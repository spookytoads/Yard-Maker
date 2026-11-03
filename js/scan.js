// Loads a Polycam export and measures it from above.
// The model is rendered with orthographic cameras straight down and straight up into
// small offscreen targets: the highest surface per cell, the lowest surface (ground),
// the lowest surface standing above the ground (obstacles vs. walk-under canopy), and a
// flat-lit colour image used as the aerial photo in the planner.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { processGround, buildYardModel, OBJECT_MIN_H } from './analyze.js';

const MODEL_EXT = ['glb', 'gltf', 'obj', 'ply', 'stl', 'fbx'];
const ext = (name) => name.toLowerCase().split('.').pop();
const base = (name) => name.split(/[\\/]/).pop().toLowerCase();

/** Read the dropped files (or the contents of a .zip) into { name → Blob }. */
async function collect(files) {
  const map = new Map();
  for (const f of files) {
    if (ext(f.name) === 'zip') {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, bytes] of Object.entries(entries)) {
        if (path.endsWith('/') || path.includes('__MACOSX')) continue;
        map.set(base(path), new Blob([bytes]));
      }
    } else map.set(base(f.name), f);
  }
  return map;
}

/** Load the scan into a THREE.Group. Throws a readable Error when nothing usable is found. */
export async function loadScan(files) {
  const map = await collect(files);
  const names = [...map.keys()];
  const main = MODEL_EXT.map((e) => names.find((n) => ext(n) === e)).find(Boolean);
  if (!main) {
    const usdz = names.find((n) => ext(n) === 'usdz');
    throw new Error(usdz
      ? 'USDZ files cannot be read in the browser. In Polycam, export the scan as GLB instead.'
      : 'No 3D model found. Export the scan from Polycam as GLB (best), OBJ, PLY or a ZIP of those.');
  }
  const urls = new Map();
  const urlFor = (n) => {
    if (!urls.has(n)) urls.set(n, URL.createObjectURL(map.get(n)));
    return urls.get(n);
  };
  const manager = new THREE.LoadingManager();
  let pending = 0;
  const { itemStart, itemEnd } = manager;
  manager.itemStart = (u) => { pending++; itemStart(u); };
  manager.itemEnd = (u) => { pending = Math.max(0, pending - 1); itemEnd(u); };
  manager.setURLModifier((url) => {
    if (url.startsWith('data:')) return url;
    const n = base(decodeURIComponent(url.split('?')[0]));
    return map.has(n) ? urlFor(n) : url;
  });
  const blob = map.get(main);
  let object;
  try {
    switch (ext(main)) {
      case 'glb':
      case 'gltf': {
        const loader = new GLTFLoader(manager);
        const draco = new DRACOLoader();
        draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
        loader.setDRACOLoader(draco);
        loader.setMeshoptDecoder(MeshoptDecoder);
        const data = ext(main) === 'glb' ? await blob.arrayBuffer() : await blob.text();
        const gltf = await new Promise((res, rej) => loader.parse(data, '', res, rej));
        object = gltf.scene;
        break;
      }
      case 'obj': {
        const loader = new OBJLoader(manager);
        const mtlName = names.find((n) => ext(n) === 'mtl');
        if (mtlName) {
          const mtl = new MTLLoader(manager).parse(await map.get(mtlName).text(), '');
          mtl.preload();
          loader.setMaterials(mtl);
        }
        object = loader.parse(await blob.text());
        break;
      }
      case 'ply': {
        const geo = new PLYLoader(manager).parse(await blob.arrayBuffer());
        const hasFaces = !!geo.index;
        const mat = hasFaces
          ? new THREE.MeshBasicMaterial({ vertexColors: !!geo.attributes.color, side: THREE.DoubleSide })
          : new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: !!geo.attributes.color });
        object = hasFaces ? new THREE.Mesh(geo, mat) : new THREE.Points(geo, mat);
        break;
      }
      case 'stl': {
        const geo = new STLLoader(manager).parse(await blob.arrayBuffer());
        object = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xb0b0a0, side: THREE.DoubleSide }));
        break;
      }
      case 'fbx':
        object = new FBXLoader(manager).parse(await blob.arrayBuffer(), '');
        break;
    }
  } catch (e) {
    throw new Error(`Could not read ${main}: ${e.message || e}`);
  }
  // wait for textures referenced by the model
  await new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };
    manager.onLoad = finish;
    setTimeout(finish, 4000);
    setTimeout(() => { if (!pending) finish(); }, 50);
  });
  const group = new THREE.Group();
  group.name = main;
  const holder = new THREE.Group(); // up-axis correction lives here, yaw on `group`
  holder.add(object);
  group.add(holder);
  return { root: group, holder, name: main };
}

