const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Superadmin: any plant the frontend asks for (or none). Everyone else: only a
// plant they've actually been granted, via plantIds — a multi-plant user's
// currently-selected plant if it's in their set, otherwise their first allowed
// plant. An out-of-scope plantId in the request is silently ignored rather than
// honored, so a restricted user can never read/write another plant's data.
function getPlantId(req) {
  if (req.user.role === 'superadmin') {
    const pid = parseInt(req.query.plantId || req.body?.plantId);
    return isNaN(pid) ? null : pid;
  }
  const allowed = req.user.plantIds || (req.user.plant_id != null ? [req.user.plant_id] : []);
  if (!allowed.length) return null;
  const requested = parseInt(req.query.plantId || req.body?.plantId);
  return !isNaN(requested) && allowed.includes(requested) ? requested : allowed[0];
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name FROM kg_vendors WHERE plant_id = $1 ORDER BY display_order, id',
      [getPlantId(req)]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/', (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  next();
}, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Vendor name is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO kg_vendors (name, plant_id) VALUES ($1, $2) RETURNING id, name',
      [name.trim(), getPlantId(req)]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Vendor already exists' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  next();
}, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM kg_vendors WHERE id = $1 AND plant_id = $2',
      [req.params.id, getPlantId(req)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
