"""
MapAnything on Modal — Video to 3D point cloud reconstruction.

Uses MapAnything (Meta/CMU) for feed-forward metric 3D reconstruction
from video frames. Outputs a GLB file with a colored point cloud and
camera cone meshes.

Deploy:  modal deploy backend/pipelines/reconstruction/app.py
Run:     modal run backend/pipelines/reconstruction/app.py --video-path ~/Desktop/video.mov
Batch:   modal run backend/pipelines/reconstruction/run_batch.py::batch --fps 5 --conf 20
"""

from __future__ import annotations

import pathlib
from typing import Any

import modal

APP_NAME = "scene-reconstructor"

app = modal.App(APP_NAME)

cuda_version = "12.4.0"
flavor = "devel"
os_version = "ubuntu22.04"
tag = f"{cuda_version}-{flavor}-{os_version}"

HF_MODEL_ID = "facebook/map-anything-apache"

mapanything_image = (
    modal.Image.from_registry(f"nvidia/cuda:{tag}", add_python="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "numpy<2",
        "Pillow",
        "opencv-python",
        "tqdm",
        "huggingface_hub",
        "trimesh",
        "scipy",
    )
    .run_commands(
        "git clone https://github.com/facebookresearch/map-anything.git /opt/map-anything",
    )
    .run_commands(
        "cd /opt/map-anything && pip install -e .",
    )
    .env({
        "HF_HOME": "/opt/hf_cache",
        "TORCH_HOME": "/opt/torch_cache",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    })
    .run_commands(
        "python -c \""
        "from mapanything.models import MapAnything; "
        f"MapAnything.from_pretrained('{HF_MODEL_ID}'); "
        "print('MapAnything model downloaded OK')\"",
    )
    .run_commands(
        "python -c \""
        "import torch; "
        "from mapanything.models import MapAnything; "
        f"model = MapAnything.from_pretrained('{HF_MODEL_ID}').to('cuda'); "
        "print('MapAnything loaded on GPU OK')\"",
        gpu="any",
    )
)

with mapanything_image.imports():
    import json
    import os
    import tempfile


def _extract_frames(video_bytes: bytes, tmpdir: str, target_fps: int):
    """Extract frames from video at target FPS. Returns (image_paths, source_fps, source_indices)."""
    import cv2

    video_path = os.path.join(tmpdir, "input.mp4")
    with open(video_path, "wb") as f:
        f.write(video_bytes)

    images_dir = os.path.join(tmpdir, "images")
    os.makedirs(images_dir)

    cap = cv2.VideoCapture(video_path)
    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_interval = max(1, int(source_fps / target_fps))

    image_paths = []
    source_indices = []
    raw_idx = 0
    out_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if raw_idx % frame_interval == 0:
            path = os.path.join(images_dir, f"{out_idx:06d}.png")
            cv2.imwrite(path, frame)
            image_paths.append(path)
            source_indices.append(raw_idx)
            out_idx += 1
        raw_idx += 1
    cap.release()

    print(f"Extracted {len(image_paths)} frames from {raw_idx} total "
          f"(source {source_fps:.1f} fps, interval {frame_interval})")
    return image_paths, source_fps, source_indices


def _build_camera_cone(position, look_dir, up, scale=0.08):
    """Build a small camera-cone mesh at the given position."""
    import numpy as np
    import trimesh

    forward = look_dir / (np.linalg.norm(look_dir) + 1e-8)
    right = np.cross(forward, up)
    right = right / (np.linalg.norm(right) + 1e-8)
    up_ortho = np.cross(right, forward)

    hw = scale * 0.6
    hh = scale * 0.45
    d = scale

    apex = position
    corners = np.array([
        position + forward * d + right * hw + up_ortho * hh,
        position + forward * d - right * hw + up_ortho * hh,
        position + forward * d - right * hw - up_ortho * hh,
        position + forward * d + right * hw - up_ortho * hh,
    ])

    vertices = np.vstack([apex, corners])
    faces = np.array([
        [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1],
        [1, 3, 2], [1, 4, 3],
    ])

    return trimesh.Trimesh(
        vertices=vertices, faces=faces,
        face_colors=[180, 180, 60, 200],
        process=False,
    )


