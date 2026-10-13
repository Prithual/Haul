import * as THREE from 'three';
import { ClientMsg, H, Snapshot, UpgradeKey, W, ZONE } from '../src/shared';
import { handleServerMsg, initChat, updateVoice } from './chat';

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
let myId = '', roomCode = '';
let snap: Snapshot | null = null;
const send = (m: ClientMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

// ---------- Lobby ----------
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const lobby = $('lobby'), nameIn = $('name'), codeIn = $('code'), errEl = $('err');
try { nameIn.value = localStorage.getItem('haul-name') || ''; } catch {}
codeIn.value = (new URLSearchParams(location.search).get('room') || '').toUpperCase();

ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.t === 'hello') {
    myId = m.id; roomCode = m.room;
    lobby.style.display = 'none';
    history.replaceState(null, '', `?room=${m.room}`); // share this link to invite friends
  } else if (m.t === 'error') errEl.textContent = m.msg;
  else if (m.t === 'state') snap = m;
  else if (m.t === 'chat' || m.t === 'rtc') handleServerMsg(m); // text chat + voice signaling
};
ws.onclose = () => { lobby.style.display = 'flex'; errEl.textContent = 'Connection lost. Refresh the page to reconnect.'; document.exitPointerLock?.(); };

function join(room: string) {
  const name = nameIn.value.trim();
  if (!name) { errEl.textContent = 'Enter your name first.'; return; }
  try { localStorage.setItem('haul-name', name); } catch {}
  errEl.textContent = '';
  send({ t: 'join', name, room });
}
$('create').onclick = () => join('');
$('join').onclick = () => {
  if (codeIn.value.trim().length < 4) errEl.textContent = 'Enter the 4-letter room code.';
  else join(codeIn.value);
};

// ---------- 3D scene ----------
const stage = document.getElementById('stage')!;
const scene = new THREE.Scene();
// Warm near-black brown, instead of a cold blue-black void, so the space beyond
// the walls reads as dim indoor darkness rather than open sky.
const AMBIENT_BG = 0x15100c;
scene.background = new THREE.Color(AMBIENT_BG);
scene.fog = new THREE.Fog(AMBIENT_BG, 260, 1500);

