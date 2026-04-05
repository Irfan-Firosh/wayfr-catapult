import os
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Vision: RCAC custom VLM ──────────────────────────────────────────────
    rcac_endpoint_url: str = ""
    rcac_api_key: str = ""
    rcac_timeout_ms: int = 500

    # ── LLM: RCAC GenAI (narration synthesis) ────────────────────────────────
    genai_base_url: str = "https://genai.rcac.purdue.edu/api"
    genai_api_key: str = ""
    genai_model: str = "llama4:latest"

    # ── Vision: Google ────────────────────────────────────────────────────────
    gemini_api_key: str = ""
    google_cloud_api_key: str = ""

    # ── 3D Scene Reconstruction ───────────────────────────────────────────────
    scene3d_window_frames: int = 10
    scene3d_voxel_m: float = 0.05

    # ── Depth ─────────────────────────────────────────────────────────────────
    replicate_api_token: str = ""

    # ── TTS: Cartesia ─────────────────────────────────────────────────────────
    cartesia_api_key: str = ""
    cartesia_voice_id: str = "f0377496-2708-4cc9-b2f8-1b7fdb5e1a2a"  # Elaine - Confident Guide
    cartesia_model_id: str = "sonic-2"

    # ── Database ─────────────────────────────────────────────────────────────
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""

    # ── Cache ─────────────────────────────────────────────────────────────────
    upstash_redis_url: str = ""
    upstash_redis_token: str = ""
    # Upstash dashboard uses these names — accept either
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""

    # ── Auth ──────────────────────────────────────────────────────────────────
    jwt_secret: str = "dev-secret-change-in-prod"

    # ── World ID ──────────────────────────────────────────────────────────────
    world_app_id: str = ""

    # ── Modal auth (SDK reads MODAL_TOKEN_ID / MODAL_TOKEN_SECRET from os.environ)
    modal_token_id: str = ""
    modal_token_secret: str = ""

    # ── Modal Apps ────────────────────────────────────────────────────────────
    modal_reconstruct_app: str = "scene-reconstructor"
    modal_reconstruct_fn: str = "predict_video"
    modal_annotator_app: str = "video-annotator-gsam2"
    modal_annotator_fn: str = "track_objects"
    modal_hloc_app: str = "hloc-localization"
    modal_hloc_build_fn: str = "build_reference"
    modal_hloc_localize_fn: str = "localize_frame"

    # ── Local data storage (fallback when Supabase Storage is unavailable) ───
    scene_data_dir: str = os.getenv("SCENE_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data" / "scenes"))
    reference_data_dir: str = os.getenv("REFERENCE_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data" / "references"))

    # ── Performance ───────────────────────────────────────────────────────────
    frame_rate_fps: int = 5
    scene_description_interval_s: float = 3.0
    narration_dedup_window_s: float = 5.0
    hazard_proximity_meters: float = 100.0
    hazard_cache_ttl_s: int = 60

    @field_validator("rcac_endpoint_url")
    @classmethod
    def normalize_rcac_url(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def rcac_available(self) -> bool:
        return bool(self.rcac_endpoint_url and self.rcac_api_key)

    @property
    def genai_available(self) -> bool:
        return bool(self.genai_base_url and self.genai_api_key)

    @property
    def gemini_available(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def cartesia_available(self) -> bool:
        return bool(self.cartesia_api_key)

    @property
    def supabase_available(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)

    @property
    def redis_url(self) -> str:
        return self.upstash_redis_url or self.upstash_redis_rest_url

    @property
    def redis_token(self) -> str:
        return self.upstash_redis_token or self.upstash_redis_rest_token

    @property
    def redis_available(self) -> bool:
        return bool(self.redis_url and self.redis_token)

    @property
    def modal_credentials_available(self) -> bool:
        return bool(self.modal_token_id and self.modal_token_secret)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

Path(settings.scene_data_dir).mkdir(parents=True, exist_ok=True)
Path(settings.reference_data_dir).mkdir(parents=True, exist_ok=True)

# Modal's client library reads credentials from the process environment, not from
# pydantic. Copy values from .env-loaded settings so `modal` sees them.
if settings.modal_token_id:
    os.environ["MODAL_TOKEN_ID"] = settings.modal_token_id
if settings.modal_token_secret:
    os.environ["MODAL_TOKEN_SECRET"] = settings.modal_token_secret
