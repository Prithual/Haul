import { Face, Wall, WallKind } from './shared';

// Every map fills the whole 2200x1400 play area and is *inside* a building: the
// map edge is the outer wall. Rooms are divided by partition walls with doorways,
// and furniture doubles as collision. The extraction zone (ZONE, bottom-left)
// must always stay clear — `npm run check:maps` verifies that and that every
// room is reachable by both players and monsters.

export type FloorType =
  | 'wood' | 'darkwood' | 'tile' | 'tileblue' | 'carpet' | 'carpetred'
  | 'carpetgreen' | 'concrete' | 'checker' | 'stone';

export interface FloorPatch { x: number; y: number; w: number; h: number; type: FloorType; name: string }
export interface Rug { x: number; y: number; w: number; h: number; color: number }

export interface MapDef {
  id: string;
  name: string;
  blurb: string;
  ceilingH: number;
  windows: boolean;
  wallColor: number;     // wallpaper / paint base color
  trimColor: number;     // baseboards & wall caps
  ceilingColor: number;
  ambient: number;       // background + fog color
  fog: [number, number];
  hemiSky: number; hemiGround: number; hemiI: number;
  sunColor: number; sunI: number;
  floors: FloorPatch[];
  rugs: Rug[];
  walls: Wall[];
}

const T = 24; // partition wall thickness
type Gap = [number, number];

// Horizontal wall centred on y, running x1..x2, with doorway gaps cut out.
function hwall(y: number, x1: number, x2: number, gaps: Gap[] = []): Wall[] {
  const out: Wall[] = []; let cur = x1;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a > cur) out.push({ x: cur, y: y - T / 2, w: a - cur, h: T, kind: 'wall' });
    cur = b;
  }
  if (x2 > cur) out.push({ x: cur, y: y - T / 2, w: x2 - cur, h: T, kind: 'wall' });
  return out;
}
// Vertical wall centred on x, running y1..y2, with doorway gaps cut out.
function vwall(x: number, y1: number, y2: number, gaps: Gap[] = []): Wall[] {
  const out: Wall[] = []; let cur = y1;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a > cur) out.push({ x: x - T / 2, y: cur, w: T, h: a - cur, kind: 'wall' });
    cur = b;
  }
  if (y2 > cur) out.push({ x: x - T / 2, y: cur, w: T, h: y2 - cur, kind: 'wall' });
  return out;
}
const f = (kind: WallKind, x: number, y: number, w: number, h: number, face?: Face): Wall =>
  face ? { kind, x, y, w, h, face } : { kind, x, y, w, h };
const fl = (name: string, type: FloorType, x: number, y: number, w: number, h: number): FloorPatch => ({ name, type, x, y, w, h });
const rug = (x: number, y: number, w: number, h: number, color: number): Rug => ({ x, y, w, h, color });

