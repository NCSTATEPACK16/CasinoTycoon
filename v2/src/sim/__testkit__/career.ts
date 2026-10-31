import { eventBus } from '../../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../../config';
import type { CampaignDef } from '../../data/campaigns';
import { getObjectDef } from '../../data/objects';
import type { CellRect, Zone } from '../../shared/contracts';
import { get3D } from '../../shared/catalog';
import { paintZoneRect } from '../build';
import { WorldNav } from '../nav/WorldNav';
import type { StaffKind } from '../entities/staff/Staff';
import { CasinoWorld } from '../world';

/**
 * B8: the career bot. The P16 tournament (`strategies.ts`) plays the three
 * original campaigns on an open 40×30 lot with a fixed list of spots; the B8
 * scenarios have their own lots, walls, zones and goals, so this bot plays
 * them the way the game does: on the scenario's starter floor, with dealers
 * required, placing by zone and nearest the door first, and doing what each
 * scenario's goal asks for (a `CareerPlan`). Like strategies.ts it is a plain
 * module, not a test file.
 *
 * `active` is "a reasonable player": open with a game, add services and
 * staff as the floor grows, keep a reserve and keep buying. `minimal` builds
 * the same opening set and then never touches the casino again: the
 * do-nothing bar every scenario must not fall to.
 */

export type CareerStrategy = 'active' | 'minimal';

export interface CareerPlan {
  /** Games to buy, best first: the first affordable one is taken. */
  ladder: readonly string[];
  /** Cash held back before buying another game. */
  reserve: number;
  /** Paint this room high-limit once cash allows, then put these games in it. */
  highLimit?: { rect: CellRect; games: readonly string[]; after: number };
  /** Once this many games stand, pay loans down from cash above the reserve. */
  repayAfter?: number;
  /** Comp eligible club members (drinks, then meals) to bring them back. */
  comps?: boolean;
  /** Stop buying games past this many, for a floor that must stay small. */
  maxGames?: number;
  /** Buy the ladder in even numbers (the least-owned affordable game) rather
   *  than the best affordable, for a floor whose mix is the point. */
  balance?: boolean;
}

export interface CareerRun {
  outcome: 'won' | 'failed' | null;
  day: number | null;
  failReason: 'timeUp' | 'insolvent' | null;
  /** Each goal's progress line at the end, for the log. */
  goals: string[];
  games: number;
  peakGuests: number;
}

/** A world started on `def` the way the worker starts one, optionally with
 *  the Recast crowd attached (the real game). */
export async function careerWorld(
  def: CampaignDef,
  seed: number,
  crowd: boolean,
): Promise<CasinoWorld> {
  const world = new CasinoWorld({ seed, starterFloor: true, requireDealers: true });
  world.startScenario(def);
  if (crowd) world.attachNav(await WorldNav.create(world));
  return world;
}

/** Placement spots: a 4×4 lattice of blocks, each holding one 2×2 table or a
 *  row of three 1-cell machines (seats face the aisle below), kept off door
 *  aprons, nearest the entrance first so guests reach games early. */
function latticeSpots(world: CasinoWorld): { col: number; row: number }[] {
  const { floor } = world;
  const apron = new Set<number>();
  const key = (c: number, r: number) => r * floor.cols + c;
  for (const w of floor.allWalls()) {
    if (!w.door) continue;
    const other = w.edge === 'w' ? { col: w.col - 1, row: w.row } : { col: w.col, row: w.row - 1 };
    for (const c of [w, other])
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) apron.add(key(c.col + dc, c.row + dr));
  }
  const spots: { col: number; row: number; d: number }[] = [];
  const e = floor.entrance;
  for (let row = 2; row < floor.rows - 2; row += 4) {
    for (let col = 2; col < floor.cols - 2; col += 4) {
      for (let i = 0; i < 3; i++) {
        const c = col + i;
        if (apron.has(key(c, row)) || apron.has(key(c, row + 1))) continue;
        spots.push({ col: c, row, d: Math.abs(c - e.col) + Math.abs(row - e.row) });
      }
    }
  }
  return spots.sort((a, b) => a.d - b.d);
}

