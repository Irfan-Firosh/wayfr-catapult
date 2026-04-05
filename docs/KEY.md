# wayfr — Project Index (Read This First)

> **For future Claude sessions:** Start here. This file tells you what the project is,
> where everything lives, and the key decisions already made. Read this before touching any code.

---

## What Is wayfr?

**wayfr** is a real-time AI navigation assistant for visually impaired people.
Users wear Meta Ray-Ban Smart Glasses. wayfr's AI pipeline processes video frames
from the glasses and narrates the environment through the glasses' speakers —
objects, text, spatial context — in real-time audio. The system is a general-purpose
spatial understanding engine: it detects and describes all objects and scene elements
relevant to navigation, not just a predefined set of hazards.

Built for the **Catapult hackathon**, targeting 6 prize tracks.

---

## Project Structure

```
wayfr/
├── docs/                  ← All architecture & design documentation (you are here)
│   ├── KEY.md             ← THIS FILE — start here
│   ├── ARCHITECTURE.md    ← Full system diagram (4 tiers: glasses → mobile → backend → web)
│   ├── VISION_STRATEGY.md ← AI vision pipeline detail (RCAC VLM + Gemini fallback)
│   ├── BACKEND.md         ← FastAPI structure, WebSocket protocol, code snippets
│   ├── DATA_FLOW.md       ← Frame-to-audio data flow, latency budget
│   ├── DATA_MODELS.md     ← PostgreSQL schema, Redis keys, Pydantic/TS types
│   ├── USER_FLOW.md       ← 3 personas (Alex, Maya, Jordan) + session state machine
│   ├── FRONTEND_DESIGN.md ← Design tokens, shadcn + Magic UI components, page layouts
│   ├── IMPLEMENTATION_PLAN.md ← Build order, time estimates, critical path
│   └── WORLD_ID.md        ← World ID integration (anti-Sybil hazard reporting)
└── plans/
    └── wayfr-build-plan.md ← Master 12-step build plan with dependency graph
```

> **Note:** No application code exists yet. All files are documentation/planning only.

---

## Tech Stack at a Glance

| Layer | Technology |
|-------|-----------|
| Hardware | Meta Ray-Ban Smart Glasses (BT 5.3) |
| Mobile | Expo React Native (iOS/Android) |
| Backend | FastAPI + Python 3.11 on Modal (serverless GPU) |
| **3D Scene Reconstruction** | **Scene3D service — DepthAnything v2 → point cloud → novel views** |
| **Vision — Primary** | **Custom VLM on Purdue RCAC GPU cluster** |
| **Vision — Fallback** | **Gemini 1.5 Flash Vision API (Google)** |
| OCR + Object Labels | Google Cloud Vision API |
| Depth Estimation | DepthAnything v2 via Replicate |
| Scene Understanding | Gemini 1.5 Flash (every 3s, receives synthetic views) |
| Narration Synthesis | Claude claude-haiku-4-5 (text only — NOT vision) |
| Text-to-Speech | ElevenLabs (Rachel voice, eleven_turbo_v2) |
| Database | Supabase (PostgreSQL + PostGIS) |
| Cache | Upstash Redis |
| Frontend | Next.js 14 + shadcn/ui + Magic UI on Vercel |
| Auth / Anti-Sybil | World ID (MiniKit) + World Chain attestations |
| Blockchain | World Chain (Base L2) — HazardAttestation.sol |

---

## Key Architectural Decisions

### 1. Vision Model: RCAC VLM (not YOLO, not off-the-shelf API)

**Decision:** Use a custom VLM fine-tuned on Purdue RCAC GPU infrastructure as the primary
object and scene understanding model. Gemini 1.5 Flash is the automatic fallback.
Both receive **synthetic 2D views rendered from the 3D scene** rather than raw camera frames.

**Why:**
- User specified: no YOLO, must be AI-based vision model
- RCAC = Purdue Research Computing and Cyberinfrastructure (university GPU cluster)
- Custom fine-tune (Moondream 2 + LoRA) satisfies Best ML hackathon track
- Gemini fallback ensures demo reliability if RCAC is unreachable
- 3D pipeline provides temporally stable, multi-angle views for improved detection

**Env vars needed:**
```
RCAC_ENDPOINT_URL=https://<rcac-hostname>:8080
RCAC_API_KEY=<bearer-token>
GEMINI_API_KEY=<google-key>   # also used for Layer 4 scene understanding
```

**See:** `docs/VISION_STRATEGY.md` for full detail including 3D pipeline, training steps, endpoint spec.

### 2. Claude is NARRATION ONLY — not vision

