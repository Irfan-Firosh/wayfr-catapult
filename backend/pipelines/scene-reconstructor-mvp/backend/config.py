import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


@dataclass
class Settings:
    backend_dir: Path = Path(__file__).resolve().parent
    project_root: Path = backend_dir.parent
    media_root: Path = Path(
        os.getenv("MEDIA_ROOT", str((Path(__file__).resolve().parent.parent / "data")))
    ).resolve()
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "500"))

    reconstruction_app_name: str = os.getenv("RECONSTRUCTION_APP_NAME", "scene-reconstructor")
    reconstruction_function_name: str = os.getenv("RECONSTRUCTION_FUNCTION_NAME", "reconstruct_scene")

    api_port: int = int(os.getenv("API_PORT", "8101"))
    viser_port: int = int(os.getenv("VISER_PORT", "8081"))

    default_fps: int = int(os.getenv("DEFAULT_FPS", "2"))
    default_conf_percentile: float = float(os.getenv("DEFAULT_CONF_PERCENTILE", "25"))

    def ensure_dirs(self) -> None:
        (self.media_root / "uploads").mkdir(parents=True, exist_ok=True)
        (self.media_root / "outputs").mkdir(parents=True, exist_ok=True)
        (self.media_root / "jobs").mkdir(parents=True, exist_ok=True)
