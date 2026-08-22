import { eventBus } from '../../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../../config';
import type { CampaignDef } from '../../data/campaigns';
import { getObjectDef } from '../../data/objects';
import { CasinoWorld } from '../world';

/**
 * The strategy tournament — scripted players, run head-to-head on the same
 * seeds, so difficulty is measured rather than asserted.
 *
 * The P16 spec's finding was that the mid-game solves itself: `minimal` (build
 * once, then never touch it) tied `greedy` on 6 of 7 seeds. A balance change is
 * only meaningful if it separates strategies that ought to be separable, and
 * that is a claim about a *field* of players, not about one bot.
 *
 * This is a plain module, not a test file — `src/**\/*.test.ts` is the Vitest
 * include glob, so nothing here is collected and nothing here may import
 * `vitest`. It is imported by campaigns.test.ts and by any future spec that
 * wants to re-run the tournament.
 */

export type Strategy =
  | 'greedy'
  | 'minimal'
  | 'oneGame'
  | 'noStaff'
  | 'reckless'
  | 'managed'
  | 'levered';

export const STRATEGIES: readonly Strategy[] = [
  'greedy',
  'minimal',
  'oneGame',
  'noStaff',
  'reckless',
  'managed',
  'levered',
];

/** The seeds the winnability guard has always used. Keep them identical across
 *  specs or results stop being comparable run to run. */
export const TOURNAMENT_SEEDS: readonly number[] = [1234, 77, 909, 5150, 31337, 8, 60221];

export interface CampaignRun {
  outcome: 'won' | 'failed' | null;
  wonOnDay: number | null;
  /** Set only when outcome is 'failed'. Task 9's anti-spiral guard reads both. */
  failReason: 'timeUp' | 'insolvent' | null;
  failedOnDay: number | null;
  best: number;
  /** The run's true low-water mark, taken off the moneyChanged stream.
   *
   *  This was once sampled every 50th tick, on the bot's own acting cadence,
   *  reasoning that a trough the player could not react to was not one the
   *  strategy should answer for. That is a fair argument about *strategy* and
   *  the wrong number for *solvency* — which is all anyone reads it for.
   *  TICKS_PER_HOUR is 50, so the stride only ever sampled the top of an hour.
   *  Worse, the trough is not visible *between* ticks at all: the day-close
   *  tick charges fines, interest, wages and upkeep and then calls
   *  liquidateToLimit() before it returns, so the balance is already repaired
   *  by the time the tick ends. `closes` cannot see it either — dayEnded is
   *  emitted after liquidation.
   *
   *  The old number was provably wrong, not merely coarse: of the 26 runs in
   *  the Aug-2026 tournament that the bank forced into a sale — which happens
   *  only when the close is under the limit — 17 reported a minCash *above*
   *  that limit, hiding up to $277 of an $800 line. */
  minCash: number;
  profits: number[];
  /** Total interest the run paid. Zero across a whole tournament means debt
   *  never cost anything and criterion 3 cannot possibly separate anyone. */
  interestPaid: number;
  /** Objects the house was forced to sell. The bot never sells voluntarily, so
   *  every objectSold in a run is a liquidation. */
  forcedSales: number;
  /** Cash at each midnight close, as the day *settled* — dayEnded is emitted
   *  after liquidateToLimit(), so this is the post-liquidation balance, never
   *  the one the bank actually judged. Interest keys off the pre-liquidation
   *  figure; read minCash for that. A run that dips at 4pm and recovers by
   *  midnight still pays nothing. */
  closes: number[];
  /** Revenue objects still standing when the run ended. Acceptance criterion 4
   *  reads this on an insolvency: liquidation is only allowed to run out of
   *  things to sell once the floor is genuinely stripped, never while a
   *  saleable earner is still on it. */
  revenueObjectsAtEnd: number;
}

/** Cash held back before expanding. The only axis reckless, managed and levered
 *  differ on — a reserve is just a negative overdraft, so one number spans
 *  "hold a quarter of the line back" through to "spend the whole line". */
function bufferFor(strategy: Strategy, creditLimit: number): number {
  if (strategy === 'reckless') return 0;
  if (strategy === 'managed') return Math.max(400, creditLimit * 0.25);
  // P16: the only bot that borrows. Every other strategy gates expansion on a
  // non-negative cash threshold, so none of them could ever reach the credit
  // line however permissive canPlace became — which made the facility
  // unmeasurable rather than unused. A negative buffer expands straight into
  // the overdraft, down to the exact balance the bank liquidates against.
  if (strategy === 'levered') return -creditLimit;
  return 150; // greedy and its variants — today's winnability bot, unchanged
}

