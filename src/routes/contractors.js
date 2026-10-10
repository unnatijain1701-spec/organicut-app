const express = require('express');
const db = require('../db');

// The contractor list is deliberately open to every authenticated user with access to
// this plant (not gated by manage_vendors like the KG vendor list) — unlike vendor
// rates, a contractor name isn't sensitive, and locking it down just reintroduces the
// free-text fragmentation problem this feature exists to fix (anyone blocked from
// adding a real new contractor will just type a near-duplicate name instead).
//
// Scope: ONE flat shared list per business type (FnV / RTE / Beverage / Coco-Sutra) —
// not per plant. Every plant of a given business type sees and edits the same list.

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

// Resolves the active plant to its business type server-side (never trusts a client-
// supplied business type) — that's the actual scope key for the whole contractor list.
async function getBusinessType(req) {
  const pid = getPlantId(req);
  if (!pid) return null;
  const { rows } = await db.query('SELECT business_type FROM plants WHERE id = $1', [pid]);
  return rows[0]?.business_type || null;
}

const normalize = s => String(s || '').trim().toLowerCase();

// GET /api/contractors — the shared contractor list for this plant's business type
router.get('/', async (req, res) => {
  const bt = await getBusinessType(req);
  if (!bt) return res.json([]);
  try {
    const { rows } = await db.query(
      'SELECT id, name FROM contractors WHERE business_type = $1 ORDER BY display_order, name',
      [bt]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/contractors — add a new canonical contractor to this business type's list
router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Contractor name is required' });
  const bt = await getBusinessType(req);
  if (!bt) return res.status(400).json({ error: 'No plant selected' });
  try {
    const { rows } = await db.query(
      `INSERT INTO contractors (business_type, name, display_order)
       VALUES ($1, $2, COALESCE((SELECT MAX(display_order)+1 FROM contractors WHERE business_type = $1), 0))
       RETURNING id, name`,
      [bt, name.trim()]
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
// spelling auto-resolves on every future upload, for any plant of this business type —
// not just the one it was uploaded at. For 'new', creates the contractor (and an alias
// too, if the chosen name differs from the raw spelling).
router.post('/resolve', async (req, res) => {
  const bt = await getBusinessType(req);
  if (!bt) return res.status(400).json({ error: 'No plant selected' });
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
          `INSERT INTO contractors (business_type, name, display_order)
           VALUES ($1, $2, COALESCE((SELECT MAX(display_order)+1 FROM contractors WHERE business_type = $1), 0))
           ON CONFLICT (business_type, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, name`,
          [bt, newName]
        );
        contractorId = rows[0].id; canonicalName = rows[0].name;
      } else {
        contractorId = parseInt(r.contractorId, 10);
        const { rows } = await db.query('SELECT id, name FROM contractors WHERE id = $1 AND business_type = $2', [contractorId, bt]);
        if (!rows.length) continue;
        canonicalName = rows[0].name;
      }
      if (r.rawName && normalize(r.rawName) !== normalize(canonicalName)) {
        await db.query(
          'INSERT INTO contractor_aliases (business_type, contractor_id, raw_name) VALUES ($1,$2,$3) ON CONFLICT (business_type, raw_name) DO UPDATE SET contractor_id = EXCLUDED.contractor_id',
          [bt, contractorId, r.rawName]
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

// GET /api/contractors/unmatched — distinct contractor_name values already saved in
// ANY plant of this business type that don't match the canonical list or a known
// alias (case-insensitive) — the raw material for the one-off historical cleanup tool.
router.get('/unmatched', async (req, res) => {
  const bt = await getBusinessType(req);
  if (!bt) return res.status(400).json({ error: 'No plant selected' });
  try {
    const { rows: savedNames } = await db.query(`
      SELECT DISTINCT ca.contractor_name
      FROM contractor_attendance ca
      JOIN daily_records dr ON dr.id = ca.record_id
      JOIN plants p ON p.id = dr.plant_id
      WHERE p.business_type = $1
      ORDER BY ca.contractor_name
    `, [bt]);
    const { rows: known } = await db.query(`
      SELECT name AS raw_name FROM contractors WHERE business_type = $1
      UNION
      SELECT raw_name FROM contractor_aliases WHERE business_type = $1
    `, [bt]);
    const knownSet = new Set(known.map(r => normalize(r.raw_name)));
    const unmatched = savedNames.map(r => r.contractor_name).filter(n => !knownSet.has(normalize(n)));
    res.json(unmatched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/contractors/merge — reassign historical contractor_attendance rows from one
// or more raw names onto a canonical contractor, across EVERY plant of this business
// type (not just the one you're viewing), and record aliases so the same raw spelling
// resolves correctly in any future CSV upload too.
// Body: { mappings: [{ rawName, contractorId }] }
router.post('/merge', async (req, res) => {
  const bt = await getBusinessType(req);
  if (!bt) return res.status(400).json({ error: 'No plant selected' });
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
      const { rows: cRows } = await client.query('SELECT name FROM contractors WHERE id = $1 AND business_type = $2', [contractorId, bt]);
      if (!cRows.length) continue;
      const canonicalName = cRows[0].name;

      await client.query(
        'INSERT INTO contractor_aliases (business_type, contractor_id, raw_name) VALUES ($1,$2,$3) ON CONFLICT (business_type, raw_name) DO UPDATE SET contractor_id = EXCLUDED.contractor_id',
        [bt, contractorId, rawName]
      );

      if (normalize(rawName) !== normalize(canonicalName)) {
        const { rowCount } = await client.query(`
          UPDATE contractor_attendance ca
          SET contractor_name = $1
          FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
          WHERE ca.record_id = dr.id AND p.business_type = $2 AND ca.contractor_name = $3
        `, [canonicalName, bt, rawName]);
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
