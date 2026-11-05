import { ROULETTE_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Widest communal table in the casino: six guests hold seats on a 2x2
// footprint around a real wheel — double zero until the player buys a
// single-zero one with appeal.
export class RouletteTable extends EngineTable {
  constructor(id: string, costToPlay: number = ROULETTE_BALANCE.costToPlay) {
    super(id, 'roulette-table', 'roulette', costToPlay, ROULETTE_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: ROULETTE_BALANCE.playIntervalTicks,
      playsMin: ROULETTE_BALANCE.playsMin,
      playsMax: ROULETTE_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return ROULETTE_BALANCE.wearPerPlay;
  }
}
