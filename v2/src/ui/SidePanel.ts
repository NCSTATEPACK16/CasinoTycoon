// The right-hand management drawer: Inspector (any object, guest or staff,
// with the rules editor for real games, prices for food and drink, comps for
// guests), Finances (the CFO view), Staff (hire/fire), and B2's Rating,
// players Club and Prices. It polls the worker once a second while open —
// cheap, and the numbers it shows only change on the sim's timescale anyway.
// Anything with a button is built once and patched, never rebuilt by a poll:
// a rebuild swaps the button out from under a press and the click is lost.

import type { SimClient } from '../client/SimClient';
import type { CasinoFinancials, PeriodPnl } from '../sim/economy/financials';
import type { GameKind } from '../shared/games';
import type {
  GuestInspect,
  InspectResult,
  MachineInspect,
  PatronView,
  PricedObject,
  RatingReport,
  StaffInspect,
} from '../worker/inspect';
import { button, el, escapeHtml, money, pct } from './dom';
import type { GuestRow, ThoughtSummary } from '../worker/feedback';
import type { FinanceHistory, LoansView } from '../worker/finance';
import { compButtons, compStatus, type CompKind } from './panels/comps';
import { FinanceChart } from './panels/FinanceChart';
import { GuestsPanel } from './panels/GuestsPanel';
import { LoansPanel } from './panels/LoansPanel';
import { PatronsPanel } from './panels/PatronsPanel';
import { PricesPanel } from './panels/PricesPanel';
import { RatingPanel } from './panels/RatingPanel';
import { RULE_FIELDS, type RuleField } from './rulesSchema';

export type PanelTab =
  'inspect' | 'finances' | 'staff' | 'rating' | 'patrons' | 'prices' | 'guests';
type Target = { objectId: string } | { agentId: number };

const HIRE: { kind: string; label: string; blurb: string }[] = [
  { kind: 'dealer', label: 'Dealer', blurb: 'Opens a table. Tables without one stay closed.' },
  { kind: 'janitor', label: 'Janitor', blurb: 'Cleans spills and litter.' },
  { kind: 'security', label: 'Security', blurb: 'Handles drunks and rage-quitters.' },
  { kind: 'mechanic', label: 'Mechanic', blurb: 'Repairs broken machines.' },
  { kind: 'bartender', label: 'Bartender', blurb: 'Staffs a bar.' },
  { kind: 'cashier', label: 'Cashier', blurb: 'Staffs the cage.' },
  {
    kind: 'waitress',
    label: 'Waitress',
    blurb: 'Carries drinks from the bar to seated players, so they keep playing.',
  },
  {
    kind: 'pitBoss',
    label: 'Pit boss',
    blurb: 'Watches the floor. Counts toward the security rating.',
  },
];

export class SidePanel {
  readonly root = el('aside', 'side-panel');
  private body = el('div', 'sp-body');
  private tabs = new Map<PanelTab, HTMLButtonElement>();
  private tab: PanelTab | null = null;
  private target: Target | null = null;
  private timer = 0;
  onSell: (objectId: string) => void = () => {};
  /** Take the camera to a guest on the floor (by numeric agent id). */
  onLocateGuest: (agentId: number) => void = () => {};
  /** Keep the camera on a guest as they move (B5). */
  onFollowGuest: (agentId: number, name: string) => void = () => {};
  onClose: () => void = () => {};
  /** A comp or price action's outcome, for the toast. */
  onMessage: (text: string) => void = () => {};
  private rating = new RatingPanel();
  private patrons = new PatronsPanel();
  private prices = new PricesPanel();
  /** B5: what guests think, and everyone on the floor. */
  private guests = new GuestsPanel();
  /** B4: the Finances tab's P&L (patched HTML, no buttons), chart and loans. */
  private finPnl = el('div', 'fin-pnl');
  private finActions = el('div', 'fin-actions');
  private chart = new FinanceChart();
  private loans = new LoansPanel();
  /** Opens the last closed day's report card. */
  onReport: () => void = () => {};
  /** The price editor inside a food stall's or bar's inspector. */
  private inspectPrices: PricesPanel | null = null;

