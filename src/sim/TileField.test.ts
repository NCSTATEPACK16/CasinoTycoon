import { describe, expect, it } from 'vitest';
import { GRID_COLS, GRID_ROWS } from '../config';
import { MoodField } from './MoodField';
import { TileField } from './TileField';

describe('TileField', () => {
  it('starts empty at the map size', () => {
    const f = new TileField();
    expect(f.cols).toBe(GRID_COLS);
    expect(f.rows).toBe(GRID_ROWS);
    expect(f.isEmpty).toBe(true);
    expect(f.max).toBe(0);
  });

  it('accumulates and reads back per tile', () => {
    const f = new TileField();
    f.add(3, 4, 2);
    f.add(3, 4, 5);
    expect(f.valueAt(3, 4)).toBe(7);
    expect(f.valueAt(4, 3)).toBe(0);
    expect(f.max).toBe(7);
  });

  it('ignores writes outside the grid instead of corrupting a neighbour', () => {
    const f = new TileField();
    // Row-major indexing means an unchecked (-1, 5) would land on a real tile
    // one row back. Silent corruption is the failure worth guarding.
    f.add(-1, 5, 99);
    f.add(GRID_COLS, 5, 99);
    f.add(5, GRID_ROWS, 99);
    expect(f.isEmpty).toBe(true);
    expect(f.valueAt(-1, 5)).toBe(0);
  });

  it('blends toward a sampled level rather than summing it', () => {
    const f = new TileField();
    f.sample(2, 2, 100, 0.5);
    expect(f.valueAt(2, 2)).toBe(50);
    f.sample(2, 2, 100, 0.5);
    expect(f.valueAt(2, 2)).toBe(75);
  });

  it('decays toward zero and flushes the tail so an aged field reads empty', () => {
    const f = new TileField();
    f.add(1, 1, 10);
    for (let i = 0; i < 5; i++) f.decay(0.5);
    expect(f.valueAt(1, 1)).toBeCloseTo(10 * 0.5 ** 5, 6);
    for (let i = 0; i < 200; i++) f.decay(0.5);
    expect(f.valueAt(1, 1)).toBe(0);
    expect(f.isEmpty).toBe(true);
  });

  it('round-trips through JSON', () => {
    const f = new TileField();
    f.add(7, 9, 3.5);
    const restored = TileField.fromJSON(JSON.parse(JSON.stringify(f.toJSON())));
    expect(restored.valueAt(7, 9)).toBe(3.5);
  });

  it('drops data from a differently-sized grid rather than smearing it', () => {
    const restored = TileField.fromJSON({ cols: GRID_COLS, rows: GRID_ROWS, values: [1, 2, 3] });
    expect(restored.isEmpty).toBe(true);
  });

  it('tolerates a null payload', () => {
    expect(TileField.fromJSON(null).isEmpty).toBe(true);
  });
});

describe('MoodField', () => {
  it('reports nothing for a tile no guest has stood on', () => {
    const m = new MoodField();
    expect(m.moodAt(5, 5)).toBeNull();
    expect(m.isEmpty).toBe(true);
  });

  it('averages the happiness seen on a tile', () => {
    const m = new MoodField();
    m.sample(5, 5, 20);
    m.sample(5, 5, 80);
    expect(m.moodAt(5, 5)).toBeCloseTo(50, 5);
  });

  it('keeps mood independent of how busy the tile is', () => {
    // The whole reason for two channels: a mobbed tile and a quiet tile with
    // equally happy guests must report the same mood, or the overlay is just
    // a traffic map wearing a mood label.
    const busy = new MoodField();
    for (let i = 0; i < 40; i++) busy.sample(1, 1, 70);
    const quiet = new MoodField();
    quiet.sample(2, 2, 70);
    expect(busy.moodAt(1, 1)).toBeCloseTo(quiet.moodAt(2, 2)!, 5);
  });

  it('distinguishes a miserable tile from an empty one', () => {
    const m = new MoodField();
    m.sample(1, 1, 0);
    // A single blended field would report 0 for both of these.
    expect(m.moodAt(1, 1)).toBe(0);
    expect(m.moodAt(2, 2)).toBeNull();
  });

  it('goes blank again once a tile stops being visited', () => {
    const m = new MoodField();
    for (let i = 0; i < 5; i++) m.sample(3, 3, 90);
    expect(m.moodAt(3, 3)).toBeCloseTo(90, 5);
    for (let i = 0; i < 400; i++) m.decay();
    expect(m.moodAt(3, 3)).toBeNull();
    expect(m.isEmpty).toBe(true);
  });

  it('round-trips through JSON', () => {
    const m = new MoodField();
    m.sample(4, 4, 62);
    const restored = MoodField.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(restored.moodAt(4, 4)).toBeCloseTo(62, 5);
  });

  it('tolerates a null payload', () => {
    expect(MoodField.fromJSON(null).isEmpty).toBe(true);
  });
});
