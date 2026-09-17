/* ═══════════════════════════════════════════════════════
   ADMIN DASHBOARD
═══════════════════════════════════════════════════════ */

let _dashLine = null;
let _dashBar  = null;
let _dashData = null;
let _dashView = 'daily';
let _dashFromDate = null;
let _dashToDate   = null;
let _dashPreset = 'thisMonth';
let _dashCompFromDate = null;
let _dashCompToDate   = null;
let _dashCompPreset = 'thisMonth';

// Shared preset -> {from, to} resolver used by both the Overview and Compare Plants filters
function _presetRange(preset) {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const pad = n => String(n).padStart(2, '0');
  const iso = (yy, mm, dd) => `${yy}-${pad(mm+1)}-${pad(dd)}`;
  if (preset === 'today') {
    const t = iso(y, mo, now.getDate());
    return { from: t, to: t };
  }
  if (preset === '7d') {
    const start = new Date(now); start.setDate(start.getDate() - 6);
    return { from: iso(start.getFullYear(), start.getMonth(), start.getDate()), to: iso(y, mo, now.getDate()) };
  }
  if (preset === 'lastMonth') {
    const lm = new Date(y, mo - 1, 1);
    const lastDay = new Date(lm.getFullYear(), lm.getMonth() + 1, 0).getDate();
    return { from: iso(lm.getFullYear(), lm.getMonth(), 1), to: iso(lm.getFullYear(), lm.getMonth(), lastDay) };
  }
  // thisMonth (default)
  const lastDay = new Date(y, mo + 1, 0).getDate();
  return { from: iso(y, mo, 1), to: iso(y, mo, lastDay) };
}

async function loadDashboard() {
  if (currentRole !== 'admin' && currentRole !== 'superadmin' && currentPlantId) return;
  document.getElementById('dashboardOverlay').style.display = 'flex';
  document.getElementById('dashViewSwitch').style.display = currentRole === 'superadmin' ? '' : 'none';
  switchDashView('overview');
  // Only default the range the first time the dashboard is ever opened this session —
  // switching plants or reopening must NOT wipe out a range the user already picked.
  if (!_dashFromDate) {
    const r = _presetRange('thisMonth');
    _dashFromDate = r.from; _dashToDate = r.to;
  }
  if (!_dashCompFromDate) {
    const r = _presetRange('thisMonth');
    _dashCompFromDate = r.from; _dashCompToDate = r.to;
  }
  document.getElementById('dashFromDate').value = _dashFromDate;
  document.getElementById('dashToDate').value   = _dashToDate;
  document.getElementById('dashCompFromDate').value = _dashCompFromDate;
  document.getElementById('dashCompToDate').value   = _dashCompToDate;
  _setActiveChip('dashPresetChips', _dashPreset);
  _setActiveChip('dashCompPresetChips', _dashCompPreset);
  try {
    // Scope the aggregate to the active business when no single plant is selected
    const btQs = (!currentPlantId && !activePlantId && activeBizType)
      ? '?businessType=' + encodeURIComponent(activeBizType) : '';
    const data = await api('GET', '/api/records/analytics' + btQs);
    _dashData = data;
    _applyDashData();
  } catch (e) {
    showToast('Failed to load dashboard: ' + e.message, true);
  }
  // Compare Plants tab is loaded lazily by switchDashView(), but if it was already
  // showing (re-entering the dashboard), refresh it with the persisted range.
  if (_dashCompareData) loadDashCompare();
}

function _setActiveChip(containerId, preset) {
  document.querySelectorAll(`#${containerId} .dash-chip`).forEach(btn =>
    btn.classList.toggle('active', btn.dataset.preset === preset));
}

function applyDashPreset(preset) {
  _dashPreset = preset;
  if (preset !== 'custom') {
    const r = _presetRange(preset);
    _dashFromDate = r.from; _dashToDate = r.to;
    document.getElementById('dashFromDate').value = _dashFromDate;
    document.getElementById('dashToDate').value   = _dashToDate;
  } else {
    _dashFromDate = document.getElementById('dashFromDate').value || null;
    _dashToDate   = document.getElementById('dashToDate').value   || null;
  }
  _setActiveChip('dashPresetChips', _dashPreset);
  _applyDashData();
}

