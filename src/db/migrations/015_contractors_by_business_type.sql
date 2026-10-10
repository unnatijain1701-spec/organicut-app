-- Contractors move from "one list per plant" to "one shared list per business type"
-- (all FnV plants share one list, all RTE plants share another, etc.) — a single flat
-- list, no per-plant override. Existing plant-scoped contractors/aliases are backfilled
-- onto their plant's business type automatically, so data already entered (e.g. Rai's
-- cleaned-up FnV list) becomes the shared business-type list with no re-entry needed.

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS business_type VARCHAR(30);
ALTER TABLE contractor_aliases ADD COLUMN IF NOT EXISTS business_type VARCHAR(30);

UPDATE contractors c SET business_type = p.business_type
FROM plants p WHERE p.id = c.plant_id AND c.business_type IS NULL;

UPDATE contractor_aliases a SET business_type = p.business_type
FROM plants p WHERE p.id = a.plant_id AND a.business_type IS NULL;

-- Dedupe contractors that collide once collapsed onto (business_type, name) — e.g. two
-- plants of the same business type that happened to already have a same-named
-- contractor. Keep the lowest id, remap every alias pointing at a dropped duplicate
-- onto the survivor, then remove the duplicates.
DO $$
DECLARE
  dup RECORD;
  survivor_id INTEGER;
BEGIN
  FOR dup IN
    SELECT business_type, name, MIN(id) AS keep_id, ARRAY_AGG(id) AS all_ids
    FROM contractors
    WHERE business_type IS NOT NULL
    GROUP BY business_type, name
    HAVING COUNT(*) > 1
  LOOP
    survivor_id := dup.keep_id;
    UPDATE contractor_aliases SET contractor_id = survivor_id
      WHERE contractor_id = ANY(dup.all_ids) AND contractor_id != survivor_id;
    DELETE FROM contractors WHERE id = ANY(dup.all_ids) AND id != survivor_id;
  END LOOP;
END $$;

-- Dedupe aliases colliding on (business_type, raw_name) the same way — keep one row.
DELETE FROM contractor_aliases a USING contractor_aliases b
  WHERE a.id > b.id AND a.business_type = b.business_type AND a.raw_name = b.raw_name;

ALTER TABLE contractors DROP CONSTRAINT IF EXISTS contractors_plant_id_name_key;
ALTER TABLE contractor_aliases DROP CONSTRAINT IF EXISTS contractor_aliases_plant_id_raw_name_key;

ALTER TABLE contractors ALTER COLUMN business_type SET NOT NULL;
ALTER TABLE contractor_aliases ALTER COLUMN business_type SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contractors_biztype_name_idx ON contractors(business_type, name);
CREATE UNIQUE INDEX IF NOT EXISTS contractor_aliases_biztype_rawname_idx ON contractor_aliases(business_type, raw_name);

ALTER TABLE contractors DROP COLUMN IF EXISTS plant_id;
ALTER TABLE contractor_aliases DROP COLUMN IF EXISTS plant_id;
