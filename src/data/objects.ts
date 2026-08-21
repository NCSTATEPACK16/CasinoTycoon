import type { IconName } from '../ui/icons.generated';
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
  /** IconName in the UI sprite. Matches the def id — see scripts/build-icons.mjs. */
  icon: IconName;
  cost: number;
  upkeepPerDay: number;
  footprint: Footprint;
  spriteKey: string;
  // On-screen size in px for real (non-placeholder) art, since source images
  // are captured at arbitrary export resolution, not pre-sized to the iso grid.
  displaySize?: { w: number; h: number };
  ratingBonus?: number; // small, capped casino-rating contribution (RATING_BALANCE.signageBonusCap)
  category: ObjectCategory;
  /** `category: 'service'` covers both objects that take money (food stall,
   *  bar, cage) and one that doesn't (toilet) — the category alone can't
   *  tell liquidation's last-revenue-object protection which is which.
   *  Unset/false for everything else; games don't need it, since
   *  `category === 'game'` already implies revenue. */
  isRevenueSource?: boolean;
}

export const OBJECT_CATALOG: readonly ObjectDef[] = [
  {
    id: 'slot-machine',
    name: 'Slot Machine',
    icon: 'slot-machine',
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
    icon: 'blackjack-table',
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
    icon: 'craps-table',
    cost: 900,
    upkeepPerDay: 35,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-craps-table',
    displaySize: { w: 220, h: 144 },
    category: 'game',
  },
  {
    id: 'roulette-table',
    name: 'Roulette Table',
    icon: 'roulette-table',
    cost: 1800,
    upkeepPerDay: 50,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-roulette-table',
    displaySize: { w: 220, h: 135 },
    category: 'game',
  },
  {
    id: 'big-six-wheel',
    name: 'Big Six Wheel',
    icon: 'big-six-wheel',
    cost: 350,
    upkeepPerDay: 12,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-big-six-wheel',
    displaySize: { w: 81, h: 140 },
    category: 'game',
  },
  {
    // Guests play each other for a house rake, so it needs at least two
    // seated players before a hand is dealt — a lone guest earns nothing.
    id: 'poker-table',
    name: 'Poker Table',
    icon: 'poker-table',
    cost: 1200,
    upkeepPerDay: 40,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-poker-table',
    displaySize: { w: 220, h: 149 },
    category: 'game',
  },
  {
    // Only guests carrying at least HIGH_LIMIT_BALANCE.minWallet will sit —
    // the gate is wallet, not archetype, so a lucky guest can graduate in.
    id: 'high-limit-table',
    name: 'High-Limit Table',
    icon: 'high-limit-table',
    cost: 2500,
    upkeepPerDay: 80,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-high-limit-table',
    displaySize: { w: 212, h: 160 },
    category: 'game',
  },
  {
    id: 'toilet',
    name: 'Restroom',
    icon: 'toilet',
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
    icon: 'food-stall',
    cost: 400,
    upkeepPerDay: 15,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-food-stall',
    displaySize: { w: 190, h: 158 },
    category: 'service',
    isRevenueSource: true,
  },
  {
    id: 'plant',
    name: 'Plant',
    icon: 'plant',
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
    icon: 'neon-sign',
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
    icon: 'marquee',
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
    icon: 'bar',
    cost: 700,
    upkeepPerDay: 15,
    footprint: { w: 2, h: 1 },
    spriteKey: 'obj-bar',
    category: 'service',
    isRevenueSource: true,
  },
  {
    id: 'cage',
    name: 'VIP Cage',
    icon: 'cage',
    cost: 900,
    upkeepPerDay: 20,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-cage',
    displaySize: { w: 220, h: 120 },
    category: 'service',
    isRevenueSource: true,
  },
];

const BY_ID = new Map(OBJECT_CATALOG.map((d) => [d.id, d]));

export function getObjectDef(id: string): ObjectDef | undefined {
  return BY_ID.get(id);
}
