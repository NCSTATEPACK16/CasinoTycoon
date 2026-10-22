// The shared play loop for engine-backed machines: one guest "play" is a run
// of real rounds at a fraction of the machine's stake (ENGINE_BALANCE.playShape),
// stopping early when the guest's wallet can no longer cover the next bet.

import { ENGINE_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayContext, PlayResult } from './CasinoGame';
import type { GameMath } from './GameMath';

/**
 * Rounds this play deals: the reference count, scaled by how much faster or
 * slower this table runs than a two-player table with a dealer. The fraction
 * is rounded stochastically so a half-speed table really deals half as much
 * over a day rather than snapping to the same integer.
 */
export function roundsForPlay(
  math: GameMath,
  defId: string,
  seated: number,
  dealerSpeed: number,
  rng: Rng,
): number {
  const base = playShape(defId).rounds;
  const ref = math.roundsPerHour(ENGINE_BALANCE.referenceSeated);
  const expected = (base * math.roundsPerHour(Math.max(1, seated), dealerSpeed)) / ref;
  const whole = Math.floor(expected);
  return Math.max(1, whole + (rng.next() < expected - whole ? 1 : 0));
}

export function playShape(defId: string): { rounds: number; handle: number } {
  return ENGINE_BALANCE.playShape[defId] ?? { rounds: 1, handle: 1 };
}

/** One round's opening stake for a play at this machine's stake. Fixed per
 *  play, so a faster table deals more handle rather than smaller bets. */
export function roundStake(defId: string, stake: number): number {
  const shape = playShape(defId);
  return (stake * shape.handle) / shape.rounds;
}

export function playEngineRounds(
  math: GameMath,
  rounds: number,
  rng: Rng,
  ctx: PlayContext,
): PlayResult {
  let wager = 0;
  let payout = 0;
  let theo = 0;
  let dealt = 0;
  let summary: string | undefined;
  for (let i = 0; i < rounds; i++) {
    const r = math.playRound({ ...ctx, wallet: ctx.wallet - wager + payout }, rng);
    if (!r) break;
    wager += r.wagered;
    payout += r.returned;
    theo += r.theo;
    summary = r.summary;
    dealt++;
  }
  // Cents are the smallest chip; slot pays at a penny denomination stay exact.
  return {
    wager: Math.round(wager * 100) / 100,
    payout: Math.round(payout * 100) / 100,
    theo,
    rounds: dealt,
    summary,
  };
}
