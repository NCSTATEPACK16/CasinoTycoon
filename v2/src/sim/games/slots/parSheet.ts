// Slot par sheets: weighted reel strips, a line paytable with a wild and a
// scatter, and the exact statistics that fall out of enumerating every stop
// combination. A par sheet is what a regulator signs off on; its RTP is a
// property of the strips, not a number someone typed.

export type Volatility = 'low' | 'medium' | 'high';

export interface ReelStrip {
  /** Symbol at each physical stop, in strip order (the window reads stop-1, stop, stop+1). */
  stops: string[];
  /** Virtual-reel weight of landing on each stop. */
  weights: number[];
}

export interface ParSheet {
  id: string;
  name: string;
  /** The return the sheet is filed at. parSheet.test.ts proves it equals the enumerated RTP. */
  rtp: number;
  volatility: Volatility;
  /** Visible rows: 1 for a classic single-line reel game, 3 for a video window. */
  rows: 1 | 3;
  reels: ReelStrip[];
  /** Each payline as a row index per reel (0 = top; a 1-row game uses [0,0,0]). */
  lines: number[][];
  /** Substitutes for every symbol except the scatter. */
  wild?: string;
  /** Pays anywhere in the window, as a multiple of the total bet. */
  scatter?: string;
  /** Line pays as multiples of the line bet, indexed by run length − 1. */
  pays: Record<string, number[]>;
  /** Scatter pays as multiples of the total bet, indexed by count − 1. */
  scatterPays?: number[];
  /** Typical pace: ~600 for video reels, ~400 for a stepper you pull. */
  spinsPerHour: number;
}

export interface ParStats {
  /** Expected return per unit of total bet. */
  rtp: number;
  /** P(a spin returns anything). */
  hitFrequency: number;
  /** Standard deviation of one spin's return, in total bets. */
  sd: number;
  /** 90% volatility index (1.645 σ): the band a session's per-spin average stays within. */
  volatilityIndex: number;
  combinations: number;
}

export interface SpinOutcome {
  /** Symbols in the window, [reel][row]. */
  window: string[][];
  /** Return as a multiple of the total bet. */
  multiplier: number;
  lineWins: { line: number; symbol: string; count: number; pays: number }[];
  scatterCount: number;
}

/** Compiled form: symbols as small ints so enumeration never touches strings. */
interface Compiled {
  sheet: ParSheet;
  sym: string[];
  wild: number;
  scatter: number;
  strips: Int32Array[];
  probs: Float64Array[];
  pays: number[][]; // [symbol][count-1], line-bet multiples
  scatterPays: number[];
}

function compile(sheet: ParSheet): Compiled {
  const sym = [...new Set(sheet.reels.flatMap((r) => r.stops))];
  const idx = (s: string) => sym.indexOf(s);
  for (const r of sheet.reels) {
    if (r.stops.length !== r.weights.length) throw new Error(`${sheet.id}: stops/weights mismatch`);
  }
  return {
    sheet,
    sym,
    wild: sheet.wild ? idx(sheet.wild) : -1,
    scatter: sheet.scatter ? idx(sheet.scatter) : -1,
    strips: sheet.reels.map((r) => Int32Array.from(r.stops.map(idx))),
    probs: sheet.reels.map((r) => {
      const total = r.weights.reduce((a, b) => a + b, 0);
      return Float64Array.from(r.weights.map((w) => w / total));
    }),
    pays: sym.map((s) => sheet.pays[s] ?? []),
    scatterPays: sheet.scatterPays ?? [],
  };
}

/** Line-bet multiple a single line pays, with wild substitution. */
function linePay(
  c: Compiled,
  symbols: Int32Array | number[],
): { symbol: number; count: number; pays: number } {
  const n = symbols.length;
  const first = symbols[0]!;
  if (first === c.scatter) return { symbol: -1, count: 0, pays: 0 };
  // The run of wilds can pay as wilds, or stand in for the first real symbol.
  let wildRun = 0;
  while (wildRun < n && symbols[wildRun] === c.wild) wildRun++;
  const wildPay = wildRun > 0 ? (c.pays[c.wild]![wildRun - 1] ?? 0) : 0;
  let best = { symbol: c.wild, count: wildRun, pays: wildPay };
  if (wildRun < n) {
    const target = symbols[wildRun]!;
    if (target !== c.scatter) {
      let run = wildRun;
      while (run < n && (symbols[run] === target || symbols[run] === c.wild)) run++;
      const p = c.pays[target]![run - 1] ?? 0;
      if (p > best.pays) best = { symbol: target, count: run, pays: p };
    }
  }
  return best;
}