const EYE_HEIGHT = 46;
const TP_DIST = 220, TP_HEIGHT = 70; // third-person chase camera offset
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.5, 5000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Lighting ----------
// Warm amber tones throughout, standing in for lamplight/bounce off wood and
// plaster rather than cool outdoor sky light — reads as an interior.
scene.add(new THREE.HemisphereLight(0xffdca8, 0x1a120c, 0.55));
// The sun is repositioned every frame to stay centered on the player, with a
// shadow frustum just big enough to cover the nearby room — a directional
// light fixed to the whole 1600x1000 map would need a huge, blurry frustum.
const sun = new THREE.DirectionalLight(0xffcf8a, 1.15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 50;
sun.shadow.camera.far = 1400;
sun.shadow.camera.left = -520; sun.shadow.camera.right = 520;
sun.shadow.camera.top = 520; sun.shadow.camera.bottom = -520;
sun.shadow.bias = -0.0004;
sun.target.position.set(0, 0, 0);
scene.add(sun); scene.add(sun.target);

// Faint bounce light near the extraction zone so it reads as a landmark even from a distance.
const zoneLight = new THREE.PointLight(0x3cc878, 1.2, 480, 2);
zoneLight.position.set(0, 90, 0);
scene.add(zoneLight);

// ---------- Night sky ----------
// A gradient dome standing in for the "outside darkness" beyond the walls,
// with a hand-rolled hash-noise starfield baked into the fragment shader (no
// texture assets) and a warm low moon. The bottom color matches AMBIENT_BG
// so the dome blends seamlessly into the fog at the horizon.
const skyUniforms = {
  topColor: { value: new THREE.Color(0x030209) },
  bottomColor: { value: new THREE.Color(AMBIENT_BG) },
  offset: { value: 60 },
  exponent: { value: 0.55 },
  uTime: { value: 0 },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform float offset;
    uniform float exponent;
    uniform float uTime;
    varying vec3 vWorldPosition;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
    void main() {
      vec3 dir = normalize(vWorldPosition + vec3(0.0, offset, 0.0));
      float h = dir.y;
      vec3 sky = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
      if (h > 0.05) {
        vec3 cell = floor(dir * 220.0);
        float r = hash(cell);
        float twinkle = 0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 30.0);
        float star = step(0.9935, r) * twinkle * smoothstep(0.05, 0.4, h);
        sky += vec3(star);
      }
      gl_FragColor = vec4(sky, 1.0);
    }
  `,
  side: THREE.BackSide,
  fog: false,
  depthWrite: false,
});
// Follows the player (like a skybox) so it always reads as infinitely far away.
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(4200, 24, 16), skyMat);
scene.add(skyDome);

function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const moon = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,207,138,0.95)', 'rgba(255,207,138,0)'),
  transparent: true, depthWrite: false, depthTest: false,
}));
moon.scale.set(340, 340, 1);
const moonBaseOffset = { x: -2200, y: 1050, z: -2600 };
scene.add(moon);

function makeCloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 6; i++) {
    const cx = 40 + Math.random() * 176, cy = 45 + Math.random() * 45, r = 30 + Math.random() * 42;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(60,52,58,0.55)');
    g.addColorStop(1, 'rgba(60,52,58,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
const clouds: THREE.Sprite[] = [];
for (let i = 0; i < 16; i++) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeCloudTexture(), transparent: true, depthWrite: false, opacity: 0.6,
  }));
  const scale = 480 + Math.random() * 420;
  spr.scale.set(scale, scale * 0.5, 1);
  spr.userData = {
    angle: Math.random() * Math.PI * 2,
    radius: 1900 + Math.random() * 1500,
    height: 620 + Math.random() * 380,
    speed: 0.0005 + Math.random() * 0.0006,
  };
  cloudGroup.add(spr);
  clouds.push(spr);
}

// Sky/moon/clouds are positioned relative to the player each frame (like a
// skybox) rather than fixed to world space, so they never appear to run out.
const lastMeWorld = { x: 0, z: 0 };
function updateSkyAnimation(t: number) {
  skyUniforms.uTime.value = t;
  skyDome.position.set(lastMeWorld.x, 0, lastMeWorld.z);
  moon.position.set(lastMeWorld.x + moonBaseOffset.x, moonBaseOffset.y, lastMeWorld.z + moonBaseOffset.z);
  for (const spr of clouds) {
    spr.userData.angle += spr.userData.speed;
    spr.position.set(
      lastMeWorld.x + Math.cos(spr.userData.angle) * spr.userData.radius,
      spr.userData.height,
      lastMeWorld.z + Math.sin(spr.userData.angle) * spr.userData.radius,
    );
  }
}

// Procedural floor texture (no external assets) — worn wood planks instead of concrete.
function makeFloorTexture(): THREE.CanvasTexture {
  const size = 512, plankW = 64;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5a1414'; ctx.fillRect(0, 0, size, size);
  // Subtle grain speckle, red tones to match the stained-red plank color.
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${140 + Math.random() * 80},${20 + Math.random() * 25},${20 + Math.random() * 25},${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, Math.random() * 3, Math.random() * 3);
  }
  // Plank seams: vertical joints plus staggered horizontal joints per row.
  ctx.strokeStyle = 'rgba(25,5,5,0.5)'; ctx.lineWidth = 2;
  for (let i = 0; i <= size; i += plankW) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke(); }
  const rowH = 128;
  for (let row = 0, y = 0; y <= size; y += rowH, row++) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    const offset = row % 2 ? plankW / 2 : 0;
    for (let x = offset; x < size; x += plankW * 2) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, Math.min(size, y + rowH)); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((W + 1000) / 256, (H + 1000) / 256);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(W + 1000, H + 1000),
  new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.95, metalness: 0.05 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// A grass yard, well outside the wood-floored interior, gives the distant
// houses somewhere to actually stand instead of floating over bare fog.
function makeGrassTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2c4a24'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    const g = 60 + Math.random() * 70;
    ctx.fillStyle = `rgba(${g * 0.55},${g},${g * 0.4},${0.15 + Math.random() * 0.2})`;
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillRect(x, y, 1, 2 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(7000, 7000),
  new THREE.MeshStandardMaterial({ map: makeGrassTexture(), roughness: 1 }),
);
grass.rotation.x = -Math.PI / 2;
grass.position.y = -0.2; // just under the interior floor, so it never z-fights the wood
grass.receiveShadow = true;
scene.add(grass);

// Ceiling — caps the room from above so looking up shows a low roof instead of
// open fog/void, which is a big part of what makes a space read as "indoors."
const ceiling = new THREE.Mesh(
  new THREE.PlaneGeometry(W + 1000, H + 1000),
  new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.95 }),
);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 150;
scene.add(ceiling);

// Map game coordinates (x right, y down, origin top-left) to three.js world
// coordinates (x right, z "forward"). Y is height/up.
const toWorld = (x: number, y: number) => new THREE.Vector3(x - W / 2, 0, y - H / 2);

const zoneMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(ZONE.w, ZONE.h),
  new THREE.MeshStandardMaterial({ color: 0x3cc878, transparent: true, opacity: 0.35, emissive: 0x1f6b3a, roughness: 0.6 }),
);
zoneMesh.rotation.x = -Math.PI / 2;
zoneMesh.position.y = 0.5;
zoneMesh.receiveShadow = true;
{ const c = toWorld(ZONE.x + ZONE.w / 2, ZONE.y + ZONE.h / 2); zoneMesh.position.set(c.x, 0.5, c.z); }
scene.add(zoneMesh);

// Ray used to find where the camera is actually looking on the ground, for throw/grab aim.
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();

// ---------- Background scenery: distant houses ----------
// Purely decorative, no external assets — sits well outside the play area so
// it never interferes with collision or gameplay. Gives the void beyond the
// walls something to read as "outside" instead of empty fog.
const sceneryGroup = new THREE.Group(); scene.add(sceneryGroup);
const houseWindowMat = new THREE.MeshStandardMaterial({ color: 0xffcf7a, emissive: 0xffcf7a, emissiveIntensity: 0.9, roughness: 0.4 });
// Every house: yellow walls, brown roof.
const HOUSE_WALL_COLOR = 0xd9a828, HOUSE_ROOF_COLOR = 0x5a3a22;

function makeHouse(width: number, depth: number, wallHeight: number, roofHeight: number): THREE.Group {
  const houseWallMat = new THREE.MeshStandardMaterial({ color: HOUSE_WALL_COLOR, roughness: 0.9 });
  const houseRoofMat = new THREE.MeshStandardMaterial({ color: HOUSE_ROOF_COLOR, roughness: 0.85 });
  const g = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), houseWallMat);
  walls.position.y = wallHeight / 2;
  g.add(walls);

  // A 4-sided cone makes a simple pyramid roof; rotate 45° so its faces align with the box.
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(width, depth) * 0.62, roofHeight, 4), houseRoofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = wallHeight + roofHeight / 2;
  g.add(roof);

  // A couple of glowing windows so the silhouette still reads as a house at a distance.
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.16, wallHeight * 0.3), houseWindowMat);
    win.position.set(side * width * 0.25, wallHeight * 0.55, depth / 2 + 0.5);
    g.add(win);
  }
  return g;
}

// Half-extent of the interior building footprint, in three.js units — used
// to keep all outdoor scenery (houses, trees) safely clear of the walls,
// however big the map is.
const BUILDING_HALF_X = W / 2 + 550, BUILDING_HALF_Z = H / 2 + 550;

// Scatter a handful of houses in a ring beyond the map, near the far edge of
// the fog range, so they emerge as a faint skyline rather than popping into view.
const HOUSE_RING_R = Math.hypot(BUILDING_HALF_X, BUILDING_HALF_Z) + 250;
const houseLayout: Array<[number, number, number, number]> = [
  [900, 700, 220, 140], [700, 620, 260, 160], [1000, 800, 200, 130],
  [800, 700, 240, 150], [950, 750, 210, 135],
];
const housePositions: Array<{ x: number; z: number }> = [];
houseLayout.forEach((dims, i) => {
  const angle = (i / houseLayout.length) * Math.PI * 2 + 0.3;
  const house = makeHouse(...dims);
  house.position.set(Math.cos(angle) * HOUSE_RING_R, 0, Math.sin(angle) * HOUSE_RING_R);
  house.rotation.y = -angle + Math.PI / 2;
  sceneryGroup.add(house);
  housePositions.push({ x: house.position.x, z: house.position.z });
});

// ---------- Background scenery: trees ----------
// Same idea as the houses — purely decorative, scattered around the yard
// beyond the walls so the "outside" reads as a wooded area, not empty ground.
const treeGroup = new THREE.Group(); scene.add(treeGroup);
const swayTrees: THREE.Group[] = [];
const TREE_TRUNK_COLORS = [0x2e2924, 0x333d08, 0x2c2621]; // brownish bark variants
const TREE_FOLIAGE_COLORS = [0x2f5c2a, 0x274d26, 0x375528, 0x243f28]; // dark, muted greens

function makeTree(): THREE.Group {
  const trunkH = 55 + Math.random() * 45;
  const trunkR = 5 + Math.random() * 3;
  const trunkMat = new THREE.MeshStandardMaterial({
    color: TREE_TRUNK_COLORS[Math.floor(Math.random() * TREE_TRUNK_COLORS.length)], roughness: 0.95,
  });
  const foliageMat = new THREE.MeshStandardMaterial({
    color: TREE_FOLIAGE_COLORS[Math.floor(Math.random() * TREE_FOLIAGE_COLORS.length)], roughness: 0.9,
  });
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.55, trunkR, trunkH, 6), trunkMat);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true; trunk.receiveShadow = true;
  g.add(trunk);

  // Three stacked, tapering cones make a simple pine silhouette.
  const foliage = new THREE.Group();
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const r = 46 - i * 10 + Math.random() * 8;
    const h = 60 - i * 9;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), foliageMat);
    cone.position.y = trunkH + i * 30 + h / 2 - 8;
    cone.castShadow = true; cone.receiveShadow = true;
    foliage.add(cone);
  }
  g.add(foliage);
  g.userData = {
    foliage,
    swayPhase: Math.random() * Math.PI * 2,
    swaySpeed: 0.5 + Math.random() * 0.5,
    swayAmp: 0.02 + Math.random() * 0.025,
  };
  return g;
}

// Keep trees out of the indoor building footprint and off the houses themselves.
function isTreeSpotBlocked(x: number, z: number): boolean {
  if (Math.abs(x) < BUILDING_HALF_X && Math.abs(z) < BUILDING_HALF_Z) return true;
  for (const hp of housePositions) {
    const dx = x - hp.x, dz = z - hp.z;
    if (dx * dx + dz * dz < 300 * 300) return true;
  }
  return false;
}
function scatterTrees(count: number, maxRadius: number) {
  let placed = 0, attempts = 0;
  while (placed < count && attempts < count * 8) {
    attempts++;
    const x = (Math.random() * 2 - 1) * maxRadius;
    const z = (Math.random() * 2 - 1) * maxRadius;
    if (Math.hypot(x, z) > maxRadius) continue;
    if (isTreeSpotBlocked(x, z)) continue;
    const tree = makeTree();
    tree.scale.setScalar(0.45 + Math.random() * 0.35);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.position.set(x, 0, z);
    treeGroup.add(tree);
    swayTrees.push(tree);
    placed++;
  }
}
scatterTrees(220, 3000);

// Gentle per-tree wind sway, applied to the foliage group only (trunks stay put).
function updateTreeSway(t: number) {
  for (const tree of swayTrees) {
    const ud = tree.userData;
    const s = Math.sin(t * ud.swaySpeed + ud.swayPhase) * ud.swayAmp;
    ud.foliage.rotation.z = s;
    ud.foliage.rotation.x = s * 0.6;
  }
}

const wallGroup = new THREE.Group(); scene.add(wallGroup);
let wallSignature = '';
// A small palette of muted "room paint" colors, cycled per wall, so the
// interior isn't one uniform color throughout.
const WALL_PALETTE = [0x4a3626, 0x3a4a36, 0x4a3a4a, 0x364a4a, 0x4a4436, 0x5a3a30];
const wallMats = WALL_PALETTE.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.05 }));

const itemGroup = new THREE.Group(); scene.add(itemGroup);
const ITEM_R = 10;
const itemGeo = new THREE.SphereGeometry(1, 16, 16); // unit sphere; scaled per item by its own radius
const itemMeshes = new Map<number, THREE.Mesh>();

const monsterGroup = new THREE.Group(); scene.add(monsterGroup);
const monsterMeshes = new Map<number, THREE.Object3D>();

// A "screamer" gets an actual ghost shape — rounded dome + open-ended body +
// a ring of small lobes standing in for a scalloped, wavy hem — instead of a
// plain octahedron. All body parts share one material so color/opacity can be
// updated in one place each frame; eyes stay solid and untouched.
// The body material's alphaMap is a soft, uneven canvas texture rather than a
// flat opacity value, so the ghost reads as wispy/tattered instead of a
// uniformly see-through solid — its actual "skin".
function makeWispTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 128, 128); // fully opaque base
  ctx.globalCompositeOperation = 'destination-out'; // punch soft holes into it
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * 128, y = Math.random() * 128, r = 8 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2); // tiled so the small lobe spheres get real detail too, not one huge blotch
  return tex;
}
function makeGhostMesh(): THREE.Group {
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x724488, emissive: 0x724488, emissiveIntensity: 0.15,
    transparent: true, opacity: 0.55, roughness: 0.35, side: THREE.DoubleSide, depthWrite: false,
    alphaMap: makeWispTexture(),
  });
  const g = new THREE.Group();
  g.userData.kind = 'screamer';
  g.userData.bodyMat = bodyMat;

  const dome = new THREE.Mesh(new THREE.SphereGeometry(20, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
  dome.position.y = 13;
  g.add(dome);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(20, 18, 26, 16, 1, true), bodyMat);
  body.position.y = -13;
  g.add(body);

  const lobeCount = 7;
  for (let i = 0; i < lobeCount; i++) {
    const a = (i / lobeCount) * Math.PI * 2;
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 8), bodyMat);
    lobe.position.set(Math.cos(a) * 17, i % 2 ? -22 : -26, Math.sin(a) * 17);
    g.add(lobe);
  }

  // Faintly glowing eyes read better in the dark than flat solid black.
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x120014, emissive: 0x8822aa, emissiveIntensity: 0.5 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 8), eyeMat);
    eye.position.set(side * 7, 12, 17);
    g.add(eye);
  }
  return g;
}

function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const m = child.material;
      if (Array.isArray(m)) m.forEach(mm => mm.dispose()); else m.dispose();
    }
  });
}
function disposeMonsterVisual(obj: THREE.Object3D) {
  monsterGroup.remove(obj);
  disposeObject3D(obj);
}

// A "hunter" gets a hunched, four-limbed predator shape — legs, a tapered
// torso, a pointed head, clawed arms angled forward, and a few spine spikes —
// instead of a plain cone. Origin sits at the feet so it stands on the floor.
function makeHunterMesh(): THREE.Group {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x993333, emissive: 0x993333, emissiveIntensity: 0.12, roughness: 0.5 });
  const g = new THREE.Group();
  g.userData.kind = 'hunter';
  g.userData.bodyMat = bodyMat;

  // Legs/arms pivot from their joint (hip/shoulder), not their middle, so the
  // walk cycle swings them naturally instead of spinning around the limb.
  const legs: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const legGeo = new THREE.CylinderGeometry(4, 4, 20, 6);
    legGeo.translate(0, -10, 0); // local origin -> hip
    const leg = new THREE.Mesh(legGeo, bodyMat);
    leg.position.set(side * 6, 20, 0);
    g.add(leg);
    legs.push(leg);
  }
  g.userData.legs = legs;

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(10, 14, 30, 8), bodyMat);
  torso.position.y = 35;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.ConeGeometry(11, 16, 6), bodyMat);
  head.position.y = 58;
  g.add(head);

  const arms: THREE.Mesh[] = [];
  const armBaseX: number[] = [];
  for (const side of [-1, 1]) {
    const armGeo = new THREE.CylinderGeometry(3, 3, 24, 6);
    armGeo.translate(0, -12, 0); // local origin -> shoulder
    const arm = new THREE.Mesh(armGeo, bodyMat);
    arm.position.set(side * 16, 52, 6); // shoulder height; arm hangs/reaches down from here
    arm.rotation.x = -0.6; // resting forward reach
    arm.rotation.z = side * 0.35;
    g.add(arm);
    arms.push(arm);
    armBaseX.push(-0.6);
  }
  g.userData.arms = arms;
  g.userData.armBaseX = armBaseX;

  // Spine spikes, tilted back, for a more menacing silhouette.
  [35, 45, 55].forEach((y, i) => {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 4), bodyMat);
    spike.position.set(0, y, -11 + i * 0.5);
    spike.rotation.x = -0.5;
    g.add(spike);
  });

  g.traverse((child: THREE.Object3D) => { if (child instanceof THREE.Mesh) child.castShadow = true; });
  return g;
}

// A player gets a simple humanoid shape — legs, torso, head, arms — instead
// of a plain capsule. Origin sits at the feet so it stands on the floor.
// Leg/arm geometry is shifted so each mesh's local origin sits at its joint
// (hip / shoulder), so rotating it for a walk cycle swings naturally from
// that joint instead of spinning around the limb's middle.

// Deterministic small-int hash of a string, used to pick a stable skin tone
// and outfit color per player id — same player always looks the same, and
// different players are visually distinguishable from across the room.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const SKIN_TONES = [0xf1c8a0, 0xe0ac7e, 0xc68a5f, 0x9c6b46, 0x6f4a30, 0x4a3222];
const OUTFIT_COLORS = [0x3b6ea5, 0xa53b3b, 0x3ba55c, 0xa5843b, 0x6b3ba5, 0x3ba5a0, 0xa53b8f, 0x707070];
const DEAD_TINT = new THREE.Color(0x333333);
const DEAD_TINT_AMOUNT = 0.65;

// A small canvas "face" — skin-tone base, two eyes, a mouth — mapped onto the
// head sphere so characters read as people instead of blank mannequins.
// SphereGeometry's UVs put the front (+Z, this game's "forward") at u≈0.25,
// so the face is drawn a quarter of the way across the canvas, not centered.
function makeFaceTexture(skinHex: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `#${skinHex.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 128, 64);
  const cx = 32, cy = 30;
  ctx.fillStyle = '#1a1410';
  ctx.beginPath(); ctx.arc(cx - 7, cy, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 7, cy, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1a1410'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 6, cy + 12); ctx.lineTo(cx + 6, cy + 12); ctx.stroke();
  return new THREE.CanvasTexture(c);
}

function makePlayerMesh(id: string): THREE.Group {
  const skinColor = SKIN_TONES[hashStr(id) % SKIN_TONES.length];
  const outfitColor = OUTFIT_COLORS[hashStr(id + '#') % OUTFIT_COLORS.length];
  const pantsColor = new THREE.Color(outfitColor).multiplyScalar(0.5).getHex(); // darker version of the outfit color

  const skinMat = new THREE.MeshStandardMaterial({ map: makeFaceTexture(skinColor), roughness: 0.8 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.6 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.7 });

  const g = new THREE.Group();
  // Kept as a live reference to whichever material stands in for "overall
  // tint" (the shirt) — used for the fallback dead/downed check elsewhere.
  g.userData.bodyMat = shirtMat;
  g.userData.skinMat = skinMat;
  g.userData.shirtMat = shirtMat;
  g.userData.pantsMat = pantsMat;
  g.userData.baseShirt = shirtMat.color.clone();
  g.userData.basePants = pantsMat.color.clone();

  const legs: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const legGeo = new THREE.CylinderGeometry(3, 3, 20, 6);
    legGeo.translate(0, -10, 0); // local origin -> top of the leg (the hip)
    const leg = new THREE.Mesh(legGeo, pantsMat);
    leg.position.set(side * 5, 20, 0); // hip height; leg hangs down to the floor
    g.add(leg);
    legs.push(leg);
  }
  g.userData.legs = legs;

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 26, 8), shirtMat);
  torso.position.y = 33;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 10), skinMat);
  head.position.y = 55;
  g.add(head);

  const arms: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const armGeo = new THREE.CylinderGeometry(2.5, 2.5, 22, 6);
    armGeo.translate(0, -11, 0); // local origin -> top of the arm (the shoulder)
    const arm = new THREE.Mesh(armGeo, shirtMat);
    arm.position.set(side * 13, 47, 0); // shoulder height; arm hangs down
    g.add(arm);
    arms.push(arm);
  }
  g.userData.arms = arms;
  g.userData.armBaseX = [0, 0]; // no resting tilt — arms hang straight down

  g.traverse((child: THREE.Object3D) => { if (child instanceof THREE.Mesh) child.castShadow = true; });
  return g;
}



