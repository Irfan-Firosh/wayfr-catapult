# wayfr

**Blind home navigation.** User says "take me to the microwave" — the app guides them there with spatial audio and turn-by-turn voice instructions.

**Tech Stack:** Next.js · React · Tailwind CSS · Supabase (Postgres + Realtime) · FastAPI · Modal (A100 GPU) · Python · Cartesia TTS · Whisper STT

## Repository layout

The repo root stays small: **product app** (`frontend/`, `backend/`) plus **docs**. GPU / batch pipelines and MVPs that used to sit at the top level now live under **`backend/pipelines/`** next to the main FastAPI service.

### Application

| Path | Role |
|------|------|
| **[backend/](backend/)** | FastAPI service — sessions, WebSockets, home setup orchestration, navigation. |
| **[frontend/](frontend/)** | Next.js app — scanning UI, live navigation, voice I/O. |
| **[docs/](docs/)** | Architecture, API notes, data flow, design. |

### ML & Modal pipelines (`backend/pipelines/`)

Standalone Python projects (Modal deploys, viewers, batch jobs). They are **not** part of the `wayfr-backend` wheel in [`backend/pyproject.toml`](backend/pyproject.toml); each folder keeps its own scripts and optional `requirements.txt`.

| Path | Role |
|------|------|
| **[backend/pipelines/reconstruction/](backend/pipelines/reconstruction/)** | Dense 3D reconstruction — video → point cloud + camera poses (MapAnything). |
| **[backend/pipelines/hloc_localization/](backend/pipelines/hloc_localization/)** | Visual localization — SuperPoint + LightGlue + PnP reference map, 6DoF localization, DPVO between anchors. |
| **[backend/pipelines/segmentation/](backend/pipelines/segmentation/)** | Open-vocabulary segmentation (Grounded SAM 2, Grounding DINO, related viewers). |
| **[backend/pipelines/scene-reconstructor-mvp/](backend/pipelines/scene-reconstructor-mvp/)** | MVP wrapper around reconstruction + small API/frontend for experiments. |
| **[backend/pipelines/video-annotator-mvp/](backend/pipelines/video-annotator-mvp/)** | MVP video annotation / detection pipeline (YOLO + GSAM2 Modal apps). |
| **[backend/pipelines/scene-bridge-mvp/](backend/pipelines/scene-bridge-mvp/)** | MVP bridge UI between recon outputs and annotator outputs. |

**Imports and `python -m`:** Packages such as `hloc_localization` expect the **`backend/pipelines`** directory on `PYTHONPATH` (so `hloc_localization` is a top-level package). From the repo root:

```bash
PYTHONPATH=backend/pipelines python -m hloc_localization.backend.server --port 8090
```

Alternatively: `cd backend/pipelines && PYTHONPATH=. python -m hloc_localization.backend.server --port 8090`.

**Modal:** Deploy paths are relative to the repository root, for example:

```bash
modal deploy backend/pipelines/reconstruction/app.py
modal deploy backend/pipelines/hloc_localization/backend/app.py
modal deploy backend/pipelines/video-annotator-mvp/modal_app_gsam2.py
```

See [`backend/.env.example`](backend/.env.example) for Modal app names used by the main backend.

## Team

| Member | Contributions |
|--------|--------------|
| **Nathan** | ML pipeline & GPU compute — 3D reconstruction, object localization, camera pose tracking |
| **Victor** | Video/audio streaming, hardware integration |
| **Madhuhaas** | Agentic system, tool-calling pipeline, frontend |
| **Antonio** | Object localization, 3D viewer, demo |
| **Adi** | Backend architecture, navigation engine, infrastructure |
