import { eventBus } from '../../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../../config';
import type { CampaignDef } from '../../data/campaigns';
import { getObjectDef, OBJECT_CATALOG } from '../../data/objects';
import { CasinoWorld } from '../world';
import { tierForCrowd } from '../tableTuning';
import { TABLE_MINIMUMS } from '../../data/balance';

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
  | 'levered'
  | 'tuned'
  | 'mistuned'
  | 'catalogue'
  | 'throughput'
  | 'workingFloor'
  | 'minimalTier1';

export const STRATEGIES: readonly Strategy[] = [
  'greedy',
  'minimal',
  'oneGame',
  'noStaff',
  'reckless',
  'managed',
  'levered',
  'tuned',
  'mistuned',
  'catalogue',
  'throughput',
  'workingFloor',
  'minimalTier1',
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
  /** Every distinct game defId this run ever placed. P17 acceptance criterion 4
   *  ("no dead stock") is a statement about what bots actually buy, and without
   *  this the tournament can only report that a strategy won, not what it won
   *  with — which is exactly the blind spot B2 exists to close. */
  gamesBuilt: string[];
  /** Revenue objects still standing when the run ended. Acceptance criterion 4
   *  reads this on an insolvency: liquidation is only allowed to run out of
   *  things to sell once the floor is genuinely stripped, never while a
   *  saleable earner is still on it. */
  revenueObjectsAtEnd: number;
}

/**
 * P17 B2 — what a strategy is willing to buy, in the order it prefers it.
 *
 * The spec calls this the single highest-risk item in the whole of P17, and the
 * reason is worth stating plainly: before this, every bot's entire purchasing
 * logic was "blackjack-table if cash >= 1200, else slot-machine". Add games to
 * the catalogue and change nothing here, and every acceptance bar in
 * difficulty.test.ts carries on measuring a floor the player would no longer
 * build — the bars stay green and stop meaning anything.
 *
 * The fix deliberately does NOT change what `greedy` buys. LEGACY_LADDER is
 * that same pair, now expressed as data and priced from the catalogue rather
 * than from two hardcoded numbers, so every P16 measurement stays comparable
 * run for run. Rewriting greedy to chase the widest catalogue would have moved
 * all of P16's numbers at the same moment the new games arrived, leaving no way
 * to tell a balance regression from a bot that simply started shopping
 * differently.
 *
 * Instead the new catalogue gets its own lines, and they are what the Tier 1
 * measurements read.
 */
const LEGACY_LADDER: readonly string[] = ['blackjack-table', 'slot-machine'];

/** Every game in the catalogue, dearest first — "buy the best you can afford",
 *  which is what greedy's two-rung ladder always was in miniature. */
const CATALOGUE_BY_COST: readonly string[] = OBJECT_CATALOG.filter((d) => d.category === 'game')
  .slice()
  .sort((a, b) => b.cost - a.cost)
  .map((d) => d.id);

/** The Tier 1 throughput line: fill dead floor with cheap volume. Bought
 *  round-robin rather than cheapest-first, because cheapest-first would carpet
 *  the floor in penny slots and never exercise the other three — and "every
 *  game is bought by at least one winning line" is an acceptance criterion. */
const TIER1_SPREAD: readonly string[] = ['penny-slots', 'pachinko', 'video-poker', 'keno-lounge'];

/** Tier 2's working floor, same round-robin shape and for the same reason: a
 *  cost-ordered ladder would buy one game forever and leave the other three
 *  unmeasured. `sports-book` is absent because it has no catalogue entry — its
 *  scheduled-settlement mechanic is deferred, see balance.ts. */
const TIER2_SPREAD: readonly string[] = ['sic-bo', 'three-card-poker', 'pai-gow', 'bingo-hall'];

