import * as THREE from 'three';
import { ClientMsg, H, ItemKind, ItemState, MonsterKind, MonsterState, PingState, Snapshot, UpgradeKey, W, Wall, ZONE } from '../src/shared';
import { MAPS } from '../src/maps';
import { createHouse, floorCss } from './house';

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
let myId = '', roomCode = '';
let snap: Snapshot | null = null;
const send = (m: ClientMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

// ---------- Procedural Web Audio Sound Engine ----------
class HorrorAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private lastHeartbeat = 0;
  private lastStep = 0;

  private init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.65, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
    this.startAmbientDrone();
  }

  ensure() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private startAmbientDrone() {
    if (!this.ctx || !this.masterGain) return;
    try {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      this.droneGain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(55, this.ctx.currentTime);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(57.5, this.ctx.currentTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(110, this.ctx.currentTime);

      this.droneGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(this.droneGain);
      this.droneGain.connect(this.masterGain);

      osc1.start();
      osc2.start();
    } catch {}
  }

  playFootstep(sprint: boolean) {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const now = performance.now();
    const minInterval = sprint ? 230 : 370;
    if (now - this.lastStep < minInterval) return;
    this.lastStep = now;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(sprint ? 95 : 120, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.08);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(sprint ? 340 : 240, t);

    gain.gain.setValueAtTime(sprint ? 0.32 : 0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  playGrab() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(460, t + 0.09);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  playThrow() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(360, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.14);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  playBank() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const notes = [1046.5, 1318.5, 1567.98, 2093.0];
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.05);
      gain.gain.setValueAtTime(0.2, t + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.32);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t + idx * 0.05);
      osc.stop(t + idx * 0.05 + 0.35);
    });
  }

  playDamage() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.linearRampToValueAtTime(45, t + 0.25);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playHeartbeat(proxNorm: number) {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const now = performance.now();
    const interval = 1200 - proxNorm * 750;
    if (now - this.lastHeartbeat < interval) return;
    this.lastHeartbeat = now;

    const t = this.ctx.currentTime;
    const vol = 0.15 + proxNorm * 0.45;

    const osc1 = this.ctx.createOscillator();
    const g1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(75, t);
    osc1.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    g1.gain.setValueAtTime(vol, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc1.connect(g1);
    g1.connect(this.masterGain);
    osc1.start(t);
    osc1.stop(t + 0.13);

    const osc2 = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(60, t + 0.14);
    osc2.frequency.exponentialRampToValueAtTime(38, t + 0.24);
    g2.gain.setValueAtTime(vol * 0.8, t + 0.14);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc2.connect(g2);
    g2.connect(this.masterGain);
    osc2.start(t + 0.14);
    osc2.stop(t + 0.28);
  }

  playHunterRoar() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.linearRampToValueAtTime(70, t + 0.55);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(260, t);
    filter.frequency.linearRampToValueAtTime(600, t + 0.28);
    filter.frequency.linearRampToValueAtTime(180, t + 0.55);
    filter.Q.setValueAtTime(4, t);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.65);
  }

  playScreamerScream() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.linearRampToValueAtTime(1500, t + 0.2);
    osc.frequency.linearRampToValueAtTime(920, t + 0.55);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.65);
  }

  playStalkerWhisper() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.linearRampToValueAtTime(320, t + 0.15);
    osc.frequency.linearRampToValueAtTime(120, t + 0.4);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playFlashlightClick() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, t);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  playPing(kind = 'info') {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const freq = kind === 'danger' ? 440 : kind === 'scrap' ? 1200 : 880;
    osc.type = kind === 'danger' ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (kind === 'danger') {
      osc.frequency.setValueAtTime(freq * 1.3, t + 0.08);
    }
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

const audio = new HorrorAudio();

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
};
ws.onclose = () => { lobby.style.display = 'flex'; errEl.textContent = 'Connection lost. Refresh the page to reconnect.'; document.exitPointerLock?.(); };

