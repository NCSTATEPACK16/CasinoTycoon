import { describe, expect, it } from 'vitest';
import { ROULETTE_BALANCE } from '../../../data/balance';
import { createMachine } from './factory';
import { RouletteTable } from './RouletteTable';

describe('RouletteTable', () => {
  it('declares six seats', () => {
    const t = new RouletteTable('r1');
    for (let i = 0; i < 6; i++) expect(t.claimSeat(`g${i}`)).not.toBeNull();
    expect(t.claimSeat('g6')).toBeNull();
  });

  it('spins a double-zero wheel by default', () => {
    expect(new RouletteTable('r0').math.edge).toBeCloseTo(2 / 38, 12);
  });

  it('is buildable through the machine factory', () => {
    const m = createMachine('roulette-table', 'r3');
    expect(m).toBeInstanceOf(RouletteTable);
    expect(m!.defId).toBe('roulette-table');
    expect(m!.costToPlay).toBe(ROULETTE_BALANCE.costToPlay);
  });
});
