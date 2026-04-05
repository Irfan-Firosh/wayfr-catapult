from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class PipelineJob(BaseModel):
    job_id: str
    status: str
    updated_at: str
    metadata: dict[str, Any] = {}
    source: str = ""


class DiscoverResponse(BaseModel):
    recon_jobs: list[PipelineJob]
    annotator_jobs: list[PipelineJob]


class BridgeRequest(BaseModel):
    recon_job_id: str
    annotator_job_id: str


class SceneObject(BaseModel):
    track_id: int
    label: str
    centroid_3d: list[float]
    bbox_3d_min: list[float]
    bbox_3d_max: list[float]
    confidence: float
    n_observations: int
    n_points: int


class BridgeStatus(BaseModel):
    bridge_id: str
    status: Literal["pending", "processing", "completed", "failed"]
    progress: int = 0
    message: str = ""
    recon_job_id: str = ""
    annotator_job_id: str = ""
    objects: list[SceneObject] = []
    error: str | None = None
