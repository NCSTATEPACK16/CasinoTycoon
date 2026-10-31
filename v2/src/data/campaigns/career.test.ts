// B8: the career. The structure (order, unlocks, medals, lots) is checked
// directly; each new scenario's goals are checked the way the P16 campaigns
// are, by playing them: the career bot wins most runs with a reasonable plan,
// and building once and walking away never wins, both on the grid walker and
// on the real Recast crowd. The three P16 campaigns keep their own guards
// (campaigns.test.ts, difficulty.test.ts, crowd.campaigns.test.ts).

import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { OBJECT_CATALOG } from '../objects';
import {
  CAREER_PLANS,
  careerWorld,
  runCareer,
  type CareerStrategy,
} from '../../sim/__testkit__/career';
import { TOURNAMENT_SEEDS } from '../../sim/__testkit__/strategies';
import { CasinoWorld } from '../../sim/world';
import { medalDays } from '../score';
import { CAMPAIGNS, CAREER, CAREER_SCENARIOS, SCENARIOS, goalsOf, type CampaignDef } from './index';

afterEach(() => eventBus.clear());

/** The same bar as the P16 campaigns: a straightforward build-out wins a
 *  typical run, not one privileged seed. */
const MIN_WINS = 4;

/** Objects open from the first scenario: everything no scenario unlocks. */
const unlockedBy = new Map<string, string>();
for (const def of CAREER) for (const id of def.unlocks ?? []) unlockedBy.set(id, def.id);

/** What the player can build when `def` opens: the base set, what every
 *  earlier scenario unlocked, and whatever the scenario names itself. */
function openAt(def: CampaignDef): Set<string> {
  const idx = CAREER.indexOf(def);
  const open = new Set(OBJECT_CATALOG.map((o) => o.id).filter((id) => !unlockedBy.has(id)));
  for (const earlier of CAREER.slice(0, idx)) for (const id of earlier.unlocks ?? []) open.add(id);
  for (const id of def.allowedObjects ?? []) open.add(id);
  return open;
}

describe('the career (B8)', () => {
  it('runs 8–12 scenarios, the P16 campaigns among them, then Sandbox', () => {
    expect(CAREER.length).toBeGreaterThanOrEqual(8);
    expect(CAREER.length).toBeLessThanOrEqual(12);
    for (const c of CAMPAIGNS) expect(CAREER).toContain(c);
    expect(SCENARIOS.at(-1)!.sandbox).toBe(true);
    expect(new Set(CAREER.map((c) => c.id)).size).toBe(CAREER.length);
  });

  it('opens one scenario at a time: each needs the one before it', () => {
    expect(CAREER[0]!.unlockAfter).toBeUndefined();
    for (let i = 1; i < CAREER.length; i++) expect(CAREER[i]!.unlockAfter).toBe(CAREER[i - 1]!.id);
  });

  it('varies the goals, the lots and the shells', () => {
    const kinds = new Set(CAREER.flatMap((d) => goalsOf(d).map((g) => g.kind)));
    for (const k of [
      'avgProfit',
      'dayProfit',
      'rating',
      'guests',
      'hold',
      'patrons',
      'highLimit',
      'noDebt',
    ])
      expect(kinds).toContain(k);
    const lots = new Set(CAREER.map((d) => `${d.lot?.cols ?? 40}×${d.lot?.rows ?? 30}`));
    expect(lots.size).toBeGreaterThanOrEqual(4);
    // Each new scenario opens on its own walled shell (restrooms and food court
    // where it has them), not the plain hall a lot without a layout falls back to.
    for (const def of CAREER_SCENARIOS) {
      const world = new CasinoWorld({ seed: 1, starterFloor: true, autoSpawn: false });
      world.startScenario(def);
      const zones = new Set<string>();
      for (let r = 0; r < world.floor.rows; r++)
        for (let c = 0; c < world.floor.cols; c++) zones.add(world.floor.zoneAt(c, r));
      expect(zones, def.id).toContain('restrooms');
      expect(zones, def.id).toContain('foodCourt');
    }
  });

  it('gives every medal a day inside the limit, gold before silver', () => {
    for (const def of CAREER) {
      const d = medalDays(def);
      expect(d.gold, def.id).toBeLessThan(d.silver);
      expect(d.silver, def.id).toBeLessThanOrEqual(def.dayLimit);
    }
  });

  it('unlocks each object at most once, and every plan uses only what is open', () => {
    const seen = new Set<string>();
    for (const def of CAREER)
      for (const id of def.unlocks ?? []) {
        expect(seen.has(id), id).toBe(false);
        expect(
          OBJECT_CATALOG.some((o) => o.id === id),
          id,
        ).toBe(true);
        seen.add(id);
      }
    for (const def of CAREER_SCENARIOS) {
      const plan = CAREER_PLANS[def.id]!;
      const open = openAt(def);
      for (const id of [...plan.ladder, ...(plan.highLimit?.games ?? [])])
        expect(open.has(id), `${def.id} uses ${id}`).toBe(true);
    }
    // The P16 bots buy blackjack and slots (High Roller: blackjack only).
    for (const def of CAMPAIGNS) {
      expect(openAt(def).has('blackjack-table')).toBe(true);
      expect(openAt(def).has('slot-machine')).toBe(true);
    }
  });
});

async function wins(def: CampaignDef, strategy: CareerStrategy, crowd: boolean): Promise<string> {
  const out: string[] = [];
  for (const seed of TOURNAMENT_SEEDS) {
    eventBus.clear();
    const world = await careerWorld(def, seed, crowd);
    const r = runCareer(def, world, strategy, CAREER_PLANS[def.id]!);
    out.push(r.outcome === 'won' ? `W${r.day}` : '-');
  }
  return out.join(' ');
}
const count = (s: string) => s.split(' ').filter((x) => x.startsWith('W')).length;

for (const crowd of [false, true]) {
  describe(`career scenarios on the ${crowd ? 'crowd' : 'grid'} (B8)`, () => {
    for (const def of CAREER_SCENARIOS) {
      it(`${def.name}: a reasonable plan wins most runs`, { timeout: 600_000 }, async () => {
        const runs = await wins(def, 'active', crowd);
        console.log(`${def.name} ${crowd ? 'crowd' : 'grid'} active: ${runs}`);
        expect(count(runs)).toBeGreaterThanOrEqual(MIN_WINS);
      });
      it(
        `${def.name}: building once and walking away never wins`,
        { timeout: 600_000 },
        async () => {
          expect(count(await wins(def, 'minimal', crowd))).toBe(0);
        },
      );
    }
  });
}
