import { describe, expect, it } from 'vitest';
import { bigWinTicker } from './Ticker';

describe('A12 big wins on the news line', () => {
  it('names the game and the amount, and carries the place for click-to-locate', () => {
    const t = bigWinTicker({
      type: 'bigWin',
      objectId: 'obj-7',
      defId: 'slot-machine',
      amount: 2500.4,
      x: 12.5,
      z: 8,
    });
    expect(t).toMatchObject({
      type: 'ticker',
      severity: 'info',
      text: 'Big win! $2,500 on a Slot Machine',
      x: 12.5,
      z: 8,
      objectId: 'obj-7',
    });
  });

  it('falls back to the amount alone for an unknown game', () => {
    const t = bigWinTicker({ type: 'bigWin', objectId: 'x', defId: '', amount: 1000, x: 0, z: 0 });
    expect(t.text).toBe('Big win! $1,000');
  });
});
