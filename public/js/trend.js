/* ═══════════════════════════════════════════════════════
   COST TREND — per-plant MPK across the last 3 months, with
   the current (in-progress) month projected to month-end using
   the same daily-average method as the Report tab.
═══════════════════════════════════════════════════════ */

let trendBizType = '';
let _trendChart = null;
let _trendMpkChart = null;
let _trendData = null;

function openTrend() {
  document.getElementById('trendOverlay').style.display = 'flex';
  loadTrendView();
}
function closeTrend() {
  const el = document.getElementById('trendOverlay');
  if (el) el.style.display = 'none';
}

async function loadTrendView() {
  const el = document.getElementById('trendContent');
  if (!el) return;
  // Same fix as Report/Dashboard Compare chips — don't fall back to the old
  // value once the chip row exists; an empty value there is a deliberate "All".
  if (document.getElementById('trendBizType')) trendBizType = bizChipValue('trendBizType');
  const bizWrap = document.getElementById('trendBizTypeWrap');
  if (bizWrap) bizWrap.innerHTML = bizChipsHTML('trendBizType', trendBizType, 'loadTrendView');
  el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Loading…</p>';
  try {
    const btParam = trendBizType ? `?businessType=${encodeURIComponent(trendBizType)}` : '';
    const data = await api('GET', `/api/records/trend${btParam}`);
    if (!data.rows || !data.rows.length) {
      el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No records found.</p>';
      return;
    }
    _trendData = data;
    _renderTrendView(data);
  } catch (e) {
    el.innerHTML = `<p style="color:#c00;text-align:center;padding:20px">⚠ ${e.message}</p>`;
  }
}

// Ordinary least-squares fit of y = slope*x + intercept over points [{x,y}, ...].
// Also returns r2 (0-1): how much of the day-to-day variation in y the line actually
// explains. High r2 = the days trace a real trend; low r2 = they're too scattered/noisy
// for a straight line to mean much, even with plenty of data points behind it.
function _linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  points.forEach(({ x, y }) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null; // all x identical — can't fit a line
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const predict = x => slope * x + intercept;

  const meanY = sumY / n;
  let ssRes = 0, ssTot = 0;
  points.forEach(({ x, y }) => {
    ssRes += (y - predict(x)) ** 2;
    ssTot += (y - meanY) ** 2;
  });
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null; // null when every y is identical (undefined R²)

  return { slope, intercept, predict, r2, n };
}

