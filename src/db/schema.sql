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

-- Seed Rai custom SKUs — MP vendor
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, 'MP', v.sku_name, v.rate, v.ord
FROM (VALUES
  ('TOMATO DECORING',                   4.25,  1),
  ('TOMATO CUTTING',                    4.30,  2),
  ('TOMATO CUTTING 10x10',              7.50,  3),
  ('TOMATO SHORTING',                   1.50,  4),
  ('TOMATO SORTING',                    1.50,  5),
  ('ONION CHOPPED',                     9.00,  6),
  ('RED ONION SLICE CUTTING',           6.00,  7),
  ('RED ONION PIZZA HUT CUTTING',       6.00,  8),
  ('ONION SHORTING (ARVIND)',            1.50,  9),
  ('ONION PEELED',                      3.25, 10),
  ('LETTUCE SHORTING',                  5.00, 11),
  ('GREEN CAPSICUM DEPLING',            4.20, 12),
  ('GREEN CAPSICUM SHORTING (ARVIND)',  1.50, 13),
  ('CORIANDER SHORTING (ARVIND)',       5.00, 14),
  ('CORIANDER PACKING',                 0.80, 15),
  ('PALAK SHORTING',                    5.00, 16),
  ('CAPSICUM CUTTING',                  4.20, 17),
  ('CAPSICUM DEPLING (RAVI)',            4.20, 18),
  ('W. ONION CUTTING',                  3.80, 19),
  ('GREEN CAPSICUM SHORTING (RAVI)',    1.83, 20),
  ('ONION SHORTING (RAVI)',             1.60, 21),
  ('GREEN CHILLI SHORTING',             1.60, 22),
  ('RED ONION PEELED SHORTING',         1.50, 23),
  ('PACKING',                           1.15, 24),
  ('MUSHOOM CUTTING',                   5.00, 25),
  ('CAPSICUM RM SHORTING',              1.50, 26),
  ('RED ONION (PEELED)',                3.25, 27),
  ('CAULIFLOWER CUTTING',               4.00, 28),
  ('CAPSICUM DICED (BVEG)',             6.00, 29),
  ('FROZEN CORIANDER (BOX)',            2.00, 30),
  ('CORIANDER SHORTING FINAL',         10.00, 31),
  ('ASH GUARD',                         6.50, 32),
  ('ONION SLICE PIZZA HUT',             6.00, 33),
  ('R.ONION (RAMAKANT)',                3.25, 34),
  ('R.ONION (SURAJ)',                   3.25, 35),
  ('R. ONION (RAMBABU)',                3.25, 36),
  ('W.ONION (RAMAKANT)',                3.25, 37),
  ('W.ONION (SURAJ)',                   3.25, 38),
  ('W. ONION (RAMBABU)',                3.25, 39),
  ('SHYAM RED ONION',                   3.25, 40),
  ('SHYAM WHITE ONION',                 3.25, 41),
  ('SHAKER RED ONION',                  3.25, 42),
  ('ARVIND RED ONION',                  3.25, 43),
  ('RAJNATH RED ONION',                 3.25, 44)
) AS v(sku_name, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Rai') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Seed Rai custom SKUs — Ashok vendor
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, 'Ashok', v.sku_name, v.rate, v.ord
FROM (VALUES
  ('RM UNLoading',            0.20, 1),
  ('RM Loading',              0.20, 2),
  ('RM Shifting to Crates',   0.20, 3),
  ('RM Shifting To Coldroom', 0.20, 4),
  ('FG Loading',              0.20, 5),
  ('FG UNloading',            0.20, 6),
  ('Punnet Box',              0.20, 7),
  ('Bardana',                 0.20, 8),
  ('Pallet Shifting',         0.20, 9)
) AS v(sku_name, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Rai') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Seed Rai custom SKUs — RS vendor
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, 'RS', v.sku_name, v.rate, v.ord
FROM (VALUES
  ('CARROT PEELED 522',            4.50,  1),
  ('GREEN CHILLI DE-STEMMED 522',  7.50,  2),
  ('ACHARI MIRCH DE-STEMMED 522',  2.80,  3),
  ('FRENCH BEANS 522',             6.00,  4),
  ('GINGER 522',                   9.00,  5),
  ('POTATO PEELED 576',            5.50,  6),
  ('BHINDI TOP/BOTTEM',            8.00,  7),
  ('Sirka Onion',                  7.00,  8),
  ('GREEN CHILI SHORTING',         1.50,  9),
  ('CARROT LACCHA (GAJAR HALWA)',  6.00, 10),
  ('RED ONION PEELING 522',        3.25, 11),
  ('WHITE ONION PEELING 522',      3.25, 12),
  ('POMEGRANATE PEELING 576',     20.00, 13),
  ('GREEN PEAS PEELING',          18.00, 14),
  ('BEETROOT PEELING',             8.00, 15),
  ('Rebel Food Packing',           2.50, 16),
  ('HALDIRAM RTU PACKING',         2.50, 17),
  ('HALDIRAM WHOLE PACKING',       2.50, 18),
  ('SUBWAY PACKING',               2.50, 19),
  ('RED POTATO PACKING',           2.50, 20)
) AS v(sku_name, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Rai') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Seed Rai custom SKUs — RJ vendor
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, 'RJ', v.sku_name, v.rate, v.ord
FROM (VALUES
  ('RED PUMPKIN',            7.50,  1),
  ('ASH GOURD',              6.50,  2),
  ('CARROT DICED',           6.75,  3),
  ('POTATO CUT',             2.70,  4),
  ('PUMPKIN DICE CUT',       7.50,  5),
  ('RTE BIRYANI BEANS CUT',  6.75,  6),
  ('ONION CUT 10x10',        9.00,  7),
  ('ONION CUT 14x14',        9.00,  8),
  ('ONION SLICE',            6.00,  9),
  ('BEANS DIMOND CUT',       7.25, 10),
  ('MUSHROOM',               5.00, 11),
  ('TOMATO CUTTING',         4.30, 12),
  ('JACKFRUIT CUT',         10.00, 13),
  ('PACKING',                1.15, 14)
) AS v(sku_name, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Rai') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Seed Rai custom SKUs — BL Unloading vendor
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, 'BL Unloading', v.sku_name, v.rate, v.ord
FROM (VALUES
  ('RM UNLoading',            0.20, 1),
  ('RM Loading',              0.20, 2),
  ('RM Shifting to Crates',   0.20, 3),
  ('RM Shifting To Coldroom', 0.20, 4),
  ('FG Loading',              0.20, 5),
  ('FG UNloading',            0.20, 6),
  ('Punnet Box',              0.20, 7),
  ('Bardana',                 0.20, 8),
  ('Pallet Shifting',         0.20, 9)
) AS v(sku_name, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Rai') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Promote any existing admin with no plant to superadmin
UPDATE users SET role = 'superadmin' WHERE role = 'admin' AND plant_id IS NULL;

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


-- ============================================================
-- Bangalore customer-wise pricing seed (auto-generated)
-- Adds one vendor tab per customer + their SKUs with new rates.
-- Safe: ON CONFLICT DO NOTHING — does not overwrite existing data.
-- Existing Bangalore SKUs / records are untouched.
-- ============================================================

-- 1) Customer tabs (vendors)
INSERT INTO kg_vendors (name, display_order, plant_id)
SELECT v.name, v.ord, p.id FROM (VALUES
  ('ITC', 11),
  ('Gopizza', 12),
  ('Peppercorn', 13),
  ('Griffith', 14),
  ('Jubilant', 15),
  ('Shilton', 16),
  ('Amicus (Salad Days)', 17),
  ('Compass', 18),
  ('Taj SATS', 19),
  ('Swiggy', 20)
) AS v(name, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, name) DO NOTHING;

-- 2) SKUs per customer tab
-- ITC
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('ITC', 'Ladyfinger', 8, 1)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Gopizza
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Gopizza', 'Onion Slice decoring', 4.275, 1),
  ('Gopizza', 'Capsicum decoring', 4.36, 2)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Peppercorn
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Peppercorn', 'Peeled Onion', 5.575, 1),
  ('Peppercorn', 'Potato', 16.3, 2)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Griffith
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Griffith', 'Chilli Green Destem', 7, 1),
  ('Griffith', 'Peeled Onion Peeling', 4.275, 2)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Jubilant
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Jubilant', 'Capsicum Cut', 5.69, 1),
  ('Jubilant', 'Onion Cut', 11.215, 2),
  ('Jubilant', 'Tomato Cut', 10.86, 3),
  ('Jubilant', 'Mushroom Cut', 5.5, 4)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Shilton
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Shilton', 'Baby Corn', 9, 1),
  ('Shilton', 'Beetroot', 9, 2),
  ('Shilton', 'Coriander', 9, 3),
  ('Shilton', 'Bitter gourd', 9, 4),
  ('Shilton', 'Green Cabbage', 9, 5),
  ('Shilton', 'Spinach', 9, 6),
  ('Shilton', 'Ladyfinger', 9, 7),
  ('Shilton', 'Long Beans', 9, 8),
  ('Shilton', 'Mushroom', 1.3, 9),
  ('Shilton', 'Peeled Sambhar Onion', 1.3, 10),
  ('Shilton', 'Spring Onion', 1.3, 11),
  ('Shilton', 'Banana Raw small dice', 9, 12),
  ('Shilton', 'Beans cluster small dice', 9, 13),
  ('Shilton', 'Bottle Guard Dice', 9, 14),
  ('Shilton', 'Broccoli Florettes', 9, 15),
  ('Shilton', 'Cabbage Green small dice', 9, 16),
  ('Shilton', 'Carrot Diamond Cut', 18.3, 17),
  ('Shilton', 'Carrot Small Dice', 9, 18),
  ('Shilton', 'Cauliflower Florets', 9, 19),
  ('Shilton', 'Chow Chow Small Dice', 9, 20),
  ('Shilton', 'Curry Leaves', 9, 21),
  ('Shilton', 'Drumsticks Finger cut', 9, 22),
  ('Shilton', 'Garlic Chopped', 4, 23),
  ('Shilton', 'Green Capsicum whole', 1.3, 24),
  ('Shilton', 'Green Chilli Destem', 7, 25),
  ('Shilton', 'Haricot Beans Diamond cut', 9, 26),
  ('Shilton', 'Hericot Beans small dice', 9, 27),
  ('Shilton', 'Onion Red Chopped', 4.275, 28),
  ('Shilton', 'Onion Red Peeled', 4.275, 29),
  ('Shilton', 'Onion Red Sliced', 11.575, 30),
  ('Shilton', 'Pumpkin Red Large Dice Sambar', 9, 31),
  ('Shilton', 'Red Capsicum Whole', 1.3, 32),
  ('Shilton', 'Ridge Gourd small dice', 9, 33),
  ('Shilton', 'Snake Guard small dice', 9, 34),
  ('Shilton', 'Tindli Dice cut', 9, 35),
  ('Shilton', 'Yellow Capsicum Whole', 1.3, 36),
  ('Shilton', 'Zucchini Green whole', 1.3, 37),
  ('Shilton', 'Zucchini Yellow whole', 1.3, 38),
  ('Shilton', 'Carrot Orange Julienne', 18.8, 39)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Amicus (Salad Days)
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Amicus (Salad Days)', 'Onion', 4.275, 1),
  ('Amicus (Salad Days)', 'Ginger', 46, 2),
  ('Amicus (Salad Days)', 'Pomegranate', 24, 3)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Compass
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Compass', 'Beetroot Peeled', 4.6, 1),
  ('Compass', 'Baby Corn Peeled', 4.6, 2),
  ('Compass', 'Cabbage', 4.6, 3),
  ('Compass', 'Cabbage Red Shredded', 4.6, 4),
  ('Compass', 'Capsicum Green', 4.6, 5),
  ('Compass', 'Capsicum Red Cut', 4.6, 6),
  ('Compass', 'Capsicum Yellow', 4.6, 7),
  ('Compass', 'Carrot Orange Cut', 16.3, 8),
  ('Compass', 'Carrot Orange Peeled', 8.3, 9),
  ('Compass', 'Dill Leaves cleaned', 4.6, 10),
  ('Compass', 'Ginger Peeled', 47.3, 11),
  ('Compass', 'Garlic Peeled', 4.6, 12),
  ('Compass', 'Mushroom 1/2 Cut', 4.6, 13),
  ('Compass', 'Mushroom 1/4 Cut', 4.6, 14),
  ('Compass', 'Onion Chopped', 8.875, 15),
  ('Compass', 'Onion Peeled', 8.875, 16),
  ('Compass', 'Potato Chopped', 12.3, 17),
  ('Compass', 'Potato Peeled', 8.3, 18),
  ('Compass', 'Pumpkin Red Cut', 4.6, 19),
  ('Compass', 'Ridge Gourd', 4.6, 20),
  ('Compass', 'Spinach Cut', 4.6, 21),
  ('Compass', 'Spring Onion Chopped', 4.6, 22),
  ('Compass', 'Bitter Gourd', 4.6, 23),
  ('Compass', 'Bottlegourd', 4.6, 24),
  ('Compass', 'Knolkhol', 4.6, 25),
  ('Compass', 'Zucchini Green Cut', 4.6, 26),
  ('Compass', 'Chow Chow', 4.6, 27),
  ('Compass', 'Curry Leaves', 4.6, 28),
  ('Compass', 'Green Chilli', 4.6, 29),
  ('Compass', 'Drumstick', 4.6, 30),
  ('Compass', 'Methi', 4.6, 31),
  ('Compass', 'Onion SambarSmall', 4.6, 32),
  ('Compass', 'Radish White', 4.6, 33),
  ('Compass', 'Tendli', 4.6, 34),
  ('Compass', 'Yam', 4.6, 35),
  ('Compass', 'Cluster Beans', 4.6, 36),
  ('Compass', 'Pumpkin White', 4.6, 37),
  ('Compass', 'Raw Banana', 4.6, 38),
  ('Compass', 'Snake Gourd', 4.6, 39),
  ('Compass', 'Papaya', 10.8, 40),
  ('Compass', 'Beetroot Slices', 4.6, 41),
  ('Compass', 'Okra Ring', 4.6, 42),
  ('Compass', 'Zucchini Yellow', 4.6, 43),
  ('Compass', 'Jack Fruit Cubed', 4.6, 44),
  ('Compass', 'Pineapple Cubes', 10.8, 45),
  ('Compass', 'Watermelon Cubes', 10.8, 46),
  ('Compass', 'Muskmelon', 10.8, 47),
  ('Compass', 'Brinjal Round', 4.6, 48),
  ('Compass', 'Sweet Potato', 4.6, 49),
  ('Compass', 'Dent Leaves', 4.6, 50)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Taj SATS
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Taj SATS', 'BABY CORN BATON', 9, 1),
  ('Taj SATS', 'BEANS BATTON', 30.3, 2),
  ('Taj SATS', 'BEANS HARICOT', 30.3, 3),
  ('Taj SATS', 'BEETROOT CUBE', 9, 4),
  ('Taj SATS', 'BOTTLEGOURD CUBE SEEDLESS 1CM', 9, 5),
  ('Taj SATS', 'BRINJAL BHARTA CUBE', 9, 6),
  ('Taj SATS', 'CABBAGE SHREDDED', 9, 7),
  ('Taj SATS', 'CARROT BATON', 18.3, 8),
  ('Taj SATS', 'CARROT DICED', 18.3, 9),
  ('Taj SATS', 'CARROT JULIENNE', 18.3, 10),
  ('Taj SATS', 'CHILLI BHAJI RING CUT', 9, 11),
  ('Taj SATS', 'CORIANDER W/O ROOTS', 9, 12),
  ('Taj SATS', 'CURRY LEAVES PEALED', 9, 13),
  ('Taj SATS', 'GARLIC PEELED', 9, 14),
  ('Taj SATS', 'GINGER PEELED', 47.3, 15),
  ('Taj SATS', 'GREEN CHILLI CHOPPED', 9, 16),
  ('Taj SATS', 'LADIES FINGER RINGCUT', 9, 17),
  ('Taj SATS', 'MIXED CAPSICUM CHOPPED', 13.39, 18),
  ('Taj SATS', 'MIXED CAPSICUM JULIENNE', 13.39, 19),
  ('Taj SATS', 'MUSHROOM SLICE', 9, 20),
  ('Taj SATS', 'ONION PEELED', 9, 21),
  ('Taj SATS', 'ONION SLICED', 11.575, 22),
  ('Taj SATS', 'PARVAL CUBE', 9, 23),
  ('Taj SATS', 'PEELED CARROT', 9, 24),
  ('Taj SATS', 'PEELED MINT', 9, 25),
  ('Taj SATS', 'PEELED SAMBHAR ONION', 9, 26),
  ('Taj SATS', 'POTATO CUBE', 12.3, 27),
  ('Taj SATS', 'POTATO DICED', 16.3, 28),
  ('Taj SATS', 'POTATO PEELED', 8.3, 29),
  ('Taj SATS', 'POTATO SLICE', 14.3, 30),
  ('Taj SATS', 'POTATO WEDGES', 14.3, 31),
  ('Taj SATS', 'PUMPKIN DICE 1CM', 9, 32),
  ('Taj SATS', 'SPINACH LEAVES WITHOUT ROOTS & STUM', 9, 33),
  ('Taj SATS', 'TONDLI 1/4 CUT', 9, 34),
  ('Taj SATS', 'WHITE PUMPKIN DICE', 9, 35),
  ('Taj SATS', 'ZUCCHINI GREEN', 9, 36),
  ('Taj SATS', 'ZUCCHINI GREEN DIAMOND CUT', 9, 37),
  ('Taj SATS', 'ZUCCHINI MIXED JULLIENE', 9, 38),
  ('Taj SATS', 'ZUCCHINI YELLOW', 9, 39),
  ('Taj SATS', 'ZUCCHINI YELLOW DIAMOND CUT', 9, 40),
  ('Taj SATS', 'WHOLE MUSHROOM', 9, 41),
  ('Taj SATS', 'CAPSICUM GREEN', 9, 42),
  ('Taj SATS', 'CUCUMBER BABY EUROPEAN', 1.3, 43),
  ('Taj SATS', 'CHOW CHOW CUBE', 9, 44),
  ('Taj SATS', 'CAPSICUM RED', 1.3, 45),
  ('Taj SATS', 'CAPSICUM YELLOW', 1.3, 46),
  ('Taj SATS', 'PUMPKIN RED', 1.3, 47),
  ('Taj SATS', 'WHITE PUMPKIN', 9, 48),
  ('Taj SATS', 'Raw Papaya', 9, 49),
  ('Taj SATS', 'BEANS SMALL DICED', 30.3, 50),
  ('Taj SATS', 'Green Chilli Destem', 7, 51),
  ('Taj SATS', 'Beetroot', 9, 52),
  ('Taj SATS', 'SNAKE GOURD', 9, 53),
  ('Taj SATS', 'BEETROOT WHOLE', 9, 54),
  ('Taj SATS', 'Ridge Gourd', 9, 55)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- Swiggy
INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, display_order)
SELECT p.id, v.vendor, v.sku, v.rate, v.ord FROM (VALUES
  ('Swiggy', 'Ash Gourd - Cut', 7.5, 1),
  ('Swiggy', 'Ash Gourd Portion', 7.5, 2),
  ('Swiggy', 'Baby Corn Peeled', 8, 3),
  ('Swiggy', 'Broccoli Florets', 8, 4),
  ('Swiggy', 'Brown Chana Sprouts', 8, 5),
  ('Swiggy', 'Chopped Coriander Leaves', 16, 6),
  ('Swiggy', 'Coconut Chunks (Naral)', 19, 7),
  ('Swiggy', 'Coconut Grated', 19, 8),
  ('Swiggy', 'Diced Muskmelon (Karbuja)', 10.28, 9),
  ('Swiggy', 'Diced Papaya (Papita)', 10.28, 10),
  ('Swiggy', 'Drumstick Cut', 8, 11),
  ('Swiggy', 'Green Peas Peeled', 34, 12),
  ('Swiggy', 'Sambhar Mix- s', 15.2, 13),
  ('Swiggy', 'Fruit Chat Mix', 7.2, 14),
  ('Swiggy', 'Garlic- Ginger Chopped', 12.8, 15),
  ('Swiggy', 'Lady Finger', 8, 16),
  ('Swiggy', 'Mixed Sprouts', 9.14, 17),
  ('Swiggy', 'Moong Sprouts (Modache Moog)', 9.14, 18),
  ('Swiggy', 'Peeled Garlic (Lahsun)', 16, 19),
  ('Swiggy', 'Peeled Pomegranate (Anaar)', 24, 20),
  ('Swiggy', 'Peeled Sambhar Onion (Pyaaz)', 8, 21),
  ('Swiggy', 'Peeled Sweet Corn', 8, 22),
  ('Swiggy', 'Pineapple Slices', 10.28, 23),
  ('Swiggy', 'Pulaw Mix', 15.2, 24),
  ('Swiggy', 'Pumpkin portion cut', 7.5, 25),
  ('Swiggy', 'Red Pumpkin Cut', 7.5, 26),
  ('Swiggy', 'Sukto Mix', 19, 27),
  ('Swiggy', 'Yam (Cut Portion)', 7.5, 28),
  ('Swiggy', 'Cauliflower Florets', 8, 29),
  ('Swiggy', 'Ugadi Pachadi 1Pack', 3.5, 30)
) AS v(vendor, sku, rate, ord)
CROSS JOIN (SELECT id FROM plants WHERE name = 'Bangalore-FnV') AS p
ON CONFLICT (plant_id, vendor_name, sku_name) DO NOTHING;

-- ============================================================
-- Partial multi-plant access — a non-superadmin user can be
-- granted any subset of plants (not just one, not necessarily all).
-- ============================================================
CREATE TABLE IF NOT EXISTS user_plants (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, plant_id)
);

-- One-time backfill: give every existing plant-locked user an explicit
-- user_plants row matching their legacy users.plant_id, so the new
-- multi-plant access model has data to work with immediately.
INSERT INTO user_plants (user_id, plant_id)
SELECT id, plant_id FROM users WHERE plant_id IS NOT NULL
ON CONFLICT DO NOTHING;
