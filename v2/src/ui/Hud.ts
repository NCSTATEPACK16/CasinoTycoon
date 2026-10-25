// The HUD: a top row (cash/time/rating bar, menu, speeds, help and Track A's
// slot) with today's conditions under it, the build palette, the news ticker
// and a toast for local feedback. The top stack publishes its height as
// --hud-bottom on the UI root, so the toolbar and drawer below it never
// collide with it however it wraps.

import { OBJECT_CATALOG } from '../data/objects';
import { get3D } from '../shared/catalog';
import type { HudView, SimEvent } from '../shared/contracts';
import type { SimClient } from '../client/SimClient';
import type { BuildTool } from '../input/BuildTool';
import { ConditionsBanner } from './panels/ConditionsBanner';
import { Ticker } from './panels/Ticker';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

type Speed = 0 | 1 | 2 | 4;
const SPEEDS: Speed[] = [0, 1, 2, 4];

export class Hud {
  private bar: HTMLElement;
  /** The bar's fields, built once and patched: the bar updates many times a
   *  second, and rebuilding it would swallow clicks on the rating button. */
  private f: Record<'cash' | 'time' | 'paused' | 'guests' | 'today' | 'goal', HTMLElement>;
  private ratingBtn: HTMLButtonElement;
  private toast: HTMLElement;
  /** The rating button: main.ts opens the rating breakdown. */
  onRating: () => void = () => {};
  private speedButtons = new Map<Speed, HTMLElement>();
  private conditions = new ConditionsBanner();
  readonly ticker = new Ticker();
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
    this.f = {
      cash: el('b', ''),
      time: el('span', ''),
      paused: el('span', 'paused-badge', 'Paused'),
      guests: el('span', ''),
      today: el('span', ''),
      goal: el('span', 'dim goal'),
    };
    this.ratingBtn = el('button', 'hud-rating') as HTMLButtonElement;
    this.ratingBtn.title = 'Rating and reputation: what makes them and what to do';
    this.ratingBtn.onclick = () => this.onRating();
    const f = this.f;
    this.bar.append(f.cash, f.time, f.paused, this.ratingBtn, f.guests, f.today, f.goal);
    const speeds = el('div', 'hud-speeds');
    for (const s of SPEEDS) {
      const b = el('button', '', s === 0 ? '❚❚' : `${s}×`);
      b.title = s === 0 ? 'Pause (Space)' : `Speed ${s}×`;
      b.onclick = () => this.setSpeed(s);
      this.speedButtons.set(s, b);
      speeds.append(b);
    }
    const palette = el('div', 'palette');
    for (const def of OBJECT_CATALOG) {
      const b = el('button', 'pal-item', `${def.name}<small>${money(def.cost)}</small>`);
      b.dataset.def = def.id;
      const zones = get3D(def.id).zones;
      b.title = zones.length ? `Needs a ${zones.join(' or ')} zone` : 'Fits anywhere with a floor';
      b.onclick = () => build.select(build.defId === def.id ? null : def.id);
      palette.append(b);
    }
    // Esc, right-click and tool switches change the selection too: follow the tool, not the click.
    const sync = () =>
      palette
        .querySelectorAll('.pal-item')
        .forEach((n) =>
          n.classList.toggle('active', (n as HTMLElement).dataset.def === build.defId),
        );
    build.addEventListener('change', sync);
    const bulldoze = el('button', 'pal-item bulldoze', 'Bulldoze <small>X</small>');
    bulldoze.onclick = () => {
      build.select(null);
      build.bulldoze = true;
    };
    palette.append(bulldoze);
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
    // Track A mounts its Settings gear here; keep it last in the row.
    const slotA = el('div', '');
    slotA.id = 'hud-slot-a';
    row.append(this.bar, menu, speeds, help, slotA);
    top.append(row, this.conditions.root);
    root.append(top, palette, this.toast, this.ticker.root, this.ticker.historyRoot);
    new ResizeObserver(() =>
      root.style.setProperty('--hud-bottom', `${Math.ceil(top.getBoundingClientRect().bottom)}px`),
    ).observe(top);
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
    const sc = h.scenario ? `${h.scenario.name}: ${h.scenario.goal}` : 'Sandbox';
    setText(f.cash, money(h.cash));
    setText(f.time, `Day ${h.day} · ${String(h.hour).padStart(2, '0')}:00`);
    f.paused.hidden = s !== 0;
    const rep = h.reputation;
    setText(
      this.ratingBtn,
      `★ ${Math.round(h.rating)}${rep ? ` · ${rep.label} ${Math.round(rep.value)}` : ''}`,
    );
    setText(f.guests, `${h.guests} guests`);
    setText(f.today, `Today ${money(h.todayProfit)}`);
    setText(f.goal, sc);
    f.goal.title = sc;
    this.conditions.update(h.modifiers);
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

function setText(n: HTMLElement, text: string): void {
  if (n.textContent !== text) n.textContent = text;
}

function el(tag: string, cls: string, html = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.innerHTML = html;
  return n;
}
