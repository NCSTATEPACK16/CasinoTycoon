// B15e: an object, guest or staff window (it replaces the side panel's
// Inspector). Built on the first poll, once the kind is known, then patched:
// a rebuild would close a dropdown the player has open.
//   Machine/table: Overview (status, stats, seats used over the last minute,
//   Sell) and Rules or Prices.
//   Guest: Overview (mood line, thought, needs, Follow), Money, Comps.
//   Staff: one pane with Fire.

import type { GameKind } from '../../shared/games';
import type {
  GuestInspect,
  InspectResult,
  MachineInspect,
  PricedObject,
  StaffInspect,
} from '../../worker/inspect';
import { button, el, escapeHtml, money, pct } from '../dom';
import { compButtons, compStatus } from '../panels/comps';
import { PricesPanel } from '../panels/PricesPanel';
import { RULE_FIELDS, type RuleField } from '../rulesSchema';
import type { DeskCtx, View } from './views';
import { Sparkline } from './Sparkline';
import type { Win } from './WindowManager';

export type Target = { objectId: string } | { agentId: number };

/** One sample a second while the window is open: a minute of seats. */
const SEAT_SAMPLES = 60;

export function inspectKey(t: Target): string {
  return 'objectId' in t ? `inspect:o:${t.objectId}` : `inspect:a:${t.agentId}`;
}

export interface InspectHooks {
  sell(objectId: string): void;
  /** The staff member was fired: the window has nothing left to show. */
  gone(): void;
}

export class InspectView implements View {
  readonly root = el('div', 'inspect');
  private built: string | null = null;
  private panes = new Map<string, HTMLElement>();
  private seats: number[] = [];
  private seatChart: Sparkline | null = null;
  private prices: PricesPanel | null = null;

  constructor(
    readonly target: Target,
    private ctx: DeskCtx,
    private win: () => Win | undefined,
    private hooks: InspectHooks,
  ) {
    this.root.innerHTML = '<p class="dim">Loading…</p>';
  }

  showPane(id: string): void {
    for (const [k, p] of this.panes) p.hidden = k !== id;
  }

  async refresh(): Promise<void> {
    let v: InspectResult;
    try {
      v = await this.ctx.sim.command<InspectResult>({ type: 'inspect', target: this.target });
    } catch (err) {
      this.built = null;
      this.panes.clear();
      this.win()?.setTabs([]);
      this.root.innerHTML = `<p class="dim">${escapeHtml((err as Error).message)}</p>`;
      return;
    }
    if (this.built !== `${v.kind}:${v.id}`) this.build(v);
    if (v.kind === 'object') {
      this.fillMachineStats(v);
      if (v.seats && this.seatChart) {
        this.seats.push(v.seats.used);
        if (this.seats.length > SEAT_SAMPLES) this.seats.shift();
        this.seatChart.update(this.seats, `${v.seats.used} / ${v.seats.total}`);
      }
      if (this.prices)
        this.prices.update(await this.ctx.sim.command<PricedObject[]>({ type: 'prices' }));
    } else if (v.kind === 'guest') this.patchGuest(v);
  }

  private pane(id: string, label: string, tabs: { id: string; label: string }[]): HTMLElement {
    const p = el('div', `pane pane-${id}`);
    this.panes.set(id, p);
    tabs.push({ id, label });
    this.root.append(p);
    return p;
  }

