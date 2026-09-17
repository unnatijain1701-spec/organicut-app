/* ═══════════════════════════════════════════════════════
   SIDEBAR NAVIGATION
═══════════════════════════════════════════════════════ */

function setActiveNav(section) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('nav' + section.charAt(0).toUpperCase() + section.slice(1));
  if (el) {
    el.classList.add('active');
    // Navigating straight to an Admin-group item (e.g. via a link) should reveal it
    if (el.classList.contains('nav-admin-item')) setAdminGroupOpen(true);
  }
}

function setAdminGroupOpen(open) {
  document.getElementById('navAdminItems').style.display = open ? '' : 'none';
  document.getElementById('navAdminToggle').querySelector('.nav-admin-toggle').classList.toggle('expanded', open);
  sessionStorage.setItem('navAdminOpen', open ? '1' : '');
}
function toggleAdminGroup() {
  setAdminGroupOpen(document.getElementById('navAdminItems').style.display === 'none');
}

function toggleMobileNav(force) {
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('navBackdrop');
  const open = (force === undefined) ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open', open);
  if (bd) bd.classList.toggle('open', open);
}

function navTo(section) {
  // On phones, close the slide-in drawer after choosing a section
  toggleMobileNav(false);
  // Warn if leaving daily entry with unsaved changes
  if (section !== 'daily' && _isDirty) {
    if (!confirm('You have unsaved changes. Leave without saving?')) return;
    _isDirty = false;
  }
  // Close any open right-panel / overlay first, then open the requested one
  closeDashboard();
  closeReport();
  closeTrend();
  toggleHistory(false);
  toggleVendorsPanel(false);
  toggleUsersPanel(false);
  setActiveNav(section);
  switch (section) {
    case 'daily':     /* main is always visible — nothing to open */ break;
    case 'dashboard': loadDashboard();          break;
    case 'report':    openReport();             break;
    case 'trend':     openTrend();              break;
    case 'history':   toggleHistory(true);      break;
    case 'vendors':   toggleVendorsPanel(true); break;
    case 'users':     toggleUsersPanel(true);   break;
  }
}

// Legacy no-ops kept so older inline handlers don't throw (dropdown removed)
function closeUserDd() {}

/* ═══════════════════════════════════════════════════════
   HISTORY PANEL
═══════════════════════════════════════════════════════ */

let historyOpen = false;

function toggleHistory(force) {
  historyOpen = force !== undefined ? force : !historyOpen;
  document.getElementById('historyPanel').classList.toggle('open', historyOpen);
  if (historyOpen) loadHistory();
  else setActiveNav('daily');
}

async function loadHistory() {
  const isAllPlants = !currentPlantId && !activePlantId;
  if (isAllPlants) {
    loadHistoryPlantPicker();
    return;
  }
  await loadHistoryRecords();
}

async function loadHistoryPlantPicker() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="hist-empty">Loading plants…</div>';
  try {
    let plants = await fetch('/api/auth/plants', { credentials: 'include' }).then(r => r.json());
    // Scoped to one business (e.g. "RTE — All Locations")? Only show that business's plants.
    if (activeBizType) plants = plants.filter(p => p.business_type === activeBizType);
    list.innerHTML = `
      <div style="padding:12px 14px 6px;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.5px">SELECT A PLANT</div>
      ${plants.map(p => `
        <div class="hist-item" style="cursor:pointer" onclick="loadHistoryForPlant(${p.id},'${p.name}')">
          <div class="hist-item-body" style="flex:1">
            <div class="hist-date">${p.name}</div>
            <div class="hist-meta"><span>Tap to view records</span></div>
          </div>
          <span style="color:var(--muted);font-size:18px;padding-right:4px">›</span>
        </div>`).join('')}`;
  } catch (e) {
    list.innerHTML = `<div class="hist-empty">Failed to load plants: ${e.message}</div>`;
  }
}

