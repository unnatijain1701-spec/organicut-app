-- Worker types are now configured by annual CTC; daily_rate stays as the derived
-- value (CTC / 365) so every existing cost calculation keeps working unchanged.
ALTER TABLE worker_types ADD COLUMN IF NOT EXISTS ctc NUMERIC(14,2);
UPDATE worker_types SET ctc = ROUND(daily_rate * 365, 2) WHERE ctc IS NULL;

-- Per-location overtime rate; OT cost = OT hours x this rate.
ALTER TABLE plants ADD COLUMN IF NOT EXISTS ot_rate_per_hour NUMERIC(10,2) NOT NULL DEFAULT 0;
