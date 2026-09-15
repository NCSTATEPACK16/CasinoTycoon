import { describe, expect, it } from 'vitest';
import {
  BINGO_BALANCE,
  PAI_GOW_BALANCE,
  SIC_BO_BALANCE,
  TABLE_MINIMUMS,
  THREE_CARD_POKER_BALANCE,
  bingoExpectedRtp,
  paiGowExpectedRtp,
  sicBoExpectedRtp,
  threeCardPokerExpectedRtp,
} from '../data/balance';
import { getObjectDef } from '../data/objects';
import { BingoHall } from './entities/machines/BingoHall';
import { createMachine } from './entities/machines/factory';
import { PaiGowTable } from './entities/machines/PaiGowTable';
import { SeatedCasinoGame } from './entities/machines/SeatedCasinoGame';
import { SicBoTable } from './entities/machines/SicBoTable';
import { ThreeCardPokerTable } from './entities/machines/ThreeCardPokerTable';
import { Rng } from './rng';
import { CasinoWorld } from './world';

// P17 Part B, Tier 2 — the working floor. Same shape as world.tier1.test.ts and
// for the same reason: the factory is the single construction point for both
// placement and deserialize, and four near-identical subclasses are exactly
// where a copy-paste points a table at the wrong balance block.
//
// `sports-book` is Tier 2's fifth game in the spec and is absent throughout —
// its scheduled-settlement mechanic is deferred, see balance.ts. Its art is
// rendered and registered in the atlas; there is no catalogue entry to test.

const TIER2 = ['sic-bo', 'three-card-poker', 'pai-gow', 'bingo-hall'] as const;

describe('Tier 2 catalogue entries', () => {
  for (const id of TIER2) {
    it(`${id}: is a catalogued game with real art and an icon`, () => {
      const def = getObjectDef(id);
      expect(def, `${id} missing from OBJECT_CATALOG`).toBeDefined();
      expect(def!.category).toBe('game');
      expect(def!.spriteKey).toBe(`img-${id}`);
      expect(def!.displaySize).toBeDefined();
      expect(def!.icon).toBe(id);
    });
  }

  it('declares a displaySize matching the rendered art, so nothing is stretched', () => {
    // setDisplaySize scales each axis independently, so an aspect that differs
    // from the PNG's distorts the sprite. Sizes are half the rendered PNG, and
    // +/-1px is the floor on exactness because half an odd dimension is not an
    // integer.
    const RENDERED: Record<string, [number, number]> = {
      'sic-bo': [440, 292],
      'three-card-poker': [410, 300],
      'pai-gow': [410, 300],
      'bingo-hall': [663, 520],
    };
    for (const id of TIER2) {
      const [pw, ph] = RENDERED[id]!;
      const d = getObjectDef(id)!.displaySize!;
      expect(Math.abs(d.w * 2 - pw), `${id}: width ${d.w}x2 vs ${pw}`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.h * 2 - ph), `${id}: height ${d.h}x2 vs ${ph}`).toBeLessThanOrEqual(1);
    }
  });

  it('prices the tier as a ladder, cheapest to dearest, above Tier 1 and under the mid-game', () => {
    const costs = TIER2.map((id) => getObjectDef(id)!.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    // The whole point of a middle tier: it starts above everything Tier 1 sells
    // and finishes below the table the `catalogue` line's trap is built on.
    expect(Math.min(...costs)).toBeGreaterThan(getObjectDef('video-poker')!.cost);
    expect(Math.max(...costs)).toBeLessThan(getObjectDef('high-limit-table')!.cost);
  });

  it('gives the bingo hall the largest footprint of any game on the floor', () => {
    // Twelve seats at a $4 card only works if the object is full, and it eats
    // more floor than anything else to get them.
    const bingo = getObjectDef('bingo-hall')!.footprint;
    const area = (f: { w: number; h: number }) => f.w * f.h;
    for (const id of TIER2) {
      if (id === 'bingo-hall') continue;
      expect(area(bingo)).toBeGreaterThan(area(getObjectDef(id)!.footprint));
    }
  });
});

