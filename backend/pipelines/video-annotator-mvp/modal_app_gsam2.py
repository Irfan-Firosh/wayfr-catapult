"""
Grounded SAM 2 on Modal — Open-vocabulary object detection and video tracking.

Uses Grounding DINO (HuggingFace) for text-prompted detection + SAM 2.1 for
mask generation and video-wide temporal tracking. Annotates with supervision.

Contract (matches modal_segmentation.py provider):
  track_objects.remote(video_bytes, text_prompt, prompt_type, conf_threshold, skip_output_video=False)
  -> dict with video bytes (empty when skip_output_video), detections_json, num_frames, objects_detected

Deploy:  modal deploy video-annotator-mvp/modal_app_gsam2.py
Dev:     modal serve video-annotator-mvp/modal_app_gsam2.py
"""

from __future__ import annotations

import os
import pathlib
from dataclasses import dataclass, field
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
DEFAULT_TARGET_FPS = 6
DEFAULT_KEYFRAME_STRIDE = 30
MAX_KEYFRAMES = 6
MAX_OBJECT_SEEDS = 40
NMS_IOU_THRESHOLD = 0.55
AUTO_DISCOVERY_PROMPT = (
    "person. chair. couch. bed. desk. table. shelf. cabinet. "
    "door. window. lamp. monitor. laptop. keyboard. phone. "
    "bottle. cup. backpack. bag. box. plant. pillow."
)

LABEL_SYNONYMS: dict[str, str] = {
    "sofa": "couch",
    "display": "monitor",
    "screen": "monitor",
    "computer_monitor": "monitor",
    "notebook": "laptop",
    "notebook_computer": "laptop",
    "cell_phone": "phone",
    "mobile_phone": "phone",
    "smartphone": "phone",
    "garbage_can": "trash_can",
    "trash_bin": "trash_can",
    "waste_bin": "trash_can",
    "bin": "trash_can",
    "back_pack": "backpack",
    "rucksack": "backpack",
    "handbag": "bag",
    "purse": "bag",
    "plant_pot": "plant",
    "flower_pot": "plant",
    "cupboard": "cabinet",
    "bookshelf": "shelf",
    "bookcase": "shelf",
    "water_bottle": "bottle",
    "coffee_mug": "cup",
    "mug": "cup",
    "pillowcase": "pillow",
}

CANONICAL_LABELS: set[str] = {
    "person", "chair", "couch", "bed", "desk", "table", "shelf", "cabinet",
    "door", "window", "lamp", "monitor", "laptop", "keyboard", "phone",
    "bottle", "cup", "backpack", "bag", "box", "plant", "pillow", "trash_can",
}

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


_GDINO_CACHE: dict[str, Any] = {}
_SAM2_IMAGE_CACHE: dict[str, Any] = {}


@dataclass
class TrackState:
    track_id: int
    birth_frame: int
    canonical_label: str = "unknown_object"
    label_confidence: float = 0.0
    label_protected: bool = False
    raw_labels: list[str] = field(default_factory=list)
    raw_scores: list[float] = field(default_factory=list)
    frames_seen: list[int] = field(default_factory=list)
    best_frames: list[int] = field(default_factory=list)
    mask_quality_history: dict[int, float] = field(default_factory=dict)
    total_frames_seen_count: int = 0
    valid_frames_seen_count: int = 0
    avg_bbox_area_ratio: float = 0.0
    avg_mask_area_ratio: float = 0.0
    avg_box_to_mask_ratio: float = 0.0

    @property
    def valid_bbox_ratio(self) -> float:
        return float(self.valid_frames_seen_count / max(self.total_frames_seen_count, 1))

    @property
    def evidence_strength(self) -> float:
        avg_score = sum(self.raw_scores) / max(len(self.raw_scores), 1)
        return min(1.0, avg_score * min(1.0, self.valid_frames_seen_count / 8.0))


