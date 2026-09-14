import { describe, expect, it } from 'vitest';
import {
  KENO_BALANCE,
  PACHINKO_BALANCE,
  PENNY_SLOT_BALANCE,
  VIDEO_POKER_BALANCE,
  kenoExpectedRtp,
  pachinkoExpectedRtp,
  pennySlotExpectedRtp,
  videoPokerExpectedRtp,
} from '../data/balance';
import { getObjectDef, OBJECT_CATALOG } from '../data/objects';
import { createMachine } from './entities/machines/factory';
import { KenoLounge } from './entities/machines/KenoLounge';
import { PachinkoMachine } from './entities/machines/PachinkoMachine';
import { PennySlots } from './entities/machines/PennySlots';
import { SeatedCasinoGame } from './entities/machines/SeatedCasinoGame';
import { VideoPokerBank } from './entities/machines/VideoPokerBank';
import { Rng } from './rng';
import { CasinoWorld } from './world';

// P17 Part B, Tier 1 — four throughput games.
//
// The factory is the single construction point for placement AND deserialize,
// so a game wired into one path and not the other would deserialize as the
// wrong subclass. P13 earned that lesson; these tests pin it for the new four.

const TIER1 = ['penny-slots', 'pachinko', 'keno-lounge', 'video-poker'] as const;

describe('Tier 1 catalogue entries', () => {
  for (const id of TIER1) {
    it(`${id}: is a catalogued game with real art and an icon`, () => {
      const def = getObjectDef(id);
      expect(def, `${id} missing from OBJECT_CATALOG`).toBeDefined();
      expect(def!.category).toBe('game');
      // spriteKey must match an atlas FILE_ASSETS key, which is what makes the
      // Blender-rendered PNG load instead of a generated placeholder.
      expect(def!.spriteKey).toBe(`img-${id}`);
      expect(def!.displaySize).toBeDefined();
      expect(def!.icon).toBe(id);
    });
  }

  it('declares a displaySize matching the rendered art, so nothing is stretched', () => {
    // ObjectViews calls setDisplaySize(w, h), which scales each axis
    // independently — so if displaySize's aspect differs from the PNG's, the
    // sprite is distorted. The whole point of the render rig is an exact
    // projection; losing it to a rounded number in the catalog would be absurd.
    // Sizes are half the rendered PNG (2x display is the pipeline convention).
    const RENDERED: Record<string, [number, number]> = {
      'penny-slots': [141, 240],
      pachinko: [156, 278],
      'keno-lounge': [433, 400],
      'video-poker': [340, 349],
    };
    // Stated as the invariant rather than an aspect tolerance: half of an odd
    // dimension is not an integer, so +/-1px is the floor on how exact this can
    // be and a percentage threshold just obscures that.
    for (const id of TIER1) {
      const [pw, ph] = RENDERED[id]!;
      const d = getObjectDef(id)!.displaySize!;
      expect(Math.abs(d.w * 2 - pw), `${id}: width ${d.w}x2 vs ${pw}`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.h * 2 - ph), `${id}: height ${d.h}x2 vs ${ph}`).toBeLessThanOrEqual(1);
    }
  });

  it('prices the tier as a ladder, cheapest to dearest', () => {
    const costs = TIER1.map((id) => getObjectDef(id)!.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    // And the whole tier sits under the cheapest existing table, which is what
    // makes it a throughput tier rather than more mid-game.
    expect(Math.max(...costs)).toBeLessThan(getObjectDef('craps-table')!.cost);
  });

  it('gives pachinko the only ratingBonus in the game catalogue', () => {
    // Derived from the catalog, not enumerated: a hand-written list silently
    // stops covering the catalogue the moment a game is added to it.
    const gamesWithBonus = OBJECT_CATALOG.filter(
      (d) => d.category === 'game' && (d.ratingBonus ?? 0) > 0,
    ).map((d) => d.id);
    expect(gamesWithBonus).toEqual(['pachinko']);
  });
});

describe('Tier 1 factory wiring', () => {
  it('builds each defId as its own subclass', () => {
    expect(createMachine('penny-slots', 'a')).toBeInstanceOf(PennySlots);
    expect(createMachine('pachinko', 'b')).toBeInstanceOf(PachinkoMachine);
    expect(createMachine('keno-lounge', 'c')).toBeInstanceOf(KenoLounge);
    expect(createMachine('video-poker', 'd')).toBeInstanceOf(VideoPokerBank);
  });

  it('carries the defId back out, so save/load cannot swap a subclass', () => {
    for (const id of TIER1) expect(createMachine(id, 'x')!.defId).toBe(id);
  });

  it('seats keno and video poker, and leaves the two cabinets single-player', () => {
    expect(createMachine('keno-lounge', 'c')).toBeInstanceOf(SeatedCasinoGame);
    expect(createMachine('video-poker', 'd')).toBeInstanceOf(SeatedCasinoGame);
    expect(createMachine('penny-slots', 'a')).not.toBeInstanceOf(SeatedCasinoGame);
    expect(createMachine('pachinko', 'b')).not.toBeInstanceOf(SeatedCasinoGame);

    const keno = createMachine('keno-lounge', 'c') as KenoLounge;
    const vp = createMachine('video-poker', 'd') as VideoPokerBank;
    expect(keno.seatCount).toBe(KENO_BALANCE.seats);
    expect(vp.seatCount).toBe(VIDEO_POKER_BALANCE.seats);
  });

  it('gives none of the tier a table minimum', () => {
    // Deliberate, and the same rule CasinoGame already states for slots: these
    // are fixed-denomination machines and a fixed-price keno ticket, so they
    // have a coin size, not a minimum. Tier 2's real table games are where
    // TABLE_MINIMUMS.defaultByType grows.
    for (const id of TIER1) expect(createMachine(id, 'x')!.supportsMinimum).toBe(false);
  });
});

