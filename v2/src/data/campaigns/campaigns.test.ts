import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { runCampaign, TOURNAMENT_SEEDS } from '../../sim/__testkit__/strategies';
import { CAMPAIGNS } from './index';

afterEach(() => eventBus.clear());

// A5 modifiers put real variance on a run — a convention day and a chip
// shortage are not the same campaign. So the guard is stated the way the
// design actually means it: a straightforward build-out wins a *typical* run,
// not one privileged seed. A campaign that genuinely stopped being winnable
// still fails this, because it would lose on most seeds rather than one.
//
// The bot itself lives in src/sim/__testkit__/strategies.ts as `greedy`, so
// the same scripted player that defines winnability here is one entry in the
// strategy tournament that measures difficulty.
const MIN_WINS = 4;

describe('campaign winnability', () => {
  for (const def of CAMPAIGNS) {
    // Seven full campaigns of simulation apiece. Vitest's 5s default was never
    // the right bound for this — under a loaded suite it fails on the clock
    // rather than on winnability, which is the one thing it must not do.
    it(
      `${def.name} ($${def.goalDailyProfit}/day within ${def.dayLimit} days) falls to a straightforward build-out`,
      { timeout: 300_000 },
      () => {
        const results = TOURNAMENT_SEEDS.map((seed) => ({
          seed,
          ...runCampaign(def, seed, 'greedy'),
        }));
        const wins = results.filter((r) => r.outcome === 'won');
        console.log(
          `${def.name}: won ${wins.length}/${TOURNAMENT_SEEDS.length} —`,
          results.map((r) => `s${r.seed}:${r.outcome}($${Math.round(r.best ?? 0)})`).join(' '),
        );
        expect(wins.length).toBeGreaterThanOrEqual(MIN_WINS);
      },
    );
  }
});
