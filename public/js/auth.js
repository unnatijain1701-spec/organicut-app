/* ═══════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════ */

async function checkAuth() {
  try {
    const user = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
    if (user.username) {
      currentUsername  = user.username;
      currentRole      = user.role || 'user';
      currentPlantId   = user.plant_id   || null;
      currentPlantName = user.plant_name || null;
      activePlantId    = currentPlantId;
      activePlantName  = currentPlantName;
      const plantLabel = currentPlantName ? ` • ${currentPlantName}` : ' • All Plants';
      document.getElementById('userBadge').textContent = user.username + plantLabel;
      const isPrivileged = currentRole === 'admin' || currentRole === 'superadmin';
      const isSuperadmin = currentRole === 'superadmin';
      const canSeeDashboard = isPrivileged || !user.plant_id;
      document.getElementById('navUsers').style.display = isSuperadmin ? '' : 'none';
      document.getElementById('navDashboard').style.display = canSeeDashboard ? '' : 'none';
      document.getElementById('navVendors').style.display = isSuperadmin ? '' : 'none';
      document.getElementById('histBulkLockBtns').style.display = isSuperadmin ? 'flex' : 'none';
      { const rb = document.getElementById('reportMenuBtn'); if (rb) rb.style.display = isSuperadmin ? 'block' : 'none'; }
      { const nr = document.getElementById('navReport'); if (nr) nr.style.display = isSuperadmin ? '' : 'none'; }
      { const nt = document.getElementById('navTrend');  if (nt) nt.style.display = isSuperadmin ? '' : 'none'; }
      document.getElementById('navAdminToggle').style.display = isSuperadmin ? '' : 'none';
      if (isSuperadmin) setAdminGroupOpen(sessionStorage.getItem('navAdminOpen') === '1');
      document.getElementById('preLoginOverlay').style.display = 'none';
      document.getElementById('loginOverlay').style.display = 'none';
      await setupPlantSelector();
      // Returning session (cookie already valid) — no picker, just resume wherever
      // sessionStorage left off, defaulting an all-plants user to "combined" if uncached.
      if (!currentPlantId) {
        activeBizType = sessionStorage.getItem('activeBizType') || '';
        renderPlantSelector();
      }
      await initApp();
    }
    // else: not logged in — leave the pre-login business tiles showing (their default state)
  } catch {
    // Network hiccup on the /me check — leave the pre-login tiles showing rather than
    // forcing straight to a login form the user hasn't chosen a business for yet.
  }
}

function choosePreLoginBiz(type) {
  pendingBizType = type;
  document.getElementById('preLoginOverlay').style.display = 'none';
  checkIfSetupNeeded();
}

function backToPreLogin() {
  pendingBizType = null;
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('preLoginOverlay').style.display = 'flex';
}

async function checkIfSetupNeeded() {
  document.getElementById('loginOverlay').style.display = 'flex';
  try {
    const r = await fetch('/api/auth/needs-setup');
    const d = await r.json();
    if (d.needed) {
      document.getElementById('loginSubText').textContent = 'Create your admin account to get started';
      showSetup();
      document.getElementById('loginSwitch').style.display = 'none';
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginForm').style.display = '';
  document.getElementById('setupForm').style.display = 'none';
  document.getElementById('loginSubText').textContent = 'Sign in to your account';
}

function showSetup() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('setupForm').style.display = '';
  document.getElementById('loginSubText').textContent = 'First-time setup — create admin account';
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Please enter username and password.'; return; }
  try {
    const user = await api('POST', '/api/auth/login', { username, password });
    currentUsername  = user.username;
    currentRole      = user.role || 'user';
    currentPlantId   = user.plant_id   || null;
    currentPlantName = user.plant_name || null;
    activePlantId    = currentPlantId;
    const plantLabel = currentPlantName ? ` • ${currentPlantName}` : ' • All Plants';
    document.getElementById('userBadge').textContent = user.username + plantLabel;
    const isPrivileged = currentRole === 'admin' || currentRole === 'superadmin';
    const isSuperadmin = currentRole === 'superadmin';
    const canSeeDashboard = isPrivileged || !user.plant_id;
    document.getElementById('navUsers').style.display = isSuperadmin ? '' : 'none';
    document.getElementById('navDashboard').style.display = canSeeDashboard ? '' : 'none';
    document.getElementById('navVendors').style.display = isSuperadmin ? '' : 'none';
    { const nr = document.getElementById('navReport'); if (nr) nr.style.display = isSuperadmin ? '' : 'none'; }
    { const nt = document.getElementById('navTrend');  if (nt) nt.style.display = isSuperadmin ? '' : 'none'; }
    document.getElementById('navAdminToggle').style.display = isSuperadmin ? '' : 'none';
    if (isSuperadmin) setAdminGroupOpen(false);
    document.getElementById('histBulkLockBtns').style.display = isSuperadmin ? 'flex' : 'none';
    document.getElementById('loginOverlay').style.display = 'none';
    await setupPlantSelector();
    // The pre-login tile (or 'Admin Sign In') the user clicked decides the starting scope —
    // for a plant-locked account this doesn't grant or restrict anything (the account's own
    // plant_id already does that); it's purely which view they land on.
    if (!currentPlantId) {
      activeBizType = (pendingBizType && pendingBizType !== 'ADMIN') ? pendingBizType : '';
      sessionStorage.setItem('activeBizType', activeBizType);
      sessionStorage.setItem('bizTypeChosen', '1');
      renderPlantSelector();
    } else if (pendingBizType && pendingBizType !== 'ADMIN') {
      const actualType = PLANTS_BY_ID[currentPlantId]?.business_type;
      if (actualType && actualType !== pendingBizType) {
        showToast(`Note: your account is scoped to ${actualType}, not ${pendingBizType}.`, false);
      }
    }
    await initApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function doSetup() {
  const username = document.getElementById('setupUser').value.trim();
  const password = document.getElementById('setupPass').value;
  const errEl = document.getElementById('setupErr');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Please fill in both fields.'; return; }
  try {
    await api('POST', '/api/auth/setup', { username, password });
    document.getElementById('loginUser').value = username;
    document.getElementById('loginPass').value = password;
    showLogin();
    document.getElementById('loginSubText').textContent = 'Account created! Signing you in…';
    await doLogin();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function doLogout() {
  closeUserDd();
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  currentUsername  = '';
  currentRole      = '';
  currentPlantId   = null;
  currentPlantName = null;
  activePlantId    = null;
  activePlantName  = null;
  activeBizType    = '';
  pendingBizType   = null;
  _isDirty = false;
  sessionStorage.removeItem('activePlantId');
  sessionStorage.removeItem('activeBizType');
  sessionStorage.removeItem('allPlantsBizType');
  sessionStorage.removeItem('bizTypeChosen');
  document.getElementById('bizTypeOverlay').style.display = 'none';
  document.getElementById('bizSwitchField').style.display = 'none';
  document.getElementById('plantSelectorField').style.display = 'none';
  document.getElementById('navUsers').style.display = 'none';
  document.getElementById('navDashboard').style.display = 'none';
  document.getElementById('navVendors').style.display = 'none';
  { const nr = document.getElementById('navReport'); if (nr) nr.style.display = 'none'; }
  { const nt = document.getElementById('navTrend');  if (nt) nt.style.display = 'none'; }
  document.getElementById('navAdminToggle').style.display = 'none';
  setAdminGroupOpen(false);
  setActiveNav('daily');
  closeDashboard();
  toggleUsersPanel(false);
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('preLoginOverlay').style.display = 'flex';
}

