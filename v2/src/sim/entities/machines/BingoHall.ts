import { BINGO_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// A crowd draw that pays in arrivals more than in takings — twelve seats at a
// $4 card, carried by the largest ratingBonus on any game. Each play buys
// cards in real 75-ball games whose prize is the hall's share of sales
// (sim/games/bingo).
export class BingoHall extends EngineTable {
  constructor(id: string, costToPlay: number = BINGO_BALANCE.costToPlay) {
    super(id, 'bingo-hall', 'bingo', costToPlay, BINGO_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: BINGO_BALANCE.playIntervalTicks,
      playsMin: BINGO_BALANCE.playsMin,
      playsMax: BINGO_BALANCE.playsMax,
    };
  }

  protected wearPerPlay(): number {
    return BINGO_BALANCE.wearPerPlay;
  }
}
