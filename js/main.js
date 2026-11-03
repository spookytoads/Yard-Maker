// Yard Maker: app state and UI wiring.
import { CATALOG, CATALOG_BY_KIND, CATEGORIES, categoryOf } from './catalog.js';
import { manualYard, yardStats, newId } from './analyze.js';
import { sampleYard, drawSampleOrtho } from './sample.js';
import { optimize, buildSite, evaluate, footprint } from './optimizer.js';
import { layoutNotes, openText, claudeSummary } from './notes.js';
import { PlanView, defaultDoor } from './plan.js';
import { fmtLen, fmtDims, fmtArea, toInput, fromInput, unitLabel, M_PER_FT } from './units.js';
import { fileToDataURL, textureFor, finishOf } from './looks.js';

const $ = (id) => document.getElementById(id);
const STORE = 'yard-maker:v1';
const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

const state = {
  model: null, items: [], units: 'imperial', selected: null, proposal: null, door: null, openNow: null, seed: 1,
};
window.__yard = state; // handy for debugging in the console

let scan = null;
let view3d = null;
let userTurned = false; // the person set "Turn plan" themselves
let busy = false;

const plan = new PlanView($('plan'), {
  getState: () => state,
  onSelect: (id) => select(id),
  onMove: () => { renderInspector(); },
  onMoveEnd: () => { dropProposal(); changed(); },
  onMeasure: (m) => showCalib(m),
  onDoor: (w) => { state.door = w; setTool('select'); dropProposal(); changed(); toast('Door set. Walkways are checked from here.'); },
});

// ------------------------------------------------------------------ helpers

function toast(msg, ms = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function swatchStyle(it) {
  if (it.photo) return `background-image:url(${it.photo})`;
  if (it.origin === 'scanned' && it.fixed) return 'background:var(--fixed)';
  return `background:${(CATEGORIES[categoryOf(it)] || CATEGORIES.other).color}`;
}

function changed() {
  renderAll();
  scheduleOpen();
  scheduleSave();
}

function dropProposal() {
  if (!state.proposal) return;
  state.proposal = null;
  renderNotes();
}

// ------------------------------------------------------------------ yard

function setYard({ model, items }, { keepNew = true } = {}) {
  const extra = keepNew ? state.items.filter((it) => it.origin !== 'scanned') : [];
  state.model = model;
  const b = model.bounds, c = model.cell;
  for (const it of extra) {
    it.x = Math.min(Math.max(it.x, b.i0 * c + it.w / 2), b.i1 * c - it.w / 2);
    it.z = Math.min(Math.max(it.z, b.j0 * c + it.d / 2), b.j1 * c - it.d / 2);
  }
  state.items = [...items, ...extra];
  state.selected = null;
  state.proposal = null;
  state.door = null;
  $('houseSide').value = model.houseSide || 'top';
  plan.setModel(model);
  if (view3d) view3d.setYard(model, model.source === 'scan' && scan ? scan.root : null);
  changed();
}

function loadSample() {
  const res = sampleYard();
  res.model.ortho = drawSampleOrtho(res.model);
  res.model.scanOrtho = res.model.ortho;
  const add = (kind, x, z, rot = 0) => res.items.push(newItem(kind, x, z, rot));
  // a few planned pieces, dropped roughly where someone might first try them
  add('firepit', 9.2, 9.5);
  add('adirondack', 10.6, 9.4);
  add('adirondack', 7.8, 9.6);
  add('gardenbed', 12.2, 6.2);
  add('hammock', 6.6, 4.2);
  scan = null;
  setYard(res, { keepNew: false });
  $('reanalyze').disabled = true;
}

function newItem(kind, x, z, rot = 0) {
  const c = CATALOG_BY_KIND[kind];
  return {
    id: newId('n'), name: c.name, kind, origin: 'new', w: c.w, d: c.d, h: c.h, clearance: c.clearance,
    shape: c.shape || 'rect', x, z, rot, fixed: false, locked: false, finish: 'auto',
  };
}

function freeSpotFor(it) {
  const o = state.openNow;
  const m = state.model;
  if (o && o.w >= it.w && o.d >= it.d) return { x: o.x + o.w / 2, z: o.z + o.d / 2 };
  const b = m.bounds, c = m.cell;
  return { x: (b.i0 + b.i1) / 2 * c, z: (b.j0 + b.j1) / 2 * c };
}

function addItem(it) {
  const p = freeSpotFor(it);
  it.x = Math.round(p.x * 20) / 20;
  it.z = Math.round(p.z * 20) / 20;
  state.items.push(it);
  dropProposal();
  select(it.id);
  changed();
  toast(`${it.name} added. Drag it, or press "Suggest a layout".`);
}

// ------------------------------------------------------------------ open space (live)

let openTimer = 0;
function scheduleOpen() {
  clearTimeout(openTimer);
  openTimer = setTimeout(() => {
    if (!state.model) return;
    const site = buildSite(state.model, state.items, { door: state.door });
    const P = state.items.map((it) => ({ x: it.x, z: it.z, rot: it.rot || 0 }));
    const ev = evaluate(site, state.items, P);
    state.openNow = ev.open;
    state.unreachableNow = ev.unreachable;
    renderStats();
    plan.invalidate();
  }, 160);
}

// ------------------------------------------------------------------ persistence

const TYPED = { ground: Float32Array, covered: Uint8Array, heightTop: Float32Array, canopy: Uint8Array, slope: Float32Array, misc: Uint8Array };

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str, T) {
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new T(u8.buffer);
}

