import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


@dataclass
class Settings:
    detector_provider: str = os.getenv("DETECTOR_PROVIDER", "modal")
    media_root: Path = Path(os.getenv("MEDIA_ROOT", "../data")).resolve()
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "300"))

    modal_app_name: str = os.getenv("MODAL_APP_NAME", "")
    modal_function_name: str = os.getenv("MODAL_FUNCTION_NAME", "")

    gsam2_app_name: str = os.getenv("GSAM2_APP_NAME", "video-annotator-gsam2")
    gsam2_function_name: str = os.getenv("GSAM2_FUNCTION_NAME", "track_objects")

    yolo_model: str = os.getenv("YOLO_MODEL", "yolov8n.pt")

    def ensure_dirs(self) -> None:
        (self.media_root / "uploads").mkdir(parents=True, exist_ok=True)
        (self.media_root / "outputs").mkdir(parents=True, exist_ok=True)
        (self.media_root / "jobs").mkdir(parents=True, exist_ok=True)

