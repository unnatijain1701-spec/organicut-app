const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { hasPermission, sanitizeGrantablePermissions, SUPERADMIN_ONLY_GRANTS } = require('../utils/permissions');

const router = express.Router();
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };

// Resolves a user's plant access as an array (never single-valued). Superadmin
// gets null, meaning "unrestricted" — every other role gets the exact set of
// plants assigned via user_plants (which may be one plant, several, or — for
// legacy accounts predating this table — a fallback to their old single plant_id).
async function getUserPlantIds(user) {
  if (user.role === 'superadmin') return null;
  const { rows } = await db.query('SELECT plant_id FROM user_plants WHERE user_id = $1 ORDER BY plant_id', [user.id]);
  if (rows.length) return rows.map(r => r.plant_id);
  return user.plant_id != null ? [user.plant_id] : [];
}

// A superadmin always has every permission implicitly (never stored). Everyone
// else gets exactly the rows granted to them here — empty by default, which is
// what every pre-existing account has, so behavior is unchanged unless someone
// explicitly grants a permission.
async function getUserPermissions(user) {
  if (user.role === 'superadmin') return [];
  const { rows } = await db.query('SELECT permission FROM user_permissions WHERE user_id = $1', [user.id]);
  return rows.map(r => r.permission);
}

// Require a specific permission (superadmin always passes). Used as route
// middleware in place of the old hardcoded `role !== 'superadmin'` checks.
function requirePermission(key) {
  return (req, res, next) => {
    if (!hasPermission(req.user, key)) return res.status(403).json({ error: 'You do not have permission to do this' });
    next();
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const u = rows[0];
    const plantIds = await getUserPlantIds(u);
    const permissions = await getUserPermissions(u);
    // Single-plant users keep the old locked-to-one-plant experience (plant_id set,
    // plant_name shown). Multi-plant users get plant_id: null so the frontend treats
    // them like an "all plants" account, but /api/auth/plants only ever returns the
    // plants actually in plantIds, so their picker is silently restricted to those.
    const singlePlantId = plantIds && plantIds.length === 1 ? plantIds[0] : null;
    let plantName = null;
    if (singlePlantId) {
      const pr = await db.query('SELECT name FROM plants WHERE id = $1', [singlePlantId]);
      plantName = pr.rows[0]?.name || null;
    }

    const token = jwt.sign(
      { id: u.id, username: u.username, role: u.role, plant_id: singlePlantId, plant_name: plantName, plantIds, permissions },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ username: u.username, role: u.role, plant_id: singlePlantId, plant_name: plantName, plantIds, permissions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me  — check current session
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    res.json({
      username:   user.username,
      role:       user.role || 'user',
      plant_id:   user.plant_id   || null,
      plant_name: user.plant_name || null,
      plantIds:   user.plantIds !== undefined ? user.plantIds : (user.plant_id != null ? [user.plant_id] : null),
      permissions: user.permissions || [],
    });
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
});

// POST /api/auth/setup  — create the very first superadmin (locked once any user exists)
router.post('/setup', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM users');
    if (parseInt(rows[0].n) > 0) {
      return res.status(403).json({ error: 'Setup already complete — an admin already exists' });
    }

    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'INSERT INTO users (username, password_hash, role, plant_id) VALUES ($1, $2, $3, NULL)',
      [username.trim(), hash, 'superadmin']
    );
    res.json({ ok: true, message: 'Super admin created. You can now log in.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/needs-setup — true only when the users table is genuinely empty
router.get('/needs-setup', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM users');
    res.json({ needed: parseInt(rows[0].n, 10) === 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/plants — list plants: all of them for superadmin, otherwise only
// the ones this user has been granted access to (via user_plants).
router.get('/plants', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name, business_type, has_kg_processing, has_worker_breakdown FROM plants ORDER BY display_order');
    if (req.user.role === 'superadmin') return res.json(rows);
    const allowed = new Set(req.user.plantIds || (req.user.plant_id != null ? [req.user.plant_id] : []));
    res.json(rows.filter(p => allowed.has(p.id)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/plants — create a new location (superadmin, or a user granted manage_locations)
router.post('/plants', authenticateToken, requirePermission('manage_locations'), async (req, res) => {
  const { name, businessType, hasKgProcessing } = req.body || {};
  if (!name || !businessType) return res.status(400).json({ error: 'name and businessType are required' });
  const validTypes = ['FnV', 'RTE', 'Beverage', 'Coco-Sutra'];
  if (!validTypes.includes(businessType)) return res.status(400).json({ error: 'Invalid businessType' });
  try {
    const { rows } = await db.query(
      `INSERT INTO plants (name, business_type, has_kg_processing, display_order)
       VALUES ($1, $2, $3, COALESCE((SELECT MAX(display_order)+1 FROM plants), 1))
       RETURNING id, name, business_type, has_kg_processing, display_order`,
      [name.trim(), businessType, hasKgProcessing !== false]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/plants/:id — edit a location's name / business type / has-kg-processing
// (superadmin, or a user granted manage_locations)
router.patch('/plants/:id', authenticateToken, requirePermission('manage_locations'), async (req, res) => {
  const plantId = parseInt(req.params.id, 10);
  if (isNaN(plantId)) return res.status(400).json({ error: 'Invalid plant id' });
  const { name, businessType, hasKgProcessing } = req.body || {};
  if (name === undefined && businessType === undefined && hasKgProcessing === undefined) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  const validTypes = ['FnV', 'RTE', 'Beverage', 'Coco-Sutra'];
  if (businessType !== undefined && !validTypes.includes(businessType)) {
    return res.status(400).json({ error: 'Invalid businessType' });
  }
  try {
    const sets = [];
    const params = [];
    if (name !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
    if (businessType !== undefined) { params.push(businessType); sets.push(`business_type = $${params.length}`); }
    if (hasKgProcessing !== undefined) { params.push(!!hasKgProcessing); sets.push(`has_kg_processing = $${params.length}`); }
    params.push(plantId);
    const { rows } = await db.query(
      `UPDATE plants SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, business_type, has_kg_processing, display_order`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/plants/:id/worker-breakdown — turn the per-worker-type attendance
// breakdown on/off for one location. Deliberately NOT gated by the manage_locations
// permission — kept to plain role access (admin/superadmin), per explicit request,
// so it isn't tangled up with who can rename/delete locations.
router.patch('/plants/:id/worker-breakdown', authenticateToken, async (req, res) => {
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isPrivileged) return res.status(403).json({ error: 'Admin or superadmin only' });
  const plantId = parseInt(req.params.id, 10);
  if (isNaN(plantId)) return res.status(400).json({ error: 'Invalid plant id' });
  const { enabled } = req.body || {};
  try {
    const { rows } = await db.query(
      'UPDATE plants SET has_worker_breakdown = $1 WHERE id = $2 RETURNING id, name, business_type, has_kg_processing, has_worker_breakdown',
      [!!enabled, plantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/auth/plants/:id — delete a location (superadmin, or a user granted
// delete_locations — a separate, more sensitive permission from manage_locations).
// Blocked if it still has saved records or users assigned, so no data is silently orphaned.
router.delete('/plants/:id', authenticateToken, requirePermission('delete_locations'), async (req, res) => {
  const plantId = parseInt(req.params.id, 10);
  if (isNaN(plantId)) return res.status(400).json({ error: 'Invalid plant id' });
  try {
    const { rows: recCheck } = await db.query('SELECT COUNT(*) AS n FROM daily_records WHERE plant_id = $1', [plantId]);
    if (parseInt(recCheck[0].n, 10) > 0) {
      return res.status(409).json({ error: 'This location has saved records and cannot be deleted.' });
    }
    const { rows: userCheck } = await db.query('SELECT COUNT(*) AS n FROM users WHERE plant_id = $1', [plantId]);
    if (parseInt(userCheck[0].n, 10) > 0) {
      return res.status(409).json({ error: 'This location still has users assigned to it — reassign or remove them first.' });
    }
    const { rowCount } = await db.query('DELETE FROM plants WHERE id = $1', [plantId]);
    if (!rowCount) return res.status(404).json({ error: 'Location not found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'This location still has vendors/SKUs or other linked data — remove those first.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/users — list users
router.get('/users', authenticateToken, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'superadmin') {
      ({ rows } = await db.query(`
        SELECT u.id, u.username, u.role, u.plant_id, p.name AS plant_name, p.business_type
        FROM users u
        LEFT JOIN plants p ON p.id = u.plant_id
        ORDER BY u.plant_id NULLS FIRST, u.id
      `));
    } else if (hasPermission(req.user, 'manage_users') && (req.user.plantIds || []).length) {
      // A scoped user_management grant sees everyone who shares at least one of
      // their own granted plants — not just an exact single-plant match — so a
      // multi-plant Admin can manage users across all of their own locations.
      ({ rows } = await db.query(`
        SELECT DISTINCT u.id, u.username, u.role, u.plant_id, p.name AS plant_name, p.business_type
        FROM users u
        LEFT JOIN plants p ON p.id = u.plant_id
        LEFT JOIN user_plants up ON up.user_id = u.id
        WHERE u.plant_id = ANY($1) OR up.plant_id = ANY($1)
        ORDER BY u.id
      `, [req.user.plantIds]));
    } else {
      ({ rows } = await db.query(`
        SELECT u.id, u.username, u.role, u.plant_id, p.name AS plant_name, p.business_type
        FROM users u
        LEFT JOIN plants p ON p.id = u.plant_id
        WHERE u.plant_id = $1
        ORDER BY u.id
      `, [req.user.plant_id]));
    }
    // Attach each user's full plant list (from user_plants) so the UI can show
    // "3 plants" instead of just the single legacy plant_name for multi-plant users.
    const { rows: upRows } = await db.query(`
      SELECT up.user_id, p.id AS plant_id, p.name, p.business_type
      FROM user_plants up JOIN plants p ON p.id = up.plant_id
    `);
    const byUser = {};
    upRows.forEach(r => {
      (byUser[r.user_id] = byUser[r.user_id] || []).push({ id: r.plant_id, name: r.name, business_type: r.business_type });
    });
    // Attach each user's granted permissions too, so the UI can show/edit them.
    const { rows: permRows } = await db.query('SELECT user_id, permission FROM user_permissions');
    const permsByUser = {};
    permRows.forEach(r => (permsByUser[r.user_id] = permsByUser[r.user_id] || []).push(r.permission));
    rows.forEach(u => {
      u.plants = byUser[u.id] || (u.plant_name ? [{ id: u.plant_id, name: u.plant_name, business_type: u.business_type }] : []);
      u.permissions = permsByUser[u.id] || [];
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/users — create a new user (superadmin, or a user granted
// manage_users). For non-superadmin roles, pass plantIds: [id, id, ...] to
// grant access to that exact subset of plants (one plant, several, or — pass
// every plant's id — effectively all of them). The legacy singular plantId is
// still accepted for one-plant grants. Pass permissions: [key, ...] to also
// grant granular permissions — a non-superadmin creator can only grant
// permissions they themselves hold, and never manage_users/delete_locations
// or the superadmin role itself (privilege-escalation guard).
router.post('/users', authenticateToken, requirePermission('manage_users'), async (req, res) => {
  const { username, password, role, plantId, plantIds, permissions } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const isSuperadmin = req.user.role === 'superadmin';
  if (role === 'superadmin' && !isSuperadmin) {
    return res.status(403).json({ error: 'Only a superadmin can create another superadmin' });
  }
  const assignedRole = role === 'superadmin' ? 'superadmin' : role === 'admin' ? 'admin' : 'user';

  let ids = [];
  if (assignedRole !== 'superadmin') {
    if (Array.isArray(plantIds) && plantIds.length) {
      ids = plantIds.map(x => parseInt(x, 10)).filter(x => !isNaN(x));
    } else if (plantId) {
      ids = [parseInt(plantId, 10)];
    }
    if (!ids.length) return res.status(400).json({ error: 'Select at least one plant' });
    const plantCheck = await db.query('SELECT id FROM plants WHERE id = ANY($1)', [ids]);
    if (plantCheck.rows.length !== ids.length) return res.status(400).json({ error: 'Invalid plant selection' });
    // A scoped (non-superadmin) manager can only grant access to plants they
    // themselves can access — never expand beyond their own assigned set.
    if (!isSuperadmin) {
      const allowed = new Set(req.user.plantIds || []);
      if (ids.some(id => !allowed.has(id))) {
        return res.status(403).json({ error: 'You can only grant access to plants you yourself have access to' });
      }
    }
  }
  const legacyPlantId = ids.length === 1 ? ids[0] : null;
  const grantedPerms = sanitizeGrantablePermissions(req.user, permissions);

  try {
    const exists = await db.query('SELECT id FROM users WHERE username = $1', [username.trim()]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      'INSERT INTO users (username, password_hash, role, plant_id) VALUES ($1, $2, $3, $4) RETURNING id, username, role, plant_id',
      [username.trim(), hash, assignedRole, legacyPlantId]
    );
    const newUser = rows[0];
    if (ids.length) {
      const values = ids.map((_, i) => `($1, $${i + 2})`).join(',');
      await db.query(`INSERT INTO user_plants (user_id, plant_id) VALUES ${values}`, [newUser.id, ...ids]);
    }
    if (grantedPerms.length) {
      const values = grantedPerms.map((_, i) => `($1, $${i + 2})`).join(',');
      await db.query(`INSERT INTO user_permissions (user_id, permission) VALUES ${values}`, [newUser.id, ...grantedPerms]);
    }
    res.json({ ...newUser, plantIds: ids, permissions: grantedPerms });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/users/:id — change role, plant access and/or permissions
// (superadmin, or a user granted manage_users; cannot change own role). Pass
// plantIds: [id, ...] to set the exact subset of plants this user should have;
// omitting it keeps their current plant access. Pass permissions: [key, ...]
// to set the exact set of granted permissions; omitting it leaves them
// untouched. A scoped (non-superadmin) manager cannot promote anyone to
// superadmin, grant manage_users/delete_locations, or touch a plant outside
// their own access — same privilege-escalation guard as user creation.
router.patch('/users/:id', authenticateToken, requirePermission('manage_users'), async (req, res) => {
  const isSuperadmin = req.user.role === 'superadmin';

  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });

  const { rows: targetRows } = await db.query('SELECT role FROM users WHERE id = $1', [targetId]);
  if (!targetRows.length) return res.status(404).json({ error: 'User not found' });
  if (!isSuperadmin && targetRows[0].role === 'superadmin') {
    return res.status(403).json({ error: 'Only a superadmin can modify another superadmin' });
  }

  const { role, plantId, plantIds, permissions } = req.body || {};
  if (role === 'superadmin' && !isSuperadmin) {
    return res.status(403).json({ error: 'Only a superadmin can promote someone to superadmin' });
  }
  let newRole;
  if (isSuperadmin && role === 'superadmin') newRole = 'superadmin';
  else if (role === 'admin') newRole = 'admin';
  else if (role === 'user') newRole = 'user';
  else newRole = targetRows[0].role === 'superadmin' ? 'user' : targetRows[0].role; // role not provided — keep as-is

  // Determine the new set of plant ids for this user
  let ids = null; // null = "not provided, keep existing"
  if (newRole === 'superadmin') {
    ids = [];
  } else if (Array.isArray(plantIds)) {
    ids = plantIds.map(x => parseInt(x, 10)).filter(x => !isNaN(x));
  } else if (plantId != null) {
    ids = [parseInt(plantId, 10)];
  }

  if (ids && ids.length) {
    const plantCheck = await db.query('SELECT id FROM plants WHERE id = ANY($1)', [ids]);
    if (plantCheck.rows.length !== ids.length) return res.status(400).json({ error: 'Invalid plant selection' });
    if (!isSuperadmin) {
      const allowed = new Set(req.user.plantIds || []);
      if (ids.some(id => !allowed.has(id))) {
        return res.status(403).json({ error: 'You can only grant access to plants you yourself have access to' });
      }
    }
  }

  if (ids === null) {
    // No plant info provided at all — keep existing access, but a demotion from
    // superadmin (which has none) must be given at least one plant.
    const existingIds = await getUserPlantIds({ id: targetId, role: 'user' });
    if (newRole !== 'superadmin' && !existingIds.length) {
      return res.status(400).json({ error: 'A plant must be assigned when changing from Superadmin to a plant role' });
    }
    ids = existingIds;
  } else if (newRole !== 'superadmin' && !ids.length) {
    return res.status(400).json({ error: 'Select at least one plant' });
  }

  const legacyPlantId = ids.length === 1 ? ids[0] : null;

  try {
    const result = await db.query(
      'UPDATE users SET role = $1, plant_id = $2 WHERE id = $3 RETURNING id, username, role, plant_id',
      [newRole, legacyPlantId, targetId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    await db.query('DELETE FROM user_plants WHERE user_id = $1', [targetId]);
    if (ids.length) {
      const values = ids.map((_, i) => `($1, $${i + 2})`).join(',');
      await db.query(`INSERT INTO user_plants (user_id, plant_id) VALUES ${values}`, [targetId, ...ids]);
    }

    let finalPerms = null;
    if (Array.isArray(permissions)) {
      finalPerms = sanitizeGrantablePermissions(req.user, permissions);
      if (!isSuperadmin) {
        // A scoped manager editing permissions may only ever touch the keys they
        // themselves can grant — any superadmin-only grant the target already had
        // (e.g. manage_users) is left untouched rather than silently stripped.
        const { rows: existingPermRows } = await db.query('SELECT permission FROM user_permissions WHERE user_id = $1', [targetId]);
        const preserved = existingPermRows.map(r => r.permission).filter(p => SUPERADMIN_ONLY_GRANTS.has(p));
        finalPerms = [...new Set([...finalPerms, ...preserved])];
      }
      await db.query('DELETE FROM user_permissions WHERE user_id = $1', [targetId]);
      if (finalPerms.length) {
        const values = finalPerms.map((_, i) => `($1, $${i + 2})`).join(',');
        await db.query(`INSERT INTO user_permissions (user_id, permission) VALUES ${values}`, [targetId, ...finalPerms]);
      }
    }

    res.json({ ...result.rows[0], plantIds: ids, permissions: finalPerms });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/auth/users/:id — delete a user (superadmin, or a user granted
// manage_users; cannot delete yourself or, unless you're a superadmin, another superadmin)
router.delete('/users/:id', authenticateToken, requirePermission('manage_users'), async (req, res) => {
  const isSuperadmin = req.user.role === 'superadmin';

  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    if (!isSuperadmin) {
      const { rows: targetRows } = await db.query('SELECT role FROM users WHERE id = $1', [targetId]);
      if (targetRows.length && targetRows[0].role === 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can delete another superadmin' });
      }
    }
    const result = await db.query('DELETE FROM users WHERE id = $1', [targetId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/users/:id/password — reset a user's password (superadmin,
// or a user granted manage_users)
router.patch('/users/:id/password', authenticateToken, requirePermission('manage_users'), async (req, res) => {
  const isSuperadmin = req.user.role === 'superadmin';

  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' });

  const { password } = req.body || {};
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    if (!isSuperadmin) {
      const { rows: targetRows } = await db.query('SELECT role FROM users WHERE id = $1', [targetId]);
      if (targetRows.length && targetRows[0].role === 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can reset another superadmin\'s password' });
      }
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id', [hash, targetId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
