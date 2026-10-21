import { describe, expect, it } from 'vitest';
import { DEBT } from '../data/balance';
import { interestFor, pickLiquidation, type LiquidationCandidate } from './solvency';

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

function candidate(over: Partial<LiquidationCandidate> = {}): LiquidationCandidate {
  return {
    id: over.id ?? 'o-1',
    defId: over.defId ?? 'slot-machine',
    isDecor: over.isDecor ?? false,
    isLastOfService: over.isLastOfService ?? false,
    isLastRevenueObject: over.isLastRevenueObject ?? false,
    trailingNet: over.trailingNet ?? 100,
    refund: over.refund ?? 250,
  };
}

describe('choosing what the house liquidates', () => {
  it('takes decor before anything that earns', () => {
    const decor = candidate({ id: 'plant', defId: 'plant', isDecor: true, trailingNet: 0 });
    const slot = candidate({ id: 'slot', trailingNet: -500 });
    expect(pickLiquidation([slot, decor])!.id).toBe('plant');
  });

  it('takes the weakest earner once the decor is gone', () => {
    const weak = candidate({ id: 'weak', trailingNet: 5 });
    const strong = candidate({ id: 'strong', trailingNet: 900 });
    expect(pickLiquidation([strong, weak])!.id).toBe('weak');
  });

  it('never takes the last unit of a service guests depend on', () => {
    const toilet = candidate({ id: 'wc', defId: 'toilet', isLastOfService: true, trailingNet: 0 });
    expect(pickLiquidation([toilet])).toBeNull();
  });

  it('never takes the last revenue object', () => {
    // Selling the floor out from under the player converts a setback into an
    // unrecoverable state, which is the outcome this whole mechanic may not have.
    const only = candidate({ id: 'only', isLastRevenueObject: true, trailingNet: -900 });
    expect(pickLiquidation([only])).toBeNull();
  });

  it('returns null when there is nothing left it is allowed to sell', () => {
    expect(pickLiquidation([])).toBeNull();
  });

  it('breaks a tie on id, so the choice is deterministic', () => {
    const a = candidate({ id: 'a', trailingNet: 10 });
    const b = candidate({ id: 'b', trailingNet: 10 });
    expect(pickLiquidation([b, a])!.id).toBe('a');
    expect(pickLiquidation([a, b])!.id).toBe('a');
  });
});
