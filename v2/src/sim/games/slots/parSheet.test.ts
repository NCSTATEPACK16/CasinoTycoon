import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import { parStats } from './parSheet';
import { PAR_SHEETS } from './sheets';
import { slotBet, slotsEngine } from './slots';

const sheets = Object.values(PAR_SHEETS);

describe('par sheets', () => {
  it('ships at least four sheets spanning 88–97% and every volatility', () => {
    expect(sheets.length).toBeGreaterThanOrEqual(4);
    const rtps = sheets.map((s) => s.rtp);
    expect(Math.min(...rtps)).toBeLessThan(0.89);
    expect(Math.max(...rtps)).toBeGreaterThan(0.965);
    expect(new Set(sheets.map((s) => s.volatility))).toEqual(new Set(['low', 'medium', 'high']));
  });

  it.each(sheets.map((s) => [s.id, s] as const))(
    '%s: filed RTP equals the enumerated RTP to 1e-9',
    (_id, sheet) => {
      const stats = parStats(sheet);
      expect(Math.abs(stats.rtp - sheet.rtp)).toBeLessThan(1e-9);
      expect(stats.hitFrequency).toBeGreaterThan(0.1);
      expect(stats.hitFrequency).toBeLessThan(0.6);
    },
    60_000,
  );

  it('the high-volatility sheet swings harder than every low one', () => {
    const sd = (id: string) => parStats(PAR_SHEETS[id]!).sd;
    const high = sheets.filter((s) => s.volatility === 'high').map((s) => sd(s.id));
    const low = sheets.filter((s) => s.volatility === 'low').map((s) => sd(s.id));
    expect(Math.min(...high)).toBeGreaterThan(Math.max(...low));
  }, 60_000);

  it('spins return the enumerated mean', () => {
    const rules = slotsEngine.defaultRules();
    const rng = new Rng(8);
    let wagered = 0;
    let returned = 0;
    for (let i = 0; i < 300_000; i++) {
      const r = slotsEngine.begin(rng, rules, []);
      r.act('spin');
      wagered += r.result()!.wagered;
      returned += r.result()!.returned;
    }
    const sd = parStats(PAR_SHEETS[rules.sheet]!).sd;
    // 4σ band on the mean of 300k spins.
    expect(Math.abs(returned / wagered - PAR_SHEETS[rules.sheet]!.rtp)).toBeLessThan(
      (4 * sd) / Math.sqrt(300_000),
    );
  }, 60_000);

  it('the bet is denomination × credits, and only legal denominations pass', () => {
    const { rules, issues } = slotsEngine.validateRules({
      denomination: 0.05,
      credits: 400,
      sheet: 'nope',
    });
    expect(slotBet(rules)).toBe(0.25 * 400);
    expect(issues.map((i) => i.field)).toEqual(['sheet', 'denomination']);
    expect(
      slotsEngine.theoreticalEdge(slotsEngine.validateRules({ sheet: 'classic-sevens' }).rules),
    ).toBeCloseTo(1 - PAR_SHEETS['classic-sevens']!.rtp, 12);
  });

  it('tight sheets appeal less than loose ones', () => {
    const a = (sheet: string) => slotsEngine.appeal(slotsEngine.validateRules({ sheet }).rules);
    expect(a('penny-fortune')).toBeLessThan(a('diamond-lines'));
    expect(a('diamond-lines')).toBeLessThan(a('garden-twenty'));
  });
});
