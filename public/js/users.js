/* ═══════════════════════════════════════════════════════
   USER MANAGEMENT
═══════════════════════════════════════════════════════ */

let usersPanelOpen = false;

// Granular permission keys a superadmin (or anyone holding manage_users) can
// mix-and-match onto a user. Must mirror src/utils/permissions.js ALL_PERMISSIONS.
const PERMISSION_DEFS = [
  { key: 'manage_locations', label: 'Manage locations', hint: 'Create and edit locations' },
  { key: 'delete_locations', label: 'Delete locations', hint: 'Superadmin-only to grant' },
  { key: 'manage_users',     label: 'Manage users',     hint: 'Superadmin-only to grant' },
  { key: 'manage_vendors',   label: 'Manage vendors',   hint: 'Vendors, SKUs & bulk upload' },
  { key: 'view_reports',     label: 'View reports',     hint: 'Multi-plant Report / Compare' },
  { key: 'view_cost_trend',  label: 'View cost trend',  hint: 'Multi-plant Cost Trend view' },
  { key: 'manage_records',   label: 'Lock/delete records', hint: 'Lock, unlock, delete & view audit log' },
];
const SUPERADMIN_ONLY_PERMS = new Set(['manage_users', 'delete_locations']);

function toggleUsersPanel(force) {
  usersPanelOpen = (force !== undefined) ? force : !usersPanelOpen;
  document.getElementById('usersPanel').style.display = usersPanelOpen ? 'flex' : 'none';
  if (usersPanelOpen) loadUsersPanel();
  else setActiveNav('daily');
}

let allPlantsCache = null;

async function loadUsersPanel() {
  const canManageLocations = hasPerm('manage_locations') || hasPerm('delete_locations');
  const canManageUsers = hasPerm('manage_users');
  document.getElementById('addLocationToggleBtn').style.display = canManageLocations ? '' : 'none';
  document.getElementById('addUserToggleBtn').style.display = canManageUsers ? '' : 'none';
  if (currentRole === 'superadmin' && !allPlantsCache) {
    try { allPlantsCache = await api('GET', '/api/auth/plants'); } catch { allPlantsCache = []; }
  }
  loadUsers();
}

/* ─────────────────────── Locations popup ─────────────────────── */

