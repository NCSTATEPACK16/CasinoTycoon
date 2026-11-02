import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import {
  BALLS_PER_CUP,
  PACHINKO_NAILS,
  PACHINKO_SPECS,
  pachinkoEngine,
  pachinkoPayback,
  pachinkoRoundFrom,
  startChance,
  type PachinkoNails,
  type PachinkoRules,
  type PachinkoSpec,
} from './pachinko';

const rules: PachinkoRules = pachinkoEngine.defaultRules();
const SPECS = Object.keys(PACHINKO_SPECS) as PachinkoSpec[];
const NAILS = Object.keys(PACHINKO_NAILS) as PachinkoNails[];

describe('pachinko par sheet', () => {
  it('the nails set the payback exactly on every spec', () => {
    for (const spec of SPECS)
      for (const nails of NAILS) {
        expect(pachinkoPayback({ spec, nails })).toBeCloseTo(PACHINKO_NAILS[nails], 12);
        // A start pocket a ball can actually find: a few percent of balls,
        // as in a real hall (about one start per 12–16 balls).
        const p = startChance({ spec, nails });
        expect(p).toBeGreaterThan(0.04);
        expect(p).toBeLessThan(0.1);
      }
    expect(pachinkoEngine.theoreticalEdge(rules)).toBeCloseTo(0.12, 12);
  });

  it('looser nails pay more and draw more; the spec changes swing, not edge', () => {
    const loose = pachinkoEngine.validateRules({ nails: 'loose' }).rules;
    const tight = pachinkoEngine.validateRules({ nails: 'tight' }).rules;
    expect(pachinkoEngine.theoreticalEdge(loose)).toBeCloseTo(0.09, 12);
    expect(pachinkoEngine.theoreticalEdge(tight)).toBeCloseTo(0.15, 12);
    expect(pachinkoEngine.appeal(loose)).toBeGreaterThan(pachinkoEngine.appeal(rules));
    expect(pachinkoEngine.appeal(tight)).toBeLessThan(pachinkoEngine.appeal(rules));
    const max = pachinkoEngine.validateRules({ spec: 'max' }).rules;
    expect(pachinkoEngine.theoreticalEdge(max)).toBeCloseTo(0.12, 12);
  });

  it.each(SPECS)(
    'a 2M-cup Monte Carlo of the %s spec lands on the model',
    (spec) => {
      const r = pachinkoEngine.validateRules({ spec }).rules;
      const rng = new Rng(0x9ac + spec.length);
      let wagered = 0;
      let returned = 0;
      let hits = 0;
      const N = 2_000_000;
      for (let i = 0; i < N; i++) {
        const round = pachinkoEngine.begin(rng, r, [{ spot: 'main', amount: 1 }]);
        round.act('shoot');
        const res = round.result()!;
        wagered += res.wagered;
        returned += res.returned;
        if (res.returned > 0) hits++;
      }
      // Per-cup SD: about 3.5 cups on sweet, 9 on max (the 1-in-319 rush). The
      // tolerance is 3 standard errors at 2M cups.
      const s = PACHINKO_SPECS[spec];
      const perJackpot = s.jackpotBalls / BALLS_PER_CUP;
      const sd = Math.sqrt(hits / N) * perJackpot * Math.sqrt((1 + s.rush) / (1 - s.rush) ** 2);
      expect(Math.abs(returned / wagered - 0.88)).toBeLessThan((3 * sd) / Math.sqrt(N));
      // The cup's chance of any jackpot: 1 − (1 − pStart·pJackpot)^balls.
      const pHit = 1 - (1 - startChance(r) * s.pJackpot) ** BALLS_PER_CUP;
      expect(Math.abs(hits / N - pHit)).toBeLessThan(4 * Math.sqrt((pHit * (1 - pHit)) / N));
    },
    120_000,
  );
});

describe('pachinko cups', () => {
  it('pays jackpots by the ball at the cup’s price', () => {
    const none = pachinkoRoundFrom(rules, 5, 9, 0);
    expect(none.options()).toEqual(['shoot']);
    none.act('shoot');
    expect(none.result()!.returned).toBe(0);
    expect(none.result()!.detail).toEqual({ balls: 125, starts: 9, jackpot: false, payout: 0 });

    const rush = pachinkoRoundFrom(rules, 5, 11, 3);
    rush.act('shoot');
    expect(rush.result()!.returned).toBeCloseTo((5 * 3 * 500) / 125, 9);
    expect(rush.options()).toBeNull();
  });

  it('shoots the same cup for the same seed', () => {
    const play = () => {
      const r = pachinkoEngine.begin(new Rng(4), rules, [{ spot: 'main', amount: 5 }]);
      r.act('shoot');
      return r.result()!.detail;
    };
    expect(play()).toEqual(play());
  });
});
