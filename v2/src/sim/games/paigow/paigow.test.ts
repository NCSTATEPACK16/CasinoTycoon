import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import { parseCard } from '../cards';
import {
  Cat,
  JOKER,
  PAI_GOW_RATES,
  catOf,
  legalSetting,
  paiGowEdge,
  paiGowEngine,
  paiGowLabel,
  paiGowRoundFromCards,
  scoreHigh,
  scoreLow,
  setHand,
  settle,
  type PaiGowRules,
} from './paigow';

const rules: PaiGowRules = paiGowEngine.defaultRules();
const cards = (s: string) => s.split(' ').map((c) => (c === 'Jk' ? JOKER : parseCard(c)));
const labels = (cs: readonly number[]) => [...cs].map(paiGowLabel).sort();

describe('pai gow hand values', () => {
  it('ranks five-card hands, with the joker semi-wild', () => {
    expect(catOf(scoreHigh(cards('As Ks Qs Js Ts')))).toBe(Cat.StraightFlush);
    expect(catOf(scoreHigh(cards('As Ks Qs Js Jk')))).toBe(Cat.StraightFlush);
    expect(catOf(scoreHigh(cards('2h 3d 4c 5s Jk')))).toBe(Cat.Straight);
    expect(catOf(scoreHigh(cards('2h 9h 4h 5h Jk')))).toBe(Cat.Flush);
    // Not a straight or flush: the joker is an ace.
    expect(catOf(scoreHigh(cards('Ah 9d 4c 5s Jk')))).toBe(Cat.Pair);
    expect(catOf(scoreHigh(cards('Kh 9d 4c 5s Jk')))).toBe(Cat.HighCard);
    expect(catOf(scoreHigh(cards('Ah Ad Ac As Jk')))).toBe(Cat.FiveAces);
    expect(scoreHigh(cards('As Ks Qs Js Ts'))).toBeGreaterThan(scoreHigh(cards('Kd Qd Jd Td 9d')));
    // The wheel is the lowest straight here.
    expect(scoreHigh(cards('Ah 2d 3c 4s 5h'))).toBeLessThan(scoreHigh(cards('2c 3d 4c 5s 6h')));
  });

  it('ranks two-card hands, the joker an ace', () => {
    expect(scoreLow(cards('2c 2d'))).toBeGreaterThan(scoreLow(cards('As Kd')));
    expect(scoreLow(cards('Jk Kd'))).toBe(scoreLow(cards('Ah Kc')));
    expect(scoreLow(cards('Kd Qc'))).toBeGreaterThan(scoreLow(cards('Kd Jc')));
  });

  it('settles both, one or neither, with copies to the banker', () => {
    const p = { high: cards('Ah Ad 9c 5s 2d'), low: cards('Kh Qd') };
    const lowerHigh = { high: cards('Kh Kd 9c 5s 2d'), low: cards('Jh Td') };
    expect(settle(p, lowerHigh)).toBe('win');
    expect(settle(p, { high: lowerHigh.high, low: cards('As Kd') })).toBe('push');
    // An identical low hand is a copy: it goes to the banker, so one-and-a-copy pushes.
    expect(settle(p, { high: lowerHigh.high, low: cards('Kc Qs') })).toBe('push');
    expect(settle(p, { high: cards('Ac As 9d 5h 2c'), low: cards('Kc Qs') })).toBe('lose');
  });
});

describe('the house way', () => {
  const set = (s: string) => {
    const r = setHand(cards(s));
    expect(legalSetting(r.high, r.low), s).toBe(true);
    return labels(r.low);
  };

  it('plays the textbook settings', () => {
    expect(set('Ah Kd 9c 7s 5d 3c 2h')).toEqual(['9c', 'Kd']); // no pair: 2nd and 3rd low
    expect(set('Ah Ad Kc 9s 5d 3c 2h')).toEqual(['9s', 'Kc']); // one pair: pair high
    expect(set('Kh Kd 8c 8s Qd 3c 2h')).toEqual(['8c', '8s']); // two pair: split
    expect(set('9h 9d 4c 4s Ad 3c 2h')).toEqual(['3c', 'Ad']); // small two pair with an ace
    expect(set('Kh Kd 8c 8s 4d 4c 2h')).toEqual(['Kd', 'Kh']); // three pair: highest low
    expect(set('Ah Ad Ac 9s 5d 3c 2h')).toEqual(['9s', 'Ah'].sort()); // trip aces split
    expect(set('7h 7d 7c Ks 5d 3c 2h')).toEqual(['5d', 'Ks']); // trips high
    expect(set('7h 7d 7c Ks Kd 3c 2h')).toEqual(['Kd', 'Ks']); // full house: pair low
    expect(set('Jh Jd Jc Js Kd 3c 2h').map((c) => c[0])).toEqual(['J', 'J']); // big quads split
    expect(set('4h 4d 4c 4s Kd 3c 2h')).toEqual(['3c', 'Kd']); // small quads stay
    // A straight with the best two left over.
    expect(set('9h 8d 7c 6s 5d Kc Qh')).toEqual(['Kc', 'Qh']);
    // The joker completes the flush.
    expect(set('2h 9h 4h 5h Jk Kc Qd')).toEqual(['Kc', 'Qd']);
  });

  it('always sets a legal hand (2,000 random deals with the joker)', () => {
    const rng = new Rng(5);
    for (let n = 0; n < 2_000; n++) {
      const deck = Array.from({ length: 53 }, (_, i) => i);
      for (let i = 0; i < 7; i++) {
        const j = i + Math.floor(rng.next() * (53 - i));
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
      }
      const r = setHand(deck.slice(0, 7));
      expect(r.high).toHaveLength(5);
      expect(r.low).toHaveLength(2);
      expect(legalSetting(r.high, r.low)).toBe(true);
    }
  });
});

