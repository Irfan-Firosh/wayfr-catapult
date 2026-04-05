# wayfr — Vision Model Strategy

## Overview

wayfr uses a layered vision strategy: a **custom-trained model self-hosted on Purdue RCAC** for
primary object and scene understanding, augmented by **Google cloud APIs** for breadth and robustness.
All models run in parallel per frame. A Gemini Flash fallback activates automatically if RCAC
is unreachable.

Rather than feeding raw camera frames directly to the vision models, wayfr first reconstructs a
persistent 3D scene from depth-estimated point clouds and renders stabilized synthetic views.
The vision models receive these synthetic views — giving them a more consistent, accumulated
spatial representation than individual raw frames.

---

## Vision Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 0: 3D Scene Reconstruction (Pre-processing)                  │
│                                                                     │
│  See "3D Scene Pipeline" section below for full detail.             │
│  • DepthAnything v2 → depth map per frame                          │
│  • Backproject pixels to 3D point cloud (camera intrinsics)        │
│  • Accumulate point clouds across sliding window (~10 frames)      │
│  • Render synthetic 2D views: top-down, current-direction,         │
│    left-side, right-side                                            │
│  • Synthetic views fed to Layers 1 & 4 instead of raw frames      │
│  • ~50ms point cloud update + ~100ms novel view render             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1: Custom AI Vision Model (Primary — Best ML Track)          │
│                                                                     │
│  VLM fine-tuned on spatial object detection dataset                 │
│  Self-hosted on Purdue RCAC GPU cluster                             │
│  Exposed as REST endpoint: POST /detect (JPEG → structured JSON)   │
│  • Input: synthetic 2D view from 3D scene (not raw frame)          │
│  • Returns: objects[], urgency[], direction[], distance_hint[]      │
│  • Fast: ~100–300ms depending on RCAC load                         │
│  • Owned: trained by the team, full control over architecture      │
│                                                                     │
│  Fallback (automatic): Gemini 1.5 Flash Vision API                 │
│  • Activates if RCAC endpoint is unreachable or times out          │
│  • Same structured JSON output format                              │
│  • Latency: ~150–200ms                                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2: Google Cloud Vision API (Text + Object Breadth)           │
│                                                                     │
│  • OCR: reads signs, menus, labels with high accuracy               │
│  • Object labels: 1,000+ object categories                          │
│  • Safe search: filters inappropriate content                       │
│  • ~150ms, highly reliable                                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3: DepthAnything v2 via Replicate (Metric Depth)             │
│                                                                     │
│  • Monocular depth estimation (single camera, no stereo needed)     │
│  • Relative depth map → calibrated to metric distances              │
│  • Primary input to 3D point cloud reconstruction (Layer 0)        │
│  • Also identifies "how far" each detected object is               │
│  • ~300ms (async, non-blocking)                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 4: Gemini 1.5 Flash (Scene Understanding — every 3s)         │
│                                                                     │
│  • Multimodal: synthetic scene view + structured detections context │
│  • Generates holistic scene description                             │
│  • Handles novel objects/situations the other models miss           │
│  • ~400ms, runs every 3s (not every frame)                          │
│  • Also serves as Layer 1 fallback (different prompt)              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Custom VLM on Purdue RCAC

### Why This Qualifies for Best ML Track

The judges require a **team-trained model** — not an off-the-shelf API wrapper. The RCAC-hosted model:
- Is fine-tuned on a custom dataset assembled by the team
- Runs on Purdue's research GPU infrastructure (A100/V100 nodes)
- Produces custom validation metrics (mAP, precision, recall, or VLM eval scores)
- Is demonstrably domain-specific: understands the spatial objects and scene elements that matter for navigation by visually impaired people
- Backend calls a team-owned endpoint — full ownership of the inference stack
- Receives synthetic 2D views rendered from the 3D scene (not raw frames), giving the model stabilized, accumulated spatial context

### Recommended Model Architecture

**Moondream 2** (default recommendation):
- 1.8B parameter VLM — fast, small, designed for visual Q&A
- Fine-tune on accessibility obstacle dataset using LoRA adapters
- Input: JPEG → Output: structured JSON via constrained generation
- Runs comfortably on a single RCAC A100 node

**Alternative if more compute is available:**
- Phi-3 Vision (4.2B) — stronger reasoning, higher latency
- LLaVA-1.5-7B — more capable, requires more VRAM