// ---------------------------------------------------------------------------
// 1. FAMILY HOUSE — living room, kitchen, bedroom up top; hallway; garage,
//    bathroom, dining room and study below. The classic starter map.
// ---------------------------------------------------------------------------
const familyHouse: MapDef = {
  id: 'house', name: 'Family House', blurb: 'Cozy… until the lights go out.',
  ceilingH: 150, windows: true,
  wallColor: 0xb89a6a, trimColor: 0x3a2618, ceilingColor: 0x2a2018,
  ambient: 0x15100c, fog: [260, 1500],
  hemiSky: 0xffdca8, hemiGround: 0x1a120c, hemiI: 0.6, sunColor: 0xffcf8a, sunI: 0.8,
  floors: [
    fl('Living Room', 'wood', 0, 0, 900, 600),
    fl('Kitchen', 'tile', 900, 0, 600, 600),
    fl('Bedroom', 'carpet', 1500, 0, 700, 600),
    fl('Hallway', 'darkwood', 0, 600, 2200, 200),
    fl('Garage', 'concrete', 0, 800, 500, 600),
    fl('Bathroom', 'tileblue', 500, 800, 400, 600),
    fl('Dining Room', 'wood', 900, 800, 700, 600),
    fl('Study', 'carpetgreen', 1600, 800, 600, 600),
  ],
  rugs: [
    rug(180, 150, 320, 280, 0x7a2f2f), rug(1650, 180, 300, 240, 0x2d4a6b),
    rug(600, 1000, 200, 140, 0x2b6a8a), rug(1020, 960, 480, 300, 0x6b3a2a),
    rug(1720, 940, 300, 260, 0x3f5a3a),
  ],
  walls: [
    ...hwall(600, 0, 2200, [[380, 500], [1100, 1220], [1780, 1900]]),
    ...hwall(800, 0, 2200, [[200, 330], [640, 760], [1200, 1320], [1850, 1970]]),
    ...vwall(900, 0, 600, [[240, 360]]),
    ...vwall(1500, 0, 600, [[240, 360]]),
    ...vwall(500, 800, 1400, [[1000, 1120]]),
    ...vwall(900, 800, 1400, [[1000, 1120]]),
    ...vwall(1600, 800, 1400, [[1000, 1120]]),
    // living room
    f('shelf', 4, 60, 40, 220, 'w'), f('tv', 200, 4, 220, 44, 'n'),
    f('table', 240, 180, 150, 70), f('sofa', 200, 300, 240, 90, 's'),
    f('sofa', 640, 220, 90, 90, 'w'), f('plant', 840, 530, 46, 46), f('plant', 30, 530, 46, 46),
    // kitchen
    f('counter', 930, 4, 490, 56, 'n'), f('fridge', 1424, 4, 60, 66, 'n'),
    f('counter', 1030, 230, 300, 90, 'o'),
    f('chair', 1060, 330, 36, 36), f('chair', 1130, 330, 36, 36), f('chair', 1200, 330, 36, 36), f('chair', 1270, 330, 36, 36),
    f('plant', 1440, 520, 46, 46),
    // bedroom
    f('bed', 1880, 4, 300, 210, 'n'), f('rack', 1524, 4, 220, 60, 'n'), f('table', 1836, 20, 36, 36),
    f('desk', 1560, 510, 170, 70, 's'), f('chair', 1615, 450, 38, 38), f('rack', 2090, 500, 90, 80, 's'),
    f('plant', 2130, 260, 46, 46),
    // hallway
    f('plant', 30, 640, 44, 44), f('plant', 2130, 720, 44, 44), f('table', 700, 616, 160, 36, 'n'),
    // garage
    f('shelf', 4, 890, 40, 230, 'w'), f('washer', 4, 820, 70, 60), f('washer', 78, 820, 64, 60),
    f('counter', 340, 818, 140, 56, 'n'),
    f('crate', 400, 1230, 70, 70), f('crate', 330, 1300, 60, 60), f('crate', 410, 1310, 54, 54),
    // bathroom
    f('tub', 520, 1300, 360, 76, 's'), f('counter', 770, 822, 110, 54, 'n'),
    f('rack', 526, 830, 60, 80, 'n'), f('plant', 836, 1230, 44, 44),
    // dining room
    f('table', 1080, 1030, 340, 160),
    f('chair', 1120, 984, 40, 40), f('chair', 1240, 984, 40, 40), f('chair', 1340, 984, 40, 40),
    f('chair', 1120, 1196, 40, 40), f('chair', 1240, 1196, 40, 40), f('chair', 1340, 1196, 40, 40),
    f('rack', 1000, 1340, 260, 50, 's'), f('plant', 930, 1330, 46, 46), f('plant', 1540, 830, 46, 46),
    // study
    f('desk', 1900, 1290, 240, 80, 's'), f('chair', 2000, 1240, 40, 40),
    f('shelf', 2156, 880, 40, 300, 'e'), f('shelf', 1616, 1250, 40, 130, 'w'),
    f('sofa', 1680, 1290, 200, 80, 's'), f('table', 1780, 1000, 120, 90), f('plant', 2130, 830, 46, 46),
  ],
};

