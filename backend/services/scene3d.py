"""
Scene3D — sliding-window 3D scene reconstruction.

Accumulates point clouds from RGB-D frames, maintains a 10-frame voxel grid,
renders synthetic 2D views for the vision pipeline, and back-projects 2D
annotations into 3D world coordinates.
"""

from __future__ import annotations

import asyncio
import io
import math
import time
from collections import deque
from typing import Any

import numpy as np
from PIL import Image

from core.config import settings
from core.logging import get_logger
from models.vision import ObjectAnnotation, SceneView, DepthMap
from models.session import CameraPose

logger = get_logger(__name__)

# Camera intrinsics (640×480, ~70° FOV)
FX = FY = 460.0
CX = 320.0
CY = 240.0

RENDER_W = 640
RENDER_H = 480
TOPDOWN_SIZE = 512


class Scene3D:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # Each frame's points: list of np.ndarray shape (N,6) [x,y,z,r,g,b]
        self._frames: deque[np.ndarray] = deque(maxlen=settings.scene3d_window_frames)
        # Merged voxel grid — rebuilt on each update
        self._voxel_cloud: np.ndarray | None = None  # shape (N,6)
        # Scene graph: label → {x,y,z,confidence,last_seen}
        self._labels: dict[str, dict[str, Any]] = {}
        # Last rendered view's camera matrix (for back-projection)
        self._last_camera_matrix: np.ndarray | None = None

    @property
    def point_count(self) -> int:
        return len(self._voxel_cloud) if self._voxel_cloud is not None else 0

    async def update_from_frame(self, rgb: np.ndarray, depth: DepthMap, pose: CameraPose) -> None:
        async with self._lock:
            pts = await asyncio.to_thread(self._backproject, rgb, depth, pose)
            self._frames.append(pts)
            self._voxel_cloud = await asyncio.to_thread(
                self._merge_and_downsample,
                list(self._frames),
            )

    def _backproject(self, rgb: np.ndarray, depth: DepthMap, pose: CameraPose) -> np.ndarray:
        """Back-project every pixel into 3D world space."""
        H, W = depth.depth_array.shape
        # Sample every 4th pixel for performance
        us, vs = np.meshgrid(np.arange(0, W, 4), np.arange(0, H, 4))
        us = us.ravel()
        vs = vs.ravel()

        d = depth.depth_array[vs, us]
        valid = (d > 0.1) & (d < 20.0)
        us, vs, d = us[valid], vs[valid], d[valid]

        # Camera-space coordinates
        xc = (us - CX) * d / FX
        yc = (vs - CY) * d / FY
        zc = d

        # Apply camera pose (simple yaw rotation for now)
        cos_y = math.cos(pose.yaw)
        sin_y = math.sin(pose.yaw)
        xw = xc * cos_y - zc * sin_y + pose.x
        yw = yc + pose.y
        zw = xc * sin_y + zc * cos_y + pose.z

        # Sample RGB
        if rgb.shape[:2] == (H, W):
            colours = rgb[vs, us]  # (N, 3)
        else:
            resized = np.array(Image.fromarray(rgb).resize((W, H)), dtype=np.uint8)
            colours = resized[vs, us]

        pts = np.column_stack([xw, yw, zw, colours.astype(np.float32)])
        return pts  # (N, 6)

    def _merge_and_downsample(self, frames: list[np.ndarray]) -> np.ndarray:
        """Concatenate all frame points and voxel-grid downsample."""
        if not frames:
            return np.empty((0, 6), dtype=np.float32)

        all_pts = np.concatenate(frames, axis=0)
        voxel_size = settings.scene3d_voxel_m

        # Quantise to voxel indices
        indices = np.floor(all_pts[:, :3] / voxel_size).astype(np.int32)
        # Build unique voxel keys and take mean colour per voxel
        keys = indices[:, 0] * 1_000_003 + indices[:, 1] * 1_009 + indices[:, 2]
        _, first_idx = np.unique(keys, return_index=True)
        return all_pts[first_idx]

    async def render_view(self, view_type: str) -> SceneView:
        async with self._lock:
            cloud = self._voxel_cloud
        return await asyncio.to_thread(self._render, cloud, view_type)

    def _render(self, cloud: np.ndarray | None, view_type: str) -> SceneView:
        """Project 3D point cloud to a 2D synthetic image."""
        if view_type == "top_down":
            return self._render_topdown(cloud)
        return self._render_perspective(cloud, view_type)

    def _render_topdown(self, cloud: np.ndarray | None) -> SceneView:
        img = np.zeros((TOPDOWN_SIZE, TOPDOWN_SIZE, 3), dtype=np.uint8)
        cam_matrix = np.eye(4, dtype=np.float32)

        if cloud is not None and len(cloud) > 0:
            # Top-down orthographic: 5m×5m centred at origin
            scale = TOPDOWN_SIZE / 10.0  # 1m = 51.2px
            cx = cy = TOPDOWN_SIZE // 2

            xs = (cloud[:, 0] * scale + cx).astype(int)
            zs = (-cloud[:, 2] * scale + cy).astype(int)
            valid = (xs >= 0) & (xs < TOPDOWN_SIZE) & (zs >= 0) & (zs < TOPDOWN_SIZE)
            xs, zs = xs[valid], zs[valid]
            rgb = cloud[valid, 3:6].astype(np.uint8)
            img[zs, xs] = rgb

        pil = Image.fromarray(img)
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=85)
        return SceneView(
            view_type="top_down",
            image_bytes=buf.getvalue(),
            camera_matrix=cam_matrix,
            width=TOPDOWN_SIZE,
            height=TOPDOWN_SIZE,
        )

    def _render_perspective(self, cloud: np.ndarray | None, view_type: str) -> SceneView:
        """Perspective projection with optional yaw offset for left/right views."""
        yaw_offsets = {"current": 0.0, "left": math.radians(30), "right": math.radians(-30)}
        yaw = yaw_offsets.get(view_type, 0.0)
        cos_y = math.cos(yaw)
        sin_y = math.sin(yaw)

        img = np.zeros((RENDER_H, RENDER_W, 3), dtype=np.uint8)

        cam_matrix = np.array([[FX, 0, CX, 0], [0, FY, CY, 0], [0, 0, 1, 0]], dtype=np.float32)
        self._last_camera_matrix = cam_matrix

        if cloud is not None and len(cloud) > 0:
            # Rotate world points by yaw offset
            xw = cloud[:, 0] * cos_y + cloud[:, 2] * sin_y
            yw = cloud[:, 1]
            zw = -cloud[:, 0] * sin_y + cloud[:, 2] * cos_y

            valid_z = zw > 0.1
            xw, yw, zw = xw[valid_z], yw[valid_z], zw[valid_z]
            rgb = cloud[valid_z, 3:6].astype(np.uint8)

            # Perspective divide
            us = (xw * FX / zw + CX).astype(int)
            vs = (yw * FY / zw + CY).astype(int)

            valid_px = (us >= 0) & (us < RENDER_W) & (vs >= 0) & (vs < RENDER_H)
            img[vs[valid_px], us[valid_px]] = rgb[valid_px]

        pil = Image.fromarray(img)
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=85)
        return SceneView(
            view_type=view_type,
            image_bytes=buf.getvalue(),
            camera_matrix=cam_matrix,
            width=RENDER_W,
            height=RENDER_H,
        )

    async def apply_annotations(self, annotations: list[ObjectAnnotation]) -> None:
        async with self._lock:
            await asyncio.to_thread(self._back_project_annotations, annotations)
        # Prune stale entries
        now = time.time()
        stale = [k for k, v in self._labels.items() if now - v["last_seen"] > 5.0]
        for k in stale:
            del self._labels[k]

    def _back_project_annotations(self, annotations: list[ObjectAnnotation]) -> None:
        if self._voxel_cloud is None or len(self._voxel_cloud) == 0:
            return

        for ann in annotations:
            if ann.bbox_2d is None:
                continue
            # Ray from bbox centre
            cx = int((ann.bbox_2d.x + ann.bbox_2d.width / 2) * RENDER_W)
            cy = int((ann.bbox_2d.y + ann.bbox_2d.height / 2) * RENDER_H)

            # Find closest point cloud point along this ray
            ray_x = (cx - CX) / FX
            ray_y = (cy - CY) / FY

            pts = self._voxel_cloud
            # Angle between ray and each point's viewing direction
            pts_x = pts[:, 0] / (pts[:, 2] + 1e-6)
            pts_y = pts[:, 1] / (pts[:, 2] + 1e-6)
            dist = np.sqrt((pts_x - ray_x) ** 2 + (pts_y - ray_y) ** 2)
            idx = int(np.argmin(dist))

            x_3d, y_3d, z_3d = float(pts[idx, 0]), float(pts[idx, 1]), float(pts[idx, 2])
            ann.x_3d = x_3d
            ann.y_3d = y_3d
            ann.z_3d = z_3d
            ann.distance_m = round(float(np.sqrt(x_3d**2 + z_3d**2)), 2)
            ann.direction = "left" if x_3d < -0.5 else "right" if x_3d > 0.5 else "ahead"

            key = f"{ann.label}_{round(z_3d, 1)}"
            self._labels[key] = {
                "label": ann.label,
                "x": x_3d,
                "y": y_3d,
                "z": z_3d,
                "confidence": ann.confidence,
                "last_seen": time.time(),
            }


# Module-level singleton (one per WebSocket session — created by session_manager)
def make_scene3d() -> Scene3D:
    return Scene3D()
