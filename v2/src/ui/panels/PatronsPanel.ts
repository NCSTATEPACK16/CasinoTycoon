// The players club: every carded patron, their tier and how close the next
// one is, their last few visits, and — for the ones on the floor right now —
// comp buttons and a way to find them. Black-tier patrons want looking after;
// the roster says so, and says who was neglected last time.

import type { PatronView } from '../../worker/inspect';
import { button, el, escapeHtml, money } from '../dom';
import { compButtons, compStatus, type CompKind } from './comps';

export class PatronsPanel {
  readonly root = el('div', 'patrons-panel');
  private key = '';
  onComp: (guestId: string, kind: CompKind) => void = () => {};
  onLocate: (agentId: number) => void = () => {};

  update(list: PatronView[]): void {
    // Rebuilt only when something on a card changes, so a press on a comp
    // button is never swapped out mid-click by the once-a-second poll.
    const key = JSON.stringify(list);
    if (key === this.key) return;
    this.key = key;
    const sorted = [...list].sort(
      (a, b) =>
        Number(!!b.onFloor) - Number(!!a.onFloor) ||
        Number(b.dueToday) - Number(a.dueToday) ||
        b.lifetimeTheo - a.lifetimeTheo,
    );
    const here = list.filter((p) => p.onFloor).length;
    const due = list.filter((p) => p.dueToday).length;
    this.root.replaceChildren(
      el('h3', '', `Players club (${list.length})`),
      el(
        'p',
        'dim small',
        list.length
          ? `${here} on the floor now · ${due} expected today. Guests are carded once their play is worth $60 in theo; tiers rise with lifetime theo, and better tiers come back more often.`
          : 'No one is carded yet. A guest whose play is worth $60 in theo earns a card when they leave, and card holders come back on later days.',
      ),
    );
    for (const p of sorted) this.root.append(this.card(p));
  }

  private card(p: PatronView): HTMLElement {
    const c = el('div', `patron tier-${p.tier.toLowerCase()}`);
    const where = p.onFloor
      ? '<b class="good">On the floor</b>'
      : p.dueToday
        ? '<b class="warn">Expected today</b>'
        : `<span class="dim">Last seen day ${p.lastSeenDay}</span>`;
    c.innerHTML = `
      <div class="patron-head"><b>${escapeHtml(p.name)}</b><span class="tier">${p.tier}</span><span class="dim small">${escapeHtml(p.archetype)}</span><span class="where">${where}</span></div>
      <div class="small">${p.visits} visit${p.visits === 1 ? '' : 's'} · lifetime theo ${money(p.lifetimeTheo)}${
        p.nextTier ? ` · ${p.nextTier.name} at ${money(p.nextTier.theo)}` : ' · top tier'
      }</div>
      ${p.nextTier ? `<i class="patron-progress" style="--v:${Math.min(100, (p.lifetimeTheo / p.nextTier.theo) * 100)}%"></i>` : ''}
      <div class="small dim">Recent: ${
        p.recent
          .slice()
          .reverse()
          .map(
            (v) =>
              `day ${v.day} ${money(v.theo)}${v.comps > 0 ? ` <span class="good">(comped ${money(v.comps)})</span>` : ''}`,
          )
          .join(' · ') || '—'
      }</div>
      ${p.wantsHost ? `<div class="small ${p.neglected ? 'bad' : 'warn'}">${p.neglected ? 'Left un-comped last visit: half as likely to come back until comped.' : 'Wants a host: comp them every visit or they come back less.'}</div>` : ''}`;
    const f = p.onFloor;
    if (f) {
      c.append(el('div', 'small dim', compStatus(f.comp)));
      const row = compButtons(f.comp, (kind) => this.onComp(f.guestId, kind));
      row.append(button('Find ⌖', () => this.onLocate(f.agentId), 'small'));
      c.append(row);
    }
    return c;
  }
}
