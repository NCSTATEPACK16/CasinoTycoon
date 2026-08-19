import { TileField, type TileFieldJSON } from './TileField';

export type TrafficFieldJSON = TileFieldJSON;

/** Fraction of each tile's count retained per decay pass. Slower than mood's:
 *  footfall is about where the floor *flows*, which is a slower-moving fact
 *  than how a crowd happens to feel right now. */
const DECAY = 0.99;

/** Visits below which a tile is treated as having nothing to say. One guest
 *  who wandered through a corner once is noise, and painting it would make a
 *  dead corner look like a route. */
const MIN_VISITS = 1.5;

/**
 * Fraction of the busiest tile below which footfall is suppressed.
 *
 * An absolute floor alone does not survive contact with a running casino:
 * given long enough, guests wander nearly everywhere, and the map fills in
 * until 1030 of 1200 tiles are painted and it says nothing. A route map has to
 * answer "where is the crowd going", so the floor scales with how busy the
 * place actually is.
 */
const NOISE_FLOOR = 0.4;

/**
 * P2 — decayed per-tile footfall.
 *
 * Written on tile-enter only, never per tick. Counting every guest on every
 * tick would be 130 writes at 10Hz to answer a question that changes on a
 * human timescale, and it would also measure *dwell* rather than *traffic* —
 * a guest standing at a machine for a minute would outweigh a corridor a
 * hundred guests walked through.
 */
export class TrafficField {
  private visits = new TileField();

  /** One guest stepped onto this tile. */
  enter(col: number, row: number): void {
    this.visits.add(col, row, 1);
  }

  /** Age every tile. Called on a cadence, not per write. */
  decay(): void {
    this.visits.decay(DECAY);
  }

  /** The count below which a tile is suppressed as noise. */
  get noiseFloor(): number {
    return Math.max(MIN_VISITS, this.visits.max * NOISE_FLOOR);
  }

  /** Footfall on this tile, or null when too little has passed through. */
  visitsAt(col: number, row: number): number | null {
    const v = this.visits.valueAt(col, row);
    return v < this.noiseFloor ? null : v;
  }

  /** Busiest tile on the floor — the top of the overlay's scale. */
  get busiest(): number {
    return this.visits.max;
  }

  get isEmpty(): boolean {
    return this.visits.max < MIN_VISITS;
  }

  clear(): void {
    this.visits.clear();
  }

  toJSON(): TrafficFieldJSON {
    return this.visits.toJSON();
  }

  static fromJSON(data: TrafficFieldJSON | null | undefined): TrafficField {
    const field = new TrafficField();
    field.visits = TileField.fromJSON(data);
    return field;
  }
}
