import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleYard } from '../js/sample.js';
import { manualYard, classify } from '../js/analyze.js';
import { optimize, footprint, buildSite, measure, rectGap } from '../js/optimizer.js';
import { layoutNotes, claudeSummary } from '../js/notes.js';
import { CATALOG_BY_KIND } from '../js/catalog.js';

const add = (items, kind, x = 8, z = 6) => {
  const c = CATALOG_BY_KIND[kind];
  items.push({ id: kind + items.length, name: c.name, kind, origin: 'new', w: c.w, d: c.d, h: c.h, clearance: c.clearance, x, z, rot: 0, fixed: false, locked: false });
};

test('sample yard: measured size and detected features', () => {
  const { model, items } = sampleYard();
  assert.equal(model.houseSide, 'top');
  assert.ok(Math.abs(model.stats.width - 16) < 0.01 && Math.abs(model.stats.depth - 12) < 0.01);
  const names = items.map((i) => i.scanType).sort();
  assert.deepEqual(names, ['grill', 'shed', 'table', 'tree', 'tree']);
  assert.ok(items.filter((i) => i.scanType === 'tree').every((i) => i.fixed));
  assert.ok(model.stats.shadeFrac > 0.1 && model.stats.shadeFrac < 0.35);
});

test('classifier labels common shapes', () => {
  assert.equal(classify({ area: 0.2, w: 0.5, d: 0.5, maxH: 7, meanH: 7, fill: 0.8, edgeFrac: 0, canopyNear: 0.6 }).type, 'tree');
  assert.equal(classify({ area: 4.3, w: 2.4, d: 1.8, maxH: 2.3, meanH: 2.3, fill: 1, edgeFrac: 0, canopyNear: 0.4 }).type, 'structure');
  assert.equal(classify({ area: 4, w: 14, d: 0.3, maxH: 3.2, meanH: 3, fill: 1, edgeFrac: 0.9, canopyNear: 0 }).type, 'wall');
  assert.equal(classify({ area: 1.4, w: 1.4, d: 1, maxH: 0.75, meanH: 0.75, fill: 1, edgeFrac: 0, canopyNear: 0 }).type, 'table');
});

test('optimizer keeps fire safety distances, avoids overlaps and opens up the lawn', async () => {
  const { model, items } = sampleYard();
  for (const k of ['firepit', 'adirondack', 'adirondack', 'gardenbed', 'hammock']) add(items, k);
  const res = await optimize(model, items, { seed: 2, timeMs: 1200 });
  assert.ok(res.after.total < res.before.total);
  assert.ok(res.after.open.area > res.before.open.area);
  assert.equal(res.after.unreachable.length, 0);
  const fps = items.map((it, k) => (it.fixed ? null : footprint(it, res.placements[k].x, res.placements[k].z, res.placements[k].rot)));
  for (let a = 0; a < fps.length; a++)
    for (let b = a + 1; b < fps.length; b++)
      if (fps[a] && fps[b]) assert.ok(rectGap(fps[a], fps[b]) > 0 || overlapArea(fps[a], fps[b]) < 1e-6, `${items[a].name} overlaps ${items[b].name}`);
  const k = items.findIndex((i) => i.kind === 'firepit');
  const m = measure(res.site, items[k], res.placements[k], res.after.placed);
  assert.ok(m.houseGap >= 2.9, `fire pit only ${m.houseGap} m from the house`);
  assert.ok(m.tallGap >= 2.5, `fire pit only ${m.tallGap} m from a tree`);
  const notes = layoutNotes(res, items, 'imperial');
  assert.ok(notes.length >= 7);
  assert.ok(notes.find((n) => n.name === 'Fire pit').facts.some((f) => /10 ft/.test(f)));
});

test('locked and fixed pieces never move', async () => {
  const { model, items } = manualYard(10, 8, 'top');
  add(items, 'shed', 2, 6); items[0].locked = true;
  add(items, 'dining6', 5, 6);
  const res = await optimize(model, items, { seed: 1, timeMs: 400 });
  assert.deepEqual(res.placements[0], { x: 2, z: 6, rot: 0 });
});

test('summary for Claude mentions size and items', () => {
  const { model, items } = sampleYard();
  const text = claudeSummary({ model, items, units: 'imperial', openNow: null });
  assert.match(text, /52′ 6″ × 39′ 4″/);
  assert.match(text, /Shed/);
});

function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0 && d > 0 ? w * d : 0;
}
