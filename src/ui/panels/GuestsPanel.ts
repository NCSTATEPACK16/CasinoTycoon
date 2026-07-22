import { world } from '../../gameContext';
import type { GuestState } from '../../sim/entities/Guest';
import { el } from '../dom';
import type { PanelSpec } from '../WindowManager';

const REFRESH_MS = 500;
const MAX_ROWS = 12;

const STATE_LABEL: Record<GuestState, string> = {
  wander: 'Wandering',
  seekGame: 'Heading to a game',
  play: 'Playing',
  service: 'Using services',
  leaving: 'Leaving',
  gone: 'Gone',
};

const mood = (happiness: number) => (happiness >= 70 ? '🙂' : happiness >= 40 ? '😐' : '😠');

// Live guest browser: click a guest for needs bars + recent thoughts.
export function makeGuestsPanel(): PanelSpec {
  const content = el('div');
  const heading = el('div', 'p-heading', 'Guests: 0 in casino');
  const list = el('div');
  const detail = el('div');
  content.append(heading, list, detail);
  let selectedId: string | null = null;

  const render = () => {
    const guests = [...world.guests.values()];
    heading.textContent = `Guests: ${guests.length} in casino`;
    if (selectedId && !world.guests.has(selectedId)) selectedId = null;

    list.textContent = '';
    for (const g of guests.slice(0, MAX_ROWS)) {
      const row = el('button', `p-row g-row${g.id === selectedId ? ' selected' : ''}`);
      row.appendChild(el('span', '', `${mood(g.needs.happiness)} Guest #${g.id.slice(2)}`));
      row.appendChild(el('span', 'val', `$${Math.round(g.wallet)}`));
      row.addEventListener('click', () => {
        selectedId = selectedId === g.id ? null : g.id;
        render();
      });
      list.appendChild(row);
    }
    if (guests.length > MAX_ROWS) {
      list.appendChild(el('div', 'p-note', `…and ${guests.length - MAX_ROWS} more`));
    }

    detail.textContent = '';
    const sel = selectedId ? world.guests.get(selectedId) : undefined;
    if (!sel) {
      detail.appendChild(
        el(
          'div',
          'p-note',
          guests.length
            ? 'Click a guest for needs and thoughts.'
            : 'The floor is empty — build some games!',
        ),
      );
      return;
    }
    detail.appendChild(
      el('div', 'p-heading', `Guest #${sel.id.slice(2)} — ${STATE_LABEL[sel.state]}`),
    );
    const bars: [string, number][] = [
      ['Energy', sel.needs.energy],
      ['Bladder', sel.needs.bladder],
      ['Hunger', sel.needs.hunger],
      ['Thirst', sel.needs.thirst],
      ['Happiness', sel.needs.happiness],
    ];
    for (const [label, value] of bars) {
      const row = el('div', 'p-row');
      row.appendChild(el('span', '', label));
      const bar = el('div', `p-bar${value < 25 ? ' low' : ''}`);
      const fill = el('i');
      fill.style.width = `${Math.round(value)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      detail.appendChild(row);
    }
    detail.appendChild(el('div', 'p-heading', 'Thoughts'));
    if (sel.thoughts.length === 0) {
      detail.appendChild(el('div', 'p-note', 'Nothing on their mind yet.'));
    }
    for (const t of [...sel.thoughts].reverse()) {
      detail.appendChild(el('div', 'g-thought', `💭 ${t.text}`));
    }
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return { title: 'Guests', width: 300, content, onClose: () => window.clearInterval(timer) };
}
