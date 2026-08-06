const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function getPlantId(req) {
  if (req.user.plant_id != null) return req.user.plant_id;
  const pid = parseInt(req.query.plantId || req.body?.plantId);
  return isNaN(pid) ? null : pid;
}

// GET /api/records  — list all records for this plant (summary only)
router.get('/', async (req, res) => {
  const pid = getPlantId(req);
  try {
    if (!pid) {
      // Superadmin "All Plants" — aggregate per date across all plants, include per-plant rows
      const { rows } = await db.query(`
        SELECT dr.id, dr.record_date, dr.attendance_cost, dr.kg_cost, dr.total_cost, dr.sale_qty, dr.mpk, dr.updated_at, dr.locked, p.name AS plant_name
        FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
        ORDER BY dr.record_date DESC, p.display_order
      `);
      return res.json(rows);
    }
    const { rows } = await db.query(`
      SELECT id, record_date, attendance_cost, kg_cost, total_cost, sale_qty, mpk, updated_at, locked
      FROM daily_records
      WHERE plant_id = $1
      ORDER BY record_date DESC
    `, [pid]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/export  — ALL records with full detail in 3 queries (no N+1)
router.get('/export', async (req, res) => {
  const pid = getPlantId(req);
  if (!pid) return res.json([]);
  try {
    const { rows: records } = await db.query(
      'SELECT * FROM daily_records WHERE plant_id = $1 ORDER BY record_date ASC', [pid]
    );
    const { rows: attendance } = await db.query(`
      SELECT ca.record_id, ca.contractor_name, ca.workers, ca.cost
      FROM contractor_attendance ca
      JOIN daily_records dr ON dr.id = ca.record_id
      WHERE dr.plant_id = $1
    `, [pid]);
    const { rows: kgEntries } = await db.query(`
      SELECT vke.record_id, vke.vendor_name, vke.sku_name, vke.rate, vke.qty, vke.cost
      FROM vendor_kg_entries vke
      JOIN daily_records dr ON dr.id = vke.record_id
      WHERE dr.plant_id = $1
    `, [pid]);

    const attMap = {};
    attendance.forEach(a => {
      if (!attMap[a.record_id]) attMap[a.record_id] = [];
      attMap[a.record_id].push(a);
    });
    const kgMap = {};
    kgEntries.forEach(e => {
      if (!kgMap[e.record_id]) kgMap[e.record_id] = [];
      kgMap[e.record_id].push(e);
    });

    const result = records.map(r => ({
      ...r,
      attendance: attMap[r.id] || [],
      kgEntries:  kgMap[r.id]  || [],
    }));

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/contractors  — every distinct contractor name ever used at this
// plant, pulled from the database (not per-device localStorage) so every user sees
// the same list and can pick an existing name instead of retyping a new spelling.
router.get('/contractors', async (req, res) => {
  const pid = getPlantId(req);
  if (!pid) return res.json({ names: [] });
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT ca.contractor_name
      FROM contractor_attendance ca
      JOIN daily_records dr ON dr.id = ca.record_id
      WHERE dr.plant_id = $1
      ORDER BY ca.contractor_name
    `, [pid]);
    res.json({ names: rows.map(r => r.contractor_name) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/contractor-drift?from=&to=  — per-contractor daily cost/workers
// for the selected plant + range, so the client can flag anyone whose cost-per-worker
// is trending up (used by the Dashboard's "Contractor Cost Trend" section).
router.get('/contractor-drift', async (req, res) => {
  const pid = getPlantId(req);
  if (!pid) return res.json({ rows: [] }); // all-plants mode has no single plant to scope contractors to
  const from = (req.query.from || '').slice(0, 10);
  const to   = (req.query.to   || '').slice(0, 10);
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const { rows } = await db.query(`
      SELECT dr.record_date AS date, ca.contractor_name, ca.workers, ca.cost
      FROM contractor_attendance ca
      JOIN daily_records dr ON dr.id = ca.record_id
      WHERE dr.plant_id = $1 AND dr.record_date BETWEEN $2 AND $3
      ORDER BY ca.contractor_name, dr.record_date ASC
    `, [pid, from, to]);
    res.json({ rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/analytics  — monthly + daily aggregates for dashboard
router.get('/analytics', async (req, res) => {
  const pid = getPlantId(req);
  try {
    if (!pid) {
      // Superadmin "All Plants" — aggregate across all plants
      const { rows: daily } = await db.query(`
        SELECT record_date AS date,
          SUM(attendance_cost)::NUMERIC(12,2) AS attendance_cost,
          SUM(kg_cost)::NUMERIC(12,2)         AS kg_cost,
          SUM(total_cost)::NUMERIC(12,2)      AS total_cost,
          SUM(sale_qty)::NUMERIC(12,2)        AS sale_qty,
          CASE WHEN SUM(sale_qty) > 0 THEN (SUM(total_cost)/SUM(sale_qty))::NUMERIC(10,4) ELSE 0 END AS mpk
        FROM daily_records GROUP BY record_date ORDER BY record_date ASC
      `);
      const { rows: monthly } = await db.query(`
        SELECT TO_CHAR(record_date, 'YYYY-MM') AS month,
          CASE WHEN SUM(sale_qty) > 0 THEN (SUM(total_cost)/SUM(sale_qty))::NUMERIC(10,4) ELSE 0 END AS avg_mpk,
          AVG(attendance_cost)::NUMERIC(12,2) AS avg_attendance_cost,
          AVG(kg_cost)::NUMERIC(12,2)         AS avg_kg_cost,
          COUNT(DISTINCT record_date)         AS days
        FROM daily_records
        GROUP BY TO_CHAR(record_date, 'YYYY-MM')
        ORDER BY month ASC
      `);
      return res.json({ daily, monthly });
    }
    const { rows: daily } = await db.query(`
      SELECT record_date AS date, attendance_cost, kg_cost, total_cost, sale_qty, mpk
      FROM daily_records WHERE plant_id = $1 ORDER BY record_date ASC
    `, [pid]);
    const { rows: monthly } = await db.query(`
      SELECT
        TO_CHAR(record_date, 'YYYY-MM') AS month,
        AVG(mpk)::NUMERIC(10,4)             AS avg_mpk,
        AVG(attendance_cost)::NUMERIC(12,2) AS avg_attendance_cost,
        AVG(kg_cost)::NUMERIC(12,2)         AS avg_kg_cost,
        COUNT(*)                            AS days
      FROM daily_records
      WHERE plant_id = $1
      GROUP BY TO_CHAR(record_date, 'YYYY-MM')
      ORDER BY month ASC
    `, [pid]);
    res.json({ daily, monthly });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/compare?from=&to=  — superadmin: daily cost+qty per plant, for cross-plant MPK comparison
router.get('/compare', async (req, res) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Superadmin only' });
  const from = (req.query.from || '').slice(0, 10);
  const to   = (req.query.to   || '').slice(0, 10);
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const { rows } = await db.query(`
      SELECT p.id AS plant_id, p.name AS plant_name, p.display_order,
        dr.record_date AS date, dr.total_cost, dr.sale_qty
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2
      ORDER BY p.display_order, dr.record_date ASC
    `, [from, to]);

    const plantMap = {};
    rows.forEach(r => {
      if (!plantMap[r.plant_id]) plantMap[r.plant_id] = { name: r.plant_name, daily: [] };
      plantMap[r.plant_id].daily.push({
        date: r.date.toISOString().slice(0, 10),
        cost: parseFloat(r.total_cost),
        qty:  parseFloat(r.sale_qty),
      });
    });

    res.json({ from, to, plants: Object.values(plantMap) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/allplants/:date  — per-plant summary for a date (all-plants users only)
router.get('/allplants/:date', async (req, res) => {
  if (req.user.plant_id != null) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await db.query(`
      SELECT dr.attendance_cost, dr.kg_cost, dr.total_cost, dr.sale_qty, dr.mpk, p.name AS plant_name, p.display_order
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date = $1
      ORDER BY p.display_order
    `, [req.params.date]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/report?from=&to=  — superadmin: per-plant multi-facility report
// Returns, for the selected range: per-plant cost/tonnage/MPK, plus each plant's
// previous-calendar-month MPK (for the improving/worsening comparison).
router.get('/report', async (req, res) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Superadmin only' });
  const from = (req.query.from || '').slice(0, 10);
  const to   = (req.query.to   || '').slice(0, 10);
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    // Previous calendar month relative to the report's "from" month
    const d = new Date(from + 'T00:00:00');
    const prevFirst = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const prevLast  = new Date(d.getFullYear(), d.getMonth(), 0);
    const iso = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

    // A day counts as COMPLETE only when attendance cost, sale qty AND per-kg cost
    // are all filled. Jaipur has no per-kg processing, so it's exempt from the KG check.
    // (Fixed SQL fragment — no user input, safe to interpolate.)
    const COMPLETE = "dr.attendance_cost > 0 AND dr.sale_qty > 0 AND (p.name = 'Jaipur' OR dr.kg_cost > 0)";

    const { rows: current } = await db.query(`
      SELECT p.id, p.name, p.display_order,
        COUNT(*) FILTER (WHERE ${COMPLETE})                    AS days,
        COUNT(*)                                               AS days_saved,
        COALESCE(SUM(dr.total_cost) FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_cost,
        COALESCE(SUM(dr.sale_qty)   FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_qty,
        CASE WHEN SUM(dr.sale_qty) FILTER (WHERE ${COMPLETE}) > 0
          THEN (SUM(dr.total_cost) FILTER (WHERE ${COMPLETE}) / SUM(dr.sale_qty) FILTER (WHERE ${COMPLETE}))::NUMERIC(10,4)
          ELSE 0 END AS mpk
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2
      GROUP BY p.id, p.name, p.display_order
      ORDER BY p.display_order
    `, [from, to]);

    const { rows: prev } = await db.query(`
      SELECT p.id,
        COALESCE(SUM(dr.total_cost) FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_cost,
        COALESCE(SUM(dr.sale_qty)   FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_qty,
        CASE WHEN SUM(dr.sale_qty) FILTER (WHERE ${COMPLETE}) > 0
          THEN (SUM(dr.total_cost) FILTER (WHERE ${COMPLETE}) / SUM(dr.sale_qty) FILTER (WHERE ${COMPLETE}))::NUMERIC(10,4)
          ELSE 0 END AS mpk
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2
      GROUP BY p.id
    `, [iso(prevFirst), iso(prevLast)]);

    const prevMap = {};
    prev.forEach(r => { prevMap[r.id] = { mpk: parseFloat(r.mpk), cost: parseFloat(r.total_cost), qty: parseFloat(r.total_qty) }; });
    const plants = current.map(r => ({
      name: r.name,
      days: parseInt(r.days),
      total_cost: parseFloat(r.total_cost),
      total_qty:  parseFloat(r.total_qty),
      mpk:        parseFloat(r.mpk),
      last_month_mpk:  prevMap[r.id]?.mpk  ?? null,
      last_month_cost: prevMap[r.id]?.cost ?? null,
      last_month_qty:  prevMap[r.id]?.qty  ?? null,
    }));

    res.json({ from, to, daysInMonth, prevMonthLabel: iso(prevFirst).slice(0,7), plants });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/audit  — superadmin: recent deletion audit entries for a plant
router.get('/audit', async (req, res) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Superadmin only' });
  const pid = getPlantId(req);
  try {
    const params = [];
    let where = '';
    if (pid) { where = 'WHERE a.plant_id = $1'; params.push(pid); }
    const { rows } = await db.query(`
      SELECT a.record_date, a.action, a.details, a.username, a.created_at, p.name AS plant_name
      FROM audit_log a LEFT JOIN plants p ON p.id = a.plant_id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT 300
    `, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/:date  — full record with attendance + KG breakdown
router.get('/:date', async (req, res) => {
  const pid = getPlantId(req);
  try {
    const { rows: records } = await db.query(
      'SELECT * FROM daily_records WHERE plant_id = $1 AND record_date = $2',
      [pid, req.params.date]
    );
    if (!records.length) return res.status(404).json({ error: 'No record found for this date' });

    const record = records[0];
    const { rows: attendance } = await db.query(
      'SELECT contractor_name, workers, cost FROM contractor_attendance WHERE record_id = $1 ORDER BY contractor_name',
      [record.id]
    );
    const { rows: kgEntries } = await db.query(
      'SELECT vendor_name, sku_name, rate, qty, cost FROM vendor_kg_entries WHERE record_id = $1 ORDER BY vendor_name, sku_name',
      [record.id]
    );

    res.json({ ...record, attendance, kgEntries });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/records  — create or update (upsert by plant + date)
router.post('/', async (req, res) => {
  const { date, attendanceCost, kgCost, totalCost, saleQty, mpk, notes, attendance, kgEntries } = req.body || {};
  const pid = getPlantId(req);

  if (!pid) return res.status(400).json({ error: 'No plant selected — please select a plant before saving' });
  if (!date) return res.status(400).json({ error: '"date" is required (YYYY-MM-DD)' });

  // Block saves on locked records for non-superadmin
  if (req.user.role !== 'superadmin') {
    const { rows: chk } = await db.query(
      'SELECT locked FROM daily_records WHERE plant_id=$1 AND record_date=$2',
      [pid, date]
    );
    if (chk[0]?.locked) {
      return res.status(403).json({ error: 'Record is locked. Contact your superadmin to unlock it.' });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO daily_records
        (plant_id, record_date, attendance_cost, kg_cost, total_cost, sale_qty, mpk, notes, updated_at, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
      ON CONFLICT (plant_id, record_date) DO UPDATE SET
        attendance_cost = EXCLUDED.attendance_cost,
        kg_cost         = EXCLUDED.kg_cost,
        total_cost      = EXCLUDED.total_cost,
        sale_qty        = EXCLUDED.sale_qty,
        mpk             = EXCLUDED.mpk,
        notes           = EXCLUDED.notes,
        updated_at      = NOW(),
        updated_by      = EXCLUDED.updated_by
      RETURNING id
    `, [pid, date, attendanceCost ?? 0, kgCost ?? 0, totalCost ?? 0, saleQty ?? 0, mpk ?? 0, notes ?? null, req.user.username]);

    const recordId = rows[0].id;

    // --- Audit: detect vendors/SKUs removed compared to what was previously saved ---
    const { rows: oldAtt } = await client.query(
      'SELECT contractor_name FROM contractor_attendance WHERE record_id = $1', [recordId]);
    const { rows: oldKg } = await client.query(
      'SELECT vendor_name, sku_name FROM vendor_kg_entries WHERE record_id = $1', [recordId]);
    const newAttNames = new Set((attendance || []).map(a => a.contractorName));
    const newKgKeys   = new Set((kgEntries || []).map(e => e.vendorName + '||' + e.skuName));
    const removedAtt = oldAtt.map(r => r.contractor_name).filter(n => !newAttNames.has(n));
    const removedKg  = oldKg.filter(r => !newKgKeys.has(r.vendor_name + '||' + r.sku_name))
                            .map(r => `${r.vendor_name}/${r.sku_name === '__UNLOADING__' ? 'Unloading' : r.sku_name}`);
    const auditParts = [];
    if (removedAtt.length) auditParts.push('Attendance removed: ' + removedAtt.join(', '));
    if (removedKg.length)  auditParts.push('KG entries removed: ' + removedKg.join(', '));
    if (auditParts.length) {
      await client.query(
        'INSERT INTO audit_log (plant_id, record_date, action, details, username) VALUES ($1,$2,$3,$4,$5)',
        [pid, date, 'remove_entries', auditParts.join('; '), req.user.username]);
    }

    await client.query('DELETE FROM contractor_attendance WHERE record_id = $1', [recordId]);
    for (const a of (attendance || [])) {
      await client.query(
        'INSERT INTO contractor_attendance (record_id, contractor_name, workers, cost) VALUES ($1,$2,$3,$4)',
        [recordId, a.contractorName, a.workers ?? 0, a.cost ?? 0]
      );
    }

    await client.query('DELETE FROM vendor_kg_entries WHERE record_id = $1', [recordId]);
    for (const e of (kgEntries || [])) {
      if (!(e.qty > 0)) continue;
      await client.query(
        'INSERT INTO vendor_kg_entries (record_id, vendor_name, sku_name, rate, qty, cost) VALUES ($1,$2,$3,$4,$5,$6)',
        [recordId, e.vendorName, e.skuName, e.rate ?? 0, e.qty, e.cost ?? 0]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, id: recordId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/records/:date
router.delete('/:date', async (req, res) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Superadmin only' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  try {
    // Capture what's being deleted for the audit log, before it's gone
    const { rows: existing } = await db.query(
      'SELECT total_cost, sale_qty, mpk FROM daily_records WHERE plant_id = $1 AND record_date = $2',
      [pid, req.params.date]
    );
    const { rowCount } = await db.query(
      'DELETE FROM daily_records WHERE plant_id = $1 AND record_date = $2',
      [pid, req.params.date]
    );
    if (!rowCount) return res.status(404).json({ error: 'Record not found' });
    const e0 = existing[0];
    const details = e0
      ? `Deleted full day record (total ₹${e0.total_cost}, sale qty ${e0.sale_qty}, MPK ${e0.mpk})`
      : 'Deleted full day record';
    await db.query(
      'INSERT INTO audit_log (plant_id, record_date, action, details, username) VALUES ($1,$2,$3,$4,$5)',
      [pid, req.params.date, 'delete_record', details, req.user.username]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/records/lock-all  — superadmin: lock or unlock ALL records for a plant
router.patch('/lock-all', async (req, res) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Superadmin only' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  const locked = req.body?.locked === true || req.body?.locked === 'true';
  try {
    const { rowCount } = await db.query(
      'UPDATE daily_records SET locked=$1, updated_at=NOW(), updated_by=$2 WHERE plant_id=$3',
      [locked, req.user.username, pid]
    );
    res.json({ ok: true, locked, count: rowCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/records/:date/lock  — superadmin: lock or unlock a record
router.patch('/:date/lock', async (req, res) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Superadmin only' });
  const pid = getPlantId(req);
  if (!pid) return res.status(400).json({ error: 'No plant selected' });
  const locked = req.body?.locked === true || req.body?.locked === 'true';
  try {
    const { rowCount } = await db.query(
      'UPDATE daily_records SET locked=$1, updated_at=NOW(), updated_by=$2 WHERE plant_id=$3 AND record_date=$4',
      [locked, req.user.username, pid, req.params.date]
    );
    if (!rowCount) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true, locked });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
