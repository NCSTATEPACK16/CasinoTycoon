import { BLACKJACK_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import { CasinoGame, type PlayCadence, type PlayResult } from './CasinoGame';

// Communal table: up to 4 guests hold seats and auto-play simplified rounds.
// The round is a house-edge payout roll, not player-facing cards.
export class BlackjackTable extends CasinoGame {
  private seats: (string | null)[];

  constructor(id: string, costToPlay: number = BLACKJACK_BALANCE.costToPlay) {
    super(id, 'blackjack-table', costToPlay);
    this.seats = new Array<string | null>(BLACKJACK_BALANCE.seats).fill(null);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: BLACKJACK_BALANCE.playIntervalTicks,
      playsMin: BLACKJACK_BALANCE.playsMin,
      playsMax: BLACKJACK_BALANCE.playsMax,
    };
  }

  get seatedCount(): number {
    return this.seats.filter((s) => s !== null).length;
  }

  override get isAvailable(): boolean {
    return !this.broken && this.seats.includes(null);
  }

  isSeatFree(seat: number): boolean {
    return this.seats[seat] === null;
  }

  /** Claim a seat (a specific one, or the first free); returns its index, or null. */
  claimSeat(guestId: string, seat?: number): number | null {
    const existing = this.seats.indexOf(guestId);
    if (existing !== -1) return existing;
    const target = seat ?? this.seats.indexOf(null);
    if (target === -1 || this.seats[target] !== null) return null;
    this.seats[target] = guestId;
    return target;
  }

  seatOf(guestId: string): number | null {
    const idx = this.seats.indexOf(guestId);
    return idx === -1 ? null : idx;
  }

  override isPlayableBy(guestId: string): boolean {
    return !this.broken && this.seats.includes(guestId);
  }

  override release(guestId: string): void {
    const idx = this.seats.indexOf(guestId);
    if (idx !== -1) this.seats[idx] = null;
  }

  override releaseAll(): void {
    this.seats.fill(null);
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
