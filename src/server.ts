import { createServer } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, join } from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { MapDef, mapForLevel } from './maps';
import { GW, GH, buildGrid, cellCenter, countFree, countSet, findPath, flood } from './nav';
import { ClientMsg, H, ItemKind, ItemState, MonsterKind, MonsterState, PingState, PlayerState, RoundStats, SHOP_TIME, Snapshot, TICK, Upgrades, UpgradeKey, W, Wall, ZONE } from './shared';

const PUBLIC = join(__dirname, '..', 'public');
const PLAYER_R = 16, ITEM_R = 10, BOAT_R = 32, MONSTER_R = 22, MAX_PLAYERS = 6;
const BASE_WALK = 220, BASE_CARRY = 150, BASE_GRAB = 50, BASE_THROW = 650, BASE_HP = 100, IMPACT_MIN = 250;
const DETECT = 300, SCREAM_RANGE = 550;
const REVIVE_RANGE = 55, REVIVE_TIME = 3; // seconds a living teammate must stay near a downed one
const BOAT_HELP_RANGE = 70; // a second player must be this close to help carry the boat
// The old map (1600x1000) is the baseline the wall/item counts were tuned
// for; scale both by how much bigger the actual map is so density stays similar.
const AREA_SCALE = (W * H) / (1600 * 1000);
// Physics: players and monsters accelerate toward a target velocity rather
// than snapping to it, so starting/stopping/turning has real momentum.
const PLAYER_ACCEL = 1500, PLAYER_BRAKE = 2400;
const MONSTER_ACCEL = 900;
// Gravity + hold height give thrown/dropped items a real arc and fall speed.
const GRAVITY = 1400, HOLD_HEIGHT = 34, ITEM_BOUNCE = 0.32, ITEM_LAND_SETTLE = 70;
// Heavier items (higher max value) are harder to carry fast and don't throw as far.
const WEIGHT_REF = 500;

interface Player extends PlayerState {
  ws: WebSocket;
  dx: number;
  dy: number;
  ax: number;
  ay: number;
  vx: number;
  vy: number;
  stepTimer: number;
  wallsVer: number; // last wall-set version this client was sent
}
interface Item extends ItemState { vx: number; vy: number; vz: number }
interface Monster {
  kind: MonsterKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  active: boolean;
  timer: number;
  state?: 'idle' | 'hunting' | 'stalking' | 'fleeing';
  path: { x: number; y: number }[]; // route through the doorways to (tx, ty)
  repath: number;                   // seconds until the route is recomputed
  wander: number;                   // seconds until an idle monster picks a new room to visit
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
// Move `cur` toward `target` by at most `maxDelta` — the building block for
// acceleration-based (rather than teleport-based) movement.
const moveToward = (cur: number, target: number, maxDelta: number) => {
  const d = target - cur;
  return Math.abs(d) <= maxDelta ? target : cur + Math.sign(d) * maxDelta;
};
const UPGRADE_KEYS: UpgradeKey[] = ['speed', 'hp', 'grab', 'throw', 'stamina', 'scanner'];
const cost = (key: UpgradeKey, count: number) => {
  const base = key === 'speed' ? 150 : key === 'hp' ? 150 : key === 'grab' ? 100 : key === 'throw' ? 120 : key === 'stamina' ? 130 : 200;
  return Math.round(base * Math.pow(1.5, count));
};

function overlapsZone(x: number, y: number, w: number, h: number, pad = 40) {
  return x < ZONE.x + ZONE.w + pad && x + w > ZONE.x - pad && y < ZONE.y + ZONE.h + pad && y + h > ZONE.y - pad;
}
function pointBlocked(x: number, y: number, r: number, walls: Wall[]) {
  return walls.some(w => x + r > w.x && x - r < w.x + w.w && y + r > w.y && y - r < w.y + w.h);
}
// Push a circle out of any wall it overlaps (closest-point method).
function resolveWalls(x: number, y: number, r: number, walls: Wall[]) {
  for (const w of walls) {
    const cx = clamp(x, w.x, w.x + w.w), cy = clamp(y, w.y, w.y + w.h);
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d < r) {
      if (d > 0.001) { x = cx + (dx / d) * r; y = cy + (dy / d) * r; }
      else { // center is inside the wall: push out the shortest side
        const left = x - w.x, right = w.x + w.w - x, top = y - w.y, bottom = w.y + w.h - y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x = w.x - r; else if (m === right) x = w.x + w.w + r;
        else if (m === top) y = w.y - r; else y = w.y + w.h + r;
      }
    }
  }
  return { x: clamp(x, r, W - r), y: clamp(y, r, H - r) };
}
// Cheap line-of-sight: step along the segment and check each sample against the walls.
function canSee(ax: number, ay: number, bx: number, by: number, walls: Wall[]) {
  const d = dist(ax, ay, bx, by), steps = Math.max(1, Math.floor(d / 16));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointBlocked(ax + (bx - ax) * t, ay + (by - ay) * t, 2, walls)) return false;
  }
  return true;
}

