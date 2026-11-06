// B10: the Events tab. Each ad or event the scenario offers, with its price,
// when it runs, its cooldown and what the sim expects it to bring at this
// floor now; a Run button; what's on now; and what past runs really did
// (arrivals in their hours against the same hours without them). Built once
// per event and patched, so a press never lands on a rebuilt button.

import './MarketingPanel.css';
import type { MarketingView } from '../../worker/marketing';
import { button, el, escapeHtml, money } from '../dom';

const KIND_LABEL: Record<string, string> = {
  ad: 'Ad',
  tournament: 'Tournament',
  junket: 'Junket',
  show: 'Show',
};

interface Card {
  root: HTMLElement;
  expected: HTMLElement;
  run: HTMLButtonElement;
}

export class MarketingPanel {
  readonly root = el('div', 'marketing');
  onRun: (eventId: string) => void = () => {};
  private head = el('p', 'small dim');
  private list = el('div', 'mk-list');
  private running = el('div', 'mk-running');
  private past = el('div', 'mk-past');
  private cards = new Map<string, Card>();

  constructor() {
    this.root.append(
      el('h3', '', 'Marketing and events'),
      this.head,
      this.running,
      this.list,
      el('h3', '', 'What they did'),
      this.past,
    );
  }

  update(v: MarketingView): void {
    if (v.events.length === 0) {
      this.head.textContent = 'This scenario offers no marketing. Word of mouth will have to do.';
    } else {
      this.head.textContent = `Paid when booked. Extra guests still need room: ${v.guests} on the floor, room for ${v.cap}.`;
    }
    this.running.innerHTML = v.running.length
      ? `<b>On now:</b> ${v.running.map((r) => `${escapeHtml(r.name)} <span class="dim">${escapeHtml(r.status)}</span>`).join(' · ')}`
      : '';
    const keep = new Set(v.events.map((e) => e.id));
    for (const [id, c] of this.cards)
      if (!keep.has(id)) {
        c.root.remove();
        this.cards.delete(id);
      }
    for (const e of v.events) {
      let c = this.cards.get(e.id);
      if (!c) {
        const root = el('div', 'mk-card');
        root.innerHTML = `<div class="mk-top"><b>${escapeHtml(e.name)}</b><span class="mk-kind">${KIND_LABEL[e.kind] ?? e.kind}</span><span class="mk-cost">${money(e.cost)}</span></div><p class="small dim">${escapeHtml(e.blurb)}</p><div class="small">Runs ${escapeHtml(e.runs)} · cooldown ${escapeHtml(e.cooldown)}</div>`;
        const expected = el('div', 'small mk-expected');
        const run = button('Run', () => this.onRun(e.id), 'small');
        const foot = el('div', 'mk-foot');
        foot.append(expected, run);
        root.append(foot);
        this.list.append(root);
        c = { root, expected, run };
        this.cards.set(e.id, c);
      }
      c.expected.textContent = `Expect ${e.expected}.`;
      c.run.disabled = e.blocked !== null;
      c.run.textContent = e.blocked ?? 'Run';
      c.root.classList.toggle('blocked', e.blocked !== null);
    }
    this.past.innerHTML = v.past.length
      ? `<table class="fin"><thead><tr><th>Event</th><th>From</th><th class="num">Cost</th><th class="num">Extra guests</th></tr></thead><tbody>${v.past
          .slice(0, 12)
          .map(
            (p) =>
              `<tr title="${escapeHtml(p.result)}"><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.when)}</td><td class="num">${money(p.cost)}</td><td class="num">${p.extra >= 0 ? '+' : ''}${p.extra}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<p class="small dim">Nothing run yet. Each run is measured against the same hours without it.</p>';
  }
}
