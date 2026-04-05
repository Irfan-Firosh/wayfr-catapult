# wayfr — Backend Structure

## Overview

FastAPI application deployed on Modal (serverless GPU). Python 3.11, async-first throughout.
All inference runs in Modal workers. REST + WebSocket on the same ASGI server.

---

## File Structure

```
backend/
├── main.py                        ← FastAPI app factory + router mounting
├── modal_app.py                   ← Modal deployment entry point
├── pyproject.toml                 ← Dependencies (poetry)
│
├── core/
│   ├── config.py                  ← All env vars (pydantic-settings)
│   ├── deps.py                    ← Dependency injection (get_db, get_redis, get_session)
│   ├── errors.py                  ← Custom exception classes + handlers
│   └── logging.py                 ← Structured logging setup
│
├── api/
│   ├── ws_handler.py              ← WebSocket endpoint (/ws/{session_id})
│   └── routes/
│       ├── health.py              ← GET /health
│       ├── sessions.py            ← POST /sessions, GET /sessions/{id}
│       ├── hazards.py             ← POST /hazards, GET /hazards/nearby
│       ├── verify.py              ← POST /verify/world-id
│       └── caregiver.py          ← POST /sessions/{id}/message (caregiver → user)
│
├── services/
│   ├── vision/
│   │   ├── pipeline.py            ← asyncio.gather orchestrator (main entry point)
│   │   ├── object_detector.py     ← RCAC VLM client wrapper (Gemini fallback built-in)
│   │   ├── cloud_vision.py        ← Google Cloud Vision API (OCR + labels)
│   │   ├── depth_estimator.py     ← DepthAnything v2 via Replicate
│   │   └── scene_analyzer.py      ← Gemini 1.5 Flash (every-3s scene description)
│   │
│   ├── narration/
│   │   ├── synthesizer.py         ← Claude Haiku: structured data → natural sentence
│   │   ├── tts.py                 ← ElevenLabs streaming TTS wrapper
│   │   ├── context_tracker.py     ← Deduplication (don't repeat same narration < 5s)
│   │   └── priority.py            ← Urgency scoring: object > hazard > context
│   │
│   ├── scene3d.py                 ← 3D scene reconstruction & novel view synthesis
│   ├── hazard_map.py              ← Proximity queries, auto-verification, cache
│   ├── session_manager.py         ← Session lifecycle (create, update, expire)
│   └── worldid.py                 ← World ID proof verification + JWT issuance
│
├── db/
│   ├── client.py                  ← Supabase Python client wrapper
│   └── repositories/
│       ├── hazards.py             ← Hazard CRUD + geospatial queries
│       └── sessions.py            ← Session CRUD
│
├── ml/
│   └── rcac_client.py             ← RCAC VLM endpoint client (+ Gemini fallback)
│
└── models/
    ├── vision.py                  ← VisionResult, ObjectAnnotation, Scene3DPoint, SceneView, DepthMap, TextAnnotation
    ├── narration.py               ← NarrationResult, AudioChunk
    ├── hazard.py                  ← Hazard, HazardSubmission, ProximityAlert
    ├── session.py                 ← Session, SessionStatus, SessionUpdate
    └── worldid.py                 ← WorldIDProof, VerificationResult
```

---

## Core Configuration (`backend/core/config.py`)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Vision
    google_cloud_api_key: str
    gemini_api_key: str
    replicate_api_token: str

    # ML — RCAC-hosted VLM (primary obstacle detection)
    rcac_endpoint_url: str            # e.g. https://<host>:8080
    rcac_api_key: str                 # Bearer token for RCAC inference server
    rcac_timeout_ms: int = 500        # Fallback to Gemini if exceeded

    # Audio
    elevenlabs_api_key: str
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"  # Rachel

    # Narration
    anthropic_api_key: str

    # Database
    supabase_url: str
    supabase_anon_key: str
    supabase_service_key: str

    # Cache
    upstash_redis_url: str
    upstash_redis_token: str

    # World ID
    world_app_id: str

    # Performance
    frame_rate_fps: int = 5
    scene_description_interval_s: float = 3.0
    narration_dedup_window_s: float = 5.0
    hazard_proximity_meters: float = 100.0
    hazard_cache_ttl_s: int = 60

    class Config:
        env_file = ".env"

