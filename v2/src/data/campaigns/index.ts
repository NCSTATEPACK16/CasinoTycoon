// Campaign scenario definitions. Goals are validated by campaigns.test.ts —
// a scripted build strategy must be able to win each one within its day limit —
// and by difficulty.test.ts, which is the stricter bar: active play has to beat
// building once and walking away.
//
// P16: every number below was set by measurement, not by feel. See §11 of
// docs/superpowers/specs/2026-08-19-difficulty-curve-solvency-design.md for
// what each one is answering. Changing one in isolation will break a guard.

import { OPEN_TRAFFIC, type TrafficProfile } from '../traffic';
import type { Goal } from './goals';

export interface CampaignDef {
  id: string;
  name: string;
  tagline: string;
  startingCash: number;
  goalDailyProfit: number;
  /** The goal must be reached by the end of this day (day 1 is a half day). */
  dayLimit: number;
  /** Placeable object ids; omitted = everything is allowed. */
  allowedObjects?: readonly string[];
  /** B7: why the rest is off-limits, in the player's words, for the palette. */
  restriction?: string;
  /** P16: how many closed days the goal is averaged over. The run is won when
   *  the mean of the last N days reaches goalDailyProfit, so a steady casino
   *  beats a lucky one — "N days running" rewarded the coin, not the operator.
   *  1 degenerates to the single-peak-day rule that shipped before P16. */
  goalWindowDays: number;
  /** P16: how far below zero this campaign may run before forced sales. */
  creditLimit: number;
  /** v2: free play — no goal, no clock, money is no object. */
  sandbox?: boolean;
  /** v2: the lot the floor plan is built on, in cells (Session 3's FloorPlan
   *  reads it). Omitted = the default 40×30 lot. */
  lot?: { cols: number; rows: number };
  /** B3: how guests arrive. Omitted = CAMPAIGN_TRAFFIC, the flat rate and
   *  fixed cap the campaigns below were tuned on. */
  traffic?: TrafficProfile;
  /** B4: the most the bank will have out on loan at once. Omitted =
   *  LOANS.defaultLimit. */
  loanLimit?: number;
  /** B8: what wins the run, all at one close. Omitted = the P16 rule:
   *  average goalDailyProfit over goalWindowDays (see goalsOf). */
  goals?: readonly Goal[];
  /** B8: win by these days for silver and gold; any win is bronze. */
  medals?: { silver: number; gold: number };
  /** B8: the scenario that must be won first. Omitted = open from the start. */
  unlockAfter?: string;
  /** B8: objects that unlock everywhere once this scenario is won. */
  unlocks?: readonly string[];
  /** B8: the run opens owing this to the bank (already in startingCash). */
  startingLoan?: { amount: number; days: number };
}

/** The goals a scenario is judged on: its own list, or the P16 profit rule. */
export function goalsOf(def: CampaignDef): readonly Goal[] {
  return (
    def.goals ?? [{ kind: 'avgProfit', amount: def.goalDailyProfit, days: def.goalWindowDays }]
  );
}