### RCAC Endpoint Spec

```
POST https://<rcac-hostname>/detect
Authorization: Bearer <RCAC_API_KEY>
Content-Type: application/json

Request:
{
  "image": "<base64_jpeg>",           // synthetic 2D view rendered from 3D scene
  "view_type": "current" | "top_down" | "left" | "right",
  "prompt_mode": "object_detection"   // or "scene_description" for richer output
}

Response:
{
  "objects": [
    {
      "label": "curb_drop",
      "confidence": 0.91,
      "bbox_2d": [x1, y1, x2, y2],
      "direction": "ahead",
      "distance_hint": "near",   // "near" (<1m) | "medium" (1-3m) | "far" (>3m)
      "urgency": "high"
    }
  ],
  "raw_description": "There is a curb drop directly ahead.",
  "inference_ms": 142
}
```

### Object Detection Output (General)

The model detects all spatially relevant objects encountered during navigation.
Urgency is assigned based on how immediately the object affects safe passage.

| Example Label | Urgency | Notes |
|---------------|---------|-------|
| `curb_drop` | HIGH | Step down — fall risk |
| `step_down` | HIGH | Stair descending |
| `wet_floor` | HIGH | Slip risk |
| `step_up` | MEDIUM | Stair ascending |
| `curb` | MEDIUM | Standard kerb |
| `pole` / `bollard` | MEDIUM | Head/torso height item |
| `construction_zone` | MEDIUM | Area item |
| `vehicle` | MEDIUM | Parked blocking path |
| `person` | LOW | Approaching pedestrian |
| `door` | LOW | Entry/exit point |
| `sign` | LOW | Text-bearing — hand off to OCR |
| `chair` / `table` | LOW | Furniture items |
| `bicycle` / `scooter` | MEDIUM | Mobile items in path |

The training taxonomy is open-ended — the model is fine-tuned to output any label relevant to
navigation, not restricted to a fixed closed set.

### Training Steps

**Step 1: Build dataset**
```
1. Source images from open accessibility/pedestrian datasets
2. Capture 100–200 photos on campus (stairs, poles, curbs, construction)
3. Annotate with obstacle classes above
4. Apply augmentations: flip, rotate ±15°, brightness ±25%, blur 1px
5. Split: 80% train, 10% val, 10% test
```

**Step 2: Fine-tune on RCAC**
```bash
# SSH into RCAC cluster
ssh <username>@scholar.rcac.purdue.edu

# Request GPU node (Slurm)
salloc -N 1 -n 1 --gres=gpu:1 -t 04:00:00 -A <account>

# Fine-tune Moondream 2 with LoRA
python train.py \
  --model moondream2 \
  --dataset ./data/wayfr-objects \
  --epochs 10 \
  --lora-rank 16 \
  --output ./checkpoints/wayfr-v1
```

**Step 3: Serve endpoint**
```bash
# Start FastAPI inference server on RCAC
uvicorn serve:app --host 0.0.0.0 --port 8080

# Or use Modal to serve RCAC checkpoint (hybrid option)
```

**Step 4: For demo, show these**
- RCAC job log (training loss curve)
- Validation metrics on navigation object detection test set
- Side-by-side: base model vs fine-tuned (our model catches domain-specific objects)
- Live inference hitting the RCAC endpoint during demo (receiving synthetic scene view, returning object annotations)

---

## Layer 1 Fallback: Gemini 1.5 Flash

Activated when `RCAC_ENDPOINT_URL` is unreachable or returns a non-200 response.
Uses the same structured output format via a JSON-mode prompt.
Receives the same synthetic 2D view from the 3D scene that the RCAC model would have received.

```python
GEMINI_OBJECT_PROMPT = """
You are analyzing a synthetic view rendered from a 3D scene reconstruction captured by smart
glasses worn by a visually impaired person. The view may be current-direction, top-down,
left-side, or right-side.

Identify all objects relevant to navigation. Return ONLY valid JSON:
{
  "objects": [
    {
      "label": "<descriptive object label, e.g. curb_drop, step_down, wet_floor, pole, vehicle, person, door, sign, chair, bicycle>",
      "confidence": <0.0–1.0>,
      "bbox_2d": [x1, y1, x2, y2],
      "direction": "<ahead | left | right>",
      "distance_hint": "<near | medium | far>",
      "urgency": "<high | medium | low>"
    }
  ],
  "raw_description": "<one sentence summary>"
}

If no objects of interest: return {"objects": [], "raw_description": "Path appears clear."}
"""
```

