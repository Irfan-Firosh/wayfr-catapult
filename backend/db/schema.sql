-- wayfr Supabase schema
-- Run this in the Supabase SQL editor to set up the database.

-- Enable PostGIS extension for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── hazards ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hazards (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    severity            TEXT NOT NULL DEFAULT 'low'
                            CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    lat                 DOUBLE PRECISION NOT NULL,
    lng                 DOUBLE PRECISION NOT NULL,
    location            GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                            ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
                        ) STORED,
    reporter_nullifier  TEXT NOT NULL,
    verified            BOOLEAN NOT NULL DEFAULT FALSE,
    verifier_count      INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for fast proximity queries
CREATE INDEX IF NOT EXISTS hazards_location_idx ON hazards USING GIST(location);
CREATE INDEX IF NOT EXISTS hazards_severity_idx  ON hazards (severity);
CREATE INDEX IF NOT EXISTS hazards_verified_idx  ON hazards (verified);

-- ── sessions (lightweight metadata only, no video) ────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_key TEXT UNIQUE NOT NULL,   -- 6-char ID from frontend (e.g. "A3F9B2")
    status      TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'ended', 'error')),
    frame_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RPC: hazards within radius ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION hazards_within_radius(
    user_lat  DOUBLE PRECISION,
    user_lng  DOUBLE PRECISION,
    radius_m  DOUBLE PRECISION DEFAULT 100
)
RETURNS SETOF hazards AS $$
    SELECT *
    FROM   hazards
    WHERE  ST_DWithin(
               location,
               ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
               radius_m
           )
    ORDER  BY location <-> ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    LIMIT  50;
$$ LANGUAGE sql STABLE;

-- ── RPC: count unique reporters at a location ────────────────────────────
CREATE OR REPLACE FUNCTION count_unique_reporters_at(
    lat       DOUBLE PRECISION,
    lng       DOUBLE PRECISION,
    radius_m  DOUBLE PRECISION DEFAULT 20
)
RETURNS TABLE(count BIGINT) AS $$
    SELECT COUNT(DISTINCT reporter_nullifier)
    FROM   hazards
    WHERE  ST_DWithin(
               location,
               ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
               radius_m
           );
$$ LANGUAGE sql STABLE;

-- ── Row Level Security ────────────────────────────────────────────────────
ALTER TABLE hazards  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Anyone can read hazards (public map)
CREATE POLICY "hazards_read_public"  ON hazards  FOR SELECT USING (true);
-- Only service role can insert/update (backend uses service key)
CREATE POLICY "hazards_write_service" ON hazards FOR ALL TO service_role USING (true);
CREATE POLICY "sessions_all_service"  ON sessions FOR ALL TO service_role USING (true);

-- ── home_maps ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS home_maps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing', 'ready', 'failed')),
    error       TEXT,
    num_objects INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE home_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "home_maps_all_service" ON home_maps FOR ALL TO service_role USING (true);

-- ── object_positions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS object_positions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    home_id        UUID NOT NULL REFERENCES home_maps(id) ON DELETE CASCADE,
    label          TEXT NOT NULL,
    track_id       INTEGER,
    x              DOUBLE PRECISION NOT NULL,
    y              DOUBLE PRECISION NOT NULL,
    z              DOUBLE PRECISION NOT NULL,
    bbox_min       DOUBLE PRECISION[3],
    bbox_max       DOUBLE PRECISION[3],
    confidence     DOUBLE PRECISION,
    n_observations INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS object_positions_home_id_idx ON object_positions (home_id);
CREATE INDEX IF NOT EXISTS object_positions_label_idx   ON object_positions (label);

ALTER TABLE object_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "object_positions_all_service" ON object_positions FOR ALL TO service_role USING (true);

-- ── Storage buckets (for GLB scenes and HLoc references) ────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('home-scenes', 'home-scenes', false),
       ('home-references', 'home-references', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'service_role_all_home_scenes'
      AND tablename  = 'objects'
      AND schemaname = 'storage'
  ) THEN
    CREATE POLICY "service_role_all_home_scenes"
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'home-scenes');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'service_role_all_home_references'
      AND tablename  = 'objects'
      AND schemaname = 'storage'
  ) THEN
    CREATE POLICY "service_role_all_home_references"
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'home-references');
  END IF;
END
$$;

-- ── Seed: 3 demo hazards in West Lafayette, IN (for hackathon demo) ───────
INSERT INTO hazards (label, description, severity, lat, lng, reporter_nullifier, verified, verifier_count)
VALUES
  ('wet_floor',    'Large puddle at building entrance', 'high',   40.4259, -86.9081, 'demo-nullifier-1', TRUE,  4),
  ('uneven_path',  'Cracked pavement, raised edge ~3cm', 'medium', 40.4251, -86.9074, 'demo-nullifier-2', TRUE,  3),
  ('low_branch',   'Tree branch at head height',          'medium', 40.4265, -86.9088, 'demo-nullifier-3', FALSE, 1)
ON CONFLICT DO NOTHING;
