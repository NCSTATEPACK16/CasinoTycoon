import { el } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { makeGuestsPanel } from './GuestsPanel';
import { makePatronsPanel } from './PatronsPanel';
import { makeThoughtsPanel } from './ThoughtsPanel';

// P16 — one window for the people on the floor.
//
// Guests, Patrons and Thoughts were three toolbar buttons for one concept: who
// is here, which of them are regulars, and what all of them think of the place.
// Three windows for one idea is how an interface starts outgrowing what it can
// support — the criticism that sank Casino Inc's — and the player had to open
// and arrange three of them to answer a single question.
//
// The views themselves are unchanged and still live in their own modules. This
// only hosts them.

/** Which bodies are hidden, given the active tab. Out-of-range falls back to
 *  the first tab: a stale index must never leave the panel showing nothing. */
export function hiddenFlags(count: number, activeIndex: number): boolean[] {
  const active = activeIndex >= 0 && activeIndex < count ? activeIndex : 0;
  return Array.from({ length: count }, (_, i) => i !== active);
}

/**
 * One cleanup that runs all of them.
 *
 * Every sub-panel holds a 2Hz interval, so a host that only cleans up the
 * visible tab leaks two of three on every open and close. A throwing cleanup
 * must not strand the others either — that is one panel's bug becoming three
 * panels' leak.
 */
export function combineCleanups(cleanups: readonly ((() => void) | undefined)[]): () => void {
  return () => {
    for (const fn of cleanups) {
      try {
        fn?.();
      } catch {
        // Deliberately swallowed: the remaining intervals matter more than
        // surfacing a failure in teardown, and there is no user action here.
      }
    }
  };
}

interface TabDef {
  id: string;
  label: string;
  make: () => PanelSpec;
}

const TABS: readonly TabDef[] = [
  { id: 'guests', label: 'Guests', make: makeGuestsPanel },
  { id: 'patrons', label: 'Regulars', make: makePatronsPanel },
  { id: 'thoughts', label: 'Thoughts', make: makeThoughtsPanel },
];

export function makePeoplePanel(): PanelSpec {
  const content = el('div');
  const strip = el('div', 'p-tabs');
  content.appendChild(strip);

  // Built eagerly: all three were separately openable before, so this is no
  // more work than a player who had them all up, and it keeps the tab switch
  // instant rather than rebuilding a list on every click.
  const panels = TABS.map((t) => t.make());
  const buttons: HTMLButtonElement[] = [];
  const bodies = panels.map((p) => {
    const body = el('div');
    body.dataset.tabBody = '';
    body.appendChild(p.content);
    content.appendChild(body);
    return body;
  });

  const select = (index: number) => {
    const hidden = hiddenFlags(bodies.length, index);
    bodies.forEach((b, i) => (b.hidden = hidden[i]!));
    buttons.forEach((b, i) => b.classList.toggle('pressed', !hidden[i]));
  };

  for (const [i, t] of TABS.entries()) {
    const btn = el('button', 'p-tool', t.label);
    btn.dataset.tab = t.id;
    btn.addEventListener('click', () => select(i));
    strip.appendChild(btn);
    buttons.push(btn);
  }
  select(0);

  return {
    title: 'People',
    width: Math.max(...panels.map((p) => p.width)),
    content,
    onClose: combineCleanups(panels.map((p) => p.onClose)),
  };
}
