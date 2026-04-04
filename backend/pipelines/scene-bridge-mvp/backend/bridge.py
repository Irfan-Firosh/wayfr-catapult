"""
2D-to-3D bridge: lift segmentation masks into 3D using reconstruction depth,
anchor each detection via centroid ray-casting (reference pattern from
locate_viewer.py), then snap filtered samples onto the GLB point cloud.

Hybrid approach:
  1. Ray-cast through mask centroid to find the object's 3D anchor on the GLB.
  2. Project mask pixels to 3D using depth maps.
  3. Keep only projected points within a plausible radius of the anchor.
  4. Snap surviving points to GLB via KD-tree.
  5. Filter per-track with connected component + MAD outlier removal.
"""

from __future__ import annotations

import os
from collections import Counter, defaultdict
from io import BytesIO
from typing import Any

import numpy as np
import trimesh
from scipy.spatial import cKDTree


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw.strip())
    except ValueError:
        return default


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


def summarize_scene_objects(scene_objects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip heavy in-memory fields before writing scene objects to disk."""
    return [
        {k: v for k, v in obj.items() if k != "point_indices"}
        for obj in scene_objects
    ]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

_BRIDGE_LABEL_SYNONYMS: dict[str, str] = {
    "screen": "monitor",
    "display": "monitor",
    "computer_monitor": "monitor",
    "sofa": "couch",
    "garbage_can": "trash_can",
    "trash_bin": "trash_can",
    "waste_bin": "trash_can",
    "mobile_phone": "phone",
    "cell_phone": "phone",
    "smartphone": "phone",
    "mug": "cup",
    "coffee_mug": "cup",
}


def _canonical_bridge_label(label: str) -> str:
    cleaned = label.strip().strip(".").strip().lower().replace("-", " ").replace("/", " ")
    cleaned = "_".join(part for part in cleaned.split() if part)
    return _BRIDGE_LABEL_SYNONYMS.get(cleaned, cleaned)


def _project_points_to_frame(
    points: np.ndarray,
    camera_pose: np.ndarray,
    intrinsics: np.ndarray,
    world_transform: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Project GLB-space points into a camera frame."""
    n = len(points)
    ones = np.ones((n, 1), dtype=np.float64)
    pts_homo = np.hstack([points.astype(np.float64), ones])

    world_from_glb = np.linalg.inv(world_transform.astype(np.float64))
    pts_world = (world_from_glb @ pts_homo.T).T

    pose_inv = np.linalg.inv(camera_pose.astype(np.float64))
    pts_cam = (pose_inv @ pts_world.T).T

    x, y, z = pts_cam[:, 0], pts_cam[:, 1], pts_cam[:, 2]
    fx, fy = intrinsics[0, 0], intrinsics[1, 1]
    cx, cy = intrinsics[0, 2], intrinsics[1, 2]

    safe_z = np.where(z > 1e-6, z, 1e-6)
    proj_u = fx * x / safe_z + cx
    proj_v = fy * y / safe_z + cy
    return proj_u, proj_v, z

def _rle_to_mask(mask_rle: dict[str, Any]) -> np.ndarray:
    """Decode the lightweight column-major RLE emitted by the annotator."""
    size = mask_rle.get("size")
    counts = mask_rle.get("counts")
    if not isinstance(size, list) or len(size) != 2 or not isinstance(counts, list):
        raise ValueError("Invalid mask_rle payload")

    h, w = int(size[0]), int(size[1])
    total = h * w
    flat = np.zeros(total, dtype=np.uint8)

    cursor = 0
    value = 0
    for run_len in counts:
        run_len = int(run_len)
        if run_len < 0:
            raise ValueError("RLE counts must be non-negative")
        end = min(total, cursor + run_len)
        if end > cursor:
            flat[cursor:end] = value
        cursor = end
        value = 1 - value

    if cursor < total:
        flat[cursor:] = value

    return flat.reshape((h, w), order="F").astype(bool)


def _resize_mask_nearest(mask: np.ndarray, target_h: int, target_w: int) -> np.ndarray:
    if mask.shape == (target_h, target_w):
        return mask.astype(bool)

    src_h, src_w = mask.shape
    y_idx = np.minimum(
        (np.arange(target_h, dtype=np.float64) * src_h / target_h).astype(np.int64),
        src_h - 1,
    )
    x_idx = np.minimum(
        (np.arange(target_w, dtype=np.float64) * src_w / target_w).astype(np.int64),
        src_w - 1,
    )
    return mask[np.ix_(y_idx, x_idx)].astype(bool)


def _mask_centroid(mask: np.ndarray) -> tuple[float, float]:
    """Return (u, v) centroid of True pixels in a boolean mask."""
    coords = np.argwhere(mask)
    if len(coords) == 0:
        return (mask.shape[1] / 2.0, mask.shape[0] / 2.0)
    v_mean = coords[:, 0].mean()
    u_mean = coords[:, 1].mean()
    return (float(u_mean), float(v_mean))


def _raycast_centroid_to_glb(
    u_center: float,
    v_center: float,
    camera_pose: np.ndarray,
    intrinsics: np.ndarray,
    world_transform: np.ndarray,
    glb_pts: np.ndarray,
    glb_tree: cKDTree,
) -> np.ndarray | None:
    """Ray-cast from camera through pixel centroid, find nearest GLB point.

    Based on the reference pattern from locate_viewer.py.
    Returns the 3D GLB-space position, or None if ray misses the scene.
    """
    fx, fy = float(intrinsics[0, 0]), float(intrinsics[1, 1])
    cx, cy = float(intrinsics[0, 2]), float(intrinsics[1, 2])

    dir_cam = np.array([(u_center - cx) / fx, (v_center - cy) / fy, 1.0])
    dir_cam /= np.linalg.norm(dir_cam)

    R_c2w = camera_pose[:3, :3].astype(np.float64)
    t_c2w = camera_pose[:3, 3].astype(np.float64)
    cam_pos_world = t_c2w
    dir_world = R_c2w @ dir_cam

    # Transform camera position to GLB space
    wt = world_transform.astype(np.float64)
    cam_pos_glb = (wt @ np.append(cam_pos_world, 1.0))[:3]
    R_wt = wt[:3, :3]
    dir_glb = R_wt @ dir_world
    dir_glb /= np.linalg.norm(dir_glb) + 1e-12

    scene_extent = np.linalg.norm(glb_pts.max(axis=0) - glb_pts.min(axis=0))
    t_vals = np.linspace(0.05, scene_extent * 1.5, 300)
    ray_pts = cam_pos_glb + np.outer(t_vals, dir_glb)

    dists, indices = glb_tree.query(ray_pts)
    best_idx = np.argmin(dists)

    if dists[best_idx] > scene_extent * 0.05:
        return None

    return glb_pts[indices[best_idx]].copy()


def _sample_mask_world_points(
    mask: np.ndarray,
    depth_map: np.ndarray,
    camera_pose: np.ndarray,
    intrinsics: np.ndarray,
    max_samples: int,
) -> np.ndarray:
    """Back-project mask pixels to 3D using depth + camera pose."""
    coords = np.argwhere(mask)
    if len(coords) == 0:
        return np.zeros((0, 3), dtype=np.float64)

    depths = depth_map[coords[:, 0], coords[:, 1]].astype(np.float64)
    valid = np.isfinite(depths) & (depths > 1e-6)
    coords = coords[valid]
    depths = depths[valid]
    if len(coords) == 0:
        return np.zeros((0, 3), dtype=np.float64)

    # Depth consistency: reject outliers within this mask observation
    med_depth = np.median(depths)
    depth_spread = np.clip(np.median(np.abs(depths - med_depth)), 0.01, None)
    depth_ok = np.abs(depths - med_depth) < 3.0 * 1.4826 * depth_spread
    coords = coords[depth_ok]
    depths = depths[depth_ok]
    if len(coords) == 0:
        return np.zeros((0, 3), dtype=np.float64)

    if len(coords) > max_samples:
        step = max(1, int(np.ceil(len(coords) / max_samples)))
        coords = coords[::step]
        depths = depths[::step]

    v = coords[:, 0].astype(np.float64)
    u = coords[:, 1].astype(np.float64)
    fx, fy = intrinsics[0, 0], intrinsics[1, 1]
    cx, cy = intrinsics[0, 2], intrinsics[1, 2]

    x_cam = ((u + 0.5) - cx) / fx * depths
    y_cam = ((v + 0.5) - cy) / fy * depths
    pts_cam = np.column_stack([x_cam, y_cam, depths, np.ones_like(depths)])
    pts_world = (camera_pose.astype(np.float64) @ pts_cam.T).T
    return pts_world[:, :3]


def _snap_world_points_to_glb(
    world_points: np.ndarray,
    glb_from_world: np.ndarray,
    glb_tree: cKDTree,
    max_distance: float,
    anchor_glb: np.ndarray | None = None,
    anchor_radius: float | None = None,
) -> np.ndarray:
    """Project world points into GLB space and snap to nearest GLB vertices.

    If anchor_glb and anchor_radius are provided, only keep snapped points
    within anchor_radius of the anchor position. This prevents noisy depth
    from scattering the object across the entire scene.
    """
    if len(world_points) == 0:
        return np.zeros((0,), dtype=np.int64)

    pts_h = np.column_stack([world_points.astype(np.float64), np.ones(len(world_points), dtype=np.float64)])
    pts_glb_h = (glb_from_world.astype(np.float64) @ pts_h.T).T
    pts_glb = pts_glb_h[:, :3] / np.clip(pts_glb_h[:, 3:4], 1e-8, None)

    distances, indices = glb_tree.query(pts_glb, distance_upper_bound=max_distance)
    valid = np.isfinite(distances) & (distances <= max_distance) & (indices < glb_tree.n)
    if not np.any(valid):
        return np.zeros((0,), dtype=np.int64)

    good_indices = indices[valid].astype(np.int64)

    if anchor_glb is not None and anchor_radius is not None:
        snapped_pts = glb_tree.data[good_indices]
        within_radius = np.linalg.norm(snapped_pts - anchor_glb, axis=1) < anchor_radius
        good_indices = good_indices[within_radius]

    if len(good_indices) == 0:
        return np.zeros((0,), dtype=np.int64)

    return np.unique(good_indices)


def _largest_voxel_component_mask(points: np.ndarray, voxel_size: float) -> np.ndarray:
    if len(points) == 0:
        return np.zeros((0,), dtype=bool)
    if len(points) <= 8:
        return np.ones((len(points),), dtype=bool)

    voxel_coords = np.floor(points / voxel_size).astype(np.int64)
    voxel_to_point_ids: dict[tuple[int, int, int], list[int]] = defaultdict(list)
    for point_idx, coord in enumerate(voxel_coords):
        voxel_to_point_ids[(int(coord[0]), int(coord[1]), int(coord[2]))].append(point_idx)

    offsets = [
        (dx, dy, dz)
        for dx in (-1, 0, 1)
        for dy in (-1, 0, 1)
        for dz in (-1, 0, 1)
        if not (dx == 0 and dy == 0 and dz == 0)
    ]

    unvisited = set(voxel_to_point_ids)
    best_component: list[tuple[int, int, int]] = []
    best_points = 0

    while unvisited:
        root = unvisited.pop()
        queue = [root]
        component = [root]
        point_count = len(voxel_to_point_ids[root])

        while queue:
            current = queue.pop()
            for dx, dy, dz in offsets:
                neighbor = (current[0] + dx, current[1] + dy, current[2] + dz)
                if neighbor not in unvisited:
                    continue
                unvisited.remove(neighbor)
                queue.append(neighbor)
                component.append(neighbor)
                point_count += len(voxel_to_point_ids[neighbor])

        if point_count > best_points:
            best_points = point_count
            best_component = component

    keep_mask = np.zeros((len(points),), dtype=bool)
    for voxel in best_component:
        keep_mask[voxel_to_point_ids[voxel]] = True
    return keep_mask


def _mad_inlier_mask(points: np.ndarray) -> np.ndarray:
    if len(points) <= 8:
        return np.ones((len(points),), dtype=bool)

    centroid = np.median(points, axis=0)
    dists = np.linalg.norm(points - centroid, axis=1)
    med = np.median(dists)
    mad = np.median(np.abs(dists - med))
    if mad <= 1e-8:
        return np.ones((len(points),), dtype=bool)

    cutoff = med + 3.0 * 1.4826 * mad
    return dists <= cutoff


def _bbox_iou_3d(a_min: np.ndarray, a_max: np.ndarray, b_min: np.ndarray, b_max: np.ndarray) -> float:
    inter_min = np.maximum(a_min, b_min)
    inter_max = np.minimum(a_max, b_max)
    inter_extent = np.maximum(inter_max - inter_min, 0.0)
    inter_vol = float(np.prod(inter_extent))
    if inter_vol <= 0:
        return 0.0
    a_vol = float(np.prod(np.maximum(a_max - a_min, 0.0)))
    b_vol = float(np.prod(np.maximum(b_max - b_min, 0.0)))
    union = a_vol + b_vol - inter_vol
    return float(inter_vol / max(union, 1e-8))


def _extent_ratio_ok(ext_a: np.ndarray, ext_b: np.ndarray, max_ratio: float = 2.5) -> bool:
    safe_a = np.maximum(ext_a, 1e-4)
    safe_b = np.maximum(ext_b, 1e-4)
    ratios = np.maximum(safe_a / safe_b, safe_b / safe_a)
    return bool(np.all(ratios <= max_ratio))


def _point_overlap_ratio(indices_a: list[int], indices_b: list[int]) -> float:
    set_a = set(indices_a)
    set_b = set(indices_b)
    if not set_a or not set_b:
        return 0.0
    inter = len(set_a & set_b)
    union = len(set_a | set_b)
    return float(inter / max(union, 1))


def _merge_scene_object_pair(
    obj_a: dict[str, Any],
    obj_b: dict[str, Any],
    points: np.ndarray,
) -> dict[str, Any]:
    indices = np.array(sorted(set(obj_a["point_indices"]) | set(obj_b["point_indices"])), dtype=np.int64)
    obj_points = points[indices]
    label_a = _canonical_bridge_label(str(obj_a["label"]))
    label_b = _canonical_bridge_label(str(obj_b["label"]))

    if label_a == "unknown_object" and label_b != "unknown_object":
        merged_label = label_b
    elif label_b == "unknown_object" and label_a != "unknown_object":
        merged_label = label_a
    else:
        merged_label = label_a if obj_a["confidence"] >= obj_b["confidence"] else label_b

    confidence = max(float(obj_a["confidence"]), float(obj_b["confidence"]))
    return {
        "track_id": min(int(obj_a["track_id"]), int(obj_b["track_id"])),
        "label": merged_label,
        "centroid_3d": obj_points.mean(axis=0).tolist(),
        "bbox_3d_min": obj_points.min(axis=0).tolist(),
        "bbox_3d_max": obj_points.max(axis=0).tolist(),
        "confidence": round(confidence, 3),
        "n_observations": int(obj_a["n_observations"]) + int(obj_b["n_observations"]),
        "n_points": int(len(indices)),
        "point_indices": indices.tolist(),
    }


def _balanced_merge_scene_objects(
    scene_objects: list[dict[str, Any]],
    points: np.ndarray,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    merge_distance = _float_env("BRIDGE_MERGE_DISTANCE", 0.10)
    exact_distance = _float_env("BRIDGE_EXACT_MERGE_DISTANCE", 0.03)
    kept_separate_semantic = 0
    kept_separate_extent = 0
    merged_exact = 0
    merged_near = 0

    pending = sorted(scene_objects, key=lambda obj: (obj["label"], -obj["confidence"], -obj["n_points"]))
    changed = True
    while changed:
        changed = False
        merged_flags = [False] * len(pending)
        next_objects: list[dict[str, Any]] = []
        for i, obj_a in enumerate(pending):
            if merged_flags[i]:
                continue
            current = obj_a
            a_centroid = np.array(current["centroid_3d"], dtype=np.float64)
            a_min = np.array(current["bbox_3d_min"], dtype=np.float64)
            a_max = np.array(current["bbox_3d_max"], dtype=np.float64)
            a_extent = a_max - a_min
            a_label = _canonical_bridge_label(str(current["label"]))

            for j in range(i + 1, len(pending)):
                if merged_flags[j]:
                    continue
                obj_b = pending[j]
                b_centroid = np.array(obj_b["centroid_3d"], dtype=np.float64)
                b_min = np.array(obj_b["bbox_3d_min"], dtype=np.float64)
                b_max = np.array(obj_b["bbox_3d_max"], dtype=np.float64)
                b_extent = b_max - b_min
                b_label = _canonical_bridge_label(str(obj_b["label"]))

                centroid_dist = float(np.linalg.norm(a_centroid - b_centroid))
                if centroid_dist > merge_distance:
                    continue

                labels_compatible = (
                    a_label == b_label
                    or "unknown_object" in {a_label, b_label}
                )
                if not labels_compatible:
                    kept_separate_semantic += 1
                    continue

                if not _extent_ratio_ok(a_extent, b_extent):
                    kept_separate_extent += 1
                    continue

                point_overlap = _point_overlap_ratio(current["point_indices"], obj_b["point_indices"])
                bbox_iou = _bbox_iou_3d(a_min, a_max, b_min, b_max)
                exact_match = centroid_dist <= exact_distance
                near_match = (
                    centroid_dist <= merge_distance
                    and (point_overlap >= 0.35 or bbox_iou >= 0.18)
                )
                if not (exact_match or near_match):
                    continue

                current = _merge_scene_object_pair(current, obj_b, points)
                merged_flags[j] = True
                changed = True
                if exact_match:
                    merged_exact += 1
                else:
                    merged_near += 1

                a_centroid = np.array(current["centroid_3d"], dtype=np.float64)
                a_min = np.array(current["bbox_3d_min"], dtype=np.float64)
                a_max = np.array(current["bbox_3d_max"], dtype=np.float64)
                a_extent = a_max - a_min
                a_label = _canonical_bridge_label(str(current["label"]))

            next_objects.append(current)
        pending = next_objects

    stats = {
        "merged_exact": merged_exact,
        "merged_near": merged_near,
        "kept_separate_semantic": kept_separate_semantic,
        "kept_separate_extent": kept_separate_extent,
    }
    return pending, stats


# ---------------------------------------------------------------------------
# Main pipeline entry point
# ---------------------------------------------------------------------------

def compute_scene_objects(
    glb_bytes: bytes,
    npz_bytes: bytes,
    detections_json: dict[str, Any],
) -> list[dict[str, Any]]:
    """Bridge 2D detections to 3D using ray-cast anchoring + mask lifting."""
    points, _ = load_glb_points(glb_bytes)
    n_points = len(points)
    print(f"[bridge] Loaded GLB: {n_points:,} points")

    npz = np.load(BytesIO(npz_bytes))
    camera_poses = npz["camera_poses"]
    intrinsics = npz["intrinsics"]
    source_indices = npz["source_frame_indices"]
    world_transform = npz["world_transform"].astype(np.float64)
    depth_maps = npz["depth_maps"]

    num_views = len(camera_poses)
    depth_h, depth_w = depth_maps.shape[1], depth_maps.shape[2]
    print(f"[bridge] NPZ: {num_views} views, depth {depth_h}x{depth_w}")

    det_tracks = {
        int(track["track_id"]): track
        for track in detections_json.get("tracks", [])
        if track.get("track_id") is not None
    }
    eligible_track_ids = {
        tid
        for tid, track in det_tracks.items()
        if track.get("bridge_eligible", True)
    }
    if not eligible_track_ids and det_tracks:
        print("[bridge] No bridge-eligible tracks were marked in detections JSON")

    frame_dets: dict[int, list[dict[str, Any]]] = {}
    for frame_record in detections_json.get("frames", []):
        fidx = int(frame_record["frame_idx"])
        dets = []
        for det in frame_record.get("detections", []):
            track_id = det.get("track_id")
            if track_id is None:
                continue
            track_id = int(track_id)
            if det_tracks and track_id not in eligible_track_ids:
                continue
            if det.get("mask_rle") is None:
                continue
            dets.append(det)
        if dets:
            frame_dets[fidx] = dets

    bbox_min_scene = points.min(axis=0)
    bbox_max_scene = points.max(axis=0)
    scene_diag = float(np.linalg.norm(bbox_max_scene - bbox_min_scene))

    max_mask_samples = _int_env("BRIDGE_MAX_MASK_SAMPLES", 500)
    min_points_per_obs = _int_env("BRIDGE_MIN_POINTS_PER_OBSERVATION", 5)
    min_points_per_object = _int_env("BRIDGE_MIN_POINTS_PER_OBJECT", 30)
    min_observations = _int_env("BRIDGE_MIN_OBSERVATIONS", 2)
    max_scene_fraction = _float_env("BRIDGE_MAX_SCENE_FRACTION", 0.06)
    hard_reject_fraction = _float_env("BRIDGE_HARD_REJECT_SCENE_FRACTION", 0.20)
    max_snap_distance = _float_env("BRIDGE_MAX_SNAP_DISTANCE", max(0.02, scene_diag * 0.002))
    cluster_voxel_size = _float_env("BRIDGE_CLUSTER_VOXEL_SIZE", max(0.02, scene_diag * 0.006))
    # Anchor radius: mask-lifted points must be within this distance of the
    # ray-cast anchor.  Scales with scene but capped at 1.5m.
    anchor_radius_frac = _float_env("BRIDGE_ANCHOR_RADIUS_FRAC", 0.12)
    anchor_radius = min(scene_diag * anchor_radius_frac, 1.5)

    glb_tree = cKDTree(points.astype(np.float64))

    track_point_indices: dict[int, set[int]] = defaultdict(set)
    track_anchors: dict[int, list[np.ndarray]] = defaultdict(list)
    track_labels: dict[int, list[str]] = defaultdict(list)
    track_scores: dict[int, list[float]] = defaultdict(list)
    track_observation_count: dict[int, int] = defaultdict(int)
    skipped_counts: Counter[str] = Counter()
    matched_views = 0

    for view_i in range(num_views):
        ann_frame_idx = int(source_indices[view_i])
        dets = frame_dets.get(ann_frame_idx)
        if not dets:
            continue

        matched_views += 1
        pose = camera_poses[view_i].astype(np.float64)
        K = intrinsics[view_i].astype(np.float64)
        depth_map = depth_maps[view_i].astype(np.float64)

        for det in dets:
            track_id = int(det["track_id"])
            try:
                mask = _rle_to_mask(det["mask_rle"])
            except Exception:
                skipped_counts["bad_mask_rle"] += 1
                continue

            mask_depth = _resize_mask_nearest(mask, depth_h, depth_w)
            if not np.any(mask_depth):
                skipped_counts["empty_resized_mask"] += 1
                continue

            # Step 1: Ray-cast centroid to find 3D anchor on GLB
            u_c, v_c = _mask_centroid(mask_depth)
            anchor_pos = _raycast_centroid_to_glb(
                u_c, v_c, pose, K, world_transform, points, glb_tree,
            )

            use_anchor_filter = anchor_pos is not None
            if anchor_pos is None:
                skipped_counts["ray_miss"] += 1

            # Step 2: Mask-lift to 3D via depth
            world_points = _sample_mask_world_points(
                mask_depth, depth_map, pose, K, max_samples=max_mask_samples,
            )
            if len(world_points) == 0:
                skipped_counts["no_depth_samples"] += 1
                continue

            # Step 3: Snap to GLB, filtering by anchor radius
            snapped_indices = _snap_world_points_to_glb(
                world_points, world_transform, glb_tree,
                max_distance=max_snap_distance,
                anchor_glb=anchor_pos if use_anchor_filter else None,
                anchor_radius=anchor_radius if use_anchor_filter else None,
            )
            if len(snapped_indices) < min_points_per_obs and use_anchor_filter:
                fallback_indices = _snap_world_points_to_glb(
                    world_points,
                    world_transform,
                    glb_tree,
                    max_distance=max_snap_distance,
                    anchor_glb=None,
                    anchor_radius=None,
                )
                if len(fallback_indices) > len(snapped_indices):
                    snapped_indices = fallback_indices
                    skipped_counts["recovered_without_anchor_filter"] += 1
            if len(snapped_indices) < min_points_per_obs and not use_anchor_filter:
                relaxed_snap_distance = max(max_snap_distance * 2.5, 0.05)
                fallback_indices = _snap_world_points_to_glb(
                    world_points,
                    world_transform,
                    glb_tree,
                    max_distance=relaxed_snap_distance,
                    anchor_glb=None,
                    anchor_radius=None,
                )
                if len(fallback_indices) > len(snapped_indices):
                    snapped_indices = fallback_indices
                    skipped_counts["recovered_with_relaxed_snap"] += 1
            if len(snapped_indices) < min_points_per_obs:
                skipped_counts["too_few_snapped_points"] += 1
                continue

            track_point_indices[track_id].update(snapped_indices.tolist())
            if anchor_pos is not None:
                track_anchors[track_id].append(anchor_pos)
            track_labels[track_id].append(str(det.get("canonical_label") or det.get("label") or "unknown"))
            track_scores[track_id].append(float(det.get("score", 0.0)))
            track_observation_count[track_id] += 1

    print(
        f"[bridge] Matched {matched_views}/{num_views} views, "
        f"found {len(track_point_indices)} candidate tracks"
    )
    if skipped_counts:
        print(f"[bridge] Skip stats: {dict(skipped_counts)}")

    scene_objects: list[dict[str, Any]] = []
    for track_id, idx_set in track_point_indices.items():
        if not idx_set:
            continue

        observations = track_observation_count[track_id]
        if observations < min_observations:
            continue

        indices = np.array(sorted(idx_set), dtype=np.int64)
        if len(indices) < min_points_per_object:
            continue
        if len(indices) / max(n_points, 1) > hard_reject_fraction:
            print(f"[bridge] Rejecting track {track_id}: captured too much of the scene before clustering")
            continue

        obj_points = points[indices]

        # Spatial tightening: re-filter all collected points to be near the
        # median ray-cast anchor.  This prevents multi-observation scatter.
        anchors = track_anchors.get(track_id, [])
        anchor_center: np.ndarray | None = None
        if anchors and len(anchors) >= 2 and observations >= 2:
            anchor_center = np.median(anchors, axis=0)
            anchor_dists = np.linalg.norm(np.array(anchors) - anchor_center, axis=1)
            # Tight radius: median anchor spread + small margin, capped
            tight_radius = max(
                float(np.percentile(anchor_dists, 75)) + 0.15,
                0.25,
            )
            tight_radius = min(tight_radius, anchor_radius * 0.8)
            pt_dists = np.linalg.norm(obj_points - anchor_center, axis=1)
            spatial_mask = pt_dists <= tight_radius
            tightened_indices = indices[spatial_mask]
            if len(tightened_indices) >= min_points_per_object:
                indices = tightened_indices
                obj_points = points[indices]

        component_mask = _largest_voxel_component_mask(obj_points, cluster_voxel_size)
        indices = indices[component_mask]
        obj_points = points[indices]

        inlier_mask = _mad_inlier_mask(obj_points)
        indices = indices[inlier_mask]
        obj_points = points[indices]

        if len(indices) < min_points_per_object:
            continue
        if len(indices) / max(n_points, 1) > max_scene_fraction:
            print(f"[bridge] Rejecting track {track_id}: still spans too much of the scene after filtering")
            continue

        track_meta = det_tracks.get(track_id, {})
        label = str(
            track_meta.get("canonical_label")
            or track_meta.get("label")
            or Counter(track_labels[track_id]).most_common(1)[0][0]
        )
        confidence = float(
            track_meta.get("label_confidence")
            or np.mean(track_scores[track_id])
        )

        if anchor_center is not None:
            centroid = anchor_center.copy()
        else:
            centroid = obj_points.mean(axis=0)

        obj_bbox_min = obj_points.min(axis=0)
        obj_bbox_max = obj_points.max(axis=0)

        scene_objects.append({
            "track_id": int(track_id),
            "label": label,
            "centroid_3d": centroid.tolist(),
            "bbox_3d_min": obj_bbox_min.tolist(),
            "bbox_3d_max": obj_bbox_max.tolist(),
            "confidence": round(confidence, 3),
            "n_observations": observations,
            "n_points": int(len(indices)),
            "point_indices": indices.tolist(),
        })

    scene_objects.sort(key=lambda obj: obj["n_points"], reverse=True)
    scene_objects, merge_stats = _balanced_merge_scene_objects(scene_objects, points)
    scene_objects.sort(key=lambda obj: obj["n_points"], reverse=True)
    print(f"[bridge] Output: {len(scene_objects)} scene objects")
    print(f"[bridge] Merge stats: {merge_stats}")
    for obj in scene_objects:
        bbox_size = np.array(obj["bbox_3d_max"]) - np.array(obj["bbox_3d_min"])
        print(
            f"  track {obj['track_id']:>3d}: {obj['label']:<20s} "
            f"{obj['n_points']:>6,d} pts, {obj['n_observations']} frames, "
            f"conf={obj['confidence']:.2f}, "
            f"size={bbox_size[0]:.2f}x{bbox_size[1]:.2f}x{bbox_size[2]:.2f}"
        )

    return scene_objects
