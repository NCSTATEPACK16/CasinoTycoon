// Construction prices for the floor plan. Per cell for floor and zone paint,
// per edge segment for walls and doors. Kept apart from objects.ts because
// none of these are placeable objects: they have no upkeep, no footprint and
// no sell-back — the floor is the lot, not an asset on it.

import type { FloorType } from '../shared/contracts';

export const FLOOR_PRICE_PER_CELL: Record<FloorType, number> = {
  none: 0,
  'carpet-red': 12,
  'carpet-blue': 12,
  wood: 18,
  tile: 15,
  marble: 30,
};

/** Re-zoning is paperwork, not construction — cheap, but not free, so a
 *  player sweeping the whole lot back and forth still notices it. */
export const ZONE_PRICE_PER_CELL = 1;

export const WALL_PRICE_PER_SEGMENT = 25;

/** A door is a wall segment with a frame in it; converting an existing wall
 *  charges the difference, so a door always costs this much in total. */
export const DOOR_PRICE_PER_SEGMENT = 60;
