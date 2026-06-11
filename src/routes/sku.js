const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/sku  — all custom SKUs grouped by vendor
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM custom_skus ORDER BY vendor_name, display_order, id'
    );
    // Group by vendor
    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.vendor_name]) grouped[r.vendor_name] = [];
      grouped[r.vendor_name].push({ id: r.id, name: r.sku_name, rate: parseFloat(r.rate) });
    });
    res.json(grouped);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sku  — add a custom SKU
router.post('/', async (req, res) => {
  const { vendorName, skuName, rate } = req.body || {};
  if (!vendorName || !skuName || rate == null) {
    return res.status(400).json({ error: 'vendorName, skuName, and rate are required' });
  }

  try {
    const { rows } = await db.query(`
      INSERT INTO custom_skus (vendor_name, sku_name, rate)
      VALUES ($1, $2, $3)
      ON CONFLICT (vendor_name, sku_name) DO UPDATE SET rate = EXCLUDED.rate
      RETURNING id, vendor_name, sku_name, rate
    `, [vendorName, skuName.trim(), parseFloat(rate)]);

    const r = rows[0];
    res.json({ id: r.id, name: r.sku_name, rate: parseFloat(r.rate) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/sku/:id  — update name and/or rate
router.patch('/:id', async (req, res) => {
  const { skuName, rate } = req.body || {};
  if (!skuName && rate == null) {
    return res.status(400).json({ error: 'skuName or rate is required' });
  }
  try {
    const sets = [], vals = [];
    if (skuName) { sets.push(`sku_name = $${vals.length + 1}`); vals.push(skuName.trim()); }
    if (rate != null) { sets.push(`rate = $${vals.length + 1}`); vals.push(parseFloat(rate)); }
    vals.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE custom_skus SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, vendor_name, sku_name, rate`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'SKU not found' });
    const r = rows[0];
    res.json({ id: r.id, name: r.sku_name, rate: parseFloat(r.rate) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'SKU name already exists for this vendor' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/sku/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM custom_skus WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'SKU not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
