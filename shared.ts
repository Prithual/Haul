export const W = 2200, H = 1400, TICK = 30;
export const ZONE = { x: 40, y: H - 260, w: 260, h: 220 };
export const DETECT = 300, SCREAM_RANGE = 550;
export const SHOP_TIME = 18;

export interface Wall { x: number; y: number; w: number; h: number }
export interface PlayerState { id: string; name: string; x: number; y: number; hp: number; maxHp: number; holding: number | null; dead: boolean; reviveProg: number }
export interface ItemState { id: number; x: number; y: number; z: number; value: number; max: number; held: string | null; r: number; big: boolean }
export interface MonsterState { kind: 'hunter' | 'screamer'; x: number; y: number; active: boolean }
export interface Upgrades { speed: number; hp: number; grab: number; throw: number }

export interface Snapshot {
  t: 'state';
  players: PlayerState[];
  items: ItemState[];
  monsters: MonsterState[];
  walls: Wall[];
  banked: number; quota: number; level: number; credits: number; upgrades: Upgrades;
  shopTimeLeft: number;
  status: 'playing' | 'won' | 'lost' | 'shop';
}
export type UpgradeKey = keyof Upgrades;
export type ClientMsg =
  | { t: 'join'; name: string; room: string }
  | { t: 'input'; dx: number; dy: number; ax: number; ay: number }
  | { t: 'grab' }
  | { t: 'throw' }
  | { t: 'buy'; item: UpgradeKey }
  | { t: 'chat'; text: string }
  | { t: 'rtc'; to: string; data: unknown }; // WebRTC signaling for proximity voice, relayed peer-to-peer by the server
