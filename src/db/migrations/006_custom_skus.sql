CREATE TABLE IF NOT EXISTS custom_skus (
  id            SERIAL PRIMARY KEY,
  vendor_name   VARCHAR(200) NOT NULL,
  sku_name      VARCHAR(200) NOT NULL,
  rate          NUMERIC(10,4) DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE custom_skus ADD COLUMN IF NOT EXISTS plant_id INTEGER REFERENCES plants(id);
ALTER TABLE custom_skus DROP CONSTRAINT IF EXISTS custom_skus_vendor_name_sku_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS custom_skus_plant_vendor_sku_idx ON custom_skus(plant_id, vendor_name, sku_name);
