import { describe, expect, it } from 'vitest';
import {
  runCampaign,
  TOURNAMENT_SEEDS,
  type CampaignRun,
  type Strategy,
} from '../../sim/__testkit__/strategies';
import { CAMPAIGNS } from './index';

/**
 * P17 Part B — the catalogue measurements.
 *
 * These exist because of B2, the spec's single highest-risk item: before it,
 * every bot bought "blackjack-table if cash >= 1200, else slot-machine" and
 * nothing else, so adding games to the catalogue would have left every
 * acceptance bar measuring a floor the player no longer builds. The bars would
 * have stayed green and stopped meaning anything.
 *
 * Kept deliberately narrow — one campaign, one or two strategies — because a
 * full tournament is 63 campaigns and ~100s. difficulty.test.ts remains the
 * home of the P16 bars, and `greedy` is untouched so those stay comparable.
 */

const DUSTY_DIME = 0; // the low-capital campaign, where a throughput tier should matter most

// Memoised by campaign/strategy, exactly as difficulty.test.ts does: the four
// assertions below overlap heavily (two read the same throughput runs, two the
// same catalogue runs), and a campaign is thousands of ticks. Without this the
// file plays every season twice over.
const cache = new Map<string, CampaignRun[]>();
function runs(defIndex: number, strategy: Strategy): CampaignRun[] {
  const key = `${defIndex}|${strategy}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = TOURNAMENT_SEEDS.map((seed) => runCampaign(CAMPAIGNS[defIndex]!, seed, strategy));
    cache.set(key, hit);
  }
  return hit;
}

const wins = (defIndex: number, strategy: Strategy) =>
  runs(defIndex, strategy).filter((r) => r.outcome === 'won').length;

describe('Tier 1 is live stock, not shelf decoration', () => {
  // Acceptance criterion 4 — "no dead stock": every game in the catalogue is
  // bought by at least one WINNING line on at least one campaign. The spec
  // calls this the criterion most likely to fail, and says to expect to cut or
  // retune games because of it.
  it('has every Tier 1 game bought by a winning line', { timeout: 300_000 }, () => {
    const winning = runs(DUSTY_DIME, 'throughput').filter((r) => r.outcome === 'won');
    expect(winning.length, 'the throughput line never won, so it proves nothing').toBeGreaterThan(0);

    const built = new Set(winning.flatMap((r) => r.gamesBuilt));
    for (const id of ['penny-slots', 'pachinko', 'keno-lounge', 'video-poker']) {
      expect(built.has(id), `${id} is dead stock — no winning line ever bought it`).toBe(true);
    }
  });

  it('lets a cheap volume floor be a real strategy, not a novelty', { timeout: 300_000 }, () => {
    // Measured 2026-09-13: throughput wins 7/7 on The Dusty Dime, 4/7 on Neon
    // Nights and 0/7 on The High Roller Club (which allows no Tier 1 object at
    // all). Total 11 against greedy's 17 — so filling a small floor with cheap
    // games is a viable opening on a thin bankroll without displacing the
    // established build as the stronger line overall.
    expect(wins(DUSTY_DIME, 'throughput')).toBeGreaterThanOrEqual(4);
  });
});

describe('buying the dearest thing you can afford is a trap', () => {
  // An early finding for Part C's criterion 1 ("the early table is a trap"),
  // which falls out of Tier 1 landing rather than needing prestige to exist.
  //
  // The `catalogue` bot buys strictly dearest-first, so on The Dusty Dime's
  // $3,000 it reaches for the $2,500 high-limit table — a wallet-gated object
  // almost nobody on a starting floor can sit at, draining $80/day while it
  // waits. Measured 2026-09-13: 0/7 on Dusty Dime and 1/7 on Neon Nights,
  // against greedy's 6/7 and 5/7.
  //
  // This is the behaviour Part C has to preserve once prestige gates the table:
  // it must stay possible, and common, to buy it too early.
  it('loses to the established build on a thin bankroll', { timeout: 300_000 }, () => {
    expect(wins(DUSTY_DIME, 'catalogue')).toBeLessThan(wins(DUSTY_DIME, 'greedy'));
  });

  it('actually reaches for the object that traps it', { timeout: 300_000 }, () => {
    // Guards the test above against passing for the wrong reason: if the bot
    // never bought a high-limit table, its losses would say nothing about the
    // trap.
    const built = new Set(runs(DUSTY_DIME, 'catalogue').flatMap((r) => r.gamesBuilt));
    expect(built.has('high-limit-table')).toBe(true);
  });
});
