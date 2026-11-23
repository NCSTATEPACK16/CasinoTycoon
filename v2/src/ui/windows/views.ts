// B15e: what the seven Manage windows show. Each view owns its DOM and a
// refresh(first) that the Desk calls once a second while (and only while) its
// window is open. Anything with a button is built once and patched, never
// rebuilt by a poll: a rebuild swaps the button out from under a press and
// the click is lost. These are the side panel's tabs (B2–B11), moved into
// windows, plus the small charts: hourly profit, guests over the day.

import type { SimClient } from '../../client/SimClient';
import type { CasinoFinancials, PeriodPnl } from '../../sim/economy/financials';
import type { Command } from '../../shared/contracts';
import type { PatronView, PricedObject, RatingReport, StaffInspect } from '../../worker/inspect';
import type { GuestRow, ThoughtSummary } from '../../worker/feedback';
import type { FinanceHistory, FinancePoint, LoansView } from '../../worker/finance';
import type { MarketingView } from '../../worker/marketing';
import { button, el, escapeHtml, money, pct } from '../dom';
import type { CompKind } from '../panels/comps';
import { FinanceChart } from '../panels/FinanceChart';
import { GuestsPanel } from '../panels/GuestsPanel';
import { LoansPanel } from '../panels/LoansPanel';
import { MarketingPanel } from '../panels/MarketingPanel';
import { PatronsPanel } from '../panels/PatronsPanel';
import { PricesPanel } from '../panels/PricesPanel';
import { RatingPanel } from '../panels/RatingPanel';
import { StaffRoster } from '../panels/StaffRoster';
import { Sparkline } from './Sparkline';

export type ManageTab =
  'finances' | 'staff' | 'rating' | 'guests' | 'patrons' | 'prices' | 'events';

/** What a view may ask of the Desk. */
export interface DeskCtx {
  sim: SimClient;
  /** Run a command; its refusal (or `done`) goes to the toast; open windows refresh. */
  act(cmd: Command, done?: string): Promise<void>;
  comp(guestId: string, kind: CompKind): Promise<void>;
  setPrice(objectId: string, itemId: string, price: number): Promise<number>;
  locateGuest(agentId: number): void;
  followGuest(agentId: number, name: string): void;
  report(): void;
}

export interface View {
  readonly root: HTMLElement;
  refresh(first: boolean): Promise<void>;
  /** A window tab was picked. */
  showPane?(id: string): void;
}

export const MANAGE: Record<
  ManageTab,
  { title: string; width: string; tabs?: { id: string; label: string }[] }
> = {
  finances: {
    title: 'Finances',
    width: '34rem',
    tabs: [
      { id: 'summary', label: 'Summary' },
      { id: 'trends', label: 'Trends' },
      { id: 'loans', label: 'Loans' },
    ],
  },
  staff: {
    title: 'Staff',
    width: '32rem',
    tabs: [
      { id: 'roster', label: 'Roster' },
      { id: 'hire', label: 'Hire' },
    ],
  },
  rating: { title: 'Rating', width: '26rem' },
  guests: { title: 'Guests', width: '28rem' },
  patrons: { title: 'Players club', width: '28rem' },
  prices: { title: 'Prices', width: '26rem' },
  events: { title: 'Events & ads', width: '28rem' },
};

export function makeView(tab: ManageTab, ctx: DeskCtx): View {
  switch (tab) {
    case 'finances':
      return new FinancesView(ctx);
    case 'staff':
      return new StaffView(ctx);
    case 'guests':
      return new GuestsView(ctx);
    case 'rating': {
      const p = new RatingPanel();
      return simple(p.root, async () =>
        p.update(await ctx.sim.command<RatingReport>({ type: 'rating' })),
      );
    }
    case 'patrons': {
      const p = new PatronsPanel();
      p.onComp = (guestId, kind) => void ctx.comp(guestId, kind);
      p.onLocate = (agentId) => ctx.locateGuest(agentId);
      return simple(p.root, async () =>
        p.update(await ctx.sim.command<PatronView[]>({ type: 'patrons' })),
      );
    }
    case 'prices': {
      const p = new PricesPanel();
      p.onSetPrice = (objectId, itemId, price) => ctx.setPrice(objectId, itemId, price);
      return simple(p.root, async () =>
        p.update(await ctx.sim.command<PricedObject[]>({ type: 'prices' })),
      );
    }
    case 'events': {
      const p = new MarketingPanel();
      p.onRun = (eventId) => void ctx.act({ type: 'runEvent', eventId }, 'Booked.');
      return simple(p.root, async () =>
        p.update(await ctx.sim.command<MarketingView>({ type: 'marketing' })),
      );
    }
  }
}

function simple(root: HTMLElement, refresh: () => Promise<void>): View {
  const wrap = el('div');
  wrap.append(root);
  return { root: wrap, refresh: () => refresh() };
}

/** Tabs that are panes of one view: every pane is kept up to date, a tab only shows one. */
class Panes {
  readonly root = el('div');
  private panes = new Map<string, HTMLElement>();

  add(id: string, ...children: HTMLElement[]): HTMLElement {
    const p = el('div', `pane pane-${id}`);
    p.append(...children);
    p.hidden = this.panes.size > 0;
    this.panes.set(id, p);
    this.root.append(p);
    return p;
  }

  show(id: string): void {
    for (const [k, p] of this.panes) p.hidden = k !== id;
  }
}