def _gdino_model_id() -> str:
    return os.getenv("GSAM2_GDINO_MODEL_ID", DEFAULT_GDINO_MODEL_ID)


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _normalize_label(raw: str) -> str:
    cleaned = raw.strip().strip(".").strip().lower().replace("-", " ").replace("/", " ")
    cleaned = "_".join(part for part in cleaned.split() if part)
    if cleaned.endswith("s") and cleaned[:-1] in CANONICAL_LABELS:
        cleaned = cleaned[:-1]
    return LABEL_SYNONYMS.get(cleaned, cleaned)


def _canonical_vote_label(raw: str) -> str:
    normalized = _normalize_label(raw)
    if normalized in CANONICAL_LABELS:
        return normalized
    return "unknown_object"


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------

def _extract_frames(
    video_bytes: bytes,
    tmpdir: str,
    target_fps: int,
) -> tuple[str, list[str], float, list[int]]:
    import cv2

    video_path = os.path.join(tmpdir, "input.mp4")
    with open(video_path, "wb") as f:
        f.write(video_bytes)

    frames_dir = os.path.join(tmpdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    frame_interval = max(1, int(round(fps / max(1, target_fps))))
    idx = 0
    raw_idx = 0
    source_indices: list[int] = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if raw_idx % frame_interval == 0:
            cv2.imwrite(os.path.join(frames_dir, f"{idx:05d}.jpg"), frame)
            source_indices.append(raw_idx)
            idx += 1
        raw_idx += 1
    cap.release()

    frame_names = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
    print(
        f"Extracted {len(frame_names)} frames from {raw_idx} total "
        f"at {fps:.1f} fps (target_fps={target_fps}, interval={frame_interval})"
    )
    return frames_dir, frame_names, fps, source_indices


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

    flat = mask.flatten(order="F").astype(np.uint8)
    counts: list[int] = []
    current_value = 0
    run_length = 0
    for value in flat.tolist():
        if value == current_value:
            run_length += 1
            continue
        counts.append(run_length)
        current_value = value
        run_length = 1
    counts.append(run_length)
    return {"size": [int(mask.shape[0]), int(mask.shape[1])], "counts": counts}


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


def _mask_iou(mask_a, mask_b) -> float:
    import numpy as np

    a = np.asarray(mask_a).astype(bool).squeeze()
    b = np.asarray(mask_b).astype(bool).squeeze()
    if a.shape != b.shape:
        return 0.0
    inter = int((a & b).sum())
    union = int((a | b).sum())
    if union <= 0:
        return 0.0
    return float(inter / union)


def _mask_centroid(mask) -> tuple[float, float]:
    import numpy as np

    mask_bool = np.asarray(mask).astype(bool).squeeze()
    coords = np.argwhere(mask_bool)
    if len(coords) == 0:
        return (0.0, 0.0)
    cy = float(coords[:, 0].mean())
    cx = float(coords[:, 1].mean())
    return (cx, cy)


def _clean_mask_for_bbox(mask):
    import cv2
    import numpy as np

    mask_bool = np.asarray(mask).astype(bool).squeeze()
    if mask_bool.ndim != 2:
        return mask_bool.astype(bool)

    mask_u8 = (mask_bool.astype(np.uint8) * 255)
    area = int(mask_bool.sum())
    if area <= 0:
        return mask_bool.astype(bool)

    if area < 256:
        kernel = np.ones((3, 3), dtype=np.uint8)
        cleaned = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, kernel, iterations=1)
        if int((cleaned > 0).sum()) > 0:
            return cleaned > 0
    return mask_bool.astype(bool)


def _bbox_from_mask(mask) -> list[float]:
    import numpy as np

    mask_bool = _clean_mask_for_bbox(mask)
    coords = np.argwhere(mask_bool)
    if len(coords) == 0:
        return [0.0, 0.0, 0.0, 0.0]
    y_min = float(coords[:, 0].min())
    y_max = float(coords[:, 0].max() + 1)
    x_min = float(coords[:, 1].min())
    x_max = float(coords[:, 1].max() + 1)
    return [x_min, y_min, x_max, y_max]


