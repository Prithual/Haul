// Sanity-checks every map: `npm run check:maps`
// - nothing overlaps the extraction zone or sticks out of the map
// - furniture doesn't overlap other furniture
// - every open floor cell is reachable from the zone (for players AND for bigger monsters)
import { H, W, ZONE } from '../src/shared';
import { MAPS } from '../src/maps';
import { GW, GH, buildGrid, cellCenter, countFree, countSet, flood } from '../src/nav';

const PLAYER_R = 16, MONSTER_R = 22;
let bad = 0;
const overlap = (a: any, b: any) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

for (const m of Object.values(MAPS)) {
  const errs: string[] = [];
  m.walls.forEach((w, i) => {
    if (w.x < 0 || w.y < 0 || w.x + w.w > W || w.y + w.h > H) errs.push(`#${i} ${w.kind} out of bounds (${w.x},${w.y},${w.w},${w.h})`);
    if (overlap(w, { x: ZONE.x - 20, y: ZONE.y - 20, w: ZONE.w + 40, h: ZONE.h + 40 })) errs.push(`#${i} ${w.kind} overlaps the extraction zone`);
    for (let j = i + 1; j < m.walls.length; j++) {
      const o = m.walls[j];
      if ((w.kind === 'wall' && o.kind === 'wall')) continue;
      if (overlap(w, o)) errs.push(`#${i} ${w.kind} (${w.x},${w.y}) overlaps #${j} ${o.kind} (${o.x},${o.y})`);
    }
  });
  
  for (const [label, r] of [['player', PLAYER_R + 2], ['monster', MONSTER_R + 2]] as const) {
    const g = buildGrid(m.walls, r);
    const seen = flood(g, ZONE.x + ZONE.w / 2, ZONE.y + ZONE.h / 2);
    const lost = countFree(g) - countSet(seen);
    if (lost > 0) {
      let minx = 1e9, miny = 1e9, maxx = 0, maxy = 0;
      for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) if (!g[cy * GW + cx] && !seen[cy * GW + cx]) {
        const c = cellCenter(cx, cy); minx = Math.min(minx, c.x); maxx = Math.max(maxx, c.x); miny = Math.min(miny, c.y); maxy = Math.max(maxy, c.y);
      }
      errs.push(`${lost} ${label}-walkable cells unreachable (bbox ${minx},${miny} → ${maxx},${maxy})`);
    }
    console.log(`  ${label}: ${countSet(seen)} reachable cells of ${countFree(g)} free`);
  }
  console.log(`${errs.length ? '✗' : '✓'} ${m.name} — ${m.walls.length} solids`);
  errs.forEach(e => console.log('    ' + e));
  bad += errs.length;
}
process.exit(bad ? 1 : 0);
