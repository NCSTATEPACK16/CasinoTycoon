import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../EventBus';
import { SLOT_BALANCE, slotExpectedRtp } from '../../../data/balance';
import { Rng } from '../../rng';
import { SlotMachine } from './SlotMachine';

afterEach(() => eventBus.clear());

describe('SlotMachine', () => {
  it('pays out close to the configured house edge over 10k spins', () => {
    const machine = new SlotMachine('obj-1');
    const rng = new Rng(1234);
    let wagered = 0;
    let paid = 0;
    for (let i = 0; i < 10_000; i++) {
      machine.reliability = 100; // hold wear at bay for the distribution test
      machine.broken = false;
      const { wager, payout } = machine.play(rng);
      wagered += wager;
      paid += payout;
    }
    expect(wagered).toBe(10_000 * SLOT_BALANCE.costToPlay);
    const rtp = paid / wagered;
    expect(Math.abs(rtp - slotExpectedRtp())).toBeLessThan(0.05);
  });

  it('tracks lifetime profit as wagers minus payouts', () => {
    const machine = new SlotMachine('obj-1');
    const rng = new Rng(7);
    let net = 0;
    for (let i = 0; i < 50; i++) {
      const { wager, payout } = machine.play(rng);
      net += wager - payout;
    }
    expect(machine.lifetimeProfit).toBe(net);
  });

  it('wears down and breaks exactly once, emitting machineBroke', () => {
    const machine = new SlotMachine('obj-9');
    const rng = new Rng(42);
    const broke: string[] = [];
    eventBus.on('machineBroke', ({ machineId }) => broke.push(machineId));
    const spinsToBreak = Math.ceil(100 / SLOT_BALANCE.wearPerPlay);
    for (let i = 0; i < spinsToBreak + 10; i++) machine.play(rng);
    expect(machine.broken).toBe(true);
    expect(machine.reliability).toBe(0);
    expect(broke).toEqual(['obj-9']);
  });

  it('refuses to play while broken', () => {
    const machine = new SlotMachine('obj-1');
    machine.broken = true;
    const before = machine.lifetimeProfit;
    expect(machine.play(new Rng(1))).toEqual({ wager: 0, payout: 0 });
    expect(machine.lifetimeProfit).toBe(before);
  });

  it('free-play test spins leave profit and reliability untouched', () => {
    const machine = new SlotMachine('obj-1');
    const rng = new Rng(5);
    machine.play(rng);
    const profit = machine.lifetimeProfit;
    const rel = machine.reliability;
    const payout = machine.testSpin(rng);
    expect(typeof payout).toBe('number');
    expect(machine.lifetimeProfit).toBe(profit);
    expect(machine.reliability).toBe(rel);
  });
});
