# wayfr — Data Flow

## Core Loop: Frame → Narration (Every 200ms)

```
┌────────────────────────────────────────────────────────────────────────┐
│  STEP 1: CAPTURE                                        Target: ~100ms │
│                                                                        │
│  Ray-Ban Camera (12MP)                                                 │
│    │  Capture frame (downscaled to 640×480 for speed)                 │
│    │  Compress JPEG at 70% quality (~25KB)                            │
│    │  Bluetooth 5.3 → Companion App                                   │
│    ▼                                                                   │
│  Companion App Buffer                                                  │
│    │  Encode as base64                                                 │
│    │  JSON: { type:"frame", data:"<b64>", timestamp, gps }           │
│    │  WebSocket (WSS) → FastAPI Backend                               │
│    ▼                                                                   │
│  Backend: ws_handler.py                                                │
│    │  Decode base64 → bytes                                           │
│    │  Look up session context from Redis                               │
│    │  Dispatch to pipeline                                             │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  STEP 2: 3D RECONSTRUCTION + PARALLEL VISION            Target: ~450ms │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  STEP 2a: Depth Estimation                           ~300ms      │  │
│  │  DepthAnything v2 via Replicate                                  │  │
│  │                                                                  │  │
│  │  Input: JPEG bytes (raw camera frame)                            │  │
│  │  Output: depth_map (H×W float32, metric metres)                  │  │
│  │  Post-process: relative → metric via calibration factor (8.0)    │  │
│  │  { pixel_depths: [...], nearest_object_m: 0.8 }                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                          │                                             │
│                          ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  STEP 2b: 3D Point Cloud Fusion                      ~50ms       │  │
│  │  Scene3D service (backend/services/scene3d.py)                   │  │
│  │                                                                  │  │
│  │  scene3d.update_from_frame(rgb, depth, pose)                     │  │
│  │  • Backproject each pixel (u,v) + depth d → (x,y,z):            │  │
│  │      x = (u - cx) * d / fx                                      │  │
│  │      y = (v - cy) * d / fy   (camera intrinsics)                │  │
│  │      z = d                                                       │  │
│  │  • Voxel-grid downsample at 0.05m → ~5k–15k points/frame        │  │
│  │  • Append to sliding window; evict oldest frame (window=10)      │  │
│  │  Output: updated 3D point cloud (~50k–150k points, ~20MB)        │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                          │                                             │
│                          ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  STEP 2c: Novel View Synthesis                       ~100ms      │  │
│  │  Scene3D service — software rasterizer                           │  │
│  │                                                                  │  │
│  │  scene3d.render_view("current")  → 640×480 perspective view      │  │
│  │  scene3d.render_view("top_down") → 512×512 orthographic view     │  │
│  │  scene3d.render_view("left")     → 640×480, yaw +30°            │  │
│  │  scene3d.render_view("right")    → 640×480, yaw −30°            │  │
│  │  Output: list[SceneView] — synthetic JPEG bytes per view         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                          │                                             │
│         ┌────────────────┴───────────────────────────┐               │
│         │                                            │               │
│         ▼                                            ▼               │
│  ┌─────────────────────────────┐  ┌──────────────────────────────┐  │
│  │  STEP 2d: Object Detection  │  │  STEP 2d: OCR + Labels       │  │
│  │  ~100–300ms (RCAC)          │  │  ~150ms                      │  │
│  │  or ~150ms (Gemini fallback)│  │  Google Cloud Vision API     │  │
│  │                             │  │                              │  │
│  │  Primary: RCAC VLM          │  │  Input: raw JPEG bytes       │  │
│  │  Fallback: Gemini Flash     │  │  Output: {                   │  │
│  │                             │  │    text: ["EXIT", "PULL      │  │
│  │  Input: SceneView (current) │  │            TO OPEN"],        │  │
│  │  Output: {                  │  │    objects: ["door",         │  │
│  │    "objects": [             │  │              "signage"]      │  │
│  │      { label:"curb_drop",   │  │  }                           │  │
│  │        confidence:0.91,     │  └──────────────────────────────┘  │
│  │        bbox_2d:[...],       │                                    │
│  │        direction:"ahead",   │                                    │
│  │        distance_hint:"near",│                                    │
│  │        urgency:"high" }     │                                    │
│  │    ],                       │                                    │
│  │    "vision_source":"rcac"   │                                    │
│  │  }                          │                                    │
│  └──────────────�┬──────────────┘                                    │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  STEP 2e: Annotation Back-Projection → 3D Scene Graph  ~20ms    │  │
│  │  Scene3D service                                                 │  │
│  │                                                                  │  │
│  │  scene3d.apply_annotations(annotations)                          │  │
│  │  • For each ObjectAnnotation: map bbox_2d centre → 3D ray       │  │
│  │  • Intersect ray with point cloud → (x_3d, y_3d, z_3d)          │  │
│  │  • Tag matching 3D points with label + confidence                │  │
│  │  • Update persistent scene graph; merge nearby duplicates        │  │
│  │  • Expire stale objects (> 5s without re-detection)              │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ── Every 3 seconds ──────────────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Scene Understanding                                 ~400ms      │  │
│  │  Gemini 1.5 Flash (multimodal)                                   │  │
│  │                                                                  │  │
│  │  Input: all 4 SceneViews + structured context from above         │  │
│  │  Output: "You are in a busy corridor. A door is 6 feet ahead.   │  │
│  │           Two people are approaching from your left."            │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  STEP 3: COMMUNITY CONTEXT INJECTION                     Target: ~10ms │
│                                                                        │
│  hazard_map.get_nearby(gps_coords)                                     │
│    → Redis HIT: return cached items for geohash cell (60s TTL)        │
│    → Redis MISS: PostGIS proximity query + cache result                │
│                                                                        │
│  Inject into vision result:                                            │
│  community_hazards: [                                                  │
│    { type:"construction", severity:"high",                             │
│      distance_m:32, direction:"ahead", verified_count:4 }             │
│  ]                                                                     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  STEP 4: NARRATION SYNTHESIS                             Target: ~200ms│
│                                                                        │
│  Input: VisionResult {                                                  │
│    detected_objects: [curb_drop@94%, pole@87%],                        │
│    text: ["EXIT"],                                                     │
│    objects: ["door"],                                                  │
│    scene_point_count: 87432,                                           │
│    scene: "Corridor with door ahead" (if available),                   │
│    community_hazards: [construction@32m]                               │
│  }                                                                     │
│                                                                        │
│  priority_engine.score():                                               │
│    curb_drop urgency=HIGH, distance < 3m → priority 1                 │
│    construction alert 32m → priority 3                                 │
│    → Select: curb_drop wins                                            │
│                                                                        │
│  context_tracker.should_narrate("Curb drop ahead"):                    │
│    → Last narrated: 8s ago → YES (> 5s dedup window)                   │
│                                                                        │
│  Claude Haiku: "Curb drop 4 feet ahead on your right."                │
│    latency: ~200ms                                                     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  STEP 5: TEXT-TO-SPEECH                                  Target: ~250ms│
│                                                                        │
│  ElevenLabs (eleven_turbo_v2, voice: Rachel)                           │
│  Input: "Curb drop 4 feet ahead on your right."                        │
│  Output: MP3 audio stream                                              │
│  First chunk arrives: ~150ms                                           │
│  Full sentence: ~250ms                                                 │
│                                                                        │
│  Send as WebSocket message:                                            │
│  { type:"audio", data:"<base64_mp3>",                                  │
│    priority:"urgent", text:"Curb drop 4 feet ahead on your right." }   │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  STEP 6: AUDIO DELIVERY                                  Target: ~100ms│
│                                                                        │
│  WebSocket → Companion App                                             │
│    → AudioQueueManager receives message                                │
│    → Priority "urgent" → interrupt current audio                       │
│    → expo-av plays MP3                                                 │
│    → Bluetooth A2DP → Ray-Ban speakers                                 │
│                                                                        │
│  TOTAL ROUND TRIP: ~1,010ms (target) | ~1,800ms (hard max)            │
│  (3D pipeline adds ~150ms; RCAC vision runs on synthetic views)        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Hazard Submission Data Flow

```
User (verified human) submits hazard
    │
    ├─── POST /hazards { lat, lng, type, severity, description }
    │    Authorization: Bearer <world_id_jwt>
    │
    ▼
