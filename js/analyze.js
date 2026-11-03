// Turns top-down height rasters of a scan into a yard model: ground surface, usable
// area, shade canopy, slope and a list of the things already standing in the yard.
// Pure functions (no three.js) so they can be unit-tested in Node.
import {
  SAT, dilate, erode, components, fillHoles, boxBlur, fillMissing, minFilter,
} from './grid.js';
import { CATALOG_BY_KIND } from './catalog.js';

export const OBJECT_MIN_H = 0.25;   // anything lower is treated as ground (grass, edging)
export const HEADROOM = 1.9;        // canopy above this height can be walked under

let nextId = 1;
export const newId = (p = 'it') => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

/**
 * Estimate the ground elevation from the lowest surface seen from below.
 * Things like a shed roof show up as "lowest" where the ground under them was never
 * scanned, so cells far above the local minimum are discarded and re-filled.
 */
export function processGround(rawLow, cols, rows, cell) {
  const valid = new Uint8Array(cols * rows);
  for (let i = 0; i < valid.length; i++) valid[i] = Number.isFinite(rawLow[i]) ? 1 : 0;
  const R = Math.max(1, Math.round(1.5 / cell));
  const env = minFilter(rawLow, valid, cols, rows, R);
  const tol = 0.3 + 0.08 * R * cell;
  const good = new Uint8Array(cols * rows);
  for (let i = 0; i < good.length; i++) good[i] = valid[i] && rawLow[i] - env[i] < tol ? 1 : 0;
  let ground = fillMissing(rawLow, good, cols, rows);
  const all = new Uint8Array(cols * rows).fill(1);
  ground = boxBlur(ground, all, cols, rows, Math.max(1, Math.round(0.25 / cell)));
  return ground;
}

/** Slope (rise over run) from a ground surface, measured over ~1 m. */
export function slopeMap(ground, cols, rows, cell) {
  const k = Math.max(1, Math.round(0.5 / cell));
  const out = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const il = Math.max(0, i - k), ir = Math.min(cols - 1, i + k);
      const ju = Math.max(0, j - k), jd = Math.min(rows - 1, j + k);
      const gx = (ground[j * cols + ir] - ground[j * cols + il]) / ((ir - il || 1) * cell);
      const gz = (ground[jd * cols + i] - ground[ju * cols + i]) / ((jd - ju || 1) * cell);
      out[j * cols + i] = Math.hypot(gx, gz);
    }
  return out;
}

/**
 * Build the yard model.
 * @param p.cols, p.rows, p.cell  grid layout (meters per cell)
 * @param p.ground   absolute ground elevation per cell (filled)
 * @param p.topY     highest surface per cell (NaN = nothing)
 * @param p.lowY     lowest surface more than OBJECT_MIN_H above ground (NaN = nothing)
 * @param p.seen     1 where the scan saw anything
 */
export function buildYardModel(p) {
  const { cols, rows, cell } = p;
  const n = cols * rows;
  let covered = Uint8Array.from(p.seen);
  // close small gaps in the scan, then fill pin-holes under 1 m²
  const rc = Math.max(1, Math.round(0.15 / cell));
  covered = erode(dilate(covered, cols, rows, rc), cols, rows, rc);
  for (let i = 0; i < n; i++) covered[i] = covered[i] && 1;
  const maxHole = 1 / (cell * cell);
  covered = fillHoles(covered, cols, rows, (cells) => cells.length <= maxHole);

  const heightTop = new Float32Array(n);
  const obstacle = new Uint8Array(n);
  const canopy = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!covered[i]) continue;
    const ht = Number.isFinite(p.topY[i]) ? p.topY[i] - p.ground[i] : 0;
    heightTop[i] = Math.max(0, ht);
    const low = Number.isFinite(p.lowY[i]) ? p.lowY[i] - p.ground[i] : Infinity;
    if (ht > OBJECT_MIN_H && low < HEADROOM) obstacle[i] = 1;
    else if (ht >= HEADROOM) canopy[i] = 1;
  }
  // roofed, walled regions (sheds): the walls enclose cells whose lowest surface is the roof
  let filled = fillHoles(obstacle, cols, rows, (cells) => {
    if (cells.length * cell * cell > 30) return false;
    let tall = 0;
    for (const c of cells) if (heightTop[c] > 1.5) tall++;
    return tall > cells.length * 0.7;
  });
  for (let i = 0; i < n; i++) if (filled[i] && !obstacle[i]) { obstacle[i] = 1; canopy[i] = 0; }

  const ground = Float32Array.from(p.ground);
  const slope = slopeMap(ground, cols, rows, cell);
  return finishModel({
    source: p.source, name: p.name, cols, rows, cell,
    origin: p.origin || { x: 0, z: 0 }, ground, covered, heightTop, canopy, slope,
    ortho: p.ortho || null,
  }, obstacle);
}

