import { POKER_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// The only game where guests play each other rather than the house. Each
// seated guest wagers costToPlay and wins the whole pot with probability
// 1/seatedCount, so expected payout per guest is costToPlay * (1 - rake) for
// any table population: the house take is exactly the rake, while the swing a
// guest feels grows with how crowded the table is.
export class PokerTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = POKER_BALANCE.costToPlay) {
    super(id, 'poker-table', costToPlay, POKER_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: POKER_BALANCE.playIntervalTicks,
      playsMin: POKER_BALANCE.playsMin,
      playsMax: POKER_BALANCE.playsMax,
    };
  }

  /** A hand needs opponents — a lone guest sits and waits rather than playing. */
  get canDeal(): boolean {
    return this.seatedCount >= POKER_BALANCE.minPlayers;
  }

  protected spin(rng: Rng): PlayResult {
    if (!this.canDeal) return { wager: 0, payout: 0 };
    const players = this.seatedCount;
    const pot = this.potFor(players);
    return {
      wager: this.costToPlay,
      payout: rng.chance(1 / players) ? pot : 0,
    };
  }

  // CasinoGame.play() calls applyWear() unconditionally after spin(). An
  // under-populated table dealt no hand, so it must not degrade — otherwise a
  // table with one lonely guest wears down to broken without ever earning.
  // Reads the same seatedCount spin() just read, within the same play().
  protected wearPerPlay(): number {
    return this.canDeal ? POKER_BALANCE.wearPerPlay : 0;
  }

  testSpin(rng: Rng): number {
    // Free Play in the Machine Inspector: show a representative pot even when
    // the table is empty, so the operator sees what a real hand pays.
    const players = Math.max(this.seatedCount, POKER_BALANCE.minPlayers);
    return rng.chance(1 / players) ? this.potFor(players) : 0;
  }

  /** The whole table's wagers less the house rake. */
  private potFor(players: number): number {
    return Math.round(this.costToPlay * players * (1 - POKER_BALANCE.rake));
  }
}
