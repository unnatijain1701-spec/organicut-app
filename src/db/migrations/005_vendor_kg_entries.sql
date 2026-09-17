CREATE TABLE IF NOT EXISTS vendor_kg_entries (
  id          SERIAL PRIMARY KEY,
  record_id   INTEGER REFERENCES daily_records(id) ON DELETE CASCADE,
  vendor_name VARCHAR(200) NOT NULL,
  sku_name    VARCHAR(200) NOT NULL,
  rate        NUMERIC(10,4) DEFAULT 0,
  qty         NUMERIC(12,2) DEFAULT 0,
  cost        NUMERIC(12,2) DEFAULT 0
);
