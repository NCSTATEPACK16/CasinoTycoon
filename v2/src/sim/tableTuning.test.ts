import { describe, expect, it } from 'vitest';
import { TABLE_MINIMUMS } from '../data/balance';
import { tierForCrowd } from './tableTuning';

/**
 * P16 — the one repeating decision that costs no capital.
 *
 * Every other choice in the game is where to put money: what to build, how
 * much to hold back, whether to borrow. Six of the seven tournament bots are
 * capital-deployment policies and the seventh is too, which is why the harness
 * could measure "spending well" but never "playing well".
 *
 * A table minimum is not a purchase. It is set each morning against the crowd
 * the day's conditions have already announced — a convention brings high
 * rollers who will clear a richer gate, a bus junket brings tourists who will
 * not — and it can be got wrong in both directions.
 */
const TIERS = TABLE_MINIMUMS.tiers;

describe('tierForCrowd', () => {
  it('leaves the table where it is on an ordinary day', () => {
    expect(tierForCrowd(25, 1, 1)).toBe(25);
  });

  it('reaches up a rung when the crowd is rich', () => {
    expect(tierForCrowd(25, 3, 1)).toBe(50);
  });

  it('drops a rung when the crowd is broke', () => {
    expect(tierForCrowd(25, 1, 0.7)).toBe(10);
  });

  it('reads a slightly-rich but thin-walleted crowd as ordinary', () => {
    // A mild bias toward money that the day's wallets cancel out is not a
    // reason to touch the dial in either direction.
    expect(tierForCrowd(25, 1.4, 0.7)).toBe(25);
  });

  it('drops the gate on a bus junket, which brings heads and not money', () => {
    // The junket biases *tourists*, so the high-roller bias stays at 1 and only
    // walletMult moves. Reading the head count instead — plenty of arrivals,
    // therefore raise the gate — is the expensive mistake this decision exists
    // to let a player make, and the reason the two signals multiply.
    const junketWalletMult = 0.85;
    expect(tierForCrowd(25, 1, junketWalletMult)).toBe(10);
  });

  it('never walks off either end of the ladder', () => {
    const lowest = TIERS[0]!;
    const highest = TIERS[TIERS.length - 1]!;
    expect(tierForCrowd(lowest, 1, 0.1)).toBe(lowest);
    expect(tierForCrowd(highest, 10, 1)).toBe(highest);
  });

  it('only ever answers with a real rung of the ladder', () => {
    for (const tier of TIERS) {
      for (const bias of [0.5, 1, 1.4, 3]) {
        for (const wallet of [0.7, 0.85, 1]) {
          expect(TIERS).toContain(tierForCrowd(tier, bias, wallet));
        }
      }
    }
  });
});
