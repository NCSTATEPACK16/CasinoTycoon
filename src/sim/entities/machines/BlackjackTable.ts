import { BLACKJACK_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// Communal table: up to 4 guests hold seats and auto-play simplified rounds.
// The round is a house-edge payout roll, not player-facing cards.
export class BlackjackTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = BLACKJACK_BALANCE.costToPlay) {
    super(id, 'blackjack-table', costToPlay, BLACKJACK_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: BLACKJACK_BALANCE.playIntervalTicks,
      playsMin: BLACKJACK_BALANCE.playsMin,
      playsMax: BLACKJACK_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, BLACKJACK_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return BLACKJACK_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, BLACKJACK_BALANCE.payoutTable);
  }
}
