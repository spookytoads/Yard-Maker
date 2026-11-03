// A built-in example yard so the planner opens in a working state before a scan is loaded.
// 16 m × 12 m with the house along the top, two trees, a shed, and a table and grill
// that are sitting in awkward spots.
import { finishModel } from './analyze.js';

export const SAMPLE = {
  width: 16, depth: 12, cell: 0.05,
  cutout: { x0: 12, z0: 9, x1: 16, z1: 12 },       // neighbour's garage corner
  trees: [
    { x: 3.4, z: 7.6, canopy: 2.7, trunk: 0.26, h: 7.5 },
    { x: 13.2, z: 3.6, canopy: 2.1, trunk: 0.23, h: 6.0 },
  ],
  shed: { x: 1.6, z: 10.5, w: 2.4, d: 1.8, h: 2.3 },
  table: { x: 8.4, z: 6.2, w: 1.6, d: 1.0, h: 0.75 },
  grill: { x: 6.0, z: 0.75, w: 1.4, d: 0.6, h: 1.1 },
};

export function sampleYard() {
  const S = SAMPLE;
  const cell = S.cell;
  const cols = Math.round(S.width / cell), rows = Math.round(S.depth / cell);
  const n = cols * rows;
  const covered = new Uint8Array(n), heightTop = new Float32Array(n), canopy = new Uint8Array(n);
  const ground = new Float32Array(n), obstacle = new Uint8Array(n);
  const inRect = (x, z, r) => x >= r.x - r.w / 2 && x < r.x + r.w / 2 && z >= r.z - r.d / 2 && z < r.z + r.d / 2;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, x = (i + 0.5) * cell, z = (j + 0.5) * cell;
      const c = S.cutout;
      // gentle fall away from the house plus a low mound in the back
      ground[k] = -0.03 * z + 0.25 * Math.exp(-((x - 6) ** 2 + (z - 10.5) ** 2) / 3);
      if (x >= c.x0 && z >= c.z0) continue;
      covered[k] = 1;
      for (const t of S.trees) {
        const d = Math.hypot(x - t.x, z - t.z);
        const wob = 1 + 0.08 * Math.sin(Math.atan2(z - t.z, x - t.x) * 5);
        if (d < t.canopy * wob) { canopy[k] = 1; heightTop[k] = t.h - d * 0.8; }
        if (d < t.trunk) { obstacle[k] = 1; canopy[k] = 0; heightTop[k] = t.h; }
      }
      for (const [r, h] of [[S.shed, S.shed.h], [S.table, S.table.h], [S.grill, S.grill.h]])
        if (inRect(x, z, r)) { obstacle[k] = 1; canopy[k] = 0; heightTop[k] = h; }
    }
  const slope = new Float32Array(n);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const gx = i > 0 && i < cols - 1 ? (ground[k + 1] - ground[k - 1]) / (2 * cell) : 0;
      const gz = j > 0 && j < rows - 1 ? (ground[k + cols] - ground[k - cols]) / (2 * cell) : 0;
      slope[k] = Math.hypot(gx, gz);
    }
  const model = {
    source: 'sample', name: 'Sample yard', cols, rows, cell, origin: { x: 0, z: 0 },
    ground, covered, heightTop, canopy, slope, ortho: null, houseSide: 'top',
  };
  const res = finishModel(model, obstacle);
  for (const it of res.items) {
    if (it.scanType === 'structure') { it.name = 'Shed'; it.scanType = 'shed'; }
    if (it.scanType === 'table') it.name = 'Patio table';
    if (it.scanType === 'grill') it.name = 'Grill';
  }
  return res;
}

