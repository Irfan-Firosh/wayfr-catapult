"""
2D-to-3D bridge: reverse-project GLB point cloud into camera frames,
match with 2D detection bounding boxes, and merge by SAM2 track ID.

Mirrors the scenegraph pipeline's backprojection approach but operates on
precomputed outputs (GLB + scene_data NPZ + detections JSON) so no GPU or
video reprocessing is required.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from io import BytesIO
from typing import Any

import numpy as np
import trimesh


def load_glb_points(glb_bytes: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Load point cloud from GLB bytes.

    Returns (points N×3 float32, colors N×3 uint8).
    """
    loaded = trimesh.load(BytesIO(glb_bytes), file_type="glb")
    if isinstance(loaded, trimesh.Scene):
        scene = loaded
    else:
        scene = trimesh.Scene()
        scene.add_geometry(loaded, geom_name="geometry_0")

    for name, geom in scene.geometry.items():
        transform = scene.graph.get(name)
        if transform is not None:
            matrix, _ = transform
            geom = geom.copy()
            geom.apply_transform(matrix)

        if isinstance(geom, trimesh.PointCloud):
            points = np.array(geom.vertices, dtype=np.float32)
            c = np.array(geom.colors, dtype=np.uint8)
            if c.ndim == 2 and c.shape[1] >= 3:
                colors = c[:, :3]
            else:
                colors = np.full((len(points), 3), 200, dtype=np.uint8)
            return points, colors

    raise ValueError("No PointCloud geometry found in GLB")


