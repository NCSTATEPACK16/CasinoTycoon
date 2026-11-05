import { BLACKJACK_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Communal blackjack: a six-deck shoe with a cut card, dealt to up to four
// seats. Guests play basic strategy at their archetype's error rate.
export class BlackjackTable extends EngineTable {
  constructor(id: string, costToPlay: number = BLACKJACK_BALANCE.costToPlay) {
    super(id, 'blackjack-table', 'blackjack', costToPlay, BLACKJACK_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: BLACKJACK_BALANCE.playIntervalTicks,
      playsMin: BLACKJACK_BALANCE.playsMin,
      playsMax: BLACKJACK_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return BLACKJACK_BALANCE.wearPerPlay;
  }
}
