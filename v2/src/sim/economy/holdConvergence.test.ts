// The books' central claim: hold converges on theo. Theo is the edge against
// the guest actually playing (book edge plus their skill premium), so over a
// running casino the house's real win should sit within noise of it — and
// the noise shrinks as handle grows.

import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../../config';
import { ENGINE_FOR_DEF } from '../games';
import { CasinoWorld } from '../world';
import { casinoFinancials } from './financials';

afterEach(() => eventBus.clear());

describe('hold vs theo on a live floor', () => {
  it('every engine game, and the floor as a whole, lands within 4σ of theo over three days', () => {
    const world = new CasinoWorld({ seed: 404, autoSpawn: true });
    world.state.cash = 1_000_000;
    const spots: [string, number, number][] = [
      ['slot-machine', 3, 3],
      ['slot-machine', 5, 3],
      ['penny-slots', 7, 3],
      ['penny-slots', 9, 3],
      ['blackjack-table', 3, 8],
      ['roulette-table', 9, 8],
      ['craps-table', 15, 8],
      ['poker-table', 21, 8],
      ['high-limit-table', 27, 8],
    ];
    for (const [defId, col, row] of spots)
      expect(world.place(defId, col, row), defId).not.toBeNull();
    world.place('toilet', 30, 20);
    world.place('food-stall', 25, 20);
    for (let i = 0; i < 5; i++) world.hireStaff('dealer');
    world.hireStaff('mechanic');
    world.hireStaff('janitor');

    // Per-play nets by game, to measure the noise rather than assume it.
    const nets = new Map<string, number[]>();
    eventBus.on('machinePlayed', ({ machineId, wager, payout }) => {
      const defId = world.machines.get(machineId)?.defId;
      if (!defId) return;
      const list = nets.get(defId) ?? [];
      list.push(wager - payout);
      nets.set(defId, list);
    });

    let handle = 0;
    let win = 0;
    let theo = 0;
    const perGame = new Map<string, { handle: number; win: number; theo: number }>();
    eventBus.on('dayEnded', () => {
      for (const r of world.ledger.history.at(-1)!.sources) {
        if (!ENGINE_FOR_DEF[r.defId]) continue;
        const g = perGame.get(r.defId) ?? { handle: 0, win: 0, theo: 0 };
        g.handle += r.wagered;
        g.win += r.wagered - r.won;
        g.theo += r.theo;
        perGame.set(r.defId, g);
        handle += r.wagered;
        win += r.wagered - r.won;
        theo += r.theo;
      }
    });
    for (let i = 0; i < 3 * HOURS_PER_DAY * TICKS_PER_HOUR; i++) {
      world.tick();
      // Keep the floor busy and the books flowing: the test is about math, not solvency.
      world.state.cash = Math.max(world.state.cash, 100_000);
    }

    expect(perGame.size).toBeGreaterThanOrEqual(6);
    for (const [defId, g] of perGame) {
      const xs = nets.get(defId) ?? [];
      const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      const sumSe = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0));
      expect(g.handle, defId).toBeGreaterThan(0);
      expect(
        Math.abs(g.win - g.theo),
        `${defId}: win ${g.win.toFixed(0)} vs theo ${g.theo.toFixed(0)}`,
      ).toBeLessThan(4 * sumSe + 1);
    }
    // Floor-wide, against the combined noise. Three days is a few hundred
    // thousand dollars of handle, so this is a ~1.5-point band on hold; the
    // tight large-handle claim is engineMachines.test.ts (40k plays a game).
    let floorVar = 0;
    for (const xs of nets.values()) {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      floorVar += xs.reduce((a, x) => a + (x - mean) ** 2, 0);
    }
    expect(Math.abs(win - theo)).toBeLessThan(4 * Math.sqrt(floorVar));
    expect(handle).toBeGreaterThan(100_000);
    // And the P&L view reads the same books.
    expect(casinoFinancials(world.ledger).yesterday!.gaming.handle).toBeGreaterThan(0);
  }, 300_000);
});