function _daysBetweenISO(a, b) { return (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000; }

// Fits the trend on WEEKLY total cost, not raw daily cost — bucketing days into weeks
// first averages out day-to-day noise (staffing swings, one-off vendor deliveries,
// weekday/weekend effects) so the regression can see an underlying trend that's often
// invisible at the single-day level. x = week index since the plant's first recorded
// day, y = that week's summed cost. The current month is then predicted by evaluating
// the fitted weekly line at each of its days (spread evenly across the week) and summing.
function _fitWeeklySeries(dailyList, currentMonth, daysInCurrentMonth) {
  const sorted = [...dailyList].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { r2: null, weeksUsed: 0, predictedCost: null };
  const firstDate = sorted[0].date;

  const weekBuckets = {};
  sorted.forEach(d => {
    const wIdx = Math.floor(_daysBetweenISO(firstDate, d.date) / 7);
    weekBuckets[wIdx] = (weekBuckets[wIdx] || 0) + d.cost;
  });
  const fitPoints = Object.entries(weekBuckets)
    .map(([wIdx, cost]) => ({ x: +wIdx, y: cost }))
    .sort((a, b) => a.x - b.x);
  const fit = _linearRegression(fitPoints);

  let predictedCost = null;
  if (fit) {
    const [cy, cm] = currentMonth.split('-').map(Number);
    let sum = 0;
    for (let i = 0; i < daysInCurrentMonth; i++) {
      const d = new Date(cy, cm - 1, 1 + i);
      const dateISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const wIdxContinuous = _daysBetweenISO(firstDate, dateISO) / 7;
      sum += fit.predict(wIdxContinuous) / 7;
    }
    predictedCost = sum;
  }
  return { r2: fit ? fit.r2 : null, weeksUsed: fitPoints.length, predictedCost };
}

// metric selects which cost field drives everything below — 'total' (attendance + kg),
// 'attendance' (labor cost, usually steadier), or 'kg' (vendor/produce cost, usually the
// volatile one). Splitting them lets one component read as a real trend even when the
// blended total looks scattered, since the two behave very differently day to day.
// Shown as a breakdown alongside the Total prediction, not as separate tables — all
// three numbers need to sit next to each other to actually be comparable.
function _costField(r, metric) {
  if (metric === 'attendance') return parseFloat(r.attendance_cost) || 0;
  if (metric === 'kg')         return parseFloat(r.kg_cost) || 0;
  return parseFloat(r.total_cost) || 0;
}

// A weak/noisy regression can extrapolate something wildly out of step with reality —
// e.g. predicting a 35% drop off a plant's own last full month with no real basis for
// it. Clamp the prediction to a plausible band around the most recent complete month's
// actual (here, ±40%) so a shaky fit can influence the DIRECTION of the forecast but
// can't run away with an implausible number. Flags when the clamp actually kicked in.
function _clampToPlausible(predicted, lastActual) {
  if (predicted == null) return { value: null, clamped: false };
  if (lastActual == null || lastActual <= 0) return { value: predicted, clamped: false };
  const lo = lastActual * 0.6, hi = lastActual * 1.4;
  if (predicted < lo) return { value: lo, clamped: true };
  if (predicted > hi) return { value: hi, clamped: true };
  return { value: predicted, clamped: false };
}

function _fitMetric(dailyRows, monthKeys, currentMonth, daysInCurrentMonth, metric) {
  const daily = dailyRows.map(r => ({ date: r.date, cost: _costField(r, metric) }));
  const { r2, weeksUsed, predictedCost } = _fitWeeklySeries(daily, currentMonth, daysInCurrentMonth);
  return { r2, weeksUsed, predictedCost };
}

// Group the backend's flat rows into per-plant data: actual monthly cost for the last
// 3 months (Jul/Aug/Sept-MTD), PLUS a weekly trend fit across every complete day of each
// plant's recorded history before this month, extrapolated across the current month's
// days to predict its cost — independent of how much of the current month is filled in.
// Fits Total, Attendance and Per-KG cost together per plant so they can sit side by side
// in one table instead of three separate views.
function _computeTrend(data) {
  const byPlant = {};
  data.rows.forEach(r => {
    if (!byPlant[r.name]) byPlant[r.name] = { businessType: r.business_type, months: {}, daily: [] };
    byPlant[r.name].months[r.month] = {
      total: parseFloat(r.total_cost) || 0,
      attendance: parseFloat(r.attendance_cost) || 0,
      kg: parseFloat(r.kg_cost) || 0,
      qty: parseFloat(r.total_qty) || 0,
      days: parseInt(r.days) || 0,
    };
  });
  (data.daily || []).forEach(r => {
    if (!byPlant[r.name]) byPlant[r.name] = { businessType: null, months: {}, daily: [] };
    byPlant[r.name].daily.push(r);
  });

  // Last 3 calendar months ending at data.currentMonth (e.g. Jul, Aug, Sep)
  const [cy, cm] = data.currentMonth.split('-').map(Number);
  const monthKeys = [2, 1, 0].map(back => {
    const d = new Date(cy, cm - 1 - back, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  });
  const monthLabels = monthKeys.map(k => {
    const [y, m] = k.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  });
  const lastCompleteMonthKey = monthKeys[monthKeys.length - 2]; // e.g. Aug, when current is Sept

  const plants = Object.entries(byPlant).map(([name, p]) => {
    const points = monthKeys.map(mk => {
      const m = p.months[mk];
      const mpk = m && m.qty > 0 ? m.total / m.qty : null;
      return { month: mk, cost: m ? m.total : null, qty: m ? m.qty : null, mpk, days: m ? m.days : 0, isCurrent: mk === data.currentMonth };
    });
    const lastActual = p.months[lastCompleteMonthKey];

    const totalFit = _fitMetric(p.daily, monthKeys, data.currentMonth, data.daysInCurrentMonth, 'total');
    const attFit    = _fitMetric(p.daily, monthKeys, data.currentMonth, data.daysInCurrentMonth, 'attendance');
    const kgFit      = _fitMetric(p.daily, monthKeys, data.currentMonth, data.daysInCurrentMonth, 'kg');
    const qtyDaily   = p.daily.map(r => ({ date: r.date, cost: parseFloat(r.sale_qty) || 0 }));
    const qtyFit     = _fitWeeklySeries(qtyDaily, data.currentMonth, data.daysInCurrentMonth);

    const totalClamp = _clampToPlausible(totalFit.predictedCost, lastActual ? lastActual.total : null);
    const attClamp    = _clampToPlausible(attFit.predictedCost,    lastActual ? lastActual.attendance : null);
    const kgClamp      = _clampToPlausible(kgFit.predictedCost,      lastActual ? lastActual.kg : null);
    const qtyClamp      = _clampToPlausible(qtyFit.predictedCost,      lastActual ? lastActual.qty : null);

    const predictedMPK = totalClamp.value != null && qtyClamp.value > 0 ? totalClamp.value / qtyClamp.value : null;

    return {
      name, businessType: p.businessType, points,
      predictedCost: totalClamp.value, predictedClamped: totalClamp.clamped,
      predictedAttendance: attClamp.value, predictedAttendanceClamped: attClamp.clamped,
      predictedKg: kgClamp.value, predictedKgClamped: kgClamp.clamped,
      predictedQty: qtyClamp.value, predictedMPK,
      weeksUsed: totalFit.weeksUsed, r2: totalFit.r2,
      // Last complete month's actuals, for a "vs last month" % badge next to each
      // predicted number — without these there's nothing to judge the prediction against.
      lastMonthTotal: lastActual ? lastActual.total : null,
      lastMonthAttendance: lastActual ? lastActual.attendance : null,
      lastMonthKg: lastActual ? lastActual.kg : null,
    };
  });

  // Company-wide Total is a SUM of the individually-fitted (and clamped) plant
  // predictions, not its own separate regression. Fitting a trend directly on the
  // combined series breaks whenever plants have different amounts of history (e.g. Rai
  // has 14 weeks, everyone else has 9) — the early weeks are really just Rai's cost
  // alone, so the combined series has an artificial step-change the moment the other
  // plants' data starts, which isn't a real trend and makes that fit meaningless.
  // Summing already-reliable per-plant numbers sidesteps that entirely and keeps Total
  // mathematically consistent with its parts.
  // MPK isn't additive across plants — Total's MPK for any month has to be recomputed
  // as (summed cost) / (summed qty), not an average of the individual plants' MPKs.
  const totalPoints = monthKeys.map(mk => {
    let costSum = null, qtySum = null;
    plants.forEach(p => {
      const pt = p.points.find(x => x.month === mk);
      if (pt && pt.cost != null) costSum = (costSum || 0) + pt.cost;
      if (pt && pt.qty  != null) qtySum  = (qtySum  || 0) + pt.qty;
    });
    return { month: mk, cost: costSum, qty: qtySum, mpk: qtySum > 0 ? costSum / qtySum : null, isCurrent: mk === data.currentMonth };
  });
  const sumField = key => { let s = null; plants.forEach(p => { if (p[key] != null) s = (s || 0) + p[key]; }); return s; };
  const predictedTotalCost = sumField('predictedCost');
  const predictedTotalQty  = sumField('predictedQty');
  const total = {
    name: 'Total', points: totalPoints,
    predictedCost: predictedTotalCost,
    predictedAttendance: sumField('predictedAttendance'),
    predictedKg: sumField('predictedKg'),
    predictedQty: predictedTotalQty,
    predictedMPK: predictedTotalQty > 0 && predictedTotalCost != null ? predictedTotalCost / predictedTotalQty : null,
    predictedClamped: plants.some(p => p.predictedClamped),
    predictedAttendanceClamped: plants.some(p => p.predictedAttendanceClamped),
    predictedKgClamped: plants.some(p => p.predictedKgClamped),
    weeksUsed: null, r2: null,
    lastMonthTotal: sumField('lastMonthTotal'),
    lastMonthAttendance: sumField('lastMonthAttendance'),
    lastMonthKg: sumField('lastMonthKg'),
  };

  return { monthKeys, monthLabels, plants, total };
}

function _renderTrendView(data) {
  const { monthLabels, plants, total } = _computeTrend(data);
  const sub = document.getElementById('trendSubLabel');
  if (sub) sub.textContent = `Predicted ${monthLabels[monthLabels.length - 1]} cost is a WEEKLY trend fit across every complete week of each plant's recorded history before this month, extrapolated forward — capped to within ±40% of last month's actual so a shaky fit can't run away with an implausible number. Values in ₹ Lakhs.`;

  const L = n => n / 1e5; // rupees -> lakhs

  const palette = ['#0f766e', '#c2410c', '#7c3aed', '#0369a1', '#be123c', '#65a30d', '#0891b2', '#a21caf'];
  // One dataset per plant — Jul/Aug actual plus a single Sept value (predicted, or
  // actual once it's in) — so each plant gets exactly one legend entry. The Sept
  // point is drawn larger/diamond so it reads as "different" without a second series.
  // Total is charted too, styled distinctly (thicker, dashed grey) so it reads as a
  // sum rather than another plant.
  const chartPlants = [...plants, { ...total, isTotal: true }];
  const datasets = chartPlants.map((p, i) => {
    const color = p.isTotal ? '#475569' : palette[i % palette.length];
    const sept = p.points[p.points.length - 1];
    const septVal = sept.cost != null ? L(sept.cost) : (p.predictedCost != null ? L(p.predictedCost) : null);
    const data = [...p.points.slice(0, -1).map(pt => pt.cost != null ? L(pt.cost) : null), septVal];
    const isPredictedPoint = sept.cost == null && p.predictedCost != null;
    return {
      label: p.name,
      data,
      borderColor: color,
      backgroundColor: color,
      spanGaps: true,
      tension: 0.25,
      borderWidth: p.isTotal ? 3 : 2,
      borderDash: p.isTotal ? [6, 3] : undefined,
      pointRadius: data.map((_, idx) => idx === data.length - 1 && isPredictedPoint ? 7 : 3),
      pointStyle: data.map((_, idx) => idx === data.length - 1 && isPredictedPoint ? 'rectRot' : 'circle'),
      segment: isPredictedPoint ? { borderDash: ctx => ctx.p1DataIndex === data.length - 1 ? [5, 4] : (p.isTotal ? [6, 3] : undefined) } : undefined,
    };
  });

  const chartHTML = '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px"><canvas id="trendChart" height="90"></canvas></div>';

  // One table, plant names across the top (same layout as the Report tab) plus a
  // Total column, metrics running down — actual months, actual MTD, predicted,
  // weeks the fit is based on, then trend quality.
  const currentLabel = monthLabels[monthLabels.length - 1];
  const tableCols = [...plants, total];
  const head = `<th>Metric</th>` + tableCols.map(p => `<th${p.name === 'Total' ? ' class="rep-total-col"' : ''}>${p.name}</th>`).join('');

  const row = (label, cellFn) =>
    `<tr><td class="rep-metric-name">${label}</td>` +
    tableCols.map(p => `<td${p.name === 'Total' ? ' class="rep-total-col"' : ''}>${cellFn(p)}</td>`).join('') + `</tr>`;

  const monthRows = monthLabels.slice(0, -1).map((label, idx) =>
    row(label, p => { const v = p.points[idx].cost; return v != null ? '₹' + L(v).toFixed(2) + ' L' : '—'; })
  ).join('');

  const mtdRow = row(`${currentLabel} (MTD)`, p => {
    const v = p.points[p.points.length - 1].cost;
    return v != null ? '₹' + L(v).toFixed(2) + ' L' : '<span style="color:var(--muted)">No data yet</span>';
  });

  const clampIcon = clamped => clamped
    ? ` <span style="color:#92400e;cursor:help" title="Raw trend fit was too far from last month's actual to be plausible — capped to a realistic range">⚠</span>`
    : '';

  // % change vs the last complete month — without this there's nothing to judge
  // whether a predicted number is actually good or bad news. Same up/down coloring
  // as the Report tab's MPK Change badge.
  function _changeBadge(predicted, lastActual) {
    if (predicted == null || lastActual == null || lastActual <= 0) return '';
    const pct = ((predicted - lastActual) / lastActual) * 100;
    const color = pct > 0 ? '#991b1b' : pct < 0 ? '#166534' : 'var(--muted)';
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
    return `<span style="font-weight:700;color:${color}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% ${arrow}</span>`;
  }

  // Each predicted metric gets its OWN row for the ₹ value and a SEPARATE row for its
  // "vs last month" % — same pattern the Report tab already uses (Avg MPK row, then a
  // distinct MPK Change row), rather than packing both into one cell.
  const predAttRow = row(`Predicted Attendance Cost`, p =>
    p.predictedAttendance != null
      ? `₹${L(p.predictedAttendance).toFixed(2)} L${clampIcon(p.predictedAttendanceClamped)}`
      : '<span style="color:var(--muted)">—</span>'
  );
  const attChangeRow = row(`— vs Aug`, p => _changeBadge(p.predictedAttendance, p.lastMonthAttendance) || '<span style="color:var(--muted)">—</span>');

  const predKgRow = row(`Predicted Per-KG Cost`, p =>
    p.predictedKg != null
      ? `₹${L(p.predictedKg).toFixed(2)} L${clampIcon(p.predictedKgClamped)}`
      : '<span style="color:var(--muted)">—</span>'
  );
  const kgChangeRow = row(`— vs Aug`, p => _changeBadge(p.predictedKg, p.lastMonthKg) || '<span style="color:var(--muted)">—</span>');

  const predTotalRow = row(`Predicted Total Cost`, p =>
    p.predictedCost != null
      ? `<span style="color:var(--primary);font-weight:700">₹${L(p.predictedCost).toFixed(2)} L</span>${clampIcon(p.predictedClamped)}`
      : '<span style="color:var(--muted)">—</span>'
  );
  const totalChangeRow = row(`— vs Aug`, p => _changeBadge(p.predictedCost, p.lastMonthTotal) || '<span style="color:var(--muted)">—</span>');

  const weeksRow = row('Weeks Used', p => p.weeksUsed > 0 ? `${p.weeksUsed} week(s)` : '<span style="color:var(--muted)">—</span>');

  // R² tells you whether a plant's recorded daily costs actually trace a real trend
  // or are just scattered/noisy — closer to 1 means the prediction above is riding a
  // real pattern; closer to 0 means treat that prediction with real caution.
  function _r2Cell(r2) {
    if (r2 == null) return '<span style="color:var(--muted)">—</span>';
    let label, color;
    if (r2 >= 0.5)      { label = 'Consistent';  color = '#166534'; }
    else if (r2 >= 0.2) { label = 'Weak';         color = '#92400e'; }
    else                { label = 'Scattered';    color = '#991b1b'; }
    return `<span style="font-weight:700;color:${color}">${label} (${r2.toFixed(2)})</span>`;
  }
  const trendRow = row('Trend Quality (R²)', p => _r2Cell(p.r2));

  const tableHTML = `<div class="rep-table-wrap"><table class="rep-table" style="font-size:15px">
    <thead><tr>${head}</tr></thead>
    <tbody>${monthRows}${mtdRow}${predAttRow}${attChangeRow}${predKgRow}${kgChangeRow}${predTotalRow}${totalChangeRow}${weeksRow}${trendRow}</tbody>
  </table></div>
  <p style="font-size:13px;color:var(--muted);margin-top:10px;line-height:1.5">
    <strong>Trend Quality (R²)</strong> shows how well a straight line actually fits each plant's week-by-week cost history (0 to 1).
    <strong style="color:#166534">Consistent</strong> means cost has been moving steadily in one direction, so the prediction above is likely meaningful.
    <strong style="color:#991b1b">Scattered</strong> means the weeks bounce around too much for a straight-line trend to mean much — treat that plant's prediction as a rough guess, not a forecast.
  </p>`;

  // ── MPK section — same layout, same plants/Total columns, but cost-per-kg instead
  // of total ₹. Predicted MPK = predicted total cost ÷ predicted quantity (not a
  // separate regression on MPK itself, since MPK is a ratio, not something that
  // accumulates the way cost does).
  const mpkDatasets = chartPlants.map((p, i) => {
    const color = p.isTotal ? '#475569' : palette[i % palette.length];
    const sept = p.points[p.points.length - 1];
    const septVal = sept.mpk != null ? sept.mpk : (p.predictedMPK != null ? p.predictedMPK : null);
    const dat = [...p.points.slice(0, -1).map(pt => pt.mpk != null ? pt.mpk : null), septVal];
    const isPredictedPoint = sept.mpk == null && p.predictedMPK != null;
    return {
      label: p.name,
      data: dat,
      borderColor: color,
      backgroundColor: color,
      spanGaps: true,
      tension: 0.25,
      borderWidth: p.isTotal ? 3 : 2,
      borderDash: p.isTotal ? [6, 3] : undefined,
      pointRadius: dat.map((_, idx) => idx === dat.length - 1 && isPredictedPoint ? 7 : 3),
      pointStyle: dat.map((_, idx) => idx === dat.length - 1 && isPredictedPoint ? 'rectRot' : 'circle'),
      segment: isPredictedPoint ? { borderDash: ctx => ctx.p1DataIndex === dat.length - 1 ? [5, 4] : (p.isTotal ? [6, 3] : undefined) } : undefined,
    };
  });
  const mpkChartHTML = '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin:24px 0 16px"><canvas id="trendMpkChart" height="90"></canvas></div>';

  const mpkMonthRows = monthLabels.slice(0, -1).map((label, idx) =>
    row(label, p => { const v = p.points[idx].mpk; return v != null ? '₹' + v.toFixed(2) : '—'; })
  ).join('');
  const mpkMtdRow = row(`${currentLabel} (MTD)`, p => {
    const v = p.points[p.points.length - 1].mpk;
    return v != null ? '₹' + v.toFixed(2) : '<span style="color:var(--muted)">No data yet</span>';
  });
  const mpkPredRow = row(`Predicted ${currentLabel} MPK`, p =>
    p.predictedMPK != null
      ? `<span style="color:var(--primary);font-weight:700">₹${p.predictedMPK.toFixed(2)}</span>`
      : '<span style="color:var(--muted)">—</span>'
  );
  const mpkChangeRow = row(`— vs Aug`, p => {
    const lastMonthMPK = p.points[p.points.length - 2]?.mpk ?? null;
    return _changeBadge(p.predictedMPK, lastMonthMPK) || '<span style="color:var(--muted)">—</span>';
  });

  const mpkTableHTML = `<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">Cost Per Kg (MPK)</div>
  <div class="rep-table-wrap"><table class="rep-table" style="font-size:15px">
    <thead><tr>${head}</tr></thead>
    <tbody>${mpkMonthRows}${mpkMtdRow}${mpkPredRow}${mpkChangeRow}</tbody>
  </table></div>`;

  document.getElementById('trendContent').innerHTML = chartHTML + tableHTML + mpkChartHTML + mpkTableHTML;

  if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
  const ctx = document.getElementById('trendChart').getContext('2d');
  _trendChart = new Chart(ctx, {
    type: 'line',
    data: { labels: monthLabels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { title: { display: true, text: 'Total Cost (₹ Lakhs)' } } },
    },
  });

  if (_trendMpkChart) { _trendMpkChart.destroy(); _trendMpkChart = null; }
  const mpkCtx = document.getElementById('trendMpkChart').getContext('2d');
  _trendMpkChart = new Chart(mpkCtx, {
    type: 'line',
    data: { labels: monthLabels, datasets: mpkDatasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { title: { display: true, text: 'MPK (₹/kg)' } } },
    },
  });
}

