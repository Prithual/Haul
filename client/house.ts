import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Face, H, W, Wall } from '../src/shared';
import { FloorType, MAPS, MapDef } from '../src/maps';

// Everything that makes the game feel like it happens INSIDE a house: wood/tile/carpet
// floors per room, wallpapered walls with baseboards, a ceiling with lamps, windows on the
// outer walls and 3D furniture for every solid the server sends. All textures are drawn
// procedurally on canvases — no external assets.

const PART_H = 95; // partition wall height (kept below the ceiling so the camera can see over)
const wx = (x: number) => x - W / 2;
const wz = (y: number) => y - H / 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---------- floor palette (also used to tint the minimap) ----------
export const FLOOR_RGB: Record<FloorType, [number, number, number]> = {
  wood: [138, 90, 48], darkwood: [70, 42, 24], tile: [190, 184, 168], tileblue: [126, 162, 178],
  carpet: [96, 76, 108], carpetred: [128, 34, 44], carpetgreen: [64, 92, 72],
  concrete: [110, 110, 106], checker: [216, 208, 192], stone: [92, 90, 84],
};
const FLOOR_WORLD: Record<FloorType, number> = {
  wood: 256, darkwood: 256, tile: 256, tileblue: 256, carpet: 256, carpetred: 256,
  carpetgreen: 256, concrete: 384, checker: 200, stone: 256,
};
export const floorCss = (t: FloorType) => `rgb(${FLOOR_RGB[t].join(',')})`;

// ---------- canvas texture helpers ----------
function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
const rgb = (r: number, g: number, b: number) => `rgb(${clamp(Math.round(r), 0, 255)},${clamp(Math.round(g), 0, 255)},${clamp(Math.round(b), 0, 255)})`;
function speckle(ctx: CanvasRenderingContext2D, size: number, n: number, dark = 0.08) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${Math.random() * dark})` : `rgba(255,255,255,${Math.random() * dark * 0.6})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
function drawFloor(type: FloorType): HTMLCanvasElement {
  const size = type === 'checker' ? 128 : 256;
  const [c, ctx] = makeCanvas(size);
  const [r, g, b] = FLOOR_RGB[type];
  ctx.fillStyle = rgb(r, g, b); ctx.fillRect(0, 0, size, size);
  if (type === 'wood' || type === 'darkwood') {
    const rowH = 32;
    for (let y = 0; y < size; y += rowH) {
      const cut = 90 + Math.random() * 80; // two planks per row so the texture tiles cleanly
      for (const [x0, len] of [[0, cut], [cut, size - cut]]) {
        const v = (Math.random() - 0.5) * 24;
        ctx.fillStyle = rgb(r + v, g + v * 0.7, b + v * 0.5); ctx.fillRect(x0, y, len, rowH);
        ctx.strokeStyle = type === 'wood' ? 'rgba(30,14,4,0.55)' : 'rgba(10,4,0,0.6)'; ctx.lineWidth = 2;
        ctx.strokeRect(x0, y, len, rowH);
        for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(x0 + Math.random() * len, y + 3 + Math.random() * (rowH - 6), 12 + Math.random() * 40, 1); }
      }
    }
  } else if (type === 'tile' || type === 'tileblue') {
    const t = 64;
    for (let y = 0; y < size; y += t) for (let x = 0; x < size; x += t) {
      const v = (Math.random() - 0.5) * 14; ctx.fillStyle = rgb(r + v, g + v, b + v); ctx.fillRect(x, y, t, t);
    }
    ctx.strokeStyle = type === 'tile' ? 'rgba(70,66,58,0.9)' : 'rgba(40,62,74,0.9)'; ctx.lineWidth = 3;
    for (let i = 0; i <= size; i += t) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke(); }
    speckle(ctx, size, 300, 0.06);
  } else if (type === 'carpet' || type === 'carpetred' || type === 'carpetgreen') {
    speckle(ctx, size, 5000, 0.13);
    ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 1;
    for (let i = 0; i < size; i += 4) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke(); }
  } else if (type === 'concrete') {
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * size, y = Math.random() * size, rad = 30 + Math.random() * 60;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const dk = Math.random() < 0.5; gr.addColorStop(0, dk ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, size, size);
    }
    speckle(ctx, size, 2500, 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, size, size); // slab joint
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(60, 20); ctx.lineTo(90, 70); ctx.lineTo(80, 110); ctx.stroke();
  } else if (type === 'checker') {
    const t = size / 2;
    ctx.fillStyle = 'rgb(38,34,32)'; ctx.fillRect(0, 0, t, t); ctx.fillRect(t, t, t, t);
    speckle(ctx, size, 400, 0.07);
  } else { // stone flags
    const t = 64;
    for (let y = 0, row = 0; y < size; y += t, row++) for (let x = (row % 2 ? -t / 2 : 0); x < size; x += t) {
      const v = (Math.random() - 0.5) * 22; ctx.fillStyle = rgb(r + v, g + v, b + v); ctx.fillRect(x, y, t, t);
      ctx.strokeStyle = 'rgba(16,14,12,0.7)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, t, t);
    }
    speckle(ctx, size, 800, 0.1);
  }
  return c;
}
const floorBase = new Map<FloorType, THREE.CanvasTexture>();
function floorTexture(type: FloorType, w: number, h: number, owned: THREE.Texture[]): THREE.CanvasTexture {
  let base = floorBase.get(type);
  if (!base) { base = new THREE.CanvasTexture(drawFloor(type)); base.colorSpace = THREE.SRGBColorSpace; base.wrapS = base.wrapT = THREE.RepeatWrapping; base.anisotropy = 4; floorBase.set(type, base); }
  const t = base.clone(); t.needsUpdate = true;
  t.repeat.set(w / FLOOR_WORLD[type], h / FLOOR_WORLD[type]);
  owned.push(t);
  return t;
}

