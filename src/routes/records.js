const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/records  — list all records (summary only)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, record_date, attendance_cost, kg_cost, total_cost, sale_qty, mpk, updated_at
      FROM daily_records
      ORDER BY record_date DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/export  — ALL records with full detail in 3 queries (no N+1)
router.get('/export', async (req, res) => {
  try {
    const { rows: records } = await db.query(
      'SELECT * FROM daily_records ORDER BY record_date ASC'
    );
    const { rows: attendance } = await db.query(`
      SELECT ca.record_id, ca.contractor_name, ca.workers, ca.cost
      FROM contractor_attendance ca
    `);
    const { rows: kgEntries } = await db.query(`
      SELECT vke.record_id, vke.vendor_name, vke.sku_name, vke.rate, vke.qty, vke.cost
      FROM vendor_kg_entries vke
    `);

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

// GET /api/records/analytics  — monthly + daily aggregates for dashboard
router.get('/analytics', async (req, res) => {
  try {
    const { rows: daily } = await db.query(`
      SELECT record_date AS date, attendance_cost, kg_cost, total_cost, sale_qty, mpk
      FROM daily_records ORDER BY record_date ASC
    `);
    const { rows: monthly } = await db.query(`
      SELECT
        TO_CHAR(record_date, 'YYYY-MM') AS month,
        AVG(mpk)::NUMERIC(10,4)             AS avg_mpk,
        AVG(attendance_cost)::NUMERIC(12,2) AS avg_attendance_cost,
        AVG(kg_cost)::NUMERIC(12,2)         AS avg_kg_cost,
        COUNT(*)                            AS days
      FROM daily_records
      GROUP BY TO_CHAR(record_date, 'YYYY-MM')
      ORDER BY month ASC
    `);
    res.json({ daily, monthly });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/records/:date  — full record with attendance + KG breakdown
router.get('/:date', async (req, res) => {
  try {
    const { rows: records } = await db.query(
      'SELECT * FROM daily_records WHERE record_date = $1', [req.params.date]
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

// POST /api/records  — create or update (upsert by date)
router.post('/', async (req, res) => {
  const { date, attendanceCost, kgCost, totalCost, saleQty, mpk, notes, attendance, kgEntries } = req.body || {};

  if (!date) return res.status(400).json({ error: '"date" is required (YYYY-MM-DD)' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO daily_records
        (record_date, attendance_cost, kg_cost, total_cost, sale_qty, mpk, notes, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (record_date) DO UPDATE SET
        attendance_cost = EXCLUDED.attendance_cost,
        kg_cost         = EXCLUDED.kg_cost,
        total_cost      = EXCLUDED.total_cost,
        sale_qty        = EXCLUDED.sale_qty,
        mpk             = EXCLUDED.mpk,
        notes           = EXCLUDED.notes,
        updated_at      = NOW()
      RETURNING id
    `, [date, attendanceCost ?? 0, kgCost ?? 0, totalCost ?? 0, saleQty ?? 0, mpk ?? 0, notes ?? null]);

    const recordId = rows[0].id;

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
  try {
    const { rowCount } = await db.query(
      'DELETE FROM daily_records WHERE record_date = $1', [req.params.date]
    );
    if (!rowCount) return res.status(404).json({ error: 'Record not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
