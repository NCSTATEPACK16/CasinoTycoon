// Builders for nav-mode worlds in tests: the v2 starter floor, a baked
// navmesh and a furnished casino, the way the worker sets one up.

import { WorldNav } from '../nav/WorldNav';
import { CasinoWorld } from '../world';

export async function navWorld(seed = 1, opts: { requireDealers?: boolean } = {}) {
  const world = new CasinoWorld({
    seed,
    autoSpawn: false,
    starterFloor: true,
    requireDealers: opts.requireDealers ?? false,
  });
  world.startScenario(null);
  world.state.cash = 10_000_000;
  world.attachNav(await WorldNav.create(world));
  return world;
}

/** Fill the sandbox starter floor: banks of slots, tables, restrooms, food, a bar. */
export function furnish(world: CasinoWorld, opts: { slots?: number } = {}): void {
  const must = (defId: string, col: number, row: number) => {
    const po = world.place(defId, col, row);
    if (!po) throw new Error(`could not place ${defId} at ${col},${row}`);
    return po;
  };
  // Slot banks: back-to-back pairs of rows (each cabinet's seat faces an
  // aisle), two-cell aisles between pairs.
  let slots = opts.slots ?? 40;
  for (let pair = 5; pair <= 21 && slots > 0; pair += 4) {
    for (const row of [pair, pair + 1]) {
      for (let col = 12; col <= 21 && slots > 0; col++, slots--) must('slot-machine', col, row);
    }
  }
  for (const [col, row] of [
    [24, 6],
    [28, 6],
    [24, 12],
    [28, 12],
  ] as const)
    must('blackjack-table', col, row);
  must('roulette-table', 24, 18);
  must('craps-table', 28, 18);
  must('toilet', 5, 5);
  must('toilet', 7, 5);
  must('toilet', 5, 8);
  must('food-stall', 5, 22);
  must('bar', 30, 23);
}
