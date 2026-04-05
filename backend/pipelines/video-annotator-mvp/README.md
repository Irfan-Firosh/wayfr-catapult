# Video Annotator MVP

Isolated MVP for one purpose: upload a video, process it through an annotation pipeline, and return a tracked output video with boxes and labels burned in.

This folder lives under `backend/pipelines/` with the other Modal GPU experiments and mirrors known working patterns from [`../segmentation/`](../segmentation/README.md) tracked-video flows.

## What This Builds

- Minimal UI with:
  - video file input
  - process button
  - live status/progress
  - original + annotated video preview
- FastAPI backend with:
  - upload endpoint
  - process endpoint
  - job status endpoint
  - static media serving
- Processing pipeline:
  - decode video
  - run object detection
  - track IDs across frames
  - draw overlays
  - re-encode to MP4
  - save detections JSON

## What Is Real vs Mocked

Real now:
- End-to-end upload -> process -> tracked output MP4
- Job tracking and status updates
- Local detector fallback (`ultralytics` + IoU tracker)
- Modal YOLO provider (remote YOLOv8 on GPU)
- Grounded SAM 2 provider (automatic multi-keyframe object discovery + SAM 2.1 masks + video tracking via `supervision`)

## Folder Layout

- `modal_app.py`: Modal remote worker — YOLOv8 + IoU tracker on GPU
- `modal_app_gsam2.py`: Modal remote worker — Grounded SAM 2 pipeline on A100
- `backend/main.py`: API server and job lifecycle
- `backend/pipeline/orchestrator.py`: provider selection + fallback flow
- `backend/pipeline/providers/modal_segmentation.py`: Modal remote provider (used by both modal and gsam2)
- `backend/pipeline/providers/local_yolo.py`: local fallback detector/tracker renderer
- `backend/pipeline/tracking.py`: simple IoU tracking (local path only)
- `backend/pipeline/draw.py`: annotation drawing (local path only)
- `frontend/index.html`: barebones UI
- `frontend/app.js`: upload/process polling
- `data/uploads`, `data/outputs`, `data/jobs`: runtime artifacts

## Dependencies

System requirements:
- Python 3.10+
- `ffmpeg` (required for browser-playable video output)
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`

Backend Python packages (see `backend/requirements.txt`):
- `fastapi`
- `uvicorn[standard]`
- `python-multipart`
- `opencv-python`
- `numpy`
- `pydantic`
- `python-dotenv`
- `ultralytics`
- `scipy`
- `modal`
- `httpx`

Frontend:
- plain HTML/CSS/JS (no build step)

## Environment Variables

Copy `.env.example` and fill values.

`DETECTOR_PROVIDER` options:
- `local_yolo` — zero-config, no API keys, runs YOLOv8 locally (80 COCO classes)
- `modal` — remote YOLOv8 on Modal GPU (same classes, faster)
- `gsam2` — Grounded SAM 2 on Modal A100 (automatic room-scene object discovery + pixel masks + temporal tracking via SAM 2.1)

For any Modal provider:
- `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` from Modal

For `modal` provider:
- `MODAL_APP_NAME=video-annotator-yolo`
- `MODAL_FUNCTION_NAME=track_video`

For `gsam2` provider:
- `GSAM2_APP_NAME=video-annotator-gsam2`
- `GSAM2_FUNCTION_NAME=track_objects`
- Optional quality tuning:
  - `GSAM2_GDINO_MODEL_ID=IDEA-Research/grounding-dino-base`
  - `GSAM2_KEYFRAME_STRIDE=15`
  - `GSAM2_TEXT_THRESHOLD=0.18`
  - `GSAM2_ENABLE_TILING=true`

## Run Commands

### 0) Deploy Modal app (required for modal/gsam2 providers)

```bash
cd backend/pipelines/video-annotator-mvp

# For DETECTOR_PROVIDER=modal (YOLO on GPU):
modal deploy modal_app.py

# For DETECTOR_PROVIDER=gsam2 (Grounded SAM 2 — recommended):
modal deploy modal_app_gsam2.py
```

Redeploy after any changes to the Modal app files.

### 1) Backend

```bash
cd backend/pipelines/video-annotator-mvp/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8100
```

### 2) Frontend

```bash
cd backend/pipelines/video-annotator-mvp/frontend
python -m http.server 5175
```

Open:
- UI: `http://localhost:5175`
- API docs: `http://localhost:8100/docs`

## API Contract

### `POST /api/videos`
Upload a video file.

Request:
- `multipart/form-data`
- `file`: video binary

Response:
```json
{
  "job_id": "abc123def456",
  "status": "queued",
  "original_url": "/media/uploads/abc123def456_original.mp4"
}
```

### `POST /api/jobs/{job_id}/process`
Start processing for uploaded video.

Request body:
```json
{
  "detector_provider": "modal",
  "text_prompt": "person. chair.",
  "conf_threshold": 0.25,
  "allow_fallback": true
}
```

Notes:
- For `gsam2`, `text_prompt` is accepted for API compatibility but ignored (auto-discovery mode).
- For `modal` and `local_yolo`, `text_prompt` still acts as an optional label filter.

Response:
- full job object (status/progress snapshot)

### `GET /api/jobs/{job_id}`
Poll job status and artifact URLs.

Completed response shape:
```json
{
  "job_id": "abc123def456",
  "status": "completed",
  "progress": 100,
  "stage": "completed",
  "message": "Processing complete.",
  "original_url": "/media/uploads/abc123def456_original.mp4",
  "annotated_url": "/media/outputs/abc123def456_tracked.mp4",
  "detections_json_url": "/media/outputs/abc123def456_detections.json",
  "requested_provider": "modal",
  "actual_provider": "modal",
  "metadata": {
    "num_frames": 430,
    "objects_detected": ["person", "chair"]
  },
  "error": null
}
```

### `GET /media/{path}`
Static serving for uploads/outputs/jobs under `MEDIA_ROOT`.

## Modal Function Contract (Expected)

`modal_segmentation.py` expects the Modal remote function to accept:

```python
fn.remote(video_bytes: bytes, text_prompt: str, prompt_type: str, conf_threshold: float)
```

And return a dict with at least:
- `video` (bytes) OR `tracked_video` / `output_video`
- optional `detections_json` (str/dict/list)
- optional `num_frames`, `objects_detected`

This mirrors existing repo patterns where segmentation jobs return bytes artifacts and metadata.

## Extension Points in Code

- Better detector backend:
  - `backend/pipeline/providers/modal_segmentation.py`
  - `backend/pipeline/providers/local_yolo.py`
- Future 3D reconstruction handoff:
  - `backend/pipeline/orchestrator.py` after detections JSON output
- Future object query/navigation flow:
  - can consume `outputs/*_detections.json` as the 2D annotation stage output

## Phase 2 (Not in MVP)

- Harden Modal retries / queueing / backoff
- Improve tracking quality (ByteTrack/SORT + class-aware association tuning)
- Improve room-scene recall and class naming quality
- Connect to 3D reconstruction + object localization flow

