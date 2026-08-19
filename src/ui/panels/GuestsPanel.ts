import { world } from '../../gameContext';
import { eventBus } from '../../EventBus';
import { COMPS, type CompKind } from '../../data/balance';
import { getObjectDef } from '../../data/objects';
import type { GuestArchetype, GuestState } from '../../sim/entities/Guest';
import { el, formatCash, row } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { iconLabel, type IconName } from '../icons';

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

const ARCHETYPE: Record<GuestArchetype, { icon: IconName; label: string } | null> = {
  regular: null,
  highRoller: { icon: 'highRoller', label: 'High Roller' },
  biker: { icon: 'biker', label: 'Biker' },
  tourist: { icon: 'tourist', label: 'Tourist' },
};

// A1a — the three comps the player can send, cheapest first so the common
// gesture is the leftmost button.
const COMP_BUTTONS: { kind: CompKind; label: string; icon: IconName }[] = [
  { kind: 'drink', label: 'Drink', icon: 'bar' },
  { kind: 'meal', label: 'Meal', icon: 'food-stall' },
  { kind: 'matchPlay', label: 'Match play', icon: 'freePlay' },
];

const moodIcon = (happiness: number): IconName =>
  happiness >= 70 ? 'moodHappy' : happiness >= 40 ? 'moodNeutral' : 'moodSad';

