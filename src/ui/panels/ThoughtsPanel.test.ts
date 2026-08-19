import { describe, expect, it } from 'vitest';
import { aggregateThoughts } from './ThoughtsPanel';
import type { GuestThought } from '../../sim/entities/Guest';

const guest = (id: string, thoughts: [string, string, number][]) => ({
  id,
  thoughts: thoughts.map(([tid, text, atTick]) => ({ id: tid, text, atTick })) as GuestThought[],
});

describe('aggregateThoughts', () => {
  it('ranks by how many guests share a complaint, loudest first', () => {
    const { groups } = aggregateThoughts(
      [
        guest('a', [['no-seat', 'Nowhere to sit', 100]]),
        guest('b', [['no-seat', 'Nowhere to sit', 100]]),
        guest('c', [['hungry', 'I am starving', 100]]),
      ],
      100,
    );
    expect(groups.map((g) => [g.id, g.guests])).toEqual([
      ['no-seat', 2],
      ['hungry', 1],
    ]);
  });

  it('counts guests, not thoughts — one guest griping repeatedly is one problem', () => {
    const { groups, thinking } = aggregateThoughts(
      [
        guest('a', [
          ['no-seat', 'Nowhere to sit', 100],
          ['no-seat', 'Nowhere to sit', 101],
          ['no-seat', 'Nowhere to sit', 102],
        ]),
      ],
      102,
    );
    expect(groups[0]!.guests).toBe(1);
    expect(thinking).toBe(1);
  });

  it('groups by thought id, not text, so subject-named thoughts still merge', () => {
    // The text builder names what the thought is about, so two guests
    // complaining about different machines must not split into two rows.
    const { groups } = aggregateThoughts(
      [
        guest('a', [['ripoff', 'The Slot Machine is a ripoff', 100]]),
        guest('b', [['ripoff', 'The Roulette Table is a ripoff', 100]]),
      ],
      100,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'ripoff', guests: 2 });
  });

  it('drops thoughts older than the recency window', () => {
    const { groups, thinking } = aggregateThoughts(
      [guest('a', [['no-seat', 'Nowhere to sit', 0]])],
      5000,
    );
    expect(groups).toEqual([]);
    expect(thinking).toBe(0);
  });

  it('counts a guest as thinking only once, however many thoughts they carry', () => {
    const { thinking } = aggregateThoughts(
      [
        guest('a', [
          ['no-seat', 'Nowhere to sit', 100],
          ['hungry', 'I am starving', 100],
        ]),
        guest('b', []),
      ],
      100,
    );
    expect(thinking).toBe(1);
  });

  it('handles an empty floor', () => {
    expect(aggregateThoughts([], 0)).toEqual({ groups: [], thinking: 0 });
  });
});
