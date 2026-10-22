import { POKER_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Ultimate Texas Hold'em: house-banked poker, so one guest is enough to deal.
// costToPlay is the Ante; the Blind matches it and the Play bet raises it.
export class PokerTable extends EngineTable {
  constructor(id: string, costToPlay: number = POKER_BALANCE.costToPlay) {
    super(id, 'poker-table', 'uth', costToPlay, POKER_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: POKER_BALANCE.playIntervalTicks,
      playsMin: POKER_BALANCE.playsMin,
      playsMax: POKER_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return POKER_BALANCE.wearPerPlay;
  }
}
