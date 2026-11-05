import { CRAPS_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Communal craps: real dice through the come-out/point cycle. Guests mostly
// play the line, take odds when they can cover them, and add a prop or place
// bet now and then.
export class CrapsTable extends EngineTable {
  constructor(id: string, costToPlay: number = CRAPS_BALANCE.costToPlay) {
    super(id, 'craps-table', 'craps', costToPlay, CRAPS_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: CRAPS_BALANCE.playIntervalTicks,
      playsMin: CRAPS_BALANCE.playsMin,
      playsMax: CRAPS_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return CRAPS_BALANCE.wearPerPlay;
  }
}
