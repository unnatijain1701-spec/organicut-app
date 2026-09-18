/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */

async function loadSKURateOverrides() {
  try {
    const overrides = await api('GET', '/api/sku/rates');
    overrides.forEach(({ vendor_name, sku_index, rate }) => {
      if (SKU_CFG[vendor_name]?.[sku_index]) {
        SKU_CFG[vendor_name][sku_index][1] = parseFloat(rate);
      }
    });
  } catch (e) {
    console.error('Failed to load SKU rate overrides:', e.message);
  }
}

let PLANTS_BY_ID = {};

async function setupPlantSelector() {
  try {
    const plants = await fetch('/api/auth/plants', { credentials: 'include' }).then(r => r.json());
    PLANTS_BY_ID = Object.fromEntries(plants.map(p => [p.id, p]));
    if (currentPlantId) return; // locked-plant users don't get the selector, just the cache above
    renderPlantSelector(plants);
  } catch (e) {
    console.error('Failed to load plants:', e.message);
  }
}

// Populates the sidebar plant dropdown, limited to the active business scope.
function renderPlantSelector(plants) {
  plants = plants || Object.values(PLANTS_BY_ID);
  const scoped = activeBizType ? plants.filter(p => p.business_type === activeBizType) : plants;
  const sel = document.getElementById('plantSelector');
  sel.innerHTML = `<option value="">${activeBizType ? 'All ' + activeBizType + ' Locations' : 'All Plants'}</option>`;
  // Restore last selected plant from sessionStorage
  const saved = parseInt(sessionStorage.getItem('activePlantId'));
  if (saved && !activePlantId) {
    const match = scoped.find(p => p.id === saved);
    if (match) { activePlantId = saved; activePlantName = match.name; }
  }
  // Drop the active plant if it falls outside the current business scope
  if (activePlantId && !scoped.some(p => p.id === activePlantId)) {
    activePlantId = null; activePlantName = null;
    sessionStorage.removeItem('activePlantId');
  }
  if (activeBizType) {
    // Already scoped to one business — a flat list is clearer than a single optgroup
    scoped.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === activePlantId) opt.selected = true;
      sel.appendChild(opt);
    });
  } else {
    // Group by business type so the list stays navigable as locations grow
    const byType = {};
    const typeOrder = [];
    scoped.forEach(p => {
      const t = p.business_type || 'Other';
      if (!byType[t]) { byType[t] = []; typeOrder.push(t); }
      byType[t].push(p);
    });
    typeOrder.forEach(t => {
      const grp = document.createElement('optgroup');
      grp.label = t;
      byType[t].forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.id === activePlantId) opt.selected = true;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    });
  }
  document.getElementById('plantSelectorField').style.display = '';
  document.getElementById('bizSwitchField').style.display = '';
  document.getElementById('bizSwitchLabel').textContent = activeBizType || 'All Businesses';
  document.getElementById('userBadge').textContent =
    currentUsername + (activePlantId ? ' • ' + activePlantName
                                     : activeBizType ? ' • All ' + activeBizType : ' • All Plants');
}

/* ── Business type picker ───────────────────────────────── */
const BIZ_TYPES = [
  { key: 'FnV',        icon: '🥬', label: 'FnV' },
  { key: 'RTE',        icon: '🍱', label: 'RTE' },
  { key: 'Beverage',   icon: '🥤', label: 'Beverage' },
  { key: 'Coco-Sutra', icon: '🥥', label: 'Coco-Sutra' },
];

/* ── Unit-of-measure helpers — Beverage is litre-based, everything else is kg-based.
   Coco-Sutra operators enter a PIECE COUNT per SKU (via the case-size box below,
   repurposed as "grams per piece"), which auto-converts to kg — so the final
   Production Qty / MPK are weight-based here too, same as FnV. ── */
function bizUnitAbbr(businessType) { return businessType === 'Beverage' ? 'L' : 'kg'; }
function bizUnitWord(businessType) { return businessType === 'Beverage' ? 'Litres' : 'Kg'; }
function bizVolUnitAbbr(businessType) { return businessType === 'Beverage' ? 'KL' : 'MT'; }
// The case-size box's label: Coco-Sutra enters a piece count (converted via each
// SKU's per-piece weight); other case-priced businesses (e.g. Beverage cartons)
// enter a case count instead.
function caseInputWord(businessType) { return businessType === 'Coco-Sutra' ? 'Pieces' : 'Cases'; }
function bizMpkLabel(businessType) { return `MPK (₹/${bizUnitAbbr(businessType)})`; }
// Best-guess business type for the current single-plant context (Daily Entry, History, SKU panels)
function activePlantBizType() {
  const pid = currentPlantId || activePlantId;
  return PLANTS_BY_ID[pid]?.business_type || null;
}
// RTE, Beverage and Coco-Sutra don't sell by weight the way FnV does — for these,
// the "Sale Qty" box becomes a read-only "Production Qty" auto-summed from the
// quantities entered in the KG tables below, and the per-row Cost column is hidden.
function isProdQtyBiz() {
  const bt = activePlantBizType();
  return bt === 'RTE' || bt === 'Beverage' || bt === 'Coco-Sutra';
}
// Sale/Production Qty box is locked either because the record itself is
// superadmin-locked, or because this business auto-fills it from KG quantities.
function saleQtyLocked() {
  return isProdQtyBiz() || (_currentRecordLocked && currentRole !== 'superadmin');
}
// Same idea for Dashboard/Compare/Report views, which can be scoped to one plant OR
// one business-type filter with no single plant — falls back to null (mixed/default kg).
function dashboardBizType() {
  const pid = currentPlantId || activePlantId;
  if (pid) return PLANTS_BY_ID[pid]?.business_type || null;
  return activeBizType || null;
}

/* ── Pre-login business tiles (first screen) ─────────────── */
function renderPreLoginTiles() {
  const grid = document.getElementById('preLoginGrid');
  grid.innerHTML = BIZ_TYPES.map((bt, i) => `
    <button type="button" class="pl-tile pl-tile-${i + 1}" onclick="choosePreLoginBiz('${bt.key}')">
      <div>
        <div class="pl-tile-name">${bt.icon}&nbsp; ${bt.label}</div>
        <div class="pl-tile-count">Enter ${bt.label}</div>
      </div>
    </button>
  `).join('');
}
renderPreLoginTiles();

/* ── Business type chip selector (replaces <select> for business-type filters) ──
   Renders a row of click buttons into containerId; selected value lives in the
   container's data-value attribute (read via bizChipValue). onChangeFn is called
   by name (a global function with no args) whenever the selection changes. */
function bizChipsHTML(containerId, currentValue, onChangeFn, opts) {
  opts = opts || {};
  const dark = opts.dark ? ' on-dark' : '';
  const chip = (v, label) =>
    `<button type="button" class="biz-chip${v === currentValue ? ' active' : ''}"
      onclick="setBizChip('${containerId}','${v}','${onChangeFn}')">${label}</button>`;
  return `<div class="biz-chips${dark}" id="${containerId}" data-value="${currentValue || ''}">` +
    (opts.noAll ? '' : chip('', 'All')) +
    BIZ_TYPES.map(bt => chip(bt.key, bt.label)).join('') +
    `</div>`;
}
function bizChipValue(containerId) {
  return document.getElementById(containerId)?.dataset.value || '';
}
function setBizChip(containerId, value, onChangeFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.dataset.value = value;
  el.querySelectorAll('.biz-chip').forEach(btn => {
    const label = btn.textContent;
    const btnValue = label === 'All' ? '' : (BIZ_TYPES.find(bt => bt.label === label)?.key ?? '');
    btn.classList.toggle('active', btnValue === value);
  });
  if (onChangeFn && window[onChangeFn]) window[onChangeFn]();
}

function openBizTypePicker() {
  const plants = Object.values(PLANTS_BY_ID);
  document.getElementById('btUserName').textContent = currentUsername;
  document.getElementById('bizTypeGrid').innerHTML = BIZ_TYPES.map(bt => {
    const n = plants.filter(p => p.business_type === bt.key).length;
    const countTxt = n === 0 ? 'No locations yet' : n === 1 ? '1 location' : n + ' locations';
    return `<div class="bt-card${n ? '' : ' empty'}" ${n ? `onclick="selectBizType('${bt.key}')"` : ''}>
      <div class="bt-ico">${bt.icon}</div>
      <div class="bt-name">${bt.label}</div>
      <div class="bt-count">${countTxt}</div>
    </div>`;
  }).join('');
  document.getElementById('bizTypeOverlay').style.display = 'flex';
}

