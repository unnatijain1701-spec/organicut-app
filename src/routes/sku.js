const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) cb(null, true);
    else cb(new Error('Only CSV or Excel (.xlsx/.xls) files are accepted.'));
  },
});

// Parse an uploaded SKU file (CSV or Excel) into rows: { skuName, rate, caseSize }.
// Expected columns (header row, any order, case-insensitive):
//   SKU Name (required), Rate (required), Case Size (optional)
function parseSKUFile(file) {
  const name = file.originalname.toLowerCase();
  let aoa;
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('The Excel file has no sheets.');
    aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false, defval: '' });
  } else {
    const text = file.buffer.toString('utf-8');
    aoa = text.split(/\r?\n/).filter(l => l.trim()).map(line => line.split(','));
  }
  if (!aoa.length) throw new Error('The file is empty.');

  const headers = aoa[0].map(h => String(h || '').trim().toLowerCase());
  const nameCol = headers.findIndex(h => h.includes('sku') && h.includes('name'));
  const rateCol = headers.findIndex(h => h.includes('rate'));
  const caseCol = headers.findIndex(h => h.includes('case'));
  if (nameCol === -1) throw new Error('Missing "SKU Name" column.');
  if (rateCol === -1) throw new Error('Missing "Rate" column.');

  const rows = [];
  for (const r of aoa.slice(1)) {
    const skuName = String(r[nameCol] ?? '').trim();
    if (!skuName) continue;
    const rate = parseFloat(r[rateCol]);
    if (isNaN(rate)) throw new Error(`Row with SKU "${skuName}" has an invalid or missing Rate.`);
    const caseSize = caseCol !== -1 && r[caseCol] !== '' ? parseFloat(r[caseCol]) : null;
    rows.push({ skuName, rate, caseSize: isNaN(caseSize) ? null : caseSize });
  }
  if (!rows.length) throw new Error('No valid SKU rows found in the file.');
  return rows;
}

function getPlantId(req) {
  if (req.user.plant_id != null) return req.user.plant_id;
  const pid = parseInt(req.query.plantId || req.body?.plantId);
  return isNaN(pid) ? null : pid;
}

// GET /api/sku  — all custom SKUs for this plant grouped by vendor
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM custom_skus WHERE plant_id = $1 ORDER BY vendor_name, display_order, id',
      [getPlantId(req)]
    );
    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.vendor_name]) grouped[r.vendor_name] = [];
      grouped[r.vendor_name].push({ id: r.id, name: r.sku_name, rate: parseFloat(r.rate), caseSize: r.case_size != null ? parseFloat(r.case_size) : 0 });
    });
    res.json(grouped);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/sku/rates  — all default SKU rate overrides for this plant
router.get('/rates', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT vendor_name, sku_index, rate FROM sku_rate_overrides WHERE plant_id = $1',
      [getPlantId(req)]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sku/rates  — save a default SKU rate override
router.post('/rates', (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  next();
}, async (req, res) => {
  const { vendorName, skuIndex, rate } = req.body || {};
  const pid = getPlantId(req);
  if (!vendorName || skuIndex == null || rate == null)
    return res.status(400).json({ error: 'vendorName, skuIndex, and rate are required' });
  try {
    await db.query(`
      INSERT INTO sku_rate_overrides (plant_id, vendor_name, sku_index, rate)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (plant_id, vendor_name, sku_index) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()
    `, [pid, vendorName, skuIndex, parseFloat(rate)]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sku  — add a custom SKU
router.post('/', (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  next();
}, async (req, res) => {
  const { vendorName, skuName, rate, caseSize } = req.body || {};
  const pid = getPlantId(req);
  if (!vendorName || !skuName || rate == null)
    return res.status(400).json({ error: 'vendorName, skuName, and rate are required' });

  try {
    const { rows } = await db.query(`
      INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, case_size)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (plant_id, vendor_name, sku_name) DO UPDATE SET rate = EXCLUDED.rate, case_size = EXCLUDED.case_size
      RETURNING id, vendor_name, sku_name, rate, case_size
    `, [pid, vendorName, skuName.trim(), parseFloat(rate), caseSize ? parseFloat(caseSize) : null]);
    const r = rows[0];
    res.json({ id: r.id, name: r.sku_name, rate: parseFloat(r.rate), caseSize: r.case_size != null ? parseFloat(r.case_size) : 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sku/bulk  — add many custom SKUs at once from an uploaded CSV/Excel file.
// Expected columns: SKU Name, Rate, Case Size (optional).
router.post('/bulk', (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  next();
}, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : err.message || 'Upload failed.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const vendorName = (req.body.vendorName || '').trim();
    if (!vendorName) return res.status(400).json({ error: 'vendorName is required' });
    const pid = getPlantId(req);

    let parsedRows;
    try {
      parsedRows = parseSKUFile(req.file);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    try {
      const inserted = [];
      for (const row of parsedRows) {
        const { rows } = await db.query(`
          INSERT INTO custom_skus (plant_id, vendor_name, sku_name, rate, case_size)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (plant_id, vendor_name, sku_name) DO UPDATE SET rate = EXCLUDED.rate, case_size = EXCLUDED.case_size
          RETURNING id, vendor_name, sku_name, rate, case_size
        `, [pid, vendorName, row.skuName, row.rate, row.caseSize]);
        const r = rows[0];
        inserted.push({ id: r.id, name: r.sku_name, rate: parseFloat(r.rate), caseSize: r.case_size != null ? parseFloat(r.case_size) : 0 });
      }
      res.json({ ok: true, count: inserted.length, skus: inserted });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// PATCH /api/sku/:id  — edit a custom SKU
router.patch('/:id', (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  next();
}, async (req, res) => {
  const { skuName, rate, caseSize } = req.body || {};
  try {
    const { rows } = await db.query(`
      UPDATE custom_skus SET sku_name = $1, rate = $2, case_size = $3 WHERE id = $4 AND plant_id = $5
      RETURNING id, sku_name, rate, case_size
    `, [skuName.trim(), parseFloat(rate), caseSize ? parseFloat(caseSize) : null, req.params.id, getPlantId(req)]);
    if (!rows.length) return res.status(404).json({ error: 'SKU not found' });
    res.json({ id: rows[0].id, name: rows[0].sku_name, rate: parseFloat(rows[0].rate), caseSize: rows[0].case_size != null ? parseFloat(rows[0].case_size) : 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/sku/:id
router.delete('/:id', (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
  next();
}, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM custom_skus WHERE id = $1 AND plant_id = $2',
      [req.params.id, getPlantId(req)]
    );
    if (!rowCount) return res.status(404).json({ error: 'SKU not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
