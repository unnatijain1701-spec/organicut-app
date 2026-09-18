let currentUsername = '';
let currentRole = '';
let currentPlantId   = null;
let currentPlantName = null;
let activePlantId    = null;  // null for superadmin until a plant is selected
let activePlantName  = null;
// Active business type scope ('' = all businesses). Only meaningful for all-plants users;
// single-location users are implicitly scoped by their own plant's business type.
let activeBizType    = sessionStorage.getItem('activeBizType') || '';
// Which pre-login tile (or 'ADMIN') was clicked to reach the login form — applied once
// login succeeds, for all-plants users only; plant-locked users' access ignores it.
let pendingBizType   = null;

/* ═══════════════════════════════════════════════════════
   SKU CONFIGURATION
═══════════════════════════════════════════════════════ */

// SKUs are fully DB-driven (custom_skus table) for all plants
const SKU_CFG = {};

// SKU rate overrides are loaded from DB in initApp() via loadSKURateOverrides()

let ATT_VENDORS = [];  // populated dynamically from CSV or saved record
let KG_VENDORS = [];  // populated from /api/vendors on init

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */

const attState = {};

const kgState        = {};
const customSKUs     = {};
const unloadingCosts = {};  // flat ₹ unloading cost per vendor per day
let activeTab = '';
let activeKGCat = 'unloading';
let _cachedCSVFile = null;
let _freshCSVLoaded = false;  // true immediately after CSV upload; prevents saved record from overwriting attendance
let _isDirty = false;         // true when form has unsaved changes
let _currentRecordLocked = false;
let _rateChangedOnLoad = false;

/* ═══════════════════════════════════════════════════════
   API HELPER
═══════════════════════════════════════════════════════ */

async function api(method, url, body) {
  // All-plants users: inject activePlantId so backend knows which plant to query
  if (!currentPlantId && activePlantId) {
    if (method === 'GET' || method === 'DELETE') {
      url += (url.includes('?') ? '&' : '?') + 'plantId=' + activePlantId;
    } else if (body instanceof FormData) {
      body.append('plantId', activePlantId);
    } else if (body) {
      body = { ...body, plantId: activePlantId };
    }
  }
  const opts = { method, credentials: 'include' };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  if (resp.status === 401) {
    document.getElementById('loginOverlay').style.display = 'flex';
    throw new Error('Session expired — please log in again');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

