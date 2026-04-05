# wayfr — Data Models

## PostgreSQL + PostGIS (Supabase)

### Enable Extensions

```sql
-- 001_extensions.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "postgis_topology";
```

---

### Table: `sessions`

Tracks active wayfr user sessions.

```sql
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       TEXT NOT NULL,
    device_type     TEXT NOT NULL CHECK (device_type IN ('ray_ban', 'phone_camera')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'ended')),

    -- Location (updated every 10s during active session)
    location        GEOGRAPHY(POINT, 4326),
    speed_mph       FLOAT,
    heading_deg     FLOAT,    -- 0-360, 0 = North

    -- User preferences
    narration_speed TEXT DEFAULT 'normal' CHECK (narration_speed IN ('slow', 'normal', 'fast')),
    detail_level    TEXT DEFAULT 'concise' CHECK (detail_level IN ('concise', 'verbose')),
    face_recog_enabled BOOLEAN DEFAULT false,

    -- Metadata
    last_detection_summary  TEXT,
    nearby_hazard_count     INT DEFAULT 0,
    last_seen_at            TIMESTAMPTZ DEFAULT NOW(),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    expires_at              TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour')
);

-- Index for location-based queries
CREATE INDEX idx_sessions_location ON sessions USING GIST (location);

-- Index for active sessions lookup
CREATE INDEX idx_sessions_status ON sessions (status) WHERE status = 'active';
```

---

### Table: `hazards`

Community-reported accessibility hazards with geospatial indexing.

```sql
CREATE TABLE hazards (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location        GEOGRAPHY(POINT, 4326) NOT NULL,
    type            TEXT NOT NULL CHECK (type IN (
                        'construction', 'wet_floor', 'broken_sidewalk',
                        'missing_curb_cut', 'obstacle', 'step', 'vehicle_blocking', 'other'
                    )),
    severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    severity_score  INT GENERATED ALWAYS AS (
                        CASE severity
                            WHEN 'critical' THEN 4
                            WHEN 'high'     THEN 3
                            WHEN 'medium'   THEN 2
                            WHEN 'low'      THEN 1
                        END
                    ) STORED,
    description     TEXT,
    photo_url       TEXT,

    -- Verification
    status          TEXT NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted', 'verified', 'resolved', 'expired')),
    report_count    INT DEFAULT 1,
    verified_at     TIMESTAMPTZ,

    -- Attribution (privacy-preserving — no PII)
    reporter_nullifier  TEXT NOT NULL,     -- World ID nullifier hash of first reporter
    on_chain_tx         TEXT,              -- World Chain transaction hash

    -- Timestamps
    reported_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- PRIMARY: Geospatial GIST index for proximity queries
CREATE INDEX idx_hazards_location ON hazards USING GIST (location);

-- SECONDARY: Active hazards only
CREATE INDEX idx_hazards_active ON hazards (severity_score DESC)
    WHERE status NOT IN ('resolved', 'expired');

-- TERTIARY: By type for filtered views
CREATE INDEX idx_hazards_type ON hazards (type);
```

**Key proximity query:**
```sql
-- Get hazards within 100m of a GPS point, sorted by severity+distance
SELECT
    id, type, severity, description, photo_url, status, report_count,
    ST_Distance(location::geography, ST_MakePoint($1, $2)::geography) AS distance_m,
    DEGREES(ST_Azimuth(
        ST_MakePoint($1, $2)::geography,
        location::geography
    )) AS bearing_deg
FROM hazards
WHERE
    ST_DWithin(
        location::geography,
        ST_MakePoint($1, $2)::geography,  -- $1=lng, $2=lat
        100  -- meters
    )
    AND status NOT IN ('resolved', 'expired')
    AND expires_at > NOW()
ORDER BY severity_score DESC, distance_m ASC
LIMIT 10;
```

---

### Table: `hazard_reports`

Individual reports — multiple users can report the same hazard location.

