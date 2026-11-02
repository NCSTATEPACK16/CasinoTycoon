import { PACHINKO_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineCabinet } from './EngineGame';

// Noise as an amenity: the only game that carries a ratingBonus (set on its
// ObjectDef, not here). Single-player and fast; each play buys a cup of balls
// on a real par sheet (sim/games/pachinko).
export class PachinkoMachine extends EngineCabinet {
  constructor(id: string, costToPlay: number = PACHINKO_BALANCE.costToPlay) {
    super(id, 'pachinko', 'pachinko', costToPlay);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: PACHINKO_BALANCE.spinIntervalTicks,
      playsMin: PACHINKO_BALANCE.spinsMin,
      playsMax: PACHINKO_BALANCE.spinsMax,
    };
  }

  protected wearPerPlay(): number {
    return PACHINKO_BALANCE.wearPerPlay;
  }
}
