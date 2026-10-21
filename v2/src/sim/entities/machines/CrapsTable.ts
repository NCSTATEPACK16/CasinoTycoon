import { CRAPS_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// Communal table: up to 4 guests hold seats and auto-play simplified rounds.
// The round is a house-edge payout roll, not a real dice simulation.
export class CrapsTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = CRAPS_BALANCE.costToPlay) {
    super(id, 'craps-table', costToPlay, CRAPS_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: CRAPS_BALANCE.playIntervalTicks,
      playsMin: CRAPS_BALANCE.playsMin,
      playsMax: CRAPS_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, CRAPS_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return CRAPS_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, CRAPS_BALANCE.payoutTable);
  }
}
