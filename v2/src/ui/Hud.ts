// The HUD (B15c): one slim top bar of glanceable gauges. Money opens
// Finances, rating opens Rating, guests open Guests; the date carries the
// paused badge; the speeds follow it; the news line (with today's conditions
// folded in) and the goal chip sit at the bar's right, then the menu, help and
// the settings slot. The goals checklist and the news history stack in the
// right column; the build palette goes to the dock and the toast to the
// toast region.

import './Hud.css';
import { getCampaign } from '../data/campaigns';
import { weekdayName } from '../data/traffic';
import type { HudView, SimEvent } from '../shared/contracts';
import type { SimClient } from '../client/SimClient';
import type { BuildTool } from '../input/BuildTool';
import { ConditionsBanner } from './panels/ConditionsBanner';
import { GoalPanel } from './panels/GoalPanel';
import { Palette } from './panels/Palette';
import { Ticker } from './panels/Ticker';
import { regionIn } from './shell/Shell';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

type Speed = 0 | 1 | 2 | 4;
const SPEEDS: Speed[] = [0, 1, 2, 4];

/** What the goal chip shows when something other than the scenario's goals
 *  owns the checklist (Opening Night's steps). */
export interface GoalChip {
  name: string;
  count: string;
}

type Field =
  | 'cash'
  | 'today'
  | 'time'
  | 'paused'
  | 'rating'
  | 'ratingMeter'
  | 'rep'
  | 'guests'
  | 'guestMeter'
  | 'cap'
  | 'goalName'
  | 'goalCount';

export class Hud {
  private bar: HTMLElement;
  private right: HTMLElement;
  /** The bar's fields, built once and patched: the bar updates many times a
   *  second, and rebuilding it would swallow clicks on its buttons. */
  private f: Record<Field, HTMLElement>;
  private ratingBtn: HTMLButtonElement;
  private guestBtn: HTMLButtonElement;
  private goalBtn: HTMLButtonElement;
  private toast: HTMLElement;
  /** Gauge clicks; main.ts opens the matching panel. */
  onRating: () => void = () => {};
  onFinances: () => void = () => {};
  onGuests: () => void = () => {};
  /** The goal chip; by default it folds the scenario's goals. */
  onGoals: () => void = () => this.toggleGoals();
  /** Asked on each update: a checklist other than the scenario's goals. */
  goalSource: () => GoalChip | null = () => null;
  private speedButtons = new Map<Speed, HTMLElement>();
  private conditions = new ConditionsBanner();
  /** B8: the scenario's goals, in the right column under the bar. */
  private goals = new GoalPanel();
  readonly ticker = new Ticker();
  /** The build palette; B8 locks and unlocks items through it. */
  readonly palette: Palette;
  /** Top-bar menu buttons; main.ts binds what each opens. */
  readonly menu: Record<'finances' | 'staff' | 'save' | 'load' | 'help', HTMLButtonElement>;
  /** The speed the sim reported last, and the one Space resumes to. */
  private current: Speed = 0;
  private resumeTo: Speed = 1;
  private day = 1;
  private hour = 0;

