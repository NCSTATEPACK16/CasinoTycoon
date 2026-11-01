import { KENO_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Six seats, the slowest cadence and longest sessions in the game, against the
// thickest house edge. Each play buys a few tickets on real 20-of-80 draws
// (sim/games/keno). Parks a crowd somewhere cheap for a long time; a waste of
// four tiles on a floor that has no crowd to park.
export class KenoLounge extends EngineTable {
  constructor(id: string, costToPlay: number = KENO_BALANCE.costToPlay) {
    super(id, 'keno-lounge', 'keno', costToPlay, KENO_BALANCE.seats);
  }

  // Inherits needsDealer = true, and that is the intended answer rather than an
  // oversight: a keno lounge is staffed by a keno writer at the counter, which
  // is a real dealt position in a real casino. The distinction the capability
  // draws is not "does anything mechanical move" — by that test the wheel games
  // would qualify and this would not — it is "is there a person running it".
  // Three video poker cabinets have nobody behind them; a keno counter does.

  get cadence(): PlayCadence {
    return {
      intervalTicks: KENO_BALANCE.playIntervalTicks,
      playsMin: KENO_BALANCE.playsMin,
      playsMax: KENO_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return KENO_BALANCE.wearPerPlay;
  }
}
