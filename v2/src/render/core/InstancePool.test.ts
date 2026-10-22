import { describe, expect, it } from 'vitest';
import { InstancePool } from './InstancePool';

function pool(cap = 4): InstancePool {
  return new InstancePool([2, 1], cap);
}

describe('InstancePool', () => {
  it('appends densely and returns stable indices', () => {
    const p = pool();
    expect(p.add('a')).toBe(0);
    expect(p.add('b')).toBe(1);
    expect(p.add('a')).toBe(0);
    expect(p.count).toBe(2);
  });

  it('swap-removes the last instance into the hole, channels included', () => {
    const p = pool();
    for (const [id, v] of [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ] as const) {
      const i = p.add(id);
      p.set(0, i, [v, v * 10]);
      p.set(1, i, [v * 100]);
    }
    expect(p.remove('a')).toBe('c');
    expect(p.count).toBe(2);
    expect(p.indexOf('c')).toBe(0);
    expect(p.idAt(0)).toBe('c');
    expect(p.get(0, 0)).toEqual([3, 30]);
    expect(p.get(1, 0)).toEqual([300]);
    expect(p.get(0, 1)).toEqual([2, 20]);
    expect(p.has('a')).toBe(false);
  });

  it('removing the last instance moves nothing', () => {
    const p = pool();
    p.add('a');
    p.add('b');
    expect(p.remove('b')).toBeUndefined();
    expect(p.count).toBe(1);
    expect(p.remove('zzz')).toBeUndefined();
  });

  it('grows capacity and keeps data', () => {
    const p = pool(2);
    for (let i = 0; i < 5; i++) p.set(1, p.add(`o${i}`), [i]);
    expect(p.grown).toBe(true);
    expect(p.capacity).toBe(8);
    for (let i = 0; i < 5; i++) expect(p.get(1, p.indexOf(`o${i}`)!)).toEqual([i]);
  });

  it('tracks the dirty index range for partial uploads', () => {
    const p = pool(8);
    for (let i = 0; i < 6; i++) p.add(`o${i}`);
    p.clearDirty();
    expect(p.dirty).toBe(false);
    p.remove('o1'); // o5 moves into slot 1
    expect([p.dirtyMin, p.dirtyMax]).toEqual([1, 1]);
    p.set(0, 3, [0, 0]);
    expect([p.dirtyMin, p.dirtyMax]).toEqual([1, 3]);
  });

  it('stays consistent under random churn', () => {
    const p = new InstancePool<number>([1], 1);
    const live = new Map<number, number>();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let step = 0; step < 5000; step++) {
      const id = Math.floor(rnd() * 200);
      if (live.has(id) && rnd() < 0.5) {
        p.remove(id);
        live.delete(id);
      } else {
        p.set(0, p.add(id), [id * 2]);
        live.set(id, id * 2);
      }
    }
    expect(p.count).toBe(live.size);
    for (const [id, i] of p.entries()) {
      expect(p.indexOf(id)).toBe(i);
      expect(p.get(0, i)[0]).toBe(live.get(id));
    }
  });
});
