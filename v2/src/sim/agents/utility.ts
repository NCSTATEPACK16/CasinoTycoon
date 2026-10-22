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
  const po = world.state.getObject(machineId);
  if (!machine || !po || machine.broken || !world.isTableOpen(machineId)) return null;
  if (g.wallet < machine.costToPlay || g.wallet < machine.minWallet) return null;
  if (!g.highLimitOk && world.floor.zoneAt(po.col, po.row) === 'highLimit') return null;
  const seated = machine instanceof SeatedCasinoGame;
  let full = false;
  let crowding = 1;
  if (seated) {
    full = !machine.isAvailable;
    if (full && queueLength(world, machineId) >= AI.maxQueueLength) return null;
    crowding = 1 - (0.35 * machine.seatedCount) / Math.max(1, machine.seatCount);
  } else if (!machine.isAvailable) {
    return null; // a cabinet someone else holds: nothing to queue for
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

/** Every candidate this guest could do next, best first. */
export function rankChoices(world: CasinoWorld, g: GuestView): Choice[] {
  const out: Choice[] = [];
  const service = (s: ServiceKind, score: number) => {
    if (score > 0) out.push({ kind: 'service', service: s, score });
  };
  if (world.hasServiceObject('toilet')) service('toilet', needUrgency(g.needs.bladder, 2));
  if (world.hasServiceObject('food-stall')) service('food-stall', needUrgency(g.needs.hunger, 1));
  if (world.hasServiceObject('bar')) service('bar', needUrgency(g.needs.thirst, 0));
  if (!g.usedCashAdvance && g.wallet < CASHIER_BALANCE.walletThreshold) service('cage', 1.3);
  for (const id of world.machines.keys()) {
    const c = scoreGame(world, g, id);
    if (c) out.push(c);
  }
  out.push({ kind: 'wander', score: AI.wanderScore });
  // Stable sort: equal scores keep world order, so ties are deterministic.
  return out.sort((a, b) => b.score - a.score);
}