settings = Settings()
```

---

## WebSocket Protocol

### Connection

```
WSS /ws/{session_id}
Headers:
  Authorization: Bearer <session_token>
```

### Client → Server Messages

```typescript
// Frame message (sent every 200ms)
{
  type: "frame",
  data: string,          // base64-encoded JPEG
  timestamp: number,     // Unix ms
  gps?: { lat: number, lng: number, accuracy: number }
}

// Voice command message
{
  type: "command",
  command: "describe" | "read_text" | "find_seat" | "where_am_i" | "pause" | "resume",
  timestamp: number
}

// Ping (keepalive)
{
  type: "ping",
  timestamp: number
}
```

### Server → Client Messages

```typescript
// Audio narration
{
  type: "audio",
  data: string,          // base64-encoded MP3 chunk
  priority: "urgent" | "normal" | "low",
  text: string,          // narration text (for debugging / captions)
  timestamp: number
}

// Hazard alert (nearby verified hazard)
{
  type: "hazard_alert",
  hazard: {
    type: string,
    severity: "low" | "medium" | "high" | "critical",
    distance_m: number,
    direction: string,   // "ahead" | "left" | "right" | "behind"
    description: string,
    verified_count: number
  }
}

// Session state update
{
  type: "session_update",
  status: "active" | "paused" | "error",
  timestamp: number
}

// Pong
{
  type: "pong",
  timestamp: number
}
```

---

## Scene3D Service (`backend/services/scene3d.py`)

Maintains a persistent, incrementally-updated 3D scene from RGB-D frames and exposes
rendered synthetic views for consumption by the vision models.

```python
class Scene3D:
    """
    Sliding-window 3D scene reconstruction service.

    Accumulates 3D point clouds from RGB-D frames, renders novel synthetic 2D views,
    and tags 3D points with semantic labels back-projected from 2D model annotations.
    """

    def update_from_frame(self, rgb: np.ndarray, depth: np.ndarray, pose: CameraPose) -> None:
        """
        Fuse a new RGB-D frame into the 3D scene.

        Backprojects every pixel using depth + camera intrinsics:
            x = (u - cx) * d / fx
            y = (v - cy) * d / fy
            z = d
        Applies voxel-grid downsampling at 0.05m, appends to sliding window,
        and evicts the oldest frame's points when window exceeds 10 frames.

        Args:
            rgb:   H×W×3 uint8 image
            depth: H×W float32 depth map (metric metres)
            pose:  camera extrinsics (rotation + translation relative to world origin)
        """

    def render_view(self, view_type: str) -> SceneView:
        """
        Project accumulated 3D point cloud to a synthetic 2D image.

        Args:
            view_type: "top_down" | "current" | "left" | "right"

        Returns:
            SceneView with JPEG bytes + camera_matrix used for the projection.
            The camera_matrix is stored so annotations can be back-projected later.

        View specs:
            top_down  — orthographic, 5m×5m footprint centred on user, 512×512 px
            current   — perspective matching glasses FOV (~70°), 640×480 px
            left      — perspective, yaw +30° from current heading, 640×480 px
            right     — perspective, yaw −30° from current heading, 640×480 px
        """

    def apply_annotations(self, annotations: list[ObjectAnnotation]) -> None:
        """
        Back-project 2D bounding box annotations into 3D space.

        For each annotation:
        1. Map bbox_2d centre to a 3D ray using the SceneView's camera_matrix
        2. Intersect ray with accumulated point cloud to find (x_3d, y_3d, z_3d)
        3. Tag matching 3D points with label + confidence
        4. Upsert into scene graph: merge if within 0.3m of an existing labelled point,
           otherwise insert new entry
        5. Remove entries not refreshed within the last 5 seconds
        """
