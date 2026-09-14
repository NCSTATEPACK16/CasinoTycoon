import { describe, expect, it } from 'vitest';
import {
  BIG_SIX_BALANCE,
  BLACKJACK_BALANCE,
  CRAPS_BALANCE,
  HIGH_LIMIT_BALANCE,
  KENO_BALANCE,
  PACHINKO_BALANCE,
  PENNY_SLOT_BALANCE,
  ROULETTE_BALANCE,
  SLOT_BALANCE,
  VIDEO_POKER_BALANCE,
  slotExpectedRtp,
  type PayoutOutcome,
} from './balance';
import { getObjectDef } from './objects';

/**
 * P16 — the daily-profit coin flip is a payout-table property.
 *
 * A day's takings are the sum of a few hundred pulls, so the house edge only
 * shows through once the number of pulls is large next to the payout variance.
 * The shipped slot table had a per-pull standard deviation 21 times the edge,
 * which needs roughly 450 pulls before the edge dominates — far more than a
 * small floor sees in a day. That is why daily profit read as a coin flip and
 * why lag-1 autocorrelation sat near zero: not the modifiers, the maths.
 *
 * The fix has to leave RTP exactly where it was. Cutting variance by taking
 * money off the players is not a difficulty-curve change, it is a nerf.
 */
function moments(table: readonly PayoutOutcome[]) {
  const rtp = table.reduce((s, o) => s + o.p * o.multiplier, 0);
  const pLoss = 1 - table.reduce((s, o) => s + o.p, 0);
  const variance =
    table.reduce((s, o) => s + o.p * (o.multiplier - rtp) ** 2, 0) + pLoss * (0 - rtp) ** 2;
  return { rtp, sd: Math.sqrt(variance), edge: 1 - rtp, pLoss };
}

describe('slot payout table', () => {
  it('holds the shipped 8% house edge exactly', () => {
    expect(slotExpectedRtp()).toBeCloseTo(0.92, 10);
  });

  it('is a well-formed distribution', () => {
    const { pLoss } = moments(SLOT_BALANCE.payoutTable);
    expect(pLoss).toBeGreaterThan(0);
    expect(pLoss).toBeLessThan(1);
  });

  it('keeps per-pull variance low enough for a day to mean something', () => {
    // The shipped table sat at 21.1. Anything above ~12 needs more pulls than a
    // day provides, and the difficulty curve dissolves into noise.
    const { sd, edge } = moments(SLOT_BALANCE.payoutTable);
    expect(sd / edge).toBeLessThan(12);
  });

  it('still pays a jackpot worth strutting about', () => {
    // P11's strut and the reputation bump both key off a big multiplier, so
    // flattening the tail entirely would quietly delete a feature.
    const best = Math.max(...SLOT_BALANCE.payoutTable.map((o) => o.multiplier));
    expect(best).toBeGreaterThanOrEqual(15);
  });
});

/**
 * P17 acceptance criterion 5 — "variance is deliberate".
 *
 * Every payout table in the catalogue reports sd/edge, and every value is
 * either under the default bar of 12 or carries an explicit, numbered
 * justification here. The bar exists because a table whose spread dwarfs its
 * edge needs more plays than a day provides, so the difficulty curve dissolves
 * into noise — exactly what P16 found and fixed on slots.
 *
 * Writing this test surfaced something P16 never had to confront, because it
 * only ever applied the bar to slots: **sd/edge scales as 1/edge**, so the
 * thinner a game's house edge, the harder the bar bites. Blackjack (4% edge)
 * sits at 24.3 and high-limit (6%) at 28.7 — not because their tails are wild,
 * but because there is almost no edge underneath them. Those are shipped,
 * P16-tuned, measured-winnable games; retuning four of them to satisfy a bar
 * they predate would be a balance change smuggled in as a test.
 *
 * So each exception states its measured value and why it stands. The allowance
 * is an upper bound, not a free pass: a table that drifts worse than its
 * recorded figure fails, which is what stops this list becoming a dumping
 * ground.
 *
 * Poker is absent on purpose — its return is a rake off live table population,
 * not a static payout table, so it has no per-play distribution to measure.
 */
const DEFAULT_BAR = 12;

interface TableSpec {
  name: string;
  table: readonly PayoutOutcome[];
  rtp: number;
  /** Present only for a table allowed above DEFAULT_BAR. */
  allowance?: { max: number; because: string };
}

