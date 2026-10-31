// Plays sampled real rounds on the objects near the camera. The worker sends a
// roundFx event per play at a watched object (setInterest); this shows one
// round per object at a watchable pace, and when it finishes takes the newest
// round that arrived meanwhile and drops the rest — a table deals faster than
// anyone could watch. The win (label, flash, sound) fires at the moment the
// round's result is revealed, from that round's own numbers.
//
// Slot reels run in the object shader (ObjectLayer.setReels). Roulette heads
// and balls, craps dice and big six faces are separate instanced parts drawn
// over the table's own art (TableParts), and dealt cards and chips have pools
// of their own (FeltParts): drawParts places them every frame for the tables
// that have shown a round and are still watched.
//
// A card table deals each seat its own round, so its pending rounds are kept
// per seat and the felt cycles round the occupied seats.

import * as THREE from 'three';
import type { RoundFx } from '../../shared/contracts';
import type { ObjectLayer } from '../ObjectLayer';
import type { Overlays } from '../Overlays';
import { dieAt, diceReveal, FLIGHT_S, type Throw } from './dice';
import { CX, dealPlan, livePlan, seatAngle, type SeenCard } from './felt';
import type { FeltParts } from './FeltParts';
import { drawFelt, type FeltState } from './FeltShow';
import { durationScale, revealTime, reelStopTime } from './reels';
import { BIG_SIX_HUB, ROULETTE_HUB, type TableParts } from './TableParts';
import {
  ballAt,
  headAngle,
  rouletteReveal,
  SETTLE_S,
  sixAngle,
  sixReveal,
  type SixSpin,
  type Spin,
} from './wheel';
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
  rate?: number,
) => void;

/** A watched table's moving hardware: the latest spin or throw it showed. */
interface TableShow {
  roulette?: Spin;
  dice?: Throw;
  six?: SixSpin;
  felt?: FeltState;
}

/** A card table's shuffle sound plays on every this-many-th hand it shows. */
const SHUFFLE_EVERY = 7;
/** A dealt card is heard as it lands, this long after it leaves the shoe (s at 1×). */
const CARD_LAND_S = 0.22;
/** The avatar's seat in a table's per-seat state: never a guest seat index. */
const OWN_SEAT = -2;

