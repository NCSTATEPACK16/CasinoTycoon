import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import { parseCard } from '../cards';
import {
  ALL_HOLDS,
  VP_CHART_FREQ,
  VP_HANDS,
  VP_OPTIMAL_RETURN,
  VP_PAYTABLES,
  chartReturn,
  handIndex,
  holdFor,
  maskOf,
  videoPokerEngine,
  videoPokerRoundFromCards,
  type VideoPokerRules,
  type VpPaytable,
} from './videopoker';

const rules: VideoPokerRules = videoPokerEngine.defaultRules();
const cards = (s: string) => s.split(' ').map(parseCard);
const TABLES = Object.keys(VP_PAYTABLES) as VpPaytable[];

describe('jacks or better hands', () => {
  it('names every hand', () => {
    const name = (s: string) => VP_HANDS[handIndex(cards(s))];
    expect(name('As Ks Qs Js Ts')).toBe('royal flush');
    expect(name('9h 8h 7h 6h 5h')).toBe('straight flush');
    expect(name('Ah 2h 3h 4h 5h')).toBe('straight flush');
    expect(name('7c 7d 7h 7s 2c')).toBe('four of a kind');
    expect(name('7c 7d 7h 2s 2c')).toBe('full house');
    expect(name('Ac 9c 7c 4c 2c')).toBe('flush');
    expect(name('Ac 2d 3h 4s 5c')).toBe('straight');
    expect(name('Tc Jd Qh Ks Ac')).toBe('straight');
    expect(name('7c 7d 7h Ks 2c')).toBe('three of a kind');
    expect(name('7c 7d Kh Ks 2c')).toBe('two pair');
    expect(name('Jc Jd 7h 5s 2c')).toBe('jacks or better');
    expect(name('Tc Td 7h 5s 2c')).toBe('nothing');
  });
});

describe('the strategy chart', () => {
  const held = (s: string) => {
    const c = cards(s);
    return holdFor(c).map((i) => s.split(' ')[i]);
  };
  it('holds by Wizard of Odds’ simple chart, first match wins', () => {
    expect(held('As Ks Qs Js 9d')).toEqual(['As', 'Ks', 'Qs', 'Js']); // 4 to a royal
    expect(held('As Ks Qs Js Td')).toEqual(['As', 'Ks', 'Qs', 'Js']); // breaks a straight for 4 to a royal
    expect(held('9c Td Jh Qs Kc')).toEqual(['9c', 'Td', 'Jh', 'Qs', 'Kc']); // made straight
    expect(held('Ts Js Qs Ks Kd')).toEqual(['Ts', 'Js', 'Qs', 'Ks']); // 4 to royal over a high pair
    expect(held('9s 8s 7s 6s 6d')).toEqual(['9s', '8s', '7s', '6s']); // 4 to a SF over a low pair
    expect(held('Jc Jd 7h 7s 2c')).toEqual(['Jc', 'Jd', '7h', '7s']); // two pair
    expect(held('Qs Js Ts 4d 4c')).toEqual(['Qs', 'Js', 'Ts']); // 3 to a royal over a low pair
    expect(held('Ah 9h 6h 2h Kc')).toEqual(['Ah', '9h', '6h', '2h']); // 4 to a flush
    expect(held('5c 5d Ah Ks 9c')).toEqual(['5c', '5d']); // low pair over two high cards
    expect(held('8c 9d Th Js 2c')).toEqual(['8c', '9d', 'Th', 'Js']); // outside straight
    expect(held('Qh Kh 4c 7d 9s')).toEqual(['Qh', 'Kh']); // suited high cards
    expect(held('Ad Kc Qh 4s 2c')).toEqual(['Kc', 'Qh']); // the lowest two high cards
    expect(held('Th Jh 2c 4d 7s')).toEqual(['Th', 'Jh']); // suited 10/J
    expect(held('Kd 2c 4h 7s 9c')).toEqual(['Kd']); // one high card
    expect(held('2c 4h 7s 9d 3c')).toEqual([]); // draw five
  });

  it('offers all 32 hold masks and names the chart’s', () => {
    expect(new Set(ALL_HOLDS).size).toBe(32);
    expect(maskOf([0, 2])).toBe('hold:10100');
    expect(ALL_HOLDS).toContain(maskOf([0, 1, 2, 3, 4]));
  });
});