export function runCareer(
  def: CampaignDef,
  world: CasinoWorld,
  strategy: CareerStrategy,
  plan: CareerPlan,
): CareerRun {
  let outcome: CareerRun['outcome'] = null;
  let day: number | null = null;
  let failReason: CareerRun['failReason'] = null;
  const offGoal = eventBus.on('goalReached', (e) => {
    outcome = 'won';
    day = (e as { day: number }).day;
  });
  const offFail = eventBus.on('scenarioFailed', (e) => {
    const d = e as { day: number; reason: 'timeUp' | 'insolvent' };
    outcome = 'failed';
    day = d.day;
    failReason = d.reason;
  });

  const spots = latticeSpots(world);
  /** Put `defId` down on the nearest free spot (in `zone`, when given). */
  const put = (defId: string, zone?: Zone): boolean => {
    const zones = get3D(defId).zones;
    for (const s of spots) {
      const at = world.floor.zoneAt(s.col, s.row);
      if (zone ? at !== zone : zones.length > 0 && !zones.includes(at)) continue;
      // A 2×2 table sits at the block's corner only.
      const fp = getObjectDef(defId)!.footprint;
      if ((fp.w > 1 || fp.h > 1) && (s.col - 2) % 4 !== 0) continue;
      if (!world.canPlace(defId, s.col, s.row).ok) continue;
      if (world.place(defId, s.col, s.row)) return true;
    }
    return false;
  };
  const count = (pred: (defId: string) => boolean) =>
    world.state.allObjects().filter((o) => pred(o.defId)).length;
  const isGame = (id: string) => getObjectDef(id)?.category === 'game';
  const staffOf = (k: StaffKind) => [...world.staff.values()].filter((s) => s.kind === k).length;
  const cost = (id: string) => getObjectDef(id)!.cost;
  const allowed = (id: string) => world.isObjectAllowed(id);

  let done = false;
  let painted = false;
  const manage = () => {
    if (done) return;
    const cash = () => world.state.cash;
    // A revenue engine first, with no reserve: there is nothing to hold one for.
    if (count(isGame) === 0) {
      const first = plan.ladder.find((id) => allowed(id) && cash() >= cost(id));
      if (first) put(first);
    }
    const games = count(isGame);
    const guests = world.guests.size;
    // Comfort scales with the crowd: a restroom per 15 guests, a stall per 30.
    if (allowed('toilet') && count((d) => d === 'toilet') < Math.max(1, Math.ceil(guests / 15)))
      if (cash() >= 300 + plan.reserve / 2 || count((d) => d === 'toilet') === 0) put('toilet');
    if (
      allowed('food-stall') &&
      count((d) => d === 'food-stall') < Math.max(1, Math.ceil(guests / 30))
    )
      if (cash() >= 400 + plan.reserve / 2 || count((d) => d === 'food-stall') === 0)
        put('food-stall');
    if (games > 0) {
      if (staffOf('mechanic') < Math.max(1, Math.ceil(games / 25)) && cash() >= 400)
        world.hireStaff('mechanic');
      if (staffOf('janitor') < Math.max(1, Math.ceil(guests / 40)) && cash() >= 400)
        world.hireStaff('janitor');
      const tables = [...world.machines.values()].filter((m) => m.needsDealer).length;
      if (tables > staffOf('dealer') && cash() >= 200) world.hireStaff('dealer');
    }
    if (strategy === 'minimal') {
      done =
        games > 0 &&
        (!allowed('toilet') || count((d) => d === 'toilet') > 0) &&
        (!allowed('food-stall') || count((d) => d === 'food-stall') > 0) &&
        staffOf('mechanic') > 0 &&
        staffOf('janitor') > 0;
      return;
    }
    if (guests > 40 && staffOf('security') === 0 && cash() >= 600) world.hireStaff('security');
    if (plan.repayAfter !== undefined && games >= plan.repayAfter) {
      for (const loan of [...world.loans.loans]) {
        const spare = cash() - plan.reserve;
        if (spare > 0) world.repayLoan(loan.id, spare);
      }
    }
    if (plan.highLimit && games >= plan.highLimit.after) {
      const hl = plan.highLimit;
      if (!painted && cash() >= 2000) {
        const r = paintZoneRect(world.state, world.grid, world.floor, hl.rect, 'highLimit');
        if (r.ok) {
          if (r.changed > 0) world.onFloorEdited(hl.rect);
          painted = true;
        }
      }
      if (painted) {
        for (const id of hl.games) {
          if (!allowed(id) || cash() < cost(id) + plan.reserve) continue;
          put(id, 'highLimit');
          break;
        }
      }
    }
    if (plan.comps) {
      for (const g of world.guests.values()) {
        if (!g.patronId || !g.compEligible || cash() < plan.reserve) continue;
        if (!world.sendComp(g.id, 'drink')) world.sendComp(g.id, 'meal');
      }
    }
    // Saving for the high-limit room: buy nothing else until it is painted.
    if (plan.highLimit && games >= plan.highLimit.after && !painted) return;
    // Keep buying while cash, the ladder and the floor allow: one of each
    // first (variety is a rating term), then the best affordable.
    for (;;) {
      if (plan.maxGames !== undefined && count(isGame) >= plan.maxGames) break;
      const ok = (id: string) => allowed(id) && cash() >= cost(id) + plan.reserve;
      const owned = (id: string) => count((d) => d === id);
      const next = plan.balance
        ? plan.ladder
            .filter(ok)
            .reduce<string | undefined>((b, id) => (b && owned(b) <= owned(id) ? b : id), undefined)
        : (plan.ladder.find((id) => ok(id) && owned(id) === 0) ?? plan.ladder.find(ok));
      if (!next || !put(next)) break;
    }
  };

  const maxTicks = def.dayLimit * HOURS_PER_DAY * TICKS_PER_HOUR;
  for (let t = 0; t < maxTicks && !outcome; t++) {
    if (t % 50 === 0) manage();
    world.tick();
  }
  offGoal();
  offFail();
  const sc = world.scenario!;
  return {
    outcome,
    day,
    failReason,
    goals: sc.progress(world.scenarioFacts()).map((p) => `${p.met ? '✓' : '✗'} ${p.progress}`),
    games: count(isGame),
    peakGuests: sc.peakGuests,
  };
}

