import { eventBus } from '../../EventBus';
import { OBJECT_CATALOG } from '../../data/objects';
import { gameState } from '../../gameContext';
import { el, formatCash } from '../dom';
import type { PanelSpec } from '../WindowManager';

// Live build catalog: selecting a tile enters place mode (ghost in the world),
// the bulldozer enters sell mode. State round-trips via buildModeChanged so
// Esc/right-click in the world deselects here too.
export function makeBuildPanel(): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Place Objects'));

  const grid = el('div', 'p-grid');
  const tiles = new Map<string, HTMLButtonElement>();
  let mode: 'off' | 'place' | 'bulldoze' = 'off';
  let selected: string | null = null;

  for (const def of OBJECT_CATALOG) {
    const tile = el('button', 'p-tile');
    tile.appendChild(el('span', 'tile-icon', def.icon));
    tile.appendChild(el('span', '', def.name));
    tile.appendChild(el('span', 'tile-cost', formatCash(def.cost)));
    tile.title = `${def.name} — ${formatCash(def.cost)}, upkeep ${formatCash(def.upkeepPerDay)}/day, ${def.footprint.w}×${def.footprint.h}`;
    tile.addEventListener('click', () => {
      if (tile.classList.contains('disabled')) return;
      if (mode === 'place' && selected === def.id) {
        eventBus.emit('buildModeChanged', { mode: 'off' });
      } else {
        eventBus.emit('buildModeChanged', { mode: 'place', defId: def.id });
      }
    });
    grid.appendChild(tile);
    tiles.set(def.id, tile);
  }
  content.appendChild(grid);

  const dozer = el('button', 'p-tool', '🚜 Bulldoze — 50% refund');
  dozer.addEventListener('click', () => {
    eventBus.emit('buildModeChanged', { mode: mode === 'bulldoze' ? 'off' : 'bulldoze' });
  });
  content.appendChild(dozer);
  content.appendChild(el('div', 'p-note', 'Left-click places · right-click or Esc cancels.'));

  const sync = () => {
    tiles.forEach((tile, id) => {
      tile.classList.toggle('selected', mode === 'place' && selected === id);
    });
    dozer.classList.toggle('selected', mode === 'bulldoze');
  };
  const affordability = (cash: number) => {
    for (const def of OBJECT_CATALOG) {
      tiles.get(def.id)?.classList.toggle('disabled', def.cost > cash);
    }
  };

  const offMode = eventBus.on('buildModeChanged', (e) => {
    mode = e.mode;
    selected = e.defId ?? null;
    sync();
  });
  const offMoney = eventBus.on('moneyChanged', ({ cash }) => affordability(cash));
  affordability(gameState.cash);

  return {
    title: 'Build',
    width: 264,
    content,
    onClose: () => {
      offMode();
      offMoney();
    },
  };
}