---

## Layer 2: Google Cloud Vision API (unchanged)

| Feature | API | Use Case |
|---------|-----|---------|
| TEXT_DETECTION | Vision v1 | Read signs, menus, labels |
| OBJECT_LOCALIZATION | Vision v1 | Identify objects (1000+ categories) |

---

## Layer 3: DepthAnything v2 (unchanged)

- Model: `depth-anything/depth-anything-v2-large` on Replicate
- Input: RGB image → Output: relative depth map
- Calibration factor: `8.0` (empirically determined)
- Timeout: 800ms (non-blocking — pipeline continues without depth if slow)

---

## Layer 4: Gemini 1.5 Flash Scene Understanding (unchanged)

Runs every 3 seconds (or on voice command). Receives structured detections from all other
layers as context to produce a holistic navigation description.

```python
GEMINI_SCENE_PROMPT = """
You are wayfr, a real-time vision assistant for a visually impaired person.
Analyze this image and provide a concise, navigation-focused scene description.

Context provided: {obstacle_summary} {text_summary} {object_summary}

Your description should:
1. Focus on spatial layout and navigation-relevant features
2. Mention people, their approximate number and direction of movement
3. Note exits, entrances, steps, ramps, and floor changes
4. Be 2-3 sentences maximum
5. Use directional language (ahead, left, right, behind)

Do NOT describe colors, aesthetics, or irrelevant details.
Do NOT repeat information already in the obstacle/text context.
"""
```

---

## Vision Output Merging

All layers feed into a unified `VisionResult`:

```python
@dataclass
class VisionResult:
    # From RCAC VLM (or Gemini fallback) — operating on synthetic scene views
    detected_objects: list[ObjectAnnotation]   # [{label, confidence, bbox_2d, direction, distance_hint, urgency, x_3d, y_3d, z_3d}]
    vision_source: str                          # "rcac" | "gemini_fallback"

    # From Cloud Vision
    text_annotations: list[str]                # ["EXIT", "PULL TO OPEN", "WET FLOOR"]
    object_labels: list[str]                   # ["door", "chair", "signage"]

    # From 3D scene (Scene3D service)
    scene_views: list[SceneView]               # Rendered synthetic views (top_down, current, left, right)
    scene_point_count: int                     # Total accumulated points in current window

    # From DepthAnything (feeds into 3D reconstruction)
    depth_map: DepthMap | None                 # Pixel-wise depth estimates

    # From Gemini (every 3s)
    scene_description: str | None             # "You are in a busy hallway..."

    # From hazard map (PostGIS)
    community_hazards: list[ProximityAlert]    # Nearby verified reports

    timestamp: float
```

---

## Fallback Strategy

| Layer | Failure Mode | Fallback |
|-------|-------------|---------|
| 3D Scene (Scene3D) | Depth unavailable | Pass raw frame directly to vision models |
| RCAC VLM | Timeout / unreachable | Gemini 1.5 Flash (same structured prompt, same synthetic view) |
| Gemini Flash | API error | Skip object detection, use Cloud Vision object labels |
| Cloud Vision | Quota exceeded | Use Gemini for OCR (slower but works) |
| DepthAnything | Replicate slow | Skip 3D reconstruction, pass raw frame; use distance_hint from VLM as proxy |
| All AI fails | Full outage | "AI processing unavailable. Please proceed with caution." |

---

---

## 3D Scene Pipeline

This pipeline transforms individual 2D video frames into a persistent 3D scene that the vision
models query via rendered synthetic views. It runs before any model inference.

### Overview