// Like canSee, but for a body with radius r — used to decide whether a monster can
// walk straight at its target or has to follow a route around walls and through doors.
function hasClearLine(ax: number, ay: number, bx: number, by: number, r: number, walls: Wall[]) {
  const d = dist(ax, ay, bx, by), steps = Math.max(1, Math.floor(d / 12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (pointBlocked(ax + (bx - ax) * t, ay + (by - ay) * t, r, walls)) return false;
  }
  return true;
}

// Smarter obstacle steering: probe radial angles so monsters steer around corners without getting stuck
function findClearDirection(x: number, y: number, wantAngle: number, r: number, walls: Wall[]): { dx: number; dy: number } {
  const angles = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0];
  for (const da of angles) {
    const a = wantAngle + da;
    const testX = x + Math.cos(a) * (r + 14);
    const testY = y + Math.sin(a) * (r + 14);
    if (!pointBlocked(testX, testY, r, walls)) {
      return { dx: Math.cos(a), dy: Math.sin(a) };
    }
  }
  return { dx: Math.cos(wantAngle), dy: Math.sin(wantAngle) };
}

function randomFreeSpot(walls: Wall[], r: number, avoidZone: boolean) {
  for (let i = 0; i < 40; i++) {
    const x = rand(80, W - 80), y = rand(60, H - 60);
    if (avoidZone && overlapsZone(x, y, 0, 0, 60)) continue;
    if (!pointBlocked(x, y, r + 10, walls)) return { x, y };
  }
  return { x: W / 2, y: H / 2 };
}

class Room {
  players = new Map<string, Player>();
  items: Item[] = [];
  monsters: Monster[] = [];
  walls: Wall[] = [];
  pings: PingState[] = [];
  stats: RoundStats = { itemsHauled: 0, totalBanked: 0, revives: 0 };
  level = Math.max(1, Number(process.env.START_LEVEL) || 1); banked = 0; quota = 0; credits = 0; nextId = 1; nextPingId = 1; resetAt = 0;
  upgrades: Upgrades = { speed: 0, hp: 0, grab: 0, throw: 0, stamina: 0, scanner: 0 };
  status: Snapshot['status'] = 'playing';
  map: MapDef = mapForLevel(1);
  wallsVersion = 0;
  gridP: Uint8Array = new Uint8Array(GW * GH); // walkable grid for players
  gridM: Uint8Array = new Uint8Array(GW * GH); // walkable grid for (bigger) monsters
  reachP: Uint8Array = new Uint8Array(GW * GH); // cells players can actually get to from the extraction zone
  reachM: Uint8Array = new Uint8Array(GW * GH);

  constructor(public code: string) { this.startLevel(); }

  get maxHp() { return BASE_HP + this.upgrades.hp * 20; }
  get maxStamina() { return 100 + this.upgrades.stamina * 25; }
  get walkSpeed() { return BASE_WALK * (1 + this.upgrades.speed * 0.08); }
  get carrySpeed() { return BASE_CARRY * (1 + this.upgrades.speed * 0.08); }
  get grabRange() { return BASE_GRAB + this.upgrades.grab * 12; }
  get throwPower() { return BASE_THROW * (1 + this.upgrades.throw * 0.12); }

  // 1 for a weightless item, shrinking toward 0 as weight grows.
  weightFactor(weight: number) { return 1 / (1 + weight / WEIGHT_REF); }
  carrySpeedFor(weight: number) { return this.carrySpeed * (0.5 + 0.5 * this.weightFactor(weight)); }
  throwPowerFor(weight: number) { return this.throwPower * (0.35 + 0.65 * this.weightFactor(weight)); }

