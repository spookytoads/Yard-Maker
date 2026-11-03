// 3D preview: the scan itself (or a terrain built from the plan) with furniture as blocks.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { footprint } from './optimizer.js';
import { CATEGORIES, CATALOG_BY_KIND, categoryOf } from './catalog.js';
import { buildModel, finishCanvas, getImage, textureFor } from './looks.js';

export class View3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe6dc);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);
    this.terrain = null;
    this.furniture = new THREE.Group();
    this.scene.add(this.furniture);
    new ResizeObserver(() => this.resize()).observe(container);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.visible) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  setVisible(v) { this.visible = v; if (v) this.resize(); }

  /** Show the yard. `scanRoot` is the analysed scan group (already yawed), or null. */
  setYard(model, scanRoot) {
    if (this.terrain) this.scene.remove(this.terrain);
    this.model = model;
    this.hasScan = !!scanRoot;
    this.terrain = scanRoot || buildTerrain(model);
    this.scene.add(this.terrain);
    const b = model.bounds, c = model.cell;
    const cx = model.origin.x + ((b.i0 + b.i1) / 2) * c, cz = model.origin.z + ((b.j0 + b.j1) / 2) * c;
    const span = Math.max((b.i1 - b.i0) * c, (b.j1 - b.j0) * c);
    const gy = groundAt(model, (b.i0 + b.i1) / 2 * c, (b.j0 + b.j1) / 2 * c);
    this.controls.target.set(cx, gy, cz);
    this.camera.position.set(cx + span * 0.15, gy + span * 0.85, cz + span * 0.95);
    this.camera.near = Math.max(0.05, span / 500);
    this.camera.far = span * 20;
    this.camera.updateProjectionMatrix();
  }

  setItems(items) {
    for (const ch of [...this.furniture.children]) {
      this.furniture.remove(ch);
      ch.traverse((o) => { o.geometry?.dispose(); });
    }
    if (!this.model) return;
    const m = this.model;
    for (const it of items) {
      if (it.origin === 'scanned') {
        // with a real scan the thing is already in the mesh; show it again only if it moved
        const moved = it.home && Math.hypot(it.x - it.home.x, it.z - it.home.z) > 0.2;
        if (this.hasScan && !moved) continue;
        if (it.fixed) { this.furniture.add(this.proxy(it)); continue; }
      }
      const fp = footprint(it);
      const catColor = (CATEGORIES[categoryOf(it)] || CATEGORIES.other).color;
      const y = groundAt(m, it.x, it.z);
      const holder = new THREE.Group();
      holder.position.set(m.origin.x + it.x, y, m.origin.z + it.z);
      if (it.photo && it.cutout) {
        const img = getImage(it.photo, () => this.setItems(this.lastItems));
        if (img) {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
          const hgt = Math.max(1.0, (it.h || 0.8) * 1.5);
          const aspect = img.width / img.height;
          sp.scale.set(Math.max(hgt * aspect, 0.3), hgt, 1);
          sp.center.set(0.5, 0);
          holder.add(sp);
        }
      } else {
        const model = buildModel(THREE, { ...it, w: it.w, d: it.d, h: it.h || CATALOG_BY_KIND[it.kind]?.h || 0.8 }, this.materialsFor(it), catColor);
        model.rotation.y = ((it.rot || 0) * Math.PI) / 180;
        holder.add(model);
      }
      if (it.clearance > 0) {
        const c = it.clearance;
        const ring = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(fp.w + 2 * c, fp.d + 2 * c)),
          new THREE.LineBasicMaterial({ color: new THREE.Color(catColor) }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        holder.add(ring);
      }
      this.furniture.add(holder);
    }
    this.lastItems = items;
  }

  /** Stand-in for a fixed feature when there is no scan mesh: trees, sheds, walls. */
  proxy(it) {
    const m = this.model;
    const g = new THREE.Group();
    g.position.set(m.origin.x + it.x, groundAt(m, it.x, it.z), m.origin.z + it.z);
    const bark = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 });
    if (it.scanType === 'tree') {
      const r = Math.max(0.12, Math.min(it.w, it.d) / 2);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, it.h * 0.55, 12), bark);
      trunk.position.y = it.h * 0.275;
      g.add(trunk);
      const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.9 });
      const R = Math.max(1.4, Math.min(3.5, it.h * 0.36));
      for (const [dx, dy, dz, s] of [[0, 0, 0, 1], [R * 0.4, -R * 0.2, R * 0.2, 0.7], [-R * 0.35, -R * 0.15, -R * 0.3, 0.75]]) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(R * s, 1), leaf);
        c.position.set(dx, it.h - R * 0.9 + dy, dz);
        g.add(c);
      }
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: it.isHouse ? 0xd9d4ca : 0x8a8177, roughness: 0.9 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), mat);
      b.position.y = it.h / 2;
      g.add(b);
      if (it.scanType === 'shed' || it.scanType === 'structure') {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(it.w + 0.2, 0.08, it.d + 0.2), new THREE.MeshStandardMaterial({ color: 0x4a4c50 }));
        roof.position.y = it.h;
        g.add(roof);
      }
    }
    return g;
  }

  /** Materials for one piece: its finish or texture photo, plus shared accents. */
  materialsFor(it) {
    const shared = this.shared || (this.shared = {
      metal: new THREE.MeshStandardMaterial({ color: 0x2f3235, metalness: 0.6, roughness: 0.45 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8 }),
      water: new THREE.MeshStandardMaterial({ color: 0x3aa7c9, roughness: 0.15, metalness: 0.1 }),
      sand: new THREE.MeshStandardMaterial({ color: 0xe2cf9c, roughness: 1 }),
      soil: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x4f8a3a, roughness: 0.9 }),
      flame: new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 1.2 }),
      stone: this.texMat(finishCanvas('stone'), 0.6),
      fabric: this.texMat(finishCanvas('fabric'), 0.8),
    });
    const src = textureFor(it, () => this.setItems(this.lastItems));
    const color = (CATEGORIES[categoryOf(it)] || CATEGORIES.other).color;
    const main = src ? this.texMat(src, 0.7) : new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const fabric = it.finish === 'custom' && it.texture && it.kind !== 'firepit' ? main : shared.fabric;
    return { ...shared, main, fabric };
  }

  texMat(src, repeat) {
    const key = src;
    this.texCache ||= new Map();
    if (!this.texCache.has(key)) {
      const tex = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      tex.needsUpdate = true;
      this.texCache.set(key, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    }
    return this.texCache.get(key);
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

export function groundAt(m, x, z) {
  const i = Math.max(0, Math.min(m.cols - 1, Math.floor(x / m.cell)));
  const j = Math.max(0, Math.min(m.rows - 1, Math.floor(z / m.cell)));
  return m.ground[j * m.cols + i] || 0;
}

/** Terrain for yards without a scan mesh: ground + heights, draped with the aerial image. */
function buildTerrain(m) {
  const step = Math.max(1, Math.round(Math.max(m.cols, m.rows) / 240));
  const nx = Math.ceil(m.cols / step), nz = Math.ceil(m.rows / step);
  const W = m.cols * m.cell, D = m.rows * m.cell;
  const geo = new THREE.PlaneGeometry(W, D, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v) + W / 2, z = pos.getZ(v) + D / 2;
    const i = Math.max(0, Math.min(m.cols - 1, Math.floor(x / m.cell)));
    const j = Math.max(0, Math.min(m.rows - 1, Math.floor(z / m.cell)));
    const k = j * m.cols + i;
    pos.setY(v, m.ground[k] || 0);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x86a862, roughness: 1 });
  if (m.ortho) {
    const tex = new THREE.TextureLoader().load(m.ortho);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    mat.color.set(0xffffff);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(m.origin.x + W / 2, 0, m.origin.z + D / 2);
  return mesh;
}
