"""
Home setup pipeline: orchestrates MapAnything + GSAM2 + HLoc + bridge
to build a 3D object map from a home walkthrough video.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from core.config import settings
from core.logging import get_logger
from db.repositories import homes as homes_repo
from models.home import ObjectPosition
from services.home_setup.bridge import compute_scene_objects
from services.home_setup.modal_clients import (
    call_annotate,
    call_build_reference,
    call_reconstruct,
)

logger = get_logger(__name__)

_REFERENCE_BUCKET = "home-references"
_SCENE_BUCKET = "home-scenes"

# ---------------------------------------------------------------------------
# Local disk storage (primary, always available)
# ---------------------------------------------------------------------------

def _scene_glb_local_path(home_id: str) -> Path:
    return Path(settings.scene_data_dir) / home_id / "scene.glb"


def _reference_local_path(home_id: str) -> Path:
    return Path(settings.reference_data_dir) / home_id / "reference.tar.gz"


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


def _bridge_objects_to_positions(home_id: str, objects: list[dict]) -> list[ObjectPosition]:
    positions = []
    for obj in objects:
        cx, cy, cz = obj["centroid_3d"]
        positions.append(
            ObjectPosition(
                id="",  # DB generates UUID
                home_id=home_id,
                label=obj["label"],
                track_id=obj.get("track_id"),
                x=round(float(cx), 4),
                y=round(float(cy), 4),
                z=round(float(cz), 4),
                bbox_min=[round(v, 4) for v in obj["bbox_3d_min"]],
                bbox_max=[round(v, 4) for v in obj["bbox_3d_max"]],
                confidence=obj.get("confidence"),
                n_observations=obj.get("n_observations", 1),
            )
        )
    return positions


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
        logger.info("bridge_complete", home_id=home_id, n_objects=len(objects))

        # Phase 2b: persist GLB locally only. Scene files are too large for the
        # current Supabase Storage quota/limits on the free tier.
        _save_scene_glb_local(home_id, recon_result["glb"])

        # Phase 3: build HLoc reference (sequential — needs video)
        try:
            ref_result = await call_build_reference(video_bytes)
            _save_reference_local(home_id, ref_result["tar"])
            await _upload_reference(home_id, ref_result["tar"])
        except Exception as exc:
            logger.warning("hloc_reference_failed", home_id=home_id, error=str(exc))

        # Phase 4: persist to Supabase
        positions = _bridge_objects_to_positions(home_id, objects)
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
