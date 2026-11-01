// B12: Opening Night's guide. A card under the top bar lists the steps and
// ticks them as the player does them; the current step's control pulses so
// the player knows where to click. It watches what the player does (the
// commands the UI sends, the objects on the floor, the rating click) and
// never drives the sim: the lesson is the real game.

import type { SimClient } from '../client/SimClient';
import { loadOnboarding, saveOnboarding, type Onboarding } from '../services/onboarding';
import type { Command, HudView, ObjectView } from '../shared/contracts';
import { button, el, escapeHtml } from './dom';
import {
  TUTORIAL_STEPS,
  TutorialTracker,
  type TutorialEvent,
  type TutorialStep,
} from './tutorial/steps';

export const TUTORIAL_ID = 'opening-night';

const byText = (selector: string, text: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((e) =>
    e.textContent?.trim().toLowerCase().startsWith(text),
  ) ?? null;

/** The control a step points at, or its tab when that control is not showing. */
export function targetFor(target: TutorialStep['target']): HTMLElement | null {
  const visible = (e: HTMLElement | null) => (e && e.offsetParent !== null ? e : null);
  const palette = (def: string, tab: string) =>
    visible(document.querySelector<HTMLElement>(`.pal-item[data-def="${def}"]`)) ??
    byText('.pal-tab', tab);
  switch (target) {
    case 'zone-tool':
      return byText('.build-toolbar .tool-btn', 'zone');
    case 'slot':
      return palette('slot-machine', 'slots');
    case 'table':
      return palette('blackjack-table', 'tables');
    case 'stall':
      return palette('food-stall', 'services');
    case 'staff-tab':
      return byText('.hud-menu button', 'staff');
    case 'prices-tab':
      return byText('.sp-tabs button', 'prices');
    case 'rating':
      return document.querySelector<HTMLElement>('.hud-rating');
  }
}

export class Tutorial {
  readonly root = el('div', 'tutorial');
  /** Back to the title (the finish card's second button). */
  onExit: () => void = () => {};
  private tracker = new TutorialTracker();
  private active = false;
  private finished = false;
  /** The finish card was closed: stay out of the way until the next run. */
  private dismissed = false;
  private pointed: HTMLElement | null = null;
  private key = '';
  private objects: readonly ObjectView[] = [];

  constructor(private onboarding: Onboarding = loadOnboarding()) {
    this.root.hidden = true;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Forget the last run: a new game is starting. */
  reset(): void {
    this.tracker = new TutorialTracker();
    this.finished = false;
    this.dismissed = false;
    this.objects = [];
    this.key = '';
  }

  /** Report the commands that succeed, as the player's own actions. */
  watch(sim: SimClient): void {
    const command = sim.command.bind(sim);
    sim.command = <T>(cmd: Command): Promise<T> => {
      const p = command<T>(cmd);
      if (this.active)
        void p.then(
          () => this.feed({ kind: 'command', cmd }),
          () => {},
        );
      return p;
    };
  }

  noteRating(): void {
    if (this.active) this.feed({ kind: 'rating' });
  }

  /** `covered`: a menu is up over the game, so the card and pointer step aside. */
  update(hud: HudView, objects?: ObjectView[], covered = false): void {
    const on = hud.scenario?.id === TUTORIAL_ID && !this.dismissed;
    if (on !== this.active) {
      this.active = on;
      if (!on) this.point(null);
      this.key = '';
    }
    this.root.hidden = !on || covered;
    if (!on) return;
    if (objects) {
      this.objects = objects;
      this.feed({ kind: 'objects', objects });
    }
    this.render(covered);
  }

  private feed(e: TutorialEvent): void {
    if (this.tracker.feed(e).length === 0) return;
    if (this.tracker.complete && !this.finished) {
      this.finished = true;
      this.onboarding.tutorialDone = true;
      saveOnboarding(this.onboarding);
    }
    this.render();
  }

  private render(covered = false): void {
    const cur = this.tracker.current;
    const key = `${[...this.tracker.done].join(',')}|${cur?.id ?? 'done'}`;
    if (key !== this.key) {
      this.key = key;
      this.root.replaceChildren(this.card(cur));
    }
    this.point(cur && !covered ? targetFor(cur.target) : null);
  }

  private card(cur: TutorialStep | undefined): HTMLElement {
    const c = el('div', 'tut-card');
    const done = this.tracker.done.size;
    c.append(
      el(
        'div',
        'tut-head',
        `<b>Opening Night</b> <span class="dim">${done} of ${TUTORIAL_STEPS.length}</span>`,
      ),
    );
    const list = el('ol', 'tut-steps');
    for (const s of TUTORIAL_STEPS) {
      const li = el(
        'li',
        this.tracker.done.has(s.id) ? 'done' : s === cur ? 'now' : '',
        escapeHtml(s.title),
      );
      li.dataset.step = s.id;
      list.append(li);
    }
    c.append(list);
    if (cur) c.append(el('p', 'tut-body', escapeHtml(cur.body)));
    else {
      c.append(
        el(
          'p',
          'tut-body',
          'That is the whole loop: build, staff, price, and watch the rating. The casino is yours — keep going, or try the career.',
        ),
        button('Keep building', () => this.hide(), 'primary'),
        button('Main menu', () => this.onExit()),
      );
    }
    return c;
  }

  private hide(): void {
    this.dismissed = true;
    this.active = false;
    this.root.hidden = true;
    this.point(null);
  }

  private point(el: HTMLElement | null): void {
    if (el === this.pointed) return;
    this.pointed?.classList.remove('tut-target');
    this.pointed = el;
    el?.classList.add('tut-target');
  }
}
