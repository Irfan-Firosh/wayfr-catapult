"""
Scene Bridge MVP — connects 2D detections from the video annotator
with 3D reconstruction data to produce objects anchored in 3D space.

Auto-discovers the latest completed jobs from both sibling MVPs.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
import viser
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from bridge import compute_scene_objects, load_glb_points
from config import Settings
from schemas import (
    BridgeRequest,
    BridgeStatus,
    DiscoverResponse,
    PipelineJob,
    SceneObject,
)

settings = Settings()
settings.ensure_dirs()

# ---------------------------------------------------------------------------
# Viser 3D viewer
# ---------------------------------------------------------------------------

viser_server = viser.ViserServer(host="0.0.0.0", port=settings.viser_port)

viewer_state: dict[str, Any] = {
    "points": None,
    "colors": None,
    "scene_objects": [],
    "selected_track_id": None,
    "centroid": None,
    "up": None,
    "init_cam_pos": None,
    "base_colors": None,
}


def _estimate_up(cam_positions: np.ndarray, scene_centroid: np.ndarray) -> np.ndarray:
    if len(cam_positions) < 3:
        return np.array([0.0, -1.0, 0.0])
    centered = cam_positions - cam_positions.mean(axis=0)
    cov = centered.T @ centered
    _, eigenvectors = np.linalg.eigh(cov)
    up = eigenvectors[:, 0]
    if np.dot(up, cam_positions.mean(axis=0) - scene_centroid) < 0:
        up = -up
    return up / (np.linalg.norm(up) + 1e-8)


def _cone_apex(mesh: trimesh.Trimesh) -> np.ndarray:
    faces = np.array(mesh.faces)
    counts = Counter(faces.flatten().tolist())
    apex_idx = max(counts, key=counts.get)
    return np.array(mesh.vertices[apex_idx])


def _generate_colors(n: int) -> list[np.ndarray]:
    colors = []
    for i in range(n):
        hue = i / max(n, 1)
        h = hue * 6.0
        c = 0.9 * 0.8
        x = c * (1 - abs(h % 2 - 1))
        m = 0.9 - c
        if h < 1:
            r, g, b = c, x, 0
        elif h < 2:
            r, g, b = x, c, 0
        elif h < 3:
            r, g, b = 0, c, x
        elif h < 4:
            r, g, b = 0, x, c
        elif h < 5:
            r, g, b = x, 0, c
        else:
            r, g, b = c, 0, x
        colors.append(np.array([int((r + m) * 255), int((g + m) * 255), int((b + m) * 255)], dtype=np.uint8))
    return colors


def load_scene_into_viser(
    glb_bytes: bytes,
    scene_objects: list[dict[str, Any]],
    downsample: int = 8,
) -> None:
    points, colors = load_glb_points(glb_bytes)

    # Extract camera meshes for orientation
    loaded = trimesh.load(BytesIO(glb_bytes), file_type="glb")
    cam_positions = []
    if isinstance(loaded, trimesh.Scene):
        for name, geom in loaded.geometry.items():
            transform = loaded.graph.get(name)
            if transform is not None:
                matrix, _ = transform
                geom = geom.copy()
                geom.apply_transform(matrix)
            if isinstance(geom, trimesh.Trimesh):
                cam_positions.append(_cone_apex(geom))

    if downsample > 1:
        idx = np.arange(0, len(points), downsample)
        ds_points = points[idx]
        ds_colors = colors[idx]
    else:
        ds_points = points
        ds_colors = colors

    centroid = ds_points.mean(axis=0)
    up = _estimate_up(np.array(cam_positions) if cam_positions else np.zeros((0, 3)), centroid)

    if cam_positions:
        first_cam = cam_positions[0]
        look_dir = centroid - first_cam
        look_dir /= np.linalg.norm(look_dir) + 1e-8
        init_cam_pos = first_cam - look_dir * 0.3
    else:
        bbox_extent = ds_points.max(axis=0) - ds_points.min(axis=0)
        cam_distance = float(np.linalg.norm(bbox_extent)) * 0.8
        init_cam_pos = centroid + up * cam_distance

    base_point_size = 0.005 * (downsample ** 0.5)

    # Dim the full cloud slightly
    dimmed = (ds_colors.astype(np.float32) * 0.5).astype(np.uint8)

    viser_server.scene.add_point_cloud(
        name="/point_cloud",
        points=ds_points,
        colors=dimmed,
        point_size=base_point_size,
        point_shape="rounded",
    )

    # Add per-object point clouds and labels
    obj_colors = _generate_colors(len(scene_objects))
    for i, obj in enumerate(scene_objects):
        obj_idx = np.array(obj["point_indices"], dtype=np.int64)
        obj_pts = points[obj_idx]

        if downsample > 1:
            step = max(1, len(obj_pts) // (len(obj_pts) // downsample + 1))
            obj_pts_ds = obj_pts[::step]
        else:
            obj_pts_ds = obj_pts

        if len(obj_pts_ds) == 0:
            continue

        color_tile = np.tile(obj_colors[i], (len(obj_pts_ds), 1))
        viser_server.scene.add_point_cloud(
            name=f"/objects/obj_{obj['track_id']}",
            points=obj_pts_ds,
            colors=color_tile,
            point_size=base_point_size * 1.5,
            point_shape="rounded",
        )

        c3d = np.array(obj["centroid_3d"])
        viser_server.scene.add_label(
            name=f"/labels/label_{obj['track_id']}",
            text=f"{obj['label']} ({obj['n_points']:,}pts)",
            position=tuple(c3d + up * 0.05),
        )

    for client in viser_server.get_clients().values():
        client.camera.position = tuple(init_cam_pos)
        client.camera.look_at = tuple(centroid)
        client.camera.up_direction = tuple(up)

    viewer_state.update({
        "points": points,
        "colors": colors,
        "scene_objects": scene_objects,
        "selected_track_id": None,
        "centroid": centroid,
        "up": up,
        "init_cam_pos": init_cam_pos,
    })

    print(f"[viser] Scene loaded: {len(ds_points):,} display points, "
          f"{len(scene_objects)} objects")


def highlight_object(track_id: int | None) -> bool:
    scene_objects = viewer_state.get("scene_objects", [])
    if not scene_objects:
        return False

    obj_colors = _generate_colors(len(scene_objects))
    up = viewer_state.get("up", np.array([0.0, -1.0, 0.0]))

    for i, obj in enumerate(scene_objects):
        tid = obj["track_id"]
        is_selected = (tid == track_id)

        brightness = 1.0 if is_selected or track_id is None else 0.3
        color = (obj_colors[i].astype(np.float32) * brightness).clip(0, 255).astype(np.uint8)

        pts = viewer_state["points"][np.array(obj["point_indices"], dtype=np.int64)]
        step = max(1, len(pts) // 5000) if len(pts) > 5000 else 1
        pts_ds = pts[::step]
        if len(pts_ds) == 0:
            continue

        color_tile = np.tile(color, (len(pts_ds), 1))
        size = 0.012 if is_selected else 0.007
        viser_server.scene.add_point_cloud(
            name=f"/objects/obj_{tid}",
            points=pts_ds,
            colors=color_tile,
            point_size=size,
            point_shape="rounded",
        )

    if track_id is not None:
        target_obj = next((o for o in scene_objects if o["track_id"] == track_id), None)
        if target_obj:
            c3d = np.array(target_obj["centroid_3d"])
            cam_offset = up * 0.3 + np.array([0.2, 0.0, 0.2])
            for client in viser_server.get_clients().values():
                client.camera.position = tuple(c3d + cam_offset)
                client.camera.look_at = tuple(c3d)
                client.camera.up_direction = tuple(up)

    viewer_state["selected_track_id"] = track_id
    return True


@viser_server.on_client_connect
def _on_client_connect(client: viser.ClientHandle):
    if viewer_state["centroid"] is not None:
        client.camera.position = tuple(viewer_state["init_cam_pos"])
        client.camera.look_at = tuple(viewer_state["centroid"])
        client.camera.up_direction = tuple(viewer_state["up"])


# ---------------------------------------------------------------------------
# Auto-discovery helpers
# ---------------------------------------------------------------------------

def _scan_jobs(data_dir: Path, source_label: str) -> list[PipelineJob]:
    jobs_dir = data_dir / "jobs"
    if not jobs_dir.exists():
        return []

    results: list[PipelineJob] = []
    for jf in sorted(jobs_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(jf.read_text())
        except Exception:
            continue
        if data.get("status") != "completed":
            continue
        results.append(PipelineJob(
            job_id=data["job_id"],
            status=data["status"],
            updated_at=data.get("updated_at", ""),
            metadata=data.get("metadata", {}),
            source=source_label,
        ))
    return results


def _resolve_recon_paths(job_id: str) -> tuple[Path, Path]:
    """Return (glb_path, npz_path) for a reconstruction job."""
    outputs = settings.recon_data_dir / "outputs"
    glb = outputs / f"{job_id}.glb"
    npz = outputs / f"{job_id}_scene_data.npz"
    return glb, npz


def _resolve_annotator_path(job_id: str) -> Path:
    return settings.annotator_data_dir / "outputs" / f"{job_id}_detections.json"


# ---------------------------------------------------------------------------
# Bridge state
# ---------------------------------------------------------------------------

bridge_results: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Scene Bridge MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/discover", response_model=DiscoverResponse)
async def discover():
    recon_jobs = _scan_jobs(settings.recon_data_dir, "reconstruction")
    annotator_jobs = _scan_jobs(settings.annotator_data_dir, "annotation")
    return DiscoverResponse(
        recon_jobs=recon_jobs,
        annotator_jobs=annotator_jobs,
    )


@app.post("/api/bridge", response_model=BridgeStatus)
async def start_bridge(req: BridgeRequest, background_tasks: BackgroundTasks):
    glb_path, npz_path = _resolve_recon_paths(req.recon_job_id)
    det_path = _resolve_annotator_path(req.annotator_job_id)

    missing = []
    if not glb_path.exists():
        missing.append(f"GLB: {glb_path}")
    if not npz_path.exists():
        missing.append(f"NPZ: {npz_path}")
    if not det_path.exists():
        missing.append(f"Detections: {det_path}")
    if missing:
        raise HTTPException(status_code=404, detail=f"Missing files: {'; '.join(missing)}")

    bridge_id = uuid.uuid4().hex[:12]
    bridge_results[bridge_id] = {
        "bridge_id": bridge_id,
        "status": "processing",
        "progress": 5,
        "message": "Starting bridge computation...",
        "recon_job_id": req.recon_job_id,
        "annotator_job_id": req.annotator_job_id,
        "objects": [],
        "error": None,
    }

    background_tasks.add_task(
        _run_bridge, bridge_id, glb_path, npz_path, det_path,
    )

    return BridgeStatus(**bridge_results[bridge_id])


def _run_bridge(bridge_id: str, glb_path: Path, npz_path: Path, det_path: Path):
    try:
        state = bridge_results[bridge_id]

        state["progress"] = 10
        state["message"] = "Loading files..."
        glb_bytes = glb_path.read_bytes()
        npz_bytes = npz_path.read_bytes()
        det_json = json.loads(det_path.read_text())

        state["progress"] = 30
        state["message"] = "Running 2D→3D bridge..."
        scene_objects = compute_scene_objects(glb_bytes, npz_bytes, det_json)

        state["progress"] = 70
        state["message"] = "Loading 3D viewer..."
        load_scene_into_viser(glb_bytes, scene_objects)

        # Save results
        out_path = settings.media_root / "bridges" / f"{bridge_id}_scene_objects.json"
        out_path.write_text(json.dumps(scene_objects, indent=2))

        state["status"] = "completed"
        state["progress"] = 100
        state["message"] = f"Bridge complete: {len(scene_objects)} objects found"
        state["objects"] = [
            SceneObject(
                track_id=o["track_id"],
                label=o["label"],
                centroid_3d=o["centroid_3d"],
                bbox_3d_min=o["bbox_3d_min"],
                bbox_3d_max=o["bbox_3d_max"],
                confidence=o["confidence"],
                n_observations=o["n_observations"],
                n_points=o["n_points"],
            ).model_dump()
            for o in scene_objects
        ]

    except Exception as exc:
        bridge_results[bridge_id]["status"] = "failed"
        bridge_results[bridge_id]["progress"] = 100
        bridge_results[bridge_id]["message"] = "Bridge failed."
        bridge_results[bridge_id]["error"] = str(exc)
        import traceback
        traceback.print_exc()


@app.get("/api/bridge/{bridge_id}", response_model=BridgeStatus)
async def get_bridge(bridge_id: str):
    if bridge_id not in bridge_results:
        raise HTTPException(status_code=404, detail="Unknown bridge_id")
    return BridgeStatus(**bridge_results[bridge_id])


@app.post("/api/bridge/{bridge_id}/select/{track_id}")
async def select_object(bridge_id: str, track_id: int):
    if bridge_id not in bridge_results:
        raise HTTPException(status_code=404, detail="Unknown bridge_id")
    ok = highlight_object(track_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Scene not loaded")
    return {"status": "ok", "track_id": track_id}


@app.post("/api/bridge/{bridge_id}/deselect")
async def deselect_object(bridge_id: str):
    if bridge_id not in bridge_results:
        raise HTTPException(status_code=404, detail="Unknown bridge_id")
    highlight_object(None)
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    print(f"Viser running on http://localhost:{settings.viser_port}")
    print(f"API running on http://localhost:{settings.api_port}")
    print(f"Recon data dir: {settings.recon_data_dir}")
    print(f"Annotator data dir: {settings.annotator_data_dir}")
    uvicorn.run(app, host="0.0.0.0", port=settings.api_port, log_level="info")
