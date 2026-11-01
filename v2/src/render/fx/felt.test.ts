import { describe, expect, it } from 'vitest';
import type { RoundFx } from '../../shared/contracts';
import { GameMath } from '../../sim/entities/machines/GameMath';
import { playEngineRounds } from '../../sim/entities/machines/enginePlay';
import { lastRound } from '../../sim/fx/rounds';
import { cardLabel } from '../../sim/games/cards';
import { Rng } from '../../sim/rng';
import {
  betSpot,
  chipsFor,
  CX,
  dealPlan,
  resultOf,
  seatAngle,
  slotPlace,
  ZB,
  type DealPlan,
  type PlannedCard,
} from './felt';

const ctx = { unit: 10, wallet: 1e9, skillError: 0.1, oddsAppetite: 1, dealerSpeed: 1 };

/** Real recorded rounds from the engines, as the worker would send them. */
function rounds(kind: 'blackjack' | 'uth', n: number, seed: number): RoundFx[] {
  const math = new GameMath(kind);
  const rng = new Rng(seed);
  const out: RoundFx[] = [];
  for (let i = 0; i < n; i++) {
    playEngineRounds(math, 1, rng, ctx);
    out.push(lastRound(math)!.fx);
  }
  return out;
}

const labels = (p: DealPlan, kind: PlannedCard['slot']['kind'], hand = 0) =>
  p.cards
    .filter((c) => c.slot.kind === kind && (c.slot.kind !== 'hand' || c.slot.hand === hand))
    .sort((a, b) => (a.slot as { index: number }).index - (b.slot as { index: number }).index)
    .map((c) => cardLabel(c.card));

describe('blackjack deal plan', () => {
  const all = rounds('blackjack', 600, 17);

  it('lays every card of the round on its own slot, and nothing else', () => {
    for (const fx of all) {
      const p = dealPlan(fx)!;
      expect(labels(p, 'dealer')).toEqual(fx.cards!.dealer);
      fx.cards!.hands.forEach((h, i) => expect(labels(p, 'hand', i)).toEqual(h));
      const total = fx.cards!.dealer.length + fx.cards!.hands.reduce((s, h) => s + h.length, 0);
      expect(p.cards).toHaveLength(total);
      expect(p.hands).toBe(fx.cards!.hands.length);
    }
  });

  it('deals player, dealer up, player, hole, then draws, then the dealer', () => {
    for (const fx of all) {
      const p = dealPlan(fx)!;
      const [a, b, c, d] = p.cards;
      expect(a!.slot).toEqual({ kind: 'hand', hand: 0, index: 0 });
      expect(b!.slot).toEqual({ kind: 'dealer', index: 0 });
      expect(c!.slot.kind).toBe('hand');
      expect(d!.slot).toEqual({ kind: 'dealer', index: 1 });
      expect(b!.up).toBe(true);
      expect(d!.up).toBe(false);
      // Out of the shoe one at a time.
      for (let i = 1; i < p.cards.length; i++)
        expect(p.cards[i]!.dealAt).toBeGreaterThan(p.cards[i - 1]!.dealAt);
      // The hole card turns after the players' draws and before the dealer draws.
      const flip = d!.flipAt!;
      for (const x of p.cards) {
        if (x.slot.kind === 'hand') expect(x.dealAt).toBeLessThan(flip);
        if (x.slot.kind === 'dealer' && x.slot.index >= 2) expect(x.dealAt).toBeGreaterThan(flip);
      }
    }
  });

  it('settles after the last card, with the round own result, then clears', () => {
    for (const fx of all) {
      const p = dealPlan(fx)!;
      const last = Math.max(...p.cards.map((c) => Math.max(c.dealAt, c.flipAt ?? 0)));
      expect(p.settleAt).toBeGreaterThan(last);
      expect(p.clearAt).toBeGreaterThan(p.settleAt);
      expect(p.betAt).toBeLessThan(p.cards[0]!.dealAt);
      expect(p.result).toBe(resultOf(fx.wagered, fx.returned));
      expect([p.wagered, p.returned]).toEqual([fx.wagered, fx.returned]);
    }
    // The sample covers wins, losses, pushes and splits.
    const plans = all.map((fx) => dealPlan(fx)!);
    for (const r of ['win', 'lose', 'push']) expect(plans.some((p) => p.result === r)).toBe(true);
    expect(plans.some((p) => p.hands > 1)).toBe(true);
  });

  it('opens a split with one card of the pair to each hand', () => {
    const fx = all.find((f) => f.cards!.hands.length > 1)!;
    const p = dealPlan(fx)!;
    expect(p.cards[0]!.slot).toEqual({ kind: 'hand', hand: 0, index: 0 });
    expect(p.cards[2]!.slot).toEqual({ kind: 'hand', hand: 1, index: 0 });
  });
});

