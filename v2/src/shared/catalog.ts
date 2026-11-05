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
  /** Seats/standing spots, as offsets in metres from the unrotated footprint's min corner,
   *  facing = heading (0 = +z). Taken from the seat empties in the Blender heroes;
   *  stools at the front edge may sit just outside the footprint. */
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
    seats: [{ x: 0.5, z: 1.12, facing: Math.PI }],
  },
  'penny-slots': {
    asset: 'slot-cabinet-penny',
    height: 1.7,
    color: 0xe67e22,
    zones: ['gaming'],
    game: 'slots',
    glow: 0x66e0ff,
    seats: [{ x: 0.5, z: 1.12, facing: Math.PI }],
  },
  'video-poker': {
    asset: 'video-poker-bank',
    height: 1.4,
    color: 0x2980b9,
    zones: GAMING,
    glow: 0x66e0ff,
    seats: [
      { x: 0.5, z: 2.05, facing: Math.PI },
      { x: 0.5, z: -0.05, facing: 0 },
    ],
  },
  'blackjack-table': {
    asset: 'table-blackjack',
    height: 0.8,
    color: 0x1e8449,
    zones: GAMING,
    game: 'blackjack',
    seats: [
      { x: 0.124, z: 0.985, facing: 1.965 },
      { x: 0.491, z: 1.508, facing: 2.621 },
      { x: 1.0, z: 1.7, facing: Math.PI },
      { x: 1.509, z: 1.508, facing: -2.621 },
      { x: 1.876, z: 0.985, facing: -1.965 },
    ],
  },
  'high-limit-table': {
    asset: 'table-blackjack-hl',
    height: 0.8,
    color: 0x0b5345,
    zones: ['highLimit'],
    game: 'blackjack',
    seats: [
      { x: 0.124, z: 0.985, facing: 1.965 },
      { x: 1.0, z: 1.7, facing: Math.PI },
      { x: 1.876, z: 0.985, facing: -1.965 },
    ],
  },
  'craps-table': {
    asset: 'table-craps',
    height: 0.9,
    color: 0x196f3d,
    zones: GAMING,
    game: 'craps',
    seats: [
      { x: 0.3, z: 1.9, facing: Math.PI },
      { x: 0.77, z: 1.9, facing: Math.PI },
      { x: 1.24, z: 1.9, facing: Math.PI },
      { x: 1.71, z: 1.9, facing: Math.PI },
      { x: -0.1, z: 0.97, facing: Math.PI / 2 },
      { x: 2.1, z: 0.97, facing: -Math.PI / 2 },
    ],
  },
  'roulette-table': {
    asset: 'table-roulette',
    height: 0.85,
    color: 0x145a32,
    zones: GAMING,
    game: 'roulette',
    seats: [
      { x: 0.25, z: 1.88, facing: Math.PI },
      { x: 0.61, z: 1.88, facing: Math.PI },
      { x: 0.97, z: 1.88, facing: Math.PI },
      { x: 1.33, z: 1.88, facing: Math.PI },
    ],
  },
  'poker-table': {
    asset: 'table-uth',
    height: 0.8,
    color: 0x117a65,
    zones: GAMING,
    game: 'uth',
    seats: [
      { x: 0.124, z: 0.985, facing: 1.965 },
      { x: 0.651, z: 1.613, facing: 2.804 },
      { x: 1.349, z: 1.613, facing: -2.804 },
      { x: 1.876, z: 0.985, facing: -1.965 },
    ],
  },
  'three-card-poker': {
    asset: 'table-carnival',
    game: 'tcp',
    height: 0.8,
    color: 0x148f77,
    zones: GAMING,
    seats: [
      { x: 0.124, z: 0.985, facing: 1.965 },
      { x: 0.491, z: 1.508, facing: 2.621 },
      { x: 1.0, z: 1.7, facing: Math.PI },
      { x: 1.509, z: 1.508, facing: -2.621 },
      { x: 1.876, z: 0.985, facing: -1.965 },
    ],
  },
  'pai-gow': {
    asset: 'table-carnival',
    game: 'paigow',
    height: 0.8,
    color: 0x0e6655,
    zones: GAMING,
    seats: [
      { x: 0.124, z: 0.985, facing: 1.965 },
      { x: 0.491, z: 1.508, facing: 2.621 },
      { x: 1.0, z: 1.7, facing: Math.PI },
      { x: 1.509, z: 1.508, facing: -2.621 },
      { x: 1.876, z: 0.985, facing: -1.965 },
    ],
  },
  'sic-bo': {
    asset: 'table-carnival',
    game: 'sicbo',
    height: 0.85,
    color: 0x7d3c98,
    zones: GAMING,
    seats: [
      { x: 0.124, z: 0.985, facing: 1.965 },
      { x: 0.491, z: 1.508, facing: 2.621 },
      { x: 1.0, z: 1.7, facing: Math.PI },
      { x: 1.509, z: 1.508, facing: -2.621 },
      { x: 1.876, z: 0.985, facing: -1.965 },
    ],
  },
  'big-six-wheel': {
    asset: 'big-six',
    game: 'bigsix',
    height: 2.6,
    color: 0xf1c40f,
    zones: GAMING,
    glow: 0xffd34d,
    seats: [{ x: 0.5, z: 1.15, facing: Math.PI }],
  },
  pachinko: {
    asset: 'pachinko',
    game: 'pachinko',
    height: 1.9,
    color: 0xd35400,
    zones: ['gaming'],
    glow: 0xff66cc,
    seats: [{ x: 0.5, z: 1.08, facing: Math.PI }],
  },
  'keno-lounge': {
    asset: 'keno-lounge',
    game: 'keno',
    height: 1.2,
    color: 0x6c3483,
    zones: ['gaming'],
    seats: [
      { x: 0.35, z: 0.95, facing: Math.PI },
      { x: 1.0, z: 0.95, facing: Math.PI },
      { x: 1.65, z: 0.95, facing: Math.PI },
      { x: 0.35, z: 1.6, facing: Math.PI },
      { x: 1.0, z: 1.6, facing: Math.PI },
      { x: 1.65, z: 1.6, facing: Math.PI },
    ],
  },
  'bingo-hall': {
    asset: 'bingo-hall',
    game: 'bingo',
    height: 1.0,
    color: 0x884ea0,
    zones: ['gaming'],
    seats: [
      { x: 0.5, z: 1.7, facing: Math.PI },
      { x: 1.25, z: 1.7, facing: Math.PI },
      { x: 2.0, z: 1.7, facing: Math.PI },
      { x: 2.75, z: 1.7, facing: Math.PI },
      { x: 3.5, z: 1.7, facing: Math.PI },
      { x: 0.5, z: 2.55, facing: Math.PI },
      { x: 1.25, z: 2.55, facing: Math.PI },
      { x: 2.0, z: 2.55, facing: Math.PI },
      { x: 2.75, z: 2.55, facing: Math.PI },
      { x: 3.5, z: 2.55, facing: Math.PI },
    ],
  },
  toilet: {
    asset: 'restroom-block',
    height: 2.4,
    color: 0xd5d8dc,
    zones: ['restrooms'],
    seats: [{ x: 0.5, z: 0.4, facing: Math.PI }],
  },
  'food-stall': {
    asset: 'food-counter',
    height: 2.2,
    color: 0xe59866,
    zones: ['foodCourt'],
    seats: [{ x: 0.5, z: 1.15, facing: Math.PI }],
  },
  bar: {
    asset: 'bar-counter',
    height: 1.2,
    color: 0x6e2c00,
    zones: ['foodCourt', 'gaming', 'highLimit'],
    glow: 0x9b59ff,
    seats: [
      { x: 0.5, z: 1.25, facing: Math.PI },
      { x: 1.5, z: 1.25, facing: Math.PI },
    ],
  },
  cage: {
    asset: 'cashier-cage',
    height: 2.4,
    color: 0xb7950b,
    zones: ['gaming', 'backOfHouse'],
    seats: [
      { x: 0.33, z: 2.0, facing: Math.PI },
      { x: 1.0, z: 2.0, facing: Math.PI },
      { x: 1.67, z: 2.0, facing: Math.PI },
    ],
  },
  plant: { asset: 'proc:plant', height: 1.4, color: 0x27ae60, zones: [] },
  'neon-sign': { asset: 'proc:neon', height: 2.2, color: 0xff2e88, zones: [], glow: 0xff2e88 },
  marquee: { asset: 'proc:marquee', height: 3.0, color: 0xf4d03f, zones: [], glow: 0xffe08a },
};

export function get3D(defId: string): Object3DDef {
  return OBJECT_3D[defId] ?? { asset: 'proc:box', height: 1, color: 0x888888, zones: [] };
}
