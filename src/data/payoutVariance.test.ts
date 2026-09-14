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
        'Sits at 13.1, just over the bar, on a 9% edge with a 6x proposition tail. Craps ' +
        'without a rare big hit is not craps, and one rung over 12 does not dissolve a day.',
    },
  },
  {
    name: 'roulette-table',
    table: ROULETTE_BALANCE.payoutTable,
    rtp: 0.92,
    allowance: {
      max: 33,
      because:
        'The highest in the game at 32.2, and deliberately so: P13 built roulette as the ' +
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
  // The spec's non-negotiable rule: a new game must differ from every existing
  // one on at least TWO axes, or it is a reskin that makes the catalogue wider
  // and shallower. Cadence, wager and edge are pinned here; the remaining axes
  // are documented per-table in balance.ts.
  it('gives each Tier 1 game a distinct wager', () => {
    const wagers = [
      PENNY_SLOT_BALANCE.costToPlay,
      PACHINKO_BALANCE.costToPlay,
      KENO_BALANCE.costToPlay,
      SLOT_BALANCE.costToPlay,
    ];
    expect(new Set(wagers).size).toBe(wagers.length);
  });

  it('makes keno the slowest game and video poker the fastest', () => {
    const everyOtherInterval = [
      SLOT_BALANCE.spinIntervalTicks,
      BLACKJACK_BALANCE.playIntervalTicks,
      CRAPS_BALANCE.playIntervalTicks,
      PENNY_SLOT_BALANCE.spinIntervalTicks,
      PACHINKO_BALANCE.spinIntervalTicks,
    ];
    expect(KENO_BALANCE.playIntervalTicks).toBeGreaterThan(Math.max(...everyOtherInterval));
    expect(VIDEO_POKER_BALANCE.playIntervalTicks).toBeLessThan(Math.min(...everyOtherInterval));
  });

  it('makes keno the thickest edge and video poker the thinnest', () => {
    const edges = ALL_TABLES.map((t) => moments(t.table).edge);
    expect(moments(KENO_BALANCE.payoutTable).edge).toBe(Math.max(...edges));
    expect(moments(VIDEO_POKER_BALANCE.payoutTable).edge).toBe(Math.min(...edges));
  });
});