// wallpaper: soft vertical stripes with a tiny motif, tinted by the map's wall color
let wallpaperBase: THREE.CanvasTexture | null = null;
const wallpaperMats = new Map<string, THREE.MeshStandardMaterial>();
function wallpaperMat(color: number, len: number): THREE.MeshStandardMaterial {
  const rep = Math.max(1, Math.round(len / 128));
  const key = `${color}|${rep}`;
  let m = wallpaperMats.get(key);
  if (m) return m;
  if (!wallpaperBase) {
    const [c, ctx] = makeCanvas(128);
    ctx.fillStyle = '#ece7de'; ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 32) { ctx.fillStyle = 'rgba(0,0,0,0.09)'; ctx.fillRect(x, 0, 10, 128); }
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = 16; y < 128; y += 32) for (let x = 21; x < 128; x += 32) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    speckle(ctx, 128, 500, 0.05);
    wallpaperBase = new THREE.CanvasTexture(c); wallpaperBase.colorSpace = THREE.SRGBColorSpace; wallpaperBase.wrapS = wallpaperBase.wrapT = THREE.RepeatWrapping;
  }
  const t = wallpaperBase.clone(); t.needsUpdate = true; t.repeat.set(rep, 1);
  m = new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.92 });
  wallpaperMats.set(key, m);
  return m;
}

// bookshelf spines and cabinet doors, drawn once and repeated along the piece
let bookBase: THREE.CanvasTexture | null = null, cabinetBase: THREE.CanvasTexture | null = null;
const decalMats = new Map<string, THREE.MeshStandardMaterial>();
function decalMat(kind: 'books' | 'cabinet', len: number): THREE.MeshStandardMaterial {
  const rep = Math.max(1, Math.round(len / (kind === 'books' ? 120 : 80)));
  const key = `${kind}|${rep}`;
  let m = decalMats.get(key);
  if (m) return m;
  if (kind === 'books' && !bookBase) {
    const [c, ctx] = makeCanvas(256, 128);
    ctx.fillStyle = '#1f130a'; ctx.fillRect(0, 0, 256, 128);
    const cols = ['#7a2a2a', '#2a4a6a', '#3a5a2a', '#8a6a2a', '#5a3a5a', '#2a5a5a', '#8a4a2a', '#4a4a4a'];
    for (let row = 0; row < 4; row++) {
      let x = 2; const base = row * 32 + 30;
      while (x < 250) {
        const bw = 5 + Math.random() * 9, bh = 20 + Math.random() * 9;
        ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)]; ctx.fillRect(x, base - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 1, base - bh + 4, bw - 2, 1);
        x += bw + 0.5;
      }
      ctx.fillStyle = '#4a2f18'; ctx.fillRect(0, base, 256, 3);
    }
    bookBase = new THREE.CanvasTexture(c); bookBase.colorSpace = THREE.SRGBColorSpace; bookBase.wrapS = THREE.RepeatWrapping;
  }
  if (kind === 'cabinet' && !cabinetBase) {
    const [c, ctx] = makeCanvas(128);
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(0, 0, 128, 128);
    for (const x of [6, 68]) {
      ctx.strokeStyle = '#2e1c0e'; ctx.lineWidth = 3; ctx.strokeRect(x, 8, 54, 112);
      ctx.strokeStyle = 'rgba(255,220,170,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(x + 6, 14, 42, 100);
    }
    ctx.fillStyle = '#c9a85a'; ctx.beginPath(); ctx.arc(52, 64, 3, 0, Math.PI * 2); ctx.arc(76, 64, 3, 0, Math.PI * 2); ctx.fill();
    cabinetBase = new THREE.CanvasTexture(c); cabinetBase.colorSpace = THREE.SRGBColorSpace; cabinetBase.wrapS = THREE.RepeatWrapping;
  }
  const t = (kind === 'books' ? bookBase! : cabinetBase!).clone(); t.needsUpdate = true; t.repeat.set(rep, 1);
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  decalMats.set(key, m);
  return m;
}

