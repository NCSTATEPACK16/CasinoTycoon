import { BINGO_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// A crowd draw that pays in arrivals more than in takings — twelve seats at a $4 card, carried by the largest ratingBonus on any game.
export class BingoHall extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = BINGO_BALANCE.costToPlay) {
    super(id, 'bingo-hall', costToPlay, BINGO_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: BINGO_BALANCE.playIntervalTicks,
      playsMin: BINGO_BALANCE.playsMin,
      playsMax: BINGO_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, BINGO_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return BINGO_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, BINGO_BALANCE.payoutTable);
  }
}
