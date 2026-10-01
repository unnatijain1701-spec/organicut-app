-- Granular, mix-and-match permissions for non-superadmin users. Superadmin is
-- always unrestricted and never needs rows here. Any user with zero rows in
-- this table behaves exactly as before this feature existed (no regressions).
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT    NOT NULL,
  PRIMARY KEY (user_id, permission)
);
