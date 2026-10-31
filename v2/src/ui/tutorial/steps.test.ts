import { describe, expect, it } from 'vitest';
import type { Command, ObjectView } from '../../shared/contracts';
import { TUTORIAL_STEPS, TutorialTracker } from './steps';

const cmd = (c: Command) => ({ kind: 'command' as const, cmd: c });
const obj = (defId: string, open = false): ObjectView => ({
  id: defId,
  defId,
  col: 1,
  row: 1,
  rot: 0,
  broken: false,
  open,
  occupants: 0,
});
const rect = { col0: 0, row0: 0, col1: 2, row1: 2 };

describe('B12 Opening Night steps', () => {
  it('walks the eight lessons in order, pointing at the first still open', () => {
    const t = new TutorialTracker();
    expect(t.current?.id).toBe('zone');
    // Painting a zone other than Gaming is not the lesson.
    expect(t.feed(cmd({ type: 'paintZone', rect, zone: 'foodCourt' }))).toEqual([]);
    expect(t.feed(cmd({ type: 'paintZone', rect, zone: 'gaming' }))).toEqual(['zone']);
    expect(t.feed(cmd({ type: 'place', defId: 'slot-machine', col: 1, row: 1, rot: 0 }))).toEqual([
      'slot',
    ]);
    expect(
      t.feed(cmd({ type: 'place', defId: 'blackjack-table', col: 5, row: 5, rot: 0 })),
    ).toEqual(['table']);
    expect(t.feed(cmd({ type: 'hire', kind: 'janitor' }))).toEqual([]);
    expect(t.feed(cmd({ type: 'hire', kind: 'dealer' }))).toEqual(['dealer']);
    expect(t.current?.id).toBe('open');
    // A closed table does not count; an open one does.
    expect(t.feed({ kind: 'objects', objects: [obj('blackjack-table', false)] })).toEqual([]);
    expect(t.feed({ kind: 'objects', objects: [obj('blackjack-table', true)] })).toEqual(['open']);
    expect(t.feed(cmd({ type: 'place', defId: 'food-stall', col: 6, row: 6, rot: 0 }))).toEqual([
      'stall',
    ]);
    expect(t.feed(cmd({ type: 'setPrice', objectId: 'a', itemId: 'soda', price: 3 }))).toEqual([
      'price',
    ]);
    expect(t.complete).toBe(false);
    expect(t.feed({ kind: 'rating' })).toEqual(['rating']);
    expect(t.complete).toBe(true);
    expect(t.current).toBeUndefined();
    expect(t.done.size).toBe(TUTORIAL_STEPS.length);
  });

  it('takes steps out of order, and picks up a floor that already has the pieces', () => {
    const t = new TutorialTracker();
    t.feed({ kind: 'rating' });
    expect(t.current?.id).toBe('zone');
    // A saved lesson reloaded: the objects on the floor tick their placing steps.
    const ticked = t.feed({
      kind: 'objects',
      objects: [obj('slot-machine'), obj('blackjack-table', true), obj('food-stall')],
    });
    expect(ticked.sort()).toEqual(['open', 'slot', 'stall', 'table']);
    expect(t.current?.id).toBe('zone');
  });

  it('gives each step a title, a body and somewhere to point', () => {
    for (const s of TUTORIAL_STEPS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.body.length).toBeGreaterThan(20);
      expect(s.target).toBeTruthy();
    }
    expect(new Set(TUTORIAL_STEPS.map((s) => s.id)).size).toBe(TUTORIAL_STEPS.length);
  });
});
