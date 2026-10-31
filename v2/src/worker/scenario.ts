// B8: the scenario as the UI reads it — the HUD's one-line goal and its goal
// panel, and the end card's result (goals, medal, score).

import { goalText } from '../data/campaigns/goals';
import {
  computeCampaignScore,
  medalDays as medalDaysOf,
  medalFor,
  type Medal,
} from '../data/score';
import type { HudView } from '../shared/contracts';
import type { CasinoWorld } from '../sim/world';

/** The HUD's one line: the goal itself when there is one, else a count. */
export function goalLine(world: CasinoWorld): string {
  const sc = world.scenario;
  if (!sc) return '';
  if (sc.def.sandbox) return 'Unlimited funds';
  if (sc.def.tutorial) return 'Learn the ropes';
  const by = `by day ${sc.def.dayLimit}`;
  return sc.goals.length === 1
    ? `${goalText(sc.goals[0]!)} ${by}`
    : `${sc.goals.length} goals ${by}`;
}

/** Every goal with its progress, while there is a goal to chase. */
export function hudGoals(world: CasinoWorld): HudView['goals'] {
  const sc = world.scenario;
  if (!sc || sc.def.sandbox || sc.def.tutorial || sc.status === 'endless') return undefined;
  return sc.progress(world.scenarioFacts());
}

export interface ScenarioResult {
  scenarioId: string;
  name: string;
  status: 'active' | 'won' | 'failed' | 'endless';
  /** The close that won, or the last close for a loss. */
  day: number;
  dayLimit: number;
  medal: Medal | null;
  /** 0 for a loss. */
  score: number;
  medalDays: { gold: number; silver: number; bronze: number };
  goals: NonNullable<HudView['goals']>;
}

export function scenarioResult(world: CasinoWorld): ScenarioResult | null {
  const sc = world.scenario;
  if (!sc || sc.def.sandbox || sc.def.tutorial) return null;
  const won = sc.wonOnDay !== null;
  const day = sc.wonOnDay ?? Math.max(1, world.time.day - 1);
  // The P16 campaigns score their window average against the goal; the
  // others have no profit figure to beat, so speed and rating carry them.
  const profit = sc.def.goals ? (sc.bestDailyProfit ?? 0) : (sc.windowAverage ?? 0);
  return {
    scenarioId: sc.def.id,
    name: sc.def.name,
    status: sc.status,
    day,
    dayLimit: sc.def.dayLimit,
    medal: won ? medalFor(sc.def, day) : null,
    score: won
      ? computeCampaignScore({
          profit,
          goalDailyProfit: sc.def.goals ? 0 : sc.def.goalDailyProfit,
          day,
          dayLimit: sc.def.dayLimit,
          rating: world.rating,
        })
      : 0,
    medalDays: medalDaysOf(sc.def),
    goals: sc.progress(world.scenarioFacts()),
  };
}
