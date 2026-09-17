-- Partial multi-plant access — a non-superadmin user can be granted any
-- subset of plants (not just one, not necessarily all).
CREATE TABLE IF NOT EXISTS user_plants (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, plant_id)
);

-- Backfill every existing plant-locked user's legacy users.plant_id into
-- user_plants. Runs once, as part of this migration only.
INSERT INTO user_plants (user_id, plant_id)
SELECT id, plant_id FROM users WHERE plant_id IS NOT NULL
ON CONFLICT DO NOTHING;
