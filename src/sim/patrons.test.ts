import { describe, expect, it } from 'vitest';
import { PATRONS, patronTierFor } from '../data/balance';
import { PatronRegistry } from './patrons';
import { Rng } from './rng';

/** A departing guest, as `recordDeparture` sees one. */
function departing(overrides: Partial<{
  id: string;
  name: string;
  patronId: string | null;
  compsReceived: number;
  theo: number;
}> = {}) {
  const theo = overrides.theo ?? PATRONS.cardThresholdTheo;
  return {
    id: overrides.id ?? 'g-1',
    name: overrides.name ?? 'Rita Calloway',
    archetype: 'regular' as const,
    patronId: overrides.patronId ?? null,
    compsReceived: overrides.compsReceived ?? 0,
    theo: () => theo,
  };
}

describe('patron tiers', () => {
  it('climb geometrically, on theo rather than visits', () => {
    expect(patronTierFor(0).id).toBe('silver');
    expect(patronTierFor(PATRONS.tiers[1]!.theo - 1).id).toBe('silver');
    expect(patronTierFor(PATRONS.tiers[1]!.theo).id).toBe('gold');
    expect(patronTierFor(PATRONS.tiers[2]!.theo).id).toBe('black');
    // The ratios are the researched part — real ladders step ~2.5-10x. A flat
    // or arithmetic ladder would make the top tier unremarkable.
    const [, gold, black] = PATRONS.tiers;
    expect(black!.theo / gold!.theo).toBeGreaterThanOrEqual(2.5);
  });

  it('gate a benefit that grows with the rung', () => {
    // Cosmetic tiers are the documented failure mode: every rung has to be
    // worth reaching for something other than its colour.
    for (let i = 1; i < PATRONS.tiers.length; i++) {
      expect(PATRONS.tiers[i]!.returnBonus).toBeGreaterThan(PATRONS.tiers[i - 1]!.returnBonus);
      expect(PATRONS.tiers[i]!.compRate).toBeGreaterThan(PATRONS.tiers[i - 1]!.compRate);
    }
  });
});

describe('carding', () => {
  it('ignores a guest who did not play enough to be worth tracking', () => {
    const reg = new PatronRegistry();
    const out = reg.recordDeparture(departing({ theo: PATRONS.cardThresholdTheo - 1 }), 3);
    expect(out.carded).toBe(false);
    expect(out.patron).toBeNull();
    expect(reg.size).toBe(0);
  });

  it('cards a guest whose theo clears the threshold, keeping the name on screen', () => {
    const reg = new PatronRegistry();
    const out = reg.recordDeparture(departing({ theo: 90, name: 'Duke Farrow' }), 3);
    expect(out.carded).toBe(true);
    expect(out.patron!.name).toBe('Duke Farrow');
    expect(out.patron!.lifetimeTheo).toBe(90);
    expect(out.patron!.visits).toBe(1);
    expect(out.patron!.lastSeenDay).toBe(3);
  });

  it('never seats two patrons under one name', () => {
    const reg = new PatronRegistry();
    const first = reg.recordDeparture(departing({ id: 'g-1', name: 'Duke Farrow', theo: 90 }), 1);
    const second = reg.recordDeparture(departing({ id: 'g-2', name: 'Duke Farrow', theo: 90 }), 1);
    expect(second.patron!.name).not.toBe(first.patron!.name);
    expect(reg.size).toBe(2);
  });
});

describe('lifetime accumulation', () => {
  it('adds each visit to the record and promotes on the crossing', () => {
    const reg = new PatronRegistry();
    const patron = reg.recordDeparture(departing({ theo: 100 }), 1).patron!;
    expect(patron.tier.id).toBe('silver');

    const second = reg.recordDeparture(
      { ...departing({ theo: PATRONS.tiers[1]!.theo }), patronId: patron.id },
      2,
    );
    expect(second.carded).toBe(false);
    expect(second.promotedTo!.id).toBe('gold');
    expect(patron.lifetimeTheo).toBe(100 + PATRONS.tiers[1]!.theo);
    expect(patron.visits).toBe(2);
  });

  it('reports no promotion on a visit that stays on the same rung', () => {
    const reg = new PatronRegistry();
    const patron = reg.recordDeparture(departing({ theo: 100 }), 1).patron!;
    const again = reg.recordDeparture({ ...departing({ theo: 10 }), patronId: patron.id }, 2);
    expect(again.promotedTo).toBeNull();
  });
});

describe('the host obligation', () => {
  const toBlack = (reg: PatronRegistry) => {
    const patron = reg.recordDeparture(departing({ theo: PATRONS.tiers[2]!.theo }), 1).patron!;
    expect(patron.tier.wantsHost).toBe(true);
    return patron;
  };

  it('flags a host-wanting patron who left with nothing comped', () => {
    const reg = new PatronRegistry();
    const patron = toBlack(reg);
    const out = reg.recordDeparture({ ...departing({ theo: 10 }), patronId: patron.id }, 2);
    expect(out.neglected).toBe(true);
    expect(patron.returnChance).toBeLessThan(
      PATRONS.returnBaseChancePerDay + patron.tier.returnBonus,
    );
  });

  it('clears the flag the moment they are comped', () => {
    const reg = new PatronRegistry();
    const patron = toBlack(reg);
    reg.recordDeparture({ ...departing({ theo: 10 }), patronId: patron.id }, 2);
    reg.onComped(patron.id);
    expect(patron.neglected).toBe(false);
  });

  it('never flags a tier that does not ask for a host', () => {
    const reg = new PatronRegistry();
    const patron = reg.recordDeparture(departing({ theo: 90 }), 1).patron!;
    const out = reg.recordDeparture({ ...departing({ theo: 10 }), patronId: patron.id }, 2);
    expect(out.neglected).toBe(false);
  });
});