async function openLocationsModal() {
  if (!allPlantsCache) {
    try { allPlantsCache = await api('GET', '/api/auth/plants'); } catch { allPlantsCache = []; }
  }
  const canDelete = currentRole === 'superadmin' || (currentPermissions || []).includes('delete_locations');

  document.getElementById('locationsModal')?.remove();
  const modalHtml = `<div id="locationsModal" class="modal-overlay">
    <div class="modal-box" style="max-width:460px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:700;font-size:16px">📍 Locations</div>
        <button id="locModalCloseBtn" class="modal-x">×</button>
      </div>
      <div id="locationsListWrap"></div>
      <div class="users-add-form" style="margin-top:14px">
        <div class="users-add-title">Add New Location</div>
        <input class="users-input" id="newLocationName" type="text" placeholder="Location name, e.g. Rai-522-FnV" autocomplete="off">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin:0 0 5px">BUSINESS TYPE</div>
        <div id="newLocationBizType" style="margin-bottom:10px"></div>
        <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text);margin-bottom:10px;cursor:pointer">
          <input type="checkbox" id="newLocationHasKg" checked style="cursor:pointer">
          Has per-unit processing cost
        </label>
        <div id="locationFormErr" class="users-form-err"></div>
        <button class="users-add-btn" onclick="addLocation()">Add Location</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  document.getElementById('locModalCloseBtn').onclick = () => document.getElementById('locationsModal').remove();
  document.getElementById('newLocationBizType').innerHTML = bizChipsHTML('newLocationBizType', '', 'null', { noAll: true });
  renderLocationsList(canDelete);
}

function renderLocationsList(canDelete) {
  const wrap = document.getElementById('locationsListWrap');
  if (!wrap) return;
  const plants = allPlantsCache || [];
  if (!plants.length) { wrap.innerHTML = '<div class="hist-empty" style="padding:10px 16px">No locations yet.</div>'; return; }
  wrap.innerHTML = plants.map(p => `
    <div class="loc-row" id="locRow_${p.id}">
      <span>
        <span class="loc-row-name" id="locName_${p.id}">${p.name}</span>
        <span class="loc-row-type">${p.business_type}${p.has_kg_processing === false ? ' · no per-unit cost' : ''}</span>
      </span>
      <span style="display:flex;gap:2px;flex-shrink:0">
        <button class="loc-rename-btn" onclick="startEditLocation(${p.id})" title="Edit">✎</button>
        ${canDelete ? `<button class="loc-rename-btn" onclick="deleteLocation(${p.id},'${p.name.replace(/'/g,"\\'")}')" title="Delete">🗑</button>` : ''}
      </span>
    </div>
  `).join('');
}

function startEditLocation(plantId) {
  const row = document.getElementById('locRow_' + plantId);
  if (!row) return;
  const plant = (allPlantsCache || []).find(p => p.id === plantId);
  if (!plant) return;
  row.innerHTML = `
    <div style="width:100%">
      <input class="loc-rename-input" id="locNameInput_${plantId}" value="${plant.name.replace(/"/g,'&quot;')}"
        style="width:100%;margin-bottom:6px"
        onkeydown="if(event.key==='Enter')saveEditLocation(${plantId});if(event.key==='Escape')renderLocationsList(true)">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="locHasKg_${plantId}" ${plant.has_kg_processing !== false ? 'checked' : ''} style="cursor:pointer">
        Has per-unit processing cost
      </label>
      <span style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn-save" onclick="saveEditLocation(${plantId})" title="Save">✓ Save</button>
        <button class="btn-cancel" onclick="renderLocationsList(true)" title="Cancel">✕</button>
      </span>
    </div>`;
  document.getElementById('locNameInput_' + plantId).focus();
}

async function saveEditLocation(plantId) {
  const input = document.getElementById('locNameInput_' + plantId);
  const name = input?.value.trim();
  const hasKgProcessing = document.getElementById('locHasKg_' + plantId)?.checked;
  if (!name) { showToast('⚠ Location name cannot be empty', true); return; }
  try {
    const plant = await api('PATCH', '/api/auth/plants/' + plantId, { name, hasKgProcessing });
    const idx = allPlantsCache.findIndex(p => p.id === plantId);
    if (idx !== -1) allPlantsCache[idx] = plant;
    PLANTS_BY_ID[plantId] = plant;
    renderLocationsList(true);
    renderPlantSelector();
    showToast(`✓ Updated "${plant.name}"`, false);
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

async function deleteLocation(plantId, name) {
  if (!confirm(`Delete location "${name}"?\nOnly works if it has no saved records and no users assigned. This cannot be undone.`)) return;
  try {
    await api('DELETE', '/api/auth/plants/' + plantId);
    allPlantsCache = (allPlantsCache || []).filter(p => p.id !== plantId);
    delete PLANTS_BY_ID[plantId];
    renderLocationsList(true);
    renderPlantSelector();
    showToast(`✓ Deleted "${name}"`, false);
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

async function addLocation() {
  const name = document.getElementById('newLocationName').value.trim();
  const businessType = bizChipValue('newLocationBizType');
  const hasKgProcessing = document.getElementById('newLocationHasKg').checked;
  const errEl = document.getElementById('locationFormErr');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Location name is required.'; return; }
  if (!businessType) { errEl.textContent = 'Please select a business type.'; return; }
  try {
    const plant = await api('POST', '/api/auth/plants', { name, businessType, hasKgProcessing });
    allPlantsCache = null;
    PLANTS_BY_ID[plant.id] = plant;
    document.getElementById('newLocationName').value = '';
    showToast(`✓ Location "${plant.name}" created`, false);
    await openLocationsModal();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

/* ─────────────────────── Add User popup ─────────────────────── */

function permissionCheckboxesHtml(selectedKeys, { restrictToGrantable } = {}) {
  const selSet = new Set(selectedKeys || []);
  const canGrant = key => !restrictToGrantable || currentRole === 'superadmin' ||
    ((currentPermissions || []).includes(key) && !SUPERADMIN_ONLY_PERMS.has(key));
  return PERMISSION_DEFS.map(p => {
    const grantable = canGrant(p.key);
    const locked = !grantable && SUPERADMIN_ONLY_PERMS.has(p.key);
    return `<label style="display:flex;align-items:flex-start;gap:8px;padding:5px 2px;font-size:13px;cursor:${grantable ? 'pointer' : 'not-allowed'};opacity:${grantable ? '1' : '.5'}">
      <input type="checkbox" class="perm-cb" value="${p.key}" ${selSet.has(p.key) ? 'checked' : ''} ${grantable ? '' : 'disabled'} style="margin-top:2px">
      <span>
        <div>${p.label}${locked ? ' 🔒' : ''}</div>
        <div style="font-size:11px;color:var(--muted)">${p.hint}</div>
      </span>
    </label>`;
  }).join('');
}

function openAddUserModal() {
  document.getElementById('addUserModal')?.remove();
  const modalHtml = `<div id="addUserModal" class="modal-overlay">
    <div class="modal-box" style="max-width:440px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:700;font-size:16px">➕ Add New User</div>
        <button id="addUserModalCloseBtn" class="modal-x">×</button>
      </div>
      <div class="users-add-form">
        <input class="users-input" id="newUsername" type="text" placeholder="Username" autocomplete="off">
        <input class="users-input" id="newPassword" type="password" placeholder="Password (min 6 chars)" autocomplete="new-password">
        <select class="users-input" id="newUserRole" style="cursor:pointer" onchange="onNewUserRoleChange(this.value)">
          <option value="user">Operator (can enter data)</option>
          <option value="admin">Admin (full access)</option>
          ${currentRole === 'superadmin' ? '<option value="superadmin">Superadmin (all plants, no restrictions)</option>' : ''}
        </select>
        <div id="newUserBizTypeField" style="display:none;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px">BUSINESS TYPE</div>
          <span id="newUserBizType"></span>
        </div>
        <div id="newUserPlant" style="display:none;border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;max-height:150px;overflow-y:auto;margin-bottom:10px"></div>
        <div id="newUserPermsField" style="display:none;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px">ADDITIONAL PERMISSIONS</div>
          <div id="newUserPerms" style="border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;max-height:220px;overflow-y:auto"></div>
        </div>
        <div id="usersFormErr" class="users-form-err"></div>
        <button class="users-add-btn" onclick="addUser()">Add User</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  document.getElementById('addUserModalCloseBtn').onclick = () => document.getElementById('addUserModal').remove();
  onNewUserRoleChange('user');
}

