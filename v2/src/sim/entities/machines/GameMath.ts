// The bridge between a placed machine and its game engine: the table's rules
// (validated), its shoe, and the one call the guest AI makes —
// playRound(guestCtx, rng) — which plays a real round for a guest with a
// stake, a wallet to respect and an error rate.

import type { BaseRules, Bet, GameKind, Round, RoundResult, RngLike } from '../../../shared/games';
import { blackjackEngine, Shoe, type BlackjackView } from '../../games/blackjack/blackjack';
import type { BlackjackRules } from '../../games/blackjack/rules';
import type { CrapsView } from '../../games/craps/craps';
import { ENGINES } from '../../games';
import { theoForBets, type CasinoEngine, type RulesIssue } from '../../games/types';
import { Rng as SeededRng } from '../../rng';
import type { UthView } from '../../games/uth/uth';

/** Hands per skill-premium measurement: the premium to about ±0.15 points,
 *  for ~0.25 s (blackjack) and ~0.6 s (UTH) on first use of a rule set. */
const PREMIUM_HANDS_BJ = 60_000;
const PREMIUM_HANDS_UTH = 30_000;
/** Shared across tables: the premium is a function of the rules alone. */
const PREMIUMS = new Map<string, number>();

export interface GuestPlayContext {
  /** Stake per round (the line bet, the Ante, the main bet). Clamped to the
   *  table's limits; a slot's bet is fixed by its denomination. */
  unit: number;
  /** Money the guest can put at risk. Doubles, splits, raises and odds the
   *  guest cannot cover are simply not taken. */
  wallet: number;
  /** Chance of a non-reference action at each decision: 0 plays perfect basic
   *  strategy (or the UTH table), 0.25 is a tourist guessing. */
  skillError: number;
  /** Chance of backing a craps point with the free odds when offered (1 =
   *  always, the reference play). Odds are edge-free swing. */
  oddsAppetite: number;
}

/** A settled round plus the books' view of it. */
export interface PlayedRound extends RoundResult {
  /** Theoretical win: Σ opening bets × each spot's edge, plus the guest's
   *  skill premium (see GameMath.skillPremium). */
  theo: number;
  /** The opening bets' total — what edges are quoted against. */
  opening: number;
}

/** Extra money an action puts on the table, read from the round's view. */
export function actionCost(kind: GameKind, view: unknown, action: string): number {
  switch (kind) {
    case 'blackjack': {
      if (action !== 'double' && action !== 'split') return 0;
      const v = view as BlackjackView;
      return v.hands[v.active]?.bet ?? 0;
    }
    case 'uth': {
      const m = /^bet(\d)x$/.exec(action);
      return m ? (view as UthView).ante * Number(m[1]) : 0;
    }
    case 'craps': {
      if (!action.startsWith('odds:')) return 0;
      const spot = action.slice(5);
      return (view as CrapsView).oddsOpen.find((o) => o.spot === spot)?.max ?? 0;
    }
    default:
      return 0;
  }
}

export class GameMath<R extends BaseRules = BaseRules> {
  rules: R;
  /** Blackjack only: the table's own shoe, so the cut card means something. */
  private shoe: Shoe | null = null;

  constructor(
    readonly kind: GameKind,
    rules?: unknown,
  ) {
    this.rules = this.engine.validateRules(rules ?? {}).rules;
  }

  get engine(): CasinoEngine<R> {
    return ENGINES[this.kind] as unknown as CasinoEngine<R>;
  }

  /** Validate, clamp and apply a rules object; returns what had to change. */
  setRules(raw: unknown): RulesIssue[] {
    const { rules, issues } = this.engine.validateRules(raw, this.rules);
    // A new deck count is a new shoe.
    if (this.kind === 'blackjack') {
      const b = rules as unknown as BlackjackRules;
      if (this.shoe && this.shoe.decks !== b.decks) this.shoe = null;
    }
    this.rules = rules;
    return issues;
  }

  get edge(): number {
    return this.engine.theoreticalEdge(this.rules);
  }

  get appeal(): number {
    return this.engine.appeal(this.rules);
  }

  /** Rounds an hour at this occupancy; a dealer's speed multiplies it. */
  roundsPerHour(seated: number, dealerSpeed = 1): number {
    return this.engine.roundsPerHour(this.rules, seated) * dealerSpeed;
  }

  /** Begin a round on this table — the avatar's entry point. */
  begin(rng: RngLike, bets: Bet[]): Round {
    if (this.kind === 'blackjack') {
      const rules = this.rules as unknown as BlackjackRules;
      this.shoe ??= new Shoe(rules.decks, rules.penetration, rng);
      return blackjackEngine.begin(rng, rules, bets, this.shoe);
    }
    return this.engine.begin(rng, this.rules, bets);
  }

  theoFor(bets: readonly Bet[]): number {
    return theoForBets(this.engine, this.rules, bets);
  }

