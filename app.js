/* ── ZebraBase app.js ── */

// ── State ──────────────────────────────────────────────────────────────────
let CONFIG = {
  sheetId:  '',
  apiKey:   '',
  tabName:  'Fish',
  demoMode: false,
};

let fishData    = [];   // all records
let filtered    = [];   // after search/filter
let activeFilter = 'all';
let currentMarkers = [];
let editingId   = null;

// Google Sheets column order (1-indexed mapping to zero-indexed array):
// TankID | Line | Genotype | Age | Count | Location | Markers | Status | Notes | LastUpdated
const COL = {
  tankId:   0, line:     1, genotype:  2,
  age:      3, count:    4, location:  5,
  markers:  6, status:   7, notes:     8, updated: 9,
};

// ── Demo data ───────────────────────────────────────────────────────────────
const DEMO = [
  { tankId:'TK-001', line:'Tg(fli1:EGFP)', genotype:'+/+', age:'90 dpf', count:12, location:'Rack 1A, Shelf 2', markers:['EGFP','fli1'], status:'Active', notes:'Healthy, spawning well', updated:'2025-04-20' },
  { tankId:'TK-002', line:'Tg(gata1:DsRed)', genotype:'+/-', age:'60 dpf', count:8, location:'Rack 1A, Shelf 3', markers:['DsRed','gata1'], status:'Breeding', notes:'Set up breeding pair', updated:'2025-04-22' },
  { tankId:'TK-003', line:'casper', genotype:'roy−/−;nacre−/−', age:'120 dpf', count:3, location:'Rack 2B, Shelf 1', markers:[], status:'Low Stock', notes:'Need to expand', updated:'2025-04-15' },
  { tankId:'TK-004', line:'Tg(mpeg1:mCherry)', genotype:'+/+', age:'30 dpf', count:20, location:'Rack 2B, Shelf 4', markers:['mCherry','mpeg1'], status:'Active', notes:'', updated:'2025-04-21' },
  { tankId:'TK-005', line:'AB wild-type', genotype:'WT', age:'180 dpf', count:6, location:'Rack 3C, Shelf 1', markers:[], status:'Archived', notes:'Retired breeders', updated:'2025-03-10' },
  { tankId:'TK-006', line:'Tg(huc:GCaMP6s)', genotype:'+/+', age:'45 dpf', count:15, location:'Rack 1B, Shelf 1', markers:['GCaMP6s','huc'], status:'Active', notes:'Imaging stock', updated:'2025-04-23' },
];

// ── Init ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Try loading saved config
  const saved = localStorage.getItem('zebrabase-config');
  if (saved) {
    try {
      const c = JSON.parse(saved);
      CONFIG = { ...CONFIG, ...c };
      if (CONFIG.sheetId && CONFIG.apiKey) {
        document.getElementById('sheet-id-input').value = CONFIG.sheetId;
        document.getElementById('api-key-input').value  = CONFIG.apiKey;
        document.getElementById('sheet-tab-input').value = CONFIG.tabName;
        connectSheets();
        return;
      }
      if (CONFIG.demoMode) { useDemoMode(); return; }
    } catch(_){}
  }
});

// ── Connection ──────────────────────────────────────────────────────────────
window.connectSheets = async function() {
  const sheetId = document.getElementById('sheet-id-input').value.trim();
  const apiKey  = document.getElementById('api-key-input').value.trim();
  const tabName = document.getElementById('sheet-tab-input').value.trim() || 'Fish';

  if (!sheetId || !apiKey) {
    showToast('⚠️ Please enter both Sheet ID and API Key', 'warn');
    return;
  }

  CONFIG = { sheetId, apiKey, tabName, demoMode: false };
  localStorage.setItem('zebrabase-config', JSON.stringify(CONFIG));

  const btn = document.getElementById('connect-btn');
  btn.textContent = 'Connecting…';
  btn.disabled = true;

  const ok = await fetchFromSheets();
  if (ok) {
    showApp();
  } else {
    btn.textContent = 'Connect to Google Sheets';
    btn.disabled = false;
  }
};

