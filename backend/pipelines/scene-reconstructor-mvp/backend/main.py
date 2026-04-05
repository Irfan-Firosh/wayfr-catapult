from __future__ import annotations

import asyncio
import json
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import modal
import numpy as np
import trimesh
import viser
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import Settings
from schemas import JobResponse, ProcessRequest, UploadResponse

settings = Settings()
settings.ensure_dirs()

# ---------------------------------------------------------------------------
# Viser 3D viewer (runs alongside FastAPI)
# ---------------------------------------------------------------------------

viser_server = viser.ViserServer(host="0.0.0.0", port=settings.viser_port)

viewer_state: dict[str, Any] = {
    "loaded_glb": None,
    "points": None,
    "colors": None,
    "centroid": None,
    "init_cam_pos": None,
    "up": None,
    "point_size": 0.005,
}


def _cone_apex(mesh: trimesh.Trimesh) -> np.ndarray:
    """Extract the cone apex (camera position) from a camera cone mesh."""
    faces = np.array(mesh.faces)
    counts = Counter(faces.flatten().tolist())
    apex_idx = max(counts, key=counts.get)
    return np.array(mesh.vertices[apex_idx])


def _estimate_up(camera_meshes: list[trimesh.Trimesh], scene_centroid: np.ndarray) -> np.ndarray:
    """Estimate scene up direction from camera positions using PCA."""
    if len(camera_meshes) < 3:
        return np.array([0.0, -1.0, 0.0])

    positions = np.array([_cone_apex(m) for m in camera_meshes])
    centered = positions - positions.mean(axis=0)
    cov = centered.T @ centered
    eigenvalues, eigenvectors = np.linalg.eigh(cov)
    up = eigenvectors[:, 0]

    cam_mean = positions.mean(axis=0)
    if np.dot(up, cam_mean - scene_centroid) < 0:
        up = -up

    return up / (np.linalg.norm(up) + 1e-8)


def load_glb(path: str) -> tuple[np.ndarray, np.ndarray, list[trimesh.Trimesh]]:
    """Load a GLB and return (points, colors, camera_meshes)."""
    loaded = trimesh.load(path)
    if isinstance(loaded, trimesh.Scene):
        scene = loaded
    else:
        scene = trimesh.Scene()
        scene.add_geometry(loaded, geom_name="geometry_0")

    points = None
    colors = None
    camera_meshes = []

    for name, geom in scene.geometry.items():
        transform = scene.graph.get(name)
        if transform is not None:
            matrix, _ = transform
            geom = geom.copy()
            geom.apply_transform(matrix)

        if isinstance(geom, trimesh.PointCloud):
            points = np.array(geom.vertices, dtype=np.float32)
            c = np.array(geom.colors, dtype=np.uint8)
            if c.size == 0:
                colors = np.full((len(points), 3), 255, dtype=np.uint8)
            elif c.ndim == 2 and c.shape[1] == 4:
                colors = c[:, :3]
            elif c.ndim == 2 and c.shape[1] == 3:
                colors = c
            else:
                colors = np.full((len(points), 3), 255, dtype=np.uint8)
        elif isinstance(geom, trimesh.Trimesh):
            camera_meshes.append(geom)

    if points is None:
        raise ValueError(f"No PointCloud found in {path}")

    print(f"Loaded {len(points):,} points, {len(camera_meshes)} camera cones from {Path(path).name}")
    return points, colors, camera_meshes