function applyDashCompPreset(preset) {
  _dashCompPreset = preset;
  if (preset !== 'custom') {
    const r = _presetRange(preset);
    _dashCompFromDate = r.from; _dashCompToDate = r.to;
    document.getElementById('dashCompFromDate').value = _dashCompFromDate;
    document.getElementById('dashCompToDate').value   = _dashCompToDate;
  } else {
    _dashCompFromDate = document.getElementById('dashCompFromDate').value || null;
    _dashCompToDate   = document.getElementById('dashCompToDate').value   || null;
  }
  _setActiveChip('dashCompPresetChips', _dashCompPreset);
  loadDashCompare();
}

function switchDashView(view) {
  document.getElementById('btnDashOverview').classList.toggle('active', view === 'overview');
  document.getElementById('btnDashCompare').classList.toggle('active', view === 'compare');
  document.getElementById('dashOverviewView').style.display = view === 'overview' ? '' : 'none';
  document.getElementById('dashCompareView').style.display  = view === 'compare'  ? '' : 'none';
  if (view === 'compare' && !_dashCompareData) loadDashCompare();
}

let _dashCompare = null;
let _dashCompareData = null;
let _dashCompareDetail = null;
let dashCompBizType = '';

async function loadDashCompare() {
  const from = _dashCompFromDate || document.getElementById('dashCompFromDate').value;
  const to   = _dashCompToDate   || document.getElementById('dashCompToDate').value;
  if (!from || !to) return;
  closeDashCompareDetail();
  // Same fix as the Report chips: don't fall back to the old value once the chip
  // row exists — an empty value there is a deliberate "All" click.
  if (document.getElementById('dashCompBizType')) dashCompBizType = bizChipValue('dashCompBizType');
  const bizWrap = document.getElementById('dashCompBizTypeWrap');
  if (bizWrap) bizWrap.innerHTML = bizChipsHTML('dashCompBizType', dashCompBizType, 'loadDashCompare');
  try {
    const businessType = dashCompBizType;
    const btParam = businessType ? `&businessType=${encodeURIComponent(businessType)}` : '';
    const data = await api('GET', `/api/records/compare?from=${from}&to=${to}${btParam}`);
    _dashCompareData = data;
    _renderDashCompare(data);
  } catch (e) {
    showToast('Failed to load comparison: ' + e.message, true);
  }
}

// Weighted 7-day rolling MPK: sum(cost) / sum(qty) over the trailing window,
// not an average of daily MPKs (avoids skew from low-volume days).
function _rollingMPK(daily, windowSize) {
  const byDate = {};
  daily.forEach(d => { byDate[d.date] = d; });
  const dates = daily.map(d => d.date).sort();
  return dates.map((date, i) => {
    const windowDates = dates.slice(Math.max(0, i - windowSize + 1), i + 1);
    let cost = 0, qty = 0;
    windowDates.forEach(dt => { cost += byDate[dt].cost; qty += byDate[dt].qty; });
    return { date, mpk: qty > 0 ? cost / qty : null };
  });
}

function _renderDashCompare(data) {
  if (_dashCompare) { _dashCompare.destroy(); _dashCompare = null; }
  const emptyEl = document.getElementById('dashCompareEmpty');
  const canvasEl = document.getElementById('dashCompareChart');

  if (!data.plants.length || !data.plants.some(p => p.daily.length)) {
    emptyEl.style.display = '';
    canvasEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  canvasEl.style.display = '';

  const palette = ['#0f766e', '#c2410c', '#7c3aed', '#0369a1', '#be123c'];
  const fmtLabel = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // Union of all dates across plants, so every line shares the same x-axis
  const allDates = [...new Set(data.plants.flatMap(p => p.daily.map(d => d.date)))].sort();

  const datasets = data.plants.map((p, i) => {
    const rolling = _rollingMPK(p.daily, 7);
    const byDate = {}; rolling.forEach(r => { byDate[r.date] = r.mpk; });
    return {
      label: p.name,
      data: allDates.map(dt => byDate[dt] ?? null),
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length],
      spanGaps: true,
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2,
    };
  });

  const ctx = canvasEl.getContext('2d');
  _dashCompare = new Chart(ctx, {
    type: 'line',
    data: { labels: allDates.map(fmtLabel), datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        // Default legend behavior: click a plant's name to show/hide just that line,
        // so any subset of plants (1, 2, 3...) can be isolated for comparison.
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
      },
      scales: {
        y: { title: { display: true, text: bizMpkLabel(dashCompBizType || null) } },
      },
    },
  });

  // Drill-in buttons, separate from the legend so the legend stays free for
  // isolating any subset of plants (its normal show/hide behavior).
  const chipsEl = document.getElementById('dashCompareDrillinChips');
  chipsEl.innerHTML = data.plants.map((p, i) =>
    `<button class="dash-chip" style="border-color:${palette[i % palette.length]}55"
       onclick="openDashCompareDetail('${p.name.replace(/'/g, "\\'")}')">${p.name}</button>`
  ).join('');
}

