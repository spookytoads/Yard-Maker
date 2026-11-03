// Layout optimizer: places movable pieces so each one gets its clearance and placement
// rules, everything stays reachable from the door, and the biggest possible open lawn is
// left over. Greedy seeding followed by simulated annealing. Pure JS (no DOM).
import { SAT, distanceField, largestRect } from './grid.js';
import { rulesOf } from './catalog.js';
import { fixedObstacleMask } from './analyze.js';

const TALL = 1.9;

export function footprint(it, x = it.x, z = it.z, rot = it.rot || 0) {
  const turned = rot % 180 !== 0;
  const w = turned ? it.d : it.w, d = turned ? it.w : it.d;
  return { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, w, d };
}

const expand = (r, c) => ({ x0: r.x0 - c, z0: r.z0 - c, x1: r.x1 + c, z1: r.z1 + c, w: r.w + 2 * c, d: r.d + 2 * c });

function overlap(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0 && d > 0 ? w * d : 0;
}

/** Gap between two rectangles (0 when touching or overlapping). */
export function rectGap(a, b) {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dz = Math.max(0, a.z0 - b.z1, b.z0 - a.z1);
  return Math.hypot(dx, dz);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether the optimizer may move this item. */
export const isMovable = (it) => !it.fixed && !it.locked;

/**
 * Precompute everything about the yard that does not depend on where furniture goes.
 */
export function buildSite(model, items, opts = {}) {
  const { cols, rows, cell } = model;
  const fine = fixedObstacleMask(model, items);
  const statics = items.filter((it) => !isMovable(it) && !(it.origin === 'scanned' && it.fixed && it.cells));
  for (const it of statics) paintFine(fine, model, footprint(it));

  // coarse grid (~0.25 m) for footprint tests
  const f = Math.max(1, Math.round(0.25 / cell));
  const cc = f * cell;
  const C = Math.ceil(cols / f), R = Math.ceil(rows / f);
  const blocked = new Uint8Array(C * R), canopy = new Float32Array(C * R), slope = new Float32Array(C * R);
  const tall = new Uint8Array(C * R);
  const tallFine = new Uint8Array(cols * rows);
  for (const it of items) {
    if (it.h < TALL) continue;
    if (it.origin === 'scanned' && it.fixed && it.cells) for (const c of it.cells) tallFine[c] = 1;
    else if (!isMovable(it)) paintFine(tallFine, model, footprint(it));
  }
  for (let J = 0; J < R; J++)
    for (let I = 0; I < C; I++) {
      let b = 0, cn = 0, s = 0, t = 0, n = 0;
      for (let j = J * f; j < Math.min(rows, J * f + f); j++)
        for (let i = I * f; i < Math.min(cols, I * f + f); i++) {
          const k = j * cols + i;
          b |= fine[k]; t |= tallFine[k];
          cn += model.canopy[k]; s += model.slope[k]; n++;
        }
      const K = J * C + I;
      blocked[K] = b; tall[K] = t; canopy[K] = cn / n; slope[K] = s / n;
    }
  const distEdge = distanceField(blocked, C, R);
  const distTall = distanceField(tall, C, R);
  for (let i = 0; i < distEdge.length; i++) { distEdge[i] *= cc; distTall[i] *= cc; }

  // global grid (~0.5 m) for open-space and walkway checks
  const g = Math.max(1, Math.round(0.5 / cc));
  const gc = g * cc;
  const GC = Math.ceil(C / g), GR = Math.ceil(R / g);
  const gBlocked = new Uint8Array(GC * GR);
  let usableG = 0;
  for (let J = 0; J < GR; J++)
    for (let I = 0; I < GC; I++) {
      let b = 0, n = 0;
      for (let j = J * g; j < Math.min(R, J * g + g); j++)
        for (let i = I * g; i < Math.min(C, I * g + g); i++) { b += blocked[j * C + i]; n++; }
      gBlocked[J * GC + I] = b / n > 0.25 ? 1 : 0;
      if (!gBlocked[J * GC + I]) usableG++;
    }

  const b = model.bounds;
  const house = {
    side: model.houseSide || 'none',
    x0: b.i0 * cell, x1: b.i1 * cell, z0: b.j0 * cell, z1: b.j1 * cell,
  };
  let door = opts.door || null;
  if (!door && house.side !== 'none') {
    const mx = (house.x0 + house.x1) / 2, mz = (house.z0 + house.z1) / 2;
    door = { top: { x: mx, z: house.z0 }, bottom: { x: mx, z: house.z1 }, left: { x: house.x0, z: mz }, right: { x: house.x1, z: mz } }[house.side];
  }
  let doorCell = null;
  if (door) doorCell = nearestFree(gBlocked, GC, GR, Math.floor(door.x / gc), Math.floor(door.z / gc));

  return {
    model, cell, cc, C, R, blocked, sat: new SAT(blocked, C, R), canopySat: new SAT(canopy, C, R),
    slopeSat: new SAT(slope, C, R), distEdge, distTall,
    gc, GC, GR, gBlocked, usableArea: usableG * gc * gc, house, door, doorCell, statics,
  };
}

function paintFine(mask, model, r) {
  const { cols, rows, cell } = model;
  const i0 = Math.max(0, Math.floor(r.x0 / cell)), i1 = Math.min(cols, Math.ceil(r.x1 / cell));
  const j0 = Math.max(0, Math.floor(r.z0 / cell)), j1 = Math.min(rows, Math.ceil(r.z1 / cell));
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) mask[j * cols + i] = 1;
}

