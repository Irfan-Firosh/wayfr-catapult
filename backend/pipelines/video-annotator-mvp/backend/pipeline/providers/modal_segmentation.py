from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import modal

from pipeline.providers.base import ProviderRequest, StatusCallback


class ModalSegmentationProvider:
    """Modal-first provider mirroring repo style (bytes in/out artifact payloads)."""

    name = "modal"

    def __init__(self, app_name: str, function_name: str) -> None:
        self._app_name = app_name
        self._function_name = function_name

    async def process_video(
        self,
        request: ProviderRequest,
        on_status: StatusCallback,
    ) -> dict[str, Any]:
        if not self._app_name or not self._function_name:
            raise RuntimeError("MODAL_APP_NAME and MODAL_FUNCTION_NAME are required for Modal provider")

        await on_status("modal", 15, "Uploading video bytes to Modal")
        video_bytes = request.input_video_path.read_bytes()

        result = await asyncio.to_thread(
            self._call_modal,
            video_bytes,
            request.text_prompt,
            request.conf_threshold,
            request.skip_output_video,
        )

        await on_status("modal", 75, "Writing Modal artifacts to disk")
        metadata = self._write_outputs(result, request.output_video_path, request.detections_json_path)

        return {
            "provider": self.name,
            "num_frames": int(metadata.get("num_frames", 0)),
            "objects_detected": metadata.get("objects_detected", []),
            "output_video_path": str(request.output_video_path),
            "detections_json_path": str(request.detections_json_path),
        }

    def _call_modal(
        self,
        video_bytes: bytes,
        text_prompt: str | None,
        conf_threshold: float,
        skip_output_video: bool,
    ) -> dict[str, Any]:
        fn = modal.Function.from_name(self._app_name, self._function_name)
        # Keep argument shape close to repo conventions for segmentation jobs.
        response = fn.remote(
            video_bytes,
            text_prompt or "",
            "mask",
            conf_threshold,
            skip_output_video,
        )
        if not isinstance(response, dict):
            raise RuntimeError("Modal function returned unexpected response format")
        return response

    def _write_outputs(
        self,
        result: dict[str, Any],
        output_video_path: Path,
        detections_json_path: Path,
    ) -> dict[str, Any]:
        video_bytes = result.get("video") or result.get("tracked_video") or result.get("output_video")
        if video_bytes is None:
            video_bytes = b""
        if not isinstance(video_bytes, (bytes, bytearray)):
            raise RuntimeError("Modal response missing `video` bytes payload")

        detections_json = result.get("detections_json") or result.get("json")
        if isinstance(detections_json, (dict, list)):
            detections_text = json.dumps(detections_json, indent=2)
        elif isinstance(detections_json, str):
            detections_text = detections_json
        else:
            detections_text = json.dumps(
                {
                    "provider": self.name,
                    "message": "No detections payload returned from Modal function",
                    "raw_keys": sorted(result.keys()),
                },
                indent=2,
            )

        output_video_path.parent.mkdir(parents=True, exist_ok=True)
        detections_json_path.parent.mkdir(parents=True, exist_ok=True)
        if len(bytes(video_bytes)) > 0:
            output_video_path.write_bytes(bytes(video_bytes))
        elif output_video_path.exists():
            output_video_path.unlink()

        objects_detected = result.get("objects_detected", [])
        num_frames = result.get("num_frames", 0)
        return {"objects_detected": objects_detected, "num_frames": num_frames}

