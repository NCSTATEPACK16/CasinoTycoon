import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import {
  TOTAL_PAYS,
  sicBoEngine,
  sicBoRoundFromDice,
  sicBoSpotEdge,
  spotWinnings,
  type SicBoRules,
} from './sicbo';

const rules: SicBoRules = sicBoEngine.defaultRules();

describe('sic bo exact edges', () => {
  // Published (Wizard of Odds, "Sic Bo"): small/big 2.78%, single number
  // 7.87% at 1-2-3:1, any triple 13.89% at 30:1, specific triple 16.2% at
  // 180:1, specific double 18.52% at 10:1, two-dice combination 16.67% at 5:1,
  // totals 4/17 15.28%, 5/16 13.89%, 6/15 16.67%, 7/14 9.72%, 8/13 12.5%,
  // 9/12 18.98%, 10/11 12.5% at the table in TOTAL_PAYS.
  const cases: [string, number][] = [
    ['small', 7 / 252],
    ['big', 7 / 252],
    ['single:3', 17 / 216],
    ['double:4', 40 / 216],
    ['triple:6', 1 - 181 / 216],
    ['anyTriple', 1 - 186 / 216],
    ['pair:2-5', 1 - 180 / 216],
    ['total:4', 1 - (3 * 61) / 216],
    ['total:5', 1 - (6 * 31) / 216],
    ['total:6', 1 - (10 * 18) / 216],
    ['total:7', 1 - (15 * 13) / 216],
    ['total:8', 1 - (21 * 9) / 216],
    ['total:9', 1 - (25 * 7) / 216],
    ['total:10', 1 - (27 * 7) / 216],
    ['total:11', 1 - (27 * 7) / 216],
    ['total:14', 1 - (15 * 13) / 216],
    ['total:17', 1 - (3 * 61) / 216],
  ];
  it.each(cases)('%s', (spot, edge) => {
    expect(sicBoSpotEdge(rules, spot)).toBeCloseTo(edge, 12);
  });

  it('small and big edges are 2.78% (7/252 of the stake, triples lose)', () => {
    expect(sicBoSpotEdge(rules, 'small')).toBeCloseTo(0.0278, 4);
  });

  it('every single number, double and triple share an edge', () => {
    for (let n = 1; n <= 6; n++) {
      expect(sicBoSpotEdge(rules, `single:${n}`)).toBeCloseTo(sicBoSpotEdge(rules, 'single:1'), 12);
      expect(sicBoSpotEdge(rules, `double:${n}`)).toBeCloseTo(sicBoSpotEdge(rules, 'double:1'), 12);
      expect(sicBoSpotEdge(rules, `triple:${n}`)).toBeCloseTo(sicBoSpotEdge(rules, 'triple:1'), 12);
    }
    expect(Object.keys(TOTAL_PAYS)).toHaveLength(14);
  });

  it('each lever changes its bet’s edge and nothing else', () => {
    const r150 = sicBoEngine.validateRules({ triple: 150 }).rules;
    expect(sicBoSpotEdge(r150, 'triple:3')).toBeCloseTo(1 - 151 / 216, 12);
    expect(sicBoSpotEdge(r150, 'small')).toBeCloseTo(sicBoSpotEdge(rules, 'small'), 12);
    const a24 = sicBoEngine.validateRules({ anyTriple: 24 }).rules;
    expect(sicBoSpotEdge(a24, 'anyTriple')).toBeCloseTo(1 - 150 / 216, 12);
    const s2 = sicBoEngine.validateRules({ singleTriple: 2 }).rules;
    expect(sicBoSpotEdge(s2, 'single:1')).toBeCloseTo(18 / 216, 12);
    expect(sicBoSpotEdge(s2, 'single:1')).toBeGreaterThan(sicBoSpotEdge(rules, 'single:1'));
    for (const l of [r150, a24, s2])
      expect(sicBoEngine.theoreticalEdge(l)).toBeGreaterThan(sicBoEngine.theoreticalEdge(rules));
    expect(sicBoEngine.appeal(r150)).toBeLessThan(sicBoEngine.appeal(rules));
  });

  it('the guest mix blends to a bit over 8%', () => {
    const e = sicBoEngine.theoreticalEdge(rules);
    expect(e).toBeGreaterThan(0.075);
    expect(e).toBeLessThan(0.09);
  });
});

