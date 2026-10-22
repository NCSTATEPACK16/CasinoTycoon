// The bundled par sheets. Each is built from a compact description — the
// symbol order on the strip and a weight per symbol per reel — because that
// is how slot math is actually tuned: the paytable is the marketing, the
// weights are the hold. Blank ('-') weight is the dial each sheet was tuned
// on to reach its filed RTP.

import type { ParSheet, ReelStrip, Volatility } from './parSheet';

export interface SheetSpec {
  id: string;
  name: string;
  rtp: number;
  volatility: Volatility;
  rows: 1 | 3;
  strip: string[];
  /** Weight per symbol, one entry per reel. Symbols missing a weight count 1;
   *  blanks take BLANK_WEIGHTS instead. */
  weights: Record<string, number[]>;
  reels: number;
  lines: number[][];
  wild?: string;
  scatter?: string;
  pays: Record<string, number[]>;
  scatterPays?: number[];
  spinsPerHour: number;
}

/** Symbol weights are written small and scaled up so the blank weight —
 *  the tuning dial — has fine enough steps to land near a target RTP. */
const WEIGHT_SCALE = 20;

/**
 * Reel r's strip: the spec's order, deterministically scrambled for every reel
 * but the first. Identical strips on every reel make the rows above and below
 * a heavy stop identical too, so a weighted blank would drag the same
 * neighbours onto every reel and pay a line across the top — real reel sets
 * are never laid out that way, and neither are these.
 */
function stripFor(strip: readonly string[], r: number): string[] {
  const out = [...strip];
  let seed = 0x9e3779b9 ^ (r * 0x85ebca6b);
  for (let i = out.length - 1; i > 0 && r > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function buildSheet(spec: SheetSpec, blank: number): ParSheet {
  const reels: ReelStrip[] = [];
  for (let r = 0; r < spec.reels; r++) {
    const stops = stripFor(spec.strip, r);
    reels.push({
      stops,
      weights: stops.map((s) => (s === '-' ? blank : (spec.weights[s]?.[r] ?? 1) * WEIGHT_SCALE)),
    });
  }
  return {
    id: spec.id,
    name: spec.name,
    rtp: spec.rtp,
    volatility: spec.volatility,
    rows: spec.rows,
    reels,
    lines: spec.lines,
    wild: spec.wild,
    scatter: spec.scatter,
    pays: spec.pays,
    scatterPays: spec.scatterPays,
    spinsPerHour: spec.spinsPerHour,
  };
}

/** Rows top/middle/bottom for a 3-reel, 3-row window: three straights and two diagonals. */
const LINES_3x3 = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];

/** The common 5×3 line set, first 20 lines in the usual order. */
const LINES_5x3 = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 2, 2, 0],
];

/** Blank-stop weight per sheet (symbol weights are ×WEIGHT_SCALE). */
export const BLANK_WEIGHTS: Record<string, number> = {
  'classic-sevens': 22,
  'diamond-lines': 216,
  'dragon-hoard': 22,
  'garden-twenty': 25,
  'penny-fortune': 17,
};

