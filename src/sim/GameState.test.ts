import { describe, expect, it } from 'vitest';
import { STARTING_CASH } from '../config';
import { GameState } from './GameState';

describe('GameState', () => {
  it('starts with STARTING_CASH', () => {
    expect(new GameState().cash).toBe(STARTING_CASH);
  });

  it('issues unique incrementing object ids', () => {
    const state = new GameState();
    const a = state.newObjectId();
    const b = state.newObjectId();
    expect(a).not.toBe(b);
  });

  it('registers, retrieves and removes placed objects', () => {
    const state = new GameState();
    const po = { id: state.newObjectId(), defId: 'plant', col: 3, row: 4 };
    state.addObject(po);
    expect(state.getObject(po.id)).toEqual(po);
    expect(state.allObjects()).toEqual([po]);
    state.removeObject(po.id);
    expect(state.getObject(po.id)).toBeUndefined();
    expect(state.allObjects()).toEqual([]);
  });

  it('round-trips through toJSON/fromJSON', () => {
    const state = new GameState();
    state.cash = 1234;
    state.addObject({ id: state.newObjectId(), defId: 'slot-machine', col: 5, row: 6 });
    const restored = GameState.fromJSON(state.toJSON());
    expect(restored.cash).toBe(1234);
    expect(restored.allObjects()).toEqual(state.allObjects());
  });

  it('does not reuse ids of restored objects after fromJSON', () => {
    const state = new GameState();
    const existing = state.newObjectId();
    state.addObject({ id: existing, defId: 'plant', col: 1, row: 1 });
    const restored = GameState.fromJSON(state.toJSON());
    expect(restored.newObjectId()).not.toBe(existing);
  });

  describe('load (in-place restore)', () => {
    it('restores cash, objects, and the id counter in place', () => {
      const a = new GameState();
      a.cash = 777;
      a.addObject({ id: a.newObjectId(), defId: 'slot-machine', col: 2, row: 3 });
      const b = new GameState();
      const ref = b;
      b.load(a.toJSON());
      expect(b).toBe(ref);
      expect(b.cash).toBe(777);
      expect(b.allObjects()).toEqual(a.allObjects());
      expect(b.newObjectId()).toBe(a.newObjectId()); // counters advanced identically
    });
  });
});
