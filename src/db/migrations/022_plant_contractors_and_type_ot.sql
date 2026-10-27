-- Purely additive: no existing row is deleted or modified.

-- Which contractors each plant shows in its manual-entry picker. The canonical
-- contractor list stays shared per business type; this only links names to plants.
CREATE TABLE IF NOT EXISTS plant_contractors (
  plant_id      INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  PRIMARY KEY (plant_id, contractor_id)
);

-- Seed each plant with the contractors already in its saved attendance, matched by
-- canonical name or a recorded alias (case-insensitive).
INSERT INTO plant_contractors (plant_id, contractor_id)
SELECT DISTINCT dr.plant_id, c.id
FROM contractor_attendance ca
JOIN daily_records dr ON dr.id = ca.record_id
JOIN plants p ON p.id = dr.plant_id
JOIN contractors c ON c.business_type = p.business_type
                  AND LOWER(TRIM(c.name)) = LOWER(TRIM(ca.contractor_name))
ON CONFLICT DO NOTHING;

INSERT INTO plant_contractors (plant_id, contractor_id)
SELECT DISTINCT dr.plant_id, a.contractor_id
FROM contractor_attendance ca
JOIN daily_records dr ON dr.id = ca.record_id
JOIN plants p ON p.id = dr.plant_id
JOIN contractor_aliases a ON a.business_type = p.business_type
                         AND LOWER(TRIM(a.raw_name)) = LOWER(TRIM(ca.contractor_name))
ON CONFLICT DO NOTHING;

-- Per-worker-type OT rate (NULL = use the location's OT rate).
ALTER TABLE worker_types ADD COLUMN IF NOT EXISTS ot_rate_per_hour NUMERIC(10,2);

-- Per-worker-type OT hours within a contractor's attendance, with the rate snapshotted.
ALTER TABLE contractor_attendance_types ADD COLUMN IF NOT EXISTS ot_hours     NUMERIC(8,2)  NOT NULL DEFAULT 0;
ALTER TABLE contractor_attendance_types ADD COLUMN IF NOT EXISTS ot_rate_used NUMERIC(10,2);
ALTER TABLE contractor_attendance_types ADD COLUMN IF NOT EXISTS ot_cost      NUMERIC(12,2) NOT NULL DEFAULT 0;
