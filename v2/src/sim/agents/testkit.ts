// Builders for nav-mode worlds in tests: the v2 starter floor, a baked
// navmesh and a furnished casino, the way the worker sets one up.

import type { CampaignDef } from '../../data/campaigns';
import { WorldNav } from '../nav/WorldNav';
import { CasinoWorld } from '../world';

export async function navWorld(
  seed = 1,
  opts: { requireDealers?: boolean; scenario?: CampaignDef } = {},
) {
  const world = new CasinoWorld({
    seed,
    autoSpawn: false,
    starterFloor: true,
    requireDealers: opts.requireDealers ?? false,
  });
  world.startScenario(opts.scenario ?? null);
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

/**
 * The SPEC §9.7 stress floor on Sandbox's 96×64 lot: a table pit, a
 * high-limit salon, restrooms, food and two bars, and slot and video-poker
 * banks two deep with an aisle between pairs and a cross aisle every eleventh
 * column. Plants and neon fill the spots a game may not stand. Doorways keep
 * a clear apron so no bank seals a room. Returns how many objects went down.
 */
export function furnishSandbox(world: CasinoWorld): number {
  const { floor } = world;
  const key = (col: number, row: number) => row * floor.cols + col;
  const keepClear = new Set<number>();
  for (const w of floor.allWalls()) {
    if (!w.door) continue;
    const other = w.edge === 'w' ? { col: w.col - 1, row: w.row } : { col: w.col, row: w.row - 1 };
    for (const c of [w, other])
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          if (Math.abs(dc) + Math.abs(dr) <= 2) keepClear.add(key(c.col + dc, c.row + dr));
  }
  let placed = 0;
  const put = (defId: string, col: number, row: number) => {
    const ok = world.place(defId, col, row) !== null;
    if (ok) placed++;
    return ok;
  };
  const tables = [
    'blackjack-table',
    'roulette-table',
    'craps-table',
    'poker-table',
    'sic-bo',
    'three-card-poker',
    'pai-gow',
  ];
  let t = 0;
  for (let row = 22; row <= 38; row += 4)
    for (let col = 30; col <= 54; col += 4) {
      if (!put(tables[t++ % tables.length]!, col, row)) continue;
      for (let dr = -1; dr < 3; dr++)
        for (let dc = -1; dc < 3; dc++) keepClear.add(key(col + dc, row + dr));
    }
  for (let row = 6; row <= 14; row += 4)
    for (let col = 61; col <= 80; col += 4) put('high-limit-table', col, row);
  for (let row = 5; row <= 12; row += 2) put('toilet', 5, row);
  for (let col = 45; col <= 52; col += 2) put('toilet', col, 58);
  for (let col = 6; col <= 20; col += 3) put('food-stall', col, 58);
  put('bar', 6, 46);
  put('bar', 10, 46);
  for (let row = 4; row < 60; row++) {
    if (row % 3 === 1) continue;
    for (let col = 4; col < 84; col++) {
      if (col % 11 === 0 || keepClear.has(key(col, row))) continue;
      if (col >= 58 && row <= 18) continue; // the salon keeps its tables
      const game = (col + row) % 7 === 0 ? 'video-poker' : 'slot-machine';
      for (const defId of [game, 'plant', 'neon-sign']) if (put(defId, col, row)) break;
    }
  }
  // Decor in the back-of-house rooms either side of the lobby.
  for (let row = 6; row <= 18; row += 2)
    for (let col = 86; col <= 94; col += 2) put('neon-sign', col, row);
  for (let row = 47; row <= 58; row += 2)
    for (let col = 86; col <= 94; col += 2) put('plant', col, row);
  return placed;
}

/**
 * B7a: the ~210-seat Sandbox floor B3 and B5 were measured on. A pit of
 * blackjack tables, restrooms, food and two bars, and slot banks two deep
 * with two-cell aisles, kept clear of the lobby's double door, to `room`
 * seats in all.
 */
export function furnishSandboxFloor(world: CasinoWorld, room = 210, aisle = 2): void {
  const put = (d: string, c: number, r: number) => world.place(d, c, r) !== null;
  for (let col = 30; col <= 54; col += 4) put('blackjack-table', col, 22);
  for (let row = 5; row <= 12; row += 2) put('toilet', 5, row);
  for (let col = 6; col <= 15; col += 3) put('food-stall', col, 58);
  put('bar', 6, 46);
  put('bar', 10, 46);
  banks: for (let row = 28; row < 48; row++) {
    if ((row - 28) % (2 + aisle) > 1) continue;
    for (let col = 20; col < 78; col++) {
      if (col % 7 <= 1) continue;
      if (world.floorCapacity() >= room) break banks;
      put('slot-machine', col, row);
    }
  }
}

/** B7a: the share of guests seated and playing, averaged over `ticks` ticks
 *  after `warmup`, sampled every 10. */
export function measurePlayShare(
  world: CasinoWorld,
  ticks: number,
  warmup = 0,
): { share: number; guests: number; playing: number } {
  let guests = 0;
  let playing = 0;
  let samples = 0;
  for (let t = 0; t < warmup + ticks; t++) {
    world.tick();
    if (t < warmup || t % 10 !== 0) continue;
    samples++;
    for (const g of world.guests.values()) {
      guests++;
      if (g.state === 'play') playing++;
    }
  }
  return {
    share: guests ? playing / guests : 0,
    guests: guests / Math.max(1, samples),
    playing: playing / Math.max(1, samples),
  };
}
