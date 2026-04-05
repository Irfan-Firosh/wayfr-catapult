"""
Modal remote worker for video-annotator-mvp.

Contract (must match backend/pipeline/providers/modal_segmentation.py):
  track_video.remote(video_bytes, text_prompt, prompt_type, conf_threshold)
  -> dict with video bytes, detections_json, num_frames, objects_detected

Deploy (from this directory):
  modal deploy modal_app.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import modal

APP_NAME = "video-annotator-yolo"
FUNCTION_NAME = "track_video"

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libgomp1",
    )
    .pip_install("ultralytics", "opencv-python-headless", "numpy")
    .run_commands(
        'python -c "from ultralytics import YOLO; YOLO(\'yolov8n.pt\')"',
    )
)


def _prompt_terms(text_prompt: str | None) -> set[str]:
    if not text_prompt:
        return set()
    terms = [p.strip().lower() for p in text_prompt.replace(",", ".").split(".")]
    return {t for t in terms if t}


def _iou(box_a: list[float], box_b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return float(inter / max(union, 1e-8))


class IoUTracker:
    def __init__(self, iou_threshold: float = 0.3, max_misses: int = 12) -> None:
        self._tracks: dict[int, Any] = {}
        self._next_id = 1
        self._iou_threshold = iou_threshold
        self._max_misses = max_misses

    def update(self, detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        assigned_track_ids: set[int] = set()
        tracked: list[dict[str, Any]] = []
        candidates: list[tuple[float, int, int]] = []
        track_items = list(self._tracks.items())
        for det_idx, det in enumerate(detections):
            for track_id, track in track_items:
                if det["label"] != track["label"]:
                    continue
                iou = _iou(det["bbox"], track["bbox"])
                if iou >= self._iou_threshold:
                    candidates.append((iou, det_idx, track_id))
        used_det_idxs: set[int] = set()
        candidates.sort(key=lambda x: x[0], reverse=True)
        for iou, det_idx, track_id in candidates:
            if det_idx in used_det_idxs or track_id in assigned_track_ids:
                continue
            det = detections[det_idx]
            self._tracks[track_id]["bbox"] = det["bbox"]
            self._tracks[track_id]["misses"] = 0
            assigned_track_ids.add(track_id)
            used_det_idxs.add(det_idx)
            tracked.append({**det, "track_id": track_id, "iou_match": float(iou)})
        for det_idx, det in enumerate(detections):
            if det_idx in used_det_idxs:
                continue
            track_id = self._next_id
            self._next_id += 1
            self._tracks[track_id] = {"track_id": track_id, "bbox": det["bbox"], "label": det["label"], "misses": 0}
            assigned_track_ids.add(track_id)
            tracked.append({**det, "track_id": track_id, "iou_match": None})
        stale: list[int] = []
        for track_id, track in self._tracks.items():
            if track_id not in assigned_track_ids:
                track["misses"] += 1
                if track["misses"] > self._max_misses:
                    stale.append(track_id)
        for track_id in stale:
            self._tracks.pop(track_id, None)
        tracked.sort(key=lambda d: (d["track_id"], -d.get("confidence", 0.0)))
        return tracked


_PALETTE = [
    (80, 200, 80), (200, 80, 80), (80, 80, 200), (200, 200, 80),
    (200, 80, 200), (80, 200, 200), (255, 160, 50), (50, 160, 255),
]


def _color_for_id(track_id: int | None) -> tuple[int, int, int]:
    if track_id is None:
        return (180, 180, 180)
    return _PALETTE[track_id % len(_PALETTE)]


def draw_detections(frame, detections: list[dict[str, Any]]) -> None:
    import cv2

    for det in detections:
        x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
        label = det["label"]
        conf = det.get("confidence", 0.0)
        track_id = det.get("track_id")
        color = _color_for_id(track_id)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
        prefix = f"id={track_id}" if track_id is not None else "id=?"
        text = f"{prefix} | {label} {conf:.2f}"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
        cv2.rectangle(frame, (x1, max(0, y1 - th - 12)), (x1 + tw + 8, y1), color, -1)
        cv2.putText(
            frame, text, (x1 + 4, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 2, cv2.LINE_AA,
        )


def reencode_for_browser(video_path: Path) -> None:
    if not shutil.which("ffmpeg"):
        return
    tmp = video_path.with_suffix(".tmp.mp4")
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(tmp),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=600)
    if result.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
        tmp.replace(video_path)
    else:
        tmp.unlink(missing_ok=True)


@app.function(
    image=image,
    gpu="T4",
    timeout=60 * 45,
    memory=8192,
)
def track_video(
    video_bytes: bytes,
    text_prompt: str,
    prompt_type: str,
    conf_threshold: float,
) -> dict[str, Any]:
    """YOLOv8 + IoU tracking on GPU; prompt_type reserved for SAM-style providers."""
    import cv2
    from ultralytics import YOLO

    _ = prompt_type
    terms = _prompt_terms(text_prompt)
    model = YOLO("yolov8n.pt")
    tracker = IoUTracker(iou_threshold=0.3, max_misses=12)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        src = td_path / "input.mp4"
        dst = td_path / "out.mp4"
        src.write_bytes(video_bytes)

        cap = cv2.VideoCapture(str(src))
        if not cap.isOpened():
            raise RuntimeError("Failed to open uploaded video bytes")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(dst), fourcc, fps, (width, height))
        if not writer.isOpened():
            cap.release()
            raise RuntimeError("Failed to create video writer")

        objects_detected: set[str] = set()
        frames_out: list[dict[str, Any]] = []
        idx = 0
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                result = model.predict(frame, conf=conf_threshold, verbose=False)[0]
                dets: list[dict[str, Any]] = []
                names = result.names
                if result.boxes is not None and len(result.boxes) > 0:
                    for box in result.boxes:
                        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                        conf = float(box.conf[0].item())
                        cls_idx = int(box.cls[0].item())
                        label = str(names.get(cls_idx, str(cls_idx)))
                        if terms and not any(term in label.lower() for term in terms):
                            continue
                        dets.append({"bbox": [x1, y1, x2, y2], "confidence": conf, "label": label})
                        objects_detected.add(label)
                tracked = tracker.update(dets)
                draw_detections(frame, tracked)
                writer.write(frame)
                frames_out.append(
                    {
                        "frame_idx": idx,
                        "timestamp_sec": (idx / fps) if fps > 0 else 0.0,
                        "detections": tracked,
                    }
                )
                idx += 1
        finally:
            writer.release()
            cap.release()

        payload = {
            "provider": "modal_yolo",
            "num_frames": idx,
            "fps": fps,
            "objects_detected": sorted(objects_detected),
            "frames": frames_out,
        }
        reencode_for_browser(dst)
        out_bytes = dst.read_bytes()

    return {
        "video": out_bytes,
        "detections_json": payload,
        "num_frames": idx,
        "objects_detected": sorted(objects_detected),
    }
