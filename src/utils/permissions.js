// Granular permission keys a superadmin can mix-and-match onto a user. Every
// one of these is additive on top of the base role (Operator/Admin) — a user
// with none of them behaves exactly as the app did before this feature.
const ALL_PERMISSIONS = [
  'manage_locations',  // create/edit locations
  'delete_locations',  // delete locations (separate from manage, per request — no forced bundling)
  'manage_users',       // create/edit/delete other users, reset passwords
  'manage_vendors',     // add/edit/delete KG vendors + SKUs (incl. bulk upload)
  'view_reports',       // multi-plant Report / Compare / All-Plants views
  'view_cost_trend',    // multi-plant Cost Trend view
  'manage_records',     // lock/unlock and delete daily records, view audit log
  'manage_worker_types', // set worker-type names & daily rates for attendance entry
];

// Superadmin is always unrestricted. Everyone else needs the exact key present
// in their JWT's `permissions` array (embedded at login from user_permissions).
function hasPermission(user, key) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

// A non-superadmin actor's own permissions are the ceiling for what they may
// grant to someone else — and manage_users/delete_locations/superadmin itself
// can only ever be granted by a superadmin, to prevent privilege escalation
// via a user who merely has manage_users.
const SUPERADMIN_ONLY_GRANTS = new Set(['manage_users', 'delete_locations']);

function sanitizeGrantablePermissions(actor, requested) {
  const list = Array.isArray(requested) ? requested.filter(p => ALL_PERMISSIONS.includes(p)) : [];
  if (actor.role === 'superadmin') return list;
  return list.filter(p => !SUPERADMIN_ONLY_GRANTS.has(p) && hasPermission(actor, p));
}

module.exports = { ALL_PERMISSIONS, hasPermission, SUPERADMIN_ONLY_GRANTS, sanitizeGrantablePermissions };