function join(room: string) {
  audio.ensure();
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
// Placeholder until the first snapshot names a map; each map then sets its own
// background/fog/light colors (see applyMap in house.ts). The game is indoors, so the
// background is only ever dim room-colored darkness — there is no sky.
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
const hemi = new THREE.HemisphereLight(0xffdca8, 0x1a120c, 0.55);
scene.add(hemi);
// A soft overhead "room light", repositioned every frame to stay centered on the player,
// with a shadow frustum just big enough to cover the nearby room — a directional
// light fixed to the whole map would need a huge, blurry frustum.
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

// ---------- Flashlight ----------
const flashlight = new THREE.SpotLight(0xfffaea, 3.2, 750, 0.54, 0.45, 1.2);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.bias = -0.0002;
scene.add(flashlight);
scene.add(flashlight.target);
let flashlightOn = true;


// Player position in world space (used for throw/grab aiming and the light rig).
const lastMeWorld = { x: 0, z: 0 };

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

// ---------- The house ----------
// Floors, wallpapered walls, ceiling, windows, lamps and all furniture live in house.ts.
const house = createHouse(scene, hemi, sun);
let curWalls: Wall[] = [];
let curMapId = '';

const itemGroup = new THREE.Group(); scene.add(itemGroup);
const itemMeshes = new Map<number, THREE.Group>();

const pingGroup = new THREE.Group(); scene.add(pingGroup);
const pingMeshes = new Map<number, THREE.Sprite>();

function makePingSprite(kind: 'scrap' | 'danger' | 'info'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;

  const color = kind === 'danger' ? '#ff3344' : kind === 'scrap' ? '#ffcc00' : '#33ccff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = kind === 'danger' ? 'rgba(255,50,50,0.35)' : kind === 'scrap' ? 'rgba(255,200,0,0.35)' : 'rgba(50,200,255,0.35)';
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 50px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const icon = kind === 'danger' ? '!' : kind === 'scrap' ? '$' : '▼';
  ctx.fillText(icon, 64, 66);

  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(24, 24, 1);
  return spr;
}

// Procedural 3D Scrap Models with distinct shapes per ItemKind
function makeScrapMesh(kind: ItemKind): THREE.Group {
  const g = new THREE.Group();
  g.userData.kind = kind;

  if (kind === 'battery') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.4, metalness: 0.7 });
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 0.8, roughness: 0.2 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 });

    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.8, 12), bodyMat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 12), coreMat);
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 10), capMat);
    capTop.position.y = 1.0;
    g.add(cyl); g.add(core); g.add(capTop);
    g.userData.coreMat = coreMat;
  } else if (kind === 'canister') {
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xd67a1a, roughness: 0.5, metalness: 0.4 });
    const valveMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.6 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.0, 12), tankMat);
    const topDome = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
    topDome.position.y = 1.0;
    const valve = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 6, 12), valveMat);
    valve.position.y = 1.6;
    valve.rotation.x = Math.PI / 2;
    g.add(body); g.add(topDome); g.add(valve);
    g.userData.coreMat = tankMat;
  } else if (kind === 'crate') {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e4e30, roughness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2e2e2e, metalness: 0.7, roughness: 0.4 });

    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), woodMat);
    const band1 = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.2, 1.65), trimMat);
    band1.position.y = 0.5;
    const band2 = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.2, 1.65), trimMat);
    band2.position.y = -0.5;
    g.add(box); g.add(band1); g.add(band2);
    g.userData.coreMat = woodMat;
  } else if (kind === 'relic') {
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffcc22, emissive: 0xaa7700, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.95
    });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a1622, roughness: 0.8 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.4, 8), baseMat);
    const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), goldMat);
    jewel.position.y = 1.1;
    g.add(base); g.add(jewel);
    g.userData.coreMat = goldMat;
  } else if (kind === 'engine') {
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.8, roughness: 0.3 });
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xb85b28, metalness: 0.7, roughness: 0.35 });

    const block = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.4), ironMat);
    const cylL = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8), copperMat);
    cylL.position.set(-0.45, 0.9, 0);
    const cylR = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8), copperMat);
    cylR.position.set(0.45, 0.9, 0);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.2, 12), ironMat);
    wheel.position.set(0, 0, 0.8);
    wheel.rotation.x = Math.PI / 2;

    g.add(block); g.add(cylL); g.add(cylR); g.add(wheel);
    g.userData.coreMat = ironMat;
  } else {
    // Boat (dinghy)
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x7c2222, roughness: 0.7 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 1.3), hullMat);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.1, 4), hullMat);
    bow.position.set(1.4, 0, 0);
    bow.rotation.z = -Math.PI / 2;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 1.1), rimMat);
    seat.position.y = 0.2;
    g.add(hull); g.add(bow); g.add(seat);
    g.userData.coreMat = hullMat;
  }

  g.traverse((c: THREE.Object3D) => {
    if (c instanceof THREE.Mesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  return g;
}


const monsterGroup = new THREE.Group(); scene.add(monsterGroup);
const monsterMeshes = new Map<number, THREE.Object3D>();

// A "screamer" gets an actual ghost shape — rounded dome + open-ended body +
// a ring of small lobes standing in for a scalloped, wavy hem — instead of a
// plain octahedron. All body parts share one material so color/opacity can be
// updated in one place each frame; eyes stay solid and untouched.
function makeGhostMesh(): THREE.Group {
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x724488, emissive: 0x724488, emissiveIntensity: 0.15,
    transparent: true, opacity: 0.55, roughness: 0.35, side: THREE.DoubleSide, depthWrite: false,
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

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x120014 });
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

// A "stalker" gets a tall, spindly, shadowy silhouette with razor claws and glowing crimson eyes
function makeStalkerMesh(): THREE.Group {
  const shadowMat = new THREE.MeshStandardMaterial({
    color: 0x12081c,
    emissive: 0x230e38,
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.6,
  });
  const g = new THREE.Group();
  g.userData.kind = 'stalker';
  g.userData.bodyMat = shadowMat;

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 42, 6), shadowMat);
  torso.position.y = 40;
  torso.rotation.x = 0.25;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 8), shadowMat);
  head.position.set(0, 62, 9);
  head.scale.set(0.85, 1.2, 1.1);
  g.add(head);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 6), eyeMat);
    eye.position.set(side * 3.5, 63, 15);
    g.add(eye);
  }

  const arms: THREE.Mesh[] = [];
  const armBaseX: number[] = [];
  for (const side of [-1, 1]) {
    const armGeo = new THREE.CylinderGeometry(1.8, 1.2, 44, 6);
    armGeo.translate(0, -22, 0);
    const arm = new THREE.Mesh(armGeo, shadowMat);
    arm.position.set(side * 11, 54, 5);
    arm.rotation.x = 0.2;
    arm.rotation.z = side * 0.25;
    g.add(arm);
    arms.push(arm);
    armBaseX.push(0.2);

    for (let c = -1; c <= 1; c++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.8, 7, 4), shadowMat);
      claw.position.set(side * 11 + c * 2, 11, 5);
      claw.rotation.x = 0.5;
      g.add(claw);
    }
  }
  g.userData.arms = arms;
  g.userData.armBaseX = armBaseX;

  const legs: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const legGeo = new THREE.CylinderGeometry(2.5, 1.8, 28, 6);
    legGeo.translate(0, -14, 0);
    const leg = new THREE.Mesh(legGeo, shadowMat);
    leg.position.set(side * 5, 28, -2);
    leg.rotation.x = -0.15;
    g.add(leg);
    legs.push(leg);
  }
  g.userData.legs = legs;

  [36, 46, 56].forEach((y, i) => {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(2.5, 15, 4), shadowMat);
    spike.position.set(0, y, -7 - i * 2);
    spike.rotation.x = -0.7;
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
function makePlayerMesh(): THREE.Group {
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const g = new THREE.Group();
  g.userData.bodyMat = bodyMat;

  const legs: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const legGeo = new THREE.CylinderGeometry(3, 3, 20, 6);
    legGeo.translate(0, -10, 0); // local origin -> top of the leg (the hip)
    const leg = new THREE.Mesh(legGeo, bodyMat);
    leg.position.set(side * 5, 20, 0); // hip height; leg hangs down to the floor
    g.add(leg);
    legs.push(leg);
  }
  g.userData.legs = legs;

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 26, 8), bodyMat);
  torso.position.y = 33;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 10), bodyMat);
  head.position.y = 55;
  g.add(head);

  const arms: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const armGeo = new THREE.CylinderGeometry(2.5, 2.5, 22, 6);
    armGeo.translate(0, -11, 0); // local origin -> top of the arm (the shoulder)
    const arm = new THREE.Mesh(armGeo, bodyMat);
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
renderer.domElement.addEventListener('click', () => {
  audio.ensure();
  if (!locked && lobby.style.display === 'none') requestLock();
});
addEventListener('mousemove', e => {
  if (!locked) return;
  if (justLocked) { justLocked = false; return; }
  const mx = Math.max(-MAX_MOVE_DELTA, Math.min(MAX_MOVE_DELTA, e.movementX));
  const my = Math.max(-MAX_MOVE_DELTA, Math.min(MAX_MOVE_DELTA, e.movementY));
  yaw += mx * SENSITIVITY;
  pitch -= my * SENSITIVITY;
  pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
});
renderer.domElement.addEventListener('mousedown', e => {
  audio.ensure();
  if (!locked) return;
  if (e.button === 0) {
    send({ t: 'throw' });
    audio.playThrow();
  } else if (e.button === 1) {
    e.preventDefault();
    performPing();
  }
});

