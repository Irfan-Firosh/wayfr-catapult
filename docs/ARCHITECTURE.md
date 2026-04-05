# wayfr — System Architecture

## System Overview

wayfr is a distributed real-time system with three physical tiers and one web tier:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 1: EDGE HARDWARE                                                      │
│                                                                             │
│   ┌──────────────────────────────────────────────┐                         │
│   │         Meta Ray-Ban Smart Glasses            │                         │
│   │                                               │                         │
│   │  ┌──────────┐  ┌────────────┐  ┌──────────┐  │                         │
│   │  │ Camera   │  │ Microphone │  │ Speakers │  │                         │
│   │  │ 12MP     │  │ Dual-mic   │  │ Open-ear │  │                         │
│   │  └────┬─────┘  └─────┬──────┘  └────▲─────┘  │                         │
│   └───────┼──────────────┼──────────────┼─────────┘                         │
│           │ BT 5.3        │ BT           │ BT audio                         │
└───────────┼──────────────┼──────────────┼──────────────────────────────────┘
            │              │              │
┌───────────┼──────────────┼──────────────┼──────────────────────────────────┐
│  TIER 2: MOBILE COMPANION                                                   │
│           ▼              ▼              │                                   │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                  Expo React Native App (iOS / Android)               │  │
│   │                                                                      │  │
│   │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  │  │
│   │  │ BT Frame    │  │ GPS Location │  │ World ID    │  │ Audio     │  │  │
│   │  │ Capture     │  │ Service      │  │ MiniKit     │  │ Playback  │  │  │
│   │  │ (5fps JPEG) │  │ (10s updates)│  │ (verify)    │  │ Queue     │  │  │
│   │  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  └─────▲─────┘  │  │
│   └─────────┼───────────────┼─────────────────┼────────────────┼──────── ┘  │
│             │ WSS frames     │ HTTPS GPS       │ HTTPS verify   │ WSS audio  │
└─────────────┼───────────────┼─────────────────┼────────────────┼────────────┘
              │               │                 │                │
┌─────────────┼───────────────┼─────────────────┼────────────────┼────────────┐
│  TIER 3: CLOUD BACKEND (Modal — serverless GPU)                             │
│             ▼               ▼                 ▼                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                       FastAPI Application                            │  │
│   │  ┌────────────────────────────────────────────────────────────────┐  │  │
│   │  │                   AI Processing Pipeline                       │  │  │
│   │  │                                                                │  │  │
│   │  │   JPEG Frame (640×480)                                        │  │  │
│   │  │        │                                                      │  │  │
│   │  │   asyncio.gather(                                             │  │  │
│   │  │     ├── RCAC VLM endpoint ──────── obstacles[], urgency[]   │  │  │
│   │  │     ├── Cloud Vision API ─────────── text[], objects[]        │  │  │
│   │  │     └── DepthAnything v2 ──────────── depth_map[]             │  │  │
│   │  │   )                     every 3s:                            │  │  │
│   │  │        │                Gemini 1.5 Flash ── scene_desc        │  │  │
│   │  │        ▼                                                      │  │  │
│   │  │   Narration Synthesizer (Claude Haiku 4.5)                   │  │  │
│   │  │   + Context Tracker (no repeats)                             │  │  │
│   │  │   + Priority Engine (urgent > hazard > context)              │  │  │
│   │  │        │                                                      │  │  │
│   │  │        ▼                                                      │  │  │
│   │  │   ElevenLabs TTS (streaming)                                  │  │  │
│   │  │        │                                                      │  │  │
│   │  │   WebSocket → MP3 stream → Mobile → Glasses Speakers         │  │  │
│   │  └────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                      │  │
│   │  ┌───────────────────────┐    ┌──────────────────────────────────┐  │  │
│   │  │  Hazard Map Service   │    │  World ID Verification Service   │  │  │
│   │  │  PostGIS proximity    │    │  Proof validation                │  │  │
│   │  │  Auto-verification    │    │  Nullifier rate limiting         │  │  │
│   │  │  Redis caching        │    │  JWT issuance                    │  │  │
│   │  └───────────┬───────────┘    └──────────────┬───────────────────┘  │  │
│   └─────────────┼────────────────────────────────┼──────────────────────┘  │
└─────────────────┼────────────────────────────────┼──────────────────────────┘
                  │                                │