window.useDemoMode = function() {
  CONFIG.demoMode = true;
  localStorage.setItem('zebrabase-config', JSON.stringify(CONFIG));
  fishData = DEMO.map(d => ({ ...d, id: d.tankId }));
  showApp();
  showToast('🐠 Demo mode active — data not saved');
};

function showApp() {
  document.getElementById('setup-overlay').classList.remove('active');
  document.getElementById('app').classList.remove('hidden');
  renderAll();
}

// ── Google Sheets integration ────────────────────────────────────────────────
async function fetchFromSheets() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.sheetId}/values/${encodeURIComponent(CONFIG.tabName)}?key=${CONFIG.apiKey}`;
  try {
    const res  = await fetch(url);
    const json = await res.json();
    if (json.error) {
      showToast('❌ Sheets error: ' + json.error.message);
      return false;
    }
    const rows = json.values || [];
    // Skip header row (row 0)
    fishData = rows.slice(1).map((r, i) => ({
      id:       r[COL.tankId]  || `row-${i+2}`,
      tankId:   r[COL.tankId]  || '',
      line:     r[COL.line]    || '',
      genotype: r[COL.genotype]|| '',
      age:      r[COL.age]     || '',
      count:    parseInt(r[COL.count]) || 0,
      location: r[COL.location]|| '',
      markers:  r[COL.markers] ? r[COL.markers].split(',').map(m=>m.trim()).filter(Boolean) : [],
      status:   r[COL.status]  || 'Active',
      notes:    r[COL.notes]   || '',
      updated:  r[COL.updated] || '',
      _rowIndex: i + 2,  // 1-based row index in sheet (row 1 = header)
    }));
    showToast('✅ Synced ' + fishData.length + ' tanks');
    return true;
  } catch(e) {
    showToast('❌ Network error: ' + e.message);
    return false;
  }
}

async function writeToSheets(record, rowIndex) {
  // Uses Apps Script web app for write operations (read-only API key can't write)
  // Falls back gracefully with instructions
  const appsScriptUrl = localStorage.getItem('zebrabase-appsscript');
  if (!appsScriptUrl) {
    showToast('ℹ️ Read-only mode. See SETUP.md to enable writes.');
    return false;
  }
  try {
    const res = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write', row: rowIndex, data: recordToRow(record) }),
    });
    const json = await res.json();
    return json.success;
  } catch(e) {
    showToast('❌ Write error: ' + e.message);
    return false;
  }
}

function recordToRow(r) {
  return [
    r.tankId, r.line, r.genotype, r.age,
    r.count, r.location,
    (r.markers||[]).join(', '),
    r.status, r.notes,
    new Date().toISOString().slice(0,10),
  ];
}

window.syncSheets = async function() {
  const btn = document.getElementById('sync-btn');
  btn.classList.add('spinning');
  if (CONFIG.demoMode) {
    await new Promise(r=>setTimeout(r,600));
    btn.classList.remove('spinning');
    showToast('🐠 Demo mode — nothing to sync');
    return;
  }
  await fetchFromSheets();
  renderAll();
  btn.classList.remove('spinning');
};

// ── Render ──────────────────────────────────────────────────────────────────
function renderAll() {
  updateStats();
  filterFish();
}

function updateStats() {
  document.getElementById('stat-total').textContent  = fishData.length;
  document.getElementById('stat-active').textContent = fishData.filter(f=>f.status==='Active').length;
  document.getElementById('stat-breed').textContent  = fishData.filter(f=>f.status==='Breeding').length;
  document.getElementById('stat-low').textContent    = fishData.filter(f=>f.status==='Low Stock').length;
}

window.filterFish = function() {
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  filtered = fishData.filter(f => {
    const matchFilter = activeFilter === 'all' || f.status === activeFilter;
    if (!matchFilter) return false;
    if (!q) return true;
    return (
      f.tankId.toLowerCase().includes(q)   ||
      f.line.toLowerCase().includes(q)      ||
      f.genotype.toLowerCase().includes(q)  ||
      f.location.toLowerCase().includes(q)  ||
      (f.markers||[]).some(m=>m.toLowerCase().includes(q)) ||
      (f.notes||'').toLowerCase().includes(q)
    );
  });
  sortFish();
};

window.sortFish = function() {
  const s = document.getElementById('sort-select').value;
  filtered.sort((a,b) => {
    if (s==='tank')    return a.tankId.localeCompare(b.tankId);
    if (s==='line')    return a.line.localeCompare(b.line);
    if (s==='age')     return (a.age||'').localeCompare(b.age||'');
    if (s==='count')   return (b.count||0) - (a.count||0);
    if (s==='updated') return (b.updated||'').localeCompare(a.updated||'');
    return 0;
  });
  renderGrid();
};

function renderGrid() {
  const grid  = document.getElementById('fish-grid');
  const empty = document.getElementById('empty-state');

  // Remove existing cards (keep empty-state)
  Array.from(grid.querySelectorAll('.fish-card')).forEach(c=>c.remove());

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  filtered.forEach((f, idx) => {
    const card = document.createElement('div');
    card.className = `fish-card status-${f.status}`;
    card.style.animationDelay = `${idx * 0.04}s`;

    const markersHtml = (f.markers||[]).map(m => `<span class="m-tag">${esc(m)}</span>`).join('');

    card.innerHTML = `
      <div class="card-header">
        <span class="tank-id">${esc(f.tankId)}</span>
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
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Filter chips ────────────────────────────────────────────────────────────
window.setFilter = function(val) {
  activeFilter = val;
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === val);
  });
  filterFish();
};