describe('Tier 2 factory wiring', () => {
  it('builds each defId as its own subclass', () => {
    expect(createMachine('sic-bo', 'a')).toBeInstanceOf(SicBoTable);
    expect(createMachine('three-card-poker', 'b')).toBeInstanceOf(ThreeCardPokerTable);
    expect(createMachine('pai-gow', 'c')).toBeInstanceOf(PaiGowTable);
    expect(createMachine('bingo-hall', 'd')).toBeInstanceOf(BingoHall);
  });

  it('carries the defId back out, so save/load cannot swap a subclass', () => {
    for (const id of TIER2) expect(createMachine(id, 'x')!.defId).toBe(id);
  });

  it('seats all four, at the counts their balance blocks declare', () => {
    const seats: Record<string, number> = {
      'sic-bo': SIC_BO_BALANCE.seats,
      'three-card-poker': THREE_CARD_POKER_BALANCE.seats,
      'pai-gow': PAI_GOW_BALANCE.seats,
      'bingo-hall': BINGO_BALANCE.seats,
    };
    for (const id of TIER2) {
      const m = createMachine(id, 'x')!;
      expect(m, `${id} is not seated`).toBeInstanceOf(SeatedCasinoGame);
      expect((m as SeatedCasinoGame).seatCount, `${id} seat count`).toBe(seats[id]);
    }
  });

  it('gives a table minimum to the three dealt games and not to bingo', () => {
    // Tier 1 grew no minimums at all; these are the first entries added to
    // TABLE_MINIMUMS.defaultByType since P13. Bingo is a fixed-price card like
    // keno — a coin size, not a minimum — so the dial would mean nothing on it.
    for (const id of ['sic-bo', 'three-card-poker', 'pai-gow'] as const) {
      expect(createMachine(id, 'x')!.supportsMinimum, `${id} should take a minimum`).toBe(true);
      expect(TABLE_MINIMUMS.defaultByType[id], `${id} missing a default minimum`).toBeGreaterThan(0);
    }
    expect(createMachine('bingo-hall', 'x')!.supportsMinimum).toBe(false);
    expect(TABLE_MINIMUMS.defaultByType['bingo-hall']).toBeUndefined();
  });
});

describe('Tier 2 payouts over many plays', () => {
  // The tables themselves are asserted analytically in payoutVariance.test.ts.
  // This checks each machine rolls against the table it claims — the failure a
  // copy-paste between four near-identical subclasses produces.
  const cases = [
    { id: 'sic-bo', rtp: sicBoExpectedRtp(), wager: SIC_BO_BALANCE.costToPlay },
    {
      id: 'three-card-poker',
      rtp: threeCardPokerExpectedRtp(),
      wager: THREE_CARD_POKER_BALANCE.costToPlay,
    },
    { id: 'pai-gow', rtp: paiGowExpectedRtp(), wager: PAI_GOW_BALANCE.costToPlay },
    { id: 'bingo-hall', rtp: bingoExpectedRtp(), wager: BINGO_BALANCE.costToPlay },
  ];

  for (const { id, rtp, wager } of cases) {
    it(`${id}: pays back its configured RTP over 40k plays`, { timeout: 60_000 }, () => {
      const machine = createMachine(id, 'm')!;
      const rng = new Rng(4242);
      const n = 40_000;
      let paid = 0;
      for (let i = 0; i < n; i++) paid += machine.testSpin(rng);
      // Compare against the wager the machine actually takes: rounding to whole
      // dollars biases bingo's $4 card noticeably.
      expect(paid / (n * wager)).toBeCloseTo(rtp, 1);
    });
  }
});

describe('Tier 2 on a live floor', () => {
  // Sized per game by cadence, as Tier 1 is: pai gow deals every 22 ticks and
  // bingo every 20, so both need roughly three times the budget of the two
  // fast tables before anything is visible.
  const TICKS: Record<string, number> = {
    'sic-bo': 4_000,
    'three-card-poker': 4_000,
    'pai-gow': 12_000,
    'bingo-hall': 12_000,
  };

  for (const id of TIER2) {
    it(`${id}: places, is played by guests, and takes money`, { timeout: 120_000 }, () => {
      const world = new CasinoWorld({ seed: 21, autoSpawn: true });
      world.state.cash = 200_000;
      expect(world.place(id, 6, 6), `${id} failed to place`).not.toBeNull();
      world.place('toilet', 14, 14);

      const machine = [...world.machines.values()].find((m) => m.defId === id);
      expect(machine, `${id} did not register as a machine`).toBeDefined();

      for (let i = 0; i < TICKS[id]!; i++) world.tick();

      // Positive house edge on all four, so a long run must end up ahead. Zero
      // means it was never played; negative means the payout table is inverted.
      expect(
        machine!.lifetimeProfit,
        `${id} never earned over ${TICKS[id]} ticks`,
      ).toBeGreaterThan(0);
      // Wear accrues only on a real play — the independent check that guests
      // actually sat rather than the profit arriving from elsewhere.
      expect(machine!.reliability, `${id} was never played`).toBeLessThan(100);
    });
  }

  it('restores each Tier 2 machine as the right subclass across a save round-trip', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.state.cash = 200_000;
    const spots = [
      [4, 4],
      [9, 4],
      [14, 4],
      [20, 4],
    ] as const;
    TIER2.forEach((id, i) => {
      expect(world.place(id, spots[i]![0], spots[i]![1]), `${id} failed to place`).not.toBeNull();
    });

    const restored = new CasinoWorld({ seed: 5, autoSpawn: false });
    restored.loadJSON(world.toJSON());

    const byDef = new Map([...restored.machines.values()].map((m) => [m.defId, m]));
    expect(byDef.get('sic-bo')).toBeInstanceOf(SicBoTable);
    expect(byDef.get('three-card-poker')).toBeInstanceOf(ThreeCardPokerTable);
    expect(byDef.get('pai-gow')).toBeInstanceOf(PaiGowTable);
    expect(byDef.get('bingo-hall')).toBeInstanceOf(BingoHall);
    expect((byDef.get('bingo-hall') as BingoHall).seatCount).toBe(BINGO_BALANCE.seats);
  });
});