function toggleFlashlight() {
  audio.ensure();
  flashlightOn = !flashlightOn;
  audio.playFlashlightClick();
  send({ t: 'flashlight', on: flashlightOn });
  const flBadge = document.getElementById('flashlightStatus');
  if (flBadge) flBadge.textContent = flashlightOn ? 'FLASHLIGHT ON' : 'FLASHLIGHT OFF';
}

function performPing() {
  audio.ensure();
  const fx = Math.cos(yaw), fy = Math.sin(yaw);
  const dir = new THREE.Vector3(Math.cos(pitch) * fx, Math.sin(pitch), Math.cos(pitch) * fy);
  raycaster.set(camera.position, dir);
  const hit = new THREE.Vector3();
  let px = (lastMeWorld.x || 0) + W / 2, py = (lastMeWorld.z || 0) + H / 2;
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    px = hit.x + W / 2;
    py = hit.z + H / 2;
  }
  let pingKind: 'scrap' | 'danger' | 'info' = 'info';
  if (snap) {
    for (const m of snap.monsters) {
      if (Math.hypot(m.x - px, m.y - py) < 95) { pingKind = 'danger'; break; }
    }
    if (pingKind === 'info') {
      for (const it of snap.items) {
        if (Math.hypot(it.x - px, it.y - py) < 60) { pingKind = 'scrap'; break; }
      }
    }
  }
  send({ t: 'ping', x: px, y: py, kind: pingKind });
  audio.playPing(pingKind);
}