describe('the daily draw', () => {
  const seed = (count: number, theo = 90) => {
    const reg = new PatronRegistry();
    for (let i = 0; i < count; i++) {
      reg.recordDeparture(departing({ id: `g-${i}`, name: `Guest ${i}`, theo }), 0);
    }
    return reg;
  };

  it('is idempotent for a day, so a reload never doubles the arrivals', () => {
    const reg = seed(40);
    const first = reg.drawForDay(1, new Rng(7)).map((p) => p.id);
    const again = reg.drawForDay(1, new Rng(99)).map((p) => p.id);
    expect(again).toEqual(first);
  });

  it('never exceeds the daily cap, however large the roster grows', () => {
    const reg = seed(PATRONS.rosterCap);
    expect(reg.drawForDay(1, new Rng(3)).length).toBeLessThanOrEqual(PATRONS.maxReturnsPerDay);
  });

  it('gives the scarce slots to the patrons worth the most', () => {
    // Every patron here would otherwise roll on equal footing; the ranking is
    // what decides who the player actually sees again.
    const reg = new PatronRegistry();
    for (let i = 0; i < 60; i++) {
      reg.recordDeparture(departing({ id: `g-${i}`, name: `Guest ${i}`, theo: 60 + i * 40 }), 0);
    }
    const due = reg.drawForDay(1, new Rng(11));
    const ranked = reg.all().slice(0, PATRONS.maxReturnsPerDay * 4);
    for (const patron of due) expect(ranked).toContain(patron);
  });

  it('hands each drawn patron to exactly one arrival, then goes quiet', () => {
    const reg = seed(40);
    const due = reg.drawForDay(1, new Rng(7));
    const taken = [];
    for (let i = 0; i < due.length + 3; i++) {
      const patron = reg.takeDue();
      if (patron) taken.push(patron);
    }
    expect(taken).toEqual(due);
    expect(reg.takeDue()).toBeNull();
  });
});

describe('bounds', () => {
  it('prunes patrons past the absence window and keeps the rest', () => {
    const reg = new PatronRegistry();
    const stale = reg.recordDeparture(departing({ id: 'g-1', name: 'A A', theo: 90 }), 1).patron!;
    const fresh = reg.recordDeparture(departing({ id: 'g-2', name: 'B B', theo: 90 }), 5).patron!;
    const dropped = reg.prune(1 + PATRONS.pruneAfterDaysAbsent + 1);
    expect(dropped).toEqual([stale]);
    expect(reg.all()).toEqual([fresh]);
  });

  it('holds the roster at its cap, evicting from the bottom', () => {
    const reg = new PatronRegistry();
    for (let i = 0; i < PATRONS.rosterCap + 25; i++) {
      reg.recordDeparture(departing({ id: `g-${i}`, name: `Guest ${i}`, theo: 60 + i }), 0);
    }
    expect(reg.size).toBe(PATRONS.rosterCap);
    // The cheapest patrons went, not the newest — the player is least likely
    // to have formed a relationship with the ones who barely cleared the bar.
    expect(Math.min(...reg.all().map((p) => p.lifetimeTheo))).toBeGreaterThan(60);
  });

  it('stays inside its save budget at the cap', () => {
    const reg = new PatronRegistry();
    for (let i = 0; i < PATRONS.rosterCap; i++) {
      reg.recordDeparture(
        departing({ id: `g-${i}`, name: `Marchesa Vandermeer ${i}`, theo: 5000 + i }),
        900,
      );
    }
    reg.drawForDay(901, new Rng(1));
    // The acceptance bar the design signed up to: a bounded roster, not a
    // growing one. 25KB is the ceiling; blowing it means the bound is fiction.
    const bytes = JSON.stringify(reg.toJSON()).length;
    expect(bytes).toBeLessThan(25_000);
  });
});

describe('serialization', () => {
  it('round-trips the roster, the day\'s draw, and the id counter', () => {
    const reg = new PatronRegistry();
    const patron = reg.recordDeparture(departing({ theo: 500 }), 4).patron!;
    reg.recordDeparture({ ...departing({ theo: 10 }), patronId: patron.id }, 4);
    reg.drawForDay(5, new Rng(2));
    const back = PatronRegistry.fromJSON(JSON.parse(JSON.stringify(reg.toJSON())));
    expect(back.toJSON()).toEqual(reg.toJSON());
    expect(back.get(patron.id)!.tier.id).toBe(patron.tier.id);
  });

  it('never reuses an id from the file', () => {
    const reg = PatronRegistry.fromJSON({
      patrons: [
        {
          id: 'p-9',
          name: 'Rita Calloway',
          archetype: 'regular',
          lifetimeTheo: 90,
          visits: 1,
          lastSeenDay: 1,
          neglected: false,
        },
      ],
      // A counter that lost track — an id collision here would merge two
      // people into one record on the next carding.
      dueToday: [],
      drawnForDay: 0,
      nextPatronNum: 1,
    });
    const fresh = reg.recordDeparture(departing({ theo: 90 }), 2).patron!;
    expect(fresh.id).not.toBe('p-9');
  });

  it('survives a truncated or hand-edited file', () => {
    const reg = PatronRegistry.fromJSON({
      patrons: [{ id: 'p-1' }, null, { name: 'no id' }],
      dueToday: ['p-1', 'p-404'],
    } as never);
    expect(reg.size).toBe(1);
    expect(reg.pendingArrivals).toBe(1);
    expect(PatronRegistry.fromJSON(null).size).toBe(0);
  });
});
