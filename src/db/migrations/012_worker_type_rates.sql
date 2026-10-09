-- Worker type rates: per-plant daily wage rates for each designation (Worker, Labour, Cutter, etc.)
CREATE TABLE IF NOT EXISTS worker_type_rates (
  id            SERIAL PRIMARY KEY,
  plant_id      INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  rate          NUMERIC(10,2) NOT NULL DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (plant_id, name)
);

-- Store per-contractor designation counts alongside existing workers total and cost.
-- JSON structure: { "Worker": 62, "Labour": 9, "Cutter": 3 }
ALTER TABLE contractor_attendance ADD COLUMN IF NOT EXISTS designations JSONB DEFAULT '{}';
