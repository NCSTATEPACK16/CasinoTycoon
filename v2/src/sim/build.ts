import { eventBus } from '../EventBus';
import { SELL_REFUND_RATIO } from '../config';
import {
  DOOR_PRICE_PER_SEGMENT,
  FLOOR_PRICE_PER_CELL,
  WALL_PRICE_PER_SEGMENT,
  ZONE_PRICE_PER_CELL,
} from '../data/floorPrices';
import { getObjectDef, type Footprint } from '../data/objects';
import { get3D } from '../shared/catalog';
import type { CellRect, FloorType, Rotation, Zone } from '../shared/contracts';
import { FloorPlan, type Edge } from './floor/FloorPlan';
import type { GameState, PlacedObject } from './GameState';
import type { IsoGrid } from './grid/IsoGrid';

// Placement/sale orchestration: validity, funds, occupancy, and domain events.
// v2 adds the floor plan: objects need floor under every cell, a zone their
// catalog entry allows, and no wall through their middle; and the floor,
// zones and walls themselves are bought here.

export type PlaceFailure =
  | 'unknown-object'
  | 'not-allowed'
  | 'insufficient-funds'
  | 'blocked'
  | 'no-floor'
  | 'wrong-zone'
  | 'wall';

/** A def's footprint after rotation. Quarter turns 1 and 3 swap w and h; the
 *  anchor (col,row) stays the min corner either way. */
export function footprintOf(defId: string, rot: Rotation = 0): Footprint {
  const fp = getObjectDef(defId)?.footprint ?? { w: 1, h: 1 };
  return rot % 2 === 1 ? { w: fp.h, h: fp.w } : { ...fp };
}

/** Floor, zone and wall rules for a footprint, independent of money and occupancy. */
function floorCheck(
  grid: IsoGrid,
  defId: string,
  col: number,
  row: number,
  fp: Footprint,
): PlaceFailure | null {
  const plan = grid.floor;
  if (!plan) return null;
  const zones = get3D(defId).zones;
  for (let r = row; r < row + fp.h; r++) {
    for (let c = col; c < col + fp.w; c++) {
      if (!plan.isFloored(c, r)) return 'no-floor';
      if (plan.strictZones && zones.length > 0 && !zones.includes(plan.zoneAt(c, r))) {
        return 'wrong-zone';
      }
    }
  }
  if (plan.wallCrossesInterior(col, row, fp.w, fp.h)) return 'wall';
  return null;
}

export type PlaceCheck = { ok: true } | { ok: false; reason: PlaceFailure };

/**
 * @param creditLimit How far below zero this purchase may take the balance.
 *   Zero — the default — is the cash-only rule: you buy what you can cover.
 *
 * P16: the campaign layer is built around a debt spiral, and until this
 * parameter existed there was no way to enter one. Purchases were blocked at
 * `cash >= cost`, so the credit line was unreachable by the only action that
 * can plausibly bankrupt a player — over-expansion — and debt could accrue
 * solely through wage and upkeep drift, which is slow, small, and never
 * approached the limit. The line is measured from the *resulting* balance, so
 * a house already in the red has correspondingly less of it left to spend.
 */
export function canPlaceObject(
  state: GameState,
  grid: IsoGrid,
  defId: string,
  col: number,
  row: number,
  creditLimit = 0,
  rot: Rotation = 0,
): PlaceCheck {
  const def = getObjectDef(defId);
  if (!def) return { ok: false, reason: 'unknown-object' };
  if (state.cash - def.cost < -creditLimit) {
    return { ok: false, reason: 'insufficient-funds' };
  }
  const fp = footprintOf(defId, rot);
  if (!grid.canPlace(col, row, fp.w, fp.h)) {
    return { ok: false, reason: 'blocked' };
  }
  const floor = floorCheck(grid, defId, col, row, fp);
  if (floor) return { ok: false, reason: floor };
  return { ok: true };
}

export function placeObject(
  state: GameState,
  grid: IsoGrid,
  defId: string,
  col: number,
  row: number,
  creditLimit = 0,
  rot: Rotation = 0,
): PlacedObject | null {
  if (!canPlaceObject(state, grid, defId, col, row, creditLimit, rot).ok) return null;
  const def = getObjectDef(defId)!;
  const fp = footprintOf(defId, rot);

  // rot is only written when non-zero so v1-shaped saves and test fixtures
  // (which compare whole PlacedObjects) keep their exact shape.
  const po: PlacedObject = { id: state.newObjectId(), defId, col, row, ...(rot ? { rot } : {}) };
  grid.occupy(po.id, col, row, fp.w, fp.h);
  state.addObject(po);
  state.cash -= def.cost;

  eventBus.emit('moneyChanged', { cash: state.cash, delta: -def.cost });
  eventBus.emit('objectPlaced', { id: po.id, defId, col, row });
  return po;
}

export function sellObject(state: GameState, grid: IsoGrid, objectId: string): number | null {
  const po = state.getObject(objectId);
  if (!po) return null;
  const def = getObjectDef(po.defId)!;

  const refund = Math.round(def.cost * SELL_REFUND_RATIO);
  grid.free(po.id);
  state.removeObject(po.id);
  state.cash += refund;

  eventBus.emit('moneyChanged', { cash: state.cash, delta: refund });
  eventBus.emit('objectSold', { id: po.id, defId: po.defId, col: po.col, row: po.row, refund });
  return refund;
}

