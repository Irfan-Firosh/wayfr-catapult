from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any
import time


class SessionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ENDED = "ended"
    ERROR = "error"


@dataclass
class GPSCoord:
    lat: float
    lng: float
    accuracy: float = 0.0


@dataclass
class CameraPose:
    """World-space camera extrinsics (identity = glasses facing forward)."""

    yaw: float = 0.0  # rotation around Y axis (left/right heading)
    pitch: float = 0.0  # rotation around X axis (up/down tilt)
    roll: float = 0.0
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


@dataclass
class SessionContext:
    session_id: str
    status: SessionStatus = SessionStatus.ACTIVE
    gps: GPSCoord | None = None
    camera_pose: CameraPose = field(default_factory=CameraPose)
    last_scene_description: float = 0.0
    pending_voice_command: str | None = None
    recent_narrations: list[str] = field(default_factory=list)
    frame_count: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


@dataclass
class Session:
    id: str
    status: SessionStatus
    created_at: float
    updated_at: float
    frame_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class SessionUpdate:
    status: SessionStatus | None = None
    gps: GPSCoord | None = None
    frame_count: int | None = None
