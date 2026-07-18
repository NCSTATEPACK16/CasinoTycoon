import { eventBus } from '../EventBus';
import { el } from './dom';

const LINGER_MS = 5000;
const FADE_MS = 400;

// Bottom-left news line (RCT-style). Messages queue and show one at a time:
// slide in, linger, fade out. Click dismisses early.
export class Ticker {
  private root: HTMLElement;
  private queue: string[] = [];
  private showing = false;

  constructor(uiRoot: HTMLElement) {
    this.root = el('div', 'ui-ticker');
    uiRoot.appendChild(this.root);
    eventBus.on('tickerMessage', ({ text }) => this.push(text));
  }

  push(text: string): void {
    this.queue.push(text);
    this.pump();
  }

  private pump(): void {
    if (this.showing) return;
    const text = this.queue.shift();
    if (text === undefined) return;
    this.showing = true;

    const msg = el('div', 'ticker-msg', text);
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
    lingerTimer = window.setTimeout(startFade, LINGER_MS);
    msg.addEventListener('click', done);
  }
}
