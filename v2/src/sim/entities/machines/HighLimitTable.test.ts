import { describe, expect, it } from 'vitest';
import { blackjackEngine } from '../../games/blackjack/blackjack';
import { SlotMachine } from './SlotMachine';
import { BlackjackTable } from './BlackjackTable';
import { HighLimitTable } from './HighLimitTable';

describe('HighLimitTable', () => {
  it('deals the best blackjack rules in the house', () => {
    const vip = new HighLimitTable('h0').math;
    const floor = blackjackEngine.defaultRules();
    expect(vip.edge).toBeLessThan(blackjackEngine.theoreticalEdge(floor));
    expect(vip.rules.minBet).toBeGreaterThan(new BlackjackTable('b0').math.rules.minBet);
  });

  it('declares a minimum wallet', () => {
    expect(new HighLimitTable('h1').minWallet).toBe(400);
  });

  it('leaves other games with no wallet minimum', () => {
    expect(new SlotMachine('s1').minWallet).toBe(0);
  });
});