function onNewUserBizTypeChange() {
  const businessType = bizChipValue('newUserBizType');
  const wrap = document.getElementById('newUserPlant');
  const plants = (allPlantsCache || []).filter(p => p.business_type === businessType);
  wrap.innerHTML = plants.length
    ? plants.map(p => `
        <label style="display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:13px;cursor:pointer">
          <input type="checkbox" class="newuser-plant-cb" value="${p.id}">
          ${p.name}
        </label>`).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:4px 2px">No locations for this business type yet.</div>';
}

function onNewUserRoleChange(role) {
  const bizField = document.getElementById('newUserBizTypeField');
  const plantSel = document.getElementById('newUserPlant');
  const permsField = document.getElementById('newUserPerms');
  const permsWrap = document.getElementById('newUserPermsField');
  // Show business-type + plant selectors when creating non-superadmin users and current user has no plant (all-plants access)
  const show = (!currentPlantId && role !== 'superadmin');
  bizField.style.display = show ? '' : 'none';
  plantSel.style.display = show ? '' : 'none';
  if (show) {
    document.getElementById('newUserBizType').innerHTML = bizChipsHTML('newUserBizType', '', 'onNewUserBizTypeChange', { noAll: true });
    document.getElementById('newUserPlant').innerHTML = '';
  }
  const showPerms = role !== 'superadmin';
  permsWrap.style.display = showPerms ? '' : 'none';
  if (showPerms) permsField.innerHTML = permissionCheckboxesHtml([], { restrictToGrantable: true });
}

