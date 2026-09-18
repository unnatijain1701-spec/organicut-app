/* ═══════════════════════════════════════════════════════
   VENDOR MANAGEMENT PANEL
═══════════════════════════════════════════════════════ */

let vendorsPanelOpen = false;
let _allVendorsCache = null;

function toggleVendorsPanel(force) {
  vendorsPanelOpen = (force !== undefined) ? force : !vendorsPanelOpen;
  document.getElementById('vendorsPanel').style.display = vendorsPanelOpen ? 'flex' : 'none';
  if (vendorsPanelOpen) loadVendorsList();
  else setActiveNav('daily');
}

function applyVendorsFilter() {
  if (!_allVendorsCache) return;
  const q = (document.getElementById('vendorsSearchInput')?.value || '').trim().toLowerCase();
  const vendors = q
    ? _allVendorsCache.filter(v =>
        v.name.toLowerCase().includes(q) ||
        (customSKUs[v.name] || []).some(s => s.name.toLowerCase().includes(q)))
    : _allVendorsCache;
  renderVendorsList(vendors, _allVendorsCache.length, q);
}

function renderVendorsList(vendors, totalCount, q) {
  const list = document.getElementById('vendorsList');
  totalCount = totalCount ?? vendors.length;
  q = q || '';
  if (!vendors.length) {
    list.innerHTML = `<div class="hist-empty">${totalCount ? 'No vendors match your search.' : 'No vendors yet.'}</div>`;
    return;
  }
  const cards = vendors.map(v => {
    const vn = v.name, ve = vn.replace(/'/g, "\\'");
    const pvid = 'pv_' + vid(vn);
    const allSkus = customSKUs[vn] || [];
    // A search that matches the vendor's own name shows every SKU (browsing that
    // vendor); a search that only matches by SKU name shows just the matching
    // SKU(s), not the vendor's whole list — otherwise a 1-word search on a vendor
    // with 100 SKUs dumps all 100 back at you instead of the one you searched for.
    const vendorNameMatches = q && vn.toLowerCase().includes(q);
    const skus = (q && !vendorNameMatches) ? allSkus.filter(s => s.name.toLowerCase().includes(q)) : allSkus;
    const filterHint = (q && !vendorNameMatches && allSkus.length)
      ? `<span style="font-size:10.5px;color:var(--muted);font-weight:400"> (${skus.length} of ${allSkus.length} SKUs match "${q}")</span>` : '';
    const skuRows = skus.length
      ? skus.map(s => `
          <div class="panel-sku-row" id="pskurow_${pvid}_${s.id}">
            <span class="panel-sku-name">${s.name}${s.caseSize > 0 ? `<span class="case-hint"> (${s.caseSize} ${bizUnitAbbr(activePlantBizType())}/${caseInputWord(activePlantBizType()).replace(/s$/,'').toLowerCase()})</span>` : ''}</span>
            <span class="panel-sku-rate">₹${s.rate.toFixed(2)}/${bizUnitAbbr(activePlantBizType())}</span>
            <button class="btn-edit-sku" onclick="startEditSKUInPanel('${ve}',${s.id})" title="Edit">✎</button>
            <button class="btn-del"      onclick="deleteSKUFromPanel('${ve}',${s.id})"  title="Remove">×</button>
          </div>`).join('')
      : (allSkus.length ? '<div class="no-custom-skus">No SKUs match your search</div>' : '<div class="no-custom-skus">No custom SKUs yet</div>');
    return `
      <div class="vendor-section">
        <div class="vendor-section-header">
          <span class="vendor-section-name">${vn}${filterHint}</span>
          ${totalCount > 1
            ? `<button class="user-del-btn" onclick="deleteVendor(${v.id},'${ve}')">Delete vendor</button>`
            : '<span style="font-size:11px;color:var(--muted)">last vendor</span>'}
        </div>
        <div class="vendor-skus">
          <div id="pskus_${pvid}">${skuRows}</div>
          <div id="panelAddSkuForm_${pvid}" style="display:none" class="panel-add-sku-form">
            <input id="panelSkuName_${pvid}" placeholder="SKU name" style="flex:1;min-width:120px"
              onkeydown="if(event.key==='Enter')addSKUFromPanel('${ve}');if(event.key==='Escape')cancelPanelAddSKU('${ve}')">
            <input id="panelSkuRate_${pvid}" type="number" placeholder="₹/${bizUnitAbbr(activePlantBizType())}" min="0" step="0.01" style="width:90px"
              onkeydown="if(event.key==='Enter')addSKUFromPanel('${ve}');if(event.key==='Escape')cancelPanelAddSKU('${ve}')">
            <input id="panelSkuCaseSize_${pvid}" type="number" placeholder="${bizUnitAbbr(activePlantBizType())}/${caseInputWord(activePlantBizType()).replace(/s$/,'').toLowerCase()} (optional)" min="0" step="0.01" style="width:150px"
              onkeydown="if(event.key==='Enter')addSKUFromPanel('${ve}');if(event.key==='Escape')cancelPanelAddSKU('${ve}')">
            <button class="btn-save"   onclick="addSKUFromPanel('${ve}')">Save</button>
            <button class="btn-cancel" onclick="cancelPanelAddSKU('${ve}')">Cancel</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
            <button class="btn-ghost" id="panelAddSkuBtn_${pvid}"
              onclick="showPanelAddSKUForm('${ve}')" style="font-size:12px">+ Add custom SKU</button>
            <button class="btn-ghost" onclick="document.getElementById('bulkSkuFileInput_${pvid}').click()" style="font-size:12px">⬆ Bulk upload SKUs</button>
            <input type="file" id="bulkSkuFileInput_${pvid}" accept=".csv,.xlsx,.xls" style="display:none"
              onchange="bulkUploadSKUs('${ve}', this)">
          </div>
        </div>
      </div>`;
  }).join('');
  list.innerHTML = `<div class="vendor-card-grid">${cards}</div>`;
}

async function loadVendorsList() {
  const list = document.getElementById('vendorsList');
  list.innerHTML = '<div class="hist-empty">Loading…</div>';
  try {
    _allVendorsCache = await api('GET', '/api/vendors');
    try {
      applyVendorsFilter();
    } catch (re) {
      list.innerHTML = `<div class="hist-empty">Render error: ${re.message}</div>`;
    }
  } catch (e) {
    list.innerHTML = `<div class="hist-empty">API error: ${e.message}</div>`;
  }
}

/* ── Panel SKU management ── */

function showPanelAddSKUForm(v) {
  const pvid = 'pv_' + vid(v);
  document.getElementById('panelAddSkuForm_' + pvid).style.display = 'flex';
  document.getElementById('panelAddSkuBtn_'  + pvid).style.display = 'none';
  document.getElementById('panelSkuName_'    + pvid).focus();
}
function cancelPanelAddSKU(v) {
  const pvid = 'pv_' + vid(v);
  document.getElementById('panelAddSkuForm_' + pvid).style.display = 'none';
  document.getElementById('panelAddSkuBtn_'  + pvid).style.display = '';
  document.getElementById('panelSkuName_'    + pvid).value = '';
  document.getElementById('panelSkuRate_'    + pvid).value = '';
  document.getElementById('panelSkuCaseSize_' + pvid).value = '';
}
async function addSKUFromPanel(v) {
  const pvid = 'pv_' + vid(v);
  const name = document.getElementById('panelSkuName_' + pvid).value.trim();
  const rate = parseFloat(document.getElementById('panelSkuRate_' + pvid).value) || 0;
  const caseSize = parseFloat(document.getElementById('panelSkuCaseSize_' + pvid).value) || 0;
  if (!name) { showToast('⚠ Enter a SKU name.', true); return; }
  try {
    const result = await api('POST', '/api/sku', { vendorName: v, skuName: name, rate, caseSize });
    if (!customSKUs[v]) customSKUs[v] = [];
    customSKUs[v].push({ id: result.id, name: result.name, rate: result.rate, qty: 0, caseSize: result.caseSize || 0, cases: 0 });
    refreshPane(v);
    loadVendorsList();
    showToast('✓ SKU added', false);
  } catch (e) { showToast('⚠ ' + e.message, true); }
}
async function bulkUploadSKUs(v, inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('vendorName', v);
  try {
    const result = await api('POST', '/api/sku/bulk', fd);
    if (!customSKUs[v]) customSKUs[v] = [];
    const existingIds = new Set(customSKUs[v].map(s => s.id));
    result.skus.forEach(s => {
      if (existingIds.has(s.id)) {
        const idx = customSKUs[v].findIndex(x => x.id === s.id);
        customSKUs[v][idx] = { ...customSKUs[v][idx], name: s.name, rate: s.rate, caseSize: s.caseSize };
      } else {
        customSKUs[v].push({ id: s.id, name: s.name, rate: s.rate, qty: 0, caseSize: s.caseSize || 0, cases: 0 });
      }
    });
    refreshPane(v);
    loadVendorsList();
    showToast(`✓ Added ${result.count} SKU${result.count === 1 ? '' : 's'}`, false);
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  } finally {
    inputEl.value = '';
  }
}

async function deleteSKUFromPanel(v, skuId) {
  try {
    await api('DELETE', '/api/sku/' + skuId);
    customSKUs[v] = (customSKUs[v] || []).filter(s => s.id !== skuId);
    refreshPane(v);
    loadVendorsList();
    showToast('✓ SKU removed', false);
  } catch (e) { showToast('⚠ ' + e.message, true); }
}
function startEditSKUInPanel(v, skuId) {
  const pvid = 'pv_' + vid(v), ve = v.replace(/'/g, "\\'");
  const row = document.getElementById('pskurow_' + pvid + '_' + skuId);
  if (!row) return;
  const sku = (customSKUs[v] || []).find(s => s.id === skuId);
  if (!sku) return;
  row.innerHTML = `
    <input class="sku-edit-inp" id="peSkuName_${pvid}_${skuId}" value="${sku.name.replace(/"/g,'&quot;')}"
      style="flex:1;min-width:100px" onkeydown="if(event.key==='Enter')saveEditSKUInPanel('${ve}',${skuId})">
    <input class="sku-edit-inp" id="peSkuRate_${pvid}_${skuId}" type="number" value="${sku.rate}" min="0" step="0.01"
      style="width:80px" onkeydown="if(event.key==='Enter')saveEditSKUInPanel('${ve}',${skuId})">
    <input class="sku-edit-inp" id="peSkuCaseSize_${pvid}_${skuId}" type="number" value="${sku.caseSize||''}" min="0" step="0.01"
      placeholder="per case" style="width:80px" onkeydown="if(event.key==='Enter')saveEditSKUInPanel('${ve}',${skuId})">
    <button class="btn-save"   onclick="saveEditSKUInPanel('${ve}',${skuId})">✓</button>
    <button class="btn-cancel" onclick="loadVendorsList()">✕</button>`;
  document.getElementById('peSkuName_' + pvid + '_' + skuId).focus();
}
async function saveEditSKUInPanel(v, skuId) {
  const pvid = 'pv_' + vid(v);
  const name = document.getElementById('peSkuName_' + pvid + '_' + skuId)?.value.trim();
  const rate = parseFloat(document.getElementById('peSkuRate_' + pvid + '_' + skuId)?.value) || 0;
  const caseSize = parseFloat(document.getElementById('peSkuCaseSize_' + pvid + '_' + skuId)?.value) || 0;
  if (!name) { showToast('⚠ Enter a SKU name.', true); return; }
  try {
    const result = await api('PATCH', '/api/sku/' + skuId, { skuName: name, rate, caseSize });
    const sku = (customSKUs[v] || []).find(s => s.id === skuId);
    if (sku) { sku.name = result.name; sku.rate = result.rate; sku.caseSize = result.caseSize || 0; }
    refreshPane(v);
    loadVendorsList();
    showToast('✓ SKU updated', false);
  } catch (e) { showToast('⚠ ' + e.message, true); }
}

async function addVendor() {
  const name  = document.getElementById('newVendorName').value.trim();
  const errEl = document.getElementById('vendorsFormErr');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Vendor name is required.'; return; }
  try {
    const v = await api('POST', '/api/vendors', { name });
    document.getElementById('newVendorName').value = '';
    KG_VENDORS.push(v.name);
    kgState[v.name]        = new Array((SKU_CFG[v.name] || []).length).fill(0);
    customSKUs[v.name]     = [];
    unloadingCosts[v.name] = 0;
    activeTab = v.name;
    renderKGTabs();
    recalc();
    loadVendorsList();
    showToast('✓ Added vendor "' + v.name + '"', false);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function deleteVendor(id, name) {
  if (!confirm('Remove vendor "' + name + '"?\nAll unsaved KG data for this vendor will be cleared.')) return;
  try {
    await api('DELETE', '/api/vendors/' + id);
    KG_VENDORS = KG_VENDORS.filter(v => v !== name);
    delete kgState[name];
    delete customSKUs[name];
    delete unloadingCosts[name];
    if (activeTab === name) activeTab = KG_VENDORS[0] || '';
    renderKGTabs();
    recalc();
    loadVendorsList();
    showToast('✓ Removed vendor "' + name + '"', false);
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

