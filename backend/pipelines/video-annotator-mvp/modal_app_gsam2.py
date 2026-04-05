"""
Grounded SAM 2 on Modal — Open-vocabulary object detection and video tracking.

Uses Grounding DINO (HuggingFace) for text-prompted detection + SAM 2.1 for
mask generation and video-wide temporal tracking. Annotates with supervision.

Contract (matches modal_segmentation.py provider):
  track_objects.remote(video_bytes, text_prompt, prompt_type, conf_threshold, skip_output_video=False)
  -> dict with video bytes (empty when skip_output_video), detections_json, num_frames, objects_detected

Deploy:  modal deploy backend/pipelines/video-annotator-mvp/modal_app_gsam2.py
Dev:     modal serve backend/pipelines/video-annotator-mvp/modal_app_gsam2.py
"""

from __future__ import annotations

import os
import pathlib
from typing import Any

import modal

APP_NAME = "video-annotator-gsam2"
FUNCTION_NAME = "track_objects"

app = modal.App(APP_NAME)

cuda_version = "12.4.0"
flavor = "devel"
os_version = "ubuntu22.04"
tag = f"{cuda_version}-{flavor}-{os_version}"

SAM2_CHECKPOINT = "sam2.1_hiera_large.pt"
SAM2_MODEL_CFG = "configs/sam2.1/sam2.1_hiera_l.yaml"
DEFAULT_GDINO_MODEL_ID = "IDEA-Research/grounding-dino-base"
DEFAULT_BOX_THRESHOLD = 0.20
DEFAULT_TEXT_THRESHOLD = 0.20
DEFAULT_KEYFRAME_STRIDE = 30
MAX_KEYFRAMES = 6
MAX_OBJECT_SEEDS = 40
NMS_IOU_THRESHOLD = 0.55
AUTO_DISCOVERY_PROMPT = (
    "person. chair. couch. bed. desk. table. shelf. cabinet. "
    "door. window. lamp. monitor. laptop. keyboard. phone. "
    "bottle. cup. backpack. bag. box. plant. pillow."
)

gsam2_image = (
    modal.Image.from_registry(f"nvidia/cuda:{tag}", add_python="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "numpy<2",
        "Pillow",
        "opencv-python",
        "tqdm",
        "supervision",
        "transformers>=4.40",
        "huggingface_hub",
    )
    .run_commands("pip install sam2")
    .env({
        "HF_HOME": "/opt/hf_cache",
        "TORCH_HOME": "/opt/torch_cache",
        "CUDA_HOME": "/usr/local/cuda",
        "LD_LIBRARY_PATH": "/usr/local/cuda/lib64:/usr/local/nvidia/lib:/usr/local/nvidia/lib64",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    })
    .run_commands(
        "python -c \""
        "from sam2.build_sam import build_sam2; "
        "import torch; "
        "print('SAM 2 package imported OK')\"",
    )
    .run_commands(
        "python -c \""
        "from huggingface_hub import hf_hub_download; "
        "hf_hub_download("
        "  repo_id='facebook/sam2.1-hiera-large',"
        "  filename='sam2.1_hiera_large.pt',"
        "  local_dir='/opt/sam2_checkpoints'"
        ")\"",
    )
    .run_commands(
        "python -c \""
        "from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection; "
        f"AutoProcessor.from_pretrained('{DEFAULT_GDINO_MODEL_ID}'); "
        f"AutoModelForZeroShotObjectDetection.from_pretrained('{DEFAULT_GDINO_MODEL_ID}'); "
        "print('Grounding DINO downloaded OK')\"",
    )
    .run_commands(
        "python -c \""
        "import torch; "
        "from PIL import Image; "
        "from sam2.build_sam import build_sam2; "
        "from sam2.sam2_image_predictor import SAM2ImagePredictor; "
        "model = build_sam2('configs/sam2.1/sam2.1_hiera_l.yaml', '/opt/sam2_checkpoints/sam2.1_hiera_large.pt'); "
        "predictor = SAM2ImagePredictor(model); "
        "print('SAM 2.1 loaded on GPU OK'); "
        "from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection; "
        f"processor = AutoProcessor.from_pretrained('{DEFAULT_GDINO_MODEL_ID}'); "
        f"m = AutoModelForZeroShotObjectDetection.from_pretrained('{DEFAULT_GDINO_MODEL_ID}').to('cuda'); "
        "img = Image.new('RGB', (640, 480), 'white'); "
        "inputs = processor(images=img, text='chair. table.', return_tensors='pt').to('cuda'); "
        "_g = torch.set_grad_enabled(False); _g.__enter__(); m(**inputs); _g.__exit__(None, None, None); "
        "print('Grounding DINO CUDA inference OK')\"",
        gpu="any",
    )
)

