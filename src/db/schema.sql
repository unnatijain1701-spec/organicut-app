-- Organicut Fresh — database schema

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_records (
  id              SERIAL PRIMARY KEY,
  record_date     DATE UNIQUE NOT NULL,
  attendance_cost NUMERIC(12,2) DEFAULT 0,
  kg_cost         NUMERIC(12,2) DEFAULT 0,
  total_cost      NUMERIC(12,2) DEFAULT 0,
  sale_qty        NUMERIC(12,2) DEFAULT 0,
  mpk             NUMERIC(12,4) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contractor_attendance (
  id              SERIAL PRIMARY KEY,
  record_id       INTEGER REFERENCES daily_records(id) ON DELETE CASCADE,
  contractor_name VARCHAR(200) NOT NULL,
  workers         INTEGER DEFAULT 0,
  cost            NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendor_kg_entries (
  id          SERIAL PRIMARY KEY,
  record_id   INTEGER REFERENCES daily_records(id) ON DELETE CASCADE,
  vendor_name VARCHAR(200) NOT NULL,
  sku_name    VARCHAR(200) NOT NULL,
  rate        NUMERIC(10,4) DEFAULT 0,
  qty         NUMERIC(12,2) DEFAULT 0,
  cost        NUMERIC(12,2) DEFAULT 0
);

-- KG vendors (dynamic list, seeded with defaults)
CREATE TABLE IF NOT EXISTS kg_vendors (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO kg_vendors (name, sort_order) VALUES
  ('Ashok', 1), ('RS', 2), ('MP', 3), ('RJ', 4), ('BL Unloading', 5)
ON CONFLICT (name) DO NOTHING;

-- Custom SKUs added by the user (beyond the hardcoded defaults)
CREATE TABLE IF NOT EXISTS custom_skus (
  id           SERIAL PRIMARY KEY,
  vendor_name  VARCHAR(200) NOT NULL,
  sku_name     VARCHAR(200) NOT NULL,
  rate         NUMERIC(10,4) DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_name, sku_name)
);