Backend: hazards.py route handler
    │
    ├─── 1. Validate JWT → extract nullifier_hash
    │
    ├─── 2. Rate limit check:
    │        Redis GET hazard_limit:{nullifier}:{today}
    │        If count >= 5 → 429 Too Many Requests
    │        Else → INCR + EXPIRE at midnight
    │
    ├─── 3. Insert hazard row:
    │        Supabase INSERT INTO hazards (location, type, severity, ...)
    │        location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    │
    ├─── 4. Insert hazard_report row:
    │        INSERT INTO hazard_reports (hazard_id, nullifier_hash)
    │        → Trigger fires: check report_count at location
    │        → If 3+ unique nullifiers within 20m → UPDATE status='verified'
    │
    ├─── 5. World Chain attestation (async, non-blocking):
    │        contract.submitAttestation(nullifier_hash, locationHash, severity)
    │        → Store tx_hash in hazard row
    │
    ├─── 6. Cache invalidation:
    │        Redis DEL hazards:{geohash6(lat, lng)}
    │
    ├─── 7. Realtime notification:
    │        Supabase → broadcasts hazard INSERT to all active sessions
    │        → nearby sessions receive hazard_alert WebSocket message
    │
    └─── 8. Response:
             { hazard_id, status:"verified", report_count:3, on_chain_tx:"0x..." }
