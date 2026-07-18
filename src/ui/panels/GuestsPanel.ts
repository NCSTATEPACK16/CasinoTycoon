import type { PanelSpec } from '../WindowManager';
import { el } from '../dom';

// P2 stub — live guest list with thoughts and needs arrives in P4.
const SAMPLE_GUESTS = [
  { name: 'Guest #1', mood: '🙂', need: 'Happiness', fill: 78 },
  { name: 'Guest #2', mood: '🤑', need: 'Cash', fill: 45 },
  { name: 'Guest #3', mood: '😠', need: 'Bladder', fill: 12 },
];

export function makeGuestsPanel(): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Guests: 0 in casino'));
  for (const guest of SAMPLE_GUESTS) {
    const r = el('div', 'p-row');
    r.appendChild(el('span', '', `${guest.mood} ${guest.name}`));
    r.appendChild(el('span', '', guest.need));
    const bar = el('div', `p-bar${guest.fill < 25 ? ' low' : ''}`);
    const fill = el('i');
    fill.style.width = `${guest.fill}%`;
    bar.appendChild(fill);
    r.appendChild(bar);
    content.appendChild(r);
  }
  content.appendChild(
    el('div', 'p-note', 'Sample data. Real guests walk in during P4 — needs, thoughts and all.'),
  );
  return { title: 'Guests', width: 300, content };
}
