import type { DailyRecord } from '../../sim/economy';
import { el, formatCash, row } from '../dom';
import type { PanelSpec } from '../WindowManager';

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