// ---------- floor construction ----------

export type FloorBuildResult =
  { ok: true; cost: number; changed: number } | { ok: false; error: string };

function charge(state: GameState, cost: number, creditLimit: number): boolean {
  if (cost === 0) return true;
  if (state.cash - cost < -creditLimit) return false;
  state.cash -= cost;
  eventBus.emit('moneyChanged', { cash: state.cash, delta: -cost });
  return true;
}

/**
 * Paint floor over a rect, charging per changed cell. Cells under an object
 * and the entrance cell are never un-floored — an object must always stand on
 * floor, and the casino must always have a way in.
 *
 * All-or-nothing on funds: the plan is trial-painted on a copy first, so a
 * drag the player cannot afford changes nothing rather than half the rect.
 */
export function paintFloorRect(
  state: GameState,
  grid: IsoGrid,
  plan: FloorPlan,
  rect: CellRect,
  type: FloorType,
  creditLimit = 0,
): FloorBuildResult {
  const skip = (col: number, row: number) =>
    type === 'none' &&
    (grid.occupantAt(col, row) !== null ||
      (col === plan.entrance.col && row === plan.entrance.row));
  const trial = FloorPlan.fromJSON(plan.toJSON());
  const changed = trial.paintFloor(rect, type, skip);
  const cost = changed.length * FLOOR_PRICE_PER_CELL[type];
  if (!charge(state, cost, creditLimit)) return { ok: false, error: 'insufficient-funds' };
  plan.paintFloor(rect, type, skip);
  return { ok: true, cost, changed: changed.length };
}

/** Re-zone a rect. Cells under an object keep their zone if the object would
 *  no longer be allowed there — zoning never silently invalidates a build. */
export function paintZoneRect(
  state: GameState,
  grid: IsoGrid,
  plan: FloorPlan,
  rect: CellRect,
  zone: Zone,
  creditLimit = 0,
): FloorBuildResult {
  const skip = (col: number, row: number) => {
    const id = grid.occupantAt(col, row);
    if (id === null || !plan.strictZones) return false;
    const defId = state.getObject(id)?.defId;
    const zones = defId ? get3D(defId).zones : [];
    return zones.length > 0 && !zones.includes(zone);
  };
  const trial = FloorPlan.fromJSON(plan.toJSON());
  const changed = trial.paintZone(rect, zone, skip);
  const cost = changed.length * ZONE_PRICE_PER_CELL;
  if (!charge(state, cost, creditLimit)) return { ok: false, error: 'insufficient-funds' };
  plan.paintZone(rect, zone, skip);
  return { ok: true, cost, changed: changed.length };
}

/** Edges an object's footprint covers on the inside — walls may not run there. */
function edgeUnderObject(grid: IsoGrid, col: number, row: number, edge: Edge): boolean {
  // An edge is interior to a footprint when both cells it separates hold the
  // same object.
  const a = grid.occupantAt(col, row);
  const b = edge === 'n' ? grid.occupantAt(col, row - 1) : grid.occupantAt(col - 1, row);
  return a !== null && a === b;
}

/** Build or demolish a wall drag (corner to corner). Free to demolish. */
export function buildWallLine(
  state: GameState,
  grid: IsoGrid,
  plan: FloorPlan,
  from: { col: number; row: number },
  to: { col: number; row: number },
  remove: boolean,
  creditLimit = 0,
): FloorBuildResult {
  const edges = FloorPlan.wallLine(from, to).filter((e) => plan.edgeInBounds(e.col, e.row, e.edge));
  if (remove) {
    let changed = 0;
    for (const e of edges) if (plan.setWall(e.col, e.row, e.edge, false)) changed++;
    return { ok: true, cost: 0, changed };
  }
  const fresh = edges.filter(
    (e) => !plan.wallAt(e.col, e.row, e.edge) && !edgeUnderObject(grid, e.col, e.row, e.edge),
  );
  const cost = fresh.length * WALL_PRICE_PER_SEGMENT;
  if (!charge(state, cost, creditLimit)) return { ok: false, error: 'insufficient-funds' };
  for (const e of fresh) plan.setWall(e.col, e.row, e.edge, true);
  return { ok: true, cost, changed: fresh.length };
}

/** Toggle a door on one edge: a wall becomes a door, a door becomes a wall
 *  again, and a bare edge gets a free-standing door frame. */
export function toggleDoor(
  state: GameState,
  grid: IsoGrid,
  plan: FloorPlan,
  col: number,
  row: number,
  edge: Edge,
  creditLimit = 0,
): FloorBuildResult {
  if (!plan.edgeInBounds(col, row, edge)) return { ok: false, error: 'out-of-bounds' };
  if (edgeUnderObject(grid, col, row, edge)) return { ok: false, error: 'blocked' };
  const existing = plan.wallAt(col, row, edge);
  if (existing?.door) {
    plan.setWall(col, row, edge, true, false);
    return { ok: true, cost: 0, changed: 1 };
  }
  const cost = existing ? DOOR_PRICE_PER_SEGMENT - WALL_PRICE_PER_SEGMENT : DOOR_PRICE_PER_SEGMENT;
  if (!charge(state, cost, creditLimit)) return { ok: false, error: 'insufficient-funds' };
  plan.setWall(col, row, edge, true, true);
  return { ok: true, cost, changed: 1 };
}
