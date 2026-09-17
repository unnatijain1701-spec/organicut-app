-- Persists default SKU rate edits across devices (replaces localStorage)
CREATE TABLE IF NOT EXISTS sku_rate_overrides (
  vendor_name VARCHAR(200) NOT NULL,
  sku_index   INTEGER NOT NULL,
  rate        NUMERIC(10,4) DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sku_rate_overrides ADD COLUMN IF NOT EXISTS plant_id INTEGER REFERENCES plants(id);
ALTER TABLE sku_rate_overrides DROP CONSTRAINT IF EXISTS sku_rate_overrides_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS sku_rate_overrides_plant_vendor_idx ON sku_rate_overrides(plant_id, vendor_name, sku_index);
