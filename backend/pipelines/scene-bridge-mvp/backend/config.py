import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


@dataclass
class Settings:
    backend_dir: Path = Path(__file__).resolve().parent
    project_root: Path = backend_dir.parent.parent

    recon_data_dir: Path = Path(
        os.getenv(
            "RECON_DATA_DIR",
            str(Path(__file__).resolve().parent.parent.parent / "scene-reconstructor-mvp" / "data"),
        )
    ).resolve()

    annotator_data_dir: Path = Path(
        os.getenv(
            "ANNOTATOR_DATA_DIR",
            str(Path(__file__).resolve().parent.parent.parent / "video-annotator-mvp" / "data"),
        )
    ).resolve()

    media_root: Path = Path(
        os.getenv("MEDIA_ROOT", str(Path(__file__).resolve().parent.parent / "data"))
    ).resolve()

    api_port: int = int(os.getenv("API_PORT", "8102"))
    viser_port: int = int(os.getenv("VISER_PORT", "8082"))

    def ensure_dirs(self) -> None:
        (self.media_root / "bridges").mkdir(parents=True, exist_ok=True)