  constructor(
    root: HTMLElement,
    private sim: SimClient,
    build: BuildTool,
  ) {
    const top = el('div', 'hud-top');
    const row = el('div', 'hud-row');
    this.bar = el('div', 'hud-bar');
    const f = (this.f = {
      cash: el('span', 'num'),
      today: el('span', 'sub'),
      time: el('span', 'num'),
      paused: el('span', 'paused-badge', 'Paused'),
      rating: el('span', 'num'),
      ratingMeter: el('i', ''),
      rep: el('span', 'sub'),
      guests: el('span', 'num'),
      guestMeter: el('i', ''),
      cap: el('span', 'sub'),
      goalName: el('span', 'goal-name'),
      goalCount: el('b', ''),
    });
    const cashBtn = gauge('g-money', 'Finances (P)', f.cash, f.today);
    cashBtn.onclick = () => this.onFinances();
    const time = el('span', 'gauge g-time');
    time.append(f.time, f.paused);
    this.ratingBtn = gauge(
      'hud-rating',
      'Rating and reputation: what makes them and what to do',
      f.rating,
      meter(f.ratingMeter),
      f.rep,
    );
    this.ratingBtn.onclick = () => this.onRating();
    this.guestBtn = gauge('g-guests', 'Guests (G)', f.guests, meter(f.guestMeter), f.cap);
    this.guestBtn.onclick = () => this.onGuests();
    this.goalBtn = gauge('goalchip', 'Goals', f.goalName, f.goalCount);
    this.goalBtn.onclick = () => this.onGoals();
    const speeds = el('div', 'hud-speeds');
    for (const s of SPEEDS) {
      const b = el('button', '', s === 0 ? '❚❚' : `${s}×`);
      b.title = s === 0 ? 'Pause (Space)' : `Speed ${s}×`;
      b.onclick = () => this.setSpeed(s);
      this.speedButtons.set(s, b);
      speeds.append(b);
    }
    this.bar.append(
      cashBtn,
      time,
      speeds,
      this.ratingBtn,
      this.guestBtn,
      this.ticker.root,
      this.goalBtn,
    );
    // B7: the tabbed palette, with forbidden and locked items explained.
    this.palette = new Palette(build);
    this.palette.onMessage = (t) => this.say(t);
    this.toast = el('div', 'toast');
    const menu = el('div', 'hud-menu');
    const mk = (label: string, key: string) => {
      const b = el('button', '', `${label} <small>${key}</small>`) as HTMLButtonElement;
      menu.append(b);
      return b;
    };
    const help = el('button', 'hud-help', '?') as HTMLButtonElement;
    help.title = 'Controls (?)';
    this.menu = {
      finances: mk('Finances', 'P'),
      staff: mk('Staff', 'H'),
      save: mk('Save', ''),
      load: mk('Menu', ''),
      help,
    };
    // The Settings gear mounts here; keep it last in the row.
    const slotA = el('div', '');
    slotA.id = 'hud-slot-a';
    row.append(this.bar, menu, help, slotA);
    top.append(row);
    regionIn(root, 'top').append(top);
    this.right = regionIn(root, 'right');
    this.right.append(this.goals.root, this.ticker.historyRoot);
    this.ticker.mountInHistory(this.conditions.root);
    regionIn(root, 'dock').append(this.palette.root);
    regionIn(root, 'toast').append(this.toast);
  }

  /** Fold or unfold the scenario's goal list. */
  toggleGoals(): void {
    this.goals.toggle();
  }

  /** B12: a panel that sits with the goals, in the right column. */
  mountBelowBar(node: HTMLElement): void {
    this.right.insertBefore(node, this.ticker.historyRoot);
  }

  /** The speed last reported by the sim (0 is paused). */
  get speed(): Speed {
    return this.current;
  }

  setSpeed(s: Speed): void {
    if (s > 0) this.resumeTo = s;
    void this.sim.command({ type: 'setSpeed', speed: s });
  }

  pause(): void {
    this.setSpeed(0);
  }

  /** Back to the last running speed. */
  resume(): void {
    this.setSpeed(this.resumeTo);
  }

  togglePause(): void {
    if (this.current === 0) this.resume();
    else this.pause();
  }

  /** Space pauses and resumes, even with a just-clicked button still holding
   *  focus: Space would otherwise press that button again on keyup. Tab is the
   *  camera key here and never moves focus, so a focused button was always
   *  clicked, never tabbed to (and Chrome reports it :focus-visible as soon as
   *  any key goes down, so that can't tell the two apart). */
  spaceKey(e: KeyboardEvent): void {
    e.preventDefault();
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    if (!e.repeat) this.togglePause();
  }

