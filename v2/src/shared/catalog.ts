// 3D-side metadata for every placeable def. Economy (cost, upkeep, footprint)
// stays in data/objects.ts; this is what the renderer, build tools and zoning
// need on top of it. Every OBJECT_CATALOG id must have an entry (catalog.test.ts).

import type { GameKind } from './games';
import type { Zone } from './contracts';

export interface Object3DDef {
  /** GLB asset key under assets/models/, or a procedural generator id 'proc:<name>'. */
  asset: string;
  /** Placeholder box height in metres until the asset lands. */
  height: number;
  /** Placeholder colour (sRGB hex). */
  color: number;
  /** Zones this object may be built in. Empty = anywhere with a floor. */
  zones: Zone[];
  /** Set when the object runs one of the rigorous game engines. */
  game?: GameKind;
  /** Seats/standing spots, as cell-local offsets in metres from the footprint's min corner. */
  seats?: { x: number; z: number; facing: number }[];
  /** Emissive accent for bloom (neon, slot toppers). */
  glow?: number;
}

const GAMING: Zone[] = ['gaming', 'highLimit'];

export const OBJECT_3D: Record<string, Object3DDef> = {
  'slot-machine': {
    asset: 'slot-cabinet',
    height: 1.9,
    color: 0xc0392b,
    zones: GAMING,
    game: 'slots',
    glow: 0xffc04d,
    seats: [{ x: 0.5, z: 1.1, facing: Math.PI }],
  },
  'penny-slots': {
    asset: 'slot-cabinet-penny',
    height: 1.7,
    color: 0xe67e22,
    zones: ['gaming'],
    game: 'slots',
    glow: 0x66e0ff,
    seats: [{ x: 0.5, z: 1.1, facing: Math.PI }],
  },
  'video-poker': {
    asset: 'video-poker-bank',
    height: 1.4,
    color: 0x2980b9,
    zones: GAMING,
    glow: 0x66e0ff,
  },
  'blackjack-table': {
    asset: 'table-blackjack',
    height: 0.8,
    color: 0x1e8449,
    zones: GAMING,
    game: 'blackjack',
  },
  'high-limit-table': {
    asset: 'table-blackjack-hl',
    height: 0.8,
    color: 0x0b5345,
    zones: ['highLimit'],
    game: 'blackjack',
  },
  'craps-table': {
    asset: 'table-craps',
    height: 0.9,
    color: 0x196f3d,
    zones: GAMING,
    game: 'craps',
  },
  'roulette-table': {
    asset: 'table-roulette',
    height: 0.85,
    color: 0x145a32,
    zones: GAMING,
    game: 'roulette',
  },
  'poker-table': { asset: 'table-uth', height: 0.8, color: 0x117a65, zones: GAMING, game: 'uth' },
  'three-card-poker': { asset: 'table-carnival', height: 0.8, color: 0x148f77, zones: GAMING },
  'pai-gow': { asset: 'table-carnival', height: 0.8, color: 0x0e6655, zones: GAMING },
  'sic-bo': { asset: 'table-carnival', height: 0.85, color: 0x7d3c98, zones: GAMING },
  'big-six-wheel': {
    asset: 'big-six',
    height: 2.6,
    color: 0xf1c40f,
    zones: GAMING,
    glow: 0xffd34d,
  },
  pachinko: { asset: 'pachinko', height: 1.9, color: 0xd35400, zones: ['gaming'], glow: 0xff66cc },
  'keno-lounge': { asset: 'keno-lounge', height: 1.2, color: 0x6c3483, zones: ['gaming'] },
  'bingo-hall': { asset: 'bingo-hall', height: 1.0, color: 0x884ea0, zones: ['gaming'] },
  toilet: { asset: 'restroom-block', height: 2.4, color: 0xd5d8dc, zones: ['restrooms'] },
  'food-stall': { asset: 'food-counter', height: 2.2, color: 0xe59866, zones: ['foodCourt'] },
  bar: {
    asset: 'bar-counter',
    height: 1.2,
    color: 0x6e2c00,
    zones: ['foodCourt', 'gaming', 'highLimit'],
    glow: 0x9b59ff,
  },
  cage: { asset: 'cashier-cage', height: 2.4, color: 0xb7950b, zones: ['gaming', 'backOfHouse'] },
  plant: { asset: 'proc:plant', height: 1.4, color: 0x27ae60, zones: [] },
  'neon-sign': { asset: 'proc:neon', height: 2.2, color: 0xff2e88, zones: [], glow: 0xff2e88 },
  marquee: { asset: 'proc:marquee', height: 3.0, color: 0xf4d03f, zones: [], glow: 0xffe08a },
};

export function get3D(defId: string): Object3DDef {
  return OBJECT_3D[defId] ?? { asset: 'proc:box', height: 1, color: 0x888888, zones: [] };
}
