import { describe, expect, it } from 'vitest';
import { parseCard } from '../cards';
import { Rng } from '../../rng';
import {
  ANTE_BONUS_TABLES,
  PAIR_PLUS_TABLES,
  TCP_BASE_NET,
  TCP_PAIRS,
  TcpCategory,
  categoryOf,
  dealerQualifies,
  pairPlusEdge,
  scoreHand,
  shouldPlay,
  tcpAnteEdge,
  tcpEngine,
  tcpRoundFromCards,
  THREE_CARD_COUNTS,
  type TcpRules,
} from './tcp';

const rules: TcpRules = tcpEngine.defaultRules();
const hand = (s: string) => s.split(' ').map(parseCard);

describe('three-card hand ranking', () => {
  it('orders straight flush > trips > straight > flush > pair > high card', () => {
    const order = ['9h Th Jh', 'As Ad Ac', '9h Td Jc', '2h 7h Kh', '2h 2d 7c', 'Ah Kd 9c'].map(
      (h) => scoreHand(hand(h)),
    );
    for (let i = 0; i + 1 < order.length; i++) expect(order[i]).toBeGreaterThan(order[i + 1]!);
  });

  it('A-2-3 is the lowest straight and Q-K-A the highest', () => {
    expect(categoryOf(scoreHand(hand('As 2d 3c')))).toBe(TcpCategory.Straight);
    expect(scoreHand(hand('As 2d 3c'))).toBeLessThan(scoreHand(hand('2s 3d 4c')));
    expect(scoreHand(hand('Qs Kd Ac'))).toBeGreaterThan(scoreHand(hand('Js Qd Kc')));
    // K-A-2 is not a straight.
    expect(categoryOf(scoreHand(hand('Ks Ad 2c')))).toBe(TcpCategory.HighCard);
  });

  it('counts every category exactly over the 22,100 hands', () => {
    const counts = new Array(6).fill(0);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++) counts[categoryOf(scoreHand([a, b, c]))]++;
    const n = THREE_CARD_COUNTS;
    expect(counts).toEqual([n.highCard, n.pair, n.flush, n.straight, n.trips, n.straightFlush]);
  });

  it('the dealer opens with queen-high or better', () => {
    expect(dealerQualifies(scoreHand(hand('Qs 5d 3c')))).toBe(true);
    expect(dealerQualifies(scoreHand(hand('Js Td 8c')))).toBe(false);
    expect(dealerQualifies(scoreHand(hand('2s 2d 9c')))).toBe(true);
  });

  it('reference strategy plays Q-6-4 and above, folds Q-6-3', () => {
    expect(shouldPlay(hand('Qs 6d 4c'))).toBe(true);
    expect(shouldPlay(hand('Qs 6d 3c'))).toBe(false);
    expect(shouldPlay(hand('Ks 2d 3c'))).toBe(true); // K-high beats Q-6-4
    expect(shouldPlay(hand('Js Ad 3c'))).toBe(true); // A-high
    expect(shouldPlay(hand('Js Td 3c'))).toBe(false);
    expect(shouldPlay(hand('2s 2d 3c'))).toBe(true);
  });
});

describe('three-card poker exact edges', () => {
  // Published figures: Wizard of Odds, "Three Card Poker": Pair Plus 2.32% on
  // the 40-30-6-4-1 table, 7.28% on 40-30-6-3-1; Ante/Play 3.37% of the Ante
  // (2.01% of ante plus play) with the Q-6-4 strategy and 5-4-1 bonus.
  it('Pair Plus edges match the published tables', () => {
    expect(pairPlusEdge('40-30-6-4-1')).toBeCloseTo(0.0232, 4);
    expect(pairPlusEdge('40-30-6-3-1')).toBeCloseTo(0.0728, 4);
    expect(pairPlusEdge('50-40-6-3-1')).toBeLessThan(pairPlusEdge('40-30-6-3-1'));
  });

  it('the Ante edge is 3.37% (5-4-1 bonus) and moves with the bonus table', () => {
    expect(tcpAnteEdge('5-4-1')).toBeCloseTo(0.0337, 4);
    expect(tcpAnteEdge('3-2-1')).toBeGreaterThan(tcpAnteEdge('5-4-1') + 0.008);
    expect(Object.keys(ANTE_BONUS_TABLES)).toHaveLength(2);
    expect(Object.keys(PAIR_PLUS_TABLES)).toHaveLength(3);
  });

  it('spotEdge reads each bet from the rules', () => {
    expect(tcpEngine.spotEdge(rules, 'ante')).toBeCloseTo(0.03373, 5);
    expect(tcpEngine.spotEdge({ ...rules, pairPlus: '40-30-6-3-1' }, 'pairPlus')).toBeCloseTo(
      0.0728,
      4,
    );
    expect(tcpEngine.spotEdge(rules, 'play')).toBe(0);
  });

  it('re-derives the Ante edge over every disjoint (player, dealer) pair', () => {
    // 22,100 × 18,424 = 407M pairs, ~10 s. Strategy: play Q-6-4+; the Ante
    // bonus is excluded here and added from the hand counts.
    const hands: number[][] = [];
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) hands.push([a, b, c]);
    const lo = hands.map((h) => h.reduce((m, c) => (c < 26 ? m | (1 << c) : m), 0));
    const hi = hands.map((h) => h.reduce((m, c) => (c >= 26 ? m | (1 << (c - 26)) : m), 0));
    const sc = hands.map((h) => scoreHand(h));
    const open = sc.map(dealerQualifies);
    let net = 0;
    let pairs = 0;
    for (let i = 0; i < hands.length; i++) {
      const plays = shouldPlay(hands[i]!);
      for (let j = 0; j < hands.length; j++) {
        if ((lo[i]! & lo[j]!) !== 0 || (hi[i]! & hi[j]!) !== 0) continue;
        pairs++;
        if (!plays) net -= 1;
        else if (!open[j]) net += 1;
        else if (sc[i]! > sc[j]!) net += 2;
        else if (sc[i]! < sc[j]!) net -= 2;
      }
    }
    expect(pairs).toBe(TCP_PAIRS);
    expect(net).toBe(TCP_BASE_NET);
  }, 300_000);
});