  update(h: HudView): void {
    this.day = h.day;
    this.hour = h.hour;
    const s = (SPEEDS.includes(h.speed as Speed) ? h.speed : 1) as Speed;
    this.current = s;
    if (s > 0) this.resumeTo = s;
    for (const [k, b] of this.speedButtons) b.classList.toggle('active', k === s);
    const f = this.f;
    setText(f.cash, money(h.cash));
    setText(f.today, `today ${h.todayProfit >= 0 ? '+' : ''}${money(h.todayProfit)}`);
    setClass(f.today, `sub ${h.todayProfit >= 0 ? 'good' : 'bad'}`);
    setText(f.time, `${weekdayName(h.day)} · Day ${h.day} · ${String(h.hour).padStart(2, '0')}:00`);
    f.paused.hidden = s !== 0;
    const rating = Math.round(h.rating);
    const rep = h.reputation;
    setText(f.rating, `★ ${rating}`);
    f.ratingMeter.style.width = `${clamp01(rating / 100) * 100}%`;
    setText(f.rep, rep ? `${rep.label} ${Math.round(rep.value)}` : '');
    setText(f.guests, String(h.guests));
    f.guestMeter.parentElement!.hidden = !h.guestCap;
    f.guestMeter.style.width = h.guestCap ? `${clamp01(h.guests / h.guestCap) * 100}%` : '0';
    setText(f.cap, h.guestCap ? `/ ${h.guestCap}` : 'guests');
    this.guestBtn.title = h.guestCap
      ? `Guests (G). ${guestsTitle(h.guestCap, hasRhythm(h.scenario?.id))}`
      : 'Guests (G)';
    this.updateGoalChip(h);
    this.ticker.setToday([...(h.modifiers ?? []), ...(h.events ?? [])].map((m) => m.name));
    this.conditions.update(h.modifiers, h.events);
    this.goals.update(h);
    this.palette.setScenario(h.scenario?.id ?? null);
  }

  private updateGoalChip(h: HudView): void {
    const f = this.f;
    const other = this.goalSource();
    const goals = h.goals;
    const count = other
      ? other.count
      : goals?.length
        ? `${goals.filter((g) => g.met).length}/${goals.length}`
        : '';
    setText(f.goalName, other?.name ?? h.scenario?.name ?? 'Sandbox');
    setText(f.goalCount, count);
    f.goalCount.hidden = !count;
    const live = !!other || !!goals?.length;
    this.goalBtn.disabled = !live;
    this.goalBtn.title = h.scenario
      ? `${h.scenario.name}: ${h.scenario.goal}${live ? ' (click to fold the checklist)' : ''}`
      : 'Sandbox: no goal, no clock';
  }

  events(evs: SimEvent[]): void {
    for (const e of evs) if (e.type === 'ticker') this.ticker.add(e, this.day, this.hour);
  }

  say(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }
}

/** Whether this scenario's guests follow the clock (B3's daily traffic). */
function hasRhythm(scenarioId: string | undefined): boolean {
  return !!scenarioId && getCampaign(scenarioId)?.traffic?.curve === 'daily';
}

/** What the guest count means, and what moves the cap. */
function guestsTitle(cap: number, rhythm: boolean): string {
  const room = rhythm
    ? `The floor holds ${cap} right now. More seats and services, and a better rating, let it hold more (up to 500).`
    : `This casino holds ${cap} guests at once.`;
  return rhythm
    ? `${room} Guests come by the clock: quiet mornings, a 4 a.m. lull, busy evenings, busier weekends.`
    : room;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** A gauge in the bar: a button made of its parts. */
function gauge(cls: string, title: string, ...parts: HTMLElement[]): HTMLButtonElement {
  const b = el('button', `gauge ${cls}`) as HTMLButtonElement;
  b.title = title;
  b.append(...parts);
  return b;
}

function meter(fill: HTMLElement): HTMLElement {
  const m = el('span', 'meter');
  m.append(fill);
  return m;
}

function setText(n: HTMLElement, text: string): void {
  if (n.textContent !== text) n.textContent = text;
}

function setClass(n: HTMLElement, cls: string): void {
  if (n.className !== cls) n.className = cls;
}

function el(tag: string, cls: string, html = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.innerHTML = html;
  return n;
}