const playerGroup = new THREE.Group(); scene.add(playerGroup);
interface PlayerVisual { mesh: THREE.Group; barGroup: THREE.Group; hpFg: THREE.Mesh; nameSprite: THREE.Sprite }
const playerVisuals = new Map<string, PlayerVisual>();

function makeNameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 12), 128, 34);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  spr.scale.set(64, 16, 1);
  return spr;
}
function makeHealthBar() {
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(34, 5), new THREE.MeshBasicMaterial({ color: 0x330000, depthTest: false }));
  const fgGeo = new THREE.PlaneGeometry(32, 3.5);
  fgGeo.translate(16, 0, 0); // anchor the left edge so scale.x shrinks from the left
  const fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0x33cc55, depthTest: false }));
  fg.position.x = -16;
  const g = new THREE.Group(); g.add(bg); g.add(fg);
  return { group: g, fg };
}

// Simple viewmodel: whatever you're holding floats in view so you can see it,
// since (unlike third person) your own body isn't rendered.
const heldViewMesh = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 12), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.15 }));
heldViewMesh.visible = false;
camera.add(heldViewMesh);
heldViewMesh.position.set(16, -14, -45); // world units, relative to the camera: lower-right, out in front
scene.add(camera);

// ---------- Look (mouse-look via Pointer Lock, first person) ----------
let yaw = -Math.PI / 2, pitch = -0.15; // start facing "down" the map (+y/south)
const PITCH_MIN = -1.25, PITCH_MAX = 1.3;
const SENSITIVITY = 0.0024;
const MAX_MOVE_DELTA = 120; // px per event — clamps the occasional huge/erratic
                             // movementX/Y some browsers report, which otherwise
                             // whip the camera around in one frame