function serialize(withPhotos = true) {
  const m = { ...state.model };
  for (const k of Object.keys(TYPED)) if (m[k]) m[k] = b64(new Uint8Array(m[k].buffer));
  if (!withPhotos) { delete m.ortho; delete m.scanOrtho; delete m.bgPhoto; }
  const items = state.items.map((it) => {
    const o = { ...it, cells: it.cells ? Array.from(it.cells) : undefined };
    delete o.stats;
    if (!withPhotos) { delete o.photo; delete o.texture; }
    return o;
  });
  return JSON.stringify({ v: 1, units: state.units, door: state.door, model: m, items });
}

function deserialize(text) {
  const d = JSON.parse(text);
  if (!d || d.v !== 1 || !d.model) throw new Error('This is not a Yard Maker project file.');
  const m = d.model;
  for (const [k, T] of Object.entries(TYPED)) if (typeof m[k] === 'string') m[k] = unb64(m[k], T);
  if (!m.ortho && m.source === 'sample') m.ortho = drawSampleOrtho(m);
  m.stats = yardStats(m, d.items);
  return d;
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, serialize(true)); }
    catch {
      try { localStorage.setItem(STORE, serialize(false)); } catch { /* storage unavailable */ }
    }
  }, 700);
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return false;
    applyProject(deserialize(raw));
    return true;
  } catch { return false; }
}

function applyProject(d) {
  state.units = d.units || 'imperial';
  scan = null;
  $('reanalyze').disabled = true;
  setYard({ model: d.model, items: d.items }, { keepNew: false });
  state.door = d.door || null;
  setUnits(state.units);
}

function download(name, href) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ------------------------------------------------------------------ rendering

function renderAll() {
  renderStats();
  renderExisting();
  renderNew();
  renderInspector();
  renderNotes();
  plan.invalidate();
  if (view3d && !$('view3d').hidden) view3d.setItems(state.items);
  const m = state.model;
  $('sourcePill').textContent = m ? (m.source === 'scan' ? m.name : m.source === 'sample' ? 'Sample yard' : 'Custom size') : '';
  $('bgClear').hidden = !(m && m.bgPhoto);
}

