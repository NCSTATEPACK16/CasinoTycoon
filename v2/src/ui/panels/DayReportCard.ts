// The end-of-day report card: when a day closes, what it made and why — the
// P&L, the best and worst game, the rating's move, who won big, and anything
// worth remembering (fines, forced sales, loans). It opens on its own at
// midnight unless the player turns that off (a per-browser preference), and
// from the Finances tab at any time. It never pauses the game.

import type { DayReport } from '../../worker/finance';
import { button, el, escapeHtml, money, pct } from '../dom';

const AUTO_KEY = 'casino-v2-report-auto';

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeAuto(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the card still works, it just forgets.
  }
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`;
const cls = (n: number) => (n >= 0 ? 'good' : 'bad');

export class DayReportCard {
  readonly root = el('div', 'help-overlay report-overlay');
  private card = el('div', 'help-card report-card');
  private auto = el('input');
  private lastDay = -1;
  /** Opens the Finances tab. */
  onFinances: () => void = () => {};

  constructor() {
    this.root.append(this.card);
    this.root.hidden = true;
    this.root.onclick = (e) => {
      if (e.target === this.root) this.close();
    };
    this.auto.type = 'checkbox';
    this.auto.checked = readAuto();
    this.auto.onchange = () => writeAuto(this.auto.checked);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get autoShow(): boolean {
    return this.auto.checked;
  }

  /** Call with each HUD day; true once when the day rolls over in play. */
  dayRolled(day: number): boolean {
    const rolled = this.lastDay !== -1 && day === this.lastDay + 1;
    this.lastDay = day;
    return rolled;
  }

  /** A new game or a load: the next day seen is a starting point, not a close. */
  resetDay(): void {
    this.lastDay = -1;
  }

  close(): void {
    this.root.hidden = true;
  }

  show(r: DayReport): void {
    const p = r.pnl;
    const change =
      r.previousProfit === null
        ? ''
        : `<span class="dim">${signed(p.profit - r.previousProfit)} on the day before</span>`;
    const rating = r.rating
      ? `★ ${r.rating.value}${
          r.rating.delta === null || r.rating.delta === 0
            ? ''
            : ` <span class="${cls(r.rating.delta)}">${r.rating.delta > 0 ? '▲' : '▼'} ${Math.abs(r.rating.delta)}</span>`
        }`
      : '—';
    const rep = `${Math.round(r.reputation.value)}${
      Math.abs(r.reputation.delta) >= 0.05
        ? ` <span class="${cls(r.reputation.delta)}">${r.reputation.delta > 0 ? '+' : ''}${r.reputation.delta.toFixed(1)}</span>`
        : ''
    }`;
    const game = (label: string, g: DayReport['best']) =>
      g
        ? `<div><span class="dim">${label}</span><b>${escapeHtml(g.name)}</b> <span class="${cls(g.net)}">${money(g.net)}</span> <span class="dim">hold ${pct(g.hold, 1)}</span></div>`
        : '';
    const interest = r.interest.overdraft + r.interest.loans;
    const lines: [string, number][] = [
      ['Games’ win', p.gaming.win],
      ['Food & drink', p.foodAndBeverage],
      ['Other income', p.otherRevenue],
      ['Wages', -p.wages],
      ['Upkeep & stock', -p.upkeep],
      ['Comps', -p.comps],
      ['Fines', -(p.otherExpenses - interest)],
      ['Interest', -interest],
    ];
    const people = (title: string, list: DayReport['winners']) =>
      list.length
        ? `<div><span class="dim">${title}</span>${list
            .map(
              (w) => `${escapeHtml(w.name)} <span class="${cls(-w.net)}">${signed(w.net)}</span>`,
            )
            .join(' · ')}</div>`
        : '';
    this.card.innerHTML = `
      <div class="help-head"><h3>${r.weekday}, day ${r.day}: closed</h3></div>
      <div class="report-top">
        <div class="report-profit"><span class="dim">Profit</span><b class="${cls(p.profit)}">${money(p.profit)}</b>${change}</div>
        <div><span class="dim">Rating</span><b>${rating}</b></div>
        <div><span class="dim">Reputation</span><b>${rep}</b></div>
        <div><span class="dim">Visits</span><b>${r.guests.toLocaleString()}</b></div>
      </div>
      <div class="report-grid">
        <section>
          <h4>Profit &amp; loss</h4>
          <table class="fin report-pnl">
            <tr><td class="dim">Handle</td><td>${money(p.gaming.handle)} <span class="dim">hold ${pct(p.gaming.hold, 1)}</span></td></tr>
            ${lines
              .filter(([, v]) => Math.abs(v) >= 0.5)
              .map(([k, v]) => `<tr><td>${k}</td><td class="${cls(v)}">${money(v)}</td></tr>`)
              .join('')}
            <tr class="total"><td>Profit</td><td class="${cls(p.profit)}">${money(p.profit)}</td></tr>
          </table>
          <p class="small dim">Cash at the close ${r.cash === null ? '—' : money(r.cash)}${
            r.debt ? ` · owed to the bank ${money(r.debt)}` : ''
          }</p>
        </section>
        <section class="report-notes">
          <h4>The day</h4>
          ${game('Best game ', r.best)}
          ${game('Worst game ', r.worst)}
          ${people(
            'Biggest winners ',
            r.winners.filter((w) => w.net > 0),
          )}
          ${people('Heaviest losers ', r.losers)}
          <div><span class="dim">Jackpots</span> ${r.jackpots} · <span class="dim">rage-quits</span> ${r.rageQuits} · <span class="dim">comps</span> ${money(r.comps)}</div>
          ${r.conditions.length ? `<div><span class="dim">Conditions</span> ${r.conditions.map(escapeHtml).join(', ')}</div>` : ''}
          ${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
        </section>
      </div>`;
    const foot = el('div', 'report-foot');
    const label = el('label', 'small dim');
    label.append(this.auto, document.createTextNode(' Show this at the end of every day'));
    foot.append(
      label,
      button(
        'Finances',
        () => {
          this.close();
          this.onFinances();
        },
        'small',
      ),
      button('Close', () => this.close(), 'small primary'),
    );
    this.card.append(foot);
    this.card.querySelector('.help-head')!.append(button('✕', () => this.close(), 'small'));
    this.root.hidden = false;
  }
}