let locked = false;
let justLocked = false; // the first mousemove right after (re)acquiring lock can
                         // carry a large stale delta and make the view jump/snap

function requestLock() { renderer.domElement.requestPointerLock?.(); }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) justLocked = true;
});
document.addEventListener('pointerlockerror', () => { locked = false; });
renderer.domElement.addEventListener('click', () => { if (!locked && lobby.style.display === 'none') requestLock(); });
addEventListener('mousemove', e => {
  if (!locked) return;
  if (justLocked) { justLocked = false; return; }
  const mx = Math.max(-MAX_MOVE_DELTA, Math.min(MAX_MOVE_DELTA, e.movementX));
  const my = Math.max(-MAX_MOVE_DELTA, Math.min(MAX_MOVE_DELTA, e.movementY));
  yaw += mx * SENSITIVITY; // '+=' here, not '-=': with how `dir`/lookAt below is built,
                            // '-=' turned the camera opposite the mouse (left felt like right)
  pitch -= my * SENSITIVITY;
  pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
});
renderer.domElement.addEventListener('mousedown', () => { if (locked) send({ t: 'throw' }); });

// ---------- Input: keyboard (desktop) ----------
const keys = new Set<string>();
let thirdPerson = false;
addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return; // typing in the lobby
  const k = e.key.toLowerCase();
  if (!keys.has(k) && k === 'e') send({ t: 'grab' });
  if (!keys.has(k) && k === 'v') thirdPerson = !thirdPerson;
  if (e.code === 'Space') { e.preventDefault(); send({ t: 'throw' }); }
  keys.add(k);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

