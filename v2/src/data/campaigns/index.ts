// Campaign scenario definitions. Goals are validated by campaigns.test.ts —
// a scripted build strategy must be able to win each one within its day limit —
// and by difficulty.test.ts, which is the stricter bar: active play has to beat
// building once and walking away.
//
// P16: every number below was set by measurement, not by feel. See §11 of
// docs/superpowers/specs/2026-08-19-difficulty-curve-solvency-design.md for
// what each one is answering. Changing one in isolation will break a guard.

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
  },
  {
    id: 'high-roller',
    name: 'The High Roller Club',
    tagline: 'Members only, tables only. Slots would cheapen the carpet.',
    // v2: $700 → $1000 for the same reason as the Dusty Dime: real blackjack
    // let a single never-touched table average up to $871; greedy's floor of
    // staffed tables never averaged under $1025 on any seed.
    startingCash: 5000,
    goalDailyProfit: 1000,
    dayLimit: 10,
    goalWindowDays: 3,
    creditLimit: 800,
    allowedObjects: ['blackjack-table', 'toilet', 'food-stall', 'plant'],
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
  lot: { cols: 64, rows: 48 },
};

/** Everything the scenario picker offers: the campaigns, then Sandbox. */
export const SCENARIOS: readonly CampaignDef[] = [...CAMPAIGNS, SANDBOX];

const BY_ID = new Map(SCENARIOS.map((c) => [c.id, c]));

export function getCampaign(id: string): CampaignDef | undefined {
  return BY_ID.get(id);
}
