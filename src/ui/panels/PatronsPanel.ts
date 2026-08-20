import { eventBus } from '../../EventBus';
import { world } from '../../gameContext';
import { PATRONS, type PatronTierId } from '../../data/balance';
import type { Patron } from '../../sim/patrons';
import { el, formatCash } from '../dom';
import { iconLabel } from '../icons';
import type { PanelSpec } from '../WindowManager';

const REFRESH_MS = 500;
const MAX_ROWS = 12;

/** Tier accent classes, so a rung reads before its label does. */
const TIER_CLASS: Record<PatronTierId, string> = {
  silver: 'pt-silver',
  gold: 'pt-gold',
  black: 'pt-black',
};

/** How a patron's last visit reads against today. */
function lastSeen(patron: Patron, today: number): string {
  const gap = today - patron.lastSeenDay;
  if (gap <= 0) return 'here today';
  if (gap === 1) return 'yesterday';
  return `${gap} days ago`;
}

// A1b — the patron roster.
//
// This panel is a *record*, not a workflow. Everything that needs the player's
// attention reaches them through the ticker while it is still actionable: who
// is expected in tonight, who just earned a card, who left un-hosted. The
// documented failure mode for loyalty systems is making the player do the
// tracking, so nothing here is a task list — it is the answer to "who are my
// regulars?", available when the player wants it and silent when they don't.
export function makePatronsPanel(): PanelSpec {
  const content = el('div');
  const heading = el('div', 'p-heading', 'Carded patrons');
  const summary = el('div', 'p-note');
  const list = el('div');
  const footer = el('div', 'p-note');
  content.append(heading, summary, list, footer);

  // Clicking a patron who happens to be on the floor jumps the camera to them:
  // the one action worth taking from a roster, and the shortest path from
  // "who is Rita?" to watching Rita play.
  list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.pt-row');
    const patronId = row?.dataset.patronId;
    if (!patronId) return;
    const guest = [...world.guests.values()].find((g) => g.patronId === patronId);
    if (guest) eventBus.emit('followGuest', { guestId: guest.id });
  });

  const render = () => {
    const patrons = world.patrons.all();
    const today = world.time.day;
    const onFloor = new Set(
      [...world.guests.values()].map((g) => g.patronId).filter((id): id is string => id !== null),
    );

    heading.textContent = `Carded patrons: ${patrons.length} of ${PATRONS.rosterCap}`;
    const due = world.patrons.pendingArrivals;
    summary.textContent = due > 0 ? `${due} expected in later today.` : 'Nobody else expected in today.';
    summary.hidden = patrons.length === 0;

    list.textContent = '';
    if (patrons.length === 0) {
      footer.textContent = '';
      list.appendChild(
        el(
          'div',
          'p-note',
          `Nobody has earned a card yet. A guest gets one once their theoretical win passes $${PATRONS.cardThresholdTheo} — play, not spend.`,
        ),
      );
      return;
    }

    for (const patron of patrons.slice(0, MAX_ROWS)) {
      const here = onFloor.has(patron.id);
      const row = el('button', `p-row pt-row ${TIER_CLASS[patron.tier.id]}`);
      row.dataset.patronId = patron.id;
      row.disabled = !here;
      row.title = here
        ? `${patron.name} is on the floor — click to follow`
        : `${patron.name} · ${patron.visits} visit${patron.visits === 1 ? '' : 's'} · last here ${lastSeen(patron, today)}`;
      row.appendChild(iconLabel('patronTier', patron.name, 'pt-name'));

      const meta = el('span', 'pt-meta');
      // Lifetime theo is the number promotion runs on, so it is the number
      // shown — not net result, which rewards a patron's bad luck rather than
      // their play.
      meta.textContent = here
        ? `${patron.tier.name} · here now`
        : `${patron.tier.name} · ${lastSeen(patron, today)}`;
      row.appendChild(meta);

      const value = el('span', 'val');
      value.textContent = formatCash(patron.lifetimeTheo);
      row.appendChild(value);
      list.appendChild(row);
    }

    footer.textContent =
      patrons.length > MAX_ROWS
        ? `…and ${patrons.length - MAX_ROWS} more on the books`
        : `Lifetime theoretical win decides the tier. Unseen for ${PATRONS.pruneAfterDaysAbsent} days and a card lapses.`;
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return {
    title: 'Patrons',
    width: 340,
    content,
    onClose: () => window.clearInterval(timer),
  };
}
