import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { SELL_REFUND_RATIO, STARTING_CASH } from '../config';
import { getObjectDef } from '../data/objects';
import { GameState } from './GameState';
import { canPlaceObject, placeObject, sellObject } from './build';
import { IsoGrid } from './grid/IsoGrid';

describe('build system', () => {
  let state: GameState;
  let grid: IsoGrid;

  beforeEach(() => {
    state = new GameState();
    grid = new IsoGrid(10, 10);
  });

  afterEach(() => {
    eventBus.clear();
  });

  it('places an object: deducts cost, occupies cells, registers it', () => {
    const cost = getObjectDef('slot-machine')!.cost;
    const po = placeObject(state, grid, 'slot-machine', 2, 3);
    expect(po).not.toBeNull();
    expect(po).toMatchObject({ defId: 'slot-machine', col: 2, row: 3 });
    expect(state.cash).toBe(STARTING_CASH - cost);
    expect(grid.occupantAt(2, 3)).toBe(po!.id);
    expect(state.getObject(po!.id)).toEqual(po);
  });

  it('emits moneyChanged and objectPlaced on placement', () => {
    const events: string[] = [];
    let money: { cash: number; delta: number } | null = null;
    eventBus.on('moneyChanged', (p) => {
      events.push('moneyChanged');
      money = p;
    });
    eventBus.on('objectPlaced', () => events.push('objectPlaced'));
    placeObject(state, grid, 'plant', 1, 1);
    const cost = getObjectDef('plant')!.cost;
    expect(events).toContain('moneyChanged');
    expect(events).toContain('objectPlaced');
    expect(money).toEqual({ cash: STARTING_CASH - cost, delta: -cost });
  });

  it('a 2×2 object occupies all four cells', () => {
    const po = placeObject(state, grid, 'blackjack-table', 4, 4);
    expect(po).not.toBeNull();
    for (const [c, r] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ] as const) {
      expect(grid.occupantAt(c, r)).toBe(po!.id);
    }
  });

  it('rejects overlap with any occupied cell and leaves cash unchanged', () => {
    placeObject(state, grid, 'blackjack-table', 4, 4);
    const cashAfterFirst = state.cash;
    // 1×1 on a corner of the table's footprint
    expect(canPlaceObject(state, grid, 'plant', 5, 5)).toEqual({ ok: false, reason: 'blocked' });
    expect(placeObject(state, grid, 'plant', 5, 5)).toBeNull();
    expect(state.cash).toBe(cashAfterFirst);
  });

  it('rejects out-of-bounds placement (multi-tile hanging off the edge)', () => {
    expect(canPlaceObject(state, grid, 'blackjack-table', 9, 9)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });

  it('rejects placement the player cannot afford', () => {
    state.cash = 10;
    expect(canPlaceObject(state, grid, 'slot-machine', 1, 1)).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    });
    expect(placeObject(state, grid, 'slot-machine', 1, 1)).toBeNull();
    expect(state.cash).toBe(10);
  });

  // P16 — the credit line is what makes over-expansion possible, and
  // over-expansion is the only action that can plausibly bankrupt a player.
  // Before this, purchases were hard-blocked at cash >= cost, so debt could
  // only ever accrue through wage and upkeep drift and the spiral the campaign
  // layer is built around was unreachable by play.
  describe('buying on credit', () => {
    it('lets a purchase draw the balance down to the credit limit', () => {
      const cost = getObjectDef('slot-machine')!.cost;
      state.cash = 0;
      expect(canPlaceObject(state, grid, 'slot-machine', 1, 1, cost)).toEqual({ ok: true });
      expect(placeObject(state, grid, 'slot-machine', 1, 1, cost)).not.toBeNull();
      expect(state.cash).toBe(-cost);
    });

    it('refuses the purchase that would breach the limit, by a single dollar', () => {
      const cost = getObjectDef('slot-machine')!.cost;
      state.cash = 0;
      // One dollar short of covering the overdraft this purchase would open.
      expect(canPlaceObject(state, grid, 'slot-machine', 1, 1, cost - 1)).toEqual({
        ok: false,
        reason: 'insufficient-funds',
      });
      expect(placeObject(state, grid, 'slot-machine', 1, 1, cost - 1)).toBeNull();
      expect(state.cash).toBe(0);
    });

    it('measures the limit from the balance, not from zero', () => {
      const cost = getObjectDef('slot-machine')!.cost;
      // Already in the red: the line is nearly spent, so the same purchase
      // that was affordable at zero is not affordable here.
      state.cash = -cost + 1;
      expect(canPlaceObject(state, grid, 'slot-machine', 1, 1, cost).ok).toBe(false);
      expect(canPlaceObject(state, grid, 'slot-machine', 1, 1, cost * 2).ok).toBe(true);
    });

    it('omitting the limit keeps the old cash-only rule', () => {
      // Every existing caller passes nothing, so the default has to be the
      // behaviour that shipped: no credit at all.
      state.cash = 10;
      expect(canPlaceObject(state, grid, 'slot-machine', 1, 1)).toEqual({
        ok: false,
        reason: 'insufficient-funds',
      });
    });
  });

  it('rejects unknown object ids', () => {
    expect(canPlaceObject(state, grid, 'mystery-box', 1, 1)).toEqual({
      ok: false,
      reason: 'unknown-object',
    });
    expect(placeObject(state, grid, 'mystery-box', 1, 1)).toBeNull();
  });

  it('sells an object: partial refund, cells freed, registry cleaned, objectSold emitted', () => {
    const po = placeObject(state, grid, 'slot-machine', 2, 2)!;
    const cashBefore = state.cash;
    const cost = getObjectDef('slot-machine')!.cost;
    let sold: unknown = null;
    eventBus.on('objectSold', (p) => (sold = p));

    const refund = sellObject(state, grid, po.id);
    expect(refund).toBe(Math.round(cost * SELL_REFUND_RATIO));
    expect(state.cash).toBe(cashBefore + refund!);
    expect(grid.occupantAt(2, 2)).toBeNull();
    expect(state.getObject(po.id)).toBeUndefined();
    expect(sold).toMatchObject({ id: po.id, defId: 'slot-machine', refund });
    // the freed cells are placeable again
    expect(canPlaceObject(state, grid, 'plant', 2, 2).ok).toBe(true);
  });

  it('selling an unknown id returns null and changes nothing', () => {
    const cashBefore = state.cash;
    expect(sellObject(state, grid, 'obj-999')).toBeNull();
    expect(state.cash).toBe(cashBefore);
  });
});
