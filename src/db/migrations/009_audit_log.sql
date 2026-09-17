-- Audit log — records who deleted data (full-day deletes + vendor/SKU removals on save)
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  plant_id    INTEGER REFERENCES plants(id),
  record_date DATE,
  action      VARCHAR(40) NOT NULL,
  details     TEXT,
  username    VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_plant_created_idx ON audit_log(plant_id, created_at DESC);
