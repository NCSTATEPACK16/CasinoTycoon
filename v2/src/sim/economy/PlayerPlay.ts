// The avatar at the tables. The player has a wallet of their own, separate
// from the casino's cash: when they sit down they are a customer, and every
// dollar they lose is the house's win. Rounds begin with `roundBegin` and
// advance with `roundAct`, exactly as a guest's would — same engines, same
// rules, same shoe.

import type { Bet, Round, RoundResult, RngLike } from '../../shared/games';
import { actionCost, type GameMath } from '../entities/machines/GameMath';

export const PLAYER_START_WALLET = 1000;

export interface PlayerRoundReply {
  /** Legal actions, or null once the round has settled. */
  options: string[] | null;
  view: unknown;
  /** Present once settled. */
  result?: RoundResult & { theo: number };
  /** The bankroll, settled rounds only: chips still in play are in it. */
  wallet: number;
  /** Chips committed to rounds that haven't settled, on every table. */
  onTable: number;
}

interface OpenRound {
  round: Round;
  math: GameMath;
  theo: number;
  committed: number;
}

export interface PlayerPlayJSON {
  wallet: number;
}

/** What settling a round needs from the world: the house side of the book. */
export interface HouseBook {
  settle(machineId: string, result: RoundResult & { theo: number }): void;
}

export class PlayerPlay {
  wallet = PLAYER_START_WALLET;
  private open = new Map<string, OpenRound>();

  /** Start a round at a machine. Bets are validated by the engine (an unknown
   *  spot is dropped) and must be covered by the wallet. */
  begin(
    machineId: string,
    math: GameMath,
    bets: Bet[],
    rng: RngLike,
    house: HouseBook,
  ): PlayerRoundReply | string {
    if (this.open.has(machineId)) return 'a round is already in progress at this table';
    const clean = bets
      .filter((b) => Number.isFinite(b.amount) && b.amount > 0)
      .map((b) => ({ spot: String(b.spot), amount: Math.round(b.amount * 100) / 100 }));
    if (clean.length === 0) return 'no bets';
    const { minBet, maxBet } = math.rules;
    for (const b of clean) {
      if (math.kind !== 'slots' && (b.amount < minBet || b.amount > maxBet)) {
        // Side bets (Trips, props) may go under the table minimum, as on a real layout.
        const main = clean[0] === b;
        if (main || b.amount > maxBet) return `bets at this table are $${minBet}–$${maxBet}`;
      }
    }
    const committed = clean.reduce((a, b) => a + b.amount, 0);
    if (this.committedElsewhere(machineId) + committed > this.wallet)
      return 'not enough in your wallet';
    const round = math.begin(rng, clean);
    const entry: OpenRound = { round, math, theo: math.theoFor(clean), committed };
    this.open.set(machineId, entry);
    return this.reply(machineId, entry, house);
  }

  act(machineId: string, action: string, house: HouseBook): PlayerRoundReply | string {
    const entry = this.open.get(machineId);
    if (!entry) return 'no round in progress at this table';
    const options = entry.round.options();
    if (!options || !options.includes(action)) return `can't ${action} now`;
    const cost = actionCost(entry.math.kind, entry.round.view(), action);
    if (this.committedElsewhere(machineId) + entry.committed + cost > this.wallet) {
      return 'not enough in your wallet';
    }
    entry.committed += cost;
    entry.round.act(action);
    return this.reply(machineId, entry, house);
  }

  /** Abandon any open rounds (table sold, world reset). Nothing is settled:
   *  an unsettled round never moved money. */
  clear(): void {
    this.open.clear();
  }

  drop(machineId: string): void {
    this.open.delete(machineId);
  }

  isPlaying(machineId: string): boolean {
    return this.open.has(machineId);
  }

  /** Chips in every open round. */
  get onTable(): number {
    let sum = 0;
    for (const e of this.open.values()) sum += e.committed;
    return sum;
  }

  /** Chips already on other tables: one wallet covers every open round. */
  private committedElsewhere(machineId: string): number {
    let sum = 0;
    for (const [id, e] of this.open) if (id !== machineId) sum += e.committed;
    return sum;
  }

  private reply(machineId: string, entry: OpenRound, house: HouseBook): PlayerRoundReply {
    const options = entry.round.options();
    const res = entry.round.result();
    if (!options && res) {
      const result = { ...res, theo: entry.theo };
      this.wallet = Math.round((this.wallet + res.returned - res.wagered) * 100) / 100;
      this.open.delete(machineId);
      house.settle(machineId, result);
      return {
        options: null,
        view: entry.round.view(),
        result,
        wallet: this.wallet,
        onTable: this.onTable,
      };
    }
    return { options, view: entry.round.view(), wallet: this.wallet, onTable: this.onTable };
  }

  toJSON(): PlayerPlayJSON {
    return { wallet: this.wallet };
  }

  static fromJSON(data: PlayerPlayJSON | undefined): PlayerPlay {
    const p = new PlayerPlay();
    if (data && Number.isFinite(data.wallet)) p.wallet = data.wallet;
    return p;
  }
}
