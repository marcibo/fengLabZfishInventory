/* ── FZFish app.js ── */

// ── Constants ────────────────────────────────────────────────────────────────
const CLIENT_ID     = '100004327605-af8aqv1jshg1u1bhiude24po7oc4mdf4.apps.googleusercontent.com';
const SHEET_ID      = '1AviXu1_KPFRx158Af05qBmA-LCw2GhxJxvfZEFUCuqY';
const TAB_NAME      = 'Fish';
const DRIVE_FOLDER  = '1VTpNTlB-JMLPZNKzgm0IIXCRkk9Agzf7';
const SCOPES        = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file openid email';

// ── State ────────────────────────────────────────────────────────────────────
let tokenClient       = null;
let accessToken       = null;
let tokenExpiry       = 0;
let tokenResolvers    = [];
let sheetGid          = 0;
let currentUser       = '';

let fishData          = [];
let filtered          = [];
let activeStatuses    = new Set();   // empty = All
let activePosMarkers  = new Set();
let activeNegMarkers  = new Set();
let currentMarkers    = [];
let currentNegMarkers = [];
let currentPhotoUrl   = null;
let originalPhotoUrl  = null;
let pendingPhotoFile  = null;
let editingId         = null;
let demoMode          = false;
let scannerRunning    = false;
let scanForForm       = false;
let experiments       = [];
let currentExperiment = null;
let pickerSelected    = new Set();
let sortDir           = -1;  // -1 = desc (newest first), 1 = asc

// A  B     C         D    E      F         G            H       I      J        K      L
// ID Line  Genotype  Date Count  Location  PosMarkers   Status  Notes  Updated  Photo  NegMarkers
const COL = {
  tankId:     0, line:     1, genotype:   2,
  age:        3, count:    4, location:   5,
  markers:    6, status:   7, notes:      8,
  updated:    9, photo:   10, negMarkers: 11,
};

// ── Demo data ────────────────────────────────────────────────────────────────
const DEMO = [
  { tankId:'demo-1', line:'Tg(fli1:EGFP)',     genotype:'+;+', age:'2025-01-10', count:12, location:'Rack 1A, Shelf 2', markers:['EGFP','fli1'],    negMarkers:[],        status:'Active',    notes:'Healthy, spawning well', photoUrl:'', updated:'2025-04-20' },
  { tankId:'demo-2', line:'Tg(gata1:DsRed)',   genotype:'+;-', age:'2025-02-01', count:8,  location:'Rack 1A, Shelf 3', markers:['DsRed','gata1'],  negMarkers:['fli1'],  status:'Breeding',  notes:'Set up breeding pair',   photoUrl:'', updated:'2025-04-22' },
  { tankId:'demo-3', line:'casper',            genotype:'?;?', age:'2024-12-05', count:3,  location:'Rack 2B, Shelf 1', markers:[],                 negMarkers:[],        status:'Low Stock', notes:'Need to expand',          photoUrl:'', updated:'2025-04-15' },
  { tankId:'demo-4', line:'Tg(mpeg1:mCherry)', genotype:'+;+', age:'2025-03-15', count:20, location:'Rack 2B, Shelf 4', markers:['mCherry','mpeg1'], negMarkers:['DsRed'], status:'Active',    notes:'',                       photoUrl:'', updated:'2025-04-21' },
  { tankId:'demo-5', line:'AB wild-type',      genotype:'-;-', age:'2024-10-01', count:6,  location:'Rack 3C, Shelf 1', markers:[],                 negMarkers:[],        status:'Archived',  notes:'Retired breeders',        photoUrl:'', updated:'2025-03-10' },
  { tankId:'demo-6', line:'Tg(huc:GCaMP6s)',  genotype:'+;+', age:'2025-03-01', count:15, location:'Rack 1B, Shelf 1', markers:['GCaMP6s','huc'],  negMarkers:[],        status:'Nursery',   notes:'Imaging stock',           photoUrl:'', updated:'2025-04-23' },
];

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('fzfish-demo') === 'true') { useDemoMode(); return; }

  // Restore session from sessionStorage if token still valid
  const storedToken  = sessionStorage.getItem('zb-token');
  const storedExpiry = parseInt(sessionStorage.getItem('zb-expiry') || '0');
  if (storedToken && Date.now() < storedExpiry) {
    accessToken  = storedToken;
    tokenExpiry  = storedExpiry;
    currentUser  = sessionStorage.getItem('zb-user') || '';
    waitForGIS(true);
    return;
  }

  waitForGIS(false);
});

function waitForGIS(autoConnect) {
  const poll = setInterval(() => {
    if (window.google?.accounts?.oauth2) {
      clearInterval(poll);
      initTokenClient();
      if (autoConnect) {
        Promise.all([fetchSheetGid(), fetchFromSheets()]).then(showApp).catch(() => {
          // Token may have expired silently; clear and show sign-in
          accessToken = null;
          sessionStorage.clear();
        });
      }
    }
  }, 100);
}

function initTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error) {
        tokenResolvers.forEach(r => r.reject(new Error(response.error)));
        tokenResolvers = [];
        const btn = document.getElementById('signin-btn');
        if (btn) { btn.disabled = false; btn.innerHTML = googleBtnHTML(); }
        return;
      }
      accessToken = response.access_token;
      tokenExpiry  = Date.now() + (response.expires_in - 60) * 1000;
      sessionStorage.setItem('zb-token',  accessToken);
      sessionStorage.setItem('zb-expiry', String(tokenExpiry));
      tokenResolvers.forEach(r => r.resolve());
      tokenResolvers = [];
    },
  });
}

