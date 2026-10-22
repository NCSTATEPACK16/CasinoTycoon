import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import { parseCard } from '../cards';
import {
  flopRaise,
  preflopRaise,
  riverRaise,
  tripsEdge,
  uthEngine,
  uthRoundFromCards,
  UTH_ANTE_EDGE,
  type UthView,
} from './uth';

const c = (s: string) => s.split(' ').map(parseCard);
const rules = uthEngine.defaultRules();
/** Deal player, dealer, board and play it to the end with one action list. */
function showdown(cards: string, actions: string[], trips = 0) {
  const r = uthRoundFromCards(rules, 10, trips, c(cards));
  for (const a of actions) r.act(a);
  return r.result()!;
}

describe('UTH payouts', () => {
  it('a 4x raise that wins against a qualified dealer pays Ante, Play, and Blind on a straight', () => {
    // Player 9-T makes a straight on 6-7-8; dealer pairs kings.
    const res = showdown('9s Td Kc Kh 6c 7d 8h 2s 3c', ['bet4x']);
    // Ante 10, Blind 10, Play 40 at risk. Returns: play 80, ante 20, blind 20 (1:1 on a straight).
    expect(res).toMatchObject({ wagered: 60, returned: 120 });
  });

  it('an unqualified dealer pushes the Ante whichever way the hand goes', () => {
    const win = showdown('As Kd 9c 7h 2c 4d 8h Js 3c', ['bet4x']);
    // Player ace-king high beats dealer nine-high; Ante pushes, Blind pushes (no straight).
    expect(win).toMatchObject({ wagered: 60, returned: 80 + 10 + 10 });
    const lose = showdown('Ts 6d Ac Kh 2c 4d 8h Js 3c', ['check', 'check', 'bet1x']);
    // Dealer ace-king high beats us but does not qualify: only the Ante comes back.
    expect(lose).toMatchObject({ wagered: 30, returned: 10 });
  });

  it('folding loses Ante and Blind but Trips still pays on the seven cards', () => {
    const res = showdown('2s 2d Ac Ah 2c 7d 9h Js 4c', ['check', 'check', 'fold'], 5);
    // Trips of deuces pays 3:1 on the 5 Trips bet.
    expect(res).toMatchObject({ wagered: 25, returned: 20 });
  });

  it('a tie pushes everything', () => {
    const res = showdown('2s 3d 2c 3h As Ks Qd Jc Th', ['bet4x']);
    expect(res).toMatchObject({ wagered: 60, returned: 60 });
  });
});

describe('Trips paytables (exact, from the seven-card counts)', () => {
  it('match the published edges', () => {
    expect(tripsEdge('50-40-30-8-7-4-3')).toBeCloseTo(0.034979, 5);
    expect(tripsEdge('50-40-30-8-6-5-3')).toBeCloseTo(0.01904, 4);
    expect(tripsEdge('50-40-30-9-7-4-3')).toBeCloseTo(0.009018, 5);
  });
});

describe('the decision table', () => {
  it('preflop: pairs of 3s+, any ace, K5o/K2s, Q8o/Q6s, JTo/J8s', () => {
    expect(preflopRaise(c('3s 3d'))).toBe(true);
    expect(preflopRaise(c('2s 2d'))).toBe(false);
    expect(preflopRaise(c('As 2d'))).toBe(true);
    expect(preflopRaise(c('Ks 5d'))).toBe(true);
    expect(preflopRaise(c('Ks 4d'))).toBe(false);
    expect(preflopRaise(c('Ks 2s'))).toBe(true);
    expect(preflopRaise(c('Qs 8d'))).toBe(true);
    expect(preflopRaise(c('Qs 7d'))).toBe(false);
    expect(preflopRaise(c('Qs 6s'))).toBe(true);
    expect(preflopRaise(c('Js Td'))).toBe(true);
    expect(preflopRaise(c('Js 9d'))).toBe(false);
    expect(preflopRaise(c('Js 8s'))).toBe(true);
  });

  it('flop: hidden pair, two pair+, or a four-flush with a hidden ten', () => {
    expect(flopRaise(c('9s 4d'), c('9c 2h Kd'))).toBe(true);
    expect(flopRaise(c('2s 2d'), c('9c 5h Kd'))).toBe(false);
    expect(flopRaise(c('Ts 4d'), c('9s 2s Ks'))).toBe(true);
    expect(flopRaise(c('4s Td'), c('9s 2s Ks'))).toBe(false);
    expect(flopRaise(c('9s 4d'), c('Qc Qh Qd'))).toBe(false);
  });

  it('river: a hidden pair, else fewer than 21 dealer outs', () => {
    expect(riverRaise(c('9s 4d'), c('9c 2h Kd 7s 3c'))).toBe(true);
    // Jack high on a dry board: every card that pairs the board beats us.
    expect(riverRaise(c('Js 4d'), c('9c 2h Kd 7s 3c'))).toBe(false);
  });
});

describe('UTH edge, Monte Carlo', () => {
  it('2M hands of the decision table land on the documented Ante edge', () => {
    const rng = new Rng(1);
    const n = 2_000_000;
    let net = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const r = uthEngine.begin(rng, rules, [{ spot: 'ante', amount: 1 }]);
      for (let o = r.options(); o; o = r.options())
        r.act(uthEngine.strategy(r.view() as UthView, o));
      const res = r.result()!;
      const d = res.wagered - res.returned;
      net += d;
      sq += d * d;
    }
    const edge = net / n;
    const se = Math.sqrt((sq / n - edge * edge) / n);
    // UTH's σ is ~4.9 Antes a hand, so 2M hands carry a standard error of
    // ~0.35% — wider than the ±0.2% the handoff asked for. The fixed seed
    // passes that band; the 3σ bound is the claim that survives any seed.
    expect(se).toBeLessThan(0.004);
    expect(Math.abs(edge - UTH_ANTE_EDGE)).toBeLessThan(0.002);
    expect(Math.abs(edge - UTH_ANTE_EDGE)).toBeLessThan(3 * se);
  }, 300_000);
});