```sql
CREATE TABLE hazard_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hazard_id       UUID REFERENCES hazards(id) ON DELETE CASCADE,
    nullifier_hash  TEXT NOT NULL,    -- World ID nullifier (unique per human per app)
    reported_at     TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (hazard_id, nullifier_hash)  -- One report per human per hazard
);

-- Trigger: auto-verify when report_count >= 3
CREATE OR REPLACE FUNCTION check_hazard_verification()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE hazards
    SET
        status = 'verified',
        report_count = report_count + 1,
        verified_at = CASE WHEN report_count + 1 >= 3 THEN NOW() ELSE verified_at END
    WHERE id = NEW.hazard_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_hazard_report_count
    AFTER INSERT ON hazard_reports
    FOR EACH ROW EXECUTE FUNCTION check_hazard_verification();
```

---

### Table: `caregiver_links`

Caregiver ↔ user pairings.

```sql
CREATE TABLE caregiver_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_device_id  TEXT NOT NULL,
    caregiver_nullifier  TEXT NOT NULL,   -- World ID nullifier of caregiver
    permissions     JSONB DEFAULT '{"view_location": true, "send_message": true}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    approved_at     TIMESTAMPTZ,          -- NULL = pending approval

    UNIQUE (user_device_id, caregiver_nullifier)
);
```

---

### Row Level Security

```sql
-- Sessions: Only the device that created can update; anyone can read active sessions (for caregivers)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select" ON sessions FOR SELECT USING (true);
CREATE POLICY "sessions_update" ON sessions FOR UPDATE
    USING (device_id = current_setting('app.device_id', true));

-- Hazards: Anyone can read; only verified World ID users can insert
ALTER TABLE hazards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hazards_select" ON hazards FOR SELECT USING (true);
CREATE POLICY "hazards_insert" ON hazards FOR INSERT
    WITH CHECK (current_setting('app.world_verified', true) = 'true');

-- Hazard reports: Same as hazards
ALTER TABLE hazard_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hazard_reports_insert" ON hazard_reports FOR INSERT
    WITH CHECK (current_setting('app.world_verified', true) = 'true');
```

---

## Redis Key Patterns (Upstash)

| Key Pattern | Type | TTL | Contents |
|-------------|------|-----|---------|
| `session:{session_id}` | Hash | 1 hour | Session state (GPS, status, last_detection) |
| `session:audio:{session_id}` | List | 1 hour | Audio queue (max 3 items) |
| `hazards:{geohash6}` | String (JSON) | 60s | Cached proximity query results |
| `hazard_limit:{nullifier}:{date}` | String | Until midnight | Daily report count per human |
| `worldid:{nullifier}` | String | 24h | Verified World ID JWT |
| `ws:{session_id}` | String | 5m | WebSocket connection ID |

### Geohash Precision Reference

| Precision | Cell Size | Use |
|-----------|----------|-----|
| 4 | ~40km × 40km | Country-level |
| 5 | ~5km × 5km | City neighborhood |
| **6** | **~1.2km × 0.6km** | **Hazard cache (our choice)** |
| 7 | ~150m × 75m | Block-level |
| 8 | ~40m × 19m | Building-level |

---

## Pydantic Models (Backend)

```python
# backend/models/vision.py — 3D scene and detection models

from pydantic import BaseModel, Field
from typing import Literal

class Scene3DPoint(BaseModel):
    """A single point in the accumulated 3D scene."""
    x: float                              # metres, world frame
    y: float
    z: float
    r: int = Field(..., ge=0, le=255)     # RGB colour from source frame
    g: int = Field(..., ge=0, le=255)
    b: int = Field(..., ge=0, le=255)
    label: str | None = None              # semantic label if annotated, e.g. "curb_drop"
    confidence: float | None = None       # detection confidence [0.0–1.0]


class SceneView(BaseModel):
    """
    A synthetic 2D view rendered from the 3D point cloud.
    Passed to vision models in place of raw camera frames.
    """
    view_type: Literal["top_down", "current", "left", "right"]
    image_bytes: bytes                    # JPEG-encoded rendered image
    camera_matrix: list[list[float]]      # 3×4 projection matrix used for this render
                                          # stored to enable annotation back-projection


class ObjectAnnotation(BaseModel):
    """
    A single detected object — output from RCAC VLM or Gemini fallback.
    Combines 2D detection output with 3D coordinates after back-projection.
    """
    label: str                            # e.g. "curb_drop", "pole", "person", "door"
    bbox_2d: tuple[int, int, int, int]    # (x1, y1, x2, y2) in synthetic view pixels
    confidence: float = Field(..., ge=0.0, le=1.0)
    urgency: Literal["high", "medium", "low"]
    distance_m: float | None = None       # metric distance derived from 3D coords
    direction: Literal["ahead", "left", "right"] | None = None

    # 3D world-frame coordinates (populated by scene3d.apply_annotations)
    x_3d: float | None = None
    y_3d: float | None = None
    z_3d: float | None = None
```