const ALL_TABLES: readonly TableSpec[] = [
  { name: 'slot-machine', table: SLOT_BALANCE.payoutTable, rtp: 0.92 },
  {
    name: 'blackjack-table',
    table: BLACKJACK_BALANCE.payoutTable,
    rtp: 0.96,
    allowance: {
      max: 25,
      because:
        'A 4% edge is the thinnest in the house bar video poker. sd/edge scales as 1/edge, ' +
        'so even this near-flat table (2x win, 1x push, 2.5x blackjack — no tail at all) ' +
        'measures 24.3. Shipped and P16-tuned; the edge is the cause, not the spread.',
    },
  },
  {
    name: 'craps-table',
    table: CRAPS_BALANCE.payoutTable,
    rtp: 0.91,
    allowance: {
      max: 14,
      because:
        'Sits at 13.1 on a 9% edge with a 6x proposition tail. Squared, that is ~1.2x the ' +
        "plays the bar implies — a real but small cost, and craps without a rare big hit is " +
        'not craps.',
    },
  },
  {
    name: 'roulette-table',
    table: ROULETTE_BALANCE.payoutTable,
    rtp: 0.92,
    allowance: {
      max: 33,
      because:
        'The highest in the game at 32.2 — and note plays-to-signal scales as (sd/edge)^2, ' +
        'so this needs ~7x the plays of the bar, which means a roulette day genuinely IS a ' +
        'coin flip. That is an inherited P13/P16 property, not something Tier 1 introduced. ' +
        'Deliberate, though: P13 built roulette as the ' +
        'table whose point IS variance, and its 20x straight-up branch is what drives the ' +
        "P11 strut and jackpot beats. Flattening it would delete the game's identity.",
    },
  },
  { name: 'big-six-wheel', table: BIG_SIX_BALANCE.payoutTable, rtp: 0.8 },
  {
    name: 'high-limit-table',
    table: HIGH_LIMIT_BALANCE.payoutTable,
    rtp: 0.94,
    allowance: {
      max: 29,
      because:
        'Best odds in the house (6% edge) plus a 10x branch, measuring 28.7. The whole ' +
        'point of the object is that the VIP treatment is real, which means a thin edge; ' +
        'the thin edge is what puts it here.',
    },
  },
  // P17 Tier 1 — all four are inside the default bar by construction.
  { name: 'penny-slots', table: PENNY_SLOT_BALANCE.payoutTable, rtp: 0.9 },
  { name: 'pachinko', table: PACHINKO_BALANCE.payoutTable, rtp: 0.88 },
  { name: 'keno-lounge', table: KENO_BALANCE.payoutTable, rtp: 0.75 },
  { name: 'video-poker', table: VIDEO_POKER_BALANCE.payoutTable, rtp: 0.96 },
];

describe('every payout table in the catalogue', () => {
  for (const { name, table, rtp, allowance } of ALL_TABLES) {
    it(`${name}: holds its stated RTP`, () => {
      expect(moments(table).rtp).toBeCloseTo(rtp, 6);
    });

    it(`${name}: is a well-formed distribution`, () => {
      const { pLoss } = moments(table);
      expect(pLoss).toBeGreaterThan(0);
      expect(pLoss).toBeLessThan(1);
    });

    it(`${name}: variance is deliberate`, () => {
      const { sd, edge } = moments(table);
      const ratio = sd / edge;
      if (!allowance) {
        expect(ratio, `${name} has no justified allowance`).toBeLessThan(DEFAULT_BAR);
        return;
      }
      // An allowance is a ceiling, not an exemption — drift past the recorded
      // figure has to re-earn its justification.
      expect(allowance.because.length, `${name} allowance needs a reason`).toBeGreaterThan(40);
      expect(ratio, allowance.because).toBeLessThanOrEqual(allowance.max);
    });
  }

  it('keeps video poker inside the bar despite the thinnest edge in the game', () => {
    // The reason VIDEO_POKER_BALANCE ships without a royal-flush band. At a 4%
    // edge a 0.0005 chance of 20x takes sd/edge from 11.1 to 15.6, and even a
    // 0.0002 tail lands at 13.1 — so the jackpot was dropped rather than the
    // bar bent. Blackjack, at the same edge WITH no tail, still measures 24.3;
    // that contrast is the whole argument for how flat this table had to be.
    const { sd, edge } = moments(VIDEO_POKER_BALANCE.payoutTable);
    expect(sd / edge).toBeLessThan(DEFAULT_BAR);
    expect(Math.max(...VIDEO_POKER_BALANCE.payoutTable.map((o) => o.multiplier))).toBeLessThan(5);
  });
});

