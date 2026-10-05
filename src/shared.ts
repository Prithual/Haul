export const W = 2200, H = 1400, TICK = 30;
export const ZONE = { x: 40, y: H - 260, w: 260, h: 220 };
export const DETECT = 300, SCREAM_RANGE = 550;
export const SHOP_TIME = 18;

export type WallKind =
  | 'wall' | 'sofa' | 'table' | 'chair' | 'bed' | 'shelf' | 'fridge' | 'counter' | 'tv'
  | 'plant' | 'crate' | 'pillar' | 'boiler' | 'trunk' | 'desk' | 'tub' | 'washer' | 'rack';
export type Face = 'n' | 's' | 'e' | 'w' | 'o'; // 'o' = no back side (e.g. a kitchen island)
// x/y/w/h is the collision footprint (h = depth on the map, not height).
// `kind` picks the 3D model; `face` says which side a sofa back / shelf back / headboard is on.
export interface Wall { x: number; y: number; w: number; h: number; kind?: WallKind; face?: Face }

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  sprinting: boolean;
  flashlight: boolean;
  holding: number | null;
  dead: boolean;
  reviveProg: number;
}

export type ItemKind = 'battery' | 'canister' | 'crate' | 'relic' | 'engine' | 'boat';

export interface ItemState {
  id: number;
  x: number;
  y: number;
  z: number;
  value: number;
  max: number;
  held: string | null;
  r: number;
  big: boolean;
  kind: ItemKind;
}

export type MonsterKind = 'hunter' | 'screamer' | 'stalker';

export interface MonsterState {
  kind: MonsterKind;
  x: number;
  y: number;
  active: boolean;
  state?: 'idle' | 'hunting' | 'stalking' | 'fleeing';
}

export interface PingState {
  id: number;
  x: number;
  y: number;
  kind: 'scrap' | 'danger' | 'info';
  creator: string;
  ttl: number;
}

export interface RoundStats {
  itemsHauled: number;
  totalBanked: number;
  revives: number;
}

export interface Upgrades {
  speed: number;
  hp: number;
  grab: number;
  throw: number;
  stamina: number;
  scanner: number;
}

export interface Snapshot {
  t: 'state';
  players: PlayerState[];
  items: ItemState[];
  monsters: MonsterState[];
  // Walls + map id only ride along when they change (new level / new joiner) to save bandwidth.
  walls?: Wall[];
  mapId?: string;
  pings: PingState[];
  banked: number;
  quota: number;
  level: number;
  credits: number;
  upgrades: Upgrades;
  shopTimeLeft: number;
  status: 'playing' | 'won' | 'lost' | 'shop';
  stats?: RoundStats;
}

export type UpgradeKey = keyof Upgrades;

export type ClientMsg =
  | { t: 'join'; name: string; room: string }
  | { t: 'input'; dx: number; dy: number; ax: number; ay: number; sprint?: boolean }
  | { t: 'grab' }
  | { t: 'throw' }
  | { t: 'buy'; item: UpgradeKey }
  | { t: 'flashlight'; on: boolean }
  | { t: 'ping'; x: number; y: number; kind: 'scrap' | 'danger' | 'info' };

