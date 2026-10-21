-- Plant-level monthly targets: optional target MPK per plant per month.
-- Used by Layer 4 (Forecasting) to show On track / At risk / Over status.
-- When no target is set, the previous month's actual MPK is used as baseline.
CREATE TABLE IF NOT EXISTS plant_targets (
  id           SERIAL PRIMARY KEY,
  plant_id     INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  month        VARCHAR(7) NOT NULL,  -- 'YYYY-MM'
  target_mpk   NUMERIC(10,4) NOT NULL,
  target_cost  NUMERIC(14,2),        -- optional overall cost budget
  target_qty   NUMERIC(14,2),        -- optional volume target
  notes        TEXT,
  created_by   VARCHAR(100),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plant_id, month)
);
