# wayfr — Implementation Plan

## Overview

This is a hackathon build. Ruthless prioritization is required.
The full plan is in `../plans/clearpath-build-plan.md`.
This document is the condensed execution guide.

---

## Pre-Hackathon Checklist (Do Before the Event)

```
□ Create all accounts:
  □ Purdue RCAC access confirmed → GPU node allocation ready
  □ Google Cloud Console → Enable Vision AI + Gemini API
  □ ElevenLabs → Grab Rachel voice ID
  □ Replicate → Get API token
  □ Supabase → Create project, save connection string
  □ Upstash → Create Redis database
  □ Modal → Install CLI, authenticate
  □ Vercel → Connect GitHub (or use CLI)
  □ World Developer Portal → Register "wayfr" app, create action
  □ Mapbox → Get public token

□ Start RCAC model training (do this at very start — takes 2–4h):
  → Assemble accessibility obstacle dataset (2,000+ images)
  → SSH into RCAC, request GPU node, kick off fine-tune job
  → Start FastAPI inference server once checkpoint is ready

□ Test hardware:
  □ Meta Ray-Ban glasses charged + paired to phone
  □ Meta View app installed
  □ Quick test: glasses camera visible in Meta View app

□ Clone this repo on all team members' machines

□ Create .env from .env.example, fill in all API keys
```

---

## Build Order & Time Estimates

| Step | What | Who | Est. Time |
|------|------|-----|----------|
| 1 | Monorepo scaffold + shadcn init | Any | 45min |
| 2 | Backend core (FastAPI + WebSocket skeleton) | Backend | 1.5h |
| 3 | Vision pipeline (RCAC VLM + Cloud Vision + Depth) | Backend | 2h |
| 4 | TTS + narration synthesis | Backend | 1h |
| 5 | Supabase + PostGIS schema | Backend | 1h |
| 6 | World ID MiniKit integration | Frontend | 1.5h |
| 7 | Hazard map service (backend) | Backend | 1.5h |
| 8 | Mobile companion app (frame relay + audio) | Mobile | 2h |
| 9 | Frontend landing + dashboard skeleton | Frontend | 2h |
| 10 | Frontend polish (Magic UI, animations, 3D map) | Frontend | 2h |
| 11 | End-to-end integration test | All | 1.5h |
| 12 | Demo rehearsal + polish | All | 1h |
| **Total** | | | **~19h** |

**Two developers:**
- Dev 1 (Backend): Steps 2, 3, 4, 5, 7 = ~8h
- Dev 2 (Frontend/Mobile): Steps 1, 6, 8, 9, 10 = ~9h
- Together: Steps 11, 12 = ~2.5h

---

## Critical Path (Must Have for Demo)

These are the absolute minimum viable demo features:

1. **Frame capture** — Phone camera streaming to backend (phone fallback, no Ray-Ban needed)
2. **Obstacle detection** — RCAC VLM endpoint returns detections (Gemini fallback if RCAC not ready)
3. **Audio narration** — Backend → ElevenLabs → audio to phone speaker
4. **World ID** — Working verification flow + hazard submission
5. **Hazard map** — At least 1 pre-seeded hazard visible on map

Everything else (depth estimation, scene description, caregiver dashboard, 3D map) is impressive-to-have.

---

## Phase 1: Foundation (First 4 Hours)

### 1a. Scaffold

```bash
# Root
mkdir catapult && cd catapult
pnpm init
# Create pnpm-workspace.yaml
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'apps/*'
  - 'backend'
EOF

# Web app
pnpm create next-app apps/web --typescript --tailwind --app --src-dir=false --import-alias="@/*"
cd apps/web
pnpm dlx shadcn@latest init  # Choose: Default style, slate color, CSS variables
pnpm add next-themes @worldcoin/minikit-js mapbox-gl framer-motion lucide-react
pnpm add -D @types/mapbox-gl

# Backend
mkdir backend && cd backend
poetry init --name wayfr-backend --python "^3.11"
poetry add fastapi uvicorn[standard] websockets python-multipart \
           google-cloud-vision google-generativeai \
           anthropic elevenlabs replicate \
           httpx supabase redis \
           pydantic-settings python-jose[cryptography] \
           httpx geohash2 asyncio
```

### 1b. Backend skeleton

Key file: `backend/main.py`
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.ws_handler import ws_router
from api.routes import health, sessions, hazards, verify

