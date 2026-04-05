"""
Thin async wrappers around Modal GPU functions.
All calls use asyncio.to_thread since Modal .remote() is synchronous.
"""

from __future__ import annotations

import asyncio
from typing import Any

from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


def _get_fn(app_name: str, fn_name: str):
    import modal
    return modal.Function.from_name(app_name, fn_name)


async def call_reconstruct(video_bytes: bytes) -> dict[str, Any]:
    """Call MapAnything reconstruct. Returns {glb, scene_data, num_frames, num_points, source_fps}."""
    def _run():
        fn = _get_fn(settings.modal_reconstruct_app, settings.modal_reconstruct_fn)
        return fn.remote(video_bytes, 2)

    logger.info("modal_reconstruct_start", size_mb=round(len(video_bytes) / 1e6, 1))
    result = await asyncio.to_thread(_run)
    logger.info("modal_reconstruct_done", num_points=result.get("num_points"))
    return result


async def call_annotate(video_bytes: bytes) -> dict[str, Any]:
    """Call GSAM2 annotator. Returns {video, detections_json, num_frames, objects_detected}."""
    def _run():
        fn = _get_fn(settings.modal_annotator_app, settings.modal_annotator_fn)
        return fn.remote(video_bytes, "", "mask", 0.20, True)

    logger.info("modal_annotate_start", size_mb=round(len(video_bytes) / 1e6, 1))
    result = await asyncio.to_thread(_run)
    logger.info("modal_annotate_done", objects=result.get("objects_detected"))
    return result


async def call_build_reference(video_bytes: bytes) -> dict[str, Any]:
    """Call HLoc build_reference. Returns {tar, num_frames, source_fps, num_registered, num_points3d}."""
    def _run():
        fn = _get_fn(settings.modal_hloc_app, settings.modal_hloc_build_fn)
        return fn.remote(video_bytes)

    logger.info("modal_build_reference_start", size_mb=round(len(video_bytes) / 1e6, 1))
    result = await asyncio.to_thread(_run)
    logger.info("modal_build_reference_done", num_registered=result.get("num_registered"))
    return result


async def call_localize(image_bytes: bytes, reference_tar: bytes) -> dict[str, Any]:
    """Call HLoc localize_frame. Returns {success, qw, qx, qy, qz, tx, ty, tz} or {success: False, error}."""
    def _run():
        fn = _get_fn(settings.modal_hloc_app, settings.modal_hloc_localize_fn)
        return fn.remote(image_bytes, reference_tar)

    result = await asyncio.to_thread(_run)
    return result
