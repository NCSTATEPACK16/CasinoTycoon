import { HIGH_LIMIT_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// The VIP table: three seats, the highest stake on the floor, and the best
// blackjack rules in the house (two decks, RSA, late surrender). Access is
// gated on wallet rather than archetype — see HIGH_LIMIT_BALANCE — so a lucky
// ordinary guest can graduate into it.
export class HighLimitTable extends EngineTable {
  constructor(id: string, costToPlay: number = HIGH_LIMIT_BALANCE.costToPlay) {
    super(id, 'high-limit-table', 'blackjack', costToPlay, HIGH_LIMIT_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: HIGH_LIMIT_BALANCE.playIntervalTicks,
      playsMin: HIGH_LIMIT_BALANCE.playsMin,
      playsMax: HIGH_LIMIT_BALANCE.playsMax,
    };
  }

  override get minWallet(): number {
    return HIGH_LIMIT_BALANCE.minWallet;
  }

  protected wearPerPlay(): number {
    return HIGH_LIMIT_BALANCE.wearPerPlay;
  }
}
