// Plays sampled real rounds on the objects near the camera. The worker sends a
// roundFx event per play at a watched object (setInterest); this shows one
// round per object at a watchable pace, and when it finishes takes the newest
// round that arrived meanwhile and drops the rest — a table deals faster than
// anyone could watch. The win (label, flash, sound) fires at the moment the
// round's result is revealed, from that round's own numbers.

import type { RoundFx } from '../../shared/contracts';
import type { ObjectLayer } from '../ObjectLayer';
import type { Overlays } from '../Overlays';
import { durationScale, revealTime, reelStopTime } from './reels';
import { PAR_SHEETS } from '../../sim/games/slots/sheets';

/** A win this large (or this many times the stake) gets the jackpot treatment. */
export const BIG_WIN = 1_000;
export const BIG_MULTIPLE = 50;
/** How long a revealed result stays before the next round may start. */
const HOLD_S = 0.9;

export type FxSound = (
  name: string,
  at: { x: number; y: number; z: number },
  delay?: number,
) => void;

interface Pending {
  fx: RoundFx;
}

interface Cue {
  at: number;
  run: () => void;
}

export class FxDirector {
  /** Sim speed, from the HUD: spins run shorter at 2× and 4×. */
  speed = 1;
  sound: FxSound = () => {};
  /** Rounds shown, per kind; read by playtests. */
  readonly stats = { shown: {} as Record<string, number>, dropped: 0, revealed: 0 };
  /** The round each object is showing (or last showed); read by playtests. */
  readonly showing = new Map<string, RoundFx>();
  private busyUntil = new Map<string, number>();
  private pending = new Map<string, Pending>();
  private cues: Cue[] = [];
  private now = 0;

  constructor(
    private objects: ObjectLayer,
    private overlays: Overlays,
  ) {}

  /** A round arrived for an object: show it now, or queue it as the newest. */
  round(objectId: string, fx: RoundFx): void {
    if ((this.busyUntil.get(objectId) ?? -Infinity) > this.now) {
      if (this.pending.has(objectId)) this.stats.dropped++;
      this.pending.set(objectId, { fx });
      return;
    }
    this.start(objectId, fx);
  }

  update(now: number): void {
    this.now = now;
    if (this.cues.length) {
      const due = this.cues.filter((c) => c.at <= now);
      if (due.length) {
        this.cues = this.cues.filter((c) => c.at > now);
        for (const c of due) c.run();
      }
    }
    for (const [id, until] of this.busyUntil) {
      if (until > now) continue;
      this.busyUntil.delete(id);
      const next = this.pending.get(id);
      if (next) {
        this.pending.delete(id);
        this.start(id, next.fx);
      }
    }
  }

  private start(id: string, fx: RoundFx): void {
    const at = this.objects.centreOf(id);
    if (!at) return;
    this.stats.shown[fx.kind] = (this.stats.shown[fx.kind] ?? 0) + 1;
    this.showing.set(id, fx);
    if (fx.slots) return this.spinSlot(id, fx, { x: at.x, y: 1.2, z: at.z });
    // A game with no motion yet: reveal at once.
    this.reveal(id, fx, { x: at.x, y: 1.2, z: at.z }, this.now);
  }

  private spinSlot(id: string, fx: RoundFx, at: { x: number; y: number; z: number }): void {
    const s = fx.slots!;
    const n = PAR_SHEETS[s.sheet]?.reels.length ?? s.stops.length;
    const dur = durationScale(this.speed);
    const t0 = this.now;
    this.objects.setReels(id, { sheet: s.sheet, stops: s.stops, t0, dur });
    this.sound('reelSpin', at);
    for (let r = 0; r < n; r++)
      this.cue(reelStopTime(t0, r, n, dur), () => this.sound('reelStop', at));
    this.reveal(id, fx, at, revealTime(t0, n, dur));
  }

  /** The result lands at `when`: label, flash and sound from this round alone. */
  private reveal(
    id: string,
    fx: RoundFx,
    at: { x: number; y: number; z: number },
    when: number,
  ): void {
    this.busyUntil.set(id, when + HOLD_S);
    this.cue(when, () => {
      this.stats.revealed++;
      if (fx.returned <= 0) return;
      this.overlays.spawnPayout(at.x, at.z, fx.returned);
      this.objects.flash(id, this.now);
      const big = fx.returned >= BIG_WIN || fx.returned >= fx.wagered * BIG_MULTIPLE;
      if (big) {
        this.sound('jackpot', at);
        this.sound('hopper', at, 0.25);
      } else this.sound(fx.returned > fx.wagered ? 'bell' : 'coin', at);
    });
  }

  private cue(at: number, run: () => void): void {
    if (at <= this.now) run();
    else this.cues.push({ at, run });
  }
}
