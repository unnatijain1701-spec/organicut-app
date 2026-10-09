/* ═══════════════════════════════════════════════════════
   WORKER TYPES — settings panel & rates management
   Accessible to superadmin + users with manage_vendors permission.
   Rates are per-plant and drive auto-calculation in the attendance table.
═══════════════════════════════════════════════════════ */

let workerTypesPanelOpen = false;

// In-memory cache of worker types for the current plant.
// Also consumed by daily-entry.js to auto-calculate attendance costs.
let _workerTypesCache = [];   // [{ id, name, rate, display_order }, …]

function toggleWorkerTypesPanel(force) {
  workerTypesPanelOpen = (force !== undefined) ? force : !workerTypesPanelOpen;
  document.getElementById('workerTypesPanel').style.display = workerTypesPanelOpen ? 'flex' : 'none';
  if (workerTypesPanelOpen) loadWorkerTypesList();
  else setActiveNav('daily');
}

/* ── load & render ── */

async function loadWorkerTypes() {
  const pid = currentPlantId || activePlantId;
  if (!pid) { _workerTypesCache = []; return; }
  try {
    const qs = '?plantId=' + pid;
    _workerTypesCache = await api('GET', '/api/worker-types' + qs);
  } catch (e) {
    console.error('Failed to load worker types:', e.message);
    _workerTypesCache = [];
  }
}

async function loadWorkerTypesList() {
  await loadWorkerTypes();
  renderWorkerTypesList();
}

function renderWorkerTypesList() {
  const list = document.getElementById('workerTypesList');
  if (!list) return;
  const pid = currentPlantId || activePlantId;
  const plantLabel = (pid && PLANTS_BY_ID[pid]) ? PLANTS_BY_ID[pid].name : 'this plant';

  if (!pid) {
    list.innerHTML = '<div class="hist-empty">Please select a plant to manage its worker types.</div>';
    return;
  }

  if (!_workerTypesCache.length) {
    list.innerHTML = '<div class="hist-empty">No worker types yet. Add one using the form on the right.</div>';
    return;
  }

  list.innerHTML = `
    <div style="padding:10px 16px 6px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">
      ${plantLabel} — ${_workerTypesCache.length} type${_workerTypesCache.length !== 1 ? 's' : ''}
    </div>
    <div class="wt-list">
      ${_workerTypesCache.map(wt => renderWorkerTypeRow(wt)).join('')}
    </div>`;
}

function renderWorkerTypeRow(wt) {
  const safeId = wt.id;
  return `<div class="wt-row" id="wtRow_${safeId}">
    <div class="wt-row-info">
      <div class="wt-row-name">${escHtml(wt.name)}</div>
      <div class="wt-row-rate">₹ ${parseFloat(wt.rate).toFixed(2)} / day</div>
    </div>
    <div class="wt-row-actions">
      <button class="loc-rename-btn" onclick="startEditWorkerType(${safeId})" title="Edit">✎</button>
      <button class="loc-rename-btn" style="color:#b04040" onclick="deleteWorkerType(${safeId},'${wt.name.replace(/'/g,"\\'")}')" title="Delete">🗑</button>
    </div>
  </div>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── add ── */

async function addWorkerType() {
  const nameEl = document.getElementById('newWorkerTypeName');
  const rateEl = document.getElementById('newWorkerTypeRate');
  const errEl  = document.getElementById('workerTypesFormErr');
  if (!nameEl || !rateEl) return;
  errEl.textContent = '';
  const name = nameEl.value.trim();
  const rate = parseFloat(rateEl.value) || 0;
  if (!name) { errEl.textContent = 'Worker type name is required.'; return; }

  const pid = currentPlantId || activePlantId;
  try {
    const wt = await api('POST', '/api/worker-types?plantId=' + pid, { name, rate });
    _workerTypesCache.push(wt);
    nameEl.value = '';
    rateEl.value = '';
    renderWorkerTypesList();
    showToast('✓ Worker type "' + name + '" added', false);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

/* ── inline edit ── */

function startEditWorkerType(id) {
  const wt = _workerTypesCache.find(x => x.id === id);
  const row = document.getElementById('wtRow_' + id);
  if (!wt || !row) return;
  row.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;width:100%">
      <div style="display:flex;gap:6px;align-items:center">
        <input class="loc-rename-input" id="wtNameInp_${id}" value="${escHtml(wt.name)}" style="flex:1"
          onkeydown="if(event.key==='Enter')saveEditWorkerType(${id});if(event.key==='Escape')renderWorkerTypesList()">
        <input type="number" min="0" step="0.01" class="loc-rename-input" id="wtRateInp_${id}" value="${parseFloat(wt.rate).toFixed(2)}"
          style="width:90px" placeholder="₹/day"
          onkeydown="if(event.key==='Enter')saveEditWorkerType(${id});if(event.key==='Escape')renderWorkerTypesList()">
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn-save" onclick="saveEditWorkerType(${id})">✓ Save</button>
        <button class="btn-cancel" onclick="renderWorkerTypesList()">✕</button>
      </div>
    </div>`;
  document.getElementById('wtNameInp_' + id)?.focus();
}

async function saveEditWorkerType(id) {
  const nameEl = document.getElementById('wtNameInp_' + id);
  const rateEl = document.getElementById('wtRateInp_' + id);
  const name = nameEl?.value.trim();
  const rate = parseFloat(rateEl?.value) || 0;
  if (!name) { showToast('⚠ Name cannot be empty', true); return; }
  const pid = currentPlantId || activePlantId;
  try {
    const updated = await api('PATCH', '/api/worker-types/' + id + '?plantId=' + pid, { name, rate });
    const idx = _workerTypesCache.findIndex(x => x.id === id);
    if (idx !== -1) _workerTypesCache[idx] = updated;
    renderWorkerTypesList();
    showToast('✓ Updated "' + name + '"', false);
    // Re-render attendance to pick up new rate immediately
    if (typeof renderAtt === 'function') renderAtt();
  } catch (e) {
    showToast('⚠ ' + e.message, true);
    renderWorkerTypesList();
  }
}

/* ── delete ── */

async function deleteWorkerType(id, name) {
  if (!confirm(`Delete worker type "${name}"?\n\nExisting saved records won't be affected — only future entries will stop using this rate.`)) return;
  const pid = currentPlantId || activePlantId;
  try {
    await api('DELETE', '/api/worker-types/' + id + '?plantId=' + pid);
    _workerTypesCache = _workerTypesCache.filter(x => x.id !== id);
    renderWorkerTypesList();
    showToast('✓ Deleted "' + name + '"', false);
    if (typeof renderAtt === 'function') renderAtt();
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}