  constructor(private sim: SimClient) {
    const head = el('div', 'sp-tabs');
    for (const [t, label] of [
      ['inspect', 'Inspector'],
      ['finances', 'Finances'],
      ['staff', 'Staff'],
      ['rating', 'Rating'],
      ['guests', 'Guests'],
      ['patrons', 'Club'],
      ['prices', 'Prices'],
    ] as const) {
      const b = button(label, () => this.open(t));
      this.tabs.set(t, b);
      head.append(b);
    }
    head.append(button('✕', () => this.close(), 'sp-close'));
    this.root.append(head, this.body);
    this.root.hidden = true;
    this.patrons.onComp = (guestId, kind) => void this.comp(guestId, kind);
    this.patrons.onLocate = (agentId) => this.onLocateGuest(agentId);
    this.prices.onSetPrice = (objectId, itemId, price) => this.setPrice(objectId, itemId, price);
    this.guests.onLocate = (agentId) => this.onLocateGuest(agentId);
    this.guests.onFollow = (agentId, name) => this.onFollowGuest(agentId, name);
    this.finActions.append(button('Last day’s report', () => this.onReport(), 'small'));
    this.loans.onTake = (amount, days) =>
      this.sim.command({ type: 'takeLoan', amount, days }).then(() => this.refresh(false));
    this.loans.onRepay = (loanId, amount) =>
      this.sim.command({ type: 'repayLoan', loanId, amount }).then(() => this.refresh(false));
  }

  private async comp(guestId: string, kind: CompKind): Promise<void> {
    try {
      await this.sim.command({ type: 'sendComp', guestId, kind });
      this.onMessage(`Comp sent: ${kind === 'matchPlay' ? 'match play' : `a ${kind}`}.`);
    } catch (err) {
      this.onMessage((err as Error).message);
    }
    await this.refresh(false);
  }

  private setPrice(objectId: string, itemId: string, price: number): Promise<number> {
    return this.sim.command<number>({ type: 'setPrice', objectId, itemId, price });
  }

  get isOpen(): boolean {
    return this.tab !== null;
  }

  toggle(t: PanelTab): void {
    if (this.tab === t) this.close();
    else this.open(t);
  }

  inspect(target: Target): void {
    this.target = target;
    this.open('inspect');
  }

  open(t: PanelTab): void {
    this.tab = t;
    this.root.hidden = false;
    for (const [k, b] of this.tabs) b.classList.toggle('active', k === t);
    this.body.innerHTML = '';
    this.inspectPrices = null;
    if (t === 'rating') this.body.append(this.rating.root);
    if (t === 'patrons') this.body.append(this.patrons.root);
    if (t === 'prices') this.body.append(this.prices.root);
    if (t === 'guests') this.body.append(this.guests.root);
    if (t === 'finances')
      this.body.append(this.finActions, this.finPnl, this.chart.root, this.loans.root);
    window.clearInterval(this.timer);
    void this.refresh(true);
    this.timer = window.setInterval(() => void this.refresh(false), 1000);
  }

  close(): void {
    this.tab = null;
    this.root.hidden = true;
    window.clearInterval(this.timer);
    this.onClose();
  }

  private async refresh(first: boolean): Promise<void> {
    const t = this.tab;
    try {
      if (t === 'inspect') await this.renderInspect(first);
      else if (t === 'finances') {
        const [f, h, l] = await Promise.all([
          this.sim.command<CasinoFinancials & { wallet: number }>({ type: 'financials' }),
          this.sim.command<FinanceHistory>({ type: 'financeHistory' }),
          this.sim.command<LoansView>({ type: 'loans' }),
        ]);
        this.renderFinances(f);
        this.chart.update(h);
        this.loans.update(l);
      } else if (t === 'staff')
        this.renderStaff(await this.sim.command<StaffInspect[]>({ type: 'staffList' }));
      else if (t === 'rating')
        this.rating.update(await this.sim.command<RatingReport>({ type: 'rating' }));
      else if (t === 'patrons')
        this.patrons.update(await this.sim.command<PatronView[]>({ type: 'patrons' }));
      else if (t === 'prices')
        this.prices.update(await this.sim.command<PricedObject[]>({ type: 'prices' }));
      else if (t === 'guests') {
        const [summary, list] = await Promise.all([
          this.sim.command<ThoughtSummary>({ type: 'thoughts' }),
          this.sim.command<GuestRow[]>({ type: 'guestList' }),
        ]);
        this.guests.update(summary, list);
      }
    } catch (err) {
      if (t === 'inspect')
        this.body.innerHTML = `<p class="dim">${escapeHtml((err as Error).message)}</p>`;
    }
  }

  // ---------- inspector ----------

