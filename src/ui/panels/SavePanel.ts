import { AUTOSAVE_SLOT, MANUAL_SLOTS, saveService } from '../../services/SaveService';
import {
  exportFileName,
  exportSaveText,
  IMPORT_FAILURE_MESSAGE,
  importSaveText,
} from '../../services/saveFile';
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
              eventBus.emit('tickerMessage', { text: 'Save failed!', severity: 'alert' });
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
                eventBus.emit('tickerMessage', { text: 'That save could not be read.', severity: 'alert' });
                return;
              }
              world.loadJSON(data);
              eventBus.emit('tickerMessage', { text: `Loaded ${slotLabel(slot)}.` });
            })
            .catch(() => {
              // loadJSON rejects an unrecognized machine defId without mutating
              // the world, so the current session is still playable here.
              eventBus.emit('tickerMessage', { text: 'Load failed! Save not compatible.', severity: 'alert' });
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

  // ---- Save portability ----
  //
  // Browser storage can be cleared without warning, and a campaign is hours of
  // play. An exported file is the same envelope a slot holds, so it migrates
  // forward on import exactly as a slot does — a backup taken today still
  // loads after the next few schema changes.
  const portable = el('div', 'p-save-portable');
  portable.appendChild(el('div', 'p-heading', 'Backup'));

  const exportBtn = el('button', 'p-tool', 'Export to file');
  exportBtn.title = 'Download this game as a file you can keep or move to another browser';
  exportBtn.addEventListener('click', () => {
    const snapshot = world.toJSON();
    const url = URL.createObjectURL(
      new Blob([exportSaveText(snapshot)], { type: 'application/json' }),
    );
    const link = el('a');
    link.href = url;
    link.download = exportFileName(snapshot);
    link.click();
    // Revoked on the next frame rather than immediately: some browsers have
    // not started reading the blob by the time click() returns.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
    eventBus.emit('tickerMessage', { text: 'Game exported.' });
  });

  // The input is the real control; the button is what the player sees, because
  // a bare file input cannot be styled to match anything else in here.
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  const importBtn = el('button', 'p-tool', 'Import from file');
  importBtn.title = 'Load a game from an exported file. Save it to a slot to keep it.';
  importBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    // Cleared before the read so picking the same file twice fires again —
    // the second attempt is exactly what a player does after a failure.
    file.value = '';
    if (!picked) return;
    void picked
      .text()
      .then((text) => {
        const res = importSaveText(text);
        if (res.status !== 'ok') {
          eventBus.emit('tickerMessage', {
            text: IMPORT_FAILURE_MESSAGE[res.status],
            severity: 'alert',
          });
          return;
        }
        world.loadJSON(res.world!);
        eventBus.emit('tickerMessage', {
          text: 'Game imported. Save it to a slot to keep it.',
        });
      })
      .catch(() => {
        // Either the file could not be read, or loadJSON rejected it without
        // mutating the world — the current session is still playable either way.
        eventBus.emit('tickerMessage', {
          text: 'That file could not be loaded.',
          severity: 'alert',
        });
      });
  });

  const portableBtns = el('div', 'p-save-btns');
  portableBtns.append(exportBtn, importBtn, file);
  portable.appendChild(portableBtns);

  void render();
  return { title: 'Save / Load', width: 340, content: wrap(content, portable) };
}

/** Slot list above, backup controls below, in one panel body. */
function wrap(...parts: HTMLElement[]): HTMLElement {
  const box = el('div');
  box.append(...parts);
  return box;
}