function googleBtnHTML() {
  return `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
    <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg> Sign in with Google`;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function ensureToken() {
  if (accessToken && Date.now() < tokenExpiry) return Promise.resolve();
  return new Promise((resolve, reject) => {
    tokenResolvers.push({ resolve, reject });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

window.signIn = async function() {
  if (!tokenClient) { showToast('⚠️ Google Auth not ready yet, please wait…'); return; }
  const btn = document.getElementById('signin-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await new Promise((resolve, reject) => {
      tokenResolvers.push({ resolve, reject });
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    });
    await Promise.all([fetchSheetGid(), fetchFromSheets(), fetchUserInfo(), fetchExperiments()]);
    showApp();
  } catch(e) {
    btn.disabled = false; btn.innerHTML = googleBtnHTML();
  }
};

window.signOut = function() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null; tokenExpiry = 0; fishData = []; demoMode = false; currentUser = '';
  sessionStorage.clear();
  localStorage.removeItem('fzfish-demo');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('setup-overlay').classList.add('active');
  const btn = document.getElementById('signin-btn');
  btn.disabled = false; btn.innerHTML = googleBtnHTML();
};

window.useDemoMode = function() {
  demoMode = true;
  localStorage.setItem('fzfish-demo', 'true');
  fishData = DEMO.map((d, i) => ({ ...d, id: d.tankId, _rowIndex: i + 2 }));
  showApp();
  showToast('🐠 Demo mode active — data not saved');
};

function showApp() {
  document.getElementById('setup-overlay').classList.remove('active');
  document.getElementById('app').classList.remove('hidden');
  const signoutBtn = document.getElementById('signout-btn');
  if (signoutBtn) signoutBtn.textContent = demoMode ? 'Exit Demo' : 'Sign Out';
  renderAll();
}

async function fetchUserInfo() {
  try {
    const res  = await authFetch('https://www.googleapis.com/oauth2/v3/userinfo');
    const json = await res.json();
    currentUser = json.email || json.name || '';
    sessionStorage.setItem('zb-user', currentUser);
  } catch(e) { currentUser = ''; }
}

// ── Authenticated fetch ───────────────────────────────────────────────────────
async function authFetch(url, options = {}) {
  if (!accessToken || Date.now() > tokenExpiry) {
    showToast('⚠️ Session expired — please sign in again.');
    signOut(); throw new Error('No valid token');
  }
  return fetch(url, { ...options, headers: { ...options.headers, 'Authorization': `Bearer ${accessToken}` } });
}

// ── Google Sheets ─────────────────────────────────────────────────────────────
async function fetchSheetGid() {
  try {
    const res  = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`);
    const json = await res.json();
    const sheet = (json.sheets || []).find(s => s.properties.title === TAB_NAME);
    sheetGid = sheet?.properties?.sheetId ?? 0;
  } catch(e) { console.warn('fetchSheetGid:', e.message); }
}

async function fetchFromSheets() {
  try {
    const res  = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}`);
    const json = await res.json();
    if (json.error) { showToast('❌ ' + json.error.message); return false; }
    const rows = json.values || [];
    fishData = rows.slice(1).map((r, i) => ({
      id:          r[COL.tankId]     || `row-${i+2}`,
      tankId:      r[COL.tankId]     || '',
      line:        r[COL.line]       || '',
      genotype:    r[COL.genotype]   || '',
      age:         r[COL.age]        || '',
      count:       parseInt(r[COL.count]) || 0,
      location:    r[COL.location]   || '',
      markers:     parseList(r[COL.markers]),
      negMarkers:  parseList(r[COL.negMarkers]),
      status:      r[COL.status]     || 'Active',
      notes:       r[COL.notes]      || '',
      updated:     r[COL.updated]    || '',
      photoUrl:    r[COL.photo]      || '',
      _rowIndex: i + 2,
    }));
    showToast('✅ Synced ' + fishData.length + ' tanks');
    return true;
  } catch(e) { showToast('❌ ' + e.message); return false; }
}

function parseList(val) {
  return val ? String(val).split(',').map(m => m.trim()).filter(Boolean) : [];
}

async function appendToSheets(record) {
  const res   = await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [recordToRow(record)] }) }
  );
  const json  = await res.json();
  const match = json.updates?.updatedRange?.match(/(\d+)$/);
  return match ? parseInt(match[1]) : null;
}

async function updateSheetRow(record, rowIndex) {
  await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME + '!A' + rowIndex)}?valueInputOption=RAW`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [recordToRow(record)] }) }
  );
}

async function deleteSheetRow(rowIndex) {
  await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex } } }] }),
  });
}

function recordToRow(r) {
  return [
    r.tankId, r.line, r.genotype, r.age, r.count, r.location,
    (r.markers    || []).join(', '),
    r.status, r.notes,
    new Date().toISOString().slice(0, 10),
    r.photoUrl    || '',
    (r.negMarkers || []).join(', '),
  ];
}

window.syncSheets = async function() {
  const btn = document.getElementById('sync-btn');
  btn.classList.add('spinning');
  if (demoMode) { await new Promise(r => setTimeout(r, 600)); btn.classList.remove('spinning'); showToast('🐠 Demo mode — nothing to sync'); return; }
  await fetchFromSheets(); await fetchExperiments(); renderAll(); btn.classList.remove('spinning');
};

// ── Experiments ──────────────────────────────────────────────────────────────
async function fetchExperiments() {
  if (demoMode) return;
  try {
    const res  = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`);
    const json = await res.json();
    const reserved = new Set([TAB_NAME.toLowerCase(), 'changelog']);
    const expSheets = (json.sheets || []).map(s => s.properties).filter(p => !reserved.has(p.title.toLowerCase()));
    experiments = await Promise.all(expSheets.map(async p => ({
      name: p.title, gid: p.sheetId, tankIds: await loadExpTankIds(p.title),
    })));
    renderExperimentsDropdown();
  } catch(e) { console.warn('fetchExperiments:', e.message); }
}

async function loadExpTankIds(tabName) {
  try {
    const r = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName)}!A2:A`);
    const d = await r.json();
    return (d.values || []).flat().filter(Boolean);
  } catch(e) { return []; }
}

async function saveExpTankIds(tabName, tankIds) {
  const range = `${encodeURIComponent(tabName)}!A2:A`;
  await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:clear`,
    { method: 'POST', headers: {'Content-Type':'application/json'} });
  if (tankIds.length) {
    await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
      { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ values: tankIds.map(id => [id]) }) });
  }
}

function renderExperimentsDropdown() {
  const list = document.getElementById('experiments-list');
  if (!list) return;
  list.innerHTML = experiments.length
    ? experiments.map((exp, i) => `
        <button class="exp-dd-row${currentExperiment?.gid === exp.gid ? ' exp-dd-active' : ''}"
            onclick="enterExperiment(${i});closeExperimentsDropdown()">
          <span class="exp-dd-name">${esc(exp.name)}</span>
          <span class="exp-dd-count">${exp.tankIds.length} tanks</span>
        </button>`).join('')
    : '<p class="exp-dd-empty">No experiments yet.</p>';
}

window.toggleExperimentsDropdown = function() {
  const dd = document.getElementById('experiments-dropdown');
  if (dd.classList.contains('hidden')) {
    renderExperimentsDropdown();
    const rect = document.getElementById('experiments-btn').getBoundingClientRect();
    dd.style.top   = (rect.bottom + 4) + 'px';
    dd.style.right = (window.innerWidth - rect.right) + 'px';
    dd.classList.remove('hidden');
  } else {
    dd.classList.add('hidden');
  }
};
window.closeExperimentsDropdown = function() {
  document.getElementById('experiments-dropdown')?.classList.add('hidden');
};

window.enterExperiment = function(idx) {
  const exp = experiments[idx];
  if (!exp) return;
  const validIds = new Set(fishData.map(f => f.tankId));
  const cleaned  = exp.tankIds.filter(id => validIds.has(id));
  if (cleaned.length !== exp.tankIds.length) {
    exp.tankIds = cleaned;
    if (!demoMode) saveExpTankIds(exp.name, cleaned);
  }
  currentExperiment = exp;
  document.getElementById('experiment-bar').classList.remove('hidden');
  document.getElementById('exp-name-display').textContent = exp.name;
  document.getElementById('exp-name-input').classList.add('hidden');
  document.getElementById('exp-name-display').classList.remove('hidden');
  document.getElementById('filter-panel')?.classList.add('exp-mode');
  document.getElementById('filter-toggle-bar')?.classList.add('exp-mode');
  renderAll();
};

window.exitExperiment = function() {
  currentExperiment = null;
  document.getElementById('experiment-bar').classList.add('hidden');
  document.getElementById('filter-panel')?.classList.remove('exp-mode');
  document.getElementById('filter-toggle-bar')?.classList.remove('exp-mode');
  renderAll();
};

window.startRenameExp = function() {
  const input = document.getElementById('exp-name-input');
  input.value = currentExperiment.name;
  document.getElementById('exp-name-display').classList.add('hidden');
  input.classList.remove('hidden');
  input.focus(); input.select();
};