function purchaseLadder(strategy: Strategy): readonly string[] {
  if (strategy === 'catalogue') return CATALOGUE_BY_COST;
  if (strategy === 'throughput' || strategy === 'minimalTier1') return TIER1_SPREAD;
  if (strategy === 'workingFloor') return TIER2_SPREAD;
  return LEGACY_LADDER;
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
export function runCampaign(
  def: CampaignDef,
  seed: number,
  strategy: Strategy,
  /** Restrict this run to these games only.
   *
   *  The ablation hook for acceptance criterion 4. Asking "is this game bought
   *  by a winning line" is nearly tautological when the bot's ladder names it
   *  outright — a game with a 0.1% edge would pass. Handing a run ONE game and
   *  measuring whether it is still a going concern asks the question criterion
   *  4 is actually for: is this thing worth buying? */
  ladderOverride?: readonly string[],
): CampaignRun {
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

  const gamesBuilt = new Set<string>();
  const ladder = ladderOverride ?? purchaseLadder(strategy);
  // `throughput` spreads across its ladder instead of draining the first
  // affordable rung; every other strategy takes the first rung it can afford,
  // which is exactly what the old two-branch if/else did.
  const spreads = strategy === 'throughput' || strategy === 'workingFloor';
  let ladderCursor = 0;
  /** Buy the best game this strategy can afford while keeping `reserve` back.
   *  Returns false when nothing is affordable, allowed, or placeable. */
  const buyGame = (reserve: number): boolean => {
    const affordable = (defId: string): boolean => {
      const objDef = getObjectDef(defId);
      return (
        !!objDef && world.isObjectAllowed(defId) && world.state.cash >= objDef.cost + reserve
      );
    };
    const take = (defId: string): boolean => {
      // Out of floor, not out of money — stop, rather than walking down to a
      // cheaper rung that has nowhere to go either.
      if (!tryPlace(defId)) return false;
      gamesBuilt.add(defId);
      return true;
    };

    if (spreads) {
      // One of each first — CHEAPEST of the unowned that is affordable — and
      // only then a second copy of anything.
      //
      // Two orderings were tried and measured before this one. A plain
      // round-robin cursor fell back to a cheap rung whenever the next was
      // briefly unaffordable and reset the cursor behind itself, so
      // `workingFloor` bought sic bo and three-card poker over and over and
      // reached pai gow and bingo on zero of fourteen runs. Dearest-first fixed
      // that and broke the mirror image of it: the opening bankroll went
      // straight into the $1,450 bingo hall, and the set completed at two games
      // on The Dusty Dime and three on Neon Nights, with three-card poker never
      // bought on any of the fourteen.
      //
      // Cheapest-first completes the set for the least capital, which is what
      // "every game is bought by a winning line" actually measures. It does NOT
      // reintroduce the penny-slot carpet the cost-ordered `catalogue` ladder
      // has, because this branch only ever considers games it does not already
      // own — repeats fall through to the round-robin below.
      //
      // And while the set is incomplete the line SAVES rather than buying a
      // second copy of something it already owns. Without that it never
      // completed at all: cheapest-first bought sic bo and three-card poker,
      // then spent every subsequent dollar on more of the same two through the
      // round-robin below, and never once held the $1,150 pai gow needs.
      const unowned = ladder.filter((id) => !gamesBuilt.has(id));
      if (unowned.length > 0) {
        const cheapest = unowned.reduce((best, id) =>
          getObjectDef(id)!.cost < getObjectDef(best)!.cost ? id : best,
        );
        return affordable(cheapest) ? take(cheapest) : false;
      }
      for (let i = 0; i < ladder.length; i++) {
        const idx = (ladderCursor + i) % ladder.length;
        if (!affordable(ladder[idx]!)) continue;
        ladderCursor = idx + 1;
        return take(ladder[idx]!);
      }
      return false;
    }

    for (const defId of ladder) {
      if (!affordable(defId)) continue;
      return take(defId);
    }
    return false;
  };

  const buffer = bufferFor(strategy, def.creditLimit);
  const hires = strategy !== 'noStaff';
  const expands = strategy !== 'minimal' && strategy !== 'oneGame' && strategy !== 'minimalTier1';
  // P16 — the only bot that makes a decision costing no capital. Identical to
  // greedy in every buying choice, so any difference between the two is the
  // dial and nothing else.
  const tunesTables = strategy === 'tuned' || strategy === 'mistuned';
  // The control. Reads the same signals and draws the opposite conclusion —
  // gate up when the crowd is broke, down when it is rich. If `tuned` and
  // `mistuned` finish level with `greedy`, the dial is inert; if `mistuned`
  // loses, the dial is live and greedy's default was simply already good.
  const invertsTables = strategy === 'mistuned';
  // A food stall is catalogued isRevenueSource, so "exactly one revenue object"
  // has to mean the stall too, not just a second game. A toilet is a pure
  // service and stays.
  const buysStall = strategy !== 'oneGame';
  // `minimalTier1` is the same build-once line pointed at the Tier 1 ladder —
  // the control that proves P16's criterion 6 ("build-and-abandon never wins")
  // survives the new catalogue rather than merely having survived it by luck.
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
    // No buffer on the opening buy — there is nothing yet to hold a reserve for.
    if (world.machines.size === 0) buyGame(0);
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
      while (buyGame(buffer)) {
        /* keep buying until cash, the ladder or the floor runs out */
      }
    }
    if (tunesTables) {
      // Set each table against the crowd the day's conditions announced. The
      // high-roller bias says who is coming; walletMult says what they brought.
      const richBias = world.modifiers.archetypeBias('highRoller');
      const walletMult = world.modifiers.walletMult();
      for (const machine of world.machines.values()) {
        if (!machine.supportsMinimum) continue;
        const base = TABLE_MINIMUMS.defaultByType[machine.defId];
        if (base === undefined) continue;
        const purse = richBias * walletMult;
        machine.setTableMinimum(
          invertsTables
            ? tierForCrowd(base, 1 / (purse || 1), 1)
            : tierForCrowd(base, richBias, walletMult),
        );
      }
    }
    if (strategy === 'minimal' || strategy === 'minimalTier1') {
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
    gamesBuilt: [...gamesBuilt],
    revenueObjectsAtEnd: world.state.allObjects().filter((o) => {
      const d = getObjectDef(o.defId);
      return d?.category === 'game' || d?.isRevenueSource === true;
    }).length,
  };
}
