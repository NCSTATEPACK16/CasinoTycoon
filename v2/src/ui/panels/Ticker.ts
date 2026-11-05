// The news ticker: one line at a time above the palette, coloured by
// severity, with a history drawer behind the News button. A line that
// happened somewhere is clickable and takes the camera there.

import type { SimEvent } from '../../shared/contracts';
import { button, el, escapeHtml } from '../dom';
import { NewsQueue, type NewsItem, type NewsPlace } from './newsQueue';

type TickerEvent = Extract<SimEvent, { type: 'ticker' }>;

const STEP_MS = 250;

export class Ticker {
  readonly root = el('div', 'news-ticker');
  readonly historyRoot = el('div', 'news-history');
  private queue = new NewsQueue();
  private line = el('div', 'news-line');
  private more = el('span', 'news-more');
  private toggleBtn: HTMLButtonElement;
  private list = el('ol');
  private current: NewsItem | null = null;
  private shownKey = '';
  /** History lines the player hasn't seen in the drawer yet. */
  private unread = 0;
  onLocate: (at: NewsPlace) => void = () => {};

  constructor() {
    this.toggleBtn = button('News', () => this.toggleHistory(), 'news-btn');
    this.toggleBtn.title = 'News history';
    this.line.hidden = true;
    this.line.setAttribute('role', 'status');
    this.line.onclick = () => {
      const at = this.current?.at;
      if (at) this.onLocate(at);
    };
    this.root.append(this.toggleBtn, this.line, this.more);
    const head = el('div', 'news-history-head', '<b>News</b>');
    head.append(button('✕', () => this.toggleHistory(false), 'small'));
    this.historyRoot.append(head, this.list);
    this.historyRoot.hidden = true;
    window.setInterval(() => this.step(), STEP_MS);
  }

  get historyOpen(): boolean {
    return !this.historyRoot.hidden;
  }

  add(e: TickerEvent, day: number, hour: number): void {
    const at = e.x !== undefined && e.z !== undefined ? place(e) : null;
    this.queue.push({ text: e.text, severity: e.severity, day, hour, at });
    if (this.historyOpen) this.renderHistory();
    else this.unread++;
    this.step();
  }

  /** A new game starts with an empty paper. */
  clear(): void {
    this.queue.clear();
    this.unread = 0;
    this.renderHistory();
    this.step();
  }

  toggleHistory(open = !this.historyOpen): void {
    this.historyRoot.hidden = !open;
    if (open) {
      this.unread = 0;
      this.renderHistory();
    }
    this.renderButton();
  }

  private step(): void {
    const cur = this.queue.tick(performance.now());
    this.current = cur;
    const key = cur ? `${cur.id}:${cur.count}` : '';
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.line.hidden = !cur;
      if (cur) {
        this.line.className = `news-line sev-${cur.severity}${cur.at ? ' located' : ''}`;
        this.line.innerHTML = lineHtml(cur);
        this.line.title = cur.at ? 'Click to see where' : '';
      }
    }
    const n = this.queue.pending;
    this.more.textContent = n > 0 ? `+${n}` : '';
    this.renderButton();
  }

  private renderButton(): void {
    this.toggleBtn.innerHTML =
      this.unread > 0 ? `News <i class="unread">${this.unread}</i>` : 'News';
    this.toggleBtn.classList.toggle('active', this.historyOpen);
  }

  private renderHistory(): void {
    this.list.replaceChildren();
    const items = this.queue.history;
    if (!items.length) {
      this.list.append(el('li', 'dim', 'No news yet.'));
      return;
    }
    for (const n of items) {
      const li = el(
        'li',
        `sev-${n.severity}${n.at ? ' located' : ''}`,
        `<time>Day ${n.day} · ${String(n.hour).padStart(2, '0')}:00</time><span>${lineHtml(n)}</span>`,
      );
      if (n.at) {
        const at = n.at;
        li.title = 'Click to see where';
        li.onclick = () => this.onLocate(at);
      }
      this.list.append(li);
    }
  }
}

function place(e: TickerEvent): NewsPlace {
  const at: NewsPlace = { x: e.x!, z: e.z! };
  if (e.objectId) at.objectId = e.objectId;
  if (e.agentId !== undefined) at.agentId = e.agentId;
  return at;
}

function lineHtml(n: NewsItem): string {
  return `${escapeHtml(n.text)}${n.count > 1 ? ` <small>×${n.count}</small>` : ''}`;
}