Claude Haiku is used to synthesize structured object detections → one natural spoken sentence.
It does NOT process images. Vision is handled entirely by the RCAC VLM + Google APIs.
The 3D scene graph provides metric distance and 3D position to Claude for richer narration.

### 3. Hazard Map Trust Model: World ID

Every hazard report requires a World ID (iris scan ZK proof). This prevents bots from
flooding the map with fake data. 3+ unique humans reporting the same location
auto-verifies the hazard. Reports are attested on-chain (World Chain).

**See:** `docs/WORLD_ID.md`

### 4. No video is ever stored

Frames are processed in-memory and discarded. No frame logging. Privacy by design.

### 5. Latency budget: ~1,010ms target, 1,800ms hard max

| Stage | Target |
|-------|--------|
| Camera → phone (BT) | 80ms |
| Phone → backend (WSS) | 40ms |
| DepthAnything v2 (depth map) | 300ms |
| 3D point cloud update | 50ms |
| Novel view render (current) | 100ms |
| RCAC VLM inference (on synthetic view) | 200ms |
| Cloud Vision API (parallel with depth) | 150ms |
| Annotation back-projection to 3D | 20ms |
| Narration synthesis (Haiku) | 200ms |
| ElevenLabs TTS (first chunk) | 150ms |
| Backend → phone → glasses | 120ms |
| **Total** | **~1,010ms** |

Depth estimation + Cloud Vision run in parallel. RCAC VLM is gated on the rendered
synthetic view (~150ms sequential after frame arrives), but Cloud Vision starts immediately.
The 3D pipeline adds ~150ms net latency in exchange for significantly improved detection quality.

---

## Three User Personas

| Persona | Role | Key Feature |
|---------|------|-------------|
| **Alex** | Visually impaired user | Real-time audio narration via glasses |
| **Maya** | Caregiver | Live dashboard — location, detections, hazards |
| **Jordan** | Community contributor | World ID-verified hazard reporting |

---

## Environment Variables (Complete List)

```env
# Vision — RCAC (primary object/scene understanding)
RCAC_ENDPOINT_URL=
RCAC_API_KEY=
RCAC_TIMEOUT_MS=500

# 3D Scene Reconstruction
SCENE3D_WINDOW_FRAMES=10
SCENE3D_VOXEL_M=0.05

# Vision — Google (Cloud Vision OCR + Gemini scene/fallback)
GOOGLE_CLOUD_API_KEY=
GEMINI_API_KEY=

# Depth
REPLICATE_API_TOKEN=

# Narration
ANTHROPIC_API_KEY=

# TTS
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # Rachel

# Database
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# Cache
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=

# World ID
WORLD_APP_ID=
JWT_SECRET=

# Maps (frontend)
NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_WORLD_APP_ID=
```

---

## Where to Start Building

Follow the 12-step plan in `plans/wayfr-build-plan.md`.

**Critical path (minimum viable demo):**
1. Backend WebSocket skeleton (`backend/main.py`)
2. RCAC VLM client with Gemini fallback (`backend/ml/rcac_client.py`)
3. Audio narration end-to-end (Haiku → ElevenLabs)
4. World ID verification flow
5. At least 1 pre-seeded hazard on the map

**Parallel work:**
- Steps 3 + 4 + 5 can be built simultaneously
- Steps 8 (mobile) + 9 (web frontend) can be built simultaneously

---

## Hackathon Prize Tracks

| Track | How wayfr Qualifies |
|-------|-------------------|
| Best ML | Custom VLM fine-tuned on RCAC GPU, validated on navigation object detection test set |
| Best Proof of Human | World ID required for all hazard reports; on-chain attestations |
| Most Promising Startup | B2G accessibility market; 253M people globally |
| Best Use of AI | Multi-layer AI pipeline: 3D scene reconstruction → novel view synthesis → RCAC VLM + Cloud Vision + Gemini |
| Best Overall | Full end-to-end product with hardware, AI, blockchain, caregiver UX |
| Hardware | Meta Ray-Ban Smart Glasses integration |

---

## Important Notes for Future Sessions

- **Project name:** `wayfr` (all lowercase, no space) — was previously named "ClearPath" in early planning
- **No code exists yet** — docs only. Check git log to confirm current state.
- **RCAC model architecture:** Moondream 2 (1.8B VLM) with LoRA fine-tuning is the default recommendation; user may substitute another VLM
- **Demo fallback chain:** RCAC (on synthetic view) → Gemini Flash (on synthetic view) → Cloud Vision object labels → raw frame direct → "proceed with caution" message
- **Claude Haiku role:** narration synthesis only (text in, text out). Never call Claude with image data.
- **Scene3D service:** maintains a sliding window of 10 frames as a 3D point cloud; renders synthetic views for vision models; back-projects annotations to 3D world coordinates
