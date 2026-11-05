// The news ticker's queue, apart from the DOM so the timing rules are
// testable. RCT-style: one line at a time, each held long enough to read,
// alerts ahead of chatter, and every line kept in a history the player can
// scroll back through. A batch of sim events arrives at once (one snapshot
// carries everything since the last), so the queue is what keeps three news
// items in the same batch from overwriting each other.

export type Severity = 'info' | 'warn' | 'alert';

/** Where a news item happened, for click-to-locate. */
export interface NewsPlace {
  x: number;
  z: number;
  objectId?: string;
  /** A guest's numeric id, as in Snapshot.agents. */
  agentId?: number;
}

export interface NewsItem {
  id: number;
  text: string;
  severity: Severity;
  day: number;
  hour: number;
  at: NewsPlace | null;
  /** Identical lines folded into this one while it was still waiting or showing. */
  count: number;
}

export type NewsInput = Omit<NewsItem, 'id' | 'count'>;

/** How long a line stays up with nothing waiting behind it, ms. */
export const DWELL_MS: Record<Severity, number> = { info: 4000, warn: 6000, alert: 8000 };
/** The floor a backed-up queue may shorten a line to. */
export const MIN_DWELL_MS = 1500;
export const HISTORY_CAP = 100;

export class NewsQueue {
  private waiting: NewsItem[] = [];
  private hist: NewsItem[] = [];
  private shown: NewsItem | null = null;
  private shownAt = 0;
  private nextId = 1;

  /** Newest first. Every line lands here at once, whether or not it has been shown yet. */
  get history(): readonly NewsItem[] {
    return this.hist;
  }

  /** Lines queued behind the one showing. */
  get pending(): number {
    return this.waiting.length;
  }

  push(input: NewsInput): NewsItem {
    // Three "Hired a dealer." in one batch read as one line "×3", not three in
    // a row. Lines about different subjects stay apart, though: two machines
    // breaking are two places the player may want to go.
    const same = (n: NewsItem) =>
      n.text === input.text && n.severity === input.severity && sameSubject(n.at, input.at);
    const dup = this.waiting.find(same) ?? (this.shown && same(this.shown) ? this.shown : null);
    if (dup) {
      dup.count++;
      return dup;
    }
    const item: NewsItem = { ...input, id: this.nextId++, count: 1 };
    this.hist.unshift(item);
    if (this.hist.length > HISTORY_CAP) this.hist.pop();
    // An alert goes ahead of every waiting non-alert but behind earlier
    // alerts, so a breakdown is never stuck behind five "Hired a dealer."
    const firstCalm = item.severity === 'alert' ? this.waiting.findIndex(isCalm) : -1;
    if (firstCalm < 0) this.waiting.push(item);
    else this.waiting.splice(firstCalm, 0, item);
    return item;
  }

  /** How long `item` stays up given what is queued behind it: a backlog
   *  speeds the ticker up so it catches up instead of falling ever behind. */
  dwell(item: NewsItem): number {
    return Math.max(MIN_DWELL_MS, DWELL_MS[item.severity] / (1 + this.waiting.length / 2));
  }

  /** Advance the display clock to `now` (ms). Returns the line to show, or
   *  null once the last one has had its time and nothing is waiting. */
  tick(now: number): NewsItem | null {
    if (this.shown && now - this.shownAt < this.dwell(this.shown)) return this.shown;
    this.shown = this.waiting.shift() ?? null;
    this.shownAt = now;
    return this.shown;
  }

  clear(): void {
    this.waiting = [];
    this.hist = [];
    this.shown = null;
  }
}

function isCalm(n: NewsItem): boolean {
  return n.severity !== 'alert';
}

function sameSubject(a: NewsPlace | null, b: NewsPlace | null): boolean {
  return a?.objectId === b?.objectId && a?.agentId === b?.agentId;
}
