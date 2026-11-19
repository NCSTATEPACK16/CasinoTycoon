import { describe, expect, it } from 'vitest';
import { pickIcons, type GuestThoughtRow } from './ThoughtIcons';

const row = (agentId: number, glyph: string | null, recent = true): GuestThoughtRow => ({
  agentId,
  thought: glyph ? { glyph } : null,
  thoughtIds: recent && glyph ? ['t'] : [],
});

describe('pickIcons', () => {
  const rows = [row(1, '😀'), row(2, '😡'), row(3, null), row(4, '🍔', false), row(5, '💸')];

  it('shows nobody when nobody is hovered or selected and Mood view is off', () => {
    expect(pickIcons(rows, new Set(), false)).toEqual([]);
  });

  it('shows only the hovered or selected guest outside the Mood view', () => {
    expect(pickIcons(rows, new Set([2]), false)).toEqual([{ agentId: 2, glyph: '😡' }]);
  });

  it('shows every guest with a recent thought in the Mood view, focus first, capped', () => {
    const all = pickIcons(rows, new Set([5]), true);
    expect(all.map((i) => i.agentId)).toEqual([5, 1, 2]);
    expect(pickIcons(rows, new Set(), true, 2)).toHaveLength(2);
  });

  it('never shows a guest whose thought is old or missing, even when focused', () => {
    expect(pickIcons(rows, new Set([3, 4]), true).map((i) => i.agentId)).toEqual([1, 2, 5]);
  });
});
