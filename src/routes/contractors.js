const express = require('express');
const db = require('../db');
const { hasPermission } = require('../utils/permissions');

const router = express.Router();

// Same scoping rule as vendors.js/sku.js's getPlantId.
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

const normalize = s => String(s || '').trim().toLowerCase();

// GET /api/contractors — the canonical contractor list for this plant
router.get('/', async (req, res) => {
  const pid = getPlantId(req);
  try {
    const { rows } = await db.query(
      'SELECT id, name FROM contractors WHERE plant_id = $1 ORDER BY display_order, name',
      [pid]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/contractors — add a new canonical contractor
router.post('/', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors')) return res.status(403).json({ error: 'You do not have permission to do this' });
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Contractor name is required' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  try {
    const { rows } = await db.query(
      `INSERT INTO contractors (plant_id, name, display_order)
       VALUES ($1, $2, COALESCE((SELECT MAX(display_order)+1 FROM contractors WHERE plant_id = $1), 0))
       RETURNING id, name`,
      [pid, name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A contractor with this name already exists' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/contractors/:id — rename a contractor
router.patch('/:id', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors')) return res.status(403).json({ error: 'You do not have permission to do this' });
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Contractor name is required' });
  try {
    const { rows } = await db.query(
      'UPDATE contractors SET name = $1 WHERE id = $2 RETURNING id, name',
      [name.trim(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contractor not found' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A contractor with this name already exists' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/contractors/:id
router.delete('/:id', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors')) return res.status(403).json({ error: 'You do not have permission to do this' });
  try {
    const { rowCount } = await db.query('DELETE FROM contractors WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Contractor not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/contractors/resolve — one-time resolution for CSV upload names that didn't
// match the canonical list. Body: { resolutions: [{ rawName, action: 'existing'|'new',
// contractorId?, newName? }] }. For 'existing', records an alias so this exact raw
// spelling auto-resolves on every future upload without asking again. For 'new', creates
// the contractor (and an alias too, if the chosen name differs from the raw spelling).
router.post('/resolve', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors')) return res.status(403).json({ error: 'You do not have permission to do this' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  const { resolutions } = req.body || {};
  if (!Array.isArray(resolutions) || !resolutions.length) return res.status(400).json({ error: 'resolutions is required' });

  try {
    const results = [];
    for (const r of resolutions) {
      let contractorId, canonicalName;
      if (r.action === 'new') {
        const newName = (r.newName || r.rawName || '').trim();
        if (!newName) continue;
        const { rows } = await db.query(
          `INSERT INTO contractors (plant_id, name, display_order)
           VALUES ($1, $2, COALESCE((SELECT MAX(display_order)+1 FROM contractors WHERE plant_id = $1), 0))
           ON CONFLICT (plant_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, name`,
          [pid, newName]
        );
        contractorId = rows[0].id; canonicalName = rows[0].name;
      } else {
        contractorId = parseInt(r.contractorId, 10);
        const { rows } = await db.query('SELECT id, name FROM contractors WHERE id = $1 AND plant_id = $2', [contractorId, pid]);
        if (!rows.length) continue;
        canonicalName = rows[0].name;
      }
      if (r.rawName && normalize(r.rawName) !== normalize(canonicalName)) {
        await db.query(
          'INSERT INTO contractor_aliases (plant_id, contractor_id, raw_name) VALUES ($1,$2,$3) ON CONFLICT (plant_id, raw_name) DO UPDATE SET contractor_id = EXCLUDED.contractor_id',
          [pid, contractorId, r.rawName]
        );
      }
      results.push({ rawName: r.rawName, canonicalName });
    }
    res.json({ results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/contractors/unmatched — distinct contractor_name values already saved in this
// plant's history that don't match any canonical contractor or alias (case-insensitive) —
// the raw material for the one-off historical cleanup tool.
router.get('/unmatched', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors')) return res.status(403).json({ error: 'You do not have permission to do this' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  try {
    const { rows: savedNames } = await db.query(`
      SELECT DISTINCT ca.contractor_name
      FROM contractor_attendance ca
      JOIN daily_records dr ON dr.id = ca.record_id
      WHERE dr.plant_id = $1
      ORDER BY ca.contractor_name
    `, [pid]);
    const { rows: known } = await db.query(`
      SELECT name AS raw_name FROM contractors WHERE plant_id = $1
      UNION
      SELECT raw_name FROM contractor_aliases WHERE plant_id = $1
    `, [pid]);
    const knownSet = new Set(known.map(r => normalize(r.raw_name)));
    const unmatched = savedNames.map(r => r.contractor_name).filter(n => !knownSet.has(normalize(n)));
    res.json(unmatched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/contractors/merge — reassign historical contractor_attendance rows from one
// or more raw names onto a canonical contractor, and record aliases so the same raw
// spelling resolves correctly in any future CSV upload too.
// Body: { mappings: [{ rawName, contractorId }] }
router.post('/merge', async (req, res) => {
  if (!hasPermission(req.user, 'manage_vendors')) return res.status(403).json({ error: 'You do not have permission to do this' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  const { mappings } = req.body || {};
  if (!Array.isArray(mappings) || !mappings.length) return res.status(400).json({ error: 'mappings is required' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let updatedRows = 0;
    for (const m of mappings) {
      const contractorId = parseInt(m.contractorId, 10);
      const rawName = (m.rawName || '').trim();
      if (!rawName || isNaN(contractorId)) continue;
      const { rows: cRows } = await client.query('SELECT name FROM contractors WHERE id = $1 AND plant_id = $2', [contractorId, pid]);
      if (!cRows.length) continue;
      const canonicalName = cRows[0].name;

      await client.query(
        'INSERT INTO contractor_aliases (plant_id, contractor_id, raw_name) VALUES ($1,$2,$3) ON CONFLICT (plant_id, raw_name) DO UPDATE SET contractor_id = EXCLUDED.contractor_id',
        [pid, contractorId, rawName]
      );

      if (normalize(rawName) !== normalize(canonicalName)) {
        // Merge historical rows: rename this raw name to the canonical one. If a
        // (record_id, canonical name) row already exists (both entered the same day),
        // fold the raw row's numbers into it instead of violating a uniqueness
        // assumption — there's no unique constraint here, so simplest is to just
        // UPDATE; duplicate contractor rows per day were already possible before this
        // feature and the UI already sums them, so this is not a regression.
        const { rowCount } = await client.query(`
          UPDATE contractor_attendance ca
          SET contractor_name = $1
          FROM daily_records dr
          WHERE ca.record_id = dr.id AND dr.plant_id = $2 AND ca.contractor_name = $3
        `, [canonicalName, pid, rawName]);
        updatedRows += rowCount;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, updatedRows });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