export const SHEET_SPECS: readonly SheetSpec[] = [
  {
    // A three-reel stepper: one line, cherries pay from the left, a top
    // award of 200 on sevens. The textbook 88% bar-top.
    id: 'classic-sevens',
    name: 'Classic Sevens',
    rtp: 0.8845547409377654,
    volatility: 'medium',
    rows: 1,
    reels: 3,
    strip: [
      '7',
      '-',
      'B3',
      '-',
      'B2',
      '-',
      'B1',
      '-',
      'CH',
      '-',
      'B1',
      '-',
      'B2',
      '-',
      'CH',
      '-',
      'B1',
      '-',
      'B3',
      '-',
      'B1',
      '-',
    ],
    weights: {
      '7': [2, 2, 1],
      B3: [3, 3, 3],
      B2: [4, 4, 4],
      B1: [5, 5, 6],
      CH: [4, 4, 4],
    },
    lines: [[0, 0, 0]],
    pays: { '7': [0, 0, 200], B3: [0, 0, 60], B2: [0, 0, 25], B1: [0, 0, 10], CH: [1, 4, 12] },
    spinsPerHour: 400,
  },
  {
    // Three reels, five lines and a wild that pays on its own: lots of
    // small line hits, which is what "low volatility" feels like.
    id: 'diamond-lines',
    name: 'Diamond Lines',
    rtp: 0.9200668434754703,
    volatility: 'low',
    rows: 3,
    reels: 3,
    strip: [
      'DI',
      'B3',
      '-',
      'B1',
      'CH',
      '-',
      'B2',
      'B1',
      '-',
      'CH',
      'B1',
      '-',
      'B2',
      'B3',
      '-',
      'B1',
      'CH',
      '-',
    ],
    weights: {
      DI: [2, 2, 2],
      B3: [3, 3, 3],
      B2: [4, 4, 4],
      B1: [6, 6, 6],
      CH: [5, 5, 5],
    },
    wild: 'DI',
    lines: LINES_3x3,
    pays: { DI: [0, 0, 150], B3: [0, 0, 60], B2: [0, 0, 30], B1: [0, 0, 15], CH: [0, 5, 12] },
    spinsPerHour: 600,
  },
  {
    // Five reels, nine lines, a wild dragon and a scatter hoard that pays
    // 100× the bet for five anywhere. Long droughts, big days.
    id: 'dragon-hoard',
    name: "Dragon's Hoard",
    rtp: 0.9516018358719933,
    volatility: 'high',
    rows: 3,
    reels: 5,
    strip: ['DR', 'A', 'K', '-', 'Q', 'HO', 'J', 'T', '-', 'PE', 'A', 'K', '-', 'Q', 'J', 'T'],
    weights: {
      DR: [1, 1, 1, 1, 1],
      HO: [1, 1, 1, 1, 1],
      PE: [2, 2, 2, 2, 2],
      A: [3, 3, 3, 3, 3],
      K: [3, 3, 3, 3, 3],
      Q: [4, 4, 4, 4, 4],
      J: [4, 4, 4, 4, 4],
      T: [5, 5, 5, 5, 5],
    },
    wild: 'DR',
    scatter: 'HO',
    lines: LINES_5x3.slice(0, 9),
    pays: {
      DR: [0, 0, 75, 750, 7500],
      PE: [0, 0, 40, 150, 1500],
      A: [0, 0, 15, 60, 225],
      K: [0, 0, 15, 45, 190],
      Q: [0, 0, 8, 30, 150],
      J: [0, 0, 8, 22, 110],
      T: [0, 0, 8, 15, 75],
    },
    scatterPays: [0, 0, 3, 30, 150],
    spinsPerHour: 600,
  },
  {
    // Twenty lines of small, frequent wins: the 97% machine a regular
    // can sit at all evening.
    id: 'garden-twenty',
    name: 'Garden Twenty',
    rtp: 0.9688617331302269,
    volatility: 'low',
    rows: 3,
    reels: 5,
    strip: ['WI', 'RO', 'A', '-', 'K', 'Q', 'TU', 'J', '-', 'T', 'A', 'K', '-', 'Q', 'J', 'T'],
    weights: {
      WI: [2, 2, 2, 2, 2],
      RO: [3, 3, 3, 3, 3],
      TU: [3, 3, 3, 3, 3],
      A: [4, 4, 4, 4, 4],
      K: [4, 4, 4, 4, 4],
      Q: [5, 5, 5, 5, 5],
      J: [5, 5, 5, 5, 5],
      T: [6, 6, 6, 6, 6],
    },
    wild: 'WI',
    lines: LINES_5x3,
    pays: {
      WI: [0, 0, 100, 500, 2000],
      RO: [0, 0, 50, 200, 750],
      TU: [0, 0, 40, 150, 500],
      A: [0, 0, 20, 75, 250],
      K: [0, 0, 20, 60, 200],
      Q: [0, 0, 15, 50, 150],
      J: [0, 0, 10, 40, 125],
      T: [0, 0, 10, 30, 100],
    },
    spinsPerHour: 600,
  },
  {
    // The penny cabinet: 20 lines, a flat paytable with no top award to
    // speak of, and the 88% hold that pays the floor's rent one cent at a
    // time. Flat on purpose — a bank of these is income you can plan on.
    id: 'penny-fortune',
    name: 'Penny Fortune',
    rtp: 0.8801514151505134,
    volatility: 'low',
    rows: 3,
    reels: 5,
    strip: ['GO', 'CO', 'A', '-', 'K', 'Q', 'BE', 'J', '-', 'T', 'A', 'K', '-', 'Q', 'J', 'T'],
    weights: {
      GO: [1, 1, 1, 1, 1],
      CO: [2, 2, 2, 2, 2],
      BE: [1, 1, 1, 1, 1],
      A: [3, 3, 3, 3, 3],
      K: [3, 3, 3, 3, 3],
      Q: [4, 4, 4, 4, 4],
      J: [4, 4, 4, 4, 4],
      T: [5, 5, 5, 5, 5],
    },
    wild: 'GO',
    scatter: 'BE',
    lines: LINES_5x3,
    pays: {
      GO: [0, 0, 40, 135, 400],
      CO: [0, 0, 35, 80, 200],
      A: [0, 0, 20, 40, 80],
      K: [0, 0, 20, 35, 70],
      Q: [0, 0, 16, 27, 55],
      J: [0, 0, 14, 24, 48],
      T: [0, 0, 14, 20, 40],
    },
    scatterPays: [0, 0, 5, 14, 27],
    spinsPerHour: 600,
  },
];

export const PAR_SHEETS: Record<string, ParSheet> = Object.fromEntries(
  SHEET_SPECS.map((spec) => [spec.id, buildSheet(spec, BLANK_WEIGHTS[spec.id]!)]),
);

export const DEFAULT_SHEET = 'diamond-lines';
export const PENNY_SHEET = 'penny-fortune';
