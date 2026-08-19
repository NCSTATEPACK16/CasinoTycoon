import { world } from '../gameContext';

// Overlay definitions and scale math, deliberately free of Phaser.
//
// The renderer needs these to paint and the legend panel needs them to explain
// what was painted — and those two must never disagree about a color, which is
// only guaranteed if they read the same table. Keeping the module Phaser-free
// means the UI layer and the unit tests can import it without dragging a WebGL
// engine along.

export type OverlayId = 'none' | 'mood';

export interface OverlayStop {
  /** Normalized position on the scale, 0..1. */
  at: number;
  color: number;
  label: string;
}

export interface OverlayDef {
  id: OverlayId;
  label: string;
  /** Value for a tile, or null when this tile has no data and must stay clear.
   *  The null case is the whole reason overlays do not simply paint zeros. */
  valueAt: (col: number, row: number) => number | null;
  /** Fixed scale bounds. A fixed scale is deliberate: an auto-ranged heat map
   *  re-colors itself as the data moves, so the same hue means something
   *  different minute to minute and the legend becomes a lie. */
  min: number;
  max: number;
  /** Hover readout text for a value. */
  format: (value: number) => string;
  /** Ordered low→high. Interpolated between stops to color a tile. */
  stops: OverlayStop[];
  /** True when there is nothing worth showing yet. */
  isEmpty: () => boolean;
  /** What to say when it is empty. */
  emptyNote: string;
}

const lerpChannel = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Blend between two packed RGB ints. */
function mixColor(a: number, b: number, t: number): number {
  const r = lerpChannel((a >> 16) & 0xff, (b >> 16) & 0xff, t);
  const g = lerpChannel((a >> 8) & 0xff, (b >> 8) & 0xff, t);
  const bl = lerpChannel(a & 0xff, b & 0xff, t);
  return (r << 16) | (g << 8) | bl;
}

/** Color for a normalized 0..1 position on a stop ramp. */
export function colorFor(stops: OverlayStop[], t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    if (clamped <= hi.at) {
      const span = hi.at - lo.at;
      return mixColor(lo.color, hi.color, span === 0 ? 0 : (clamped - lo.at) / span);
    }
  }
  return stops[stops.length - 1]!.color;
}

export const OVERLAYS: Record<Exclude<OverlayId, 'none'>, OverlayDef> = {
  mood: {
    id: 'mood',
    label: 'Guest mood',
    valueAt: (col, row) => world.mood.moodAt(col, row),
    min: 0,
    max: 100,
    format: (v) => `${Math.round(v)}% happy`,
    // Red → amber → green. Diverging rather than sequential because mood has a
    // meaningful midpoint: "fine" is a real state, not just less of "bad".
    stops: [
      { at: 0, color: 0xd5514e, label: 'Miserable' },
      { at: 0.5, color: 0xe0a53a, label: 'Fine' },
      { at: 1, color: 0x4caf6a, label: 'Delighted' },
    ],
    isEmpty: () => world.mood.isEmpty,
    emptyNote: 'No guests have walked the floor yet.',
  },
};