def create_app() -> FastAPI:
    app = FastAPI(title="wayfr API", version="1.0.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.include_router(health.router)
    app.include_router(sessions.router, prefix="/sessions")
    app.include_router(hazards.router, prefix="/hazards")
    app.include_router(verify.router, prefix="/verify")
    app.include_router(ws_router)
    return app

app = create_app()
```

---

## Phase 2: Vision + Audio Pipeline (Hours 4–8)

Priority: Get frames → narration → audio working end-to-end, even with mock detections.

### Quick validation test:
```bash
# From mobile: connect WebSocket and send a test frame
wscat -c ws://localhost:8000/ws/test-session \
  -H "Authorization: Bearer test" \
  -x '{"type":"frame","data":"<base64_jpeg>","timestamp":1711497600}'

# Should receive:
# {"type":"audio","data":"<base64_mp3>","text":"Clear path ahead.","priority":"normal"}
```

---

## Phase 3: Frontend + World ID (Hours 8–14)

### Magic UI installation
```bash
cd apps/web

# Core animated components
pnpm dlx magicui-cli add animated-beam
pnpm dlx magicui-cli add globe
pnpm dlx magicui-cli add number-ticker
pnpm dlx magicui-cli add shimmer-button
pnpm dlx magicui-cli add border-beam
pnpm dlx magicui-cli add sparkles-text
pnpm dlx magicui-cli add blur-fade
pnpm dlx magicui-cli add bento-grid
pnpm dlx magicui-cli add particles
pnpm dlx magicui-cli add animated-list
pnpm dlx magicui-cli add marquee
pnpm dlx magicui-cli add pulsating-button
pnpm dlx magicui-cli add retro-grid
pnpm dlx magicui-cli add meteors
```

---

## Phase 4: Integration + Polish (Hours 14–19)

### End-to-end test script
```
1. Start backend: cd backend && uvicorn main:app --reload
2. Start web: cd apps/web && pnpm dev
3. Start mobile: cd apps/mobile && pnpm start
4. Open mobile app → start session
5. Hold phone camera up
6. Verify: audio narration comes out of speaker within 2s
7. Open web dashboard → verify live location + detections appear
8. Go to /verify → complete World ID → submit hazard → verify on-chain
9. Walk toward a chair → verify "obstacle detected" narration
10. Check RCAC inference logs → confirm VLM is detecting custom obstacle classes
```

---

## Seed Data

Add representative hazard data for demo areas:

```sql
-- infra/supabase/seed.sql
-- Pre-seed 5 verified hazards near demo location

INSERT INTO hazards (location, type, severity, status, report_count, description, reporter_nullifier)
VALUES
  (ST_SetSRID(ST_MakePoint(-73.9851, 40.7589), 4326),
   'construction', 'high', 'verified', 4,
   'Major sidewalk construction, use other side of street', '0xabc123'),

  (ST_SetSRID(ST_MakePoint(-73.9845, 40.7592), 4326),
   'wet_floor', 'medium', 'verified', 3,
   'Building entrance - wet floor near revolving door', '0xdef456'),

  (ST_SetSRID(ST_MakePoint(-73.9838, 40.7587), 4326),
   'missing_curb_cut', 'high', 'verified', 5,
   'No curb cut on northeast corner', '0xghi789'),

  (ST_SetSRID(ST_MakePoint(-73.9862, 40.7594), 4326),
   'broken_sidewalk', 'medium', 'submitted', 1,
   'Large crack, potential tripping hazard', '0xjkl012'),

  (ST_SetSRID(ST_MakePoint(-73.9855, 40.7583), 4326),
   'obstacle', 'low', 'verified', 3,
   'Food cart partially blocking sidewalk during lunch hours', '0xmno345');
```

---

## Demo Backup Modes

| Scenario | Fallback |
|----------|---------|
| Ray-Ban BT fails | Phone camera mode (identical backend) |
| ElevenLabs quota | Google TTS (lower quality but works) |
| Replicate timeout | Skip depth, use distance_hint from VLM as proxy |
| RCAC model not trained | Route all traffic to Gemini Flash fallback |
| World Chain down | Show mock attestation + contract code |
| Backend cold start | Warm up endpoint 10min before demo |
| Internet issues | Pre-recorded demo video as last resort |

---

## Demo Script (90 Seconds)

**0:00** — Put on Ray-Ban glasses. Phone visible.
> "Meet wayfr. AI navigation for the 253 million people living with visual impairment."

**0:08** — Start walking toward a table.
> Glasses narrate: *"Table 4 feet ahead. Clear path to your right."*
> "Real-time obstacle detection from our custom-trained model — not a generic detector.
> Trained on thousands of pedestrian-specific hazards."

**0:20** — Point glasses at a sign.
> Glasses: *"Sign reads: Exit. Push to open."*
> "Text reading. OCR in real-time."

**0:30** — Open phone, show map with hazard markers.
> "Every hazard on this map was reported by a verified human being.
> Let me show you."

**0:40** — Click Verify with World ID → complete verification.
> Particles animation fires.
> "World ID proves I'm a real person. No bots. No spam."

**0:50** — Submit hazard report → show World Chain explorer.
> "And that report is now on World Chain — immutable, on-chain proof
> that a real human flagged this hazard."

**1:00** — Show caregiver dashboard.
> "Maya, Alex's caregiver, watches in real-time from anywhere."

**1:10** — Final close.
> "wayfr. Real-time AI navigation. Verified community hazards.
> For everyone who deserves to navigate the world independently."

**1:30** — Done.