async function selectBizType(type) {
  activeBizType = type || '';
  sessionStorage.setItem('activeBizType', activeBizType);
  sessionStorage.setItem('bizTypeChosen', '1');
  document.getElementById('bizTypeOverlay').style.display = 'none';
  // Keep every business-type filter in the app in sync with the chosen scope — each
  // surface re-renders its own chip row from these variables next time it loads.
  allPlantsBizType = activeBizType;
  sessionStorage.setItem('allPlantsBizType', activeBizType);
  dashCompBizType = activeBizType;
  repBizType = activeBizType;
  renderPlantSelector();
  clearForm();
  await initApp();
}

async function onPlantChange(val) {
  if (_isDirty && !confirm('You have unsaved changes. Switch plant without saving?')) {
    // Revert the dropdown to current activePlantId
    document.getElementById('plantSelector').value = activePlantId || '';
    return;
  }
  activePlantId = val ? parseInt(val) : null;
  sessionStorage.setItem('activePlantId', activePlantId || '');
  const sel = document.getElementById('plantSelector');
  const plantName = sel.options[sel.selectedIndex]?.text;
  activePlantName = activePlantId ? plantName : null;
  const plantLabel = activePlantId ? ` • ${plantName}` : ' • All Plants';
  document.getElementById('userBadge').textContent = currentUsername + plantLabel;
  clearForm();
  await initApp();
  if (vendorsPanelOpen) loadVendorsList();
  const dashOpen = document.getElementById('dashboardOverlay').style.display !== 'none';
  if (dashOpen) await loadDashboard();
  if (activePlantId) {
    const date = document.getElementById('dateInput').value;
    if (date) await silentLoadRecord(date);
  }
}

async function initApp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('dateInput').value =
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  const isAllPlants = !currentPlantId && !activePlantId;
  const effectivePlantId = currentPlantId || activePlantId;
  const hasKgProcessing = PLANTS_BY_ID[effectivePlantId]?.has_kg_processing !== false;
  const bizType = PLANTS_BY_ID[effectivePlantId]?.business_type || null;
  const unitAbbr = bizUnitAbbr(bizType);
  const _prodQtyBiz = bizType === 'RTE' || bizType === 'Beverage' || bizType === 'Coco-Sutra';
  document.getElementById('saleQtyLabel').innerHTML = _prodQtyBiz
    ? `Production&nbsp;Qty&nbsp;(${unitAbbr})`
    : `Sale&nbsp;Qty&nbsp;(${unitAbbr})`;
  const _sqInput = document.getElementById('saleQtyInput');
  _sqInput.classList.toggle('locked-input', saleQtyLocked());
  _sqInput.title = _prodQtyBiz ? 'Auto-filled from the quantities entered below' : '';
  document.getElementById('sumKGLabel').textContent = `Per ${bizUnitWord(bizType)} Cost`;
  document.getElementById('sumMPKLabel').textContent = `MPK (₹ / ${unitAbbr})`;
  document.getElementById('kgProcessingCardTitle').textContent = `⚖ Per ${bizUnitWord(bizType)} Processing Cost`;
  document.getElementById('allPlantsView').style.display  = isAllPlants ? '' : 'none';
  document.getElementById('entryCards').style.display     = isAllPlants ? 'none' : 'block';
  document.querySelector('.sumbar').style.display         = isAllPlants ? 'none' : '';
  document.querySelector('.btn-save-rec').style.display   = isAllPlants ? 'none' : '';
  document.getElementById('reloadBtn').style.display      = isAllPlants ? 'none' : '';
  document.getElementById('navDaily').style.display       = isAllPlants ? 'none' : '';
  // Vendors are plant-specific — hide the tab whenever no single plant is in context
  const isSuperadmin = currentRole === 'superadmin';
  document.getElementById('navVendors').style.display = (!isAllPlants && isSuperadmin) ? '' : 'none';
  document.getElementById('kgProcessingCard').style.display = hasKgProcessing ? '' : 'none';
  { const eab = document.getElementById('exportAllPlantsBtn'); if (eab) eab.style.display = (isAllPlants && isSuperadmin) ? 'block' : 'none'; }

  if (isAllPlants) {
    loadHistory();
    await loadDashboard();
    setActiveNav('dashboard');
    return;
  }

  await loadSKURateOverrides();
  await loadKGVendors();
  await loadCustomSKUs();
  renderAtt();
  renderKGTabs();
  recalc();
  loadHistory();
}

let allPlantsBizType = sessionStorage.getItem('allPlantsBizType') || '';

function onAllPlantsBizTypeChange() {
  allPlantsBizType = bizChipValue('allPlantsBizType');
  sessionStorage.setItem('allPlantsBizType', allPlantsBizType);
  const date = document.getElementById('dateInput').value;
  if (date) loadAllPlantsView(date);
}

