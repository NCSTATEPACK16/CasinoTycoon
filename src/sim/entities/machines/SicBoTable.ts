import { SIC_BO_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// The swingiest table in the house: a 10x branch rare enough to stay inside the variance bar and fat enough to drive P11's jackpot beats.
export class SicBoTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = SIC_BO_BALANCE.costToPlay) {
    super(id, 'sic-bo', costToPlay, SIC_BO_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: SIC_BO_BALANCE.playIntervalTicks,
      playsMin: SIC_BO_BALANCE.playsMin,
      playsMax: SIC_BO_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, SIC_BO_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return SIC_BO_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, SIC_BO_BALANCE.payoutTable);
  }
}
