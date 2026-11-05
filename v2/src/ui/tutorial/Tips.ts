// B12: first-time tips. One small card at a time, each shown once per
// browser (the ids are kept in the onboarding record), dismissed with a
// click or after a while. The caller decides when a tip is due.

import { loadOnboarding, saveOnboarding, type Onboarding } from '../../services/onboarding';
import { button, el } from '../dom';

export const TIPS = {
  controls: 'Space pauses and resumes. Press ? for every control, or drag to look around.',
  guests: 'That is a guest. Click one, or press G, to see what the crowd is thinking.',
  finances: 'A day just closed. Press P for Finances: the day’s profit and loss, loans and charts.',
} as const;
export type TipId = keyof typeof TIPS;

const SHOW_MS = 14_000;

export class Tips {
  readonly root = el('div', 'tip');
  private queue: TipId[] = [];
  private showing: TipId | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Set false while something else (the tutorial) is guiding the player. */
  enabled = true;

  constructor(private onboarding: Onboarding = loadOnboarding()) {
    this.root.hidden = true;
  }

  seen(id: TipId): boolean {
    return this.onboarding.tips.includes(id);
  }

  /** Show `id` unless it was shown before; queued behind a tip on screen. */
  once(id: TipId): void {
    if (!this.enabled || this.seen(id) || this.showing === id || this.queue.includes(id)) return;
    this.queue.push(id);
    if (!this.showing) this.next();
  }

  dismiss(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.showing = null;
    this.root.hidden = true;
    this.next();
  }

  private next(): void {
    const id = this.queue.shift();
    if (!id) return;
    this.showing = id;
    if (!this.onboarding.tips.includes(id)) {
      this.onboarding.tips.push(id);
      saveOnboarding(this.onboarding);
    }
    this.root.replaceChildren(
      el('span', '', TIPS[id]),
      button('Got it', () => this.dismiss(), 'tip-ok'),
    );
    this.root.hidden = false;
    this.timer = setTimeout(() => this.dismiss(), SHOW_MS);
  }
}