// ---------- Text + proximity voice chat (see chat.ts) ----------
initChat({ send: m => send(m as ClientMsg), getMyId: () => myId, lock: () => requestLock() });
const held = (...k: string[]) => (k.some(x => keys.has(x)) ? 1 : 0);

// ---------- Touch controls (mobile) ----------
// No pointer lock on touch: the aim stick drives yaw directly, and pitch stays level.
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

function makeStick(baseId: string, knobId: string, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
  const base = document.getElementById(baseId)!, knob = document.getElementById(knobId)!;
  let active = -1, cx = 0, cy = 0;
  const R = 44;
  const set = (dx: number, dy: number) => { knob.style.transform = `translate(${dx}px,${dy}px)`; };
  base.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    active = t.identifier;
    const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
  }, { passive: false });
  addEventListener('touchmove', e => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== active) continue;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(d, R);
      dx = dx / d * clamped; dy = dy / d * clamped;
      set(dx, dy);
      onMove(dx / R, dy / R);
    }
  }, { passive: false });
  addEventListener('touchend', e => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== active) continue;
      active = -1; set(0, 0); onEnd();
    }
  });
}

let moveStick = { dx: 0, dy: 0 };
let isMoving = false;
makeStick('moveBase', 'moveKnob', (dx, dy) => { moveStick = { dx, dy }; }, () => { moveStick = { dx: 0, dy: 0 }; });
makeStick('aimBase', 'aimKnob', (dx, dy) => {
  if (Math.hypot(dx, dy) > 0.15) yaw = Math.atan2(dy, dx);
}, () => {});

document.getElementById('grabBtn')?.addEventListener('touchstart', e => { e.preventDefault(); send({ t: 'grab' }); }, { passive: false });
document.getElementById('throwBtn')?.addEventListener('touchstart', e => { e.preventDefault(); send({ t: 'throw' }); }, { passive: false });
document.getElementById('viewBtn')?.addEventListener('touchstart', e => { e.preventDefault(); thirdPerson = !thirdPerson; }, { passive: false });

// ---------- Movement + aim, sent to the server ----------
// Forward/right are derived from the look direction (yaw), so WASD is
// relative to where you're facing, like a normal first-person game.
setInterval(() => {
  const forwardInput = (held('w', 'arrowup') - held('s', 'arrowdown')) || -moveStick.dy;
  const strafeInput = (held('d', 'arrowright') - held('a', 'arrowleft')) || moveStick.dx;
  const fx = Math.cos(yaw), fy = Math.sin(yaw); // forward, in game (x,y) space
  const rx = -fy, ry = fx; // right
  const dx = fx * forwardInput + rx * strafeInput;
  const dy = fy * forwardInput + ry * strafeInput;
  isMoving = forwardInput !== 0 || strafeInput !== 0;

  // Aim point: where the camera's actual look direction (yaw+pitch) meets the ground.
  const dir = new THREE.Vector3(Math.cos(pitch) * fx, Math.sin(pitch), Math.cos(pitch) * fy);
  const origin = camera.position.clone();
  raycaster.set(origin, dir);
  const hit = new THREE.Vector3();
  let ax = origin.x + fx * 400 + W / 2, ay = origin.z + fy * 400 + H / 2; // fallback: far ahead, horizontally
  if (dir.y < -0.05 && raycaster.ray.intersectPlane(groundPlane, hit)) { ax = hit.x + W / 2; ay = hit.z + H / 2; }

  send({ t: 'input', dx, dy, ax, ay });
}, 33);

