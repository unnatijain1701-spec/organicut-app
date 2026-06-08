const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');

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

    const token = jwt.sign(
      { id: rows[0].id, username: rows[0].username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ username: rows[0].username });
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
    res.json({ username: user.username });
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
});

// POST /api/auth/setup  — create the very first admin user (locked once any user exists)
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
    await db.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username.trim(), hash]);
    res.json({ ok: true, message: 'Admin user created. You can now log in.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
