import { describe, expect, it } from 'vitest';
import { runCampaign, type CampaignRun, type Strategy } from '../../sim/__testkit__/strategies';
import { TOURNAMENT_SEEDS } from '../../sim/__testkit__/strategies';
import { CAMPAIGNS } from './index';

// P16 acceptance bars — spec §5 criteria 1, 3, 4 and 5. Criterion 2 (a
// straightforward build-out still wins a typical run) stays in campaigns.test.ts
// where it has always lived; criterion 6 is covered by world.attribution.test.ts.
//
// These are measurements, not unit tests: each asserts a *margin between
// strategies*. A failure here means the balance constants are wrong, not that a
// function misbehaved.
//
// Every run is memoised by campaign/seed/strategy. The four criteria overlap
// heavily — criterion 4 re-reads exactly the greedy runs criterion 1 already
// played — and a full campaign is thousands of ticks, so without this the file
// simulates the same seasons three times over.
const cache = new Map<string, CampaignRun>();
function run(defIndex: number, seed: number, strategy: Strategy): CampaignRun {
  const key = `${defIndex}|${seed}|${strategy}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = runCampaign(CAMPAIGNS[defIndex]!, seed, strategy);
    cache.set(key, hit);
  }
  return hit;
}

const wins = (defIndex: number, strategy: Strategy) =>
  TOURNAMENT_SEEDS.filter((s) => run(defIndex, s, strategy).outcome === 'won').length;

describe('the game does not solve itself', () => {
  for (let i = 0; i < CAMPAIGNS.length; i++) {
    const def = CAMPAIGNS[i]!;

    // Criterion 1. The direct machine-checkable statement of the whole spec:
    // playing well must beat building once and walking away. Before P16 this
    // margin was 0 on The Dusty Dime.
    it(`${def.name}: active play beats build-and-abandon`, { timeout: 300_000 }, () => {
      expect(wins(i, 'greedy') - wins(i, 'minimal')).toBeGreaterThanOrEqual(3);
    });

    // Criterion 5. A campaign won on one lucky modifier day is a campaign the
    // player did not earn.
    it(`${def.name}: cannot be won on a single day`, () => {
      expect(def.goalWindowDays).toBeGreaterThanOrEqual(2);
    });

    // Criterion 6. The stronger form of criterion 1, and the harder bar: a
    // player who builds the opening set and never touches the casino again
    // must not win *at all*. A margin of 3 is satisfied by 5-2; this is not.
    //
    // The Dusty Dime failed this until P16 retuned it, and the fix was not the
    // goal figure. At $2000 starting cash a greedy player could afford roughly
    // what `minimal` builds and then stopped, so the two produced near-identical
    // casinos — and no goal separates distributions sitting on top of each
    // other. Starting cash is the lever, because `minimal` banks every dollar
    // past its opening set while an active player keeps spending it.
    it(`${def.name}: build-and-abandon never wins`, { timeout: 300_000 }, () => {
      expect(wins(i, 'minimal')).toBe(0);
    });
  }

  // Criterion 3. If reckless ties managed, interest and the credit limit did
  // not create a decision and the constants are wrong — not the test.
  it('rewards holding a reserve over spending every last dollar', { timeout: 300_000 }, () => {
    let managedTotal = 0;
    let recklessTotal = 0;
    for (let i = 0; i < CAMPAIGNS.length; i++) {
      managedTotal += wins(i, 'managed');
      recklessTotal += wins(i, 'reckless');
    }
    expect(managedTotal).toBeGreaterThan(recklessTotal);
  });

  // Criterion 4. The anti-death-spiral guard. Liquidation is the release
  // valve; if a run can be killed by the opening build, it is not working.
  it('never bankrupts a player before day 2', { timeout: 300_000 }, () => {
    for (let i = 0; i < CAMPAIGNS.length; i++) {
      for (const seed of TOURNAMENT_SEEDS) {
        const r = run(i, seed, 'greedy');
        if (r.outcome === 'failed' && r.failReason === 'insolvent') {
          const where = `${CAMPAIGNS[i]!.name} seed ${seed}`;
          expect(r.failedOnDay, where).toBeGreaterThanOrEqual(2);
          // The second half of criterion 4: liquidation is only allowed to run
          // out of things to sell once the floor is stripped to its protected
          // core. Insolvency while a second earner was still standing would
          // mean the selection rule refused a sale that would have saved the
          // run.
          expect(r.revenueObjectsAtEnd, where).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