```

---

## Caregiver Realtime Flow

```
Caregiver opens /dashboard
    │
    ├─── Subscribe to Supabase Realtime:
    │    supabase.channel('session:{id}').on('postgres_changes', ...)
    │
    ◄── Active session backend writes every 10s:
    │    UPDATE sessions SET
    │      location = ST_MakePoint(lng, lat),
    │      speed_mph = 2.1,
    │      last_detection_summary = 'Crosswalk detected',
    │      nearby_hazard_count = 2,
    │      last_seen_at = NOW()
    │
    ├─── Supabase Realtime pushes UPDATE event to all subscribers
    │
    ▼
Dashboard updates (no polling):
    - Map pin moves to new location
    - "Last seen: 0s ago" timer resets
    - Detection feed appends new entry (AnimatedList)
    - Hazard badge count updates

Caregiver sends message:
    POST /sessions/{id}/message { text: "Alex, I'm nearby" }
        → Claude TTS or ElevenLabs → audio bytes
        → Backend sends WebSocket message to Alex's session
        → Plays through glasses: "Message from Maya: I'm nearby"
```

---

## World ID Verification Flow

```
User clicks "Verify with World ID"
    │
    ├─── MiniKit.commandsAsync.verify({
    │      action: 'submit-hazard-report',
    │      verification_level: 'orb'
    │    })
    │    → Opens World app via deep link
    │    → User completes iris scan
    │    → World app generates ZK proof
    │
    ◄── MiniKit callback:
    │   { merkle_root, nullifier_hash, proof, verification_level: 'orb' }
    │
    ├─── POST /verify/world-id { ...proof_payload }
    │
    ▼
Backend: worldid.py
    ├─── POST https://developer.worldcoin.org/api/v2/verify/{app_id}
    │    { nullifier_hash, merkle_root, proof, action, signal }
    │
    ├─── Response 200 → valid proof
    │
    ├─── Check nullifier not banned (Redis SET worldid_banned)
    │
    ├─── Issue JWT:
    │    { nullifier_hash, world_verified:true, exp: +24h }
    │
    └─── Response: { token, reports_today: 2, reports_remaining: 3 }

Frontend:
    ├─── Store JWT in SecureStore / localStorage
    ├─── Fire particles animation
    └─── Show "Verified Human" badge
         Unlock hazard submission form
```