  // The boat is crushingly heavy solo, but manageable once a second living
  // player is standing close enough to be "helping" carry it.
  effectiveWeight(it: Item) {
    if (!it.big) return it.max;
    const helped = [...this.players.values()].some(o => !o.dead && dist(o.x, o.y, it.x, it.y) < BOAT_HELP_RANGE);
    return helped ? it.max * 0.5 : it.max * 6;
  }

  add(ws: WebSocket, name: string): Player {
    const id = Math.random().toString(36).slice(2, 7);
    const p: Player = {
      id, name, x: 0, y: 0,
      hp: this.maxHp, maxHp: this.maxHp,
      stamina: this.maxStamina, maxStamina: this.maxStamina,
      sprinting: false, flashlight: true,
      holding: null, dead: false, reviveProg: 0,
      ws, dx: 0, dy: 0, ax: 0, ay: 0, vx: 0, vy: 0, stepTimer: 0, wallsVer: -1
    };
    this.spawn(p);
    this.players.set(id, p);
    return p;
  }

  remove(p: Player) { this.release(p); this.players.delete(p.id); }

  spawn(p: Player) {
    p.x = ZONE.x + ZONE.w / 2 + rand(-60, 60);
    p.y = ZONE.y + ZONE.h / 2 + rand(-60, 60);
    p.maxHp = this.maxHp; p.hp = this.maxHp;
    p.maxStamina = this.maxStamina; p.stamina = this.maxStamina;
    p.sprinting = false; p.flashlight = true;
    p.dead = false; p.holding = null; p.vx = 0; p.vy = 0; p.reviveProg = 0;
  }

  addPing(x: number, y: number, kind: 'scrap' | 'danger' | 'info', creator: string) {
    if (this.pings.length > 12) this.pings.shift();
    this.pings.push({
      id: this.nextPingId++,
      x: clamp(x, 0, W),
      y: clamp(y, 0, H),
      kind,
      creator,
      ttl: 6
    });
  }

  // Build this level's solids: the map's rooms + furniture, plus a few random crates
  // scattered around. A crate is only kept if every open floor cell is still reachable
  // (by players AND monsters), so random clutter can never wall anyone off.
  generateWalls() {
    this.map = mapForLevel(this.level);
    const walls: Wall[] = this.map.walls.map(w => ({ ...w }));
    const sx = ZONE.x + ZONE.w / 2, sy = ZONE.y + ZONE.h / 2;
    const lost = (g: Uint8Array) => countFree(g) - countSet(flood(g, sx, sy));
    const baseP = lost(buildGrid(walls, PLAYER_R + 2)), baseM = lost(buildGrid(walls, MONSTER_R + 2));
    const want = Math.round(3 + this.level * 1.2);
    for (let placed = 0, tries = 0; placed < want && tries < want * 8; tries++) {
      const w = rand(44, 74), h = rand(44, 74);
      const x = rand(60, W - 60 - w), y = rand(60, H - 60 - h);
      if (overlapsZone(x, y, w, h, 50)) continue;
      if (walls.some(o => x < o.x + o.w + 10 && x + w > o.x - 10 && y < o.y + o.h + 10 && y + h > o.y - 10)) continue;
      walls.push({ x, y, w, h, kind: 'crate' });
      if (lost(buildGrid(walls, PLAYER_R + 2)) > baseP || lost(buildGrid(walls, MONSTER_R + 2)) > baseM) { walls.pop(); continue; }
      placed++;
    }
    this.gridP = buildGrid(walls, PLAYER_R + 2);
    this.gridM = buildGrid(walls, MONSTER_R + 2);
    this.reachP = flood(this.gridP, sx, sy);
    this.reachM = flood(this.gridM, sx, sy);
    return walls;
  }

  // A random reachable floor spot that isn't inside furniture or the extraction zone.
  randomReachableSpot(r: number, grid: Uint8Array, minZoneDist = 0) {
    const zx = ZONE.x + ZONE.w / 2, zy = ZONE.y + ZONE.h / 2;
    for (let i = 0; i < 300; i++) {
      const cx = Math.floor(rand(0, GW)), cy = Math.floor(rand(0, GH));
      if (!grid[cy * GW + cx]) continue;
      const c = cellCenter(cx, cy), x = c.x + rand(-8, 8), y = c.y + rand(-8, 8);
      if (overlapsZone(x, y, 0, 0, 30) || dist(x, y, zx, zy) < minZoneDist) continue;
      if (pointBlocked(x, y, r + 10, this.walls)) continue;
      return { x, y };
    }
    return randomFreeSpot(this.walls, r, true);
  }

