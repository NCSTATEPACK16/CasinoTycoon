import { SCORE_BALANCE } from './balance';

export interface ScoreInput {
  profit: number;
  goalDailyProfit: number;
  day: number;
  dayLimit: number;
  rating: number;
}

/** profit-vs-goal ratio × day-efficiency × final rating, composited into one
 * leaderboard-ranking number. Higher is better. */
export function computeCampaignScore(input: ScoreInput): number {
  const b = SCORE_BALANCE;
  const profitRatio = input.goalDailyProfit > 0 ? input.profit / input.goalDailyProfit : 1;
  // Day 1 of dayLimit → full credit; the last allowed day → the configured floor.
  const dayFrac = input.dayLimit > 1 ? (input.dayLimit - input.day) / (input.dayLimit - 1) : 1;
  const dayEfficiency = b.dayEfficiencyFloor + (1 - b.dayEfficiencyFloor) * Math.max(0, dayFrac);
  const ratingFactor = 1 + input.rating * b.ratingWeight;
  return Math.max(0, Math.round(b.baseMultiplier * profitRatio * dayEfficiency * ratingFactor));
}

/** B8: bronze for any win, silver and gold for winning sooner. */
export type Medal = 'bronze' | 'silver' | 'gold';

export const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };
export const MEDAL_GLYPH: Record<Medal, string> = { bronze: '🥉', silver: '🥈', gold: '🥇' };

/** The days a win must come by for silver and gold. A scenario names its own
 *  (set from measured wins); the fallback is three quarters and half of the
 *  day limit. */
export function medalDays(def: { dayLimit: number; medals?: { silver: number; gold: number } }): {
  gold: number;
  silver: number;
  bronze: number;
} {
  return {
    gold: def.medals?.gold ?? Math.ceil(def.dayLimit * 0.5),
    silver: def.medals?.silver ?? Math.ceil(def.dayLimit * 0.75),
    bronze: def.dayLimit,
  };
}

/** The medal a win on `day` earns. */
export function medalFor(
  def: { dayLimit: number; medals?: { silver: number; gold: number } },
  day: number,
): Medal {
  const d = medalDays(def);
  return day <= d.gold ? 'gold' : day <= d.silver ? 'silver' : 'bronze';
}
