import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { FLOOR_PRICE_PER_CELL, WALL_PRICE_PER_SEGMENT } from '../../data/floorPrices';
import {
  buildWallLine,
  canPlaceObject,
  footprintOf,
  paintFloorRect,
  paintZoneRect,
  placeObject,
  toggleDoor,
} from '../build';
import { GameState } from '../GameState';
import { findPath } from '../grid/astar';
import { IsoGrid } from '../grid/IsoGrid';
import { FloorPlan } from './FloorPlan';
import { starterFloorPlan } from './starter';

afterEach(() => eventBus.clear());

function lot(cols = 12, rows = 10) {
  const plan = new FloorPlan(cols, rows, { col: cols - 1, row: 1 });
  const grid = new IsoGrid(cols, rows);
  grid.floor = plan;
  const state = new GameState();
  state.cash = 100_000;
  return { plan, grid, state };
}

describe('FloorPlan', () => {
  it('paints floor and zones, reporting only the cells that changed', () => {
    const { plan } = lot();
    const r = { col0: 4, row0: 3, col1: 1, row1: 1 }; // corners in either order
    expect(plan.paintFloor(r, 'marble')).toHaveLength(12);
    expect(plan.paintFloor(r, 'marble')).toHaveLength(0);
    expect(plan.floorAt(2, 2)).toBe('marble');
    expect(plan.paintZone({ col0: 0, row0: 0, col1: 2, row1: 2 }, 'gaming')).toHaveLength(4);
    expect(plan.zoneAt(1, 1)).toBe('gaming');
    expect(plan.zoneAt(0, 0)).toBe('none'); // no floor there, so no zone
    // Removing floor clears the zone with it.
    plan.paintFloor({ col0: 1, row0: 1, col1: 1, row1: 1 }, 'none');
    expect(plan.zoneAt(1, 1)).toBe('none');
  });

  it('owns every edge once, including the far lot boundary', () => {
    const plan = new FloorPlan(4, 3, { col: 0, row: 0 });
    expect(plan.edgeInBounds(3, 3, 'n')).toBe(true); // south boundary
    expect(plan.edgeInBounds(4, 2, 'w')).toBe(true); // east boundary
    expect(plan.edgeInBounds(4, 3, 'n')).toBe(false);
    expect(plan.setWall(2, 1, 'w', true)).toBe(true);
    expect(plan.setWall(2, 1, 'w', true)).toBe(false);
    expect(plan.blocksStep(1, 1, 2, 1)).toBe(true);
    expect(plan.blocksStep(2, 1, 1, 1)).toBe(true);
    expect(plan.blocksStep(1, 1, 1, 2)).toBe(false);
    plan.setWall(2, 1, 'w', true, true);
    expect(plan.blocksStep(1, 1, 2, 1)).toBe(false); // a door is passable
  });

  it('turns a drag into edge segments, an L for a diagonal', () => {
    expect(FloorPlan.wallLine({ col: 1, row: 2 }, { col: 4, row: 2 })).toEqual([
      { col: 1, row: 2, edge: 'n' },
      { col: 2, row: 2, edge: 'n' },
      { col: 3, row: 2, edge: 'n' },
    ]);
    const l = FloorPlan.wallLine({ col: 0, row: 0 }, { col: 2, row: 2 });
    expect(l.filter((e) => e.edge === 'n')).toHaveLength(2);
    expect(l.filter((e) => e.edge === 'w').every((e) => e.col === 2)).toBe(true);
  });

  it('round-trips through JSON', () => {
    const plan = starterFloorPlan(null, 40, 30);
    const copy = FloorPlan.fromJSON(JSON.parse(JSON.stringify(plan.toJSON())));
    expect(copy.toJSON()).toEqual(plan.toJSON());
    expect(copy.toView().walls.length).toBe(plan.allWalls().length);
    expect(copy.strictZones).toBe(true);
  });

  it('starts the sandbox with a walkable lobby, gaming floor and restroom corner', () => {
    const plan = starterFloorPlan(null, 40, 30);
    const grid = new IsoGrid(40, 30);
    grid.floor = plan;
    expect(plan.isFloored(plan.entrance.col, plan.entrance.row)).toBe(true);
    expect(plan.zoneAt(20, 15)).toBe('gaming');
    expect(plan.zoneAt(6, 6)).toBe('restrooms');
    // Every room is reachable from the entrance through its doors.
    for (const target of [
      { col: 20, row: 15 },
      { col: 6, row: 6 },
      { col: 6, row: 23 },
    ]) {
      expect(findPath(grid, plan.entrance, target)).not.toBeNull();
    }
  });
});

