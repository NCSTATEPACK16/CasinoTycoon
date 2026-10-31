import { describe, expect, it } from 'vitest';
import { evaluateGoal, goalText, windowDays, type GoalFacts } from './goals';

const facts = (over: Partial<GoalFacts> = {}): GoalFacts => ({
  profits: [],
  bestDailyProfit: null,
  play: [],
  peakGuests: 0,
  rating: 50,
  patrons: { silver: 0, gold: 0, black: 0 },
  highLimitGames: 0,
  debt: 0,
  cash: 1000,
  ...over,
});

describe('B8 goals', () => {
  it('averages profit only over a full window', () => {
    const g = { kind: 'avgProfit', amount: 1000, days: 3 } as const;
    expect(evaluateGoal(g, facts({ profits: [3000, 3000] })).met).toBe(false);
    const part = evaluateGoal(g, facts({ profits: [3000, 3000] }));
    expect(part.fraction).toBeCloseTo(2 / 3);
    expect(evaluateGoal(g, facts({ profits: [0, 1500, 1500] })).met).toBe(true);
    // Only the last `days` count.
    expect(evaluateGoal(g, facts({ profits: [-9000, 1000, 1000, 1000] })).met).toBe(true);
    expect(evaluateGoal(g, facts({ profits: [1000, 1000, 999] })).met).toBe(false);
  });

  it('keeps records (one big day, a crowd at once) and judges states at the close', () => {
    expect(
      evaluateGoal({ kind: 'dayProfit', amount: 2000 }, facts({ bestDailyProfit: 2000 })).met,
    ).toBe(true);
    expect(
      evaluateGoal({ kind: 'dayProfit', amount: 2000 }, facts({ bestDailyProfit: 1999 })).met,
    ).toBe(false);
    expect(evaluateGoal({ kind: 'guests', count: 60 }, facts({ peakGuests: 60 })).met).toBe(true);
    expect(evaluateGoal({ kind: 'rating', min: 70 }, facts({ rating: 69.9 })).met).toBe(false);
    expect(evaluateGoal({ kind: 'rating', min: 70 }, facts({ rating: 70 })).met).toBe(true);
    expect(evaluateGoal({ kind: 'highLimit', games: 4 }, facts({ highLimitGames: 3 })).met).toBe(
      false,
    );
  });

  it('counts club members at a tier or above', () => {
    const p = { silver: 7, gold: 2, black: 1 };
    expect(
      evaluateGoal({ kind: 'patrons', tier: 'silver', count: 6 }, facts({ patrons: p })).met,
    ).toBe(true);
    expect(
      evaluateGoal({ kind: 'patrons', tier: 'gold', count: 3 }, facts({ patrons: p })).met,
    ).toBe(false);
    expect(goalText({ kind: 'patrons', tier: 'silver', count: 6 })).toBe('Sign 6 club members');
  });

  it('wants no loan and no overdraft for "no debt"', () => {
    const g = { kind: 'noDebt' } as const;
    expect(evaluateGoal(g, facts({ debt: 0, cash: 0 })).met).toBe(true);
    expect(evaluateGoal(g, facts({ debt: 250, cash: 5000 })).met).toBe(false);
    expect(evaluateGoal(g, facts({ debt: 0, cash: -1 })).met).toBe(false);
    expect(evaluateGoal(g, facts({ debt: 250, cash: -100 })).progress).toBe('$350 owed');
  });

  it('pools hold over the window and needs the floor busy', () => {
    const g = { kind: 'hold', min: 0.04, max: 0.08, days: 2, minHandle: 1000 } as const;
    // 100 + 60 on 2000 + 2000 = 4% exactly: in the band.
    const ok = facts({
      play: [
        { handle: 2000, win: 100 },
        { handle: 2000, win: 60 },
      ],
    });
    expect(evaluateGoal(g, ok).met).toBe(true);
    const tight = facts({
      play: [
        { handle: 2000, win: 300 },
        { handle: 2000, win: 300 },
      ],
    });
    expect(evaluateGoal(g, tight).met).toBe(false);
    const quiet = facts({
      play: [
        { handle: 500, win: 30 },
        { handle: 500, win: 30 },
      ],
    });
    expect(evaluateGoal(g, quiet).met).toBe(false);
    expect(evaluateGoal(g, quiet).progress).toContain('$500 wagered a day');
    expect(evaluateGoal(g, facts({ play: [{ handle: 2000, win: 100 }] })).met).toBe(false);
  });

  it('keeps as many days as the longest window needs', () => {
    expect(windowDays([{ kind: 'noDebt' }])).toBe(1);
    expect(
      windowDays([
        { kind: 'avgProfit', amount: 1, days: 3 },
        { kind: 'hold', min: 0, max: 1, days: 5, minHandle: 0 },
      ]),
    ).toBe(5);
  });
});