  private build(v: InspectResult): void {
    this.built = `${v.kind}:${v.id}`;
    this.root.replaceChildren();
    this.panes.clear();
    this.prices = null;
    this.seatChart = null;
    const tabs: { id: string; label: string }[] = [];
    const w = this.win();
    if (v.kind === 'object') {
      if (w) w.title = v.name;
      const o = this.pane('overview', 'Overview', tabs);
      o.append(el('p', 'm-status'), el('div', 'sp-stats'));
      if (v.seats) {
        this.seatChart = new Sparkline('Seats used (last minute)');
        o.append(this.seatChart.root);
      }
      const actions = el('div', 'win-actions');
      actions.append(button('Sell', () => this.hooks.sell(v.id), 'danger'));
      o.append(actions);
      if (v.game) this.pane('rules', 'Rules', tabs).append(this.rulesForm(v));
      if (v.defId === 'food-stall' || v.defId === 'bar') {
        this.prices = new PricesPanel(v.id);
        this.prices.onSetPrice = (objectId, itemId, price) =>
          this.ctx.setPrice(objectId, itemId, price);
        this.pane('prices', 'Prices', tabs).append(this.prices.root);
      }
    } else if (v.kind === 'guest') {
      if (w) w.title = v.name;
      const o = this.pane('overview', 'Overview', tabs);
      o.append(el('p', 'dim g-sub'), el('div', 'g-thought'), el('div', 'g-needs'));
      const actions = el('div', 'win-actions');
      const t = this.target;
      if ('agentId' in t) {
        actions.append(
          button('Show me', () => this.ctx.locateGuest(t.agentId)),
          button('Follow', () => this.ctx.followGuest(t.agentId, v.name)),
        );
      }
      o.append(actions);
      this.pane('money', 'Money', tabs).append(el('div', 'g-stats'));
      this.pane('comps', 'Comps', tabs).append(el('div', 'g-comp'));
    } else {
      this.renderStaff(v, tabs);
    }
    // One pane needs no tab bar.
    w?.setTabs(tabs.length > 1 ? tabs : []);
    this.showPane(w?.tab && this.panes.has(w.tab) ? w.tab : tabs[0]!.id);
  }

  private renderStaff(v: StaffInspect, tabs: { id: string; label: string }[]): void {
    const w = this.win();
    if (w) w.title = `${cap(v.role)} ${v.id}`;
    const o = this.pane('overview', 'Overview', tabs);
    const actions = el('div', 'win-actions');
    actions.append(
      button(
        'Fire',
        () => void this.ctx.act({ type: 'fire', staffId: v.id }).then(() => this.hooks.gone()),
        'danger',
      ),
    );
    o.append(
      statGrid([
        ['State', v.state],
        ['Wage', `${money(v.wagePerHour, true)}/h`],
        ['Assigned', v.assignedTo ?? '—'],
      ]),
      actions,
    );
  }

  /** The guest view's moving parts; the comp buttons only when their state changes. */
  private patchGuest(v: GuestInspect): void {
    const q = (cls: string) => this.root.querySelector<HTMLElement>(cls)!;
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
      el('p', 'small dim', compStatus(v.comp)),
      compButtons(v.comp, (kind) => void this.ctx.comp(v.id, kind)),
    );
  }

  private fillMachineStats(v: MachineInspect): void {
    const status = this.root.querySelector<HTMLElement>('.m-status');
    if (status)
      status.innerHTML = v.broken
        ? '<b class="bad">Broken</b>'
        : v.open
          ? '<b class="good">Open</b>'
          : '<b class="warn">Closed — no dealer</b>';
    const into = this.root.querySelector<HTMLElement>('.sp-stats');
    if (!into) return;
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

  private rulesForm(v: MachineInspect): HTMLElement {
    const game = v.game!;
    const rules = game.rules as Record<string, unknown>;
    const form = el('form', 'rules');
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
    if (!inputs.size) form.append(el('p', 'dim small', 'This game has no rules to change.'));
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
        const r = await this.ctx.sim.command<{
          rules: Record<string, unknown>;
          issues: { field: string; message?: string }[];
        }>({ type: 'setRules', objectId: v.id, rules: next });
        Object.assign(rules, r.rules);
        for (const f of fields) {
          const i = inputs.get(f.key);
          if (i) setControl(f, i, r.rules[f.key]);
        }
        note.textContent = r.issues.length
          ? `Adjusted: ${r.issues.map((i) => i.message ?? i.field).join('; ')}`
          : 'Applied.';
        const fresh = await this.ctx.sim.command<InspectResult>({
          type: 'inspect',
          target: { objectId: v.id },
        });
        if (fresh.kind === 'object') this.fillMachineStats(fresh);
      } catch (err) {
        note.textContent = (err as Error).message;
      }
    };
    form.onsubmit = (e) => e.preventDefault();
    return form;
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
