import { ROULETTE_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// Widest communal table in the casino: six guests hold seats on a 2x2
// footprint. Payouts are a house-edge roll, not a wheel simulation — the
// 20x branch exists so the floor gets an occasional loud, strut-worthy win.
export class RouletteTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = ROULETTE_BALANCE.costToPlay) {
    super(id, 'roulette-table', costToPlay, ROULETTE_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: ROULETTE_BALANCE.playIntervalTicks,
      playsMin: ROULETTE_BALANCE.playsMin,
      playsMax: ROULETTE_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, ROULETTE_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return ROULETTE_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, ROULETTE_BALANCE.payoutTable);
  }
}
