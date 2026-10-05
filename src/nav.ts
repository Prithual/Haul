import { H, W, Wall } from './shared';

// A coarse walkability grid. `buildGrid` marks every cell whose centre would make a
// circle of radius `r` overlap a wall (or the map edge) as blocked (1). With rooms and
// doorways, monsters can't just steer straight at a target any more — they BFS over
// this grid to find a route through the doors.
export const CELL = 20;
export const GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const cellX = (x: number) => clamp(Math.floor(x / CELL), 0, GW - 1);
export const cellY = (y: number) => clamp(Math.floor(y / CELL), 0, GH - 1);
export const cellCenter = (cx: number, cy: number) => ({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });

export function buildGrid(walls: Wall[], r: number): Uint8Array {
  const g = new Uint8Array(GW * GH);
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
    const c = cellCenter(cx, cy);
    if (c.x < r || c.x > W - r || c.y < r || c.y > H - r) g[cy * GW + cx] = 1;
  }
  for (const w of walls) {
    const x0 = cellX(w.x - r), x1 = cellX(w.x + w.w + r), y0 = cellY(w.y - r), y1 = cellY(w.y + w.h + r);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = cellCenter(cx, cy);
      const dx = c.x - clamp(c.x, w.x, w.x + w.w), dy = c.y - clamp(c.y, w.y, w.y + w.h);
      if (Math.hypot(dx, dy) < r) g[cy * GW + cx] = 1;
    }
  }
  return g;
}

// Nearest unblocked cell to a world point (searches outward in rings).
export function nearestFree(g: Uint8Array, x: number, y: number, maxRing = 12): { cx: number; cy: number } | null {
  const sx = cellX(x), sy = cellY(y);
  if (!g[sy * GW + sx]) return { cx: sx, cy: sy };
  for (let ring = 1; ring <= maxRing; ring++) {
    let best: { cx: number; cy: number } | null = null, bd = Infinity;
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const cx = sx + dx, cy = sy + dy;
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || g[cy * GW + cx]) continue;
      const c = cellCenter(cx, cy), d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) { bd = d; best = { cx, cy }; }
    }
    if (best) return best;
  }
  return null;
}

// 1 for every free cell reachable from (sx, sy), 0 otherwise.
export function flood(g: Uint8Array, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(GW * GH);
  const start = nearestFree(g, sx, sy);
  if (!start) return seen;
  const q = new Int32Array(GW * GH); let head = 0, tail = 0;
  q[tail++] = start.cy * GW + start.cx; seen[q[0]] = 1;
  while (head < tail) {
    const i = q[head++], cx = i % GW, cy = (i / GW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (g[ni] || seen[ni]) continue;
      seen[ni] = 1; q[tail++] = ni;
    }
  }
  return seen;
}

export const countFree = (g: Uint8Array) => { let n = 0; for (let i = 0; i < g.length; i++) if (!g[i]) n++; return n; };
export const countSet = (s: Uint8Array) => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i]) n++; return n; };

// Shortest 8-way route between two world points (BFS; diagonals never cut corners).
// Returns cell-centre waypoints from start to goal, or [] if there's no route.
export function findPath(g: Uint8Array, fx: number, fy: number, tx: number, ty: number): { x: number; y: number }[] {
  const s = nearestFree(g, fx, fy), e = nearestFree(g, tx, ty);
  if (!s || !e) return [];
  const si = s.cy * GW + s.cx, ei = e.cy * GW + e.cx;
  if (si === ei) return [cellCenter(e.cx, e.cy)];
  const prev = new Int32Array(GW * GH).fill(-1);
  const q = new Int32Array(GW * GH); let head = 0, tail = 0;
  q[tail++] = si; prev[si] = si;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = false;
  while (head < tail && !found) {
    const i = q[head++], cx = i % GW, cy = (i / GW) | 0;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (g[ni] || prev[ni] !== -1) continue;
      if (dx !== 0 && dy !== 0 && (g[cy * GW + nx] || g[ny * GW + cx])) continue;
      prev[ni] = i; q[tail++] = ni;
      if (ni === ei) { found = true; break; }
    }
  }
  if (!found) return [];
  const path: { x: number; y: number }[] = [];
  for (let i = ei; i !== si; i = prev[i]) path.push(cellCenter(i % GW, (i / GW) | 0));
  return path.reverse();
}
