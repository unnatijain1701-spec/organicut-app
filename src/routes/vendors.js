const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name FROM kg_vendors WHERE plant_id = $1 ORDER BY display_order, id',
      [req.user.plant_id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Vendor name is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO kg_vendors (name, plant_id) VALUES ($1, $2) RETURNING id, name',
      [name.trim(), req.user.plant_id]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Vendor already exists' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM kg_vendors WHERE id = $1 AND plant_id = $2',
      [req.params.id, req.user.plant_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
