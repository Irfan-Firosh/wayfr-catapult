"""
Home setup pipeline: orchestrates MapAnything + GSAM2 + HLoc + bridge
to build a 3D object map from a home walkthrough video.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any

from core.config import settings
from core.logging import get_logger
from db.repositories import homes as homes_repo
from models.home import ObjectEvidenceFrame, ObjectPosition
from services.home_setup.bridge import build_scene_highlight_samples, compute_scene_objects
from services.home_setup.modal_clients import (
    call_annotate,
    call_build_reference,
    call_reconstruct,
)

logger = get_logger(__name__)

_REFERENCE_BUCKET = "home-references"
_SCENE_BUCKET = "home-scenes"
_OBJECT_EVIDENCE_BUCKET = "home-object-evidence"

# ---------------------------------------------------------------------------
# Local disk storage (primary, always available)
# ---------------------------------------------------------------------------

def _scene_glb_local_path(home_id: str) -> Path:
    return Path(settings.scene_data_dir) / home_id / "scene.glb"


def _reference_local_path(home_id: str) -> Path:
    return Path(settings.reference_data_dir) / home_id / "reference.tar.gz"


def _scene_annotations_local_path(home_id: str) -> Path:
    return Path(settings.scene_data_dir) / home_id / "scene_annotations.json"


def _scene_evidence_manifest_local_path(home_id: str) -> Path:
    return Path(settings.scene_data_dir) / home_id / "object_evidence.json"


def _scene_evidence_frames_dir(home_id: str) -> Path:
    return Path(settings.scene_data_dir) / home_id / "object_evidence_frames"


def _scene_evidence_frame_local_path(home_id: str, track_id: int, sampled_frame_idx: int) -> Path:
    return _scene_evidence_frames_dir(home_id) / f"track-{track_id:04d}-sample-{sampled_frame_idx:05d}.jpg"


def _save_scene_glb_local(home_id: str, glb_bytes: bytes) -> None:
    """Write GLB to local disk. Raises on failure (pipeline gate)."""
    path = _scene_glb_local_path(home_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(glb_bytes)
    logger.info("scene_glb_saved_local", home_id=home_id, path=str(path), size_mb=round(len(glb_bytes) / 1e6, 1))


def _load_scene_glb_local(home_id: str) -> bytes | None:
    """Read GLB from local disk, or None if missing."""
    path = _scene_glb_local_path(home_id)
    if path.exists():
        return path.read_bytes()
    return None


def _save_scene_annotations_local(home_id: str, payload: dict[str, Any]) -> None:
    """Write lightweight object highlight data to local disk."""
    path = _scene_annotations_local_path(home_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    logger.info("scene_annotations_saved_local", home_id=home_id, path=str(path), n_objects=len(payload.get("objects", [])))


def _load_scene_annotations_local(home_id: str) -> dict[str, Any] | None:
    """Read local object highlight data, or None if missing."""
    path = _scene_annotations_local_path(home_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("scene_annotations_load_failed", home_id=home_id, error=str(exc))
        return None


def _save_scene_evidence_local(home_id: str, payload: dict[str, Any]) -> None:
    path = _scene_evidence_manifest_local_path(home_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    logger.info("scene_evidence_saved_local", home_id=home_id, path=str(path), n_tracks=len(payload.get("tracks", [])))


def _load_scene_evidence_local(home_id: str) -> dict[str, Any] | None:
    path = _scene_evidence_manifest_local_path(home_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("scene_evidence_load_failed", home_id=home_id, error=str(exc))
        return None


def _legacy_scene_evidence_track_map(home_id: str) -> dict[int, dict[str, Any]]:
    payload = _load_scene_evidence_local(home_id)
    if payload is None:
        return {}

    tracks = payload.get("tracks")
    if not isinstance(tracks, list):
        return {}

    track_map: dict[int, dict[str, Any]] = {}
    for track in tracks:
        if not isinstance(track, dict) or track.get("track_id") is None:
            continue
        track_map[int(track["track_id"])] = track
    return track_map


def _save_reference_local(home_id: str, tar_bytes: bytes) -> None:
    """Write HLoc reference tarball to local disk."""
    path = _reference_local_path(home_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(tar_bytes)
    logger.info("reference_saved_local", home_id=home_id, path=str(path), size_mb=round(len(tar_bytes) / 1e6, 1))


def _load_reference_local(home_id: str) -> bytes | None:
    """Read HLoc reference from local disk, or None if missing."""
    path = _reference_local_path(home_id)
    if path.exists():
        return path.read_bytes()
    return None

# ---------------------------------------------------------------------------
# Supabase cloud storage
# ---------------------------------------------------------------------------

async def _upload_scene_glb(home_id: str, glb_bytes: bytes) -> None:
    """Upload reconstructed GLB to Supabase Storage."""
    from db.client import get_supabase

    client = get_supabase()
    if client is None:
        raise RuntimeError("Supabase is not configured for scene GLB upload")
    path = f"{home_id}/scene.glb"
    client.storage.from_(_SCENE_BUCKET).upload(
        path,
        glb_bytes,
        {"content-type": "model/gltf-binary", "upsert": "true"},
    )
    logger.info("scene_glb_uploaded", home_id=home_id, size_mb=round(len(glb_bytes) / 1e6, 1))


async def _download_scene_glb(home_id: str) -> bytes | None:
    """Serve the scene GLB from local disk.

    The main home setup flow intentionally keeps scene GLBs local-only so large
    files do not fail against Supabase Storage size limits.
    """
    local = _load_scene_glb_local(home_id)
    if local is not None:
        logger.info("scene_glb_served_from_local", home_id=home_id)
        return local

    from db.client import get_supabase

    client = get_supabase()
    if client is not None:
        path = f"{home_id}/scene.glb"
        try:
            data = client.storage.from_(_SCENE_BUCKET).download(path)
            if data:
                return data
        except Exception as exc:
            logger.warning("scene_glb_cloud_download_failed", home_id=home_id, error=str(exc))

    return None


async def _upload_reference(home_id: str, tar_bytes: bytes) -> None:
    """Upload HLoc reference tarball to Supabase Storage (non-fatal cloud backup)."""
    from db.client import get_supabase

    client = get_supabase()
    if client is None:
        logger.warning("supabase_not_configured_skip_reference_upload")
        return
    path = f"{home_id}/reference.tar.gz"
    try:
        client.storage.from_(_REFERENCE_BUCKET).upload(
            path,
            tar_bytes,
            {"content-type": "application/gzip", "upsert": "true"},
        )
        logger.info("reference_uploaded", home_id=home_id, size_mb=round(len(tar_bytes) / 1e6, 1))
    except Exception as exc:
        logger.warning("reference_cloud_upload_failed", home_id=home_id, error=str(exc))


async def _download_reference(home_id: str) -> bytes | None:
    """Try Supabase first, fall back to local disk."""
    from db.client import get_supabase

    client = get_supabase()
    if client is not None:
        path = f"{home_id}/reference.tar.gz"
        try:
            data = client.storage.from_(_REFERENCE_BUCKET).download(path)
            if data:
                return data
        except Exception as exc:
            logger.warning("reference_cloud_download_failed", home_id=home_id, error=str(exc))

    local = _load_reference_local(home_id)
    if local is not None:
        logger.info("reference_served_from_local", home_id=home_id)
    return local


def _bridge_objects_to_positions(
    home_id: str,
    objects: list[dict],
    evidence_by_track: dict[int, dict[str, Any]] | None = None,
) -> list[ObjectPosition]:
    evidence_by_track = evidence_by_track or {}
    positions = []
    for obj in objects:
        cx, cy, cz = obj["centroid_3d"]
        track_id = obj.get("track_id")
        evidence_raw = evidence_by_track.get(int(track_id)) if track_id is not None else None
        positions.append(
            ObjectPosition(
                id="",  # DB generates UUID
                home_id=home_id,
                label=obj["label"],
                track_id=track_id,
                x=round(float(cx), 4),
                y=round(float(cy), 4),
                z=round(float(cz), 4),
                bbox_min=[round(v, 4) for v in obj["bbox_3d_min"]],
                bbox_max=[round(v, 4) for v in obj["bbox_3d_max"]],
                confidence=obj.get("confidence"),
                n_observations=obj.get("n_observations", 1),
                evidence_frame=(
                    ObjectEvidenceFrame(
                        image_path=str(evidence_raw["image_path"]),
                        sampled_frame_idx=int(evidence_raw["sampled_frame_idx"])
                        if evidence_raw.get("sampled_frame_idx") is not None else None,
                        source_frame_idx=int(evidence_raw["source_frame_idx"])
                        if evidence_raw.get("source_frame_idx") is not None else None,
                        timestamp_sec=float(evidence_raw["timestamp_sec"])
                        if evidence_raw.get("timestamp_sec") is not None else None,
                        bbox=[float(v) for v in (evidence_raw.get("bbox") or [])[:4]] or None,
                        mask_quality=float(evidence_raw["mask_quality"])
                        if evidence_raw.get("mask_quality") is not None else None,
                    )
                    if evidence_raw and evidence_raw.get("image_path")
                    else None
                ),
            )
        )
    return positions


def _extract_video_frames(video_bytes: bytes, frame_indices: set[int]) -> dict[int, Any]:
    if not frame_indices:
        return {}

    import cv2

    ordered = sorted({int(idx) for idx in frame_indices if int(idx) >= 0})
    if not ordered:
        return {}

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_video:
        tmp_video.write(video_bytes)
        tmp_path = Path(tmp_video.name)

    frames: dict[int, Any] = {}
    try:
        cap = cv2.VideoCapture(str(tmp_path))
        for frame_idx in ordered:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if ok and frame is not None:
                frames[frame_idx] = frame
        cap.release()
    finally:
        tmp_path.unlink(missing_ok=True)

    return frames


def _object_evidence_storage_path(home_id: str, track_id: int) -> str:
    return f"{home_id}/track-{track_id}.jpg"


def _upload_object_evidence_image(path: str, image_bytes: bytes) -> bool:
    from db.client import get_supabase

    client = get_supabase()
    if client is None:
        logger.warning("supabase_not_configured_skip_object_evidence_upload", path=path)
        return False

    try:
        client.storage.from_(_OBJECT_EVIDENCE_BUCKET).upload(
            path,
            image_bytes,
            {"content-type": "image/jpeg", "upsert": "true"},
        )
        return True
    except Exception as exc:
        logger.warning("object_evidence_upload_failed", path=path, error=str(exc))
        return False


async def _download_object_evidence_image(path: str) -> bytes | None:
    from db.client import get_supabase

    client = get_supabase()
    if client is None:
        return None

    try:
        data = client.storage.from_(_OBJECT_EVIDENCE_BUCKET).download(path)
    except Exception as exc:
        logger.warning("object_evidence_download_failed", path=path, error=str(exc))
        return None

    return data or None


def _candidate_sampled_frames_for_track(
    track: dict[str, Any],
    track_id: int,
    frame_by_sample_idx: dict[int, dict[str, Any]],
    detections_by_track: dict[int, list[dict[str, Any]]],
) -> list[int]:
    best_frames = [
        int(frame_idx)
        for frame_idx in (track.get("best_frames") or [])
        if int(frame_idx) in frame_by_sample_idx
    ]
    if best_frames:
        return best_frames

    fallback_frames: list[int] = []
    for item in detections_by_track.get(track_id, []):
        sampled_frame_idx = int(item["frame_record"].get("sampled_frame_idx", -1))
        if sampled_frame_idx >= 0 and sampled_frame_idx not in fallback_frames:
            fallback_frames.append(sampled_frame_idx)
    return fallback_frames


def _score_evidence_candidate(
    *,
    bbox: list[float] | None,
    frame_width: int | None,
    frame_height: int | None,
    mask_area_ratio: float | None = None,
    bbox_area_ratio: float | None = None,
    mask_quality: float | None = None,
) -> tuple[float, float, float, float]:
    bbox = bbox or [0.0, 0.0, 0.0, 0.0]
    x1, y1, x2, y2 = [float(v) for v in bbox[:4]]
    raw_w = max(0.0, x2 - x1)
    raw_h = max(0.0, y2 - y1)
    raw_area = raw_w * raw_h

    visible_ratio = 1.0
    computed_bbox_area_ratio = 0.0
    if frame_width and frame_height and frame_width > 0 and frame_height > 0 and raw_area > 0:
        clipped_x1 = min(max(x1, 0.0), float(frame_width))
        clipped_y1 = min(max(y1, 0.0), float(frame_height))
        clipped_x2 = min(max(x2, 0.0), float(frame_width))
        clipped_y2 = min(max(y2, 0.0), float(frame_height))
        clipped_w = max(0.0, clipped_x2 - clipped_x1)
        clipped_h = max(0.0, clipped_y2 - clipped_y1)
        clipped_area = clipped_w * clipped_h
        visible_ratio = clipped_area / raw_area if raw_area > 0 else 0.0
        computed_bbox_area_ratio = clipped_area / float(frame_width * frame_height)
    elif raw_area > 0 and bbox_area_ratio is not None:
        computed_bbox_area_ratio = max(float(bbox_area_ratio), 0.0)

    bbox_area_ratio_value = (
        max(float(bbox_area_ratio), computed_bbox_area_ratio, 0.0)
        if bbox_area_ratio is not None
        else computed_bbox_area_ratio
    )
    visible_area_ratio = (
        max(float(mask_area_ratio), 0.0)
        if mask_area_ratio is not None
        else bbox_area_ratio_value
    )
    quality = max(float(mask_quality or 0.0), 0.0)

    # Prefer fully in-frame objects first; among those, prefer the frame where
    # the object occupies the most visible area. Keep mask quality as a tiebreaker.
    fully_in_frame = 1.0 if visible_ratio >= 0.98 else 0.0
    primary_score = visible_area_ratio * visible_ratio
    return (fully_in_frame, primary_score, visible_area_ratio, quality + bbox_area_ratio_value * 0.01)


def _select_object_evidence_records(detections_json: dict[str, Any]) -> dict[int, dict[str, Any]]:
    tracks = detections_json.get("tracks")
    frames = detections_json.get("frames")
    if not isinstance(tracks, list) or not isinstance(frames, list):
        return {}
    frame_width = int(detections_json.get("frame_width", 0) or 0)
    frame_height = int(detections_json.get("frame_height", 0) or 0)

    frame_by_sample_idx: dict[int, dict[str, Any]] = {}
    detections_by_track: dict[int, list[dict[str, Any]]] = {}

    for frame_record in frames:
        if not isinstance(frame_record, dict):
            continue
        sampled_frame_idx = int(frame_record.get("sampled_frame_idx", -1))
        if sampled_frame_idx >= 0:
            frame_by_sample_idx[sampled_frame_idx] = frame_record
        for detection in frame_record.get("detections", []) or []:
            if not isinstance(detection, dict) or detection.get("track_id") is None:
                continue
            track_id = int(detection["track_id"])
            detections_by_track.setdefault(track_id, []).append({
                "frame_record": frame_record,
                "detection": detection,
            })

    selected: dict[int, dict[str, Any]] = {}
    for track in tracks:
        if not isinstance(track, dict) or track.get("track_id") is None:
            continue
        track_id = int(track["track_id"])
        label = str(track.get("canonical_label") or "unknown_object")
        best_record: dict[str, Any] | None = None
        best_score: tuple[float, float, float, float] | None = None

        for sampled_frame_idx in _candidate_sampled_frames_for_track(
            track,
            track_id,
            frame_by_sample_idx,
            detections_by_track,
        ):
            frame_record = frame_by_sample_idx.get(sampled_frame_idx)
            if not frame_record:
                continue

            detection = next(
                (
                    det
                    for det in frame_record.get("detections", []) or []
                    if isinstance(det, dict) and int(det.get("track_id", -1)) == track_id
                ),
                None,
            )
            if detection is None:
                continue

            source_frame_idx = int(frame_record.get("frame_idx", -1))
            if source_frame_idx < 0:
                continue

            record = {
                "track_id": track_id,
                "label": label,
                "sampled_frame_idx": sampled_frame_idx,
                "source_frame_idx": source_frame_idx,
                "timestamp_sec": float(frame_record.get("timestamp_sec", 0.0)),
                "bbox": [float(v) for v in (detection.get("bbox") or [0, 0, 0, 0])[:4]],
                "mask_quality": float(detection.get("mask_quality", 0.0)),
                "label_confidence": float(detection.get("score", track.get("label_confidence", 0.0)) or 0.0),
                "mask_area_ratio": float(detection.get("mask_area_ratio", 0.0) or 0.0),
                "bbox_area_ratio": float(detection.get("bbox_area_ratio", 0.0) or 0.0),
            }
            score = _score_evidence_candidate(
                bbox=record["bbox"],
                frame_width=frame_width,
                frame_height=frame_height,
                mask_area_ratio=record["mask_area_ratio"],
                bbox_area_ratio=record["bbox_area_ratio"],
                mask_quality=record["mask_quality"],
            )
            if best_score is None or score > best_score:
                best_score = score
                best_record = record

        if best_record is not None:
            selected[track_id] = best_record

    return selected


def _build_object_evidence(home_id: str, video_bytes: bytes, detections_json: dict[str, Any]) -> dict[int, dict[str, Any]]:
    import cv2

    selected_records = _select_object_evidence_records(detections_json)
    if not selected_records:
        return {}

    source_frames = _extract_video_frames(
        video_bytes,
        {int(record["source_frame_idx"]) for record in selected_records.values()},
    )

    uploaded: dict[int, dict[str, Any]] = {}
    for track_id, record in selected_records.items():
        source_frame = source_frames.get(int(record["source_frame_idx"]))
        if source_frame is None:
            continue

        frame_image = source_frame.copy()
        bbox_raw = record.get("bbox") or [0, 0, 0, 0]
        x1, y1, x2, y2 = [int(round(float(v))) for v in bbox_raw[:4]]
        x1 = max(0, min(x1, frame_image.shape[1] - 1))
        x2 = max(0, min(x2, frame_image.shape[1] - 1))
        y1 = max(0, min(y1, frame_image.shape[0] - 1))
        y2 = max(0, min(y2, frame_image.shape[0] - 1))
        if x2 > x1 and y2 > y1:
            overlay = frame_image.copy()
            cv2.rectangle(overlay, (x1, y1), (x2, y2), (35, 197, 94), thickness=-1)
            frame_image = cv2.addWeighted(overlay, 0.16, frame_image, 0.84, 0)
            cv2.rectangle(frame_image, (x1, y1), (x2, y2), (35, 197, 94), thickness=3)
        cv2.putText(
            frame_image,
            str(record.get("label") or f"track_{track_id}").replace("_", " "),
            (max(12, x1), max(24, y1 - 10 if y1 > 24 else y1 + 24)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

        ok, encoded = cv2.imencode(".jpg", frame_image, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        if not ok:
            logger.warning("object_evidence_encode_failed", home_id=home_id, track_id=track_id)
            continue

        image_path = _object_evidence_storage_path(home_id, track_id)
        if not _upload_object_evidence_image(image_path, encoded.tobytes()):
            continue

        uploaded[track_id] = {
            **record,
            "image_path": image_path,
        }

    return uploaded


async def run_home_setup(home_id: str, video_bytes: bytes) -> None:
    """
    Full home setup pipeline. Runs as a background task.
    Updates home_maps.status to 'ready' or 'failed' when done.
    """
    logger.info("home_setup_start", home_id=home_id, size_mb=round(len(video_bytes) / 1e6, 1))

    try:
        # Phase 1: run reconstruction + annotation in parallel
        recon_result, annot_result = await asyncio.gather(
            call_reconstruct(video_bytes),
            call_annotate(video_bytes),
        )

        # Phase 2: bridge 2D detections to 3D
        det_json_raw = annot_result.get("detections_json", "{}")
        if isinstance(det_json_raw, str):
            det_json: dict = json.loads(det_json_raw)
        else:
            det_json = det_json_raw

        objects = await asyncio.to_thread(
            compute_scene_objects,
            recon_result["glb"],
            recon_result["scene_data"],
            det_json,
        )
        object_evidence_by_track = await asyncio.to_thread(
            _build_object_evidence,
            home_id,
            video_bytes,
            det_json,
        )
        logger.info("bridge_complete", home_id=home_id, n_objects=len(objects))

        # Phase 2b: persist GLB locally only. Scene files are too large for the
        # current Supabase Storage quota/limits on the free tier.
        _save_scene_glb_local(home_id, recon_result["glb"])
        _save_scene_annotations_local(
            home_id,
            build_scene_highlight_samples(recon_result["glb"], objects),
        )

        # Phase 3: build HLoc reference (sequential — needs video)
        try:
            ref_result = await call_build_reference(video_bytes)
            _save_reference_local(home_id, ref_result["tar"])
            await _upload_reference(home_id, ref_result["tar"])
        except Exception as exc:
            logger.warning("hloc_reference_failed", home_id=home_id, error=str(exc))

        # Phase 4: persist to Supabase
        positions = _bridge_objects_to_positions(home_id, objects, object_evidence_by_track)
        await homes_repo.upsert_objects(home_id, positions)
        await homes_repo.update_status(home_id, "ready", num_objects=len(positions))
        logger.info("home_setup_complete", home_id=home_id, n_objects=len(positions))

    except Exception as exc:
        logger.error("home_setup_failed", home_id=home_id, error=str(exc))
        await homes_repo.update_status(home_id, "failed", error=str(exc))


async def get_reference_tar(home_id: str) -> bytes | None:
    """Retrieve the HLoc reference tar for a home (for localization)."""
    return await _download_reference(home_id)


async def get_scene_glb(home_id: str) -> bytes | None:
    """Retrieve the reconstructed GLB for a home (for 3D viewer)."""
    return await _download_scene_glb(home_id)


async def get_object_highlight(home_id: str, track_id: int, sample_limit: int = 768) -> dict[str, Any] | None:
    """Retrieve sampled exact object points for annotator highlighting."""
    payload = _load_scene_annotations_local(home_id)
    if payload is None:
        return None

    objects = payload.get("objects")
    if not isinstance(objects, list):
        return None

    for obj in objects:
        if int(obj.get("track_id", -1)) != int(track_id):
            continue

        sampled_points = obj.get("sampled_points") or []
        if sample_limit > 0 and len(sampled_points) > sample_limit:
            step = max(1, int(len(sampled_points) / sample_limit))
            sampled_points = sampled_points[::step][:sample_limit]

        return {
            "track_id": int(obj["track_id"]),
            "label": str(obj.get("label") or ""),
            "source": str(obj.get("source") or "bridge_point_indices"),
            "point_count": int(obj.get("point_count") or len(sampled_points)),
            "sampled_point_count": int(len(sampled_points)),
            "sample_limit": int(sample_limit),
            "bbox_3d_min": obj.get("bbox_3d_min"),
            "bbox_3d_max": obj.get("bbox_3d_max"),
            "centroid_3d": obj.get("centroid_3d"),
            "sampled_points": sampled_points,
        }

    return None


async def get_object_evidence(home_id: str, track_id: int) -> dict[str, Any] | None:
    obj = await homes_repo.get_object_by_track(home_id, track_id)
    if obj is not None and obj.evidence_frame is not None:
        evidence_frame = obj.evidence_frame
        return {
            "track_id": int(track_id),
            "label": obj.label,
            "frames_seen_count": int(obj.n_observations),
            "frames": [
                {
                    "frame_idx": evidence_frame.source_frame_idx,
                    "sampled_frame_idx": evidence_frame.sampled_frame_idx,
                    "timestamp_sec": evidence_frame.timestamp_sec,
                    "bbox": evidence_frame.bbox,
                    "mask_quality": evidence_frame.mask_quality,
                    "image_url": (
                        f"/api/homes/{home_id}/objects/{track_id}/evidence-frame"
                        if evidence_frame.image_path
                        else None
                    ),
                }
            ],
        }

    legacy_track = _legacy_scene_evidence_track_map(home_id).get(int(track_id))
    if legacy_track is None:
        return None

    frames_payload: list[dict[str, Any]] = []
    for frame in legacy_track.get("frames") or []:
        if not isinstance(frame, dict):
            continue
        sampled_frame_idx = int(frame.get("sampled_frame_idx", -1))
        if sampled_frame_idx < 0:
            continue
        asset_path = _scene_evidence_frame_local_path(home_id, track_id, sampled_frame_idx)
        frames_payload.append({
            "frame_idx": int(frame.get("frame_idx", -1)),
            "sampled_frame_idx": sampled_frame_idx,
            "timestamp_sec": float(frame.get("timestamp_sec", 0.0)),
            "bbox": frame.get("bbox"),
            "mask_quality": float(frame.get("mask_quality", 0.0)),
            "image_url": (
                f"/api/homes/{home_id}/object-evidence/{track_id}/frames/{sampled_frame_idx}"
                if asset_path.exists()
                else None
            ),
        })

    return {
        "track_id": int(track_id),
        "label": str(legacy_track.get("label") or (obj.label if obj else "")),
        "frames_seen_count": int(legacy_track.get("frames_seen_count", obj.n_observations if obj else 0)),
        "frames": frames_payload,
    }


async def get_object_evidence_image(home_id: str, track_id: int) -> tuple[bytes | None, ObjectEvidenceFrame | None]:
    obj = await homes_repo.get_object_by_track(home_id, track_id)
    if obj is None or obj.evidence_frame is None:
        return None, None

    image_bytes = await _download_object_evidence_image(obj.evidence_frame.image_path)
    return image_bytes, obj.evidence_frame


def get_legacy_object_evidence_image(home_id: str, track_id: int, sampled_frame_idx: int) -> bytes | None:
    legacy_track = _legacy_scene_evidence_track_map(home_id).get(int(track_id))
    if legacy_track is None:
        return None

    matching_frame = next(
        (
            frame
            for frame in (legacy_track.get("frames") or [])
            if isinstance(frame, dict) and int(frame.get("sampled_frame_idx", -1)) == int(sampled_frame_idx)
        ),
        None,
    )
    if matching_frame is None:
        return None

    asset_path = _scene_evidence_frame_local_path(home_id, track_id, sampled_frame_idx)
    if not asset_path.exists():
        return None

    return asset_path.read_bytes()


def get_legacy_object_evidence_preview(home_id: str, track_id: int) -> dict[str, Any] | None:
    legacy_track = _legacy_scene_evidence_track_map(home_id).get(int(track_id))
    if legacy_track is None:
        return None

    best_preview: dict[str, Any] | None = None
    best_score: tuple[float, float, float, float] | None = None
    for frame in legacy_track.get("frames") or []:
        if not isinstance(frame, dict):
            continue
        sampled_frame_idx = int(frame.get("sampled_frame_idx", -1))
        if sampled_frame_idx < 0:
            continue

        asset_path = _scene_evidence_frame_local_path(home_id, track_id, sampled_frame_idx)
        if not asset_path.exists():
            continue

        from PIL import Image

        with Image.open(asset_path) as image:
            frame_width, frame_height = image.size

        preview = {
            "image_url": f"/api/homes/{home_id}/object-evidence/{track_id}/frames/{sampled_frame_idx}",
            "sampled_frame_idx": sampled_frame_idx,
            "source_frame_idx": int(frame.get("frame_idx", -1)),
            "timestamp_sec": float(frame.get("timestamp_sec", 0.0)),
            "bbox": frame.get("bbox"),
            "mask_quality": float(frame.get("mask_quality", 0.0)),
        }
        score = _score_evidence_candidate(
            bbox=preview["bbox"],
            frame_width=frame_width,
            frame_height=frame_height,
            mask_quality=preview["mask_quality"],
        )
        if best_score is None or score > best_score:
            best_score = score
            best_preview = preview

    return best_preview