// ---------- Shop ----------
const UPGRADE_INFO: { key: UpgradeKey; label: string; desc: string }[] = [
  { key: 'speed', label: 'Boots', desc: '+8% move speed' },
  { key: 'hp', label: 'Vest', desc: '+20 max HP' },
  { key: 'grab', label: 'Long arms', desc: '+12 grab range' },
  { key: 'throw', label: 'Sling', desc: '+12% throw power' },
];
const shopEl = document.getElementById('shop')!;
const shopList = document.getElementById('shopList')!;
let shopBuilt = false;
function buildShop() {
  shopList.innerHTML = '';
  for (const u of UPGRADE_INFO) {
    const row = document.createElement('div');
    row.className = 'shopRow';
    row.innerHTML = `<div><b>${u.label}</b><br><small>${u.desc}</small></div><button data-k="${u.key}">Buy</button>`;
    row.querySelector('button')!.addEventListener('click', () => send({ t: 'buy', item: u.key }));
    shopList.appendChild(row);
  }
  shopBuilt = true;
}

// ---------- HUD (plain HTML, drawn over the 3D canvas) ----------
const hudLevel = document.getElementById('hudLevel')!;
const hudRoom = document.getElementById('hudRoom')!;
const hudHint = document.getElementById('hudHint')!;
const hudCenter = document.getElementById('hudCenter')!;
const lockHint = document.getElementById('lockHint')!;
const hpFill = document.getElementById('hpFill')!;
const downedHint = document.getElementById('downedHint')!;
if (isTouch) { hudHint.style.display = 'none'; lockHint.style.display = 'none'; }

// ---------- Minimap (top-down, drawn in a corner over the 3D view) ----------
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
const mmCtx = minimapCanvas.getContext('2d')!;
const MM_W = minimapCanvas.width, MM_H = minimapCanvas.height;
function drawMinimap(s: Snapshot) {
  const sx = MM_W / W, sy = MM_H / H;
  mmCtx.clearRect(0, 0, MM_W, MM_H);

  // Extraction zone
  mmCtx.fillStyle = 'rgba(60,200,120,0.5)';
  mmCtx.fillRect(ZONE.x * sx, ZONE.y * sy, ZONE.w * sx, ZONE.h * sy);

  // Walls
  mmCtx.fillStyle = 'rgba(210,190,165,0.55)';
  for (const w of s.walls) mmCtx.fillRect(w.x * sx, w.y * sy, Math.max(1, w.w * sx), Math.max(1, w.h * sy));

  // Items
  for (const it of s.items) {
    mmCtx.fillStyle = `hsl(${(it.value / it.max) * 120},70%,55%)`;
    mmCtx.beginPath(); mmCtx.arc(it.x * sx, it.y * sy, 2, 0, Math.PI * 2); mmCtx.fill();
  }

  // Monsters
  for (const m of s.monsters) {
    mmCtx.fillStyle = m.kind === 'hunter' ? (m.active ? '#ee3333' : '#993333') : (m.active ? '#cc33ee' : '#a06ec2');
    mmCtx.beginPath(); mmCtx.arc(m.x * sx, m.y * sy, 3, 0, Math.PI * 2); mmCtx.fill();
  }

  // Other players
  for (const pl of s.players) {
    if (pl.id === myId) continue;
    mmCtx.fillStyle = pl.dead ? '#ffcc33' : '#ccc';
    mmCtx.beginPath(); mmCtx.arc(pl.x * sx, pl.y * sy, 3, 0, Math.PI * 2); mmCtx.fill();
  }

  // Self, with a short line showing which way the camera is facing
  const me = s.players.find(pl => pl.id === myId);
  if (me) {
    const px = me.x * sx, py = me.y * sy;
    mmCtx.strokeStyle = '#ffd76a'; mmCtx.lineWidth = 1.5;
    mmCtx.beginPath(); mmCtx.moveTo(px, py); mmCtx.lineTo(px + Math.cos(yaw) * 10, py + Math.sin(yaw) * 10); mmCtx.stroke();
    mmCtx.fillStyle = '#ffd76a';
    mmCtx.beginPath(); mmCtx.arc(px, py, 3.5, 0, Math.PI * 2); mmCtx.fill();
  }
}

// ---------- Smoothing ----------
const disp = new Map<string, { x: number; y: number; z: number }>();
function smooth(key: string, x: number, y: number, z: number) {
  const d = disp.get(key) ?? { x, y, z };
  d.x += (x - d.x) * 0.5; d.y += (y - d.y) * 0.5; d.z += (z - d.z) * 0.5;
  disp.set(key, d);
  return d;
}

// Item color reflects remaining value, same formula used for the viewmodel.
function itemColor(value: number, max: number) { return new THREE.Color(`hsl(${(value / max) * 120},70%,50%)`); }

// ---------- Facing + walk cycle ----------
// The server only sends positions, not a heading, so each body's facing angle
// is derived here from how it's actually moving frame to frame, then eased
// toward that target (shortest angular path) so turns look smooth rather than
// snapping. This is what makes players/hunters visibly turn instead of always
// pointing the same static direction while sliding around.
const faceState = new Map<string, { angle: number; x: number; y: number }>();
function updateFacing(key: string, x: number, y: number): { angle: number; moving: boolean } {
  const prev = faceState.get(key);
  if (!prev) { faceState.set(key, { angle: -Math.PI / 2, x, y }); return { angle: -Math.PI / 2, moving: false }; }
  let angle = prev.angle;
  const dx = x - prev.x, dy = y - prev.y;
  const moving = Math.hypot(dx, dy) > 0.25;
  if (moving) {
    const target = Math.atan2(dy, dx);
    const diff = Math.atan2(Math.sin(target - angle), Math.cos(target - angle)); // shortest turn direction
    angle += diff * 0.3;
  }
  faceState.set(key, { angle, x, y });
  return { angle, moving };
}
// Converts a game-space heading (same atan2 convention as `yaw`) into a
// THREE.js rotation.y, given the meshes above are authored facing local +Z.
function headingToRotationY(angle: number): number { return Math.PI / 2 - angle; }

// Per-entity walk-cycle phase: advances while moving, eases back to a neutral
// pose (in step with `bobPhase` below) while idle, so limbs don't freeze mid-stride.
const gaitPhase = new Map<string, number>();
function stepGait(key: string, moving: boolean, rate = 10): number {
  let p = gaitPhase.get(key) ?? 0;
  p = moving ? p + rate / 60 : p * 0.9;
  gaitPhase.set(key, p);
  return p;
}
function animateGait(userData: any, phase: number, swing: number) {
  const legs = userData.legs as THREE.Mesh[] | undefined;
  const arms = userData.arms as THREE.Mesh[] | undefined;
  if (legs) {
    legs[0].rotation.x = Math.sin(phase) * swing;
    legs[1].rotation.x = -Math.sin(phase) * swing;
  }
  if (arms) {
    const base = (userData.armBaseX as number[] | undefined) ?? [0, 0];
    arms[0].rotation.x = base[0] - Math.sin(phase) * swing * 0.7;
    arms[1].rotation.x = base[1] + Math.sin(phase) * swing * 0.7;
  }
}

