/* ── ZebraBase app.js ── */

// ── Constants ───────────────────────────────────────────────────────────────
const CLIENT_ID    = '100004327605-af8aqv1jshg1u1bhiude24po7oc4mdf4.apps.googleusercontent.com';
const SHEET_ID     = '1AviXu1_KPFRx158Af05qBmA-LCw2GhxJxvfZEFUCuqY';
const TAB_NAME     = 'Fish';
const DRIVE_FOLDER = '1VTpNTlB-JMLPZNKzgm0IIXCRkk9Agzf7';
const SCOPES       = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

// ── State ───────────────────────────────────────────────────────────────────
let tokenClient    = null;
let accessToken    = null;
let tokenExpiry    = 0;
let tokenResolvers = [];
let sheetGid       = 0;

let fishData        = [];
let filtered        = [];
let activeFilter    = 'all';
let currentMarkers  = [];
let currentPhotoUrl = null;
let pendingPhotoFile = null;
let editingId       = null;
let demoMode        = false;
let scannerContext  = 'search'; // 'search' | 'modal'
let activeMarkers   = new Set();

// Column order in the Google Sheet (zero-indexed):
// TankID | Line | Genotype | Age | Count | Location | Markers | Status | Notes | LastUpdated | Photo
const COL = {
  tankId:  0, line:    1, genotype: 2,
  age:     3, count:   4, location: 5,
  markers: 6, status:  7, notes:    8,
  updated: 9, photo:  10,
};

// ── Demo data ────────────────────────────────────────────────────────────────
const DEMO = [
  { tankId:'TK-001', line:'Tg(fli1:EGFP)',     genotype:'+/+',             age:'90 dpf',  count:12, location:'Rack 1A, Shelf 2', markers:['EGFP','fli1'],   status:'Active',    notes:'Healthy, spawning well', photoUrl:'', updated:'2025-04-20' },
  { tankId:'TK-002', line:'Tg(gata1:DsRed)',   genotype:'+/-',             age:'60 dpf',  count:8,  location:'Rack 1A, Shelf 3', markers:['DsRed','gata1'], status:'Breeding',  notes:'Set up breeding pair',   photoUrl:'', updated:'2025-04-22' },
  { tankId:'TK-003', line:'casper',            genotype:'roy−/−;nacre−/−', age:'120 dpf', count:3,  location:'Rack 2B, Shelf 1', markers:[],               status:'Low Stock', notes:'Need to expand',          photoUrl:'', updated:'2025-04-15' },
  { tankId:'TK-004', line:'Tg(mpeg1:mCherry)', genotype:'+/+',             age:'30 dpf',  count:20, location:'Rack 2B, Shelf 4', markers:['mCherry','mpeg1'],status:'Active',    notes:'',                       photoUrl:'', updated:'2025-04-21' },
  { tankId:'TK-005', line:'AB wild-type',      genotype:'WT',              age:'180 dpf', count:6,  location:'Rack 3C, Shelf 1', markers:[],               status:'Archived',  notes:'Retired breeders',        photoUrl:'', updated:'2025-03-10' },
  { tankId:'TK-006', line:'Tg(huc:GCaMP6s)',  genotype:'+/+',             age:'45 dpf',  count:15, location:'Rack 1B, Shelf 1', markers:['GCaMP6s','huc'], status:'Active',    notes:'Imaging stock',           photoUrl:'', updated:'2025-04-23' },
];

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('zebrabase-demo') === 'true') {
    useDemoMode();
    return;
  }
  const poll = setInterval(() => {
    if (window.google?.accounts?.oauth2) {
      clearInterval(poll);
      initTokenClient();
    }
  }, 100);
});

function initTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error) {
        tokenResolvers.forEach(r => r.reject(new Error(response.error)));
        tokenResolvers = [];
        showToast('❌ Sign in failed: ' + response.error);
        const btn = document.getElementById('signin-btn');
        btn.disabled = false;
        btn.innerHTML = googleBtnContent();
        return;
      }
      accessToken = response.access_token;
      tokenExpiry  = Date.now() + (response.expires_in - 60) * 1000;
      tokenResolvers.forEach(r => r.resolve());
      tokenResolvers = [];
    },
  });
}

