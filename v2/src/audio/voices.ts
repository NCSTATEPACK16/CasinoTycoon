// Voice limiting: a global cap on simultaneous sounds plus a per-sound cap,
// so 500 guests winning at once never stacks into a wall of coins. Pure
// bookkeeping; the engine stops whichever voice this module says to steal.

export interface Voice {
  id: number;
  key: string;
  priority: number;
  startedAt: number;
}

export type Grant = { ok: true; id: number; steal: number | null } | { ok: false };

export class VoiceLimiter {
  private voices = new Map<number, Voice>();
  private nextId = 1;

  constructor(
    readonly maxVoices: number,
    private maxPerKey: (key: string) => number = () => Infinity,
  ) {}

  get active(): number {
    return this.voices.size;
  }

  countOf(key: string): number {
    let n = 0;
    for (const v of this.voices.values()) if (v.key === key) n++;
    return n;
  }

  /**
   * Ask for a voice. A sound at its own cap restarts its oldest instance.
   * With the whole pool full, it steals the lowest-priority, oldest voice,
   * unless every playing voice outranks it, in which case it is dropped.
   */
  request(key: string, priority: number, now: number): Grant {
    let victim: Voice | null = null;
    if (this.countOf(key) >= this.maxPerKey(key)) {
      for (const v of this.voices.values())
        if (v.key === key && (!victim || v.startedAt < victim.startedAt)) victim = v;
    } else if (this.voices.size >= this.maxVoices) {
      for (const v of this.voices.values())
        if (
          !victim ||
          v.priority < victim.priority ||
          (v.priority === victim.priority && v.startedAt < victim.startedAt)
        )
          victim = v;
      if (victim && victim.priority > priority) return { ok: false };
    }
    if (victim) this.voices.delete(victim.id);
    const id = this.nextId++;
    this.voices.set(id, { id, key, priority, startedAt: now });
    return { ok: true, id, steal: victim?.id ?? null };
  }

  /** The sound ended (or was stopped): free its slot. Unknown ids are ignored. */
  release(id: number): void {
    this.voices.delete(id);
  }
}

/**
 * Token bucket: on average `perSecond` events, with bursts of up to `burst`.
 * Keeps a busy floor at a pleasant sparkle however many guests win at once.
 */
export class RateLimiter {
  private tokens: number;
  private last: number | null = null;

  constructor(
    readonly perSecond: number,
    readonly burst: number,
  ) {
    this.tokens = burst;
  }

  /** True when an event may happen at `nowMs`; spends a token if so. */
  take(nowMs: number): boolean {
    if (this.last !== null)
      this.tokens = Math.min(
        this.burst,
        this.tokens + ((nowMs - this.last) / 1000) * this.perSecond,
      );
    this.last = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