  randomNavSpot() { return this.randomReachableSpot(0, this.reachM); }

  startLevel() {
    this.quota = 800 + this.level * 400; this.banked = 0; this.status = 'playing';
    this.walls = this.generateWalls();
    this.wallsVersion++;
    this.items = [];
    this.pings = [];
    this.stats = { itemsHauled: 0, totalBanked: 0, revives: 0 };
    const itemCount = Math.round((9 + this.level * 2) * AREA_SCALE);

    const itemPool: Array<{ kind: ItemKind; minVal: number; maxVal: number; r: number }> = [
      { kind: 'battery', minVal: 160, maxVal: 260, r: 10 },
      { kind: 'canister', minVal: 260, maxVal: 420, r: 12 },
      { kind: 'crate', minVal: 380, maxVal: 620, r: 14 },
      { kind: 'relic', minVal: 600, maxVal: 950, r: 11 },
    ];
    if (this.level >= 2) {
      itemPool.push({ kind: 'engine', minVal: 850, maxVal: 1300, r: 18 });
    }

    for (let i = 0; i < itemCount; i++) {
      const typeDef = itemPool[Math.floor(Math.random() * itemPool.length)];
      const max = Math.round(rand(typeDef.minVal, typeDef.maxVal) * (1 + (this.level - 1) * 0.08));
      const spot = this.randomReachableSpot(typeDef.r, this.reachP);
      this.items.push({
        id: this.nextId++,
        x: spot.x, y: spot.y, z: 0,
        vx: 0, vy: 0, vz: 0,
        value: max, max, held: null,
        r: typeDef.r, big: false,
        kind: typeDef.kind
      });
    }

    // Heavy boat
    {
      const max = Math.round(1400 + this.level * 280);
      const spot = this.randomReachableSpot(BOAT_R, this.reachP);
      this.items.push({
        id: this.nextId++,
        x: spot.x, y: spot.y, z: 0,
        vx: 0, vy: 0, vz: 0,
        value: max, max, held: null,
        r: BOAT_R, big: true,
        kind: 'boat'
      });
    }

    const mk = (kind: MonsterKind, tx = 0, ty = 0): Monster => ({
      kind, ...this.randomReachableSpot(MONSTER_R, this.reachM, 700), vx: 0, vy: 0, tx, ty,
      active: false, timer: 0, state: 'idle', path: [], repath: 0, wander: rand(2, 6),
    });
    this.monsters = [mk('hunter', W / 2, H / 2)];
    if (this.level >= 2) this.monsters.push(mk('screamer'));
    if (this.level >= 3) this.monsters.push(mk('stalker'));
    if (this.level >= 5) this.monsters.push(mk('hunter', W / 3, H / 3));
    for (const m of this.monsters) { const t = this.randomNavSpot(); if (!m.tx && !m.ty) { m.tx = t.x; m.ty = t.y; } }
    this.players.forEach(p => this.spawn(p));
  }

  // Dropping (vz omitted) lets an item thud straight down from hand height;
  // throwing gives it real horizontal + vertical launch speed to arc with.
  release(p: Player, vx = 0, vy = 0, vz = 0) {
    const it = this.items.find(i => i.id === p.holding);
    if (it) { it.held = null; it.vx = vx; it.vy = vy; it.vz = vz; it.z = Math.max(it.z, HOLD_HEIGHT); }
    p.holding = null;
  }

  grab(p: Player) {
    if (p.dead || this.status !== 'playing') return;
    if (p.holding !== null) return this.release(p);
    let best: Item | undefined, bd = this.grabRange;
    for (const it of this.items) {
      const d = dist(it.x, it.y, p.x, p.y);
      if (!it.held && it.z <= 1 && d < bd) { best = it; bd = d; }
    }
    if (best) { best.held = p.id; p.holding = best.id; }
  }

  throwItem(p: Player) {
    if (p.dead || p.holding === null || this.status !== 'playing') return;
    const it = this.items.find(i => i.id === p.holding);
    const power = this.throwPowerFor(it ? this.effectiveWeight(it) : 0);
    const a = Math.atan2(p.ay - p.y, p.ax - p.x);
    this.release(p, Math.cos(a) * power, Math.sin(a) * power, power * 0.42);
  }

