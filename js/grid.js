// Raster helpers shared by the scan analysis and the layout optimizer.
// A grid is row-major: index = row * cols + col. Rows run along +z, cols along +x.

/** Summed-area table for O(1) rectangle sums. */
export class SAT {
  constructor(values, cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const W = cols + 1;
    const sat = new Float64Array(W * (rows + 1));
    for (let j = 0; j < rows; j++) {
      let run = 0;
      for (let i = 0; i < cols; i++) {
        run += values[j * cols + i];
        sat[(j + 1) * W + i + 1] = sat[j * W + i + 1] + run;
      }
    }
    this.sat = sat;
  }
  /** Sum over cols [i0, i1) and rows [j0, j1), clamped to the grid. */
  sum(i0, j0, i1, j1) {
    const { cols, rows, sat } = this;
    i0 = Math.max(0, Math.min(cols, i0));
    i1 = Math.max(0, Math.min(cols, i1));
    j0 = Math.max(0, Math.min(rows, j0));
    j1 = Math.max(0, Math.min(rows, j1));
    if (i1 <= i0 || j1 <= j0) return 0;
    const W = cols + 1;
    return sat[j1 * W + i1] - sat[j0 * W + i1] - sat[j1 * W + i0] + sat[j0 * W + i0];
  }
}

/** Box dilation of a 0/1 mask by a square of radius r cells. */
export function dilate(mask, cols, rows, r) {
  if (r <= 0) return Uint8Array.from(mask);
  const s = new SAT(mask, cols, rows);
  const out = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      out[j * cols + i] = s.sum(i - r, j - r, i + r + 1, j + r + 1) > 0 ? 1 : 0;
  return out;
}

/** Box erosion; cells outside the grid count as `outside` (0 or 1). */
export function erode(mask, cols, rows, r, outside = 0) {
  if (r <= 0) return Uint8Array.from(mask);
  const s = new SAT(mask, cols, rows);
  const out = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const i0 = i - r, j0 = j - r, i1 = i + r + 1, j1 = j + r + 1;
      const full = (i1 - i0) * (j1 - j0);
      let inside = s.sum(i0, j0, i1, j1);
      if (outside) {
        const ci = Math.min(cols, i1) - Math.max(0, i0);
        const cj = Math.min(rows, j1) - Math.max(0, j0);
        inside += full - ci * cj;
      }
      out[j * cols + i] = inside >= full ? 1 : 0;
    }
  return out;
}

/** Connected components of cells where mask[i] is truthy. Returns { labels, count, sizes }. */
export function components(mask, cols, rows, eight = true) {
  const labels = new Int32Array(cols * rows).fill(-1);
  const sizes = [];
  const stack = new Int32Array(cols * rows);
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    let sp = 0, size = 0;
    stack[sp++] = start;
    labels[start] = count;
    while (sp) {
      const c = stack[--sp];
      size++;
      const ci = c % cols, cj = (c - ci) / cols;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          if (!eight && di && dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const n = nj * cols + ni;
          if (mask[n] && labels[n] === -1) {
            labels[n] = count;
            stack[sp++] = n;
          }
        }
    }
    sizes.push(size);
    count++;
  }
  return { labels, count, sizes };
}

/** 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let p = v[k];
    let s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    while (s <= z[k]) {
      k--;
      p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Exact Euclidean distance (in cells) from every cell to the nearest source cell. */
export function distanceField(sources, cols, rows) {
  const INF = 1e12;
  const g = new Float64Array(cols * rows);
  for (let i = 0; i < g.length; i++) g[i] = sources[i] ? 0 : INF;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) f[j] = g[j * cols + i];
    edt1d(f, rows, d, v, z);
    for (let j = 0; j < rows; j++) g[j * cols + i] = d[j];
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) f[i] = g[j * cols + i];
    edt1d(f, cols, d, v, z);
    for (let i = 0; i < cols; i++) g[j * cols + i] = d[i];
  }
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = g[i] >= INF / 2 ? Infinity : Math.sqrt(g[i]);
  return out;
}

/**
 * Largest axis-aligned rectangle of truthy cells. Returns { area, i, j, w, h } in cells.
 * `score(w, h)` ranks candidates (default: area). Every maximal rectangle is visited.
 */
