const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { hasPermission } = require('../utils/permissions');

const router = express.Router();

// Resolve plant id the same way as vendors.js — superadmin passes plantId in
// query/body; everyone else is limited to their granted plant set.
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

// GET /api/worker-types — list all worker types (and rates) for the current plant.
// Returns [] for unknown/missing plants rather than a 400 so the frontend can
// start up cleanly even when no rates have been configured yet.
router.get('/', async (req, res) => {
  const pid = getPlantId(req);
  if (!pid) return res.json([]);
  try {
    const { rows } = await db.query(
      'SELECT id, name, rate, display_order FROM worker_type_rates WHERE plant_id = $1 ORDER BY display_order, id',
      [pid]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/worker-types — create a new worker type (manage_vendors or superadmin).
router.post('/', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  const { name, rate } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Worker type name is required' });
  const parsedRate = parseFloat(rate) || 0;
  try {
    const { rows } = await db.query(
      `INSERT INTO worker_type_rates (plant_id, name, rate, display_order)
       VALUES ($1, $2, $3, COALESCE((SELECT MAX(display_order)+1 FROM worker_type_rates WHERE plant_id=$1), 0))
       RETURNING id, name, rate, display_order`,
      [pid, name.trim(), parsedRate]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A worker type with this name already exists for this plant' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/worker-types/:id — update name and/or rate.
router.patch('/:id', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  const wtId = parseInt(req.params.id, 10);
  if (isNaN(wtId)) return res.status(400).json({ error: 'Invalid id' });
  const { name, rate } = req.body || {};
  if (name === undefined && rate === undefined)
    return res.status(400).json({ error: 'Nothing to update' });
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  try {
    const sets = [];
    const params = [];
    if (name !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
    if (rate !== undefined)  { params.push(parseFloat(rate) || 0); sets.push(`rate = $${params.length}`); }
    params.push(wtId, pid);
    const { rows } = await db.query(
      `UPDATE worker_type_rates SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND plant_id = $${params.length}
       RETURNING id, name, rate, display_order`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Worker type not found' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A worker type with this name already exists for this plant' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/worker-types/:id — delete a worker type (manage_vendors or superadmin).
router.delete('/:id', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  const wtId = parseInt(req.params.id, 10);
  if (isNaN(wtId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rowCount } = await db.query(
      'DELETE FROM worker_type_rates WHERE id = $1 AND plant_id = $2',
      [wtId, pid]
    );
    if (!rowCount) return res.status(404).json({ error: 'Worker type not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