/** Shared tail of model building: obstacle components → scanned items, house side, stats. */
export function finishModel(model, obstacle, presetItems) {
  const { cols, rows, cell, covered, heightTop, canopy } = model;
  const n = cols * rows;
  const cellA = cell * cell;
  // drop specks smaller than a fist; keep slightly larger crumbs blocked but unlisted
  const { labels, count, sizes } = components(obstacle, cols, rows, true);
  const misc = new Uint8Array(n);
  const listed = [];
  const groups = Array.from({ length: count }, () => []);
  for (let i = 0; i < n; i++) if (labels[i] >= 0) groups[labels[i]].push(i);
  const canopySat = new SAT(canopy, cols, rows);
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) outside[i] = covered[i] ? 0 : 1;
  const nearOutside = dilate(outside, cols, rows, Math.max(1, Math.round(0.3 / cell)));
  for (let l = 0; l < count; l++) {
    const area = sizes[l] * cellA;
    if (area < 0.02) continue;
    if (area < 0.12) { for (const c of groups[l]) misc[c] = 1; continue; }
    listed.push(describeComponent(groups[l], model, canopySat, nearOutside));
  }
  model.misc = misc;
  model.bounds = coveredBounds(covered, cols, rows);
  model.width = cols * cell;
  model.depth = rows * cell;
  const items = presetItems || listed;
  model.houseSide = model.houseSide || detectHouseSide(items, model);
  for (const it of items) if (it.isHouse === undefined) it.isHouse = false;
  model.stats = yardStats(model, items);
  return { model, items };
}

function coveredBounds(covered, cols, rows) {
  let i0 = cols, j0 = rows, i1 = -1, j1 = -1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      if (covered[j * cols + i]) {
        if (i < i0) i0 = i; if (i > i1) i1 = i;
        if (j < j0) j0 = j; if (j > j1) j1 = j;
      }
  if (i1 < 0) return { i0: 0, j0: 0, i1: cols, j1: rows };
  return { i0, j0, i1: i1 + 1, j1: j1 + 1 };
}

