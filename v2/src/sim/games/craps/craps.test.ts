import { describe, expect, it } from 'vitest';
import type { RngLike } from '../../../shared/games';
import { Rng } from '../../rng';
import { crapsEngine, crapsSpotEdge, type CrapsRules } from './craps';

const rules: CrapsRules = crapsEngine.defaultRules();

/** Rolls the given dice in order (each die value → the RNG value that produces it). */
function dice(...rolls: [number, number][]): RngLike {
  const vals = rolls.flatMap(([a, b]) => [(a - 0.5) / 6, (b - 0.5) / 6]);
  let i = 0;
  return { next: () => vals[i++] ?? 0 };
}

function play(rng: RngLike, bets: { spot: string; amount: number }[], actions: string[] = []) {
  const r = crapsEngine.begin(rng, rules, bets);
  for (const a of actions) r.act(a);
  while (r.options()) r.act('roll');
  return r.result()!;
}

describe('craps exact edges', () => {
  it('Pass is 7/495 and Don’t Pass (bar 12) is 3/220', () => {
    expect(crapsSpotEdge(rules, 'pass')).toBeCloseTo(7 / 495, 14);
    expect(crapsSpotEdge(rules, 'dontPass')).toBeCloseTo(3 / 220, 14);
    expect(crapsSpotEdge(rules, 'come')).toBeCloseTo(7 / 495, 14);
    expect(crapsSpotEdge(rules, 'dontCome')).toBeCloseTo(3 / 220, 14);
  });

  it('odds are free at true payouts', () => {
    for (const p of [4, 5, 6, 8, 9, 10]) {
      expect(crapsSpotEdge(rules, `odds:${p}`)).toBeCloseTo(0, 14);
      expect(crapsSpotEdge(rules, `layOdds:${p}`)).toBeCloseTo(0, 14);
    }
  });

  it('place, field, hardways and props match the standard tables', () => {
    expect(crapsSpotEdge(rules, 'place:6')).toBeCloseTo(1 / 66, 12);
    expect(crapsSpotEdge(rules, 'place:5')).toBeCloseTo(1 / 25, 12);
    expect(crapsSpotEdge(rules, 'place:4')).toBeCloseTo(1 / 15, 12);
    expect(crapsSpotEdge(rules, 'field')).toBeCloseTo(1 / 18, 12);
    expect(crapsSpotEdge({ ...rules, field12Pays: 3 }, 'field')).toBeCloseTo(1 / 36, 12);
    expect(crapsSpotEdge(rules, 'hard:4')).toBeCloseTo(1 / 9, 12);
    expect(crapsSpotEdge(rules, 'hard:8')).toBeCloseTo(1 / 11, 12);
    expect(crapsSpotEdge(rules, 'any7')).toBeCloseTo(1 / 6, 12);
    expect(crapsSpotEdge(rules, 'anyCraps')).toBeCloseTo(1 / 9, 12);
  });
});

describe('craps state machine', () => {
  it('a come-out 7 wins Pass and loses Don’t Pass', () => {
    expect(play(dice([3, 4]), [{ spot: 'pass', amount: 10 }])).toMatchObject({
      wagered: 10,
      returned: 20,
    });
    expect(play(dice([3, 4]), [{ spot: 'dontPass', amount: 10 }])).toMatchObject({
      wagered: 10,
      returned: 0,
    });
  });

  it('a come-out 12 is barred for the don’t side', () => {
    expect(play(dice([6, 6]), [{ spot: 'dontPass', amount: 10 }])).toMatchObject({ returned: 10 });
    expect(play(dice([6, 6]), [{ spot: 'pass', amount: 10 }])).toMatchObject({ returned: 0 });
  });

  it('point made pays the line and true-odds behind it (3-4-5x: 3x on a 4 pays 2:1)', () => {
    const res = play(
      dice([2, 2], [5, 6], [1, 3]),
      [{ spot: 'pass', amount: 10 }],
      ['roll', 'odds:pass'],
    );
    // Line 10 + odds 30 at risk; wins 10 + 60.
    expect(res).toMatchObject({ wagered: 40, returned: 20 + 30 + 60 });
  });

  it('a seven-out loses the line and its odds', () => {
    const res = play(dice([3, 3], [4, 3]), [{ spot: 'pass', amount: 10 }], ['roll', 'odds:pass']);
    expect(res).toMatchObject({ wagered: 60, returned: 0 });
  });

  it('a come bet travels to its own number and settles after the line', () => {
    // Come-out 6 (point), come bet rolls 5 (its point), then 6 (line wins), then 5 (come wins).
    const res = play(dice([3, 3], [2, 3], [4, 2], [1, 4]), [
      { spot: 'pass', amount: 10 },
      { spot: 'come', amount: 10 },
    ]);
    expect(res).toMatchObject({ wagered: 20, returned: 40 });
  });

  it('a come bet the shooter never reaches is handed back and never counted', () => {
    expect(
      play(dice([5, 6]), [
        { spot: 'pass', amount: 10 },
        { spot: 'come', amount: 10 },
      ]),
    ).toMatchObject({
      wagered: 10,
      returned: 20,
    });
  });

  it('place bets are off on the come-out and lose to the seven-out', () => {
    const res = play(dice([3, 4], [2, 2], [3, 4]), [
      { spot: 'pass', amount: 10 },
      { spot: 'place:6', amount: 12 },
    ]);
    // Come-out 7 wins pass (place off), then point 4, then seven-out loses place 6.
    // The pass bet settled on the first roll, so its second life is not ours.
    expect(res).toMatchObject({ wagered: 22, returned: 20 });
  });

  it('realised hold on the pass line converges on 7/495', () => {
    const rng = new Rng(21);
    let net = 0;
    const n = 1_000_000;
    for (let i = 0; i < n; i++) {
      const res = play(rng, [{ spot: 'pass', amount: 1 }]);
      net += res.wagered - res.returned;
    }
    // σ ≈ 1 per decision: ±0.3% is 3σ at a million decisions.
    expect(Math.abs(net / n - 7 / 495)).toBeLessThan(0.003);
  }, 60_000);

  it('the reference strategy takes full odds, which dilutes hold but not theo', () => {
    const rng = new Rng(3);
    let wagered = 0;
    let line = 0;
    for (let i = 0; i < 20_000; i++) {
      const r = crapsEngine.begin(rng, rules, [{ spot: 'pass', amount: 10 }]);
      for (let o = r.options(); o; o = r.options()) r.act(crapsEngine.strategy(r.view(), o));
      wagered += r.result()!.wagered;
      line += 10;
    }
    expect(wagered / line).toBeGreaterThan(3);
  });
});