// Live guest browser: click a guest for needs bars + recent thoughts.
export function makeGuestsPanel(): PanelSpec {
  const content = el('div');
  const heading = el('div', 'p-heading', 'Guests: 0 in casino');
  const list = el('div');
  const detail = el('div');
  // Built once and re-synced, not rebuilt: at a 500ms refresh a button that is
  // replaced on every tick is a button you cannot reliably press.
  const follow = el('button', 'p-tool g-follow');
  follow.addEventListener('click', () => {
    if (!selectedId) return;
    eventBus.emit('followGuest', { guestId: followingId === selectedId ? null : selectedId });
  });
  // Built once and re-synced for the same reason as the follow button: at a
  // 500ms refresh, a button rebuilt every tick is a button that eats clicks.
  const comps = el('div', 'g-comps');
  const compButtons = COMP_BUTTONS.map(({ kind, label, icon: iconName }) => {
    const btn = el('button', 'p-tool');
    btn.appendChild(iconLabel(iconName, `${label} $${COMPS.compUnit[kind]}`));
    btn.addEventListener('click', () => {
      if (!selectedId) return;
      world.sendComp(selectedId, kind);
      render();
    });
    comps.appendChild(btn);
    return { kind, btn };
  });
  const compNote = el('div', 'g-comp-note');
  content.append(heading, list, follow, comps, compNote, detail);
  let selectedId: string | null = null;
  let followingId: string | null = null;

  interface Row {
    el: HTMLButtonElement;
    label: HTMLSpanElement;
    value: HTMLSpanElement;
    mood: IconName;
  }
  const rows = new Map<string, Row>();
  const more = el('div', 'p-note');

  // Delegated, because the list is rebuilt on every refresh: a handler bound to
  // a row would be clicking a node that is about to be detached.
  list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.g-row');
    const id = row?.dataset.guestId;
    if (!id) return;
    selectedId = selectedId === id ? null : id;
    render();
  });

  const render = () => {
    const guests = [...world.guests.values()];
    heading.textContent = `Guests: ${guests.length} in casino`;
    if (selectedId && !world.guests.has(selectedId)) selectedId = null;

    // Rows are reused across refreshes rather than rebuilt. At twice a second,
    // replacing the list wholesale would throw away focus, hover, and any
    // in-progress click twice per second.
    const shown = guests.slice(0, MAX_ROWS);
    for (const g of shown) {
      let row = rows.get(g.id);
      if (!row) {
        const el_ = el('button', 'p-row g-row');
        el_.dataset.guestId = g.id;
        const label = iconLabel(moodIcon(g.needs.happiness), g.name);
        const value = el('span', 'val');
        el_.append(label, value);
        row = { el: el_, label, value, mood: moodIcon(g.needs.happiness) };
        rows.set(g.id, row);
      }
      const mood = moodIcon(g.needs.happiness);
      if (mood !== row.mood) {
        row.mood = mood;
        row.label.replaceWith((row.label = iconLabel(mood, g.name)));
      }
      row.value.textContent = `$${Math.round(g.wallet)}`;
      row.el.classList.toggle('selected', g.id === selectedId);
    }
    for (const [id, row] of rows) {
      if (!shown.some((g) => g.id === id)) {
        row.el.remove();
        rows.delete(id);
      }
    }
    // Re-append in rank order; appending an existing child moves it.
    for (const g of shown) list.appendChild(rows.get(g.id)!.el);

    more.textContent =
      guests.length > MAX_ROWS ? `…and ${guests.length - MAX_ROWS} more` : '';
    if (guests.length > MAX_ROWS) list.appendChild(more);
    else more.remove();

    detail.textContent = '';
    const sel = selectedId ? world.guests.get(selectedId) : undefined;
    follow.hidden = !sel;
    comps.hidden = !sel;
    compNote.hidden = !sel;
    if (sel) {
      // Theo, not net result, is what a casino rates a player on — a guest who
      // wagered heavily and got lucky is still worth comping. Showing it is
      // what makes the spend a judgement rather than a guess.
      const theo = sel.theo();
      const headroom = sel.compHeadroom();
      for (const { kind, btn } of compButtons) {
        const cost = COMPS.compUnit[kind];
        const reason = !sel.compEligible
          ? `${sel.name} hasn't played enough yet — needs $${COMPS.theoFloorToComp} of theoretical win`
          : cost > headroom
            ? `${sel.name} has had their fill this visit`
            : '';
        btn.disabled = reason !== '';
        btn.title = reason || `Send ${sel.name} a comp worth $${cost}`;
      }
      compNote.textContent = sel.compEligible
        ? `Theoretical win $${theo.toFixed(2)} · comped $${sel.compsReceived.toFixed(2)} of $${(sel.compsReceived + headroom).toFixed(2)}`
        : `Theoretical win $${theo.toFixed(2)} of $${COMPS.theoFloorToComp} needed to comp`;
    }
    if (sel) {
      const on = followingId === sel.id;
      follow.replaceChildren(
        iconLabel('rating', on ? 'Following — click to stop' : 'Follow camera'),
      );
      follow.classList.toggle('pressed', on);
    }
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
    const head = el('div', 'p-heading', `${sel.name} — ${STATE_LABEL[sel.state]}`);
    const arch = ARCHETYPE[sel.archetype];
    // Archetype rides as a chip rather than more text in the heading: it is the
    // one attribute worth spotting at a glance in a list of 130.
    if (arch) head.appendChild(iconLabel(arch.icon, arch.label, 'g-arch'));
    detail.appendChild(head);

    // The session ledger. Every field below already existed on Guest — this
    // panel is pure surfacing, which is why it costs nothing to show.
    detail.appendChild(row('Wallet', formatCash(sel.wallet)));
    const net = el('div', 'p-row');
    // "Today", not "session": world.foldGuestSession() banks netResult into the
    // day's ledger and zeroes it at midnight, so after a rollover this reads $0
    // even for a guest who has been playing for hours.
    net.appendChild(el('span', '', 'Net today'));
    const netVal = el('span', `val ${sel.netResult >= 0 ? 'up' : 'down'}`);
    // Signed from the guest's side: a guest up $40 is the house down $40.
    netVal.textContent = `${sel.netResult >= 0 ? '+' : '-'}${formatCash(Math.abs(sel.netResult))}`;
    net.appendChild(netVal);
    detail.appendChild(net);
    detail.appendChild(row('Wagered', formatCash(sel.totalWagered())));
    const fav = sel.favoriteGame();
    if (fav) detail.appendChild(row('Favorite game', getObjectDef(fav)?.name ?? fav));

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
      const thought = el('div', 'g-thought');
      thought.appendChild(iconLabel('thought', t.text));
      detail.appendChild(thought);
    }
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  // The scene clears the follow itself when the guest leaves or the player
  // grabs the camera, so the button state comes from the event, not from here.
  const offFollow = eventBus.on('followGuest', ({ guestId }) => {
    followingId = guestId;
    render();
  });
  return {
    title: 'Guests',
    width: 320,
    content,
    onClose: () => {
      window.clearInterval(timer);
      offFollow();
      if (followingId) eventBus.emit('followGuest', { guestId: null });
    },
  };
}