  buy(item: UpgradeKey) {
    if (this.status !== 'shop') return;
    const c = cost(item, this.upgrades[item]);
    if (this.credits < c) return;
    this.credits -= c; this.upgrades[item]++;
    if (item === 'hp') for (const p of this.players.values()) { p.maxHp = this.maxHp; p.hp = Math.min(p.maxHp, p.hp + 20); }
    if (item === 'stamina') for (const p of this.players.values()) { p.maxStamina = this.maxStamina; p.stamina = this.maxStamina; }
  }

  // Loud impacts pull the hunter's patrol point and can wake a screamer.
  noise(x: number, y: number, loud: number) {
    for (const m of this.monsters) {
      m.repath = 0;
      if (m.kind === 'hunter' && !m.active && dist(x, y, m.x, m.y) < loud * 1.5) { m.tx = x; m.ty = y; }
      if (m.kind === 'screamer' && dist(x, y, m.x, m.y) < SCREAM_RANGE) { m.active = true; m.timer = 4; m.tx = x; m.ty = y; }
      if (m.kind === 'stalker' && dist(x, y, m.x, m.y) < loud * 1.2) { m.tx = x; m.ty = y; }
    }
  }

  updateItems(dt: number) {
    for (const it of this.items) {
      const p = it.held ? this.players.get(it.held) : undefined;
      if (it.held && (!p || p.dead)) { it.held = null; if (p) p.holding = null; }
      if (p && it.held) {
        const a = Math.atan2(p.ay - p.y, p.ax - p.x);
        let vx = (p.x + Math.cos(a) * 36 - it.x) * 12, vy = (p.y + Math.sin(a) * 36 - it.y) * 12;
        const s = Math.hypot(vx, vy);
        if (s > 500) { vx *= 500 / s; vy *= 500 / s; }
        it.vx = vx; it.vy = vy; it.vz = 0; it.z = HOLD_HEIGHT;
      } else {
        const f = Math.pow(0.2, dt);
        it.vx *= f; it.vy *= f;
      }
      it.x += it.vx * dt; it.y += it.vy * dt;

      let hit = 0;
      if (it.x < it.r || it.x > W - it.r) { hit = Math.abs(it.vx); it.x = clamp(it.x, it.r, W - it.r); it.vx *= -0.5; }
      if (it.y < it.r || it.y > H - it.r) { hit = Math.max(hit, Math.abs(it.vy)); it.y = clamp(it.y, it.r, H - it.r); it.vy *= -0.5; }
      if (!it.held) {
        const before = { x: it.x, y: it.y };
        const r = resolveWalls(it.x, it.y, it.r, this.walls);
        if (r.x !== before.x || r.y !== before.y) hit = Math.max(hit, Math.hypot(it.vx, it.vy));
        it.x = r.x; it.y = r.y;
      }

      // Gravity: falls under acceleration, bounces a bit off the ground, and
      // a hard landing counts as an impact just like slamming into a wall.
      if (!it.held) {
        if (it.z > 0 || it.vz !== 0) {
          it.vz -= GRAVITY * dt;
          it.z += it.vz * dt;
          if (it.z <= 0) {
            it.z = 0;
            hit = Math.max(hit, Math.abs(it.vz));
            it.vz = Math.abs(it.vz) > ITEM_LAND_SETTLE ? -it.vz * ITEM_BOUNCE : 0;
          }
        }
      }

      if (hit > IMPACT_MIN && !it.held) {
        it.value = Math.max(0, it.value - it.max * Math.min(0.6, (hit - IMPACT_MIN) / 1200));
        this.noise(it.x, it.y, hit);
      }

      if (!it.held && it.z <= 1 && it.x > ZONE.x && it.x < ZONE.x + ZONE.w && it.y > ZONE.y && it.y < ZONE.y + ZONE.h) {
        const val = Math.round(it.value);
        this.banked += val;
        this.stats.itemsHauled++;
        this.stats.totalBanked += val;
        it.id = -1; // marked for removal
      }
    }
    this.items = this.items.filter(i => i.id !== -1);
  }