  private async renderInspect(first: boolean): Promise<void> {
    if (!this.target) {
      this.body.innerHTML =
        '<p class="dim">Click a machine, table, guest or staff member to inspect it.</p>';
      return;
    }
    const v = await this.sim.command<InspectResult>({ type: 'inspect', target: this.target });
    // A machine's form is built once per target: a poll only patches numbers,
    // or a rebuild would close a dropdown the player has open.
    if (!first && v.kind === 'object' && this.body.querySelector('.sp-stats')) {
      this.patchStats(v);
      return this.refreshInspectPrices();
    }
    if (!first && v.kind === 'guest' && this.body.dataset.guest === v.id) return this.patchGuest(v);
    this.body.innerHTML = '';
    delete this.body.dataset.guest;
    this.inspectPrices = null;
    if (v.kind === 'object') {
      this.renderMachine(v);
      if (v.defId === 'food-stall' || v.defId === 'bar') {
        const prices = new PricesPanel(v.id);
        prices.onSetPrice = (objectId, itemId, price) => this.setPrice(objectId, itemId, price);
        this.inspectPrices = prices;
        this.body.insertBefore(prices.root, this.body.lastElementChild);
        await this.refreshInspectPrices();
      }
    } else if (v.kind === 'guest') {
      this.body.dataset.guest = v.id;
      this.body.append(
        el('h3', '', escapeHtml(v.name)),
        el('p', 'dim g-sub'),
        el('div', 'g-stats'),
        el('div', 'g-needs'),
        el('div', 'g-thought'),
        el('div', 'g-comp'),
      );
      const target = this.target;
      if ('agentId' in target)
        this.body.append(button('Follow', () => this.onFollowGuest(target.agentId, v.name)));
      this.patchGuest(v);
    } else {
      this.body.append(
        el('h3', '', `${cap(v.role)} <span class="dim">${v.id}</span>`),
        statGrid([
          ['State', v.state],
          ['Wage', `${money(v.wagePerHour, true)}/h`],
          ['Assigned', v.assignedTo ?? '—'],
        ]),
        button(
          'Fire',
          () => void this.sim.command({ type: 'fire', staffId: v.id }).then(() => this.close()),
          'danger',
        ),
      );
    }
  }

  private async refreshInspectPrices(): Promise<void> {
    if (!this.inspectPrices) return;
    this.inspectPrices.update(await this.sim.command<PricedObject[]>({ type: 'prices' }));
  }

  /** The guest view's moving parts; the comp buttons only when their state changes. */
  private patchGuest(v: GuestInspect): void {
    const q = (cls: string) => this.body.querySelector<HTMLElement>(cls)!;
    const club = v.patron ? ` · <b class="warn">${v.patron.tier} card</b>` : '';
    q('.g-sub').innerHTML = `${escapeHtml(v.archetype)} · ${escapeHtml(v.state)}${club}`;
    q('.g-stats').replaceChildren(
      statGrid([
        ['Wallet', money(v.wallet, true)],
        ['Bankroll', v.bankroll ? money(v.bankroll.bankroll) : '—'],
        ['Stop-loss', v.bankroll ? pct(v.bankroll.stopLoss, 0) : '—'],
        ['Win goal', v.bankroll ? pct(v.bankroll.winGoal, 0) : '—'],
        ['BJ error rate', v.bankroll ? pct(v.bankroll.bjError, 0) : '—'],
      ]),
    );
    q('.g-needs').replaceChildren(needsBars(v.needs));
    q('.g-thought').replaceChildren(
      ...(v.thought ? [el('blockquote', 'thought', `“${escapeHtml(v.thought)}”`)] : []),
    );
    const comp = q('.g-comp');
    const key = JSON.stringify(v.comp);
    if (comp.dataset.key === key) return;
    comp.dataset.key = key;
    comp.replaceChildren(
      el('h4', '', 'Comps'),
      el('p', 'small dim', compStatus(v.comp)),
      compButtons(v.comp, (kind) => void this.comp(v.id, kind)),
    );
  }

  private renderMachine(v: MachineInspect): void {
    const status = v.broken
      ? '<b class="bad">Broken</b>'
      : v.open
        ? '<b class="good">Open</b>'
        : '<b class="warn">Closed — no dealer</b>';
    this.body.append(el('h3', '', escapeHtml(v.name)), el('p', '', status));
    const stats = el('div', 'sp-stats');
    this.body.append(stats);
    this.fillMachineStats(stats, v);
    if (v.game) this.body.append(this.rulesForm(v));
    this.body.append(button('Sell', () => this.onSell(v.id), 'danger'));
  }