┌─────────────────┼────────────────────────────────┼──────────────────────────┐
│  DATA LAYER      ▼                                ▼                          │
│                                                                              │
│   ┌──────────────────────────────────┐   ┌────────────────────────────────┐  │
│   │  Supabase                        │   │  Upstash Redis                 │  │
│   │  PostgreSQL + PostGIS            │   │  Session state (TTL 1h)        │  │
│   │  • hazards (GIST spatial index)  │   │  Hazard cache (TTL 60s)        │  │
│   │  • sessions                      │   │  Nullifier rate limits         │  │
│   │  • hazard_attestations           │   │  Audio queue                   │  │
│   │  • caregiver_links               │   └────────────────────────────────┘  │
│   │  Realtime subscriptions          │                                       │
│   └──────────────────────────────────┘   ┌────────────────────────────────┐  │
│                                           │  World Chain (Base L2)         │  │
│                                           │  HazardAttestation.sol         │  │
│                                           │  On-chain verification records │  │
│                                           └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  TIER 4: WEB FRONTEND (Next.js 14 on Vercel)                                │
│                                                                              │
│  Landing page │ Caregiver Dashboard │ 3D Hazard Map │ World ID Verify       │
│                                                                              │
│  shadcn/ui + Magic UI + Tailwind + Mapbox GL JS + Supabase Realtime         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### Meta Ray-Ban Glasses
- **Inputs:** Camera (12MP, up to 30fps), dual microphone
- **Outputs:** Audio through open-ear speakers
- **Compute:** None — pure I/O device
- **Connection:** Bluetooth 5.3 to companion phone
- **Constraints:** No public SDK. BT bandwidth limits effective frame delivery to ~5fps. Audio latency ~100ms.

### Companion Mobile App
- **Primary role:** Hardware relay. Bridges glasses BT to cloud WebSocket.
- **Secondary role:** GPS source, World ID client, audio queue manager, offline hazard cache.
- **Frame pipeline:** Ray-Ban camera → BT → phone → compress to JPEG (640×480, ~25KB) → WebSocket.
- **Audio pipeline:** WebSocket audio stream → `expo-av` → BT audio profile → glasses speakers.
- **Fallback:** If no Ray-Bans, use phone camera directly. Same backend pipeline.

### FastAPI Backend (Modal)
- **Session handler:** Maintains per-session context (last N narrations, GPS, calibration).
- **Vision orchestrator:** Fires YOLO + Cloud Vision in parallel per frame. Gemini every 3s.
- **Narration engine:** Claude Haiku synthesizes structured detections → 1 natural sentence.
- **TTS relay:** ElevenLabs streaming → chunked audio back over WebSocket.
- **Hazard service:** PostGIS proximity queries, Redis caching, World ID validation.
- **Scale:** Modal auto-scales 0→N workers. Each worker handles 1 WebSocket session.

### Supabase (PostgreSQL + PostGIS)
- **Hazard map:** Geospatial storage with GIST index. Sub-100ms proximity queries.
- **Sessions:** Lightweight session metadata (no video stored).
- **Realtime:** Push hazard inserts + session updates to caregiver dashboard.
- **Row Level Security:** Users can only read hazards, write with valid JWT.

### World Chain
- **Purpose:** Immutable attestation that a hazard report was submitted by a verified human.
- **Contract:** `HazardAttestation.sol` — minimal, just events. No complex logic.
- **Why on-chain:** Judges can verify attestations in real-time via block explorer during demo.

---

## Latency Budget

| Stage | Target | Hard Max | Notes |
|-------|--------|----------|-------|
| Camera → phone (BT) | 80ms | 120ms | BT 5.3 audio profile |
| Phone → backend (WSS) | 40ms | 80ms | WiFi assumed for demo |
| YOLO inference (Roboflow) | 50ms | 100ms | Roboflow hosted inference |
| Cloud Vision API | 120ms | 200ms | Google's SLA |
| Narration synthesis (Haiku) | 200ms | 400ms | Haiku is fastest Claude |
| ElevenLabs TTS (first chunk) | 150ms | 300ms | Streaming, first ~150ms |
| Backend → phone (WSS) | 40ms | 80ms | |
| Phone → glasses (BT audio) | 80ms | 120ms | A2DP BT audio |
| **Total** | **760ms** | **1,400ms** | |

YOLO + Cloud Vision run in parallel (not sequential). Gemini only runs every 3s.

---

## Security Model

| Concern | Solution |
|---------|---------|
| Unauthorized session creation | Session token issued on device pairing (UUID, stored in Redis) |
| Hazard map spam / Sybil attacks | World ID nullifier required. Max 5 reports/day/human. |
| Video privacy | Frames processed in-memory, never persisted. No frame logging. |
| PII exposure | No names/faces stored. World ID nullifier hash only (unlinkable). |
| API key exposure | All keys in env vars. `.env` gitignored. Modal secrets management. |
| XSS (web) | Next.js RSC, no dangerouslySetInnerHTML. shadcn sanitizes inputs. |
| CSRF | CORS restricted to known origins. SameSite cookies. |

---

## Scalability Path

**Hackathon (1–10 concurrent users):**
- Single Modal worker handles all sessions
- Supabase free tier (500MB, 50k requests/day) — sufficient
- Upstash free tier (10k commands/day) — sufficient

**Post-hackathon (100–1,000 users):**
- Modal auto-scales to N workers (cost: pay per second of GPU use)
- Supabase Pro ($25/mo) for connection pooling + read replicas
- Redis: Upstash Pro for higher throughput

**Scale (10,000+ users):**
- Shard WebSocket workers by geography (Modal regions)
- PostGIS read replicas for hazard map queries
- CDN-cache common hazard regions (Cloudflare KV)
- Model optimization: quantize YOLOv8n → ONNX for self-hosted inference
