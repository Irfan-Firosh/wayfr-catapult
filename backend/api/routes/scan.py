"""
POST /api/scan — accept a video file, extract frames, run object detection,
merge detections across frames, return 3D-positioned annotations.

This is the "batch LIDAR" mode: video in → annotated 3D scene out.
"""

from __future__ import annotations

import asyncio
import tempfile
import time
from dataclasses import dataclass

import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException

from core.logging import get_logger
from ml.rcac_client import rcac_client
from models.vision import ObjectAnnotation

logger = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["scan"])

EXTRACT_FPS = 0.5  # frames per second to sample — lower for faster MVP
MAX_FRAMES = 5  # cap for reasonable processing time (~30-60s total)
MAX_FILE_MB = 100
CONCURRENCY = 3  # parallel VLM calls


# ── Distance / position helpers ──────────────────────────────────────────────

DISTANCE_MAP = {"close": 1.5, "medium": 3.5, "far": 6.0}


def _compute_3d(obj: ObjectAnnotation) -> dict:
    """Convert 2D bbox + hints into 3D world coordinates."""
    # x from bbox center (normalised 0-1 → -4m to +4m)
    if obj.bbox_2d:
        cx = obj.bbox_2d.x + obj.bbox_2d.width / 2
        x = (cx - 0.5) * 8.0
    elif obj.direction == "left":
        x = -2.0
    elif obj.direction == "right":
        x = 2.0
    else:
        x = 0.0

    # z from distance hint
    z = DISTANCE_MAP.get(obj.distance_hint or "", 3.0)

    # y — ground level; slightly above for tall objects
    y = 0.0

    # distance_m
    distance_m = round(float(np.sqrt(x**2 + z**2)), 2)

    return {
        "label": obj.label,
        "x": round(x, 2),
        "y": round(y, 2),
        "z": round(z, 2),
        "urgency": obj.urgency,
        "confidence": round(obj.confidence, 2),
        "distance_m": distance_m,
        "direction": obj.direction or ("left" if x < -0.5 else "right" if x > 0.5 else "ahead"),
    }


# ── Detection merging ────────────────────────────────────────────────────────


@dataclass
class _MergedObj:
    label: str
    urgency: str
    xs: list[float]
    zs: list[float]
    confs: list[float]
    direction: str | None
    count: int = 1


def _merge_detections(all_dets: list[list[dict]]) -> list[dict]:
    """Merge detections across frames. Same label within 1.5m → single object."""
    merged: list[_MergedObj] = []

    for frame_dets in all_dets:
        for det in frame_dets:
            matched = False
            for m in merged:
                if m.label == det["label"]:
                    dx = abs(np.mean(m.xs) - det["x"])
                    dz = abs(np.mean(m.zs) - det["z"])
                    if dx < 1.5 and dz < 1.5:
                        m.xs.append(det["x"])
                        m.zs.append(det["z"])
                        m.confs.append(det["confidence"])
                        m.count += 1
                        # Keep highest urgency
                        if det["urgency"] == "high":
                            m.urgency = "high"
                        elif det["urgency"] == "medium" and m.urgency != "high":
                            m.urgency = "medium"
                        matched = True
                        break
            if not matched:
                merged.append(
                    _MergedObj(
                        label=det["label"],
                        urgency=det["urgency"],
                        xs=[det["x"]],
                        zs=[det["z"]],
                        confs=[det["confidence"]],
                        direction=det["direction"],
                    )
                )

    results: list[dict] = []
    for m in merged:
        x = round(float(np.mean(m.xs)), 2)
        z = round(float(np.mean(m.zs)), 2)
        results.append(
            {
                "label": m.label,
                "x": x,
                "y": 0,
                "z": z,
                "urgency": m.urgency,
                "confidence": round(float(np.mean(m.confs)), 2),
                "distance_m": round(float(np.sqrt(x**2 + z**2)), 2),
                "direction": m.direction
                or ("left" if x < -0.5 else "right" if x > 0.5 else "ahead"),
                "frame_count": m.count,
            }
        )

    return results


# ── Frame extraction ──────────────────────────────────────────────────────────


def _extract_frames(video_path: str, fps: float = EXTRACT_FPS) -> list[bytes]:
    """Extract JPEG frames from video at the given FPS."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Could not open video file")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_interval = max(1, int(video_fps / fps))
    duration_s = total_frames / video_fps if video_fps > 0 else 0

    logger.info(
        "extracting_frames",
        video_fps=video_fps,
        total=total_frames,
        interval=frame_interval,
        duration_s=round(duration_s, 1),
    )

    frames: list[bytes] = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % frame_interval == 0 and len(frames) < MAX_FRAMES:
            # Resize to 640x480 and encode as JPEG
            frame = cv2.resize(frame, (640, 480))
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frames.append(buf.tobytes())
        frame_idx += 1

    cap.release()
    logger.info("frames_extracted", count=len(frames))
    return frames


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.post("/scan")
async def scan_video(file: UploadFile = File(...)):
    """
    Accept a video upload, process frames through the vision pipeline,
    return merged 3D-positioned object annotations.
    """
    t_start = time.time()

    # Validate
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video (mp4, webm, mov)")

    content = await file.read()
    if len(content) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"Video too large (max {MAX_FILE_MB}MB)")

    # Save to temp file for cv2
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    # Extract frames
    frames = await asyncio.to_thread(_extract_frames, tmp_path)
    if not frames:
        raise HTTPException(status_code=400, detail="No frames could be extracted from video")

    # Detect objects in frames concurrently (bounded to avoid rate limits)
    sem = asyncio.Semaphore(CONCURRENCY)

    async def _detect_frame(idx: int, frame: bytes) -> list[dict]:
        async with sem:
            try:
                result = await rcac_client.detect(frame)
                dets = [_compute_3d(obj) for obj in result]
                logger.info("frame_scanned", frame=idx + 1, total=len(frames), objects=len(dets))
                return dets
            except Exception as exc:
                logger.warning("frame_detect_failed", frame=idx + 1, error=str(exc))
                return []

    all_detections: list[list[dict]] = await asyncio.gather(
        *[_detect_frame(i, f) for i, f in enumerate(frames)]
    )

    # Merge across frames
    merged = _merge_detections(all_detections)

    # Clean up temp file
    import os

    try:
        os.unlink(tmp_path)
    except OSError:
        pass

    elapsed = time.time() - t_start
    frames_with_objects = sum(1 for d in all_detections if d)

    logger.info(
        "scan_complete",
        objects=len(merged),
        frames=len(frames),
        frames_with_objects=frames_with_objects,
        elapsed_s=round(elapsed, 1),
    )

    return {
        "objects": merged,
        "stats": {
            "total_frames": len(frames),
            "frames_with_objects": frames_with_objects,
            "unique_objects": len(merged),
            "processing_time_s": round(elapsed, 1),
        },
    }