function renderStats() {
  const m = state.model;
  if (!m) return;
  m.stats = yardStats(m, state.items);
  const s = m.stats, u = state.units;
  const o = state.openNow;
  const rows = [
    ['big', 'Overall size', fmtDims(s.width, s.depth, u)],
    ['', 'Usable ground', fmtArea(s.usableArea, u)],
    ['', 'Open lawn now', o ? fmtDims(o.w, o.d, u) : '—'],
    ['', 'Canopy shade', `${Math.round(s.shadeFrac * 100)}%`],
    ['', 'Slope', s.meanSlope < 0.02 ? 'Level' : `${Math.round(s.meanSlope * 100)}% avg`],
  ];
  $('yardStats').innerHTML = rows.map(([c, k, v]) => `<div class="${c}"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
}

function renderExisting() {
  const list = state.items.filter((it) => it.origin === 'scanned');
  const el = $('existingList');
  if (!list.length) {
    el.innerHTML = `<li class="empty">${state.model?.source === 'manual' ? 'Nothing yet. Load a scan, or add your existing pieces from the furniture list and lock them.' : 'Nothing standing in the yard was found.'}</li>`;
    return;
  }
  el.innerHTML = list.map((it) => `
    <li data-id="${it.id}" class="${state.selected === it.id ? 'sel' : ''}">
      <span class="sw" style="${swatchStyle(it)}"></span>
      <span><div class="nm">${esc(it.name)}</div><div class="dm">${fmtDims(it.w, it.d, state.units)} · ${fmtLen(it.h, state.units)} tall</div></span>
      <button type="button" class="chip ${it.fixed ? 'fix' : 'mov'}" data-toggle="${it.id}" title="Switch between fixed and movable">${it.fixed ? 'Fixed' : 'Movable'}</button>
    </li>`).join('');
}

function renderNew() {
  const list = state.items.filter((it) => it.origin !== 'scanned');
  const el = $('newList');
  el.innerHTML = list.length ? list.map((it) => `
    <li data-id="${it.id}" class="${state.selected === it.id ? 'sel' : ''}">
      <span class="sw" style="${swatchStyle(it)}"></span>
      <span><div class="nm">${esc(it.name)}${it.locked ? ' · locked' : ''}</div><div class="dm">${fmtDims(footprint(it).w, footprint(it).d, state.units)}</div></span>
      <button type="button" class="chip" data-remove="${it.id}" aria-label="Remove ${esc(it.name)}">Remove</button>
    </li>`).join('') : '<li class="empty">Pick pieces above to add them to the plan.</li>';
}

function renderCatalog() {
  $('catalog').innerHTML = CATALOG.map((c) => `
    <button type="button" data-kind="${c.kind}" style="--c:${CATEGORIES[c.cat].color}" title="${esc(c.why)}">
      <b>${esc(c.name)}</b><small>${fmtDims(c.w, c.d, state.units)}</small>
    </button>`).join('');
  const sel = $('iKind');
  sel.innerHTML = '<option value="scanned">No type (no placement rules)</option>' +
    CATALOG.map((c) => `<option value="${c.kind}">${esc(c.name)}</option>`).join('');
}

function selectedItem() { return state.items.find((it) => it.id === state.selected) || null; }

function renderInspector() {
  const it = selectedItem();
  $('inspector').hidden = !it;
  if (!it) return;
  const u = state.units;
  const fixedScan = it.origin === 'scanned' && it.fixed;
  $('inspTitle').textContent = it.origin === 'scanned' ? 'In your yard' : 'Planned piece';
  setVal('iName', it.name);
  $('iKind').value = CATALOG_BY_KIND[it.kind] ? it.kind : 'scanned';
  $('iKind').disabled = fixedScan;
  const fp = footprint(it);
  setVal('iW', toInput(it.w, u)); setVal('iD', toInput(it.d, u)); setVal('iC', toInput(it.clearance || 0, u));
  for (const id of ['iW', 'iD', 'iC']) $(id).disabled = fixedScan;
  const info = [];
  if (it.origin === 'scanned') info.push(`Measured from the scan: ${fmtDims(it.w, it.d, u)}, ${fmtLen(it.h, u)} tall.`);
  info.push(`Center: ${fmtLen(it.x, u)} from the left, ${fmtLen(it.z, u)} from the top. Footprint ${fmtDims(fp.w, fp.d, u)}.`);
  const c = CATALOG_BY_KIND[it.kind];
  if (c && !fixedScan) info.push(`Planner puts it ${c.why}.`);
  $('iInfo').textContent = info.join(' ');
  $('iRotate').disabled = fixedScan;
  $('iLock').hidden = fixedScan;
  $('iLock').setAttribute('aria-pressed', String(!!it.locked));
  $('iLock').textContent = it.locked ? 'Locked' : 'Lock in place';
  $('iFixed').hidden = it.origin !== 'scanned';
  $('iFixed').textContent = it.fixed ? 'Mark movable' : 'Mark fixed';
  $('iDelete').textContent = it.origin === 'scanned' ? 'Not really there' : 'Remove';
  // look
  $('lookBox').hidden = fixedScan;
  const img = $('iPhoto');
  if (it.photo) img.src = it.photo; else img.removeAttribute('src');
  const tex = textureFor(it, () => renderInspector());
  const fig = $('iPhotoFig');
  fig.style.backgroundImage = !it.photo && tex ? `url(${tex.toDataURL ? tex.toDataURL() : tex.src})` : '';
  $('iPhotoCap').textContent = it.photo ? 'Your photo' : tex ? `${finishName(it)} finish` : 'No photo yet';
  $('iFinish').value = it.finish || 'auto';
  $('iCutout').checked = !!it.cutout;
  $('iCutout').disabled = !it.photo;
  $('iClearLook').hidden = !(it.photo || it.texture);
}

function finishName(it) {
  if (it.finish === 'custom' && it.texture) return 'Your texture';
  const f = finishOf(it);
  return f ? f[0].toUpperCase() + f.slice(1) : '';
}

function setVal(id, v) { const el = $(id); if (document.activeElement !== el) el.value = v; }

function renderNotes() {
  const p = state.proposal;
  $('proposalActions').hidden = !p;
  const u = state.units;
  if (!p) { $('metrics').innerHTML = ''; $('notes').innerHTML = ''; return; }
  const moves = p.notes.filter((n) => n.moved).length;
  const bo = p.before.open, ao = p.after.open;
  const unreachable = p.after.unreachable.length;
  $('metrics').innerHTML = `
    <div class="metric"><span>Open lawn</span><b><span>${openText(bo, u)}</span><br><span class="up">→ ${openText(ao, u)}</span></b></div>
    <div class="metric"><span>Pieces to move or place</span><b>${moves}</b></div>
    <div class="metric"><span>Paths from the door</span><b class="${unreachable ? '' : 'up'}">${p.site.doorCell === null ? 'no house set' : unreachable ? `${unreachable} blocked` : 'all clear'}</b></div>`;
  $('notes').innerHTML = p.notes.map((n) => {
    const num = p.numbers[n.k];
    const act = n.moved ? (n.isNew ? `Place it${n.turned ? ', turned 90°' : ''}` : `Move it ${fmtLen(n.dist, u)}${n.turned ? ' and turn it' : ''}`) : 'Keep it where it is';
    return `<li class="note" data-id="${n.id}">
      <span class="num ${n.moved ? '' : 'still'}">${n.moved ? num : '✓'}</span>
      <div><h4>${esc(n.name)}</h4><div class="act">${act}</div></div>
      <div class="where">${esc(n.where)}</div>
      <ul class="facts">${n.facts.map((f) => `<li>${esc(f)}</li>`).join('')}${n.warn.map((f) => `<li class="w">${esc(f)}</li>`).join('')}</ul>
      ${n.why && n.moved ? `<p class="why">Best ${esc(n.why)}.</p>` : ''}
      ${n.moved ? `<button type="button" class="btn small" data-apply="${n.k}">Apply this move</button>` : ''}
    </li>`;
  }).join('');
}

// ------------------------------------------------------------------ actions

function select(id) {
  state.selected = id;
  renderExisting();
  renderNew();
  renderInspector();
  plan.invalidate();
}

async function suggest(seed) {
  if (busy || !state.model) return;
  busy = true;
  $('suggestBtn').disabled = true;
  $('anotherBtn').disabled = true;
  const bar = $('progress');
  bar.hidden = false;
  bar.firstElementChild.style.width = '0%';
  try {
    const res = await optimize(state.model, state.items, {
      seed, door: state.door, onProgress: (f) => { bar.firstElementChild.style.width = `${Math.round(f * 100)}%`; },
    });
    res.notes = layoutNotes(res, state.items, state.units);
    res.numbers = {};
    let n = 0;
    for (const note of res.notes) if (note.moved) res.numbers[note.k] = ++n;
    state.proposal = res;
    state.seed = seed;
    if (!n) toast('Your current layout already makes good use of the space.');
  } catch (e) {
    console.error(e);
    toast(`The planner hit a problem: ${e.message}`);
  } finally {
    busy = false;
    bar.hidden = true;
    $('suggestBtn').disabled = false;
    $('anotherBtn').disabled = false;
    renderNotes();
    plan.invalidate();
  }
}

function applyMove(k) {
  const p = state.proposal;
  if (!p) return;
  const it = state.items[k], to = p.placements[k];
  it.x = to.x; it.z = to.z; it.rot = to.rot;
  p.notes = layoutNotes(p, state.items, state.units);
  if (!p.notes.some((n) => n.moved)) state.proposal = null;
  changed();
}

function applyAll() {
  const p = state.proposal;
  if (!p) return;
  state.items.forEach((it, k) => { const to = p.placements[k]; it.x = to.x; it.z = to.z; it.rot = to.rot; });
  state.proposal = null;
  changed();
  toast('Layout applied. Lock anything you like, then try again for more ideas.');
}

function removeItem(id) {
  const i = state.items.findIndex((it) => it.id === id);
  if (i < 0) return;
  state.items.splice(i, 1);
  if (state.selected === id) state.selected = null;
  dropProposal();
  changed();
}

function rotateSelected() {
  const it = selectedItem();
  if (!it || (it.origin === 'scanned' && it.fixed)) return;
  it.rot = ((it.rot || 0) + 90) % 180;
  dropProposal();
  changed();
}

function setTool(t) {
  plan.tool = t;
  $('doorTool').setAttribute('aria-pressed', String(t === 'door'));
  $('measureTool').setAttribute('aria-pressed', String(t === 'measure'));
  const hint = $('toolHint');
  hint.hidden = t === 'select';
  hint.textContent = t === 'door' ? 'Click where the back door opens onto the yard' : 'Drag between two points to measure';
  if (t !== 'measure') { plan.measure = null; $('calib').hidden = true; plan.invalidate(); }
}

function showCalib(m) {
  const L = Math.hypot(m.b.x - m.a.x, m.b.z - m.a.z);
  if (L < 0.05) return;
  state.measured = L;
  $('calibMeasured').textContent = fmtLen(L, state.units);
  $('calibLen').value = toInput(L, state.units);
  $('calib').hidden = false;
}

/** Correct the scan's scale (all lengths in the model and scanned items multiply by f). */
function scaleYard(f) {
  const m = state.model;
  m.cell *= f;
  m.origin = { x: m.origin.x * f, z: m.origin.z * f };
  for (const k of ['ground', 'heightTop']) for (let i = 0; i < m[k].length; i++) m[k][i] *= f;
  for (const it of state.items) {
    it.x *= f; it.z *= f;
    if (it.origin === 'scanned') { it.w *= f; it.d *= f; it.h *= f; if (it.home) { it.home.x *= f; it.home.z *= f; } }
  }
  if (state.door) state.door = { x: state.door.x * f, z: state.door.z * f };
  if (scan) { scan.holder.scale.multiplyScalar(f); $('scaleIn').value = (parseFloat($('scaleIn').value || '1') * f).toFixed(3); }
  state.proposal = null;
  plan.setModel(m);
  if (view3d) view3d.setYard(m, m.source === 'scan' && scan ? scan.root : null);
  setTool('select');
  changed();
  toast('Scale corrected.');
}

function setUnits(u) {
  const old = state.units;
  state.units = u;
  $('uFt').setAttribute('aria-pressed', String(u === 'imperial'));
  $('uM').setAttribute('aria-pressed', String(u === 'metric'));
  document.querySelectorAll('.u').forEach((el) => { el.textContent = unitLabel(u); });
  if (old !== u) {
    for (const id of ['manW', 'manD', 'cW', 'cD', 'cC', 'calibLen']) {
      const v = fromInput($(id).value, old);
      if (Number.isFinite(v)) $(id).value = toInput(v, u);
    }
  }
  renderCatalog();
  if (state.proposal) state.proposal.notes = layoutNotes(state.proposal, state.items, u);
  renderAll();
  scheduleSave();
}

// ------------------------------------------------------------------ scans

async function handleFiles(files) {
  if (!files.length || busy) return;
  busy = true;
  const status = $('scanStatus');
  status.className = 'status';
  status.textContent = 'Loading the 3D tools…';
  try {
    const mod = await import('./scan.js');
    status.textContent = `Reading ${[...files].map((f) => f.name).join(', ')}…`;
    if (scan && view3d) view3d.scene.remove(scan.root);
    scan = await mod.loadScan([...files]);
    userTurned = false;
    $('yawExtra').value = 0;
    await runAnalysis(mod);
  } catch (e) {
    console.error(e);
    status.className = 'status err';
    status.textContent = e.message || String(e);
  } finally {
    busy = false;
  }
}

async function runAnalysis(mod) {
  const status = $('scanStatus');
  mod ||= await import('./scan.js');
  const opts = {
    upAxis: $('upAxis').value, autoYaw: $('autoYaw').checked,
    yaw: parseFloat($('yawExtra').value) || 0, scale: parseFloat($('scaleIn').value) || 1,
    onStep: (t) => { status.textContent = t; },
  };
  let res = await mod.analyzeScan(scan, opts);
  // turn the plan so the house runs along the top, the way most people draw a yard
  const turn = { right: 90, left: -90, bottom: 180 }[res.model.houseSide];
  if (turn && opts.autoYaw && !userTurned) {
    opts.yaw = (opts.yaw + turn + 360) % 360;
    $('yawExtra').value = opts.yaw;
    res = await mod.analyzeScan(scan, opts);
  }
  res.model.scanOrtho = res.model.ortho;
  setYard(res);
  const found = res.items.length;
  const s = res.model.stats;
  status.textContent = `Measured ${fmtDims(s.width, s.depth, state.units)}. Found ${found} thing${found === 1 ? '' : 's'} in the yard.`;
  $('reanalyze').disabled = false;
  if (s.width < 2 || s.depth < 2) {
    status.className = 'status err';
    status.textContent += ' That is very small: check the up axis and scale under Scan options.';
  }
}

// ------------------------------------------------------------------ events

function bind() {
  $('uFt').onclick = () => setUnits('imperial');
  $('uM').onclick = () => setUnits('metric');

  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
  $('scanFile').addEventListener('change', (e) => { const list = [...e.target.files]; e.target.value = ''; handleFiles(list); });
  $('yawExtra').addEventListener('change', () => { userTurned = true; });
  $('reanalyze').onclick = async () => {
    if (!scan || busy) return;
    busy = true;
    try { await runAnalysis(); } catch (e) { $('scanStatus').className = 'status err'; $('scanStatus').textContent = e.message; } finally { busy = false; }
  };
  $('manualBtn').onclick = () => {
    const w = fromInput($('manW').value, state.units), d = fromInput($('manD').value, state.units);
    if (!(w > 1 && d > 1)) { toast('Enter a width and depth of at least a few feet.'); return; }
    scan = null;
    $('reanalyze').disabled = true;
    setYard(manualYard(w, d, $('houseSide').value || 'top'));
    toast(`Yard set to ${fmtDims(w, d, state.units)}.`);
  };
  $('sampleBtn').onclick = () => loadSample();

  $('houseSide').onchange = (e) => { state.model.houseSide = e.target.value; state.door = null; dropProposal(); changed(); };
  $('doorTool').onclick = () => setTool(plan.tool === 'door' ? 'select' : 'door');
  $('measureTool').onclick = () => setTool(plan.tool === 'measure' ? 'select' : 'measure');
  $('calibBtn').onclick = () => {
    const real = fromInput($('calibLen').value, state.units);
    if (!(real > 0) || !state.measured) return;
    scaleYard(real / state.measured);
  };
  $('bgFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !state.model) return;
    try {
      const url = await fileToDataURL(f, 2048);
      state.model.bgPhoto = url;
      state.model.ortho = url;
      plan.setModel(state.model);
      plan.layers.photo = true;
      document.querySelector('[data-layer="photo"]').checked = true;
      if (view3d && state.model.source !== 'scan') view3d.setYard(state.model, null);
      changed();
      toast('Background photo added. It is stretched to the yard outline.');
    } catch (err) { toast(err.message); }
  });
  $('bgClear').onclick = () => {
    const m = state.model;
    delete m.bgPhoto;
    m.ortho = m.scanOrtho || null;
    plan.setModel(m);
    changed();
  };

  $('existingList').addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const it = state.items.find((x) => x.id === t.dataset.toggle);
      it.fixed = !it.fixed;
      if (!it.fixed && !it.clearance) it.clearance = 0.5;
      dropProposal();
      changed();
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (li) select(li.dataset.id);
  });
  $('newList').addEventListener('click', (e) => {
    const r = e.target.closest('[data-remove]');
    if (r) { removeItem(r.dataset.remove); return; }
    const li = e.target.closest('li[data-id]');
    if (li) select(li.dataset.id);
  });
  $('catalog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (b && state.model) addItem(newItem(b.dataset.kind, 0, 0));
  });
  $('customBtn').onclick = () => {
    const u = state.units;
    const w = fromInput($('cW').value, u), d = fromInput($('cD').value, u), c = fromInput($('cC').value, u);
    if (!(w > 0 && d > 0)) { toast('Enter a width and depth.'); return; }
    addItem({
      id: newId('n'), name: $('cName').value.trim() || 'Custom piece', kind: 'custom', cat: 'other', origin: 'new',
      w, d, h: 0.8, clearance: Math.max(0, c || 0), shape: 'rect', x: 0, z: 0, rot: 0, fixed: false, locked: false, finish: 'auto',
    });
  };

  // inspector
  $('iName').addEventListener('input', (e) => { const it = selectedItem(); if (it) { it.name = e.target.value; renderExisting(); renderNew(); plan.invalidate(); scheduleSave(); } });
  $('iKind').addEventListener('change', (e) => {
    const it = selectedItem();
    if (!it) return;
    it.kind = e.target.value;
    const c = CATALOG_BY_KIND[it.kind];
    if (c) { it.clearance = c.clearance; if (it.origin !== 'scanned') { it.w = c.w; it.d = c.d; it.h = c.h; it.shape = c.shape || 'rect'; it.name = c.name; } }
    dropProposal();
    changed();
  });
  for (const [id, key] of [['iW', 'w'], ['iD', 'd'], ['iC', 'clearance']]) {
    $(id).addEventListener('change', (e) => {
      const it = selectedItem();
      const v = fromInput(e.target.value, state.units);
      if (!it || !(v >= (key === 'clearance' ? 0 : 0.05))) return;
      it[key] = v;
      dropProposal();
      changed();
    });
  }
  $('iRotate').onclick = rotateSelected;
  $('iLock').onclick = () => { const it = selectedItem(); if (it) { it.locked = !it.locked; dropProposal(); changed(); } };
  $('iFixed').onclick = () => {
    const it = selectedItem();
    if (!it) return;
    it.fixed = !it.fixed;
    if (!it.fixed && !it.clearance) it.clearance = 0.5;
    dropProposal();
    changed();
  };
  $('iDelete').onclick = () => { const it = selectedItem(); if (it) removeItem(it.id); };
  $('iPhotoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    const it = selectedItem();
    if (!f || !it) return;
    try {
      it.photo = await fileToDataURL(f, 640);
      it.cutout = true;
      changed();
      toast('Photo added. Open the 3D tab to see it standing in the yard.');
    } catch (err) { toast(err.message); }
  });
  $('iTexFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    const it = selectedItem();
    if (!f || !it) return;
    try {
      it.texture = await fileToDataURL(f, 512);
      it.finish = 'custom';
      changed();
      toast('Texture added to the plan and the 3D model.');
    } catch (err) { toast(err.message); }
  });
  $('iFinish').addEventListener('change', (e) => {
    const it = selectedItem();
    if (!it) return;
    if (e.target.value === 'custom' && !it.texture) { $('iTexFile').click(); return; }
    it.finish = e.target.value;
    changed();
  });
  $('iCutout').addEventListener('change', (e) => { const it = selectedItem(); if (it) { it.cutout = e.target.checked; changed(); } });
  $('iClearLook').onclick = () => {
    const it = selectedItem();
    if (!it) return;
    delete it.photo; delete it.texture; it.cutout = false;
    if (it.finish === 'custom') it.finish = 'auto';
    changed();
  };

  // suggestions
  $('suggestBtn').onclick = () => suggest(state.seed);
  $('anotherBtn').onclick = () => suggest(state.seed + 1);
  $('discardBtn').onclick = () => { state.proposal = null; renderNotes(); plan.invalidate(); };
  $('applyBtn').onclick = applyAll;
  $('notes').addEventListener('click', (e) => {
    const a = e.target.closest('[data-apply]');
    if (a) { applyMove(Number(a.dataset.apply)); return; }
    const li = e.target.closest('li[data-id]');
    if (li) select(li.dataset.id);
  });

  // stage
  document.querySelectorAll('[data-layer]').forEach((cb) => cb.addEventListener('change', () => { plan.layers[cb.dataset.layer] = cb.checked; plan.invalidate(); }));
  $('zoomIn').onclick = () => plan.zoom(1.25);
  $('zoomOut').onclick = () => plan.zoom(0.8);
  $('zoomFit').onclick = () => plan.fit();
  $('tabPlan').onclick = () => showTab('plan');
  $('tab3d').onclick = () => showTab('3d');

  // header
  $('copyClaude').onclick = async () => {
    if (!state.model) return;
    const text = claudeSummary(state);
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied. Paste it into a Claude chat to talk through the layout.');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      toast(ok ? 'Copied. Paste it into a Claude chat.' : 'Copy was blocked by the browser.');
    }
  };
  $('saveBtn').onclick = () => {
    const url = URL.createObjectURL(new Blob([serialize(true)], { type: 'application/json' }));
    download('yard-plan.json', url);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  $('savePng').onclick = () => download('yard-plan.png', $('view3d').hidden ? plan.snapshot() : view3d.snapshot());
  $('openProject').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { applyProject(deserialize(await f.text())); toast('Project opened.'); } catch (err) { toast(err.message); }
  });
  if (embedded) document.querySelectorAll('.dl').forEach((el) => { el.hidden = true; });

  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.key === 'r' || e.key === 'R') rotateSelected();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
      const it = selectedItem();
      if (it && it.origin !== 'scanned') { e.preventDefault(); removeItem(it.id); }
    } else if (e.key === 'Escape') { setTool('select'); select(null); }
  });
}

async function showTab(t) {
  const is3d = t === '3d';
  $('tabPlan').setAttribute('aria-selected', String(!is3d));
  $('tab3d').setAttribute('aria-selected', String(is3d));
  $('planWrap').hidden = is3d;
  $('view3d').hidden = !is3d;
  $('layers').style.visibility = is3d ? 'hidden' : '';
  if (is3d) {
    if (!view3d) {
      try {
        const { View3D } = await import('./view3d.js');
        view3d = new View3D($('view3d'));
        window.__view3d = view3d;
        view3d.setYard(state.model, state.model.source === 'scan' && scan ? scan.root : null);
      } catch (e) {
        console.error(e);
        toast('The 3D view could not load. Check your connection and try again.');
        showTab('plan');
        return;
      }
    }
    view3d.setVisible(true);
    view3d.setItems(state.items);
  } else {
    view3d?.setVisible(false);
    plan.resize();
  }
}

// ------------------------------------------------------------------ boot

bind();
renderCatalog();
setUnits('imperial');
if (!restore()) loadSample();