// ---------------------------------------------------------------------------
// 2. MANOR — a grand central hall with a library, ballroom and entry hall on
//    the left, kitchen, dining room and master suite on the right.
// ---------------------------------------------------------------------------
const manor: MapDef = {
  id: 'manor', name: 'Old Manor', blurb: 'Long corridors. Louder footsteps.',
  ceilingH: 190, windows: true,
  wallColor: 0x8a4a5c, trimColor: 0x3a2a18, ceilingColor: 0x1c1418,
  ambient: 0x120d12, fog: [240, 1400],
  hemiSky: 0xf0d0e0, hemiGround: 0x150e14, hemiI: 0.55, sunColor: 0xffc0a0, sunI: 0.7,
  floors: [
    fl('Library', 'darkwood', 0, 0, 1000, 460),
    fl('Ballroom', 'checker', 0, 460, 1000, 470),
    fl('Entry Hall', 'stone', 0, 930, 1000, 470),
    fl('Great Hall', 'carpetred', 1000, 0, 200, 1400),
    fl('Kitchen', 'tile', 1200, 0, 1000, 460),
    fl('Dining Room', 'darkwood', 1200, 460, 1000, 470),
    fl('Master Suite', 'carpet', 1200, 930, 1000, 470),
  ],
  rugs: [
    rug(360, 120, 340, 260, 0x6a2a3a), rug(300, 540, 400, 300, 0x2a2a55),
    rug(1040, 20, 120, 1360, 0x7a1f2a), rug(1560, 540, 540, 300, 0x2a4a3a),
    rug(1600, 1100, 260, 220, 0x5a2a2a),
  ],
  walls: [
    ...vwall(1000, 0, 1400, [[180, 300], [640, 760], [1100, 1220]]),
    ...vwall(1200, 0, 1400, [[180, 300], [640, 760], [1100, 1220]]),
    ...hwall(460, 0, 1000, [[400, 520]]),
    ...hwall(930, 0, 1000, [[600, 720]]),
    ...hwall(460, 1200, 2200, [[1500, 1620]]),
    ...hwall(930, 1200, 2200, [[1700, 1820]]),
    // library
    f('shelf', 40, 4, 900, 44, 'n'), f('shelf', 4, 120, 40, 260, 'w'),
    f('table', 420, 170, 220, 100),
    f('chair', 450, 128, 38, 38), f('chair', 560, 128, 38, 38), f('chair', 450, 278, 38, 38), f('chair', 560, 278, 38, 38),
    f('sofa', 110, 240, 90, 90, 'w'), f('sofa', 720, 250, 90, 90, 'e'), f('plant', 940, 400, 44, 44),
    // ballroom
    f('pillar', 250, 600, 54, 54), f('pillar', 700, 600, 54, 54), f('pillar', 250, 780, 54, 54), f('pillar', 700, 780, 54, 54),
    f('table', 40, 640, 150, 120), f('plant', 930, 490, 44, 44), f('plant', 930, 860, 44, 44), f('plant', 30, 490, 44, 44),
    // entry hall
    f('sofa', 450, 1276, 240, 80, 's'), f('table', 770, 1260, 150, 90), f('rack', 340, 1344, 100, 44, 's'),
    f('plant', 940, 1330, 46, 46), f('rack', 4, 942, 40, 150, 'w'),
    // great hall
    f('plant', 1020, 30, 44, 44), f('plant', 1136, 30, 44, 44), f('plant', 1020, 1330, 44, 44), f('plant', 1136, 1330, 44, 44),
    f('pillar', 1078, 380, 44, 44), f('pillar', 1078, 960, 44, 44),
    // kitchen
    f('counter', 1230, 4, 700, 56, 'n'), f('fridge', 2110, 4, 80, 80, 'n'),
    f('counter', 1500, 170, 320, 100, 'o'),
    f('chair', 1540, 280, 36, 36), f('chair', 1620, 280, 36, 36), f('chair', 1700, 280, 36, 36), f('chair', 1780, 280, 36, 36),
    f('counter', 2140, 140, 50, 260, 'e'), f('plant', 1230, 400, 44, 44),
    // dining room
    f('table', 1620, 620, 420, 140),
    f('chair', 1650, 570, 38, 38), f('chair', 1790, 570, 38, 38), f('chair', 1930, 570, 38, 38),
    f('chair', 1650, 772, 38, 38), f('chair', 1790, 772, 38, 38), f('chair', 1930, 772, 38, 38),
    f('rack', 2130, 500, 60, 340, 'e'), f('plant', 1230, 500, 44, 44), f('plant', 1230, 870, 44, 44),
    // master suite
    f('bed', 1890, 1140, 300, 220, 'e'), f('rack', 1290, 1344, 400, 44, 's'),
    f('desk', 1300, 946, 150, 64, 'n'), f('chair', 1340, 1010, 38, 38),
    f('sofa', 1300, 1240, 200, 80, 's'), f('table', 1840, 1150, 40, 44), f('plant', 1230, 1340, 46, 46),
  ],
};