// ---------- Input: keyboard (desktop) ----------
const keys = new Set<string>();
let thirdPerson = false;
addEventListener('keydown', e => {
  audio.ensure();
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (!keys.has(k) && k === 'e') { send({ t: 'grab' }); audio.playGrab(); }
  if (!keys.has(k) && k === 'f') toggleFlashlight();
  if (!keys.has(k) && k === 'q') performPing();
  if (!keys.has(k) && k === 'v') thirdPerson = !thirdPerson;
  if (e.code === 'Space') { e.preventDefault(); send({ t: 'throw' }); audio.playThrow(); }
  keys.add(k);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
const held = (...k: string[]) => (k.some(x => keys.has(x)) ? 1 : 0);

// ---------- Touch controls (mobile) ----------
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

function makeStick(baseId: string, knobId: string, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
  const base = document.getElementById(baseId)!, knob = document.getElementById(knobId)!;
  let active = -1, cx = 0, cy = 0;
  const R = 44;
  const set = (dx: number, dy: number) => { knob.style.transform = `translate(${dx}px,${dy}px)`; };
  base.addEventListener('touchstart', e => {
    e.preventDefault();
    audio.ensure();
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
let isSprinting = false;
let touchSprint = false;

makeStick('moveBase', 'moveKnob', (dx, dy) => { moveStick = { dx, dy }; }, () => { moveStick = { dx: 0, dy: 0 }; });
makeStick('aimBase', 'aimKnob', (dx, dy) => {
  if (Math.hypot(dx, dy) > 0.15) yaw = Math.atan2(dy, dx);
}, () => {});

document.getElementById('grabBtn')?.addEventListener('touchstart', e => { e.preventDefault(); audio.ensure(); send({ t: 'grab' }); audio.playGrab(); }, { passive: false });
document.getElementById('throwBtn')?.addEventListener('touchstart', e => { e.preventDefault(); audio.ensure(); send({ t: 'throw' }); audio.playThrow(); }, { passive: false });
document.getElementById('viewBtn')?.addEventListener('touchstart', e => { e.preventDefault(); audio.ensure(); thirdPerson = !thirdPerson; }, { passive: false });
document.getElementById('sprintBtn')?.addEventListener('touchstart', e => { e.preventDefault(); audio.ensure(); touchSprint = true; }, { passive: false });
document.getElementById('sprintBtn')?.addEventListener('touchend', e => { e.preventDefault(); touchSprint = false; });
document.getElementById('lightBtn')?.addEventListener('touchstart', e => { e.preventDefault(); toggleFlashlight(); }, { passive: false });

// ---------- Movement + aim, sent to the server ----------
setInterval(() => {
  const forwardInput = (held('w', 'arrowup') - held('s', 'arrowdown')) || -moveStick.dy;
  const strafeInput = (held('d', 'arrowright') - held('a', 'arrowleft')) || moveStick.dx;
  const fx = Math.cos(yaw), fy = Math.sin(yaw);
  const rx = -fy, ry = fx;
  const dx = fx * forwardInput + rx * strafeInput;
  const dy = fy * forwardInput + ry * strafeInput;
  isMoving = forwardInput !== 0 || strafeInput !== 0;
  isSprinting = (keys.has('shift') || touchSprint) && isMoving;

  const dir = new THREE.Vector3(Math.cos(pitch) * fx, Math.sin(pitch), Math.cos(pitch) * fy);
  const origin = camera.position.clone();
  raycaster.set(origin, dir);
  const hit = new THREE.Vector3();
  let ax = origin.x + fx * 400 + W / 2, ay = origin.z + fy * 400 + H / 2;
  if (dir.y < -0.05 && raycaster.ray.intersectPlane(groundPlane, hit)) { ax = hit.x + W / 2; ay = hit.z + H / 2; }

  send({ t: 'input', dx, dy, ax, ay, sprint: isSprinting });
}, 33);

// ---------- Shop ----------
const UPGRADE_INFO: { key: UpgradeKey; label: string; desc: string }[] = [
  { key: 'speed', label: 'Boots', desc: '+8% move speed' },
  { key: 'hp', label: 'Vest', desc: '+20 max HP' },
  { key: 'stamina', label: 'Lungs', desc: '+25 max stamina & sprint recovery' },
  { key: 'grab', label: 'Long arms', desc: '+12 grab range' },
  { key: 'throw', label: 'Sling', desc: '+12% throw power' },
  { key: 'scanner', label: 'Radar Sensor', desc: 'Sweeping motion radar on minimap' },
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
    row.querySelector('button')!.addEventListener('click', () => { audio.ensure(); send({ t: 'buy', item: u.key }); });
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
const staminaFill = document.getElementById('staminaFill')!;
const downedHint = document.getElementById('downedHint')!;
const vignetteEl = document.getElementById('vignette')!;
if (isTouch) { hudHint.style.display = 'none'; lockHint.style.display = 'none'; }

// ---------- Minimap (top-down, drawn in a corner over the 3D view) ----------
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
const mmCtx = minimapCanvas.getContext('2d')!;
const MM_W = minimapCanvas.width, MM_H = minimapCanvas.height;

function drawMinimap(s: Snapshot) {
  const sx = MM_W / W, sy = MM_H / H;
  mmCtx.clearRect(0, 0, MM_W, MM_H);

  // Room floors, tinted by material
  const def = MAPS[curMapId];
  if (def) for (const fp of def.floors) {
    mmCtx.fillStyle = floorCss(fp.type).replace('rgb', 'rgba').replace(')', ',0.32)');
    mmCtx.fillRect(fp.x * sx, fp.y * sy, fp.w * sx, fp.h * sy);
  }

  // Extraction zone
  mmCtx.fillStyle = 'rgba(60,200,120,0.5)';
  mmCtx.fillRect(ZONE.x * sx, ZONE.y * sy, ZONE.w * sx, ZONE.h * sy);

  // Walls
  for (const w of curWalls) {
    const isWall = !w.kind || w.kind === 'wall';
    mmCtx.fillStyle = isWall ? 'rgba(235,222,198,0.85)' : 'rgba(150,118,84,0.7)';
    mmCtx.fillRect(w.x * sx, w.y * sy, Math.max(1, w.w * sx), Math.max(1, w.h * sy));
  }

  // Pings
  for (const p of s.pings || []) {
    const px = p.x * sx, py = p.y * sy;
    mmCtx.strokeStyle = p.kind === 'danger' ? '#ff3344' : p.kind === 'scrap' ? '#ffcc00' : '#33ccff';
    mmCtx.lineWidth = 2;
    mmCtx.beginPath();
    mmCtx.arc(px, py, 6 + Math.sin(performance.now() / 150) * 2, 0, Math.PI * 2);
    mmCtx.stroke();
  }

  // Items
  for (const it of s.items) {
    mmCtx.fillStyle = `hsl(${(it.value / it.max) * 120},70%,55%)`;
    mmCtx.beginPath(); mmCtx.arc(it.x * sx, it.y * sy, 2.5, 0, Math.PI * 2); mmCtx.fill();
  }

  // Monsters
  for (const m of s.monsters) {
    if (m.kind === 'hunter') mmCtx.fillStyle = m.active ? '#ee3333' : '#993333';
    else if (m.kind === 'screamer') mmCtx.fillStyle = m.active ? '#cc33ee' : '#a06ec2';
    else mmCtx.fillStyle = m.active ? '#ff1144' : '#6b1180';
    mmCtx.beginPath(); mmCtx.arc(m.x * sx, m.y * sy, 3.5, 0, Math.PI * 2); mmCtx.fill();
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

    // Scanner radar sweep if upgrade active
    if (s.upgrades.scanner > 0) {
      const sweepAngle = (performance.now() / 1000 * 2.5) % (Math.PI * 2);
      const sweepR = 26 * (1 + s.upgrades.scanner * 0.4);
      mmCtx.strokeStyle = 'rgba(60, 220, 255, 0.35)';
      mmCtx.lineWidth = 1.5;
      mmCtx.beginPath();
      mmCtx.arc(px, py, sweepR, 0, Math.PI * 2);
      mmCtx.stroke();
      mmCtx.beginPath();
      mmCtx.moveTo(px, py);
      mmCtx.lineTo(px + Math.cos(sweepAngle) * sweepR, py + Math.sin(sweepAngle) * sweepR);
      mmCtx.stroke();
    }

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
let lastHp = 100;
let lastBanked = 0;
let shakeAmount = 0;
const prevMonsterActive = new Map<number, boolean>();

let bannerText = '', bannerUntil = 0;
function frame() {
  requestAnimationFrame(frame);
  const animT = performance.now() / 1000;
  house.update(animT);
  if (!snap) { hudCenter.textContent = 'Connecting...'; renderer.render(scene, camera); return; }
  const s = snap;
  // The wall list + map id only ride along with a snapshot when they change (new level / just joined).
  if (s.walls) curWalls = s.walls;
  if (s.mapId && s.mapId !== curMapId) {
    curMapId = s.mapId;
    const def = house.applyMap(s.mapId);
    bannerText = `${def.name} — ${def.blurb}`; bannerUntil = performance.now() + 4500;
  }
  hudCenter.textContent = s.status === 'lost' ? 'Squad wiped. Restarting...' : (performance.now() < bannerUntil ? bannerText : '');
  hudLevel.textContent = `Level ${s.level}${house.def ? ' · ' + house.def.name : ''}   Banked $${s.banked} / $${s.quota}`;
  hudRoom.textContent = `Room ${roomCode}   ${s.players.length} player${s.players.length === 1 ? '' : 's'}`;
  lockHint.style.display = !isTouch && !locked && s.status !== 'shop' ? 'block' : 'none';

  // Bank sound
  if (s.banked > lastBanked) {
    audio.playBank();
    lastBanked = s.banked;
  }
  if (s.status === 'playing' && s.banked === 0 && lastBanked > 0) {
    lastBanked = 0;
  }

  shopEl.style.display = s.status === 'shop' ? 'flex' : 'none';
  if (s.status === 'shop') {
    if (!shopBuilt) buildShop();
    document.getElementById('shopCredits')!.textContent = `$${s.credits}`;
    document.getElementById('shopTimer')!.textContent = `Next level in ${s.shopTimeLeft}s`;
    if (s.stats) {
      const sh = document.getElementById('statHauled');
      const sb = document.getElementById('statBanked');
      const sr = document.getElementById('statRevives');
      if (sh) sh.textContent = String(s.stats.itemsHauled);
      if (sb) sb.textContent = `$${s.stats.totalBanked}`;
      if (sr) sr.textContent = String(s.stats.revives);
    }
    shopList.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
      const key = b.dataset.k as UpgradeKey;
      const count = s.upgrades[key] || 0;
      const base = key === 'speed' ? 150 : key === 'hp' ? 150 : key === 'grab' ? 100 : key === 'throw' ? 120 : key === 'stamina' ? 130 : 200;
      const c = Math.round(base * Math.pow(1.5, count));
      b.textContent = `Buy — $${c}`;
      b.disabled = s.credits < c;
    });
  }

  // Solids (walls + furniture) only change when a new level starts; rebuildSolids ignores repeats.
  house.rebuildSolids(curWalls);

  // Scrap items with distinct 3D models
  const seenItems = new Set<number>();
  for (const it of s.items) {
    seenItems.add(it.id);
    let mesh = itemMeshes.get(it.id);
    if (!mesh || mesh.userData.kind !== it.kind) {
      if (mesh) { itemGroup.remove(mesh); disposeObject3D(mesh); }
      mesh = makeScrapMesh(it.kind || 'canister');
      itemGroup.add(mesh);
      itemMeshes.set(it.id, mesh);
    }
    const onGround = !it.held && it.z <= 1;
    const bob = onGround ? Math.sin(performance.now() / 400 + it.id) * 3 : 0;
    const p = smooth('i' + it.id, it.x, it.y, it.z);
    const w3 = toWorld(p.x, p.y);
    mesh.scale.setScalar(it.r / 10);
    mesh.position.set(w3.x, it.r + p.z + bob, w3.z);

    if (onGround) {
      mesh.rotation.y = performance.now() / 1200 + it.id;
    }

    const color = itemColor(it.value, it.max);
    if (mesh.userData.coreMat) {
      mesh.userData.coreMat.color.copy(color);
      mesh.userData.coreMat.emissive.copy(color);
      mesh.userData.coreMat.emissiveIntensity = it.held ? 0.75 : 0.35;
    }

    if (it.held === myId) {
      heldViewMesh.visible = true;
      heldViewMesh.scale.setScalar(it.r / 9);
      (heldViewMesh.material as THREE.MeshStandardMaterial).color.copy(color);
      (heldViewMesh.material as THREE.MeshStandardMaterial).emissive.copy(color);
      (heldViewMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.55;
    }
  }
  if (!s.items.some(it => it.held === myId)) heldViewMesh.visible = false;
  for (const [id, mesh] of itemMeshes) if (!seenItems.has(id)) { itemGroup.remove(mesh); disposeObject3D(mesh); itemMeshes.delete(id); }

  // 3D In-World Ping Waypoints
  const seenPings = new Set<number>();
  for (const ping of s.pings || []) {
    seenPings.add(ping.id);
    let spr = pingMeshes.get(ping.id);
    if (!spr) {
      spr = makePingSprite(ping.kind);
      pingGroup.add(spr);
      pingMeshes.set(ping.id, spr);
    }
    const pw = toWorld(ping.x, ping.y);
    const bob = Math.sin(performance.now() / 200 + ping.id) * 3;
    spr.position.set(pw.x, 26 + bob, pw.z);
  }
  for (const [id, spr] of pingMeshes) {
    if (!seenPings.has(id)) {
      pingGroup.remove(spr);
      (spr.material as THREE.Material).dispose();
      pingMeshes.delete(id);
    }
  }

  // Monsters
  s.monsters.forEach((m, i) => {
    let mesh = monsterMeshes.get(i);
    if (!mesh || mesh.userData.kind !== m.kind) {
      if (mesh) disposeMonsterVisual(mesh);
      if (m.kind === 'hunter') {
        mesh = makeHunterMesh();
      } else if (m.kind === 'screamer') {
        mesh = makeGhostMesh();
      } else {
        mesh = makeStalkerMesh();
      }
      monsterGroup.add(mesh); monsterMeshes.set(i, mesh);
    }

    // Audio cue when monster becomes active/aggro'd
    const wasActive = prevMonsterActive.get(i) || false;
    if (m.active && !wasActive) {
      if (m.kind === 'hunter') audio.playHunterRoar();
      else if (m.kind === 'screamer') audio.playScreamerScream();
      else if (m.kind === 'stalker') audio.playStalkerWhisper();
    }
    prevMonsterActive.set(i, m.active);

    const p = smooth('m' + i, m.x, m.y, 0);
    const w3 = toWorld(p.x, p.y);
    const face = updateFacing('m' + i, m.x, m.y);
    mesh.rotation.y = headingToRotationY(face.angle);

    if (m.kind === 'hunter') {
      mesh.position.set(w3.x, 0, w3.z);
      const phase = stepGait('m' + i, face.moving, 16);
      animateGait(mesh.userData, phase, 0.6);
      const mat = mesh.userData.bodyMat as THREE.MeshStandardMaterial;
      mat.color.set(m.active ? 0xee3333 : 0x993333);
      mat.emissive.copy(mat.color); mat.emissiveIntensity = m.active ? 0.5 : 0.12;
    } else if (m.kind === 'screamer') {
      const bob = Math.sin(performance.now() / 500 + i) * 5;
      mesh.position.set(w3.x, 46 + bob, w3.z);
      mesh.rotation.z = Math.sin(performance.now() / 700 + i) * 0.15;
      const mat = mesh.userData.bodyMat as THREE.MeshStandardMaterial;
      mat.color.set(m.active ? 0xcc33ee : 0x724488);
      mat.emissive.copy(mat.color); mat.emissiveIntensity = m.active ? 0.6 : 0.15;
      mat.opacity = m.active ? 0.75 : 0.55;
    } else {
      // Stalker
      mesh.position.set(w3.x, 0, w3.z);
      const phase = stepGait('m' + i, face.moving, 13);
      animateGait(mesh.userData, phase, 0.45);
      const mat = mesh.userData.bodyMat as THREE.MeshStandardMaterial;
      if (m.state === 'fleeing') {
        mat.emissive.set(0x550000);
        mat.emissiveIntensity = 0.55;
      } else if (m.state === 'hunting') {
        mat.emissive.set(0xaa1122);
        mat.emissiveIntensity = 0.85;
      } else {
        mat.emissive.set(0x230e38);
        mat.emissiveIntensity = 0.25;
      }
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
      const mesh = makePlayerMesh();
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
    v.mesh.position.set(w3.x, 0, w3.z);
    v.barGroup.position.set(w3.x, 70, w3.z);
    v.barGroup.quaternion.copy(camera.quaternion);
    v.nameSprite.position.set(w3.x, 82, w3.z);

    const isMe = pl.id === myId;
    v.mesh.visible = !isMe || thirdPerson;
    (v.mesh.userData.bodyMat as THREE.MeshStandardMaterial).color.set(pl.dead ? 0x555555 : 0xcccccc);
    v.mesh.rotation.x = pl.dead ? Math.PI / 2 : 0;

    let faceAngle: number, isWalking: boolean;
    if (isMe) { faceAngle = yaw; isWalking = isMoving && !pl.dead; }
    else { const face = updateFacing('p' + pl.id, pl.x, pl.y); faceAngle = face.angle; isWalking = face.moving && !pl.dead; }
    v.mesh.rotation.y = headingToRotationY(faceAngle);
    const gp = stepGait('p' + pl.id, isWalking);
    animateGait(v.mesh.userData, gp, 0.5);
    if (pl.dead) {
      v.hpFg.scale.x = Math.max(0.001, pl.reviveProg);
      (v.hpFg.material as THREE.MeshBasicMaterial).color.set(0xffcc33);
    } else {
      v.hpFg.scale.x = Math.max(0.001, pl.hp / pl.maxHp);
      (v.hpFg.material as THREE.MeshBasicMaterial).color.set(0x33cc55);
    }
    v.barGroup.visible = !isMe;
    v.nameSprite.visible = !pl.dead && !isMe;
    if (isMe) { meWorld = { x: w3.x, z: w3.z }; mePlayer = pl; lastMeWorld.x = w3.x; lastMeWorld.z = w3.z; }
  }
  for (const [id, v] of playerVisuals) if (!seenPlayers.has(id)) {
    playerGroup.remove(v.mesh); disposeObject3D(v.mesh);
    playerGroup.remove(v.barGroup); playerGroup.remove(v.nameSprite);
    playerVisuals.delete(id);
  }

  // Audio: footsteps while moving
  if (isMoving && mePlayer && !mePlayer.dead) {
    audio.playFootstep(isSprinting && mePlayer.stamina > 0);
  }

  // Proximity to closest monster for heartbeat & flashlight flicker
  let closestMonsterDist = 99999;
  if (mePlayer) {
    for (const m of s.monsters) {
      const d = Math.hypot(m.x - mePlayer.x, m.y - mePlayer.y);
      if (d < closestMonsterDist) closestMonsterDist = d;
    }
    if (closestMonsterDist < 460 && !mePlayer.dead) {
      audio.playHeartbeat(1 - closestMonsterDist / 460);
    }

    // Damage detection, audio, screen shake & red vignette flash
    if (mePlayer.hp < lastHp) {
      audio.playDamage();
      shakeAmount = Math.min(20, shakeAmount + (lastHp - mePlayer.hp) * 0.45);
      vignetteEl.style.opacity = '0.75';
      setTimeout(() => {
        if (mePlayer && mePlayer.hp / mePlayer.maxHp >= 0.35) {
          vignetteEl.style.opacity = '0';
        }
      }, 180);
    }
    lastHp = mePlayer.hp;

    // Pulsing vignette when health is critically low
    if (mePlayer.hp / mePlayer.maxHp < 0.35 && !mePlayer.dead) {
      const pulse = 0.25 + 0.25 * Math.sin(performance.now() / 180);
      vignetteEl.style.opacity = String(pulse);
    } else if (vignetteEl.style.opacity !== '0.75') {
      vignetteEl.style.opacity = '0';
    }
  }

  if (meWorld) {
    if (isMoving && mePlayer && !mePlayer.dead) {
      const speedRate = (isSprinting && mePlayer.stamina > 0) ? 14 : 10;
      bobPhase += 1 / 60 * speedRate;
    } else {
      bobPhase *= 0.9;
    }
    const bobbing = Math.sin(bobPhase) * 1.6;
    const dir = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
    if (thirdPerson) {
      heldViewMesh.visible = false;
      const back = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(-TP_DIST);
      const camPos = new THREE.Vector3(meWorld.x + back.x, EYE_HEIGHT + TP_HEIGHT + bobbing, meWorld.z + back.z);
      camera.position.copy(camPos);
      camera.lookAt(camPos.clone().add(dir.clone().multiplyScalar(400)));
    } else {
      camera.position.set(meWorld.x, EYE_HEIGHT + bobbing, meWorld.z);
      camera.lookAt(camera.position.clone().add(dir));
    }

    // Apply screen shake
    if (shakeAmount > 0.05) {
      camera.position.x += (Math.random() - 0.5) * shakeAmount;
      camera.position.y += (Math.random() - 0.5) * shakeAmount;
      shakeAmount *= 0.88;
    }

    // Flashlight positioning and spooky flicker
    if (flashlightOn) {
      let flIntensity = 3.2;
      if (closestMonsterDist < 250) {
        if (Math.random() < 0.22) {
          flIntensity = 0.4 + Math.random() * 1.6;
        }
      }
      flashlight.intensity = flIntensity;
      if (thirdPerson) {
        flashlight.position.set(meWorld.x, EYE_HEIGHT + 10, meWorld.z);
        flashlight.target.position.set(meWorld.x + dir.x * 200, EYE_HEIGHT, meWorld.z + dir.z * 200);
      } else {
        flashlight.position.copy(camera.position);
        flashlight.target.position.copy(camera.position.clone().add(dir.clone().multiplyScalar(200)));
      }
    } else {
      flashlight.intensity = 0;
    }

    sun.position.set(meWorld.x - 260, 420, meWorld.z + 180);
    sun.target.position.set(meWorld.x, 0, meWorld.z);
    zoneLight.position.set(zoneMesh.position.x, 90, zoneMesh.position.z);
  }

  // HP & Stamina bars in HUD
  if (mePlayer) {
    hpFill.style.width = `${Math.max(0, (mePlayer.hp / mePlayer.maxHp) * 100)}%`;
    staminaFill.style.width = `${Math.max(0, (mePlayer.stamina / mePlayer.maxStamina) * 100)}%`;
  }
  downedHint.style.display = mePlayer?.dead ? 'block' : 'none';
  if (mePlayer?.dead) downedHint.textContent = mePlayer.reviveProg > 0
    ? `Being revived... ${Math.round(mePlayer.reviveProg * 100)}%`
    : 'DOWNED — a teammate must stand near you to revive you';

  drawMinimap(s);
  renderer.render(scene, camera);
}

frame();