describe('sic bo rounds', () => {
  const roll = (dice: number[], bets: { spot: string; amount: number }[]) => {
    const r = sicBoRoundFromDice(rules, bets, dice);
    expect(r.options()).toEqual(['roll']);
    r.act('roll');
    expect(r.options()).toBeNull();
    return r.result()!;
  };

  it('pays small and big 1:1 and loses both on a triple', () => {
    expect(roll([1, 2, 3], [{ spot: 'small', amount: 10 }]).returned).toBe(20);
    expect(roll([6, 5, 4], [{ spot: 'big', amount: 10 }]).returned).toBe(20);
    expect(roll([3, 3, 3], [{ spot: 'small', amount: 10 }]).returned).toBe(0);
    expect(roll([4, 4, 4], [{ spot: 'big', amount: 10 }]).returned).toBe(0);
    expect(roll([6, 6, 6], [{ spot: 'big', amount: 10 }]).returned).toBe(0);
  });

  it('pays singles 1:1, 2:1 and 3:1 by match count', () => {
    const bet = [{ spot: 'single:2', amount: 10 }];
    expect(roll([2, 5, 6], bet).returned).toBe(20);
    expect(roll([2, 2, 6], bet).returned).toBe(30);
    expect(roll([2, 2, 2], bet).returned).toBe(40);
    expect(roll([1, 5, 6], bet).returned).toBe(0);
  });

  it('pays doubles, triples, totals and pairs', () => {
    expect(roll([4, 4, 1], [{ spot: 'double:4', amount: 1 }]).returned).toBe(11);
    expect(roll([4, 4, 4], [{ spot: 'double:4', amount: 1 }]).returned).toBe(11);
    expect(roll([4, 4, 4], [{ spot: 'triple:4', amount: 1 }]).returned).toBe(181);
    expect(roll([4, 4, 4], [{ spot: 'anyTriple', amount: 1 }]).returned).toBe(31);
    expect(roll([4, 4, 4], [{ spot: 'total:12', amount: 1 }]).returned).toBe(7);
    expect(roll([1, 2, 6], [{ spot: 'pair:2-6', amount: 1 }]).returned).toBe(6);
    expect(roll([1, 2, 2], [{ spot: 'pair:2-6', amount: 1 }]).returned).toBe(0);
  });

  it('settles several bets on one roll and carries the dice', () => {
    const r = roll(
      [6, 5, 4],
      [
        { spot: 'big', amount: 10 },
        { spot: 'total:15', amount: 2 },
      ],
    );
    expect(r.wagered).toBe(12);
    expect(r.returned).toBe(20 + 2 * 18);
    expect(r.detail).toMatchObject({ dice: [6, 5, 4], total: 15, triple: false });
  });

  it('unknown spots lose', () => {
    expect(spotWinnings(rules, 'bogus', [1, 2, 3])).toBe(-1);
  });
});

describe('sic bo Monte Carlo', () => {
  it('2M rolls of each family land on the exact edge (±0.15% on the mix)', () => {
    const rng = new Rng(11);
    let net = 0;
    let wagered = 0;
    const n = 2_000_000;
    for (let i = 0; i < n; i++) {
      const bets = sicBoEngine.guestBets(rules, 1, rng);
      const r = sicBoEngine.begin(rng, rules, bets);
      r.act('roll');
      const res = r.result()!;
      net += res.wagered - res.returned;
      wagered += res.wagered;
    }
    // Long-shot heavy: SE of the mix is about 0.07%, so 0.3% is a 4σ bound.
    expect(Math.abs(net / wagered - sicBoEngine.theoreticalEdge(rules))).toBeLessThan(0.003);
  }, 120_000);

  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 40 }, () => {
        const r = sicBoEngine.begin(rng, rules, sicBoEngine.guestBets(rules, 5, rng));
        r.act('roll');
        return r.result()!.returned;
      });
    };
    expect(run(3)).toEqual(run(3));
  });

  it('validates limits and choices', () => {
    const { rules: r, issues } = sicBoEngine.validateRules({ triple: 100, minBet: 5, maxBet: 1 });
    expect(r).toMatchObject({ triple: 180, minBet: 5, maxBet: 5 });
    expect(issues.map((i) => i.field).sort()).toEqual(['maxBet', 'triple']);
  });
});
