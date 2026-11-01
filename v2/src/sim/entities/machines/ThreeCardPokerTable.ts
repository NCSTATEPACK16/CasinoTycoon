import { THREE_CARD_POKER_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Three Card Poker: house-banked, so one guest is enough to deal. costToPlay
// scales the Ante; the Play bet matches it and Pair Plus is the side bet.
export class ThreeCardPokerTable extends EngineTable {
  constructor(id: string, costToPlay: number = THREE_CARD_POKER_BALANCE.costToPlay) {
    super(id, 'three-card-poker', 'tcp', costToPlay, THREE_CARD_POKER_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: THREE_CARD_POKER_BALANCE.playIntervalTicks,
      playsMin: THREE_CARD_POKER_BALANCE.playsMin,
      playsMax: THREE_CARD_POKER_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return THREE_CARD_POKER_BALANCE.wearPerPlay;
  }
}
