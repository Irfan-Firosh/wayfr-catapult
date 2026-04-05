from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol


StatusCallback = Callable[[str, int, str], Awaitable[None]]


@dataclass
class ProviderRequest:
    input_video_path: Path
    output_video_path: Path
    detections_json_path: Path
    text_prompt: str | None
    conf_threshold: float
    skip_output_video: bool = False


class AnnotatorProvider(Protocol):
    name: str

    async def process_video(
        self,
        request: ProviderRequest,
        on_status: StatusCallback,
    ) -> dict[str, Any]:
        ...

