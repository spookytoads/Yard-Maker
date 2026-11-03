// Top-down site plan: aerial photo, canopy shade, obstacles, grid, dimensions, furniture,
// suggested moves and a measuring tape. Canvas 2D, coordinates in meters (x right, z down).
import { footprint } from './optimizer.js';
import { CATALOG, CATEGORIES, categoryOf } from './catalog.js';
import { fmtLen, fmtDims, M_PER_FT } from './units.js';
import { textureFor } from './looks.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class PlanView {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks; // { getState, onSelect, onMove, onMoveEnd, onMeasure, onDoor }
    this.view = { s: 30, ox: 40, oy: 40 };
    this.tool = 'select';
    this.layers = { photo: true, shade: true, heights: false, grid: true, clearance: true, textures: true };
    this.pointers = new Map();
    this.measure = null;
    this.layerCache = {};
    this.colors = {};
    this.needs = false;
    this.readColors();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.readColors(); this.invalidate(); });
    new MutationObserver(() => { this.readColors(); this.invalidate(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bind();
  }

  readColors() {
    for (const k of ['plan-bg', 'outside', 'lawn', 'ink', 'ink-soft', 'grid', 'grid-major', 'fixed', 'accent', 'accent-ink', 'open', 'house', 'paper'])
      this.colors[k] = css(`--${k}`);
    this.layerCache.fixedKey = null;
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.dpr = dpr;
    if (!this.fitted) this.fit();
    this.invalidate();
  }

  fit() {
    const st = this.hooks.getState();
    if (!st.model) return;
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (r.width < 10) return;
    const m = st.model, b = m.bounds, c = m.cell;
    const w = (b.i1 - b.i0) * c, d = (b.j1 - b.j0) * c;
    const pad = Math.min(64, r.width * 0.1);
    const s = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / d);
    this.view = { s, ox: (r.width - w * s) / 2 - b.i0 * c * s, oy: (r.height - d * s) / 2 - b.j0 * c * s };
    this.fitted = true;
    this.invalidate();
  }

  zoom(f, cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    cx ??= r.width / 2; cy ??= r.height / 2;
    const v = this.view;
    const ns = Math.max(2, Math.min(400, v.s * f));
    v.ox = cx - ((cx - v.ox) * ns) / v.s;
    v.oy = cy - ((cy - v.oy) * ns) / v.s;
    v.s = ns;
    this.invalidate();
  }

  toWorld(px, py) { return { x: (px - this.view.ox) / this.view.s, z: (py - this.view.oy) / this.view.s }; }

  setModel(model) {
    this.layerCache = {};
    this.fitted = false;
    this.photo = null;
    if (model?.ortho) {
      const img = new Image();
      img.onload = () => { this.photo = this.maskPhoto(model, img); this.invalidate(); };
      img.src = model.ortho;
    }
    this.buildLayers(model);
    this.fit();
  }

  /** Cut the aerial photo to the scanned area. */
  maskPhoto(model, img) {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingEnabled = true;
    g.drawImage(this.cellCanvas(model, (i) => (model.covered[i] ? [0, 0, 0, 255] : null)), 0, 0, cv.width, cv.height);
    return cv;
  }

  cellCanvas(model, colorAt) {
    const { cols, rows } = model;
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const g = cv.getContext('2d');
    const img = g.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const c = colorAt(i);
      if (!c) continue;
      img.data.set(c, i * 4);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  buildLayers(model) {
    if (!model) return;
    const hex = (h, a) => {
      const v = h.replace('#', '');
      const n = parseInt(v.length === 3 ? v.split('').map((x) => x + x).join('') : v, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
    };
    const lawn = hex(this.colors.lawn || '#7fa35a', 255);
    this.layerCache.covered = this.cellCanvas(model, (i) => (model.covered[i] ? lawn : null));
    this.layerCache.shade = this.cellCanvas(model, (i) => (model.canopy[i] ? [20, 40, 30, 90] : null));
    this.layerCache.heights = this.cellCanvas(model, (i) => {
      const h = model.heightTop[i];
      if (!model.covered[i] || h < 0.25) return null;
      const t = Math.min(1, h / 4);
      return [Math.round(250 - 60 * t), Math.round(200 - 150 * t), Math.round(60 + 120 * t), 170];
    });
  }

  fixedLayer(model, items) {
    const key = items.filter((it) => it.origin === 'scanned' && it.fixed).map((it) => it.id).join('|') + this.colors.fixed;
    if (this.layerCache.fixedKey === key && this.layerCache.fixed) return this.layerCache.fixed;
    const owner = new Int32Array(model.cols * model.rows).fill(-1);
    items.forEach((it, k) => { if (it.origin === 'scanned' && it.cells) for (const c of it.cells) owner[c] = k; });
    const col = this.hexA(this.colors.fixed || '#4a4038', 200);
    const misc = this.hexA(this.colors.fixed || '#4a4038', 120);
    this.layerCache.fixed = this.cellCanvas(model, (i) => {
      const k = owner[i];
      if (k >= 0 && items[k].fixed) return col;
      if (model.misc && model.misc[i]) return misc;
      return null;
    });
    this.layerCache.owner = owner;
    this.layerCache.fixedKey = key;
    return this.layerCache.fixed;
  }

  hexA(h, a) {
    const v = h.replace('#', '');
    const n = parseInt(v.length === 3 ? v.split('').map((x) => x + x).join('') : v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }

  invalidate() {
    if (this.needs) return;
    this.needs = true;
    requestAnimationFrame(() => { this.needs = false; this.draw(); });
  }

  // ---------------------------------------------------------------- drawing

  draw() {
    const st = this.hooks.getState();
    const { ctx: g, canvas, colors: C } = this;
    const dpr = this.dpr || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = C['plan-bg'];
    g.fillRect(0, 0, canvas.width, canvas.height);
    const m = st.model;
    if (!m) return;
    const { s, ox, oy } = this.view;
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    const W = m.cols * m.cell, D = m.rows * m.cell;
    const px = 1 / s; // one CSS pixel in meters

    // outside the scan
    g.fillStyle = C.outside;
    g.fillRect(0, 0, W, D);
    g.imageSmoothingEnabled = false;
    if (this.layers.photo && this.photo) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.photo, 0, 0, W, D);
      g.imageSmoothingEnabled = false;
    } else g.drawImage(this.layerCache.covered, 0, 0, W, D);
    if (this.layers.heights) g.drawImage(this.layerCache.heights, 0, 0, W, D);
    if (this.layers.shade) g.drawImage(this.layerCache.shade, 0, 0, W, D);
    g.drawImage(this.fixedLayer(m, st.items), 0, 0, W, D);
    g.imageSmoothingEnabled = true;

    if (this.layers.grid) this.drawGrid(g, m, st.units, px);
    this.drawHouse(g, m, st, px);
    this.drawDims(g, m, st.units, px);

    const prop = st.proposal;
    const open = prop ? prop.after.open : st.openNow;
    if (open && open.area > 0) this.drawOpen(g, open, st.units, px);

    // scanned fixed labels
    for (const it of st.items) if (it.origin === 'scanned' && it.fixed) this.drawFixedLabel(g, it, px, st.selected === it.id);
    // furniture
    for (const it of st.items) if (!(it.origin === 'scanned' && it.fixed)) this.drawItem(g, it, st, px);
    if (prop) this.drawProposal(g, st, prop, px);
    if (this.measure) this.drawMeasure(g, this.measure, st.units, px);
  }

  drawGrid(g, m, units, px) {
    const b = m.bounds, c = m.cell;
    const x0 = b.i0 * c, x1 = b.i1 * c, z0 = b.j0 * c, z1 = b.j1 * c;
    const unit = units === 'metric' ? 1 : M_PER_FT;
    const major = 5;
    const minorVisible = unit / px > 7;
    g.lineWidth = px;
    for (const [isMajor, color] of [[false, this.colors.grid], [true, this.colors['grid-major']]]) {
      if (!isMajor && !minorVisible) continue;
      g.strokeStyle = color;
      g.beginPath();
      for (let k = 0, x = x0; x <= x1 + 1e-6; k++, x = x0 + k * unit) {
        if ((k % major === 0) !== isMajor) continue;
        g.moveTo(x, z0); g.lineTo(x, z1);
      }
      for (let k = 0, z = z0; z <= z1 + 1e-6; k++, z = z0 + k * unit) {
        if ((k % major === 0) !== isMajor) continue;
        g.moveTo(x0, z); g.lineTo(x1, z);
      }
      g.stroke();
    }
  }

  drawHouse(g, m, st, px) {
    const side = m.houseSide;
    const b = m.bounds, c = m.cell;
    const x0 = b.i0 * c, x1 = b.i1 * c, z0 = b.j0 * c, z1 = b.j1 * c;
    if (side && side !== 'none') {
      const t = 10 * px;
      g.fillStyle = this.colors.house;
      const r = { top: [x0, z0 - t, x1 - x0, t], bottom: [x0, z1, x1 - x0, t], left: [x0 - t, z0, t, z1 - z0], right: [x1, z0, t, z1 - z0] }[side];
      g.fillRect(...r);
      g.save();
      g.fillStyle = this.colors.paper;
      g.font = `600 ${8 * px}px ${css('--font-ui')}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const vert = side === 'left' || side === 'right';
      const cx = r[0] + (vert ? r[2] / 2 : r[2] * 0.2), cz = r[1] + (vert ? r[3] * 0.2 : r[3] / 2);
      g.translate(cx, cz);
      if (side === 'left' || side === 'right') g.rotate(-Math.PI / 2);
      g.fillText('H O U S E', 0, 0.5 * px);
      g.restore();
    }
    const door = st.door || defaultDoor(m);
    if (door) {
      g.fillStyle = this.colors.accent;
      g.strokeStyle = this.colors.paper;
      g.lineWidth = 2 * px;
      g.beginPath(); g.arc(door.x, door.z, 6 * px, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = this.colors.paper;
      g.font = `700 ${7 * px}px ${css('--font-ui')}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('D', door.x, door.z + 0.5 * px);
    }
  }

  drawDims(g, m, units, px) {
    const b = m.bounds, c = m.cell;
    const x0 = b.i0 * c, x1 = b.i1 * c, z0 = b.j0 * c, z1 = b.j1 * c;
    const off = (m.houseSide === 'top' ? 26 : 16) * px;
    const offL = (m.houseSide === 'left' ? 26 : 16) * px;
    g.strokeStyle = this.colors.ink;
    g.fillStyle = this.colors.ink;
    g.lineWidth = px;
    g.font = `500 ${11 * px}px ${css('--font-mono')}`;
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    const tick = 4 * px;
    // width along the top
    let y = z0 - off;
    g.beginPath();
    g.moveTo(x0, y); g.lineTo(x1, y);
    g.moveTo(x0, y - tick); g.lineTo(x0, y + tick);
    g.moveTo(x1, y - tick); g.lineTo(x1, y + tick);
    g.stroke();
    this.label(g, fmtLen(x1 - x0, units), (x0 + x1) / 2, y - 3 * px, px);
    // depth along the left
    const x = x0 - offL;
    g.beginPath();
    g.moveTo(x, z0); g.lineTo(x, z1);
    g.moveTo(x - tick, z0); g.lineTo(x + tick, z0);
    g.moveTo(x - tick, z1); g.lineTo(x + tick, z1);
    g.stroke();
    g.save();
    g.translate(x - 3 * px, (z0 + z1) / 2);
    g.rotate(-Math.PI / 2);
    this.label(g, fmtLen(z1 - z0, units), 0, 0, px);
    g.restore();
  }

  label(g, text, x, y, px) {
    const w = g.measureText(text).width;
    g.save();
    g.fillStyle = this.colors['plan-bg'];
    g.fillRect(x - w / 2 - 3 * px, y - 12 * px, w + 6 * px, 13 * px);
    g.restore();
    g.fillText(text, x, y);
  }

  drawOpen(g, o, units, px) {
    g.save();
    g.strokeStyle = this.colors.open;
    g.fillStyle = this.colors.open;
    g.globalAlpha = 0.12;
    g.fillRect(o.x, o.z, o.w, o.d);
    g.globalAlpha = 1;
    g.setLineDash([6 * px, 4 * px]);
    g.lineWidth = 1.5 * px;
    g.strokeRect(o.x, o.z, o.w, o.d);
    g.setLineDash([]);
    const t = `Open lawn ${fmtDims(o.w, o.d, units)}`;
    g.font = `600 ${10 * px}px ${css('--font-ui')}`;
    if (g.measureText(t).width < o.w - 8 * px) {
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillStyle = this.colors.open;
      g.fillText(t, o.x + 5 * px, o.z + 4 * px);
    }
    g.restore();
  }

  drawFixedLabel(g, it, px, selected) {
    const fs = 10 * px;
    g.save();
    if (selected) {
      g.strokeStyle = this.colors.accent;
      g.lineWidth = 2 * px;
      g.strokeRect(it.x - it.w / 2 - 2 * px, it.z - it.d / 2 - 2 * px, it.w + 4 * px, it.d + 4 * px);
    }
    g.font = `600 ${fs}px ${css('--font-ui')}`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    const t = it.name;
    const w = g.measureText(t).width;
    const y = it.z + it.d / 2 + 3 * px;
    g.fillStyle = 'rgba(255,255,255,0.82)';
    g.fillRect(it.x - w / 2 - 3 * px, y - 1 * px, w + 6 * px, fs + 3 * px);
    g.fillStyle = '#2a2622';
    g.fillText(t, it.x, y);
    g.restore();
  }

  drawItem(g, it, st, px, at) {
    const p = at || it;
    const fp = footprint(it, p.x, p.z, p.rot);
    const cat = CATEGORIES[categoryOf(it)] || CATEGORIES.other;
    const sel = st.selected === it.id;
    g.save();
    if (!at && this.layers.clearance && it.clearance > 0) {
      g.strokeStyle = cat.color;
      g.globalAlpha = sel ? 0.9 : 0.45;
      g.setLineDash([4 * px, 3 * px]);
      g.lineWidth = px;
      const c = it.clearance;
      roundRect(g, fp.x0 - c, fp.z0 - c, fp.w + 2 * c, fp.d + 2 * c, Math.min(c, 0.4));
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    // footprint: finish or texture photo when the Textures layer is on, else category colour
    const tex = !at && this.layers.textures ? textureFor(it, () => this.invalidate()) : null;
    if (tex) {
      const pat = this.patternFor(g, tex);
      g.fillStyle = pat;
      shapePath(g, it, fp);
      g.fill();
      g.fillStyle = cat.color;
      g.globalAlpha = 0.28;
      g.fill();
    } else {
      g.fillStyle = cat.color;
      g.globalAlpha = at ? 0.0 : 0.82;
      shapePath(g, it, fp);
      g.fill();
    }
    g.globalAlpha = 1;
    g.lineWidth = (sel ? 2.5 : 1.2) * px;
    g.strokeStyle = sel ? this.colors.accent : 'rgba(0,0,0,0.55)';
    if (at) { g.setLineDash([5 * px, 3 * px]); g.strokeStyle = this.colors.accent; g.lineWidth = 2 * px; }
    shapePath(g, it, fp);
    g.stroke();
    g.setLineDash([]);
    if (it.locked && !at) {
      g.fillStyle = '#fff';
      g.font = `700 ${9 * px}px ${css('--font-ui')}`;
      g.textAlign = 'right'; g.textBaseline = 'top';
      g.fillText('LOCKED', fp.x1 - 3 * px, fp.z0 + 3 * px);
    }
    if (!at) {
      // label inside when it fits, otherwise below
      const fs = 10 * px;
      g.font = `600 ${fs}px ${css('--font-ui')}`;
      const name = it.name;
      const tw = g.measureText(name).width;
      g.textAlign = 'center';
      if (tw < fp.w - 6 * px && fp.d > fs * 2.6) {
        g.fillStyle = '#fff';
        g.shadowColor = 'rgba(0,0,0,0.6)';
        g.shadowBlur = 3;
        g.textBaseline = 'middle';
        g.fillText(name, p.x, p.z - fs * 0.55);
        g.font = `500 ${fs * 0.9}px ${css('--font-mono')}`;
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillText(fmtDims(fp.w, fp.d, st.units), p.x, p.z + fs * 0.65);
      } else {
        g.textBaseline = 'top';
        const y = fp.z1 + (it.clearance > 0 && this.layers.clearance ? Math.max(3 * px, it.clearance * 0.25) : 3 * px);
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(p.x - tw / 2 - 3 * px, y - px, tw + 6 * px, fs + 3 * px);
        g.fillStyle = '#2a2622';
        g.fillText(name, p.x, y);
      }
    }
    g.restore();
  }

  drawProposal(g, st, prop, px) {
    let n = 0;
    st.items.forEach((it, k) => {
      const p = prop.placements[k];
      if (!p || (it.origin === 'scanned' && it.fixed)) return;
      const moved = Math.hypot(p.x - it.x, p.z - it.z) > 0.05 || (p.rot % 180) !== ((it.rot || 0) % 180);
      if (!moved) return;
      n++;
      this.drawItem(g, it, st, px, p);
      g.save();
      g.strokeStyle = this.colors.accent;
      g.fillStyle = this.colors.accent;
      g.lineWidth = 2 * px;
      const dx = p.x - it.x, dz = p.z - it.z, L = Math.hypot(dx, dz);
      if (L > 0.3) {
        const ux = dx / L, uz = dz / L, h = 8 * px;
        const ex = p.x - ux * 4 * px, ez = p.z - uz * 4 * px;
        g.beginPath(); g.moveTo(it.x, it.z); g.lineTo(ex, ez); g.stroke();
        g.beginPath();
        g.moveTo(ex + ux * 2 * px, ez + uz * 2 * px);
        g.lineTo(ex - ux * h - uz * h * 0.5, ez - uz * h + ux * h * 0.5);
        g.lineTo(ex - ux * h + uz * h * 0.5, ez - uz * h - ux * h * 0.5);
        g.closePath(); g.fill();
      }
      const r = 8 * px;
      g.beginPath(); g.arc(p.x, p.z, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = this.colors['accent-ink'];
      g.font = `700 ${10 * px}px ${css('--font-ui')}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(prop.numbers?.[k] ?? n), p.x, p.z + 0.5 * px);
      g.restore();
    });
  }

  drawMeasure(g, m, units, px) {
    g.save();
    g.strokeStyle = this.colors.accent;
    g.fillStyle = this.colors.accent;
    g.lineWidth = 2 * px;
    g.beginPath(); g.moveTo(m.a.x, m.a.z); g.lineTo(m.b.x, m.b.z); g.stroke();
    for (const p of [m.a, m.b]) { g.beginPath(); g.arc(p.x, p.z, 4 * px, 0, Math.PI * 2); g.fill(); }
    const L = Math.hypot(m.b.x - m.a.x, m.b.z - m.a.z);
    g.font = `600 ${12 * px}px ${css('--font-mono')}`;
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    const t = fmtLen(L, units);
    const w = g.measureText(t).width;
    const cx = (m.a.x + m.b.x) / 2, cz = (m.a.z + m.b.z) / 2 - 6 * px;
    g.fillStyle = this.colors.accent;
    g.fillRect(cx - w / 2 - 4 * px, cz - 15 * px, w + 8 * px, 17 * px);
    g.fillStyle = this.colors['accent-ink'];
    g.fillText(t, cx, cz);
    g.restore();
  }

  patternFor(g, src) {
    this.patterns ||= new Map();
    let p = this.patterns.get(src);
    if (!p) {
      p = g.createPattern(src, 'repeat');
      const tile = 0.6; // meters per texture tile
      p.setTransform(new DOMMatrix().scale(tile / Math.max(src.width, src.height)));
      this.patterns.set(src, p);
    }
    return p;
  }

  // ---------------------------------------------------------------- input

  hit(w) {
    const st = this.hooks.getState();
    for (let k = st.items.length - 1; k >= 0; k--) {
      const it = st.items[k];
      if (it.origin === 'scanned' && it.fixed) continue;
      const fp = footprint(it);
      if (w.x >= fp.x0 && w.x <= fp.x1 && w.z >= fp.z0 && w.z <= fp.z1) return it;
    }
    const m = st.model;
    if (m && this.layerCache.owner) {
      const i = Math.floor(w.x / m.cell), j = Math.floor(w.z / m.cell);
      // search a small neighbourhood so thin trunks are clickable
      const r = Math.max(1, Math.round(6 / this.view.s / m.cell));
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= m.cols || jj >= m.rows) continue;
          const k = this.layerCache.owner[jj * m.cols + ii];
          if (k >= 0 && st.items[k]?.fixed) return st.items[k];
        }
    }
    return null;
  }

  bind() {
    const cv = this.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) { this.drag = { type: 'pinch', ...this.pinchInfo() }; return; }
      const w = this.toWorld(p.x, p.y);
      if (this.tool === 'measure') { this.measure = { a: w, b: w }; this.drag = { type: 'measure' }; this.invalidate(); return; }
      if (this.tool === 'door') { this.hooks.onDoor(w); return; }
      const it = this.hit(w);
      this.hooks.onSelect(it ? it.id : null);
      if (it && !it.fixed && !it.locked) this.drag = { type: 'item', item: it, dx: it.x - w.x, dz: it.z - w.z, moved: false };
      else this.drag = { type: 'pan', sx: p.x, sy: p.y, ox: this.view.ox, oy: this.view.oy };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = pos(e);
      this.pointers.set(e.pointerId, p);
      const d = this.drag;
      if (!d) return;
      if (d.type === 'pinch' && this.pointers.size === 2) {
        const now = this.pinchInfo();
        this.zoom(now.dist / d.dist, now.cx, now.cy);
        this.view.ox += now.cx - d.cx; this.view.oy += now.cy - d.cy;
        Object.assign(d, now);
        return;
      }
      const w = this.toWorld(p.x, p.y);
      if (d.type === 'measure') { this.measure.b = w; this.invalidate(); }
      else if (d.type === 'item') {
        const snap = this.hooks.getState().units === 'metric' ? 0.05 : 0.0254 * 3;
        d.item.x = Math.round((w.x + d.dx) / snap) * snap;
        d.item.z = Math.round((w.z + d.dz) / snap) * snap;
        d.moved = true;
        this.hooks.onMove(d.item);
        this.invalidate();
      } else if (d.type === 'pan') {
        this.view.ox = d.ox + p.x - d.sx; this.view.oy = d.oy + p.y - d.sy;
        this.invalidate();
      }
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      const d = this.drag;
      if (d?.type === 'item' && d.moved) this.hooks.onMoveEnd(d.item);
      if (d?.type === 'measure') this.hooks.onMeasure(this.measure);
      if (this.pointers.size < 2) this.drag = d?.type === 'pinch' ? null : (this.pointers.size ? this.drag : null);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });
  }

  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  /** PNG of the current view. */
  snapshot() { return this.canvas.toDataURL('image/png'); }
}

export function defaultDoor(m) {
  if (!m || !m.houseSide || m.houseSide === 'none') return null;
  const b = m.bounds, c = m.cell;
  const x0 = b.i0 * c, x1 = b.i1 * c, z0 = b.j0 * c, z1 = b.j1 * c;
  return { top: { x: (x0 + x1) / 2, z: z0 }, bottom: { x: (x0 + x1) / 2, z: z1 }, left: { x: x0, z: (z0 + z1) / 2 }, right: { x: x1, z: (z0 + z1) / 2 } }[m.houseSide];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function shapePath(g, it, fp) {
  const shape = it.shape || (CATALOG_SHAPES[it.kind]);
  g.beginPath();
  if (shape === 'circle') g.ellipse((fp.x0 + fp.x1) / 2, (fp.z0 + fp.z1) / 2, fp.w / 2, fp.d / 2, 0, 0, Math.PI * 2);
  else if (g.roundRect) g.roundRect(fp.x0, fp.z0, fp.w, fp.d, Math.min(0.08, fp.w / 4, fp.d / 4));
  else g.rect(fp.x0, fp.z0, fp.w, fp.d);
}

const CATALOG_SHAPES = Object.fromEntries(CATALOG.map((c) => [c.kind, c.shape]));