let _dashCompareDetailPlantName = null;
let _dashCompareDetailMode = 'perKg'; // 'perKg' | 'absolute'

function openDashCompareDetail(plantName) {
  const plant = _dashCompareData?.plants.find(p => p.name === plantName);
  if (!plant || !plant.daily.length) { showToast('No data for ' + plantName + ' in this range', true); return; }

  _dashCompareDetailPlantName = plantName;
  document.getElementById('dashCompareChartSection').style.display = 'none';
  document.getElementById('dashCompareDetailSection').style.display = '';
  document.getElementById('dashCompareDetailTitle').textContent = 'Plant Breakdown — ' + plantName;
  _renderDashCompareDetailChart();
}

function setDashCompareDetailMode(mode) {
  _dashCompareDetailMode = mode;
  document.querySelectorAll('#dashCompareDetailModeToggle .dash-toggle-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode));
  _renderDashCompareDetailChart();
}

function _renderDashCompareDetailChart() {
  const plant = _dashCompareData?.plants.find(p => p.name === _dashCompareDetailPlantName);
  if (!plant) return;

  const _pbt = Object.values(PLANTS_BY_ID).find(p => p.name === plant.name)?.business_type || null;
  const _pu = bizUnitAbbr(_pbt);
  const hintEl = document.getElementById('dashCompareDetailHint');
  hintEl.textContent = _dashCompareDetailMode === 'perKg'
    ? `Attendance cost/${_pu} and KG cost/${_pu} (left axis, ₹) vs Sale Qty (right axis, ${_pu}) — note: both cost/${_pu} lines rise together if volume simply drops, even with no real cost change.`
    : `Absolute ₹ spent on attendance and KG processing (left axis) vs Sale Qty (right axis) — these lines are unaffected by volume, so a rise here means you actually spent more.`;

  if (_dashCompareDetail) { _dashCompareDetail.destroy(); _dashCompareDetail = null; }

  const sorted = [...plant.daily].sort((a, b) => a.date.localeCompare(b.date));
  const fmtLabel = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const qty = sorted.map(d => d.qty);
  const isPerKg = _dashCompareDetailMode === 'perKg';
  const attData = isPerKg
    ? sorted.map(d => d.qty > 0 ? d.attendanceCost / d.qty : null)
    : sorted.map(d => d.attendanceCost);
  const kgData = isPerKg
    ? sorted.map(d => d.qty > 0 ? d.kgCost / d.qty : null)
    : sorted.map(d => d.kgCost);

  const ctx = document.getElementById('dashCompareDetailChart').getContext('2d');
  _dashCompareDetail = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(d => fmtLabel(d.date)),
      datasets: [
        { label: isPerKg ? `Attendance Cost/${_pu}` : 'Attendance Cost (₹)', data: attData, borderColor: '#1e6b45', backgroundColor: '#1e6b45',
          yAxisID: 'y', spanGaps: true, tension: 0.3, pointRadius: 2, borderWidth: 2 },
        { label: isPerKg ? `KG Cost/${_pu}` : 'KG Cost (₹)', data: kgData, borderColor: '#c2410c', backgroundColor: '#c2410c',
          yAxisID: 'y', spanGaps: true, tension: 0.3, pointRadius: 2, borderWidth: 2 },
        { label: `Sale Qty (${_pu})`, data: qty, borderColor: '#94a3b8', backgroundColor: '#94a3b8',
          yAxisID: 'y1', spanGaps: true, tension: 0.3, pointRadius: 2, borderWidth: 2, borderDash: [5, 3] },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y:  { position: 'left',  title: { display: true, text: isPerKg ? `₹ per ${_pu}` : '₹ (absolute)' } },
        y1: { position: 'right', title: { display: true, text: `Sale Qty (${_pu})` }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

function closeDashCompareDetail() {
  document.getElementById('dashCompareDetailSection').style.display = 'none';
  document.getElementById('dashCompareChartSection').style.display  = '';
}

function _applyDashData() {
  if (!_dashData) return;
  // Filter daily records to selected range
  const filtered = {
    daily: _dashData.daily.filter(r => {
      if (_dashFromDate && r.date < _dashFromDate) return false;
      if (_dashToDate   && r.date > _dashToDate)   return false;
      return true;
    }),
    monthly: _dashData.monthly
  };
  // Update range label
  const fmtD = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const label = (_dashFromDate && _dashToDate)
    ? `Showing: ${fmtD(_dashFromDate)} — ${fmtD(_dashToDate)}`
    : (_dashFromDate ? `From ${fmtD(_dashFromDate)}` : '');
  document.getElementById('dashDateRangeLabel').textContent = label;
  _renderDashCards(filtered);
  _renderDashTrend(filtered);
  setChartView(_dashView);
  _renderDashTable(filtered);
}

function closeDashboard() {
  document.getElementById('dashboardOverlay').style.display = 'none';
  if (_dashLine) { _dashLine.destroy(); _dashLine = null; }
  if (_dashBar)  { _dashBar.destroy();  _dashBar  = null; }
  setActiveNav('daily');
}

function _renderDashCards(data) {
  const recs = data.daily;

  const totalCostSum = recs.reduce((s, r) => s + parseFloat(r.total_cost || 0), 0);
  const totalAttSum  = recs.reduce((s, r) => s + parseFloat(r.attendance_cost || 0), 0);
  const totalQtySum  = recs.reduce((s, r) => s + parseFloat(r.sale_qty  || 0), 0);
  const avgMPK = totalQtySum > 0 ? totalCostSum / totalQtySum : null;

  const valid = recs.filter(r => parseFloat(r.mpk) > 0);
  const best  = valid.length ? valid.reduce((b, r) => parseFloat(r.mpk) < parseFloat(b.mpk) ? r : b) : null;
  const worst = valid.length ? valid.reduce((w, r) => parseFloat(r.mpk) > parseFloat(w.mpk) ? r : w) : null;

  const fmtD = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const _dbt = dashboardBizType();
  document.getElementById('dcAvgMPKLabel').textContent = bizMpkLabel(_dbt).replace('MPK ', 'Avg MPK ');
  document.getElementById('dcTotalVolLabel').textContent = _dbt === 'Beverage' ? 'Total Volume' : 'Total Tonnage';
  document.getElementById('dcAvgMPK').textContent    = avgMPK !== null ? '₹ ' + avgMPK.toFixed(2) : '—';
  document.getElementById('dcBestMPK').textContent   = best  ? '₹ ' + parseFloat(best.mpk).toFixed(2)  : '—';
  document.getElementById('dcBestDate').textContent  = best  ? fmtD(best.date)  : '';
  document.getElementById('dcWorstMPK').textContent  = worst ? '₹ ' + parseFloat(worst.mpk).toFixed(2) : '—';
  document.getElementById('dcWorstDate').textContent = worst ? fmtD(worst.date) : '';
  document.getElementById('dcDaysCount').textContent = recs.length + ' days recorded';
  document.getElementById('dcTotalAtt').textContent  = fcShort(totalCostSum);
  const mtVal = totalQtySum / 1000;
  document.getElementById('dcTotalVol').textContent  = mtVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + bizVolUnitAbbr(_dbt);
  document.getElementById('dcTotalVolMT').textContent = totalQtySum.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ' + bizUnitAbbr(_dbt);

  _renderDashPrediction(recs);
}

function _renderDashPrediction(recs) {
  const predSection = document.getElementById('dashPredSection');
  if (!predSection) return;

  // Only show when the filter window is the current month
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth();
  const fromOk = !_dashFromDate || _dashFromDate === `${curY}-${String(curM+1).padStart(2,'0')}-01`;
  const daysInMonth = new Date(curY, curM + 1, 0).getDate();
  const lastDay = `${curY}-${String(curM+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
  const toOk = !_dashToDate || _dashToDate === lastDay;

  if (!fromOk || !toOk || recs.length === 0) {
    predSection.style.display = 'none';
    return;
  }
  predSection.style.display = '';

  const daysRecorded = recs.length;
  const daysElapsed  = now.getDate(); // today's date = days elapsed in month
  const daysRemaining = daysInMonth - daysElapsed;

  const actualCost = recs.reduce((s, r) => s + parseFloat(r.total_cost || 0), 0);
  const actualQty  = recs.reduce((s, r) => s + parseFloat(r.sale_qty  || 0), 0);
  const avgDailyCost = actualCost / daysRecorded;
  const avgDailyQty  = actualQty  / daysRecorded;

  const predCost = actualCost + avgDailyCost * daysRemaining;
  const predQty  = actualQty  + avgDailyQty  * daysRemaining;
  const actualMPK = actualQty > 0 ? actualCost / actualQty : null;
  const predMPK   = predQty   > 0 ? predCost   / predQty   : null;

  const pct = Math.round((daysElapsed / daysInMonth) * 100);

  document.getElementById('dpPredCost').textContent    = fcShort(predCost);
  document.getElementById('dpPredBasis').textContent   = `avg ₹${Math.round(avgDailyCost).toLocaleString('en-IN')}/day × ${daysRemaining} days left`;
  document.getElementById('dpPredVol').textContent     = (predQty/1000).toFixed(2) + ' ' + bizVolUnitAbbr(dashboardBizType());
  document.getElementById('dpActualMPK').textContent   = actualMPK ? '₹ ' + actualMPK.toFixed(2) : '—';
  document.getElementById('dpPredMPK').textContent     = predMPK   ? '₹ ' + predMPK.toFixed(2)   : '—';
  document.getElementById('dpProgressBar').style.width = pct + '%';
  document.getElementById('dpProgressLabel').textContent = `${daysElapsed} of ${daysInMonth} days elapsed (${pct}%)  •  ${daysRemaining} days remaining`;
  document.getElementById('dashPredLabel').textContent = `Based on ${daysRecorded}-day average`;
}

function _renderDashTrend(data) {
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const prevDate  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

  const curr = data.monthly.find(m => m.month === thisMonth);
  const prev = data.monthly.find(m => m.month === prevMonth);
  const el   = document.getElementById('dashTrend');

  if (!curr || !prev || !parseFloat(prev.avg_mpk)) {
    el.textContent = 'Trend: Not enough data to compare months.';
    el.className   = 'dash-trend';
    return;
  }

  const c = parseFloat(curr.avg_mpk), p = parseFloat(prev.avg_mpk);
  const pct = Math.abs((c - p) / p * 100).toFixed(1);

  // MPK is cost per kg — LOWER is better. A drop = improving, a rise = worsening.
  if (c < p) {
    el.textContent = `This month vs last month: MPK ↓ ${pct}% (improving)`;
    el.className   = 'dash-trend up';    // green
  } else if (c > p) {
    el.textContent = `This month vs last month: MPK ↑ ${pct}% (worsening)`;
    el.className   = 'dash-trend down';  // red
  } else {
    el.textContent = `This month vs last month: MPK unchanged`;
    el.className   = 'dash-trend';
  }
}

function setChartView(view) {
  _dashView = view;
  document.getElementById('btnDaily').classList.toggle('active', view === 'daily');
  document.getElementById('btnMonthly').classList.toggle('active', view === 'monthly');
  document.getElementById('dashBarSection').style.display = view === 'monthly' ? '' : 'none';
  document.getElementById('dashChartTitle').textContent   = view === 'daily' ? 'Daily MPK' : 'Monthly Avg MPK';
  _renderLineChart();
  if (view === 'monthly') _renderBarChart();
}

function _renderLineChart() {
  if (!_dashData) return;
  if (_dashLine) { _dashLine.destroy(); _dashLine = null; }

  // Use filtered daily data for daily view
  const filteredDaily = _dashData.daily.filter(r => {
    if (_dashFromDate && r.date < _dashFromDate) return false;
    if (_dashToDate   && r.date > _dashToDate)   return false;
    return true;
  });

  const ctx = document.getElementById('dashLineChart').getContext('2d');
  const fmtLabel = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const labels = _dashView === 'daily'
    ? filteredDaily.map(r => fmtLabel(r.date))
    : _dashData.monthly.map(m => m.month);
  const values = _dashView === 'daily'
    ? filteredDaily.map(r => parseFloat(r.mpk))
    : _dashData.monthly.map(m => parseFloat(m.avg_mpk));

  const _du = bizUnitAbbr(dashboardBizType());
  _dashLine = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `MPK (₹/${_du})`,
        data: values,
        borderColor: '#1e6b45',
        backgroundColor: 'rgba(30,107,69,.09)',
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: '#1e6b45',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false,
          callbacks: { label: ctx => '₹ ' + ctx.parsed.y.toFixed(2) + ' / ' + _du }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 11 }, maxTicksLimit: 14 } },
        y: { grid: { color: 'rgba(0,0,0,.04)' },
             ticks: { font: { size: 11 }, callback: v => '₹' + v.toFixed(1) } }
      }
    }
  });
}

function _renderBarChart() {
  if (!_dashData) return;
  if (_dashBar) { _dashBar.destroy(); _dashBar = null; }

  const ctx = document.getElementById('dashBarChart').getContext('2d');
  const months = _dashData.monthly;

  _dashBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.month),
      datasets: [
        { label: 'Prod. Attendance Cost', data: months.map(m => parseFloat(m.avg_attendance_cost)),
          backgroundColor: '#1e6b45', borderRadius: 4 },
        { label: `Per ${bizUnitWord(dashboardBizType())} Cost`, data: months.map(m => parseFloat(m.avg_kg_cost)),
          backgroundColor: '#3aaa6b', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: { mode: 'index',
          callbacks: { label: ctx => ctx.dataset.label + ': ₹' + ctx.parsed.y.toFixed(2) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,.04)' },
             ticks: { font: { size: 11 }, callback: v => '₹' + v.toFixed(0) } }
      }
    }
  });
}

function _renderDashTable(data) {
  const tbody = document.getElementById('dashTableBody');
  const rows  = [...data.daily].reverse();
  { const h = document.getElementById('histKgCostHeader'); if (h) h.textContent = `Per ${bizUnitWord(dashboardBizType())} Cost`; }
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:28px">No records yet.</td></tr>';
    return;
  }
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  tbody.innerHTML = rows.map((r, i) => `
    <tr class="${i % 2 === 1 ? 'dash-row-alt' : ''}">
      <td>${fmt(r.date)}</td>
      <td class="r">₹ ${parseFloat(r.attendance_cost).toFixed(2)}</td>
      <td class="r">₹ ${parseFloat(r.kg_cost).toFixed(2)}</td>
      <td class="r">₹ ${parseFloat(r.total_cost).toFixed(2)}</td>
      <td class="r">${parseFloat(r.sale_qty || 0).toFixed(0)} ${bizUnitAbbr(dashboardBizType())}</td>
      <td class="r">₹ ${parseFloat(r.mpk).toFixed(2)}</td>
      <td class="r">
        ${currentRole === 'superadmin' ? `<button class="dash-row-del" onclick="dashDeleteRecord('${r.date}')">🗑 Delete</button>` : ''}
      </td>
    </tr>`).join('');
}

async function dashDeleteRecord(date) {
  if (!confirm(`Delete record for ${date}? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/records/${date}`);
    showToast(`Record for ${date} deleted`);
    await loadDashboard();
  } catch (e) {
    showToast(e.message, true);
  }
}

