// How pieces look: built-in finish textures (painted on canvas), your own photos, and
// simple 3D models built from primitives for each kind of furniture.

export const FINISHES = {
  wood:   { label: 'Wood',          base: '#a8794d', grain: '#7a5432' },
  teak:   { label: 'Teak',          base: '#b98a56', grain: '#8a5f34' },
  wicker: { label: 'Wicker',        base: '#9c7a55', grain: '#5e4630' },
  metal:  { label: 'Black metal',   base: '#2c2f33', grain: '#45494f' },
  stone:  { label: 'Stone',         base: '#9d968c', grain: '#6f6a63' },
  fabric: { label: 'Cushion fabric', base: '#cfc6b6', grain: '#b3a993' },
};

const AUTO = {
  fence: 'wood', deck: 'wood', wall: 'stone', boulder: 'stone',
  dining6: 'teak', bistro: 'metal', sofa: 'wicker', chaise: 'wicker', adirondack: 'wood', hammock: 'fabric',
  bench: 'teak', firepit: 'stone', grill: 'metal', hottub: 'wood', playset: 'wood', trampoline: 'metal',
  sandbox: 'wood', cornhole: 'wood', gardenbed: 'wood', planter: 'stone', shed: 'wood',
};

export function finishOf(it) {
  if (it.finish && it.finish !== 'auto') return it.finish === 'custom' && !it.texture ? AUTO[it.kind] || 'wood' : it.finish;
  return AUTO[it.kind] || null;
}

const finishCache = new Map();
/** A 256 px tileable canvas for a built-in finish. */
export function finishCanvas(name) {
  if (finishCache.has(name)) return finishCache.get(name);
  const f = FINISHES[name];
  if (!f) return null;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = f.base;
  g.fillRect(0, 0, S, S);
  const rnd = seeded(name.length * 97 + 13);
  if (name === 'wood' || name === 'teak') {
    // planks with grain
    const plank = S / 4;
    for (let p = 0; p < 4; p++) {
      g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.08})`;
      g.fillRect(0, p * plank, S, plank);
      g.strokeStyle = f.grain;
      for (let l = 0; l < 14; l++) {
        g.globalAlpha = 0.25 + rnd() * 0.35;
        g.lineWidth = 0.6 + rnd() * 1.2;
        const y = p * plank + rnd() * plank;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x / 40 + l) * 1.5 + (rnd() - 0.5));
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, p * plank, S, 2);
    }
  } else if (name === 'wicker') {
    const n = 16, c = S / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const horiz = (i + j) % 2 === 0;
        const grd = horiz ? g.createLinearGradient(0, j * c, 0, j * c + c) : g.createLinearGradient(i * c, 0, i * c + c, 0);
        grd.addColorStop(0, f.grain); grd.addColorStop(0.5, f.base); grd.addColorStop(1, f.grain);
        g.fillStyle = grd;
        g.fillRect(i * c + 0.5, j * c + 0.5, c - 1, c - 1);
      }
  } else if (name === 'metal') {
    for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`; g.fillRect(0, y, S, 1); }
    g.strokeStyle = f.grain; g.lineWidth = 3;
    for (let x = 16; x < S; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  } else if (name === 'stone') {
    const rows = 4, h = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -h * 0.6 : 0;
      while (x < S) {
        const w = h * (1 + rnd() * 0.8);
        const t = 0.85 + rnd() * 0.3;
        g.fillStyle = shade(f.base, t);
        g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; g.fillRect(x + rnd() * w, r * h + rnd() * h, 2, 2); }
        x += w;
      }
    }
  } else if (name === 'fabric') {
    for (let y = 0; y < S; y += 3) { g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`; g.fillRect(0, y, S, 1); }
    for (let x = 0; x < S; x += 3) { g.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.04})`; g.fillRect(x, 0, 1, S); }
  }
  finishCache.set(name, cv);
  return cv;
}

const imgCache = new Map();
/** Cached <img> for a data URL; calls onReady once it has loaded. */
export function getImage(url, onReady) {
  if (!url) return null;
  let rec = imgCache.get(url);
  if (!rec) {
    const img = new Image();
    rec = { img, ready: false, waiters: [] };
    img.onload = () => { rec.ready = true; rec.waiters.splice(0).forEach((f) => f()); };
    img.src = url;
    imgCache.set(url, rec);
  }
  if (rec.ready) return rec.img;
  if (onReady) rec.waiters.push(onReady);
  return null;
}

/** The image to tile on a piece: your texture photo, else its finish. */
export function textureFor(it, onReady) {
  if (it.finish === 'custom' && it.texture) return getImage(it.texture, onReady);
  const f = finishOf(it);
  return f ? finishCanvas(f) : null;
}