document.addEventListener('click', function(e) {
  const dd = document.getElementById('exportDd');
  if (dd && !dd.contains(e.target)) {
    document.getElementById('exportDdMenu').classList.remove('open');
  }
});

async function exportMonthRecords() {
  if (typeof XLSX === 'undefined') {
    alert('SheetJS library not loaded — check your internet connection and reload the page.');
    return;
  }
  const d = new Date();
  const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const month = prompt('Enter month to export (YYYY-MM):', ym);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) { showToast('⚠ Invalid month format. Use YYYY-MM.', true); return; }
  showToast('⏳ Fetching records for ' + month + '…', false);
  try {
    const pid = currentPlantId || activePlantId;
    if (pid) {
      const all = await api('GET', '/api/records/export');
      const records = all.filter(r => {
        const rd = typeof r.record_date === 'string' ? r.record_date.slice(0, 7) : '';
        return rd === month;
      });
      if (!records.length) { showToast('⚠ No records found for ' + month, true); return; }
      _writeSinglePlantWorkbook(records, bizUnitAbbr(activePlantBizType()), _exportScopeTag() + '_MPK_' + month + '.xlsx');
      showToast('✓ Exported ' + records.length + ' record(s) for ' + month, false);
    } else {
      const btQs = activeBizType ? '&businessType=' + encodeURIComponent(activeBizType) : '';
      const records = await api('GET', '/api/records/export-all?month=' + month + btQs);
      if (!records.length) { showToast('⚠ No records found for ' + month, true); return; }
      _writeMultiPlantWorkbook(records, _exportScopeTag() + '_MPK_' + month + '.xlsx');
      showToast('✓ Exported ' + records.length + ' record(s) across plants for ' + month, false);
    }
  } catch (e) {
    showToast('⚠ Export failed: ' + e.message, true);
  }
}

