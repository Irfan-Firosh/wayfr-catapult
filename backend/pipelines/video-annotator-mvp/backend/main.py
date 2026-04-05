from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import Settings
from pipeline.orchestrator import PipelineOrchestrator
from schemas import JobResponse, ProcessRequest, UploadResponse


settings = Settings()
settings.ensure_dirs()
orchestrator = PipelineOrchestrator(settings)

app = FastAPI(title="Video Annotator MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=str(settings.media_root)), name="media")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_path(job_id: str) -> Path:
    return settings.media_root / "jobs" / f"{job_id}.json"


def _to_media_url(rel: str | None) -> str | None:
    return f"/media/{rel}" if rel else None


def _read_job(job_id: str) -> dict[str, Any]:
    path = _job_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    return json.loads(path.read_text())


def _write_job(job_id: str, data: dict[str, Any]) -> None:
    data["updated_at"] = _now_iso()
    _job_path(job_id).write_text(json.dumps(data, indent=2))


def _create_job_record(job_id: str, upload_rel: str) -> dict[str, Any]:
    job = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "stage": "upload",
        "message": "Video uploaded. Ready to process.",
        "requested_provider": None,
        "actual_provider": None,
        "input_video_rel": upload_rel,
        "output_video_rel": None,
        "detections_json_rel": None,
        "metadata": {},
        "error": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    _write_job(job_id, job)
    return job


def _job_response(job: dict[str, Any]) -> JobResponse:
    return JobResponse(
        job_id=job["job_id"],
        status=job["status"],
        progress=int(job.get("progress", 0)),
        stage=job.get("stage", ""),
        message=job.get("message", ""),
        original_url=_to_media_url(job.get("input_video_rel")),
        annotated_url=_to_media_url(job.get("output_video_rel")),
        detections_json_url=_to_media_url(job.get("detections_json_rel")),
        requested_provider=job.get("requested_provider"),
        actual_provider=job.get("actual_provider"),
        metadata=job.get("metadata", {}),
        error=job.get("error"),
    )


async def _process_job_task(job_id: str, req: ProcessRequest) -> None:
    job = _read_job(job_id)
    input_rel = job["input_video_rel"]
    input_path = settings.media_root / input_rel
    output_rel = f"outputs/{job_id}_tracked.mp4"
    detections_rel = f"outputs/{job_id}_detections.json"
    output_path = settings.media_root / output_rel
    detections_path = settings.media_root / detections_rel

    async def update(stage: str, progress: int, message: str) -> None:
        current = _read_job(job_id)
        current["stage"] = stage
        current["progress"] = max(0, min(100, int(progress)))
        current["message"] = message
        _write_job(job_id, current)

    try:
        current = _read_job(job_id)
        current["status"] = "processing"
        current["requested_provider"] = req.detector_provider or settings.detector_provider
        current["stage"] = "pipeline"
        current["progress"] = 5
        current["message"] = "Starting processing pipeline..."
        _write_job(job_id, current)

        result = await orchestrator.run(
            input_video_path=input_path,
            output_video_path=output_path,
            detections_json_path=detections_path,
            text_prompt=req.text_prompt,
            conf_threshold=req.conf_threshold,
            preferred_provider=req.detector_provider,
            allow_fallback=req.allow_fallback,
            skip_output_video=req.skip_output_video,
            on_status=update,
        )

        done = _read_job(job_id)
        done["status"] = "completed"
        done["progress"] = 100
        done["stage"] = "completed"
        done["message"] = "Processing complete."
        done["actual_provider"] = result.get("actual_provider")
        done["output_video_rel"] = None if req.skip_output_video else output_rel
        done["detections_json_rel"] = detections_rel
        done["metadata"] = {
            "num_frames": result.get("num_frames", 0),
            "objects_detected": result.get("objects_detected", []),
            "skip_output_video": req.skip_output_video,
        }
        _write_job(job_id, done)
    except Exception as exc:
        failed = _read_job(job_id)
        failed["status"] = "failed"
        failed["stage"] = "failed"
        failed["progress"] = 100
        failed["message"] = "Processing failed."
        failed["error"] = str(exc)
        _write_job(job_id, failed)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/videos", response_model=UploadResponse)
async def upload_video(file: UploadFile = File(...)) -> UploadResponse:
    size_limit = settings.max_upload_mb * 1024 * 1024
    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
    job_id = uuid.uuid4().hex[:12]
    upload_rel = f"uploads/{job_id}_original{suffix}"
    upload_path = settings.media_root / upload_rel
    upload_path.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    with upload_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > size_limit:
                out.close()
                upload_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb}MB limit")
            out.write(chunk)

    _create_job_record(job_id, upload_rel)
    return UploadResponse(job_id=job_id, status="queued", original_url=_to_media_url(upload_rel) or "")


@app.post("/api/jobs/{job_id}/process", response_model=JobResponse)
async def start_processing(job_id: str, req: ProcessRequest, background_tasks: BackgroundTasks) -> JobResponse:
    job = _read_job(job_id)
    if job["status"] == "processing":
        return _job_response(job)
    if job["status"] == "completed":
        return _job_response(job)

    background_tasks.add_task(_process_job_task, job_id, req)

    job["status"] = "processing"
    job["stage"] = "queued_processing"
    job["progress"] = 2
    job["message"] = "Job accepted. Processing will start shortly."
    job["requested_provider"] = req.detector_provider or settings.detector_provider
    _write_job(job_id, job)
    return _job_response(job)


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    return _job_response(_read_job(job_id))

