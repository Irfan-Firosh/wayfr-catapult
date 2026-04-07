# wayfr

wayfr is a **spatial intelligence platform** for turning walkthrough video into persistent 3D scene artifacts, anchored objects and labels, and persona-specific interpretations of physical spaces.

In the code today, the center of the product is:

- walkthrough video -> 3D scene reconstruction
- object anchoring, evidence frames, and scene artifacts
- shared scene review in the browser
- persona-specific annotation plans and overlays on top of the same scene

Navigation, live audio, hazards, and marketplace flows exist in this repo, but they are secondary surfaces built on top of that shared spatial layer.

This README is grounded in the implemented code in `frontend/` and `backend/`, not the planning docs.

## What wayfr is

### 1. A 3D scene mapping system

The `setup` flow accepts a walkthrough video, creates a home record, and runs a background pipeline that reconstructs a scene, writes a GLB, generates supporting artifacts, and stores anchored object positions.

### 2. A scene intelligence layer

The backend maintains and serves:

- reconstructed scene meshes
- anchored object positions
- object highlight samples
- evidence frames tied to tracked objects
- localization reference bundles for mapped spaces

### 3. A persona-aware interpretation layer

The personas system detects a user role, generates a structured persona profile, and creates an annotation plan that relabels and prioritizes the same scene differently depending on who is viewing it.

### 4. A browser-based scene review experience

The frontend provides scene browsing, object inspection, evidence viewing, focused overlays, and persona-specific scene cards on top of the stored spatial artifacts.

## Core implemented workflow

1. Capture or upload a walkthrough video in `/setup`.
2. Send the video to `POST /api/homes`.
3. Run the home setup pipeline to reconstruct the scene, annotate objects, and build localization references.
4. Save scene outputs such as `scene.glb`, object evidence, and reference bundles locally, with optional cloud storage support.
5. Reopen the mapped scene in `/dashboard`, inspect anchored objects, and fetch evidence imagery.
6. Apply persona-specific annotation plans in `/personas` to reinterpret the same environment for different roles and needs.

## Main product surfaces

### Mapping and scene review

- `/setup` uploads or records walkthroughs and starts scene generation
- `/dashboard` reopens saved scenes, renders GLBs, and inspects anchored objects
- `/capture` runs a lighter video-to-scene scan flow for quick experimentation

### Persona overlays

- `/personas` detects a persona, generates a structured profile, and builds customized annotation plans for mapped scenes
- persona plans are rendered as focused overlays on top of the shared scene rather than as separate scene copies

### Scene reuse and localization

- mapped homes expose stored GLBs, object metadata, highlight samples, and evidence frames
- localization references can be built during setup and queried later with `POST /api/homes/{home_id}/localize`

## Secondary capabilities

These are implemented in the repo, but they are not the main identity of the product:

- navigation planning from current pose to a named object in a mapped home
- real-time WebSocket frame ingestion with detections, hazard alerts, and synthesized audio
- hazard submission and nearby hazard lookup with verification hooks
- a World ID-gated marketplace that routes submitted recordings into the same home-mapping pipeline

## Tech stack

### Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Clerk
- Supabase JS
- Three.js, React Three Fiber, Drei
- World ID Kit

### Backend

- FastAPI
- Uvicorn
- Pydantic Settings
- Supabase Python client
- Upstash Redis
- Modal
- OpenCV
- NumPy, SciPy, Trimesh
- Boto3
- Replicate
- Google Cloud Vision
- Google Generative AI

## Repo layout

```text
.
├── backend/
│   ├── api/               # FastAPI routes and WebSocket handler
│   ├── core/              # config, logging, errors
│   ├── db/                # Supabase client, schema, repositories, migrations
│   ├── ml/                # RCAC client
│   ├── models/            # backend data models
│   ├── services/          # scene, setup, narration, navigation, hazards, vision
│   ├── pipelines/         # standalone reconstruction / annotation / localization projects
│   ├── pyproject.toml
│   └── .env.example
├── frontend/
│   ├── app/               # App Router pages and Next.js server routes
│   ├── components/        # scene, personas, marketplace, landing, ui
│   ├── lib/
│   ├── package.json
│   └── .env.example
└── README.md
```

