const express = require('express');
const db = require('../db');

const router = express.Router();

// Admin/superadmin-only, a plain role check — same pattern as the worker-breakdown
// toggle, deliberately not tied to the mix-and-match permission set.
function isPrivileged(req) {
  return req.user.role === 'admin' || req.user.role === 'superadmin';
}

// GET /api/holidays — the full shared holiday calendar (everyone can view it; only
// admin/superadmin can edit it)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, TO_CHAR(date, \'YYYY-MM-DD\') AS date, name FROM holidays ORDER BY date');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/holidays — add a holiday date
router.post('/', async (req, res) => {
  if (!isPrivileged(req)) return res.status(403).json({ error: 'Admin or superadmin only' });
  const { date, name } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Holiday name is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO holidays (date, name) VALUES ($1, $2) RETURNING id, TO_CHAR(date, \'YYYY-MM-DD\') AS date, name',
      [date, name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A holiday is already set for this date' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', async (req, res) => {
  if (!isPrivileged(req)) return res.status(403).json({ error: 'Admin or superadmin only' });
  try {
    const { rowCount } = await db.query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Holiday not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