// Shared workbook builders for detail exports — single-plant (no Plant column) and
// multi-plant (rows tagged with each record's Plant) — used by every export function.
function _writeSinglePlantWorkbook(records, _u, filename) {
  const summaryRows = [['Date','Production Attendance Cost','Per KG Cost','Total Cost',`Sale Qty (${_u})`,'MPK','Last Saved By']];
  const attRows     = [['Date','Contractor','Workers','Cost (₹)']];
  const kgRows      = [['Date','Vendor','SKU',`Rate (₹/${_u})`,`Qty (${_u})`,'Cost (₹)']];
  for (const detail of records) {
    const dateStr = typeof detail.record_date === 'string' ? detail.record_date.slice(0, 10) : detail.record_date;
    const xd = xlDate(dateStr);
    summaryRows.push([xd,
      r2(parseFloat(detail.attendance_cost)||0), r2(parseFloat(detail.kg_cost)||0),
      r2(parseFloat(detail.total_cost)||0), parseFloat(detail.sale_qty)||0,
      parseFloat(detail.mpk)>0 ? r2(parseFloat(detail.mpk)) : '',
      detail.updated_by || '']);
    (detail.attendance||[]).forEach(a => {
      attRows.push([xd, a.contractor_name, a.workers||0, parseFloat(a.cost)||0]);
    });
    (detail.kgEntries||[]).forEach(e => {
      if (e.sku_name==='__UNLOADING__') kgRows.push([xd, e.vendor_name, 'Unloading Cost', '', '', r2(parseFloat(e.cost)||0)]);
      else kgRows.push([xd, e.vendor_name, e.sku_name, parseFloat(e.rate)||0, parseFloat(e.qty)||0, r2(parseFloat(e.cost)||0)]);
    });
  }
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows, {cellDates:true}); ws1['!cols']=[12,22,14,12,14,10,16].map(w=>({wch:w}));
  const ws2 = XLSX.utils.aoa_to_sheet(attRows,     {cellDates:true}); ws2['!cols']=[12,32,10,12].map(w=>({wch:w}));
  const ws3 = XLSX.utils.aoa_to_sheet(kgRows,      {cellDates:true}); ws3['!cols']=[12,20,28,12,10,12].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
  XLSX.utils.book_append_sheet(wb, ws2, 'Attendance Detail');
  XLSX.utils.book_append_sheet(wb, ws3, 'KG Detail');
  XLSX.writeFile(wb, filename);
}

