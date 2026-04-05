"""
Full vision processing pipeline orchestrator.

Order of operations:
  1. DepthAnything v2 → depth map            ~300ms
  2. scene3d.update_from_frame(...)           ~50ms  (sequential after depth)
  3. scene3d.render_view("current")           ~100ms (sequential after update)
  4. object_detector + cloud_vision           parallel, ~150–300ms
  5. scene3d.apply_annotations(...)           ~20ms  (after detection)
  Cloud Vision runs in parallel with depth (starts immediately on raw frame).
  Gemini scene understanding runs every 3s on all four rendered views.
"""

from __future__ import annotations

import asyncio
import io
import time

import numpy as np
from PIL import Image

from core.config import settings
from core.logging import get_logger
from ml.rcac_client import rcac_client
from models.session import SessionContext
from models.vision import VisionResult
from services.scene3d import Scene3D
from services.vision.cloud_vision import cloud_vision
from services.vision.depth_estimator import depth_estimator
from services.vision.scene_analyzer import scene_analyzer

logger = get_logger(__name__)


async def process_frame(
    frame_bytes: bytes,
    session_ctx: SessionContext,
    scene3d: Scene3D,
    hazard_alerts: list | None = None,
) -> VisionResult:
    """
    Full frame processing pipeline.

    Args:
        frame_bytes:   raw JPEG bytes from the capture device
        session_ctx:   current session state (GPS, pose, last description time)
        scene3d:       per-session 3D scene object
        hazard_alerts: pre-fetched community hazard alerts (optional)
    """
    t_start = time.time()
    rgb = _jpeg_to_ndarray(frame_bytes)

    # ── Step 1: Depth estimation (required before 3D update) ─────────────────
    # Runs in parallel with Cloud Vision (which only needs raw frame)
    depth_task = asyncio.create_task(depth_estimator.estimate(frame_bytes))
    cv_task = asyncio.create_task(cloud_vision.analyze(frame_bytes))

    depth_result = await depth_task

    # ── Step 2+3: Fuse into 3D scene and render synthetic view ───────────────
    await scene3d.update_from_frame(
        rgb=rgb,
        depth=depth_result,
        pose=session_ctx.camera_pose,
    )
    current_view = await scene3d.render_view("current")
    session_ctx.frame_count += 1

    # ── Step 4: Object detection on raw camera frame ──────────────────────────
    # Use raw frame bytes for detection — synthetic 3D view is too sparse when
    # depth estimation falls back to a flat plane.
    detect_task = asyncio.create_task(rcac_client.detect(frame_bytes))

    # ── Conditional Gemini scene understanding (every 3s or on "describe" cmd) ─
    run_gemini = (
        time.time() - session_ctx.last_scene_description > settings.scene_description_interval_s
        or session_ctx.pending_voice_command == "describe"
    )
    gemini_task = None
    if run_gemini:
        all_views = await asyncio.gather(
            scene3d.render_view("top_down"),
            scene3d.render_view("left"),
            scene3d.render_view("right"),
        )
        gemini_task = asyncio.create_task(
            scene_analyzer.analyze([current_view, *all_views], session_ctx)
        )
        session_ctx.last_scene_description = time.time()

    # ── Await remaining tasks ─────────────────────────────────────────────────
    detected_objects = await detect_task
    cv_result = await cv_task
    scene_description: str | None = None
    if gemini_task:
        try:
            scene_description = await gemini_task
        except Exception as exc:
            logger.warning("gemini_scene_failed", error=str(exc))

    # ── Step 5: Back-project detections into 3D world ─────────────────────────
    if detected_objects:
        await scene3d.apply_annotations(detected_objects)

    if session_ctx.pending_voice_command:
        session_ctx.pending_voice_command = None

    elapsed = time.time() - t_start
    logger.info(
        "frame_processed",
        session_id=session_ctx.session_id,
        frame=session_ctx.frame_count,
        objects=len(detected_objects),
        elapsed_ms=round(elapsed * 1000),
    )

    return VisionResult(
        detected_objects=detected_objects,
        text_annotations=cv_result.text,
        object_labels=cv_result.objects,
        scene_views=[current_view],
        scene_point_count=scene3d.point_count,
        depth_map=depth_result,
        scene_description=scene_description,
        community_hazards=hazard_alerts or [],
    )


def _jpeg_to_ndarray(jpeg_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    img = img.resize((640, 480))
    return np.array(img, dtype=np.uint8)
