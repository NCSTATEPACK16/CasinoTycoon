import { PENNY_SLOT_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import { CasinoGame, type PlayCadence, type PlayResult } from './CasinoGame';

// The cheapest way to occupy a tile: a $2 wager, the flattest payout table in
// the house, and long sessions. Single-player, like the full-size slot.
export class PennySlots extends CasinoGame {
  constructor(id: string, costToPlay: number = PENNY_SLOT_BALANCE.costToPlay) {
    super(id, 'penny-slots', costToPlay);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: PENNY_SLOT_BALANCE.spinIntervalTicks,
      playsMin: PENNY_SLOT_BALANCE.spinsMin,
      playsMax: PENNY_SLOT_BALANCE.spinsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return {
      wager: this.costToPlay,
      payout: this.rollPayout(rng, PENNY_SLOT_BALANCE.payoutTable),
    };
  }

  protected wearPerPlay(): number {
    return PENNY_SLOT_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, PENNY_SLOT_BALANCE.payoutTable);
  }
}