def _project_points_to_frame(
    points: np.ndarray,
    camera_pose: np.ndarray,
    intrinsics: np.ndarray,
    world_transform: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Project GLB points into a camera frame.

    Returns (proj_u, proj_v, depth) arrays of length N.
    Points behind the camera get depth <= 0.
    """
    n = len(points)
    ones = np.ones((n, 1), dtype=np.float64)
    pts_homo = np.hstack([points.astype(np.float64), ones])  # N×4

    # GLB space -> original world space (world_transform is self-inverse)
    pts_world = (world_transform @ pts_homo.T).T  # N×4

    # World -> camera space
    pose_inv = np.linalg.inv(camera_pose)
    pts_cam = (pose_inv @ pts_world.T).T  # N×4

    x, y, z = pts_cam[:, 0], pts_cam[:, 1], pts_cam[:, 2]

    fx, fy = intrinsics[0, 0], intrinsics[1, 1]
    cx, cy = intrinsics[0, 2], intrinsics[1, 2]

    safe_z = np.where(z > 1e-6, z, 1e-6)
    proj_u = fx * x / safe_z + cx
    proj_v = fy * y / safe_z + cy

    return proj_u, proj_v, z


def compute_scene_objects(
    glb_bytes: bytes,
    npz_bytes: bytes,
    detections_json: dict[str, Any],
) -> list[dict[str, Any]]:
    """Bridge 2D detections to 3D using reverse-projection.

    Args:
        glb_bytes: GLB file from reconstruction pipeline.
        npz_bytes: scene_data.npz from reconstruction (camera_poses,
            intrinsics, source_frame_indices, world_transform, depth_maps).
        detections_json: Parsed JSON from the video annotator pipeline.

    Returns:
        List of scene objects, each with track_id, label, centroid_3d,
        bbox_3d_min/max, confidence, n_observations, and point_indices.
    """
    points, colors = load_glb_points(glb_bytes)
    n_points = len(points)
    print(f"[bridge] Loaded GLB: {n_points:,} points")

    npz = np.load(BytesIO(npz_bytes))
    camera_poses = npz["camera_poses"]        # (V, 4, 4)
    intrinsics = npz["intrinsics"]            # (V, 3, 3)
    source_indices = npz["source_frame_indices"]  # (V,)
    world_transform = npz["world_transform"]  # (4, 4)
    depth_maps = npz["depth_maps"]            # (V, H, W)

    num_views = len(camera_poses)
    depth_H, depth_W = depth_maps.shape[1], depth_maps.shape[2]
    print(f"[bridge] NPZ: {num_views} views, depth {depth_H}×{depth_W}")

    det_W = detections_json["frame_width"]
    det_H = detections_json["frame_height"]
    scale_u = det_W / depth_W
    scale_v = det_H / depth_H
    print(f"[bridge] Detection res {det_W}×{det_H}, scale factors u={scale_u:.3f} v={scale_v:.3f}")

    # Build lookup: annotator frame_idx -> list of detections
    frame_dets: dict[int, list[dict]] = {}
    for frame_record in detections_json.get("frames", []):
        fidx = frame_record["frame_idx"]
        dets = frame_record.get("detections", [])
        if dets:
            frame_dets[fidx] = dets

    # Per-track collection: track_id -> set of GLB point indices
    track_point_indices: dict[int, set[int]] = defaultdict(set)
    track_labels: dict[int, list[str]] = defaultdict(list)
    track_scores: dict[int, list[float]] = defaultdict(list)
    track_frame_count: dict[int, int] = defaultdict(int)

    matched_views = 0

    for view_i in range(num_views):
        ann_frame_idx = int(source_indices[view_i])
        dets = frame_dets.get(ann_frame_idx)
        if not dets:
            continue

        matched_views += 1
        pose = camera_poses[view_i].astype(np.float64)
        K = intrinsics[view_i].astype(np.float64)

        proj_u, proj_v, depth = _project_points_to_frame(
            points, pose, K, world_transform,
        )

        in_front = depth > 1e-3
        # Scale projections from depth-map coords to detection coords
        proj_u_det = proj_u * scale_u
        proj_v_det = proj_v * scale_v

        for det in dets:
            track_id = det.get("track_id")
            if track_id is None:
                continue
            bbox = det["bbox"]  # [x1, y1, x2, y2]
            x1, y1, x2, y2 = bbox

            inside = (
                in_front
                & (proj_u_det >= x1)
                & (proj_u_det <= x2)
                & (proj_v_det >= y1)
                & (proj_v_det <= y2)
            )

            matched_idx = np.where(inside)[0]
            if len(matched_idx) > 0:
                track_point_indices[track_id].update(matched_idx.tolist())
                track_labels[track_id].append(det.get("label", "unknown"))
                track_scores[track_id].append(float(det.get("score", 0.0)))
                track_frame_count[track_id] += 1

    print(f"[bridge] Matched {matched_views}/{num_views} views, "
          f"found {len(track_point_indices)} tracked objects")

    # Build scene objects
    scene_objects: list[dict[str, Any]] = []
    for track_id, idx_set in track_point_indices.items():
        if not idx_set:
            continue
        indices = np.array(sorted(idx_set), dtype=np.int64)
        obj_points = points[indices]

        centroid = obj_points.mean(axis=0)
        bbox_min = obj_points.min(axis=0)
        bbox_max = obj_points.max(axis=0)

        label_counts = Counter(track_labels[track_id])
        label = label_counts.most_common(1)[0][0]
        confidence = float(np.mean(track_scores[track_id]))

        scene_objects.append({
            "track_id": int(track_id),
            "label": label,
            "centroid_3d": centroid.tolist(),
            "bbox_3d_min": bbox_min.tolist(),
            "bbox_3d_max": bbox_max.tolist(),
            "confidence": round(confidence, 3),
            "n_observations": track_frame_count[track_id],
            "n_points": len(indices),
            "point_indices": indices.tolist(),
        })

    scene_objects.sort(key=lambda o: o["n_points"], reverse=True)
    print(f"[bridge] Output: {len(scene_objects)} scene objects")
    for obj in scene_objects:
        print(f"  track {obj['track_id']:>3d}: {obj['label']:<20s} "
              f"{obj['n_points']:>6,d} pts, {obj['n_observations']} frames, "
              f"conf={obj['confidence']:.2f}")

    return scene_objects
