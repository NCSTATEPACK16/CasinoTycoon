import { world } from '../../gameContext';
import type { GuestThought } from '../../sim/entities/Guest';
import { el } from '../dom';
import { iconLabel } from '../icons';
import type { PanelSpec } from '../WindowManager';

const REFRESH_MS = 500;
const MAX_ROWS = 10;
/** Older thoughts stop being actionable — a complaint from twenty minutes ago
 *  says nothing about the floor right now. */
const RECENT_TICKS = 600;

// B2: the thoughts aggregation view.
//
// 130 guests each carrying up to six thoughts is 780 individual signals, which
// is noise. Ranked by how many guests share a complaint, the same data becomes
// a to-do list. This is the pattern RollerCoaster Tycoon 2 got right: individual
// legibility plus a sorted summary, so a player can answer "why is this
// happening?" without clicking through the crowd.

export interface ThoughtGroup {
  id: string;
  text: string;
  guests: number;
}

/** Exported for tests: takes the guests rather than reaching for the world
 *  singleton, so the ranking rules can be checked without a running sim. */
export function aggregateThoughts(
  guests: Iterable<{ id: string; thoughts: readonly GuestThought[] }>,
  tickCount: number,
): { groups: ThoughtGroup[]; thinking: number } {
  const cutoff = tickCount - RECENT_TICKS;
  // Count guests, not thoughts: one guest griping six times about the same
  // thing is one problem, not six.
  const byId = new Map<string, { text: string; guests: Set<string> }>();
  let thinking = 0;
  for (const g of guests) {
    let counted = false;
    for (const t of g.thoughts) {
      if (t.atTick < cutoff) continue;
      counted = true;
      const entry = byId.get(t.id);
      if (entry) entry.guests.add(g.id);
      else byId.set(t.id, { text: t.text, guests: new Set([g.id]) });
    }
    if (counted) thinking++;
  }
  const groups = [...byId.entries()]
    .map(([id, e]) => ({ id, text: e.text, guests: e.guests.size }))
    .sort((a, b) => b.guests - a.guests || a.text.localeCompare(b.text));
  return { groups, thinking };
}

export function makeThoughtsPanel(): PanelSpec {
  const content = el('div');
  const heading = el('div', 'p-heading', 'What guests are thinking');
  const list = el('div');
  content.append(heading, list);

  const render = () => {
    const { groups, thinking } = aggregateThoughts(world.guests.values(), world.tickCount);
    heading.textContent =
      thinking === 0
        ? 'What guests are thinking'
        : `What guests are thinking · ${thinking} of ${world.guests.size}`;

    list.textContent = '';
    if (groups.length === 0) {
      list.appendChild(
        el(
          'div',
          'p-note',
          world.guests.size === 0
            ? 'Nobody on the floor yet.'
            : 'Nothing on anyone’s mind — the floor is running clean.',
        ),
      );
      return;
    }
    const loudest = groups[0]!.guests;
    for (const g of groups.slice(0, MAX_ROWS)) {
      const row = el('div', 'p-row th-row');
      row.appendChild(iconLabel('thought', g.text));
      const count = el('span', 'val');
      count.textContent = String(g.guests);
      row.appendChild(count);
      // A bar scaled to the loudest complaint, so the shape of the problem
      // reads before any of the numbers do.
      const bar = el('div', 'th-bar');
      const fill = el('i');
      fill.style.width = `${Math.round((g.guests / loudest) * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      list.appendChild(row);
    }
    if (groups.length > MAX_ROWS) {
      list.appendChild(el('div', 'p-note', `…and ${groups.length - MAX_ROWS} quieter complaints`));
    }
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return { title: 'Thoughts', width: 340, content, onClose: () => window.clearInterval(timer) };
}
