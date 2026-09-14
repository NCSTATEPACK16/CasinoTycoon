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
const TIER1 = ['penny-slots', 'pachinko', 'keno-lounge', 'video-poker'] as const;
/** Ablation runs are per-game, so they multiply fast. Three seeds is enough —
 *  a game that cannot turn one profitable day does not do it on seed four. */
const ABLATION_SEEDS = TOURNAMENT_SEEDS.slice(0, 3);

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
    // The weaker half of criterion 4, kept because it is the criterion's literal
    // wording — but on its own it is close to tautological: TIER1_SPREAD names
    // these four ids outright and the bot buys round-robin regardless of merit,
    // so a game with a 0.1% edge would pass. The ablation below is the half that
    // can actually fail.
    const winning = runs(DUSTY_DIME, 'throughput').filter((r) => r.outcome === 'won');
    expect(winning.length, 'the throughput line never won, so it proves nothing').toBeGreaterThan(0);

    const built = new Set(winning.flatMap((r) => r.gamesBuilt));
    for (const id of TIER1) {
      expect(built.has(id), `${id} is dead stock — no winning line ever bought it`).toBe(true);
    }
  });

  // The question criterion 4 is actually asking: is this game worth buying?
  // Each run is handed exactly ONE Tier 1 game and nothing else to build, so a
  // game that cannot carry a floor by itself shows up as a floor that never
  // turns a profit. Three seeds rather than seven — this is four extra campaigns
  // per game and the signal is not close.
  for (const id of TIER1) {
    it(`${id}: is a going concern on its own`, { timeout: 300_000 }, () => {
      const solo = ABLATION_SEEDS.map((seed) =>
        runCampaign(CAMPAIGNS[DUSTY_DIME]!, seed, 'throughput', [id]),
      );
      // It got built at all — guards against the run failing for lack of floor.
      expect(solo.every((r) => r.gamesBuilt.includes(id)), `${id} never placed`).toBe(true);
      // And it earned. A game that cannot produce a single profitable day as the
      // only earner on the floor is dead stock however eagerly a bot buys it.
      const best = Math.max(...solo.map((r) => r.best));
      expect(best, `${id} never produced a profitable day as the sole earner`).toBeGreaterThan(0);
    });
  }

  it('lets a cheap volume floor be a real strategy, not a novelty', { timeout: 300_000 }, () => {
    // Measured 2026-09-13: throughput 7/7 on The Dusty Dime, 4/7 on Neon Nights,
    // 0/7 on The High Roller Club.
    //
    // The headline "11 against greedy's 17" is misleading and is not the claim
    // made here. High Roller Club allows only blackjack-table (campaigns/index.ts),
    // so the entire Tier 1 ladder is banned there and throughput's 0/7 is
    // structural, not a balance result. On the two campaigns where Tier 1 is
    // legal it is 7+4 = 11 against greedy's 6+5 = 11 — a dead tie.
    //
    // So the honest statement is: a cheap volume floor is an equal-strength
    // opening where it is allowed, not a weaker one. Whether that is too strong
    // is a Tier 2 question, when mid-price games arrive to compete with it.
    expect(wins(DUSTY_DIME, 'throughput')).toBeGreaterThanOrEqual(4);
  });

  // Item 1 from the whole-branch review. P16's criterion 6 — build once, walk
  // away, never win — is asserted in difficulty.test.ts against a `minimal` bot
  // that only knows blackjack and slots. Tier 1 gives build-and-abandon four new
  // and much cheaper things to build, so the criterion needs re-proving against
  // them rather than assumed to carry over.
  it('does not let build-and-abandon win with Tier 1 either', { timeout: 300_000 }, () => {
    // Only the campaigns where Tier 1 is actually legal. The High Roller Club
    // allows blackjack-table alone, so a Tier 1 build-and-abandon line there
    // builds nothing and wins zero for a reason that has nothing to do with the
    // new games — a vacuous pass, and seven campaigns of simulation to get it.
    const tier1Legal = CAMPAIGNS.map((c, i) => [c, i] as const).filter(
      ([c]) => !c.allowedObjects || c.allowedObjects.includes('penny-slots'),
    );
    expect(tier1Legal.length, 'no campaign permits Tier 1 — this test is vacuous').toBeGreaterThan(
      0,
    );
    for (const [campaign, i] of tier1Legal) {
      expect(wins(i, 'minimalTier1'), campaign.name).toBe(0);
    }
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