def _build_glb(predictions, conf_percentile: float):
    """Build a GLB scene from MapAnything predictions.

    Returns (glb_bytes, num_points).
    """
    import numpy as np
    import trimesh
    from mapanything.utils.geometry import depthmap_to_world_frame

    all_points = []
    all_colors = []
    camera_meshes = []

    for view_idx, pred in enumerate(predictions):
        depthmap = pred["depth_z"][0].squeeze(-1)
        intrinsics = pred["intrinsics"][0]
        camera_pose = pred["camera_poses"][0]

        pts3d, valid_mask = depthmap_to_world_frame(depthmap, intrinsics, camera_pose)
        mask = pred["mask"][0].squeeze(-1).cpu().numpy().astype(bool)
        mask = mask & valid_mask.cpu().numpy()
        conf = pred["conf"][0].cpu().numpy()

        if conf_percentile > 0:
            threshold = np.percentile(conf[mask], conf_percentile)
            mask = mask & (conf >= threshold)

        pts_np = pts3d.cpu().numpy()[mask]
        img_np = pred["img_no_norm"][0].cpu().numpy()[mask]
        colors = (img_np * 255).clip(0, 255).astype(np.uint8)

        all_points.append(pts_np)
        all_colors.append(colors)

        pose_np = camera_pose.cpu().numpy()
        cam_pos = pose_np[:3, 3]
        cam_forward = pose_np[:3, 2]
        cam_up = -pose_np[:3, 1]
        cone = _build_camera_cone(cam_pos, cam_forward, cam_up)
        camera_meshes.append(cone)

        if view_idx % 10 == 0:
            print(f"  View {view_idx}: {mask.sum():,} valid points")

    points = np.concatenate(all_points, axis=0)
    colors = np.concatenate(all_colors, axis=0)
    print(f"Total: {len(points):,} points from {len(predictions)} views")

    scene = trimesh.Scene()

    colors_rgba = np.column_stack([colors, np.full(len(colors), 255, dtype=np.uint8)])
    pc = trimesh.PointCloud(vertices=points, colors=colors_rgba)
    scene.add_geometry(pc, geom_name="point_cloud")

    for i, cone in enumerate(camera_meshes):
        scene.add_geometry(cone, geom_name=f"camera_{i:04d}")

    rotation_x = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])
    scene.apply_transform(rotation_x)

    glb_bytes = scene.export(file_type="glb")
    return glb_bytes, len(points)


def _extract_scene_data(predictions, source_indices, conf_percentile):
    """Collect depth maps, poses, intrinsics as compressed NPZ bytes."""
    import numpy as np
    from io import BytesIO

    depth_maps = []
    camera_poses = []
    intrinsics_list = []

    for pred in predictions:
        depth_maps.append(pred["depth_z"][0].squeeze(-1).cpu().numpy())
        camera_poses.append(pred["camera_poses"][0].cpu().numpy())
        intrinsics_list.append(pred["intrinsics"][0].cpu().numpy())

    rotation_x = np.eye(4)
    rotation_x[1, 1] = rotation_x[2, 2] = -1.0

    buf = BytesIO()
    np.savez_compressed(
        buf,
        depth_maps=np.stack(depth_maps),
        camera_poses=np.stack(camera_poses),
        intrinsics=np.stack(intrinsics_list),
        source_frame_indices=np.array(source_indices, dtype=np.int32),
        world_transform=rotation_x,
        conf_percentile=np.array(conf_percentile),
    )
    scene_bytes = buf.getvalue()
    print(f"Scene data NPZ: {len(scene_bytes) / 1024 / 1024:.1f} MB")
    return scene_bytes


