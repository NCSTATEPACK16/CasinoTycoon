import { SLOT_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineCabinet } from './EngineGame';

// A video reel cabinet playing a real par sheet (Diamond Lines by default).
export class SlotMachine extends EngineCabinet {
  constructor(id: string, costToPlay?: number) {
    super(id, 'slot-machine', 'slots', costToPlay);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: SLOT_BALANCE.spinIntervalTicks,
      playsMin: SLOT_BALANCE.spinsMin,
      playsMax: SLOT_BALANCE.spinsMax,
    };
  }

  protected wearPerPlay(): number {
    return SLOT_BALANCE.wearPerPlay;
  }
}
