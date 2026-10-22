// What the sim needs from a game engine on top of the shared GameEngine
// contract. The contract is what the UI and the guest AI see; these extras are
// what the machines and the books need, so they stay inside sim/games rather
// than widening shared/games.ts.

import type { BaseRules, Bet, GameEngine, RngLike } from '../../shared/games';

/** One validation problem with a submitted rules object. */
export interface RulesIssue {
  field: string;
  message: string;
}

export interface CasinoEngine<R extends BaseRules = BaseRules> extends GameEngine<R> {
  /**
   * Coerce untrusted input (a save, a `setRules` command) into a legal rule set.
   * Unknown fields are dropped, out-of-range values clamped to the nearest legal
   * one, and every change is reported so the UI can say what it did.
   */
  validateRules(raw: unknown, base?: R): { rules: R; issues: RulesIssue[] };
  /** Exact house edge of one spot, as a fraction of the amount on that spot. */
  spotEdge(rules: R, spot: string): number;
  /** The bets a guest with this unit stake lays down to start a round. */
  guestBets(rules: R, unit: number, rng: RngLike): Bet[];
}

/** Expected house win for a set of opening bets: Σ amount × that spot's edge.
 *  Raises, doubles and odds are excluded because the edge is quoted per
 *  initial wager — the convention every published edge table uses. */
export function theoForBets<R extends BaseRules>(
  engine: CasinoEngine<R>,
  rules: R,
  bets: readonly Bet[],
): number {
  let theo = 0;
  for (const b of bets) theo += b.amount * engine.spotEdge(rules, b.spot);
  return theo;
}

/** Pick from a list with an injected RNG — the engines never touch Math.random. */
export function pickFrom<T>(rng: RngLike, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

// ---------- rule validation helpers ----------

export function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Read a finite number, clamped into [min, max]; fall back when missing. */
export function readNumber(
  src: Record<string, unknown>,
  field: string,
  fallback: number,
  min: number,
  max: number,
  issues: RulesIssue[],
): number {
  const v = src[field];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    issues.push({ field, message: `not a number; kept ${fallback}` });
    return fallback;
  }
  if (v < min || v > max) {
    const clamped = Math.min(max, Math.max(min, v));
    issues.push({ field, message: `${v} out of range; clamped to ${clamped}` });
    return clamped;
  }
  return v;
}

/** Read one of a fixed set of values; anything else keeps the fallback. */
export function readChoice<T extends string | number | boolean>(
  src: Record<string, unknown>,
  field: string,
  fallback: T,
  allowed: readonly T[],
  issues: RulesIssue[],
): T {
  const v = src[field];
  if (v === undefined) return fallback;
  if ((allowed as readonly unknown[]).includes(v)) return v as T;
  issues.push({ field, message: `${String(v)} is not one of ${allowed.join(', ')}` });
  return fallback;
}

/** Shared min/max-bet validation: whole dollars, min ≥ 1, max ≥ min. */
export function readLimits(
  src: Record<string, unknown>,
  base: BaseRules,
  issues: RulesIssue[],
  ceiling = 100_000,
): BaseRules {
  const minBet = Math.round(readNumber(src, 'minBet', base.minBet, 1, ceiling, issues));
  let maxBet = Math.round(readNumber(src, 'maxBet', base.maxBet, 1, ceiling, issues));
  if (maxBet < minBet) {
    issues.push({ field: 'maxBet', message: `below minBet; raised to ${minBet}` });
    maxBet = minBet;
  }
  return { minBet, maxBet };
}

/** Clamp a stake to the table's limits. */
export function clampBet(rules: BaseRules, amount: number): number {
  return Math.min(rules.maxBet, Math.max(rules.minBet, Math.round(amount)));
}
