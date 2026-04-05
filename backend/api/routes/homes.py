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
from services.home_setup.pipeline import get_reference_tar, get_scene_glb, run_home_setup

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
            }
            for o in objects
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
