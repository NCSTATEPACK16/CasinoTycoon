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
  /** P16: days *running* at or above goal needed to win. 1 is a single peak
   *  day — which is what shipped before P16 and is not enough on its own. */
  goalConsecutiveDays: number;
  /** P16: how far below zero this campaign may run before forced sales. */
  creditLimit: number;
}

export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    id: 'dusty-dime',
    name: 'The Dusty Dime',
    tagline: 'A dusty roadside hall with one working outlet. Prove it can pay.',
    startingCash: 2000,
    goalDailyProfit: 600,
    dayLimit: 12,
    goalConsecutiveDays: 2,
    creditLimit: 1000,
  },
  {
    id: 'neon-nights',
    name: 'Neon Nights',
    tagline: 'A strip-corner lease and impatient backers. Scale it fast.',
    startingCash: 3500,
    goalDailyProfit: 1000,
    dayLimit: 11,
    goalConsecutiveDays: 2,
    creditLimit: 1000,
  },
  {
    id: 'high-roller',
    name: 'The High Roller Club',
    tagline: 'Members only, tables only. Slots would cheapen the carpet.',
    startingCash: 5000,
    goalDailyProfit: 700,
    dayLimit: 10,
    goalConsecutiveDays: 2,
    creditLimit: 800,
    allowedObjects: ['blackjack-table', 'toilet', 'food-stall', 'plant'],
  },
];

const BY_ID = new Map(CAMPAIGNS.map((c) => [c.id, c]));

export function getCampaign(id: string): CampaignDef | undefined {
  return BY_ID.get(id);
}