  updateMonsters(dt: number) {
    for (const m of this.monsters) {
      let chasing = false;
      let sp = 80;

      if (m.kind === 'hunter') {
        let target: Player | undefined, best = DETECT;
        for (const p of this.players.values()) {
          const d = dist(p.x, p.y, m.x, m.y);
          if (!p.dead && d < best && canSee(m.x, m.y, p.x, p.y, this.walls)) { best = d; target = p; }
        }
        if (target) {
          chasing = true; m.active = true; m.timer = 2; m.tx = target.x; m.ty = target.y;
          m.state = 'hunting';
        } else if (m.active && (m.timer -= dt) > 0) {
          chasing = true;
          m.state = 'hunting';
        } else {
          m.active = false;
          m.state = 'idle';
        }
        sp = chasing ? Math.min(210, 160 + this.level * 12) : 80;
      } else if (m.kind === 'screamer') {
        for (const p of this.players.values()) if (!p.dead && dist(p.x, p.y, m.x, m.y) < 140) {
          m.tx = p.x; m.ty = p.y; m.active = true; m.timer = 3.5;
        }
        if (m.active) {
          chasing = true; m.timer -= dt; if (m.timer <= 0) m.active = false;
          m.state = 'hunting';
        } else {
          m.state = 'idle';
        }
        sp = chasing ? 250 : 35;
      } else if (m.kind === 'stalker') {
        // Find closest living player
        let closest: Player | undefined, minDist = 99999;
        for (const p of this.players.values()) {
          if (p.dead) continue;
          const d = dist(p.x, p.y, m.x, m.y);
          if (d < minDist) { minDist = d; closest = p; }
        }

        if (closest) {
          // Check if player is shining flashlight directly at stalker
          const toStalkerAngle = Math.atan2(m.y - closest.y, m.x - closest.x);
          const pAngle = Math.atan2(closest.ay - closest.y, closest.ax - closest.x);
          let angleDiff = Math.abs(toStalkerAngle - pAngle);
          while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);

          const isSpotted = closest.flashlight && angleDiff < 0.85 && minDist < 500 && canSee(closest.x, closest.y, m.x, m.y, this.walls);

          if (isSpotted) {
            // Spotted! Retreat into shadow
            m.state = 'fleeing';
            m.active = true;
            chasing = false;
            m.tx = m.x + Math.cos(toStalkerAngle) * 220;
            m.ty = m.y + Math.sin(toStalkerAngle) * 220;
            sp = 190;
          } else if (minDist < 90) {
            // Lunging attack range!
            m.state = 'hunting';
            m.active = true;
            chasing = true;
            m.tx = closest.x; m.ty = closest.y;
            sp = 220;
          } else {
            // Stealthily creep closer behind player
            m.state = 'stalking';
            m.active = false;
            chasing = true;
            m.tx = closest.x; m.ty = closest.y;
            sp = 145;
          }
        } else {
          m.state = 'idle';
          sp = 60;
        }
      }

      let d = dist(m.tx, m.ty, m.x, m.y);
      // Idle monsters patrol: once they arrive (or get bored) they pick another room to walk to.
      if (!chasing && m.state !== 'fleeing') {
        m.wander -= dt;
        const arrived = d < 30 || (m.path.length === 1 && dist(m.x, m.y, m.path[0].x, m.path[0].y) < 26);
        if (arrived || m.wander <= 0) {
          const t = this.randomNavSpot();
          m.tx = t.x; m.ty = t.y; m.wander = rand(8, 14); m.path = []; m.repath = 0;
          d = dist(m.tx, m.ty, m.x, m.y);
        }
      }

      // Navigation: walk straight at the target if nothing is in the way, otherwise follow
      // a route through the doorways (recomputed a few times a second while chasing).
      let goalX = m.tx, goalY = m.ty;
      if (d > 40 && !hasClearLine(m.x, m.y, m.tx, m.ty, MONSTER_R - 2, this.walls)) {
        m.repath -= dt;
        if (m.repath <= 0 || m.path.length === 0) {
          m.path = findPath(this.gridM, m.x, m.y, m.tx, m.ty);
          m.repath = chasing ? 0.4 : 1.2;
        }
        while (m.path.length > 1 && dist(m.x, m.y, m.path[0].x, m.path[0].y) < 26) m.path.shift();
        // Cut corners: head for the furthest of the next few waypoints that's in clear view.
        for (let k = Math.min(m.path.length - 1, 6); k > 0; k--) {
          if (hasClearLine(m.x, m.y, m.path[k].x, m.path[k].y, MONSTER_R - 2, this.walls)) { m.path.splice(0, k); break; }
        }
        if (m.path.length) { goalX = m.path[0].x; goalY = m.path[0].y; }
      } else m.path = [];

      const wantAngle = Math.atan2(goalY - m.y, goalX - m.x);
      // Smart navigation around walls
      const steer = findClearDirection(m.x, m.y, wantAngle, MONSTER_R, this.walls);
      const wantX = d > 1 ? steer.dx * sp : 0;
      const wantY = d > 1 ? steer.dy * sp : 0;

      const accel = MONSTER_ACCEL * dt;
      m.vx = moveToward(m.vx, wantX, accel); m.vy = moveToward(m.vy, wantY, accel);
      const r = resolveWalls(m.x + m.vx * dt, m.y + m.vy * dt, MONSTER_R, this.walls);
      if (r.x === m.x) m.vx = 0; if (r.y === m.y) m.vy = 0;
      m.x = r.x; m.y = r.y;

      for (const p of this.players.values()) {
        if (!p.dead && dist(p.x, p.y, m.x, m.y) < PLAYER_R + MONSTER_R) {
          const dmg = m.kind === 'stalker' ? 50 : 40;
          p.hp -= dmg * dt;
          if (p.hp <= 0) { p.hp = 0; p.dead = true; this.release(p); }
        }
      }
    }
  }

  // A downed player ("dead") can be revived: any living teammate standing
  // close enough for long enough brings them back with partial health.
  updateRevives(dt: number) {
    for (const p of this.players.values()) {
      if (!p.dead) { p.reviveProg = 0; continue; }
      const helper = [...this.players.values()].some(o => o !== p && !o.dead && dist(o.x, o.y, p.x, p.y) < REVIVE_RANGE);
      if (helper) {
        p.reviveProg += dt / REVIVE_TIME;
        if (p.reviveProg >= 1) {
          p.dead = false;
          p.reviveProg = 0;
          p.hp = Math.round(p.maxHp * 0.4);
          this.stats.revives++;
        }
      } else {
        p.reviveProg = Math.max(0, p.reviveProg - dt / REVIVE_TIME); // drains if left alone
      }
    }
  }

  tick(dt: number) {
    if (this.status === 'shop') {
      if (Date.now() > this.resetAt) { this.level++; this.startLevel(); }
      return;
    }
    if (this.status !== 'playing') {
      if (Date.now() > this.resetAt) {
        this.level = 1; this.credits = 0;
        this.upgrades = { speed: 0, hp: 0, grab: 0, throw: 0, stamina: 0, scanner: 0 };
        this.startLevel();
      }
      return;
    }

    // Update pings
    for (const ping of this.pings) {
      ping.ttl -= dt;
    }
    this.pings = this.pings.filter(p => p.ttl > 0);

    for (const p of this.players.values()) {
      if (p.dead) continue;
      const len = Math.hypot(p.dx, p.dy);
      const isMoving = len > 0;

      // Sprinting and stamina
      let sprintMult = 1.0;
      if (p.sprinting && isMoving && p.stamina > 0) {
        p.stamina = Math.max(0, p.stamina - 28 * dt);
        sprintMult = 1.45;
        // Sprinting footsteps noise attracts nearby monsters
        p.stepTimer = (p.stepTimer || 0) + dt;
        if (p.stepTimer > 0.35) {
          p.stepTimer = 0;
          this.noise(p.x, p.y, 175);
        }
      } else {
        if (!p.sprinting) {
          p.stamina = Math.min(p.maxStamina, p.stamina + 22 * dt);
        }
      }

      let maxSpd = this.walkSpeed * sprintMult;
      if (p.holding !== null) {
        const held = this.items.find(i => i.id === p.holding);
        maxSpd = this.carrySpeedFor(held ? this.effectiveWeight(held) : 0) * (p.sprinting && p.stamina > 0 ? 1.3 : 1.0);
      }
      const wantX = isMoving ? (p.dx / len) * maxSpd : 0;
      const wantY = isMoving ? (p.dy / len) * maxSpd : 0;
      // Braking (no input) pulls up quicker than accelerating does, so stops feel snappy but starts still ramp up.
      const accel = (isMoving ? PLAYER_ACCEL : PLAYER_BRAKE) * dt;
      p.vx = moveToward(p.vx, wantX, accel); p.vy = moveToward(p.vy, wantY, accel);
      if (p.vx === 0 && p.vy === 0) continue;
      const r = resolveWalls(p.x + p.vx * dt, p.y + p.vy * dt, PLAYER_R, this.walls);
      if (r.x === p.x) p.vx = 0; if (r.y === p.y) p.vy = 0; // wall stopped that axis — kill momentum into it
      p.x = r.x; p.y = r.y;
    }
    this.updateItems(dt);
    this.updateMonsters(dt);
    this.updateRevives(dt);

    if (this.banked >= this.quota) {
      this.credits += Math.max(0, this.banked - this.quota);
      this.status = 'shop'; this.resetAt = Date.now() + SHOP_TIME * 1000;
    } else if (this.items.length === 0 || [...this.players.values()].every(p => p.dead)) {
      this.status = 'lost'; this.resetAt = Date.now() + 5000;
    }
  }

  broadcast() {
    const snap: Snapshot = {
      t: 'state',
      players: [...this.players.values()].map(({ id, name, x, y, hp, maxHp, stamina, maxStamina, sprinting, flashlight, holding, dead, reviveProg }) => ({
        id, name, x, y, hp, maxHp, stamina: Math.round(stamina), maxStamina, sprinting, flashlight, holding, dead, reviveProg
      })),
      items: this.items.map(({ id, x, y, z, value, max, held, r, big, kind }) => ({
        id, x, y, z: Math.round(z), value: Math.round(value), max, held, r, big, kind
      })),
      monsters: this.monsters.map(({ kind, x, y, active, state }): MonsterState => ({
        kind, x, y, active, state
      })),
      pings: this.pings,
      banked: this.banked, quota: this.quota, level: this.level, credits: this.credits, upgrades: this.upgrades,
      shopTimeLeft: this.status === 'shop' ? Math.max(0, Math.ceil((this.resetAt - Date.now()) / 1000)) : 0,
      status: this.status,
      stats: this.stats,
    };
    // The (large, rarely-changing) wall list only goes to a client when it's new to the level.
    const data = JSON.stringify(snap);
    let withWalls: string | undefined;
    for (const p of this.players.values()) {
      if (p.ws.readyState !== WebSocket.OPEN) continue;
      if (p.wallsVer !== this.wallsVersion) {
        withWalls ??= JSON.stringify({ ...snap, walls: this.walls, mapId: this.map.id });
        p.ws.send(withWalls); p.wallsVer = this.wallsVersion;
      } else p.ws.send(data);
    }
  }
}

