import { describe, expect, it } from 'vitest';
import { computeCampaignScore, medalDays, medalFor } from './score';

describe('computeCampaignScore', () => {
  it('rewards beating the goal by more than just reaching it', () => {
    const atGoal = computeCampaignScore({
      profit: 350,
      goalDailyProfit: 350,
      day: 3,
      dayLimit: 3,
      rating: 70,
    });
    const overGoal = computeCampaignScore({
      profit: 700,
      goalDailyProfit: 350,
      day: 3,
      dayLimit: 3,
      rating: 70,
    });
    expect(overGoal).toBeGreaterThan(atGoal);
  });

  it('rewards finishing earlier over finishing on the last allowed day', () => {
    const early = computeCampaignScore({
      profit: 350,
      goalDailyProfit: 350,
      day: 1,
      dayLimit: 3,
      rating: 70,
    });
    const late = computeCampaignScore({
      profit: 350,
      goalDailyProfit: 350,
      day: 3,
      dayLimit: 3,
      rating: 70,
    });
    expect(early).toBeGreaterThan(late);
  });

  it('rewards a higher final casino rating', () => {
    const lowRating = computeCampaignScore({
      profit: 350,
      goalDailyProfit: 350,
      day: 2,
      dayLimit: 3,
      rating: 40,
    });
    const highRating = computeCampaignScore({
      profit: 350,
      goalDailyProfit: 350,
      day: 2,
      dayLimit: 3,
      rating: 90,
    });
    expect(highRating).toBeGreaterThan(lowRating);
  });

  it('never returns a negative or non-finite score for reasonable inputs', () => {
    const score = computeCampaignScore({
      profit: 350,
      goalDailyProfit: 350,
      day: 3,
      dayLimit: 3,
      rating: 0,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe('B8 medals', () => {
  it('gives gold, silver and bronze by the day the run was won', () => {
    const def = { dayLimit: 12, medals: { gold: 5, silver: 8 } };
    expect(medalFor(def, 5)).toBe('gold');
    expect(medalFor(def, 6)).toBe('silver');
    expect(medalFor(def, 8)).toBe('silver');
    expect(medalFor(def, 12)).toBe('bronze');
  });

  it('falls back to half and three quarters of the day limit', () => {
    expect(medalDays({ dayLimit: 10 })).toEqual({ gold: 5, silver: 8, bronze: 10 });
  });
});