function googleBtnContent() {
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
  if (!tokenClient) {
    showToast('⚠️ Google Auth not ready yet, please wait…');
    return;
  }
  const btn = document.getElementById('signin-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    await new Promise((resolve, reject) => {
      tokenResolvers.push({ resolve, reject });
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    });
    await Promise.all([fetchSheetGid(), fetchFromSheets()]);
    showApp();
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = googleBtnContent();
  }
};

window.signOut = function() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiry  = 0;
  fishData     = [];
  demoMode     = false;
  localStorage.removeItem('zebrabase-demo');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('setup-overlay').classList.add('active');
  const btn = document.getElementById('signin-btn');
  btn.disabled = false;
  btn.innerHTML = googleBtnContent();
};

window.useDemoMode = function() {
  demoMode = true;
  localStorage.setItem('zebrabase-demo', 'true');
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

// ── Authenticated fetch ──────────────────────────────────────────────────────
async function authFetch(url, options = {}) {
  if (!accessToken || Date.now() > tokenExpiry) {
    showToast('⚠️ Session expired — please sign in again.');
    signOut();
    throw new Error('No valid token');
  }
  return fetch(url, {
    ...options,
    headers: { ...options.headers, 'Authorization': `Bearer ${accessToken}` },
  });
}

// ── Google Sheets ─────────────────────────────────────────────────────────────
async function fetchSheetGid() {
  try {
    const res  = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`);
    const json = await res.json();
    const sheet = (json.sheets || []).find(s => s.properties.title === TAB_NAME);
    sheetGid = sheet?.properties?.sheetId ?? 0;
  } catch(e) {
    console.warn('Could not fetch sheet GID:', e.message);
  }
}

async function fetchFromSheets() {
  try {
    const res  = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}`);
    const json = await res.json();
    if (json.error) { showToast('❌ Sheets error: ' + json.error.message); return false; }
    const rows = json.values || [];
    fishData = rows.slice(1).map((r, i) => ({
      id:       r[COL.tankId]  || `row-${i+2}`,
      tankId:   r[COL.tankId]  || '',
      line:     r[COL.line]    || '',
      genotype: r[COL.genotype]|| '',
      age:      r[COL.age]     || '',
      count:    parseInt(r[COL.count]) || 0,
      location: r[COL.location]|| '',
      markers:  r[COL.markers] ? r[COL.markers].split(',').map(m => m.trim()).filter(Boolean) : [],
      status:   r[COL.status]  || 'Active',
      notes:    r[COL.notes]   || '',
      updated:  r[COL.updated] || '',
      photoUrl: r[COL.photo]   || '',
      _rowIndex: i + 2,
    }));
    showToast('✅ Synced ' + fishData.length + ' tanks');
    return true;
  } catch(e) {
    showToast('❌ Network error: ' + e.message);
    return false;
  }
}

async function appendToSheets(record) {
  const res  = await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [recordToRow(record)] }) }
  );
  const json = await res.json();
  const match = json.updates?.updatedRange?.match(/(\d+)$/);
  return match ? parseInt(match[1]) : null;
}

async function updateSheetRow(record, rowIndex) {
  const range = `${TAB_NAME}!A${rowIndex}`;
  await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [recordToRow(record)] }) }
  );
}

async function deleteSheetRow(rowIndex) {
  await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ deleteDimension: { range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex } } }]
      }),
    }
  );
}

function recordToRow(r) {
  return [
    r.tankId, r.line, r.genotype, r.age,
    r.count, r.location,
    (r.markers || []).join(', '),
    r.status, r.notes,
    new Date().toISOString().slice(0, 10),
    r.photoUrl || '',
  ];
}

window.syncSheets = async function() {
  const btn = document.getElementById('sync-btn');
  btn.classList.add('spinning');
  if (demoMode) {
    await new Promise(r => setTimeout(r, 600));
    btn.classList.remove('spinning');
    showToast('🐠 Demo mode — nothing to sync');
    return;
  }
  await fetchFromSheets();
  renderAll();
  btn.classList.remove('spinning');
};

