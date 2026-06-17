const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/sku  — all custom SKUs grouped by vendor
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM custom_skus ORDER BY vendor_name, display_order, id'
    );
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

// GET /api/sku/rates  — all default SKU rate overrides
router.get('/rates', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT vendor_name, sku_index, rate FROM sku_rate_overrides');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sku/rates  — save a default SKU rate override
router.post('/rates', async (req, res) => {
  const { vendorName, skuIndex, rate } = req.body || {};
  if (!vendorName || skuIndex == null || rate == null)
    return res.status(400).json({ error: 'vendorName, skuIndex, and rate are required' });
  try {
    await db.query(`
      INSERT INTO sku_rate_overrides (vendor_name, sku_index, rate)
      VALUES ($1, $2, $3)
      ON CONFLICT (vendor_name, sku_index) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()
    `, [vendorName, skuIndex, parseFloat(rate)]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sku  — add a custom SKU
router.post('/', async (req, res) => {
  const { vendorName, skuName, rate } = req.body || {};
  if (!vendorName || !skuName || rate == null)
    return res.status(400).json({ error: 'vendorName, skuName, and rate are required' });

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

// PATCH /api/sku/:id  — edit a custom SKU
router.patch('/:id', async (req, res) => {
  const { skuName, rate } = req.body || {};
  try {
    const { rows } = await db.query(`
      UPDATE custom_skus SET sku_name = $1, rate = $2 WHERE id = $3
      RETURNING id, sku_name, rate
    `, [skuName.trim(), parseFloat(rate), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'SKU not found' });
    res.json({ id: rows[0].id, name: rows[0].sku_name, rate: parseFloat(rows[0].rate) });
  } catch (e) {
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
