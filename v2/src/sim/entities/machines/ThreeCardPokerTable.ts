import { THREE_CARD_POKER_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// The reliable mid table. Four seats, fast rounds, a moderate edge and no tail at all — nothing about it is exciting, which is the point.
export class ThreeCardPokerTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = THREE_CARD_POKER_BALANCE.costToPlay) {
    super(id, 'three-card-poker', costToPlay, THREE_CARD_POKER_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: THREE_CARD_POKER_BALANCE.playIntervalTicks,
      playsMin: THREE_CARD_POKER_BALANCE.playsMin,
      playsMax: THREE_CARD_POKER_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, THREE_CARD_POKER_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return THREE_CARD_POKER_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, THREE_CARD_POKER_BALANCE.payoutTable);
  }
}
