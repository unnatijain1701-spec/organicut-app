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

-- Drop index first so duplicate cleanup doesn't hit constraint violations
DROP INDEX IF EXISTS daily_records_plant_date_idx;
DELETE FROM daily_records a
USING daily_records b
WHERE a.plant_id IS NULL
  AND b.plant_id = (SELECT id FROM plants WHERE name = 'Rai')
  AND a.record_date = b.record_date;
UPDATE daily_records SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;

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
UPDATE custom_skus SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;

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
UPDATE sku_rate_overrides SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;

ALTER TABLE sku_rate_overrides DROP CONSTRAINT IF EXISTS sku_rate_overrides_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS sku_rate_overrides_plant_vendor_idx ON sku_rate_overrides(plant_id, vendor_name, sku_index);

CREATE TABLE IF NOT EXISTS kg_vendors (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE kg_vendors ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE kg_vendors ADD COLUMN IF NOT EXISTS plant_id      INTEGER REFERENCES plants(id);

-- Drop unique index so we can safely clean up any duplicate rows left by previous failed migrations
DROP INDEX IF EXISTS kg_vendors_plant_name_idx;

-- Remove NULL-plant rows that already have a Rai duplicate (left by previous crash)
DELETE FROM kg_vendors a
USING kg_vendors b
WHERE a.plant_id IS NULL
  AND b.plant_id = (SELECT id FROM plants WHERE name = 'Rai')
  AND a.name = b.name;

-- Migrate remaining NULL rows to Rai
UPDATE kg_vendors SET plant_id = (SELECT id FROM plants WHERE name = 'Rai') WHERE plant_id IS NULL;

-- Drop old global unique; recreate as per-plant unique
ALTER TABLE kg_vendors DROP CONSTRAINT IF EXISTS kg_vendors_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS kg_vendors_plant_name_idx ON kg_vendors(plant_id, name);

-- Seed Rai's default vendors — skips any already migrated above
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
ON CONFLICT DO NOTHING;

-- Seed Mumbai vendor
INSERT INTO kg_vendors (name, display_order, plant_id)
SELECT 'Daksh enterprises', 1, p.id FROM plants p WHERE p.name = 'Mumbai'
ON CONFLICT DO NOTHING;

-- Seed Hyderabad vendor
INSERT INTO kg_vendors (name, display_order, plant_id)
SELECT 'Daksh enterprises', 1, p.id FROM plants p WHERE p.name = 'Hyderabad'
ON CONFLICT DO NOTHING;

-- Seed Mumbai custom SKUs (Daksh enterprises)
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, 'Daksh enterprises', v.sku_name, v.rate, v.ord
FROM (VALUES
  ('Capsicum Dipling',   2.80,  1),
  ('Capsicum Shorting',  1.20,  2),
  ('Onion Shorting',     1.20,  3),
  ('Onion Peeling',      3.20,  4),
  ('Onion Cutting',      3.25,  5),
  ('Packing',            1.20,  6),
  ('Punnet Packing',     0.50,  7),
  ('Tomato Dipling',     3.50,  8),
  ('Tomato Cutting',     3.50,  9),
  ('Potato Peeling',     5.25, 10),
  ('Potato Cutting',     4.00, 11),
  ('Onion 1kg Packing',  1.00, 12),
  ('Onion 3kg Packing',  3.00, 13),
  ('Drumstick Cutting',  3.00, 14),
  ('Pumpkin Cutting',    6.00, 15),
  ('Cauliflower Cutting',4.00, 16),
  ('Pineapple Peeling',  7.00, 17)
) AS v(sku_name, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Mumbai') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Seed Hyderabad custom SKUs (Daksh enterprises)
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, 'Daksh enterprises', v.sku_name, v.rate, v.ord
FROM (VALUES
  ('Capsicum Decoring',           3.10, 1),
  ('Onion & Capsicum Shorting',   1.20, 2),
  ('Packing',                     1.20, 3),
  ('W. Onion Cutting',            3.10, 4),
  ('Tecobell/PH/KFC Onion Cutting', 6.00, 5),
  ('Carrot Cut',                  4.00, 6),
  ('Potato Cut',                  6.00, 7),
  ('Mushroom Cut',                3.00, 8)
) AS v(sku_name, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Hyderabad') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Promote any existing admin with no plant to superadmin
UPDATE users SET role = 'superadmin' WHERE role = 'admin' AND plant_id IS NULL;