/** What a reasonable player does in each B8 scenario. Each plan uses only
 *  objects the career has unlocked by the time the scenario opens. */
export const CAREER_PLANS: Record<string, CareerPlan> = {
  'lucky-strike': {
    ladder: ['blackjack-table', 'slot-machine', 'roulette-table', 'penny-slots'],
    reserve: 300,
  },
  'velvet-rope': {
    ladder: ['blackjack-table', 'roulette-table', 'craps-table', 'slot-machine'],
    reserve: 500,
    comps: true,
    highLimit: {
      rect: { col0: 20, row0: 19, col1: 33, row1: 25 },
      games: ['high-limit-table'],
      after: 2,
    },
  },
  'house-rules': {
    ladder: ['slot-machine', 'video-poker'],
    reserve: 400,
    balance: true,
  },
  'the-salon': {
    ladder: ['blackjack-table', 'roulette-table', 'craps-table', 'slot-machine'],
    reserve: 600,
    highLimit: {
      rect: { col0: 26, row0: 4, col1: 39, row1: 11 },
      games: ['high-limit-table', 'blackjack-table'],
      after: 4,
    },
  },
  'clean-slate': {
    ladder: ['blackjack-table', 'slot-machine', 'roulette-table'],
    reserve: 800,
    repayAfter: 8,
  },
  'the-strip': {
    ladder: ['blackjack-table', 'roulette-table', 'craps-table', 'slot-machine', 'penny-slots'],
    reserve: 1000,
  },
};
