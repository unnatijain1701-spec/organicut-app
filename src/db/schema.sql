-- Organicut Fresh — database schema

CREATE TABLE IF NOT EXISTS plants (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) UNIQUE NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plants (name, display_order) VALUES
  ('Rai',       1),
  ('Jaipur',    2),
  ('Hyderabad', 3),
  ('Bangalore', 4),
  ('Mumbai',    5)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role     VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plant_id INTEGER REFERENCES plants(id);

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

ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS plant_id INTEGER REFERENCES plants(id);

-- Replace single-date unique with per-plant unique
ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_record_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS daily_records_plant_date_idx ON daily_records(plant_id, record_date);

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

CREATE TABLE IF NOT EXISTS kg_vendors (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE kg_vendors ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE kg_vendors ADD COLUMN IF NOT EXISTS plant_id      INTEGER REFERENCES plants(id);

-- Drop old global unique; replace with per-plant unique
ALTER TABLE kg_vendors DROP CONSTRAINT IF EXISTS kg_vendors_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS kg_vendors_plant_name_idx ON kg_vendors(plant_id, name);

-- Seed Rai's default vendors (plant_id = 1) — only if they don't exist yet
INSERT INTO kg_vendors (name, display_order, plant_id)
SELECT v.name, v.display_order, p.id
FROM (VALUES
  ('Ashok',        1),
  ('RS',           2),
  ('MP',           3),
  ('RJ',           4),
  ('BL Unloading', 5)
) AS v(name, display_order)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Rai') AS p
WHERE NOT EXISTS (
  SELECT 1 FROM kg_vendors kv WHERE kv.plant_id = p.id AND kv.name = v.name
);

-- ── Migration: tag all existing rows as Rai ──────────────────────────────────
UPDATE daily_records      SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;
UPDATE kg_vendors         SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;
UPDATE custom_skus        SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;
UPDATE sku_rate_overrides SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;

-- Promote any existing admin with no plant to superadmin
UPDATE users SET role = 'superadmin' WHERE role = 'admin' AND plant_id IS NULL;
