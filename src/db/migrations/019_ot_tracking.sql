-- OT (overtime) tracking for contractor attendance.
-- Per-plant flag: only plants with has_ot_tracking = true show the OT columns.
ALTER TABLE plants ADD COLUMN IF NOT EXISTS has_ot_tracking BOOLEAN DEFAULT FALSE;

ALTER TABLE contractor_attendance ADD COLUMN IF NOT EXISTS ot_hours NUMERIC(8,2) DEFAULT 0;
ALTER TABLE contractor_attendance ADD COLUMN IF NOT EXISTS ot_cost  NUMERIC(12,2) DEFAULT 0;
