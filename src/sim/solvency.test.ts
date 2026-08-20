import { describe, expect, it } from 'vitest';
import { DEBT } from '../data/balance';
import { interestFor } from './solvency';

describe('debt interest', () => {
  it('is charged only on a negative closing balance', () => {
    // Dipping under during the evening and recovering by close costs nothing.
    // That is the whole point: it is the first thing in the game that pays
    // the player for paying attention.
    expect(interestFor(0, 0.05)).toBe(0);
    expect(interestFor(1200, 0.05)).toBe(0);
  });

  it('scales with the size of the hole, rounded to whole dollars', () => {
    expect(interestFor(-2000, 0.05)).toBe(100);
    expect(interestFor(-333, 0.05)).toBe(17);
  });

  it('is never negative, whatever the rate', () => {
    expect(interestFor(-2000, 0)).toBe(0);
  });

  it('ships a rate and a default limit that balancing can reach', () => {
    expect(DEBT.dailyInterestRate).toBeGreaterThan(0);
    expect(DEBT.defaultCreditLimit).toBeGreaterThan(0);
  });
});
