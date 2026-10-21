-- Action items generated from insights findings (Layers 2-3).
-- Tracks recommendations, estimated savings, ownership and resolution.
CREATE TABLE IF NOT EXISTS insight_actions (
  id              SERIAL PRIMARY KEY,
  plant_id        INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  month           VARCHAR(7) NOT NULL,           -- 'YYYY-MM' the finding belongs to
  finding_type    VARCHAR(40) NOT NULL,           -- vendor_rate | attendance_jump | sku_rate | missing_days | variance_att | variance_kg | manual
  finding_ref     TEXT,                           -- human-readable reference (vendor name, SKU, etc.)
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  estimated_saving NUMERIC(14,2),                 -- optional ₹ estimate
  baseline_mpk    NUMERIC(10,4),                  -- MPK at the time the action was created
  actual_mpk      NUMERIC(10,4),                  -- MPK after completion (filled on close)
  owner           VARCHAR(100),                   -- person responsible
  due_date        DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'open',  -- open | in_progress | completed | dismissed
  priority        VARCHAR(10) DEFAULT 'medium',   -- low | medium | high
  resolution_note TEXT,
  created_by      VARCHAR(100),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insight_actions_plant_month ON insight_actions(plant_id, month);
CREATE INDEX IF NOT EXISTS idx_insight_actions_status ON insight_actions(status);
