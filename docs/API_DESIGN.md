# ClearPath — API Design

## Base URL

```
Production:  https://clearpath--fastapi-app.modal.run
Development: http://localhost:8000
WebSocket:   wss://clearpath--fastapi-app.modal.run/ws/{session_id}
```

---

## Authentication

All endpoints except `/health` and `/sessions` (POST) require a session JWT.

```
Authorization: Bearer <jwt_token>
```

JWT payload:
```json
{
  "session_id": "uuid",
  "world_verified": true,
  "nullifier_hash": "0x...",
  "iat": 1711497600,
  "exp": 1711584000
}
```

---

## Endpoints

---

### `GET /health`

Health check. No auth required.

**Response 200:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "services": {
    "roboflow": "ok",
    "cloud_vision": "ok",
    "replicate": "ok",
    "elevenlabs": "ok",
    "supabase": "ok",
    "redis": "ok"
  }
}
```

---

### `POST /sessions`

Create a new active session. Called when companion app starts. No auth required (returns auth token).

**Request:**
```json
{
  "device_id": "uuid",          // Unique device identifier (stored locally)
  "device_type": "ray_ban" | "phone_camera",
  "user_prefs": {
    "narration_speed": "normal" | "fast" | "slow",
    "detail_level": "concise" | "verbose",
    "voice_commands_enabled": true,
    "face_recognition_enabled": false
  }
}
```

**Response 201:**
```json
{
  "session_id": "uuid",
  "token": "eyJ...",
  "ws_url": "wss://clearpath--fastapi-app.modal.run/ws/uuid",
  "expires_at": "2024-03-28T00:00:00Z"
}
```

---

### `GET /sessions/{session_id}`

Get session status. Used by caregiver dashboard.

**Response 200:**
```json
{
  "session_id": "uuid",
  "status": "active" | "paused" | "ended",
  "device_type": "ray_ban",
  "gps": { "lat": 40.7589, "lng": -73.9851, "accuracy": 5.2 },
  "speed_mph": 2.1,
  "last_seen": "2024-03-27T10:30:00Z",
  "last_detection_summary": "Crosswalk detected, 3 people nearby",
  "nearby_hazard_count": 2,
  "created_at": "2024-03-27T09:00:00Z"
}
```

---

### `POST /sessions/{session_id}/message`

Send a voice message from caregiver to the active session. Audio plays through glasses speaker.

**Request:**
```json
{
  "text": "Alex, I'll meet you at the corner in 5 minutes",
  "sender_name": "Maya"
}
```

**Response 200:**
```json
{
  "delivered": true,
  "audio_duration_ms": 3200
}
```

---

### `POST /verify/world-id`

Verify a World ID proof and issue a verified JWT.

**Request:**
```json
{
  "merkle_root": "0x...",
  "nullifier_hash": "0x...",
  "proof": "0x...",
  "verification_level": "orb",
  "action": "submit-hazard-report",
  "signal": "0x..."
}
```

**Response 200:**
```json
{
  "token": "eyJ...",
  "nullifier_hash": "0x...",
  "verification_level": "orb",
  "reports_today": 2,
  "reports_remaining_today": 3,
  "expires_at": "2024-03-28T00:00:00Z"
}
```

**Response 400 (invalid proof):**
```json
{
  "error": "World ID proof verification failed",
  "code": "WORLD_ID_INVALID",
  "details": { "reason": "invalid_proof" }
}
```

**Response 429 (rate limited):**
```json
{
  "error": "Maximum 5 hazard reports per day reached",
  "code": "RATE_LIMIT_EXCEEDED",
  "details": { "resets_at": "2024-03-28T00:00:00Z" }
}
```

---

### `GET /hazards/nearby`

Get community hazards near a GPS location.

**Query params:**
```
lat=40.7589&lng=-73.9851&radius_m=100&limit=10
```

**Response 200:**
```json
{
  "hazards": [
    {
      "id": "uuid",
      "type": "construction",
      "severity": "high",
      "description": "Entire block torn up, use other side",
      "distance_m": 32.4,
      "direction": "ahead",
      "lat": 40.7591,
      "lng": -73.9848,
      "verified": true,
      "verified_count": 4,
      "reported_at": "2024-03-27T08:00:00Z",
      "expires_at": "2024-03-29T08:00:00Z"
    }
  ],
  "total": 1,
  "cached": true,
  "cache_age_s": 12
}
```

---

### `POST /hazards`

Submit a new community hazard report. Requires World ID verified JWT.

**Request:**
```json
{
  "lat": 40.7591,
  "lng": -73.9848,
  "type": "construction" | "wet_floor" | "broken_sidewalk" | "missing_curb_cut" | "obstacle" | "other",
  "severity": "low" | "medium" | "high" | "critical",
  "description": "Optional: Entire block torn up, use other side",
  "photo_url": "https://..."
}
```

**Response 201:**
```json
{
  "hazard_id": "uuid",
  "status": "submitted" | "verified",
  "report_count": 3,
  "on_chain_tx": "0x...",
  "message": "Verified! This location now has 3 confirmed reports."
}
```

---

### `GET /hazards/map`

Get all active hazards for map visualization (web frontend).

**Query params:**
```
bounds=40.75,-73.99,40.77,-73.97&limit=100
```

**Response 200:**
```json
{
  "hazards": [
    {
      "id": "uuid",
      "type": "construction",
      "severity": "high",
      "lat": 40.7591,
      "lng": -73.9848,
      "verified": true,
      "verified_count": 4,
      "reported_at": "2024-03-27T08:00:00Z"
    }
  ],
  "total": 47
}
```

---

### `DELETE /hazards/{hazard_id}`

Mark hazard as resolved (only original reporter or admin).

**Response 200:**
```json
{ "resolved": true }
```

---

## WebSocket Protocol

Full spec in `docs/BACKEND.md`. Summary:

### Frame Cadence
- Client sends frames every **200ms** (5fps)
- Server responds with audio **as soon as ready** (~760ms after frame)
- Server sends hazard alerts **immediately** when new hazard detected nearby

### Message Type Reference

| Direction | Type | Frequency | Purpose |
|-----------|------|-----------|---------|
| Client → Server | `frame` | 200ms | Video frame (base64 JPEG) |
| Client → Server | `command` | On demand | Voice command result |
| Client → Server | `ping` | 30s | Keepalive |
| Server → Client | `audio` | ~760ms | Narration audio (MP3 chunk) |
| Server → Client | `hazard_alert` | On trigger | Nearby community hazard |
| Server → Client | `session_update` | On change | Session status change |
| Server → Client | `pong` | On ping | Keepalive response |

### Priority Levels for Audio

| Priority | Behavior |
|----------|---------|
| `urgent` | Immediately interrupts any playing audio. Used for < 1m obstacles. |
| `normal` | Queues after current audio completes. Standard narration. |
| `low` | Queued, dropped if queue > 2 items. Background context. |

---

## Caregiver Realtime (Supabase)

Caregiver dashboard connects directly to Supabase Realtime (not the FastAPI backend).

```typescript
// Subscribe to session updates
const channel = supabase
  .channel(`session:${sessionId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'sessions',
    filter: `id=eq.${sessionId}`
  }, (payload) => {
    updateDashboard(payload.new)
  })
  .subscribe()
```

Backend writes session updates to Supabase on every GPS update + every 10s tick.
