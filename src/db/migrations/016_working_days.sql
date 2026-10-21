-- Per-plant weekly off-day (e.g. Beverage plants closed every Sunday) and an opt-in
-- flag for the shared national holiday calendar — together these let "days recorded"
-- denominators (Report, Dashboard month-end projection) count only days the plant was
-- actually expected to work, instead of every calendar day. NULL weekly_off_day means
-- "works every day of the week" (today's default — zero change for existing plants).
ALTER TABLE plants ADD COLUMN IF NOT EXISTS weekly_off_day SMALLINT; -- 0=Sunday ... 6=Saturday, NULL=none
ALTER TABLE plants ADD COLUMN IF NOT EXISTS observes_holidays BOOLEAN NOT NULL DEFAULT false;

-- One shared holiday calendar (date + label) used by every plant that opts in via
-- observes_holidays — national/regional holidays are the same across locations in the
-- common case; nothing stops adding plant-specific exceptions later if ever needed.
CREATE TABLE IF NOT EXISTS holidays (
  id   SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL
);