/** The last day of closed hours. */
function lastDay(points: FinancePoint[]): FinancePoint[] {
  return points.slice(-24);
}

// ---------- finances ----------

class FinancesView implements View {
  private panes = new Panes();
  private pnl = el('div', 'fin-pnl');
  private profit = new Sparkline(
    'Profit by hour (last 24 h)',
    'Charts start after the first hour.',
  );
  private chart = new FinanceChart();
  private loans = new LoansPanel();
  get root(): HTMLElement {
    return this.panes.root;
  }

  constructor(private ctx: DeskCtx) {
    const actions = el('div', 'fin-actions');
    actions.append(button('Last day’s report', () => ctx.report(), 'small'));
    this.panes.add('summary', actions, this.profit.root, this.pnl);
    this.panes.add('trends', this.chart.root);
    this.panes.add('loans', this.loans.root);
    this.loans.onTake = (amount, days) =>
      ctx.sim.command({ type: 'takeLoan', amount, days }).then(() => this.refresh());
    this.loans.onRepay = (loanId, amount) =>
      ctx.sim.command({ type: 'repayLoan', loanId, amount }).then(() => this.refresh());
  }

  showPane(id: string): void {
    this.panes.show(id);
  }

  async refresh(): Promise<void> {
    const [f, h, l] = await Promise.all([
      this.ctx.sim.command<CasinoFinancials & { wallet: number }>({ type: 'financials' }),
      this.ctx.sim.command<FinanceHistory>({ type: 'financeHistory' }),
      this.ctx.sim.command<LoansView>({ type: 'loans' }),
    ]);
    const hours = lastDay(h.hours);
    const last = hours[hours.length - 1];
    this.profit.update(
      hours.map((p) => p.profit),
      last ? `${money(last.profit)} last hour` : '',
    );
    this.renderPnl(f);
    this.chart.update(h);
    this.loans.update(l);
  }

  private renderPnl(f: CasinoFinancials & { wallet: number }): void {
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
    this.pnl.innerHTML = `
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
}

// ---------- staff ----------

const HIRE: { kind: string; label: string; blurb: string }[] = [
  { kind: 'dealer', label: 'Dealer', blurb: 'Opens a table. Tables without one stay closed.' },
  { kind: 'janitor', label: 'Janitor', blurb: 'Cleans spills and litter.' },
  {
    kind: 'security',
    label: 'Security',
    blurb: 'Handles drunks and rage-quitters. At skill 60+, walks out guests the pit flags.',
  },
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
    blurb: 'Watches the pit for card counters and cheats. Counts toward the security rating.',
  },
];

class StaffView implements View {
  private panes = new Panes();
  private roster = new StaffRoster();
  private hire = el('div', 'hire-grid');
  get root(): HTMLElement {
    return this.panes.root;
  }

  constructor(private ctx: DeskCtx) {
    for (const h of HIRE) {
      const card = el(
        'div',
        'hire-card',
        `<b>${h.label}</b> <span class="dim count"></span><small>${h.blurb}</small>`,
      );
      card.dataset.kind = h.kind;
      card.append(button('Hire', () => void ctx.act({ type: 'hire', kind: h.kind })));
      this.hire.append(card);
    }
    this.panes.add('roster', this.roster.root);
    this.panes.add('hire', this.hire);
    this.roster.onTrain = (staffId) => void ctx.act({ type: 'train', staffId }, 'Off to training.');
    this.roster.onShift = (staffId, shift) => void ctx.act({ type: 'setShift', staffId, shift });
    this.roster.onWage = (kind, wagePerHour) =>
      void ctx.act({ type: 'setWage', kind, wagePerHour });
    this.roster.onFire = (staffId) => void ctx.act({ type: 'fire', staffId });
  }

  showPane(id: string): void {
    this.panes.show(id);
  }

  async refresh(): Promise<void> {
    const list = await this.ctx.sim.command<StaffInspect[]>({ type: 'staffList' });
    for (const card of this.hire.querySelectorAll<HTMLElement>('.hire-card')) {
      const count = list.filter((s) => s.role === card.dataset.kind).length;
      card.querySelector('.count')!.textContent = `× ${count}`;
    }
    this.roster.update(list);
  }
}

// ---------- guests ----------

class GuestsView implements View {
  readonly root = el('div');
  private chart = new Sparkline(
    'Guests on the floor (last 24 h)',
    'The chart starts after the first hour.',
  );
  private guests = new GuestsPanel();

  constructor(private ctx: DeskCtx) {
    this.guests.onLocate = (agentId) => ctx.locateGuest(agentId);
    this.guests.onFollow = (agentId, name) => ctx.followGuest(agentId, name);
    this.guests.onRemove = (guestId) =>
      void ctx.act({ type: 'removeGuest', guestId }, 'Security is walking them out.');
    this.root.append(this.chart.root, this.guests.root);
  }

  async refresh(): Promise<void> {
    const [summary, list, h] = await Promise.all([
      this.ctx.sim.command<ThoughtSummary>({ type: 'thoughts' }),
      this.ctx.sim.command<GuestRow[]>({ type: 'guestList' }),
      this.ctx.sim.command<FinanceHistory>({ type: 'financeHistory' }),
    ]);
    const hours = lastDay(h.hours);
    this.chart.update([...hours.map((p) => p.guests), list.length], `${list.length} now`);
    this.guests.update(summary, list);
  }
}