def _smooth_bbox(prev_bbox: list[float] | None, curr_bbox: list[float]) -> list[float]:
    if prev_bbox is None:
        return [float(v) for v in curr_bbox]

    prev_w = max(float(prev_bbox[2] - prev_bbox[0]), 1.0)
    prev_h = max(float(prev_bbox[3] - prev_bbox[1]), 1.0)
    curr_w = max(float(curr_bbox[2] - curr_bbox[0]), 1.0)
    curr_h = max(float(curr_bbox[3] - curr_bbox[1]), 1.0)

    prev_cx = (float(prev_bbox[0]) + float(prev_bbox[2])) * 0.5
    prev_cy = (float(prev_bbox[1]) + float(prev_bbox[3])) * 0.5
    curr_cx = (float(curr_bbox[0]) + float(curr_bbox[2])) * 0.5
    curr_cy = (float(curr_bbox[1]) + float(curr_bbox[3])) * 0.5

    alpha_center = 0.6
    alpha_size = 0.4
    smoothed_cx = alpha_center * curr_cx + (1.0 - alpha_center) * prev_cx
    smoothed_cy = alpha_center * curr_cy + (1.0 - alpha_center) * prev_cy
    smoothed_w = alpha_size * curr_w + (1.0 - alpha_size) * prev_w
    smoothed_h = alpha_size * curr_h + (1.0 - alpha_size) * prev_h

    # Cap sudden growth so a noisy frame does not balloon the box.
    smoothed_w = min(smoothed_w, max(prev_w * 1.2, curr_w))
    smoothed_h = min(smoothed_h, max(prev_h * 1.2, curr_h))

    x1 = smoothed_cx - smoothed_w * 0.5
    y1 = smoothed_cy - smoothed_h * 0.5
    x2 = smoothed_cx + smoothed_w * 0.5
    y2 = smoothed_cy + smoothed_h * 0.5
    return [float(x1), float(y1), float(x2), float(y2)]


def _box_quality_metrics(mask, bbox: list[float]) -> dict[str, float]:
    import numpy as np

    mask_bool = np.asarray(mask).astype(bool).squeeze()
    if mask_bool.ndim != 2:
        return {
            "bbox_area_ratio": 0.0,
            "mask_area_ratio": 0.0,
            "box_to_mask_ratio": 0.0,
        }

    frame_area = float(mask_bool.shape[0] * mask_bool.shape[1])
    mask_area = float(mask_bool.sum())
    bbox_area = max(0.0, float(bbox[2] - bbox[0])) * max(0.0, float(bbox[3] - bbox[1]))
    return {
        "bbox_area_ratio": float(bbox_area / max(frame_area, 1.0)),
        "mask_area_ratio": float(mask_area / max(frame_area, 1.0)),
        "box_to_mask_ratio": float(bbox_area / max(mask_area, 1.0)),
    }


# ---------------------------------------------------------------------------
# Grounding DINO detection
# ---------------------------------------------------------------------------

def _get_gdino():
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    if "processor" not in _GDINO_CACHE:
        _GDINO_CACHE["processor"] = AutoProcessor.from_pretrained(_gdino_model_id())
        _GDINO_CACHE["model"] = (
            AutoModelForZeroShotObjectDetection.from_pretrained(_gdino_model_id())
            .to("cuda")
            .eval()
        )
    return _GDINO_CACHE["processor"], _GDINO_CACHE["model"]


def _gdino_predict(image, text_prompt: str, box_threshold: float, text_threshold: float):
    import torch

    processor, model = _get_gdino()

    inputs = processor(images=image, text=text_prompt, return_tensors="pt").to("cuda")
    with torch.inference_mode():
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

def _get_sam2_image_predictor():
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    if "predictor" not in _SAM2_IMAGE_CACHE:
        sam2_model = build_sam2(
            SAM2_MODEL_CFG,
            f"/opt/sam2_checkpoints/{SAM2_CHECKPOINT}",
        )
        _SAM2_IMAGE_CACHE["predictor"] = SAM2ImagePredictor(sam2_model)
    return _SAM2_IMAGE_CACHE["predictor"]