  /** The reference action for a round in progress (basic strategy etc). */
  referenceAction(round: Round, options: string[]): string {
    const view = round.view();
    if (this.kind === 'blackjack') {
      return blackjackEngine.strategyFor(
        this.rules as unknown as BlackjackRules,
        view as BlackjackView,
        options,
      );
    }
    return this.engine.strategy(view, options);
  }

  /**
   * Play one complete round for a guest. Returns null when the guest cannot
   * cover the opening bets. Every decision takes the reference action, except
   * that with probability `skillError` the guest picks uniformly among the
   * other legal actions — which is how real players lose more than the book
   * edge — and an action the wallet cannot cover is never offered.
   */
  playRound(ctx: GuestPlayContext, rng: RngLike, errRng: RngLike = rng): PlayedRound | null {
    const played = this.playRaw(ctx, rng, errRng);
    if (!played) return null;
    const { result, bets } = played;
    const opening = bets.reduce((a, b) => a + b.amount, 0);
    return {
      ...result,
      theo: this.theoFor(bets) + opening * this.skillPremium(ctx.skillError),
      opening,
    };
  }

  /** One round with no books attached: the result and the opening bets. */
  private playRaw(
    ctx: GuestPlayContext,
    rng: RngLike,
    errRng: RngLike,
  ): { result: RoundResult; bets: Bet[] } | null {
    let bets = this.engine.guestBets(this.rules, ctx.unit, rng);
    let committed = bets.reduce((a, b) => a + b.amount, 0);
    // A side bet the wallet cannot cover is skipped, not the whole round.
    if (committed > ctx.wallet && bets.length > 1) {
      bets = bets.slice(0, 1);
      committed = bets[0]!.amount;
    }
    if (committed <= 0 || committed > ctx.wallet) return null;
    const round = this.begin(rng, bets);
    for (let guard = 0; guard < 1000; guard++) {
      const options = round.options();
      if (!options) break;
      const view = round.view();
      const affordable = options.filter(
        (o) => committed + actionCost(this.kind, view, o) <= ctx.wallet,
      );
      // Every round has a free action (stand, check, fold, roll, spin), so
      // `affordable` is never empty; guard anyway rather than loop forever.
      const legal = affordable.length > 0 ? affordable : options;
      let action = this.referenceAction(round, legal);
      if (!legal.includes(action)) action = legal[0]!;
      // Declining the odds is not a mistake — it costs nothing — so it is a
      // matter of appetite rather than skill.
      if (action.startsWith('odds:') && errRng.next() >= ctx.oddsAppetite) action = 'roll';
      if (legal.length > 1 && ctx.skillError > 0 && errRng.next() < ctx.skillError) {
        const others = legal.filter((o) => o !== action);
        action = others[Math.floor(errRng.next() * others.length)]!;
      }
      committed += actionCost(this.kind, view, action);
      round.act(action);
    }
    const result = round.result();
    return result ? { result, bets } : null;
  }

  /**
   * Extra house edge, per unit of opening bet, from a player who strays from
   * the reference strategy at this rate. Casinos rate players the same way:
   * theo is the edge against the player actually sitting there, not against
   * perfect play, which is why it predicts hold.
   *
   * Measured, not modelled: the same deals are played twice, once perfectly
   * and once with errors (common random numbers, so the difference is far
   * quieter than either run), on a private shoe and RNG so the measurement
   * never disturbs the live table. Cached per rule set and error rate. Only
   * blackjack and UTH have decisions with an edge cost — craps' only
   * decision is the zero-edge odds, and slots and roulette have none.
   */
  skillPremium(skillError: number): number {
    if (skillError <= 0 || (this.kind !== 'blackjack' && this.kind !== 'uth')) return 0;
    // Table limits don't change a decision's cost; leave them out of the key.
    const { minBet: _min, maxBet: _max, ...decisive } = this.rules;
    const key = `${this.kind}|${JSON.stringify(decisive)}|${skillError}`;
    const cached = PREMIUMS.get(key);
    if (cached !== undefined) return cached;
    const hands = this.kind === 'blackjack' ? PREMIUM_HANDS_BJ : PREMIUM_HANDS_UTH;
    const run = (err: number): number => {
      const probe = new GameMath<R>(this.kind, this.rules);
      const deal = new SeededRng(0x5eed);
      const errors = new SeededRng(0xe77);
      let net = 0;
      let opening = 0;
      for (let i = 0; i < hands; i++) {
        const r = probe.playRaw(
          { unit: 1, wallet: Infinity, skillError: err, oddsAppetite: 1 },
          deal,
          errors,
        );
        if (r) {
          net += r.result.wagered - r.result.returned;
          opening += r.bets.reduce((a, b) => a + b.amount, 0);
        }
      }
      return net / opening;
    };
    const premium = Math.max(0, run(skillError) - run(0));
    PREMIUMS.set(key, premium);
    return premium;
  }

  toJSON(): unknown {
    return this.rules;
  }
}
