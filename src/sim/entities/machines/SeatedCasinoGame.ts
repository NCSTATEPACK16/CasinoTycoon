import { CasinoGame } from './CasinoGame';

// Shared base for communal multi-seat tables (Blackjack, Craps): guests hold
// a seat rather than reserving the whole machine, so several can play at once.
export abstract class SeatedCasinoGame extends CasinoGame {
  private seats: (string | null)[];

  constructor(id: string, defId: string, costToPlay: number, seatCount: number) {
    super(id, defId, costToPlay);
    this.seats = new Array<string | null>(seatCount).fill(null);
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
}