```
2D frame (RGB)
    │
    ▼
DepthAnything v2 → depth map (H×W float32, metric metres)
    │
    ▼
Backprojection to 3D point cloud
    │   For each pixel (u, v) with depth d:
    │     x = (u - cx) * d / fx
    │     y = (v - cy) * d / fy
    │     z = d
    │   where (fx, fy, cx, cy) = camera intrinsics
    │
    ▼
Point cloud fusion — sliding window of last 10 frames
    │   New points appended; oldest frame's points evicted
    │   Each point carries: (x, y, z, r, g, b, label, confidence)
    │   label/confidence populated after annotation back-projection
    │
    ▼
Novel view synthesis — render 4 synthetic 2D projections
    │   top_down   : orthographic projection, camera above scene looking down
    │   current    : perspective projection matching glasses FOV
    │   left       : perspective, rotated 30° left from heading
    │   right      : perspective, rotated 30° right from heading
    │
    ▼
Synthetic views → RCAC VLM / Gemini Flash
    │   Returns: ObjectAnnotation[] with label, bbox_2d, confidence, urgency, direction
    │
    ▼
Back-project 2D annotations → 3D space
    │   Use camera matrix for each view to map bbox centres → 3D rays
    │   Intersect ray with point cloud depth → assign (x_3d, y_3d, z_3d)
    │   Tag matching 3D points with label + confidence
    │
    ▼
3D scene graph update
    │   Persistent dict: {object_id → ObjectAnnotation with 3D coords}
    │   Merge/update by proximity (within 0.3m = same object)
    │   Stale entries removed after 5s without re-detection
    │
    ▼
Claude Haiku narration synthesis → ElevenLabs TTS
```

### Camera Intrinsics

Ray-Ban Meta Smart Glasses approximate intrinsics (640×480 resolution):

| Parameter | Value | Description |
|-----------|-------|-------------|
| `fx` | 580.0 px | Focal length X |
| `fy` | 580.0 px | Focal length Y |
| `cx` | 320.0 px | Principal point X (half width) |
| `cy` | 240.0 px | Principal point Y (half height) |

These are refined at runtime using a checkerboard calibration target if available.
Otherwise the defaults above produce usable metric reconstruction at 1–5m range.

### Sliding Window Accumulation

- Window size: **10 frames** (covers ~2 seconds at 5fps)
- Each frame contributes up to `640 × 480 = 307,200` points before downsampling
- Downsampling: voxel grid filter at 0.05m resolution → typically ~5,000–15,000 points per frame
- Total scene: ~50,000–150,000 points in window
- Memory: ~20MB peak (float32 x,y,z + uint8 r,g,b + labels)

### Novel View Rendering

Synthetic views are rendered using a software rasterizer (no GPU required for this step):

```python
def render_view(points_xyz, points_rgb, view_type: str, camera_matrix: np.ndarray) -> np.ndarray:
    """
    Project 3D point cloud to 2D image using given camera_matrix.
    Returns H×W×3 uint8 image.
    view_type: "top_down" | "current" | "left" | "right"
    """
```

- `top_down`: Orthographic, 5m × 5m footprint centred on user, rendered to 512×512
- `current`: Perspective using glasses FOV (~70°), rendered to 640×480
- `left` / `right`: Perspective, yaw ±30° from current heading, rendered to 640×480

The vision model receives the `current` view for every frame inference cycle,
and all four views when the 3-second Gemini scene understanding cycle fires.

### Benefits Over Raw Frame Inference

| Property | Raw Frames | 3D Scene Views |
|----------|-----------|----------------|
| Temporal stability | Frame-by-frame noise | Accumulated over 10 frames |
| Spatial coverage | Single viewpoint | Multi-angle from same scene |
| Object persistence | Lost between frames | Tracked in scene graph |
| Distance accuracy | Relative only | Metric (via intrinsics) |
| Occlusion handling | Blind to occluded items | Top-down view reveals layout |

---

## Env Vars (Layer 1)

```env
# Primary: RCAC-hosted VLM
RCAC_ENDPOINT_URL=https://<rcac-hostname>:8080
RCAC_API_KEY=<secret>

# Fallback: Gemini (already used for Layer 4)
GEMINI_API_KEY=<secret>
```

---

## Demo Script for Best ML Track (30 seconds)

1. Show RCAC job dashboard → "We trained this model on Purdue's research GPU cluster"
2. Show training loss curve → "Custom fine-tune on our spatial object detection dataset"
3. Show validation metrics: "X% accuracy on navigation-relevant object classes"
4. Live demo: point glasses at a step → depth map → 3D point cloud → synthetic view → RCAC endpoint responds → "Step down ahead"
5. Key statement: "This is a model we trained ourselves, running on university research infrastructure —
   not a generic API. It receives stabilized 3D scene views and understands the specific objects
   that matter for navigation by visually impaired people."
