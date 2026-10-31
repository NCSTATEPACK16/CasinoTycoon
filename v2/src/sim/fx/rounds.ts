// Round-effect records: the last real round of each play, kept per machine so
// the floor can show a round that actually happened (SPEC: "what you see
// happened"). playEngineRounds records into it once per play; the worker reads
// it for objects near the camera and for the inspector.
//
// Recording never touches the RNG or the result — it only reads the settled
// round and the machine's rules — so it cannot move a single outcome.

import type { RoundFx } from '../../shared/contracts';
import type { RoundResult } from '../../shared/games';
import type { GameMath } from '../entities/machines/GameMath';
import type { RouletteRules } from '../games/roulette/roulette';
import type { SpinOutcome } from '../games/slots/parSheet';
import { PAR_SHEETS } from '../games/slots/sheets';
import type { SlotRules } from '../games/slots/slots';

export interface RoundRecord {
  /** Bumps on every record, so a reader can tell a new round from a re-read. */
  seq: number;
  fx: RoundFx;
}

/** Keyed by the machine's GameMath: one per machine, gone with its world. */
const LAST = new WeakMap<GameMath, RoundRecord>();
let seq = 0;

/** playEngineRounds' one call: remember this play's last round. */
export function recordRound(math: GameMath, round: RoundResult): void {
  LAST.set(math, { seq: ++seq, fx: toFx(math, round) });
}

export function lastRound(math: GameMath | null | undefined): RoundRecord | null {
  return (math && LAST.get(math)) ?? null;
}

function toFx(math: GameMath, r: RoundResult): RoundFx {
  const fx: RoundFx = {
    kind: math.kind,
    wagered: r.wagered,
    returned: r.returned,
    summary: r.summary,
  };
  if (math.kind === 'slots') {
    const sheet = (math.rules as unknown as SlotRules).sheet;
    const o = r.detail as SpinOutcome;
    fx.slots = { sheet, stops: stopsFor(sheet, o.window), lines: o.lineWins.map((w) => w.line) };
  } else if (math.kind === 'roulette') {
    const { pocket } = r.detail as { pocket: number };
    fx.roulette = { pocket, wheel: (math.rules as unknown as RouletteRules).wheel };
  } else if (math.kind === 'craps') {
    // A round is a whole shooter sequence; the floor throws the roll that settled it.
    const last = (r.detail as { rolls: [number, number][] }).rolls.at(-1);
    if (last) fx.craps = { dice: [last[0], last[1]] };
  }
  return fx;
}

/**
 * A stop per reel that puts exactly this window on screen. The engine reports
 * the symbols it landed on, not the stop index; any stop showing the same
 * column is the same spin to the player, so the first match is as true as any.
 */
export function stopsFor(sheetId: string, window: string[][]): number[] {
  const sheet = PAR_SHEETS[sheetId]!;
  const mid = sheet.rows === 3 ? 1 : 0;
  return window.map((col, r) => {
    const strip = sheet.reels[r]!.stops;
    const len = strip.length;
    for (let s = 0; s < len; s++)
      if (col.every((sym, row) => strip[(((s + row - mid) % len) + len) % len] === sym)) return s;
    return 0;
  });
}
