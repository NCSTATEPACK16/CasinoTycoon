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
