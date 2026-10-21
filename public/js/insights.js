/* ═══════════════════════════════════════════════════════
   COST INSIGHTS — Layers 1-5
   Layer 1: Cost Visibility (where the money goes)
   Layer 2: Variance & Root-Cause Analysis (why costs changed)
   Layer 3: Anomaly Detection (flag values that deserve investigation)
   Layer 4: Forecasting & Targets (estimate where costs are heading)
   Layer 5: Recommendations & Actions (translate findings into action)
═══════════════════════════════════════════════════════ */

let insightsBizType = '';
let _insightsMonth = '';
let _insightsTab = 'overview';
let _insChartCostSplit = null;
let _insChartVendor = null;
let _insChartSku = null;
let _insChartVariance = null;
let _insChartForecast = null;

function openInsights() {
  document.getElementById('insightsOverlay').style.display = 'flex';
  if (!_insightsMonth) {
    const now = new Date();
    _insightsMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  loadInsights();
}
function closeInsights() {
  const el = document.getElementById('insightsOverlay');
  if (el) el.style.display = 'none';
}

function setInsightsTab(tab) {
  _insightsTab = tab;
  document.querySelectorAll('.ins-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  loadInsights();
}

async function loadInsights() {
  if (document.getElementById('insightsBizType')) insightsBizType = bizChipValue('insightsBizType');
  const bizWrap = document.getElementById('insightsBizTypeWrap');
  if (bizWrap) bizWrap.innerHTML = bizChipsHTML('insightsBizType', insightsBizType, 'loadInsights');

  const monthInput = document.getElementById('insightsMonthInput');
  if (monthInput) {
    if (!monthInput.value) monthInput.value = _insightsMonth;
    _insightsMonth = monthInput.value;
  }

  const content = document.getElementById('insightsContent');
  content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Loading…</p>';

  try {
    const btParam = insightsBizType ? `&businessType=${encodeURIComponent(insightsBizType)}` : '';
    if (_insightsTab === 'overview') {
      const data = await api('GET', `/api/insights/overview?month=${_insightsMonth}${btParam}`);
      _renderOverview(data, content);
    } else if (_insightsTab === 'variance') {
      const data = await api('GET', `/api/insights/variance?month=${_insightsMonth}${btParam}`);
      _renderVariance(data, content);
    } else if (_insightsTab === 'anomalies') {
      const data = await api('GET', `/api/insights/anomalies?month=${_insightsMonth}${btParam}`);
      _renderAnomalies(data, content);
    } else if (_insightsTab === 'forecast') {
      const data = await api('GET', `/api/insights/forecast?month=${_insightsMonth}${btParam}`);
      _renderForecast(data, content);
    } else if (_insightsTab === 'actions') {
      const [actions, recs] = await Promise.all([
        api('GET', `/api/insights/actions?month=${_insightsMonth}`),
        api('GET', `/api/insights/recommendations?month=${_insightsMonth}${btParam}`),
      ]);
      _renderActions(actions, recs, content);
    }
  } catch (e) {
    content.innerHTML = `<p style="color:#c00;text-align:center;padding:20px">⚠ ${e.message}</p>`;
  }
}

// ═══════════════════════════════════════════════════════
// LAYER 1: OVERVIEW
// ═══════════════════════════════════════════════════════

function _renderOverview(data, el) {
  if (!data.plants || !data.plants.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No records found for this month.</p>';
    return;
  }

  // Aggregate totals
  let totAtt = 0, totKg = 0, totCost = 0, totQty = 0;
  data.plants.forEach(p => {
    totAtt  += parseFloat(p.attendance_cost);
    totKg   += parseFloat(p.kg_cost);
    totCost += parseFloat(p.total_cost);
    totQty  += parseFloat(p.total_qty);
  });
  const totMPK = totQty > 0 ? totCost / totQty : null;

  // Month label
  const [yr, mo] = _insightsMonth.split('-').map(Number);
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  let html = '';

  // ── Summary cards ──
  html += `<div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">${monthLabel} — Summary</div>
    <div class="rep-summary">
      <div class="rep-sum-card">
        <div class="rep-sum-label">Total Cost</div>
        <div class="rep-sum-value">${fcShort(totCost)}</div>
      </div>
      <div class="rep-sum-card">
        <div class="rep-sum-label">Total Volume</div>
        <div class="rep-sum-value">${fn(totQty, 0)} ${insightsBizType === 'Beverage' ? 'L' : 'kg'}</div>
      </div>
      <div class="rep-sum-card">
        <div class="rep-sum-label">Avg MPK</div>
        <div class="rep-sum-value">${totMPK != null ? '₹ ' + fn(totMPK) : '—'}</div>
      </div>
    </div>
  </div>`;

  // ── Per-plant MPK table ──
  html += `<div style="margin-bottom:20px">
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">Per-Plant Breakdown</div>
    <div class="rep-table-wrap"><table class="rep-table">
      <thead><tr>
        <th style="text-align:left">Plant</th>
        <th>Days</th>
        <th>Att. Cost</th>
        <th>Per-Unit Cost</th>
        <th>Total Cost</th>
        <th>Volume</th>
        <th>MPK</th>
        <th>Cost Split</th>
      </tr></thead>
      <tbody>`;
  data.plants.forEach(p => {
    const att = parseFloat(p.attendance_cost);
    const kg  = parseFloat(p.kg_cost);
    const tot = parseFloat(p.total_cost);
    const qty = parseFloat(p.total_qty);
    const mpk = qty > 0 ? tot / qty : null;
    const attPct = tot > 0 ? Math.round(att / tot * 100) : 0;
    const kgPct  = 100 - attPct;
    html += `<tr>
      <td class="rep-metric-name">${p.name}</td>
      <td>${p.days}</td>
      <td>${fcShort(att)}</td>
      <td>${fcShort(kg)}</td>
      <td>${fcShort(tot)}</td>
      <td>${fn(qty, 0)}</td>
      <td style="font-weight:800;color:var(--primary)">${mpk != null ? '₹ ' + fn(mpk) : '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:4px;font-size:11px">
          <div style="width:60px;height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden">
            <div style="width:${attPct}%;height:100%;background:#f59e0b"></div>
          </div>
          <span style="color:#f59e0b">${attPct}%</span> / <span style="color:#3b82f6">${kgPct}%</span>
        </div>
      </td>
    </tr>`;
  });
  // Total row
  const totAttPct = totCost > 0 ? Math.round(totAtt / totCost * 100) : 0;
  html += `<tr style="font-weight:800;background:#eef7f1">
    <td class="rep-metric-name" style="background:#eef7f1">Total</td>
    <td>—</td>
    <td>${fcShort(totAtt)}</td>
    <td>${fcShort(totKg)}</td>
    <td>${fcShort(totCost)}</td>
    <td>${fn(totQty, 0)}</td>
    <td style="color:var(--primary)">${totMPK != null ? '₹ ' + fn(totMPK) : '—'}</td>
    <td>
      <div style="display:flex;align-items:center;gap:4px;font-size:11px">
        <div style="width:60px;height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden">
          <div style="width:${totAttPct}%;height:100%;background:#f59e0b"></div>
        </div>
        <span style="color:#f59e0b">${totAttPct}%</span> / <span style="color:#3b82f6">${100 - totAttPct}%</span>
      </div>
    </td>
  </tr>`;
  html += '</tbody></table></div></div>';

  // ── Cost split chart (attendance vs per-unit) ──
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">Attendance vs Per-Unit Cost</div>
      <canvas id="insChartCostSplit" height="200"></canvas>
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">MPK by Plant</div>
      <canvas id="insChartMPK" height="200"></canvas>
    </div>
  </div>`;

  // ── Top vendors by attendance cost ──
  if (data.vendorAttendance && data.vendorAttendance.length) {
    // Aggregate across plants, take top 10
    const vendorAgg = {};
    data.vendorAttendance.forEach(v => {
      if (!vendorAgg[v.contractor_name]) vendorAgg[v.contractor_name] = { cost: 0, workers: 0 };
      vendorAgg[v.contractor_name].cost    += parseFloat(v.cost);
      vendorAgg[v.contractor_name].workers += parseInt(v.workers) || 0;
    });
    const topVendors = Object.entries(vendorAgg)
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, 10);

    html += `<div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">Top Contractors by Attendance Cost</div>
      <div class="rep-table-wrap"><table class="rep-table">
        <thead><tr><th style="text-align:left">Contractor</th><th>Total Cost</th><th>Total Workers</th><th>Avg Cost/Worker</th><th>Share</th></tr></thead>
        <tbody>`;
    topVendors.forEach(([name, v]) => {
      const avgRate = v.workers > 0 ? v.cost / v.workers : 0;
      const share = totAtt > 0 ? (v.cost / totAtt * 100).toFixed(1) : 0;
      html += `<tr>
        <td class="rep-metric-name">${name}</td>
        <td>${fcShort(v.cost)}</td>
        <td>${v.workers.toLocaleString('en-IN')}</td>
        <td>₹ ${fn(avgRate)}</td>
        <td>${share}%</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
  }

  // ── Top SKUs by cost ──
  if (data.skuCost && data.skuCost.length) {
    const skuAgg = {};
    data.skuCost.forEach(s => {
      if (!skuAgg[s.sku_name]) skuAgg[s.sku_name] = { cost: 0, qty: 0 };
      skuAgg[s.sku_name].cost += parseFloat(s.cost);
      skuAgg[s.sku_name].qty  += parseFloat(s.qty);
    });
    const topSkus = Object.entries(skuAgg)
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, 15);

    html += `<div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">Top SKUs by Cost</div>
      <div class="rep-table-wrap"><table class="rep-table">
        <thead><tr><th style="text-align:left">SKU</th><th>Total Cost</th><th>Total Qty</th><th>Avg Rate (₹/unit)</th><th>Share of Per-Unit Cost</th></tr></thead>
        <tbody>`;
    topSkus.forEach(([name, s]) => {
      const avgRate = s.qty > 0 ? s.cost / s.qty : 0;
      const share = totKg > 0 ? (s.cost / totKg * 100).toFixed(1) : 0;
      html += `<tr>
        <td class="rep-metric-name">${name}</td>
        <td>${fcShort(s.cost)}</td>
        <td>${fn(s.qty, 0)}</td>
        <td>₹ ${fn(avgRate)}</td>
        <td>${share}%</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
  }

  el.innerHTML = html;

  // ── Draw charts ──
  _drawOverviewCharts(data);
}

function _drawOverviewCharts(data) {
  // Cost split stacked bar
  if (_insChartCostSplit) _insChartCostSplit.destroy();
  const splitCtx = document.getElementById('insChartCostSplit');
  if (splitCtx) {
    const labels = data.plants.map(p => p.name);
    _insChartCostSplit = new Chart(splitCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Attendance', data: data.plants.map(p => parseFloat(p.attendance_cost)), backgroundColor: '#f59e0b', borderRadius: 3 },
          { label: 'Per-Unit', data: data.plants.map(p => parseFloat(p.kg_cost)), backgroundColor: '#3b82f6', borderRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ₹ ${(ctx.raw / 1e5).toFixed(2)} L` } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { stacked: true, ticks: { callback: v => '₹' + (v / 1e5).toFixed(0) + 'L', font: { size: 10 } } },
        },
      },
    });
  }

  // MPK bar chart
  const mpkCtx = document.getElementById('insChartMPK');
  if (mpkCtx) {
    const labels = data.plants.map(p => p.name);
    const mpkVals = data.plants.map(p => {
      const qty = parseFloat(p.total_qty);
      const tot = parseFloat(p.total_cost);
      return qty > 0 ? tot / qty : 0;
    });
    new Chart(mpkCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'MPK (₹)',
          data: mpkVals,
          backgroundColor: '#1e6b45',
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `₹ ${ctx.raw.toFixed(2)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { ticks: { callback: v => '₹' + v.toFixed(0), font: { size: 10 } } },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════
// LAYER 2: VARIANCE & ROOT-CAUSE
// ═══════════════════════════════════════════════════════

function _renderVariance(data, el) {
  if (!data.variance || !data.variance.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No data for this period.</p>';
    return;
  }

  const [yr, mo] = _insightsMonth.split('-').map(Number);
  const curLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const prvLabel = data.prevMonth ? new Date(data.prevMonth + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'Prev';

  let html = '';

  // ── MPK change decomposition table ──
  html += `<div style="margin-bottom:20px">
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">MPK Change: ${curLabel} vs ${prvLabel}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px">What drove the change in cost per unit?</div>
    <div class="rep-table-wrap"><table class="rep-table">
      <thead><tr>
        <th style="text-align:left">Plant</th>
        <th>${prvLabel} MPK</th>
        <th>${curLabel} MPK</th>
        <th>Change</th>
        <th>Att. Effect</th>
        <th>Per-Unit Effect</th>
        <th>Volume Δ</th>
      </tr></thead>
      <tbody>`;

  let totCurCost = 0, totPrvCost = 0, totCurQty = 0, totPrvQty = 0;
  data.variance.forEach(v => {
    totCurCost += v.current.total;
    totPrvCost += v.previous.total;
    totCurQty  += v.current.qty;
    totPrvQty  += v.previous.qty;
    const changeBadge = _insChangeBadge(v.mpkChange, v.previous.mpk);
    html += `<tr>
      <td class="rep-metric-name">${v.name}</td>
      <td>${v.previous.mpk != null ? '₹ ' + fn(v.previous.mpk) : '—'}</td>
      <td style="font-weight:700">${v.current.mpk != null ? '₹ ' + fn(v.current.mpk) : '—'}</td>
      <td>${changeBadge}</td>
      <td>${v.attEffect != null ? _insEffectBadge(v.attEffect) : '—'}</td>
      <td>${v.kgEffect != null ? _insEffectBadge(v.kgEffect) : '—'}</td>
      <td>${v.volumeEffect ? _insVolBadge(v.volumeEffect) : '—'}</td>
    </tr>`;
  });
  // Total row
  const totPrvMPK = totPrvQty > 0 ? totPrvCost / totPrvQty : null;
  const totCurMPK = totCurQty > 0 ? totCurCost / totCurQty : null;
  const totChange = totCurMPK != null && totPrvMPK != null ? totCurMPK - totPrvMPK : null;
  html += `<tr style="font-weight:800;background:#eef7f1">
    <td class="rep-metric-name" style="background:#eef7f1">Total</td>
    <td>${totPrvMPK != null ? '₹ ' + fn(totPrvMPK) : '—'}</td>
    <td>${totCurMPK != null ? '₹ ' + fn(totCurMPK) : '—'}</td>
    <td>${_insChangeBadge(totChange, totPrvMPK)}</td>
    <td>—</td><td>—</td>
    <td>${totPrvQty > 0 ? _insVolBadge({ qtyChange: totCurQty - totPrvQty, costFromVolume: (totPrvMPK || 0) * (totCurQty - totPrvQty), costFromRate: totCurCost - totPrvCost - (totPrvMPK || 0) * (totCurQty - totPrvQty) }) : '—'}</td>
  </tr>`;
  html += '</tbody></table></div></div>';

  // ── Top vendor cost changes ──
  if (data.vendorChanges && data.vendorChanges.length) {
    html += `<div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">Top Contractor Cost Changes</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Contractors with the largest month-over-month cost difference</div>
      <div class="rep-table-wrap"><table class="rep-table">
        <thead><tr>
          <th style="text-align:left">Contractor</th>
          <th>${prvLabel}</th><th>${curLabel}</th><th>Change</th>
        </tr></thead>
        <tbody>`;
    data.vendorChanges.slice(0, 15).forEach(v => {
      const dir = v.change > 0 ? '🔴' : '🟢';
      html += `<tr>
        <td class="rep-metric-name">${v.vendor}</td>
        <td>${fcShort(v.previous)}</td>
        <td>${fcShort(v.current)}</td>
        <td>${dir} ${v.change > 0 ? '+' : ''}${fcShort(v.change)}</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
  }

  // ── Top SKU cost changes ──
  if (data.skuChanges && data.skuChanges.length) {
    html += `<div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">Top SKU Cost Changes</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">SKUs with the largest cost or rate swing</div>
      <div class="rep-table-wrap"><table class="rep-table">
        <thead><tr>
          <th style="text-align:left">SKU</th><th>Vendor</th>
          <th>${prvLabel} Cost</th><th>${curLabel} Cost</th><th>Cost Δ</th>
          <th>Rate Δ</th>
        </tr></thead>
        <tbody>`;
    data.skuChanges.slice(0, 15).forEach(s => {
      const dir = s.costChange > 0 ? '🔴' : '🟢';
      const rateDir = s.rateChange > 0 ? '↑' : s.rateChange < 0 ? '↓' : '—';
      html += `<tr>
        <td class="rep-metric-name">${s.sku}</td>
        <td>${s.vendor}</td>
        <td>${fcShort(s.previous.cost)}</td>
        <td>${fcShort(s.current.cost)}</td>
        <td>${dir} ${s.costChange > 0 ? '+' : ''}${fcShort(s.costChange)}</td>
        <td>${rateDir} ${s.rateChange !== 0 ? (s.rateChange > 0 ? '+' : '') + '₹' + fn(s.rateChange) : ''}</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
  }

  el.innerHTML = html;
}

function _insChangeBadge(change, base) {
  if (change == null) return '<span style="color:var(--muted)">—</span>';
  const pct = base && base !== 0 ? (change / Math.abs(base) * 100) : null;
  const pctStr = pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : '';
  // For MPK: increase = worse (red), decrease = better (green)
  if (change > 0.005)  return `<span class="rep-badge worsening">+₹${fn(change)}${pctStr}</span>`;
  if (change < -0.005) return `<span class="rep-badge improving">₹${fn(change)}${pctStr}</span>`;
  return `<span class="rep-badge same">—</span>`;
}

function _insEffectBadge(effect) {
  if (effect == null) return '—';
  const sign = effect > 0 ? '+' : '';
  const cls = effect > 0.005 ? 'worsening' : effect < -0.005 ? 'improving' : 'same';
  return `<span class="rep-badge ${cls}">${sign}₹${fn(effect)}</span>`;
}

function _insVolBadge(vol) {
  if (!vol) return '—';
  const qtySign = vol.qtyChange > 0 ? '+' : '';
  const rateLabel = vol.costFromRate > 0 ? `Rate: +${fcShort(vol.costFromRate)}` : `Rate: ${fcShort(vol.costFromRate)}`;
  const volLabel = vol.costFromVolume > 0 ? `Vol: +${fcShort(vol.costFromVolume)}` : `Vol: ${fcShort(vol.costFromVolume)}`;
  return `<span style="font-size:10px;line-height:1.4;display:inline-block">${qtySign}${fn(vol.qtyChange, 0)} units<br>${volLabel}<br>${rateLabel}</span>`;
}

// ═══════════════════════════════════════════════════════
// LAYER 3: ANOMALIES
// ═══════════════════════════════════════════════════════

function _renderAnomalies(data, el) {
  if (!data.anomalies || !data.anomalies.length) {
    el.innerHTML = `<div style="text-align:center;padding:40px">
      <div style="font-size:40px;margin-bottom:12px">✓</div>
      <div style="font-size:15px;font-weight:700;color:var(--text)">No anomalies detected</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">All values for this month look normal compared to the last 3 months.</div>
    </div>`;
    return;
  }

  // Group by type
  const groups = {};
  data.anomalies.forEach(a => {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  });

  const typeLabels = {
    vendor_rate:     { icon: '👷', label: 'Unusual Contractor Rates' },
    attendance_jump: { icon: '📊', label: 'Attendance Cost Jumps' },
    sku_rate:        { icon: '📦', label: 'SKU Rate Anomalies' },
    missing_days:    { icon: '📅', label: 'Missing Working Days' },
  };

  // Summary counts
  const highCount   = data.anomalies.filter(a => a.severity === 'high').length;
  const mediumCount = data.anomalies.filter(a => a.severity === 'medium').length;
  const lowCount    = data.anomalies.filter(a => a.severity === 'low').length;

  let html = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">
      <span style="font-size:18px">🔴</span>
      <span style="font-size:13px;font-weight:700;color:#991b1b">${highCount} High</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
      <span style="font-size:18px">🟡</span>
      <span style="font-size:13px;font-weight:700;color:#92400e">${mediumCount} Medium</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
      <span style="font-size:18px">🟢</span>
      <span style="font-size:13px;font-weight:700;color:#166534">${lowCount} Low</span>
    </div>
  </div>`;

  for (const [type, items] of Object.entries(groups)) {
    const info = typeLabels[type] || { icon: '⚠', label: type };
    html += `<div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px">${info.icon} ${info.label} <span style="font-weight:400;color:var(--muted)">(${items.length})</span></div>`;

    if (type === 'missing_days') {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">';
      items.forEach(a => {
        const sevColor = a.severity === 'high' ? '#991b1b' : a.severity === 'medium' ? '#92400e' : '#166534';
        const sevBg    = a.severity === 'high' ? '#fef2f2' : a.severity === 'medium' ? '#fffbeb' : '#f0fdf4';
        html += `<div style="padding:12px;background:${sevBg};border-radius:8px;border:1px solid var(--border)">
          <div style="font-weight:700;color:${sevColor};font-size:13px">${a.plant}</div>
          <div style="font-size:12px;color:var(--text);margin-top:4px">${a.count} missing day${a.count > 1 ? 's' : ''}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${(a.dates || []).join(', ')}${a.count > 10 ? '…' : ''}</div>
        </div>`;
      });
      html += '</div>';
    } else {
      html += `<div class="rep-table-wrap"><table class="rep-table">
        <thead><tr>
          <th style="text-align:left;width:50px">⚡</th>
          <th style="text-align:left">Plant</th>
          <th>Date</th>
          ${type === 'vendor_rate' ? '<th>Contractor</th>' : ''}
          ${type === 'sku_rate' ? '<th>SKU</th>' : ''}
          <th>Value</th>
          <th>Expected</th>
          <th>Z-Score</th>
        </tr></thead>
        <tbody>`;
      items.forEach(a => {
        const sevIcon = a.severity === 'high' ? '🔴' : '🟡';
        html += `<tr>
          <td style="text-align:center">${sevIcon}</td>
          <td class="rep-metric-name">${a.plant}</td>
          <td>${a.date || '—'}</td>
          ${type === 'vendor_rate' ? `<td>${a.vendor}</td>` : ''}
          ${type === 'sku_rate' ? `<td>${a.sku}</td>` : ''}
          <td style="font-weight:700">₹ ${fn(a.value)}</td>
          <td>₹ ${fn(a.expected)}</td>
          <td><span style="font-weight:700;color:${Math.abs(a.zScore) >= 3 ? '#991b1b' : '#92400e'}">${a.zScore > 0 ? '+' : ''}${a.zScore}</span></td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }

    html += '</div>';
  }

  el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════
// LAYER 4: FORECASTING & TARGETS
// ═══════════════════════════════════════════════════════

function _renderForecast(data, el) {
  if (!data.forecasts || !data.forecasts.length) {
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No records found for this month.</p>';
    return;
  }

  const [yr, mo] = _insightsMonth.split('-').map(Number);
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  let html = '';

  // ── Status summary ──
  const onTrack = data.forecasts.filter(f => f.status === 'on_track').length;
  const atRisk  = data.forecasts.filter(f => f.status === 'at_risk').length;
  const over    = data.forecasts.filter(f => f.status === 'over').length;
  const noData  = data.forecasts.filter(f => !f.status).length;

  html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
      <span style="font-size:14px;font-weight:800;color:#166534">${onTrack}</span>
      <span style="font-size:12px;color:#166534">On Track</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
      <span style="font-size:14px;font-weight:800;color:#92400e">${atRisk}</span>
      <span style="font-size:12px;color:#92400e">At Risk</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">
      <span style="font-size:14px;font-weight:800;color:#991b1b">${over}</span>
      <span style="font-size:12px;color:#991b1b">Over Target</span>
    </div>
    ${noData ? `<div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#f5f5f5;border:1px solid #e5e7eb;border-radius:8px">
      <span style="font-size:14px;font-weight:800;color:var(--muted)">${noData}</span>
      <span style="font-size:12px;color:var(--muted)">No Data</span>
    </div>` : ''}
  </div>`;

  // ── Main forecast table ──
  html += `<div style="margin-bottom:20px">
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">${monthLabel} — Forecast</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Run-rate projection based on ${data.today <= _insightsMonth + '-31' ? 'days recorded so far' : 'actual month data'}</div>
    <div class="rep-table-wrap"><table class="rep-table">
      <thead><tr>
        <th style="text-align:left">Plant</th>
        <th>Days</th>
        <th>MTD Cost</th>
        <th>MTD MPK</th>
        <th>Projected Cost</th>
        <th>Projected MPK</th>
        <th>Range</th>
        <th>Target/Base</th>
        <th>Status</th>
        <th>Conf.</th>
      </tr></thead>
      <tbody>`;

  let totMtdCost = 0, totMtdQty = 0, totProjCost = 0, totProjQty = 0;
  let totLow = 0, totHigh = 0;
  let hasAnyProjection = false;

  data.forecasts.forEach(f => {
    totMtdCost += f.mtd.cost;
    totMtdQty  += f.mtd.qty;
    if (f.projected.cost != null) {
      totProjCost += f.projected.cost;
      totProjQty  += f.projected.qty || 0;
      totLow  += f.range.lowCost || f.projected.cost;
      totHigh += f.range.highCost || f.projected.cost;
      hasAnyProjection = true;
    }

    const statusBadge = _forecastStatusBadge(f.status);
    const confBadge = _forecastConfBadge(f.confidence, f.daysRecorded, f.totalWorkingDays);
    const daysLabel = `${f.daysRecorded}/${f.totalWorkingDays}`;
    const rangeStr = f.range.lowMPK != null && f.range.highMPK != null
      ? `₹${fn(f.range.lowMPK)} – ₹${fn(f.range.highMPK)}`
      : '—';
    const baseLabel = f.baseline.source === 'target'
      ? `₹${fn(f.baseline.mpk)} (target)`
      : f.baseline.mpk != null ? `₹${fn(f.baseline.mpk)} (prev)` : '—';

    html += `<tr>
      <td class="rep-metric-name">${f.name}</td>
      <td>${daysLabel}</td>
      <td>${fcShort(f.mtd.cost)}</td>
      <td>${f.mtd.mpk != null ? '₹ ' + fn(f.mtd.mpk) : '—'}</td>
      <td style="font-weight:700">${f.projected.cost != null ? fcShort(f.projected.cost) : '—'}</td>
      <td style="font-weight:800;color:var(--primary)">${f.projected.mpk != null ? '₹ ' + fn(f.projected.mpk) : '—'}</td>
      <td style="font-size:11px">${rangeStr}</td>
      <td style="font-size:11px">${baseLabel}</td>
      <td>${statusBadge}</td>
      <td>${confBadge}</td>
    </tr>`;
  });

  // Total row
  const totMtdMPK = totMtdQty > 0 ? totMtdCost / totMtdQty : null;
  const totProjMPK = totProjQty > 0 ? totProjCost / totProjQty : null;
  const totLowMPK = totProjQty > 0 ? totLow / totProjQty : null;
  const totHighMPK = totProjQty > 0 ? totHigh / totProjQty : null;
  html += `<tr style="font-weight:800;background:#eef7f1">
    <td class="rep-metric-name" style="background:#eef7f1">Total</td>
    <td>—</td>
    <td>${fcShort(totMtdCost)}</td>
    <td>${totMtdMPK != null ? '₹ ' + fn(totMtdMPK) : '—'}</td>
    <td>${hasAnyProjection ? fcShort(totProjCost) : '—'}</td>
    <td style="color:var(--primary)">${totProjMPK != null ? '₹ ' + fn(totProjMPK) : '—'}</td>
    <td style="font-size:11px">${totLowMPK != null ? '₹' + fn(totLowMPK) + ' – ₹' + fn(totHighMPK) : '—'}</td>
    <td>—</td><td>—</td><td>—</td>
  </tr>`;
  html += '</tbody></table></div></div>';

  // ── Per-plant forecast cards ──
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-bottom:20px">';
  data.forecasts.forEach(f => {
    if (f.projected.cost == null) return;
    const statusColor = f.status === 'on_track' ? '#166534' : f.status === 'at_risk' ? '#92400e' : f.status === 'over' ? '#991b1b' : 'var(--muted)';
    const statusBg = f.status === 'on_track' ? '#f0fdf4' : f.status === 'at_risk' ? '#fffbeb' : f.status === 'over' ? '#fef2f2' : '#f5f5f5';
    const pctComplete = f.totalWorkingDays > 0 ? Math.round(f.daysRecorded / f.totalWorkingDays * 100) : 0;

    const progressBar = `<div style="width:100%;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin:6px 0">
      <div style="width:${pctComplete}%;height:100%;background:${statusColor};border-radius:3px"></div>
    </div>`;

    const attPct = f.projected.cost > 0 ? Math.round(f.projected.attendance / f.projected.cost * 100) : 0;
    const kgPct = 100 - attPct;

    let vsLastMonth = '';
    if (f.previousMonth && f.previousMonth.mpk != null && f.projected.mpk != null) {
      const pctChange = ((f.projected.mpk - f.previousMonth.mpk) / f.previousMonth.mpk * 100);
      const arrow = pctChange > 0 ? '↑' : pctChange < 0 ? '↓' : '→';
      const color = pctChange > 2 ? '#991b1b' : pctChange < -2 ? '#166534' : 'var(--muted)';
      vsLastMonth = `<span style="font-size:11px;color:${color}">${arrow} ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% vs last month</span>`;
    }

    html += `<div style="padding:14px;background:${statusBg};border:1px solid var(--border);border-radius:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-weight:700;font-size:13px;color:${statusColor}">${f.name}</div>
        ${_forecastStatusBadge(f.status)}
      </div>
      ${progressBar}
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:10px">
        <span>${f.daysRecorded} of ${f.totalWorkingDays} working days (${pctComplete}%)</span>
        <span>${f.remainingWorkingDays} remaining</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Projected Cost</div>
          <div style="font-size:15px;font-weight:800">${fcShort(f.projected.cost)}</div>
          <div style="font-size:10px;color:var(--muted)">Att: ${attPct}% / Unit: ${kgPct}%</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Projected MPK</div>
          <div style="font-size:15px;font-weight:800;color:var(--primary)">${f.projected.mpk != null ? '₹ ' + fn(f.projected.mpk) : '—'}</div>
          ${vsLastMonth}
        </div>
      </div>
      ${f.baseline.mpk != null ? `<div style="font-size:11px;color:var(--muted);border-top:1px solid var(--border);padding-top:6px;margin-top:4px">
        ${f.baseline.source === 'target' ? 'Target' : 'Baseline'}: ₹${fn(f.baseline.mpk)}/unit
        ${f.range.lowMPK != null ? ` &middot; Range: ₹${fn(f.range.lowMPK)} – ₹${fn(f.range.highMPK)}` : ''}
        ${f.baseline.notes ? `<br>${f.baseline.notes}` : ''}
      </div>` : ''}
    </div>`;
  });
  html += '</div>';

  // ── What-if MPK calculator ──
  html += `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:20px">
    <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">What-If Calculator</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px">Adjust cost and volume to see how MPK changes</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;max-width:600px">
      <div>
        <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Daily Cost Change (%)</label>
        <input type="range" id="whatifCostSlider" min="-30" max="30" value="0" style="width:100%" oninput="_updateWhatIf()">
        <div style="text-align:center;font-size:12px;font-weight:700" id="whatifCostLabel">0%</div>
      </div>
      <div>
        <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Volume Change (%)</label>
        <input type="range" id="whatifVolSlider" min="-30" max="30" value="0" style="width:100%" oninput="_updateWhatIf()">
        <div style="text-align:center;font-size:12px;font-weight:700" id="whatifVolLabel">0%</div>
      </div>
      <div id="whatifResult" style="display:flex;flex-direction:column;justify-content:center;align-items:center">
        <div style="font-size:10px;color:var(--muted)">Scenario MPK</div>
        <div style="font-size:18px;font-weight:800;color:var(--primary)" id="whatifMPK">—</div>
      </div>
    </div>
  </div>`;

  // ── Chart: projected vs baseline ──
  html += `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:20px">
    <canvas id="insChartForecast" height="120"></canvas>
  </div>`;

  // ── Set targets button (superadmin only) ──
  if (currentRole === 'superadmin') {
    html += `<div style="margin-bottom:20px">
      <button onclick="_openTargetModal()" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer">Set Monthly Targets</button>
    </div>`;
  }

  el.innerHTML = html;

  el._forecastData = data;
  _updateWhatIf();
  _drawForecastChart(data);
}

function _forecastStatusBadge(status) {
  if (status === 'on_track') return '<span style="font-size:11px;font-weight:700;color:#166534;background:#dcfce7;padding:2px 8px;border-radius:10px">On Track</span>';
  if (status === 'at_risk')  return '<span style="font-size:11px;font-weight:700;color:#92400e;background:#fef3c7;padding:2px 8px;border-radius:10px">At Risk</span>';
  if (status === 'over')     return '<span style="font-size:11px;font-weight:700;color:#991b1b;background:#fee2e2;padding:2px 8px;border-radius:10px">Over</span>';
  return '<span style="font-size:11px;color:var(--muted)">—</span>';
}

function _forecastConfBadge(conf, recorded, total) {
  if (conf === 'high')   return `<span style="font-size:10px;font-weight:700;color:#166534" title="${recorded}/${total} days">${conf}</span>`;
  if (conf === 'medium') return `<span style="font-size:10px;font-weight:700;color:#92400e" title="${recorded}/${total} days">${conf}</span>`;
  return `<span style="font-size:10px;font-weight:700;color:#991b1b" title="${recorded}/${total} days">${conf}</span>`;
}

function _updateWhatIf() {
  const content = document.getElementById('insightsContent');
  if (!content || !content._forecastData) return;
  const data = content._forecastData;
  const costPct = parseInt(document.getElementById('whatifCostSlider')?.value || 0);
  const volPct  = parseInt(document.getElementById('whatifVolSlider')?.value || 0);
  document.getElementById('whatifCostLabel').textContent = (costPct >= 0 ? '+' : '') + costPct + '%';
  document.getElementById('whatifVolLabel').textContent = (volPct >= 0 ? '+' : '') + volPct + '%';

  let totalCost = 0, totalQty = 0;
  data.forecasts.forEach(f => {
    if (f.projected.cost == null) return;
    totalCost += f.projected.cost * (1 + costPct / 100);
    totalQty  += (f.projected.qty || 0) * (1 + volPct / 100);
  });
  const mpk = totalQty > 0 ? totalCost / totalQty : null;
  document.getElementById('whatifMPK').textContent = mpk != null ? '₹ ' + fn(mpk) : '—';
}

function _drawForecastChart(data) {
  if (_insChartForecast) _insChartForecast.destroy();
  const ctx = document.getElementById('insChartForecast');
  if (!ctx) return;

  const labels = data.forecasts.filter(f => f.projected.mpk != null).map(f => f.name);
  const projected = data.forecasts.filter(f => f.projected.mpk != null).map(f => f.projected.mpk);
  const baseline  = data.forecasts.filter(f => f.projected.mpk != null).map(f => f.baseline.mpk || 0);
  const lowRange  = data.forecasts.filter(f => f.projected.mpk != null).map(f => f.range.lowMPK || f.projected.mpk);
  const highRange = data.forecasts.filter(f => f.projected.mpk != null).map(f => f.range.highMPK || f.projected.mpk);

  _insChartForecast = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Projected MPK',
          data: projected,
          backgroundColor: '#1e6b45',
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Target/Baseline',
          data: baseline,
          backgroundColor: 'rgba(59,130,246,0.3)',
          borderColor: '#3b82f6',
          borderWidth: 2,
          borderDash: [4, 2],
          type: 'line',
          fill: false,
          pointStyle: 'dash',
          pointRadius: 0,
          order: 1,
        },
        {
          label: 'Low Range',
          data: lowRange,
          backgroundColor: 'rgba(30,107,69,0.1)',
          borderColor: 'rgba(30,107,69,0.3)',
          borderWidth: 1,
          type: 'line',
          fill: false,
          pointRadius: 0,
          order: 0,
        },
        {
          label: 'High Range',
          data: highRange,
          backgroundColor: 'rgba(30,107,69,0.1)',
          borderColor: 'rgba(30,107,69,0.3)',
          borderWidth: 1,
          type: 'line',
          fill: '-1',
          pointRadius: 0,
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ₹${ctx.raw.toFixed(2)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: 'MPK (₹/unit)' }, ticks: { callback: v => '₹' + v.toFixed(0), font: { size: 10 } } },
      },
    },
  });
}

// ── Target modal ──
function _openTargetModal() {
  let modal = document.getElementById('targetModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'targetModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto" id="targetModalContent"></div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  _loadTargetForm();
}

async function _loadTargetForm() {
  const content = document.getElementById('targetModalContent');
  content.innerHTML = '<p style="color:var(--muted);text-align:center">Loading…</p>';

  try {
    const [targets, plantsResp] = await Promise.all([
      api('GET', `/api/insights/targets?month=${_insightsMonth}`),
      fetch('/api/auth/plants', { credentials: 'include' }).then(r => r.json()),
    ]);

    const plants = insightsBizType ? plantsResp.filter(p => p.business_type === insightsBizType) : plantsResp;
    const targetMap = {};
    targets.forEach(t => { targetMap[t.plant_id] = t; });

    const [yr, mo] = _insightsMonth.split('-').map(Number);
    const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    let html = `<div style="font-size:15px;font-weight:700;margin-bottom:4px">Set Targets — ${monthLabel}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px">Set target MPK per plant. Leave empty to use last month as baseline.</div>
      <div id="targetFormRows">`;

    plants.forEach(p => {
      const existing = targetMap[p.id];
      html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px;background:#f9fafb;border-radius:8px" data-plant-id="${p.id}" data-target-id="${existing ? existing.id : ''}">
        <div style="flex:1;font-size:13px;font-weight:600">${p.name}</div>
        <input type="number" step="0.01" min="0" placeholder="MPK" value="${existing ? existing.target_mpk : ''}" style="width:80px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" class="target-mpk-input">
        <input type="text" placeholder="Notes" value="${existing ? (existing.notes || '') : ''}" style="width:120px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" class="target-notes-input">
      </div>`;
    });

    html += `</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="_saveTargets()" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer;flex:1">Save Targets</button>
        <button onclick="document.getElementById('targetModal').style.display='none'" style="background:#e5e7eb;color:var(--text);border:none;border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer">Cancel</button>
      </div>
      <div id="targetSaveStatus" style="font-size:12px;margin-top:8px"></div>`;

    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<p style="color:#c00">Failed to load: ${e.message}</p>`;
  }
}

async function _saveTargets() {
  const rows = document.querySelectorAll('#targetFormRows > div');
  const status = document.getElementById('targetSaveStatus');
  status.textContent = 'Saving…';
  status.style.color = 'var(--muted)';
  let saved = 0, errors = 0;

  for (const row of rows) {
    const plantId = parseInt(row.dataset.plantId);
    const mpkInput = row.querySelector('.target-mpk-input');
    const notesInput = row.querySelector('.target-notes-input');
    const mpk = parseFloat(mpkInput.value);
    const notes = notesInput.value.trim();
    const existingId = row.dataset.targetId;

    if (isNaN(mpk) || mpk <= 0) {
      if (existingId) {
        try {
          await api('DELETE', `/api/insights/targets/${existingId}`);
          saved++;
        } catch { errors++; }
      }
      continue;
    }

    try {
      await api('POST', '/api/insights/targets', {
        plant_id: plantId, month: _insightsMonth, target_mpk: mpk, notes,
      });
      saved++;
    } catch { errors++; }
  }

  if (errors) {
    status.textContent = `Saved ${saved}, failed ${errors}`;
    status.style.color = '#991b1b';
  } else {
    status.textContent = `Saved ${saved} target(s)`;
    status.style.color = '#166534';
    setTimeout(() => {
      document.getElementById('targetModal').style.display = 'none';
      loadInsights();
    }, 800);
  }
}

// ═══════════════════════════════════════════════════════
// LAYER 5: RECOMMENDATIONS & ACTIONS
// ═══════════════════════════════════════════════════════

function _renderActions(actions, recsData, el) {
  const recs = recsData.recommendations || [];

  const [yr, mo] = _insightsMonth.split('-').map(Number);
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // Stats
  const open = actions.filter(a => a.status === 'open').length;
  const inProgress = actions.filter(a => a.status === 'in_progress').length;
  const completed = actions.filter(a => a.status === 'completed').length;
  const dismissed = actions.filter(a => a.status === 'dismissed').length;
  const totalSaving = actions.filter(a => a.status === 'completed' && a.estimated_saving)
    .reduce((s, a) => s + parseFloat(a.estimated_saving), 0);

  let html = '';

  // ── Summary cards ──
  html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <div style="padding:10px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;text-align:center">
      <div style="font-size:18px;font-weight:800;color:#991b1b">${open}</div>
      <div style="font-size:11px;color:#991b1b">Open</div>
    </div>
    <div style="padding:10px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;text-align:center">
      <div style="font-size:18px;font-weight:800;color:#92400e">${inProgress}</div>
      <div style="font-size:11px;color:#92400e">In Progress</div>
    </div>
    <div style="padding:10px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;text-align:center">
      <div style="font-size:18px;font-weight:800;color:#166534">${completed}</div>
      <div style="font-size:11px;color:#166534">Completed</div>
    </div>
    <div style="padding:10px 16px;background:#f5f5f5;border:1px solid #e5e7eb;border-radius:8px;text-align:center">
      <div style="font-size:18px;font-weight:800;color:var(--muted)">${dismissed}</div>
      <div style="font-size:11px;color:var(--muted)">Dismissed</div>
    </div>
    ${totalSaving > 0 ? `<div style="padding:10px 16px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;text-align:center;margin-left:auto">
      <div style="font-size:18px;font-weight:800;color:#047857">${fcShort(totalSaving)}</div>
      <div style="font-size:11px;color:#047857">Est. Savings (Completed)</div>
    </div>` : ''}
  </div>`;

  // ── Suggested recommendations ──
  if (recs.length > 0) {
    html += `<div style="margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">Suggested Actions</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Based on this month's variance and anomaly analysis. Click to add as an action item.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px">`;

    recs.forEach((r, i) => {
      const prioColor = r.priority === 'high' ? '#991b1b' : r.priority === 'medium' ? '#92400e' : '#166534';
      const prioBg = r.priority === 'high' ? '#fef2f2' : r.priority === 'medium' ? '#fffbeb' : '#f0fdf4';
      const prioBorder = r.priority === 'high' ? '#fecaca' : r.priority === 'medium' ? '#fde68a' : '#bbf7d0';
      html += `<div style="padding:12px;background:${prioBg};border:1px solid ${prioBorder};border-radius:8px;cursor:pointer" onclick="_addRecommendation(${i})" id="recCard${i}">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:6px">
          <div style="font-size:12px;font-weight:700;color:${prioColor}">${r.title}</div>
          <span style="font-size:10px;font-weight:700;color:${prioColor};background:${prioBg};border:1px solid ${prioBorder};padding:1px 6px;border-radius:4px;white-space:nowrap">${r.priority}</span>
        </div>
        <div style="font-size:11px;color:var(--text);margin-bottom:6px">${r.description || ''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;color:var(--muted)">${r.plant_name}</span>
          ${r.estimated_saving ? `<span style="font-size:11px;font-weight:700;color:#047857">Est. saving: ${fcShort(r.estimated_saving)}</span>` : ''}
        </div>
        <div style="font-size:10px;color:${prioColor};margin-top:6px;text-align:right">Click to add as action →</div>
      </div>`;
    });

    html += '</div></div>';
  }

  // ── Action items table ──
  html += `<div style="margin-bottom:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">Action Items — ${monthLabel}</div>
        <div style="font-size:11px;color:var(--muted)">Track recommendations and their outcomes</div>
      </div>
      ${currentRole === 'superadmin' ? `<button onclick="_openActionModal()" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;font-size:12px;cursor:pointer">+ New Action</button>` : ''}
    </div>`;

  if (actions.length === 0) {
    html += `<div style="text-align:center;padding:30px;color:var(--muted)">
      <div style="font-size:32px;margin-bottom:8px">📋</div>
      <div style="font-size:13px">No action items for this month yet.</div>
      <div style="font-size:11px;margin-top:4px">${recs.length > 0 ? 'Click a suggestion above to get started.' : 'Use the + button to create one manually.'}</div>
    </div>`;
  } else {
    html += `<div class="rep-table-wrap"><table class="rep-table">
      <thead><tr>
        <th style="width:30px">⚡</th>
        <th style="text-align:left">Action</th>
        <th>Plant</th>
        <th>Owner</th>
        <th>Due</th>
        <th>Est. Saving</th>
        <th>Status</th>
        <th>MPK Impact</th>
        <th style="width:50px"></th>
      </tr></thead>
      <tbody>`;

    actions.forEach(a => {
      const prioIcon = a.priority === 'high' ? '🔴' : a.priority === 'medium' ? '🟡' : '🟢';
      const statusBadge = _actionStatusBadge(a.status);
      const mpkImpact = a.status === 'completed' && a.baseline_mpk && a.actual_mpk
        ? _actionMPKImpact(parseFloat(a.baseline_mpk), parseFloat(a.actual_mpk))
        : '<span style="color:var(--muted);font-size:11px">—</span>';
      const dueStr = a.due_date ? new Date(a.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
      const isOverdue = a.due_date && a.status !== 'completed' && a.status !== 'dismissed' && new Date(a.due_date) < new Date();

      html += `<tr style="${a.status === 'dismissed' ? 'opacity:.5' : ''}">
        <td style="text-align:center">${prioIcon}</td>
        <td>
          <div style="font-size:12px;font-weight:700;color:var(--text)">${a.title}</div>
          ${a.description ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.description}</div>` : ''}
          ${a.finding_ref ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">Ref: ${a.finding_ref}</div>` : ''}
        </td>
        <td style="font-size:12px">${a.plant_name}</td>
        <td style="font-size:12px">${a.owner || '—'}</td>
        <td style="font-size:12px;${isOverdue ? 'color:#991b1b;font-weight:700' : ''}">${dueStr}${isOverdue ? ' ⚠' : ''}</td>
        <td style="font-size:12px;font-weight:700;color:#047857">${a.estimated_saving ? fcShort(parseFloat(a.estimated_saving)) : '—'}</td>
        <td>${statusBadge}</td>
        <td>${mpkImpact}</td>
        <td>
          <button onclick="_openActionModal(${a.id})" style="border:none;background:none;cursor:pointer;font-size:14px" title="Edit">✏️</button>
        </td>
      </tr>`;
    });

    html += '</tbody></table></div>';
  }
  html += '</div>';

  // ── Completed actions with MPK impact ──
  const completedActions = actions.filter(a => a.status === 'completed' && a.baseline_mpk && a.actual_mpk);
  if (completedActions.length > 0) {
    html += `<div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Completed Actions — Before/After MPK</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">`;

    completedActions.forEach(a => {
      const before = parseFloat(a.baseline_mpk);
      const after = parseFloat(a.actual_mpk);
      const change = after - before;
      const pct = before > 0 ? ((change / before) * 100).toFixed(1) : '—';
      const improved = change < 0;
      const bg = improved ? '#f0fdf4' : '#fef2f2';
      const color = improved ? '#166534' : '#991b1b';
      const border = improved ? '#bbf7d0' : '#fecaca';

      html += `<div style="padding:12px;background:${bg};border:1px solid ${border};border-radius:8px">
        <div style="font-size:12px;font-weight:700;color:${color};margin-bottom:6px">${a.title}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${a.plant_name}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--muted)">Before</div>
            <div style="font-size:15px;font-weight:800">₹${fn(before)}</div>
          </div>
          <div style="font-size:18px;color:${color}">${improved ? '→' : '→'}</div>
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--muted)">After</div>
            <div style="font-size:15px;font-weight:800;color:${color}">₹${fn(after)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:10px;color:var(--muted)">Change</div>
            <div style="font-size:13px;font-weight:800;color:${color}">${change > 0 ? '+' : ''}${pct}%</div>
          </div>
        </div>
        ${a.resolution_note ? `<div style="font-size:11px;color:var(--muted);margin-top:8px;border-top:1px solid ${border};padding-top:6px">${a.resolution_note}</div>` : ''}
      </div>`;
    });

    html += '</div></div>';
  }

  el.innerHTML = html;
  el._recsData = recs;
}

function _actionStatusBadge(status) {
  if (status === 'open')        return '<span style="font-size:11px;font-weight:700;color:#991b1b;background:#fee2e2;padding:2px 8px;border-radius:10px">Open</span>';
  if (status === 'in_progress') return '<span style="font-size:11px;font-weight:700;color:#92400e;background:#fef3c7;padding:2px 8px;border-radius:10px">In Progress</span>';
  if (status === 'completed')   return '<span style="font-size:11px;font-weight:700;color:#166534;background:#dcfce7;padding:2px 8px;border-radius:10px">Completed</span>';
  if (status === 'dismissed')   return '<span style="font-size:11px;font-weight:700;color:var(--muted);background:#f3f4f6;padding:2px 8px;border-radius:10px">Dismissed</span>';
  return `<span style="font-size:11px;color:var(--muted)">${status}</span>`;
}

function _actionMPKImpact(before, after) {
  const change = after - before;
  const pct = before > 0 ? ((change / before) * 100).toFixed(1) : null;
  if (change < -0.005) return `<span style="font-size:11px;font-weight:700;color:#166534">${pct}%</span>`;
  if (change > 0.005)  return `<span style="font-size:11px;font-weight:700;color:#991b1b">+${pct}%</span>`;
  return '<span style="font-size:11px;color:var(--muted)">0%</span>';
}

async function _addRecommendation(idx) {
  const content = document.getElementById('insightsContent');
  if (!content || !content._recsData) return;
  const r = content._recsData[idx];
  if (!r) return;

  const card = document.getElementById('recCard' + idx);
  if (card) {
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
  }

  try {
    await api('POST', '/api/insights/actions', {
      plant_id: r.plant_id,
      month: _insightsMonth,
      finding_type: r.finding_type,
      finding_ref: r.finding_ref,
      title: r.title,
      description: r.description,
      estimated_saving: r.estimated_saving,
      baseline_mpk: r.baseline_mpk || null,
      priority: r.priority,
    });
    loadInsights();
  } catch (e) {
    if (card) { card.style.opacity = '1'; card.style.pointerEvents = ''; }
    alert('Failed to create action: ' + e.message);
  }
}

function _openActionModal(editId) {
  let modal = document.getElementById('actionModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'actionModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center';
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;max-width:520px;width:90%;max-height:85vh;overflow-y:auto" id="actionModalContent"><p style="color:var(--muted);text-align:center">Loading…</p></div>';
  _loadActionForm(editId);
}

async function _loadActionForm(editId) {
  const content = document.getElementById('actionModalContent');
  let existing = null;
  if (editId) {
    try {
      const all = await api('GET', `/api/insights/actions?month=${_insightsMonth}`);
      existing = all.find(a => a.id === editId);
    } catch {}
  }

  let plantsResp;
  try {
    plantsResp = await fetch('/api/auth/plants', { credentials: 'include' }).then(r => r.json());
  } catch { plantsResp = []; }
  const plants = insightsBizType ? plantsResp.filter(p => p.business_type === insightsBizType) : plantsResp;

  const isEdit = !!existing;
  const title = isEdit ? 'Edit Action' : 'New Action';

  let html = `<div style="font-size:15px;font-weight:700;margin-bottom:16px">${title}</div>`;

  html += `<div style="margin-bottom:10px">
    <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Plant</label>
    <select id="actionPlantId" style="width:100%;height:34px;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:13px">
      ${plants.map(p => `<option value="${p.id}" ${existing && existing.plant_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
    </select>
  </div>`;

  html += `<div style="margin-bottom:10px">
    <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Title</label>
    <input type="text" id="actionTitle" value="${existing ? existing.title.replace(/"/g, '&quot;') : ''}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px" placeholder="e.g. Negotiate vendor rate">
  </div>`;

  html += `<div style="margin-bottom:10px">
    <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Description</label>
    <textarea id="actionDesc" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:12px;resize:vertical">${existing ? (existing.description || '') : ''}</textarea>
  </div>`;

  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Priority</label>
      <select id="actionPriority" style="width:100%;height:34px;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:13px">
        <option value="high" ${existing && existing.priority === 'high' ? 'selected' : ''}>High</option>
        <option value="medium" ${!existing || existing.priority === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="low" ${existing && existing.priority === 'low' ? 'selected' : ''}>Low</option>
      </select>
    </div>
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Status</label>
      <select id="actionStatus" style="width:100%;height:34px;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:13px">
        <option value="open" ${!existing || existing.status === 'open' ? 'selected' : ''}>Open</option>
        <option value="in_progress" ${existing && existing.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
        <option value="completed" ${existing && existing.status === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="dismissed" ${existing && existing.status === 'dismissed' ? 'selected' : ''}>Dismissed</option>
      </select>
    </div>
  </div>`;

  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Owner</label>
      <input type="text" id="actionOwner" value="${existing ? (existing.owner || '') : ''}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px" placeholder="Person responsible">
    </div>
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Due Date</label>
      <input type="date" id="actionDue" value="${existing && existing.due_date ? existing.due_date.slice(0, 10) : ''}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px">
    </div>
  </div>`;

  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Est. Saving (₹)</label>
      <input type="number" id="actionSaving" step="0.01" value="${existing && existing.estimated_saving ? existing.estimated_saving : ''}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px" placeholder="0">
    </div>
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Finding Ref</label>
      <input type="text" id="actionRef" value="${existing ? (existing.finding_ref || '') : ''}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px" placeholder="Vendor/SKU name">
    </div>
  </div>`;

  if (isEdit) {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Baseline MPK</label>
        <input type="number" id="actionBaseMPK" step="0.01" value="${existing.baseline_mpk || ''}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px">
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Actual MPK (after)</label>
        <input type="number" id="actionActualMPK" step="0.01" value="${existing.actual_mpk || ''}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px">
      </div>
    </div>
    <div style="margin-bottom:10px">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Resolution Note</label>
      <textarea id="actionResolution" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:12px;resize:vertical">${existing.resolution_note || ''}</textarea>
    </div>`;
  }

  html += `<div style="display:flex;gap:8px;margin-top:16px">
    <button onclick="_saveAction(${editId || 'null'})" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer;flex:1">${isEdit ? 'Update' : 'Create'}</button>
    ${isEdit ? `<button onclick="_deleteAction(${editId})" style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:8px;padding:10px 16px;font-weight:700;font-size:13px;cursor:pointer">Delete</button>` : ''}
    <button onclick="document.getElementById('actionModal').style.display='none'" style="background:#e5e7eb;color:var(--text);border:none;border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer">Cancel</button>
  </div>
  <div id="actionSaveStatus" style="font-size:12px;margin-top:8px"></div>`;

  content.innerHTML = html;
}

async function _saveAction(editId) {
  const status = document.getElementById('actionSaveStatus');
  status.textContent = 'Saving…';
  status.style.color = 'var(--muted)';

  const payload = {
    plant_id: parseInt(document.getElementById('actionPlantId').value),
    month: _insightsMonth,
    title: document.getElementById('actionTitle').value.trim(),
    description: document.getElementById('actionDesc').value.trim(),
    priority: document.getElementById('actionPriority').value,
    status: document.getElementById('actionStatus').value,
    owner: document.getElementById('actionOwner').value.trim(),
    due_date: document.getElementById('actionDue').value || null,
    estimated_saving: parseFloat(document.getElementById('actionSaving').value) || null,
    finding_ref: document.getElementById('actionRef').value.trim() || null,
    finding_type: 'manual',
  };

  if (!payload.title) {
    status.textContent = 'Title is required';
    status.style.color = '#991b1b';
    return;
  }

  if (editId) {
    const baseMPK = document.getElementById('actionBaseMPK');
    const actualMPK = document.getElementById('actionActualMPK');
    const resolution = document.getElementById('actionResolution');
    if (baseMPK) payload.baseline_mpk = parseFloat(baseMPK.value) || null;
    if (actualMPK) payload.actual_mpk = parseFloat(actualMPK.value) || null;
    if (resolution) payload.resolution_note = resolution.value.trim() || null;
  }

  try {
    if (editId) {
      await api('PUT', `/api/insights/actions/${editId}`, payload);
    } else {
      await api('POST', '/api/insights/actions', payload);
    }
    status.textContent = 'Saved!';
    status.style.color = '#166534';
    setTimeout(() => {
      document.getElementById('actionModal').style.display = 'none';
      loadInsights();
    }, 500);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = '#991b1b';
  }
}

async function _deleteAction(id) {
  if (!confirm('Delete this action item?')) return;
  try {
    await api('DELETE', `/api/insights/actions/${id}`);
    document.getElementById('actionModal').style.display = 'none';
    loadInsights();
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}
