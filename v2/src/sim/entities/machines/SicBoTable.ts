import { SIC_BO_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Sic bo: three dice and a layout of bets. costToPlay is the guest's stake for
// a visit; each play deals a few real rolls with a layout drawn from the
// guest mix (sim/games/sicbo).
export class SicBoTable extends EngineTable {
  constructor(id: string, costToPlay: number = SIC_BO_BALANCE.costToPlay) {
    super(id, 'sic-bo', 'sicbo', costToPlay, SIC_BO_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: SIC_BO_BALANCE.playIntervalTicks,
      playsMin: SIC_BO_BALANCE.playsMin,
      playsMax: SIC_BO_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return SIC_BO_BALANCE.wearPerPlay;
  }
}
