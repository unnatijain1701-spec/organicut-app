/* ═══════════════════════════════════════════════════════
   EXCEL EXPORT
═══════════════════════════════════════════════════════ */

// Convert "YYYY-MM-DD" string to a JS Date that SheetJS writes as a real Excel date
function xlDate(str) { return str ? new Date(str + 'T00:00:00') : str; }

// Filesystem-safe plant name for export filenames, e.g. "Rai-FnV" or "AllPlants"
// Short, clear tag identifying the current export scope:
//  - single plant selected  → "Rai-FnV"
//  - all locations in one business, no single plant → "All-FnV"
//  - all businesses combined, no single plant, no business filter → "All-Businesses"
function _exportScopeTag(businessType) {
  const pid = currentPlantId || activePlantId;
  if (pid) {
    const name = PLANTS_BY_ID[pid]?.name || currentPlantName || activePlantName;
    return name ? name.replace(/[^a-zA-Z0-9-]+/g, '') : 'Plant';
  }
  const bt = businessType !== undefined ? businessType : activeBizType;
  return bt ? 'All-' + String(bt).replace(/[^a-zA-Z0-9-]+/g, '') : 'All-Businesses';
}

function exportExcel() {
  if (typeof XLSX === 'undefined') {
    alert('SheetJS library not loaded — check your internet connection and reload the page.');
    return;
  }

  const date    = (document.getElementById('dateInput').value || 'Unknown').slice(0, 10);
  const saleQty = parseFloat(document.getElementById('saleQtyInput').value) || 0;

  const attCost = totalAtt();
  const kgCost  = totalKG();
  const total   = grandTotal();
  const mpk     = saleQty > 0 ? r2(total / saleQty) : '';

  const xd = xlDate(date);

  // Sheet 1: Daily Summary
  const _u = bizUnitAbbr(activePlantBizType());
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['Date','Attendance Cost','KG Cost','Total Cost',`Sale Qty (${_u})`,'MPK'],
    [xd, r2(attCost), r2(kgCost), r2(total), saleQty, mpk]
  ], {cellDates: true});
  ws1['!cols'] = [12,16,12,12,14,10].map(w => ({ wch: w }));

  // Sheet 2: Attendance Detail
  const attRows = [['Date','Contractor','Workers','Cost (₹)']];
  ATT_VENDORS.forEach(v => {
    attRows.push([xd, v, attState[v]?.workers || 0, parseFloat(attState[v]?.cost) || 0]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(attRows, {cellDates: true});
  ws2['!cols'] = [12,32,10,12].map(w => ({ wch: w }));

  // Sheet 3: KG Detail
  const kgRows = [['Date','Vendor','SKU',`Rate (₹/${_u})`,`Qty (${_u})`,'Cost (₹)']];
  KG_VENDORS.forEach(v => {
    (SKU_CFG[v] || []).forEach(([name, rate], i) => {
      const qty = kgState[v]?.[i] || 0;
      if (qty > 0) kgRows.push([xd, v, name, rate, qty, r2(qty * rate)]);
    });
    customSKUs[v].forEach(sku => {
      if ((sku.qty || 0) > 0) kgRows.push([xd, v, sku.name + ' *', sku.rate, sku.qty, r2(sku.qty * sku.rate)]);
    });
    const ul = unloadingCosts[v] || 0;
    if (ul > 0) kgRows.push([xd, v, 'Unloading Cost', '', '', r2(ul)]);
  });
  const ws3 = XLSX.utils.aoa_to_sheet(kgRows, {cellDates: true});
  ws3['!cols'] = [12,14,28,12,10,12].map(w => ({ wch: w }));

  // Sheet 4: Attendance Summary (one row per contractor)
  const attSumRows = [['Contractor','Workers Present','Attendance Cost (₹)','% of Total Att Cost']];
  const totalAttCost = ATT_VENDORS.reduce((s, v) => s + (parseFloat(attState[v]?.cost) || 0), 0);
  ATT_VENDORS.forEach(v => {
    const cost = parseFloat(attState[v]?.cost) || 0;
    const pct = totalAttCost > 0 ? r2((cost / totalAttCost) * 100) : 0;
    attSumRows.push([v, attState[v]?.workers || 0, r2(cost), pct]);
  });
  attSumRows.push(['TOTAL', ATT_VENDORS.reduce((s,v) => s + (attState[v]?.workers||0), 0), r2(totalAttCost), 100]);
  const ws4 = XLSX.utils.aoa_to_sheet(attSumRows);
  ws4['!cols'] = [32,16,20,18].map(w => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Daily Summary');
  XLSX.utils.book_append_sheet(wb, ws4, 'Attendance Summary');
  XLSX.utils.book_append_sheet(wb, ws2, 'Attendance Detail');
  XLSX.utils.book_append_sheet(wb, ws3, 'KG Detail');
  XLSX.writeFile(wb, _exportScopeTag() + '_MPK_' + date + '.xlsx');
}

function toggleExportDd() {
  document.getElementById('exportDdMenu').classList.toggle('open');
}

// ── Multi-Plant (Bi-Weekly) Report — superadmin ──
function openPlantReport() {
  document.getElementById('plantReportModal')?.remove();
  const firstOfMonth = _firstOfMonth();
  let iso = _d2Date();                   // default end = today − 2 days (D-2)
  if (iso < firstOfMonth) iso = firstOfMonth;
  const m = document.createElement('div');
  m.id = 'plantReportModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(13,35,24,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:16px;font-weight:800;color:#1e3a28">📑 Multi-Plant Report</span>
      <button onclick="document.getElementById('plantReportModal').remove()" style="border:none;background:none;font-size:22px;color:#aaa;cursor:pointer">×</button>
    </div>
    <div style="padding:20px">
      <div style="font-size:12px;color:#666;margin-bottom:14px">Generates a report across all plants — totals, month-end projection, and last-month comparison.</div>
      <label style="font-size:12px;font-weight:700;color:#334">From</label>
      <input type="date" id="prFrom" value="${firstOfMonth}" style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:8px;margin:4px 0 12px;font-size:14px">
      <label style="font-size:12px;font-weight:700;color:#334">To</label>
      <input type="date" id="prTo" value="${iso}" style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:8px;margin:4px 0 12px;font-size:14px">
      <label style="font-size:12px;font-weight:700;color:#334;display:block;margin-bottom:6px">Business Type</label>
      <div style="margin-bottom:18px">${bizChipsHTML('prBizType', '', 'null')}</div>
      <button onclick="generatePlantReport()" style="width:100%;padding:11px;background:#1e6b45;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">↓ Generate Excel Report</button>
    </div>
  </div>`;
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
}

// Manually-supplied last-month baseline (plants that started after go-live have no
// full previous month in the DB). Keyed by the report's previous-month label so it
// only applies to that month — later reports use real recorded data automatically.
// Cost in rupees (lakhs × 1e5), qty in kg (MT × 1e3).
const LAST_MONTH_BASELINE = {
  '2026-06': {
    'Rai-FnV':       { cost: 66.52e5, qty: 628.92e3 },
    'Jaipur-FnV':    { cost:  2.18e5, qty:  25.99e3 },
    'Bangalore-FnV': { cost: 22.21e5, qty: 174.21e3 },
    'Mumbai-FnV':    { cost: 15.44e5, qty: 170.51e3 },
    'Hyderabad-FnV': { cost: 12.26e5, qty: 131.24e3 },
  },
};

// ── Date helpers for the report (local time, D-2 default) ──
function _isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function _firstOfMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
function _d2Date() { const d = new Date(); d.setDate(d.getDate() - 2); return _isoLocal(d); }

// Shared computation used by both the Excel export and the on-screen report view.
// Returns numeric rows + totals; formatting is done by the caller.
function _computeReport(data) {
  const dim = data.daysInMonth;
  const baseline = LAST_MONTH_BASELINE[data.prevMonthLabel] || {};
  let tCost=0, tQty=0, tPCost=0, tPQty=0, tLCost=0, tLQty=0;

  const rows = data.plants.map(p => {
    const projCost = (p.days ? p.total_cost / p.days : 0) * dim;
    const projQty  = (p.days ? p.total_qty  / p.days : 0) * dim;
    const projMPK  = projQty > 0 ? projCost / projQty : 0;

    const bl = baseline[p.name];
    let lmCost, lmQty, lmMPK;
    if (bl) { lmCost = bl.cost; lmQty = bl.qty; lmMPK = bl.qty > 0 ? bl.cost / bl.qty : null; }
    else    { lmCost = p.last_month_cost; lmQty = p.last_month_qty; lmMPK = p.last_month_mpk; }

    let changePct = null, status = 'no-data';
    if (lmMPK != null && lmMPK > 0) {
      changePct = ((p.mpk - lmMPK) / lmMPK) * 100;
      status = p.mpk < lmMPK ? 'improving' : (p.mpk > lmMPK ? 'worsening' : 'same');
    }
    // Tonnage change compares against the PROJECTED month-end total, not the raw total
    // so far — last month's figure is a full month, so comparing it to a partial-month
    // total would always look artificially low. "Improving" means MORE volume (growth),
    // the opposite sense of a cost metric going down.
    let qtyChangePct = null, qtyStatus = 'no-data';
    if (lmQty != null && lmQty > 0) {
      qtyChangePct = ((projQty - lmQty) / lmQty) * 100;
      qtyStatus = projQty > lmQty ? 'improving' : (projQty < lmQty ? 'worsening' : 'same');
    }

    tCost += p.total_cost; tQty += p.total_qty; tPCost += projCost; tPQty += projQty;
    if (lmCost) tLCost += lmCost;
    if (lmQty)  tLQty  += lmQty;

    return { name: p.name, businessType: p.businessType, days: p.days, cost: p.total_cost, qty: p.total_qty, mpk: p.mpk,
             lmQty, lmMPK, changePct, status, qtyChangePct, qtyStatus, projCost, projQty, projMPK };
  });

  const totMPK  = tQty  > 0 ? tCost  / tQty  : 0;
  const totPMPK = tPQty > 0 ? tPCost / tPQty : 0;
  const totLMPK = tLQty > 0 ? tLCost / tLQty : null;
  let totChangePct = null, totStatus = 'no-data';
  if (totLMPK) {
    totChangePct = ((totMPK - totLMPK) / totLMPK) * 100;
    totStatus = totMPK < totLMPK ? 'improving' : (totMPK > totLMPK ? 'worsening' : 'same');
  }
  let totQtyChangePct = null, totQtyStatus = 'no-data';
  if (tLQty > 0) {
    totQtyChangePct = ((tPQty - tLQty) / tLQty) * 100;
    totQtyStatus = tPQty > tLQty ? 'improving' : (tPQty < tLQty ? 'worsening' : 'same');
  }
  const totals = { cost: tCost, qty: tQty, mpk: totMPK, lmQty: tLQty, lmMPK: totLMPK,
                   changePct: totChangePct, status: totStatus,
                   qtyChangePct: totQtyChangePct, qtyStatus: totQtyStatus,
                   projCost: tPCost, projQty: tPQty, projMPK: totPMPK };
  return { rows, totals };
}

const _repL  = n => +(n / 1e5).toFixed(2);   // rupees → lakhs
const _repMT = n => +(n / 1e3).toFixed(2);   // kg → metric tonnes
function _repStatusText(s) {
  return s === 'improving' ? 'Improving ▼' : s === 'worsening' ? 'Worsening ▲' : s === 'same' ? 'Same' : 'No last-month data';
}
function _repChangeText(status, pct) {
  return status === 'no-data' ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

async function generatePlantReport(from, to, businessType) {
  if (typeof XLSX === 'undefined') { alert('Excel library not loaded — reload the page.'); return; }
  from = from || document.getElementById('prFrom')?.value;
  to   = to   || document.getElementById('prTo')?.value;
  if (!from || !to) { showToast('⚠ Pick both dates', true); return; }
  if (businessType === undefined) businessType = bizChipValue('prBizType');
  const btParam = businessType ? `&businessType=${encodeURIComponent(businessType)}` : '';
  showToast('⏳ Building report…', false);
  try {
    const data = await api('GET', `/api/records/report?from=${from}&to=${to}${btParam}`);
    if (!data.plants || !data.plants.length) { showToast('⚠ No data in this range', true); return; }
    const { rows: R, totals: T } = _computeReport(data);
    const rangeDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;

    const _vu = businessType ? bizVolUnitAbbr(businessType) : 'MT';
    const header = ['Plant','Days Recorded','Total Cost (L)',`Total Tonnage (${_vu})`,'Avg MPK (₹)',
                    `Last Month Tonnage (${_vu})`,'Last Month MPK (₹)','MPK Change','Status',
                    'Proj. Month-End Cost (L)',`Proj. Tonnage (${_vu})`,'Tonnage Change (Proj. vs LM)','Proj. MPK (₹)'];
    const rowFor = r => [
      r.name, r.days != null ? `${r.days} / ${rangeDays}` : `${rangeDays} days`,
      _repL(r.cost), _repMT(r.qty), +r.mpk.toFixed(2),
      r.lmQty > 0 ? _repMT(r.lmQty) : '—',
      r.lmMPK != null ? +r.lmMPK.toFixed(2) : '—',
      _repChangeText(r.status, r.changePct || 0), _repStatusText(r.status),
      _repL(r.projCost), _repMT(r.projQty),
      _repChangeText(r.qtyStatus, r.qtyChangePct || 0),
      +r.projMPK.toFixed(2),
    ];
    const aoa = [
      ['MULTI-PLANT REPORT'],
      ['Period', `${from} to ${to}`],
      ['Projection basis', `daily average × ${data.daysInMonth} days in month`],
      ['Comparison', `vs previous month (${data.prevMonthLabel})`],
      [],
      header,
      ...R.map(rowFor),
      rowFor({ ...T, name: 'TOTAL' }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [14,14,15,17,12,17,15,17,12,18,20,17,14].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Multi-Plant Report');
    const _scopeTag = businessType ? 'All-' + businessType.replace(/[^a-zA-Z0-9-]+/g, '') : 'All-Businesses';
    XLSX.writeFile(wb, `${_scopeTag}_MPK_Report_${from}_to_${to}.xlsx`);
    document.getElementById('plantReportModal')?.remove();
    showToast('✓ Report downloaded', false);
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

// ── On-screen Report tab (superadmin) ──
function openReport() {
  const first = _firstOfMonth();
  let to = _d2Date();                 // default end = today − 2 days (D-2)
  if (to < first) to = first;         // clamp if we're at the very start of a month
  const fromEl = document.getElementById('repFrom'), toEl = document.getElementById('repTo');
  if (fromEl && !fromEl.value) fromEl.value = first;
  if (toEl   && !toEl.value)   toEl.value   = to;
  document.getElementById('reportOverlay').style.display = 'flex';
  loadReportView();
}
function closeReport() {
  const el = document.getElementById('reportOverlay');
  if (el) el.style.display = 'none';
}

let repBizType = '';

async function loadReportView() {
  const from = document.getElementById('repFrom')?.value;
  const to   = document.getElementById('repTo')?.value;
  const el   = document.getElementById('reportContent');
  if (!el) return;
  // Only fall back to the previous selection when the chip row hasn't been rendered
  // yet (first load) — once it exists, an empty value is a deliberate "All" click,
  // not a missing one, so it must not be overwritten by the old non-empty value.
  if (document.getElementById('repBizType')) repBizType = bizChipValue('repBizType');
  const bizWrap = document.getElementById('repBizTypeWrap');
  if (bizWrap) bizWrap.innerHTML = bizChipsHTML('repBizType', repBizType, 'loadReportView');
  if (!from || !to) { el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Pick a date range.</p>'; return; }
  el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Loading…</p>';
  try {
    const businessType = repBizType;
    const btParam = businessType ? `&businessType=${encodeURIComponent(businessType)}` : '';
    const data = await api('GET', `/api/records/report?from=${from}&to=${to}${btParam}`);
    if (!data.plants || !data.plants.length) {
      el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No records found in this range.</p>';
      return;
    }
    _renderReportView(data);
  } catch (e) {
    el.innerHTML = `<p style="color:#c00;text-align:center;padding:20px">⚠ ${e.message}</p>`;
  }
}

function _renderReportView(data) {
  const { rows: R, totals: T } = _computeReport(data);
  const lbl = document.getElementById('repCompareLabel');
  if (lbl) lbl.textContent = `Comparing vs previous month (${data.prevMonthLabel})`;

  const L  = n => (n / 1e5).toFixed(2);   // rupees → lakhs
  const MT = n => (n / 1e3).toFixed(2);   // kg → tonnes
  const cls = s => s === 'improving' ? 'rep-up' : s === 'worsening' ? 'rep-down' : '';
  const chg = (s, pct) => s === 'no-data' ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  const stat = s => s === 'improving' ? 'Improving ▼' : s === 'worsening' ? 'Worsening ▲' : s === 'same' ? 'Same' : '—';

  // Number of calendar days in the selected period (inclusive)
  const rangeDays = Math.round((new Date(data.to) - new Date(data.from)) / 86400000) + 1;

  const head = `<th>Metric</th>` + R.map(p => `<th>${p.name}</th>`).join('') + `<th class="rep-total-col">Total</th>`;

  // Each row: label + a value per plant + the Total-column value
  const row = (label, cellFn, totalHTML) =>
    `<tr><td class="rep-metric-name">${label}</td>` +
    R.map(p => `<td>${cellFn(p)}</td>`).join('') +
    `<td class="rep-total-col">${totalHTML}</td></tr>`;

  const vu = bizVolUnitAbbr(bizChipValue('repBizType') || null);
  const body = [
    row('Days Recorded',              p => `<span class="${p.days >= rangeDays ? '' : 'rep-down'}">${p.days} / ${rangeDays}</span>`, `${rangeDays} days`),
    row('Total Cost (₹ L)',           p => L(p.cost),  L(T.cost)),
    row(`Total Tonnage (${vu})`,      p => MT(p.qty),  MT(T.qty)),
    row('Avg MPK (₹)',                p => p.mpk.toFixed(2), T.mpk.toFixed(2)),
    row(`Last Month Tonnage (${vu})`, p => p.lmQty > 0 ? MT(p.lmQty) : '—', T.lmQty > 0 ? MT(T.lmQty) : '—'),
    row('Last Month MPK (₹)',         p => p.lmMPK != null ? p.lmMPK.toFixed(2) : '—', T.lmMPK != null ? T.lmMPK.toFixed(2) : '—'),
    row('MPK Change',                 p => `<span class="${cls(p.status)}">${chg(p.status, p.changePct || 0)}</span>`, `<span class="${cls(T.status)}">${chg(T.status, T.changePct || 0)}</span>`),
    row('Status',                     p => `<span class="${cls(p.status)}">${stat(p.status)}</span>`, `<span class="${cls(T.status)}">${stat(T.status)}</span>`),
    row('Proj. Month-End Cost (₹ L)', p => L(p.projCost), L(T.projCost)),
    row(`Proj. Tonnage (${vu})`,      p => MT(p.projQty), MT(T.projQty)),
    row('Tonnage Change (Proj. vs LM)', p => `<span class="${cls(p.qtyStatus)}">${chg(p.qtyStatus, p.qtyChangePct || 0)}</span>`, `<span class="${cls(T.qtyStatus)}">${chg(T.qtyStatus, T.qtyChangePct || 0)}</span>`),
    row('Proj. Month-End MPK (₹)',    p => p.projMPK.toFixed(2), T.projMPK.toFixed(2)),
  ].join('');

  document.getElementById('reportContent').innerHTML =
    `<div class="rep-table-wrap"><table class="rep-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

