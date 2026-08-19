import { GRID_COLS, GRID_ROWS } from '../config';

export interface TileFieldJSON {
  cols: number;
  rows: number;
  /** Flat row-major values. Sparse in practice but stored dense — 1200 floats
   *  is 9.6KB of JSON at worst, and a sparse encoding would cost more in code
   *  than it saves in bytes at this grid size. */
  values: number[];
}

/**
 * A decaying scalar per map tile — the shared substrate under every data
 * overlay (mood, traffic, profit).
 *
 * Two properties matter for all three consumers:
 *
 * - **Decay.** Raw counters only ever grow, so a tile that was busy on day one
 *   stays hot forever and the map stops meaning "now". Every field ages.
 * - **A dense flat array.** 40×30 is 1200 numbers; a Map keyed by "col,row"
 *   would allocate on every write, and writes happen on guest movement at 130
 *   guests × 10Hz.
 */
export class TileField {
  readonly cols: number;
  readonly rows: number;
  private values: Float64Array;

  constructor(cols: number = GRID_COLS, rows: number = GRID_ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.values = new Float64Array(cols * rows);
  }

  private index(col: number, row: number): number {
    return row * this.cols + col;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  valueAt(col: number, row: number): number {
    if (!this.inBounds(col, row)) return 0;
    return this.values[this.index(col, row)]!;
  }

  /** Accumulate — the counter idiom, for traffic and profit. */
  add(col: number, row: number, amount: number): void {
    if (!this.inBounds(col, row)) return;
    const i = this.index(col, row);
    this.values[i] = this.values[i]! + amount;
  }

  set(col: number, row: number, value: number): void {
    if (!this.inBounds(col, row)) return;
    this.values[this.index(col, row)] = value;
  }

  /**
   * Blend a reading toward `value` — the sampler idiom, for mood.
   *
   * Mood is a *level*, not a count: a tile with two happy guests is not twice
   * as happy as a tile with one. An exponential moving average also smooths
   * the flicker that would otherwise come from guests walking in and out of a
   * tile ten times a second.
   */
  sample(col: number, row: number, value: number, weight: number): void {
    if (!this.inBounds(col, row)) return;
    const i = this.index(col, row);
    this.values[i] = this.values[i]! + (value - this.values[i]!) * weight;
  }

  /** Age every tile toward zero. `factor` is the fraction retained per call. */
  decay(factor: number): void {
    for (let i = 0; i < this.values.length; i++) {
      const next = this.values[i]! * factor;
      // Flush denormal tails to zero so a decayed field compares equal to an
      // empty one and serializes without a screenful of 1e-17.
      this.values[i] = next < 1e-6 ? 0 : next;
    }
  }

  clear(): void {
    this.values.fill(0);
  }

  get max(): number {
    let max = 0;
    for (let i = 0; i < this.values.length; i++) if (this.values[i]! > max) max = this.values[i]!;
    return max;
  }

  /** True when nothing has been recorded — lets an overlay say "no data yet"
   *  instead of painting a uniform field of zeros. */
  get isEmpty(): boolean {
    return this.max === 0;
  }

  toJSON(): TileFieldJSON {
    return { cols: this.cols, rows: this.rows, values: Array.from(this.values) };
  }

  static fromJSON(data: TileFieldJSON | null | undefined): TileField {
    const field = new TileField(data?.cols ?? GRID_COLS, data?.rows ?? GRID_ROWS);
    const values = data?.values;
    if (!values) return field;
    // A save written on a differently-sized grid is not worth remapping; drop
    // the data rather than smearing it across the wrong tiles.
    if (values.length === field.cols * field.rows) field.values.set(values);
    return field;
  }
}
