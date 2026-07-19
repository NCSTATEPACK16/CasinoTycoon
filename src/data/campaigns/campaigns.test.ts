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

describe('campaign winnability', () => {
  for (const def of CAMPAIGNS) {
    it(`${def.name} ($${def.goalDailyProfit}/day within ${def.dayLimit} days) falls to a straightforward build-out`, () => {
      const res = runCampaign(def, 1234);
      console.log(
        `${def.name}: ${res.outcome}, best daily $${res.best}, days:`,
        res.history.map((r) => `d${r.day}=$${r.profit}`).join(' '),
      );
      expect(res.outcome).toBe('won');
    });
  }
});
