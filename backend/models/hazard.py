from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import time


@dataclass
class Hazard:
    id: str
    label: str
    description: str
    severity: str  # "low" | "medium" | "high" | "critical"
    lat: float
    lng: float
    reporter_nullifier: str
    verified: bool = False
    verifier_count: int = 1
    created_at: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class HazardSubmission:
    label: str
    description: str
    severity: str
    lat: float
    lng: float
    world_id_proof: str  # serialised World ID proof JSON
    nullifier_hash: str


@dataclass
class ProximityAlert:
    hazard_id: str
    label: str
    description: str
    severity: str
    distance_m: float
    direction: str  # "ahead" | "left" | "right" | "behind"
    verified: bool
    verified_count: int
