const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };

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
    let plantName = null;
    if (u.plant_id) {
      const pr = await db.query('SELECT name FROM plants WHERE id = $1', [u.plant_id]);
      plantName = pr.rows[0]?.name || null;
    }

    const token = jwt.sign(
      { id: u.id, username: u.username, role: u.role, plant_id: u.plant_id, plant_name: plantName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ username: u.username, role: u.role, plant_id: u.plant_id, plant_name: plantName });
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

// GET /api/auth/plants — list all plants (used by superadmin when creating users)
router.get('/plants', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name, business_type, has_kg_processing FROM plants ORDER BY display_order');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/plants — create a new location (superadmin only)
router.post('/plants', authenticateToken, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
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

// PATCH /api/auth/plants/:id — rename a location (superadmin only)
router.patch('/plants/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  const plantId = parseInt(req.params.id, 10);
  if (isNaN(plantId)) return res.status(400).json({ error: 'Invalid plant id' });
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await db.query(
      `UPDATE plants SET name = $1 WHERE id = $2
       RETURNING id, name, business_type, has_kg_processing, display_order`,
      [name.trim(), plantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found' });
    res.json(rows[0]);
  } catch (e) {
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
    } else {
      ({ rows } = await db.query(`
        SELECT u.id, u.username, u.role, u.plant_id, p.name AS plant_name, p.business_type
        FROM users u
        LEFT JOIN plants p ON p.id = u.plant_id
        WHERE u.plant_id = $1
        ORDER BY u.id
      `, [req.user.plant_id]));
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/users — create a new user
router.post('/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  const { username, password, role, plantId } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const assignedRole = role === 'superadmin' ? 'superadmin' : role === 'admin' ? 'admin' : 'user';

  let assignedPlantId;
  if (assignedRole === 'superadmin') {
    assignedPlantId = null; // superadmin has no plant
  } else if (req.user.role === 'superadmin' || !req.user.plant_id) {
    if (!plantId) return res.status(400).json({ error: 'plantId is required' });
    const plantCheck = await db.query('SELECT id FROM plants WHERE id = $1', [plantId]);
    if (!plantCheck.rows.length) return res.status(400).json({ error: 'Invalid plant' });
    assignedPlantId = parseInt(plantId, 10);
  } else {
    assignedPlantId = req.user.plant_id;
  }

  try {
    const exists = await db.query('SELECT id FROM users WHERE username = $1', [username.trim()]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      'INSERT INTO users (username, password_hash, role, plant_id) VALUES ($1, $2, $3, $4) RETURNING id, username, role, plant_id',
      [username.trim(), hash, assignedRole, assignedPlantId]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/users/:id — change role (admin/superadmin only, cannot change own role)
router.patch('/users/:id', authenticateToken, async (req, res) => {
  const isSuperadmin = req.user.role === 'superadmin';
  const isAdmin      = false; // user management locked to superadmin during trial
  if (!isSuperadmin) return res.status(403).json({ error: 'Superadmin only' });

  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });

  const { role, plantId } = req.body || {};
  let newRole;
  if (isSuperadmin && role === 'superadmin') newRole = 'superadmin';
  else if (role === 'admin') newRole = 'admin';
  else newRole = 'user';

  // Determine new plant_id
  let newPlantId;
  if (newRole === 'superadmin') {
    newPlantId = null;
  } else if (plantId != null) {
    const plantCheck = await db.query('SELECT id FROM plants WHERE id = $1', [parseInt(plantId, 10)]);
    if (!plantCheck.rows.length) return res.status(400).json({ error: 'Invalid plant' });
    newPlantId = parseInt(plantId, 10);
  } else {
    // No plantId provided — keep existing plant_id
    const existing = await db.query('SELECT plant_id FROM users WHERE id = $1', [targetId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'User not found' });
    newPlantId = existing.rows[0].plant_id;
    // If demoting a superadmin (plant_id was NULL) without providing a plantId, reject
    if (newRole !== 'superadmin' && newPlantId == null) {
      return res.status(400).json({ error: 'A plant must be assigned when changing from Superadmin to a plant role' });
    }
  }

  try {
    const result = await db.query(
      'UPDATE users SET role = $1, plant_id = $2 WHERE id = $3 RETURNING id, username, role, plant_id',
      [newRole, newPlantId, targetId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/auth/users/:id — delete a user (cannot delete yourself)
router.delete('/users/:id', authenticateToken, async (req, res) => {
  const isSuperadmin = req.user.role === 'superadmin';
  const isAdmin      = false; // user management locked to superadmin during trial
  if (!isSuperadmin) return res.status(403).json({ error: 'Superadmin only' });

  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' });
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    const whereClause = isAdmin ? 'WHERE id = $1 AND plant_id = $2' : 'WHERE id = $1';
    const params = isAdmin ? [targetId, req.user.plant_id] : [targetId];
    const result = await db.query(`DELETE FROM users ${whereClause}`, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/users/:id/password — reset a user's password (admin/superadmin only)
router.patch('/users/:id/password', authenticateToken, async (req, res) => {
  const isSuperadmin = req.user.role === 'superadmin';
  const isAdmin      = false; // user management locked to superadmin during trial
  if (!isSuperadmin) return res.status(403).json({ error: 'Superadmin only' });

  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' });

  const { password } = req.body || {};
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const whereClause = isAdmin ? 'WHERE id = $2 AND plant_id = $3' : 'WHERE id = $2';
    const hash = await bcrypt.hash(password, 12);
    const params = isAdmin ? [hash, targetId, req.user.plant_id] : [hash, targetId];
    const result = await db.query(
      `UPDATE users SET password_hash = $1 ${whereClause} RETURNING id`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
