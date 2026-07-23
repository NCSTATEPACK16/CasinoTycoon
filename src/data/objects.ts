// Data-driven catalog of placeable objects. Balancing lives here, never in logic.
// spriteKey must exist in the placeholder generator (or, later, the atlas manifest).

export interface Footprint {
  w: number;
  h: number;
}

export type ObjectCategory = 'game' | 'service' | 'decor';

export interface ObjectDef {
  id: string;
  name: string;
  icon: string; // toolbar/panel glyph
  cost: number;
  upkeepPerDay: number;
  footprint: Footprint;
  spriteKey: string;
  // On-screen size in px for real (non-placeholder) art, since source images
  // are captured at arbitrary export resolution, not pre-sized to the iso grid.
  displaySize?: { w: number; h: number };
  ratingBonus?: number; // small, capped casino-rating contribution (RATING_BALANCE.signageBonusCap)
  category: ObjectCategory;
}

export const OBJECT_CATALOG: readonly ObjectDef[] = [
  {
    id: 'slot-machine',
    name: 'Slot Machine',
    icon: '🎰',
    cost: 500,
    upkeepPerDay: 20,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-slot-machine',
    displaySize: { w: 77, h: 130 },
    category: 'game',
  },
  {
    id: 'blackjack-table',
    name: 'Blackjack Table',
    icon: '🃏',
    cost: 1200,
    upkeepPerDay: 50,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-blackjack-table',
    displaySize: { w: 220, h: 161 },
    category: 'game',
  },
  {
    id: 'craps-table',
    name: 'Craps Table',
    icon: '🎲',
    cost: 900,
    upkeepPerDay: 35,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-craps-table',
    displaySize: { w: 220, h: 144 },
    category: 'game',
  },
  {
    id: 'toilet',
    name: 'Restroom',
    icon: '🚻',
    cost: 300,
    upkeepPerDay: 10,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-restroom',
    displaySize: { w: 170, h: 189 },
    category: 'service',
  },
  {
    id: 'food-stall',
    name: 'Food Stall',
    icon: '🌭',
    cost: 400,
    upkeepPerDay: 15,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-food-stall',
    displaySize: { w: 190, h: 158 },
    category: 'service',
  },
  {
    id: 'plant',
    name: 'Plant',
    icon: '🪴',
    cost: 40,
    upkeepPerDay: 0,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-plant',
    displaySize: { w: 120, h: 144 },
    category: 'decor',
  },
  {
    id: 'neon-sign',
    name: 'Neon Sign',
    icon: '🪧',
    cost: 250,
    upkeepPerDay: 5,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-neon-sign',
    displaySize: { w: 67, h: 110 },
    ratingBonus: 2,
    category: 'decor',
  },
  {
    id: 'marquee',
    name: 'Marquee',
    icon: '✨',
    cost: 600,
    upkeepPerDay: 12,
    footprint: { w: 2, h: 1 },
    spriteKey: 'img-marquee',
    displaySize: { w: 200, h: 141 },
    ratingBonus: 4,
    category: 'decor',
  },
  {
    id: 'bar',
    name: 'Bar',
    icon: '🍸',
    cost: 700,
    upkeepPerDay: 15,
    footprint: { w: 2, h: 1 },
    spriteKey: 'obj-bar',
    category: 'service',
  },
  {
    id: 'cage',
    name: 'VIP Cage',
    icon: '💰',
    cost: 900,
    upkeepPerDay: 20,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-cage',
    displaySize: { w: 220, h: 120 },
    category: 'service',
  },
];

const BY_ID = new Map(OBJECT_CATALOG.map((d) => [d.id, d]));

export function getObjectDef(id: string): ObjectDef | undefined {
  return BY_ID.get(id);
}
