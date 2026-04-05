from __future__ import annotations

import asyncio
import json
from concurrent.futures import Future
from typing import Any

import cv2
from ultralytics import YOLO

from pipeline.draw import draw_detections
from pipeline.frame_io import create_writer, open_reader, reencode_for_browser
from pipeline.providers.base import ProviderRequest, StatusCallback
from pipeline.tracking import IoUTracker


def _prompt_terms(text_prompt: str | None) -> set[str]:
    if not text_prompt:
        return set()
    terms = [p.strip().lower() for p in text_prompt.replace(",", ".").split(".")]
    return {t for t in terms if t}


def _send_status(loop: asyncio.AbstractEventLoop, on_status: StatusCallback, stage: str, progress: int, msg: str) -> None:
    future: Future = asyncio.run_coroutine_threadsafe(on_status(stage, progress, msg), loop)
    future.result(timeout=10)


class LocalYoloProvider:
    name = "local_yolo"

    def __init__(self, model_name: str = "yolov8n.pt") -> None:
        self._model_name = model_name

    async def process_video(
        self,
        request: ProviderRequest,
        on_status: StatusCallback,
    ) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        return await asyncio.to_thread(self._process_sync, request, on_status, loop)

    def _process_sync(
        self,
        request: ProviderRequest,
        on_status: StatusCallback,
        loop: asyncio.AbstractEventLoop,
    ) -> dict[str, Any]:
        model = YOLO(self._model_name)
        tracker = IoUTracker(iou_threshold=0.3, max_misses=12)
        terms = _prompt_terms(request.text_prompt)

        cap, fps, width, height, frame_count = open_reader(request.input_video_path)
        writer = create_writer(request.output_video_path, fps, width, height)

        objects_detected: set[str] = set()
        frames_out: list[dict[str, Any]] = []
        idx = 0
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                result = model.predict(frame, conf=request.conf_threshold, verbose=False)[0]
                dets: list[dict[str, Any]] = []

                names = result.names
                if result.boxes is not None and len(result.boxes) > 0:
                    for box in result.boxes:
                        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                        conf = float(box.conf[0].item())
                        cls_idx = int(box.cls[0].item())
                        label = str(names.get(cls_idx, str(cls_idx)))

                        if terms and not any(term in label.lower() for term in terms):
                            continue

                        dets.append(
                            {
                                "bbox": [x1, y1, x2, y2],
                                "confidence": conf,
                                "label": label,
                            }
                        )
                        objects_detected.add(label)

                tracked = tracker.update(dets)
                draw_detections(frame, tracked)
                writer.write(frame)

                frames_out.append(
                    {
                        "frame_idx": idx,
                        "timestamp_sec": (idx / fps) if fps > 0 else 0.0,
                        "detections": tracked,
                    }
                )

                idx += 1
                if idx % 10 == 0 and frame_count > 0:
                    progress = min(90, int((idx / frame_count) * 90))
                    _send_status(loop, on_status, "tracking", progress, f"Processed {idx}/{frame_count} frames")
        finally:
            writer.release()
            cap.release()

        payload = {
            "provider": self.name,
            "num_frames": idx,
            "fps": fps,
            "objects_detected": sorted(objects_detected),
            "frames": frames_out,
        }
        request.detections_json_path.write_text(json.dumps(payload, indent=2))

        reencode_for_browser(request.output_video_path)

        return {
            "provider": self.name,
            "num_frames": idx,
            "objects_detected": sorted(objects_detected),
            "output_video_path": str(request.output_video_path),
            "detections_json_path": str(request.detections_json_path),
        }