function nearestFree(mask, C, R, ci, cj) {
  ci = Math.max(0, Math.min(C - 1, ci));
  cj = Math.max(0, Math.min(R - 1, cj));
  let best = null, bd = Infinity;
  for (let j = 0; j < R; j++)
    for (let i = 0; i < C; i++) {
      if (mask[j * C + i]) continue;
      const d = (i - ci) ** 2 + (j - cj) ** 2;
      if (d < bd) { bd = d; best = j * C + i; }
    }
  return best;
}

// ---- per-rect samplers ------------------------------------------------------

function cellRange(site, r) {
  const e = 1e-6;
  return [
    Math.floor(r.x0 / site.cc + e), Math.floor(r.z0 / site.cc + e),
    Math.ceil(r.x1 / site.cc - e), Math.ceil(r.z1 / site.cc - e),
  ];
}

/** Cells of the rect that are outside the yard or blocked, and the rect's total cells. */
function blockedCells(site, r) {
  const [i0, j0, i1, j1] = cellRange(site, r);
  const total = Math.max(1, (i1 - i0) * (j1 - j0));
  const ci = Math.max(0, Math.min(site.C, i1) - Math.max(0, i0));
  const cj = Math.max(0, Math.min(site.R, j1) - Math.max(0, j0));
  const inside = ci * cj;
  return { blocked: site.sat.sum(i0, j0, i1, j1) + (total - inside), total };
}

function meanOver(site, satObj, r) {
  const [i0, j0, i1, j1] = cellRange(site, r);
  const ci = Math.max(0, Math.min(site.C, i1) - Math.max(0, i0));
  const cj = Math.max(0, Math.min(site.R, j1) - Math.max(0, j0));
  return ci * cj ? satObj.sum(i0, j0, i1, j1) / (ci * cj) : 0;
}

function sampleField(site, field, x, z) {
  const i = Math.max(0, Math.min(site.C - 1, Math.floor(x / site.cc)));
  const j = Math.max(0, Math.min(site.R - 1, Math.floor(z / site.cc)));
  return field[j * site.C + i];
}

export function houseGap(site, r) {
  const h = site.house;
  switch (h.side) {
    case 'top': return r.z0 - h.z0;
    case 'bottom': return h.z1 - r.z1;
    case 'left': return r.x0 - h.x0;
    case 'right': return h.x1 - r.x1;
    default: return null;
  }
}

/** Measurable facts about one placed piece (used for scoring and for the written notes). */
export function measure(site, it, p, others) {
  const fp = footprint(it, p.x, p.z, p.rot);
  const reff = (fp.w + fp.d) / 4;
  const out = {
    fp,
    houseGap: houseGap(site, fp),
    tallGap: sampleField(site, site.distTall, p.x, p.z) - reff,
    edgeGap: sampleField(site, site.distEdge, p.x, p.z) - Math.min(fp.w, fp.d) / 2,
    shade: meanOver(site, site.canopySat, fp),
    slope: meanOver(site, site.slopeSat, fp),
    blocked: blockedCells(site, fp),
  };
  const rules = rulesOf(it);
  if (rules.near) out.near = nearestOf(it, fp, rules.near.kinds, others);
  if (rules.away) out.away = rules.away.map((a) => ({ kinds: a.kinds, min: a.gap, ...nearestOf(it, fp, a.kinds, others) }));
  if (site.door) out.doorGap = rectGap(fp, { x0: site.door.x, x1: site.door.x, z0: site.door.z, z1: site.door.z });
  return out;
}

