// Maps what happens in the game to sounds: sim payouts on the floor, the
// player's build and staff commands, and the interface (clicks, panels
// opening and closing). Watches from the outside, so the panels themselves
// need no audio code.

import type { SimClient } from '../client/SimClient';
import type { Command, SimEvent } from '../shared/contracts';
import type { AudioEngine } from './AudioEngine';
import type { SoundName } from './sounds';
import { RateLimiter } from './voices';

/** A payout this large rings the jackpot instead of a coin. */
export const BIG_WIN = 1_000;
/**
 * Coins the floor rings, nearest win first: about six a second with bursts of
 * three, so a busy floor sparkles instead of roaring. Jackpots always ring.
 */
const COINS_PER_SECOND = 6;
const COIN_BURST = 3;

const ON_OK: Partial<Record<Command['type'], SoundName>> = {
  place: 'place',
  paintFloor: 'place',
  paintZone: 'place',
  wall: 'place',
  door: 'place',
  sell: 'sell',
  hire: 'hire',
  fire: 'sell',
};
/** The player's own actions; a refusal on any of these buzzes. */
const ERRORS = new Set<Command['type']>([
  ...(Object.keys(ON_OK) as Command['type'][]),
  'setRules',
  'roundBegin',
  'roundAct',
]);

export class GameAudio {
  private lastPanelSound = 0;
  private coins = new RateLimiter(COINS_PER_SECOND, COIN_BURST);

  constructor(
    private audio: AudioEngine,
    sim: SimClient,
  ) {
    sim.onSnapshot((s) => this.events(s.events));
    sim.onCommand((cmd, ok) => {
      const name = ok ? ON_OK[cmd.type] : ERRORS.has(cmd.type) ? 'error' : undefined;
      if (name) this.audio.play(name);
    });
  }

  events(events: SimEvent[]): void {
    const pays = events.filter((e) => e.type === 'payout');
    if (!pays.length) return;
    pays.sort((a, b) => this.audio.distanceTo(a) - this.audio.distanceTo(b));
    const now = performance.now();
    for (const p of pays) {
      const at = { x: p.x, y: 1, z: p.z };
      if (p.amount >= BIG_WIN) {
        this.audio.play('jackpot', { at });
        this.audio.play('hopper', { at, delay: 0.25 });
      } else if (this.coins.take(now)) this.audio.play('coin', { at });
    }
  }

  /** Open/close sounds for panels shown and hidden through their `hidden` attribute. */
  watchPanels(panels: HTMLElement[]): void {
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        const wasHidden = r.oldValue !== null;
        if (wasHidden === el.hidden) continue; // attribute rewritten, state unchanged
        this.lastPanelSound = performance.now();
        this.audio.play(el.hidden ? 'close' : 'open');
      }
    });
    for (const p of panels)
      mo.observe(p, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  }

  /** A soft click for every button, unless the click opened or closed a panel. */
  watchClicks(root: HTMLElement): void {
    root.addEventListener(
      'click',
      (e) => {
        if (!(e.target as Element | null)?.closest?.('button')) return;
        const at = performance.now();
        // Runs after the button's own handler and the panel observer.
        setTimeout(() => {
          if (this.lastPanelSound < at) this.audio.play('click');
        });
      },
      { capture: true },
    );
  }
}