describe('floor construction and placement', () => {
  it('charges per changed floor cell and never un-floors under an object', () => {
    const { plan, grid, state } = lot();
    const before = state.cash;
    const r = paintFloorRect(state, grid, plan, { col0: 0, row0: 0, col1: 3, row1: 3 }, 'wood');
    expect(r).toEqual({ ok: true, cost: 16 * FLOOR_PRICE_PER_CELL.wood, changed: 16 });
    expect(state.cash).toBe(before - 16 * FLOOR_PRICE_PER_CELL.wood);
    grid.occupy('obj-x', 1, 1);
    paintFloorRect(state, grid, plan, { col0: 0, row0: 0, col1: 3, row1: 3 }, 'none');
    expect(plan.isFloored(1, 1)).toBe(true);
    expect(plan.isFloored(0, 0)).toBe(false);
  });

  it('is all-or-nothing on funds', () => {
    const { plan, grid, state } = lot();
    state.cash = 10;
    const r = paintFloorRect(state, grid, plan, { col0: 0, row0: 0, col1: 5, row1: 5 }, 'marble');
    expect(r.ok).toBe(false);
    expect(plan.isFloored(0, 0)).toBe(false);
    expect(state.cash).toBe(10);
  });

  it('charges walls per new segment and toggles doors', () => {
    const { plan, grid, state } = lot();
    const before = state.cash;
    const r = buildWallLine(state, grid, plan, { col: 0, row: 4 }, { col: 5, row: 4 }, false);
    expect(r).toMatchObject({ ok: true, changed: 5, cost: 5 * WALL_PRICE_PER_SEGMENT });
    expect(state.cash).toBe(before - 5 * WALL_PRICE_PER_SEGMENT);
    expect(toggleDoor(state, grid, plan, 2, 4, 'n').ok).toBe(true);
    expect(plan.wallAt(2, 4, 'n')?.door).toBe(true);
    expect(toggleDoor(state, grid, plan, 2, 4, 'n').ok).toBe(true);
    expect(plan.wallAt(2, 4, 'n')?.door).toBe(false);
    buildWallLine(state, grid, plan, { col: 0, row: 4 }, { col: 5, row: 4 }, true);
    expect(plan.allWalls()).toHaveLength(0);
  });

  it('requires floor under the whole footprint', () => {
    const { plan, grid, state } = lot();
    plan.paintFloor({ col0: 0, row0: 0, col1: 4, row1: 4 }, 'carpet-red');
    plan.paintZone({ col0: 0, row0: 0, col1: 4, row1: 4 }, 'gaming');
    expect(canPlaceObject(state, grid, 'blackjack-table', 3, 3)).toEqual({ ok: true });
    expect(canPlaceObject(state, grid, 'blackjack-table', 4, 4)).toEqual({
      ok: false,
      reason: 'no-floor',
    });
  });

  it('checks every cell against the catalog zones (empty = anywhere)', () => {
    const { plan, grid, state } = lot();
    plan.paintFloor({ col0: 0, row0: 0, col1: 9, row1: 9 }, 'carpet-red');
    plan.paintZone({ col0: 0, row0: 0, col1: 4, row1: 9 }, 'gaming');
    plan.paintZone({ col0: 5, row0: 0, col1: 9, row1: 9 }, 'restrooms');
    expect(canPlaceObject(state, grid, 'toilet', 6, 6).ok).toBe(true);
    expect(canPlaceObject(state, grid, 'toilet', 2, 2)).toEqual({
      ok: false,
      reason: 'wrong-zone',
    });
    // A 2-wide table straddling the zone line has one cell in the wrong zone.
    expect(canPlaceObject(state, grid, 'blackjack-table', 4, 2)).toEqual({
      ok: false,
      reason: 'wrong-zone',
    });
    expect(canPlaceObject(state, grid, 'plant', 7, 7).ok).toBe(true);
    // An open (v1) lot does not enforce zones at all.
    plan.strictZones = false;
    expect(canPlaceObject(state, grid, 'toilet', 2, 2).ok).toBe(true);
  });

  it('rejects a wall through the footprint interior', () => {
    const { plan, grid, state } = lot();
    plan.paintFloor({ col0: 0, row0: 0, col1: 9, row1: 9 }, 'carpet-red');
    plan.paintZone({ col0: 0, row0: 0, col1: 9, row1: 9 }, 'gaming');
    plan.setWall(5, 3, 'w', true);
    expect(canPlaceObject(state, grid, 'blackjack-table', 4, 3)).toEqual({
      ok: false,
      reason: 'wall',
    });
    // Walls on the footprint's outer edge are fine — tables go against walls.
    expect(canPlaceObject(state, grid, 'blackjack-table', 5, 3).ok).toBe(true);
  });

  it('swaps w and h for quarter turns', () => {
    const { plan, grid, state } = lot();
    expect(footprintOf('video-poker', 0)).toEqual({ w: 1, h: 2 });
    expect(footprintOf('video-poker', 1)).toEqual({ w: 2, h: 1 });
    expect(footprintOf('video-poker', 2)).toEqual({ w: 1, h: 2 });
    plan.paintFloor({ col0: 0, row0: 0, col1: 9, row1: 0 }, 'carpet-red');
    plan.paintZone({ col0: 0, row0: 0, col1: 9, row1: 0 }, 'gaming');
    // A one-row strip: the bank only fits turned on its side.
    expect(canPlaceObject(state, grid, 'video-poker', 2, 0, 0, 0).ok).toBe(false);
    expect(canPlaceObject(state, grid, 'video-poker', 2, 0, 0, 1).ok).toBe(true);
    const po = placeObject(state, grid, 'video-poker', 2, 0, 0, 1)!;
    expect(po.rot).toBe(1);
    expect(grid.occupantAt(3, 0)).toBe(po.id);
  });

  it('keeps an object’s cells in an allowed zone when re-zoning around it', () => {
    const { plan, grid, state } = lot();
    plan.paintFloor({ col0: 0, row0: 0, col1: 9, row1: 9 }, 'carpet-red');
    plan.paintZone({ col0: 0, row0: 0, col1: 9, row1: 9 }, 'gaming');
    placeObject(state, grid, 'blackjack-table', 2, 2);
    paintZoneRect(state, grid, plan, { col0: 0, row0: 0, col1: 9, row1: 9 }, 'restrooms');
    expect(plan.zoneAt(2, 2)).toBe('gaming');
    expect(plan.zoneAt(0, 0)).toBe('restrooms');
  });
});