function nearestOf(it, fp, kinds, others) {
  let best = null, gap = Infinity;
  for (const o of others) {
    if (o.item === it || !kinds.includes(o.item.kind)) continue;
    const g = rectGap(fp, o.fp);
    if (g < gap) { gap = g; best = o.item; }
  }
  return { item: best, gap };
}

// ---- scoring ---------------------------------------------------------------

/**
 * Score a full layout. `P[k]` is the placement of items[k]. Lower is better.
 * @param active optional boolean array; inactive items are ignored (used while seeding)
 */
export function evaluate(site, items, P, { active = null, global = true, detail = false } = {}) {
  const placed = [];
  for (let k = 0; k < items.length; k++) {
    if (active && !active[k]) continue;
    const it = items[k];
    if (it.origin === 'scanned' && it.fixed && it.cells) continue; // part of the terrain mask
    const fp = footprint(it, P[k].x, P[k].z, P[k].rot);
    placed.push({ k, item: it, fp, clr: expand(fp, it.clearance || 0), movable: isMovable(it) });
  }
  let total = 0;
  const per = detail ? new Map() : null;
  const add = (k, v, why) => {
    total += v;
    if (per && v > 0.01) {
      if (!per.has(k)) per.set(k, []);
      per.get(k).push({ why, v });
    }
  };

  for (let a = 0; a < placed.length; a++) {
    const A = placed[a];
    if (!A.movable) continue;
    const it = A.item, rules = rulesOf(it);
    const { blocked, total: cells } = blockedCells(site, A.fp);
    if (blocked > 0) add(A.k, 300 + 400 * (blocked / cells), 'blocked');
    const c = it.clearance || 0;
    if (c > 0) {
      const outer = blockedCells(site, A.clr);
      const ring = Math.max(1, outer.total - cells);
      const frac = Math.max(0, outer.blocked - blocked) / ring;
      add(A.k, (rules.edge === 'prefer' ? 6 : 40) * frac, 'clearance');
    }
    for (let b = 0; b < placed.length; b++) {
      if (b === a) continue;
      const B = placed[b];
      const ov = overlap(A.fp, B.fp);
      if (ov > 0 && (!B.movable || b > a)) {
        add(A.k, 300 + 400 * ov / Math.max(0.1, Math.min(A.fp.w * A.fp.d, B.fp.w * B.fp.d)), 'overlap');
      }
      const cb = B.item.clearance || 0;
      if (cb > 0) {
        const hit = overlap(A.fp, B.clr) - ov;
        if (hit > 1e-6) add(A.k, 40 * hit / Math.max(0.1, B.clr.w * B.clr.d - B.fp.w * B.fp.d), 'clearance');
      }
    }
    const m = measure(site, it, P[A.k], placed);
    if (rules.house && m.houseGap !== null) {
      const [lo, hi] = rules.house;
      if (m.houseGap < lo) add(A.k, (lo >= 2.5 ? 25 : 12) * (lo - m.houseGap), 'house-near');
      if (m.houseGap > hi) add(A.k, 4 * (m.houseGap - hi), 'house-far');
    }
    if (rules.awayTall && m.tallGap < rules.awayTall) add(A.k, 20 * (rules.awayTall - m.tallGap), 'tall');
    if (rules.sky) add(A.k, 30 * m.shade, 'canopy');
    if (rules.light === 'sun') add(A.k, 10 * m.shade, 'sun');
    if (rules.light === 'shade') add(A.k, 8 * (1 - m.shade), 'shade');
    if (rules.edge === 'prefer') add(A.k, Math.min(15, 3 * Math.max(0, m.edgeGap - 0.3)), 'edge');
    if (rules.edge === 'avoid' && m.edgeGap < 1.5) add(A.k, 6 * (1.5 - m.edgeGap), 'edge-avoid');
    if (rules.level) add(A.k, 80 * Math.max(0, m.slope - 0.03), 'slope');
    if (m.near && m.near.item) add(A.k, 6 * Math.max(0, m.near.gap - rules.near.gap), 'near');
    if (m.away) for (const w of m.away) if (w.item && w.gap < w.min) add(A.k, 15 * (w.min - w.gap), 'away');
    if (m.doorGap !== undefined && m.doorGap < 1.0) add(A.k, 30 * (1 - m.doorGap), 'door');
    if (it.home) add(A.k, 0.4 * Math.hypot(P[A.k].x - it.home.x, P[A.k].z - it.home.z), 'moved');
  }

  let open = null, unreachable = [];
  if (global) {
    const g = globalCheck(site, placed);
    open = g.open;
    unreachable = g.unreachable;
    total -= 35 * (open.score / Math.max(1, site.usableArea));
    for (const k of unreachable) add(k, 60, 'unreachable');
  }
  return { total, per, open, unreachable, placed };
}

