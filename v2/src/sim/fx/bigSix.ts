// The big six wheel still pays from a {p, multiplier} table (BIG_SIX_BALANCE)
// rather than a wheel engine, so its spins report a payout, not a segment.
// The floor shows a segment that agrees with what was paid: a guest is taken
// to have backed the $1 spot, so a 2× return is a $1 segment and a loss is any
// other. The table's 4× return has no exact segment (no wheel pays 3:1); it
// shows the nearest, $2. Once the big six gets a real engine (Track B's B9),
// its round reports the segment and this goes. The worker records every
// spin here (bigSix has no GameMath for playEngineRounds to record through),
// reading the settled wager and payout only.

import type { RoundFx } from '../../shared/contracts';
import type { RoundRecord } from './rounds';

/** The segments round the wheel, in the order the atlas paints them. */
export const BIG_SIX_SEGMENTS = [
  1, 2, 1, 5, 1, 2, 1, 10, 1, 2, 1, 5, 1, 20, 1, 2, 1, 5, 1, 2, 1, 10, 1, 2, 1, 5, 1, 2, 1, 40,
] as const;

/** The segment value a return of `returned` on `wagered` shows (0 = the guest's $1 lost). */
export function segmentValue(wagered: number, returned: number): number {
  if (returned <= 0 || wagered <= 0) return 0;
  return returned / wagered >= 3.5 ? 2 : 1;
}

/** A segment index for that value, varied by `seq` so repeats don't stop on the same spot. */
export function segmentFor(wagered: number, returned: number, seq: number): number {
  const v = segmentValue(wagered, returned);
  const fits = BIG_SIX_SEGMENTS.flatMap((s, i) => ((v === 0 ? s !== 1 : s === v) ? [i] : []));
  return fits[Math.abs(Math.imul(seq + 1, 2654435761) >>> 0) % fits.length]!;
}

/** The round the floor shows for a big six play. */
export function bigSixFx(wagered: number, returned: number, seq: number): RoundFx {
  const segment = segmentFor(wagered, returned, seq);
  return {
    kind: 'bigSix',
    wagered,
    returned,
    summary: returned > 0 ? `$${BIG_SIX_SEGMENTS[segment]} pays` : 'no win',
    bigSix: { segment },
  };
}

/** Keyed by the wheel itself: one per machine, gone with its world. */
const LAST = new WeakMap<object, RoundRecord>();
let seq = 0;

/** The worker's one call per big six spin (each machinePlayed is one spin). */
export function recordBigSix(machine: object, wagered: number, returned: number): RoundRecord {
  const rec = { seq: ++seq, fx: bigSixFx(wagered, returned, seq) };
  LAST.set(machine, rec);
  return rec;
}

export function lastBigSix(machine: object | null | undefined): RoundRecord | null {
  return (machine && LAST.get(machine)) ?? null;
}
