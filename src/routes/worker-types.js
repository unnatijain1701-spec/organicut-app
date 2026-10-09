const express = require('express');
const db = require('../db');
const { hasPermission } = require('../utils/permissions');

const router = express.Router();

// Same scoping rule as vendors.js/sku.js's getPlantId — a restricted (non-superadmin)
// user can only ever resolve to a plant inside their granted plantIds set.
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

// GET /api/worker-types — effective list for this plant: every global (plant_id
// IS NULL) worker type, with a plant-specific row of the same name overriding its
// rate. A plant-specific type with no global counterpart is simply added.
router.get('/', async (req, res) => {
  const pid = getPlantId(req);
  try {
    const { rows } = await db.query(
      `SELECT id, plant_id, name, daily_rate, display_order FROM worker_types
       WHERE plant_id IS NULL OR plant_id = $1
       ORDER BY display_order, name`,
      [pid]
    );
    const byName = {};
    const order = [];
    rows.forEach(r => {
      if (!byName[r.name]) order.push(r.name);
      // Plant-specific rows come after NULL rows are already in the map because of
      // ORDER BY display_order, name — not guaranteed, so explicitly prefer plant-specific.
      if (!byName[r.name] || r.plant_id != null) byName[r.name] = r;
    });
    res.json(order.map(n => byName[n]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/worker-types — create a worker type. Pass plantId to scope it to one
// plant only (overriding/adding to the global list for that plant); omit it to
// create a global default used by every plant that has no override of its own.
router.post('/', async (req, res) => {
  if (!hasPermission(req.user, 'manage_worker_types')) return res.status(403).json({ error: 'You do not have permission to do this' });
  const { name, dailyRate, global: isGlobal } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Worker type name is required' });
  const rate = parseFloat(dailyRate);
  if (isNaN(rate) || rate < 0) return res.status(400).json({ error: 'Daily rate must be a non-negative number' });
  const plantId = isGlobal ? null : getPlantId(req);
  if (!isGlobal && !plantId) return res.status(400).json({ error: 'No plant selected' });
  try {
    const { rows } = await db.query(
      `INSERT INTO worker_types (plant_id, name, daily_rate, display_order)
       VALUES ($1, $2, $3, COALESCE((SELECT MAX(display_order)+1 FROM worker_types WHERE plant_id IS NOT DISTINCT FROM $1), 0))
       RETURNING id, plant_id, name, daily_rate, display_order`,
      [plantId, name.trim(), rate]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A worker type with this name already exists at this scope' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/worker-types/:id — rename and/or change the daily rate
router.patch('/:id', async (req, res) => {
  if (!hasPermission(req.user, 'manage_worker_types')) return res.status(403).json({ error: 'You do not have permission to do this' });
  const { name, dailyRate } = req.body || {};
  if (name === undefined && dailyRate === undefined) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const sets = [];
    const params = [];
    if (name !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
    if (dailyRate !== undefined) { params.push(parseFloat(dailyRate) || 0); sets.push(`daily_rate = $${params.length}`); }
    params.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE worker_types SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, plant_id, name, daily_rate, display_order`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Worker type not found' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A worker type with this name already exists at this scope' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/worker-types/:id
router.delete('/:id', async (req, res) => {
  if (!hasPermission(req.user, 'manage_worker_types')) return res.status(403).json({ error: 'You do not have permission to do this' });
  try {
    const { rowCount } = await db.query('DELETE FROM worker_types WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Worker type not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