export function lawnScore(w, h) {
  const s = Math.min(w, h), L = Math.max(w, h);
  return w * h * Math.min(1, s / (0.6 * L));
}

function globalCheck(site, placed) {
  const { GC, GR, gc, gBlocked } = site;
  const occOpen = Uint8Array.from(gBlocked);
  const occWalk = Uint8Array.from(gBlocked);
  const paint = (mask, r) => {
    const i0 = Math.max(0, Math.floor(r.x0 / gc)), i1 = Math.min(GC, Math.ceil(r.x1 / gc));
    const j0 = Math.max(0, Math.floor(r.z0 / gc)), j1 = Math.min(GR, Math.ceil(r.z1 / gc));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) mask[j * GC + i] = 1;
  };
  for (const p of placed) { paint(occOpen, p.clr); paint(occWalk, p.fp); }
  const free = new Uint8Array(GC * GR);
  for (let i = 0; i < free.length; i++) free[i] = occOpen[i] ? 0 : 1;
  // a usable lawn is roughly square: long thin strips only count up to 1 : 1.7
  const lr = largestRect(free, GC, GR, lawnScore);
  let { i, j, w, h } = lr;
  // report the squarish part of a long strip, centered
  const w2 = Math.min(w, Math.round(h * 1.7)), h2 = Math.min(h, Math.round(w * 1.7));
  i += Math.floor((w - w2) / 2); j += Math.floor((h - h2) / 2);
  const open = { area: w2 * h2 * gc * gc, score: lr.score * gc * gc, x: i * gc, z: j * gc, w: w2 * gc, d: h2 * gc };

  const unreachable = [];
  if (site.doorCell !== null) {
    const seen = new Uint8Array(GC * GR);
    const q = new Int32Array(GC * GR);
    let qh = 0, qt = 0;
    const start = site.doorCell;
    if (!occWalk[start]) { seen[start] = 1; q[qt++] = start; }
    while (qh < qt) {
      const c = q[qh++];
      const ci = c % GC, cj = (c - ci) / GC;
      const nb = [ci > 0 ? c - 1 : -1, ci < GC - 1 ? c + 1 : -1, cj > 0 ? c - GC : -1, cj < GR - 1 ? c + GC : -1];
      for (const n of nb) if (n >= 0 && !seen[n] && !occWalk[n]) { seen[n] = 1; q[qt++] = n; }
    }
    for (const p of placed) {
      if (!p.movable && p.item.origin === 'scanned') continue;
      const r = p.fp;
      const i0 = Math.max(0, Math.floor(r.x0 / gc) - 1), i1 = Math.min(GC, Math.ceil(r.x1 / gc) + 1);
      const j0 = Math.max(0, Math.floor(r.z0 / gc) - 1), j1 = Math.min(GR, Math.ceil(r.z1 / gc) + 1);
      let ok = false;
      for (let j = j0; j < j1 && !ok; j++) for (let i = i0; i < i1; i++) if (seen[j * GC + i]) { ok = true; break; }
      if (!ok) unreachable.push(p.k);
    }
  }
  return { open, unreachable };
}

// ---- search ----------------------------------------------------------------

/**
 * Find a good layout. Resolves to { placements, before, after, seed }.
 * Runs in time slices so the page stays responsive.
 */