```

**Key invariants:**
- Window size: 10 frames (configurable via `SCENE3D_WINDOW_FRAMES` env var)
- Voxel resolution: 0.05m (configurable via `SCENE3D_VOXEL_M`)
- Memory ceiling: ~20MB for a full 10-frame window at 640×480 after downsampling
- Thread safety: all mutations protected by `asyncio.Lock`; rendering is read-only

---

## Vision Pipeline (`backend/services/vision/pipeline.py`)

```python
async def process_frame(frame_bytes: bytes, session_ctx: SessionContext) -> VisionResult:
    """
    Full frame processing pipeline including 3D reconstruction.

    Order of operations (sequential where dependent, parallel elsewhere):
      1. DepthAnything v2 → depth map           ~300ms
      2. scene3d.update_from_frame(...)          ~50ms  (after depth completes)
      3. scene3d.render_view("current")          ~100ms (after update completes)
      4. object_detector + cloud_vision          parallel, ~150–300ms
      5. scene3d.apply_annotations(...)          ~20ms  (after detection completes)

    Cloud Vision runs on the raw frame in parallel with depth estimation —
    it does not require the 3D reconstruction step.
    Gemini scene understanding runs every 3s using all four rendered views.
    """
    # Step 1: depth (required before 3D update)
    depth_result = await depth_estimator.estimate(frame_bytes)

    # Step 2 + 3: fuse into 3D scene and render synthetic view
    await scene3d.update_from_frame(
        rgb=frame_bytes_to_ndarray(frame_bytes),
        depth=depth_result.depth_array,
        pose=session_ctx.camera_pose,
    )
    current_view = await scene3d.render_view("current")

    # Step 4: object detection on synthetic view + OCR on raw frame (parallel)
    tasks = [
        object_detector.detect(current_view.image_bytes),   # ~100–300ms (RCAC) | ~150ms fallback
        cloud_vision.analyze(frame_bytes),                   # ~150ms
    ]

    run_gemini = (
        time.time() - session_ctx.last_scene_description > settings.scene_description_interval_s
        or session_ctx.pending_voice_command == "describe"
    )
    if run_gemini:
        all_views = await asyncio.gather(
            scene3d.render_view("top_down"),
            scene3d.render_view("left"),
            scene3d.render_view("right"),
        )
        tasks.append(scene_analyzer.analyze([current_view, *all_views], session_ctx))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    detected_objects = results[0] if not isinstance(results[0], Exception) else []

    # Step 5: back-project annotations to 3D scene graph
    if detected_objects:
        await scene3d.apply_annotations(detected_objects)

    return VisionResult(
        detected_objects=detected_objects,
        text_annotations=results[1].text if not isinstance(results[1], Exception) else [],
        object_labels=results[1].objects if not isinstance(results[1], Exception) else [],
        scene_views=[current_view],
        scene_point_count=scene3d.point_count,
        depth_map=depth_result if not isinstance(depth_result, Exception) else None,
        scene_description=results[2] if run_gemini and not isinstance(results[2], Exception) else None,
        community_hazards=await hazard_map.get_nearby(session_ctx.gps),
        timestamp=time.time(),
    )
```

---

## Narration Synthesizer (`backend/services/narration/synthesizer.py`)

### System Prompt (Claude Haiku)

```
You are the wayfr narration engine, assisting a visually impaired person wearing smart glasses.
Your job: generate exactly ONE short, clear sentence (max 15 words) describing the most
important thing the user needs to know right now.

Priority order:
1. URGENT: Immediate object in path (< 1m) — always interrupt
2. HIGH: Object (1–3m) or step/drop detected
3. MEDIUM: Community hazard alert nearby
4. LOW: Scene context, text, items of interest

Rules:
- Use directional language: "ahead", "on your left", "on your right", "behind you"
- Include distance when relevant: "3 feet ahead", "about 2 meters to your left"
- Never repeat the same observation within 5 seconds
- If nothing important: say nothing (return null)
- Tone: calm, confident, precise. Like a trusted guide.

