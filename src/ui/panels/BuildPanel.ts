import type { PanelSpec } from '../WindowManager';
import { el } from '../dom';

// P2 stub — the real catalog arrives in P3 as src/data/objects.ts and these
// tiles become live placement tools.
const PREVIEW_ITEMS = [
  { icon: '🎰', name: 'Slot Machine', cost: '$500' },
  { icon: '🃏', name: 'Blackjack', cost: '$1,200' },
  { icon: '🚻', name: 'Restroom', cost: '$300' },
  { icon: '🌭', name: 'Food Stall', cost: '$400' },
  { icon: '🪴', name: 'Plant', cost: '$40' },
  { icon: '🛋️', name: 'Bench', cost: '$60' },
];

export function makeBuildPanel(): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Place Objects'));
  const grid = el('div', 'p-grid');
  for (const item of PREVIEW_ITEMS) {
    const tile = el('div', 'p-tile');
    tile.appendChild(el('span', 'tile-icon', item.icon));
    tile.appendChild(el('span', '', item.name));
    tile.appendChild(el('span', 'tile-cost', item.cost));
    grid.appendChild(tile);
  }
  content.appendChild(grid);
  content.appendChild(
    el('div', 'p-note', 'Construction crews arrive in P3 — placement, snapping and bulldozing.'),
  );
  return { title: 'Build', width: 264, content };
}