function _writeMultiPlantWorkbook(records, filename) {
  const summaryRows = [['Plant','Business Type','Date','Production Attendance Cost','Per-Unit Cost','Total Cost','Sale Qty','MPK','Last Saved By']];
  const attRows     = [['Plant','Date','Contractor','Workers','Cost (₹)']];
  const kgRows      = [['Plant','Date','Vendor','SKU','Rate (₹)','Qty','Cost (₹)']];

  let grandCost = 0, grandQty = 0;
  for (const detail of records) {
    const dateStr = typeof detail.record_date === 'string' ? detail.record_date.slice(0, 10) : detail.record_date;
    const xd = xlDate(dateStr);
    const plant = detail.plant_name || '';
    const totalCost = parseFloat(detail.total_cost) || 0;
    const saleQty   = parseFloat(detail.sale_qty) || 0;
    grandCost += totalCost; grandQty += saleQty;
    summaryRows.push([plant, detail.business_type || '', xd,
      r2(parseFloat(detail.attendance_cost)||0), r2(parseFloat(detail.kg_cost)||0),
      r2(totalCost), saleQty,
      parseFloat(detail.mpk)>0 ? r2(parseFloat(detail.mpk)) : '',
      detail.updated_by || '']);
    (detail.attendance||[]).forEach(a => {
      attRows.push([plant, xd, a.contractor_name, a.workers||0, parseFloat(a.cost)||0]);
    });
    (detail.kgEntries||[]).forEach(e => {
      if (e.sku_name==='__UNLOADING__') kgRows.push([plant, xd, e.vendor_name, 'Unloading Cost', '', '', r2(parseFloat(e.cost)||0)]);
      else kgRows.push([plant, xd, e.vendor_name, e.sku_name, parseFloat(e.rate)||0, parseFloat(e.qty)||0, r2(parseFloat(e.cost)||0)]);
    });
  }
  summaryRows.push(['TOTAL', '', '', '', '', r2(grandCost), grandQty,
    grandQty > 0 ? r2(grandCost/grandQty) : '', '']);

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows, {cellDates:true}); ws1['!cols']=[14,14,12,22,14,12,14,10,16].map(w=>({wch:w}));
  const ws2 = XLSX.utils.aoa_to_sheet(attRows,     {cellDates:true}); ws2['!cols']=[14,12,32,10,12].map(w=>({wch:w}));
  const ws3 = XLSX.utils.aoa_to_sheet(kgRows,      {cellDates:true}); ws3['!cols']=[14,12,20,28,12,10,12].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
  XLSX.utils.book_append_sheet(wb, ws2, 'Attendance Detail');
  XLSX.utils.book_append_sheet(wb, ws3, 'KG Detail');
  XLSX.writeFile(wb, filename);
}