describe('Tier 1 payouts over many plays', () => {
  // The payout tables are asserted analytically in payoutVariance.test.ts; this
  // checks the machines actually roll against the table they claim, which a
  // copy-paste between four near-identical subclasses could easily get wrong.
  const cases = [
    { id: 'penny-slots', rtp: pennySlotExpectedRtp(), wager: PENNY_SLOT_BALANCE.costToPlay },
    { id: 'pachinko', rtp: pachinkoExpectedRtp(), wager: PACHINKO_BALANCE.costToPlay },
    { id: 'keno-lounge', rtp: kenoExpectedRtp(), wager: KENO_BALANCE.costToPlay },
    { id: 'video-poker', rtp: videoPokerExpectedRtp(), wager: VIDEO_POKER_BALANCE.costToPlay },
  ];

  for (const { id, rtp, wager } of cases) {
    it(`${id}: pays back its configured RTP over 40k plays`, { timeout: 60_000 }, () => {
      const machine = createMachine(id, 'm')!;
      const rng = new Rng(4242);
      const n = 40_000;
      let paid = 0;
      for (let i = 0; i < n; i++) paid += machine.testSpin(rng);
      // Rounding to whole dollars biases a $2 wager noticeably, so compare
      // against the wager the machine actually takes rather than a fraction.
      expect(paid / (n * wager)).toBeCloseTo(rtp, 1);
    });
  }
});

describe('Tier 1 on a live floor', () => {
  // Sized per game rather than one budget for all four: keno deals every 30
  // ticks, so it genuinely needs ten in-game days to show anything, while the
  // other three deal every 4-6 and are proven in a third of that. Using keno's
  // budget everywhere tripled this file's runtime for no extra evidence.
  const TICKS: Record<string, number> = {
    'penny-slots': 4_000,
    pachinko: 4_000,
    'video-poker': 4_000,
    'keno-lounge': 12_000,
  };

  for (const id of TIER1) {
    it(`${id}: places, is played by guests, and takes money`, { timeout: 120_000 }, () => {
      const world = new CasinoWorld({ seed: 21, autoSpawn: true });
      world.state.cash = 200_000;
      expect(world.place(id, 6, 6), `${id} failed to place`).not.toBeNull();
      world.place('toilet', 10, 10);

      const machine = [...world.machines.values()].find((m) => m.defId === id);
      expect(machine, `${id} did not register as a machine`).toBeDefined();

      for (let i = 0; i < TICKS[id]!; i++) world.tick();

      // Every Tier 1 game has a positive house edge, so a long run must end up
      // ahead. Zero means it was never played; negative means its payout table
      // is inverted.
      expect(machine!.lifetimeProfit, `${id} never earned over ${TICKS[id]} ticks`).toBeGreaterThan(0);
      // Wear only accrues on a real play, so this is the independent check that
      // guests actually sat down rather than the profit coming from elsewhere.
      expect(machine!.reliability, `${id} was never played`).toBeLessThan(100);
    });
  }

  it('restores each Tier 1 machine as the right subclass across a save round-trip', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.state.cash = 200_000;
    const spots = [
      [4, 4],
      [8, 4],
      [12, 4],
      [16, 4],
    ] as const;
    TIER1.forEach((id, i) => {
      expect(world.place(id, spots[i]![0], spots[i]![1]), `${id} failed to place`).not.toBeNull();
    });

    const restored = new CasinoWorld({ seed: 5, autoSpawn: false });
    restored.loadJSON(world.toJSON());

    const byDef = new Map([...restored.machines.values()].map((m) => [m.defId, m]));
    expect(byDef.get('penny-slots')).toBeInstanceOf(PennySlots);
    expect(byDef.get('pachinko')).toBeInstanceOf(PachinkoMachine);
    expect(byDef.get('keno-lounge')).toBeInstanceOf(KenoLounge);
    expect(byDef.get('video-poker')).toBeInstanceOf(VideoPokerBank);
    expect((byDef.get('keno-lounge') as KenoLounge).seatCount).toBe(KENO_BALANCE.seats);
  });
});
