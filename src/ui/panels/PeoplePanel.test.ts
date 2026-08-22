import { describe, expect, it } from 'vitest';
import { combineCleanups, hiddenFlags } from './PeoplePanel';

/**
 * P16 — Guests, Patrons and Thoughts were three toolbar buttons for one
 * concept: the people on the floor and what they think of the place. Three
 * windows for one idea is how an interface starts outgrowing what it can
 * support, which is the shape of the criticism levelled at Casino Inc.
 *
 * The three views are unchanged; they are tabs now. The DOM assembly is as
 * untested as every other panel here — the suite runs on `environment: 'node'`
 * and the convention is to pull the logic out instead, as ThoughtsPanel does
 * with aggregateThoughts. These two are that logic, and they carry the only
 * two ways a tabbed host goes wrong.
 */
describe('hiddenFlags', () => {
  it('shows exactly one body', () => {
    expect(hiddenFlags(3, 0)).toEqual([false, true, true]);
    expect(hiddenFlags(3, 2)).toEqual([true, true, false]);
  });

  it('falls back to the first tab when the index is nonsense', () => {
    // A corrupt or stale index must not produce a panel with nothing in it.
    expect(hiddenFlags(3, -1)).toEqual([false, true, true]);
    expect(hiddenFlags(3, 9)).toEqual([false, true, true]);
  });
});

describe('combineCleanups', () => {
  it('runs every cleanup, not just the visible tab’s', () => {
    // Each sub-panel holds a 2Hz interval. Closing the parent and leaving two
    // of the three running is a leak that survives every later open and close.
    const closed: string[] = [];
    combineCleanups([() => closed.push('a'), () => closed.push('b'), () => closed.push('c')])();
    expect(closed).toEqual(['a', 'b', 'c']);
  });

  it('tolerates a sub-panel that declares no cleanup', () => {
    const closed: string[] = [];
    expect(() => combineCleanups([undefined, () => closed.push('b')])()).not.toThrow();
    expect(closed).toEqual(['b']);
  });

  it('still runs the rest when one cleanup throws', () => {
    // One panel's bug must not strand the other two intervals forever.
    const closed: string[] = [];
    const run = combineCleanups([
      () => closed.push('a'),
      () => {
        throw new Error('boom');
      },
      () => closed.push('c'),
    ]);
    expect(() => run()).not.toThrow();
    expect(closed).toEqual(['a', 'c']);
  });
});
