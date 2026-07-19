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
      const line = el('div', 'p-save-row');
      const text = el('div', 'p-save-text');
      text.appendChild(el('div', 'p-save-label', slotLabel(slot)));
      text.appendChild(
        el(
          'div',
          'p-save-meta',
          info
            ? `Day ${info.day} · ${formatCash(info.cash)} · ${info.scenarioName ?? 'Sandbox'}`
            : 'Empty',
        ),
      );
      line.appendChild(text);

      const btns = el('div', 'p-save-btns');
      if (slot !== AUTOSAVE_SLOT) {
        const save = el('button', 'p-tool', 'Save');
        save.addEventListener('click', () => {
          void saveService.save(slot, world.toJSON()).then(() => {
            eventBus.emit('tickerMessage', { text: `Game saved to ${slotLabel(slot)}.` });
            void render();
          });
        });
        btns.appendChild(save);
      }
      if (info) {
        const load = el('button', 'p-tool', 'Load');
        load.addEventListener('click', () => {
          void saveService.load(slot).then((data) => {
            if (!data) {
              eventBus.emit('tickerMessage', { text: 'That save could not be read.' });
              return;
            }
            world.loadJSON(data);
            eventBus.emit('tickerMessage', { text: `Loaded ${slotLabel(slot)}.` });
          });
        });
        btns.appendChild(load);
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
  return { title: '💾 Save / Load', width: 340, content };
}