function describeComponent(cells, model, canopySat, nearOutside) {
  const { cols, cell, heightTop } = model;
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity, maxH = 0, sumH = 0, edge = 0;
  for (const c of cells) {
    const i = c % cols, j = (c - i) / cols;
    if (i < i0) i0 = i; if (i > i1) i1 = i;
    if (j < j0) j0 = j; if (j > j1) j1 = j;
    const h = heightTop[c];
    if (h > maxH) maxH = h;
    sumH += h;
    if (nearOutside[c]) edge++;
  }
  const w = (i1 - i0 + 1) * cell, d = (j1 - j0 + 1) * cell;
  const area = cells.length * cell * cell;
  const ring = Math.round(1.5 / cell);
  const ringCells = (i1 - i0 + 1 + 2 * ring) * (j1 - j0 + 1 + 2 * ring) - (i1 - i0 + 1) * (j1 - j0 + 1);
  const canopyNear = canopySat.sum(i0 - ring, j0 - ring, i1 + 1 + ring, j1 + 1 + ring) / Math.max(1, ringCells);
  const stats = {
    area, w, d, maxH, meanH: sumH / cells.length, fill: area / (w * d),
    edgeFrac: edge / cells.length, canopyNear,
  };
  const guess = classify(stats);
  const item = {
    id: newId('sc'),
    name: guess.name,
    scanType: guess.type,
    kind: guess.kind || 'scanned',
    origin: 'scanned',
    autoName: true,
    fixed: guess.fixed,
    locked: false,
    w: round2(w), d: round2(d), h: round2(maxH),
    x: round2((i0 + i1 + 1) / 2 * cell), z: round2((j0 + j1 + 1) / 2 * cell),
    rot: 0,
    shape: 'rect',
    clearance: guess.fixed ? 0 : (CATALOG_BY_KIND[guess.kind]?.clearance ?? 0.5),
    cells: cells.slice(),
    home: null,
    stats,
  };
  item.home = { x: item.x, z: item.z, rot: 0 };
  return item;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Heuristic labels. People can rename anything and flip fixed/movable. */
export function classify(s) {
  const long = Math.max(s.w, s.d), short = Math.min(s.w, s.d);
  if (s.maxH >= HEADROOM) {
    if ((long >= 4 && short <= 0.7) || (long >= 4 && s.fill < 0.3)) {
      if (s.maxH > 2.6 && s.edgeFrac > 0.3) return { name: 'House wall', type: 'wall', kind: 'house', fixed: true };
      return { name: 'Fence / wall', type: 'fence', kind: 'fence', fixed: true };
    }
    if (s.area >= 2 && s.fill >= 0.6) return { name: 'Structure', type: 'structure', kind: 'structure', fixed: true };
    if (s.canopyNear > 0.25 || s.area < 1.0) return { name: 'Tree', type: 'tree', kind: 'tree', fixed: true };
    if (s.area >= 2) return { name: 'Structure', type: 'structure', kind: 'structure', fixed: true };
    return { name: 'Tall object', type: 'tall', fixed: true };
  }
  if (long >= 3 && short <= 0.4) return { name: 'Low wall / edging', type: 'edging', kind: 'wall', fixed: true };
  if (s.area > 8) return { name: 'Large low feature', type: 'feature', kind: 'deck', fixed: true };
  const h = s.maxH, a = s.area;
  // ragged, see-through outline: a bush rather than something built
  if (h >= 0.5 && s.fill < 0.55 && a >= 0.3) return { name: 'Shrub?', type: 'shrub', fixed: true, kind: 'shrub' };
  if (h >= 0.6 && h <= 0.95 && a >= 0.6 && a <= 4.5)
    return { name: 'Table?', type: 'table', fixed: false, kind: a > 2 ? 'dining6' : 'bistro' };
  if (h > 0.95 && h <= 1.5 && a >= 0.4 && a <= 1.8)
    return { name: 'Grill?', type: 'grill', fixed: false, kind: 'grill' };
  if (h < 0.6 && a > 1.2) return { name: 'Planter / bed?', type: 'bed', fixed: false, kind: 'gardenbed' };
  if (a < 0.8) return { name: 'Chair / small object', type: 'small', fixed: false };
  return { name: 'Object', type: 'object', fixed: false };
}

/** Which side of the plan the house is on: the side with a long tall fixed thing along it. */
export function detectHouseSide(items, model) {
  const { bounds, cell } = model;
  const W = (bounds.i1 - bounds.i0) * cell, D = (bounds.j1 - bounds.j0) * cell;
  const x0 = bounds.i0 * cell, x1 = bounds.i1 * cell, z0 = bounds.j0 * cell, z1 = bounds.j1 * cell;
  const score = { top: 0, bottom: 0, left: 0, right: 0 };
  const band = 1.2;
  for (const it of items) {
    if (!it.fixed || it.h < 2.2) continue;
    const ix0 = it.x - it.w / 2, ix1 = it.x + it.w / 2, iz0 = it.z - it.d / 2, iz1 = it.z + it.d / 2;
    if (iz0 - z0 < band) score.top += it.w / W;
    if (z1 - iz1 < band) score.bottom += it.w / W;
    if (ix0 - x0 < band) score.left += it.d / D;
    if (x1 - ix1 < band) score.right += it.d / D;
  }
  let best = 'top', bv = 0.45;
  for (const k of Object.keys(score)) if (score[k] > bv) { best = k; bv = score[k]; }
  for (const it of items) {
    if (!it.fixed || it.h < 2.2) continue;
    const r = best === 'top' || best === 'bottom' ? it.w / W : it.d / D;
    if (r > 0.4 && /wall|Structure/i.test(it.name)) { it.name = 'House'; it.scanType = 'house'; it.kind = 'house'; it.isHouse = true; }
  }
  return best;
}

export function yardStats(model, items) {
  const { cols, rows, cell, covered, canopy, slope } = model;
  const cellA = cell * cell;
  let usable = 0, shade = 0, blocked = 0, slopeSum = 0, steep = 0, maxSlope = 0;
  const fixedMask = fixedObstacleMask(model, items);
  for (let i = 0; i < cols * rows; i++) {
    if (!covered[i]) continue;
    if (fixedMask[i]) { blocked++; continue; }
    usable++;
    if (canopy[i]) shade++;
    slopeSum += slope[i];
    if (slope[i] > 0.08) steep++;
    if (slope[i] > maxSlope) maxSlope = slope[i];
  }
  const b = model.bounds;
  return {
    width: (b.i1 - b.i0) * cell,
    depth: (b.j1 - b.j0) * cell,
    usableArea: usable * cellA,
    blockedArea: blocked * cellA,
    shadeFrac: usable ? shade / usable : 0,
    meanSlope: usable ? slopeSum / usable : 0,
    steepFrac: usable ? steep / usable : 0,
    maxSlope,
  };
}

/** 1 where the yard cannot be used: outside the scan, fixed scanned things, unlisted crumbs. */
export function fixedObstacleMask(model, items) {
  const { cols, rows, covered } = model;
  const m = new Uint8Array(cols * rows);
  for (let i = 0; i < m.length; i++) m[i] = covered[i] ? (model.misc ? model.misc[i] : 0) : 1;
  for (const it of items) {
    if (it.origin === 'scanned' && it.fixed && it.cells) for (const c of it.cells) m[c] = 1;
  }
  return m;
}

/** A plain rectangular yard for people without a scan. */
export function manualYard(widthM, depthM, houseSide = 'top') {
  const cell = Math.max(0.05, Math.min(0.2, Math.max(widthM, depthM) / 300));
  const cols = Math.max(4, Math.round(widthM / cell)), rows = Math.max(4, Math.round(depthM / cell));
  const n = cols * rows;
  const model = {
    source: 'manual', name: 'Custom yard', cols, rows, cell, origin: { x: 0, z: 0 },
    ground: new Float32Array(n), covered: new Uint8Array(n).fill(1), heightTop: new Float32Array(n),
    canopy: new Uint8Array(n), slope: new Float32Array(n), ortho: null, houseSide,
  };
  return finishModel(model, new Uint8Array(n));
}

// ---- hand corrections: mark, split and merge scanned items -------------------

/** Recompute a scanned item's measured box from its cells and put it back at its scanned spot. */
export function refreshFromCells(model, it) {
  const { cols, cell, heightTop, canopy } = model;
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity, maxH = 0;
  for (const c of it.cells) {
    const i = c % cols, j = (c - i) / cols;
    if (i < i0) i0 = i; if (i > i1) i1 = i;
    if (j < j0) j0 = j; if (j > j1) j1 = j;
    if (heightTop[c] > maxH && !canopy[c]) maxH = heightTop[c];
  }
  it.w = round2((i1 - i0 + 1) * cell);
  it.d = round2((j1 - j0 + 1) * cell);
  it.x = round2((i0 + i1 + 1) / 2 * cell);
  it.z = round2((j0 + j1 + 1) / 2 * cell);
  it.rot = 0;
  if (maxH >= 0.15) it.h = round2(maxH);
  else it.h = it.h && it.h >= 0.15 ? it.h : 0.5; // flat in the scan: assume knee height
  it.home = { x: it.x, z: it.z, rot: 0 };
  delete it.stats;
  return it;
}

/**
 * Turn a box drawn on the plan into a scanned item. Whatever stands up inside the box is
 * used; if nothing does (a low bench read as ground) the whole box is used. Cells that
 * belonged to other scanned items move to the new one, which is how a detection is split.
 * Returns { item, removed: ids of items left empty, touched: ids of items that lost cells } or null.
 */
export function markRegion(model, items, rect) {
  const { cols, rows, cell, covered, heightTop } = model;
  const i0 = Math.max(0, Math.floor(Math.min(rect.x0, rect.x1) / cell)), i1 = Math.min(cols, Math.ceil(Math.max(rect.x0, rect.x1) / cell));
  const j0 = Math.max(0, Math.floor(Math.min(rect.z0, rect.z1) / cell)), j1 = Math.min(rows, Math.ceil(Math.max(rect.z0, rect.z1) / cell));
  if (i1 - i0 < 1 || j1 - j0 < 1) return null;
  const all = [], standing = [];
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const k = j * cols + i;
      if (!covered[k]) continue;
      all.push(k);
      // tree canopy overhead is walk-under space, not part of the thing being marked
      if (heightTop[k] >= 0.15 && !model.canopy[k]) standing.push(k);
    }
  const chosen = standing.length >= Math.max(4, all.length * 0.02) ? standing : all;
  if (!chosen.length) return null;
  const take = new Set(chosen);
  const removed = [], touched = [];
  let fromFixed = 0, fromAny = 0;
  for (const it of items) {
    if (it.origin !== 'scanned' || !it.cells) continue;
    const before = it.cells.length;
    const keep = it.cells.filter((c) => !take.has(c));
    if (keep.length === before) continue;
    const moved = before - keep.length;
    fromAny += moved;
    if (it.fixed) fromFixed += moved;
    if (keep.length) { it.cells = keep; refreshFromCells(model, it); touched.push(it.id); }
    else removed.push(it.id);
  }
  const item = refreshFromCells(model, {
    id: newId('mk'), name: 'Marked item', autoName: true, scanType: 'marked', kind: 'scanned',
    origin: 'scanned', marked: true, fixed: fromAny > 0 && fromFixed > fromAny / 2, locked: false,
    shape: 'rect', clearance: 0.5, cells: chosen, rot: 0, h: standing.length ? 0 : 0.5,
  });
  if (item.fixed) item.clearance = 0;
  return { item, removed, touched, flat: chosen === all && !standing.length };
}

/** Join b into a (both scanned). Returns a. */
export function mergeItems(model, a, b) {
  const set = new Set(a.cells);
  for (const c of b.cells) set.add(c);
  a.cells = [...set];
  if (b.h > a.h) a.h = b.h;
  return refreshFromCells(model, a);
}

/** Scanned items within `maxGap` meters of `it`, nearest first. */
export function nearbyScanned(items, it, maxGap = 2) {
  const box = (o) => ({ x0: o.home?.x ?? o.x, z0: o.home?.z ?? o.z, w: o.w, d: o.d });
  const a = box(it);
  return items
    .filter((o) => o !== it && o.origin === 'scanned' && o.cells?.length)
    .map((o) => {
      const b = box(o);
      const dx = Math.max(0, Math.abs(a.x0 - b.x0) - (a.w + b.w) / 2);
      const dz = Math.max(0, Math.abs(a.z0 - b.z0) - (a.d + b.d) / 2);
      return { item: o, gap: Math.hypot(dx, dz) };
    })
    .filter((o) => o.gap <= maxGap)
    .sort((p, q) => p.gap - q.gap);
}
