/* ═══════════════════════════════════════════════════════
   COST INSIGHTS — Layers 1-4
   Layer 1: Cost Visibility (where the money goes)
   Layer 2: Variance & Root-Cause Analysis (why costs changed)
   Layer 3: Anomaly Detection (flag values that deserve investigation)
   Layer 4: Forecasting & Targets (estimate where costs are heading)
═══════════════════════════════════════════════════════ */

const express = require('express');
const db = require('../db');
const { hasPermission } = require('../utils/permissions');
const { countWorkingDays } = require('../utils/workingDays');

const router = express.Router();

// ── Shared helpers (same as records.js) ──────────────────────

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

function plantScopeClause(req, params) {
  if (req.user.role === 'superadmin') return '';
  const allowed = req.user.plantIds || (req.user.plant_id != null ? [req.user.plant_id] : []);
  params.push(allowed);
  return `AND p.id = ANY($${params.length})`;
}

// Same "complete day" definition as records.js — see comment there.
const COMPLETE = "dr.attendance_cost > 0 AND dr.sale_qty > 0 AND (NOT p.has_kg_processing OR EXISTS (SELECT 1 FROM vendor_kg_entries vke WHERE vke.record_id = dr.id AND vke.qty > 0))";

// ── Layer 1: Cost Visibility Overview ────────────────────────
// GET /api/insights/overview?month=YYYY-MM&businessType=
// Returns per-plant monthly totals, attendance vs kg split, vendor-wise
// attendance, SKU-wise kg cost, and cost-per-kg beside total cost.
router.get('/overview', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const month = (req.query.month || '').slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month param required (YYYY-MM)' });
  const [yr, mo] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to   = `${yr}-${String(mo).padStart(2, '0')}-${new Date(yr, mo, 0).getDate()}`;
  const businessType = req.query.businessType || null;
  try {
    const params = [from, to];
    let btFilter = '';
    if (businessType) { params.push(businessType); btFilter = `AND p.business_type = $${params.length}`; }
    const scopeFilter = plantScopeClause(req, params);

    // 1a. Per-plant summary (complete days only)
    const { rows: plants } = await db.query(`
      SELECT p.id, p.name, p.display_order, p.business_type, p.has_kg_processing,
        COUNT(*) FILTER (WHERE ${COMPLETE}) AS days,
        COUNT(*) AS days_saved,
        COALESCE(SUM(dr.attendance_cost) FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS attendance_cost,
        COALESCE(SUM(dr.kg_cost)         FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS kg_cost,
        COALESCE(SUM(dr.total_cost)      FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_cost,
        COALESCE(SUM(dr.sale_qty)        FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_qty
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2 ${btFilter} ${scopeFilter}
      GROUP BY p.id, p.name, p.display_order, p.business_type, p.has_kg_processing
      ORDER BY p.display_order
    `, params);

    // 1b. Vendor-wise attendance cost (from contractor_attendance joined to daily_records)
    const vendorParams = [from, to];
    let vendorBtFilter = '';
    if (businessType) { vendorParams.push(businessType); vendorBtFilter = `AND p.business_type = $${vendorParams.length}`; }
    const vendorScopeFilter = plantScopeClause(req, vendorParams);

    const { rows: vendorAttendance } = await db.query(`
      SELECT p.id AS plant_id, ca.contractor_name,
        SUM(ca.cost)::NUMERIC(14,2) AS cost,
        SUM(ca.workers)::INTEGER AS workers
      FROM contractor_attendance ca
        JOIN daily_records dr ON dr.id = ca.record_id
        JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2 ${vendorBtFilter} ${vendorScopeFilter}
      GROUP BY p.id, ca.contractor_name
      ORDER BY SUM(ca.cost) DESC
    `, vendorParams);

    // 1c. SKU-wise kg cost (from vendor_kg_entries joined to daily_records)
    const skuParams = [from, to];
    let skuBtFilter = '';
    if (businessType) { skuParams.push(businessType); skuBtFilter = `AND p.business_type = $${skuParams.length}`; }
    const skuScopeFilter = plantScopeClause(req, skuParams);

    const { rows: skuCost } = await db.query(`
      SELECT p.id AS plant_id, vke.sku_name, vke.vendor_name,
        SUM(vke.cost)::NUMERIC(14,2)  AS cost,
        SUM(vke.qty)::NUMERIC(14,4)   AS qty,
        CASE WHEN SUM(vke.qty) > 0
          THEN (SUM(vke.cost) / SUM(vke.qty))::NUMERIC(10,4)
          ELSE 0 END AS avg_rate
      FROM vendor_kg_entries vke
        JOIN daily_records dr ON dr.id = vke.record_id
        JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2
        AND vke.sku_name != '__UNLOADING__'
        ${skuBtFilter} ${skuScopeFilter}
      GROUP BY p.id, vke.sku_name, vke.vendor_name
      ORDER BY SUM(vke.cost) DESC
    `, skuParams);

    res.json({ month, from, to, plants, vendorAttendance, skuCost });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Layer 2: Variance & Root-Cause Analysis ─────────────────
// GET /api/insights/variance?month=YYYY-MM&businessType=
// Compares current month to the previous month. Decomposes the MPK change
// into: attendance effect, kg-cost effect, and volume effect.
router.get('/variance', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const month = (req.query.month || '').slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month param required (YYYY-MM)' });
  const [yr, mo] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to   = `${yr}-${String(mo).padStart(2, '0')}-${new Date(yr, mo, 0).getDate()}`;
  // Previous month
  const prevDate = new Date(yr, mo - 2, 1);
  const prevFrom = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-01`;
  const prevLastDay = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).getDate();
  const prevTo   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${prevLastDay}`;
  const businessType = req.query.businessType || null;
  try {
    // Helper to run the per-plant summary for a date range
    async function getPlantSummary(rangeFrom, rangeTo) {
      const params = [rangeFrom, rangeTo];
      let btFilter = '';
      if (businessType) { params.push(businessType); btFilter = `AND p.business_type = $${params.length}`; }
      const scopeFilter = plantScopeClause(req, params);
      const { rows } = await db.query(`
        SELECT p.id, p.name, p.display_order, p.business_type,
          COUNT(*) FILTER (WHERE ${COMPLETE}) AS days,
          COALESCE(SUM(dr.attendance_cost) FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS attendance_cost,
          COALESCE(SUM(dr.kg_cost)         FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS kg_cost,
          COALESCE(SUM(dr.total_cost)      FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_cost,
          COALESCE(SUM(dr.sale_qty)        FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_qty
        FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $1 AND $2 ${btFilter} ${scopeFilter}
        GROUP BY p.id, p.name, p.display_order, p.business_type
        ORDER BY p.display_order
      `, params);
      return rows;
    }

    // Helper to get vendor-level attendance for a date range
    async function getVendorAttendance(rangeFrom, rangeTo) {
      const params = [rangeFrom, rangeTo];
      let btFilter = '';
      if (businessType) { params.push(businessType); btFilter = `AND p.business_type = $${params.length}`; }
      const scopeFilter = plantScopeClause(req, params);
      const { rows } = await db.query(`
        SELECT p.id AS plant_id, ca.contractor_name,
          SUM(ca.cost)::NUMERIC(14,2) AS cost,
          SUM(ca.workers)::INTEGER AS workers
        FROM contractor_attendance ca
          JOIN daily_records dr ON dr.id = ca.record_id
          JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $1 AND $2 ${btFilter} ${scopeFilter}
        GROUP BY p.id, ca.contractor_name
      `, params);
      return rows;
    }

    // Helper to get SKU-level kg cost for a date range
    async function getSkuCost(rangeFrom, rangeTo) {
      const params = [rangeFrom, rangeTo];
      let btFilter = '';
      if (businessType) { params.push(businessType); btFilter = `AND p.business_type = $${params.length}`; }
      const scopeFilter = plantScopeClause(req, params);
      const { rows } = await db.query(`
        SELECT p.id AS plant_id, vke.sku_name, vke.vendor_name,
          SUM(vke.cost)::NUMERIC(14,2) AS cost,
          SUM(vke.qty)::NUMERIC(14,4)  AS qty,
          CASE WHEN SUM(vke.qty) > 0
            THEN (SUM(vke.cost) / SUM(vke.qty))::NUMERIC(10,4)
            ELSE 0 END AS avg_rate
        FROM vendor_kg_entries vke
          JOIN daily_records dr ON dr.id = vke.record_id
          JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $1 AND $2
          AND vke.sku_name != '__UNLOADING__'
          ${btFilter} ${scopeFilter}
        GROUP BY p.id, vke.sku_name, vke.vendor_name
      `, params);
      return rows;
    }

    const [currentPlants, prevPlants, currentVendors, prevVendors, currentSkus, prevSkus] = await Promise.all([
      getPlantSummary(from, to),
      getPlantSummary(prevFrom, prevTo),
      getVendorAttendance(from, to),
      getVendorAttendance(prevFrom, prevTo),
      getSkuCost(from, to),
      getSkuCost(prevFrom, prevTo),
    ]);

    // Build per-plant variance decomposition
    const prevMap = {};
    prevPlants.forEach(r => { prevMap[r.id] = r; });

    const variance = currentPlants.map(cur => {
      const prv = prevMap[cur.id];
      const curDays = parseInt(cur.days) || 0;
      const curAtt  = parseFloat(cur.attendance_cost);
      const curKg   = parseFloat(cur.kg_cost);
      const curTot  = parseFloat(cur.total_cost);
      const curQty  = parseFloat(cur.total_qty);
      const curMPK  = curQty > 0 ? curTot / curQty : null;

      const prvDays = prv ? (parseInt(prv.days) || 0) : 0;
      const prvAtt  = prv ? parseFloat(prv.attendance_cost) : 0;
      const prvKg   = prv ? parseFloat(prv.kg_cost) : 0;
      const prvTot  = prv ? parseFloat(prv.total_cost) : 0;
      const prvQty  = prv ? parseFloat(prv.total_qty) : 0;
      const prvMPK  = prvQty > 0 ? prvTot / prvQty : null;

      // Decompose MPK change:
      // MPK = (AttCost + KgCost) / Qty
      // ΔAttEffect = (curAtt/curQty) - (prvAtt/prvQty)  [change in att cost per unit]
      // ΔKgEffect  = (curKg/curQty) - (prvKg/prvQty)    [change in kg cost per unit]
      // Together these sum to the total MPK change.
      // Volume effect: how much of the cost change is explained by volume vs rate
      let attEffect = null, kgEffect = null, volumeEffect = null;
      if (curQty > 0 && prvQty > 0) {
        const curAttPerUnit = curAtt / curQty;
        const prvAttPerUnit = prvAtt / prvQty;
        const curKgPerUnit  = curKg / curQty;
        const prvKgPerUnit  = prvKg / prvQty;
        attEffect = curAttPerUnit - prvAttPerUnit;
        kgEffect  = curKgPerUnit - prvKgPerUnit;

        // Volume effect: if costs stayed at previous rates, how much would the
        // total cost change just from the qty change?
        // = prvMPK × (curQty - prvQty)  (the cost difference from volume alone)
        // expressed as an impact on total cost, not per-unit
        volumeEffect = {
          qtyCurrent: curQty,
          qtyPrev:    prvQty,
          qtyChange:  curQty - prvQty,
          costFromVolume:   prvMPK * (curQty - prvQty),  // if rates stayed same
          costFromRate:     curTot - prvTot - prvMPK * (curQty - prvQty), // remainder = rate change
        };
      }

      return {
        id:   cur.id,
        name: cur.name,
        businessType: cur.business_type,
        current: { days: curDays, attendance: curAtt, kg: curKg, total: curTot, qty: curQty, mpk: curMPK },
        previous: { days: prvDays, attendance: prvAtt, kg: prvKg, total: prvTot, qty: prvQty, mpk: prvMPK },
        mpkChange: curMPK != null && prvMPK != null ? curMPK - prvMPK : null,
        attEffect,
        kgEffect,
        volumeEffect,
      };
    });

    // Vendor-level changes — build maps keyed by plant_id:vendor
    function vendorMap(rows) {
      const m = {};
      rows.forEach(r => {
        const key = `${r.plant_id}:${r.contractor_name}`;
        m[key] = { cost: parseFloat(r.cost), workers: parseInt(r.workers) || 0 };
      });
      return m;
    }
    const curVendorMap  = vendorMap(currentVendors);
    const prevVendorMap = vendorMap(prevVendors);
    const allVendorKeys = new Set([...Object.keys(curVendorMap), ...Object.keys(prevVendorMap)]);
    const vendorChanges = [];
    for (const key of allVendorKeys) {
      const [plantId, ...rest] = key.split(':');
      const name = rest.join(':');
      const cur  = curVendorMap[key]  || { cost: 0, workers: 0 };
      const prev = prevVendorMap[key] || { cost: 0, workers: 0 };
      const delta = cur.cost - prev.cost;
      if (Math.abs(delta) > 0.01) {
        vendorChanges.push({ plantId: parseInt(plantId), vendor: name, current: cur.cost, previous: prev.cost, change: delta });
      }
    }
    vendorChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    // SKU-level changes — build maps keyed by plant_id:vendor:sku
    function skuMap(rows) {
      const m = {};
      rows.forEach(r => {
        const key = `${r.plant_id}:${r.vendor_name}:${r.sku_name}`;
        m[key] = { cost: parseFloat(r.cost), qty: parseFloat(r.qty), rate: parseFloat(r.avg_rate) };
      });
      return m;
    }
    const curSkuMap  = skuMap(currentSkus);
    const prevSkuMap = skuMap(prevSkus);
    const allSkuKeys = new Set([...Object.keys(curSkuMap), ...Object.keys(prevSkuMap)]);
    const skuChanges = [];
    for (const key of allSkuKeys) {
      const [plantId, vendor, ...rest] = key.split(':');
      const sku = rest.join(':');
      const cur  = curSkuMap[key]  || { cost: 0, qty: 0, rate: 0 };
      const prev = prevSkuMap[key] || { cost: 0, qty: 0, rate: 0 };
      const delta = cur.cost - prev.cost;
      if (Math.abs(delta) > 0.01) {
        skuChanges.push({
          plantId: parseInt(plantId), vendor, sku,
          current:  { cost: cur.cost,  qty: cur.qty,  rate: cur.rate },
          previous: { cost: prev.cost, qty: prev.qty, rate: prev.rate },
          costChange: delta,
          rateChange: cur.rate - prev.rate,
        });
      }
    }
    skuChanges.sort((a, b) => Math.abs(b.costChange) - Math.abs(a.costChange));

    const prevLabel = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    res.json({ month, prevMonth: prevLabel, variance, vendorChanges: vendorChanges.slice(0, 30), skuChanges: skuChanges.slice(0, 30) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Layer 3: Anomaly Detection ──────────────────────────────
// GET /api/insights/anomalies?month=YYYY-MM&businessType=
// Scans the month's records for anomalies: unusual vendor rates, attendance
// jumps, SKU cost spikes, missing working days.
router.get('/anomalies', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const month = (req.query.month || '').slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month param required (YYYY-MM)' });
  const [yr, mo] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to   = `${yr}-${String(mo).padStart(2, '0')}-${new Date(yr, mo, 0).getDate()}`;
  const businessType = req.query.businessType || null;

  // Look-back window for historical stats: the 3 months before this one
  const histStart = new Date(yr, mo - 4, 1);
  const histEnd   = new Date(yr, mo - 1, 0);
  const isoD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const histFrom = isoD(histStart);
  const histTo   = isoD(histEnd);

  try {
    const anomalies = [];

    // ── 3a. Vendor-rate anomalies (attendance cost per worker unusually high/low) ──
    // Historical average cost-per-worker per vendor per plant
    const vrHistParams = [histFrom, histTo];
    let vrBtFilter = '';
    if (businessType) { vrHistParams.push(businessType); vrBtFilter = `AND p.business_type = $${vrHistParams.length}`; }
    const vrScope = plantScopeClause(req, vrHistParams);
    const { rows: vrHist } = await db.query(`
      SELECT p.id AS plant_id, p.name AS plant_name, ca.contractor_name,
        AVG(CASE WHEN ca.workers > 0 THEN ca.cost / ca.workers END)::NUMERIC(10,2) AS avg_rate,
        STDDEV(CASE WHEN ca.workers > 0 THEN ca.cost / ca.workers END)::NUMERIC(10,2) AS std_rate,
        COUNT(*) AS entries
      FROM contractor_attendance ca
        JOIN daily_records dr ON dr.id = ca.record_id
        JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2 ${vrBtFilter} ${vrScope}
      GROUP BY p.id, p.name, ca.contractor_name
      HAVING COUNT(*) >= 5
    `, vrHistParams);
    const vrHistMap = {};
    vrHist.forEach(r => { vrHistMap[`${r.plant_id}:${r.contractor_name}`] = r; });

    // Current month's vendor rates
    const vrCurParams = [from, to];
    let vrCurBtFilter = '';
    if (businessType) { vrCurParams.push(businessType); vrCurBtFilter = `AND p.business_type = $${vrCurParams.length}`; }
    const vrCurScope = plantScopeClause(req, vrCurParams);
    const { rows: vrCur } = await db.query(`
      SELECT p.id AS plant_id, p.name AS plant_name, ca.contractor_name,
        TO_CHAR(dr.record_date, 'YYYY-MM-DD') AS date,
        ca.cost, ca.workers,
        CASE WHEN ca.workers > 0 THEN (ca.cost / ca.workers)::NUMERIC(10,2) ELSE NULL END AS rate_per_worker
      FROM contractor_attendance ca
        JOIN daily_records dr ON dr.id = ca.record_id
        JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2 ${vrCurBtFilter} ${vrCurScope}
      ORDER BY dr.record_date
    `, vrCurParams);

    for (const entry of vrCur) {
      if (!entry.rate_per_worker) continue;
      const hist = vrHistMap[`${entry.plant_id}:${entry.contractor_name}`];
      if (!hist || !hist.std_rate || parseFloat(hist.std_rate) === 0) continue;
      const rate = parseFloat(entry.rate_per_worker);
      const mean = parseFloat(hist.avg_rate);
      const std  = parseFloat(hist.std_rate);
      const zScore = (rate - mean) / std;
      if (Math.abs(zScore) >= 2.0) {
        anomalies.push({
          type: 'vendor_rate',
          severity: Math.abs(zScore) >= 3 ? 'high' : 'medium',
          plant: entry.plant_name,
          plantId: entry.plant_id,
          date: entry.date,
          vendor: entry.contractor_name,
          value: rate,
          expected: mean,
          zScore: Math.round(zScore * 10) / 10,
          message: `${entry.contractor_name} rate ₹${rate}/worker on ${entry.date} is ${zScore > 0 ? 'above' : 'below'} normal (avg ₹${mean}, σ=${std.toFixed(0)})`,
        });
      }
    }

    // ── 3b. Attendance cost jumps (daily total attendance vs rolling average) ──
    const attHistParams = [histFrom, to]; // include current month to see the jump
    let attBtFilter = '';
    if (businessType) { attHistParams.push(businessType); attBtFilter = `AND p.business_type = $${attHistParams.length}`; }
    const attScope = plantScopeClause(req, attHistParams);
    const { rows: attDaily } = await db.query(`
      SELECT p.id AS plant_id, p.name AS plant_name,
        TO_CHAR(dr.record_date, 'YYYY-MM-DD') AS date,
        dr.attendance_cost
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2 AND dr.attendance_cost > 0 ${attBtFilter} ${attScope}
      ORDER BY p.id, dr.record_date
    `, attHistParams);

    // Group by plant, compute rolling stats, flag current-month outliers
    const attByPlant = {};
    attDaily.forEach(r => {
      if (!attByPlant[r.plant_id]) attByPlant[r.plant_id] = { name: r.plant_name, entries: [] };
      attByPlant[r.plant_id].entries.push({ date: r.date, cost: parseFloat(r.attendance_cost) });
    });
    for (const [plantId, data] of Object.entries(attByPlant)) {
      // Use history entries (before current month) to compute stats
      const histEntries = data.entries.filter(e => e.date < from);
      if (histEntries.length < 10) continue;
      const costs = histEntries.map(e => e.cost);
      const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
      const std  = Math.sqrt(costs.reduce((a, b) => a + (b - mean) ** 2, 0) / costs.length);
      if (std === 0) continue;

      // Flag current month entries that are outliers
      const curEntries = data.entries.filter(e => e.date >= from && e.date <= to);
      for (const entry of curEntries) {
        const z = (entry.cost - mean) / std;
        if (Math.abs(z) >= 2.0) {
          anomalies.push({
            type: 'attendance_jump',
            severity: Math.abs(z) >= 3 ? 'high' : 'medium',
            plant: data.name,
            plantId: parseInt(plantId),
            date: entry.date,
            value: entry.cost,
            expected: Math.round(mean * 100) / 100,
            zScore: Math.round(z * 10) / 10,
            message: `Attendance cost ₹${entry.cost.toLocaleString('en-IN')} on ${entry.date} is ${z > 0 ? 'unusually high' : 'unusually low'} (avg ₹${Math.round(mean).toLocaleString('en-IN')})`,
          });
        }
      }
    }

    // ── 3c. SKU rate anomalies ──
    const skuHistParams = [histFrom, histTo];
    let skuHistBtFilter = '';
    if (businessType) { skuHistParams.push(businessType); skuHistBtFilter = `AND p.business_type = $${skuHistParams.length}`; }
    const skuHistScope = plantScopeClause(req, skuHistParams);
    const { rows: skuHist } = await db.query(`
      SELECT p.id AS plant_id, p.name AS plant_name, vke.sku_name,
        AVG(vke.rate)::NUMERIC(10,4) AS avg_rate,
        STDDEV(vke.rate)::NUMERIC(10,4) AS std_rate,
        COUNT(*) AS entries
      FROM vendor_kg_entries vke
        JOIN daily_records dr ON dr.id = vke.record_id
        JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2
        AND vke.sku_name != '__UNLOADING__' AND vke.rate > 0
        ${skuHistBtFilter} ${skuHistScope}
      GROUP BY p.id, p.name, vke.sku_name
      HAVING COUNT(*) >= 5
    `, skuHistParams);
    const skuHistMap = {};
    skuHist.forEach(r => { skuHistMap[`${r.plant_id}:${r.sku_name}`] = r; });

    const skuCurParams = [from, to];
    let skuCurBtFilter = '';
    if (businessType) { skuCurParams.push(businessType); skuCurBtFilter = `AND p.business_type = $${skuCurParams.length}`; }
    const skuCurScope = plantScopeClause(req, skuCurParams);
    const { rows: skuCur } = await db.query(`
      SELECT p.id AS plant_id, p.name AS plant_name, vke.sku_name,
        TO_CHAR(dr.record_date, 'YYYY-MM-DD') AS date,
        vke.rate, vke.cost, vke.qty
      FROM vendor_kg_entries vke
        JOIN daily_records dr ON dr.id = vke.record_id
        JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2
        AND vke.sku_name != '__UNLOADING__' AND vke.rate > 0
        ${skuCurBtFilter} ${skuCurScope}
      ORDER BY dr.record_date
    `, skuCurParams);

    for (const entry of skuCur) {
      const hist = skuHistMap[`${entry.plant_id}:${entry.sku_name}`];
      if (!hist || !hist.std_rate || parseFloat(hist.std_rate) === 0) continue;
      const rate = parseFloat(entry.rate);
      const mean = parseFloat(hist.avg_rate);
      const std  = parseFloat(hist.std_rate);
      const z = (rate - mean) / std;
      if (Math.abs(z) >= 2.0) {
        anomalies.push({
          type: 'sku_rate',
          severity: Math.abs(z) >= 3 ? 'high' : 'medium',
          plant: entry.plant_name,
          plantId: entry.plant_id,
          date: entry.date,
          sku: entry.sku_name,
          value: rate,
          expected: mean,
          zScore: Math.round(z * 10) / 10,
          message: `${entry.sku_name} rate ₹${rate} on ${entry.date} deviates from avg ₹${mean.toFixed(2)}`,
        });
      }
    }

    // ── 3d. Missing working days ──
    // Get plants and their off-day + holiday settings
    const missingParams = [from, to];
    let missingBtFilter = '';
    if (businessType) { missingParams.push(businessType); missingBtFilter = `AND p.business_type = $${missingParams.length}`; }
    const missingScope = plantScopeClause(req, missingParams);

    const { rows: plantDays } = await db.query(`
      SELECT p.id, p.name, p.weekly_off_day, p.observes_holidays,
        ARRAY_AGG(DISTINCT TO_CHAR(dr.record_date, 'YYYY-MM-DD')) FILTER (WHERE ${COMPLETE}) AS complete_dates
      FROM plants p
        LEFT JOIN daily_records dr ON dr.plant_id = p.id AND dr.record_date BETWEEN $1 AND $2
      WHERE 1=1 ${missingBtFilter} ${missingScope}
      GROUP BY p.id, p.name, p.weekly_off_day, p.observes_holidays
    `, missingParams);

    // Get holidays for the month
    const { rows: hRows } = await db.query("SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date FROM holidays WHERE date BETWEEN $1 AND $2", [from, to]);
    const holidaySet = new Set(hRows.map(h => h.date));

    const today = new Date().toISOString().slice(0, 10);
    for (const plant of plantDays) {
      const offDay = plant.weekly_off_day != null ? parseInt(plant.weekly_off_day, 10) : null;
      const holidays = plant.observes_holidays ? holidaySet : null;
      const completeDates = new Set(plant.complete_dates || []);

      // Check each working day up to today
      const d = new Date(from + 'T00:00:00');
      const endDate = new Date(Math.min(new Date(to + 'T00:00:00'), new Date(today + 'T00:00:00')));
      const missingDates = [];
      while (d <= endDate) {
        const iso = toISODate(d);
        const dow = d.getDay();
        d.setDate(d.getDate() + 1);
        if (offDay != null && dow === offDay) continue;
        if (holidays && holidays.has(iso)) continue;
        if (!completeDates.has(iso)) missingDates.push(iso);
      }
      if (missingDates.length > 0) {
        anomalies.push({
          type: 'missing_days',
          severity: missingDates.length >= 5 ? 'high' : (missingDates.length >= 2 ? 'medium' : 'low'),
          plant: plant.name,
          plantId: plant.id,
          count: missingDates.length,
          dates: missingDates.slice(0, 10), // cap for payload size
          message: `${plant.name}: ${missingDates.length} working day${missingDates.length > 1 ? 's' : ''} without complete records`,
        });
      }
    }

    // Sort: high severity first, then by date
    const sevOrder = { high: 0, medium: 1, low: 2 };
    anomalies.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9) || (a.date || '').localeCompare(b.date || ''));

    res.json({ month, anomalies });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Layer 4: Forecasting & Targets ─────────────────────
// GET /api/insights/forecast?month=YYYY-MM&businessType=
// Per-working-day run-rate extrapolation with low/expected/high range,
// target comparison (from plant_targets or previous month's actual MPK),
// and volume what-if parameters.
router.get('/forecast', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const month = (req.query.month || '').slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month param required (YYYY-MM)' });
  const [yr, mo] = month.split('-').map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(yr, mo, 0).getDate();
  const to   = `${month}-${String(lastDay).padStart(2, '0')}`;
  const businessType = req.query.businessType || null;
  const today = toISODate(new Date());

  // Previous month for baseline
  const prevDate = new Date(yr, mo - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevFrom = `${prevMonth}-01`;
  const prevLastDay = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).getDate();
  const prevTo = `${prevMonth}-${String(prevLastDay).padStart(2, '0')}`;

  try {
    const params = [from, to];
    let btFilter = '';
    if (businessType) { params.push(businessType); btFilter = `AND p.business_type = $${params.length}`; }
    const scopeFilter = plantScopeClause(req, params);

    // Current month: per-plant daily records (complete days)
    const { rows: dailyRows } = await db.query(`
      SELECT p.id AS plant_id, p.name, p.display_order, p.business_type,
        p.weekly_off_day, p.observes_holidays,
        TO_CHAR(dr.record_date, 'YYYY-MM-DD') AS date,
        EXTRACT(DOW FROM dr.record_date)::INT AS dow,
        dr.attendance_cost::NUMERIC(14,2) AS attendance_cost,
        dr.kg_cost::NUMERIC(14,2) AS kg_cost,
        dr.total_cost::NUMERIC(14,2) AS total_cost,
        dr.sale_qty::NUMERIC(14,2) AS sale_qty
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2
        AND ${COMPLETE}
        ${btFilter} ${scopeFilter}
      ORDER BY p.display_order, dr.record_date
    `, params);

    // Previous month: per-plant summary
    const prevParams = [prevFrom, prevTo];
    let prevBtFilter = '';
    if (businessType) { prevParams.push(businessType); prevBtFilter = `AND p.business_type = $${prevParams.length}`; }
    const prevScopeFilter = plantScopeClause(req, prevParams);
    const { rows: prevSummary } = await db.query(`
      SELECT p.id AS plant_id,
        COUNT(*) FILTER (WHERE ${COMPLETE}) AS days,
        COALESCE(SUM(dr.total_cost) FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_cost,
        COALESCE(SUM(dr.sale_qty) FILTER (WHERE ${COMPLETE}), 0)::NUMERIC(14,2) AS total_qty
      FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
      WHERE dr.record_date BETWEEN $1 AND $2 ${prevBtFilter} ${prevScopeFilter}
      GROUP BY p.id
    `, prevParams);
    const prevMap = {};
    prevSummary.forEach(r => { prevMap[r.plant_id] = r; });

    // Targets for this month
    const targetParams = [month];
    const { rows: targetRows } = await db.query(
      'SELECT plant_id, target_mpk, target_cost, target_qty, notes FROM plant_targets WHERE month = $1',
      targetParams
    );
    const targetMap = {};
    targetRows.forEach(r => { targetMap[r.plant_id] = r; });

    // Holidays for working-day calculation
    const { rows: hRows } = await db.query(
      "SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date FROM holidays WHERE date BETWEEN $1 AND $2",
      [from, to]
    );
    const holidaySet = new Set(hRows.map(h => h.date));

    // Group daily rows by plant
    const byPlant = {};
    const plantMeta = {};
    dailyRows.forEach(r => {
      if (!byPlant[r.plant_id]) {
        byPlant[r.plant_id] = [];
        plantMeta[r.plant_id] = {
          name: r.name, displayOrder: r.display_order,
          businessType: r.business_type,
          weeklyOffDay: r.weekly_off_day != null ? parseInt(r.weekly_off_day) : null,
          observesHolidays: r.observes_holidays,
        };
      }
      byPlant[r.plant_id].push({
        date: r.date, dow: r.dow,
        attendance: parseFloat(r.attendance_cost),
        kg: parseFloat(r.kg_cost),
        total: parseFloat(r.total_cost),
        qty: parseFloat(r.sale_qty),
      });
    });

    // Also include plants with targets but no records yet this month
    // (they need to appear to show "0 days recorded" vs target)
    if (Object.keys(targetMap).length) {
      const allPlantParams = [];
      let allBtFilter = '';
      if (businessType) { allPlantParams.push(businessType); allBtFilter = `WHERE p.business_type = $${allPlantParams.length}`; }
      const { rows: allPlants } = await db.query(
        `SELECT id, name, display_order, business_type, weekly_off_day, observes_holidays FROM plants p ${allBtFilter} ORDER BY display_order`,
        allPlantParams
      );
      allPlants.forEach(p => {
        if (!plantMeta[p.id] && targetMap[p.id]) {
          plantMeta[p.id] = {
            name: p.name, displayOrder: p.display_order,
            businessType: p.business_type,
            weeklyOffDay: p.weekly_off_day != null ? parseInt(p.weekly_off_day) : null,
            observesHolidays: p.observes_holidays,
          };
          byPlant[p.id] = [];
        }
      });
    }

    const forecasts = [];
    for (const [pid, meta] of Object.entries(plantMeta)) {
      const plantId = parseInt(pid);
      const days = byPlant[plantId] || [];
      const daysRecorded = days.length;

      // Working days in this month
      const plantHolidays = meta.observesHolidays ? holidaySet : null;
      const totalWorkingDays = countWorkingDays(from, to, meta.weeklyOffDay, plantHolidays);
      const elapsedWorkingDays = countWorkingDays(from, today < to ? today : to, meta.weeklyOffDay, plantHolidays);
      const remainingWorkingDays = Math.max(0, totalWorkingDays - elapsedWorkingDays);

      // MTD actuals
      let mtdCost = 0, mtdAtt = 0, mtdKg = 0, mtdQty = 0;
      days.forEach(d => { mtdCost += d.total; mtdAtt += d.attendance; mtdKg += d.kg; mtdQty += d.qty; });
      const mtdMPK = mtdQty > 0 ? mtdCost / mtdQty : null;

      // Per-working-day run rate
      const dailyRate = daysRecorded > 0 ? mtdCost / daysRecorded : null;
      const dailyAttRate = daysRecorded > 0 ? mtdAtt / daysRecorded : null;
      const dailyKgRate = daysRecorded > 0 ? mtdKg / daysRecorded : null;
      const dailyQtyRate = daysRecorded > 0 ? mtdQty / daysRecorded : null;

      // Weekday pattern: avg cost by day-of-week (for confidence range)
      const dowCosts = {};
      days.forEach(d => {
        if (!dowCosts[d.dow]) dowCosts[d.dow] = [];
        dowCosts[d.dow].push(d.total);
      });

      // Projected month-end (expected = run rate × total working days)
      let projectedCost = null, projectedQty = null, projectedMPK = null;
      let projectedAtt = null, projectedKg = null;
      if (dailyRate != null && totalWorkingDays > 0) {
        projectedCost = dailyRate * totalWorkingDays;
        projectedAtt  = dailyAttRate * totalWorkingDays;
        projectedKg   = dailyKgRate * totalWorkingDays;
        projectedQty  = dailyQtyRate * totalWorkingDays;
        projectedMPK  = projectedQty > 0 ? projectedCost / projectedQty : null;
      }

      // Confidence range: use coefficient of variation of daily costs
      let lowCost = null, highCost = null, lowMPK = null, highMPK = null;
      let confidence = 'low';
      if (daysRecorded >= 3 && dailyRate != null) {
        const costs = days.map(d => d.total);
        const mean = mtdCost / daysRecorded;
        const variance = costs.reduce((s, c) => s + (c - mean) ** 2, 0) / daysRecorded;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
        const spread = cv * 0.8; // dampen for month-level
        lowCost  = projectedCost * (1 - spread);
        highCost = projectedCost * (1 + spread);
        if (projectedQty > 0) {
          lowMPK  = lowCost / projectedQty;
          highMPK = highCost / projectedQty;
        }
        if (daysRecorded >= totalWorkingDays * 0.7) confidence = 'high';
        else if (daysRecorded >= totalWorkingDays * 0.4) confidence = 'medium';
        else confidence = 'low';
      }

      // Target / baseline
      const target = targetMap[plantId];
      const prev = prevMap[plantId];
      const baselineMPK = target ? parseFloat(target.target_mpk)
        : (prev && parseFloat(prev.total_qty) > 0
          ? parseFloat(prev.total_cost) / parseFloat(prev.total_qty) : null);
      const baselineSource = target ? 'target' : (prev ? 'previous_month' : null);

      // Status: On track / At risk / Over
      let status = null;
      if (baselineMPK != null && projectedMPK != null) {
        const pct = (projectedMPK - baselineMPK) / baselineMPK;
        if (pct <= 0.02) status = 'on_track';
        else if (pct <= 0.10) status = 'at_risk';
        else status = 'over';
      }

      forecasts.push({
        plantId, name: meta.name, businessType: meta.businessType,
        daysRecorded, totalWorkingDays, elapsedWorkingDays, remainingWorkingDays,
        mtd: { cost: mtdCost, attendance: mtdAtt, kg: mtdKg, qty: mtdQty, mpk: mtdMPK },
        dailyRate: { cost: dailyRate, attendance: dailyAttRate, kg: dailyKgRate, qty: dailyQtyRate },
        projected: { cost: projectedCost, attendance: projectedAtt, kg: projectedKg, qty: projectedQty, mpk: projectedMPK },
        range: { lowCost, highCost, lowMPK, highMPK },
        confidence,
        baseline: { mpk: baselineMPK, source: baselineSource, targetCost: target ? parseFloat(target.target_cost) : null, targetQty: target ? parseFloat(target.target_qty) : null, notes: target ? target.notes : null },
        status,
        previousMonth: prev ? { days: parseInt(prev.days), cost: parseFloat(prev.total_cost), qty: parseFloat(prev.total_qty), mpk: parseFloat(prev.total_qty) > 0 ? parseFloat(prev.total_cost) / parseFloat(prev.total_qty) : null } : null,
      });
    }
    forecasts.sort((a, b) => (plantMeta[a.plantId]?.displayOrder || 0) - (plantMeta[b.plantId]?.displayOrder || 0));

    res.json({ month, prevMonth, today, forecasts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Target CRUD ────────────────────────────────────────
// GET /api/insights/targets?month=YYYY-MM
router.get('/targets', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const month = (req.query.month || '').slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month required' });
  try {
    const { rows } = await db.query(
      `SELECT pt.*, p.name AS plant_name FROM plant_targets pt JOIN plants p ON p.id = pt.plant_id WHERE pt.month = $1 ORDER BY p.display_order`,
      [month]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/insights/targets — upsert a target
router.post('/targets', async (req, res) => {
  if (req.user.role !== 'superadmin' && !hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const { plant_id, month, target_mpk, target_cost, target_qty, notes } = req.body;
  if (!plant_id || !month || target_mpk == null) return res.status(400).json({ error: 'plant_id, month, target_mpk required' });
  try {
    const { rows } = await db.query(`
      INSERT INTO plant_targets (plant_id, month, target_mpk, target_cost, target_qty, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (plant_id, month) DO UPDATE SET
        target_mpk = EXCLUDED.target_mpk,
        target_cost = EXCLUDED.target_cost,
        target_qty = EXCLUDED.target_qty,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `, [plant_id, month, target_mpk, target_cost || null, target_qty || null, notes || null, req.user.username]);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/insights/targets/:id
router.delete('/targets/:id', async (req, res) => {
  if (req.user.role !== 'superadmin' && !hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  try {
    await db.query('DELETE FROM plant_targets WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Layer 5: Recommendations / Action Items ───────────
// GET /api/insights/actions?month=YYYY-MM&status=&plantId=
router.get('/actions', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const month = (req.query.month || '').slice(0, 7);
  const status = req.query.status || null;
  const plantId = parseInt(req.query.plantId) || null;
  try {
    const params = [];
    const clauses = [];
    if (month) { params.push(month); clauses.push(`ia.month = $${params.length}`); }
    if (status) { params.push(status); clauses.push(`ia.status = $${params.length}`); }
    if (plantId) { params.push(plantId); clauses.push(`ia.plant_id = $${params.length}`); }
    // Plant scope for non-superadmin
    if (req.user.role !== 'superadmin') {
      const allowed = req.user.plantIds || (req.user.plant_id != null ? [req.user.plant_id] : []);
      params.push(allowed);
      clauses.push(`ia.plant_id = ANY($${params.length})`);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await db.query(`
      SELECT ia.*, p.name AS plant_name
      FROM insight_actions ia JOIN plants p ON p.id = ia.plant_id
      ${where}
      ORDER BY
        CASE ia.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        CASE ia.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
        ia.created_at DESC
    `, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/insights/actions — create an action
router.post('/actions', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const { plant_id, month, finding_type, finding_ref, title, description,
          estimated_saving, baseline_mpk, owner, due_date, priority } = req.body;
  if (!plant_id || !month || !title) return res.status(400).json({ error: 'plant_id, month, title required' });
  try {
    const { rows } = await db.query(`
      INSERT INTO insight_actions (plant_id, month, finding_type, finding_ref, title, description,
        estimated_saving, baseline_mpk, owner, due_date, priority, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [plant_id, month, finding_type || 'manual', finding_ref || null,
        title, description || null, estimated_saving || null, baseline_mpk || null,
        owner || null, due_date || null, priority || 'medium', req.user.username]);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/insights/actions/:id — update status, resolution, actual_mpk
router.put('/actions/:id', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const id = parseInt(req.params.id);
  const fields = [];
  const vals = [];
  const allowed = ['status', 'title', 'description', 'estimated_saving', 'owner',
                   'due_date', 'priority', 'resolution_note', 'actual_mpk'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      vals.push(req.body[key] === '' ? null : req.body[key]);
      fields.push(`${key} = $${vals.length}`);
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(id);
  fields.push('updated_at = NOW()');
  try {
    const { rows } = await db.query(
      `UPDATE insight_actions SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/insights/actions/:id
router.delete('/actions/:id', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  try {
    await db.query('DELETE FROM insight_actions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/insights/recommendations?month=YYYY-MM&businessType=
// Auto-generate recommended actions from variance/anomaly data
router.get('/recommendations', async (req, res) => {
  if (!hasPermission(req.user, 'view_cost_trend'))
    return res.status(403).json({ error: 'You do not have permission to do this' });
  const month = (req.query.month || '').slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month param required (YYYY-MM)' });
  const [yr, mo] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to   = `${yr}-${String(mo).padStart(2, '0')}-${new Date(yr, mo, 0).getDate()}`;
  const prevDate = new Date(yr, mo - 2, 1);
  const prevFrom = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-01`;
  const prevLastDay = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).getDate();
  const prevTo   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${prevLastDay}`;
  const businessType = req.query.businessType || null;

  try {
    const recommendations = [];

    // 5a. Vendors with significant cost increase vs previous month
    const vParams = [from, to, prevFrom, prevTo];
    let vBtFilter = '';
    if (businessType) { vParams.push(businessType); vBtFilter = `AND p.business_type = $${vParams.length}`; }
    const vScope = plantScopeClause(req, vParams);

    const { rows: vendorSwings } = await db.query(`
      WITH cur AS (
        SELECT p.id AS plant_id, p.name AS plant_name, ca.contractor_name,
          SUM(ca.cost)::NUMERIC(14,2) AS cost,
          SUM(ca.workers)::INT AS workers
        FROM contractor_attendance ca
          JOIN daily_records dr ON dr.id = ca.record_id
          JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $1 AND $2 ${vBtFilter} ${vScope}
        GROUP BY p.id, p.name, ca.contractor_name
      ), prev AS (
        SELECT p.id AS plant_id, ca.contractor_name,
          SUM(ca.cost)::NUMERIC(14,2) AS cost,
          SUM(ca.workers)::INT AS workers
        FROM contractor_attendance ca
          JOIN daily_records dr ON dr.id = ca.record_id
          JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $3 AND $4 ${vBtFilter} ${vScope}
        GROUP BY p.id, ca.contractor_name
      )
      SELECT cur.plant_id, cur.plant_name, cur.contractor_name,
        cur.cost AS cur_cost, COALESCE(prev.cost, 0) AS prev_cost,
        cur.cost - COALESCE(prev.cost, 0) AS delta,
        CASE WHEN cur.workers > 0 THEN (cur.cost / cur.workers)::NUMERIC(10,2) END AS cur_rate,
        CASE WHEN prev.workers > 0 THEN (prev.cost / prev.workers)::NUMERIC(10,2) END AS prev_rate
      FROM cur LEFT JOIN prev ON cur.plant_id = prev.plant_id AND cur.contractor_name = prev.contractor_name
      WHERE cur.cost - COALESCE(prev.cost, 0) > 5000
      ORDER BY cur.cost - COALESCE(prev.cost, 0) DESC
      LIMIT 10
    `, vParams);

    for (const v of vendorSwings) {
      const saving = parseFloat(v.delta);
      const rateUp = v.cur_rate && v.prev_rate && parseFloat(v.cur_rate) > parseFloat(v.prev_rate);
      recommendations.push({
        finding_type: 'variance_att',
        finding_ref: v.contractor_name,
        plant_id: v.plant_id,
        plant_name: v.plant_name,
        title: `Review ${v.contractor_name} cost increase`,
        description: rateUp
          ? `Rate per worker rose from ₹${v.prev_rate} to ₹${v.cur_rate}. Total cost up by ₹${Math.round(saving).toLocaleString('en-IN')}.`
          : `Total cost up by ₹${Math.round(saving).toLocaleString('en-IN')} vs previous month.`,
        estimated_saving: saving,
        priority: saving > 50000 ? 'high' : saving > 15000 ? 'medium' : 'low',
      });
    }

    // 5b. SKUs with significant rate increase
    const sParams = [from, to, prevFrom, prevTo];
    let sBtFilter = '';
    if (businessType) { sParams.push(businessType); sBtFilter = `AND p.business_type = $${sParams.length}`; }
    const sScope = plantScopeClause(req, sParams);

    const { rows: skuSwings } = await db.query(`
      WITH cur AS (
        SELECT p.id AS plant_id, p.name AS plant_name, vke.sku_name,
          SUM(vke.cost)::NUMERIC(14,2) AS cost,
          SUM(vke.qty)::NUMERIC(14,4) AS qty,
          CASE WHEN SUM(vke.qty) > 0 THEN (SUM(vke.cost)/SUM(vke.qty))::NUMERIC(10,4) END AS rate
        FROM vendor_kg_entries vke
          JOIN daily_records dr ON dr.id = vke.record_id
          JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $1 AND $2 AND vke.sku_name != '__UNLOADING__'
          ${sBtFilter} ${sScope}
        GROUP BY p.id, p.name, vke.sku_name
      ), prev AS (
        SELECT p.id AS plant_id, vke.sku_name,
          SUM(vke.cost)::NUMERIC(14,2) AS cost,
          SUM(vke.qty)::NUMERIC(14,4) AS qty,
          CASE WHEN SUM(vke.qty) > 0 THEN (SUM(vke.cost)/SUM(vke.qty))::NUMERIC(10,4) END AS rate
        FROM vendor_kg_entries vke
          JOIN daily_records dr ON dr.id = vke.record_id
          JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $3 AND $4 AND vke.sku_name != '__UNLOADING__'
          ${sBtFilter} ${sScope}
        GROUP BY p.id, vke.sku_name
      )
      SELECT cur.plant_id, cur.plant_name, cur.sku_name,
        cur.cost AS cur_cost, COALESCE(prev.cost,0) AS prev_cost,
        cur.rate AS cur_rate, prev.rate AS prev_rate,
        cur.qty AS cur_qty,
        cur.cost - COALESCE(prev.cost,0) AS delta
      FROM cur LEFT JOIN prev ON cur.plant_id = prev.plant_id AND cur.sku_name = prev.sku_name
      WHERE cur.rate IS NOT NULL AND prev.rate IS NOT NULL
        AND cur.rate > prev.rate * 1.10
        AND cur.cost - COALESCE(prev.cost,0) > 2000
      ORDER BY cur.cost - COALESCE(prev.cost,0) DESC
      LIMIT 10
    `, sParams);

    for (const s of skuSwings) {
      const saving = parseFloat(s.delta);
      const ratePct = s.prev_rate ? ((parseFloat(s.cur_rate) / parseFloat(s.prev_rate) - 1) * 100).toFixed(0) : '?';
      recommendations.push({
        finding_type: 'variance_kg',
        finding_ref: s.sku_name,
        plant_id: s.plant_id,
        plant_name: s.plant_name,
        title: `Negotiate ${s.sku_name} rate (up ${ratePct}%)`,
        description: `Rate rose from ₹${s.prev_rate} to ₹${s.cur_rate}/unit. Cost impact: +₹${Math.round(saving).toLocaleString('en-IN')}.`,
        estimated_saving: saving,
        priority: saving > 30000 ? 'high' : saving > 10000 ? 'medium' : 'low',
      });
    }

    // 5c. Plants with worsening MPK trend
    const mParams = [from, to, prevFrom, prevTo];
    let mBtFilter = '';
    if (businessType) { mParams.push(businessType); mBtFilter = `AND p.business_type = $${mParams.length}`; }
    const mScope = plantScopeClause(req, mParams);

    const { rows: mpkTrend } = await db.query(`
      WITH cur AS (
        SELECT p.id AS plant_id, p.name AS plant_name,
          COALESCE(SUM(dr.total_cost) FILTER (WHERE ${COMPLETE}),0)::NUMERIC(14,2) AS cost,
          COALESCE(SUM(dr.sale_qty) FILTER (WHERE ${COMPLETE}),0)::NUMERIC(14,2) AS qty
        FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $1 AND $2 ${mBtFilter} ${mScope}
        GROUP BY p.id, p.name
      ), prev AS (
        SELECT p.id AS plant_id,
          COALESCE(SUM(dr.total_cost) FILTER (WHERE ${COMPLETE}),0)::NUMERIC(14,2) AS cost,
          COALESCE(SUM(dr.sale_qty) FILTER (WHERE ${COMPLETE}),0)::NUMERIC(14,2) AS qty
        FROM daily_records dr JOIN plants p ON p.id = dr.plant_id
        WHERE dr.record_date BETWEEN $3 AND $4 ${mBtFilter} ${mScope}
        GROUP BY p.id
      )
      SELECT cur.plant_id, cur.plant_name,
        CASE WHEN cur.qty > 0 THEN cur.cost/cur.qty END AS cur_mpk,
        CASE WHEN prev.qty > 0 THEN prev.cost/prev.qty END AS prev_mpk
      FROM cur LEFT JOIN prev ON cur.plant_id = prev.plant_id
      WHERE cur.qty > 0 AND prev.qty > 0
        AND cur.cost/cur.qty > prev.cost/prev.qty * 1.05
      ORDER BY cur.cost/cur.qty - prev.cost/prev.qty DESC
    `, mParams);

    for (const m of mpkTrend) {
      const curMPK = parseFloat(m.cur_mpk);
      const prevMPK = parseFloat(m.prev_mpk);
      const pctInc = ((curMPK / prevMPK - 1) * 100).toFixed(1);
      recommendations.push({
        finding_type: 'variance_att',
        finding_ref: m.plant_name,
        plant_id: m.plant_id,
        plant_name: m.plant_name,
        title: `${m.plant_name} MPK up ${pctInc}% — investigate cost drivers`,
        description: `MPK went from ₹${prevMPK.toFixed(2)} to ₹${curMPK.toFixed(2)}. Check attendance costs, vendor rates, and volume changes.`,
        estimated_saving: null,
        priority: parseFloat(pctInc) > 15 ? 'high' : 'medium',
        baseline_mpk: prevMPK,
      });
    }

    // Deduplicate: skip recommendations that already have an action this month
    const { rows: existingActions } = await db.query(
      'SELECT finding_type, finding_ref, plant_id FROM insight_actions WHERE month = $1',
      [month]
    );
    const existingSet = new Set(existingActions.map(a => `${a.plant_id}:${a.finding_type}:${a.finding_ref}`));
    const filtered = recommendations.filter(r =>
      !existingSet.has(`${r.plant_id}:${r.finding_type}:${r.finding_ref}`)
    );

    res.json({ month, recommendations: filtered });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

function toISODate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = router;
