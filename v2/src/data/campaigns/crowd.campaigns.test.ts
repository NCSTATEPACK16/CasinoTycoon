// B7a: the campaigns as players actually play them, on the Recast crowd.
//
// campaigns.test.ts and difficulty.test.ts run the tournament on the grid
// walker, which is fast and is what the goals were tuned on. The real game
// walks guests in real time, and until B7a that made the campaigns all but
// unwinnable: greedy won 0/7, 1/7 and 1/7 on the crowd against 7/7, 5/7 and
// 5/7 on the grid. With the slower clock and guests staying at a game it is
// 7/7, 6/7 and 5/7. This guards the two bars that matter on the crowd: a
// straightforward build-out wins most runs, and doing nothing never does.

import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { runCampaign, TOURNAMENT_SEEDS, type Strategy } from '../../sim/__testkit__/strategies';
import { WorldNav } from '../../sim/nav/WorldNav';
import { CasinoWorld } from '../../sim/world';
import { CAMPAIGNS, type CampaignDef } from './index';

afterEach(() => eventBus.clear());

async function crowdWins(def: CampaignDef, strategy: Strategy): Promise<number> {
  let wins = 0;
  for (const seed of TOURNAMENT_SEEDS) {
    const world = new CasinoWorld({ seed, autoSpawn: true });
    world.startScenario(def);
    world.attachNav(await WorldNav.create(world));
    if (runCampaign(def, seed, strategy, undefined, world).outcome === 'won') wins++;
  }
  return wins;
}

describe('campaigns on the crowd (B7a)', () => {
  for (const def of CAMPAIGNS) {
    it(
      `${def.name}: a straightforward build-out wins most runs`,
      { timeout: 300_000 },
      async () => {
        expect(await crowdWins(def, 'greedy')).toBeGreaterThanOrEqual(4);
      },
    );
    it(`${def.name}: building once and walking away never wins`, { timeout: 300_000 }, async () => {
      expect(await crowdWins(def, 'minimal')).toBe(0);
    });
  }
});
