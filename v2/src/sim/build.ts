import { eventBus } from '../EventBus';
import { SELL_REFUND_RATIO } from '../config';
import { getObjectDef } from '../data/objects';
import type { GameState, PlacedObject } from './GameState';
import type { IsoGrid } from './grid/IsoGrid';

// Placement/sale orchestration: validity, funds, occupancy, and domain events.

export type PlaceFailure = 'unknown-object' | 'not-allowed' | 'insufficient-funds' | 'blocked';

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
): PlaceCheck {
  const def = getObjectDef(defId);
  if (!def) return { ok: false, reason: 'unknown-object' };
  if (state.cash - def.cost < -creditLimit) {
    return { ok: false, reason: 'insufficient-funds' };
  }
  if (!grid.canPlace(col, row, def.footprint.w, def.footprint.h)) {
    return { ok: false, reason: 'blocked' };
  }
  return { ok: true };
}

export function placeObject(
  state: GameState,
  grid: IsoGrid,
  defId: string,
  col: number,
  row: number,
  creditLimit = 0,
): PlacedObject | null {
  if (!canPlaceObject(state, grid, defId, col, row, creditLimit).ok) return null;
  const def = getObjectDef(defId)!;

  const po: PlacedObject = { id: state.newObjectId(), defId, col, row };
  grid.occupy(po.id, col, row, def.footprint.w, def.footprint.h);
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