@app.function(
    image=mapanything_image,
    gpu="A100-80GB",
    timeout=60 * 60,
    memory=65536,
)
def predict_video(
    video_bytes: bytes,
    fps: int = 2,
    conf_percentile: float = 25.0,
) -> dict[str, Any]:
    """
    Full MapAnything 3D reconstruction pipeline: video -> point cloud GLB.

    Args:
        video_bytes: Raw video file bytes.
        fps: Frames to extract per second (more = denser, slower).
        conf_percentile: Confidence percentile cutoff (lower = more points, more noise).

    Returns:
        {glb: bytes, num_frames: int, num_points: int,
         scene_data: bytes (compressed NPZ), source_fps: float}
    """
    import torch
    from mapanything.models import MapAnything
    from mapanything.utils.image import load_images

    with tempfile.TemporaryDirectory() as tmpdir:
        image_paths, source_fps, source_indices = _extract_frames(video_bytes, tmpdir, fps)

        if len(image_paths) == 0:
            raise ValueError("No frames extracted from video")

        print(f"Loading MapAnything model...")
        model = MapAnything.from_pretrained(HF_MODEL_ID).to("cuda")

        print(f"Loading {len(image_paths)} images...")
        views = load_images(image_paths)

        print(f"Running inference on {len(views)} views...")
        predictions = model.infer(
            views,
            memory_efficient_inference=True,
            minibatch_size=1,
            use_amp=True,
            amp_dtype="bf16",
            apply_mask=True,
            mask_edges=True,
            apply_confidence_mask=False,
        )

        del model
        torch.cuda.empty_cache()

        print(f"Building GLB (conf_percentile={conf_percentile})...")
        glb_bytes, num_points = _build_glb(predictions, conf_percentile)

        print("Extracting scene data...")
        scene_data_bytes = _extract_scene_data(predictions, source_indices, conf_percentile)

    torch.cuda.empty_cache()

    print(f"Output: {len(glb_bytes) / 1024 / 1024:.1f} MB GLB, "
          f"{len(image_paths)} frames, {num_points:,} points")

    return {
        "glb": glb_bytes,
        "num_frames": len(image_paths),
        "num_points": num_points,
        "scene_data": scene_data_bytes,
        "source_fps": source_fps,
    }


@app.function(
    image=mapanything_image,
    gpu="A100-80GB",
    timeout=60 * 60,
    memory=65536,
)
def reconstruct_scene(
    video_bytes: bytes,
    fps: int = 2,
    conf_percentile: float = 25.0,
) -> dict[str, Any]:
    """Alias for predict_video so the web backend can call by this name."""
    return predict_video.local(video_bytes, fps, conf_percentile)


@app.local_entrypoint()
def main(
    video_path: str,
    fps: int = 2,
    conf: float = 25.0,
    outdir: str = "",
):
    """
    Run MapAnything 3D reconstruction on a local video.

    Usage:
      modal run backend/pipelines/reconstruction/app.py \\
        --video-path data/IMG_4723.MOV --fps 3 --conf 20
    """
    video_p = pathlib.Path(video_path).expanduser().resolve()
    if not video_p.exists():
        print(f"File not found: {video_p}")
        return

    out_dir = pathlib.Path(outdir or ".").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Video: {video_p.name} ({video_p.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"FPS: {fps}, Confidence percentile: {conf}")

    result = predict_video.remote(video_p.read_bytes(), fps, conf)

    out_glb = out_dir / f"{video_p.stem}.glb"
    out_glb.write_bytes(result["glb"])

    if result.get("scene_data"):
        out_npz = out_dir / f"{video_p.stem}_scene_data.npz"
        out_npz.write_bytes(result["scene_data"])
        print(f"Scene data: {out_npz.name} ({len(result['scene_data']) / 1024 / 1024:.1f} MB)")

    print(
        f"\n{video_p.name} -> {out_glb.name} "
        f"({len(result['glb']) / 1024 / 1024:.1f} MB, "
        f"{result['num_frames']} frames, "
        f"{result['num_points']:,} points)"
    )