/* ─────────────────────── Users list ─────────────────────── */

let _allUsersCache = null;
let usersRoleFilter = '';   // '' = all roles

const ROLE_TABS = [
  { key: '',           label: 'All' },
  { key: 'user',        label: 'Operators' },
  { key: 'admin',       label: 'Admins' },
  { key: 'superadmin',  label: 'Superadmins' },
];

function renderUsersRoleTabs() {
  const wrap = document.getElementById('usersRoleTabs');
  if (!wrap) return;
  wrap.innerHTML = `<div class="biz-chips">` +
    ROLE_TABS.map(t => `<button type="button" class="biz-chip${t.key === usersRoleFilter ? ' active' : ''}"
      onclick="setUsersRoleFilter('${t.key}')">${t.label}</button>`).join('') +
    `</div>`;
}
function setUsersRoleFilter(role) {
  usersRoleFilter = role;
  renderUsersRoleTabs();
  applyUsersFilter();
}

async function loadUsers() {
  const list = document.getElementById('usersList');
  list.innerHTML = '<div class="hist-empty">Loading…</div>';
  renderUsersRoleTabs();
  try {
    _allUsersCache = await api('GET', '/api/auth/users');
    applyUsersFilter();
  } catch (e) {
    list.innerHTML = '<div class="hist-empty">Failed to load users.</div>';
  }
}

function toggleUserRowActions(userId) {
  const el = document.getElementById('urow_' + userId + '_actions');
  if (!el) return;
  const opening = el.style.display === 'none';
  // Only one row's actions open at a time, so the list doesn't grow unpredictably
  document.querySelectorAll('.user-row-actions').forEach(a => a.style.display = 'none');
  el.style.display = opening ? 'flex' : 'none';
}

