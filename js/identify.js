// "Identify with Claude": send Claude a top-down crop of the aerial view around each
// scanned item, with its measured size and height, and get back a suggested type.
import { typeGroups, CATALOG_BY_KIND, FEATURE_BY_KIND } from './catalog.js';

const OUTLINE = '#ff2d78';
let orthoCache = { url: null, img: null };

function loadOrtho(url) {
  if (orthoCache.url === url && orthoCache.img) return Promise.resolve(orthoCache.img);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { orthoCache = { url, img }; resolve(img); };
    img.onerror = () => reject(new Error('The aerial view could not be read.'));
    img.src = url;
  });
}

/** The item's box where the scan saw it (not where it may have been dragged to). */
function scannedBox(it) {
  const x = it.home?.x ?? it.x, z = it.home?.z ?? it.z;
  return { x0: x - it.w / 2, x1: x + it.w / 2, z0: z - it.d / 2, z1: z + it.d / 2 };
}

/** A JPEG crop of the aerial view around the item, outlined, with a 1 m scale bar. */
export async function cropItem(model, it, maxSide = 512) {
  const img = await loadOrtho(model.ortho);
  const W = model.cols * model.cell, D = model.rows * model.cell;
  const ppm = img.width / W; // image pixels per meter
  const b = scannedBox(it);
  const margin = Math.max(1, 0.7 * Math.max(it.w, it.d));
  const x0 = Math.max(0, b.x0 - margin), x1 = Math.min(W, b.x1 + margin);
  const z0 = Math.max(0, b.z0 - margin), z1 = Math.min(D, b.z1 + margin);
  const sw = (x1 - x0) * ppm, sh = (z1 - z0) * ppm;
  const scale = Math.max(256 / Math.max(sw, sh), Math.min(4, maxSide / Math.max(sw, sh)));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * scale));
  cv.height = Math.max(1, Math.round(sh * scale));
  const g = cv.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, cv.width, cv.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, x0 * ppm, z0 * ppm, sw, sh, 0, 0, cv.width, cv.height);
  const k = ppm * scale; // canvas pixels per meter
  g.strokeStyle = OUTLINE;
  g.lineWidth = Math.max(2, cv.width / 170);
  const pad = g.lineWidth * 1.5;
  g.strokeRect((b.x0 - x0) * k - pad, (b.z0 - z0) * k - pad, it.w * k + 2 * pad, it.d * k + 2 * pad);
  // 1 m scale bar
  const bar = k, y = cv.height - 14;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(6, y - 14, bar + 40, 22);
  g.fillStyle = '#111';
  g.fillRect(10, y, bar, 4);
  g.font = '12px sans-serif';
  g.fillText('1 m', 14 + bar, y + 5);
  return new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.9));
}

const typeList = () => typeGroups().flatMap((gr) => gr.items.map((c) => `${c.kind} (${c.name})`)).join(', ');

/** Prompt for one call covering `entries` (one image each, in order). */
export function identifyPrompt(entries) {
  const lines = entries.map((e, n) =>
    `Image ${n + 1}: footprint ${e.w.toFixed(2)} m × ${e.d.toFixed(2)} m, top ${e.h.toFixed(2)} m above the ground${e.shade ? ', under tree canopy' : ''}${e.edge ? ', at the edge of the yard' : ''}. The app guessed "${e.guess}".`);
  return [
    'These images are top-down views of a backyard, rendered from a 3D phone scan (Polycam) looking straight down.',
    'In each image, the thing to identify is inside the pink box. The 1 m bar shows the scale. Scans can be blurry, so use the measured size and height as well as the picture.',
    '',
    ...lines,
    '',
    `For each image choose the most likely type from this list (use "scanned" when it is none of them): ${typeList()}.`,
    'Reply with only a JSON array with one object per image, in order, like:',
    '[{"image": 1, "type": "grill", "name": "Grill", "confidence": "high", "reason": "Dark box about grill height with a lid outline."}]',
    'confidence is "high", "medium" or "low"; name is a short label for the plan; reason is one short sentence.',
  ].join('\n');
}

/** Clean up one guess from Claude's reply. */
export function readGuess(g) {
  if (!g || typeof g !== 'object') return null;
  const type = CATALOG_BY_KIND[g.type] || FEATURE_BY_KIND[g.type] ? g.type : 'scanned';
  const confidence = ['high', 'medium', 'low'].includes(g.confidence) ? g.confidence : 'low';
  return {
    type,
    name: String(g.name || '').trim().slice(0, 40),
    confidence,
    reason: String(g.reason || '').trim().slice(0, 200),
  };
}