/** Up to `max` world-space vertex positions as a flat [x, y, z, ...] array. */
function samplePoints(root, max = 120000) {
  root.updateMatrixWorld(true);
  let total = 0;
  root.traverse((o) => { if ((o.isMesh || o.isPoints) && o.geometry?.attributes.position) total += o.geometry.attributes.position.count; });
  const stride = Math.max(1, Math.ceil(total / max));
  const out = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o.isMesh || o.isPoints) || !o.geometry?.attributes.position) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return out;
}

const quantile = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];

/** Yaw (degrees) that makes the yard's bounding box smallest, i.e. lines the fences up with the grid. */
function bestYaw(pts) {
  const xs = [], zs = [];
  for (let i = 0; i < pts.length; i += 3) { xs.push(pts[i]); zs.push(pts[i + 2]); }
  const sx = [...xs].sort((a, b) => a - b), sz = [...zs].sort((a, b) => a - b);
  const lo = [quantile(sx, 0.005), quantile(sz, 0.005)], hi = [quantile(sx, 0.995), quantile(sz, 0.995)];
  const keep = [];
  for (let i = 0; i < xs.length; i++)
    if (xs[i] >= lo[0] && xs[i] <= hi[0] && zs[i] >= lo[1] && zs[i] <= hi[1]) keep.push(xs[i], zs[i]);
  let best = 0, bestArea = Infinity;
  for (let a = 0; a < 90; a += 0.5) {
    const t = (a * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < keep.length; i += 2) {
      const x = keep[i] * c + keep[i + 1] * s, z = -keep[i] * s + keep[i + 1] * c;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const area = (x1 - x0) * (z1 - z0);
    if (area < bestArea - 1e-6) { bestArea = area; best = a; }
  }
  return best;
}

const HEIGHT_VS = /* glsl */ `
  uniform float uPointSize;
  varying float vY;
  varying vec2 vXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vY = wp.y; vXZ = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_PointSize = uPointSize;
  }`;
const HEIGHT_FS = /* glsl */ `
  precision highp float;
  uniform float uMinY, uRangeY, uUseGround, uOffset;
  uniform vec4 uBox;
  uniform sampler2D uGround;
  varying float vY;
  varying vec2 vXZ;
  void main() {
    if (uUseGround > 0.5) {
      float g = texture2D(uGround, (vXZ - uBox.xy) / uBox.zw).r;
      if (vY < g + uOffset) discard;
    }
    float h = clamp((vY - uMinY) / uRangeY, 0.0, 1.0) * 65535.0;
    float hi = floor(h / 256.0);
    float lo = floor(h - hi * 256.0);
    gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);
  }`;

/**
 * Measure a loaded scan. Returns { model, items } from analyze.js plus the root for 3D.
 * opts: { upAxis: 'y'|'z', autoYaw: bool, yaw: degrees added on top, scale: multiplier, onStep }
 */
export async function analyzeScan(scan, opts = {}) {
  const step = opts.onStep || (() => {});
  const { root, holder } = scan;
  holder.rotation.set(opts.upAxis === 'z' ? -Math.PI / 2 : 0, 0, 0);
  holder.scale.setScalar(opts.scale || 1);
  root.rotation.set(0, 0, 0);
  step('Finding the yard outline…');
  await tick();
  let pts = samplePoints(root);
  if (!pts.length) throw new Error('The model has no geometry.');
  const yaw = (opts.autoYaw !== false ? bestYaw(pts) : 0) + (opts.yaw || 0);
  root.rotation.y = (yaw * Math.PI) / 180; // same sense as the search in bestYaw()
  pts = samplePoints(root);
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < pts.length; i += 3) { xs.push(pts[i]); ys.push(pts[i + 1]); zs.push(pts[i + 2]); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); zs.sort((a, b) => a - b);
  const pad = 0.2;
  const minX = quantile(xs, 0.002) - pad, maxX = quantile(xs, 0.998) + pad;
  const minZ = quantile(zs, 0.002) - pad, maxZ = quantile(zs, 0.998) + pad;
  const minY = ys[0] - 0.5, maxY = ys[ys.length - 1] + 0.5;
  const W = maxX - minX, D = maxZ - minZ;
  if (W > 400 || D > 400) throw new Error(`The scan is ${W.toFixed(0)} × ${D.toFixed(0)} units across. If it is not in meters, set the scale and re-analyse.`);
  const cell = Math.min(0.25, Math.max(0.04, Math.max(W, D) / 320));
  const cols = Math.ceil(W / cell), rows = Math.ceil(D / cell);
  const gw = cols * cell, gd = rows * cell;
  const cx = minX + gw / 2, cz = minZ + gd / 2;

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: true });
  renderer.setPixelRatio(1);
  try {
    const scene = new THREE.Scene();
    const parent = root.parent;
    scene.add(root);
    root.updateMatrixWorld(true);
    const range = maxY - minY;
    const cam = new THREE.OrthographicCamera(-gw / 2, gw / 2, gd / 2, -gd / 2, 0.01, range + 4);
    const placeCam = (fromTop) => {
      cam.position.set(cx, fromTop ? maxY + 1 : minY - 1, cz);
      cam.up.set(0, 0, fromTop ? -1 : 1);
      cam.lookAt(cx, fromTop ? minY : maxY, cz);
      cam.updateMatrixWorld(true);
    };
    const groundTex = new THREE.DataTexture(new Float32Array(cols * rows), cols, rows, THREE.RedFormat, THREE.FloatType);
    groundTex.minFilter = groundTex.magFilter = THREE.NearestFilter;
    const uniforms = {
      uMinY: { value: minY }, uRangeY: { value: range }, uUseGround: { value: 0 }, uOffset: { value: OBJECT_MIN_H },
      uBox: { value: new THREE.Vector4(minX, minZ, gw, gd) }, uGround: { value: groundTex }, uPointSize: { value: 3 },
    };
    const meshMat = new THREE.ShaderMaterial({ vertexShader: HEIGHT_VS, fragmentShader: HEIGHT_FS, uniforms, side: THREE.DoubleSide });
    // Walls and trunks are edge-on when seen from straight above or below, so their
    // triangles cover no pixels. Their edges still do: a second wireframe draw catches them.
    const wireMat = meshMat.clone();
    wireMat.uniforms = uniforms;
    wireMat.wireframe = true;
    const originals = new Map();
    root.traverse((o) => { if (o.isMesh || o.isPoints) originals.set(o, o.material); });
    const useMat = (mat) => originals.forEach((_, o) => { o.material = mat; });

    const rt = new THREE.WebGLRenderTarget(cols, rows, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    const buf = new Uint8Array(cols * rows * 4);
    const pass = (fromTop) => {
      placeCam(fromTop);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.autoClear = false;
      useMat(meshMat);
      renderer.render(scene, cam);
      useMat(wireMat);
      renderer.render(scene, cam);
      renderer.autoClear = true;
      renderer.readRenderTargetPixels(rt, 0, 0, cols, rows, buf);
      renderer.setRenderTarget(null);
      const out = new Float32Array(cols * rows).fill(NaN);
      for (let k = 0; k < rows; k++) {
        const j = fromTop ? rows - 1 - k : k;
        for (let i = 0; i < cols; i++) {
          const p = (k * cols + i) * 4;
          if (buf[p + 3] < 128) continue;
          out[j * cols + i] = minY + ((buf[p] * 256 + buf[p + 1]) / 65535) * range;
        }
      }
      return out;
    };

    step('Measuring the ground…');
    await tick();
    const bottom = pass(false);
    const top = pass(true);
    const ground = processGround(bottom, cols, rows, cell);
    groundTex.image.data.set(ground);
    groundTex.needsUpdate = true;
    uniforms.uUseGround.value = 1;
    step('Finding trees, furniture and structures…');
    await tick();
    const low = pass(false);
    steepPass(root, { minX, minZ, cell, cols, rows }, ground, low);
    const seen = new Uint8Array(cols * rows);
    for (let i = 0; i < seen.length; i++) seen[i] = Number.isFinite(bottom[i]) || Number.isFinite(top[i]) ? 1 : 0;

    step('Making the aerial view…');
    await tick();
    originals.forEach((m, o) => { o.material = flatMaterial(m, o); });
    const s = Math.max(1, Math.min(4, Math.floor(2048 / Math.max(cols, rows))));
    renderer.setSize(cols * s, rows * s, false);
    placeCam(true);
    renderer.setClearColor(0x000000, 0);
    const lights = [new THREE.HemisphereLight(0xffffff, 0x666655, 2.2), new THREE.DirectionalLight(0xffffff, 1.4)];
    lights[1].position.set(cx + 10, maxY + 30, cz + 6);
    lights[1].target.position.set(cx, minY, cz);
    for (const l of lights) scene.add(l);
    scene.add(lights[1].target);
    renderer.render(scene, cam);
    for (const l of lights) scene.remove(l);
    const ortho = renderer.domElement.toDataURL('image/jpeg', 0.85);
    originals.forEach((m, o) => { o.material = m; });
    rt.dispose(); groundTex.dispose(); meshMat.dispose(); wireMat.dispose();
    scene.remove(root);
    if (parent) parent.add(root);

    step('Building the plan…');
    await tick();
    const res = buildYardModel({
      source: 'scan', name: scan.name, cols, rows, cell, origin: { x: minX, z: minZ },
      ground, topY: top, lowY: low, seen, ortho,
    });
    res.model.yaw = yaw;
    return res;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}

/**
 * Walls, fences and trunks are near-vertical, so a straight-down render barely sees them.
 * Walk every steep triangle on the CPU and record its lowest point that stands in the
 * obstacle band above the ground. Updates `low` in place.
 */
function steepPass(root, grid, ground, low) {
  const { minX, minZ, cell, cols, rows } = grid;
  const v = new THREE.Vector3();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const mark = (x, y, z) => {
    const i = Math.floor((x - minX) / cell), j = Math.floor((z - minZ) / cell);
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    const k = j * cols + i;
    const h = y - ground[k];
    if (h < OBJECT_MIN_H || h > 1.9) return;
    if (!(low[k] <= y)) low[k] = y;
  };
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    const pos = o.geometry.attributes.position;
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z;
    }
    const index = o.geometry.index;
    const tris = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const a = index ? index.getX(t * 3) : t * 3, b = index ? index.getX(t * 3 + 1) : t * 3 + 1, c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      A.fromArray(world, a * 3); B.fromArray(world, b * 3); C.fromArray(world, c * 3);
      nrm.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A));
      const len = nrm.length();
      if (len < 1e-12 || Math.abs(nrm.y / len) > 0.6) continue; // not steep
      const edge = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A));
      const n = Math.min(600, Math.max(1, Math.ceil(edge / (cell * 0.7))));
      for (let p = 0; p <= n; p++)
        for (let q = 0; q <= n - p; q++) {
          const u = p / n, w = q / n, r = 1 - u - w;
          mark(A.x * r + B.x * u + C.x * w, A.y * r + B.y * u + C.y * w, A.z * r + B.z * u + C.z * w);
        }
    }
  });
}

function flatMaterial(m, o) {
  const src = Array.isArray(m) ? m[0] : m;
  const vc = !!o.geometry?.attributes.color;
  if (o.isPoints) return new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: vc, color: vc ? 0xffffff : 0x999988 });
  if (src?.map || vc) return new THREE.MeshBasicMaterial({ map: src?.map || null, vertexColors: vc, side: THREE.DoubleSide });
  // untextured scan: shade it so shapes read from above
  return new THREE.MeshLambertMaterial({ color: 0xb4bca6, side: THREE.DoubleSide });
}

const tick = () => new Promise((r) => setTimeout(r, 16));