// ---- Rooms ----
const rooms = new Map<string, Room>();
function createRoom(): Room {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
  let code = '';
  do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); } while (rooms.has(code));
  const room = new Room(code);
  rooms.set(code, room);
  return room;
}

// ---- HTTP + WebSocket ----
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const file = join(PUBLIC, url === '/' ? 'index.html' : url);
  if (!file.startsWith(PUBLIC) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  let room: Room | undefined;
  let player: Player | undefined;
  const fail = (msg: string) => ws.send(JSON.stringify({ t: 'error', msg }));

  ws.on('message', raw => {
    let m: ClientMsg;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.t === 'join') {
      if (player) return;
      const name = String(m.name || '').trim().slice(0, 12) || 'Player';
      const code = String(m.room || '').trim().toUpperCase();
      const found = code ? rooms.get(code) : undefined;
      if (code && !found) return fail(`Room ${code} not found.`);
      const r = found ?? createRoom();
      if (r.players.size >= MAX_PLAYERS) return fail('That room is full (6 players max).');
      room = r;
      player = r.add(ws, name);
      ws.send(JSON.stringify({ t: 'hello', id: player.id, room: r.code }));
      return;
    }

    if (!room || !player) return;
    if (m.t === 'input') {
      const n = (v: unknown, lo: number, hi: number) => clamp(Number.isFinite(v) ? (v as number) : 0, lo, hi);
      player.dx = n(m.dx, -1, 1); player.dy = n(m.dy, -1, 1);
      player.ax = n(m.ax, 0, W); player.ay = n(m.ay, 0, H);
      if (typeof m.sprint === 'boolean') player.sprinting = m.sprint;
    } else if (m.t === 'grab') room.grab(player);
    else if (m.t === 'throw') room.throwItem(player);
    else if (m.t === 'buy' && UPGRADE_KEYS.includes(m.item)) room.buy(m.item);
    else if (m.t === 'flashlight') player.flashlight = !!m.on;
    else if (m.t === 'ping') room.addPing(m.x, m.y, m.kind || 'info', player.name);
  });

  ws.on('close', () => {
    if (!room || !player) return;
    room.remove(player);
    if (room.players.size === 0) rooms.delete(room.code); // empty rooms are removed
  });
});

setInterval(() => {
  for (const room of rooms.values()) { room.tick(1 / TICK); room.broadcast(); }
}, 1000 / TICK);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`Game server running on http://localhost:${PORT}`));