function applyUsersFilter() {
  const list = document.getElementById('usersList');
  if (!_allUsersCache) return;
  const q = (document.getElementById('usersSearchInput')?.value || '').trim().toLowerCase();

  let users = _allUsersCache;
  if (usersRoleFilter) users = users.filter(u => u.role === usersRoleFilter);
  if (q) users = users.filter(u => u.username.toLowerCase().includes(q));

  if (!users.length) {
    list.innerHTML = `<div class="hist-empty">${_allUsersCache.length ? 'No users match your filters.' : 'No users found.'}</div>`;
    return;
  }

  const canManageUsers = currentRole === 'superadmin' || (currentPermissions || []).includes('manage_users');

  const renderUserRow = u => {
    const isYou   = u.username === currentUsername;
    const roleStyles = {
      superadmin: { label: 'SUPERADMIN', bg: '#7a1e5e', fg: '#fff' },
      admin:      { label: 'ADMIN',      bg: '#1e6b45', fg: '#fff' },
      user:       { label: 'OPERATOR',   bg: '#e4f3ea', fg: '#4a7a5e' },
    };
    const rs = roleStyles[u.role] || roleStyles.user;
    const badge = `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:6px;
      background:${rs.bg};color:${rs.fg}">${rs.label}</span>`;
    const plants = u.plants || (u.plant_name ? [{ name: u.plant_name }] : []);
    const plantBadge = u.role === 'superadmin'
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;margin-left:4px;background:#fff3cd;color:#856404">All Plants</span>`
      : plants.length === 1
        ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;margin-left:4px;background:#f0f7f4;color:#4a7a5e">${plants[0].name}</span>`
        : plants.length > 1
          ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;margin-left:4px;background:#f0f7f4;color:#4a7a5e;cursor:help" title="${plants.map(p=>p.name).join(', ')}">${plants.length} Plants</span>`
          : `<span style="font-size:10px;padding:2px 7px;border-radius:10px;margin-left:4px;background:#fee2e2;color:#991b1b">No plants assigned</span>`;
    const permCount = (u.permissions || []).length;
    const permBadge = (u.role !== 'superadmin' && permCount > 0)
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;margin-left:4px;background:#eef2ff;color:#3730a3;cursor:help" title="${(u.permissions||[]).join(', ')}">${permCount} permission${permCount===1?'':'s'}</span>`
      : '';
    const safeName = u.username.replace(/'/g,"\\'");
    const roleOpts = currentRole === 'superadmin'
      ? [['user','Operator'],['admin','Admin'],['superadmin','Superadmin']]
      : [['user','Operator'],['admin','Admin']];
    const roleSelect = (isYou || !canManageUsers) ? '' : `<select onchange="changeUserRole(${u.id},'${safeName}',this.value,'${u.role}')"
      style="font-size:11px;padding:2px 4px;border-radius:6px;border:1px solid var(--border);cursor:pointer;margin-right:2px">
      ${roleOpts.map(([v,l]) => `<option value="${v}"${u.role===v?' selected':''}>${l}</option>`).join('')}
    </select>`;
    const rowId = 'urow_' + u.id;
    const menuBtn = (isYou || !canManageUsers) ? '' : `<button class="user-row-menu-btn" onclick="toggleUserRowActions(${u.id})" title="Actions">⋮</button>`;
    const editPlantsBtn = (u.role !== 'superadmin')
      ? `<button class="user-del-btn" style="background:#e8f4ed;color:#1e6b45;border:none" onclick="openEditPlantsModal(${u.id},'${safeName}','${u.role}')" title="Edit plant access">📍</button>`
      : '';
    const editPermsBtn = (u.role !== 'superadmin')
      ? `<button class="user-del-btn" style="background:#eef2ff;color:#3730a3;border:none" onclick="openEditPermissionsModal(${u.id})" title="Edit permissions">🔑✦</button>`
      : '';
    const actionsRow = (isYou || !canManageUsers) ? '' : `<div class="user-row-actions" id="${rowId}_actions" style="display:none">
      ${roleSelect}
      <span style="display:flex;gap:4px">
        ${editPlantsBtn}
        ${editPermsBtn}
        <button class="user-del-btn" style="background:#e8f4ed;color:#1e6b45;border:none" onclick="resetUserPassword(${u.id},'${safeName}')">🔑</button>
        <button class="user-del-btn" onclick="deleteUser(${u.id},'${safeName}')">Delete</button>
      </span>
    </div>`;
    return `<div class="user-row" id="${rowId}">
      <div class="user-row-top">
        <div class="user-row-name">${u.username}${badge}${plantBadge}${permBadge}${isYou ? '<span class="user-row-you"> (you)</span>' : ''}</div>
        ${menuBtn}
      </div>
      ${actionsRow}
    </div>`;
  };

  if (currentRole !== 'superadmin') {
    // Single-location users only ever see their own group — no grouping needed
    list.innerHTML = `<div class="user-card-grid">${users.map(renderUserRow).join('')}</div>`;
    return;
  }

  const groups = {};
  const groupOrder = [];
  users.forEach(u => {
    const key = u.business_type || 'All Business Types';
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(u);
  });
  groupOrder.sort((a, b) => a === 'All Business Types' ? 1 : b === 'All Business Types' ? -1 : a.localeCompare(b));

  list.innerHTML = groupOrder.map(key => `
    <div class="users-group">
      <div class="users-group-title">${key}</div>
      <div class="user-card-grid">${groups[key].map(renderUserRow).join('')}</div>
    </div>
  `).join('');
}

async function addUser() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role     = document.getElementById('newUserRole').value;
  const plantIds = [...document.querySelectorAll('#newUserPlant .newuser-plant-cb:checked')].map(cb => parseInt(cb.value, 10));
  const permissions = [...document.querySelectorAll('#newUserPerms .perm-cb:checked')].map(cb => cb.value);
  const errEl    = document.getElementById('usersFormErr');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Both fields are required.'; return; }
  if (password.length < 6)    { errEl.textContent = 'Password must be at least 6 characters.'; return; }
  if (role !== 'superadmin' && !currentPlantId && !plantIds.length) { errEl.textContent = 'Please select at least one plant.'; return; }
  try {
    const body = { username, password, role };
    if (role !== 'superadmin') {
      if (!currentPlantId) body.plantIds = plantIds;
      body.permissions = permissions;
    }
    await api('POST', '/api/auth/users', body);
    document.getElementById('addUserModal')?.remove();
    showToast('✓ User "' + username + '" created as ' + (role === 'admin' ? 'Admin' : role === 'superadmin' ? 'Superadmin' : 'Operator') + (plantIds.length > 1 ? ` (${plantIds.length} plants)` : ''), false);
    loadUsers();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function deleteUser(id, username) {
  if (!confirm('Delete user "' + username + '"? This cannot be undone.')) return;
  try {
    await api('DELETE', '/api/auth/users/' + id);
    showToast('✓ User "' + username + '" deleted', false);
    loadUsers();
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}

async function changeUserRole(id, username, newRole, currentUserRole) {
  const label = newRole === 'superadmin' ? 'Superadmin' : newRole === 'admin' ? 'Admin' : 'Operator';

  // If demoting from superadmin to a plant role, we must collect a plant
  const needsPlant = (currentUserRole === 'superadmin' || !currentUserRole) && newRole !== 'superadmin';

  if (needsPlant) {
    openPlantPickerModal({
      title: `Change role for "${username}"`,
      subtitle: `Select the plant(s) to assign as <strong>${label}</strong>`,
      selectedIds: [],
      onCancel: () => loadUsers(),
      onConfirm: async (plantIds) => {
        if (!plantIds.length) { showToast('⚠ Please select at least one plant', true); return; }
        try {
          await api('PATCH', '/api/auth/users/' + id, { role: newRole, plantIds });
          showToast(`✓ "${username}" is now ${label}`, false);
        } catch (e) {
          showToast('⚠ ' + e.message, true);
        }
        loadUsers();
      },
    });
    return;
  }

  if (!confirm(`Change "${username}" role to ${label}?`)) { loadUsers(); return; }
  try {
    await api('PATCH', '/api/auth/users/' + id, { role: newRole });
    showToast(`✓ "${username}" is now ${label}`, false);
    loadUsers();
  } catch (e) {
    showToast('⚠ ' + e.message, true);
    loadUsers();
  }
}

// Edit which plants an existing (non-superadmin) user has access to, without
// changing their role — e.g. "give this operator 3 of our 5 plants".
async function openEditPlantsModal(id, username, role) {
  const u = (_allUsersCache || []).find(x => x.id === id);
  const currentIds = (u?.plants || []).map(p => p.id);
  openPlantPickerModal({
    title: `Edit plant access for "${username}"`,
    subtitle: `Select every plant this ${role === 'admin' ? 'Admin' : 'Operator'} should be able to access`,
    selectedIds: currentIds,
    onCancel: () => {},
    onConfirm: async (plantIds) => {
      if (!plantIds.length) { showToast('⚠ Please select at least one plant', true); return; }
      try {
        await api('PATCH', '/api/auth/users/' + id, { plantIds });
        showToast(`✓ Updated plant access for "${username}" (${plantIds.length} plant${plantIds.length===1?'':'s'})`, false);
      } catch (e) {
        showToast('⚠ ' + e.message, true);
      }
      loadUsers();
    },
  });
}

// Mix-and-match permission popup — grant any combination of the keys in
// PERMISSION_DEFS onto an existing (non-superadmin) user.
function openEditPermissionsModal(id) {
  const u = (_allUsersCache || []).find(x => x.id === id);
  if (!u) return;
  const safeName = u.username.replace(/'/g,"\\'");

  document.getElementById('permPickerModal')?.remove();
  const modalHtml = `<div id="permPickerModal" class="modal-overlay">
    <div class="modal-box" style="max-width:420px">
      <div style="font-weight:700;font-size:15px;margin-bottom:6px">Edit permissions for "${u.username}"</div>
      <div style="font-size:13px;color:#4a7060;margin-bottom:8px">Mix and match exactly what this ${u.role === 'admin' ? 'Admin' : 'Operator'} can do</div>
      <div id="ppermList" style="max-height:50vh;overflow-y:auto">${permissionCheckboxesHtml(u.permissions || [], { restrictToGrantable: true })}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
        <button id="ppermCancelBtn" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:#fff;cursor:pointer;font-size:13px">Cancel</button>
        <button id="ppermConfirmBtn" style="padding:7px 16px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-size:13px;font-weight:600">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  document.getElementById('ppermCancelBtn').onclick = () => document.getElementById('permPickerModal').remove();
  document.getElementById('ppermConfirmBtn').onclick = async () => {
    const keys = [...document.querySelectorAll('#ppermList .perm-cb:checked')].map(cb => cb.value);
    document.getElementById('permPickerModal').remove();
    try {
      await api('PATCH', '/api/auth/users/' + id, { permissions: keys });
      showToast(`✓ Updated permissions for "${safeName}"`, false);
    } catch (e) {
      showToast('⚠ ' + e.message, true);
    }
    loadUsers();
  };
}

// Shared modal: a checkbox list of every plant (grouped by business type), used
// both for the role-change flow and for editing an existing user's plant access.
async function openPlantPickerModal({ title, subtitle, selectedIds, onCancel, onConfirm }) {
  let plants;
  try { plants = await api('GET', '/api/auth/plants'); } catch { plants = []; }
  if (!plants.length) { showToast('⚠ Could not load plant list', true); onCancel(); return; }

  const selSet = new Set(selectedIds || []);
  const byType = {};
  const typeOrder = [];
  plants.forEach(p => {
    const t = p.business_type || 'Other';
    if (!byType[t]) { byType[t] = []; typeOrder.push(t); }
    byType[t].push(p);
  });
  const groupsHtml = typeOrder.map(t => `
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px">${t}</div>
    ${byType[t].map(p => `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:13px;cursor:pointer">
        <input type="checkbox" class="ppm-plant-cb" value="${p.id}" ${selSet.has(p.id) ? 'checked' : ''}>
        ${p.name}
      </label>`).join('')}
  `).join('');

  document.getElementById('plantPickerModal')?.remove();
  const modalHtml = `<div id="plantPickerModal" class="modal-overlay">
    <div class="modal-box" style="max-width:420px">
      <div style="font-weight:700;font-size:15px;margin-bottom:6px">${title}</div>
      <div style="font-size:13px;color:#4a7060;margin-bottom:8px">${subtitle}</div>
      <div id="ppmPlantList" style="max-height:50vh;overflow-y:auto">${groupsHtml}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
        <button id="ppmCancelBtn" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:#fff;cursor:pointer;font-size:13px">Cancel</button>
        <button id="ppmConfirmBtn" style="padding:7px 16px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer;font-size:13px;font-weight:600">Confirm</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  document.getElementById('ppmCancelBtn').onclick = () => { document.getElementById('plantPickerModal').remove(); onCancel(); };
  document.getElementById('ppmConfirmBtn').onclick = () => {
    const ids = [...document.querySelectorAll('.ppm-plant-cb:checked')].map(cb => parseInt(cb.value, 10));
    document.getElementById('plantPickerModal').remove();
    onConfirm(ids);
  };
}

async function resetUserPassword(id, username) {
  const newPass = prompt('Enter new password for "' + username + '" (min 6 characters):');
  if (!newPass) return;
  if (newPass.length < 6) { showToast('⚠ Password must be at least 6 characters.', true); return; }
  try {
    await api('PATCH', '/api/auth/users/' + id + '/password', { password: newPass });
    showToast('✓ Password reset for "' + username + '"', false);
  } catch (e) {
    showToast('⚠ ' + e.message, true);
  }
}