Examples:
GOOD: "Step down 2 feet ahead on your right."
GOOD: "Sign reads: Pull to open."
GOOD: "Community alert: Wet floor 15 meters ahead, reported by 4 people."
BAD: "I can see that there appears to be what looks like a step..."
BAD: "Everything seems clear at the moment."
```

---

## Narration Context Tracker

Prevents the same observation being repeated within the dedup window (5s default).

```python
class ContextTracker:
    def __init__(self, window_s: float = 5.0):
        self._recent: deque[tuple[str, float]] = deque()
        self._window = window_s

    def should_narrate(self, text: str) -> bool:
        now = time.time()
        self._prune(now)
        # Fuzzy match against recent narrations (similarity > 0.8 = skip)
        for recent_text, _ in self._recent:
            if self._similarity(text, recent_text) > 0.8:
                return False
        self._recent.append((text, now))
        return True

    def _similarity(self, a: str, b: str) -> float:
        # Simple token overlap ratio
        a_tokens, b_tokens = set(a.lower().split()), set(b.lower().split())
        if not a_tokens or not b_tokens:
            return 0.0
        return len(a_tokens & b_tokens) / max(len(a_tokens), len(b_tokens))
```

---

## Hazard Map Service (`backend/services/hazard_map.py`)

```python
async def get_nearby(gps: GPSCoord | None, radius_m: float = 100) -> list[ProximityAlert]:
    """
    Get verified hazards near user's GPS location.
    Redis-cached per geohash6 cell (TTL: 60s).
    """
    if not gps:
        return []

    cache_key = f"hazards:{geohash.encode(gps.lat, gps.lng, precision=6)}"
    cached = await redis.get(cache_key)
    if cached:
        return [ProximityAlert(**h) for h in json.loads(cached)]

    hazards = await hazard_repo.get_within_radius(gps.lat, gps.lng, radius_m)
    await redis.setex(cache_key, settings.hazard_cache_ttl_s, json.dumps([h.dict() for h in hazards]))
    return hazards

async def submit_hazard(submission: HazardSubmission, nullifier_hash: str) -> Hazard:
    """
    Insert new hazard. Requires verified World ID nullifier.
    Auto-verifies if 3+ unique humans reported same location.
    """
    # Check nullifier rate limit
    rate_key = f"hazard_limit:{nullifier_hash}:{date.today()}"
    count = await redis.incr(rate_key)
    if count == 1:
        await redis.expire(rate_key, 86400)  # Expires end of day
    if count > 5:
        raise TooManyReportsError("Maximum 5 hazard reports per day per verified human")

    hazard = await hazard_repo.create(submission, nullifier_hash)

    # Check auto-verification threshold
    nearby_count = await hazard_repo.count_unique_reporters_at(hazard.location, radius_m=20)
    if nearby_count >= 3:
        await hazard_repo.set_verified(hazard.id)
        # Write on-chain attestation
        await world_chain.submit_attestation(nullifier_hash, hazard)

    # Invalidate nearby cache cells
    await redis.delete(f"hazards:{geohash.encode(hazard.lat, hazard.lng, precision=6)}")

    return hazard
```

---

## Modal Deployment (`backend/modal_app.py`)

```python
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_pyproject("pyproject.toml")
)

app = modal.App("wayfr-backend", image=image)

@app.function(
    secrets=[modal.Secret.from_name("clearpath-secrets")],
    gpu=modal.gpu.T4(),          # T4 for scene3d rasterization and pipeline
    concurrency_limit=20,         # Max 20 concurrent WebSocket sessions
    timeout=3600,                 # 1h session max
)
@modal.asgi_app()
def fastapi_app():
    from main import create_app
    return create_app()
```

**Key Modal settings:**
- GPU: T4 (sufficient for scene3d rasterization + pipeline orchestration, ~$0.60/hr) — upgrade to A10G if latency > budget
- Concurrency: 20 per worker, auto-scales workers
- Secrets: Managed via Modal secret store (not env files)
- Cold start: ~3s (acceptable — sessions don't cold-start after first user)

---

## Error Response Format

All API errors return:

```json
{
  "error": "Human-readable error message",
  "code": "SNAKE_CASE_ERROR_CODE",
  "details": {}
}
```

Common error codes:
- `WORLD_ID_INVALID` — Proof verification failed
- `RATE_LIMIT_EXCEEDED` — Too many hazard reports
- `SESSION_NOT_FOUND` — Invalid session ID
- `VISION_PIPELINE_ERROR` — AI processing failure (fallback to last good result)
- `AUDIO_GENERATION_FAILED` — TTS error (fallback to Google TTS)
