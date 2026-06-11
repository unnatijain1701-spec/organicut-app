const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/vendors
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name FROM kg_vendors ORDER BY sort_order, id');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/vendors
router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Vendor name is required' });
  }
  try {
    const { rows } = await db.query(
      'INSERT INTO kg_vendors (name) VALUES ($1) RETURNING id, name',
      [name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Vendor already exists' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/vendors/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM kg_vendors WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