with gsam2_image.imports():
    import json
    import os
    import shutil
    import subprocess
    import tempfile


def _gdino_model_id() -> str:
    return os.getenv("GSAM2_GDINO_MODEL_ID", DEFAULT_GDINO_MODEL_ID)


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------

def _extract_frames(video_bytes: bytes, tmpdir: str) -> tuple[str, list[str], float]:
    import cv2

    video_path = os.path.join(tmpdir, "input.mp4")
    with open(video_path, "wb") as f:
        f.write(video_bytes)

    frames_dir = os.path.join(tmpdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        cv2.imwrite(os.path.join(frames_dir, f"{idx:05d}.jpg"), frame)
        idx += 1
    cap.release()

    frame_names = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
    print(f"Extracted {len(frame_names)} frames at {fps:.1f} fps")
    return frames_dir, frame_names, fps


def _sample_keyframes(num_frames: int, keyframe_stride: int) -> list[int]:
    if num_frames <= 0:
        return []
    stride = max(1, keyframe_stride)
    frame_ids = list(range(0, num_frames, stride))
    if (num_frames - 1) not in frame_ids:
        frame_ids.append(num_frames - 1)
    if len(frame_ids) > MAX_KEYFRAMES:
        step = max(1, len(frame_ids) // MAX_KEYFRAMES)
        frame_ids = frame_ids[::step]
        if frame_ids[-1] != (num_frames - 1):
            frame_ids.append(num_frames - 1)
    return sorted(set(frame_ids))


# ---------------------------------------------------------------------------
# Mask encoding
# ---------------------------------------------------------------------------

def _mask_to_rle(mask):
    """Encode binary mask as COCO-style RLE (column-major)."""
    import numpy as np
    flat = mask.flatten(order='F').astype(np.uint8)
    diffs = np.diff(flat, prepend=0, append=0)
    starts = np.where(diffs != 0)[0]
    lengths = np.diff(starts)
    if flat[0] == 0:
        counts = lengths.tolist()
    else:
        counts = [0] + lengths.tolist()
    return {"size": [mask.shape[0], mask.shape[1]], "counts": counts}


# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------

def _iou(box_a: list[float], box_b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return float(inter / max(union, 1e-8))


def _merge_detections(
    detections: list[dict[str, Any]],
    iou_threshold: float = NMS_IOU_THRESHOLD,
) -> list[dict[str, Any]]:
    detections = sorted(detections, key=lambda d: d["score"], reverse=True)
    kept: list[dict[str, Any]] = []
    for det in detections:
        if any(
            det["label"] == ex["label"] and _iou(det["bbox"], ex["bbox"]) >= iou_threshold
            for ex in kept
        ):
            continue
        kept.append(det)
    return kept


# ---------------------------------------------------------------------------
# Grounding DINO detection
# ---------------------------------------------------------------------------

def _gdino_predict(image, text_prompt: str, box_threshold: float, text_threshold: float):
    import torch
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    processor = AutoProcessor.from_pretrained(_gdino_model_id())
    model = AutoModelForZeroShotObjectDetection.from_pretrained(_gdino_model_id()).to("cuda")

    inputs = processor(images=image, text=text_prompt, return_tensors="pt").to("cuda")
    with torch.no_grad():
        outputs = model(**inputs)

    try:
        results = processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids,
            box_threshold=box_threshold,
            text_threshold=text_threshold,
            target_sizes=[image.size[::-1]],
        )
    except TypeError:
        results = processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids,
            threshold=box_threshold,
            text_threshold=text_threshold,
            target_sizes=[image.size[::-1]],
        )
    return results[0]


def _detect_objects_on_frame(
    frames_dir: str,
    frame_names: list[str],
    frame_idx: int,
    text_prompt: str,
    box_threshold: float,
    text_threshold: float,
) -> tuple[list[dict[str, Any]], Any]:
    import numpy as np
    from PIL import Image

    img_path = os.path.join(frames_dir, frame_names[frame_idx])
    image = Image.open(img_path).convert("RGB")
    image_np = np.array(image)

    result = _gdino_predict(image, text_prompt, box_threshold, text_threshold)
    boxes = result["boxes"].cpu().numpy()
    labels = result.get("text_labels") or result.get("labels") or []
    scores = result["scores"].cpu().numpy()

    all_dets: list[dict[str, Any]] = []
    for box, label, score in zip(boxes, labels, scores):
        bbox = [float(box[0]), float(box[1]), float(box[2]), float(box[3])]
        area = max(0.0, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
        if area < 24.0:
            continue
        all_dets.append({"bbox": bbox, "label": str(label), "score": float(score)})

    merged = _merge_detections(all_dets)
    print(f"Frame {frame_idx}: {len(merged)} detections after merge")
    return merged, image_np


# ---------------------------------------------------------------------------
# SAM 2 mask generation (single-frame)
# ---------------------------------------------------------------------------

def _get_sam2_masks(image_np, boxes):
    import numpy as np
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    sam2_model = build_sam2(SAM2_MODEL_CFG, f"/opt/sam2_checkpoints/{SAM2_CHECKPOINT}")
    predictor = SAM2ImagePredictor(sam2_model)
    predictor.set_image(image_np)
    masks, _, _ = predictor.predict(
        point_coords=None, point_labels=None, box=boxes, multimask_output=False,
    )

    if masks.ndim == 3:
        masks = masks[None]
    elif masks.ndim == 4:
        masks = masks.squeeze(1)
    return masks.astype(np.uint8)


# ---------------------------------------------------------------------------
# SAM 2 video tracking
# ---------------------------------------------------------------------------

def _unload_models():
    """Free all cached detection models from GPU before video tracking."""
    import gc
    import torch
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print(f"GPU memory after cleanup: {torch.cuda.memory_allocated() / 1024**3:.1f} GiB allocated")


def _track_video(
    frames_dir: str,
    seed_objects: list[dict[str, Any]],
):
    import torch
    from sam2.build_sam import build_sam2_video_predictor

    autocast_ctx = torch.autocast(device_type="cuda", dtype=torch.bfloat16) if torch.cuda.is_available() else None
    if autocast_ctx is not None:
        autocast_ctx.__enter__()
    if torch.cuda.is_available() and torch.cuda.get_device_properties(0).major >= 8:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    video_predictor = build_sam2_video_predictor(SAM2_MODEL_CFG, f"/opt/sam2_checkpoints/{SAM2_CHECKPOINT}")
    inference_state = video_predictor.init_state(video_path=frames_dir)

    id_to_meta: dict[int, dict] = {}
    for object_id, seed in enumerate(seed_objects, start=1):
        id_to_meta[object_id] = {
            "label": str(seed["label"]),
            "score": float(seed.get("score", 0.0)),
        }
        video_predictor.add_new_mask(
            inference_state=inference_state,
            frame_idx=int(seed["frame_idx"]),
            obj_id=object_id,
            mask=seed["mask"],
        )

    video_segments: dict[int, dict[int, Any]] = {}
    for out_frame_idx, out_obj_ids, out_mask_logits in video_predictor.propagate_in_video(inference_state):
        video_segments[out_frame_idx] = {
            out_obj_id: (out_mask_logits[i] > 0.0).cpu().numpy()
            for i, out_obj_id in enumerate(out_obj_ids)
        }

    print(f"Propagated tracking across {len(video_segments)} frames")

    del video_predictor, inference_state
    if autocast_ctx is not None:
        autocast_ctx.__exit__(None, None, None)
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return video_segments, id_to_meta


# ---------------------------------------------------------------------------
# Annotation & encoding
# ---------------------------------------------------------------------------

def _annotate_and_encode(
    frames_dir: str,
    frame_names: list[str],
    video_segments: dict,
    id_to_meta: dict[int, dict],
    fps: float,
    tmpdir: str,
) -> tuple[bytes, list[dict], int, int]:
    import cv2
    import numpy as np
    import supervision as sv

    annotated_dir = os.path.join(tmpdir, "annotated")
    os.makedirs(annotated_dir, exist_ok=True)

    per_frame_detections: list[dict] = []

    for frame_idx in range(len(frame_names)):
        img = cv2.imread(os.path.join(frames_dir, frame_names[frame_idx]))
        segments = video_segments.get(frame_idx, {})

        if segments:
            object_ids = list(segments.keys())
            masks_arr = np.concatenate(list(segments.values()), axis=0)

            detections = sv.Detections(
                xyxy=sv.mask_to_xyxy(masks_arr),
                mask=masks_arr,
                class_id=np.array(object_ids, dtype=np.int32),
            )

            annotated = sv.BoxAnnotator(thickness=3).annotate(scene=img.copy(), detections=detections)
            annotated = sv.MaskAnnotator().annotate(scene=annotated, detections=detections)

            for i, oid in enumerate(object_ids):
                x1, y1, _, _ = [int(v) for v in detections.xyxy[i].tolist()]
                label = id_to_meta.get(oid, {}).get("label", f"object_{oid}")
                font = cv2.FONT_HERSHEY_SIMPLEX
                (tw, th), _ = cv2.getTextSize(label, font, 1.0, 3)
                lx1, ly1 = max(0, x1), max(0, y1 - th - 14)
                lx2, ly2 = min(annotated.shape[1] - 1, lx1 + tw + 18), max(0, y1)
                cv2.rectangle(annotated, (lx1, ly1), (lx2, ly2), (12, 12, 12), -1)
                cv2.putText(annotated, label, (lx1 + 8, max(th + 2, ly2 - 8)),
                            font, 1.0, (255, 255, 255), 3, cv2.LINE_AA)

            frame_dets = [
                {
                    "track_id": oid,
                    "label": id_to_meta.get(oid, {}).get("label", f"object_{oid}"),
                    "score": id_to_meta.get(oid, {}).get("score", 0.0),
                    "bbox": detections.xyxy[i].tolist(),
                    "mask_rle": _mask_to_rle(segments[oid].squeeze()),
                }
                for i, oid in enumerate(object_ids)
            ]
        else:
            annotated = img
            frame_dets = []

        per_frame_detections.append({
            "frame_idx": frame_idx,
            "timestamp_sec": frame_idx / fps if fps > 0 else 0.0,
            "detections": frame_dets,
        })
        cv2.imwrite(os.path.join(annotated_dir, f"{frame_idx:05d}.jpg"), annotated)

    first_frame = cv2.imread(os.path.join(frames_dir, frame_names[0]))
    frame_h, frame_w = first_frame.shape[:2]

    h, w = cv2.imread(os.path.join(annotated_dir, "00000.jpg")).shape[:2]
    raw_path = os.path.join(tmpdir, "tracked_raw.mp4")
    writer = cv2.VideoWriter(raw_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    for fname in sorted(os.listdir(annotated_dir)):
        if fname.endswith(".jpg"):
            writer.write(cv2.imread(os.path.join(annotated_dir, fname)))
    writer.release()

    final_path = os.path.join(tmpdir, "tracked.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path,
         "-c:v", "libx264", "-preset", "fast", "-crf", "23",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         "-an", final_path],
        capture_output=True, timeout=600,
    )
    if not os.path.exists(final_path) or os.path.getsize(final_path) == 0:
        final_path = raw_path

    with open(final_path, "rb") as f:
        video_out = f.read()

    print(f"Output video: {len(video_out) / 1024 / 1024:.1f} MB")
    return video_out, per_frame_detections, frame_w, frame_h


def _detections_only_from_segments(
    frames_dir: str,
    frame_names: list[str],
    video_segments: dict,
    id_to_meta: dict[int, dict],
    fps: float,
) -> tuple[list[dict], int, int]:
    """Same per-frame JSON as _annotate_and_encode without drawing frames or encoding MP4."""
    import cv2
    import numpy as np
    import supervision as sv

    first_frame = cv2.imread(os.path.join(frames_dir, frame_names[0]))
    frame_h, frame_w = first_frame.shape[:2]

    per_frame_detections: list[dict] = []

    for frame_idx in range(len(frame_names)):
        segments = video_segments.get(frame_idx, {})

        if segments:
            object_ids = list(segments.keys())
            masks_arr = np.concatenate(list(segments.values()), axis=0)

            detections = sv.Detections(
                xyxy=sv.mask_to_xyxy(masks_arr),
                mask=masks_arr,
                class_id=np.array(object_ids, dtype=np.int32),
            )

            frame_dets = [
                {
                    "track_id": oid,
                    "label": id_to_meta.get(oid, {}).get("label", f"object_{oid}"),
                    "score": id_to_meta.get(oid, {}).get("score", 0.0),
                    "bbox": detections.xyxy[i].tolist(),
                    "mask_rle": _mask_to_rle(segments[oid].squeeze()),
                }
                for i, oid in enumerate(object_ids)
            ]
        else:
            frame_dets = []

        per_frame_detections.append({
            "frame_idx": frame_idx,
            "timestamp_sec": frame_idx / fps if fps > 0 else 0.0,
            "detections": frame_dets,
        })

    print("Skip demo video: built detections JSON only (no annotated MP4)")
    return per_frame_detections, frame_w, frame_h


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

@app.function(
    image=gsam2_image,
    gpu="A100",
    timeout=60 * 45,
    memory=32768,
)
def track_objects(
    video_bytes: bytes,
    text_prompt: str,
    prompt_type: str = "mask",
    conf_threshold: float = DEFAULT_BOX_THRESHOLD,
    skip_output_video: bool = False,
) -> dict[str, Any]:
    import time
    import numpy as np
    import torch

    auto_prompt = AUTO_DISCOVERY_PROMPT
    box_threshold = conf_threshold if conf_threshold > 0 else DEFAULT_BOX_THRESHOLD
    text_threshold = float(os.getenv("GSAM2_TEXT_THRESHOLD", str(DEFAULT_TEXT_THRESHOLD)))
    keyframe_stride = int(os.getenv("GSAM2_KEYFRAME_STRIDE", str(DEFAULT_KEYFRAME_STRIDE)))
    stage_times: dict[str, float] = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        # --- Stage 1: extract frames ---
        t0 = time.perf_counter()
        frames_dir, frame_names, fps = _extract_frames(video_bytes, tmpdir)
        stage_times["extract_frames_sec"] = round(time.perf_counter() - t0, 3)
        if not frame_names:
            raise ValueError("No frames extracted from video")

        # --- Stage 2: detect objects on keyframes & generate masks ---
        t1 = time.perf_counter()
        keyframes = _sample_keyframes(len(frame_names), keyframe_stride)
        seed_objects: list[dict[str, Any]] = []

        for frame_idx in keyframes:
            merged_dets, image_np = _detect_objects_on_frame(
                frames_dir, frame_names, frame_idx,
                auto_prompt, box_threshold, text_threshold,
            )
            if not merged_dets:
                continue

            per_frame_cap = max(1, MAX_OBJECT_SEEDS // max(1, len(keyframes)))
            selected = merged_dets[:per_frame_cap]
            boxes = np.array([d["bbox"] for d in selected], dtype=np.float32)
            masks = _get_sam2_masks(image_np, boxes)
            for det, mask in zip(selected, masks):
                seed_objects.append({
                    "frame_idx": frame_idx,
                    "bbox": det["bbox"],
                    "label": det["label"],
                    "score": det["score"],
                    "mask": mask,
                })
            if len(seed_objects) >= MAX_OBJECT_SEEDS:
                break

        stage_times["discover_seed_objects_sec"] = round(time.perf_counter() - t1, 3)

        if not seed_objects:
            raise ValueError(
                "Grounding DINO found no objects. Try a lower conf_threshold or better scene lighting."
            )

        # De-duplicate seeds across keyframes
        merged_seeds: list[dict[str, Any]] = []
        for seed in sorted(seed_objects, key=lambda s: s["score"], reverse=True):
            if any(
                seed["label"] == ex["label"] and _iou(seed["bbox"], ex["bbox"]) >= 0.65
                for ex in merged_seeds
            ):
                continue
            merged_seeds.append(seed)
            if len(merged_seeds) >= MAX_OBJECT_SEEDS:
                break

        print(f"Seed objects: {len(seed_objects)} candidates -> {len(merged_seeds)} after dedup")

        # --- Free detection models before heavy video tracking ---
        _unload_models()

        # --- Stage 3: propagate tracking ---
        t2 = time.perf_counter()
        video_segments, id_to_meta = _track_video(frames_dir, merged_seeds)
        stage_times["track_video_sec"] = round(time.perf_counter() - t2, 3)

        # --- Stage 4: annotate & encode (or JSON-only) ---
        t3 = time.perf_counter()
        if skip_output_video:
            per_frame_detections, frame_w, frame_h = _detections_only_from_segments(
                frames_dir, frame_names, video_segments, id_to_meta, fps,
            )
            video_out = b""
        else:
            video_out, per_frame_detections, frame_w, frame_h = _annotate_and_encode(
                frames_dir, frame_names, video_segments, id_to_meta, fps, tmpdir,
            )
        stage_times["annotate_encode_sec"] = round(time.perf_counter() - t3, 3)

    objects_detected = sorted({s["label"] for s in merged_seeds})

    payload = {
        "provider": "gsam2",
        "num_frames": len(frame_names),
        "fps": fps,
        "frame_width": frame_w,
        "frame_height": frame_h,
        "discovery": {
            "mode": "auto_promptless",
            "gdino_model_id": _gdino_model_id(),
            "box_threshold": box_threshold,
            "text_threshold": text_threshold,
            "keyframe_stride": keyframe_stride,
            "keyframes_used": keyframes,
            "seed_objects_used": len(merged_seeds),
        },
        "timings_sec": stage_times,
        "objects_detected": objects_detected,
        "frames": per_frame_detections,
    }

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return {
        "video": video_out,
        "detections_json": json.dumps(payload, indent=2),
        "num_frames": len(frame_names),
        "objects_detected": objects_detected,
    }


@app.local_entrypoint()
def main(
    video_path: str,
    text_prompt: str = "",
    prompt_type: str = "mask",
    box_threshold: float = DEFAULT_BOX_THRESHOLD,
    outdir: str = "",
    skip_output_video: bool = False,
):
    video_p = pathlib.Path(video_path).expanduser().resolve()
    if not video_p.exists():
        print(f"File not found: {video_p}")
        return

    out_dir = pathlib.Path(outdir or ".").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Video: {video_p.name} ({video_p.stat().st_size / 1024 / 1024:.1f} MB)")
    print("Prompt input is ignored; GSAM2 runs in auto-discovery mode")

    result = track_objects.remote(
        video_p.read_bytes(), text_prompt, prompt_type, box_threshold, skip_output_video,
    )

    stem = video_p.stem
    out_video = out_dir / f"{stem}_tracked.mp4"
    vbytes = result.get("video") or b""
    if len(vbytes) > 0:
        out_video.write_bytes(vbytes)
    elif out_video.exists():
        out_video.unlink()

    out_json = out_dir / f"{stem}_detections.json"
    out_json.write_text(result["detections_json"])

    video_note = f"{len(vbytes) / 1024 / 1024:.1f} MB" if len(vbytes) else "skipped"
    print(
        f"\n{video_p.name} -> {out_video.name if len(vbytes) else '(no video)'} "
        f"({video_note}, "
        f"{result['num_frames']} frames, "
        f"objects: {result['objects_detected']})"
    )