// ---------- plain material cache ----------
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, rough = 0.85, metal = 0.05, emissive = 0, emI = 0): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}|${metal}|${emissive}|${emI}`;
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: emI }); matCache.set(k, m); }
  return m;
}

// Bake every mesh of a group into one mesh per material (world matrices applied), so a sofa
// or a bed costs a couple of draw calls instead of a dozen — matters with ~70 pieces × 3 shadow passes.
function mergeGroup(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld);
    const list = buckets.get(m.material as THREE.Material);
    if (list) list.push(geo); else buckets.set(m.material as THREE.Material, [geo]);
    m.geometry.dispose();
  });
  const out = new THREE.Group();
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach(x => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

function clearGroup(g: THREE.Group) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}

const FACE_ROT: Record<Face, number> = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2, o: 0 };

// Chairs turn their back away from the nearest table/counter/desk.
function chairFace(w: Wall, all: Wall[]): Face {
  const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
  let best: Wall | null = null, bd = Infinity;
  for (const o of all) {
    if (o.kind !== 'table' && o.kind !== 'counter' && o.kind !== 'desk') continue;
    const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return 'n';
  // measure to the nearest edge of the table rather than its centre (tables are big)
  const tx = clamp(cx, best.x, best.x + best.w), ty = clamp(cy, best.y, best.y + best.h);
  const dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'w' : 'e';
  return dy > 0 ? 'n' : 's';
}

// Build one piece of furniture in a local frame: origin at floor-centre of its footprint,
// its back toward -z. The merged group is then rotated to whatever wall it stands against.
function buildSolid(w: Wall, def: MapDef, all: Wall[]): THREE.Group {
  let face: Face = w.face ?? 'n';
  if (w.kind === 'chair' && !w.face) face = chairFace(w, all);
  const swap = face === 'e' || face === 'w';
  const lw = swap ? w.h : w.w, ld = swap ? w.w : w.h;
  const ceil = def.ceilingH;
  const seed = Math.floor(w.x * 7 + w.y * 13);
  const pick = <T,>(arr: T[]): T => arr[seed % arr.length];

  const g = new THREE.Group();
  const box = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m); mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  const cyl = (rt: number, rb: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); mesh.position.set(x, y, z); mesh.rotation.set(rx, 0, rz); g.add(mesh); return mesh;
  };
  const sph = (r: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m); mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  const plane = (pw: number, ph: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m); mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  const wood = mat(pick([0x7a5230, 0x6a4a2a, 0x8a6238]), 0.75);

  switch (w.kind) {
    case 'sofa': {
      const [c1, c2] = pick<[number, number]>([[0x7a3a3a, 0x8a4a4a], [0x3a4f6a, 0x4a5f7a], [0x4f6a3a, 0x5f7a4a], [0x6a5a3a, 0x7a6a4a]]);
      const arm = Math.min(16, lw * 0.16), n = lw > 150 ? 3 : lw > 100 ? 2 : 1, cw = (lw - arm * 2) / n;
      box(lw, 20, ld, mat(c1, 0.95), 0, 10, 0);
      box(arm, 34, ld, mat(c1, 0.95), -lw / 2 + arm / 2, 17, 0); box(arm, 34, ld, mat(c1, 0.95), lw / 2 - arm / 2, 17, 0);
      box(lw, 46, ld * 0.28, mat(c1, 0.95), 0, 23, -ld / 2 + ld * 0.14);
      for (let i = 0; i < n; i++) box(cw - 2, 10, ld * 0.7, mat(c2, 0.95), -lw / 2 + arm + cw * (i + 0.5), 25, ld * 0.14);
      break;
    }
    case 'chair': {
      box(lw, 5, ld, wood, 0, 22, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(4, 20, 4, wood, sx * (lw / 2 - 3), 10, sz * (ld / 2 - 3));
      box(lw, 26, 3, wood, 0, 37, -ld / 2 + 2);
      break;
    }
    case 'bed': {
      const sheet = pick([0xd8d0c0, 0xc8d4e0, 0xe0c8c8]), blanket = pick([0x3a5a7a, 0x7a3a3a, 0x4a6a4a, 0x6a4a7a]);
      box(lw, 14, ld, wood, 0, 7, 0);
      box(lw - 6, 14, ld - 6, mat(sheet, 0.95), 0, 21, 0);
      box(lw * 0.38, 8, ld * 0.16, mat(0xf0ece4, 0.95), -lw * 0.22, 32, -ld / 2 + ld * 0.14);
      box(lw * 0.38, 8, ld * 0.16, mat(0xf0ece4, 0.95), lw * 0.22, 32, -ld / 2 + ld * 0.14);
      box(lw - 8, 4, ld * 0.58, mat(blanket, 0.95), 0, 29, ld * 0.17);
      box(lw, 46, 6, wood, 0, 23, -ld / 2 + 3);
      break;
    }
    case 'shelf': {
      box(lw, 100, ld, mat(0x3a2414, 0.8), 0, 50, 0);
      plane(lw - 6, 92, decalMat('books', lw), 0, 50, ld / 2 + 0.6);
      box(lw + 2, 3, ld + 2, mat(0x2a180c, 0.8), 0, 101.5, 0);
      break;
    }
    case 'rack': {
      box(lw, 84, ld, mat(0x5a3a22, 0.8), 0, 42, 0);
      plane(lw - 4, 80, decalMat('cabinet', lw), 0, 42, ld / 2 + 0.6);
      box(lw + 2, 3, ld + 2, mat(0x3e2814, 0.8), 0, 85.5, 0);
      break;
    }
    case 'counter': {
      box(lw, 44, ld, mat(0x6b5642, 0.85), 0, 22, 0);
      plane(lw - 2, 40, decalMat('cabinet', lw), 0, 22, ld / 2 + 0.6);
      box(lw + 2, 4, ld + 2, mat(0xcfcbc2, 0.35, 0.1), 0, 46, 0);
      if (face !== 'o') box(lw, 24, 3, mat(0xb8b4aa, 0.5), 0, 60, -ld / 2 + 1.5);
      break;
    }
    case 'fridge': {
      const steel = mat(0xdedcd6, 0.4, 0.3);
      box(lw, 92, ld, steel, 0, 46, 0);
      box(lw + 0.6, 1.2, ld + 0.6, mat(0x222222), 0, 62, 0);
      box(3, 22, 3, mat(0x999999, 0.3, 0.8), lw / 2 - 8, 76, ld / 2 + 1.5); box(3, 22, 3, mat(0x999999, 0.3, 0.8), lw / 2 - 8, 40, ld / 2 + 1.5);
      break;
    }
    case 'tv': {
      box(lw, 26, ld, mat(0x2a1c12, 0.8), 0, 13, 0);
      box(lw * 0.72, 40, 4, mat(0x05070a, 0.2, 0.4, 0x1a2a4a, 0.6), 0, 48, 0);
      box(30, 4, 14, mat(0x111111), 0, 27, 0);
      break;
    }
    case 'table': {
      box(lw, 6, ld, wood, 0, 32, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(6, 30, 6, wood, sx * (lw / 2 - 8), 15, sz * (ld / 2 - 8));
      break;
    }
    case 'desk': {
      const dk = mat(0x5a3e24, 0.75);
      box(lw, 5, ld, wood, 0, 34, 0);
      box(5, 32, ld - 4, dk, -lw / 2 + 3, 16, 0); box(5, 32, ld - 4, dk, lw / 2 - 3, 16, 0);
      box(lw - 10, 20, 3, dk, 0, 22, -ld / 2 + 3);
      box(28, 18, 3, mat(0x08090c, 0.2, 0.4, 0x223a55, 0.7), -lw * 0.2, 47, -ld / 2 + 12);
      box(4, 8, 4, mat(0x222222), -lw * 0.2, 39, -ld / 2 + 12);
      break;
    }
    case 'plant': {
      const r = Math.min(lw, ld) * 0.3;
      cyl(r, r * 0.75, 20, 10, mat(0x9a5a3a, 0.9), 0, 10, 0);
      const leaf = [mat(0x2f6a2a, 0.9), mat(0x3a7a30, 0.9), mat(0x275a26, 0.9)];
      sph(r * 1.55, leaf[0], 0, 34, 0); sph(r * 1.2, leaf[1], r * 0.4, 48, -r * 0.2); sph(r * 1.0, leaf[2], -r * 0.3, 58, r * 0.2);
      break;
    }
    case 'crate': {
      const hh = clamp(Math.min(lw, ld) * 0.85, 34, 62), dark = mat(0x5a4222, 0.9);
      box(lw, hh, ld, mat(0x8a6a3a, 0.9), 0, hh / 2, 0);
      for (const y of [hh * 0.2, hh * 0.8]) box(lw + 1.2, 5, ld + 1.2, dark, 0, y, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(5, hh, 5, dark, sx * lw / 2, hh / 2, sz * ld / 2);
      box(lw + 1, 3, ld + 1, mat(0x9a7a44, 0.9), 0, hh + 1.5, 0);
      break;
    }
    case 'pillar': {
      if (lw >= 100) { // chimney stack
        box(lw, ceil, ld, mat(0x7a3a2a, 0.95), 0, ceil / 2, 0);
        box(lw + 8, 12, ld + 8, mat(0x4a2418, 0.95), 0, 6, 0);
        box(lw + 8, 10, ld + 8, mat(0x4a2418, 0.95), 0, ceil - 5, 0);
      } else if (def.id === 'attic') { // roof post
        box(lw, ceil, ld, mat(0x4a3320, 0.9), 0, ceil / 2, 0);
        box(lw + 6, 6, ld + 6, mat(0x33220f, 0.9), 0, 3, 0);
      } else if (def.id === 'manor') { // marble column
        const r = lw / 2 * 0.85, marble = mat(0xd8d0c8, 0.4, 0.1);
        cyl(r, r, ceil, 18, marble, 0, ceil / 2, 0);
        cyl(r * 1.3, r * 1.3, 10, 18, marble, 0, 5, 0); cyl(r * 1.3, r * 1.3, 12, 18, marble, 0, ceil - 6, 0);
      } else { // concrete support pillar
        box(lw, ceil, ld, mat(0x77787a, 0.95), 0, ceil / 2, 0);
        box(lw + 5, 8, ld + 5, mat(0x5a5b5e, 0.95), 0, 4, 0); box(lw + 5, 8, ld + 5, mat(0x5a5b5e, 0.95), 0, ceil - 4, 0);
      }
      break;
    }
    case 'boiler': {
      const r = lw / 2 * 0.9, steel = mat(0x6f7f86, 0.4, 0.7);
      cyl(r, r, 100, 20, steel, 0, 50, 0);
      cyl(r * 0.4, r, 14, 20, steel, 0, 107, 0);
      cyl(4, 4, ceil - 114, 8, mat(0x8a9aa0, 0.4, 0.7), 0, 114 + (ceil - 114) / 2, 0);
      cyl(3, 3, lw * 0.9, 8, mat(0x8a9aa0, 0.4, 0.7), 0, 80, 0, 0, Math.PI / 2);
      box(6, 6, 2, mat(0x440000, 0.4, 0.1, 0xff2a1a, 1.2), 0, 70, r + 1);
      break;
    }
    case 'trunk': {
      const gold = mat(0x9a8a4a, 0.4, 0.6);
      box(lw, 24, ld, mat(0x5a3a20, 0.85), 0, 12, 0);
      box(lw + 1, 8, ld + 1, mat(0x6a4526, 0.85), 0, 28, 0);
      for (const sx of [-1, 1]) box(5, 34, ld + 2.5, gold, sx * lw * 0.3, 17, 0);
      box(8, 8, 3, gold, 0, 24, ld / 2 + 1.5);
      break;
    }
    case 'tub': {
      box(lw, 34, ld, mat(0xe9e9e6, 0.3), 0, 17, 0);
      box(lw - 14, 1.5, ld - 14, mat(0xbfd9e8, 0.15, 0.1), 0, 34.8, 0);
      cyl(2, 2, 14, 8, mat(0xbbbbbb, 0.3, 0.9), lw / 2 - 14, 41, 0);
      break;
    }
    case 'washer': {
      box(lw, 64, ld, mat(0xe4e4e0, 0.4, 0.2), 0, 32, 0);
      const r = lw * 0.3;
      cyl(r + 3, r + 3, 2, 20, mat(0xbbbbbb, 0.3, 0.8), 0, 30, ld / 2 + 1, Math.PI / 2);
      cyl(r, r, 3, 20, mat(0x1a2a3a, 0.1, 0.6, 0x0a1a2a, 0.4), 0, 30, ld / 2 + 1.5, Math.PI / 2);
      box(lw - 8, 8, 2, mat(0x222233, 0.3, 0.4, 0x224488, 0.5), 0, 58, ld / 2 + 0.5);
      break;
    }
    default:
      box(lw, 60, ld, wood, 0, 30, 0);
  }

  const out = mergeGroup(g);
  out.position.set(wx(w.x + w.w / 2), 0, wz(w.y + w.h / 2));
  out.rotation.y = FACE_ROT[face];
  return out;
}

// ---------------------------------------------------------------------------
export function createHouse(scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight) {
  const env = new THREE.Group(); scene.add(env);
  const solids = new THREE.Group(); scene.add(solids);
  const owned: THREE.Texture[] = [];
  const glowTex = (() => {
    const [c, ctx] = makeCanvas(128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,225,160,0.9)'); g.addColorStop(1, 'rgba(255,225,160,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  let curDef: MapDef | null = null;
  let lampMat: THREE.MeshStandardMaterial | null = null;
  let lampGlows: THREE.Sprite[] = [];
  let lampBase = 1.4;
  let solidsKey = '';

  // Keep the dark, gap-hiding base plane under all floor patches.
  const under = new THREE.Mesh(new THREE.PlaneGeometry(W + 400, H + 400), new THREE.MeshBasicMaterial({ color: 0x0a0806 }));
  under.rotation.x = -Math.PI / 2; under.position.y = -0.6; scene.add(under);

  function applyMap(id: string): MapDef {
    const def = MAPS[id] ?? MAPS.house;
    if (curDef === def) return def;
    curDef = def; solidsKey = '';
    scene.background = new THREE.Color(def.ambient);
    scene.fog = new THREE.Fog(def.ambient, def.fog[0], def.fog[1]);
    hemi.color.set(def.hemiSky); hemi.groundColor.set(def.hemiGround); hemi.intensity = def.hemiI;
    sun.color.set(def.sunColor); sun.intensity = def.sunI;

    clearGroup(env); owned.forEach(t => t.dispose()); owned.length = 0; lampGlows = [];
    const ceil = def.ceilingH;

    // Floors, one patch per room
    for (const f of def.floors) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h),
        new THREE.MeshStandardMaterial({ map: floorTexture(f.type, f.w, f.h, owned), roughness: f.type === 'tile' || f.type === 'tileblue' || f.type === 'checker' ? 0.45 : 0.9, metalness: 0.03 }));
      m.rotation.x = -Math.PI / 2; m.position.set(wx(f.x + f.w / 2), 0, wz(f.y + f.h / 2)); m.receiveShadow = true;
      env.add(m);
    }
    // Rugs: a coloured rectangle with a lighter inset border
    const rugs = new THREE.Group();
    for (const r of def.rugs) {
      const col = new THREE.Color(r.color), light = col.clone().lerp(new THREE.Color(0xffffff), 0.28);
      for (const [inset, c, y] of [[0, col, 0.25], [12, light, 0.3], [24, col, 0.35]] as const) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(4, r.w - inset * 2), Math.max(4, r.h - inset * 2)),
          new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
        m.rotation.x = -Math.PI / 2; m.position.set(wx(r.x + r.w / 2), y, wz(r.y + r.h / 2)); m.receiveShadow = true;
        rugs.add(m);
      }
    }
    env.add(rugs);

    // Outer walls (wallpapered, full height) around the whole map
    const sides = [
      { cx: 0, cz: -H / 2 - 20, sx: W + 80, sz: 40 }, { cx: 0, cz: H / 2 + 20, sx: W + 80, sz: 40 },
      { cx: -W / 2 - 20, cz: 0, sx: 40, sz: H }, { cx: W / 2 + 20, cz: 0, sx: 40, sz: H },
    ];
    for (const s of sides) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.sx, ceil, s.sz), wallpaperMat(def.wallColor, Math.max(s.sx, s.sz)));
      m.position.set(s.cx, ceil / 2, s.cz); m.receiveShadow = true; env.add(m);
    }
    const trimMat = mat(def.trimColor, 0.7);
    const trim = new THREE.Group();
    const tb = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), trimMat); m.position.set(x, y, z); trim.add(m);
    };
    for (const [bw, bd, x, z] of [[W, 4, 0, -H / 2 + 2], [W, 4, 0, H / 2 - 2], [4, H, -W / 2 + 2, 0], [4, H, W / 2 - 2, 0]] as const) {
      tb(bw, 12, bd, x, 6, z);                  // baseboard
      tb(bw + (bd === 4 ? 0 : 0), 3, bd - 1, x, 46, z); // chair rail
      tb(bw, 8, bd + 1, x, ceil - 4, z);        // crown moulding
    }
    env.add(mergeGroup(trim));

    // Windows on the outer walls: pale moonlight through a frame
    if (def.windows) {
      const glass = mat(0x8fb0e0, 0.2, 0, 0x7fa0d8, 0.85), frame = mat(def.trimColor, 0.7);
      const wg = new THREE.Group();
      const ww = 110, wh = Math.min(80, ceil * 0.45), wy = ceil * 0.55;
      const addWindow = (x: number, z: number, rotY: number) => {
        const one = new THREE.Group();
        const add = (g: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => { const me = new THREE.Mesh(g, m); me.position.set(px, py, pz); one.add(me); };
        add(new THREE.BoxGeometry(ww + 12, wh + 12, 2), frame, 0, 0, 0.5);
        add(new THREE.PlaneGeometry(ww, wh), glass, 0, 0, 1.6);
        add(new THREE.BoxGeometry(ww, 3, 2), frame, 0, 0, 2); add(new THREE.BoxGeometry(3, wh, 2), frame, 0, 0, 2);
        add(new THREE.BoxGeometry(ww + 22, 5, 5), frame, 0, -wh / 2 - 8, 3); // sill
        one.position.set(x, wy, z); one.rotation.y = rotY; wg.add(one);
      };
      for (let i = 0; i < 5; i++) { const x = -W / 2 + 260 + i * 420; addWindow(x, -H / 2, 0); addWindow(x, H / 2, Math.PI); }
      for (let i = 0; i < 3; i++) { const z = -H / 2 + 260 + i * 440; addWindow(-W / 2, z, Math.PI / 2); addWindow(W / 2, z, -Math.PI / 2); }
      env.add(mergeGroup(wg));
    }

    // Ceiling + ceiling details
    const ceilMesh = new THREE.Mesh(new THREE.PlaneGeometry(W + 80, H + 80), mat(def.ceilingColor, 0.95));
    ceilMesh.rotation.x = Math.PI / 2; ceilMesh.position.y = ceil; env.add(ceilMesh);
    const cd = new THREE.Group();
    const cb = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m); me.position.set(x, y, z); cd.add(me);
    };
    if (def.id === 'attic') { // rafters
      const beam = mat(0x3a2716, 0.9);
      for (let z = -H / 2 + 120; z < H / 2; z += 300) cb(W, 14, 14, beam, 0, ceil - 7, z);
      for (let x = -W / 2 + 200; x < W / 2; x += 600) cb(14, 14, H, beam, x, ceil - 21, 0);
    } else if (def.id === 'basement') { // exposed pipes
      const pipe = new THREE.CylinderGeometry(5, 5, W, 8), pm = mat(0x8a8f92, 0.4, 0.7);
      for (const z of [-H / 4, H / 8, H / 3]) { const m = new THREE.Mesh(pipe, pm); m.rotation.z = Math.PI / 2; m.position.set(0, ceil - 12, z); cd.add(m); }
      for (let x = -W / 2 + 200; x < W / 2; x += 400) cb(10, 14, H, mat(0x3a3f44, 0.6, 0.5), x, ceil - 8, 0);
    } else if (def.id === 'manor') { // coffered ceiling beams
      const beam = mat(0x2e2016, 0.8);
      for (let z = -H / 2 + 230; z < H / 2; z += 465) cb(W, 12, 22, beam, 0, ceil - 6, z);
    }
    env.add(mergeGroup(cd));

    // Lamps: a few per room, hanging shade (or a fluorescent tube in the basement)
    lampBase = def.id === 'basement' ? 1.2 : def.id === 'attic' ? 1.1 : 1.5;
    lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: def.id === 'basement' ? 0xbfe0ff : 0xffd890, emissiveIntensity: lampBase, roughness: 0.4 });
    const lamps = new THREE.Group();
    for (const f of def.floors) {
      const n = Math.max(1, Math.round((f.w * f.h) / 700000));
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * f.w / f.h))), rows = Math.max(1, Math.ceil(n / cols));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const lx = wx(f.x + f.w * (c + 0.5) / cols), lz = wz(f.y + f.h * (r + 0.5) / rows);
        if (def.id === 'basement') {
          const t = new THREE.Mesh(new THREE.BoxGeometry(70, 4, 10), lampMat); t.position.set(lx, ceil - 4, lz); lamps.add(t);
        } else {
          const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 12, 4), trimMat); cord.position.set(lx, ceil - 6, lz); lamps.add(cord);
          const shade = new THREE.Mesh(new THREE.CylinderGeometry(9, 18, 10, 12), lampMat); shade.position.set(lx, ceil - 16, lz); lamps.add(shade);
        }
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.45,
          color: def.id === 'basement' ? 0x9fc8ff : 0xffe0a0,
        }));
        spr.scale.set(150, 150, 1); spr.position.set(lx, ceil - 22, lz); lamps.add(spr); lampGlows.push(spr);
      }
    }
    env.add(lamps);
    return def;
  }

  // Rebuild every solid (partition walls + furniture) from the server's wall list.
  function rebuildSolids(walls: Wall[]) {
    if (!curDef) return;
    const key = curDef.id + '#' + walls.map(w => `${w.kind ?? 'wall'},${w.x},${w.y},${w.w},${w.h},${w.face ?? ''}`).join('|');
    if (key === solidsKey) return;
    solidsKey = key;
    clearGroup(solids);
    const def = curDef, trimMat = mat(def.trimColor, 0.7);
    const trim = new THREE.Group();
    for (const w of walls) {
      const cx = wx(w.x + w.w / 2), cz = wz(w.y + w.h / 2);
      if (!w.kind || w.kind === 'wall') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, PART_H, w.h), wallpaperMat(def.wallColor, Math.max(w.w, w.h)));
        m.position.set(cx, PART_H / 2, cz); m.castShadow = true; m.receiveShadow = true; solids.add(m);
        const base = new THREE.Mesh(new THREE.BoxGeometry(w.w + 1.6, 10, w.h + 1.6), trimMat); base.position.set(cx, 5, cz); trim.add(base);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 1.6, 3, w.h + 1.6), trimMat); cap.position.set(cx, PART_H + 1.5, cz); trim.add(cap);
      } else {
        solids.add(buildSolid(w, def, walls));
      }
    }
    const tm = mergeGroup(trim); solids.add(tm);
  }

  function update(t: number) {
    if (!lampMat || !curDef) return;
    let k = 1;
    if (curDef.id === 'basement') { // tubes stutter now and then
      const s = Math.sin(t * 2.1) * Math.sin(t * 5.3) + Math.sin(t * 0.7);
      k = s > 1.25 ? 0.25 + 0.5 * Math.abs(Math.sin(t * 40)) : 1;
    } else if (curDef.id === 'attic') { k = 0.85 + 0.15 * Math.sin(t * 1.3) * Math.sin(t * 0.37);
    } else k = 0.97 + 0.03 * Math.sin(t * 0.8);
    lampMat.emissiveIntensity = lampBase * k;
    for (const s of lampGlows) s.material.opacity = 0.45 * k;
  }

  return { applyMap, rebuildSolids, update, get def() { return curDef; } };
}