/** Return (in total bets) for the window given by one stop per reel. */
function evaluateStops(c: Compiled, stops: ArrayLike<number>, lineBuf: number[]): number {
  const { sheet, strips, scatter } = c;
  const reels = strips.length;
  const mid = sheet.rows === 3 ? 1 : 0;
  let lineTotal = 0;
  for (const line of sheet.lines) {
    for (let r = 0; r < reels; r++) {
      const strip = strips[r]!;
      const len = strip.length;
      lineBuf[r] = strip[(((stops[r]! + line[r]! - mid) % len) + len) % len]!;
    }
    lineTotal += linePay(c, lineBuf).pays;
  }
  let scatters = 0;
  if (scatter >= 0) {
    for (let r = 0; r < reels; r++) {
      const strip = strips[r]!;
      const len = strip.length;
      for (let row = 0; row < sheet.rows; row++) {
        if (strip[(((stops[r]! + row - mid) % len) + len) % len] === scatter) scatters++;
      }
    }
  }
  const scatterPay = scatters > 0 ? (c.scatterPays[scatters - 1] ?? 0) : 0;
  return lineTotal / sheet.lines.length + scatterPay;
}

const compiledCache = new Map<string, Compiled>();
const statsCache = new Map<string, ParStats>();

function compiled(sheet: ParSheet): Compiled {
  let c = compiledCache.get(sheet.id);
  if (!c || c.sheet !== sheet) {
    c = compile(sheet);
    compiledCache.set(sheet.id, c);
  }
  return c;
}

/**
 * Enumerate every combination of stops — Π strip lengths of them — and
 * accumulate the exact moments of the return. Cached per sheet: the biggest
 * bundled sheet is a few million combinations, about a second's work.
 */
export function parStats(sheet: ParSheet): ParStats {
  const hit = statsCache.get(sheet.id);
  if (hit && compiledCache.get(sheet.id)?.sheet === sheet) return hit;
  const c = compiled(sheet);
  const reels = c.strips.length;
  const stops = new Int32Array(reels);
  const lineBuf = new Array<number>(reels).fill(0);
  let m1 = 0;
  let m2 = 0;
  let hitP = 0;
  let combos = 0;
  const walk = (r: number, p: number): void => {
    if (r === reels) {
      const x = evaluateStops(c, stops, lineBuf);
      m1 += p * x;
      m2 += p * x * x;
      if (x > 0) hitP += p;
      combos++;
      return;
    }
    const probs = c.probs[r]!;
    for (let i = 0; i < probs.length; i++) {
      stops[r] = i;
      walk(r + 1, p * probs[i]!);
    }
  };
  walk(0, 1);
  const sd = Math.sqrt(Math.max(0, m2 - m1 * m1));
  const stats: ParStats = {
    rtp: m1,
    hitFrequency: hitP,
    sd,
    volatilityIndex: 1.645 * sd,
    combinations: combos,
  };
  statsCache.set(sheet.id, stats);
  return stats;
}

/** Land one spin: pick a weighted stop per reel and read the window. */
export function spinSheet(sheet: ParSheet, rand: () => number): SpinOutcome {
  const c = compiled(sheet);
  const reels = c.strips.length;
  const stops: number[] = [];
  for (let r = 0; r < reels; r++) {
    const probs = c.probs[r]!;
    let u = rand();
    let i = 0;
    while (i < probs.length - 1 && u >= probs[i]!) u -= probs[i++]!;
    stops.push(i);
  }
  const mid = sheet.rows === 3 ? 1 : 0;
  const at = (r: number, row: number) => {
    const strip = c.strips[r]!;
    const len = strip.length;
    return strip[(((stops[r]! + row - mid) % len) + len) % len]!;
  };
  const lineWins: SpinOutcome['lineWins'] = [];
  sheet.lines.forEach((line, li) => {
    const syms = line.map((row, r) => at(r, row));
    const w = linePay(c, syms);
    if (w.pays > 0)
      lineWins.push({ line: li, symbol: c.sym[w.symbol]!, count: w.count, pays: w.pays });
  });
  let scatterCount = 0;
  const window: string[][] = [];
  for (let r = 0; r < reels; r++) {
    const col: string[] = [];
    for (let row = 0; row < sheet.rows; row++) {
      const s = at(r, row);
      if (s === c.scatter) scatterCount++;
      col.push(c.sym[s]!);
    }
    window.push(col);
  }
  const lineTotal = lineWins.reduce((a, w) => a + w.pays, 0);
  const scatterPay = scatterCount > 0 ? (c.scatterPays[scatterCount - 1] ?? 0) : 0;
  return {
    window,
    multiplier: lineTotal / sheet.lines.length + scatterPay,
    lineWins,
    scatterCount,
  };
}
