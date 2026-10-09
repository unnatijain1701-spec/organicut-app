-- Per-plant on/off switch for the worker-type attendance breakdown. Defaults to
-- OFF for every existing plant (and every new one unless set otherwise), so
-- nothing changes for a plant until an admin/superadmin explicitly turns it on —
-- they keep entering one total worker count + one total cost, exactly as today.
ALTER TABLE plants ADD COLUMN IF NOT EXISTS has_worker_breakdown BOOLEAN NOT NULL DEFAULT false;
