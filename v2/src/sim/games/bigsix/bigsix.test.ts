import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import {
  BIG_SIX_GUEST_MIX,
  BIG_SIX_LAYOUTS,
  BIG_SIX_SYMBOLS,
  bigSixEngine,
  bigSixRoundAt,
  bigSixSpotEdge,
  wheelOf,
  type BigSixRules,
} from './bigsix';

const rules: BigSixRules = bigSixEngine.defaultRules();

describe('big six exact edges', () => {
  it('every bet matches the published edge over 54 segments', () => {
    // Wizard of Odds ("Big Six"): $1 11.11%, $2 16.67%, $5 22.22%, $10 18.52%,
    // $20 22.22%, joker/logo 14.81% at 45:1.
    const cases: [string, number][] = [
      ['sym:1', 0.1111],
      ['sym:2', 0.1667],
      ['sym:5', 0.2222],
      ['sym:10', 0.1852],
      ['sym:20', 0.2222],
      ['sym:joker', 0.1481],
      ['sym:logo', 0.1481],
      ['main', 0.1111],
    ];
    for (const [spot, e] of cases) expect(bigSixSpotEdge(rules, spot), spot).toBeCloseTo(e, 4);
    expect(bigSixSpotEdge(rules, 'sym:7')).toBe(0);
  });

  it('the wheel has 54 segments with each symbol’s count, spread round the rim', () => {
    for (const layout of ['standard', 'atlantic-city'] as const) {
      const wheel = wheelOf(layout);
      expect(wheel).toHaveLength(54);
      for (const sym of BIG_SIX_SYMBOLS)
        expect(wheel.filter((s) => s === sym).length).toBe(BIG_SIX_LAYOUTS[layout][sym]);
      // No two $20s, $10s or specials side by side.
      for (let i = 0; i < 54; i++) {
        const a = wheel[i]!;
        const b = wheel[(i + 1) % 54]!;
        if (a !== '1' && a !== '2') expect(b, `segment ${i}`).not.toBe(a);
      }
    }
  });

  it('each lever moves its bets and the mix', () => {
    const forty = bigSixEngine.validateRules({ jokerPays: 40 }).rules;
    expect(bigSixSpotEdge(forty, 'sym:joker')).toBeCloseTo(1 - 41 / 54, 12);
    expect(bigSixSpotEdge(forty, 'sym:1')).toBeCloseTo(bigSixSpotEdge(rules, 'sym:1'), 12);
    const ac = bigSixEngine.validateRules({ segments: 'atlantic-city' }).rules;
    expect(bigSixSpotEdge(ac, 'sym:1')).toBeCloseTo(1 - 46 / 54, 12); // 14.81%
    expect(bigSixSpotEdge(ac, 'sym:5')).toBeCloseTo(1 - 48 / 54, 12); // 11.11%
    expect(bigSixEngine.theoreticalEdge(forty)).toBeGreaterThan(
      bigSixEngine.theoreticalEdge(rules),
    );
    expect(bigSixEngine.appeal(forty)).toBeLessThan(bigSixEngine.appeal(rules));
  });

  it('the guest mix blends to about 15%, confirmed by 2M spins', () => {
    expect(Object.values(BIG_SIX_GUEST_MIX).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const e = bigSixEngine.theoreticalEdge(rules);
    expect(e).toBeGreaterThan(0.145);
    expect(e).toBeLessThan(0.16);
    const rng = new Rng(0xb16);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 2_000_000; i++) {
      const r = bigSixEngine.begin(rng, rules, bigSixEngine.guestBets(rules, 1, rng));
      r.act('spin');
      wagered += r.result()!.wagered;
      returned += r.result()!.returned;
    }
    // Per-spin SD is about 3.6 units on the mix (the 45:1 specials): three
    // standard errors at 2M spins is 0.76 points.
    expect(Math.abs(1 - returned / wagered - e)).toBeLessThan(0.0076);
  }, 120_000);
});

describe('big six spins', () => {
  it('pays the landed symbol to every bet on it', () => {
    const wheel = wheelOf('standard');
    const joker = wheel.indexOf('joker');
    const r = bigSixRoundAt(
      rules,
      [
        { spot: 'sym:joker', amount: 2 },
        { spot: 'sym:1', amount: 5 },
      ],
      joker,
    );
    expect(r.options()).toEqual(['spin']);
    r.act('spin');
    expect(r.result()!.wagered).toBe(7);
    expect(r.result()!.returned).toBe(2 * 46);
    expect(r.result()!.detail).toEqual({ segment: joker, symbol: 'joker' });
  });

  it('spins the same segment for the same seed', () => {
    const spin = () => {
      const r = bigSixEngine.begin(new Rng(3), rules, [{ spot: 'main', amount: 1 }]);
      r.act('spin');
      return r.result()!.detail;
    };
    expect(spin()).toEqual(spin());
  });
});
