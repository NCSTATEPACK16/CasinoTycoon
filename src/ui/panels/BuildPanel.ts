import { eventBus } from '../../EventBus';
import { OBJECT_CATALOG, type ObjectDef } from '../../data/objects';
import { gameState, world } from '../../gameContext';
import { el, formatCash } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { icon, iconLabel } from '../icons';

// Live build catalog: selecting a tile enters place mode (ghost in the world),
// the bulldozer enters sell mode. State round-trips via buildModeChanged so
// Esc/right-click in the world deselects here too.
export function makeBuildPanel(): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Place Objects'));

  /** Why this object can't be placed right now, phrased as the next action. */
  const blockedReason = (def: ObjectDef): string => {
    if (!world.isObjectAllowed(def.id)) {
      return `${def.name} isn't available in this scenario.`;
    }
    const short = def.cost - world.state.cash;
    return `Can't afford ${def.name} — you need ${formatCash(short)} more.`;
  };

  const grid = el('div', 'p-grid');
  const tiles = new Map<string, HTMLButtonElement>();
  let mode: 'off' | 'place' | 'bulldoze' = 'off';
  let selected: string | null = null;

  for (const def of OBJECT_CATALOG) {
    const tile = el('button', 'p-tile');
    tile.appendChild(icon(def.icon, 'tile-icon'));
    tile.appendChild(el('span', '', def.name));
    tile.appendChild(el('span', 'tile-cost', formatCash(def.cost)));
    tile.title = `${def.name} — ${formatCash(def.cost)}, upkeep ${formatCash(def.upkeepPerDay)}/day, ${def.footprint.w}×${def.footprint.h}`;
    tile.addEventListener('click', () => {
      if (tile.classList.contains('disabled')) {
        // Never swallow a click in silence. "I clicked and nothing happened,
        // why?" is the documented way players bounce off a tycoon UI.
        eventBus.emit('tickerMessage', { text: blockedReason(def), severity: 'warn' });
        return;
      }
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

  const dozer = el('button', 'p-tool');
  dozer.appendChild(iconLabel('bulldoze', 'Bulldoze — 50% refund'));
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
      const allowed = world.isObjectAllowed(def.id);
      const tile = tiles.get(def.id);
      const blocked = !allowed || def.cost > cash;
      tile?.classList.toggle('disabled', blocked);
      if (tile) {
        tile.title = blocked
          ? blockedReason(def)
          : `${def.name} — ${formatCash(def.cost)}, upkeep ${formatCash(def.upkeepPerDay)}/day, ${def.footprint.w}×${def.footprint.h}`;
      }
      tile?.classList.toggle('locked', !allowed);
      if (tile) tile.title = allowed ? tile.title : `${def.name} — not available in this scenario`;
    }
  };

  const offMode = eventBus.on('buildModeChanged', (e) => {
    mode = e.mode;
    selected = e.defId ?? null;
    sync();
  });
  const offMoney = eventBus.on('moneyChanged', ({ cash }) => affordability(cash));
  const offReset = eventBus.on('worldReset', () => affordability(gameState.cash));
  affordability(gameState.cash);

  return {
    title: 'Build',
    width: 264,
    content,
    onClose: () => {
      offMode();
      offMoney();
      offReset();
    },
  };
}