describe('video poker returns', () => {
  it('the chart sits about 0.1 point under each published optimal return', () => {
    // Wizard of Odds ("Jacks or Better"): 9/6 99.54%, 8/5 97.30%, 7/5 96.15%,
    // 6/5 95.00% with optimal strategy. The simple chart gives up 0.08–0.11.
    expect(VP_CHART_FREQ.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    for (const t of TABLES) {
      const gap = VP_OPTIMAL_RETURN[t] - chartReturn(t);
      expect(gap, t).toBeGreaterThan(0.0005);
      expect(gap, t).toBeLessThan(0.0015);
    }
    expect(videoPokerEngine.theoreticalEdge(rules)).toBeCloseTo(1 - 0.96049, 4);
  });

  it('every paytable lever moves the edge and the appeal with it', () => {
    let prev = -1;
    for (const t of ['9/6', '8/5', '7/5', '6/5'] as VpPaytable[]) {
      const r = videoPokerEngine.validateRules({ paytable: t }).rules;
      const e = videoPokerEngine.theoreticalEdge(r);
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
    const nineSix = videoPokerEngine.validateRules({ paytable: '9/6' }).rules;
    expect(videoPokerEngine.appeal(nineSix)).toBeGreaterThan(videoPokerEngine.appeal(rules));
  });

  it('a 2M-hand Monte Carlo of the chart lands on the measured frequencies', () => {
    const rng = new Rng(0x1ac5);
    const freq = new Array<number>(10).fill(0);
    let returned = 0;
    const N = 2_000_000;
    for (let i = 0; i < N; i++) {
      const round = videoPokerEngine.begin(rng, rules, [{ spot: 'main', amount: 1 }]);
      round.act(videoPokerEngine.strategy(round.view(), round.options()!));
      const res = round.result()!;
      returned += res.returned;
      freq[VP_HANDS.indexOf((res.detail as { hand: (typeof VP_HANDS)[number] }).hand)]!++;
    }
    for (let k = 0; k < 10; k++) {
      const p = VP_CHART_FREQ[k]!;
      expect(Math.abs(freq[k]! / N - p), VP_HANDS[k]).toBeLessThan(
        4 * Math.sqrt((p * (1 - p)) / N),
      );
    }
    // Per-hand SD is 4.4 units (the royal), so the return's standard error at
    // 2M hands is 0.31 points: hold it to three.
    expect(Math.abs(returned / N - chartReturn('7/5'))).toBeLessThan(3 * (4.406 / Math.sqrt(N)));
  }, 120_000);
});

describe('video poker rounds', () => {
  it('holds, draws in order and pays the final hand', () => {
    // Dealt J-J-7-5-2, hold the jacks, draw J-K-4: three jacks at 3 for 1.
    const r = videoPokerRoundFromCards(rules, 5, cards('Jc Jd 7h 5s 2c Jh Ks 4d 9c 8c'));
    expect(r.options()).toHaveLength(32);
    r.act('hold:11000');
    const res = r.result()!;
    expect(res.returned).toBe(15);
    expect(res.detail).toEqual({
      dealt: ['Jc', 'Jd', '7h', '5s', '2c'],
      held: [true, true, false, false, false],
      final: ['Jc', 'Jd', 'Jh', 'Ks', '4d'],
      hand: 'three of a kind',
    });
    expect(r.options()).toBeNull();
  });

  it('deals the same hand for the same seed', () => {
    const play = () => {
      const r = videoPokerEngine.begin(new Rng(8), rules, [{ spot: 'main', amount: 5 }]);
      r.act(videoPokerEngine.strategy(r.view(), r.options()!));
      return r.result()!.detail;
    };
    expect(play()).toEqual(play());
  });
});