// ── Add / Edit Modal ─────────────────────────────────────────────────────────
window.openAddModal = function() {
  editingId = null;
  currentMarkers = [];
  document.getElementById('modal-title').textContent = 'Add Tank';
  document.getElementById('fish-form').reset();
  document.getElementById('markers-container').innerHTML = '';
  document.querySelector('input[name="status"][value="Active"]').checked = true;
  document.getElementById('fish-modal').classList.add('active');
};

window.openEditModal = function(id) {
  const f = fishData.find(x => x.id === id);
  if (!f) return;
  editingId = id;
  currentMarkers = [...(f.markers||[])];
  document.getElementById('modal-title').textContent = 'Edit Tank';
  document.getElementById('f-tank-id').value  = f.tankId;
  document.getElementById('f-line').value     = f.line;
  document.getElementById('f-genotype').value = f.genotype||'';
  document.getElementById('f-age').value      = f.age||'';
  document.getElementById('f-count').value    = f.count||'';
  document.getElementById('f-location').value = f.location||'';
  document.getElementById('f-notes').value    = f.notes||'';
  const statusInput = document.querySelector(`input[name="status"][value="${f.status}"]`);
  if (statusInput) statusInput.checked = true;
  renderMarkerTags();
  document.getElementById('fish-modal').classList.add('active');
};

window.closeModal = function() {
  document.getElementById('fish-modal').classList.remove('active');
};

window.saveFish = async function(e) {
  e.preventDefault();
  const record = {
    tankId:   document.getElementById('f-tank-id').value.trim(),
    line:     document.getElementById('f-line').value.trim(),
    genotype: document.getElementById('f-genotype').value.trim(),
    age:      document.getElementById('f-age').value.trim(),
    count:    parseInt(document.getElementById('f-count').value)||0,
    location: document.getElementById('f-location').value.trim(),
    markers:  [...currentMarkers],
    status:   document.querySelector('input[name="status"]:checked').value,
    notes:    document.getElementById('f-notes').value.trim(),
    updated:  new Date().toISOString().slice(0,10),
  };
  record.id = record.tankId;

  if (editingId) {
    const idx = fishData.findIndex(x => x.id === editingId);
    if (idx !== -1) {
      const rowIndex = fishData[idx]._rowIndex;
      record._rowIndex = rowIndex;
      fishData[idx] = record;
      if (!CONFIG.demoMode) await writeToSheets(record, rowIndex);
    }
    showToast('✅ Tank updated');
  } else {
    // Check duplicate
    if (fishData.find(x => x.tankId === record.tankId)) {
      showToast('⚠️ Tank ID already exists');
      return;
    }
    record._rowIndex = fishData.length + 2;
    fishData.push(record);
    if (!CONFIG.demoMode) await writeToSheets(record, record._rowIndex);
    showToast('✅ Tank added');
  }

  closeModal();
  renderAll();
};

