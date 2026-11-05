import { describe, expect, it } from 'vitest';
import { CAMPAIGNS } from '../../data/campaigns';
import { OBJECT_CATALOG } from '../../data/objects';
import { paletteTab } from './Palette';

describe('palette tabs', () => {
  it('puts every catalogue item in exactly one tab, and no tab is empty', () => {
    const byTab = new Map<string, string[]>();
    for (const d of OBJECT_CATALOG)
      byTab.set(paletteTab(d), [...(byTab.get(paletteTab(d)) ?? []), d.id]);
    expect([...byTab.keys()].sort()).toEqual(['decor', 'services', 'slots', 'tables']);
    expect(byTab.get('slots')).toEqual(
      expect.arrayContaining(['slot-machine', 'penny-slots', 'video-poker', 'pachinko']),
    );
    expect(byTab.get('tables')).toEqual(
      expect.arrayContaining(['blackjack-table', 'roulette-table', 'craps-table', 'big-six-wheel']),
    );
    expect(byTab.get('services')).toEqual(['toilet', 'food-stall', 'bar', 'cage']);
    expect(byTab.get('decor')).toEqual(['plant', 'neon-sign', 'marquee']);
  });

  it('every restricted campaign says why, in the player’s words', () => {
    for (const c of CAMPAIGNS) if (c.allowedObjects) expect(c.restriction).toBeTruthy();
  });
});
