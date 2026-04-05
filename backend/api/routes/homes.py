"""
Home map routes:
  POST /api/homes                  — upload video, start setup pipeline
  GET  /api/homes                  — list all homes
  GET  /api/homes/{id}             — home detail + status
  GET  /api/homes/{id}/objects     — anchored object positions
  GET  /api/homes/{id}/scene       — download reconstructed GLB
  POST /api/homes/{id}/localize    — localize a frame against home reference
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from core.logging import get_logger
from db.repositories import homes as homes_repo
from services.home_setup.modal_clients import call_localize
from services.home_setup.pipeline import (
    get_object_evidence,
    get_object_evidence_image,
    get_legacy_object_evidence_image,
    get_legacy_object_evidence_preview,
    get_object_highlight,
    get_reference_tar,
    get_scene_glb,
    run_home_setup,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/api/homes", tags=["homes"])

MAX_VIDEO_MB = 500


# ── Request / response models ─────────────────────────────────────────────────

class LocalizeRequest(BaseModel):
    image_b64: str  # base64-encoded JPEG


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("")
async def create_home(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    name: str = Form(default="My Home"),
):
    if not video.content_type or not video.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video (mp4, mov, webm)")

    video_bytes = await video.read()
    if len(video_bytes) > MAX_VIDEO_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"Video too large (max {MAX_VIDEO_MB}MB)")

    home = await homes_repo.create(name)
    if home is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    background_tasks.add_task(run_home_setup, home.id, video_bytes)
    logger.info("home_setup_queued", home_id=home.id, name=name)

    return {"home_id": home.id, "name": home.name, "status": home.status}


@router.get("")
async def list_homes():
    homes = await homes_repo.list_all()
    return {
        "homes": [
            {
                "home_id": h.id,
                "name": h.name,
                "status": h.status,
                "num_objects": h.num_objects,
                "created_at": h.created_at,
            }
            for h in homes
        ]
    }


@router.get("/{home_id}")
async def get_home(home_id: str):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    return {
        "home_id": home.id,
        "name": home.name,
        "status": home.status,
        "num_objects": home.num_objects,
        "error": home.error,
        "created_at": home.created_at,
        "updated_at": home.updated_at,
    }


@router.get("/{home_id}/objects")
async def get_objects(home_id: str):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    objects = await homes_repo.get_objects(home_id)
    return {
        "home_id": home_id,
        "objects": [
            {
                "id": o.id,
                "label": o.label,
                "track_id": o.track_id,
                "x": o.x,
                "y": o.y,
                "z": o.z,
                "bbox_min": o.bbox_min,
                "bbox_max": o.bbox_max,
                "confidence": o.confidence,
                "n_observations": o.n_observations,
                "evidence_frame": (
                    {
                        "image_url": f"/api/homes/{home_id}/objects/{o.track_id}/evidence-frame",
                        "sampled_frame_idx": o.evidence_frame.sampled_frame_idx,
                        "source_frame_idx": o.evidence_frame.source_frame_idx,
                        "timestamp_sec": o.evidence_frame.timestamp_sec,
                        "bbox": o.evidence_frame.bbox,
                        "mask_quality": o.evidence_frame.mask_quality,
                    }
                    if o.track_id is not None and o.evidence_frame is not None and o.evidence_frame.image_path
                    else legacy_preview
                ),
            }
            for o in objects
            for legacy_preview in [get_legacy_object_evidence_preview(home_id, o.track_id) if o.track_id is not None else None]
        ],
    }


@router.get("/{home_id}/scene")
async def get_scene(home_id: str):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    if home.status != "ready":
        raise HTTPException(status_code=409, detail=f"Home not ready (status={home.status})")

    glb_bytes = await get_scene_glb(home_id)
    if glb_bytes is None:
        raise HTTPException(status_code=404, detail="Scene GLB not found for this home")

    return Response(
        content=glb_bytes,
        media_type="model/gltf-binary",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/{home_id}/object-highlights/{track_id}")
async def get_object_highlight_points(home_id: str, track_id: int, sample_limit: int = 768):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    if home.status != "ready":
        raise HTTPException(status_code=409, detail=f"Home not ready (status={home.status})")

    payload = await get_object_highlight(home_id, track_id, sample_limit=sample_limit)
    if payload is None:
        raise HTTPException(status_code=404, detail="Exact object highlight not found for this track")

    return payload


@router.get("/{home_id}/object-evidence/{track_id}")
async def get_object_evidence_payload(home_id: str, track_id: int):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    if home.status != "ready":
        raise HTTPException(status_code=409, detail=f"Home not ready (status={home.status})")

    payload = await get_object_evidence(home_id, track_id)
    if payload is None:
        return {
            "track_id": int(track_id),
            "frames": [],
            "message": "No supporting frames are stored for this object yet.",
        }

    return payload


@router.get("/{home_id}/object-evidence/{track_id}/frames/{sampled_frame_idx}")
async def get_object_evidence_frame(home_id: str, track_id: int, sampled_frame_idx: int):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    if home.status != "ready":
        raise HTTPException(status_code=409, detail=f"Home not ready (status={home.status})")

    image_bytes, evidence_frame = await get_object_evidence_image(home_id, track_id)
    if image_bytes is not None and evidence_frame is not None:
        if evidence_frame.sampled_frame_idx is not None and evidence_frame.sampled_frame_idx != sampled_frame_idx:
            raise HTTPException(status_code=404, detail="Supporting frame not found")

        return Response(
            content=image_bytes,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    legacy_image = get_legacy_object_evidence_image(home_id, track_id, sampled_frame_idx)
    if legacy_image is None:
        raise HTTPException(status_code=404, detail="Supporting frame not found")

    return Response(
        content=legacy_image,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/{home_id}/objects/{track_id}/evidence-frame")
async def get_object_evidence_frame_for_object(home_id: str, track_id: int):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    if home.status != "ready":
        raise HTTPException(status_code=409, detail=f"Home not ready (status={home.status})")

    image_bytes, _ = await get_object_evidence_image(home_id, track_id)
    if image_bytes is None:
        raise HTTPException(status_code=404, detail="Supporting frame not found")

    return Response(
        content=image_bytes,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/{home_id}/localize")
async def localize_frame(home_id: str, body: LocalizeRequest):
    home = await homes_repo.get(home_id)
    if home is None:
        raise HTTPException(status_code=404, detail=f"Home '{home_id}' not found")
    if home.status != "ready":
        raise HTTPException(status_code=409, detail=f"Home not ready (status={home.status})")

    reference_tar = await get_reference_tar(home_id)
    if reference_tar is None:
        raise HTTPException(status_code=404, detail="HLoc reference not found for this home")

    try:
        image_bytes = base64.b64decode(body.image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="image_b64 is not valid base64")

    result = await call_localize(image_bytes, reference_tar)
    return result