---

```python
# backend/models/hazard.py

from enum import Enum
from pydantic import BaseModel, Field, validator
from datetime import datetime
from uuid import UUID

class HazardType(str, Enum):
    CONSTRUCTION = "construction"
    WET_FLOOR = "wet_floor"
    BROKEN_SIDEWALK = "broken_sidewalk"
    MISSING_CURB_CUT = "missing_curb_cut"
    OBSTACLE = "obstacle"
    STEP = "step"
    VEHICLE_BLOCKING = "vehicle_blocking"
    OTHER = "other"

class HazardSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class HazardSubmission(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    type: HazardType
    severity: HazardSeverity
    description: str | None = Field(None, max_length=500)
    photo_url: str | None = None

class Hazard(BaseModel):
    id: UUID
    lat: float
    lng: float
    type: HazardType
    severity: HazardSeverity
    description: str | None
    status: str
    report_count: int
    verified: bool
    on_chain_tx: str | None
    reported_at: datetime

class ProximityAlert(BaseModel):
    hazard_id: UUID
    type: HazardType
    severity: HazardSeverity
    description: str | None
    distance_m: float
    direction: str         # "ahead" | "left" | "right" | "behind"
    bearing_deg: float
    verified: bool
    verified_count: int
```

---

## TypeScript Types (Frontend)

```typescript
// apps/web/lib/types.ts

export type HazardType =
  | 'construction' | 'wet_floor' | 'broken_sidewalk'
  | 'missing_curb_cut' | 'obstacle' | 'step'
  | 'vehicle_blocking' | 'other'

export type HazardSeverity = 'low' | 'medium' | 'high' | 'critical'

export type Urgency = 'high' | 'medium' | 'low'

export type ViewType = 'top_down' | 'current' | 'left' | 'right'

/** A single detected object with 2D bbox and optional 3D world coordinates. */
export interface ObjectAnnotation {
  label: string                          // e.g. "curb_drop", "pole", "person"
  bbox_2d: [number, number, number, number]  // [x1, y1, x2, y2] in synthetic view px
  confidence: number                     // 0.0–1.0
  urgency: Urgency
  distance_m: number | null              // metric distance from user
  direction: 'ahead' | 'left' | 'right' | null
  x_3d: number | null                    // world-frame 3D coords after back-projection
  y_3d: number | null
  z_3d: number | null
}

/** A rendered synthetic view from the 3D scene. */
export interface SceneView {
  view_type: ViewType
  image_url: string                      // data URL or CDN URL of the rendered JPEG
}

export interface Hazard {
  id: string
  lat: number
  lng: number
  type: HazardType
  severity: HazardSeverity
  description: string | null
  status: 'submitted' | 'verified' | 'resolved' | 'expired'
  report_count: number
  verified: boolean
  on_chain_tx: string | null
  reported_at: string
}

export interface Session {
  id: string
  device_type: 'ray_ban' | 'phone_camera'
  status: 'active' | 'paused' | 'ended'
  location: { lat: number; lng: number } | null
  speed_mph: number | null
  last_detection_summary: string | null
  nearby_hazard_count: number
  last_seen_at: string
}

export interface Detection {
  timestamp: string
  type: 'object' | 'text' | 'hazard_alert' | 'scene'
  content: string
  urgency: 'urgent' | 'normal' | 'low'
}

export interface WorldIDVerification {
  nullifier_hash: string
  verification_level: 'orb' | 'device'
  verified_at: string
  reports_today: number
  reports_remaining_today: number
}
```
