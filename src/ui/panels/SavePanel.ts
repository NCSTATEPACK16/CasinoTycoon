import { AUTOSAVE_SLOT, MANUAL_SLOTS, saveService } from '../../services/SaveService';
import { world } from '../../gameContext';
import { eventBus } from '../../EventBus';
import { el, formatCash } from '../dom';
import type { PanelSpec } from '../WindowManager';

const slotLabel = (slot: string) =>
  slot === AUTOSAVE_SLOT ? 'Autosave' : `Slot ${slot.slice(-1)}`;

export function makeSavePanel(): PanelSpec {
  const content = el('div');

  const render = async () => {
    const infos = new Map((await saveService.list()).map((i) => [i.slot, i]));
    content.textContent = '';
    for (const slot of [...MANUAL_SLOTS, AUTOSAVE_SLOT]) {
      const info = infos.get(slot);
      // A file from a newer build is listed, not hidden. Showing it as "Empty"
      // is indistinguishable from having lost it.
      const stale = info?.status === 'newer';
      const line = el('div', 'p-save-row');
      const text = el('div', 'p-save-text');
      text.appendChild(el('div', 'p-save-label', slotLabel(slot)));
      const meta = el(
        'div',
        stale ? 'p-save-meta p-save-stale' : 'p-save-meta',
        !info
          ? 'Empty'
          : stale
            ? 'Saved by a newer version — update to load'
            : `Day ${info.day} · ${formatCash(info.cash)} · ${info.scenarioName ?? 'Sandbox'}`,
      );
      text.appendChild(meta);
      line.appendChild(text);

      const btns = el('div', 'p-save-btns');
      if (slot !== AUTOSAVE_SLOT) {
        const save = el('button', 'p-tool', 'Save');
        save.addEventListener('click', () => {
          void saveService
            .save(slot, world.toJSON())
            .then(() => {
              eventBus.emit('tickerMessage', { text: `Game saved to ${slotLabel(slot)}.` });
              void render();
            })
            .catch(() => {
              eventBus.emit('tickerMessage', { text: 'Save failed!' });
            });
        });
        btns.appendChild(save);
      }
      if (info && !stale) {
        const load = el('button', 'p-tool', 'Load');
        load.addEventListener('click', () => {
          void saveService
            .load(slot)
            .then((data) => {
              if (!data) {
                eventBus.emit('tickerMessage', { text: 'That save could not be read.' });
                return;
              }
              world.loadJSON(data);
              eventBus.emit('tickerMessage', { text: `Loaded ${slotLabel(slot)}.` });
            })
            .catch(() => {
              // loadJSON rejects an unrecognized machine defId without mutating
              // the world, so the current session is still playable here.
              eventBus.emit('tickerMessage', { text: 'Load failed! Save not compatible.' });
            });
        });
        btns.appendChild(load);
      }
      if (info) {
        const del = el('button', 'p-tool', 'Delete'); // labeled, never a bare ✕ (P6 gotcha)
        del.addEventListener('click', () => {
          void saveService.delete(slot).then(() => void render());
        });
        btns.appendChild(del);
      }
      line.appendChild(btns);
      content.appendChild(line);
    }
  };

  void render();
  return { title: 'Save / Load', width: 340, content };
}