describe('Tier 1 differentiation', () => {
  /**
   * The spec's non-negotiable rule: a new game must differ from every existing
   * one on at least TWO axes, or it is a reskin that makes the catalogue wider
   * and shallower.
   *
   * This replaces an earlier test that compared four hand-picked wagers and
   * quietly left video poker out of the list — because video poker and pachinko
   * both wager $5, so including it would have failed. That test was shaped
   * around its own counterexample. The rule was never "every wager is unique";
   * it is "every PAIR differs on two or more axes", so this asserts that
   * directly, over every pair in the catalogue, and reports the offender.
   */
  const AXES = ['wager', 'rtp', 'cadence', 'sessionMin', 'sessionMax', 'seats', 'wear', 'footprint', 'upkeep', 'ratingBonus'] as const;

  interface Profile {
    id: string;
    wager: number;
    rtp: number;
    cadence: number;
    sessionMin: number;
    sessionMax: number;
    seats: number;
    wear: number;
    footprint: string;
    upkeep: number;
    ratingBonus: number;
  }

  function profile(id: string, b: Record<string, unknown>, table?: readonly PayoutOutcome[]): Profile {
    const def = getObjectDef(id)!;
    return {
      id,
      wager: b.costToPlay as number,
      rtp: table ? Number(moments(table).rtp.toFixed(4)) : -1,
      cadence: (b.playIntervalTicks ?? b.spinIntervalTicks) as number,
      sessionMin: (b.playsMin ?? b.spinsMin) as number,
      sessionMax: (b.playsMax ?? b.spinsMax) as number,
      seats: (b.seats as number) ?? 1,
      wear: b.wearPerPlay as number,
      footprint: `${def.footprint.w}x${def.footprint.h}`,
      upkeep: def.upkeepPerDay,
      ratingBonus: def.ratingBonus ?? 0,
    };
  }

  const PROFILES: readonly Profile[] = [
    profile('slot-machine', SLOT_BALANCE, SLOT_BALANCE.payoutTable),
    profile('blackjack-table', BLACKJACK_BALANCE, BLACKJACK_BALANCE.payoutTable),
    profile('craps-table', CRAPS_BALANCE, CRAPS_BALANCE.payoutTable),
    profile('roulette-table', ROULETTE_BALANCE, ROULETTE_BALANCE.payoutTable),
    profile('big-six-wheel', BIG_SIX_BALANCE, BIG_SIX_BALANCE.payoutTable),
    profile('high-limit-table', HIGH_LIMIT_BALANCE, HIGH_LIMIT_BALANCE.payoutTable),
    profile('penny-slots', PENNY_SLOT_BALANCE, PENNY_SLOT_BALANCE.payoutTable),
    profile('pachinko', PACHINKO_BALANCE, PACHINKO_BALANCE.payoutTable),
    profile('keno-lounge', KENO_BALANCE, KENO_BALANCE.payoutTable),
    profile('video-poker', VIDEO_POKER_BALANCE, VIDEO_POKER_BALANCE.payoutTable),
  ];

  it('differs every pair of games on at least two axes', () => {
    for (let i = 0; i < PROFILES.length; i++) {
      for (let j = i + 1; j < PROFILES.length; j++) {
        const a = PROFILES[i]!;
        const b = PROFILES[j]!;
        const differing = AXES.filter((axis) => a[axis] !== b[axis]);
        expect(
          differing.length,
          `${a.id} vs ${b.id} differ only on [${differing.join(', ')}] — two axes minimum`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('records that video poker and pachinko share a wager, and differ elsewhere', () => {
    // Kept explicit so the overlap is a documented fact rather than something a
    // future edit rediscovers. They share costToPlay ($5) and nothing else.
    const vp = PROFILES.find((p) => p.id === 'video-poker')!;
    const pa = PROFILES.find((p) => p.id === 'pachinko')!;
    expect(vp.wager).toBe(pa.wager);
    const differing = AXES.filter((axis) => vp[axis] !== pa[axis]);
    expect(differing).not.toContain('wager');
    expect(differing.length).toBeGreaterThanOrEqual(4);
  });

  it('makes keno the slowest game and video poker the fastest', () => {
    const cadences = PROFILES.filter((p) => p.id !== 'keno-lounge' && p.id !== 'video-poker').map(
      (p) => p.cadence,
    );
    expect(KENO_BALANCE.playIntervalTicks).toBeGreaterThan(Math.max(...cadences));
    expect(VIDEO_POKER_BALANCE.playIntervalTicks).toBeLessThan(Math.min(...cadences));
  });

  it('makes keno the thickest edge and video poker the thinnest', () => {
    const edges = ALL_TABLES.map((t) => moments(t.table).edge);
    expect(moments(KENO_BALANCE.payoutTable).edge).toBe(Math.max(...edges));
    expect(moments(VIDEO_POKER_BALANCE.payoutTable).edge).toBe(Math.min(...edges));
  });
});