describe('UTH deal plan', () => {
  const all = rounds('uth', 300, 5);

  it('deals two each and a face-down board that turns flop first, then turn and river', () => {
    for (const fx of all) {
      const p = dealPlan(fx)!;
      expect(labels(p, 'hand')).toEqual(fx.cards!.hands[0]);
      expect(labels(p, 'dealer')).toEqual(fx.cards!.dealer);
      expect(labels(p, 'board')).toEqual(fx.cards!.board);
      const board = p.cards.filter((c) => c.slot.kind === 'board');
      expect(board.every((b) => !b.up)).toBe(true);
      const flop = board.slice(0, 3).map((b) => b.flipAt!);
      const rest = board.slice(3).map((b) => b.flipAt!);
      expect(new Set(flop).size).toBe(1);
      expect(rest[0]!).toBeGreaterThan(flop[0]!);
      // The dealer shows last, then the round settles.
      const dealer = p.cards.filter((c) => c.slot.kind === 'dealer');
      for (const d of dealer) {
        expect(d.up).toBe(false);
        expect(d.flipAt!).toBeGreaterThan(rest[0]!);
        expect(p.settleAt).toBeGreaterThan(d.flipAt!);
      }
      // A fold turns the player's own cards face down; otherwise they stay up.
      for (const h of p.cards.filter((c) => c.slot.kind === 'hand')) {
        expect(h.up).toBe(true);
        expect(h.flipAt !== null).toBe(!!fx.cards!.folded);
      }
    }
    expect(all.some((f) => f.cards!.folded)).toBe(true);
  });
});

describe('felt layout', () => {
  it('keeps every seat on the felt, the dealer side included', () => {
    for (const [px, pz] of [
      [0.1, 1.0],
      [1.0, 1.85],
      [1.9, 1.0],
      [1.0, 0.0],
      [0.2, 0.1],
    ] as const) {
      const a = seatAngle(px, pz);
      for (const s of [betSpot(a), slotPlace({ kind: 'hand', hand: 0, index: 2 }, a)]) {
        expect(s.z).toBeGreaterThan(ZB + 0.15);
        expect(Math.abs(s.x - CX)).toBeLessThan(0.75);
      }
    }
  });

  it('lays nothing under the chip rack (heroes.py: x 0.69–1.31, z up to 0.55)', () => {
    const clear = (p: { x: number; z: number }) =>
      p.z - 0.039 > 0.55 || Math.abs(p.x - CX) > 0.31 + 0.028;
    for (let i = 0; i < 7; i++)
      expect(clear(slotPlace({ kind: 'dealer', index: i }, 1))).toBe(true);
    for (let i = 0; i < 5; i++) expect(clear(slotPlace({ kind: 'board', index: i }, 1))).toBe(true);
    for (let a = 0.5; a < 2.7; a += 0.2) {
      expect(clear(betSpot(a))).toBe(true);
      expect(clear(slotPlace({ kind: 'hand', hand: 0, index: 0 }, a))).toBe(true);
    }
  });

  it("keeps a seat's cards clear of the board and the dealer's row", () => {
    for (let a = 0.5; a < 2.7; a += 0.05)
      for (let i = 0; i < 3; i++) {
        const c = slotPlace({ kind: 'hand', hand: 0, index: i }, a);
        for (let k = 0; k < 5; k++) {
          const b = slotPlace({ kind: 'board', index: k }, a);
          const d = slotPlace({ kind: 'dealer', index: k }, a);
          expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeGreaterThan(0.1);
          expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeGreaterThan(0.1);
        }
      }
  });

  it('puts the cards between the bet and the dealer, facing the player', () => {
    const a = seatAngle(0.3, 1.5);
    const bet = betSpot(a);
    const card = slotPlace({ kind: 'hand', hand: 0, index: 0 }, a);
    expect(Math.hypot(card.x - CX, card.z - ZB)).toBeLessThan(Math.hypot(bet.x - CX, bet.z - ZB));
    // yaw turns the card's +z toward the player.
    const dir = { x: Math.sin(card.yaw), z: Math.cos(card.yaw) };
    expect(dir.x * (0.3 - card.x) + dir.z * (1.5 - card.z)).toBeGreaterThan(0);
    // The centre seat squares up.
    expect(slotPlace({ kind: 'hand', hand: 0, index: 0 }, seatAngle(1.0, 1.8)).yaw).toBeCloseTo(
      0,
      6,
    );
  });
});

describe('chips', () => {
  it('stacks an amount in the largest chips first', () => {
    expect(chipsFor(10)).toEqual([5, 5]);
    expect(chipsFor(137)).toEqual([100, 25, 5, 5, 1, 1]);
    expect(chipsFor(0)).toEqual([]);
    for (const v of [1, 7, 25, 60, 499, 1234])
      expect(chipsFor(v).reduce((s, c) => s + c, 0)).toBe(v);
    expect(chipsFor(99_999).length).toBeLessThanOrEqual(20);
  });
});