## API surface

The current API surface is split between the FastAPI backend and Next.js server routes.

### Scene ingestion and mapping

FastAPI:

- `GET /health`
- `POST /api/homes`
- `POST /api/scan`

### Scene retrieval and localization

FastAPI:

- `GET /api/homes`
- `GET /api/homes/{home_id}`
- `GET /api/homes/{home_id}/objects`
- `GET /api/homes/{home_id}/scene`
- `GET /api/homes/{home_id}/object-highlights/{track_id}`
- `GET /api/homes/{home_id}/object-evidence/{track_id}`
- `GET /api/homes/{home_id}/object-evidence/{track_id}/frames/{sampled_frame_idx}`
- `GET /api/homes/{home_id}/objects/{track_id}/evidence-frame`
- `POST /api/homes/{home_id}/localize`

Next.js server routes:

- `GET /api/local-scenes`
- `GET /api/local-scenes/{homeId}`

### Overlay and persona surfaces

Next.js server routes:

- `POST /api/personas/detect`
- `POST /api/personas/annotate`
- `GET /api/personas/history`
- `POST /api/personas/log/session`
- `POST /api/personas/log/profile`
- `POST /api/personas/log/message`
- `POST /api/personas/log/annotation`

### Downstream workflows

FastAPI:

- `POST /sessions`
- `GET /sessions/{session_id}`
- WebSocket `/ws/{session_id}`
- `POST /api/navigation/plan`
- `POST /hazards`
- `GET /hazards/nearby`
- `POST /verify/world-id`

Next.js server routes:

- `POST /api/world-id/verify`
- `POST /api/world-id/rp-signature`
- marketplace profile, contract, submission, balance, and pipeline handoff routes under `/api/marketplace/*`
- capture relay routes under `/api/capture/*`

## Local development

### 1. Backend

From the repo root:

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn main:app --reload
```

The backend runs on `http://localhost:8000`.

Notes:

- `backend/core/config.py` loads `backend/.env` automatically.
- local scene artifacts default to `backend/data/scenes`
- local localization references default to `backend/data/references`
- advanced flows depend on external services being configured

### 2. Frontend

In a second terminal:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

The frontend runs on `http://localhost:3000`.

## Environment variables

Only configure what you need for the workflows you want to exercise.

### Minimum frontend

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

### Frontend integrations

`frontend/.env.example` supports:

- Supabase browser keys
- Supabase service keys for server routes
- RCAC GenAI config for persona routes
- World ID app ID, RP ID, and RP signing key
- Mapbox token

### Backend integrations

`backend/.env.example` supports:

- Modal credentials and app names for reconstruction, annotation, and localization
- RCAC endpoint and API key
- RCAC GenAI config
- Gemini and Google Cloud Vision
- Replicate
- Cartesia TTS
- Supabase
- Upstash Redis
- World ID
- optional S3 storage for scene GLBs

## How scene generation works

The implemented code path for `POST /api/homes` is:

1. accept a walkthrough video and create a home record
2. schedule `run_home_setup(...)` as a background task
3. call reconstruction, annotation, and reference-building steps
4. bridge 2D detections into anchored 3D object positions
5. write scene artifacts and evidence locally
6. optionally upload scene GLBs and related assets to cloud storage
7. let the frontend poll until the scene is ready for review

## Data and storage

From the code, the app stores or reads from:

- Supabase Postgres for homes, object positions, profiles, contracts, submissions, transactions, capture sessions, and persona history
- Supabase Storage for scene and recording artifacts when configured
- local backend data directories for scene GLBs, reference bundles, and evidence frames
- optional S3 storage for scene GLBs
- Upstash Redis for cache and session-related services when configured
- browser local storage for the lightweight capture scan flow

## Current caveats

These are visible from the codebase today:

- CORS is currently configured with `allow_origins=["*"]` in the FastAPI app
- the report page is still a UI stub rather than a full backend-backed reporting flow
- many advanced capabilities depend on external services and credentials
- projects under `backend/pipelines/` are separate runtime units and may need their own deployment beyond starting FastAPI

## Security note

Do not commit `.env` files or live credentials. If any real cloud keys were exposed locally or in version control, rotate them immediately.
