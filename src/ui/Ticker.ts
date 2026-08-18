import { eventBus, type GameEvents } from '../EventBus';
import { el } from './dom';

const FADE_MS = 400;
// Alerts hold longer than flavor: "a machine has broken down" is something you
// act on, "autosaved" is not.
const LINGER_MS: Record<Severity, number> = { info: 5000, warn: 6500, alert: 8000 };

type Severity = NonNullable<GameEvents['tickerMessage']['severity']>;

// Bottom-left news line (RCT-style). Messages queue and show one at a time:
// slide in, linger, fade out. Click dismisses early.
export class Ticker {
  private root: HTMLElement;
  private queue: { text: string; severity: Severity }[] = [];
  private showing = false;

  constructor(uiRoot: HTMLElement) {
    this.root = el('div', 'ui-ticker');
    uiRoot.appendChild(this.root);
    eventBus.on('tickerMessage', ({ text, severity }) => this.push(text, severity));
  }

  push(text: string, severity: Severity = 'info'): void {
    this.queue.push({ text, severity });
    this.pump();
  }

  private pump(): void {
    if (this.showing) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.showing = true;

    const msg = el('div', `ticker-msg sev-${next.severity}`, next.text);
    this.root.appendChild(msg);

    let lingerTimer = 0;
    let fadeTimer = 0;
    const done = () => {
      window.clearTimeout(lingerTimer);
      window.clearTimeout(fadeTimer);
      msg.remove();
      this.showing = false;
      this.pump();
    };
    const startFade = () => {
      msg.classList.add('leaving');
      fadeTimer = window.setTimeout(done, FADE_MS);
    };
    lingerTimer = window.setTimeout(startFade, LINGER_MS[next.severity]);
    msg.addEventListener('click', done);
  }
}