  private fillMachineStats(into: HTMLElement, v: MachineInspect): void {
    const rows: [string, string][] = [];
    if (v.game) {
      rows.push(
        ['House edge', pct(v.game.edge)],
        ['Guest appeal', `${Math.round(v.game.appeal * 100)}%`],
        ['Rounds / hour', v.game.roundsPerHour.toFixed(0)],
      );
    }
    if (v.seats) rows.push(['Seats', `${v.seats.used} / ${v.seats.total}`]);
    if (v.today) {
      rows.push(
        ['Handle today', money(v.today.handle)],
        ['Win today', money(v.today.win)],
        ['Hold', pct(v.today.hold)],
        ['Theo', money(v.today.theo)],
        ['Rounds', String(v.today.rounds)],
      );
    }
    rows.push(
      ['Lifetime profit', money(v.lifetimeProfit)],
      ['Reliability', `${Math.round(v.reliability)}%`],
    );
    into.replaceChildren(statGrid(rows));
  }

  private patchStats(v: InspectResult): void {
    const stats = this.body.querySelector<HTMLElement>('.sp-stats');
    if (stats && v.kind === 'object') this.fillMachineStats(stats, v);
  }

  private rulesForm(v: MachineInspect): HTMLElement {
    const game = v.game!;
    const rules = game.rules as Record<string, unknown>;
    const form = el('form', 'rules');
    form.append(el('h4', '', 'Rules'));
    const fields = RULE_FIELDS[game.kind as GameKind] ?? [];
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const f of fields) {
      if (!(f.key in rules)) continue;
      const row = el('label', 'rule');
      row.append(el('span', '', f.label));
      const input = control(f, rules[f.key]);
      input.addEventListener('change', () => void apply());
      inputs.set(f.key, input);
      row.append(input);
      form.append(row);
    }
    const note = el('p', 'dim small');
    form.append(note);
    const apply = async () => {
      const next: Record<string, unknown> = { ...rules };
      for (const f of fields) {
        const i = inputs.get(f.key);
        if (!i) continue;
        next[f.key] = readControl(f, i);
      }
      try {
        const r = await this.sim.command<{
          rules: Record<string, unknown>;
          issues: { field: string; message?: string }[];
        }>({
          type: 'setRules',
          objectId: v.id,
          rules: next,
        });
        Object.assign(rules, r.rules);
        for (const f of fields) {
          const i = inputs.get(f.key);
          if (i) setControl(f, i, r.rules[f.key]);
        }
        note.textContent = r.issues.length
          ? `Adjusted: ${r.issues.map((i) => i.message ?? i.field).join('; ')}`
          : 'Applied.';
        const fresh = await this.sim.command<InspectResult>({
          type: 'inspect',
          target: { objectId: v.id },
        });
        this.patchStats(fresh);
      } catch (err) {
        note.textContent = (err as Error).message;
      }
    };
    form.onsubmit = (e) => e.preventDefault();
    return form;
  }

  // ---------- finances ----------

  private renderFinances(f: CasinoFinancials & { wallet: number }): void {
    const period = (p: PeriodPnl | null) =>
      p
        ? `<td>${money(p.gaming.handle)}</td><td>${money(p.gaming.win)}</td><td>${pct(p.gaming.hold)}</td><td>${money(p.gaming.theo)}</td><td>${money(p.foodAndBeverage)}</td><td>${money(-p.wages)}</td><td>${money(-p.upkeep)}</td><td class="${p.profit >= 0 ? 'good' : 'bad'}">${money(p.profit)}</td>`
        : '<td colspan="8" class="dim">—</td>';
    const games = f.byGame
      .map(
        (g) =>
          `<tr><td>${escapeHtml(g.defId)}</td><td>${g.objects}</td><td>${money(g.handle)}</td><td>${money(g.win)}</td><td>${pct(g.hold)}</td><td>${money(g.theo)}</td><td>${pct(g.occupancy, 0)}</td><td class="${g.net >= 0 ? 'good' : 'bad'}">${money(g.net)}</td></tr>`,
      )
      .join('');
    this.finPnl.innerHTML = `
      <h3>Profit &amp; loss</h3>
      <div class="scroll-x"><table class="fin">
        <tr><th></th><th>Handle</th><th>Win</th><th>Hold</th><th>Theo</th><th>F&amp;B</th><th>Wages</th><th>Upkeep</th><th>Profit</th></tr>
        <tr><th>Today</th>${period(f.today)}</tr>
        <tr><th>Yesterday</th>${period(f.yesterday)}</tr>
        <tr><th>7 days</th>${period(f.last7)}</tr>
      </table></div>
      <p class="dim small">Hold = win ÷ handle. Theo = Σ edge × opening wagers: what the math says you should win. Hold above theo is player error plus luck.</p>
      <h3>By game (today)</h3>
      <div class="scroll-x"><table class="fin">
        <tr><th>Game</th><th>#</th><th>Handle</th><th>Win</th><th>Hold</th><th>Theo</th><th>Occ.</th><th>Net</th></tr>
        ${games || '<tr><td colspan="8" class="dim">No play yet today.</td></tr>'}
      </table></div>
      <h3>Your own play</h3>
      <p>Wallet <b>${money(f.wallet, true)}</b> · wagered ${money(f.player.wagered)} · returned ${money(f.player.returned)} · ${f.player.rounds} rounds</p>`;
  }

  // ---------- staff ----------

  /** Built once per open and patched after: a full rebuild every poll swaps
   *  the Hire button out from under a press that straddles the poll, and the
   *  click never lands — which reads as the count not updating. */
  private renderStaff(list: StaffInspect[]): void {
    let hire = this.body.querySelector<HTMLElement>('.hire-grid');
    if (!hire) {
      hire = el('div', 'hire-grid');
      for (const h of HIRE) {
        const card = el(
          'div',
          'hire-card',
          `<b>${h.label}</b> <span class="dim count"></span><small>${h.blurb}</small>`,
        );
        card.dataset.kind = h.kind;
        card.append(
          button(
            'Hire',
            () =>
              void this.sim.command({ type: 'hire', kind: h.kind }).then(() => this.refresh(false)),
          ),
        );
        hire.append(card);
      }
      this.body.replaceChildren(
        el('h3', '', 'Hire'),
        hire,
        el('h3', 'roster-title'),
        el('table', 'fin roster'),
      );
    }
    for (const card of hire.querySelectorAll<HTMLElement>('.hire-card')) {
      const count = list.filter((s) => s.role === card.dataset.kind).length;
      card.querySelector('.count')!.textContent = `× ${count}`;
    }
    this.body.querySelector('.roster-title')!.textContent = `Roster (${list.length})`;
    const roster = this.body.querySelector<HTMLElement>('.roster')!;
    // Rows are rebuilt only when someone joins or leaves; a state change
    // patches its cell, for the same reason as the hire cards above.
    const key = list.map((s) => s.id).join('|');
    if (roster.dataset.key === key) {
      for (const s of list) {
        const cell = roster.querySelector(`tr[data-id="${s.id}"] .state`);
        if (cell) cell.textContent = s.state;
      }
      return;
    }
    roster.dataset.key = key;
    roster.innerHTML = '<tr><th>Who</th><th>Role</th><th>State</th><th>Wage</th><th></th></tr>';
    for (const s of list) {
      const tr = el(
        'tr',
        '',
        `<td>${s.id}</td><td>${cap(s.role)}</td><td class="state">${s.state}</td><td>${money(s.wagePerHour, true)}/h</td>`,
      );
      tr.dataset.id = s.id;
      const td = el('td');
      td.append(
        button(
          'Fire',
          () =>
            void this.sim.command({ type: 'fire', staffId: s.id }).then(() => this.refresh(false)),
          'danger small',
        ),
      );
      tr.append(td);
      roster.append(tr);
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statGrid(rows: [string, string][]): HTMLElement {
  const d = el('dl', 'stat-grid');
  for (const [k, v] of rows) d.append(el('dt', '', k), el('dd', '', v));
  return d;
}

function needsBars(n: Record<string, number>): HTMLElement {
  const d = el('div', 'needs');
  for (const [k, v] of Object.entries(n)) {
    d.append(
      el(
        'div',
        'need',
        `<span>${cap(k)}</span><i style="--v:${Math.max(0, Math.min(100, v))}%"></i>`,
      ),
    );
  }
  return d;
}

function control(f: RuleField, value: unknown): HTMLInputElement | HTMLSelectElement {
  if (f.type === 'select') {
    const s = el('select');
    for (const o of f.options) {
      const opt = el('option', '', o.label);
      opt.value = String(o.value);
      s.append(opt);
    }
    s.value = String(value);
    return s;
  }
  const i = el('input');
  if (f.type === 'bool') {
    i.type = 'checkbox';
    i.checked = Boolean(value);
  } else {
    i.type = 'number';
    i.min = String(f.min);
    i.max = String(f.max);
    i.step = String(f.step);
    i.value = String(value);
  }
  return i;
}

function readControl(f: RuleField, i: HTMLInputElement | HTMLSelectElement): unknown {
  if (f.type === 'bool') return (i as HTMLInputElement).checked;
  if (f.type === 'number') return Number(i.value);
  const opt = f.options.find((o) => String(o.value) === i.value);
  return opt ? opt.value : i.value;
}

function setControl(f: RuleField, i: HTMLInputElement | HTMLSelectElement, v: unknown): void {
  if (f.type === 'bool') (i as HTMLInputElement).checked = Boolean(v);
  else i.value = String(v);
}