/** Paint a stylised aerial photo for the sample yard. Browser only. */
export function drawSampleOrtho(model, scale = 3) {
  const S = SAMPLE;
  const ppm = scale / model.cell; // pixels per meter
  const cv = document.createElement('canvas');
  cv.width = Math.round(S.width * ppm);
  cv.height = Math.round(S.depth * ppm);
  const g = cv.getContext('2d');
  const rnd = mulberry(7);
  // lawn
  g.fillStyle = '#6f9a4a';
  g.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * cv.width, y = rnd() * cv.height;
    g.fillStyle = rnd() < 0.5 ? 'rgba(40,70,20,0.18)' : 'rgba(170,200,110,0.16)';
    g.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  // mowing stripes
  for (let x = 0; x < S.width; x += 1.2) {
    g.fillStyle = (x / 1.2) % 2 < 1 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    g.fillRect(x * ppm, 0, 1.2 * ppm, cv.height);
  }
  // paver patio by the house
  g.fillStyle = '#b9ad9c';
  g.fillRect(4 * ppm, 0, 7 * ppm, 2.4 * ppm);
  g.strokeStyle = 'rgba(90,80,70,0.35)';
  g.lineWidth = 1;
  for (let x = 4; x <= 11; x += 0.6) { g.beginPath(); g.moveTo(x * ppm, 0); g.lineTo(x * ppm, 2.4 * ppm); g.stroke(); }
  for (let z = 0; z <= 2.4; z += 0.3) { g.beginPath(); g.moveTo(4 * ppm, z * ppm); g.lineTo(11 * ppm, z * ppm); g.stroke(); }
  // stepping stones toward the shed
  g.fillStyle = '#a59c8e';
  for (let t = 0; t < 7; t++) {
    const x = 4.2 - t * 0.35, z = 2.9 + t * 1.05;
    g.beginPath(); g.ellipse(x * ppm, z * ppm, 0.28 * ppm, 0.22 * ppm, 0.3, 0, Math.PI * 2); g.fill();
  }
  // mulch bed around the shed
  g.fillStyle = '#6b4a32';
  g.fillRect(0, 9.2 * ppm, 3.4 * ppm, 2.8 * ppm);
  // neighbour's garage corner (outside the yard)
  const c = S.cutout;
  g.fillStyle = '#8e8c88';
  g.fillRect(c.x0 * ppm, c.z0 * ppm, (c.x1 - c.x0) * ppm, (c.z1 - c.z0) * ppm);
  // shed roof
  const sh = S.shed;
  g.fillStyle = '#5d5f63';
  g.fillRect((sh.x - sh.w / 2) * ppm, (sh.z - sh.d / 2) * ppm, sh.w * ppm, sh.d * ppm);
  g.strokeStyle = '#3d3f43'; g.lineWidth = 2;
  g.beginPath(); g.moveTo((sh.x - sh.w / 2) * ppm, sh.z * ppm); g.lineTo((sh.x + sh.w / 2) * ppm, sh.z * ppm); g.stroke();
  // table and grill
  const tb = S.table;
  g.fillStyle = '#8a6440';
  g.fillRect((tb.x - tb.w / 2) * ppm, (tb.z - tb.d / 2) * ppm, tb.w * ppm, tb.d * ppm);
  g.strokeStyle = 'rgba(60,40,20,0.6)';
  for (let x = tb.x - tb.w / 2 + 0.15; x < tb.x + tb.w / 2; x += 0.15) {
    g.beginPath(); g.moveTo(x * ppm, (tb.z - tb.d / 2) * ppm); g.lineTo(x * ppm, (tb.z + tb.d / 2) * ppm); g.stroke();
  }
  const gr = S.grill;
  g.fillStyle = '#26282b';
  g.fillRect((gr.x - gr.w / 2) * ppm, (gr.z - gr.d / 2) * ppm, gr.w * ppm, gr.d * ppm);
  // tree canopies
  for (const t of S.trees) {
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * t.canopy * 0.75;
      const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      const rr = t.canopy * (0.3 + rnd() * 0.25);
      const grd = g.createRadialGradient(x * ppm, z * ppm, 0, x * ppm, z * ppm, rr * ppm);
      grd.addColorStop(0, 'rgba(70,110,45,0.95)');
      grd.addColorStop(1, 'rgba(30,62,28,0.0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x * ppm, z * ppm, rr * ppm, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(25,50,22,0.55)';
    g.beginPath(); g.arc(t.x * ppm, t.z * ppm, t.canopy * 0.55 * ppm, 0, Math.PI * 2); g.fill();
  }
  return cv.toDataURL('image/jpeg', 0.85);
}

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
