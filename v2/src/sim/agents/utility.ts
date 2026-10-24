// Utility scoring for the guest brain. Every candidate activity — each game on
// the floor, each service, wandering — gets a score from the guest's needs,
// tastes and bankroll; the brain tries them best-first. Pure apart from the
// world reads, and it never draws from world.rng (see bankroll.ts for why).

import { CASHIER_BALANCE, GUEST_BALANCE } from '../../data/balance';
import { get3D } from '../../shared/catalog';
import { footprintOf } from '../build';
import type { GuestArchetype, GuestNeeds } from '../entities/Guest';
import { SeatedCasinoGame } from '../entities/machines/SeatedCasinoGame';
import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';
import { AI, ARCHETYPE_AI } from './aiBalance';
import type { BankrollProfile } from './bankroll';
import { queueLength } from './queue';

export type ServiceKind = 'toilet' | 'food-stall' | 'bar' | 'cage';

export type Choice =
  | { kind: 'service'; service: ServiceKind; score: number }
  | { kind: 'game'; machineId: string; full: boolean; score: number }
  | { kind: 'wander'; score: number };

/** What the scorer needs to know about a guest. */
export interface GuestView {
  id: string;
  archetype: GuestArchetype;
  wallet: number;
  needs: GuestNeeds;
  pos: Cell;
  profile: BankrollProfile;
  usedCashAdvance: boolean;
  /** May path into High-Limit (bankroll at or above AI.highLimitBankroll). */
  highLimitOk: boolean;
}

/**
 * How badly a need wants serving. Below GUEST_BALANCE.needThreshold it is
 * urgent and outranks any game (≥ 1.4); just above, it is an opportunistic
 * pull that a mediocre game can lose to. Bladder beats hunger beats thirst at
 * equal levels, which is v1's order.
 */
export function needUrgency(level: number, rank: number): number {
  const t = GUEST_BALANCE.needThreshold;
  if (level < t) return 1.4 + 0.1 * rank + (t - level) / t;
  const soft = t * 1.6;
  if (level < soft) return (0.35 * (soft - level)) / (soft - t);
  return 0;
}

/** Score for playing one game, or null when this guest cannot play it now. */
export function scoreGame(world: CasinoWorld, g: GuestView, machineId: string): Choice | null {
  const machine = world.machines.get(machineId);
  if (!machine || machine.broken) return null;
  const seated = machine instanceof SeatedCasinoGame;
  // A cabinet someone else holds: nothing to queue for. Checked first because
  // on a busy floor that is most cabinets, and every check below costs more.
  if (!seated && !machine.isAvailable) return null;
  const po = world.state.getObject(machineId);
  if (!po || !world.isTableOpen(machineId)) return null;
  if (g.wallet < machine.costToPlay || g.wallet < machine.minWallet) return null;
  if (!g.highLimitOk && world.floor.zoneAt(po.col, po.row) === 'highLimit') return null;
  let full = false;
  let crowding = 1;
  if (seated) {
    full = !machine.isAvailable;
    if (full && queueLength(world, machineId) >= AI.maxQueueLength) return null;
    crowding = 1 - (0.35 * machine.seatedCount) / Math.max(1, machine.seatCount);
  }
  const kind = get3D(machine.defId).game ?? 'other';
  const pref = ARCHETYPE_AI[g.archetype].prefs[kind] ?? 0.5;
  const fp = footprintOf(po.defId, po.rot);
  const d = Math.hypot(
    po.col + fp.w / 2 - (g.pos.col + 0.5),
    po.row + fp.h / 2 - (g.pos.row + 0.5),
  );
  const distance = 1 / (1 + d / AI.distanceScale);
  // Bankroll fit: a table whose minimum is several of this guest's unit bets
  // is a table they will bust out of in minutes, and they know it.
  const ratio = machine.costToPlay / Math.max(1, g.wallet * g.profile.riskFrac);
  const fit = ratio <= 1 ? 1 : ratio <= 3 ? 0.7 : ratio <= 8 ? 0.4 : 0.15;
  // The floor of 0.3 keeps any playable game ahead of aimless wandering:
  // a guest in a one-machine casino still plays the machine.
  let score = 0.3 + 0.9 * pref * distance * crowding * fit;
  if (full) score *= AI.queueFactor;
  return { kind: 'game', machineId, full, score };
}

/**
 * Every candidate this guest could do next, best first: exactly the order a
 * stable sort by score would give (ties keep world order, so runs stay
 * deterministic), but lazy. The brain takes the first choice that works,
 * usually the first, and on a floor of 2,000 games scoring them all was most
 * of the sim's tick. So games are scored chunk by chunk outward from the
 * guest, and a candidate is handed out only once it beats the best score any
 * unscored game could still reach from where it stands (see gameScoreBound).
 */
