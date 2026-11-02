import { PAI_GOW_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Pai gow poker: the steady pick. Seven cards set by the house way against the
// banker's; about four hands in ten push, which is what makes a session flat
// (sim/games/paigow).
export class PaiGowTable extends EngineTable {
  constructor(id: string, costToPlay: number = PAI_GOW_BALANCE.costToPlay) {
    super(id, 'pai-gow', 'paigow', costToPlay, PAI_GOW_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: PAI_GOW_BALANCE.playIntervalTicks,
      playsMin: PAI_GOW_BALANCE.playsMin,
      playsMax: PAI_GOW_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return PAI_GOW_BALANCE.wearPerPlay;
  }
}
