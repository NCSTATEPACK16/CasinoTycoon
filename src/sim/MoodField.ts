import { TileField, type TileFieldJSON } from './TileField';

export interface MoodFieldJSON {
  sum: TileFieldJSON;
  weight: TileFieldJSON;
}

/** Fraction of the accumulated signal retained per sample pass. Tuned so a
 *  tile fades out over roughly a minute of real time at the sample cadence —
 *  long enough to survive a quiet stretch, short enough that the map means
 *  "lately" rather than "ever". */
const DECAY = 0.97;

/** Below this weight a tile has not been visited enough to have an opinion.
 *  Reporting a mood from one guest-tick would make the map mostly noise. */
const MIN_WEIGHT = 0.35;

/**
 * B3-mood's data layer: how guests *feel* in each part of the floor.
 *
 * Two channels rather than one, because a single blended field cannot tell
 * "miserable here" apart from "nobody has been here" — both would read as a
 * low number, and the overlay would libel an empty corner as a problem area.
 * `sum` accumulates happiness × weight, `weight` accumulates presence, and the
 * mood is their ratio. Weight decaying to zero is what makes a tile go blank
 * instead of going cold.
 */
export class MoodField {
  private sum = new TileField();
  private weight = new TileField();

  /** Record one guest standing on one tile. */
  sample(col: number, row: number, happiness: number): void {
    this.sum.add(col, row, happiness);
    this.weight.add(col, row, 1);
  }

  /** Age both channels. Called once per sample pass, not per guest. */
  decay(): void {
    this.sum.decay(DECAY);
    this.weight.decay(DECAY);
  }

  /** Mean happiness on this tile, or null when too little has been seen. */
  moodAt(col: number, row: number): number | null {
    const w = this.weight.valueAt(col, row);
    if (w < MIN_WEIGHT) return null;
    return this.sum.valueAt(col, row) / w;
  }

  get isEmpty(): boolean {
    return this.weight.max < MIN_WEIGHT;
  }

  clear(): void {
    this.sum.clear();
    this.weight.clear();
  }

  toJSON(): MoodFieldJSON {
    return { sum: this.sum.toJSON(), weight: this.weight.toJSON() };
  }

  static fromJSON(data: MoodFieldJSON | null | undefined): MoodField {
    const field = new MoodField();
    if (!data) return field;
    field.sum = TileField.fromJSON(data.sum);
    field.weight = TileField.fromJSON(data.weight);
    return field;
  }
}
