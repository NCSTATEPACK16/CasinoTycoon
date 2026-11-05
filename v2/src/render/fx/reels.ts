// Slot reels on the floor: which strips exist, where each reel sits at a given
// moment of a spin, and the resting stops an idle cabinet shows. The object
// shader runs the same timing (REEL_GLSL below); keep the two in step — the
// unit tests drive the TypeScript, the screenshots the GLSL.
//
// A reel's position is in symbols along its strip: the symbol at strip index i
// sits on the payline when the position is i. Spinning scrolls symbols down
// the window, which is the position falling; each reel lands exactly on its
// target, overshoots a touch and settles, left to right.

import { ENGINE_RULES } from '../../data/balance';
import { spinSheet } from '../../sim/games/slots/parSheet';
import { PAR_SHEETS } from '../../sim/games/slots/sheets';

/** Atlas column order: sheet s, reel r is column s * MAX_REELS + r. */
export const SHEET_ORDER = Object.keys(PAR_SHEETS);
export const MAX_REELS = 5;
/** Pixels per symbol cell in the atlas strip. */
export const REEL_CELL = 48;
export const STRIP_MAX = Math.max(
  ...Object.values(PAR_SHEETS).flatMap((s) => s.reels.map((r) => r.stops.length)),
);

/** Seconds from the spin to the first reel stopping, before the speed scale. */
export const FIRST_STOP_S = 0.85;
/** Gap between reels stopping: a little quicker on a five-reel video slot. */
export const stopGapS = (reels: number) => (reels > 3 ? 0.24 : 0.32);
/** Nominal spin speed, symbols a second. */
const SPIN_SPEED = 16;
/** Ease-in exponent: zero speed at the start, full speed into the stop. */
const EASE = 1.6;
/** Overshoot past the stop, in symbols, and how it rings down. */
const BOUNCE_A = 0.32;
const BOUNCE_K = 9;
const BOUNCE_W = 18;

/** Spins are shorter at 2× and 4× so the floor keeps up, but stay readable. */
export function durationScale(speed: number): number {
  return speed <= 1 ? 1 : 1 / Math.sqrt(speed);
}

/** When reel r of n stops, for a spin started at t0. */
export function reelStopTime(t0: number, r: number, n: number, dur: number): number {
  return t0 + dur * (FIRST_STOP_S + r * stopGapS(n));
}

/** When the last reel has stopped: the moment the result is revealed. */
export function revealTime(t0: number, n: number, dur: number): number {
  return reelStopTime(t0, n - 1, n, dur);
}

const mod = (x: number, m: number) => x - m * Math.floor(x / m);

/** Reel r's position (symbols) at time t, spinning from `prev` to `target`. */
export function reelPosition(
  t: number,
  t0: number,
  dur: number,
  r: number,
  n: number,
  target: number,
  prev: number,
  len: number,
): number {
  if (t <= t0) return prev;
  const ts = reelStopTime(t0, r, n, dur);
  if (t >= ts) {
    const u = t - ts;
    return target - BOUNCE_A * Math.exp(-BOUNCE_K * u) * Math.sin(BOUNCE_W * u);
  }
  const x = (t - t0) / (ts - t0);
  const laps = Math.max(1, Math.round((SPIN_SPEED * (ts - t0)) / len));
  const dist = mod(prev - target, len) + laps * len;
  return target + dist * (1 - x ** EASE);
}

/** Target and previous stop share one float: both are whole numbers below 64. */
export const packStops = (target: number, prev: number) => target + 64 * prev;

/** GLSL twin of reelPosition; p is a packStops value. */
export const REEL_GLSL = /* glsl */ `
  float reelPos(float t, float t0, float dur, float r, float n, float p, float len) {
    float target = mod(p, 64.0);
    float prev = floor(p / 64.0);
    if (t <= t0) return prev;
    float gap = n > 3.0 ? ${stopGapS(5).toFixed(3)} : ${stopGapS(3).toFixed(3)};
    float ts = t0 + dur * (${FIRST_STOP_S.toFixed(3)} + r * gap);
    if (t >= ts) {
      float u = t - ts;
      return target - ${BOUNCE_A.toFixed(3)} * exp(-${BOUNCE_K.toFixed(1)} * u) * sin(${BOUNCE_W.toFixed(1)} * u);
    }
    float x = (t - t0) / (ts - t0);
    float laps = max(1.0, floor(${SPIN_SPEED.toFixed(1)} * (ts - t0) / len + 0.5));
    float dist = mod(prev - target, len) + laps * len;
    return target + dist * (1.0 - pow(x, ${EASE.toFixed(2)}));
  }`;

/** The par sheet a cabinet runs until a round says otherwise. */
export function defaultSheet(defId: string): string | null {
  const sheet = ENGINE_RULES[defId]?.sheet;
  return typeof sheet === 'string' && sheet in PAR_SHEETS ? sheet : null;
}

/** Spin the real engine onto chosen stops: each draw lands mid-way into its stop's weight. */
function windowAt(sheetId: string, stops: number[]) {
  const sheet = PAR_SHEETS[sheetId]!;
  let r = 0;
  return spinSheet(sheet, () => {
    const w = sheet.reels[r]!.weights;
    const total = w.reduce((a, b) => a + b, 0);
    let cum = 0;
    for (let i = 0; i < stops[r]!; i++) cum += w[i]!;
    r++;
    return (cum + w[stops[r - 1]!]! / 2) / total;
  });
}

/**
 * Stops for a cabinet nobody has played yet: scattered by `seed`, and never
 * a window the machine would pay (no line, no scatter count that pays). An
 * idle cabinet must not advertise a win that didn't happen.
 */
export function restingStops(sheetId: string, seed: number): number[] {
  const sheet = PAR_SHEETS[sheetId]!;
  const n = sheet.reels.length;
  let h = seed >>> 0 || 1;
  for (let tries = 0; tries < 400; tries++) {
    const stops: number[] = [];
    for (let r = 0; r < n; r++) {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      const w = sheet.reels[r]!.weights;
      let s = h % w.length;
      while (w[s] === 0) s = (s + 1) % w.length;
      stops.push(s);
    }
    const o = windowAt(sheetId, stops);
    const scatterPays = (sheet.scatterPays?.[o.scatterCount - 1] ?? 0) > 0;
    if (o.multiplier === 0 && o.lineWins.length === 0 && !scatterPays) return stops;
  }
  return new Array<number>(n).fill(0);
}

/** For tests: the window chosen stops show, through the engine itself. */
export const outcomeAt = windowAt;