export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    id: 'dusty-dime',
    name: 'The Dusty Dime',
    tagline: 'A dusty roadside hall with one working outlet. Prove it can pay.',
    // P16 — was $2000 / $600 / 3 days, which let a do-nothing build sneak a
    // win. The goal figure was never the problem: at $2000 a greedy player can
    // afford roughly what `minimal` builds and then stops, so the two produced
    // near-identical casinos and their profit distributions overlapped. No goal
    // separates distributions that sit on top of each other.
    //
    // Starting cash is the lever, because `minimal` stops building once its
    // opening set is down and simply banks the rest — every extra dollar goes
    // to the player who keeps playing. At $3000, build-and-walk-away wins none
    // of the seven seeds and a straightforward build-out wins six. The 4-day
    // window is the anti-luck half: this is the hall where you prove the place
    // runs, not that it had one good night.
    //
    // v2: the goal rose to $1000 when the tables started dealing real
    // blackjack. A single table now earns enough that build-and-abandon's best
    // four-day average reached $864 at a $700 goal; greedy's winners average
    // $1400+ and its losers are early spirals well short of either figure, so
    // $1000 sits in the gap (measured over the seven tournament seeds).
    //
    // v2, after the guest brain landed: $3000 → $4000. Guests that score games
    // and walk at stop-loss or win-goal make the opening blackjack table's
    // first days swingier, and at $3000 two of greedy's seven seeds went
    // insolvent before the slots were bought (3/7 wins). At $4000 greedy wins
    // 7/7 (worst four-day average $1798), managed 7/7 against reckless 6/7,
    // and build-and-abandon still tops out at $749 — it banks the extra cash
    // rather than spending it, so the lever moves only the players who play.
    startingCash: 4000,
    goalDailyProfit: 1000,
    dayLimit: 12,
    goalWindowDays: 4,
    creditLimit: 1000,
    // B4: a bank loan of up to half the starting stake; the greedy probe never
    // borrows, and a loan costs 1.5–2.5% a day, so the goals stand.
    loanLimit: 2000,
    unlocks: ['roulette-table', 'keno-lounge', 'marquee'],
  },
  {
    id: 'neon-nights',
    name: 'Neon Nights',
    tagline: 'A strip-corner lease and impatient backers. Scale it fast.',
    startingCash: 3500,
    goalDailyProfit: 1000,
    dayLimit: 11,
    goalWindowDays: 3,
    creditLimit: 1000,
    // B4: a bank loan of up to half the starting stake; the greedy probe never
    // borrows, and a loan costs 1.5–2.5% a day, so the goals stand.
    loanLimit: 1750,
    unlockAfter: 'lucky-strike',
    unlocks: ['craps-table', 'sic-bo'],
  },
  {
    id: 'high-roller',
    name: 'The High Roller Club',
    tagline: 'Members only, tables only. Slots would cheapen the carpet.',
    restriction: 'Members play blackjack here: no slots, wheels or dice on this carpet.',
    // v2: $700 → $1000 for the same reason as the Dusty Dime: real blackjack
    // let a single never-touched table average up to $871; greedy's floor of
    // staffed tables never averaged under $1025 on any seed.
    startingCash: 5000,
    goalDailyProfit: 1000,
    dayLimit: 10,
    goalWindowDays: 3,
    creditLimit: 800,
    // B4: a bank loan of up to half the starting stake; the greedy probe never
    // borrows, and a loan costs 1.5–2.5% a day, so the goals stand.
    loanLimit: 2500,
    allowedObjects: ['blackjack-table', 'toilet', 'food-stall', 'plant'],
    unlockAfter: 'neon-nights',
    unlocks: ['high-limit-table', 'poker-table'],
  },
];

/**
 * v2 Sandbox: effectively unlimited cash and credit, every object allowed, and
 * no goal or day limit — the run starts 'endless'. Kept out of CAMPAIGNS
 * because every campaign there is a goal the tournament must be able to win.
 */
export const SANDBOX: CampaignDef = {
  id: 'sandbox',
  name: 'Sandbox',
  tagline: 'Unlimited bankroll. Build the casino you want to walk around in.',
  startingCash: 100_000_000,
  goalDailyProfit: 0,
  dayLimit: 1_000_000,
  goalWindowDays: 1,
  creditLimit: 100_000_000,
  sandbox: true,
  // SPEC §9.7: room for 2,000 objects and 500 guests.
  lot: { cols: 96, rows: 64 },
  // B3: the daily rhythm, and a cap that grows with the floor up to 500.
  traffic: OPEN_TRAFFIC,
};

/**
 * B8: the scenarios the career adds. Each has its own lot and starter shell
 * (sim/floor/starter.ts), B3's daily traffic, and goals that ask for
 * something other than a daily average. Every one is pinned by
 * career.test.ts: the career bot wins it with a reasonable plan, and building
 * once and walking away never does, on the grid and on the real crowd.
 */