/** Shrink a picked image file to a JPEG data URL (keeps saved projects small). */
export function fileToDataURL(file, max = 640) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('That file is not an image.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * s));
      cv.height = Math.max(1, Math.round(img.height * s));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

function shade(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * t)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function seeded(s) {
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---------------------------------------------------------------- 3D models

/**
 * Build a model for a piece, centered at the origin on the ground, sized w × d (x × z).
 * `mats` = { main, metal, fabric, stone, dark, water, sand, soil, leaf, flame }.
 */
export function buildModel(THREE, it, mats, accent) {
  const g = new THREE.Group();
  const w = it.w, d = it.d, h = it.h || 0.8;
  const box = (bw, bh, bd, x, y, z, m = mats.main) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const cyl = (rt, rb, ch, x, y, z, m = mats.main, seg = 24) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, ch, seg), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const chair = (x, z, face, m = mats.main) => {
    const c = new THREE.Group();
    const s = 0.46;
    const add = (bw, bh, bd, px, py, pz) => { const mm = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m); mm.position.set(px, py, pz); c.add(mm); };
    add(s, 0.05, s, 0, 0.45, 0);
    add(s, 0.45, 0.05, 0, 0.7, -s / 2);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(0.04, 0.45, 0.04, lx * (s / 2 - 0.03), 0.225, lz * (s / 2 - 0.03));
    c.position.set(x, 0, z);
    c.rotation.y = face;
    g.add(c);
  };
  switch (it.kind) {
    case 'dining6': {
      const tw = w - 0.75, td = d - 0.75;
      box(tw, 0.05, td, 0, 0.74, 0);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.06, 0.72, 0.06, lx * (tw / 2 - 0.08), 0.36, lz * (td / 2 - 0.08));
      for (const sx of [-0.25, 0.25]) for (const sz of [-1, 1]) chair(sx * tw * 1.3, sz * (td / 2 + 0.22), sz < 0 ? 0 : Math.PI);
      chair(-(tw / 2 + 0.22), 0, Math.PI / 2); chair(tw / 2 + 0.22, 0, -Math.PI / 2);
      break;
    }
    case 'bistro': {
      cyl(0.32, 0.32, 0.04, 0, 0.74, 0);
      cyl(0.03, 0.03, 0.72, 0, 0.36, 0, mats.metal);
      cyl(0.22, 0.22, 0.03, 0, 0.015, 0, mats.metal);
      chair(0, -(d / 2 - 0.25), 0, mats.metal); chair(0, d / 2 - 0.25, Math.PI, mats.metal);
      break;
    }
    case 'sofa': {
      box(w, 0.42, 0.8, 0, 0.21, -d / 2 + 0.4);
      box(w, 0.42, 0.18, 0, 0.6, -d / 2 + 0.09);
      box(w - 0.2, 0.12, 0.6, 0, 0.48, -d / 2 + 0.45, mats.fabric);
      for (const s of [-1, 1]) {
        box(0.8, 0.42, 0.8, s * (w / 2 - 0.4), 0.21, d / 2 - 0.5);
        box(0.8, 0.12, 0.6, s * (w / 2 - 0.4), 0.48, d / 2 - 0.45, mats.fabric);
      }
      box(0.9, 0.4, 0.6, 0, 0.2, 0.15, mats.dark);
      break;
    }
    case 'chaise': {
      box(w, 0.3, d * 0.7, 0, 0.15, d * 0.15);
      box(w * 0.94, 0.08, d * 0.66, 0, 0.34, d * 0.15, mats.fabric);
      const back = box(w, 0.08, d * 0.36, 0, 0.5, -d * 0.32, mats.fabric);
      back.rotation.x = -0.75;
      break;
    }
    case 'adirondack': {
      const seat = box(w * 0.7, 0.05, d * 0.6, 0, 0.36, 0.05);
      seat.rotation.x = 0.12;
      const back = box(w * 0.7, h * 0.75, 0.05, 0, 0.62, -d * 0.32);
      back.rotation.x = -0.32;
      for (const s of [-1, 1]) {
        box(0.12, 0.03, d * 0.75, s * (w / 2 - 0.06), 0.6, 0.02);
        box(0.05, 0.6, 0.05, s * (w / 2 - 0.06), 0.3, d * 0.33);
        box(0.05, 0.4, 0.05, s * (w / 2 - 0.12), 0.2, -d * 0.2);
      }
      break;
    }
    case 'hammock': {
      // arched steel stand with a fabric bed slung between the ends
      const span = w * 0.92;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(span / 2, 0.04, 8, 32, Math.PI), mats.metal);
      arc.scale.y = 1.15 / (span / 2);
      g.add(arc);
      for (const s of [-1, 1]) box(0.08, 0.05, d * 0.8, s * (span / 2), 0.025, 0, mats.metal);
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, x = (t - 0.5) * span * 0.8;
        pts.push(new THREE.Vector3(x, 1.0 - 0.45 * Math.sin(Math.PI * t), 0));
      }
      const bed = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.32, 10), mats.fabric);
      bed.scale.z = 1.4;
      g.add(bed);
      break;
    }
    case 'bench': {
      box(w, 0.05, d * 0.7, 0, 0.45, d * 0.1);
      box(w, 0.4, 0.05, 0, 0.72, -d / 2 + 0.05);
      for (const s of [-1, 1]) box(0.06, 0.45, d * 0.8, s * (w / 2 - 0.05), 0.225, 0, mats.metal);
      break;
    }
    case 'firepit': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w / 2 - 0.12, 0.13, 10, 28), mats.stone);
      ring.rotation.x = Math.PI / 2;
      ring.scale.z = 2.2;
      ring.position.y = 0.2;
      g.add(ring);
      cyl(w / 2 - 0.2, w / 2 - 0.2, 0.05, 0, 0.05, 0, mats.dark);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 10), mats.flame);
      flame.position.y = 0.4;
      g.add(flame);
      break;
    }
    case 'grill': {
      const bw = w * 0.55;
      box(bw, 0.35, d * 0.9, 0, 0.75, 0, mats.metal);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.45, d * 0.45, bw, 20, 1, false, 0, Math.PI), mats.metal);
      lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2; lid.rotation.x = Math.PI / 2;
      lid.position.y = 0.92;
      g.add(lid);
      for (const s of [-1, 1]) box((w - bw) / 2, 0.03, d * 0.8, s * (bw / 2 + (w - bw) / 4), 0.85, 0, mats.main);
      box(bw, 0.5, d * 0.8, 0, 0.3, 0, mats.dark);
      break;
    }
    case 'hottub': {
      box(w, h, d, 0, h / 2, 0);
      box(w - 0.24, 0.02, d - 0.24, 0, h - 0.06, 0, mats.water);
      break;
    }
    case 'playset': {
      const bh = 2.3, legSpread = d * 0.32;
      box(w * 0.65, 0.1, 0.1, -w * 0.15, bh, 0);
      for (const sx of [-w * 0.47, w * 0.17])
        for (const sz of [-1, 1]) {
          const leg = box(0.08, bh * 1.04, 0.08, sx, bh / 2, sz * legSpread / 2);
          leg.rotation.x = sz * 0.24;
        }
      for (const sx of [-w * 0.32, -w * 0.02]) {
        for (const rz of [-0.2, 0.2]) box(0.015, 1.8, 0.015, sx + rz, bh - 0.9, 0, mats.dark);
        box(0.5, 0.04, 0.2, sx, 0.45, 0, mats.dark);
      }
      box(1.2, 0.08, 1.2, w / 2 - 0.65, 1.4, -d * 0.1);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.08, 1.4, 0.08, w / 2 - 0.65 + lx * 0.56, 0.7, -d * 0.1 + lz * 0.56);
      const slide = box(0.5, 0.04, 2.0, w / 2 - 0.65, 0.75, d * 0.38, mats.water);
      slide.rotation.x = 0.7;
      break;
    }
    case 'trampoline': {
      const r = Math.min(w, d) / 2;
      const frame = new THREE.Mesh(new THREE.TorusGeometry(r - 0.05, 0.04, 8, 40), mats.metal);
      frame.rotation.x = Math.PI / 2; frame.position.y = 0.9;
      g.add(frame);
      cyl(r - 0.15, r - 0.15, 0.02, 0, 0.89, 0, mats.dark, 40);
      for (let a = 0; a < 6; a++) box(0.05, 0.9, 0.05, Math.cos(a) * (r - 0.05), 0.45, Math.sin(a) * (r - 0.05), mats.metal);
      break;
    }
    case 'sandbox': {
      for (const s of [-1, 1]) { box(w, 0.3, 0.08, 0, 0.15, s * (d / 2 - 0.04)); box(0.08, 0.3, d, s * (w / 2 - 0.04), 0.15, 0); }
      box(w - 0.16, 0.2, d - 0.16, 0, 0.1, 0, mats.sand);
      break;
    }
    case 'cornhole': {
      for (const s of [-1, 1]) {
        const b = box(0.6, 0.03, 1.2, 0, 0.18, s * (d / 2 - 0.6));
        b.rotation.x = s * 0.25;
      }
      break;
    }
    case 'gardenbed': {
      for (const s of [-1, 1]) { box(w, h, 0.06, 0, h / 2, s * (d / 2 - 0.03)); box(0.06, h, d, s * (w / 2 - 0.03), h / 2, 0); }
      box(w - 0.12, h - 0.05, d - 0.12, 0, (h - 0.05) / 2, 0, mats.soil);
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mats.leaf);
        p.position.set(-w / 2 + 0.3 + (i % 3) * (w - 0.6) / 2, h + 0.1, (i < 3 ? -1 : 1) * d * 0.2);
        g.add(p);
      }
      break;
    }
    case 'planter': {
      cyl(w / 2, w / 2 * 0.75, 0.5, 0, 0.25, 0, mats.main);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(w / 2 * 0.9, 12, 10), mats.leaf);
      leaf.position.y = 0.75;
      g.add(leaf);
      break;
    }
    case 'shed': {
      const wall = h * 0.75;
      box(w, wall, d, 0, wall / 2, 0);
      const roofH = h - wall;
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2 - 0.1, 0); shape.lineTo(d / 2 + 0.1, 0); shape.lineTo(0, roofH); shape.closePath();
      const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w + 0.2, bevelEnabled: false }), mats.dark);
      roof.rotation.y = Math.PI / 2;
      roof.position.set(-w / 2 - 0.1, wall, 0);
      g.add(roof);
      box(0.9, 1.8, 0.03, 0, 0.9, d / 2 + 0.01, mats.dark);
      break;
    }
    case 'tree': {
      // a scanned tree is measured at the trunk; a planned one by its canopy
      const scanned = it.origin === 'scanned';
      const R = scanned ? Math.max(1.4, Math.min(3.5, h * 0.36)) : Math.max(0.6, Math.min(w, d) / 2);
      const r = scanned ? Math.max(0.1, Math.min(w, d) / 2) : Math.max(0.08, R * 0.08);
      cyl(r * 0.8, r, h * 0.6, 0, h * 0.3, 0, mats.bark, 10);
      for (const [dx, dy, dz, k] of [[0, 0, 0, 1], [R * 0.4, -R * 0.25, R * 0.2, 0.7], [-R * 0.35, -R * 0.2, -R * 0.3, 0.72]]) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(R * k, 1), mats.leaf);
        c.position.set(dx, Math.max(R, h - R * 0.9) + dy, dz);
        g.add(c);
      }
      break;
    }
    case 'shrub': {
      for (const [dx, dz, k] of [[0, 0, 1], [w * 0.22, d * 0.15, 0.7], [-w * 0.2, -d * 0.18, 0.75]]) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(w, d) / 2 * k, 1), mats.leaf);
        b.scale.y = (h / Math.min(w, d)) * 1.1;
        b.position.set(dx, h * 0.45 * k, dz);
        g.add(b);
      }
      break;
    }
    case 'hedge': {
      const hb = box(w, h, d, 0, h / 2, 0, mats.leaf);
      hb.geometry = new THREE.BoxGeometry(w, h, d, 6, 3, 2);
      break;
    }
    case 'flowerbed': {
      box(w, 0.12, d, 0, 0.06, 0, mats.soil);
      const colors = [0xe0507a, 0xf2c14e, 0xffffff, 0x9b6ad6];
      for (let i = 0; i < Math.round(w * d * 6); i++) {
        const m = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.8 });
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), m);
        f.position.set((((i * 0.618) % 1) - 0.5) * (w - 0.2), 0.2 + (i % 3) * 0.04, ((((i * 0.371) % 1)) - 0.5) * (d - 0.2));
        g.add(f);
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), mats.leaf);
        leaf.position.set(f.position.x, 0.12, f.position.z);
        g.add(leaf);
      }
      break;
    }
    case 'boulder': {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), mats.stone);
      rock.scale.set(w, h * 1.6, d);
      rock.position.y = h * 0.35;
      g.add(rock);
      break;
    }
    case 'deck': box(w, Math.max(0.05, Math.min(h, 0.6)), d, 0, Math.max(0.05, Math.min(h, 0.6)) / 2, 0, mats.main); break;
    case 'pool': {
      box(w, 0.15, d, 0, 0.075, 0, mats.stone);
      box(w - 0.4, 0.02, d - 0.4, 0, 0.16, 0, mats.water);
      break;
    }
    case 'fence':
    case 'wall': box(w, h, d, 0, h / 2, 0, it.kind === 'fence' ? mats.main : mats.stone); break;
    case 'house':
    case 'structure': {
      box(w, h, d, 0, h / 2, 0, mats.wall);
      box(w + 0.2, 0.1, d + 0.2, 0, h, 0, mats.dark);
      break;
    }
    case 'utility': box(w, h, d, 0, h / 2, 0, mats.metal); break;
    default: {
      box(w, h, d, 0, h / 2, 0);
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