// Markers
window.addMarkerTag = function() {
  const input = document.getElementById('marker-input');
  const val   = input.value.trim();
  if (val && !currentMarkers.includes(val)) {
    currentMarkers.push(val);
    renderMarkerTags();
  }
  input.value = '';
  input.focus();
};

document.addEventListener('keydown', e => {
  if (e.target.id === 'marker-input' && e.key === 'Enter') {
    e.preventDefault();
    addMarkerTag();
  }
});

function renderMarkerTags() {
  const c = document.getElementById('markers-container');
  c.innerHTML = currentMarkers.map((m,i) =>
    `<span class="marker-tag">${esc(m)}<button type="button" onclick="removeMarker(${i})">×</button></span>`
  ).join('');
}

window.removeMarker = function(i) {
  currentMarkers.splice(i, 1);
  renderMarkerTags();
};

// ── Delete ──────────────────────────────────────────────────────────────────
window.deleteFish = function(id) {
  if (!confirm('Delete this tank record?')) return;
  fishData = fishData.filter(f => f.id !== id);
  showToast('🗑 Tank deleted');
  renderAll();
};

// ── Detail Drawer ────────────────────────────────────────────────────────────
window.openDrawer = function(id) {
  const f = fishData.find(x => x.id === id);
  if (!f) return;

  const markersHtml = (f.markers||[]).length
    ? (f.markers||[]).map(m => `<span class="m-tag">${esc(m)}</span>`).join(' ')
    : '<span style="color:var(--text-dim)">None</span>';

  document.getElementById('drawer-content').innerHTML = `
    <div class="drawer-fish-id">${esc(f.tankId)}</div>
    <div class="drawer-line">${esc(f.line)}</div>
    <span class="status-badge badge-${f.status}" style="margin-top:.25rem;display:inline-block">${esc(f.status)}</span>

    <div class="drawer-section">
      <h4>Details</h4>
      <div class="drawer-row"><span class="drawer-row-label">Genotype</span><span class="drawer-row-val">${esc(f.genotype||'—')}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Age</span><span class="drawer-row-val">${esc(f.age||'—')}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Count</span><span class="drawer-row-val">${f.count||'—'}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Location</span><span class="drawer-row-val">${esc(f.location||'—')}</span></div>
      <div class="drawer-row"><span class="drawer-row-label">Last Updated</span><span class="drawer-row-val">${esc(f.updated||'—')}</span></div>
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

// ── Barcode Scanner ──────────────────────────────────────────────────────────
let scannerRunning = false;

window.openScanner = function() {
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
      name: 'Live',
      type: 'LiveStream',
      target: document.querySelector('#interactive'),
      constraints: {
        facingMode: 'environment',
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    decoder: {
      readers: ['code_128_reader','ean_reader','ean_8_reader','code_39_reader','upc_reader'],
    },
    locate: true,
  }, err => {
    if (err) {
      console.error(err);
      document.getElementById('scan-status').textContent = 'Camera error — use manual entry.';
      return;
    }
    Quagga.start();
    scannerRunning = true;
    document.getElementById('scan-status').textContent = 'Point camera at barcode…';
  });

  Quagga.onDetected(result => {
    const code = result.codeResult.code;
    stopQuagga();
    document.getElementById('scan-overlay').classList.remove('active');
    handleBarcode(code);
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
  const found = fishData.find(f => f.tankId === code);
  if (found) {
    openDrawer(found.id);
  } else {
    // Pre-fill add modal with scanned ID
    openAddModal();
    document.getElementById('f-tank-id').value = code;
    showToast(`No tank found for "${code}" — pre-filled form`);
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────
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
  if ((e.metaKey||e.ctrlKey) && e.key==='k') {
    e.preventDefault();
    document.getElementById('search-input')?.focus();
  }
  if (e.key === 'Escape') {
    closeModal();
    closeDrawer();
    closeScanner();
  }
  if ((e.metaKey||e.ctrlKey) && e.key==='n') {
    e.preventDefault();
    openAddModal();
  }
});
