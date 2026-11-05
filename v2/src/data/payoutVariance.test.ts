import { describe, expect, it } from 'vitest';
import {
  BIG_SIX_BALANCE,
  BINGO_BALANCE,
  BLACKJACK_BALANCE,
  CRAPS_BALANCE,
  HIGH_LIMIT_BALANCE,
  KENO_BALANCE,
  PACHINKO_BALANCE,
  PAI_GOW_BALANCE,
  PENNY_SLOT_BALANCE,
  ROULETTE_BALANCE,
  SIC_BO_BALANCE,
  SLOT_BALANCE,
  engineRtp,
  THREE_CARD_POKER_BALANCE,
  VIDEO_POKER_BALANCE,
} from './balance';
import { getObjectDef } from './objects';

// P16 and P17 measured the v1 payout tables here: their RTP, their sd/edge
// against a variance bar, and the catalogue's differentiation. Every game on
// the floor plays a real engine now (B9a–B9d), whose exact edges and swing are
// tested in sim/games, so only the differentiation rule stays.

describe('catalogue differentiation', () => {
  /**
   * The spec's non-negotiable rule: a new game must differ from every existing
   * one on at least TWO axes, or it is a reskin that makes the catalogue wider
   * and shallower.
   *
   * This replaces an earlier test that compared four hand-picked wagers and
   * quietly left video poker out of the list — because video poker and pachinko
   * both wager $5, so including it would have failed. That test was shaped
   * around its own counterexample. The rule was never "every wager is unique";
   * it is "every PAIR differs on two or more axes", so this asserts that
   * directly, over every pair in the catalogue, and reports the offender.
   */
  const AXES = [
    'wager',
    'rtp',
    'cadence',
    'sessionMin',
    'sessionMax',
    'seats',
    'wear',
    'footprint',
    'upkeep',
    'ratingBonus',
  ] as const;

  interface Profile {
    id: string;
    wager: number;
    rtp: number;
    cadence: number;
    sessionMin: number;
    sessionMax: number;
    seats: number;
    wear: number;
    footprint: string;
    upkeep: number;
    ratingBonus: number;
  }

  function profile(id: string, b: Record<string, unknown>): Profile {
    const def = getObjectDef(id)!;
    // Every game carries its RTP in its engine's rules.
    const rtp = engineRtp(id);
    return {
      id,
      wager: b.costToPlay as number,
      rtp: Number(rtp.toFixed(4)),
      cadence: (b.playIntervalTicks ?? b.spinIntervalTicks) as number,
      sessionMin: (b.playsMin ?? b.spinsMin) as number,
      sessionMax: (b.playsMax ?? b.spinsMax) as number,
      seats: (b.seats as number) ?? 1,
      wear: b.wearPerPlay as number,
      footprint: `${def.footprint.w}x${def.footprint.h}`,
      upkeep: def.upkeepPerDay,
      ratingBonus: def.ratingBonus ?? 0,
    };
  }

  const PROFILES: readonly Profile[] = [
    profile('slot-machine', SLOT_BALANCE),
    profile('blackjack-table', BLACKJACK_BALANCE),
    profile('craps-table', CRAPS_BALANCE),
    profile('roulette-table', ROULETTE_BALANCE),
    profile('big-six-wheel', BIG_SIX_BALANCE),
    profile('high-limit-table', HIGH_LIMIT_BALANCE),
    profile('penny-slots', PENNY_SLOT_BALANCE),
    profile('pachinko', PACHINKO_BALANCE),
    profile('keno-lounge', KENO_BALANCE),
    profile('video-poker', VIDEO_POKER_BALANCE),
    profile('sic-bo', SIC_BO_BALANCE),
    profile('three-card-poker', THREE_CARD_POKER_BALANCE),
    profile('pai-gow', PAI_GOW_BALANCE),
    profile('bingo-hall', BINGO_BALANCE),
  ];

  it('differs every pair of games on at least two axes', () => {
    for (let i = 0; i < PROFILES.length; i++) {
      for (let j = i + 1; j < PROFILES.length; j++) {
        const a = PROFILES[i]!;
        const b = PROFILES[j]!;
        const differing = AXES.filter((axis) => a[axis] !== b[axis]);
        expect(
          differing.length,
          `${a.id} vs ${b.id} differ only on [${differing.join(', ')}] — two axes minimum`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('records that video poker and pachinko share a wager, and differ elsewhere', () => {
    // Kept explicit so the overlap is a documented fact rather than something a
    // future edit rediscovers. They share costToPlay ($5) and nothing else.
    const vp = PROFILES.find((p) => p.id === 'video-poker')!;
    const pa = PROFILES.find((p) => p.id === 'pachinko')!;
    expect(vp.wager).toBe(pa.wager);
    const differing = AXES.filter((axis) => vp[axis] !== pa[axis]);
    expect(differing).not.toContain('wager');
    expect(differing.length).toBeGreaterThanOrEqual(4);
  });

  it('makes keno the slowest game and video poker the fastest', () => {
    const cadences = PROFILES.filter((p) => p.id !== 'keno-lounge' && p.id !== 'video-poker').map(
      (p) => p.cadence,
    );
    expect(KENO_BALANCE.playIntervalTicks).toBeGreaterThan(Math.max(...cadences));
    expect(VIDEO_POKER_BALANCE.playIntervalTicks).toBeLessThan(Math.min(...cadences));
  });

  it('makes video poker the thinnest edge in the arcade', () => {
    // Among the machines and draw games (House Rules' licence), 7/5 Jacks or
    // Better at 3.9% undercuts every default. The dealt games' book edges
    // (blackjack, craps' line, UTH's Ante) are thinner, which is why the claim
    // is the arcade's, not the house's.
    const vp = 1 - engineRtp('video-poker');
    const arcade = ['slot-machine', 'penny-slots', 'pachinko', 'keno-lounge', 'bingo-hall'];
    for (const p of PROFILES.filter((x) => arcade.includes(x.id)))
      expect(1 - p.rtp, p.id).toBeGreaterThan(vp);
  });
});
