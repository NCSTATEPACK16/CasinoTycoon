import { MODIFIERS } from '../../data/balance';
import { getObjectDef } from '../../data/objects';
import type { DailyRecord, SourceRecord } from '../../sim/economy';
import { el, formatCash, row } from '../dom';
import { icon } from '../icons';
import type { PanelSpec } from '../WindowManager';

/** Names for the costs that belong to no placed object. */
const HOUSE_LABELS: Record<string, string> = {
  wages: 'Staff wages',
  comps: 'Comps',
  fines: 'Fines',
};

/** Matches the machine inspector's window title, so the row that lost money
 *  names the same object the player can click. Two "Slot Machine" rows and no
 *  way to tell which is which is a breakdown that does not break anything down. */
const sourceLabel = (r: SourceRecord): string => {
  const house = HOUSE_LABELS[r.defId];
  if (house) return house;
  const name = getObjectDef(r.defId)?.name ?? r.defId;
  return `${name} ${r.id.replace('obj-', '#')}`;
};

const net = (r: SourceRecord): number => r.revenue - r.upkeep;

/**
 * B6 — one expandable line per source, ranked by what it actually contributed.
 *
 * Collapsed by default: the headline numbers are the answer most days, and a
 * wall of rows would bury them. Expanding is the follow-up question — "which
 * of my machines is carrying this?" — and it only became answerable at all
 * once P1 attributed revenue per object.
 */
function makeBreakdown(record: DailyRecord): HTMLElement {
  const wrap = el('div');
  if (record.sources.length === 0) return wrap;

  const toggle = el('button', 'p-tool dr-toggle');
  const list = el('div');
  list.hidden = true;
  wrap.append(toggle, list);

  const rows = [...record.sources].sort((a, b) => net(b) - net(a));

  const syncToggle = () => {
    toggle.replaceChildren();
    toggle.appendChild(icon(list.hidden ? 'stepDown' : 'stepUp', 'dr-caret'));
    toggle.appendChild(el('span', '', list.hidden ? 'Where it came from' : 'Hide breakdown'));
  };
  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    syncToggle();
  });
  syncToggle();

  for (const r of rows) {
    const value = net(r);
    const line = el('div', 'p-row');
    line.appendChild(el('span', '', sourceLabel(r)));
    const val = el('span', `val ${value > 0 ? 'up' : value < 0 ? 'down' : ''}`);
    val.textContent = `${value < 0 ? '−' : ''}${formatCash(Math.abs(value))}`;
    line.appendChild(val);
    // Handle is the context that stops a thin-margin, high-volume table from
    // reading as a failure next to a quiet one with the same net.
    if (r.wagered > 0) {
      line.title = `${formatCash(r.wagered)} wagered, ${formatCash(r.won)} paid out`;
    }
    list.appendChild(line);
  }
  return wrap;
}

/** Per-day report: winners/losers lists + the day's headline stats.
 *
 * Note: `record.winners` is "top 5 sessions by net value, whatever the
 * sign" per the ledger's contract (economy.ts), not "top 5 profitable
 * guests" — a day with fewer than 5 net-positive guests can still surface
 * a net-negative session under "winners". We filter to net > 0 here so a
 * guest who actually lost money is never shown as a winner; the raw
 * ranking (unfiltered) still drives the ticker headline in world.ts, which
 * only ever reads winners[0] and already only fires when that top slot is
 * truthy/found — a caller wanting the literal top-5-by-rank list unfiltered
 * can still get it from `record.winners` directly. */
export function makeDailyReportPanel(record: DailyRecord): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', `Day ${record.day} Report`));
  content.appendChild(row('Profit', formatCash(record.profit)));
  content.appendChild(row('Taken in', formatCash(record.takenIn)));
  content.appendChild(row('Paid out', formatCash(record.paidOut)));
  content.appendChild(row('Guests', String(record.guestCount)));
  content.appendChild(row('Jackpots', String(record.jackpotCount)));
  content.appendChild(row('Rage quits', String(record.rageQuitCount)));
  // Comps are already inside `expenses`; breaking them out is what makes the
  // spend legible as a decision rather than as overhead.
  if (record.compSpend > 0) content.appendChild(row('Comps', formatCash(record.compSpend)));

  // A12: the movement, not just the level — a player needs to see that
  // yesterday's play is what moved it.
  const repDelta = record.reputationDelta;
  const repRow = el('div', 'p-row');
  repRow.appendChild(el('span', '', 'Reputation'));
  const repVal = el('span', `val ${repDelta > 0 ? 'up' : repDelta < 0 ? 'down' : ''}`);
  const sign = repDelta > 0 ? '+' : '';
  repVal.textContent =
    repDelta === 0
      ? `${Math.round(record.reputation)}/100`
      : `${Math.round(record.reputation)}/100 (${sign}${repDelta.toFixed(1)})`;
  repRow.appendChild(repVal);
  content.appendChild(repRow);

  // A5: which conditions this day was played under. Resolved by id against the
  // catalog, so a retired modifier degrades to nothing rather than a raw slug.
  if (record.modifierIds.length > 0) {
    content.appendChild(el('div', 'p-heading', 'Conditions'));
    const tags = el('div');
    for (const id of record.modifierIds) {
      const def = MODIFIERS.catalog.find((m) => m.id === id);
      if (def) tags.appendChild(el('span', 'cond-tag', def.name));
    }
    content.appendChild(tags);
  }

  content.appendChild(makeBreakdown(record));

  const winners = record.winners.filter((w) => w.net > 0);
  content.appendChild(el('div', 'p-heading', 'Top winners'));
  if (winners.length === 0) {
    content.appendChild(el('div', 'p-note', 'Nobody walked away ahead.'));
  }
  for (const w of winners) {
    content.appendChild(row(`${w.name} (${w.favoriteGame})`, `+${formatCash(w.net)}`));
  }

  content.appendChild(el('div', 'p-heading', 'Top losers'));
  if (record.losers.length === 0) {
    content.appendChild(el('div', 'p-note', 'Nobody took a real beating.'));
  }
  for (const l of record.losers) {
    content.appendChild(row(`${l.name} (${l.favoriteGame})`, formatCash(l.net)));
  }

  return { title: `Day ${record.day}`, width: 280, content };
}