/**
 * Plays one campaign to its conclusion.
 *
 * `greedy` is the bot the winnability guard has always used, lifted verbatim:
 * services early, a mechanic and a janitor once affordable, then games bought
 * greedily on a small buffer. The others vary exactly one thing each, so a
 * difference between two runs points at that one thing.
 */
export function runCampaign(def: CampaignDef, seed: number, strategy: Strategy): CampaignRun {
  eventBus.clear();
  const world = new CasinoWorld({ seed, autoSpawn: true });
  world.startScenario(def);

  let outcome: 'won' | 'failed' | null = null;
  let wonOnDay: number | null = null;
  let failReason: 'timeUp' | 'insolvent' | null = null;
  let failedOnDay: number | null = null;
  eventBus.on('goalReached', (e) => {
    outcome = 'won';
    wonOnDay = (e as { day: number }).day;
  });
  eventBus.on('dayEnded', () => closes.push(world.state.cash));
  let forcedSales = 0;
  eventBus.on('objectSold', () => forcedSales++);
  const closes: number[] = [];
  // The trough exists only *inside* a tick — the day-close tick charges fines,
  // interest, wages and upkeep and then calls liquidateToLimit() before it
  // returns, so no per-tick or per-event-after sample can see it. Every one of
  // the sim's twelve cash mutations emits moneyChanged with the post-mutation
  // balance, so the event stream is the one exhaustive view of the curve.
  let minCash = world.state.cash;
  eventBus.on('moneyChanged', (e) => {
    minCash = Math.min(minCash, (e as { cash: number }).cash);
  });
  eventBus.on('scenarioFailed', (e) => {
    const detail = e as { day: number; reason: 'timeUp' | 'insolvent' };
    outcome = 'failed';
    failReason = detail.reason;
    failedOnDay = detail.day;
  });

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

  const buffer = bufferFor(strategy, def.creditLimit);
  const hires = strategy !== 'noStaff';
  const expands = strategy !== 'minimal' && strategy !== 'oneGame';
  // A food stall is catalogued isRevenueSource, so "exactly one revenue object"
  // has to mean the stall too, not just a second game. A toilet is a pure
  // service and stays.
  const buysStall = strategy !== 'oneGame';
  // `minimal` is the build-once-then-never-touch-it line the spec measured. It
  // stops acting the moment its opening set is on the floor — not after a fixed
  // number of ticks, which would make it a slower greedy rather than a
  // different strategy.
  let done = false;

  const manage = () => {
    if (done) return;
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
    if (
      buysStall &&
      world.isObjectAllowed('food-stall') &&
      !has('food-stall') &&
      world.state.cash >= 600
    ) {
      tryPlace('food-stall');
    }
    const kinds = [...world.staff.values()].map((s) => s.kind);
    if (
      hires &&
      world.machines.size > 0 &&
      !kinds.includes('mechanic') &&
      world.state.cash >= 400
    ) {
      world.hireStaff('mechanic');
    }
    if (hires && world.machines.size > 0 && !kinds.includes('janitor') && world.state.cash >= 400) {
      world.hireStaff('janitor');
    }
    if (expands) {
      for (;;) {
        if (world.isObjectAllowed('blackjack-table') && world.state.cash >= 1200 + buffer) {
          if (!tryPlace('blackjack-table')) break;
        } else if (world.isObjectAllowed('slot-machine') && world.state.cash >= 500 + buffer) {
          if (!tryPlace('slot-machine')) break;
        } else break;
      }
    }
    if (strategy === 'minimal') {
      const now = world.state.allObjects();
      const staffKinds = [...world.staff.values()].map((s) => s.kind);
      done =
        world.machines.size > 0 &&
        (!world.isObjectAllowed('toilet') || now.some((o) => o.defId === 'toilet')) &&
        (!world.isObjectAllowed('food-stall') || now.some((o) => o.defId === 'food-stall')) &&
        staffKinds.includes('mechanic') &&
        staffKinds.includes('janitor');
    }
  };

  const maxTicks = def.dayLimit * HOURS_PER_DAY * TICKS_PER_HOUR;
  for (let t = 0; t < maxTicks && !outcome; t++) {
    if (t % 50 === 0) manage();
    world.tick();
  }
  minCash = Math.min(minCash, world.state.cash);

  return {
    outcome,
    wonOnDay,
    failReason,
    failedOnDay,
    best: world.scenario?.bestDailyProfit ?? 0,
    minCash,
    profits: world.ledger.history.map((r) => r.profit),
    interestPaid: world.ledger.history.reduce((a, r) => a + r.interestPaid, 0),
    forcedSales,
    closes,
    revenueObjectsAtEnd: world.state.allObjects().filter((o) => {
      const d = getObjectDef(o.defId);
      return d?.category === 'game' || d?.isRevenueSource === true;
    }).length,
  };
}
