// Blackjack dealt from a real shoe: cut-card penetration, dealer peek, splits,
// doubles, late surrender and the configurable rule set in ./rules.

import type { Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import { cardLabel, rankOf, shuffle } from '../cards';
import { clampBet, type CasinoEngine } from '../types';
import {
  blackjackEdge,
  DEFAULT_BLACKJACK_RULES,
  validateBlackjackRules,
  type BlackjackRules,
} from './rules';
import { basicStrategyFor, type BjAction, type HandFacts } from './strategy';

export type { BlackjackRules } from './rules';

/** Blackjack value of a card: 2–9 face, ten/court 10, ace 1. */
export function bjValue(card: number): number {
  const r = rankOf(card);
  return r === 12 ? 1 : r >= 8 ? 10 : r + 2;
}

/**
 * The shoe. It lives with the table, not the round, so the cut card means
 * something: rounds deal down through it and a reshuffle happens between
 * rounds once the cut card has come out.
 */
export class Shoe {
  readonly cards: Uint8Array;
  private pos = 0;
  private cut: number;
  /** Rounds since the last shuffle — telemetry for the inspector. */
  shuffles = 0;

  constructor(
    readonly decks: number,
    penetration: number,
    private readonly rng: RngLike,
  ) {
    this.cards = new Uint8Array(decks * 52);
    for (let i = 0; i < this.cards.length; i++) this.cards[i] = i % 52;
    this.cut = Math.floor(this.cards.length * penetration);
    this.reshuffle();
  }

  reshuffle(): void {
    shuffle(this.cards, this.rng);
    this.pos = 0;
    this.shuffles++;
  }

  /** Called between rounds: shuffle if the cut card has come out. */
  prepareRound(penetration: number): void {
    this.cut = Math.floor(this.cards.length * penetration);
    if (this.pos >= this.cut) this.reshuffle();
  }

  draw(): number {
    // A round that runs past the end of the shoe (only possible with a deep
    // cut and a run of splits) reshuffles the discards, as a dealer would.
    if (this.pos >= this.cards.length) this.reshuffle();
    return this.cards[this.pos++]!;
  }

  get remaining(): number {
    return this.cards.length - this.pos;
  }
}

interface Hand {
  cards: number[];
  bet: number;
  done: boolean;
  doubled: boolean;
  surrendered: boolean;
  /** Born from a split — no blackjack, maybe no double. */
  split: boolean;
  /** Split aces get one card. */
  splitAces: boolean;
}

function facts(cards: readonly number[]): { sum: number; ace: boolean } {
  let sum = 0;
  let ace = false;
  for (const c of cards) {
    const v = bjValue(c);
    sum += v;
    if (v === 1) ace = true;
  }
  return { sum, ace };
}

export function handTotal(cards: readonly number[]): number {
  const { sum, ace } = facts(cards);
  return ace && sum + 10 <= 21 ? sum + 10 : sum;
}

const isBlackjack = (cards: readonly number[]): boolean =>
  cards.length === 2 && handTotal(cards) === 21;

export interface BlackjackView {
  dealerUp: number;
  /** Shown once the round has settled. */
  dealerCards: number[] | null;
  hands: { cards: number[]; bet: number; total: number; done: boolean }[];
  active: number;
  /** Strategy inputs for the active hand. */
  facts: HandFacts | null;
  /** The rules that change a basic-strategy decision. */
  rules: Pick<BlackjackRules, 'h17' | 'das'>;
}

class BlackjackRound implements Round {
  private readonly hands: Hand[] = [];
  private readonly dealer: number[] = [];
  private active = 0;
  private settled: RoundResult | null = null;
  private readonly base: number;

  constructor(
    private readonly rules: BlackjackRules,
    private readonly shoe: Shoe,
    bet: number,
  ) {
    this.base = bet;
    const p1 = shoe.draw();
    const d1 = shoe.draw();
    const p2 = shoe.draw();
    const d2 = shoe.draw();
    this.hands.push(this.newHand([p1, p2], bet, false));
    this.dealer.push(d1, d2);

    const playerBj = isBlackjack(this.hands[0]!.cards);
    // The dealer peeks under an ace or ten: a dealer blackjack ends the round
    // before anyone can double or split into it.
    const upValue = bjValue(d1);
    const dealerBj = (upValue === 1 || upValue === 10) && isBlackjack(this.dealer);
    if (dealerBj || playerBj) {
      this.hands[0]!.done = true;
      this.finish(false);
    }
  }

  private newHand(cards: number[], bet: number, split: boolean, splitAces = false): Hand {
    return { cards, bet, done: false, doubled: false, surrendered: false, split, splitAces };
  }

  private get hand(): Hand | undefined {
    return this.hands[this.active];
  }

  private allowed(): BjAction[] {
    const h = this.hand;
    if (!h || h.done) return [];
    const r = this.rules;
    const two = h.cards.length === 2;
    // A split ace still in play is a re-splittable pair of aces: it may split
    // again or stand, never draw.
    if (h.splitAces) return this.hands.length < r.maxSplitHands ? ['stand', 'split'] : ['stand'];
    const opts: BjAction[] = ['stand', 'hit'];
    if (two && (!h.split || r.das)) opts.push('double');
    if (
      two &&
      bjValue(h.cards[0]!) === bjValue(h.cards[1]!) &&
      this.hands.length < r.maxSplitHands
    ) {
      opts.push('split');
    }
    if (two && !h.split && this.hands.length === 1 && r.surrender === 'late')
      opts.push('surrender');
    return opts;
  }

  options(): string[] | null {
    if (this.settled) return null;
    return this.allowed();
  }

  act(action: string): void {
    if (this.settled) return;
    const h = this.hand;
    if (!h || !(this.allowed() as string[]).includes(action)) return;
    switch (action as BjAction) {
      case 'stand':
        h.done = true;
        break;
      case 'hit':
        h.cards.push(this.shoe.draw());
        if (handTotal(h.cards) >= 21) h.done = true;
        break;
      case 'double':
        h.bet *= 2;
        h.doubled = true;
        h.cards.push(this.shoe.draw());
        h.done = true;
        break;
      case 'surrender':
        h.surrendered = true;
        h.done = true;
        break;
      case 'split': {
        const aces = bjValue(h.cards[0]!) === 1;
        const second = this.newHand([h.cards.pop()!], this.base, true, aces);
        h.split = true;
        h.splitAces = aces;
        h.cards.push(this.shoe.draw());
        second.cards.push(this.shoe.draw());
        this.hands.splice(this.active + 1, 0, second);
        for (const sh of [h, second]) {
          // Split aces take their one card and stand — unless it is another
          // ace and the table lets them re-split.
          const pairOfAces = aces && bjValue(sh.cards[1]!) === 1 && this.rules.rsa;
          if ((aces && !pairOfAces) || handTotal(sh.cards) === 21) sh.done = true;
        }
        break;
      }
    }
    this.advance();
  }

  private advance(): void {
    while (this.active < this.hands.length && this.hands[this.active]!.done) this.active++;
    if (this.active >= this.hands.length) this.finish(true);
  }

  private finish(dealerPlays: boolean): void {
    const r = this.rules;
    // The dealer draws only if some hand is still standing to be beaten.
    const live = this.hands.some((h) => !h.surrendered && handTotal(h.cards) <= 21);
    if (dealerPlays && live) {
      for (;;) {
        const { sum, ace } = facts(this.dealer);
        const total = ace && sum + 10 <= 21 ? sum + 10 : sum;
        const soft = ace && sum + 10 <= 21;
        if (total > 17 || (total === 17 && !(soft && r.h17))) break;
        this.dealer.push(this.shoe.draw());
      }
    }
    const dealerTotal = handTotal(this.dealer);
    const dealerBj = isBlackjack(this.dealer);
    const bjPays = r.blackjackPays === '3:2' ? 1.5 : 1.2;
    let wagered = 0;
    let returned = 0;
    const notes: string[] = [];
    for (const h of this.hands) {
      wagered += h.bet;
      const total = handTotal(h.cards);
      const natural = !h.split && isBlackjack(h.cards);
      let ret: number;
      if (h.surrendered) ret = h.bet / 2;
      else if (natural && dealerBj) ret = h.bet;
      else if (natural) ret = h.bet * (1 + bjPays);
      else if (dealerBj) ret = 0;
      else if (total > 21) ret = 0;
      else if (dealerTotal > 21 || total > dealerTotal) ret = h.bet * 2;
      else if (total === dealerTotal) ret = h.bet;
      else ret = 0;
      returned += ret;
      notes.push(
        h.surrendered
          ? 'surrender'
          : natural
            ? 'blackjack'
            : total > 21
              ? `bust ${total}`
              : `${total}`,
      );
    }
    this.settled = {
      wagered,
      returned,
      summary: `${notes.join(' / ')} vs dealer ${dealerBj ? 'blackjack' : dealerTotal > 21 ? `bust ${dealerTotal}` : dealerTotal}`,
      detail: {
        dealer: this.dealer.map(cardLabel),
        hands: this.hands.map((h) => h.cards.map(cardLabel)),
      },
    };
  }

  view(): BlackjackView {
    const h = this.hand;
    let handFacts: HandFacts | null = null;
    if (h && !this.settled) {
      const f = facts(h.cards);
      const pair =
        h.cards.length === 2 && bjValue(h.cards[0]!) === bjValue(h.cards[1]!)
          ? bjValue(h.cards[0]!)
          : null;
      handFacts = { ...f, pair };
    }
    return {
      dealerUp: this.dealer[0]!,
      dealerCards: this.settled ? [...this.dealer] : null,
      hands: this.hands.map((x) => ({
        cards: [...x.cards],
        bet: x.bet,
        total: handTotal(x.cards),
        done: x.done,
      })),
      active: this.active,
      facts: handFacts,
      rules: { h17: this.rules.h17, das: this.rules.das },
    };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

export interface BlackjackEngine extends CasinoEngine<BlackjackRules> {
  /** Begin a round from a table's own shoe. Without one, a freshly shuffled
   *  shoe is used — a continuous shuffler, in effect. */
  begin(rng: RngLike, rules: BlackjackRules, bets: Bet[], shoe?: Shoe): Round;
  /** Basic strategy for a view under explicit rules. */
  strategyFor(rules: BlackjackRules, view: BlackjackView, options: readonly string[]): string;
}

export const blackjackEngine: BlackjackEngine = {
  kind: 'blackjack',

  defaultRules: () => ({ ...DEFAULT_BLACKJACK_RULES }),

  validateRules: (raw, base) => validateBlackjackRules(raw, base),

  theoreticalEdge: blackjackEdge,

  roundsPerHour(_rules, seated) {
    // The classic hands-per-hour table — ~200 heads-up, ~133 with two, ~57
    // with six — is fitted almost exactly by 400 / (players + 1).
    return 400 / (Math.max(1, seated) + 1);
  },

  begin(rng, rules, bets, shoe) {
    const main = bets.find((b) => b.spot === 'main');
    const s = shoe ?? new Shoe(rules.decks, rules.penetration, rng);
    s.prepareRound(rules.penetration);
    return new BlackjackRound(rules, s, main ? main.amount : rules.minBet);
  },

  strategy(view, options) {
    const v = view as BlackjackView;
    return blackjackEngine.strategyFor({ ...DEFAULT_BLACKJACK_RULES, ...v.rules }, v, options);
  },

  strategyFor(rules, view, options) {
    if (!view.facts || options.length === 0) return options[0] ?? 'stand';
    return basicStrategyFor(rules).choose(
      view.facts,
      bjValue(view.dealerUp),
      // Conservative plays first so EV ties resolve to them.
      (['stand', 'hit', 'double', 'split', 'surrender'] as const).filter((a) =>
        options.includes(a),
      ),
    );
  },

  appeal(rules) {
    // 6:5 is the rule players know by name and resent; the others are the
    // ones a regular reads off the felt. Multipliers stack.
    let a = 1;
    if (rules.blackjackPays === '6:5') a *= 0.7;
    if (rules.h17) a *= 0.95;
    if (rules.das) a *= 1.03;
    if (rules.surrender === 'late') a *= 1.04;
    if (rules.rsa) a *= 1.02;
    if (rules.decks <= 2) a *= 1.08;
    if (rules.maxSplitHands === 2) a *= 0.97;
    return Math.min(1.5, Math.max(0.5, a));
  },

  spotEdge(rules, spot) {
    return spot === 'main' ? blackjackEdge(rules) : 0;
  },

  guestBets(rules, unit) {
    return [{ spot: 'main', amount: clampBet(rules, unit) }];
  },
};
