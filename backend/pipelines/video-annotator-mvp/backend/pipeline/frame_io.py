from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2


def open_reader(video_path: Path) -> tuple[cv2.VideoCapture, float, int, int, int]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    return cap, fps, width, height, frame_count


def create_writer(output_path: Path, fps: float, width: int, height: int) -> cv2.VideoWriter:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError(f"Failed to create video writer: {output_path}")
    return writer


def reencode_for_browser(video_path: Path) -> None:
    """Re-encode mp4v output to H.264 so browsers can play it."""
    if not shutil.which("ffmpeg"):
        return
    tmp = video_path.with_suffix(".tmp.mp4")
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(tmp),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=600)
    if result.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
        tmp.replace(video_path)
    else:
        tmp.unlink(missing_ok=True)

