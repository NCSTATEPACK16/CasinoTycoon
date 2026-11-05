import { describe, expect, it } from 'vitest';
import { RateLimiter, VoiceLimiter } from './voices';

describe('RateLimiter', () => {
  it('allows a burst, then the steady rate', () => {
    const r = new RateLimiter(6, 3);
    expect([r.take(0), r.take(0), r.take(0), r.take(0)]).toEqual([true, true, true, false]);
    // One token every 1000/6 ms.
    expect(r.take(100)).toBe(false);
    expect(r.take(170)).toBe(true);
    expect(r.take(171)).toBe(false);
  });

  it('holds 10 s of a flood to about rate × seconds + burst', () => {
    const r = new RateLimiter(6, 3);
    let n = 0;
    for (let t = 0; t <= 10_000; t += 10) if (r.take(t)) n++;
    expect(n).toBeGreaterThanOrEqual(62);
    expect(n).toBeLessThanOrEqual(63);
  });

  it('never banks more than the burst after a quiet spell', () => {
    const r = new RateLimiter(6, 3);
    r.take(0);
    let n = 0;
    while (r.take(60_000)) n++;
    expect(n).toBe(3);
  });
});

describe('VoiceLimiter', () => {
  it('grants voices freely under both caps', () => {
    const v = new VoiceLimiter(4, () => 2);
    expect(v.request('coin', 1, 0)).toEqual({ ok: true, id: 1, steal: null });
    expect(v.request('card', 1, 1)).toEqual({ ok: true, id: 2, steal: null });
    expect(v.active).toBe(2);
  });

  it('restarts the oldest instance of a sound at its own cap', () => {
    const v = new VoiceLimiter(16, (k) => (k === 'coin' ? 2 : 8));
    v.request('coin', 1, 0); // id 1
    v.request('coin', 1, 5); // id 2
    const g = v.request('coin', 1, 9);
    expect(g).toEqual({ ok: true, id: 3, steal: 1 });
    expect(v.countOf('coin')).toBe(2);
    expect(v.active).toBe(2);
  });

  it('steals the lowest-priority, oldest voice when the pool is full', () => {
    const v = new VoiceLimiter(3);
    v.request('a', 2, 0); // id 1
    v.request('b', 1, 1); // id 2: lowest priority
    v.request('c', 1, 2); // id 3: same priority, newer
    const g = v.request('d', 2, 3);
    expect(g).toEqual({ ok: true, id: 4, steal: 2 });
    expect(v.active).toBe(3);
  });

  it('drops a new sound that every playing voice outranks', () => {
    const v = new VoiceLimiter(2);
    v.request('jackpot', 5, 0);
    v.request('click', 3, 0);
    expect(v.request('coin', 1, 1)).toEqual({ ok: false });
    expect(v.active).toBe(2);
  });

  it('frees slots on release and ignores unknown ids', () => {
    const v = new VoiceLimiter(1);
    const g = v.request('a', 1, 0);
    expect(v.request('b', 0, 1)).toEqual({ ok: false });
    if (g.ok) v.release(g.id);
    v.release(999);
    expect(v.request('b', 0, 2).ok).toBe(true);
    expect(v.active).toBe(1);
  });

  it('never exceeds the global cap under a flood', () => {
    const v = new VoiceLimiter(24, () => 4);
    const keys = ['coin', 'card', 'chips', 'dice', 'click', 'bell', 'reel', 'thunk'];
    for (let i = 0; i < 1000; i++) {
      v.request(keys[i % keys.length]!, i % 3, i);
      expect(v.active).toBeLessThanOrEqual(24);
      for (const k of keys) expect(v.countOf(k)).toBeLessThanOrEqual(4);
    }
  });
});
