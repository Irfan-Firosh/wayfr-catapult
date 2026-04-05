from __future__ import annotations

from pathlib import Path
from typing import Any, Awaitable, Callable

from config import Settings
from pipeline.providers.base import ProviderRequest, StatusCallback
from pipeline.providers.modal_segmentation import ModalSegmentationProvider


JobStatusUpdate = Callable[[str, int, str], Awaitable[None]]


class PipelineOrchestrator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _provider_for(self, name: str):
        if name == "modal":
            return ModalSegmentationProvider(
                app_name=self.settings.modal_app_name,
                function_name=self.settings.modal_function_name,
            )
        if name == "gsam2":
            return ModalSegmentationProvider(
                app_name=self.settings.gsam2_app_name,
                function_name=self.settings.gsam2_function_name,
            )
        raise RuntimeError(f"Unknown detector provider: {name}")

    async def run(
        self,
        *,
        input_video_path: Path,
        output_video_path: Path,
        detections_json_path: Path,
        text_prompt: str | None,
        conf_threshold: float,
        preferred_provider: str | None,
        allow_fallback: bool,
        skip_output_video: bool = False,
        on_status: JobStatusUpdate,
    ) -> dict[str, Any]:
        _ = allow_fallback
        requested_provider = preferred_provider or self.settings.detector_provider
        order = [requested_provider]

        last_error: Exception | None = None
        for provider_name in order:
            provider = self._provider_for(provider_name)
            try:
                await on_status("provider", 12, f"Using provider: {provider.name}")
                request = ProviderRequest(
                    input_video_path=input_video_path,
                    output_video_path=output_video_path,
                    detections_json_path=detections_json_path,
                    text_prompt=text_prompt,
                    conf_threshold=conf_threshold,
                    skip_output_video=skip_output_video,
                )
                result = await provider.process_video(request, on_status)
                result["requested_provider"] = requested_provider
                result["actual_provider"] = provider.name
                return result
            except Exception as exc:
                last_error = exc
                await on_status("provider", 20, f"Provider {provider_name} failed: {exc}")
                break

        raise RuntimeError(f"All providers failed. Last error: {last_error}")