// Superadmin, from the All Plants view: every plant's full daily detail for one
// month in a single workbook, each row tagged with its Plant name.
async function exportAllPlantsMonth() {
  if (typeof XLSX === 'undefined') {
    alert('SheetJS library not loaded — check your internet connection and reload the page.');
    return;
  }
  const d = new Date();
  const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const fromMonth = prompt('Export ALL plants — from which month? (YYYY-MM):', ym);
  if (!fromMonth || !/^\d{4}-\d{2}$/.test(fromMonth)) { showToast('⚠ Invalid month format. Use YYYY-MM.', true); return; }
  const toMonth = prompt('...to which month? (YYYY-MM, same as above for a single month):', fromMonth);
  if (!toMonth || !/^\d{4}-\d{2}$/.test(toMonth)) { showToast('⚠ Invalid month format. Use YYYY-MM.', true); return; }
  if (toMonth < fromMonth) { showToast('⚠ "To" month is before "from" month', true); return; }

  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  const from = `${fromMonth}-01`;
  const toLastDay = new Date(ty, tm, 0).getDate(); // 0th of next month = last day of this month
  const to = `${toMonth}-${String(toLastDay).padStart(2, '0')}`;
  const rangeLabel = fromMonth === toMonth ? fromMonth : `${fromMonth}_to_${toMonth}`;

  showToast('⏳ Fetching all plants’ records for ' + rangeLabel + '…', false);
  try {
    const btQs = activeBizType ? '&businessType=' + encodeURIComponent(activeBizType) : '';
    const records = await api('GET', `/api/records/export-all?from=${from}&to=${to}${btQs}`);
    if (!records.length) { showToast('⚠ No records found for ' + rangeLabel + ' across any plant', true); return; }

    _writeMultiPlantWorkbook(records, (activeBizType ? 'All-' + activeBizType : 'All-Businesses') + '_MPK_' + rangeLabel + '.xlsx');
    showToast('✓ Exported ' + records.length + ' record(s) across all plants for ' + rangeLabel, false);
  } catch (e) {
    showToast('⚠ Export failed: ' + e.message, true);
  }
}

