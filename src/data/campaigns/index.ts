// Campaign scenario definitions. Goals are validated by campaigns.test.ts —
// a scripted build strategy must be able to win each one within its day limit.

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
}

export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    id: 'dusty-dime',
    name: 'The Dusty Dime',
    tagline: 'A dusty roadside hall with one working outlet. Prove it can pay.',
    startingCash: 2000,
    goalDailyProfit: 350,
    dayLimit: 3,
  },
  {
    id: 'neon-nights',
    name: 'Neon Nights',
    tagline: 'A strip-corner lease and impatient backers. Scale it fast.',
    startingCash: 3500,
    goalDailyProfit: 1000,
    dayLimit: 5,
  },
  {
    id: 'high-roller',
    name: 'The High Roller Club',
    tagline: 'Members only, tables only. Slots would cheapen the carpet.',
    startingCash: 5000,
    goalDailyProfit: 1400,
    dayLimit: 6,
    allowedObjects: ['blackjack-table', 'toilet', 'food-stall', 'plant'],
  },
];

const BY_ID = new Map(CAMPAIGNS.map((c) => [c.id, c]));

export function getCampaign(id: string): CampaignDef | undefined {
  return BY_ID.get(id);
}
