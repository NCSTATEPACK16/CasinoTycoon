import { describe, expect, it } from 'vitest';
import { hashPayload, planReconcile, type SlotSnapshot } from './reconcile';

const snap = (slot: string, hash: string, day = 1): SlotSnapshot => ({
  slot,
  savedAt: '2026-07-26T00:00:00.000Z',
  day,
  cash: 1000,
  hash,
});

describe('planReconcile', () => {
  it('uploads slots that exist only locally', () => {
    const plan = planReconcile([snap('slot-1', 'a')], []);
    expect(plan.uploads).toEqual(['slot-1']);
    expect(plan.pulls).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('pulls slots that exist only in the cloud', () => {
    const plan = planReconcile([], [snap('slot-2', 'b')]);
    expect(plan.pulls).toEqual(['slot-2']);
    expect(plan.uploads).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('does nothing for slots that are already identical', () => {
    const plan = planReconcile([snap('slot-1', 'same')], [snap('slot-1', 'same')]);
    expect(plan).toEqual({ uploads: [], pulls: [], conflicts: [] });
  });

  it('flags a conflict when both sides differ', () => {
    const plan = planReconcile([snap('slot-1', 'a', 14)], [snap('slot-1', 'b', 9)]);
    expect(plan.uploads).toEqual([]);
    expect(plan.pulls).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    const [conflict] = plan.conflicts;
    expect(conflict?.slot).toBe('slot-1');
    expect(conflict?.local.day).toBe(14);
    expect(conflict?.cloud.day).toBe(9);
  });

  it('handles all three slots independently in one pass', () => {
    const plan = planReconcile(
      [snap('slot-1', 'a'), snap('slot-3', 'same')],
      [snap('slot-2', 'b'), snap('slot-3', 'same')],
    );
    expect(plan.uploads).toEqual(['slot-1']);
    expect(plan.pulls).toEqual(['slot-2']);
    expect(plan.conflicts).toEqual([]);
  });

  it('never considers the autosave slot', () => {
    const plan = planReconcile([snap('autosave', 'a')], []);
    expect(plan).toEqual({ uploads: [], pulls: [], conflicts: [] });
  });
});

describe('hashPayload', () => {
  it('is stable and distinguishes different payloads', () => {
    expect(hashPayload('{"a":1}')).toBe(hashPayload('{"a":1}'));
    expect(hashPayload('{"a":1}')).not.toBe(hashPayload('{"a":2}'));
  });
});