// ---------------------------------------------------------------------------
// 3. BASEMENT — low concrete ceilings, shelf aisles, pillars, a laundry room,
//    a boiler room and a wine cellar. Cold, dark and cramped.
// ---------------------------------------------------------------------------
const basement: MapDef = {
  id: 'basement', name: 'The Basement', blurb: 'Low ceilings. Pipes groan overhead.',
  ceilingH: 115, windows: false,
  wallColor: 0x6a7076, trimColor: 0x22262a, ceilingColor: 0x14171a,
  ambient: 0x090b0e, fog: [200, 1100],
  hemiSky: 0x9fb8d8, hemiGround: 0x0a0c10, hemiI: 0.42, sunColor: 0xa0b8ff, sunI: 0.45,
  floors: [
    fl('Laundry', 'tile', 0, 0, 600, 450),
    fl('Storage', 'concrete', 600, 0, 900, 450),
    fl('Boiler Room', 'stone', 1500, 0, 700, 450),
    fl('Main Floor', 'concrete', 0, 450, 2200, 500),
    fl('Lower Floor', 'concrete', 0, 950, 1700, 450),
    fl('Wine Cellar', 'darkwood', 1700, 950, 500, 450),
  ],
  rugs: [rug(1780, 1060, 320, 220, 0x4a1f26)],
  walls: [
    ...hwall(450, 0, 600, [[200, 330]]), ...vwall(600, 0, 450, [[160, 280]]),
    ...hwall(450, 1500, 2200, [[1750, 1870]]), ...vwall(1500, 0, 450, [[160, 280]]),
    ...hwall(950, 1700, 2200, [[1900, 2020]]), ...vwall(1700, 950, 1400, [[1150, 1270]]),
    // laundry
    f('washer', 4, 4, 70, 70), f('washer', 80, 4, 70, 70), f('washer', 156, 4, 70, 70),
    f('shelf', 4, 140, 40, 200, 'w'), f('table', 320, 120, 180, 70), f('crate', 520, 380, 50, 50),
    // storage
    f('shelf', 700, 4, 300, 44, 'n'), f('shelf', 1100, 4, 300, 44, 'n'), f('shelf', 700, 150, 300, 40, 's'),
    f('crate', 1100, 250, 60, 60), f('crate', 1170, 250, 60, 60), f('crate', 1135, 320, 60, 60),
    // main floor shelf aisles + pillars
    f('shelf', 200, 560, 500, 40, 'n'), f('shelf', 200, 700, 500, 40, 's'),
    f('shelf', 1000, 560, 500, 40, 'n'), f('shelf', 1000, 700, 500, 40, 's'),
    f('pillar', 400, 850, 50, 50), f('pillar', 800, 850, 50, 50), f('pillar', 1200, 850, 50, 50), f('pillar', 1600, 850, 50, 50),
    f('pillar', 400, 1150, 50, 50), f('pillar', 800, 1150, 50, 50), f('pillar', 1200, 1150, 50, 50), f('pillar', 1500, 1150, 50, 50),
    f('crate', 150, 900, 60, 60), f('crate', 1650, 700, 70, 70), f('crate', 2000, 600, 80, 60),
    f('crate', 700, 1300, 70, 70), f('crate', 1000, 1050, 60, 60), f('crate', 1350, 1300, 80, 60),
    // boiler room
    f('boiler', 1900, 60, 150, 150), f('boiler', 1560, 300, 100, 100), f('rack', 2140, 240, 50, 160, 'e'),
    // wine cellar
    f('rack', 1730, 990, 160, 44, 'n'), f('rack', 2050, 990, 140, 44, 'n'), f('rack', 2144, 1080, 46, 260, 'e'),
    f('rack', 1740, 1346, 450, 44, 's'), f('table', 1900, 1160, 120, 80),
  ],
};