export const CAREER_SCENARIOS: readonly CampaignDef[] = [
  {
    id: 'lucky-strike',
    unlockAfter: 'dusty-dime',
    unlocks: ['pachinko', 'bingo-hall'],
    name: 'Lucky Strike Lanes',
    tagline: 'A bowling alley with the pins pulled up. Fill it with people.',
    startingCash: 6000,
    goalDailyProfit: 0,
    dayLimit: 10,
    goalWindowDays: 1,
    creditLimit: 1000,
    loanLimit: 3000,
    lot: { cols: 32, rows: 24 },
    traffic: OPEN_TRAFFIC,
    medals: { gold: 4, silver: 6 },
    goals: [
      { kind: 'guests', count: 50 },
      { kind: 'rating', min: 70 },
    ],
  },
  {
    id: 'velvet-rope',
    unlockAfter: 'high-roller',
    unlocks: ['three-card-poker'],
    name: 'The Velvet Rope',
    tagline: 'A club for people who expect to be remembered. Remember them.',
    startingCash: 8000,
    goalDailyProfit: 0,
    dayLimit: 14,
    goalWindowDays: 1,
    creditLimit: 1500,
    loanLimit: 4000,
    traffic: OPEN_TRAFFIC,
    medals: { gold: 8, silver: 11 },
    goals: [
      { kind: 'patrons', tier: 'silver', count: 6 },
      { kind: 'avgProfit', amount: 800, days: 2 },
    ],
  },
  {
    id: 'house-rules',
    unlockAfter: 'velvet-rope',
    unlocks: ['pai-gow'],
    name: 'House Rules',
    tagline: 'The gaming board wants a fair house, and the books say busy.',
    restriction: 'An arcade licence: machines and draw games only, no dealt tables.',
    startingCash: 7000,
    goalDailyProfit: 0,
    dayLimit: 12,
    goalWindowDays: 1,
    creditLimit: 1500,
    loanLimit: 3500,
    lot: { cols: 36, rows: 26 },
    traffic: OPEN_TRAFFIC,
    allowedObjects: [
      'slot-machine',
      'penny-slots',
      'video-poker',
      'pachinko',
      'keno-lounge',
      'bingo-hall',
      'toilet',
      'food-stall',
      'bar',
      'cage',
      'plant',
      'neon-sign',
      'marquee',
    ],
    medals: { gold: 4, silver: 7 },
    goals: [
      { kind: 'hold', min: 0.04, max: 0.08, days: 3, minHandle: 12000 },
      { kind: 'avgProfit', amount: 400, days: 3 },
    ],
  },
  {
    id: 'the-salon',
    unlockAfter: 'house-rules',
    name: 'The Salon',
    tagline: 'An empty marble room upstairs. Make it worth the walk.',
    startingCash: 9000,
    goalDailyProfit: 0,
    dayLimit: 12,
    goalWindowDays: 1,
    creditLimit: 2000,
    loanLimit: 5000,
    lot: { cols: 48, rows: 32 },
    traffic: OPEN_TRAFFIC,
    medals: { gold: 6, silver: 9 },
    goals: [
      { kind: 'highLimit', games: 4 },
      { kind: 'dayProfit', amount: 2000 },
    ],
  },
  {
    id: 'clean-slate',
    unlockAfter: 'the-salon',
    name: 'Clean Slate',
    tagline: 'You bought the place with the bank’s money. Give it back.',
    startingCash: 8000,
    goalDailyProfit: 0,
    dayLimit: 14,
    goalWindowDays: 1,
    creditLimit: 2000,
    loanLimit: 8000,
    traffic: OPEN_TRAFFIC,
    startingLoan: { amount: 6000, days: 28 },
    medals: { gold: 8, silver: 11 },
    goals: [{ kind: 'noDebt' }, { kind: 'avgProfit', amount: 700, days: 3 }],
  },
  {
    id: 'the-strip',
    unlockAfter: 'clean-slate',
    name: 'The Strip',
    tagline: 'The flagship. Biggest floor, brightest lights, no excuses.',
    startingCash: 15000,
    goalDailyProfit: 0,
    dayLimit: 14,
    goalWindowDays: 1,
    creditLimit: 3000,
    loanLimit: 10000,
    lot: { cols: 64, rows: 44 },
    traffic: OPEN_TRAFFIC,
    medals: { gold: 5, silver: 8 },
    goals: [
      { kind: 'guests', count: 150 },
      { kind: 'rating', min: 75 },
      { kind: 'dayProfit', amount: 2500 },
    ],
  },
];

const byId = (id: string) => [...CAMPAIGNS, ...CAREER_SCENARIOS].find((c) => c.id === id)!;

/**
 * B8: the career in the order it is played. The three P16 campaigns keep
 * their goals and tuning (the tournament in strategies.ts pins them); the
 * new scenarios sit between them so the goals vary as they rise.
 */
export const CAREER: readonly CampaignDef[] = [
  'dusty-dime',
  'lucky-strike',
  'neon-nights',
  'high-roller',
  'velvet-rope',
  'house-rules',
  'the-salon',
  'clean-slate',
  'the-strip',
].map(byId);

/** Everything the scenario picker offers: the career, then Sandbox. */
export const SCENARIOS: readonly CampaignDef[] = [...CAREER, SANDBOX];

const BY_ID = new Map(SCENARIOS.map((c) => [c.id, c]));

export function getCampaign(id: string): CampaignDef | undefined {
  return BY_ID.get(id);
}
