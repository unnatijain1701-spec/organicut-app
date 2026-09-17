CREATE TABLE IF NOT EXISTS daily_records (
  id              SERIAL PRIMARY KEY,
  record_date     DATE NOT NULL,
  attendance_cost NUMERIC(12,2) DEFAULT 0,
  kg_cost         NUMERIC(12,2) DEFAULT 0,
  total_cost      NUMERIC(12,2) DEFAULT 0,
  sale_qty        NUMERIC(12,2) DEFAULT 0,
  mpk             NUMERIC(12,4) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS plant_id   INTEGER REFERENCES plants(id);
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS locked     BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_record_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS daily_records_plant_date_idx ON daily_records(plant_id, record_date);
