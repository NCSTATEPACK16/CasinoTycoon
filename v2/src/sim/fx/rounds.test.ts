import { describe, expect, it } from 'vitest';
import { GameMath } from '../entities/machines/GameMath';
import { playEngineRounds } from '../entities/machines/enginePlay';
import { spinSheet } from '../games/slots/parSheet';
import { PAR_SHEETS } from '../games/slots/sheets';
import { Rng } from '../rng';
import { lastRound, stopsFor } from './rounds';

const ctx = { unit: 10, wallet: 1e9, skillError: 0, oddsAppetite: 1, dealerSpeed: 1 };

/** The window a stop per reel puts on screen (the engine's own indexing). */
function windowAt(sheetId: string, stops: number[]): string[][] {
  const sheet = PAR_SHEETS[sheetId]!;
  const mid = sheet.rows === 3 ? 1 : 0;
  return stops.map((s, r) => {
    const strip = sheet.reels[r]!.stops;
    const len = strip.length;
    return Array.from(
      { length: sheet.rows },
      (_, row) => strip[(((s + row - mid) % len) + len) % len]!,
    );
  });
}

describe('round records', () => {
  it('finds reel stops that show exactly the window the engine landed on', () => {
    const rng = new Rng(7);
    for (const id of Object.keys(PAR_SHEETS))
      for (let i = 0; i < 300; i++) {
        const o = spinSheet(PAR_SHEETS[id]!, () => rng.next());
        expect(windowAt(id, stopsFor(id, o.window))).toEqual(o.window);
      }
  });

  it("keeps a play's last round, with its own stake and return", () => {
    const math = new GameMath('slots', {
      sheet: 'lucky-cherries',
      denomination: 0.25,
      credits: 40,
    });
    expect(lastRound(math)).toBeNull();
    const rng = new Rng(11);
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      playEngineRounds(math, 1, rng, ctx);
      const rec = lastRound(math)!;
      seen.push(rec.seq);
      expect(rec.fx.kind).toBe('slots');
      expect(rec.fx.wagered).toBe(10);
      const s = rec.fx.slots!;
      expect(s.sheet).toBe('lucky-cherries');
      expect(s.stops).toHaveLength(3);
      // A paying window has a winning line; a dead one has none.
      expect(rec.fx.returned > 0).toBe(s.lines.length > 0);
    }
    expect(new Set(seen).size).toBe(40);
  });

  it('records the pocket and the wheel of a roulette spin', () => {
    for (const wheel of ['single', 'double'] as const) {
      const math = new GameMath('roulette', { minBet: 20, maxBet: 1000, wheel, laPartage: false });
      const rng = new Rng(3);
      const pockets = new Set<number>();
      for (let i = 0; i < 400; i++) {
        playEngineRounds(math, 2, rng, ctx);
        const fx = lastRound(math)!.fx;
        expect(fx.roulette!.wheel).toBe(wheel);
        // The summary is the engine's own "17 red" / "00 green".
        const label = fx.roulette!.pocket === 37 ? '00' : String(fx.roulette!.pocket);
        expect(fx.summary.split(' ')[0]).toBe(label);
        pockets.add(fx.roulette!.pocket);
      }
      expect(Math.max(...pockets)).toBe(wheel === 'double' ? 37 : 36);
    }
  });

  it('records the craps roll that settled the round', () => {
    const math = new GameMath('craps');
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      playEngineRounds(math, 3, rng, ctx);
      const fx = lastRound(math)!.fx;
      const [a, b] = fx.craps!.dice;
      for (const d of [a, b]) expect(d >= 1 && d <= 6 && Number.isInteger(d)).toBe(true);
      // The engine's summary ends with the last roll's total.
      expect(fx.summary).toMatch(new RegExp(`last ${a + b}$`));
    }
  });

  it('never touches the RNG or the outcome', () => {
    // The same deals through playEngineRounds (which records) and through the
    // bare engine leave both RNGs in the same state with the same money.
    const a = new GameMath('blackjack');
    const b = new GameMath('blackjack');
    const ra = new Rng(99);
    const rb = new Rng(99);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 50; i++) {
      const res = playEngineRounds(a, 4, ra, ctx);
      for (let k = 0; k < 4; k++) {
        const r = b.playRound(ctx, rb)!;
        wagered += r.wagered;
        returned += r.returned;
      }
      expect(res.rounds).toBe(4);
      void res;
    }
    expect(ra.next()).toBe(rb.next());
    const total = (m: GameMath, rng: Rng) => playEngineRounds(m, 1, rng, ctx).wager;
    expect(total(a, ra)).toBe(total(b, rb));
    expect(wagered).toBeGreaterThan(0);
    expect(returned).toBeGreaterThan(0);
  });
});
