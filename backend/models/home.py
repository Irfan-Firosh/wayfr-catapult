from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import time


class HomeMapStatus(str, Enum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


@dataclass
class HomeMap:
    id: str
    name: str
    status: HomeMapStatus
    num_objects: int = 0
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


@dataclass
class ObjectEvidenceFrame:
    image_path: str
    sampled_frame_idx: int | None = None
    source_frame_idx: int | None = None
    timestamp_sec: float | None = None
    bbox: list[float] | None = None
    mask_quality: float | None = None


@dataclass
class ObjectPosition:
    id: str
    home_id: str
    label: str
    x: float
    y: float
    z: float
    track_id: int | None = None
    bbox_min: list[float] | None = None  # [x, y, z]
    bbox_max: list[float] | None = None  # [x, y, z]
    confidence: float | None = None
    n_observations: int = 1
    evidence_frame: ObjectEvidenceFrame | None = None


@dataclass
class Waypoint:
    x: float
    z: float
    distance_m: float


@dataclass
class NavigationPlan:
    home_id: str
    target_label: str
    target: ObjectPosition | None
    waypoints: list[Waypoint]
    instructions: list[str]
    total_distance_m: float