// ── Google Drive (photo upload) ──────────────────────────────────────────────
async function uploadPhoto(file) {
  const metadata = {
    name: `zebrabase_${Date.now()}_${file.name}`,
    mimeType: file.type,
    parents: [DRIVE_FOLDER],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const uploadRes  = await authFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
  const { id: fileId } = await uploadRes.json();

  await authFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  updateStats();
  updateMarkerDatalist();
  updateMarkerDropdown();
  filterFish();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function allUniqueMarkers() {
  return [...new Set(fishData.flatMap(f => f.markers || []))].sort();
}

function updateMarkerDatalist() {
  const datalist = document.getElementById('markers-datalist');
  if (!datalist) return;
  datalist.innerHTML = allUniqueMarkers().map(m => `<option value="${esc(m)}">`).join('');
}

function updateMarkerDropdown() {
  const dropdown = document.getElementById('marker-dropdown');
  if (!dropdown || dropdown.classList.contains('hidden')) return;
  const markers = allUniqueMarkers();
  if (markers.length === 0) {
    dropdown.innerHTML = '<p class="marker-dropdown-empty">No markers in inventory</p>';
    return;
  }
  dropdown.innerHTML = markers.map(m => `
    <label class="marker-check">
      <input type="checkbox" value="${esc(m)}" ${activeMarkers.has(m) ? 'checked' : ''}
        onchange="toggleMarkerFilter('${esc(m)}', this.checked)" />
      ${esc(m)}
    </label>
  `).join('');
}

window.toggleMarkerDropdown = function() {
  const dropdown = document.getElementById('marker-dropdown');
  const btn      = document.getElementById('marker-filter-btn');
  if (!dropdown.classList.contains('hidden')) {
    dropdown.classList.add('hidden');
    return;
  }
  const rect = btn.getBoundingClientRect();
  dropdown.style.top   = (rect.bottom + 4) + 'px';
  dropdown.style.right = (window.innerWidth - rect.right) + 'px';
  dropdown.classList.remove('hidden');
  updateMarkerDropdown();
};

window.toggleMarkerFilter = function(marker, checked) {
  if (checked) activeMarkers.add(marker); else activeMarkers.delete(marker);
  const count = activeMarkers.size;
  const countEl = document.getElementById('marker-filter-count');
  if (countEl) countEl.textContent = count > 0 ? ` (${count})` : '';
  const btn = document.getElementById('marker-filter-btn');
  if (btn) btn.classList.toggle('active', count > 0);
  filterFish();
};

document.addEventListener('click', e => {
  const wrap = document.getElementById('marker-filter-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('marker-dropdown')?.classList.add('hidden');
  }
});

function updateStats() {
  document.getElementById('stat-total').textContent   = fishData.length;
  document.getElementById('stat-active').textContent  = fishData.filter(f => f.status === 'Active').length;
  document.getElementById('stat-breed').textContent   = fishData.filter(f => f.status === 'Breeding').length;
  document.getElementById('stat-low').textContent     = fishData.filter(f => f.status === 'Low Stock').length;
  document.getElementById('stat-nursery').textContent = fishData.filter(f => f.status === 'Nursery').length;
}

window.filterFish = function() {
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  filtered = fishData.filter(f => {
    if (activeFilter !== 'all' && f.status !== activeFilter) return false;
    if (activeMarkers.size > 0) {
      const fishMarkerSet = new Set(f.markers || []);
      for (const m of activeMarkers) { if (!fishMarkerSet.has(m)) return false; }
    }
    if (!q) return true;
    return (
      f.tankId.toLowerCase().includes(q)   ||
      f.line.toLowerCase().includes(q)     ||
      f.genotype.toLowerCase().includes(q) ||
      f.location.toLowerCase().includes(q) ||
      (f.markers || []).some(m => m.toLowerCase().includes(q)) ||
      (f.notes || '').toLowerCase().includes(q)
    );
  });
  sortFish();
};

window.sortFish = function() {
  const s = document.getElementById('sort-select').value;
  filtered.sort((a, b) => {
    if (s === 'tank')    return a.tankId.localeCompare(b.tankId);
    if (s === 'line')    return a.line.localeCompare(b.line);
    if (s === 'age')     return (a.age || '').localeCompare(b.age || '');
    if (s === 'count')   return (b.count || 0) - (a.count || 0);
    if (s === 'updated') return (b.updated || '').localeCompare(a.updated || '');
    return 0;
  });
  renderGrid();
};

function renderGrid() {
  const grid  = document.getElementById('fish-grid');
  const empty = document.getElementById('empty-state');
  Array.from(grid.querySelectorAll('.fish-card')).forEach(c => c.remove());

  if (filtered.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  filtered.forEach((f, idx) => {
    const card = document.createElement('div');
    card.className = `fish-card status-${f.status}`;
    card.style.animationDelay = `${idx * 0.04}s`;

    const markersHtml = (f.markers || []).map(m => `<span class="m-tag">${esc(m)}</span>`).join('');
    const thumbHtml   = f.photoUrl
      ? `<img class="card-thumb" src="${esc(f.photoUrl)}" alt="Tank photo" loading="lazy" />`
      : '';

    card.innerHTML = `
      ${thumbHtml}
      <div class="card-header">
        <span class="tank-id">${esc(f.tankId || '—')}</span>
        <span class="status-badge badge-${f.status}">${esc(f.status)}</span>
      </div>
      <div class="line-name">${esc(f.line)}</div>
      ${f.genotype ? `<div class="genotype">${esc(f.genotype)}</div>` : ''}
      <div class="card-meta">
        ${f.age      ? `<span class="meta-item"><span class="meta-icon">⏱</span>${esc(f.age)}</span>` : ''}
        ${f.count    ? `<span class="meta-item"><span class="meta-icon">🐟</span>${f.count}</span>` : ''}
        ${f.location ? `<span class="meta-item"><span class="meta-icon">📍</span>${esc(f.location)}</span>` : ''}
      </div>
      ${markersHtml ? `<div class="card-markers">${markersHtml}</div>` : ''}
      <div class="card-actions">
        <button class="card-btn" onclick="event.stopPropagation(); openEditModal('${esc(f.id)}')">Edit</button>
        <button class="card-btn danger" onclick="event.stopPropagation(); deleteFish('${esc(f.id)}')">Delete</button>
      </div>
    `;
    card.addEventListener('click', () => openDrawer(f.id));
    grid.appendChild(card);
  });
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Filter chips ──────────────────────────────────────────────────────────────
window.setFilter = function(val) {
  activeFilter = val;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === val));
  filterFish();
};

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
window.openAddModal = function() {
  editingId        = null;
  currentMarkers   = [];
  currentPhotoUrl  = null;
  pendingPhotoFile = null;
  document.getElementById('modal-title').textContent = 'Add Tank';
  document.getElementById('fish-form').reset();
  document.getElementById('markers-container').innerHTML = '';
  document.querySelector('input[name="status"][value="Active"]').checked = true;
  resetPhotoUI();
  document.getElementById('fish-modal').classList.add('active');
};

window.openEditModal = function(id) {
  const f = fishData.find(x => x.id === id);
  if (!f) return;
  editingId        = id;
  currentMarkers   = [...(f.markers || [])];
  currentPhotoUrl  = f.photoUrl || null;
  pendingPhotoFile = null;
  document.getElementById('modal-title').textContent = 'Edit Tank';
  document.getElementById('f-tank-id').value  = f.tankId;
  document.getElementById('f-line').value     = f.line;
  document.getElementById('f-genotype').value = f.genotype || '';
  document.getElementById('f-age').value      = f.age || '';
  document.getElementById('f-count').value    = f.count || '';
  document.getElementById('f-location').value = f.location || '';
  document.getElementById('f-notes').value    = f.notes || '';
  const statusInput = document.querySelector(`input[name="status"][value="${f.status}"]`);
  if (statusInput) statusInput.checked = true;
  renderMarkerTags();
  resetPhotoUI();
  if (currentPhotoUrl) showPhotoPreview(currentPhotoUrl);
  document.getElementById('fish-modal').classList.add('active');
};

window.closeModal = function() {
  document.getElementById('fish-modal').classList.remove('active');
};

// Photo helpers
function resetPhotoUI() {
  document.getElementById('f-photo').value = '';
  document.getElementById('photo-preview-wrap').classList.add('hidden');
  document.getElementById('photo-upload-label').classList.remove('hidden');
}

function showPhotoPreview(url) {
  document.getElementById('f-photo-preview').src = url;
  document.getElementById('photo-preview-wrap').classList.remove('hidden');
  document.getElementById('photo-upload-label').classList.add('hidden');
}

window.handlePhotoSelect = function(input) {
  const file = input.files[0];
  if (!file) return;
  pendingPhotoFile = file;
  showPhotoPreview(URL.createObjectURL(file));
};

window.removePhoto = function() {
  currentPhotoUrl  = null;
  pendingPhotoFile = null;
  resetPhotoUI();
};

window.saveFish = async function(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  let photoUrl = currentPhotoUrl || '';
  if (pendingPhotoFile && !demoMode) {
    try {
      showToast('📤 Uploading photo…');
      photoUrl = await uploadPhoto(pendingPhotoFile);
    } catch(err) {
      showToast('❌ Photo upload failed: ' + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Tank';
      return;
    }
  }

  const tankIdRaw = document.getElementById('f-tank-id').value.trim();
  const record = {
    tankId:   tankIdRaw,
    line:     document.getElementById('f-line').value.trim(),
    genotype: document.getElementById('f-genotype').value.trim(),
    age:      document.getElementById('f-age').value.trim(),
    count:    parseInt(document.getElementById('f-count').value) || 0,
    location: document.getElementById('f-location').value.trim(),
    markers:  [...currentMarkers],
    status:   document.querySelector('input[name="status"]:checked').value,
    notes:    document.getElementById('f-notes').value.trim(),
    photoUrl,
    updated:  new Date().toISOString().slice(0, 10),
  };
  // Auto-generate ID if blank
  record.id = record.tankId || `tank-${Date.now()}`;
  if (!record.tankId) record.tankId = record.id;

  if (editingId) {
    const idx = fishData.findIndex(x => x.id === editingId);
    if (idx !== -1) {
      record._rowIndex = fishData[idx]._rowIndex;
      fishData[idx] = record;
      if (!demoMode) await updateSheetRow(record, record._rowIndex);
    }
    showToast('✅ Tank updated');
  } else {
    if (tankIdRaw && fishData.find(x => x.tankId === tankIdRaw)) {
      showToast('⚠️ Tank ID already exists');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Tank';
      return;
    }
    if (!demoMode) {
      const rowIndex = await appendToSheets(record);
      record._rowIndex = rowIndex || fishData.length + 2;
    } else {
      record._rowIndex = fishData.length + 2;
    }
    fishData.push(record);
    showToast('✅ Tank added');
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Tank';
  closeModal();
  renderAll();
};

// Markers
window.addMarkerTag = function() {
  const input = document.getElementById('marker-input');
  const val   = input.value.trim();
  if (val && !currentMarkers.includes(val)) { currentMarkers.push(val); renderMarkerTags(); }
  input.value = '';
  input.focus();
};

document.addEventListener('keydown', e => {
  if (e.target.id === 'marker-input' && e.key === 'Enter') { e.preventDefault(); addMarkerTag(); }
});

function renderMarkerTags() {
  document.getElementById('markers-container').innerHTML = currentMarkers.map((m, i) =>
    `<span class="marker-tag">${esc(m)}<button type="button" onclick="removeMarker(${i})">×</button></span>`
  ).join('');
}

window.removeMarker = function(i) { currentMarkers.splice(i, 1); renderMarkerTags(); };

// ── Delete ────────────────────────────────────────────────────────────────────
window.deleteFish = async function(id) {
  if (!confirm('Delete this tank record?')) return;
  const fish = fishData.find(f => f.id === id);
  if (!fish) return;

  if (!demoMode && fish._rowIndex) {
    try {
      await deleteSheetRow(fish._rowIndex);
      await fetchFromSheets();
    } catch(e) {
      showToast('❌ Delete failed: ' + e.message);
      return;
    }
  } else {
    fishData = fishData.filter(f => f.id !== id);
  }
  showToast('🗑 Tank deleted');
  closeDrawer();
  renderAll();
};

// ── Detail Drawer ─────────────────────────────────────────────────────────────
window.openDrawer = function(id) {
  const f = fishData.find(x => x.id === id);
  if (!f) return;

  const markersHtml = (f.markers || []).length
    ? (f.markers || []).map(m => `<span class="m-tag">${esc(m)}</span>`).join(' ')
    : '<span style="color:var(--text-dim)">None</span>';

  document.getElementById('drawer-content').innerHTML = `
    ${f.photoUrl ? `<img class="drawer-photo" src="${esc(f.photoUrl)}" alt="Tank photo" />` : ''}
    <div class="drawer-fish-id">${esc(f.tankId || '—')}</div>
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
      <h4>Markers / Transgenes</h4>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem;padding:.5rem 0">${markersHtml}</div>
    </div>

    ${f.notes ? `
    <div class="drawer-section">
      <h4>Notes</h4>
      <p style="font-size:.88rem;color:var(--text-muted);line-height:1.5">${esc(f.notes)}</p>
    </div>` : ''}

    <div class="drawer-actions">
      <button class="btn-primary" onclick="closeDrawer();openEditModal('${esc(f.id)}')">Edit</button>
      <button class="btn-ghost" onclick="closeDrawer();deleteFish('${esc(f.id)}')">Delete</button>
    </div>
  `;

  document.getElementById('detail-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('active');
};

window.closeDrawer = function() {
  document.getElementById('detail-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('active');
};

// ── Barcode Scanner ───────────────────────────────────────────────────────────
let scannerRunning = false;

window.openScanner = function(context = 'search') {
  scannerContext = context;
  document.getElementById('scan-overlay').classList.add('active');
  document.getElementById('scan-status').textContent = 'Initializing camera…';
  document.getElementById('manual-barcode').value = '';
  startQuagga();
};

window.closeScanner = function() {
  document.getElementById('scan-overlay').classList.remove('active');
  stopQuagga();
};

function startQuagga() {
  if (typeof Quagga === 'undefined') {
    document.getElementById('scan-status').textContent = 'Scanner not available. Use manual entry.';
    return;
  }
  Quagga.init({
    inputStream: {
      name: 'Live', type: 'LiveStream',
      target: document.querySelector('#interactive'),
      constraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    },
    decoder: { readers: ['code_128_reader','ean_reader','ean_8_reader','code_39_reader','upc_reader'] },
    locate: true,
  }, err => {
    if (err) { document.getElementById('scan-status').textContent = 'Camera error — use manual entry.'; return; }
    Quagga.start();
    scannerRunning = true;
    document.getElementById('scan-status').textContent = 'Point camera at barcode…';
  });
  Quagga.onDetected(result => {
    stopQuagga();
    document.getElementById('scan-overlay').classList.remove('active');
    handleBarcode(result.codeResult.code);
  });
}

function stopQuagga() {
  if (scannerRunning && typeof Quagga !== 'undefined') {
    try { Quagga.stop(); } catch(_){}
    scannerRunning = false;
  }
}

window.manualBarcode = function() {
  const val = document.getElementById('manual-barcode').value.trim();
  if (!val) return;
  closeScanner();
  handleBarcode(val);
};

document.addEventListener('keydown', e => {
  if (e.target.id === 'manual-barcode' && e.key === 'Enter') manualBarcode();
});

function handleBarcode(code) {
  showToast(`📷 Scanned: ${code}`);
  if (scannerContext === 'modal') {
    document.getElementById('f-tank-id').value = code;
    return;
  }
  const found = fishData.find(f => f.tankId === code);
  if (found) {
    openDrawer(found.id);
  } else {
    openAddModal();
    document.getElementById('f-tank-id').value = code;
    showToast(`No tank found for "${code}" — pre-filled form`);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.getElementById('search-input')?.focus(); }
  if (e.key === 'Escape') { closeModal(); closeDrawer(); closeScanner(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openAddModal(); }
});
