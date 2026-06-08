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
      if (!(e.qty > 0)) continue; // skip zero-qty rows
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
