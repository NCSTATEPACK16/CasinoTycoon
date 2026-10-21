import { SLOT_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import { CasinoGame, type PlayCadence, type PlayResult } from './CasinoGame';

export class SlotMachine extends CasinoGame {
  constructor(id: string, costToPlay: number = SLOT_BALANCE.costToPlay) {
    super(id, 'slot-machine', costToPlay);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: SLOT_BALANCE.spinIntervalTicks,
      playsMin: SLOT_BALANCE.spinsMin,
      playsMax: SLOT_BALANCE.spinsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, SLOT_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return SLOT_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, SLOT_BALANCE.payoutTable);
  }
}
