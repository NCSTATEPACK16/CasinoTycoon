// Roulette on the floor: the wheel head spins down, the ball orbits the rim
// the other way, drops, rattles and settles in the pocket of the real result.
// Angles are "game angles" in the wheel's plane: atan2(z, x) in the asset's
// top view, the same sense the atlas paints the wheel in (canvas x → +x,
// canvas y-down → +z), so pocket i of the painted order sits at
// (i + ½) / n · 2π on the head.

/** The pocket order round a single-zero wheel, from zero. */
export const EUROPEAN = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
/** Double-zero order; 37 is the engine's 00. */
export const AMERICAN = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37, 27, 10, 25, 29, 12, 8,
  19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

const TAU = Math.PI * 2;
const mod = (x: number, m: number) => x - m * Math.floor(x / m);

export type WheelKind = 'single' | 'double';

export function pocketOrder(wheel: WheelKind): number[] {
  return wheel === 'double' ? AMERICAN : EUROPEAN;
}

/** Where a number's pocket sits on the head, in head-local game angle. */
export function pocketAngle(pocket: number, wheel: WheelKind): number {
  const order = pocketOrder(wheel);
  const i = order.indexOf(pocket);
  return ((Math.max(0, i) + 0.5) / order.length) * TAU;
}

/** Which pocket a head-local angle falls in. */
export function pocketAt(angle: number, wheel: WheelKind): number {
  const order = pocketOrder(wheel);
  return order[Math.floor((mod(angle, TAU) / TAU) * order.length) % order.length]!;
}

/** Head speeds (rad/s): idling between spins and just after the croupier's push. */
const IDLE_W = 0.5;
const PUSH_W = 3.2;
const WHEEL_DECAY = 0.45;
/** Ball timeline (s, before the speed scale): orbit, drop and rattle, settled. */
export const DROP_S = 3.0;
export const SETTLE_S = 4.1;
/** Radii (m) of the ball track at the rim and of the pocket ring. */
export const RIM_R = 0.3;
export const POCKET_R = 0.205;
const BALL_SPEED = 11;

export interface Spin {
  t0: number;
  dur: number;
  /** Head angle at t0, so a new spin carries on from the old one. */
  head0: number;
  /** Ball angle at t0 (it is launched from where it lay). */
  ball0: number;
  pocket: number;
  wheel: WheelKind;
}

/** The head's angle at time t: a push that decays to an idle turn. */
export function headAngle(s: Spin, t: number): number {
  const tau = Math.max(0, t - s.t0);
  const k = WHEEL_DECAY / s.dur;
  return s.head0 + IDLE_W * tau + ((PUSH_W - IDLE_W) * (1 - Math.exp(-k * tau))) / k;
}

export interface Ball {
  angle: number;
  radius: number;
  /** Height above the head surface while it bounces. */
  lift: number;
  settled: boolean;
}

/** The ball at time t: lands in s.pocket exactly at the settle time and rides the head after. */
export function ballAt(s: Spin, t: number): Ball {
  const tau = Math.max(0, t - s.t0);
  const ts = SETTLE_S * s.dur;
  const td = DROP_S * s.dur;
  const end = headAngle(s, s.t0 + ts) + pocketAngle(s.pocket, s.wheel);
  if (tau >= ts) {
    return {
      angle: headAngle(s, t) + pocketAngle(s.pocket, s.wheel),
      radius: POCKET_R,
      lift: 0,
      settled: true,
    };
  }
  // The ball runs against the head and slows into the pocket: its angle falls
  // from ball0 (plus whole laps) to `end`, fast at first, gently at the end.
  const p = 2.2;
  const laps = Math.max(2, Math.round((BALL_SPEED * ts) / p / TAU));
  const dist = mod(s.ball0 - end, TAU) + laps * TAU;
  const x = tau / ts;
  const angle = end + dist * (1 - x) ** p;
  let radius = RIM_R;
  let lift = 0;
  if (tau < 0.25 * s.dur) {
    // Picked out of its pocket and flicked onto the track.
    const k = tau / (0.25 * s.dur);
    radius = POCKET_R + (RIM_R - POCKET_R) * k;
    lift = Math.sin(Math.PI * k) * 0.03;
  } else if (tau > td) {
    // Off the track, down the cone, rattling over the frets into the pocket.
    const k = (tau - td) / (ts - td);
    radius = RIM_R + (POCKET_R - RIM_R) * Math.min(1, k * 1.6);
    lift = Math.abs(Math.sin(k * Math.PI * 4)) * 0.02 * (1 - k);
  }
  return { angle, radius, lift, settled: false };
}

/** When the result shows: the ball comes to rest. */
export function rouletteReveal(s: Pick<Spin, 't0' | 'dur'>): number {
  return s.t0 + SETTLE_S * s.dur;
}

// ---------- big six ----------
// The wheel stands upright facing the player; the clapper sits at the top.
// Angles are about the axle, counter-clockwise seen from the front, in the
// face's own xy plane. The atlas paints segment i clockwise from +x (canvas
// y runs down the face), so its centre sits at −(i + ½) / n · 2π.

/** Seconds (before the speed scale) from the push to the clapper settling. */
export const BIG_SIX_S = 5.0;
const SIX_N = 30;
const SIX_LAPS = 3;

export interface SixSpin {
  t0: number;
  dur: number;
  /** Face angle at t0, so a new spin carries on from where the last stopped. */
  angle0: number;
  segment: number;
}

/** The face angle that puts segment i under the clapper. */
export function sixRestAngle(segment: number): number {
  return Math.PI / 2 + ((segment + 0.5) / SIX_N) * TAU;
}

/** Which segment is under the clapper at face angle a. */
export function sixSegmentAt(a: number): number {
  return Math.floor((mod(a - Math.PI / 2, TAU) / TAU) * SIX_N) % SIX_N;
}

/** The face angle at time t: a clockwise spin slowing onto the segment. */
export function sixAngle(s: SixSpin, t: number): number {
  const tau = Math.max(0, t - s.t0);
  const ts = BIG_SIX_S * s.dur;
  const end = sixRestAngle(s.segment);
  if (tau >= ts) return end;
  const dist = mod(s.angle0 - end, TAU) + SIX_LAPS * TAU;
  return end + dist * (1 - tau / ts) ** 2.4;
}

export function sixReveal(s: Pick<SixSpin, 't0' | 'dur'>): number {
  return s.t0 + BIG_SIX_S * s.dur;
}