let bobPhase = 0;

function frame() {
  requestAnimationFrame(frame);
  // Ambient environment animation runs every frame, even before a snapshot
  // arrives, so the sky/clouds/trees are already alive on the lobby/connecting screen.
  const animT = performance.now() / 1000;
  updateSkyAnimation(animT);
  updateTreeSway(animT);
  if (!snap) { hudCenter.textContent = 'Connecting...'; renderer.render(scene, camera); return; }
  const s = snap;
  hudCenter.textContent = s.status === 'lost' ? 'Squad wiped. Restarting...' : '';
  hudLevel.textContent = `Level ${s.level}   Banked $${s.banked} / $${s.quota}`;
  hudRoom.textContent = `Room ${roomCode}   ${s.players.length} player${s.players.length === 1 ? '' : 's'}`;
  lockHint.style.display = !isTouch && !locked && s.status !== 'shop' ? 'block' : 'none';

  shopEl.style.display = s.status === 'shop' ? 'flex' : 'none';
  if (s.status === 'shop') {
    if (!shopBuilt) buildShop();
    document.getElementById('shopCredits')!.textContent = `$${s.credits}`;
    document.getElementById('shopTimer')!.textContent = `Next level in ${s.shopTimeLeft}s`;
    shopList.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
      const key = b.dataset.k as UpgradeKey;
      const count = s.upgrades[key];
      const c = Math.round((key === 'speed' ? 150 : key === 'hp' ? 150 : key === 'grab' ? 100 : 120) * Math.pow(1.55, count));
      b.textContent = `Buy — $${c}`;
      b.disabled = s.credits < c;
    });
  }

  // Walls only change when a new level starts, so only rebuild them then.
  const sig = s.walls.map(w => `${w.x},${w.y},${w.w},${w.h}`).join('|');
  if (sig !== wallSignature) {
    wallSignature = sig;
    for (const child of [...wallGroup.children]) { wallGroup.remove(child); (child as THREE.Mesh).geometry.dispose(); }
    s.walls.forEach((w, i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, 80, w.h), wallMats[i % wallMats.length]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const c = toWorld(w.x + w.w / 2, w.y + w.h / 2);
      mesh.position.set(c.x, 40, c.z);
      wallGroup.add(mesh);
    });
  }

  const seenItems = new Set<number>();
  for (const it of s.items) {
    seenItems.add(it.id);
    let mesh = itemMeshes.get(it.id);
    if (!mesh) {
      mesh = new THREE.Mesh(itemGeo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.15 }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      itemGroup.add(mesh); itemMeshes.set(it.id, mesh);
    }
    const onGround = !it.held && it.z <= 1;
    const bob = onGround ? Math.sin(performance.now() / 400 + it.id) * 3 : 0;
    const p = smooth('i' + it.id, it.x, it.y, it.z);
    const w3 = toWorld(p.x, p.y);
    mesh.scale.setScalar(it.r);
    mesh.position.set(w3.x, it.r + p.z + bob, w3.z);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const color = itemColor(it.value, it.max);
    mat.color.copy(color); mat.emissive.copy(color); mat.emissiveIntensity = it.held ? 0.7 : 0.35;

    if (it.held === myId) {
      heldViewMesh.visible = true;
      heldViewMesh.scale.setScalar(it.r / 9); // the viewmodel is authored at radius 9
      (heldViewMesh.material as THREE.MeshStandardMaterial).color.copy(color);
      (heldViewMesh.material as THREE.MeshStandardMaterial).emissive.copy(color);
      (heldViewMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
    }
  }
  if (!s.items.some(it => it.held === myId)) heldViewMesh.visible = false;
  for (const [id, mesh] of itemMeshes) if (!seenItems.has(id)) { itemGroup.remove(mesh); (mesh.material as THREE.Material).dispose(); itemMeshes.delete(id); }

  s.monsters.forEach((m, i) => {
    let mesh = monsterMeshes.get(i);
    if (!mesh || mesh.userData.kind !== m.kind) {
      if (mesh) disposeMonsterVisual(mesh);
      if (m.kind === 'hunter') {
        mesh = makeHunterMesh();
      } else {
        mesh = makeGhostMesh();
      }
      monsterGroup.add(mesh); monsterMeshes.set(i, mesh);
    }
    const p = smooth('m' + i, m.x, m.y, 0);
    const w3 = toWorld(p.x, p.y);
    const face = updateFacing('m' + i, m.x, m.y);
    mesh.rotation.y = headingToRotationY(face.angle);
    if (m.kind === 'hunter') {
      mesh.position.set(w3.x, 0, w3.z); // feet-based origin, stands on the floor
      const phase = stepGait('m' + i, face.moving, 16); // frantic, faster gait than a player's
      animateGait(mesh.userData, phase, 0.6);
      const mat = mesh.userData.bodyMat as THREE.MeshStandardMaterial;
      mat.color.set(m.active ? 0xee3333 : 0x993333);
      mat.emissive.copy(mat.color); mat.emissiveIntensity = m.active ? 0.5 : 0.12;
    } else {
      // Ghosts float and bob gently rather than sitting planted on the ground;
      // a slow sideways sway on top of the bob and the turn-to-face keeps them
      // reading as alive rather than a shape sliding around a fixed pose.
      const bob = Math.sin(performance.now() / 500 + i) * 5;
      mesh.position.set(w3.x, 46 + bob, w3.z);
      mesh.rotation.z = Math.sin(performance.now() / 700 + i) * 0.15;
      const mat = mesh.userData.bodyMat as THREE.MeshStandardMaterial;
      mat.color.set(m.active ? 0xcc33ee : 0x724488);
      mat.emissive.copy(mat.color); mat.emissiveIntensity = m.active ? 0.6 : 0.15;
      mat.opacity = m.active ? 0.75 : 0.55;
    }
  });
  for (const [idx, mesh] of monsterMeshes) if (idx >= s.monsters.length) { disposeMonsterVisual(mesh); monsterMeshes.delete(idx); }

  let meWorld: { x: number; z: number } | null = null;
  let mePlayer: Snapshot['players'][number] | null = null;
  const seenPlayers = new Set<string>();
  for (const pl of s.players) {
    seenPlayers.add(pl.id);
    let v = playerVisuals.get(pl.id);
    if (!v) {
      const mesh = makePlayerMesh(pl.id);
      playerGroup.add(mesh);
      const { group: barGroup, fg: hpFg } = makeHealthBar();
      playerGroup.add(barGroup);
      const nameSprite = makeNameSprite(pl.id === myId ? 'you' : pl.name);
      playerGroup.add(nameSprite);
      v = { mesh, barGroup, hpFg, nameSprite };
      playerVisuals.set(pl.id, v);
    }
    const p = smooth('p' + pl.id, pl.x, pl.y, 0);
    const w3 = toWorld(p.x, p.y);
    v.mesh.position.set(w3.x, 0, w3.z); // feet-based origin, stands on the floor
    v.barGroup.position.set(w3.x, 70, w3.z);
    v.barGroup.quaternion.copy(camera.quaternion);
    v.nameSprite.position.set(w3.x, 82, w3.z);
    // First person: don't render your own body, it'd just clip the camera.
    // Third person: show it, since the camera now sits behind you.
    const isMe = pl.id === myId;
    v.mesh.visible = !isMe || thirdPerson;
    // Downed players read as visibly desaturated/darkened versions of their
    // own skin/outfit, rather than snapping to one flat gray for everyone —
    // still recognizable as *that* player at a glance.
    const shirtMat = v.mesh.userData.shirtMat as THREE.MeshStandardMaterial;
    const pantsMat = v.mesh.userData.pantsMat as THREE.MeshStandardMaterial;
    const skinMat = v.mesh.userData.skinMat as THREE.MeshStandardMaterial;
    if (pl.dead) {
      shirtMat.color.copy(v.mesh.userData.baseShirt as THREE.Color).lerp(DEAD_TINT, DEAD_TINT_AMOUNT);
      pantsMat.color.copy(v.mesh.userData.basePants as THREE.Color).lerp(DEAD_TINT, DEAD_TINT_AMOUNT);
      skinMat.color.set(0x888888); // desaturates the face texture without redrawing it
    } else {
      shirtMat.color.copy(v.mesh.userData.baseShirt as THREE.Color);
      pantsMat.color.copy(v.mesh.userData.basePants as THREE.Color);
      skinMat.color.set(0xffffff); // full texture color
    }
    v.mesh.rotation.x = pl.dead ? Math.PI / 2 : 0; // lie flat once downed, so it reads clearly at a glance
    // Facing + walk cycle: your own body (only ever seen in third person) uses
    // the exact known camera yaw for instant, precise turning; everyone else's
    // heading is inferred from how they're actually moving (see updateFacing).
    let faceAngle: number, isWalking: boolean;
    if (isMe) { faceAngle = yaw; isWalking = isMoving && !pl.dead; }
    else { const face = updateFacing('p' + pl.id, pl.x, pl.y); faceAngle = face.angle; isWalking = face.moving && !pl.dead; }
    v.mesh.rotation.y = headingToRotationY(faceAngle);
    const gp = stepGait('p' + pl.id, isWalking);
    animateGait(v.mesh.userData, gp, 0.5);
    if (pl.dead) {
      // While downed, the same bar shows revive progress instead of health, in amber.
      v.hpFg.scale.x = Math.max(0.001, pl.reviveProg);
      (v.hpFg.material as THREE.MeshBasicMaterial).color.set(0xffcc33);
    } else {
      v.hpFg.scale.x = Math.max(0.001, pl.hp / pl.maxHp);
      (v.hpFg.material as THREE.MeshBasicMaterial).color.set(0x33cc55);
    }
    // Your own bar/name stay hidden (you have the HUD hp bar instead); a
    // downed teammate's bar stays visible even in first person, so you can
    // see revive progress from across the room.
    v.barGroup.visible = !isMe;
    v.nameSprite.visible = !pl.dead && !isMe;
    if (isMe) { meWorld = { x: w3.x, z: w3.z }; mePlayer = pl; lastMeWorld.x = w3.x; lastMeWorld.z = w3.z; }
  }
  for (const [id, v] of playerVisuals) if (!seenPlayers.has(id)) {
    playerGroup.remove(v.mesh); disposeObject3D(v.mesh);
    playerGroup.remove(v.barGroup); playerGroup.remove(v.nameSprite);
    playerVisuals.delete(id);
  }

  if (meWorld) {
    // Subtle head-bob while actually moving gives walking some physical weight.
    if (isMoving && mePlayer && !mePlayer.dead) bobPhase += 1 / 60 * 10; else bobPhase *= 0.9;
    const bobbing = Math.sin(bobPhase) * 1.6;
    const dir = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
    if (thirdPerson) {
      // Chase camera: sits behind and above the player, looking the same
      // direction as the mouse-look would in first person, so aim stays consistent.
      heldViewMesh.visible = false;
      const back = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(-TP_DIST);
      const camPos = new THREE.Vector3(meWorld.x + back.x, EYE_HEIGHT + TP_HEIGHT + bobbing, meWorld.z + back.z);
      camera.position.copy(camPos);
      camera.lookAt(camPos.clone().add(dir.clone().multiplyScalar(400)));
    } else {
      camera.position.set(meWorld.x, EYE_HEIGHT + bobbing, meWorld.z);
      camera.lookAt(camera.position.clone().add(dir));
    }
    sun.position.set(meWorld.x - 260, 420, meWorld.z + 180);
    sun.target.position.set(meWorld.x, 0, meWorld.z);
    zoneLight.position.set(zoneMesh.position.x, 90, zoneMesh.position.z);

    // Proximity voice: ears at your head facing where you look; each teammate's
    // voice is placed at their body (head height), so volume + direction follow the level.
    updateVoice({
      listener: { x: meWorld.x, y: EYE_HEIGHT, z: meWorld.z },
      forward: { x: dir.x, y: dir.y, z: dir.z },
      peers: s.players.flatMap(pl => {
        const pv = pl.id === myId ? undefined : playerVisuals.get(pl.id);
        return pv ? [{ id: pl.id, name: pl.name, x: pv.mesh.position.x, y: 55, z: pv.mesh.position.z }] : [];
      }),
    });
  }

  // HP bar in the HUD, since your own floating bar isn't rendered in first person.
  if (mePlayer) hpFill.style.width = `${Math.max(0, (mePlayer.hp / mePlayer.maxHp) * 100)}%`;
  downedHint.style.display = mePlayer?.dead ? 'block' : 'none';
  if (mePlayer?.dead) downedHint.textContent = mePlayer.reviveProg > 0
    ? `Being revived... ${Math.round(mePlayer.reviveProg * 100)}%`
    : 'DOWNED — a teammate must stand near you to revive you';

  drawMinimap(s);
  renderer.render(scene, camera);
}
frame();