// ---------------------------------------------------------------------------
// 4. ATTIC — one big dusty room under the roof: chimney stack, roof posts,
//    trunks and boxes, plus two half-walls that break up the sightlines.
// ---------------------------------------------------------------------------
const attic: MapDef = {
  id: 'attic', name: 'The Attic', blurb: 'Dust, cobwebs and things that creak.',
  ceilingH: 125, windows: true,
  wallColor: 0x6a5a48, trimColor: 0x2a1e14, ceilingColor: 0x1a120c,
  ambient: 0x0e0a08, fog: [220, 1200],
  hemiSky: 0xffd9a0, hemiGround: 0x150e08, hemiI: 0.48, sunColor: 0xffbb70, sunI: 0.6,
  floors: [fl('Attic', 'darkwood', 0, 0, 2200, 1400)],
  rugs: [rug(1000, 1000, 400, 260, 0x4a3a2a), rug(300, 300, 300, 200, 0x3a2a3a)],
  walls: [
    ...vwall(700, 0, 900, [[300, 520]]),
    ...vwall(1500, 500, 1400, [[860, 1080]]),
    f('pillar', 1000, 580, 150, 150),
    f('pillar', 460, 1050, 40, 40), f('pillar', 1100, 250, 40, 40), f('pillar', 1900, 300, 40, 40),
    f('pillar', 1900, 1000, 40, 40), f('pillar', 1250, 1150, 40, 40), f('pillar', 400, 700, 40, 40),
    f('trunk', 100, 60, 120, 70), f('trunk', 2000, 1250, 120, 70), f('trunk', 1800, 700, 130, 70),
    f('trunk', 800, 1250, 120, 70),
    f('crate', 300, 100, 70, 70), f('crate', 380, 110, 56, 56), f('crate', 340, 170, 50, 50),
    f('crate', 1600, 100, 70, 70), f('crate', 1900, 550, 60, 60), f('crate', 900, 300, 80, 60),
    f('crate', 1700, 1000, 60, 60), f('crate', 600, 1000, 70, 70), f('crate', 500, 1290, 60, 60),
    f('bed', 1750, 60, 200, 120, 'n'), f('sofa', 200, 1000, 200, 90, 's'),
    f('rack', 4, 300, 40, 300, 'w'), f('shelf', 1200, 4, 400, 44, 'n'), f('shelf', 2156, 300, 40, 240, 'e'),
    f('rack', 2100, 900, 90, 60, 'e'),
  ],
};

export const MAPS: Record<string, MapDef> = {
  [familyHouse.id]: familyHouse,
  [manor.id]: manor,
  [basement.id]: basement,
  [attic.id]: attic,
};
// Levels cycle through the maps in this order.
export const MAP_ORDER = [familyHouse.id, manor.id, basement.id, attic.id];
export const mapForLevel = (level: number) => MAPS[MAP_ORDER[(level - 1) % MAP_ORDER.length]];
