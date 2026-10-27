-- Worker types are configured by MONTHLY CTC; daily_rate = monthly_ctc / 30.
-- Backfilled from the current daily rate so no existing rate changes.
ALTER TABLE worker_types ADD COLUMN IF NOT EXISTS monthly_ctc NUMERIC(12,2);
UPDATE worker_types SET monthly_ctc = ROUND(daily_rate * 30, 2) WHERE monthly_ctc IS NULL;
ALTER TABLE worker_types DROP COLUMN IF EXISTS ctc;