window.saveRenameExp = async function() {
  const input   = document.getElementById('exp-name-input');
  const display = document.getElementById('exp-name-display');
  const newName = input.value.trim();
  input.classList.add('hidden');
  display.classList.remove('hidden');
  if (!newName || newName === currentExperiment.name) { display.textContent = currentExperiment.name; return; }
  const oldName = currentExperiment.name;
  const idx = experiments.findIndex(e => e.gid === currentExperiment.gid);
  display.textContent = newName;
  currentExperiment.name = newName;
  if (idx !== -1) experiments[idx].name = newName;
  renderExperimentsDropdown();
  if (demoMode) return;
  try {
    await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: currentExperiment.gid, title: newName }, fields: 'title' } }] }),
    });
  } catch(e) {
    showToast('❌ Rename failed');
    currentExperiment.name = oldName;
    if (idx !== -1) experiments[idx].name = oldName;
    display.textContent = oldName;
  }
};

window.createExperiment = async function() {
  closeExperimentsDropdown();
  const name = prompt('Experiment name:');
  if (!name?.trim()) return;
  const trimmed = name.trim();
  if (demoMode) {
    const exp = { name: trimmed, gid: Date.now(), tankIds: [] };
    experiments.push(exp);
    enterExperiment(experiments.length - 1);
    return;
  }
  try {
    showToast('Creating…');
    const r = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: trimmed } } }] }),
    });
    const d     = await r.json();
    const props = d.replies[0].addSheet.properties;
    await authFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(trimmed)}!A1?valueInputOption=RAW`,
      { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ values: [['Tank ID']] }) }
    );
    const exp = { name: props.title, gid: props.sheetId, tankIds: [] };
    experiments.push(exp);
    enterExperiment(experiments.length - 1);
  } catch(e) { showToast('❌ ' + e.message); }
};

window.deleteExperiment = async function() {
  if (!currentExperiment) return;
  if (!confirm(`Delete "${currentExperiment.name}"? This cannot be undone.`)) return;
  const exp = currentExperiment;
  exitExperiment();
  experiments = experiments.filter(e => e.gid !== exp.gid);
  renderExperimentsDropdown();
  if (demoMode) return;
  try {
    await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: exp.gid } }] }),
    });
  } catch(e) { showToast('❌ Delete failed: ' + e.message); }
};

window.removeFromExperiment = function(tankId, event) {
  event.stopPropagation();
  if (!currentExperiment) return;
  currentExperiment.tankIds = currentExperiment.tankIds.filter(id => id !== tankId);
  const idx = experiments.findIndex(e => e.gid === currentExperiment.gid);
  if (idx !== -1) experiments[idx].tankIds = currentExperiment.tankIds;
  if (!demoMode) saveExpTankIds(currentExperiment.name, currentExperiment.tankIds);
  renderAll();
};

// ── Tank picker ───────────────────────────────────────────────────────────────
let pickerActiveStatus = null;

window.openTankPicker = function() {
  if (!currentExperiment) return;
  pickerSelected   = new Set(currentExperiment.tankIds);
  pickerActiveStatus = null;
  document.getElementById('picker-search').value = '';
  document.getElementById('picker-sort').value   = 'line';
  buildPickerStatusChips();
  renderPickerGrid();
  document.getElementById('tank-picker-overlay').classList.add('active');
  document.body.classList.add('modal-open');
};

function buildPickerStatusChips() {
  const statuses = ['Active','Nursery','Incubator','Low Stock','Breeding','Archived'];
  const wrap = document.getElementById('picker-status-chips');
  if (!wrap) return;
  wrap.innerHTML = statuses.map(s =>
    `<button class="chip picker-status-chip${pickerActiveStatus === s ? ' active' : ''}"
      onclick="setPickerStatus('${s}')">${s}</button>`
  ).join('');
}

window.setPickerStatus = function(status) {
  pickerActiveStatus = pickerActiveStatus === status ? null : status;
  buildPickerStatusChips();
  renderPickerGrid();
};

window.closeTankPicker = function() {
  document.getElementById('tank-picker-overlay').classList.remove('active');
  checkScrollLock();
};

window.filterPicker = function() {
  renderPickerGrid();
};

function renderPickerGrid() {
  const q    = (document.getElementById('picker-search')?.value || '').toLowerCase();
  const sort = document.getElementById('picker-sort')?.value || 'line';
  const grid = document.getElementById('picker-grid');

  let list = fishData.filter(f => {
    if (pickerActiveStatus && f.status !== pickerActiveStatus) return false;
    if (!q) return true;
    return (
      f.line.toLowerCase().includes(q) ||
      (f.genotype || '').toLowerCase().includes(q) ||
      (f.location || '').toLowerCase().includes(q) ||
      (f.tankId   || '').toLowerCase().includes(q) ||
      (f.markers  || []).some(m => m.toLowerCase().includes(q))
    );
  });

  list = [...list].sort((a, b) => {
    if (sort === 'age')     return (a.age     || '').localeCompare(b.age     || '');
    if (sort === 'count')   return (a.count   || 0) - (b.count   || 0);
    if (sort === 'updated') return (b.updated || '').localeCompare(a.updated || '');
    return a.line.localeCompare(b.line);
  });
  if (!list.length) { grid.innerHTML = '<p class="picker-empty">No tanks found.</p>'; return; }
  grid.innerHTML = list.map(f => {
    const checked = pickerSelected.has(f.tankId);
    const posHtml = (f.markers || []).map(m => `<span class="m-tag">${esc(m)}</span>`).join('');
    return `<label class="picker-card${checked ? ' picker-card-checked' : ''}">
      <input type="checkbox" class="picker-cb" value="${esc(f.tankId)}"
        ${checked ? 'checked' : ''} onchange="togglePickerTank('${esc(f.tankId)}', this.checked)" />
      <div class="picker-card-body">
        <div class="picker-card-line">${esc(f.line)}</div>
        <div class="picker-card-meta">
          <span class="status-badge badge-${f.status}">${esc(f.status)}</span>
          ${f.tankId   ? `<span class="picker-card-id">${esc(f.tankId)}</span>` : ''}
          ${f.location ? `<span class="picker-card-loc">📍 ${esc(f.location)}</span>` : ''}
          ${posHtml}
        </div>
      </div>
    </label>`;
  }).join('');
  updatePickerBtn();
}

window.togglePickerTank = function(tankId, checked) {
  if (checked) pickerSelected.add(tankId);
  else pickerSelected.delete(tankId);
  document.querySelector(`.picker-cb[value="${tankId}"]`)?.closest('.picker-card')?.classList.toggle('picker-card-checked', checked);
  updatePickerBtn();
};

function updatePickerBtn() {
  const btn = document.getElementById('picker-confirm-btn');
  if (btn) btn.textContent = `Done (${pickerSelected.size} selected)`;
}

window.confirmTankPicker = async function() {
  if (!currentExperiment) return;
  const btn = document.getElementById('picker-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  currentExperiment.tankIds = [...pickerSelected];
  const idx = experiments.findIndex(e => e.gid === currentExperiment.gid);
  if (idx !== -1) experiments[idx].tankIds = currentExperiment.tankIds;
  if (!demoMode) {
    try { await saveExpTankIds(currentExperiment.name, currentExperiment.tankIds); }
    catch(e) { showToast('❌ ' + e.message); if (btn) { btn.disabled = false; updatePickerBtn(); } return; }
  }
  closeTankPicker();
  renderAll();
  renderExperimentsDropdown();
  showToast(`✅ ${currentExperiment.tankIds.length} tanks saved`);
};

// ── Changelog ────────────────────────────────────────────────────────────────
function diffRecord(oldRec, newRec) {
  const fields = [
    { key: 'line',     label: 'Line'       },
    { key: 'genotype', label: 'Genotype'   },
    { key: 'age',      label: 'Fert. Date' },
    { key: 'count',    label: 'Count'      },
    { key: 'location', label: 'Location'   },
    { key: 'status',   label: 'Status'     },
    { key: 'notes',    label: 'Notes'      },
  ];
  const changes = [];
  fields.forEach(({ key, label }) => {
    const o = String(oldRec[key] ?? '');
    const n = String(newRec[key] ?? '');
    if (o !== n) changes.push(`${label}: "${o}" → "${n}"`);
  });
  // Markers
  const oldPos = (oldRec.markers    || []).join(', ') || '—';
  const newPos = (newRec.markers    || []).join(', ') || '—';
  if (oldPos !== newPos) changes.push(`+Markers: [${oldPos}] → [${newPos}]`);
  const oldNeg = (oldRec.negMarkers || []).join(', ') || '—';
  const newNeg = (newRec.negMarkers || []).join(', ') || '—';
  if (oldNeg !== newNeg) changes.push(`−Markers: [${oldNeg}] → [${newNeg}]`);
  // Photo
  const hadPhoto = !!oldRec.photoUrl;
  const hasPhoto = !!newRec.photoUrl;
  if (!hadPhoto && hasPhoto)                                changes.push('Photo: added');
  else if (hadPhoto && !hasPhoto)                           changes.push('Photo: removed');
  else if (hadPhoto && hasPhoto && oldRec.photoUrl !== newRec.photoUrl) changes.push('Photo: replaced');
  return changes.length ? changes.join(' | ') : 'No changes';
}

function logChange(action, record, details = '') {
  if (demoMode) return;
  const row = [new Date().toISOString(), action, record.tankId || '', record.line || '', currentUser || '', details];
  authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/changelog:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [row] }) }
  ).catch(e => console.warn('Changelog:', e));
}

// ── Google Drive ──────────────────────────────────────────────────────────────
async function uploadPhoto(file) {
  const metadata = { name: `fzfish_${Date.now()}_${file.name}`, mimeType: file.type, parents: [DRIVE_FOLDER] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);
  const { id: fileId } = await (await authFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form })).json();
  await authFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}

function extractDriveFileId(url) {
  const m = (url || '').match(/[?&]id=([^&]+)/);
  return m ? m[1] : null;
}

async function deleteDrivePhoto(photoUrl) {
  const id = extractDriveFileId(photoUrl);
  if (!id || demoMode) return;
  try { await authFetch(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }); } catch(e) {}
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  updateStats();
  updateMarkerDatalists();
  updateFilterSummary(); // also calls updateMiniStats()
  filterFish();
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function calcDpf(d) {
  if (!d) return '?';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return '?';
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateStats() {
  const count = s => fishData.filter(f => f.status === s).length;
  document.getElementById('stat-total').textContent     = fishData.length;
  document.getElementById('stat-active').textContent    = count('Active');
  document.getElementById('stat-nursery').textContent   = count('Nursery');
  document.getElementById('stat-incubator').textContent = count('Incubator');
  document.getElementById('stat-low').textContent       = count('Low Stock');
  document.getElementById('stat-archived').textContent  = count('Archived');
}

window.filterFish = function() {
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const base = currentExperiment
    ? fishData.filter(f => currentExperiment.tankIds.includes(f.tankId))
    : fishData;
  filtered = base.filter(f => {
    if (activeStatuses.size > 0 && !activeStatuses.has(f.status)) return false;
    if (activePosMarkers.size > 0) {
      const s = new Set(f.markers || []);
      for (const m of activePosMarkers) { if (!s.has(m)) return false; }
    }
    if (activeNegMarkers.size > 0) {
      const s = new Set(f.negMarkers || []);
      for (const m of activeNegMarkers) { if (!s.has(m)) return false; }
    }
    if (!q) return true;
    return (
      f.line.toLowerCase().includes(q)      ||
      f.genotype.toLowerCase().includes(q)  ||
      f.location.toLowerCase().includes(q)  ||
      (f.markers    || []).some(m => m.toLowerCase().includes(q)) ||
      (f.negMarkers || []).some(m => m.toLowerCase().includes(q)) ||
      (f.notes      || '').toLowerCase().includes(q)
    );
  });
  sortFish();
};

window.sortFish = function() {
  const s = document.getElementById('sort-select').value;
  filtered.sort((a, b) => {
    let cmp = 0;
    if (s === 'line')    cmp = a.line.localeCompare(b.line);
    if (s === 'age')     cmp = (a.age || '').localeCompare(b.age || '');
    if (s === 'count')   cmp = (a.count || 0) - (b.count || 0);
    if (s === 'updated') cmp = (a.updated || '').localeCompare(b.updated || '');
    return sortDir * cmp;
  });
  renderGrid();
};

window.toggleSortDir = function() {
  sortDir *= -1;
  const btn = document.getElementById('sort-dir-btn');
  if (btn) btn.textContent = sortDir === 1 ? '↑' : '↓';
  sortFish();
};

function renderGrid() {
  const grid  = document.getElementById('fish-grid');
  const empty = document.getElementById('empty-state');
  Array.from(grid.querySelectorAll('.fish-card')).forEach(c => c.remove());
  if (filtered.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  filtered.forEach((f, idx) => {
    const card    = document.createElement('div');
    card.className = `fish-card status-${f.status}`;
    card.style.animationDelay = `${idx * 0.04}s`;

    const posHtml   = (f.markers    || []).map(m => `<span class="m-tag">${esc(m)}</span>`).join('');
    const negHtml   = (f.negMarkers || []).map(m => `<span class="m-tag m-tag-neg">−${esc(m)}</span>`).join('');
    const thumbHtml = f.photoUrl ? `<img class="card-thumb" src="${esc(f.photoUrl)}" loading="lazy" />` : '';

    card.innerHTML = `
      ${thumbHtml}
      <div class="card-header">
        <span class="fert-date">${f.age ? formatDate(f.age) + ' · ' + calcDpf(f.age) + ' dpf' : ''}</span>
        <span class="status-badge badge-${f.status}">${esc(f.status)}</span>
      </div>
      <div class="line-name">${esc(f.line)}</div>
      ${f.genotype ? `<div class="genotype">${esc(f.genotype)}</div>` : ''}
      <div class="card-meta">
        ${f.count    ? `<span class="meta-item"><span class="meta-icon">🐟</span>${f.count}</span>` : ''}
        ${f.location ? `<span class="meta-item"><span class="meta-icon">📍</span>${esc(f.location)}</span>` : ''}
      </div>
      ${(posHtml || negHtml) ? `<div class="card-markers">${posHtml}${negHtml}</div>` : ''}
      <div class="card-footer">
        <span class="tank-id">${esc(f.tankId || '')}</span>
        <div class="card-actions">
          ${currentExperiment
            ? `<button class="card-btn danger" onclick="removeFromExperiment('${esc(f.tankId)}', event)">✕ Remove</button>`
            : `<button class="card-btn" onclick="event.stopPropagation();openEditModal('${esc(f.id)}')">Edit</button>
          <button class="card-btn danger" onclick="event.stopPropagation();deleteFish('${esc(f.id)}')">Delete</button>`
          }
        </div>
      </div>
    `;
    card.addEventListener('click', () => openDrawer(f.id));
    grid.appendChild(card);
  });
}

// ── Marker datalists & dropdowns ──────────────────────────────────────────────
function uniquePosMarkers() { return [...new Set(fishData.flatMap(f => f.markers    || []))].sort(); }
function uniqueNegMarkers() { return [...new Set(fishData.flatMap(f => f.negMarkers || []))].sort(); }

function updateMarkerDatalists() {
  const fill = (id, items) => { const el = document.getElementById(id); if (el) el.innerHTML = items.map(m => `<option value="${esc(m)}">`).join(''); };
  fill('markers-datalist',     uniquePosMarkers());
  fill('neg-markers-datalist', uniqueNegMarkers());
}

function buildDropdownHtml(markers, activeSet, toggleFn) {
  if (!markers.length) return '<p class="marker-dropdown-empty">No markers in inventory</p>';
  return markers.map(m => `
    <label class="marker-check">
      <input type="checkbox" value="${esc(m)}" ${activeSet.has(m) ? 'checked' : ''}
        onchange="${toggleFn}('${esc(m)}', this.checked)" />
      ${esc(m)}
    </label>`).join('');
}

function positionDropdown(dropdown, btnId) {
  const rect = document.getElementById(btnId).getBoundingClientRect();
  dropdown.style.top   = (rect.bottom + 4) + 'px';
  dropdown.style.right = (window.innerWidth - rect.right) + 'px';
}

window.togglePosDropdown = function() {
  const dd = document.getElementById('pos-dropdown');
  if (!dd.classList.contains('hidden')) { dd.classList.add('hidden'); return; }
  document.getElementById('neg-dropdown').classList.add('hidden');
  positionDropdown(dd, 'pos-filter-btn');
  dd.innerHTML = buildDropdownHtml(uniquePosMarkers(), activePosMarkers, 'togglePosFilter');
  dd.classList.remove('hidden');
};

window.toggleNegDropdown = function() {
  const dd = document.getElementById('neg-dropdown');
  if (!dd.classList.contains('hidden')) { dd.classList.add('hidden'); return; }
  document.getElementById('pos-dropdown').classList.add('hidden');
  positionDropdown(dd, 'neg-filter-btn');
  dd.innerHTML = buildDropdownHtml(uniqueNegMarkers(), activeNegMarkers, 'toggleNegFilter');
  dd.classList.remove('hidden');
};

window.togglePosFilter = function(m, checked) {
  if (checked) activePosMarkers.add(m); else activePosMarkers.delete(m);
  const c = activePosMarkers.size;
  document.getElementById('pos-filter-count').textContent = c > 0 ? ` (${c})` : '';
  document.getElementById('pos-filter-btn').classList.toggle('active', c > 0);
  updateFilterSummary(); filterFish();
};

window.toggleNegFilter = function(m, checked) {
  if (checked) activeNegMarkers.add(m); else activeNegMarkers.delete(m);
  const c = activeNegMarkers.size;
  document.getElementById('neg-filter-count').textContent = c > 0 ? ` (${c})` : '';
  document.getElementById('neg-filter-btn').classList.toggle('active', c > 0);
  updateFilterSummary(); filterFish();
};

// Close dropdowns on outside click
document.addEventListener('click', e => {
  ['pos-filter-wrap','neg-filter-wrap'].forEach(id => {
    const wrap = document.getElementById(id);
    const ddId = id === 'pos-filter-wrap' ? 'pos-dropdown' : 'neg-dropdown';
    if (wrap && !wrap.contains(e.target)) document.getElementById(ddId)?.classList.add('hidden');
  });
  const expWrap = document.getElementById('exp-btn-wrap') || document.querySelector('.exp-btn-wrap');
  if (expWrap && !expWrap.contains(e.target)) closeExperimentsDropdown();
});

// ── Filter chips (multi-select status) ───────────────────────────────────────
window.setFilter = function(status) {
  if (activeStatuses.has(status)) activeStatuses.delete(status);
  else activeStatuses.add(status);
  refreshChips();
  updateFilterSummary();
  filterFish();
};

window.clearFilters = function() {
  activeStatuses.clear();
  refreshChips();
  updateFilterSummary();
  filterFish();
};

function refreshChips() {
  document.querySelectorAll('.chip').forEach(c => {
    if (c.dataset.filter === 'all') c.classList.toggle('active', activeStatuses.size === 0);
    else c.classList.toggle('active', activeStatuses.has(c.dataset.filter));
  });
}

function updateFilterSummary() {
  const total = activeStatuses.size + activePosMarkers.size + activeNegMarkers.size;
  const countEl = document.getElementById('filter-active-count');
  if (countEl) countEl.textContent = total > 0 ? ` (${total})` : '';
  updateMiniStats();
}

// ── Mobile filter sheet ───────────────────────────────────────────────────────
window.openMobileFilters = function() {
  buildMobileFilterSheet();
  document.getElementById('mobile-filter-sheet').classList.add('open');
  document.body.classList.add('modal-open');
};

window.closeMobileFilters = function() {
  document.getElementById('mobile-filter-sheet').classList.remove('open');
  checkScrollLock();
};

window.clearAllMobileFilters = function() {
  activeStatuses.clear();
  activePosMarkers.clear();
  activeNegMarkers.clear();
  refreshChips();
  document.getElementById('pos-filter-count').textContent = '';
  document.getElementById('neg-filter-count').textContent = '';
  document.getElementById('pos-filter-btn').classList.remove('active');
  document.getElementById('neg-filter-btn').classList.remove('active');
  updateFilterSummary();
  filterFish();
  buildMobileFilterSheet();
};

window.buildMobileFilterSheet = function() {
  const body = document.getElementById('mobile-filter-body');
  if (!body) return;

  const statusList = [
    { key: 'Active',    cls: 'sc-active'    },
    { key: 'Nursery',   cls: 'sc-nursery'   },
    { key: 'Incubator', cls: 'sc-incubator' },
    { key: 'Low Stock', cls: 'sc-low-stock' },
    { key: 'Archived',  cls: 'sc-archived'  },
  ];
  const cnt = s => fishData.filter(f => f.status === s).length;
  let html = '';

  // ── Status ──
  html += '<div class="mf-section"><div class="mf-section-title">Status</div>';
  const allActive = activeStatuses.size === 0;
  html += `<button class="mf-row${allActive ? ' mf-row-active' : ''}"
      onclick="clearFilters();buildMobileFilterSheet()">
    <span class="mf-check">${allActive ? '✓' : ''}</span>
    <span class="mf-row-label">All tanks</span>
    <span class="mf-row-count">${fishData.length}</span>
  </button>`;
  statusList.forEach(({ key, cls }) => {
    const on = activeStatuses.has(key);
    html += `<button class="mf-row${on ? ' mf-row-active' : ''}"
        onclick="setFilter('${key}');buildMobileFilterSheet()">
      <span class="mf-check">${on ? '✓' : ''}</span>
      <span class="mf-status-dot ${cls}">●</span>
      <span class="mf-row-label">${key}</span>
      <span class="mf-row-count">${cnt(key)}</span>
    </button>`;
  });
  html += '</div>';

  // ── Sort ──
  const sv  = document.getElementById('sort-select')?.value || 'line';
  const dir = sortDir === 1 ? '↑' : '↓';
  html += `<div class="mf-section"><div class="mf-section-title">Sort</div>
    <div class="mf-sort-row">
      <select class="mf-sort-select"
          onchange="document.getElementById('sort-select').value=this.value;sortFish()">
        <option value="line"    ${sv==='line'    ? 'selected' : ''}>Line</option>
        <option value="age"     ${sv==='age'     ? 'selected' : ''}>Fert. Date</option>
        <option value="count"   ${sv==='count'   ? 'selected' : ''}>Count</option>
        <option value="updated" ${sv==='updated' ? 'selected' : ''}>Last Updated</option>
      </select>
      <button class="mf-dir-btn" onclick="toggleSortDir();buildMobileFilterSheet()">${dir}</button>
    </div>
  </div>`;

  // ── + Markers ──
  const pm = uniquePosMarkers();
  if (pm.length) {
    html += '<div class="mf-section"><div class="mf-section-title">+ Markers (present)</div>';
    pm.forEach(m => {
      const on = activePosMarkers.has(m);
      html += `<button class="mf-row${on ? ' mf-row-active' : ''}"
          onclick="togglePosFilter('${esc(m)}',${!on});buildMobileFilterSheet()">
        <span class="mf-check">${on ? '✓' : ''}</span>
        <span class="mf-row-label mf-marker-pos">${esc(m)}</span>
      </button>`;
    });
    html += '</div>';
  }

  // ── − Markers ──
  const nm = uniqueNegMarkers();
  if (nm.length) {
    html += '<div class="mf-section"><div class="mf-section-title">− Markers (absent)</div>';
    nm.forEach(m => {
      const on = activeNegMarkers.has(m);
      html += `<button class="mf-row${on ? ' mf-row-active' : ''}"
          onclick="toggleNegFilter('${esc(m)}',${!on});buildMobileFilterSheet()">
        <span class="mf-check">${on ? '✓' : ''}</span>
        <span class="mf-row-label mf-marker-neg">${esc(m)}</span>
      </button>`;
    });
    html += '</div>';
  }

  body.innerHTML = html;
};

function updateMiniStats() {
  const bar = document.getElementById('mini-stats-bar');
  if (!bar) return;
  const statusList = [
    { key: 'Active',    cls: 'sc-active'    },
    { key: 'Nursery',   cls: 'sc-nursery'   },
    { key: 'Incubator', cls: 'sc-incubator' },
    { key: 'Low Stock', cls: 'sc-low-stock' },
    { key: 'Archived',  cls: 'sc-archived'  },
  ];
  let html = `<span class="mini-stat" onclick="clearFilters()">
    <span class="mini-stat-count">${fishData.length}</span>
    <span class="mini-stat-label">Total</span>
  </span>`;
  statusList.forEach(({ key, cls }) => {
    const n = fishData.filter(f => f.status === key).length;
    if (!n) return;
    const sel = activeStatuses.has(key);
    html += `<span class="mini-stat${sel ? ' mini-stat-sel' : ''}" onclick="setFilter('${key}')">
      <span class="mini-stat-dot ${cls}">●</span>
      <span class="mini-stat-count">${n}</span>
      <span class="mini-stat-label">${key}</span>
    </span>`;
  });
  bar.innerHTML = html;
}

// ── Scroll lock ───────────────────────────────────────────────────────────────
function checkScrollLock() {
  const anyOverlay = document.querySelector('.overlay.active') !== null;
  const drawerOpen = document.getElementById('detail-drawer')?.classList.contains('open');
  document.body.classList.toggle('modal-open', anyOverlay || !!drawerOpen);
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
window.openAddModal = function() {
  editingId = null; currentMarkers = []; currentNegMarkers = [];
  currentPhotoUrl = null; originalPhotoUrl = null; pendingPhotoFile = null;
  document.getElementById('modal-title').textContent = 'Add Tank';
  document.getElementById('fish-form').reset();
  document.getElementById('f-tank-id').value             = '';
  document.getElementById('markers-container').innerHTML     = '';
  document.getElementById('neg-markers-container').innerHTML = '';
  document.querySelector('input[name="status"][value="Active"]').checked = true;
  resetPhotoUI();
  document.getElementById('fish-modal').classList.add('active');
  checkScrollLock();
};

window.openEditModal = function(id) {
  const f = fishData.find(x => x.id === id);
  if (!f) return;
  editingId = id; currentMarkers = [...(f.markers || [])]; currentNegMarkers = [...(f.negMarkers || [])];
  currentPhotoUrl = f.photoUrl || null; originalPhotoUrl = f.photoUrl || null; pendingPhotoFile = null;
  document.getElementById('modal-title').textContent = 'Edit Tank';
  document.getElementById('f-tank-id').value  = f.tankId || f.id || '';
  document.getElementById('f-line').value     = f.line;
  document.getElementById('f-genotype').value = f.genotype || '';
  document.getElementById('f-age').value      = f.age || '';
  document.getElementById('f-count').value    = f.count || '';
  document.getElementById('f-location').value = f.location || '';
  document.getElementById('f-notes').value    = f.notes || '';
  const si = document.querySelector(`input[name="status"][value="${f.status}"]`);
  if (si) si.checked = true;
  renderMarkerTags(); renderNegMarkerTags();
  resetPhotoUI();
  if (currentPhotoUrl) showPhotoPreview(currentPhotoUrl);
  document.getElementById('fish-modal').classList.add('active');
  checkScrollLock();
};

window.closeModal = function() {
  document.getElementById('fish-modal').classList.remove('active');
  document.getElementById('pos-picker-dropdown')?.classList.add('hidden');
  document.getElementById('neg-picker-dropdown')?.classList.add('hidden');
  checkScrollLock();
};

// Photo
function resetPhotoUI() {
  document.getElementById('f-photo').value = '';
  document.getElementById('photo-preview-wrap').classList.add('hidden');
  document.getElementById('photo-upload-label').classList.remove('hidden');
}
function showPhotoPreview(url) {
  const img = document.getElementById('f-photo-preview');
  img.src     = url;
  img.onclick = () => openLightbox(url);
  document.getElementById('photo-preview-wrap').classList.remove('hidden');
  document.getElementById('photo-upload-label').classList.add('hidden');
}
window.handlePhotoSelect = function(input) {
  const file = input.files[0];
  if (!file) return;
  pendingPhotoFile = file;
  showPhotoPreview(URL.createObjectURL(file));
};
window.removePhoto = function() { currentPhotoUrl = null; pendingPhotoFile = null; resetPhotoUI(); };

window.saveFish = async function(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  let photoUrl = currentPhotoUrl || '';
  if (pendingPhotoFile && !demoMode) {
    try { showToast('📤 Uploading photo…'); photoUrl = await uploadPhoto(pendingPhotoFile); }
    catch(err) { showToast('❌ Photo upload failed: ' + err.message); saveBtn.disabled = false; saveBtn.textContent = 'Save Tank'; return; }
  }

  const record = {
    tankId:     document.getElementById('f-tank-id').value.trim() || (editingId ? (fishData.find(x => x.id === editingId)?.tankId || editingId) : `tank-${Date.now()}`),
    line:       document.getElementById('f-line').value.trim(),
    genotype:   document.getElementById('f-genotype').value.trim(),
    age:        document.getElementById('f-age').value.trim(),
    count:      parseInt(document.getElementById('f-count').value) || 0,
    location:   document.getElementById('f-location').value.trim(),
    markers:    [...currentMarkers],
    negMarkers: [...currentNegMarkers],
    status:     document.querySelector('input[name="status"]:checked').value,
    notes:      document.getElementById('f-notes').value.trim(),
    photoUrl, updated: new Date().toISOString().slice(0, 10),
  };
  record.id = record.tankId;

  if (editingId) {
    const idx = fishData.findIndex(x => x.id === editingId);
    if (idx !== -1) {
      const oldRec = { ...fishData[idx] };
      record._rowIndex = fishData[idx]._rowIndex;
      fishData[idx] = record;
      if (!demoMode) {
        await updateSheetRow(record, record._rowIndex);
        if (originalPhotoUrl && originalPhotoUrl !== photoUrl) deleteDrivePhoto(originalPhotoUrl);
        logChange('Edited', record, diffRecord(oldRec, record));
      }
    }
    showToast('✅ Tank updated');
  } else {
    if (!demoMode) {
      const rowIndex = await appendToSheets(record);
      record._rowIndex = rowIndex || fishData.length + 2;
      const addDetails = [
        `Line: ${record.line}`,
        `Status: ${record.status}`,
        record.count   ? `Count: ${record.count}`        : null,
        record.location? `Location: ${record.location}`  : null,
        (record.markers    ||[]).length ? `+Markers: [${record.markers.join(', ')}]`    : null,
        (record.negMarkers ||[]).length ? `−Markers: [${record.negMarkers.join(', ')}]` : null,
        record.photoUrl ? 'Photo: added' : null,
      ].filter(Boolean).join(' | ');
      logChange('Added', record, addDetails);
    } else {
      record._rowIndex = fishData.length + 2;
    }
    fishData.push(record);
    showToast('✅ Tank added');
  }

  saveBtn.disabled = false; saveBtn.textContent = 'Save Tank';
  closeModal(); renderAll();
};

// ── Marker tag rendering ──────────────────────────────────────────────────────
function renderMarkerTags() {
  document.getElementById('markers-container').innerHTML = currentMarkers.map((m, i) =>
    `<span class="marker-tag">${esc(m)}<button type="button" onclick="removeMarker(${i})">×</button></span>`).join('');
}
window.removeMarker = function(i) { currentMarkers.splice(i, 1); renderMarkerTags(); refreshPosPicker(); };

function renderNegMarkerTags() {
  document.getElementById('neg-markers-container').innerHTML = currentNegMarkers.map((m, i) =>
    `<span class="marker-tag marker-tag-neg">${esc(m)}<button type="button" onclick="removeNegMarker(${i})">×</button></span>`).join('');
}
window.removeNegMarker = function(i) { currentNegMarkers.splice(i, 1); renderNegMarkerTags(); refreshNegPicker(); };

// ── Marker picker dropdowns (in Add/Edit modal) ───────────────────────────────
function buildPickerHtml(allMarkers, currentList, toggleFn, newInputId) {
  let html = '';
  if (allMarkers.length) {
    html += allMarkers.map(m => {
      const on = currentList.includes(m);
      return `<label class="mpick-row${on ? ' mpick-checked' : ''}">
        <input type="checkbox" ${on ? 'checked' : ''}
          onchange="${toggleFn}('${esc(m)}', this.checked)" />
        ${esc(m)}
      </label>`;
    }).join('');
    html += '<div class="mpick-divider">── or type new ──</div>';
  }
  html += `<div class="mpick-new-row">
    <input type="text" id="${newInputId}" class="mpick-new-input" placeholder="New marker…"
      onkeydown="if(event.key==='Enter'){event.preventDefault();addNewMarker('${newInputId}')}" />
    <button type="button" class="btn-tag-add" onclick="addNewMarker('${newInputId}')">+</button>
  </div>`;
  return html;
}

function refreshPosPicker() {
  const dd = document.getElementById('pos-picker-dropdown');
  if (!dd || dd.classList.contains('hidden')) return;
  const prev = document.getElementById('pos-new-input')?.value || '';
  dd.innerHTML = buildPickerHtml(uniquePosMarkers(), currentMarkers, 'toggleMarkerInPicker', 'pos-new-input');
  const ni = document.getElementById('pos-new-input');
  if (ni) ni.value = prev;
}
function refreshNegPicker() {
  const dd = document.getElementById('neg-picker-dropdown');
  if (!dd || dd.classList.contains('hidden')) return;
  const prev = document.getElementById('neg-new-input')?.value || '';
  dd.innerHTML = buildPickerHtml(uniqueNegMarkers(), currentNegMarkers, 'toggleNegMarkerInPicker', 'neg-new-input');
  const ni = document.getElementById('neg-new-input');
  if (ni) ni.value = prev;
}

window.togglePosPicker = function() {
  const dd = document.getElementById('pos-picker-dropdown');
  const opening = dd.classList.contains('hidden');
  document.getElementById('pos-picker-dropdown').classList.add('hidden');
  document.getElementById('neg-picker-dropdown').classList.add('hidden');
  if (opening) {
    dd.innerHTML = buildPickerHtml(uniquePosMarkers(), currentMarkers, 'toggleMarkerInPicker', 'pos-new-input');
    dd.classList.remove('hidden');
    setTimeout(() => document.getElementById('pos-new-input')?.focus(), 50);
  }
};

window.toggleNegPicker = function() {
  const dd = document.getElementById('neg-picker-dropdown');
  const opening = dd.classList.contains('hidden');
  document.getElementById('pos-picker-dropdown').classList.add('hidden');
  document.getElementById('neg-picker-dropdown').classList.add('hidden');
  if (opening) {
    dd.innerHTML = buildPickerHtml(uniqueNegMarkers(), currentNegMarkers, 'toggleNegMarkerInPicker', 'neg-new-input');
    dd.classList.remove('hidden');
    setTimeout(() => document.getElementById('neg-new-input')?.focus(), 50);
  }
};

window.toggleMarkerInPicker = function(m, checked) {
  if (checked && !currentMarkers.includes(m)) currentMarkers.push(m);
  else if (!checked) currentMarkers = currentMarkers.filter(x => x !== m);
  renderMarkerTags(); refreshPosPicker();
};

window.toggleNegMarkerInPicker = function(m, checked) {
  if (checked && !currentNegMarkers.includes(m)) currentNegMarkers.push(m);
  else if (!checked) currentNegMarkers = currentNegMarkers.filter(x => x !== m);
  renderNegMarkerTags(); refreshNegPicker();
};

window.addNewMarker = function(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const v = input.value.trim();
  if (!v) return;
  if (inputId === 'pos-new-input') {
    if (!currentMarkers.includes(v)) { currentMarkers.push(v); renderMarkerTags(); }
    refreshPosPicker();
  } else {
    if (!currentNegMarkers.includes(v)) { currentNegMarkers.push(v); renderNegMarkerTags(); }
    refreshNegPicker();
  }
  input.value = ''; input.focus();
};

// Escape key closes dropdowns and overlays
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeExperimentsDropdown();
  if (!document.getElementById('tank-picker-overlay')?.classList.contains('hidden')) closeTankPicker();
});

// Close picker dropdowns on outside click
document.addEventListener('click', e => {
  ['pos-picker-wrap', 'neg-picker-wrap'].forEach(id => {
    const wrap = document.getElementById(id);
    if (wrap && !wrap.contains(e.target)) {
      wrap.querySelector('.marker-picker-dropdown')?.classList.add('hidden');
    }
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────
window.deleteFish = async function(id) {
  if (!confirm('Delete this tank record?')) return;
  const fish = fishData.find(f => f.id === id);
  if (!fish) return;
  if (!demoMode && fish._rowIndex) {
    try {
      await deleteSheetRow(fish._rowIndex);
      if (fish.photoUrl) deleteDrivePhoto(fish.photoUrl);
      const delDetails = [
        `Line: ${fish.line}`,
        `Status: ${fish.status}`,
        fish.count    ? `Count: ${fish.count}`        : null,
        fish.location ? `Location: ${fish.location}`  : null,
        (fish.markers    ||[]).length ? `+Markers: [${fish.markers.join(', ')}]`    : null,
        (fish.negMarkers ||[]).length ? `−Markers: [${fish.negMarkers.join(', ')}]` : null,
        fish.photoUrl ? 'Had photo' : null,
      ].filter(Boolean).join(' | ');
      logChange('Deleted', fish, delDetails);
      await fetchFromSheets();
    } catch(e) { showToast('❌ Delete failed: ' + e.message); return; }
  } else {
    fishData = fishData.filter(f => f.id !== id);
  }
  // Remove deleted tank from any experiments
  const deletedId = fish.tankId;
  if (deletedId) {
    experiments.forEach(exp => { exp.tankIds = exp.tankIds.filter(id => id !== deletedId); });
    if (currentExperiment) currentExperiment.tankIds = currentExperiment.tankIds.filter(id => id !== deletedId);
  }
  showToast('🗑 Tank deleted');
  closeDrawer(); renderAll();
};

// ── Detail Drawer ─────────────────────────────────────────────────────────────
window.openDrawer = function(id) {
  const f = fishData.find(x => x.id === id);
  if (!f) return;
  const posHtml = (f.markers    || []).length ? (f.markers   || []).map(m => `<span class="m-tag">${esc(m)}</span>`).join(' ')           : '<span style="color:var(--text-dim)">None</span>';
  const negHtml = (f.negMarkers || []).length ? (f.negMarkers|| []).map(m => `<span class="m-tag m-tag-neg">−${esc(m)}</span>`).join(' ') : '<span style="color:var(--text-dim)">None</span>';
  const photoHtml = f.photoUrl ? `<img class="drawer-photo" src="${esc(f.photoUrl)}" onclick="openLightbox('${esc(f.photoUrl)}')" title="Click to enlarge" />` : '';

  document.getElementById('drawer-content').innerHTML = `
    ${photoHtml}
    <div class="drawer-line">${esc(f.line)}</div>
    <span class="status-badge badge-${f.status}" style="margin-top:.25rem;display:inline-block">${esc(f.status)}</span>
    <div class="drawer-section">
      <h4>Details</h4>
      <div class="drawer-row"><span class="drawer-row-label">Genotype</span><span class="drawer-row-val">${esc(f.genotype || '—')}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Fert. Date</span><span class="drawer-row-val">${formatDate(f.age)}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Count</span><span class="drawer-row-val">${f.count || '—'}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Location</span><span class="drawer-row-val">${esc(f.location || '—')}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Last Updated</span><span class="drawer-row-val">${esc(f.updated || '—')}</span></div>
    </div>
    <div class="drawer-section">
      <h4>Positive Markers</h4>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem;padding:.5rem 0">${posHtml}</div>
    </div>
    <div class="drawer-section">
      <h4>Negative Markers</h4>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem;padding:.5rem 0">${negHtml}</div>
    </div>
    ${f.notes ? `<div class="drawer-section"><h4>Notes</h4><p style="font-size:.88rem;color:var(--text-muted);line-height:1.5">${esc(f.notes)}</p></div>` : ''}
    <div class="drawer-actions">
      <button class="btn-primary" onclick="closeDrawer();openEditModal('${esc(f.id)}')">Edit</button>
      <button class="btn-ghost"   onclick="closeDrawer();deleteFish('${esc(f.id)}')">Delete</button>
    </div>
  `;
  document.getElementById('detail-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('active');
  checkScrollLock();
};

window.closeDrawer = function() {
  document.getElementById('detail-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('active');
  checkScrollLock();
};

// ── Lightbox ──────────────────────────────────────────────────────────────────
window.openLightbox = function(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('photo-lightbox').classList.add('active');
  checkScrollLock();
};
window.closeLightbox = function() {
  document.getElementById('photo-lightbox').classList.remove('active');
  checkScrollLock();
};

// ── Barcode Scanner ───────────────────────────────────────────────────────────
window.openScanner = function() {
  scanForForm = false;
  document.getElementById('scan-overlay').classList.add('active');
  document.getElementById('scan-status').textContent = 'Initializing camera…';
  document.getElementById('manual-barcode').value    = '';
  checkScrollLock(); startQuagga();
};
window.openScannerForForm = function() {
  scanForForm = true;
  document.getElementById('scan-overlay').classList.add('active');
  document.getElementById('scan-status').textContent = 'Initializing camera…';
  document.getElementById('manual-barcode').value    = '';
  checkScrollLock(); startQuagga();
};
window.closeScanner = function() {
  document.getElementById('scan-overlay').classList.remove('active');
  scanForForm = false;
  stopQuagga(); checkScrollLock();
};
function startQuagga() {
  if (typeof Quagga === 'undefined') { document.getElementById('scan-status').textContent = 'Scanner not available. Use manual entry.'; return; }
  Quagga.init({
    inputStream: { name:'Live', type:'LiveStream', target: document.querySelector('#interactive'), constraints: { facingMode:'environment', width:{ideal:1280}, height:{ideal:720} } },
    decoder:     { readers: ['code_128_reader','ean_reader','ean_8_reader','code_39_reader','upc_reader'] },
    locate: true,
  }, err => {
    if (err) { document.getElementById('scan-status').textContent = 'Camera error — use manual entry.'; return; }
    Quagga.start(); scannerRunning = true;
    document.getElementById('scan-status').textContent = 'Point camera at barcode…';
  });
  Quagga.onDetected(result => {
    stopQuagga();
    document.getElementById('scan-overlay').classList.remove('active');
    checkScrollLock();
    const code = result.codeResult.code;
    if (scanForForm) {
      scanForForm = false;
      document.getElementById('f-tank-id').value = code;
      showToast(`📷 Scanned: ${code}`);
      return;
    }
    const found = fishData.find(f => f.tankId === code);
    showToast(`📷 Scanned: ${code}`);
    if (found) openDrawer(found.id);
    else { openAddModal(); document.getElementById('f-tank-id').value = code; }
  });
}
function stopQuagga() {
  if (scannerRunning && typeof Quagga !== 'undefined') { try { Quagga.stop(); } catch(_){} scannerRunning = false; }
}
window.manualBarcode = function() {
  const v = document.getElementById('manual-barcode').value.trim();
  if (!v) return;
  closeScanner();
  if (scanForForm) {
    scanForForm = false;
    document.getElementById('f-tank-id').value = v;
    showToast(`📷 Entered: ${v}`);
    return;
  }
  const found = fishData.find(f => f.tankId === v);
  showToast(`📷 Scanned: ${v}`);
  if (found) openDrawer(found.id);
  else { openAddModal(); document.getElementById('f-tank-id').value = v; }
};
document.addEventListener('keydown', e => { if (e.target.id === 'manual-barcode' && e.key === 'Enter') manualBarcode(); });

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); document.getElementById('search-input')?.focus(); }
  if (e.key==='Escape') { closeModal(); closeDrawer(); closeScanner(); closeLightbox(); closeMobileFilters(); }
  if ((e.metaKey||e.ctrlKey) && e.key==='n') { e.preventDefault(); openAddModal(); }
});