export async function optimize(model, items, opts = {}) {
  const seed = opts.seed ?? 1;
  const rand = mulberry32(seed);
  const site = buildSite(model, items, opts);
  const movable = items.map((it, k) => (isMovable(it) ? k : -1)).filter((k) => k >= 0);
  const current = items.map((it) => ({ x: it.x, z: it.z, rot: it.rot || 0 }));
  const before = evaluate(site, items, current, { detail: true });
  if (!movable.length) return { site, placements: current, before, after: before, seed };

  const budget = opts.timeMs ?? 1400;
  const t0 = now();
  const slice = async () => { await new Promise((r) => setTimeout(r, 0)); };
  const progress = (f) => opts.onProgress && opts.onProgress(Math.min(1, f));

  const seeded = await greedySeed(site, items, current, movable, rand, slice);
  const starts = [seeded, current.map((p) => ({ ...p }))];
  let best = null;
  for (let s = 0; s < starts.length; s++) {
    const share = s === 0 ? 0.65 : 0.35;
    const r = await anneal(site, items, starts[s], movable, rand, budget * share, slice, (f) => progress((s === 0 ? 0 : 0.65) + f * share));
    if (!best || r.cost < best.cost) best = r;
  }
  // snap to 5 cm and settle
  const P = best.P.map((p) => ({ x: Math.round(p.x * 20) / 20, z: Math.round(p.z * 20) / 20, rot: p.rot }));
  let after = evaluate(site, items, P, { detail: true });
  if (after.total > before.total) { after = before; best.P = current; }
  progress(1);
  return { site, placements: after === before ? current : P, before, after, seed, elapsed: now() - t0 };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function bounds(site) {
  const h = site.house;
  return { x0: h.x0, x1: h.x1, z0: h.z0, z1: h.z1 };
}

async function greedySeed(site, items, current, movable, rand, slice) {
  const P = current.map((p) => ({ ...p }));
  const active = items.map((it) => !isMovable(it));
  const order = movable.slice().sort((a, b) => {
    const A = items[a], B = items[b];
    const sa = (A.w + 2 * (A.clearance || 0)) * (A.d + 2 * (A.clearance || 0));
    const sb = (B.w + 2 * (B.clearance || 0)) * (B.d + 2 * (B.clearance || 0));
    return sb - sa;
  });
  const bb = bounds(site);
  const span = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0);
  const step = Math.max(0.35, Math.min(1.0, span / 30));
  let t = now();
  for (const k of order) {
    active[k] = true;
    const it = items[k];
    let bestCost = Infinity, bestP = P[k];
    for (const rot of [0, 90]) {
      if (rot === 90 && Math.abs(it.w - it.d) < 0.05) continue;
      for (let z = bb.z0 + step / 2; z < bb.z1; z += step)
        for (let x = bb.x0 + step / 2; x < bb.x1; x += step) {
          P[k] = { x, z, rot };
          const c = evaluate(site, items, P, { active, global: false }).total + rand() * 3;
          if (c < bestCost) { bestCost = c; bestP = { x, z, rot }; }
        }
      if (now() - t > 30) { await slice(); t = now(); }
    }
    P[k] = bestP;
  }
  return P;
}

async function anneal(site, items, start, movable, rand, ms, slice, progress) {
  let P = start.map((p) => ({ ...p }));
  let cost = evaluate(site, items, P).total;
  let best = { P: P.map((p) => ({ ...p })), cost };
  const bb = bounds(site);
  const T0 = 12, T1 = 0.15;
  const tStart = now();
  let tSlice = tStart;
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  for (let iter = 0; ; iter++) {
    const el = now() - tStart;
    if (el >= ms) break;
    const f = el / ms;
    const T = T0 * Math.pow(T1 / T0, f);
    const sigma = 2.5 * (1 - f) + 0.15;
    const k = movable[Math.floor(rand() * movable.length)];
    const old = P[k];
    let other = -1, oldOther = null;
    const r = rand();
    if (r < 0.62) P[k] = { x: old.x + gauss() * sigma, z: old.z + gauss() * sigma, rot: old.rot };
    else if (r < 0.75) P[k] = { ...old, rot: (old.rot + 90) % 180 };
    else if (r < 0.87 && movable.length > 1) {
      other = movable[Math.floor(rand() * movable.length)];
      if (other === k) other = -1;
      else { oldOther = P[other]; P[k] = { ...oldOther, rot: old.rot }; P[other] = { ...old, rot: oldOther.rot }; }
    } else P[k] = { x: bb.x0 + rand() * (bb.x1 - bb.x0), z: bb.z0 + rand() * (bb.z1 - bb.z0), rot: rand() < 0.5 ? 0 : 90 };
    const c = evaluate(site, items, P).total;
    if (c <= cost || rand() < Math.exp((cost - c) / T)) {
      cost = c;
      if (c < best.cost) best = { P: P.map((p) => ({ ...p })), cost: c };
    } else {
      P[k] = old;
      if (other >= 0) P[other] = oldOther;
    }
    if (now() - tSlice > 25) { progress(f); await slice(); tSlice = now(); }
  }
  return best;
}