export function largestRect(free, cols, rows, score = (w, h) => w * h) {
  const heights = new Int32Array(cols);
  const stack = new Int32Array(cols + 1);
  let best = { area: 0, score: 0, i: 0, j: 0, w: 0, h: 0 };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) heights[i] = free[j * cols + i] ? heights[i] + 1 : 0;
    let sp = 0;
    for (let i = 0; i <= cols; i++) {
      const h = i < cols ? heights[i] : 0;
      while (sp && heights[stack[sp - 1]] >= h) {
        const top = stack[--sp];
        const height = heights[top];
        const left = sp ? stack[sp - 1] + 1 : 0;
        const width = i - left;
        const sc = score(width, height);
        if (sc > best.score) best = { area: width * height, score: sc, i: left, j: j - height + 1, w: width, h: height };
      }
      stack[sp++] = i;
    }
  }
  return best;
}

/** Fill enclosed holes (0-regions not touching the border) whose size passes `accept(cells)`. */
export function fillHoles(mask, cols, rows, accept) {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { labels, count } = components(inv, cols, rows, false);
  const touches = new Uint8Array(count);
  const cells = Array.from({ length: count }, () => []);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const l = labels[j * cols + i];
      if (l < 0) continue;
      cells[l].push(j * cols + i);
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) touches[l] = 1;
    }
  const out = Uint8Array.from(mask);
  for (let l = 0; l < count; l++) {
    if (touches[l]) continue;
    if (accept(cells[l])) for (const c of cells[l]) out[c] = 1;
  }
  return out;
}

/** Box blur of values where valid, radius r cells. Invalid cells keep NaN. */
export function boxBlur(values, valid, cols, rows, r) {
  const v = new Float32Array(values.length);
  const w = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) if (valid[i]) { v[i] = values[i]; w[i] = 1; }
  const sv = new SAT(v, cols, rows), sw = new SAT(w, cols, rows);
  const out = new Float32Array(values.length);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!valid[k]) { out[k] = NaN; continue; }
      const n = sw.sum(i - r, j - r, i + r + 1, j + r + 1);
      out[k] = sv.sum(i - r, j - r, i + r + 1, j + r + 1) / n;
    }
  return out;
}

/** Fill missing values by a coarse-to-fine pyramid (push-pull). */
export function fillMissing(values, valid, cols, rows) {
  let any = false, all = true;
  for (let i = 0; i < valid.length; i++) { if (valid[i]) any = true; else all = false; }
  if (all || !any) return Float32Array.from(values);
  const cc = Math.ceil(cols / 2), cr = Math.ceil(rows / 2);
  const cv = new Float32Array(cc * cr), cm = new Uint8Array(cc * cr);
  for (let j = 0; j < cr; j++)
    for (let i = 0; i < cc; i++) {
      let s = 0, n = 0;
      for (let dj = 0; dj < 2; dj++)
        for (let di = 0; di < 2; di++) {
          const x = 2 * i + di, y = 2 * j + dj;
          if (x >= cols || y >= rows) continue;
          const k = y * cols + x;
          if (valid[k]) { s += values[k]; n++; }
        }
      if (n) { cv[j * cc + i] = s / n; cm[j * cc + i] = 1; }
    }
  const coarse = fillMissing(cv, cm, cc, cr);
  const out = Float32Array.from(values);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!valid[k]) out[k] = coarse[(j >> 1) * cc + (i >> 1)];
    }
  return out;
}

/** Sliding-window minimum over valid cells (square radius r). Invalid cells → +Infinity. */
export function minFilter(values, valid, cols, rows, r) {
  const tmp = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      let m = Infinity;
      for (let x = Math.max(0, i - r), e = Math.min(cols - 1, i + r); x <= e; x++) {
        const k = j * cols + x;
        if (valid[k] && values[k] < m) m = values[k];
      }
      tmp[j * cols + i] = m;
    }
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      let m = Infinity;
      for (let y = Math.max(0, j - r), e = Math.min(rows - 1, j + r); y <= e; y++) {
        const v = tmp[y * cols + i];
        if (v < m) m = v;
      }
      out[j * cols + i] = m;
    }
  return out;
}
