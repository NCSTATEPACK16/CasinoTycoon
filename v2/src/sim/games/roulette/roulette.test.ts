import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import { parseSpot, rouletteEngine, rouletteSpotEdge, type RouletteRules } from './roulette';

const single: RouletteRules = { ...rouletteEngine.defaultRules(), wheel: 'single' };
const double: RouletteRules = { ...rouletteEngine.defaultRules(), wheel: 'double' };
const SPOTS = [
  'straight:0',
  'straight:17',
  'split:1-2',
  'split:14-17',
  'street:13',
  'corner:5',
  'sixline:28',
  'column:1',
  'column:3',
  'dozen:2',
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
];

describe('roulette edges by enumeration', () => {
  it('every standard bet is 1/37 on a single-zero wheel and 2/38 on double zero', () => {
    for (const spot of SPOTS) {
      expect(rouletteSpotEdge(single, spot)).toBeCloseTo(1 / 37, 12);
      expect(rouletteSpotEdge(double, spot)).toBeCloseTo(2 / 38, 12);
    }
    expect(rouletteSpotEdge(double, 'straight:00')).toBeCloseTo(2 / 38, 12);
  });

  it('the five-number bet is the worst on the layout at 7.89%', () => {
    expect(rouletteSpotEdge(double, 'basket')).toBeCloseTo(3 / 38, 12);
    // On a single-zero wheel the same corner is the fair-priced "first four".
    expect(rouletteSpotEdge(single, 'basket')).toBeCloseTo(1 / 37, 12);
  });

  it('La Partage halves the even-money edge and leaves inside bets alone', () => {
    const lp = { ...single, laPartage: true };
    expect(rouletteSpotEdge(lp, 'red')).toBeCloseTo(1 / 74, 12);
    expect(rouletteSpotEdge(lp, 'straight:5')).toBeCloseTo(1 / 37, 12);
  });

  it('rejects bets the layout does not have', () => {
    for (const bad of [
      'split:1-5',
      'split:3-4',
      'street:2',
      'corner:3',
      'straight:00',
      'dozen:4',
      'blue',
    ]) {
      expect(parseSpot(bad, 'single')).toBeNull();
    }
    expect(parseSpot('straight:00', 'double')).not.toBeNull();
  });

  it('validates rules: La Partage needs a single-zero wheel, limits are clamped', () => {
    const { rules, issues } = rouletteEngine.validateRules({
      wheel: 'double',
      laPartage: true,
      minBet: -5,
    });
    expect(rules.laPartage).toBe(false);
    expect(rules.minBet).toBe(1);
    expect(issues.map((i) => i.field)).toEqual(['minBet', 'laPartage']);
  });

  it('realised hold converges on the edge', () => {
    const rng = new Rng(4);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 400_000; i++) {
      const r = rouletteEngine.begin(rng, double, [{ spot: 'red', amount: 1 }]);
      r.act('spin');
      wagered += r.result()!.wagered;
      returned += r.result()!.returned;
    }
    // σ per unit even-money spin ≈ 1, so 400k spins pin the hold to ±0.5% (3σ).
    expect(Math.abs((wagered - returned) / wagered - 2 / 38)).toBeLessThan(0.005);
  });

  it('single zero appeals more than double; La Partage more still', () => {
    expect(rouletteEngine.appeal(single)).toBeGreaterThan(rouletteEngine.appeal(double));
    expect(rouletteEngine.appeal({ ...single, laPartage: true })).toBeGreaterThan(
      rouletteEngine.appeal(single),
    );
  });
});