def _get_sam2_masks(image_np, boxes):
    import numpy as np

    predictor = _get_sam2_image_predictor()
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

    _GDINO_CACHE.clear()
    _SAM2_IMAGE_CACHE.clear()
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
            "raw_labels": [str(seed["label"])],
            "raw_scores": [float(seed.get("score", 0.0))],
            "source": str(seed.get("source", "prompted")),
            "birth_frame": int(seed["frame_idx"]),
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


def _build_track_states(
    video_segments: dict[int, dict[int, Any]],
    id_to_meta: dict[int, dict],
    protect_prompt_labels: bool = True,
) -> dict[int, TrackState]:
    import numpy as np

    states: dict[int, TrackState] = {}
    for track_id, meta in id_to_meta.items():
        raw_labels = list(meta.get("raw_labels") or [meta.get("label", "unknown_object")])
        raw_scores = [float(v) for v in (meta.get("raw_scores") or [meta.get("score", 0.0)])]
        source = str(meta.get("source", "prompted"))
        primary_label = raw_labels[0] if raw_labels else meta.get("label", "")
        primary_canonical = _canonical_vote_label(primary_label)
        states[track_id] = TrackState(
            track_id=int(track_id),
            birth_frame=int(meta.get("birth_frame", 0)),
            raw_labels=raw_labels,
            raw_scores=raw_scores,
            label_protected=(
                protect_prompt_labels
                and source in {"prompted", "user_prompt", "prompt"}
                and primary_canonical != "unknown_object"
            ),
        )

    for frame_idx, segments in sorted(video_segments.items()):
        for track_id, mask in segments.items():
            state = states.get(track_id)
            if state is None:
                continue
            state.total_frames_seen_count += 1
            mask_bool = np.asarray(mask).astype(bool).squeeze()
            if mask_bool.ndim != 2:
                continue
            mask_area = int(mask_bool.sum())
            if mask_area <= 0:
                continue
            ys, xs = np.where(mask_bool)
            bbox_area = (int(xs.max()) - int(xs.min()) + 1) * (int(ys.max()) - int(ys.min()) + 1)
            frame_area = mask_bool.shape[0] * mask_bool.shape[1]
            state.valid_frames_seen_count += 1
            state.frames_seen.append(int(frame_idx))
            state.mask_quality_history[int(frame_idx)] = float(mask_area / max(bbox_area, 1))
            state.avg_bbox_area_ratio += float(bbox_area / max(frame_area, 1))
            state.avg_mask_area_ratio += float(mask_area / max(frame_area, 1))
            state.avg_box_to_mask_ratio += float(bbox_area / max(mask_area, 1))

    for state in states.values():
        if state.valid_frames_seen_count > 0:
            denom = float(state.valid_frames_seen_count)
            state.avg_bbox_area_ratio /= denom
            state.avg_mask_area_ratio /= denom
            state.avg_box_to_mask_ratio /= denom
        if state.mask_quality_history:
            state.best_frames = [
                frame_idx
                for frame_idx, _ in sorted(
                    state.mask_quality_history.items(),
                    key=lambda item: item[1],
                    reverse=True,
                )[:5]
            ]

    return states


def _compute_track_labels(track_states: dict[int, TrackState]) -> None:
    from collections import defaultdict

    for state in track_states.values():
        weighted_votes: dict[str, float] = defaultdict(float)
        for raw_label, raw_score in zip(state.raw_labels, state.raw_scores):
            canonical = _canonical_vote_label(raw_label)
            if canonical == "unknown_object":
                continue
            weighted_votes[canonical] += max(float(raw_score), 0.05)

        if weighted_votes:
            label, vote = max(weighted_votes.items(), key=lambda item: (item[1], item[0]))
            total_vote = sum(weighted_votes.values())
            state.canonical_label = label
            state.label_confidence = round(float(vote / max(total_vote, 1e-6)), 3)
            continue

        fallback = _canonical_vote_label(state.raw_labels[0]) if state.raw_labels else "unknown_object"
        state.canonical_label = fallback
        state.label_confidence = round(
            float(sum(state.raw_scores) / max(len(state.raw_scores), 1)),
            3,
        )


