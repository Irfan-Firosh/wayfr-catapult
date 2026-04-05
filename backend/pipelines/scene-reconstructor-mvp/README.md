# 3D Scene Reconstructor MVP

Upload a video, reconstruct a 3D point cloud using [MapAnything](https://github.com/facebookresearch/map-anything) on Modal (A100-80GB), and explore it interactively in a Viser-based 3D viewer.

## Architecture

```
backend/pipelines/scene-reconstructor-mvp/
├── modal_app.py          # MapAnything pipeline on Modal (A100-80GB)
├── backend/
│   ├── main.py           # FastAPI (port 8101) + Viser (port 8081)
│   ├── config.py         # Settings from .env
│   ├── schemas.py        # Pydantic models
│   └── requirements.txt
├── frontend/
│   ├── index.html        # Upload + 3D viewer UI
│   ├── app.js
│   └── styles.css
├── data/                 # uploads/, outputs/, jobs/
├── .env                  # Modal credentials + config
└── README.md
```

## Setup

### 1. Modal account

```bash
pip install modal
modal setup  # one-time auth
```

Create your local environment file and add credentials:

```bash
cp backend/pipelines/scene-reconstructor-mvp/.env.example backend/pipelines/scene-reconstructor-mvp/.env
```

### 2. Deploy the Modal app

```bash
modal deploy backend/pipelines/scene-reconstructor-mvp/modal_app.py
```

This builds the GPU container image (MapAnything + PyTorch on A100-80GB) and deploys the `reconstruct_scene` function.

### 3. Install backend dependencies

```bash
cd backend/pipelines/scene-reconstructor-mvp/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Start the backend

```bash
cd backend/pipelines/scene-reconstructor-mvp/backend
python main.py
```

This starts:
- FastAPI on http://localhost:8101
- Viser 3D viewer on http://localhost:8081

### 5. Start the frontend

```bash
cd backend/pipelines/scene-reconstructor-mvp/frontend
python -m http.server 5176
```

Open http://localhost:5176

## Usage

1. Select a video file and click **Upload**
2. Adjust FPS (frames per second to extract) and Conf% (confidence percentile cutoff)
3. Click **Reconstruct** to start the pipeline
4. Wait for processing (Modal runs MapAnything on an A100-80GB GPU)
5. When complete, the 3D point cloud appears in the embedded viewer
6. Use **Download GLB** to save the reconstruction locally

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| FPS | 2 | Frames extracted per second. More = denser, slower |
| Conf% | 25 | Confidence percentile cutoff. Lower = more points, more noise |

### Quality presets

```
Fast preview:  FPS=1, Conf%=40
Default:       FPS=2, Conf%=25
High quality:  FPS=5, Conf%=20
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/videos` | POST | Upload video (multipart) |
| `/api/jobs/{id}/process` | POST | Start reconstruction (`{fps, conf_percentile}`) |
| `/api/jobs/{id}` | GET | Poll job status |
| `/api/jobs/{id}/download` | GET | Download GLB file |

## CLI (Modal direct)

Run reconstruction without the web UI:

```bash
modal run backend/pipelines/scene-reconstructor-mvp/modal_app.py \
  --video-path ~/Desktop/video.MOV \
  --fps 3 --conf 20
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEDIA_ROOT` | `../data` | Storage directory |
| `MAX_UPLOAD_MB` | `500` | Max upload size |
| `MODAL_TOKEN_ID` | - | Modal credentials |
| `MODAL_TOKEN_SECRET` | - | Modal credentials |
| `RECONSTRUCTION_APP_NAME` | `scene-reconstructor` | Deployed Modal app name |
| `RECONSTRUCTION_FUNCTION_NAME` | `reconstruct_scene` | Modal function name |
| `API_PORT` | `8101` | FastAPI port (use non-conflicting port) |
| `VISER_PORT` | `8081` | Viser 3D viewer port |

Security note: never commit real `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` values.

## Viewing existing GLBs

Use the standalone viewer from `backend/pipelines/reconstruction/`:

```bash
cd backend/pipelines/reconstruction
pip install -r requirements.txt
python viewer.py /path/to/scene.glb --downsample 20
```