export function* rankChoices(world: CasinoWorld, g: GuestView): Generator<Choice> {
  const heap = new ChoiceHeap();
  let ord = -10; // services rank ahead of games on ties, in this order
  const service = (s: ServiceKind, score: number) => {
    if (score > 0) heap.push({ kind: 'service', service: s, score }, ord);
    ord++;
  };
  if (world.hasServiceObject('toilet')) service('toilet', needUrgency(g.needs.bladder, 2));
  if (world.hasServiceObject('food-stall')) service('food-stall', needUrgency(g.needs.hunger, 1));
  if (world.hasServiceObject('bar')) service('bar', needUrgency(g.needs.thirst, 0));
  if (!g.usedCashAdvance && g.wallet < CASHIER_BALANCE.walletThreshold) service('cage', 1.3);
  heap.push({ kind: 'wander', score: AI.wanderScore }, Infinity);

  const index = siteIndex(world);
  const gx = g.pos.col + 0.5;
  const gz = g.pos.row + 0.5;
  const order = index.chunks
    .map((sites, i) => ({ sites, d: rectDistance(gx, gz, index.rects[i]!) }))
    .filter((c) => c.sites.length > 0)
    .sort((a, b) => a.d - b.d);
  const maxPref = maxPrefFor(g.archetype);
  let next = 0;
  for (;;) {
    const bound = next < order.length ? gameScoreBound(maxPref, order[next]!.d) : -Infinity;
    const top = heap.peek();
    if (top && top.score > bound) {
      yield heap.pop()!;
      continue;
    }
    if (next >= order.length) return; // heap empty, every game scored
    for (const site of order[next++]!.sites) {
      const c = scoreGame(world, g, site.id);
      if (c) heap.push(c, site.ord);
    }
  }
}

/**
 * The most any game whose centre is `d` metres away could score for a guest
 * whose favourite game is worth `maxPref`: scoreGame with every other factor
 * (crowding, bankroll fit, not queueing) at its best. A hair of slack keeps
 * float rounding from ever ranking a game early.
 */
function gameScoreBound(maxPref: number, d: number): number {
  return 0.3 + (0.9 * maxPref) / (1 + d / AI.distanceScale) + 1e-9;
}

const maxPrefs = new Map<GuestArchetype, number>();
function maxPrefFor(archetype: GuestArchetype): number {
  let m = maxPrefs.get(archetype);
  if (m === undefined) {
    // 0.5 is scoreGame's default for a game kind the archetype has no taste for.
    m = Math.max(0.5, ...Object.values(ARCHETYPE_AI[archetype].prefs));
    maxPrefs.set(archetype, m);
  }
  return m;
}

/** Distance from a point to the nearest point of a rectangle (0 inside it). */
function rectDistance(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface Site {
  id: string;
  /** Position in world.machines: the tie-break a stable sort would use. */
  ord: number;
}

/** The floor's games bucketed by the chunk their footprint centre falls in. */
interface SiteIndex {
  revision: number;
  chunks: Site[][];
  rects: Rect[];
}

const SITE_CHUNK = 8;
const siteIndexes = new WeakMap<CasinoWorld, SiteIndex>();

function siteIndex(world: CasinoWorld): SiteIndex {
  const cached = siteIndexes.get(world);
  if (cached && cached.revision === world.machinesRevision) return cached;
  const ccols = Math.max(1, Math.ceil(world.grid.cols / SITE_CHUNK));
  const crows = Math.max(1, Math.ceil(world.grid.rows / SITE_CHUNK));
  const chunks: Site[][] = [];
  const rects: Rect[] = [];
  for (let cz = 0; cz < crows; cz++)
    for (let cx = 0; cx < ccols; cx++) {
      chunks.push([]);
      const x0 = cx * SITE_CHUNK;
      const z0 = cz * SITE_CHUNK;
      rects.push({ x0, z0, x1: x0 + SITE_CHUNK, z1: z0 + SITE_CHUNK });
    }
  let ord = 0;
  for (const id of world.machines.keys()) {
    const po = world.state.getObject(id);
    ord++;
    if (!po) continue; // scoreGame rejects it anyway
    const fp = footprintOf(po.defId, po.rot);
    // A centre on the far edge of the lot belongs to the last chunk, whose
    // rectangle still contains it.
    const cx = Math.min(ccols - 1, Math.floor((po.col + fp.w / 2) / SITE_CHUNK));
    const cz = Math.min(crows - 1, Math.floor((po.row + fp.h / 2) / SITE_CHUNK));
    chunks[cz * ccols + cx]!.push({ id, ord });
  }
  const index = { revision: world.machinesRevision, chunks, rects };
  siteIndexes.set(world, index);
  return index;
}

/** Max-heap of choices by score, ties to the lower ord. */
class ChoiceHeap {
  private items: { c: Choice; ord: number }[] = [];

  push(c: Choice, ord: number): void {
    const a = this.items;
    a.push({ c, ord });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!ChoiceHeap.before(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  peek(): Choice | undefined {
    return this.items[0]?.c;
  }

  pop(): Choice | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < a.length && ChoiceHeap.before(a[l]!, a[best]!)) best = l;
        if (r < a.length && ChoiceHeap.before(a[r]!, a[best]!)) best = r;
        if (best === i) break;
        [a[i], a[best]] = [a[best]!, a[i]!];
        i = best;
      }
    }
    return top?.c;
  }

  private static before(a: { c: Choice; ord: number }, b: { c: Choice; ord: number }): boolean {
    return a.c.score > b.c.score || (a.c.score === b.c.score && a.ord < b.ord);
  }
}
