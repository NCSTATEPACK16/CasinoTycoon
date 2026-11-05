import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import {
  KENO_GUEST_MIX,
  KENO_PAYTABLES,
  KENO_SPOTS,
  catchProbability,
  kenoEngine,
  kenoReturn,
  kenoRoundFromDraw,
  kenoSpotEdge,
  type KenoRules,
} from './keno';

const rules: KenoRules = kenoEngine.defaultRules();

describe('keno exact edges', () => {
  it('the hypergeometric catch odds sum to one and match known values', () => {
    for (const n of KENO_SPOTS) {
      let p = 0;
      for (let k = 0; k <= n; k++) p += catchProbability(n, k);
      expect(p).toBeCloseTo(1, 12);
    }
    // 1-spot: 20 of 80 drawn. 4-spot catch-all: 1 in 326.4. 10-spot catch-all:
    // 1 in 8,911,711 (Wizard of Odds, "Keno": probability tables).
    expect(catchProbability(1, 1)).toBeCloseTo(0.25, 12);
    expect(1 / catchProbability(4, 4)).toBeCloseTo(326.44, 1);
    expect(1 / catchProbability(10, 10)).toBeCloseTo(8_911_711, -1);
  });

  it('a 1-spot paying 3 for 1 returns exactly 75%', () => {
    // The live-keno 1-spot (Wizard of Odds: 3 for 1 is the usual pay, 75%).
    expect(kenoReturn('standard', 1)).toBeCloseTo(0.75, 12);
  });

  it('every standard ticket sits in the live-keno range (65–80% return)', () => {
    // Wizard of Odds' 2001 Las Vegas survey: live keno returned 65% to 80%.
    for (const n of KENO_SPOTS) {
      expect(kenoReturn('standard', n), `${n}-spot`).toBeGreaterThan(0.7);
      expect(kenoReturn('standard', n), `${n}-spot`).toBeLessThan(0.8);
    }
  });

  it('generous beats standard beats tight on every ticket', () => {
    for (const n of KENO_SPOTS) {
      expect(kenoReturn('generous', n)).toBeGreaterThan(kenoReturn('standard', n));
      expect(kenoReturn('standard', n)).toBeGreaterThan(kenoReturn('tight', n));
    }
  });

  it('the guest mix blends to about a 26% edge, and the lever moves it', () => {
    expect(Object.values(KENO_GUEST_MIX).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const e = kenoEngine.theoreticalEdge(rules);
    expect(e).toBeGreaterThan(0.25);
    expect(e).toBeLessThan(0.28);
    const g = kenoEngine.validateRules({ paytable: 'generous' }).rules;
    const t = kenoEngine.validateRules({ paytable: 'tight' }).rules;
    expect(kenoEngine.theoreticalEdge(g)).toBeLessThan(e);
    expect(kenoEngine.theoreticalEdge(t)).toBeGreaterThan(e);
    expect(kenoEngine.appeal(g)).toBeGreaterThan(kenoEngine.appeal(rules));
    expect(kenoEngine.appeal(t)).toBeLessThan(kenoEngine.appeal(rules));
    expect(kenoSpotEdge(rules, 'spot:1')).toBeCloseTo(0.25, 12);
    expect(kenoSpotEdge(rules, 'nonsense')).toBe(0);
  });

  it('a 2M-ticket Monte Carlo of the guest mix lands on the exact edge', () => {
    const rng = new Rng(0x6e0);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 2_000_000; i++) {
      const bets = kenoEngine.guestBets(rules, 1, rng);
      const r = kenoEngine.begin(rng, rules, bets);
      r.act('draw');
      const res = r.result()!;
      wagered += res.wagered;
      returned += res.returned;
    }
    // Per-ticket SD is ~10 units on the mix (the 8- and 10-spot tops), so the
    // standard error over 2M tickets is ~0.7 points: hold the run to 2 points.
    expect(Math.abs(1 - returned / wagered - kenoEngine.theoreticalEdge(rules))).toBeLessThan(0.02);
  }, 120_000);
});

describe('keno rounds', () => {
  it('pays by catches from the ticket’s own table', () => {
    const drawn = Array.from({ length: 20 }, (_, i) => i + 1);
    const four = kenoRoundFromDraw(rules, [{ spot: 'spot:4', amount: 2 }], [[1, 2, 3, 50]], drawn);
    expect(four.options()).toEqual(['draw']);
    four.act('draw');
    const r = four.result()!;
    expect(r.wagered).toBe(2);
    expect(r.returned).toBe(2 * KENO_PAYTABLES.standard[4][3]!);
    expect(r.detail).toEqual({ picks: [1, 2, 3, 50], drawn, hits: 3 });
    expect(four.options()).toBeNull();

    const miss = kenoRoundFromDraw(rules, [{ spot: 'spot:1', amount: 5 }], [[80]], drawn);
    miss.act('draw');
    expect(miss.result()!.returned).toBe(0);
  });

  it('deals the same tickets and draw for the same seed', () => {
    const play = () => {
      const rng = new Rng(9);
      const r = kenoEngine.begin(rng, rules, kenoEngine.guestBets(rules, 3, rng));
      r.act('draw');
      return r.result()!.detail;
    };
    expect(play()).toEqual(play());
  });

  it('draws 20 distinct numbers and marks distinct picks', () => {
    const rng = new Rng(3);
    const r = kenoEngine.begin(rng, rules, [{ spot: 'spot:10', amount: 1 }]);
    r.act('draw');
    const d = r.result()!.detail as { picks: number[]; drawn: number[] };
    expect(new Set(d.drawn).size).toBe(20);
    expect(new Set(d.picks).size).toBe(10);
    for (const x of [...d.drawn, ...d.picks]) expect(x >= 1 && x <= 80).toBe(true);
  });

  it('validates the paytable lever', () => {
    expect(kenoEngine.validateRules({ paytable: 'wild' }).issues).toHaveLength(1);
    expect(kenoEngine.validateRules({ paytable: 'tight' }).rules.paytable).toBe('tight');
  });
});
