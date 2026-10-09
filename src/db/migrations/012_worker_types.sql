-- Named worker types with an editable daily rate, so manual attendance entry can
-- auto-calculate cost the same way CSV upload already does (via its per-row
-- "Work Station" wage). A NULL plant_id row is a global default; a plant-specific
-- row with the same name overrides it for that plant only.
CREATE TABLE IF NOT EXISTS worker_types (
  id            SERIAL PRIMARY KEY,
  plant_id      INTEGER REFERENCES plants(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  daily_rate    NUMERIC(10,2) NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plant_id, name)
);

-- Per-worker-type breakdown of a contractor_attendance row — persists what used to
-- be a CSV-upload-only, never-saved client-side computation. rate_used is snapshotted
-- at save time (not a live lookup into worker_types), so a later rate change never
-- silently rewrites historical cost.
CREATE TABLE IF NOT EXISTS contractor_attendance_types (
  id            SERIAL PRIMARY KEY,
  attendance_id INTEGER NOT NULL REFERENCES contractor_attendance(id) ON DELETE CASCADE,
  worker_type   VARCHAR(100) NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  rate_used     NUMERIC(10,2),
  cost          NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cat_attendance_id ON contractor_attendance_types(attendance_id);