describe('three-card poker rounds', () => {
  const play = (cards: string, ante: number, pp: number, action: string) => {
    const r = tcpRoundFromCards(rules, ante, pp, hand(cards));
    expect(r.options()).toEqual(['play', 'fold']);
    r.act(action);
    expect(r.options()).toBeNull();
    return r.result()!;
  };

  it('pays Ante and Play 1:1 when the player beats a qualifying dealer', () => {
    const r = play('As Kd 9c Qs Jd 2c', 10, 0, 'play');
    expect(r.wagered).toBe(20);
    expect(r.returned).toBe(40);
  });

  it('pays the Ante only, and pushes the Play, when the dealer does not open', () => {
    const r = play('Ks Jd 4c Jh Td 8c', 10, 0, 'play');
    expect(r.returned).toBe(20 + 10);
  });

  it('pushes a tie and loses to a better dealer hand', () => {
    expect(play('As Kd 9c Ah Kh 9d', 10, 0, 'play').returned).toBe(20);
    expect(play('Qs 7d 4c Ks Kd 9c', 10, 0, 'play').returned).toBe(0);
  });

  it('pays the Ante bonus on a straight or better even when the dealer wins', () => {
    // Player straight 5-6-7 loses to a dealer straight flush, but the 1:1 bonus pays.
    const r = play('5s 6d 7c 9h Th Jh', 10, 0, 'play');
    expect(r.returned).toBe(10 * 1);
    const sf = play('9h Th Jh 2s 5d 8c', 10, 0, 'play');
    expect(sf.returned).toBe(10 * 5 + 20 + 10); // bonus, Ante win, Play pushes (8-high does not open)
  });

  it('a fold loses the Ante, and Pair Plus pays regardless', () => {
    const r = play('2s 2d 7c Ks Qd Jc', 10, 5, 'fold');
    expect(r.wagered).toBe(15);
    expect(r.returned).toBe(5 * 2); // a pair pays 1:1
    expect(play('Ks 7d 3c As Qd Jc', 10, 5, 'fold').returned).toBe(0);
  });

  it('carries the dealt cards for the effects layer', () => {
    const r = play('As Kd 9c Qs Jd 2c', 10, 0, 'play');
    expect(r.detail).toMatchObject({
      player: ['As', 'Kd', '9c'],
      dealer: ['Qs', 'Jd', '2c'],
      folded: false,
    });
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const rng = new Rng(seed);
      const out: number[] = [];
      for (let i = 0; i < 50; i++) {
        const r = tcpEngine.begin(rng, rules, tcpEngine.guestBets(rules, 10, rng));
        while (r.options()) r.act(tcpEngine.strategy(r.view(), r.options()!));
        out.push(r.result()!.returned);
      }
      return out;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});

describe('three-card poker Monte Carlo', () => {
  it('3M reference-strategy hands land on the exact Ante edge (±0.15%)', () => {
    const rng = new Rng(2024);
    let net = 0;
    const n = 3_000_000;
    for (let i = 0; i < n; i++) {
      const r = tcpEngine.begin(rng, rules, [{ spot: 'ante', amount: 1 }]);
      while (r.options()) r.act(tcpEngine.strategy(r.view(), r.options()!));
      const res = r.result()!;
      net += res.wagered - res.returned;
    }
    expect(Math.abs(net / n - tcpAnteEdge('5-4-1'))).toBeLessThan(0.0015);
  }, 300_000);
});

describe('three-card poker rules', () => {
  it('validates and clamps like the other engines', () => {
    const { rules: r, issues } = tcpEngine.validateRules({
      minBet: 50,
      maxBet: 20,
      pairPlus: 'nope',
      anteBonus: '3-2-1',
    });
    expect(r).toMatchObject({
      minBet: 50,
      maxBet: 50,
      anteBonus: '3-2-1',
      pairPlus: '40-30-6-4-1',
    });
    expect(issues.map((i) => i.field).sort()).toEqual(['maxBet', 'pairPlus']);
  });

  it('each lever moves the edge or the appeal in the tested direction', () => {
    const base = tcpEngine.theoreticalEdge(rules);
    const stingy = tcpEngine.validateRules({ anteBonus: '3-2-1' }).rules;
    expect(tcpEngine.theoreticalEdge(stingy)).toBeGreaterThan(base);
    expect(tcpEngine.appeal(stingy)).toBeLessThan(tcpEngine.appeal(rules));
    const tight = tcpEngine.validateRules({ pairPlus: '40-30-6-3-1' }).rules;
    expect(tcpEngine.spotEdge(tight, 'pairPlus')).toBeGreaterThan(
      tcpEngine.spotEdge(rules, 'pairPlus'),
    );
    expect(tcpEngine.appeal(tight)).toBeLessThan(tcpEngine.appeal(rules));
  });

  it('guest bets always include an Ante inside the limits', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 200; i++) {
      const bets = tcpEngine.guestBets(rules, 3, rng);
      expect(bets[0]!.spot).toBe('ante');
      for (const b of bets) expect(b.amount).toBeGreaterThanOrEqual(rules.minBet);
    }
  });
});
