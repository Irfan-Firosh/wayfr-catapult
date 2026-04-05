# wayfr — User Flows

## Personas

| Persona | Goal | Pain Point |
|---------|------|-----------|
| **Alex** — Visually impaired user | Navigate independently and safely | Cane doesn't warn about head-height obstacles, guide dogs are $50K+ |
| **Maya** — Caregiver | Monitor Alex remotely, get peace of mind | No visibility into Alex's environment when alone |
| **Jordan** — Community contributor | Submit hazard reports to help others | No way to ensure reports are trusted by vulnerable users |

---

## Flow 1: Alex — Daily Navigation Session

### Onboarding (One-Time)

```
Download wayfr companion app
    → "Pair your glasses" → BT scan → Select "Meta Ray-Ban" → Connected ✓
    → (Optional) World ID verify to unlock community hazard map
    → Configure: narration speed, detail level, face recognition
    → Done. App always-on from here.
```

### Active Session

```
Alex puts on glasses
    → App detects BT connection automatically
    → Session created → "wayfr active. Clear path ahead."
    → Continuous frame capture begins (5fps)

Walking down the street:
    → "Parked car on your right."
    → "Curb drop 3 feet ahead."
    → "Community alert: Construction 20 feet ahead. Verified by 4 people."
    → "Crosswalk. Listen for signal."

Entering a building:
    → "Sign reads: Pull to open."
    → "3 steps up after the door."

In a restaurant:
    → [Voice] "Hey wayfr, read the menu."
    → OCR pipeline → reads menu items aloud

Meeting someone:
    → [Voice] "Who's in front of me?"
    → Face recognition (if enabled) → "This person is Maya."

Session end:
    → Glasses removed → BT disconnects → Session ends automatically
    → Summary pushed to caregiver: "Alex was active for 2h 14m. No falls detected."
```

---

## Flow 2: Maya — Caregiver Dashboard

```
Open web app → /dashboard
    → Subscribe to Alex's session (Supabase Realtime)

Dashboard live view:
    → Blue dot on Mapbox map — Alex's real-time position (updates every 10s)
    → Session card: "Alex — Active — 2.1 mph — Last seen 3s ago"
    → Detection feed: "10:32:01 Curb detected (urgent) · 10:32:07 Sign read: EXIT"
    → Hazard alerts: "⚠ 2 active hazards near Alex"

Caregiver actions:
    → [Send Message] → Types: "Alex, I'm 5 minutes away"
                    → Backend TTS → audio through glasses speakers
    → [Check In] → Plays tone → Alex responds verbally or app auto-confirms

Emergency mode:
    → Accelerometer detects fall (no movement for 5s after spike)
    → Glasses: "Possible fall detected. Say 'I'm okay' to cancel."
    → If no response in 10s: Maya receives push notification + GPS pin
```

---

## Flow 3: Jordan — Hazard Contribution

```
Jordan walks past broken sidewalk
    → Opens wayfr web app → /report
    → "Verify you're human to contribute trusted reports."
    → [Verify with World ID] button

World ID flow:
    → MiniKit.commandsAsync.verify() opens World app modal
    → Jordan completes iris scan in World app
    → Callback: merkle_root, nullifier_hash, proof
    → Backend verifies with World ID API
    → JWT issued: "Verified. 5 reports available today."

Hazard submission:
    → Map auto-locates Jordan's GPS position
    → Select type: [Broken Sidewalk]
    → Select severity: [High]
    → Add photo (optional)
    → Note: "Large chunk missing, ankle injury risk"
    → [Submit Report]

Backend processing:
    → World ID nullifier checked (not previously banned)
    → Insert into PostGIS hazards table
    → Write attestation to World Chain (tx hash returned)
    → Check nearby reports: "2 others reported this location"
    → report_count = 3 → auto-mark "verified"
    → Invalidate Redis cache for geohash cell
    → Emit Supabase Realtime event to nearby active sessions

Jordan sees:
    "✓ Verified hazard — confirmed by 3 people including you."
    "On-chain: 0x7f3c..."
    "Active wayfr users near this location have been alerted."
```

---

## Voice Command Reference

Wake word: **"Hey wayfr"**

| Command | Backend Action | Response |
|---------|---------------|---------|
| "What's around me?" | Gemini full scene | "You're in a busy intersection. Crosswalk ahead, traffic on your left." |
| "Read that" | Cloud Vision OCR | Reads all text in current frame |
| "How far is that?" | DepthAnything | "The object ahead is approximately 4 feet away." |
| "Is it safe ahead?" | YOLO + hazard map | "Path clear. No community hazards within 50 meters." |
| "Who is this?" | Face recognition | "This person is [name]" or "Unknown person, appears to be in their 30s." |
| "Where am I?" | GPS + Mapbox geocode | "You're on 5th Avenue near 42nd Street." |
| "Find a seat" | YOLO scan + guidance | "Chair detected 6 feet to your right." |
| "Pause narration" | Session update | Silences auto-narration for 2 minutes |
| "Resume" | Session update | "wayfr resumed." |
| "Call Maya" | Contacts integration | Initiates phone call |
| "Describe my surroundings" | Gemini verbose | Full 3–4 sentence scene description |

---

## Session State Machine

```
[DISCONNECTED]
    │ BT connection established
    ▼
[IDLE]
    │ Session created (POST /sessions)
    ▼
[ACTIVE: SCANNING] ◄────────────────────────────────────────┐
    │                                                        │
    │  Every 200ms:                                          │
    │  • Capture frame → send to backend                    │
    │  • Backend returns audio → play                       │
    │  Every 10s:                                            │
    │  • Send GPS location                                   │
    │  • Check proximity hazards                             │
    │  Every 30s:                                            │
    │  • Send keepalive ping                                 │
    │                                                        │
    ├── Voice command detected → [COMMAND MODE] ────────────►┘
    │
    ├── "Pause" command → [PAUSED]
    │       │ "Resume" command → [ACTIVE: SCANNING]
    │
    ├── Accelerometer spike + no movement → [CHECKING]
    │       │ "I'm okay" spoken → [ACTIVE: SCANNING]
    │       │ 10s timeout → [EMERGENCY]
    │
    ├── BT disconnected → [IDLE]
    └── Session expired (1h) → [ENDED]

[COMMAND MODE] (2–10s)
    │ Command processed
    │ Response narrated
    ▼
[ACTIVE: SCANNING]

[EMERGENCY]
    │ Push notification → all caregivers
    │ GPS broadcast every 5s (increased frequency)
    │ Continue scanning
    ▼
[ACTIVE: SCANNING] (when "I'm okay" spoken or caregiver confirms)
```

---

## Error States

| Error | User Experience | Recovery |
|-------|----------------|---------|
| Backend timeout | "Taking a moment to process..." | Auto-retry, continue |
| BT audio disconnected | Switches to phone speaker | Reconnect prompt after 30s |
| Vision API down | "AI processing paused. Proceed with caution." | Retry every 30s |
| GPS unavailable | Hazard map disabled | Local fallback (last known hazards) |
| No internet | "wayfr offline. Basic obstacle detection active." | YOLO runs locally if available |
