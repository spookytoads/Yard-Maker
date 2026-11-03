import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceField, largestRect, components, fillHoles, SAT } from '../js/grid.js';

test('distanceField is exact Euclidean distance', () => {
  const cols = 9, rows = 7, src = new Uint8Array(cols * rows);
  src[3 * cols + 4] = 1;
  const d = distanceField(src, cols, rows);
  assert.equal(d[3 * cols + 4], 0);
  assert.ok(Math.abs(d[0] - Math.hypot(4, 3)) < 1e-6);
  assert.ok(Math.abs(d[6 * cols + 8] - Math.hypot(4, 3)) < 1e-6);
});

test('largestRect finds the biggest empty rectangle', () => {
  const cols = 6, rows = 5, free = new Uint8Array(cols * rows).fill(1);
  free[2 * cols + 2] = 0; // one blocked cell in the middle
  const r = largestRect(free, cols, rows);
  assert.equal(r.area, 15); // the 3 x 5 block right of the blocked cell
});

test('components and fillHoles', () => {
  const cols = 5, rows = 5, m = new Uint8Array(cols * rows);
  for (let i = 1; i < 4; i++) { m[1 * cols + i] = 1; m[3 * cols + i] = 1; m[i * cols + 1] = 1; m[i * cols + 3] = 1; }
  assert.equal(components(m, cols, rows).count, 1);
  const f = fillHoles(m, cols, rows, () => true);
  assert.equal(f[2 * cols + 2], 1);
});

test('SAT sums clamp to the grid', () => {
  const s = new SAT(new Uint8Array(12).fill(1), 4, 3);
  assert.equal(s.sum(-5, -5, 50, 50), 12);
  assert.equal(s.sum(1, 1, 3, 2), 2);
});