def _merge_track_meta(keep_meta: dict[str, Any], drop_meta: dict[str, Any]) -> None:
    keep_meta.setdefault("raw_labels", [keep_meta.get("label", "unknown_object")])
    keep_meta.setdefault("raw_scores", [float(keep_meta.get("score", 0.0))])
    keep_meta["raw_labels"].extend(list(drop_meta.get("raw_labels") or [drop_meta.get("label", "unknown_object")]))
    keep_meta["raw_scores"].extend(
        [float(v) for v in (drop_meta.get("raw_scores") or [drop_meta.get("score", 0.0)])]
    )
    keep_meta["score"] = max(float(keep_meta.get("score", 0.0)), float(drop_meta.get("score", 0.0)))
    keep_meta["birth_frame"] = min(int(keep_meta.get("birth_frame", 0)), int(drop_meta.get("birth_frame", 0)))


def _suppress_duplicate_tracks(
    track_states: dict[int, TrackState],
    video_segments: dict[int, dict[int, Any]],
    id_to_meta: dict[int, dict[str, Any]],
) -> tuple[dict[int, dict[int, Any]], dict[int, dict[str, Any]]]:
    merge_map: dict[int, int] = {}
    track_ids = sorted(track_states)

    for idx, track_a in enumerate(track_ids):
        if track_a in merge_map:
            continue
        for track_b in track_ids[idx + 1:]:
            if track_b in merge_map:
                continue
            shared_frames = [
                frame_idx
                for frame_idx, segments in video_segments.items()
                if track_a in segments and track_b in segments
            ]
            if len(shared_frames) < 3:
                continue

            sample_frames = shared_frames[:: max(1, len(shared_frames) // 12)]
            overlaps = [
                _mask_iou(video_segments[frame_idx][track_a], video_segments[frame_idx][track_b])
                for frame_idx in sample_frames
            ]
            centroid_dists = []
            for frame_idx in sample_frames:
                centroid_a = _mask_centroid(video_segments[frame_idx][track_a])
                centroid_b = _mask_centroid(video_segments[frame_idx][track_b])
                dx = centroid_a[0] - centroid_b[0]
                dy = centroid_a[1] - centroid_b[1]
                centroid_dists.append((dx * dx + dy * dy) ** 0.5)
            avg_overlap = sum(overlaps) / max(len(overlaps), 1)
            avg_centroid_dist = sum(centroid_dists) / max(len(centroid_dists), 1)

            label_a = track_states[track_a].canonical_label
            label_b = track_states[track_b].canonical_label
            labels_compatible = (
                label_a == label_b
                or "unknown_object" in {label_a, label_b}
            )
            weak_track_present = (
                track_states[track_a].label_confidence < 0.45
                or track_states[track_b].label_confidence < 0.45
                or track_states[track_a].avg_box_to_mask_ratio > 8.0
                or track_states[track_b].avg_box_to_mask_ratio > 8.0
            )

            should_merge = False
            if labels_compatible and avg_overlap >= 0.72:
                should_merge = True
            elif labels_compatible and avg_overlap >= 0.55 and avg_centroid_dist <= 18.0:
                should_merge = True
            elif weak_track_present and avg_overlap >= 0.82 and avg_centroid_dist <= 14.0:
                should_merge = True

            if not should_merge:
                continue

            keep_id = track_a
            drop_id = track_b
            if track_states[track_b].evidence_strength > track_states[track_a].evidence_strength:
                keep_id, drop_id = track_b, track_a
            merge_map[drop_id] = keep_id

    if not merge_map:
        return video_segments, id_to_meta

    print(f"Merging {len(merge_map)} duplicate tracks")
    for frame_idx, segments in list(video_segments.items()):
        merged_segments: dict[int, Any] = {}
        for track_id, mask in segments.items():
            target_id = merge_map.get(track_id, track_id)
            if target_id in merged_segments:
                merged_segments[target_id] = merged_segments[target_id] | mask
            else:
                merged_segments[target_id] = mask
        video_segments[frame_idx] = merged_segments

    for drop_id, keep_id in merge_map.items():
        if keep_id in id_to_meta and drop_id in id_to_meta:
            _merge_track_meta(id_to_meta[keep_id], id_to_meta[drop_id])
        id_to_meta.pop(drop_id, None)

    return video_segments, id_to_meta


def _build_track_summaries(track_states: dict[int, TrackState]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for state in track_states.values():
        summaries.append({
            "track_id": state.track_id,
            "canonical_label": state.canonical_label,
            "label_confidence": round(state.label_confidence, 3),
            "raw_labels": sorted(set(state.raw_labels)),
            "birth_frame": state.birth_frame,
            "last_frame": state.frames_seen[-1] if state.frames_seen else state.birth_frame,
            "frames_seen_count": len(state.frames_seen),
            "total_frames_seen_count": state.total_frames_seen_count,
            "valid_frames_seen_count": state.valid_frames_seen_count,
            "valid_bbox_ratio": round(state.valid_bbox_ratio, 3),
            "avg_bbox_area_ratio": round(state.avg_bbox_area_ratio, 5),
            "avg_mask_area_ratio": round(state.avg_mask_area_ratio, 5),
            "avg_box_to_mask_ratio": round(state.avg_box_to_mask_ratio, 3),
            "best_frames": state.best_frames,
            "mask_quality_avg": round(
                sum(state.mask_quality_history.values()) / max(len(state.mask_quality_history), 1),
                3,
            ),
            "label_protected": state.label_protected,
            "evidence_strength": round(state.evidence_strength, 3),
            "bridge_eligible": (
                state.canonical_label != "unknown_object"
                and state.valid_frames_seen_count >= 1
                and state.avg_box_to_mask_ratio <= 10.0
                and (
                    sum(state.mask_quality_history.values()) / max(len(state.mask_quality_history), 1)
                ) >= 0.12
            ),
        })
    summaries.sort(key=lambda item: item["evidence_strength"], reverse=True)
    return summaries


# ---------------------------------------------------------------------------
# Annotation & encoding
# ---------------------------------------------------------------------------

def _annotate_and_encode(
    frames_dir: str,
    frame_names: list[str],
    source_indices: list[int],
    video_segments: dict,
    track_states: dict[int, TrackState],
    source_fps: float,
    output_fps: float,
    tmpdir: str,
) -> tuple[bytes, list[dict], int, int]:
    import cv2
    import numpy as np
    import supervision as sv

    annotated_dir = os.path.join(tmpdir, "annotated")
    os.makedirs(annotated_dir, exist_ok=True)

    per_frame_detections: list[dict] = []
    prev_bbox_by_track: dict[int, list[float]] = {}

    for frame_idx in range(len(frame_names)):
        img = cv2.imread(os.path.join(frames_dir, frame_names[frame_idx]))
        segments = video_segments.get(frame_idx, {})

        if segments:
            object_ids = list(segments.keys())
            masks_arr = np.concatenate(list(segments.values()), axis=0)
            tight_boxes = []
            quality_by_track: dict[int, dict[str, float]] = {}
            for oid in object_ids:
                tight_box = _bbox_from_mask(segments[oid])
                tight_box = _smooth_bbox(prev_bbox_by_track.get(oid), tight_box)
                prev_bbox_by_track[oid] = tight_box
                tight_boxes.append(tight_box)
                quality_by_track[oid] = _box_quality_metrics(segments[oid], tight_box)

            detections = sv.Detections(
                xyxy=np.array(tight_boxes, dtype=np.float32),
                mask=masks_arr,
                class_id=np.array(object_ids, dtype=np.int32),
            )

            annotated = sv.BoxAnnotator(thickness=3).annotate(scene=img.copy(), detections=detections)
            annotated = sv.MaskAnnotator().annotate(scene=annotated, detections=detections)

            for i, oid in enumerate(object_ids):
                x1, y1, _, _ = [int(v) for v in detections.xyxy[i].tolist()]
                state = track_states.get(oid)
                label = state.canonical_label if state else f"object_{oid}"
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
                    "label": track_states.get(oid).canonical_label if oid in track_states else f"object_{oid}",
                    "score": track_states.get(oid).label_confidence if oid in track_states else 0.0,
                    "bbox": detections.xyxy[i].tolist(),
                    "mask_rle": _mask_to_rle(segments[oid].squeeze()),
                    "canonical_label": track_states.get(oid).canonical_label if oid in track_states else "unknown_object",
                    "mask_quality": (
                        round(track_states[oid].mask_quality_history.get(frame_idx, 0.0), 3)
                        if oid in track_states else 0.0
                    ),
                    "bbox_area_ratio": round(quality_by_track[oid]["bbox_area_ratio"], 5),
                    "mask_area_ratio": round(quality_by_track[oid]["mask_area_ratio"], 5),
                    "box_to_mask_ratio": round(quality_by_track[oid]["box_to_mask_ratio"], 3),
                }
                for i, oid in enumerate(object_ids)
            ]
        else:
            annotated = img
            frame_dets = []

        per_frame_detections.append({
            "frame_idx": source_indices[frame_idx],
            "sampled_frame_idx": frame_idx,
            "timestamp_sec": source_indices[frame_idx] / source_fps if source_fps > 0 else 0.0,
            "detections": frame_dets,
        })
        cv2.imwrite(os.path.join(annotated_dir, f"{frame_idx:05d}.jpg"), annotated)

    first_frame = cv2.imread(os.path.join(frames_dir, frame_names[0]))
    frame_h, frame_w = first_frame.shape[:2]

    h, w = cv2.imread(os.path.join(annotated_dir, "00000.jpg")).shape[:2]
    raw_path = os.path.join(tmpdir, "tracked_raw.mp4")
    writer = cv2.VideoWriter(raw_path, cv2.VideoWriter_fourcc(*"mp4v"), output_fps, (w, h))
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
    source_indices: list[int],
    video_segments: dict,
    track_states: dict[int, TrackState],
    source_fps: float,
) -> tuple[list[dict], int, int]:
    """Same per-frame JSON as _annotate_and_encode without drawing frames or encoding MP4."""
    import cv2
    import numpy as np
    import supervision as sv

    first_frame = cv2.imread(os.path.join(frames_dir, frame_names[0]))
    frame_h, frame_w = first_frame.shape[:2]

    per_frame_detections: list[dict] = []
    prev_bbox_by_track: dict[int, list[float]] = {}

    for frame_idx in range(len(frame_names)):
        segments = video_segments.get(frame_idx, {})

        if segments:
            object_ids = list(segments.keys())
            masks_arr = np.concatenate(list(segments.values()), axis=0)
            tight_boxes = []
            quality_by_track: dict[int, dict[str, float]] = {}
            for oid in object_ids:
                tight_box = _bbox_from_mask(segments[oid])
                tight_box = _smooth_bbox(prev_bbox_by_track.get(oid), tight_box)
                prev_bbox_by_track[oid] = tight_box
                tight_boxes.append(tight_box)
                quality_by_track[oid] = _box_quality_metrics(segments[oid], tight_box)

            detections = sv.Detections(
                xyxy=np.array(tight_boxes, dtype=np.float32),
                mask=masks_arr,
                class_id=np.array(object_ids, dtype=np.int32),
            )

            frame_dets = [
                {
                    "track_id": oid,
                    "label": track_states.get(oid).canonical_label if oid in track_states else f"object_{oid}",
                    "score": track_states.get(oid).label_confidence if oid in track_states else 0.0,
                    "bbox": detections.xyxy[i].tolist(),
                    "mask_rle": _mask_to_rle(segments[oid].squeeze()),
                    "canonical_label": track_states.get(oid).canonical_label if oid in track_states else "unknown_object",
                    "mask_quality": (
                        round(track_states[oid].mask_quality_history.get(frame_idx, 0.0), 3)
                        if oid in track_states else 0.0
                    ),
                    "bbox_area_ratio": round(quality_by_track[oid]["bbox_area_ratio"], 5),
                    "mask_area_ratio": round(quality_by_track[oid]["mask_area_ratio"], 5),
                    "box_to_mask_ratio": round(quality_by_track[oid]["box_to_mask_ratio"], 3),
                }
                for i, oid in enumerate(object_ids)
            ]
        else:
            frame_dets = []

        per_frame_detections.append({
            "frame_idx": source_indices[frame_idx],
            "sampled_frame_idx": frame_idx,
            "timestamp_sec": source_indices[frame_idx] / source_fps if source_fps > 0 else 0.0,
            "detections": frame_dets,
        })

    print("Skip demo video: built detections JSON only (no annotated MP4)")
    return per_frame_detections, frame_w, frame_h


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

