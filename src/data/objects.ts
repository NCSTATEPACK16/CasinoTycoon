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
    spriteKey: 'obj-slot-machine',
    category: 'game',
  },
  {
    id: 'blackjack-table',
    name: 'Blackjack Table',
    icon: '🃏',
    cost: 1200,
    upkeepPerDay: 50,
    footprint: { w: 2, h: 2 },
    spriteKey: 'obj-blackjack-table',
    category: 'game',
  },
  {
    id: 'toilet',
    name: 'Restroom',
    icon: '🚻',
    cost: 300,
    upkeepPerDay: 10,
    footprint: { w: 1, h: 1 },
    spriteKey: 'obj-toilet',
    category: 'service',
  },
  {
    id: 'food-stall',
    name: 'Food Stall',
    icon: '🌭',
    cost: 400,
    upkeepPerDay: 15,
    footprint: { w: 1, h: 1 },
    spriteKey: 'obj-food-stall',
    category: 'service',
  },
  {
    id: 'plant',
    name: 'Plant',
    icon: '🪴',
    cost: 40,
    upkeepPerDay: 0,
    footprint: { w: 1, h: 1 },
    spriteKey: 'obj-plant',
    category: 'decor',
  },
];

const BY_ID = new Map(OBJECT_CATALOG.map((d) => [d.id, d]));

export function getObjectDef(id: string): ObjectDef | undefined {
  return BY_ID.get(id);
}
