import { describe, expect, it } from 'vitest';
import { parseCard } from '../cards';
import { categoryOf, evaluate, HandCategory } from './evaluator';

const hand = (s: string): number[] => s.split(' ').map(parseCard);

describe('evaluate', () => {
  it('orders the categories', () => {
    const ladder = [
      'As Kd 9c 7h 4s 3d 2c', // high card
      'As Ad 9c 7h 4s 3d 2c', // pair
      'As Ad 9c 9h 4s 3d 2c', // two pair
      'As Ad Ac 9h 4s 3d 2c', // trips
      'As Kd Qc Jh Ts 3d 2c', // straight
      'As Ks 9s 7s 4s 3d 2c', // flush
      'As Ad Ac 9h 9s 3d 2c', // full house
      'As Ad Ac Ah 9s 3d 2c', // quads
      'Ts 9s 8s 7s 6s 3d 2c', // straight flush
    ].map((h) => evaluate(hand(h)));
    ladder.forEach((s, i) => expect(categoryOf(s)).toBe(i));
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!).toBeGreaterThan(ladder[i - 1]!);
  });

  it('plays the wheel as a five-high straight, below six-high', () => {
    const wheel = evaluate(hand('As 2d 3c 4h 5s Kd 9c'));
    const six = evaluate(hand('6s 2d 3c 4h 5s Kd 9c'));
    expect(categoryOf(wheel)).toBe(HandCategory.Straight);
    expect(six).toBeGreaterThan(wheel);
  });

  it('ignores the sixth and seventh kickers', () => {
    // Both play A-A-K-Q-J; the 4 and 3 vs 8 and 7 never reach the hand.
    expect(evaluate(hand('As Ad Kc Qh Js 4d 3c'))).toBe(evaluate(hand('Ac Ah Kd Qs Jd 8c 7h')));
    // Two pair with a third pair: the best kicker may be the third pair's rank.
    expect(evaluate(hand('As Ad Kc Kh Qs Qd 2c'))).toBe(evaluate(hand('Ac Ah Kd Ks Qh 3c 2d')));
  });

  it('matches the known category counts over all 133,784,560 seven-card hands', () => {
    const tally = new Array<number>(9).fill(0);
    const c = new Uint8Array(7);
    for (c[0] = 0; c[0] < 46; c[0]++)
      for (c[1] = c[0] + 1; c[1] < 47; c[1]++)
        for (c[2] = c[1] + 1; c[2] < 48; c[2]++)
          for (c[3] = c[2] + 1; c[3] < 49; c[3]++)
            for (c[4] = c[3] + 1; c[4] < 50; c[4]++)
              for (c[5] = c[4] + 1; c[5] < 51; c[5]++)
                for (c[6] = c[5] + 1; c[6] < 52; c[6]++) tally[evaluate(c, 7) >> 20]!++;
    expect(tally).toEqual([
      23_294_460, 58_627_800, 31_433_400, 6_461_620, 6_180_020, 4_047_644, 3_473_184, 224_848,
      41_584,
    ]);
  }, 600_000);
});
