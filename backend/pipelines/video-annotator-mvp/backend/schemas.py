from typing import Any, Literal

from pydantic import BaseModel, Field


JobStatus = Literal["queued", "processing", "completed", "failed"]


class UploadResponse(BaseModel):
    job_id: str
    status: JobStatus
    original_url: str


class ProcessRequest(BaseModel):
    detector_provider: str | None = None
    text_prompt: str | None = None
    conf_threshold: float = Field(default=0.25, ge=0.0, le=1.0)
    allow_fallback: bool = False
    # When True, skip annotated MP4 (detections JSON only; faster). Default off.
    skip_output_video: bool = False


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int
    stage: str
    message: str
    original_url: str | None = None
    annotated_url: str | None = None
    detections_json_url: str | None = None
    requested_provider: str | None = None
    actual_provider: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None