async function exportAllRecords() {
  if (typeof XLSX === 'undefined') {
    alert('SheetJS library not loaded — check your internet connection and reload the page.');
    return;
  }
  showToast('⏳ Fetching all records…', false);
  try {
    const pid = currentPlantId || activePlantId;
    let records, isMultiPlant;
    if (pid) {
      records = await api('GET', '/api/records/export');
      isMultiPlant = false;
    } else {
      const btQs = activeBizType ? '?businessType=' + encodeURIComponent(activeBizType) : '';
      records = await api('GET', '/api/records/export-all' + btQs);
      isMultiPlant = true;
    }
    if (!records.length) { showToast('⚠ No records found.', true); return; }

    const _u = isMultiPlant ? 'unit' : bizUnitAbbr(activePlantBizType());
    const attTotals   = {};
    const vendorTotals = {};
    records.forEach(detail => {
      (detail.attendance || []).forEach(a => {
        if (!attTotals[a.contractor_name]) attTotals[a.contractor_name] = { days: 0, workers: 0, cost: 0 };
        attTotals[a.contractor_name].days    += 1;
        attTotals[a.contractor_name].workers += a.workers || 0;
        attTotals[a.contractor_name].cost    += parseFloat(a.cost) || 0;
      });
      (detail.kgEntries || []).forEach(e => {
        if (!vendorTotals[e.vendor_name]) vendorTotals[e.vendor_name] = { qty: 0, cost: 0 };
        if (e.sku_name === '__UNLOADING__') {
          vendorTotals[e.vendor_name].cost += parseFloat(e.cost) || 0;
        } else {
          vendorTotals[e.vendor_name].qty  += parseFloat(e.qty)  || 0;
          vendorTotals[e.vendor_name].cost += parseFloat(e.cost) || 0;
        }
      });
    });

    // Attendance summary (aggregated by contractor)
    const attSumRows = [['Contractor','No. of Days','Total Workers','Total Attendance Cost (₹)']];
    Object.entries(attTotals).sort((a,b) => b[1].cost - a[1].cost).forEach(([name, v]) => {
      attSumRows.push([name, v.days, v.workers, r2(v.cost)]);
    });
    attSumRows.push(['TOTAL', '', '', r2(Object.values(attTotals).reduce((s,v) => s+v.cost, 0))]);

    // KG vendor summary
    const kgSumRows = [['Vendor', `Total Qty Processed (${_u})`, 'Total Amount Paid (₹)']];
    Object.entries(vendorTotals).sort((a,b) => b[1].cost - a[1].cost).forEach(([name, v]) => {
      kgSumRows.push([name, r2(v.qty), r2(v.cost)]);
    });
    kgSumRows.push(['TOTAL', '', r2(Object.values(vendorTotals).reduce((s,v) => s+v.cost, 0))]);

    const wsAS = XLSX.utils.aoa_to_sheet(attSumRows); wsAS['!cols'] = [32,12,14,26].map(w=>({wch:w}));
    const wsKS = XLSX.utils.aoa_to_sheet(kgSumRows);  wsKS['!cols'] = [20,24,20].map(w=>({wch:w}));

    const filename = _exportScopeTag() + '_MPK_AllRecords.xlsx';
    let wb;
    if (isMultiPlant) {
      // Build the detail sheets via the shared multi-plant writer, then re-open
      // the resulting workbook to splice in the two summary sheets before saving once.
      wb = XLSX.utils.book_new();
      const summaryRows = [['Plant','Business Type','Date','Production Attendance Cost','Per-Unit Cost','Total Cost','Sale Qty','MPK','Last Saved By']];
      const attRows = [['Plant','Date','Contractor','Workers','Cost (₹)']];
      const kgRows  = [['Plant','Date','Vendor','SKU','Rate (₹)','Qty','Cost (₹)']];
      let grandCost = 0, grandQty = 0;
      records.forEach(detail => {
        const dateStr = typeof detail.record_date === 'string' ? detail.record_date.slice(0, 10) : detail.record_date;
        const xd = xlDate(dateStr);
        const plant = detail.plant_name || '';
        const totalCost = parseFloat(detail.total_cost) || 0;
        const saleQty   = parseFloat(detail.sale_qty) || 0;
        grandCost += totalCost; grandQty += saleQty;
        summaryRows.push([plant, detail.business_type || '', xd,
          r2(parseFloat(detail.attendance_cost)||0), r2(parseFloat(detail.kg_cost)||0),
          r2(totalCost), saleQty,
          parseFloat(detail.mpk)>0 ? r2(parseFloat(detail.mpk)) : '',
          detail.updated_by || '']);
        (detail.attendance||[]).forEach(a => attRows.push([plant, xd, a.contractor_name, a.workers||0, parseFloat(a.cost)||0]));
        (detail.kgEntries||[]).forEach(e => {
          if (e.sku_name==='__UNLOADING__') kgRows.push([plant, xd, e.vendor_name, 'Unloading Cost', '', '', r2(parseFloat(e.cost)||0)]);
          else kgRows.push([plant, xd, e.vendor_name, e.sku_name, parseFloat(e.rate)||0, parseFloat(e.qty)||0, r2(parseFloat(e.cost)||0)]);
        });
      });
      summaryRows.push(['TOTAL', '', '', '', '', r2(grandCost), grandQty, grandQty > 0 ? r2(grandCost/grandQty) : '', '']);
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows, {cellDates:true}); ws1['!cols']=[14,14,12,22,14,12,14,10,16].map(w=>({wch:w}));
      const wsAD = XLSX.utils.aoa_to_sheet(attRows, {cellDates:true}); wsAD['!cols']=[14,12,32,10,12].map(w=>({wch:w}));
      const wsKD = XLSX.utils.aoa_to_sheet(kgRows,  {cellDates:true}); wsKD['!cols']=[14,12,20,28,12,10,12].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, ws1,  'Daily Summary');
      XLSX.utils.book_append_sheet(wb, wsAD, 'Attendance Detail');
      XLSX.utils.book_append_sheet(wb, wsAS, 'Attendance Summary');
      XLSX.utils.book_append_sheet(wb, wsKD, 'KG Detail');
      XLSX.utils.book_append_sheet(wb, wsKS, 'KG Vendor Summary');
    } else {
      const summaryRows = [['Date','Production Attendance Cost','Per KG Cost','Total Cost',`Sale Qty (${_u})`,'MPK','Last Saved By']];
      const attRows = [['Date','Contractor','Workers','Cost (₹)']];
      const kgRows  = [['Date','Vendor','SKU',`Rate (₹/${_u})`,`Qty (${_u})`,'Cost (₹)']];
      records.forEach(detail => {
        const dateStr = typeof detail.record_date === 'string' ? detail.record_date.slice(0, 10) : detail.record_date;
        const xd = xlDate(dateStr);
        summaryRows.push([xd,
          r2(parseFloat(detail.attendance_cost)||0), r2(parseFloat(detail.kg_cost)||0),
          r2(parseFloat(detail.total_cost)||0), parseFloat(detail.sale_qty)||0,
          parseFloat(detail.mpk)>0 ? r2(parseFloat(detail.mpk)) : '',
          detail.updated_by || '']);
        (detail.attendance||[]).forEach(a => attRows.push([xd, a.contractor_name, a.workers||0, parseFloat(a.cost)||0]));
        (detail.kgEntries||[]).forEach(e => {
          if (e.sku_name==='__UNLOADING__') kgRows.push([xd, e.vendor_name, 'Unloading Cost', '', '', r2(parseFloat(e.cost)||0)]);
          else kgRows.push([xd, e.vendor_name, e.sku_name, parseFloat(e.rate)||0, parseFloat(e.qty)||0, r2(parseFloat(e.cost)||0)]);
        });
      });
      const ws1  = XLSX.utils.aoa_to_sheet(summaryRows, {cellDates:true}); ws1['!cols']  = [12,22,14,12,14,10,16].map(w=>({wch:w}));
      const wsAD = XLSX.utils.aoa_to_sheet(attRows,     {cellDates:true}); wsAD['!cols'] = [12,32,10,12].map(w=>({wch:w}));
      const wsKD = XLSX.utils.aoa_to_sheet(kgRows,      {cellDates:true}); wsKD['!cols'] = [12,20,28,12,10,12].map(w=>({wch:w}));
      wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1,  'Daily Summary');
      XLSX.utils.book_append_sheet(wb, wsAD, 'Attendance Detail');
      XLSX.utils.book_append_sheet(wb, wsAS, 'Attendance Summary');
      XLSX.utils.book_append_sheet(wb, wsKD, 'KG Detail');
      XLSX.utils.book_append_sheet(wb, wsKS, 'KG Vendor Summary');
    }
    XLSX.writeFile(wb, filename);
    showToast('✓ Exported ' + records.length + ' record' + (records.length === 1 ? '' : 's'), false);
  } catch (e) {
    showToast('⚠ Export failed: ' + e.message, true);
  }
}

async function downloadBackup() {
  showToast('⏳ Preparing backup…', false);
  try {
    const pid = currentPlantId || activePlantId;
    let records, scopeLabel;
    if (pid) {
      records = await api('GET', '/api/records/export');
      scopeLabel = currentPlantName || activePlantName;
    } else {
      const btQs = activeBizType ? '?businessType=' + encodeURIComponent(activeBizType) : '';
      records = await api('GET', '/api/records/export-all' + btQs);
      scopeLabel = activeBizType ? 'All ' + activeBizType + ' locations' : 'All businesses';
    }
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `${_exportScopeTag()}_Backup_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✓ Backup downloaded — ' + scopeLabel + ' (' + records.length + ' records)', false);
  } catch (e) {
    showToast('⚠ Backup failed: ' + e.message, true);
  }
}

