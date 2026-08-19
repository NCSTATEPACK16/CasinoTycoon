import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../../config';
import { CasinoWorld } from '../../sim/world';
import { CAMPAIGNS, type CampaignDef } from './index';

afterEach(() => eventBus.clear());

// A straightforward build-out any player might attempt: services early, a
// mechanic and a janitor once affordable, then games bought greedily with a
// small cash buffer. Each shipped campaign must be winnable this way.
function runCampaign(def: CampaignDef, seed: number) {
  const world = new CasinoWorld({ seed, autoSpawn: true });
  world.startScenario(def);
  let outcome: 'won' | 'failed' | null = null;
  eventBus.on('goalReached', () => (outcome = 'won'));
  eventBus.on('scenarioFailed', () => (outcome = 'failed'));

  const spots: { col: number; row: number }[] = [];
  for (let row = 4; row <= 26; row += 4) {
    for (let col = 4; col <= 34; col += 4) spots.push({ col, row });
  }
  let spotIdx = 0;
  const tryPlace = (defId: string): boolean => {
    while (spotIdx < spots.length) {
      const s = spots[spotIdx]!;
      if (world.canPlace(defId, s.col, s.row).ok) {
        world.place(defId, s.col, s.row);
        spotIdx++;
        return true;
      }
      spotIdx++;
    }
    return false;
  };

  const manage = () => {
    const objs = world.state.allObjects();
    const has = (id: string) => objs.some((o) => o.defId === id);
    // A revenue engine comes first; comfort and staff follow from its takings.
    if (world.machines.size === 0) {
      if (world.isObjectAllowed('blackjack-table') && world.state.cash >= 1200) {
        tryPlace('blackjack-table');
      } else if (world.isObjectAllowed('slot-machine') && world.state.cash >= 500) {
        tryPlace('slot-machine');
      }
    }
    if (world.isObjectAllowed('toilet') && !has('toilet') && world.state.cash >= 500) {
      tryPlace('toilet');
    }
    if (world.isObjectAllowed('food-stall') && !has('food-stall') && world.state.cash >= 600) {
      tryPlace('food-stall');
    }
    const kinds = [...world.staff.values()].map((s) => s.kind);
    if (world.machines.size > 0 && !kinds.includes('mechanic') && world.state.cash >= 400) {
      world.hireStaff('mechanic');
    }
    if (world.machines.size > 0 && !kinds.includes('janitor') && world.state.cash >= 400) {
      world.hireStaff('janitor');
    }
    const buffer = 150;
    for (;;) {
      if (world.isObjectAllowed('blackjack-table') && world.state.cash >= 1200 + buffer) {
        if (!tryPlace('blackjack-table')) break;
      } else if (world.isObjectAllowed('slot-machine') && world.state.cash >= 500 + buffer) {
        if (!tryPlace('slot-machine')) break;
      } else break;
    }
  };

  const maxTicks = def.dayLimit * HOURS_PER_DAY * TICKS_PER_HOUR;
  for (let t = 0; t < maxTicks && !outcome; t++) {
    if (t % 50 === 0) manage();
    world.tick();
  }
  return {
    outcome,
    best: world.scenario?.bestDailyProfit ?? null,
    history: world.ledger.history,
  };
}

// A5 modifiers put real variance on a run — a convention day and a chip
// shortage are not the same campaign. So the guard is stated the way the
// design actually means it: a straightforward build-out wins a *typical* run,
// not one privileged seed. A campaign that genuinely stopped being winnable
// still fails this, because it would lose on most seeds rather than one.
const SEEDS = [1234, 77, 909, 5150, 31337, 8, 60221];
const MIN_WINS = 4;

describe('campaign winnability', () => {
  for (const def of CAMPAIGNS) {
    it(`${def.name} ($${def.goalDailyProfit}/day within ${def.dayLimit} days) falls to a straightforward build-out`, () => {
      const results = SEEDS.map((seed) => {
        eventBus.clear();
        return { seed, ...runCampaign(def, seed) };
      });
      const wins = results.filter((r) => r.outcome === 'won');
      console.log(
        `${def.name}: won ${wins.length}/${SEEDS.length} —`,
        results.map((r) => `s${r.seed}:${r.outcome}($${Math.round(r.best ?? 0)})`).join(' '),
      );
      expect(wins.length).toBeGreaterThanOrEqual(MIN_WINS);
    });
  }
});