describe('pai gow edge', () => {
  it('commission moves the edge analytically: P(lose) − P(win)(1 − c)', () => {
    const r = PAI_GOW_RATES['semi-wild'];
    expect(paiGowEdge(rules)).toBeCloseTo(r.lose - r.win * 0.95, 12);
    const four = paiGowEngine.validateRules({ commission: 0.04 }).rules;
    expect(paiGowEdge(rules) - paiGowEdge(four)).toBeCloseTo(r.win * 0.01, 12);
    expect(paiGowEngine.appeal(four)).toBeGreaterThan(paiGowEngine.appeal(rules));
    const noJoker = paiGowEngine.validateRules({ jokerRule: 'none' }).rules;
    expect(paiGowEdge(noJoker)).toBeGreaterThan(paiGowEdge(rules));
  });

  // Wizard of Odds ("Pai Gow Poker"): the player using the house way against a
  // house-way banker gives up about 2.7% per hand at a 5% commission, and
  // about 41% of hands push.
  const measure = (jokerRule: PaiGowRules['jokerRule'], seed: number) => {
    const r = paiGowEngine.validateRules({ jokerRule }).rules;
    const rng = new Rng(seed);
    let net = 0;
    let push = 0;
    const N = 2_000_000;
    for (let i = 0; i < N; i++) {
      const round = paiGowEngine.begin(rng, r, [{ spot: 'main', amount: 1 }]);
      round.act('deal');
      const res = round.result()!;
      net += res.wagered - res.returned;
      if (res.returned === res.wagered) push++;
    }
    return { edge: net / N, push: push / N, rules: r };
  };

  it('a 2M-hand Monte Carlo lands on the edge (53 cards)', () => {
    const m = measure('semi-wild', 0xa1);
    expect(Math.abs(m.edge - paiGowEdge(m.rules))).toBeLessThan(0.0015);
    expect(m.edge).toBeGreaterThan(0.022);
    expect(m.edge).toBeLessThan(0.032);
    expect(m.push).toBeGreaterThan(0.39);
    expect(m.push).toBeLessThan(0.43);
  }, 300_000);

  it('a 2M-hand Monte Carlo lands on the edge (52 cards, no joker)', () => {
    const m = measure('none', 0xa2);
    expect(Math.abs(m.edge - paiGowEdge(m.rules))).toBeLessThan(0.0015);
  }, 300_000);
});

describe('pai gow rounds', () => {
  it('pays even money less commission, pushes and loses', () => {
    // Player A-A-K-Q-9-7-5: aces high, K-Q low. Banker 8-8-J-T-6-4-2: eights
    // high, J-T low. Both player hands win.
    const win = paiGowRoundFromCards(
      rules,
      100,
      cards('Ah Ad Kc Qs 9d 7c 5h 8h 8d Jc Ts 6d 4c 2s'),
    );
    expect(win.options()).toEqual(['deal']);
    win.act('deal');
    const r = win.result()!;
    expect(r.returned).toBeCloseTo(195, 9);
    const d = r.detail as {
      player: { high: string[]; low: string[] };
      dealer: { high: string[]; low: string[] };
      outcome: string;
    };
    expect(d.outcome).toBe('win');
    expect(d.player.low.sort()).toEqual(['Kc', 'Qs']);
    expect(d.dealer.high).toHaveLength(5);

    const lose = paiGowRoundFromCards(
      rules,
      100,
      cards('8h 8d Jc Ts 6d 4c 2s Ah Ad Kc Qs 9d 7c 5h'),
    );
    lose.act('deal');
    expect(lose.result()!.returned).toBe(0);
  });

  it('labels the joker for the felt', () => {
    expect(paiGowLabel(JOKER)).toBe('Jk');
  });

  it('deals the same hands for the same seed', () => {
    const play = () => {
      const round = paiGowEngine.begin(new Rng(11), rules, [{ spot: 'main', amount: 10 }]);
      round.act('deal');
      return round.result()!.detail;
    };
    expect(play()).toEqual(play());
  });
});