async function loadHistoryForPlant(plantId, plantName) {
  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="hist-empty">Loading…</div>';
  try {
    const records = await fetch(`/api/records?plantId=${plantId}`, { credentials: 'include' }).then(r => r.json());
    const backBtn = `<div style="padding:10px 14px;border-bottom:1px solid var(--border)">
      <button onclick="loadHistoryPlantPicker()" style="background:none;border:none;color:var(--primary);font-weight:700;cursor:pointer;font-size:13px">‹ ${activeBizType ? 'All ' + activeBizType + ' Locations' : 'All Plants'}</button>
      <span style="font-weight:700;font-size:13px;margin-left:8px">${plantName}</span>
    </div>`;
    if (!records.length) {
      list.innerHTML = backBtn + '<div class="hist-empty">No records for this plant yet.</div>';
      return;
    }
    const nowKey = new Date().toISOString().slice(0, 7);
    const groups = {};
    records.forEach(r => {
      const key = (r.record_date + '').slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    const monthsHTML = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(key => {
      const [yr, mo] = key.split('-');
      const monthName = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const isCurrentMonth = key === nowKey;
      const rowsHTML = groups[key].map(r => {
        const d = new Date(r.record_date);
        const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const cleanDate = (r.record_date + '').slice(0, 10);
        return `<div class="hist-item">
          <div class="hist-item-body" onclick="loadHistoryRecordForPlant('${cleanDate}',${plantId})">
            <div class="hist-date">${dateStr}</div>
            <div class="hist-meta">
              <span>Total: ${fc(parseFloat(r.total_cost))}</span>
              <span>MPK: ${parseFloat(r.mpk) > 0 ? fn(parseFloat(r.mpk)) : '—'}</span>
            </div>
          </div>
        </div>`;
      }).join('');
      return `<div class="hist-month">
        <div class="hist-month-hdr ${isCurrentMonth ? 'open' : ''}" onclick="toggleHistMonth(this)">
          <span>${monthName}</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span class="hist-month-count">${groups[key].length} day${groups[key].length > 1 ? 's' : ''}</span>
            <span class="hist-month-arrow">▼</span>
          </span>
        </div>
        <div class="hist-month-body ${isCurrentMonth ? 'open' : ''}">${rowsHTML}</div>
      </div>`;
    }).join('');
    list.innerHTML = backBtn + monthsHTML;
  } catch (e) {
    list.innerHTML = `<div class="hist-empty">Failed to load: ${e.message}</div>`;
  }
}

async function loadHistoryRecordForPlant(date, plantId) {
  try {
    const record = await fetch(`/api/records/${date}?plantId=${plantId}`, { credentials: 'include' }).then(r => r.json());
    applyRecord(record);
    toggleHistory(false);
    showToast('✓ Loaded record for ' + date, false);
  } catch {
    showToast('⚠ No record found for this date', true);
  }
}

async function loadHistoryRecords() {
  const list = document.getElementById('historyList');
  try {
    const btQs = (!currentPlantId && !activePlantId && activeBizType)
      ? '?businessType=' + encodeURIComponent(activeBizType) : '';
    const records = await api('GET', '/api/records' + btQs);
    if (!records.length) {
      list.innerHTML = '<div class="hist-empty">No records saved yet.</div>';
      return;
    }
    const nowKey = new Date().toISOString().slice(0, 7);
    const groups = {};
    records.forEach(r => {
      const key = (r.record_date + '').slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    list.innerHTML = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(key => {
      const [yr, mo] = key.split('-');
      const monthName = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const isCurrentMonth = key === nowKey;
      const rowsHTML = groups[key].map(r => {
        const d = new Date(r.record_date);
        const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const cleanDate = (r.record_date + '').slice(0, 10);
        const isLocked = !!r.locked;
        const lockedStyle = (isLocked && currentRole !== 'superadmin') ? 'opacity:0.5;' : '';
        return `<div class="hist-item" style="${lockedStyle}">
          <div class="hist-item-body" onclick="loadHistoryRecord('${cleanDate}')">
            <div class="hist-date" style="${isLocked && currentRole !== 'superadmin' ? 'color:var(--muted)' : ''}">${dateStr}</div>
            <div class="hist-meta">
              <span>Total: ${fc(parseFloat(r.total_cost))}</span>
              <span>MPK: ${parseFloat(r.mpk) > 0 ? fn(parseFloat(r.mpk)) : '—'}</span>
              ${r.updated_by ? `<span style="color:var(--muted);font-size:10px">by ${r.updated_by}</span>` : ''}
            </div>
          </div>
          ${currentRole === 'superadmin' ? `
            <button class="hist-lock-btn" title="${isLocked ? 'Unlock this record' : 'Lock this record'}" onclick="event.stopPropagation();toggleRecordLock('${cleanDate}',${isLocked ? 'false' : 'true'})">${isLocked ? '🔒' : '🔓'}</button>
            <button class="hist-del-btn" title="Delete this record" onclick="deleteHistoryRecord('${cleanDate}')">🗑</button>` : ''}
          ${currentRole !== 'superadmin' && isLocked ? `<span title="Locked by admin" style="font-size:13px;flex-shrink:0">🔒</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="hist-month">
        <div class="hist-month-hdr ${isCurrentMonth ? 'open' : ''}" onclick="toggleHistMonth(this)">
          <span>${monthName}</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span class="hist-month-count">${groups[key].length} day${groups[key].length > 1 ? 's' : ''}</span>
            <span class="hist-month-arrow">▼</span>
          </span>
        </div>
        <div class="hist-month-body ${isCurrentMonth ? 'open' : ''}">${rowsHTML}</div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="hist-empty">Failed to load records.</div>';
  }
}

function toggleHistMonth(hdr) {
  hdr.classList.toggle('open');
  hdr.nextElementSibling.classList.toggle('open');
}

async function loadHistoryRecord(date) {
  try {
    const cleanDate = (date || '').slice(0, 10);
    const record = await api('GET', '/api/records/' + cleanDate);
    document.getElementById('dateInput').value = cleanDate;
    applyRecord(record);
    toggleHistory(false);
    showToast('✓ Loaded record for ' + cleanDate, false);
  } catch (e) {
    showToast('⚠ Failed to load record: ' + e.message, true);
  }
}

async function deleteHistoryRecord(date) {
  if (!confirm('Delete record for ' + date + '?\nThis cannot be undone.')) return;
  try {
    await api('DELETE', '/api/records/' + date);
    showToast('✓ Deleted record for ' + date, false);
    loadHistory();
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