@app.function(
    image=gsam2_image,
    gpu="H100",
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

    prompt_prefix = (text_prompt or "").strip().strip(".")
    auto_prompt = AUTO_DISCOVERY_PROMPT
    if prompt_prefix:
        auto_prompt = f"{prompt_prefix}. {AUTO_DISCOVERY_PROMPT}"
    box_threshold = conf_threshold if conf_threshold > 0 else DEFAULT_BOX_THRESHOLD
    text_threshold = float(os.getenv("GSAM2_TEXT_THRESHOLD", str(DEFAULT_TEXT_THRESHOLD)))
    target_fps = max(1, int(os.getenv("GSAM2_TARGET_FPS", str(DEFAULT_TARGET_FPS))))
    keyframe_stride = int(os.getenv("GSAM2_KEYFRAME_STRIDE", str(DEFAULT_KEYFRAME_STRIDE)))
    stage_times: dict[str, float] = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        # --- Stage 1: extract frames ---
        t0 = time.perf_counter()
        frames_dir, frame_names, source_fps, source_indices = _extract_frames(
            video_bytes,
            tmpdir,
            target_fps,
        )
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
            seed_canonical = _canonical_vote_label(seed["label"])
            if any(
                (
                    seed_canonical != "unknown_object"
                    and seed_canonical == _canonical_vote_label(ex["label"])
                    and _iou(seed["bbox"], ex["bbox"]) >= 0.65
                )
                or (
                    _iou(seed["bbox"], ex["bbox"]) >= 0.88
                )
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

        # --- Stage 3.5: canonicalize labels + merge duplicate tracks ---
        t2b = time.perf_counter()
        track_states = _build_track_states(video_segments, id_to_meta)
        _compute_track_labels(track_states)
        video_segments, id_to_meta = _suppress_duplicate_tracks(track_states, video_segments, id_to_meta)
        track_states = _build_track_states(video_segments, id_to_meta)
        _compute_track_labels(track_states)
        stage_times["label_cleanup_sec"] = round(time.perf_counter() - t2b, 3)

        # --- Stage 4: annotate & encode (or JSON-only) ---
        t3 = time.perf_counter()
        output_fps = float(min(target_fps, max(1.0, source_fps)))
        if skip_output_video:
            per_frame_detections, frame_w, frame_h = _detections_only_from_segments(
                frames_dir,
                frame_names,
                source_indices,
                video_segments,
                track_states,
                source_fps,
            )
            video_out = b""
        else:
            video_out, per_frame_detections, frame_w, frame_h = _annotate_and_encode(
                frames_dir,
                frame_names,
                source_indices,
                video_segments,
                track_states,
                source_fps,
                output_fps,
                tmpdir,
            )
        stage_times["annotate_encode_sec"] = round(time.perf_counter() - t3, 3)

    objects_detected = sorted({
        state.canonical_label
        for state in track_states.values()
        if state.canonical_label != "unknown_object"
    })
    track_summaries = _build_track_summaries(track_states)

    payload = {
        "provider": "gsam2",
        "num_frames": len(frame_names),
        "fps": output_fps,
        "source_fps": source_fps,
        "frame_width": frame_w,
        "frame_height": frame_h,
        "discovery": {
            "mode": "auto_promptless",
            "gdino_model_id": _gdino_model_id(),
            "box_threshold": box_threshold,
            "text_threshold": text_threshold,
            "target_fps": target_fps,
            "keyframe_stride": keyframe_stride,
            "keyframes_used": [source_indices[idx] for idx in keyframes],
            "sampled_keyframes_used": keyframes,
            "seed_objects_used": len(merged_seeds),
        },
        "timings_sec": stage_times,
        "objects_detected": objects_detected,
        "tracks": track_summaries,
        "source_frame_indices": source_indices,
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
