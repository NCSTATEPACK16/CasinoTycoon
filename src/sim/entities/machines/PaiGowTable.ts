import { PAI_GOW_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// The steady pick. Very slow, very long sessions, and the lowest per-play standard deviation of any game in the catalogue.
export class PaiGowTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = PAI_GOW_BALANCE.costToPlay) {
    super(id, 'pai-gow', costToPlay, PAI_GOW_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: PAI_GOW_BALANCE.playIntervalTicks,
      playsMin: PAI_GOW_BALANCE.playsMin,
      playsMax: PAI_GOW_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, PAI_GOW_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return PAI_GOW_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, PAI_GOW_BALANCE.payoutTable);
  }
}