def load_glb_into_viser(glb_path: str, downsample: int = 10) -> None:
    """Load a GLB file and display it in the Viser scene."""
    points, colors, camera_meshes = load_glb(glb_path)

    if downsample > 1:
        idx = np.arange(0, len(points), downsample)
        points = points[idx]
        colors = colors[idx]
        print(f"Downsampled to {len(points):,} points for viewer")

    if len(points) == 0:
        raise ValueError("No points available to display in viewer")

    centroid = points.mean(axis=0)
    up = _estimate_up(camera_meshes, centroid)

    if camera_meshes:
        first_cam_pos = _cone_apex(camera_meshes[0])
        look_dir = centroid - first_cam_pos
        look_dir /= np.linalg.norm(look_dir) + 1e-8
        init_cam_pos = first_cam_pos - look_dir * 0.3
    else:
        bbox_extent = points.max(axis=0) - points.min(axis=0)
        cam_distance = float(np.linalg.norm(bbox_extent)) * 0.8
        init_cam_pos = centroid + up * cam_distance

    base_point_size = 0.005 * (downsample ** 0.5)

    viser_server.scene.add_point_cloud(
        name="/point_cloud",
        points=points,
        colors=colors,
        point_size=base_point_size,
        point_shape="rounded",
    )

    for client in viser_server.get_clients().values():
        client.camera.position = tuple(init_cam_pos)
        client.camera.look_at = tuple(centroid)
        client.camera.up_direction = tuple(up)

    viewer_state.update({
        "loaded_glb": glb_path,
        "points": points,
        "colors": colors,
        "centroid": centroid,
        "init_cam_pos": init_cam_pos,
        "up": up,
        "point_size": base_point_size,
    })

    print(f"Viser scene updated with {len(points):,} points")


@viser_server.on_client_connect
def _on_client_connect(client: viser.ClientHandle):
    if viewer_state["centroid"] is not None:
        client.camera.position = tuple(viewer_state["init_cam_pos"])
        client.camera.look_at = tuple(viewer_state["centroid"])
        client.camera.up_direction = tuple(viewer_state["up"])


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="3D Scene Reconstructor MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=str(settings.media_root)), name="media")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_path(job_id: str) -> Path:
    return settings.media_root / "jobs" / f"{job_id}.json"


def _to_media_url(rel: str | None) -> str | None:
    return f"/media/{rel}" if rel else None


def _read_job(job_id: str) -> dict[str, Any]:
    path = _job_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    return json.loads(path.read_text())


def _write_job(job_id: str, data: dict[str, Any]) -> None:
    data["updated_at"] = _now_iso()
    _job_path(job_id).write_text(json.dumps(data, indent=2))


def _create_job_record(job_id: str, upload_rel: str) -> dict[str, Any]:
    job = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "stage": "upload",
        "message": "Video uploaded. Ready to process.",
        "input_video_rel": upload_rel,
        "glb_rel": None,
        "viewer_ready": False,
        "metadata": {},
        "error": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    _write_job(job_id, job)
    return job


def _job_response(job: dict[str, Any]) -> JobResponse:
    return JobResponse(
        job_id=job["job_id"],
        status=job["status"],
        progress=int(job.get("progress", 0)),
        stage=job.get("stage", ""),
        message=job.get("message", ""),
        original_url=_to_media_url(job.get("input_video_rel")),
        glb_url=_to_media_url(job.get("glb_rel")),
        viewer_ready=job.get("viewer_ready", False),
        metadata=job.get("metadata", {}),
        error=job.get("error"),
    )


async def _process_job_task(job_id: str, req: ProcessRequest) -> None:
    """Background task: call Modal for reconstruction, save GLB, load into Viser."""
    job = _read_job(job_id)
    input_rel = job["input_video_rel"]
    input_path = settings.media_root / input_rel
    glb_rel = f"outputs/{job_id}.glb"
    glb_path = settings.media_root / glb_rel

    try:
        job = _read_job(job_id)
        job["status"] = "processing"
        job["stage"] = "uploading"
        job["progress"] = 5
        job["message"] = "Sending video to Modal..."
        _write_job(job_id, job)

        video_bytes = input_path.read_bytes()

        job = _read_job(job_id)
        job["stage"] = "reconstructing"
        job["progress"] = 15
        job["message"] = f"Running MapAnything reconstruction (fps={req.fps})..."
        _write_job(job_id, job)

        fn = modal.Function.from_name(
            settings.reconstruction_app_name,
            settings.reconstruction_function_name,
        )
        result = await asyncio.to_thread(
            fn.remote, video_bytes, req.fps, req.conf_percentile,
        )

        if not isinstance(result, dict) or "glb" not in result:
            raise RuntimeError("Modal function returned unexpected format")

        job = _read_job(job_id)
        job["stage"] = "saving"
        job["progress"] = 80
        job["message"] = "Saving reconstruction..."
        _write_job(job_id, job)

        glb_path.parent.mkdir(parents=True, exist_ok=True)
        glb_path.write_bytes(result["glb"])

        scene_data_rel = None
        scene_data = result.get("scene_data")
        if scene_data:
            scene_data_rel = f"outputs/{job_id}_scene_data.npz"
            scene_data_path = settings.media_root / scene_data_rel
            scene_data_path.write_bytes(scene_data)

        job = _read_job(job_id)
        job["stage"] = "loading_viewer"
        job["progress"] = 90
        job["message"] = "Loading 3D viewer..."
        _write_job(job_id, job)

        load_glb_into_viser(str(glb_path))

        done = _read_job(job_id)
        done["status"] = "completed"
        done["progress"] = 100
        done["stage"] = "completed"
        done["message"] = "Reconstruction complete."
        done["glb_rel"] = glb_rel
        done["viewer_ready"] = True
        metadata = {
            "num_frames": result.get("num_frames", 0),
            "num_points": result.get("num_points", 0),
            "glb_size_mb": round(len(result["glb"]) / 1024 / 1024, 1),
        }
        if scene_data_rel:
            metadata["scene_data_rel"] = scene_data_rel
        if result.get("source_fps"):
            metadata["source_fps"] = result["source_fps"]
        done["metadata"] = metadata
        _write_job(job_id, done)

    except Exception as exc:
        failed = _read_job(job_id)
        failed["status"] = "failed"
        failed["stage"] = "failed"
        failed["progress"] = 100
        failed["message"] = "Reconstruction failed."
        failed["error"] = str(exc)
        _write_job(job_id, failed)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/videos", response_model=UploadResponse)
