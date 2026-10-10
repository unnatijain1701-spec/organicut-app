let currentUsername = '';
let currentRole = '';
let currentPermissions = [];   // granular permission keys granted to this (non-superadmin) user
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

// Mirrors src/utils/permissions.js hasPermission — superadmin is always unrestricted.
function hasPerm(key) {
  return currentRole === 'superadmin' || (currentPermissions || []).includes(key);
}

// Several backend routes send a raw DATE column (record_date) without wrapping it in
// TO_CHAR(...) — node-postgres parses those into real JS Date objects, not strings. A
// few places here used to assume it was always a string (`r.record_date.slice(0,10)`,
// `r.record_date + ''`), which either threw (Date has no .slice) or silently produced
// garbage (string-concatenating a Date calls its verbose .toString(), not an ISO date).
// Always route a record_date value through this before treating it as 'YYYY-MM-DD'.
function toISODateStr(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) {
    const pad = n => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}`;
  }
  return String(val).slice(0, 10);
}

/* ═══════════════════════════════════════════════════════
   SKU CONFIGURATION
═══════════════════════════════════════════════════════ */

// SKUs are fully DB-driven (custom_skus table) for all plants
const SKU_CFG = {};

// SKU rate overrides are loaded from DB in initApp() via loadSKURateOverrides()

let ATT_VENDORS = [];  // populated dynamically from CSV or saved record
let KG_VENDORS = [];  // populated from /api/vendors on init
let WORKER_TYPES = [];        // [{id, plant_id, name, daily_rate, display_order}, ...] for the active plant
let WORKER_TYPES_BY_NAME = {}; // name -> daily_rate, for quick lookup when auto-calculating cost
let CONTRACTORS = [];          // [{id, name}, ...] canonical contractor list for the active plant

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

