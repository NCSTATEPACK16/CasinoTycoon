import { describe, expect, it } from 'vitest';
import { DWELL_MS, HISTORY_CAP, MIN_DWELL_MS, NewsQueue, type NewsInput } from './newsQueue';

const news = (text: string, severity: NewsInput['severity'] = 'info'): NewsInput => ({
  text,
  severity,
  day: 1,
  hour: 9,
  at: null,
});

/** Run the display clock until idle, recording each line as it comes up. */
function drain(q: NewsQueue, from = 0): { text: string; at: number }[] {
  const shown: { text: string; at: number }[] = [];
  let last: number | null = null;
  for (let t = from; t < from + 120_000; t += 100) {
    const cur = q.tick(t);
    if (cur && cur.id !== last) shown.push({ text: cur.text, at: t });
    last = cur?.id ?? null;
    if (!cur && q.pending === 0 && t > from) break;
  }
  return shown;
}

describe('NewsQueue', () => {
  it('shows every line of one batch in turn instead of overwriting', () => {
    const q = new NewsQueue();
    q.push(news('Hired a dealer.'));
    q.push(news('Hired a janitor.'));
    q.push(news('Autosaved.'));
    expect(drain(q).map((s) => s.text)).toEqual([
      'Hired a dealer.',
      'Hired a janitor.',
      'Autosaved.',
    ]);
  });

  it('puts an alert ahead of waiting chatter but behind earlier alerts', () => {
    const q = new NewsQueue();
    q.push(news('first'));
    expect(q.tick(0)?.text).toBe('first');
    q.push(news('chatter 1'));
    q.push(news('chatter 2'));
    q.push(news('broke 1', 'alert'));
    q.push(news('broke 2', 'alert'));
    q.push(news('chatter 3'));
    expect(drain(q, 1).map((s) => s.text)).toEqual([
      'first',
      'broke 1',
      'broke 2',
      'chatter 1',
      'chatter 2',
      'chatter 3',
    ]);
  });

  it('holds a lone line for its severity dwell, then goes idle', () => {
    for (const sev of ['info', 'warn', 'alert'] as const) {
      const q = new NewsQueue();
      q.push(news('x', sev));
      expect(q.tick(0)?.text).toBe('x');
      expect(q.tick(DWELL_MS[sev] - 1)?.text).toBe('x');
      expect(q.tick(DWELL_MS[sev])).toBeNull();
    }
  });

  it('speeds up when backed up, but never below the floor', () => {
    const q = new NewsQueue();
    for (let i = 0; i < 20; i++) q.push(news(`line ${i}`));
    const shown = drain(q);
    expect(shown).toHaveLength(20);
    const gap = shown[1]!.at - shown[0]!.at;
    expect(gap).toBeLessThan(DWELL_MS.info);
    expect(gap).toBeGreaterThanOrEqual(MIN_DWELL_MS);
    // The tail, with nothing behind it, gets its full time again.
    const last = shown.at(-1)!.at - shown.at(-2)!.at;
    expect(last).toBeGreaterThan(gap);
  });

  it('folds a repeat of a waiting or showing line into a count', () => {
    const q = new NewsQueue();
    q.push(news('A machine has broken down!', 'alert'));
    q.tick(0);
    q.push(news('A machine has broken down!', 'alert'));
    q.push(news('Hired a dealer.'));
    q.push(news('Hired a dealer.'));
    expect(q.history.map((n) => [n.text, n.count])).toEqual([
      ['Hired a dealer.', 2],
      ['A machine has broken down!', 2],
    ]);
    // A different severity is a different line.
    q.push(news('Hired a dealer.', 'warn'));
    expect(q.history).toHaveLength(3);
  });

  it('keeps the same line about different subjects apart, so each can be located', () => {
    const q = new NewsQueue();
    const broke = (objectId: string) => ({
      ...news('A machine has broken down!', 'alert'),
      at: { x: 1, z: 1, objectId },
    });
    q.push(broke('obj-2'));
    q.push(broke('obj-3'));
    q.push(broke('obj-3'));
    expect(q.history.map((n) => [n.at?.objectId, n.count])).toEqual([
      ['obj-3', 2],
      ['obj-2', 1],
    ]);
  });

  it('keeps every line in a newest-first history, capped', () => {
    const q = new NewsQueue();
    for (let i = 0; i < HISTORY_CAP + 5; i++) q.push(news(`n${i}`));
    expect(q.history).toHaveLength(HISTORY_CAP);
    expect(q.history[0]!.text).toBe(`n${HISTORY_CAP + 4}`);
    expect(q.history.at(-1)!.text).toBe('n5');
  });

  it('keeps where each line happened for click-to-locate', () => {
    const q = new NewsQueue();
    const item = q.push({ ...news('Ann is back'), at: { x: 4.5, z: 7.25, agentId: 12 } });
    expect(q.history[0]).toBe(item);
    expect(item.at).toEqual({ x: 4.5, z: 7.25, agentId: 12 });
  });

  it('forgets everything on clear, for a new game', () => {
    const q = new NewsQueue();
    q.push(news('old'));
    q.tick(0);
    q.clear();
    expect(q.history).toHaveLength(0);
    expect(q.tick(1)).toBeNull();
  });
});
