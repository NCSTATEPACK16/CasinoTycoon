import { PENNY_SLOT_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineCabinet } from './EngineGame';

// The cheapest way to occupy a tile: 200 credits at a penny on an 88% sheet,
// and long sessions. Single-player, like the full-size slot.
export class PennySlots extends EngineCabinet {
  constructor(id: string, costToPlay?: number) {
    super(id, 'penny-slots', 'slots', costToPlay);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: PENNY_SLOT_BALANCE.spinIntervalTicks,
      playsMin: PENNY_SLOT_BALANCE.spinsMin,
      playsMax: PENNY_SLOT_BALANCE.spinsMax,
    };
  }

  protected wearPerPlay(): number {
    return PENNY_SLOT_BALANCE.wearPerPlay;
  }
}