async function loadAllPlantsView(date) {
  const tableEl = document.getElementById('allPlantsTable');
  const titleEl = document.getElementById('allPlantsTitle');
  const bizWrap = document.getElementById('allPlantsBizTypeWrap');
  if (bizWrap) bizWrap.innerHTML = bizChipsHTML('allPlantsBizType', allPlantsBizType, 'onAllPlantsBizTypeChange');
  if (!date) { tableEl.innerHTML = '<div class="ap-empty">Select a date to view the summary.</div>'; return; }
  const d = new Date(date);
  const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  titleEl.textContent = `All Plants — Summary for ${dateStr}` + (allPlantsBizType ? ` (${allPlantsBizType})` : '');
  tableEl.innerHTML = '<div class="ap-empty">Loading…</div>';
  try {
    const qs = allPlantsBizType ? '?businessType=' + encodeURIComponent(allPlantsBizType) : '';
    const rows = await fetch('/api/records/allplants/' + date + qs, { credentials: 'include' }).then(r => r.json());
    if (!rows.length) { tableEl.innerHTML = '<div class="ap-empty">No data saved for this date across any plant.</div>'; return; }
    const fc = v => '₹ ' + parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fn2 = v => parseFloat(v || 0) > 0 ? '₹ ' + parseFloat(v).toFixed(2) : '—';
    const totAtt = rows.reduce((s, r) => s + parseFloat(r.attendance_cost || 0), 0);
    const totKG  = rows.reduce((s, r) => s + parseFloat(r.kg_cost || 0), 0);
    const totTot = rows.reduce((s, r) => s + parseFloat(r.total_cost || 0), 0);
    const totQty = rows.reduce((s, r) => s + parseFloat(r.sale_qty || 0), 0);
    const totMPK = totQty > 0 ? totTot / totQty : null;
    const hdrUnit = allPlantsBizType ? bizUnitAbbr(allPlantsBizType) : null;
    tableEl.innerHTML = `<table class="ap-table">
      <thead><tr>
        <th>Plant</th><th>Prod. Att. Cost</th><th>Per Unit Cost</th><th>Total Cost</th><th>Sale Qty${hdrUnit ? ` (${hdrUnit})` : ''}</th><th>MPK${hdrUnit ? ` (₹/${hdrUnit})` : ' (₹)'}</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${r.plant_name}</td>
          <td>${fc(r.attendance_cost)}</td>
          <td>${fc(r.kg_cost)}</td>
          <td>${fc(r.total_cost)}</td>
          <td>${parseFloat(r.sale_qty || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}${!hdrUnit ? ' ' + bizUnitAbbr(r.business_type) : ''}</td>
          <td>${fn2(r.mpk)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr class="ap-total">
        <td>Total</td>
        <td>${fc(totAtt)}</td>
        <td>${fc(totKG)}</td>
        <td>${fc(totTot)}</td>
        <td>${totQty.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td>${totMPK ? '₹ ' + totMPK.toFixed(2) : '—'}</td>
      </tr></tfoot>
    </table>`;
  } catch (e) {
    tableEl.innerHTML = `<div class="ap-empty">Failed to load: ${e.message}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════
   KG VENDORS — dynamic list from backend
═══════════════════════════════════════════════════════ */

async function loadKGVendors() {
  try {
    const vendors = await api('GET', '/api/vendors');
    KG_VENDORS = vendors.map(v => v.name);
    KG_VENDORS.forEach(v => {
      if (!kgState[v])        kgState[v]        = new Array((SKU_CFG[v] || []).length).fill(0);
      if (!customSKUs[v])     customSKUs[v]     = [];
      if (unloadingCosts[v] === undefined) unloadingCosts[v] = 0;
    });
    if (!activeTab || !KG_VENDORS.includes(activeTab)) activeTab = KG_VENDORS[0] || '';
  } catch (e) {
    console.error('Failed to load KG vendors:', e.message);
  }
}

/* ═══════════════════════════════════════════════════════
   CUSTOM SKU — backend-backed
═══════════════════════════════════════════════════════ */

async function loadCustomSKUs() {
  try {
    const grouped = await api('GET', '/api/sku');
    KG_VENDORS.forEach(v => {
      customSKUs[v] = (grouped[v] || []).map(s => ({ id: s.id, name: s.name, rate: s.rate, qty: 0, caseSize: s.caseSize || 0, cases: 0 }));
    });
  } catch (e) {
    console.error('Failed to load custom SKUs:', e.message);
  }
}


/* ── Manual contractor add / remove ── */

/* ── Saved contractor list (per plant, stored in localStorage) ── */

function _savedContractorKey() {
  return 'savedContractors_' + (currentPlantId || 'all');
}
const _DEFAULT_CONTRACTORS = [
  'Krish Enterprises',
  'Sai Enterprises',
  'RS',
  'SATENDRA SINGH Bhadoriya',
  'Bhadawar Service Corporation',
];
function getSavedContractors() {
  try {
    const stored = localStorage.getItem(_savedContractorKey());
    if (stored) return JSON.parse(stored);
    // First visit — seed defaults and save them
    setSavedContractors(_DEFAULT_CONTRACTORS);
    return [..._DEFAULT_CONTRACTORS];
  } catch { return [..._DEFAULT_CONTRACTORS]; }
}
function setSavedContractors(list) {
  localStorage.setItem(_savedContractorKey(), JSON.stringify(list));
}

function showAddContractorPanel() {
  if (document.getElementById('addContractorModal')) return;
  const html = `<div id="addContractorModal" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:14px;padding:24px;min-width:320px;max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px">Add Contractor</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px">Click a name to add to today's list. Press ✕ to remove from saved.</div>
      <div id="savedContractorList" style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px">${_renderSavedList()}</div>
      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:11px;font-weight:600;color:#4a7060;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">New contractor</div>
        <div style="display:flex;gap:6px">
          <input id="newContractorName" type="text" placeholder="Contractor name" class="input" style="flex:1"
            onkeydown="if(event.key==='Enter')confirmAddContractor();if(event.key==='Escape')closeAddContractorPanel();">
          <button class="btn btn-save-rec" onclick="confirmAddContractor()">Add</button>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-card-outline" onclick="closeAddContractorPanel()">Close</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('newContractorName').focus();
}

function _renderSavedList() {
  const saved = getSavedContractors();
  if (!saved.length) return '<span style="font-size:12px;color:#8a9a90">No saved contractors yet. Add one below.</span>';
  return saved.map(n => {
    const safe = n.replace(/'/g, "\\'");
    const alreadyIn = ATT_VENDORS.includes(n);
    return `<span style="display:inline-flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;border:1px solid ${alreadyIn ? '#ccc' : '#1e6b45'};font-size:12px">
      <button onclick="quickAddContractor('${safe}')" style="padding:5px 10px;border:none;background:${alreadyIn ? '#f0f0f0' : '#e8f4ed'};color:${alreadyIn ? '#999' : '#1e6b45'};cursor:${alreadyIn ? 'default' : 'pointer'};font-weight:600" ${alreadyIn ? 'disabled title="Already added"' : ''}>${n}${alreadyIn ? ' ✓' : ''}</button>
      <button onclick="removeFromSavedList('${safe}')" title="Remove from saved list"
        style="padding:5px 7px;border:none;border-left:1px solid ${alreadyIn ? '#ccc' : '#1e6b45'};background:${alreadyIn ? '#f0f0f0' : '#e8f4ed'};color:#b04040;cursor:pointer;font-size:13px;line-height:1">×</button>
    </span>`;
  }).join('');
}

function removeFromSavedList(name) {
  const saved = getSavedContractors().filter(n => n !== name);
  setSavedContractors(saved);
  document.getElementById('savedContractorList').innerHTML = _renderSavedList();
}

function quickAddContractor(name) {
  if (!ATT_VENDORS.includes(name)) {
    ATT_VENDORS.push(name);
    attState[name] = { workers: 0, cost: 0, designations: {} };
    const el = document.getElementById('savedContractorList');
    if (el) el.innerHTML = _renderSavedList();
    renderAtt();
  }
}

function closeAddContractorPanel() {
  document.getElementById('addContractorModal')?.remove();
}

function confirmAddContractor() {
  const inp = document.getElementById('newContractorName');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) { showToast('⚠ Enter a contractor name.', true); return; }
  if (ATT_VENDORS.includes(name)) { showToast('⚠ Already in list.', true); closeAddContractorPanel(); return; }
  // Auto-save to saved list
  const saved = getSavedContractors();
  if (!saved.includes(name)) { saved.push(name); setSavedContractors(saved); }
  ATT_VENDORS.push(name);
  attState[name] = { workers: 0, cost: 0, designations: {} };
  closeAddContractorPanel();
  renderAtt();
}

function removeContractor(v) {
  ATT_VENDORS = ATT_VENDORS.filter(x => x !== v);
  renderAtt();
}

/* ── Default SKU rate edit (persisted in DB via /api/sku/rates) ── */

function startEditDefaultSKU(v, i) {
  const row = document.getElementById('defrow_' + vid(v) + '_' + i);
  if (!row) return;
  const rate = (SKU_CFG[v] || [])[i]?.[1] ?? 0;
  const vesc = v.replace(/'/g, "\\'");
  const rateCell = row.querySelector('#defrate_' + vid(v) + '_' + i);
  if (rateCell) rateCell.innerHTML =
    `<input class="sku-edit-inp" id="eDR_${vid(v)}_${i}" type="number" value="${rate}" min="0" step="0.01" style="width:80px"
       onkeydown="if(event.key==='Enter')saveDefaultSKUEdit('${vesc}',${i});if(event.key==='Escape')refreshPane('${vesc}')">
     <button class="btn-save" style="margin-left:4px" onclick="saveDefaultSKUEdit('${vesc}',${i})">✓</button>
     <button class="btn-cancel" onclick="refreshPane('${vesc}')">✕</button>`;
  document.getElementById('eDR_' + vid(v) + '_' + i)?.focus();
}

async function saveDefaultSKUEdit(v, i) {
  const inp = document.getElementById('eDR_' + vid(v) + '_' + i);
  if (!inp) return;
  const newRate = parseFloat(inp.value) || 0;
  if (SKU_CFG[v]?.[i]) SKU_CFG[v][i][1] = newRate;
  try {
    await api('POST', '/api/sku/rates', { vendorName: v, skuIndex: i, rate: newRate });
  } catch (e) {
    console.error('Failed to save rate override:', e.message);
  }
  refreshPane(v);
  markDirty(); recalc();
  showToast('✓ Rate updated', false);
}

/* ═══════════════════════════════════════════════════════
   CALCULATIONS
═══════════════════════════════════════════════════════ */

function r2(n) { return Math.round(n * 100) / 100; }

function totalAtt() {
  return ATT_VENDORS.reduce((s, v) => s + (parseFloat(attState[v].cost) || 0), 0);
}

function vendorKG(v) {
  const defCost  = (SKU_CFG[v] || []).reduce((s, [, rate], i) => s + (kgState[v]?.[i] || 0) * rate, 0);
  const custCost = (customSKUs[v] || []).reduce((s, sku) => s + (sku.qty || 0) * sku.rate, 0);
  return defCost + custCost + (unloadingCosts[v] || 0);
}

function totalKG() { return KG_VENDORS.reduce((s, v) => s + vendorKG(v), 0); }

function grandTotal() { return totalAtt() + totalKG(); }

// Raw quantity (not cost) entered for a vendor — used to auto-fill Production Qty
// for RTE/Beverage, where the top box isn't a separately-typed sale figure.
function vendorQty(v) {
  const defQty  = (SKU_CFG[v] || []).reduce((s, _pair, i) => s + (kgState[v]?.[i] || 0), 0);
  const custQty = (customSKUs[v] || []).reduce((s, sku) => s + (sku.qty || 0), 0);
  return defQty + custQty;
}
function totalKGQty() { return KG_VENDORS.reduce((s, v) => s + vendorQty(v), 0); }

function getMPK() {
  const sq = parseFloat(document.getElementById('saleQtyInput').value) || 0;
  return sq > 0 ? grandTotal() / sq : null;
}

/* ═══════════════════════════════════════════════════════
   FORMATTING
═══════════════════════════════════════════════════════ */

function fc(n) {
  if (n == null || isNaN(n)) return '—';
  return '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fcShort(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return '₹ ' + (n / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return '₹ ' + (n / 1e5).toFixed(2) + ' L';
  return '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fn(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function vid(v) { return v.replace(/[^a-zA-Z0-9]/g, '_'); }

/* ═══════════════════════════════════════════════════════
   RECALC
═══════════════════════════════════════════════════════ */

function markDirty() {
  if (!_isDirty) {
    _isDirty = true;
    const lbl = document.getElementById('lastSavedLabel');
    if (lbl) lbl.style.display = 'none'; // hide old "Saved at" when new edits start
  }
}

// Show the selected date in a friendly, unambiguous form like "5 July 26"
function updateDateNice() {
  const el = document.getElementById('dateNice');
  if (!el) return;
  const v = document.getElementById('dateInput')?.value;
  const d = v ? new Date(v + 'T00:00:00') : null;
  if (!d || isNaN(d)) { el.textContent = ''; return; }
  const months = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
  el.textContent = `${d.getDate()} ${months[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

function recalc() {
  updateDateNice();
  // For RTE/Beverage, Production Qty isn't typed in — it's the sum of everything
  // entered in the KG tables below, kept in sync on every quantity change.
  if (isProdQtyBiz()) {
    document.getElementById('saleQtyInput').value = totalKGQty() || '';
  }
  const att = totalAtt(), kg = totalKG(), total = att + kg, mpk = getMPK();
  document.getElementById('sumAtt').textContent   = fcShort(att);
  document.getElementById('sumKG').textContent    = fcShort(kg);
  document.getElementById('sumTotal').textContent = fcShort(total);
  document.getElementById('sumMPK').textContent   = mpk != null ? fn(mpk) : '—';
  document.getElementById('attTotal').textContent = fc(att);
  const totalW = ATT_VENDORS.reduce((s, v) => s + (parseInt(attState[v]?.workers) || 0), 0);
  const wEl = document.querySelector('#attTfoot .ft td:nth-child(' + (2 + (_desigViewOn ? _getAllDesigCols().length : 0)) + ')');
  if (wEl) wEl.textContent = totalW > 0 ? totalW + ' workers' : '';
  const _qtyOnly = isProdQtyBiz();
  const _u = bizUnitAbbr(activePlantBizType());
  KG_VENDORS.forEach(v => {
    const el = document.getElementById('kgTot_' + vid(v));
    if (el) el.textContent = _qtyOnly ? `${fn(vendorQty(v))} ${_u}` : fc(vendorKG(v));
  });
  // Flag the Sale/Production Qty box when it's empty or zero so it can't be missed
  const sqField = document.getElementById('saleQtyField');
  if (sqField) {
    const sq = parseFloat(document.getElementById('saleQtyInput').value) || 0;
    sqField.classList.toggle('needs-sale', !(sq > 0));
  }
}

/* ═══════════════════════════════════════════════════════
   RENDER — ATTENDANCE TABLE
═══════════════════════════════════════════════════════ */

let _desigViewOn = false;

function _getAllDesigCols() {
  const seen = new Set();
  ATT_VENDORS.forEach(v => Object.keys(attState[v]?.designations || {}).forEach(d => seen.add(d)));
  return [...seen];
}

function toggleDesigView() {
  _desigViewOn = !_desigViewOn;
  const btn = document.getElementById('desigToggleBtn');
  if (btn) {
    btn.textContent = _desigViewOn ? 'Hide Breakdown' : 'Show Breakdown';
    btn.style.background = _desigViewOn ? '#e8f4ed' : '';
    btn.style.color = _desigViewOn ? '#1e6b45' : '';
    btn.style.borderColor = _desigViewOn ? '#1e6b45' : '';
  }
  renderAtt();
}

function renderAtt() {
  const hasAnyDesig = ATT_VENDORS.some(v => Object.keys(attState[v]?.designations || {}).length > 0);
  const toggleBtn = document.getElementById('desigToggleBtn');
  if (toggleBtn) toggleBtn.style.display = hasAnyDesig ? '' : 'none';

  const desigCols = _desigViewOn ? _getAllDesigCols() : [];
  const totalCols = 3 + desigCols.length;

  // Rebuild thead
  const thead = document.getElementById('attThead');
  if (thead) {
    const desigHeaders = desigCols.map(d =>
      `<th class="r" style="font-size:11px;color:#1e6b45;white-space:nowrap;padding:8px 10px">${d}</th>`
    ).join('');
    thead.innerHTML = `<tr>
      <th>Contractor</th>
      ${desigHeaders}
      <th class="r">Workers Present</th>
      <th class="r">Production Attendance Cost (₹)</th>
    </tr>`;
  }

  // Rebuild tfoot
  const tfoot = document.getElementById('attTfoot');
  if (tfoot) {
    const totalWorkers = ATT_VENDORS.reduce((s, v) => s + (parseInt(attState[v]?.workers) || 0), 0);
    const desigTotals = desigCols.map(d => {
      const total = ATT_VENDORS.reduce((s, v) => s + (attState[v]?.designations?.[d]?.workers || 0), 0);
      return `<td class="r" style="font-size:12px;color:#4a7060">${total || '—'}</td>`;
    }).join('');
    tfoot.innerHTML = `<tr class="ft">
      <td>Total</td>
      ${desigTotals}
      <td class="r">${totalWorkers > 0 ? totalWorkers + ' workers' : ''}</td>
      <td class="r" id="attTotal">₹ 0.00</td>
    </tr>`;
  }

  if (ATT_VENDORS.length === 0) {
    document.getElementById('attTbody').innerHTML =
      `<tr><td colspan="${totalCols}" style="text-align:center;color:#8a9a90;padding:18px;font-size:13px">
        No contractors yet — upload a CSV or add one manually below
      </td></tr>`;
  } else {
    document.getElementById('attTbody').innerHTML = ATT_VENDORS.map(v => {
      const s = attState[v], vk = v.replace(/'/g, "\\'");
      const desig = s.designations || {};
      const desigCells = desigCols.map(d => {
        const w = desig[d]?.workers || 0;
        return `<td class="r" style="font-size:12px;color:${w ? '#1e6b45' : '#ccc'};padding:6px 10px">${w || '—'}</td>`;
      }).join('');
      return `<tr>
        <td>${v} <button onclick="removeContractor('${vk}')" title="Remove row"
          style="border:none;background:none;cursor:pointer;color:#b04040;font-size:13px;padding:0 4px">×</button></td>
        ${desigCells}
        <td class="r">
          <input type="number" min="0" step="1" value="${s.workers}" style="width:80px"
            onchange="attState['${vk}'].workers=parseInt(this.value)||0;markDirty();recalc();">
        </td>
        <td class="r">
          <input type="number" min="0" step="0.01" value="${s.cost}" style="width:130px"
            onchange="attState['${vk}'].cost=parseFloat(this.value)||0;markDirty();recalc();">
        </td>
      </tr>`;
    }).join('');
  }
  recalc();
}


/* ═══════════════════════════════════════════════════════
   RENDER — KG TABS
═══════════════════════════════════════════════════════ */

function isUnloadingVendor(v) {
  const skus = customSKUs[v] || [];
  if (skus.length === 0) return false;
  return skus.every(s => /load|unload|shift|pallet|bardana|punnet|crate|coldroom/i.test(s.name));
}

function switchKGCat(cat) {
  activeKGCat = cat;
  ['unloading', 'processing'].forEach(c => {
    const cap = c.charAt(0).toUpperCase() + c.slice(1);
    const btn  = document.getElementById('kgCatBtn'  + cap);
    const pane = document.getElementById('kgCat' + cap);
    if (btn)  btn.classList.toggle('active', c === cat);
    if (pane) pane.style.display = c === cat ? '' : 'none';
  });
}

function renderUnloadingTable() {
  const wrap = document.getElementById('unloadingTableWrap');
  if (!wrap) return;
  const unloadVendors = KG_VENDORS.filter(v => isUnloadingVendor(v));

  if (unloadVendors.length === 0) {
    wrap.innerHTML = '<p style="padding:18px;color:var(--muted);text-align:center;font-size:13px">No loading/unloading vendors configured.</p>';
    return;
  }

  // Collect all unique activity names (preserve order from first vendor)
  const allActivities = [];
  const seen = new Set();
  unloadVendors.forEach(v => {
    (customSKUs[v] || []).forEach(s => { if (!seen.has(s.name)) { seen.add(s.name); allActivities.push(s.name); } });
  });

  // Header: Activity | Rate/kg | [VendorA qty | VendorA cost] | [VendorB qty | VendorB cost] ...
  const headerCols = unloadVendors.map(v => `<th colspan="2" style="text-align:center;background:#d4eede;color:var(--primary);font-size:13px;font-weight:800;letter-spacing:.4px;padding:10px 12px">${v.toUpperCase()}</th>`).join('');

  const dataRows = allActivities.map(actName => {
    // Rate from first vendor that has this activity
    let displayRate = 0;
    const vendorCells = unloadVendors.map(v => {
      const vd  = vid(v);
      const sku = (customSKUs[v] || []).find(s => s.name === actName);
      if (!sku) return '<td></td><td class="r"><span class="zero">—</span></td>';
      const rate = sku.rate ?? 0;
      if (!displayRate) displayRate = rate;
      const qty  = sku.qty || 0;
      const cost = qty * rate;
      return `<td class="r"><input type="number" min="0" step="0.001" value="${qty||''}" placeholder="—"
        data-v="${vd}" data-type="cust" data-ci="${sku.id}" data-rate="${rate}" onchange="onKG(this)"></td>
        <td class="r cost-val" id="kcc_${vd}_${sku.id}">${cost>0?fc(cost):'<span class="zero">—</span>'}</td>`;
    }).join('');
    return `<tr><td class="sku-name">${actName}</td><td class="r rate-cell">₹&nbsp;${displayRate.toFixed(2)}</td>${vendorCells}</tr>`;
  }).join('');

  const footerCells = unloadVendors.map(v =>
    `<td colspan="2" class="r cost-val" id="kgTot_${vid(v)}">${fc(vendorKG(v))}</td>`
  ).join('');

  wrap.innerHTML = `<div class="table-wrap"><table class="unload-table">
    <thead><tr><th>Activity</th><th class="r">₹/${bizUnitAbbr(activePlantBizType())}</th>${headerCols}</tr></thead>
    <tbody>${dataRows}</tbody>
    <tfoot><tr class="ft"><td colspan="2">Total KG Cost</td>${footerCells}</tr></tfoot>
  </table></div>`;
}

// Legacy vendor tabs to retire on a cutoff date. The tab stays visible for
// records dated BEFORE `from` (so historical entries still display), and is
// hidden for records dated ON/AFTER `from`. No data is deleted — old records
// keep their own rate snapshots regardless of tab visibility.
const LEGACY_VENDOR_CUTOFFS = [
  { plant: 'Bangalore-FnV', name: 'Vendor', from: '2026-07-03' },
];
function isHiddenLegacyVendor(v) {
  const plant = currentPlantName || activePlantName;
  const date  = (document.getElementById('dateInput')?.value || '').slice(0, 10);
  if (!plant || !date) return false;
  return LEGACY_VENDOR_CUTOFFS.some(r =>
    r.plant === plant && r.name === v && date >= r.from);
}

function renderKGTabs() {
  renderUnloadingTable();

  const procVendors = KG_VENDORS.filter(v => !isUnloadingVendor(v) && !isHiddenLegacyVendor(v));
  if (!procVendors.includes(activeTab)) activeTab = procVendors[0] || '';

  document.getElementById('kgTabNav').innerHTML = procVendors.map(v => {
    const vesc = v.replace(/'/g, "\\'");
    return `<button class="tab-btn ${v===activeTab?'active':''}" onclick="switchTab('${vesc}',this)">${v}</button>`;
  }).join('');
  document.getElementById('kgTabPanes').innerHTML = procVendors.map(v => buildPane(v)).join('');
}

function buildPane(v) {
  const vid_ = vid(v);
  const _qtyOnly = isProdQtyBiz();
  const _u = bizUnitAbbr(activePlantBizType());
  const _cw = caseInputWord(activePlantBizType());
  const _cwSingular = _cw.replace(/s$/, '').toLowerCase();
  const _hasCaseCol = customSKUs[v].some(s => s.caseSize > 0);
  const caseColCell = (caseSize) => `<td class="r case-fixed-cell">${caseSize > 0 ? fn(caseSize, 3) + ' ' + _u : '<span class="zero">—</span>'}</td>`;
  const defRows = (SKU_CFG[v] || []).map(([name, rate], i) => {
    const qty = kgState[v][i] || 0, cost = qty * rate;
    const vesc = v.replace(/'/g, "\\'");
    const costCell = _qtyOnly ? '' : `<td class="r cost-val" id="kc_${vid_}_${i}">${cost>0?fc(cost):'<span class="zero">—</span>'}</td>`;
    return `<tr id="defrow_${vid_}_${i}">
      <td class="sku-name">${name}
        <button class="btn-edit-sku" title="Edit rate" onclick="startEditDefaultSKU('${vesc}',${i})">✎</button>
      </td>
      ${_hasCaseCol ? caseColCell(0) : ''}
      <td class="r rate-cell" id="defrate_${vid_}_${i}">₹&nbsp;${rate.toFixed(2)}</td>
      <td class="r"><input type="number" min="0" step="0.001" value="${qty||''}" placeholder="—"
        data-v="${vid_}" data-type="def" data-i="${i}" data-rate="${rate}" onchange="onKG(this)"></td>
      ${costCell}
    </tr>`;
  }).join('');

  const custRows = customSKUs[v].map((sku) => {
    const qty = sku.qty || 0, cost = qty * sku.rate;
    const caseInput = sku.caseSize > 0
      ? `<input type="number" min="0" step="0.01" value="${sku.cases||''}" placeholder="${_cw}" class="case-input" title="${sku.caseSize} ${_u} per ${_cwSingular}"
          onchange="onCaseInput(this,${sku.caseSize},'${vid_}',${sku.id})">`
      : '';
    const costCell = _qtyOnly ? '' : `<td class="r cost-val" id="kcc_${vid_}_${sku.id}">${cost>0?fc(cost):'<span class="zero">—</span>'}</td>`;
    // When a per-piece weight is set, the qty box becomes a read-only display of
    // the computed weight (pieces × per-piece weight) — the Pieces/Cases box is
    // the only thing anyone types into, so there's no way to enter a conflicting
    // manual weight. onCaseInput() still writes into this box by id as before.
    const qtyInputAttrs = sku.caseSize > 0 ? 'readonly tabindex="-1" style="background:#f5f5f5;color:var(--muted);cursor:not-allowed"' : '';
    return `<tr class="custom-sku-row" id="custrow_${vid_}_${sku.id}">
      <td class="sku-name">${sku.name}</td>
      ${_hasCaseCol ? caseColCell(sku.caseSize) : ''}
      <td class="r rate-cell">₹&nbsp;${sku.rate.toFixed(2)}</td>
      <td class="r"><span class="qty-cell-inner">${caseInput}<input type="number" min="0" step="0.001" value="${qty||''}" placeholder="—" ${qtyInputAttrs}
        id="qty_${vid_}_${sku.id}" data-v="${vid_}" data-type="cust" data-ci="${sku.id}" data-rate="${sku.rate}" onchange="onKG(this)"></span></td>
      ${costCell}
    </tr>`;
  }).join('');

  const vesc = v.replace(/'/g, "\\'");
  const caseColHead = _hasCaseCol ? `<th class="r">${_u}/${_cwSingular}</th>` : '';
  const headCostCol = _qtyOnly ? '' : `<th class="r">Cost (₹)</th>`;
  const footLabel = _qtyOnly ? `${v} — Total Qty` : `${v} — Total KG Cost`;
  const footColspan = (_qtyOnly ? 2 : 3) + (_hasCaseCol ? 1 : 0);
  const footVal = _qtyOnly ? `${fn(vendorQty(v))} ${_u}` : fc(vendorKG(v));
  return `<div class="tab-pane ${v===activeTab?'active':''}" id="kgPane_${vid_}">
    <div class="table-wrap">
      <table>
        <thead><tr><th>SKU</th>${caseColHead}<th class="r">Rate (₹/${_u})</th><th class="r">Qty (${_u})</th>${headCostCol}</tr></thead>
        <tbody>${defRows}${custRows}</tbody>
        <tfoot><tr class="ft"><td colspan="${footColspan}">${footLabel}</td>
          <td class="r cost-val" id="kgTot_${vid_}">${footVal}</td></tr></tfoot>
      </table>
    </div>
    <div class="unloading-bar" id="unloadBar_${vid_}">
      <button class="btn-ghost" id="unloadBtn_${vid_}"
        style="${(unloadingCosts[v]||0)>0?'display:none':''}"
        onclick="showUnloadingInput('${vesc}')">+ Add Unloading Cost</button>
      <div id="unloadWrap_${vid_}"
        style="display:${(unloadingCosts[v]||0)>0?'flex':'none'};align-items:center;gap:10px;width:100%">
        <span>Unloading Cost (₹)</span>
        <input type="number" min="0" step="0.01" value="${(unloadingCosts[v]||0)>0?unloadingCosts[v]:''}" placeholder="0.00"
          id="unloadInp_${vid_}" data-v="${vid_}" onchange="onUnloadingCost(this)">
        <button class="btn-del" title="Remove unloading cost" onclick="removeUnloadingCost('${vesc}')">×</button>
        <span class="cost-val" id="kgUnload_${vid_}">${(unloadingCosts[v]||0)>0?fc(unloadingCosts[v]):''}</span>
      </div>
    </div>
  </div>`;
}

function refreshPane(v) {
  const pane = document.getElementById('kgPane_' + vid(v));
  if (!pane) return;
  const wasActive = pane.classList.contains('active');
  const tmp = document.createElement('div');
  tmp.innerHTML = buildPane(v);
  const built = tmp.firstElementChild;
  if (wasActive) built.classList.add('active');
  pane.replaceWith(built);
}

function switchTab(vendor, btn) {
  activeTab = vendor;
  const proc = document.getElementById('kgCatProcessing');
  (proc || document).querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  (proc || document).querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const pane = document.getElementById('kgPane_' + vid(vendor));
  if (pane) pane.classList.add('active');
}

function onKG(input) {
  const v_    = input.dataset.v;
  const type  = input.dataset.type;
  const rate  = parseFloat(input.dataset.rate);
  const qty   = parseFloat(input.value) || 0;
  const rawV  = KG_VENDORS.find(k => vid(k) === v_);

  let costCellId;
  if (type === 'def') {
    const i = parseInt(input.dataset.i);
    if (rawV) kgState[rawV][i] = qty;
    costCellId = 'kc_' + v_ + '_' + i;
  } else {
    const skuId = parseInt(input.dataset.ci);
    if (rawV) { const s = customSKUs[rawV].find(x => x.id === skuId); if (s) s.qty = qty; }
    costCellId = 'kcc_' + v_ + '_' + skuId;
  }

  const cost = qty * rate;
  const costCell = document.getElementById(costCellId);
  if (costCell) costCell.innerHTML = cost > 0 ? fc(cost) : '<span class="zero">—</span>';

  const totCell = document.getElementById('kgTot_' + v_);
  if (totCell && rawV) totCell.textContent = isProdQtyBiz() ? `${fn(vendorQty(rawV))} ${bizUnitAbbr(activePlantBizType())}` : fc(vendorKG(rawV));
  markDirty(); recalc();
}

// Case-count entry for SKUs sold in fixed-size cases (e.g. beverage cartons) — computes the
// resulting litres/kg from cases × case size, writes it into the real qty input, and lets
// onKG() do everything else exactly as if that quantity had been typed directly.
function onCaseInput(input, caseSize, vid_, skuId) {
  const cases = parseFloat(input.value) || 0;
  const qty = +(cases * caseSize).toFixed(3);
  const rawV = KG_VENDORS.find(k => vid(k) === vid_);
  if (rawV) { const s = customSKUs[rawV].find(x => x.id === skuId); if (s) s.cases = cases; }
  const qtyInput = document.getElementById('qty_' + vid_ + '_' + skuId);
  if (qtyInput) { qtyInput.value = qty || ''; onKG(qtyInput); }
}

function onUnloadingCost(input) {
  const rawV = KG_VENDORS.find(k => vid(k) === input.dataset.v);
  if (!rawV) return;
  unloadingCosts[rawV] = parseFloat(input.value) || 0;
  const label = document.getElementById('kgUnload_' + input.dataset.v);
  if (label) label.textContent = unloadingCosts[rawV] > 0 ? fc(unloadingCosts[rawV]) : '';
  const totCell = document.getElementById('kgTot_' + input.dataset.v);
  if (totCell) totCell.textContent = fc(vendorKG(rawV));
  markDirty(); recalc();
}

function showUnloadingInput(v) {
  const v_ = vid(v);
  document.getElementById('unloadBtn_' + v_).style.display = 'none';
  const wrap = document.getElementById('unloadWrap_' + v_);
  wrap.style.display = 'flex';
  const inp = document.getElementById('unloadInp_' + v_);
  if (inp) inp.focus();
}

function removeUnloadingCost(v) {
  unloadingCosts[v] = 0;
  recalc();
  refreshPane(v);
}

/* ═══════════════════════════════════════════════════════
   CSV UPLOAD
═══════════════════════════════════════════════════════ */

function showToast(msg, isError) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    Object.assign(t.style, {
      position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
      padding:'12px 20px', borderRadius:'9px', fontSize:'13px', fontWeight:'600',
      zIndex:'9999', boxShadow:'0 4px 20px rgba(0,0,0,.25)', maxWidth:'88vw',
      whiteSpace:'pre-wrap', textAlign:'center', lineHeight:'1.6', transition:'opacity .4s'
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = isError ? '#dc2626' : '#1a2e23';
  t.style.color = '#fff';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, isError ? 12000 : 4000);
}

async function onCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  _cachedCSVFile = file;

  const date = document.getElementById('dateInput').value.trim();
  const fd = new FormData();
  fd.append('file', file);
  if (date) fd.append('date', date);

  showToast('⏳ Uploading ' + file.name + '…', false);

  try {
    const result = await api('POST', '/api/upload/csv', fd);

    if (result.date) document.getElementById('dateInput').value = result.date;

    ATT_VENDORS = Object.keys(result.byContractor).sort();
    ATT_VENDORS.forEach(v => {
      const data = result.byContractor[v];
      attState[v] = { workers: data.workers, cost: r2(data.totalCost), designations: data.designations || {} };
    });
    _freshCSVLoaded = true;

    showToast('✓ ' + file.name + ' — ' + result.totalRows + ' rows loaded', false);

    updateCSVMeta(result);
    renderAtt();

    if (result.date) silentLoadRecord(result.date);

  } catch (err) {
    showToast('⚠ CSV Error: ' + err.message, true);
  }
}

async function tryReprocessCSV() {
  if (!_cachedCSVFile) return;
  const date = document.getElementById('dateInput').value.trim();
  if (!date) return;
  const fd = new FormData();
  fd.append('file', _cachedCSVFile);
  fd.append('date', date);
  try {
    const result = await api('POST', '/api/upload/csv', fd);
    // Only apply the cached file if it actually contains data for the date the user
    // selected. If it doesn't, the parser falls back to some other day — in that case
    // do nothing: never override the chosen date, and let the saved DB record load.
    if (result.date !== date) return;
    ATT_VENDORS = Object.keys(result.byContractor).sort();
    ATT_VENDORS.forEach(v => {
      const data = result.byContractor[v];
      attState[v] = { workers: data.workers, cost: r2(data.totalCost), designations: data.designations || {} };
    });
    _freshCSVLoaded = true;
    updateCSVMeta(result);
    renderAtt();
  } catch (err) {
    showToast('⚠ Reprocess failed: ' + err.message, true);
  }
}

function updateCSVMeta(result) {
  const { unmapped, unmappedNames = [], sortedDates = [], date: filterDate, totalRows = 0, byContractor = {} } = result;
  const totalProcessed = Object.values(byContractor).reduce((s, c) => s + (c.workers || 0), 0);

  const note = document.getElementById('unmappedNote');
  if (unmapped > 0) {
    note.textContent = 'Unmapped contractors (ignored): ' + (unmappedNames.length ? unmappedNames.join(', ') : unmapped + ' rows');
    note.style.display = '';
  } else {
    note.style.display = 'none';
  }

  const dsEl = document.getElementById('csvDateChips');
  if (sortedDates.length > 1) {
    dsEl.innerHTML = 'Dates in CSV: ' + sortedDates.map(d => {
      const active = d === filterDate ? 'style="background:#1e6b45;color:#fff;border-color:#1e6b45"' : '';
      return `<button onclick="pickCSVDate('${d}')" ${active}
        style="margin:0 3px;padding:3px 10px;border:1px solid #c6ddd0;border-radius:6px;
               font-size:12px;font-weight:600;cursor:pointer;background:#edf7f1;color:#234d34"
      >${d}</button>`;
    }).join('');
    dsEl.style.display = '';
  } else {
    dsEl.innerHTML = ''; dsEl.style.display = 'none';
  }

  if (totalProcessed === 0) {
    showToast('⚠ 0 workers found in CSV.\n' + (totalRows > 0
      ? 'Check the CSV has a "Contractor Name" and "Day Count" column.'
      : 'The CSV appears empty or has an unrecognised format.'), true);
  } else {
    const dateMsg = filterDate ? ' for ' + filterDate : '';
    showToast('✓ Matched ' + totalProcessed + ' employees' + dateMsg + '.', false);
  }
}

function pickCSVDate(d) {
  document.getElementById('dateInput').value = d;
  tryReprocessCSV();
}

function toggleHistMng(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('histMngMenu');
  if (menu) menu.classList.toggle('open');
}
// Close the Manage menu when clicking anywhere else
document.addEventListener('click', (e) => {
  const menu = document.getElementById('histMngMenu');
  if (menu && menu.classList.contains('open') && !e.target.closest('.hist-mng')) {
    menu.classList.remove('open');
  }
});

async function showAuditLog() {
  document.getElementById('auditModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'auditModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:760px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff">
      <span style="font-size:16px;font-weight:800;color:#991b1b">🗑 Deletion Log</span>
      <button onclick="document.getElementById('auditModal').remove()" style="border:none;background:#f3f4f6;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:16px">×</button>
    </div>
    <div id="auditBody" style="padding:16px 20px"><p style="color:#888;text-align:center">Loading…</p></div>
  </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);

  try {
    const rows = await api('GET', '/api/records/audit');
    const body = document.getElementById('auditBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<p style="color:#888;text-align:center;padding:20px">No deletions recorded yet. Any future deletion will appear here.</p>';
      return;
    }
    const fmt = ts => { const d = new Date(ts); return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); };
    const label = a => a === 'delete_record' ? '<span style="color:#991b1b;font-weight:700">Full day deleted</span>' : '<span style="color:#b45309;font-weight:700">Entries removed</span>';
    body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="text-align:left;border-bottom:2px solid #e5e7eb;color:#666">
        <th style="padding:8px 6px">When</th><th style="padding:8px 6px">Who</th>
        <th style="padding:8px 6px">Plant / Date</th><th style="padding:8px 6px">Action</th>
        <th style="padding:8px 6px">Details</th></tr></thead>
      <tbody>${rows.map(r => `<tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:8px 6px;white-space:nowrap;color:#555">${fmt(r.created_at)}</td>
        <td style="padding:8px 6px;font-weight:700;color:#1e3a28">${r.username || '—'}</td>
        <td style="padding:8px 6px;white-space:nowrap">${r.plant_name || '—'}<br><span style="color:#888">${(r.record_date||'').slice(0,10)}</span></td>
        <td style="padding:8px 6px">${label(r.action)}</td>
        <td style="padding:8px 6px;color:#444">${(r.details || '').replace(/</g,'&lt;')}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch (e) {
    const body = document.getElementById('auditBody');
    if (body) body.innerHTML = `<p style="color:#c00;text-align:center;padding:20px">⚠ ${e.message}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════
   SAVE & LOAD RECORDS
═══════════════════════════════════════════════════════ */

function previewRecord() {
  const date = document.getElementById('dateInput').value;
  const saleQty = parseFloat(document.getElementById('saleQtyInput').value) || 0;
  const att = totalAtt(), kg = totalKG(), total = att + kg;
  const mpk = saleQty > 0 ? r2(total / saleQty) : null;

  const attRows = ATT_VENDORS.map(v => {
    const w = parseInt(attState[v]?.workers) || 0;
    const c = parseFloat(attState[v]?.cost) || 0;
    if (!w && !c) return '';
    return `<tr><td>${v}</td><td style="text-align:center">${w}</td><td style="text-align:right">${fc(c)}</td></tr>`;
  }).filter(Boolean).join('');

  const kgRows = [];
  KG_VENDORS.forEach(v => {
    (SKU_CFG[v] || []).forEach(([name, rate], i) => {
      const qty = kgState[v]?.[i] || 0;
      if (qty > 0) kgRows.push(`<tr><td>${v}</td><td>${name}</td><td style="text-align:center">${qty}</td><td style="text-align:right">${fc(qty * rate)}</td></tr>`);
    });
    (customSKUs[v] || []).forEach(sku => {
      if ((sku.qty || 0) > 0) kgRows.push(`<tr><td>${v}</td><td>${sku.name}</td><td style="text-align:center">${sku.qty}</td><td style="text-align:right">${fc(sku.qty * sku.rate)}</td></tr>`);
    });
    const ul = unloadingCosts[v] || 0;
    if (ul > 0) kgRows.push(`<tr><td>${v}</td><td>Unloading</td><td style="text-align:center">—</td><td style="text-align:right">${fc(ul)}</td></tr>`);
  });

  const dateStr = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const tblStyle = 'width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px';
  const thStyle = 'background:#e8f4ed;color:#1e6b45;padding:6px 10px;text-align:left;font-weight:700;border-bottom:1.5px solid #b6d9c7';
  const tdStyle = 'padding:6px 10px;border-bottom:1px solid #eee';

  document.body.insertAdjacentHTML('beforeend', `
    <div id="previewModal" onclick="if(event.target===this)closePreviewModal()" style="position:fixed;inset:0;background:rgba(13,35,24,.72);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:#fff;border-radius:16px;width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="padding:18px 22px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:16px;font-weight:800;color:#1e3a28">Record Preview</div>
            <div style="font-size:12px;color:#888;margin-top:2px">${dateStr}${(currentPlantName||activePlantName) ? ' • ' + (currentPlantName||activePlantName) : ''}</div>
          </div>
          <button onclick="closePreviewModal()" style="border:none;background:none;font-size:22px;color:#aaa;cursor:pointer;line-height:1">×</button>
        </div>
        <div style="overflow-y:auto;padding:20px 22px;flex:1">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
            <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Att. Cost</div>
              <div style="font-size:15px;font-weight:800;color:#1e6b45;margin-top:4px">${fc(att)}</div>
            </div>
            <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">KG Cost</div>
              <div style="font-size:15px;font-weight:800;color:#1e6b45;margin-top:4px">${fc(kg)}</div>
            </div>
            <div style="background:#1e6b45;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px">Total Cost</div>
              <div style="font-size:15px;font-weight:800;color:#fff;margin-top:4px">${fc(total)}</div>
            </div>
            <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">MPK</div>
              <div style="font-size:15px;font-weight:800;color:#1e6b45;margin-top:4px">${mpk != null ? '₹ ' + fn(mpk) : '—'}</div>
            </div>
          </div>
          ${attRows ? `
            <div style="font-size:12px;font-weight:700;color:#1e6b45;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Attendance</div>
            <table style="${tblStyle}"><thead><tr>
              <th style="${thStyle}">Contractor</th><th style="${thStyle};text-align:center">Workers</th><th style="${thStyle};text-align:right">Cost</th>
            </tr></thead><tbody style="color:#2c3e30">${attRows.replace(/padding:6px 10px/g, tdStyle)}</tbody></table>` : '<div style="color:#aaa;font-size:13px;margin-bottom:16px">No attendance data entered.</div>'}
          ${kgRows.length ? `
            <div style="font-size:12px;font-weight:700;color:#1e6b45;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Per ${bizUnitWord(activePlantBizType())} Costs</div>
            <table style="${tblStyle}"><thead><tr>
              <th style="${thStyle}">Vendor</th><th style="${thStyle}">SKU</th><th style="${thStyle};text-align:center">Qty</th><th style="${thStyle};text-align:right">Cost</th>
            </tr></thead><tbody style="color:#2c3e30">${kgRows.join('').replace(/padding:6px 10px/g, tdStyle)}</tbody></table>` : `<div style="color:#aaa;font-size:13px">No ${bizUnitWord(activePlantBizType())} cost data entered.</div>`}
          <div style="font-size:12px;color:#888;margin-top:4px">Sale Qty: <strong style="color:#1e3a28">${saleQty > 0 ? saleQty.toLocaleString('en-IN') + ' ' + bizUnitAbbr(activePlantBizType()) : '—'}</strong></div>
        </div>
        <div style="padding:14px 22px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:10px">
          <button onclick="closePreviewModal()" style="padding:8px 20px;border:1px solid #ddd;background:#fff;border-radius:8px;font-size:13px;cursor:pointer;color:#555">Close</button>
          ${!_currentRecordLocked || currentRole==='superadmin' ? `<button onclick="closePreviewModal();saveRecord()" style="padding:8px 20px;background:#1e6b45;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">💾 Save Now</button>` : ''}
        </div>
      </div>
    </div>`);
}

function closePreviewModal() {
  document.getElementById('previewModal')?.remove();
}

async function saveRecord() {
  if (_currentRecordLocked && currentRole !== 'superadmin') {
    showToast('⚠ This record is locked. Ask superadmin to unlock it.', true);
    return;
  }
  const date    = document.getElementById('dateInput').value;
  if (!date) { showToast('⚠ Please select a date before saving.', true); return; }

  // Date validation
  const today = new Date(); today.setHours(0,0,0,0);
  const selected = new Date(date + 'T00:00:00');
  if (selected > today) { showToast('⚠ Cannot save a record for a future date.', true); return; }
  const diffDays = Math.floor((today - selected) / 86400000);
  if (diffDays > 7) {
    if (!confirm(`You are saving data for ${date}, which is ${diffDays} days ago. Continue?`)) return;
  }

  const saleQty = parseFloat(document.getElementById('saleQtyInput').value) || 0;
  if (!(saleQty > 0)) {
    if (!confirm('⚠ Sale Quantity is empty — MPK cannot be calculated without it.\n\nSave anyway without Sale Quantity?')) return;
  }
  const att     = totalAtt(), kg = totalKG(), total = att + kg;
  const mpk     = saleQty > 0 ? r2(total / saleQty) : null;

  const attendance = ATT_VENDORS.map(v => ({
    contractorName: v,
    workers: attState[v].workers || 0,
    cost:    parseFloat(attState[v].cost) || 0,
  }));

  const kgEntries = [];
  KG_VENDORS.forEach(v => {
    (SKU_CFG[v] || []).forEach(([name, rate], i) => {
      const qty = kgState[v]?.[i] || 0;
      if (qty > 0) kgEntries.push({ vendorName: v, skuName: name, rate, qty, cost: r2(qty * rate) });
    });
    customSKUs[v].forEach(sku => {
      if ((sku.qty || 0) > 0)
        kgEntries.push({ vendorName: v, skuName: sku.name, rate: sku.rate, qty: sku.qty, cost: r2(sku.qty * sku.rate) });
    });
    const ul = unloadingCosts[v] || 0;
    if (ul > 0) kgEntries.push({ vendorName: v, skuName: '__UNLOADING__', rate: 1, qty: ul, cost: r2(ul) });
  });

  try {
    await api('POST', '/api/records', {
      date, attendanceCost: att, kgCost: kg, totalCost: total, saleQty, mpk,
      attendance, kgEntries,
    });
    _isDirty = false;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const lbl = document.getElementById('lastSavedLabel');
    if (lbl) { lbl.textContent = 'Saved at ' + timeStr; lbl.style.display = ''; }
    showToast('✓ Record saved for ' + date, false);
    loadHistory();
  } catch (e) {
    showToast('⚠ Save failed: ' + e.message, true);
  }
}

async function silentLoadRecord(date) {
  try {
    const record = await api('GET', '/api/records/' + date);
    applyRecord(record);
    showToast('✓ Loaded saved record for ' + date, false);
  } catch {
    // 404 = no record yet, fine
  }
}

async function reloadTodayData() {
  const date = document.getElementById('dateInput').value;
  if (!date) { showToast('⚠ Select a date first', true); return; }
  const btn = document.getElementById('reloadBtn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  clearForm();
  await silentLoadRecord(date);
  if (btn) { btn.textContent = '🔄'; btn.disabled = false; }
}

function applyRecord(record) {
  if (_freshCSVLoaded) {
    // CSV was just uploaded — keep CSV attendance data, only add contractors from saved
    // record that aren't already in the CSV list (so nothing disappears)
    const savedVendors = (record.attendance || []).map(a => a.contractor_name);
    savedVendors.forEach(v => {
      if (!ATT_VENDORS.includes(v)) {
        ATT_VENDORS.push(v);
        const a = record.attendance.find(x => x.contractor_name === v);
        attState[v] = { workers: a?.workers || 0, cost: parseFloat(a?.cost) || 0, designations: {} };
      }
    });
  } else {
    // Loading a saved record directly (no fresh CSV) — restore attendance from record
    ATT_VENDORS = (record.attendance || []).map(a => a.contractor_name);
    ATT_VENDORS.forEach(v => {
      const a = (record.attendance || []).find(x => x.contractor_name === v);
      attState[v] = { workers: a ? (a.workers || 0) : 0, cost: a ? parseFloat(a.cost) || 0 : 0, designations: {} };
    });
  }

  KG_VENDORS.forEach(v => { kgState[v] = new Array((SKU_CFG[v] || []).length).fill(0); });
  customSKUs_resetQty();

  // Track if any saved rate differs from current rate
  let rateChanged = false;
  (record.kgEntries || []).forEach(e => {
    const v   = e.vendor_name;
    const qty = parseFloat(e.qty) || 0;
    if (e.sku_name === '__UNLOADING__') {
      if (v in unloadingCosts) unloadingCosts[v] = qty;
      return;
    }
    const idx = SKU_CFG[v]?.findIndex(([name]) => name === e.sku_name);
    if (idx >= 0) {
      if (!kgState[v]) kgState[v] = new Array((SKU_CFG[v] || []).length).fill(0);
      kgState[v][idx] = qty;
      // If saved rate differs from current, temporarily use saved rate for accurate display
      const savedRate = parseFloat(e.rate);
      const currentRate = SKU_CFG[v][idx][1];
      if (!isNaN(savedRate) && Math.abs(savedRate - currentRate) > 0.001) {
        rateChanged = true;
        SKU_CFG[v][idx][1] = savedRate; // use saved rate for display
      }
    } else {
      const cs = customSKUs[v]?.find(s => s.name === e.sku_name);
      if (cs) {
        cs.qty = qty; if (e.rate) cs.rate = parseFloat(e.rate);
        // Case count isn't stored server-side (only the resulting litres/kg are) — back-derive
        // it from the saved qty so the "Cases" input shows something sensible on reload.
        if (cs.caseSize > 0) cs.cases = +(qty / cs.caseSize).toFixed(3);
      }
    }
  });
  _rateChangedOnLoad = rateChanged;
  const banner = document.getElementById('rateChangeBanner');
  if (banner) banner.style.display = rateChanged ? 'flex' : 'none';

  if (record.sale_qty != null) {
    document.getElementById('saleQtyInput').value = parseFloat(record.sale_qty) || '';
  }

  renderAtt();
  renderKGTabs();
  recalc();
  _currentRecordLocked = !!record?.locked;
  _updateLockUI();
}

function customSKUs_resetQty() {
  KG_VENDORS.forEach(v => {
    customSKUs[v].forEach(s => { s.qty = 0; s.cases = 0; });
    unloadingCosts[v] = 0;
  });
}

function clearForm() {
  // Reset attendance
  ATT_VENDORS = [];
  Object.keys(attState).forEach(k => delete attState[k]);
  // Reset KG quantities and unloading costs
  KG_VENDORS.forEach(v => {
    kgState[v] = new Array((SKU_CFG[v] || []).length).fill(0);
    customSKUs[v].forEach(s => { s.qty = 0; s.cases = 0; });
    unloadingCosts[v] = 0;
  });
  // Reset sale qty
  document.getElementById('saleQtyInput').value = '';
  _freshCSVLoaded = false;
  _isDirty = false;
  const lbl = document.getElementById('lastSavedLabel');
  if (lbl) lbl.style.display = 'none';
  renderAtt();
  renderKGTabs();
  recalc();
  _isDirty = false; // recalc sets dirty, reset after clear
  _currentRecordLocked = false;
  _rateChangedOnLoad = false;
  const banner = document.getElementById('rateChangeBanner');
  if (banner) banner.style.display = 'none';
  _updateLockUI();
}

async function recalcWithCurrentRates() {
  // Reload current rates from DB, then re-render tabs so new rates apply
  await loadSKURateOverrides();
  _rateChangedOnLoad = false;
  const banner = document.getElementById('rateChangeBanner');
  if (banner) banner.style.display = 'none';
  renderKGTabs();
  recalc();
  markDirty();
  showToast('↺ Costs recalculated with current rates. Review and save.', false);
}

function _updateLockUI() {
  const saveBtn = document.querySelector('.btn-save-rec');
  const lockBadge = document.getElementById('lockBadge');
  const entryCards = document.getElementById('entryCards');
  const saleQty = document.getElementById('saleQtyInput');
  const isLockedForUser = _currentRecordLocked && currentRole !== 'superadmin';
  if (_currentRecordLocked) {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.title = 'Record is locked by superadmin'; saveBtn.style.opacity = '0.45'; }
    if (lockBadge) lockBadge.style.display = '';
  } else {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.title = ''; saveBtn.style.opacity = ''; }
    if (lockBadge) lockBadge.style.display = 'none';
  }
  if (entryCards) entryCards.classList.toggle('locked-view', isLockedForUser);
  if (saleQty) saleQty.classList.toggle('locked-input', saleQtyLocked());
}

async function lockAllRecords(lock) {
  const action = lock ? 'lock' : 'unlock';
  if (!confirm(`This will ${action} ALL saved records for this plant. Continue?`)) return;
  try {
    const pid = activePlantId || currentPlantId;
    const url = '/api/records/lock-all' + (pid ? '?plantId=' + pid : '');
    const result = await api('PATCH', url, { locked: lock });
    showToast(`${lock ? '🔒 Locked' : '🔓 Unlocked'} ${result.count} record${result.count !== 1 ? 's' : ''}`, false);
    loadHistory();
    // Update topbar if current date's record was affected
    _currentRecordLocked = lock;
    _updateLockUI();
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

async function toggleRecordLock(date, lock) {
  try {
    const pid = activePlantId || currentPlantId;
    const url = '/api/records/' + date + '/lock' + (pid ? '?plantId=' + pid : '');
    await api('PATCH', url, { locked: lock });
    showToast(lock ? '🔒 Record locked for ' + date : '🔓 Record unlocked for ' + date, false);
    loadHistory();
    const currentDate = document.getElementById('dateInput').value;
    if (currentDate === date) {
      _currentRecordLocked = lock;
      _updateLockUI();
    }
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

