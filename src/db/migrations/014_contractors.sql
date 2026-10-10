-- Canonical, per-plant contractor list — replaces free-typed contractor names (the
-- source of the "Factotum / Foctotum / FACTOUM / Factotum Manpower" fragmentation).
CREATE TABLE IF NOT EXISTS contractors (
  id            SERIAL PRIMARY KEY,
  plant_id      INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plant_id, name)
);

-- Maps a raw spelling (from an old free-text manual entry, or a biometric CSV export's
-- own naming) onto a canonical contractor. Resolved once, remembered forever — the same
-- raw spelling in a future CSV auto-resolves without asking again.
CREATE TABLE IF NOT EXISTS contractor_aliases (
  id            SERIAL PRIMARY KEY,
  plant_id      INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  raw_name      VARCHAR(200) NOT NULL,
  UNIQUE (plant_id, raw_name)
);