async def upload_video(file: UploadFile = File(...)) -> UploadResponse:
    size_limit = settings.max_upload_mb * 1024 * 1024
    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
    job_id = uuid.uuid4().hex[:12]
    upload_rel = f"uploads/{job_id}_original{suffix}"
    upload_path = settings.media_root / upload_rel
    upload_path.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    with upload_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > size_limit:
                out.close()
                upload_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds {settings.max_upload_mb}MB limit",
                )
            out.write(chunk)

    _create_job_record(job_id, upload_rel)
    return UploadResponse(
        job_id=job_id,
        status="queued",
        original_url=_to_media_url(upload_rel) or "",
    )


@app.post("/api/jobs/{job_id}/process", response_model=JobResponse)
async def start_processing(
    job_id: str, req: ProcessRequest, background_tasks: BackgroundTasks,
) -> JobResponse:
    job = _read_job(job_id)
    if job["status"] in ("processing", "completed"):
        return _job_response(job)

    background_tasks.add_task(_process_job_task, job_id, req)

    job["status"] = "processing"
    job["stage"] = "queued_processing"
    job["progress"] = 2
    job["message"] = "Job accepted. Reconstruction will start shortly."
    _write_job(job_id, job)
    return _job_response(job)


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    return _job_response(_read_job(job_id))


@app.get("/api/jobs/{job_id}/download")
async def download_glb(job_id: str):
    job = _read_job(job_id)
    glb_rel = job.get("glb_rel")
    if not glb_rel:
        raise HTTPException(status_code=404, detail="GLB not ready yet")
    glb_path = settings.media_root / glb_rel
    if not glb_path.exists():
        raise HTTPException(status_code=404, detail="GLB file not found")
    return FileResponse(
        glb_path,
        media_type="model/gltf-binary",
        filename=f"{job_id}.glb",
    )


@app.get("/api/jobs/{job_id}/download-scene-data")
async def download_scene_data(job_id: str):
    job = _read_job(job_id)
    scene_data_rel = job.get("metadata", {}).get("scene_data_rel")
    if not scene_data_rel:
        raise HTTPException(status_code=404, detail="Scene data not available for this job")
    scene_data_path = settings.media_root / scene_data_rel
    if not scene_data_path.exists():
        raise HTTPException(status_code=404, detail="Scene data file not found")
    return FileResponse(
        scene_data_path,
        media_type="application/octet-stream",
        filename=f"{job_id}_scene_data.npz",
    )


if __name__ == "__main__":
    import uvicorn

    print(f"Viser running on http://localhost:{settings.viser_port}")
    print(f"API running on http://localhost:{settings.api_port}")
    uvicorn.run(app, host="0.0.0.0", port=settings.api_port, log_level="info")
