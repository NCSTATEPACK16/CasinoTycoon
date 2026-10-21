import { describe, expect, it } from 'vitest';
import { parseCard } from '../cards';
import { blackjackEngine, Shoe, type BlackjackView } from './blackjack';
import { blackjackEdge, DEFAULT_BLACKJACK_RULES, validateBlackjackRules } from './rules';
import { strategyChart } from './strategy';

/** A shoe stacked with the given cards on top, dealt p1 d1 p2 d2 then hits. */
function stacked(labels: string[], decks = 6): Shoe {
  const shoe = new Shoe(decks, 0.75, { next: () => 0.5 });
  labels.forEach((l, i) => (shoe.cards[i] = parseCard(l)));
  return shoe;
}
const rules = DEFAULT_BLACKJACK_RULES;
const begin = (cards: string[], r = rules) =>
  blackjackEngine.begin({ next: () => 0.5 }, r, [{ spot: 'main', amount: 10 }], stacked(cards));

describe('basic strategy chart', () => {
  const chart = strategyChart(rules);
  const cell = (row: string, up: string) =>
    chart.rows.find((r) => r.label === row)!.cells[chart.ups.indexOf(up)];

  it('reproduces the textbook decisions for 6D S17 DAS', () => {
    expect(cell('16', 'T')).toBe('H');
    expect(cell('16', '6')).toBe('S');
    expect(cell('12', '2')).toBe('H');
    expect(cell('12', '4')).toBe('S');
    expect(cell('11', '6')).toBe('D');
    expect(cell('11', 'T')).toBe('D');
    expect(cell('10', 'A')).toBe('H');
    expect(cell('9', '3')).toBe('D');
    expect(cell('A,7', '2')).toBe('S');
    expect(cell('A,7', '9')).toBe('H');
    expect(cell('A,7', '6')).toBe('D');
    expect(cell('A,A', 'A')).toBe('P');
    expect(cell('8,8', 'T')).toBe('P');
    expect(cell('T,T', '6')).toBe('S');
    expect(cell('9,9', '7')).toBe('S');
    expect(cell('5,5', '9')).toBe('D');
    expect(cell('4,4', '5')).toBe('P'); // only with DAS
  });

  it('follows the rules it is generated for', () => {
    const noDas = strategyChart({ ...rules, das: false });
    expect(noDas.rows.find((r) => r.label === '4,4')!.cells[noDas.ups.indexOf('5')]).toBe('H');
    const ls = strategyChart({ ...rules, surrender: 'late' });
    expect(ls.rows.find((r) => r.label === '16')!.cells[ls.ups.indexOf('T')]).toBe('R');
    const h17 = strategyChart({ ...rules, h17: true });
    expect(h17.rows.find((r) => r.label === '11')!.cells[h17.ups.indexOf('A')]).toBe('D');
  });
});

describe('blackjack rounds', () => {
  it('pays a natural 3:2, or 6:5 under the short-pay rule', () => {
    expect(begin(['As', '9d', 'Kh', '7c']).result()).toMatchObject({ wagered: 10, returned: 25 });
    expect(
      begin(['As', '9d', 'Kh', '7c'], { ...rules, blackjackPays: '6:5' }).result(),
    ).toMatchObject({
      returned: 22,
    });
  });

  it('the dealer peeks: a dealer blackjack ends the round before the player acts', () => {
    const r = begin(['Ts', 'Ad', '9h', 'Kc']);
    expect(r.options()).toBeNull();
    expect(r.result()).toMatchObject({ wagered: 10, returned: 0 });
  });

  it('doubling puts twice the bet at risk and takes exactly one card', () => {
    const r = begin(['6s', '6d', '5h', 'Tc', 'Ts', '9c']);
    r.act('double');
    // Player 21 vs dealer 16 → draws the 9 and busts.
    expect(r.result()).toMatchObject({ wagered: 20, returned: 40 });
  });

  it('splits play two hands, and split aces take one card each', () => {
    const r = begin(['As', '7d', 'Ah', 'Tc', 'Ks', '9c']);
    expect(r.options()).toContain('split');
    r.act('split');
    // A+K = 21 (not a blackjack), A+9 = 20, vs dealer 17.
    expect(r.result()).toMatchObject({ wagered: 20, returned: 40 });
  });

  it('late surrender returns half the bet', () => {
    const r = begin(['Ts', '9d', '6h', 'Tc'], { ...rules, surrender: 'late' });
    r.act('surrender');
    expect(r.result()).toMatchObject({ wagered: 10, returned: 5 });
  });

  it('the strategy plays a stacked hand by the chart', () => {
    const r = begin(['Ts', '6d', '6h', 'Tc']);
    expect(blackjackEngine.strategy(r.view() as BlackjackView, r.options()!)).toBe('stand');
  });

  it('the shoe reshuffles only once the cut card is out', () => {
    const shoe = new Shoe(1, 0.5, { next: () => 0.3 });
    const first = shoe.shuffles;
    for (let i = 0; i < 26; i++) shoe.draw();
    shoe.prepareRound(0.5);
    expect(shoe.shuffles).toBe(first + 1);
  });
});

describe('rule-adjustment table', () => {
  it('sums the published effects', () => {
    expect(blackjackEdge(rules)).toBeCloseTo(0.004, 6);
    expect(blackjackEdge({ ...rules, h17: true })).toBeCloseTo(0.0062, 6);
    expect(blackjackEdge({ ...rules, blackjackPays: '6:5' }) - blackjackEdge(rules)).toBeCloseTo(
      0.0139,
      6,
    );
  });

  it('validation clamps and reports', () => {
    const { rules: r, issues } = validateBlackjackRules({
      decks: 3,
      penetration: 0.99,
      blackjackPays: '6:5',
    });
    expect(r.decks).toBe(6);
    expect(r.penetration).toBe(0.9);
    expect(r.blackjackPays).toBe('6:5');
    expect(issues.map((i) => i.field)).toEqual(['decks', 'penetration']);
  });

  it('player-hostile rules cost appeal', () => {
    const base = blackjackEngine.appeal(rules);
    expect(blackjackEngine.appeal({ ...rules, blackjackPays: '6:5' })).toBeLessThan(base);
    expect(blackjackEngine.appeal({ ...rules, h17: true })).toBeLessThan(base);
  });
});
