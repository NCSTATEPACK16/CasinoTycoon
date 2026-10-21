// The casino-math contract. Every game engine is pure: given a seeded RNG,
// rules and bets it resolves a round with the game's real rules — no
// {p, multiplier} shortcuts. See docs/SPEC.md §6.

export interface RngLike {
  /** Uniform in [0, 1). */
  next(): number;
}

export type GameKind = 'slots' | 'roulette' | 'blackjack' | 'craps' | 'uth';

export interface Bet {
  /** Engine-specific spot id: 'pass', 'dontPass', 'straight:17', 'ante', 'main'... */
  spot: string;
  amount: number;
}

export interface RoundResult {
  /** Total put at risk over the whole round, including raises, doubles and odds. */
  wagered: number;
  /** Total handed back to the player, stake included. Net to house = wagered - returned. */
  returned: number;
  /** Human-readable summary for the inspector and the avatar's table UI. */
  summary: string;
  /** Engine-specific detail (cards, dice, reel stops) for rendering the result. */
  detail: unknown;
}

/** A round in progress. AI drives it with its strategy; the avatar drives it
 *  from the UI. `options()` returning null means the round has settled. */
export interface Round {
  options(): string[] | null;
  act(action: string): void;
  /** Public state for rendering: hands, point, reels. */
  view(): unknown;
  result(): RoundResult | null;
}

export interface BaseRules {
  minBet: number;
  maxBet: number;
}

export interface GameEngine<R extends BaseRules = BaseRules> {
  readonly kind: GameKind;
  defaultRules(): R;
  /** House edge as a fraction of the initial wager under these rules and
   *  optimal (or the engine's documented reference) strategy. */
  theoreticalEdge(rules: R): number;
  /** Rounds dealt per hour at a table with this many seated players. */
  roundsPerHour(rules: R, seated: number): number;
  begin(rng: RngLike, rules: R, bets: Bet[]): Round;
  /** The action the reference strategy takes for this view (basic strategy,
   *  UTH decision table). Guests apply their own error rate on top. */
  strategy(view: unknown, options: string[]): string;
  /** Appeal multiplier 0.5..1.5 for guests who notice rules (6:5 BJ, 00 wheels). */
  appeal(rules: R): number;
}