const BALL_R = 0.011;
const tmpM = new THREE.Matrix4();
const tmpL = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpInv = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

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
  /** Per object, the newest waiting round per seat (−1 where there are no seats). */
  private pending = new Map<string, Map<number, RoundFx>>();
  private lastSeat = new Map<string, number>();
  private hands = new Map<string, number>();
  private cues: Cue[] = [];
  private tables = new Map<string, TableShow>();
  private now = 0;
  /** The table the avatar plays at: its own rounds show there, not the guests'. */
  own: string | null = null;
  private revealAt = new Map<string, number>();

  constructor(
    private objects: ObjectLayer,
    private overlays: Overlays,
  ) {}

  /** A round arrived for an object: show it now, or queue it as the newest. */
  round(objectId: string, fx: RoundFx): void {
    // Every seat's bet shows on the felt, even when its cards don't.
    if (fx.cards) this.noteBet(objectId, fx);
    if (objectId === this.own) return;
    if ((this.busyUntil.get(objectId) ?? -Infinity) > this.now) {
      const seat = fx.player?.seat ?? -1;
      let q = this.pending.get(objectId);
      if (!q) this.pending.set(objectId, (q = new Map()));
      if (q.has(seat)) this.stats.dropped++;
      q.set(seat, fx);
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
      const q = this.pending.get(id);
      if (q?.size) {
        // The next seat round the table after the one just shown.
        const last = this.lastSeat.get(id) ?? -Infinity;
        const seats = [...q.keys()].sort((a, b) => a - b);
        const seat = seats.find((s) => s > last) ?? seats[0]!;
        const fx = q.get(seat)!;
        q.delete(seat);
        this.start(id, fx);
      }
    }
  }

  private start(id: string, fx: RoundFx): void {
    const at = this.objects.centreOf(id);
    if (!at) return;
    this.stats.shown[fx.kind] = (this.stats.shown[fx.kind] ?? 0) + 1;
    this.showing.set(id, fx);
    const pos = { x: at.x, y: 1.2, z: at.z };
    if (fx.slots) return this.spinSlot(id, fx, pos);
    if (fx.roulette) return this.spinRoulette(id, fx, pos);
    if (fx.craps) return this.throwDice(id, fx, pos);
    if (fx.bigSix) return this.spinSix(id, fx, { ...pos, y: 1.9 });
    if (fx.cards) return this.dealCards(id, fx, { ...pos, y: 0.9 });
    // A game with no motion yet: reveal at once.
    this.reveal(id, fx, pos, this.now);
  }

  /**
   * Show the avatar's own settled round (a spin, a roll) on its table now,
   * whatever the table was showing. Returns the seconds until its result shows.
   */
  playOwn(id: string, fx: RoundFx, player: { x: number; z: number }): number {
    this.busyUntil.delete(id);
    this.pending.delete(id);
    // The avatar's own round runs at its own pace, whatever the sim speed.
    const speed = this.speed;
    this.speed = 1;
    this.start(id, { ...fx, player: { seat: OWN_SEAT, ...player } });
    this.speed = speed;
    return Math.max(0, (this.revealAt.get(id) ?? this.now) - this.now);
  }

  /**
   * The avatar's hand so far on its card table: new cards are dealt, turned
   * cards flip, and once `settled` is given the bet is paid or collected.
   * Returns the seconds until the result shows (0 mid-hand).
   */
  ownHand(
    id: string,
    seen: readonly SeenCard[],
    wagered: number,
    player: { x: number; z: number },
    settled: RoundFx | null,
  ): number {
    const at = this.objects.centreOf(id);
    const s = this.seatAt(id, player);
    if (!at || !s) return 0;
    const pos = { x: at.x, y: 0.9, z: at.z };
    const t = this.table(id);
    t.felt ??= { bets: new Map() };
    const h = t.felt.hand;
    const going = h && h.seat === OWN_SEAT && h.plan.settleAt === Infinity ? h : null;
    const t0 = going ? going.t0 : this.now;
    const tau = this.now - t0;
    const plan = livePlan(going?.plan ?? null, seen, tau, wagered, settled?.returned ?? null);
    const before = new Map((going?.plan.cards ?? []).map((c) => [c.dealAt, c.flipAt]));
    for (const c of plan.cards) {
      if (!before.has(c.dealAt))
        this.cue(t0 + c.dealAt + CARD_LAND_S, () => this.sound('card', pos));
      else if (c.flipAt !== null && before.get(c.dealAt) === null)
        this.cue(t0 + c.flipAt, () => this.sound('card', pos));
    }
    if (!going) this.cue(t0 + plan.betAt, () => this.sound('chips', pos));
    t.felt.hand = { plan, t0, dur: 1, seat: OWN_SEAT, a: s.a, player: { x: s.x, z: s.z } };
    t.felt.bets.delete(OWN_SEAT);
    this.busyUntil.set(id, t0 + plan.clearAt + 0.5);
    if (!settled) return 0;
    this.showing.set(id, settled);
    if (plan.result !== 'push') this.cue(t0 + plan.settleAt, () => this.sound('chips', pos));
    this.reveal(id, settled, pos, t0 + plan.settleAt);
    this.busyUntil.set(id, t0 + plan.clearAt + 0.5);
    return Math.max(0, t0 + plan.settleAt - this.now);
  }

  /** Forget tables no longer watched; their own static art shows again. */
  retain(ids: ReadonlySet<string>): void {
    for (const id of this.tables.keys()) if (!ids.has(id)) this.tables.delete(id);
    for (const id of this.pending.keys()) if (!ids.has(id)) this.pending.delete(id);
  }

  /** Where a round's player sits in the table's own frame, and its seat's angle. */
  private seatOf(id: string, fx: RoundFx): { a: number; x: number; z: number } | null {
    return this.seatAt(id, fx.player);
  }

  private seatAt(
    id: string,
    player: { x: number; z: number } | undefined,
  ): { a: number; x: number; z: number } | null {
    const o = this.objects.get(id);
    if (!o) return null;
    // Without a seat (a test world), the middle of the arc.
    const p = player
      ? tmpV.set(player.x, 0, player.z).applyMatrix4(tmpInv.copy(o.matrix).invert())
      : tmpV.set(CX, 0, 1.8);
    return { a: seatAngle(p.x, p.z), x: p.x, z: p.z };
  }

  private noteBet(id: string, fx: RoundFx): void {
    const s = this.seatOf(id, fx);
    if (!s) return;
    const t = this.table(id);
    t.felt ??= { bets: new Map() };
    t.felt.bets.set(fx.player?.seat ?? -1, { a: s.a, amount: fx.wagered, at: this.now });
  }

  private dealCards(id: string, fx: RoundFx, at: { x: number; y: number; z: number }): void {
    const plan = dealPlan(fx);
    const s = this.seatOf(id, fx);
    if (!plan || !s) return this.reveal(id, fx, at, this.now);
    const t = this.table(id);
    t.felt ??= { bets: new Map() };
    const seat = fx.player?.seat ?? -1;
    const dur = durationScale(this.speed);
    const t0 = this.now;
    t.felt.hand = { plan, t0, dur, seat, a: s.a, player: { x: s.x, z: s.z } };
    t.felt.bets.set(seat, { a: s.a, amount: plan.wagered, at: t0 });
    this.lastSeat.set(id, seat);
    const n = (this.hands.get(id) ?? 0) + 1;
    this.hands.set(id, n);
    if (n % SHUFFLE_EVERY === 1) this.sound('shuffle', at);
    this.cue(t0 + plan.betAt * dur, () => this.sound('chips', at));
    for (const c of plan.cards) {
      this.cue(t0 + (c.dealAt + CARD_LAND_S) * dur, () => this.sound('card', at));
      if (c.flipAt !== null) this.cue(t0 + c.flipAt * dur, () => this.sound('card', at));
    }
    if (plan.result !== 'push') this.cue(t0 + plan.settleAt * dur, () => this.sound('chips', at));
    this.reveal(id, fx, at, t0 + plan.settleAt * dur);
    // The table stays busy until its felt is cleared.
    this.busyUntil.set(id, t0 + (plan.clearAt + 0.5) * dur);
  }

  private table(id: string): TableShow {
    let t = this.tables.get(id);
    if (!t) this.tables.set(id, (t = {}));
    return t;
  }

  private spinRoulette(id: string, fx: RoundFx, at: { x: number; y: number; z: number }): void {
    const r = fx.roulette!;
    const t = this.table(id);
    const prev = t.roulette;
    const dur = durationScale(this.speed);
    // The head keeps turning from where it was; the ball is picked from its pocket.
    const head0 = prev ? headAngle(prev, this.now) : Math.random() * Math.PI * 2;
    const ball0 = prev ? ballAt(prev, this.now).angle : head0;
    t.roulette = { t0: this.now, dur, head0, ball0, pocket: r.pocket, wheel: r.wheel };
    this.sound('ballRoll', at, 0, 4.0 / SETTLE_S / dur);
    this.reveal(id, fx, at, rouletteReveal(t.roulette), 'ball');
  }

  private throwDice(id: string, fx: RoundFx, at: { x: number; y: number; z: number }): void {
    const t = this.table(id);
    const dur = durationScale(this.speed);
    t.dice = { t0: this.now, dur, faces: fx.craps!.dice, seed: Math.random() * 1000 };
    this.cue(this.now + FLIGHT_S * dur, () => this.sound('dice', at));
    this.reveal(id, fx, at, diceReveal(t.dice));
  }

  private spinSix(id: string, fx: RoundFx, at: { x: number; y: number; z: number }): void {
    const t = this.table(id);
    const dur = durationScale(this.speed);
    const angle0 = t.six ? sixAngle(t.six, this.now) : 0;
    t.six = { t0: this.now, dur, angle0, segment: fx.bigSix!.segment };
    // The clip is one spin, its clapper ticking down over about BIG_SIX_S.
    this.sound('bigSixSpin', at, 0, 1 / dur);
    this.reveal(id, fx, at, sixReveal(t.six));
  }

  /** Place every watched table's moving parts for this frame. */
  drawParts(parts: TableParts, felt: FeltParts): void {
    parts.begin();
    felt.begin();
    for (const [id, t] of this.tables) {
      const o = this.objects.get(id);
      if (!o) {
        this.tables.delete(id);
        continue;
      }
      const base = o.matrix;
      if (t.roulette) {
        const s = t.roulette;
        // Game angles run atan2(z, x); a turn about +y by θ moves them by −θ.
        tmpQ.setFromAxisAngle(Y, -headAngle(s, this.now));
        tmpL.compose(ROULETTE_HUB, tmpQ, ONE);
        parts.push(s.wheel === 'double' ? 'headUS' : 'headEU', tmpM.multiplyMatrices(base, tmpL));
        const b = ballAt(s, this.now);
        tmpV.set(
          ROULETTE_HUB.x + Math.cos(b.angle) * b.radius,
          ROULETTE_HUB.y + BALL_R + b.lift,
          ROULETTE_HUB.z + Math.sin(b.angle) * b.radius,
        );
        tmpL.makeTranslation(tmpV.x, tmpV.y, tmpV.z);
        parts.push('ball', tmpM.multiplyMatrices(base, tmpL));
      }
      if (t.dice)
        for (const i of [0, 1]) {
          const d = dieAt(t.dice, i, this.now);
          tmpL.compose(d.pos, d.quat, ONE);
          parts.push('die', tmpM.multiplyMatrices(base, tmpL));
        }
      if (t.felt) drawFelt(felt, base, t.felt, this.now);
      if (t.six) {
        tmpQ.setFromAxisAngle(Z, sixAngle(t.six, this.now));
        tmpL.compose(BIG_SIX_HUB, tmpQ, ONE);
        parts.push('bigSix', tmpM.multiplyMatrices(base, tmpL));
      }
    }
    parts.end();
    felt.end();
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
    landing?: string,
  ): void {
    this.busyUntil.set(id, when + HOLD_S);
    this.revealAt.set(id, when);
    this.cue(when, () => {
      this.stats.revealed++;
      if (landing) this.sound(landing, at);
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
