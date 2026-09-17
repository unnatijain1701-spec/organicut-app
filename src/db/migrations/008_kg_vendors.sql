CREATE TABLE IF NOT EXISTS kg_vendors (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE kg_vendors ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE kg_vendors ADD COLUMN IF NOT EXISTS plant_id      INTEGER REFERENCES plants(id);
ALTER TABLE kg_vendors DROP CONSTRAINT IF EXISTS kg_vendors_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS kg_vendors_plant_name_idx ON kg_vendors(plant_id, name);
