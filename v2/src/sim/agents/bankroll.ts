// The bankroll model of SPEC §7: how much a guest came to play with, how
// big they bet, and when they walk away. Drawn once per guest from a stream
// keyed on the guest id, so adding the model never shifts the world's shared
// rng — every v1 payout and spawn stays byte-identical for a seed.

import { Rng } from '../rng';
import type { GuestArchetype } from '../entities/Guest';
import { ARCHETYPE_AI } from './aiBalance';

export interface BankrollProfile {
  /** Session bankroll: the wallet at the guest's first game (see Guest.startPlaying). */
  bankroll: number;
  riskFrac: number;
  /** Walk once this much of the bankroll is gone (fraction). */
  stopLoss: number;
  /** Walk once up this much (fraction). */
  winGoal: number;
  /** Blackjack basic-strategy error rate, 0..0.25. */
  bjError: number;
  compSensitivity: number;
}

function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const span = (rng: Rng, [lo, hi]: [number, number]) => lo + (hi - lo) * rng.next();

/** A private stream for one guest's decisions (profile, tie-breaks). */
export function guestRng(id: string): Rng {
  return new Rng((hash(id) ^ 0x2545f491) >>> 0);
}

export function drawProfile(
  rng: Rng,
  archetype: GuestArchetype,
  bankroll: number,
): BankrollProfile {
  const a = ARCHETYPE_AI[archetype];
  return {
    bankroll,
    riskFrac: span(rng, a.riskFrac),
    stopLoss: span(rng, a.stopLoss),
    winGoal: span(rng, a.winGoal),
    bjError: span(rng, a.bjError),
    compSensitivity: span(rng, a.compSensitivity),
  };
}

/** Unit bet = clamp(bankroll × riskFrac, table min, table max). */
export function unitBet(p: BankrollProfile, wallet: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(wallet * p.riskFrac)));
}

export type StopReason = 'stopLoss' | 'winGoal' | null;

/** Measured on gambling results only (`sessionNet` = Σ payout − wager), not
 *  on the wallet: a cash advance, a comp or a sandwich is neither a win nor a
 *  loss, and must not end a session. Broke is a separate, wallet-based rule. */
export function stopReason(p: BankrollProfile, sessionNet: number): StopReason {
  if (-sessionNet >= p.bankroll * p.stopLoss) return 'stopLoss';
  if (sessionNet >= p.bankroll * p.winGoal) return 'winGoal';
  return null;
}
