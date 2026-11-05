import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import {
  HOUSE_CARDS,
  bingoEngine,
  bingoRoundFrom,
  complete,
  dealCard,
  playGame,
  type BingoRules,
} from './bingo';

const rules: BingoRules = bingoEngine.defaultRules();

describe('bingo cards and patterns', () => {
  it('deals legal 75-ball cards with a free centre', () => {
    const rng = new Rng(1);
    for (let n = 0; n < 200; n++) {
      const card = dealCard(rng);
      expect(card[12]).toBe(0);
      expect(new Set(card.filter((x) => x > 0)).size).toBe(24);
      card.forEach((x, cell) => {
        if (cell === 12) return;
        const col = cell % 5;
        expect(x).toBeGreaterThanOrEqual(15 * col + 1);
        expect(x).toBeLessThanOrEqual(15 * col + 15);
      });
    }
  });

  it('knows a line, a diagonal through the free centre, and a blackout', () => {
    const free = 1 << 12;
    expect(complete(0b11111, 'line')).toBe(true); // top row
    expect(complete(free | (1 << 0) | (1 << 6) | (1 << 18) | (1 << 24), 'line')).toBe(true);
    expect(complete(free | (1 << 0) | (1 << 6) | (1 << 18), 'line')).toBe(false);
    expect(complete((1 << 25) - 1, 'blackout')).toBe(true);
    expect(complete(((1 << 25) - 1) & ~1, 'blackout')).toBe(false);
  });

  it('calls until someone wins and reports every card that won on that ball', () => {
    const a = dealCard(new Rng(2));
    const b = [...a]; // the same card twice: they must share
    const top = a.slice(0, 5);
    const order = [
      ...top,
      ...Array.from({ length: 75 }, (_, i) => i + 1).filter((x) => !top.includes(x)),
    ];
    const g = playGame([a, b], 'line', new Rng(0), order);
    expect(g.called).toEqual(top);
    expect(g.winners).toEqual([0, 1]);
  });
});

describe('bingo par sheet', () => {
  it('the edge is 1 − payback by construction, and each lever moves it', () => {
    expect(bingoEngine.theoreticalEdge(rules)).toBeCloseTo(0.14, 12);
    const p75 = bingoEngine.validateRules({ payback: 0.75 }).rules;
    expect(bingoEngine.theoreticalEdge(p75)).toBeCloseTo(0.25, 12);
    expect(bingoEngine.appeal(p75)).toBeLessThan(bingoEngine.appeal(rules));
    const blackout = bingoEngine.validateRules({ pattern: 'blackout' }).rules;
    expect(bingoEngine.theoreticalEdge(blackout)).toBeCloseTo(0.14, 12);
    expect(bingoEngine.roundsPerHour(blackout, 1)).toBeLessThan(
      bingoEngine.roundsPerHour(rules, 1),
    );
  });

  it.each(['line', 'blackout'] as const)(
    'a Monte Carlo of %s games pays the guest’s card the payback',
    (pattern) => {
      // Exact by symmetry: every card costs the same and has the same chance.
      // The run checks the engine keeps it (no card favoured, ties split).
      const r = bingoEngine.validateRules({ pattern }).rules;
      const rng = new Rng(pattern.length);
      let wagered = 0;
      let returned = 0;
      let shared = 0;
      const N = 300_000;
      for (let i = 0; i < N; i++) {
        const round = bingoEngine.begin(rng, r, [{ spot: 'card', amount: 1 }]);
        round.act('call');
        const res = round.result()!;
        wagered += res.wagered;
        returned += res.returned;
        if ((res.detail as { winners: number }).winners > 1) shared++;
      }
      // A card wins about 1 game in 21 for 18 cards: SD ≈ 4 units, so three
      // standard errors at 300k games is 2.2 points.
      expect(Math.abs(returned / wagered - 0.86)).toBeLessThan(0.022);
      // Ties happen, and more often on a line than a blackout.
      expect(shared / N).toBeGreaterThan(pattern === 'line' ? 0.05 : 0.001);
    },
    120_000,
  );
});

describe('bingo games', () => {
  it('pays the pool share to a winning card and records the game', () => {
    const mine = dealCard(new Rng(7));
    const crowd = Array.from({ length: HOUSE_CARDS }, (_, i) => dealCard(new Rng(100 + i)));
    const top = mine.slice(0, 5);
    const order = [
      ...top,
      ...Array.from({ length: 75 }, (_, i) => i + 1).filter((x) => !top.includes(x)),
    ];
    const g = bingoRoundFrom(rules, [{ spot: 'card', amount: 4 }], [mine, ...crowd], order);
    expect(g.options()).toEqual(['call']);
    g.act('call');
    const res = g.result()!;
    const d = res.detail as { called: number[]; cards: number[][]; winners: number };
    expect(d.cards).toEqual([mine]);
    expect(d.called).toEqual(top.slice(0, d.called.length));
    // The pool is 86% of 21 cards at $4, split between the winners.
    expect(res.returned).toBeCloseTo((0.86 * 4 * (HOUSE_CARDS + 1)) / d.winners, 9);
  });

  it('plays the same game for the same seed', () => {
    const play = () => {
      const r = bingoEngine.begin(new Rng(12), rules, [{ spot: 'card', amount: 4 }]);
      r.act('call');
      return r.result()!.detail;
    };
    expect(play()).toEqual(play());
  });
});
