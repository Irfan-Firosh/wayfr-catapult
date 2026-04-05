from typing import Any, Literal

from pydantic import BaseModel, Field


JobStatus = Literal["queued", "processing", "completed", "failed"]


class UploadResponse(BaseModel):
    job_id: str
    status: JobStatus
    original_url: str


class ProcessRequest(BaseModel):
    fps: int = Field(default=2, ge=1, le=30)
    conf_percentile: float = Field(default=25.0, ge=0.0, le=100.0)


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int
    stage: str
    message: str
    original_url: str | None = None
    glb_url: str | None = None
    viewer_ready: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
