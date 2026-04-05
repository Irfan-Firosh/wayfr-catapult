from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import time


@dataclass
class BBox2D:
    x: float  # normalised [0,1]
    y: float
    width: float
    height: float


@dataclass
class ObjectAnnotation:
    label: str
    confidence: float
    urgency: str  # "high" | "medium" | "low"
    bbox_2d: BBox2D | None = None
    distance_m: float | None = None
    direction: str | None = None  # "ahead" | "left" | "right"
    distance_hint: str | None = None  # "close" | "medium" | "far"
    x_3d: float | None = None
    y_3d: float | None = None
    z_3d: float | None = None


@dataclass
class TextAnnotation:
    text: str
    confidence: float
    bbox_2d: BBox2D | None = None


@dataclass
class DepthMap:
    depth_array: Any  # np.ndarray H×W float32 (metres)
    min_depth: float
    max_depth: float
    width: int
    height: int


@dataclass
class Scene3DPoint:
    x: float
    y: float
    z: float
    r: int = 128
    g: int = 128
    b: int = 128
    label: str | None = None
    confidence: float | None = None


@dataclass
class SceneView:
    view_type: str  # "current" | "top_down" | "left" | "right"
    image_bytes: bytes  # JPEG
    camera_matrix: Any  # np.ndarray 3×4 projection matrix
    width: int = 640
    height: int = 480


@dataclass
class VisionResult:
    detected_objects: list[ObjectAnnotation]
    text_annotations: list[TextAnnotation]
    object_labels: list[str]
    scene_views: list[SceneView]
    scene_point_count: int
    depth_map: DepthMap | None
    scene_description: str | None
    community_hazards: list[Any]  # list[ProximityAlert]
    timestamp: float = field(default_factory=time.time)
