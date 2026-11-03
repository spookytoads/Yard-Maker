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

test('importer reads common size formats', async () => {
  const { parseProduct } = await import('../js/importer.js');
  const inch = (m) => Math.round(m / 0.0254 * 10) / 10;
  const r1 = parseProduct('72"W x 40"D x 30"H');
  assert.deepEqual([inch(r1.w), inch(r1.d), inch(r1.h)], [72, 40, 30]);
  const r2 = parseProduct('Overall: 84.25" L x 40" W x 29.5" H\nPackage dimensions: 50 x 30 x 12 in');
  assert.deepEqual([inch(r2.w), inch(r2.d), inch(r2.h)], [84.3, 40, 29.5]);
  const r3 = parseProduct('Fire pit, 32 in. diameter x 24 in. H');
  assert.ok(r3.round && inch(r3.w) === 32 && r3.kind === 'firepit');
  const r4 = parseProduct('Patio Set\nProduct Width (in.) 84 in\nProduct Depth (in.)\n42 in\nAssembled Height (in.): 30 in');
  assert.deepEqual([inch(r4.w), inch(r4.d), inch(r4.h)], [84, 42, 30]);
  const r5 = parseProduct('183 x 102 x 76 cm');
  assert.ok(Math.abs(r5.w - 1.83) < 1e-6 && Math.abs(r5.d - 1.02) < 1e-6);
  const r6 = parseProduct('https://example.com/p/acme-6-person-teak-dining-set-w123456789.html');
  assert.equal(r6.ok, false);
  assert.equal(r6.kind, 'dining6');
  assert.match(r6.name, /Acme 6 Person Teak Dining Set/);
});

test('mark, split and merge scanned items', async () => {
  const { markRegion, mergeItems, nearbyScanned } = await import('../js/analyze.js');
  const { model, items } = sampleYard();
  const shed = items.find((i) => i.name === 'Shed');
  const cellsBefore = shed.cells.length;
  // a box on open lawn: nothing stands there, so the box itself becomes the item
  const lawn = markRegion(model, items, { x0: 8, z0: 9, x1: 9.5, z1: 9.6 });
  assert.ok(lawn.flat && Math.abs(lawn.item.w - 1.5) < 0.06 && Math.abs(lawn.item.d - 0.6) < 0.06);
  assert.equal(lawn.item.h, 0.5);
  // a box over the left half of the shed splits it
  const half = markRegion(model, items, { x0: 0, z0: 9, x1: 1.6, z1: 12 });
  assert.deepEqual(half.touched, [shed.id]);
  assert.ok(half.item.fixed, 'a piece split from a fixed shed stays fixed');
  assert.ok(Math.abs(half.item.h - 2.3) < 0.01);
  assert.equal(shed.cells.length + half.item.cells.length, cellsBefore);
  assert.ok(Math.abs(shed.w - 1.2) < 0.06);
  // and merging puts it back
  items.push(half.item);
  assert.equal(nearbyScanned(items, shed)[0].item, half.item);
  mergeItems(model, shed, half.item);
  assert.equal(shed.cells.length, cellsBefore);
  assert.ok(Math.abs(shed.w - 2.4) < 0.06 && Math.abs(shed.x - 1.6) < 0.06);
});

test('identify prompt and reply parsing', async () => {
  const { identifyPrompt, readGuess } = await import('../js/identify.js');
  const p = identifyPrompt([{ w: 1.4, d: 0.6, h: 1.1, shade: false, edge: false, guess: 'Grill?' }]);
  assert.match(p, /Image 1: footprint 1\.40 m × 0\.60 m, top 1\.10 m/);
  assert.match(p, /grill \(Grill\)/);
  assert.deepEqual(readGuess({ type: 'grill', name: 'Gas grill', confidence: 'high', reason: 'x' }), { type: 'grill', name: 'Gas grill', confidence: 'high', reason: 'x' });
  assert.equal(readGuess({ type: 'spaceship', confidence: 'sure' }).type, 'scanned');
  assert.equal(readGuess({ type: 'tree', confidence: 'sure' }).confidence, 'low');
});
