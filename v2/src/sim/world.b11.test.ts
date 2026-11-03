// B11: staff with depth, wired into the world. Skill and pay at hire, shifts
// on the clock, training, the wage lever, mis-pays, and the pit against
// advantage players.

import { afterEach, describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR } from '../config';
import { eventBus } from '../EventBus';
import { ADVANTAGE_BALANCE, STAFF_BALANCE, STAFF_DEPTH } from '../data/balance';
import { CAMPAIGNS, SANDBOX } from '../data/campaigns';
import { HOUSE_SOURCES } from './economy';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

function sandbox(seed = 4): CasinoWorld {
  const world = new CasinoWorld({ seed, autoSpawn: false });
  world.startScenario(SANDBOX);
  return world;
}

/** Run to the top of a game hour (same day or the next). */
function runTo(world: CasinoWorld, hour: number): void {
  do world.tick();
  while (world.time.hour !== hour || world.time.tickInHour !== 0);
}

const wagesToday = (world: CasinoWorld) =>
  world.ledger.sources.get(HOUSE_SOURCES.wages.id)?.upkeep ?? 0;

describe('hiring', () => {
  it('a new hire starts at skill 30–50, seeded', () => {
    const skills = (seed: number) => {
      const world = sandbox(seed);
      return Array.from({ length: 20 }, () => world.hireStaff('dealer').skill);
    };
    const a = skills(7);
    expect(a).toEqual(skills(7));
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(STAFF_DEPTH.hireSkill.min);
      expect(s).toBeLessThanOrEqual(STAFF_DEPTH.hireSkill.max);
    }
    expect(new Set(a).size).toBeGreaterThan(5);
  });

  it('spreads hires to the busiest uncovered shift first', () => {
    const world = sandbox();
    const shifts = Array.from({ length: 4 }, () => world.hireStaff('janitor').shift);
    expect(shifts).toEqual(['swing', 'day', 'graveyard', 'swing']);
  });
});

describe('shifts', () => {
  it('in Sandbox only the shift on the clock works, and only it is paid', () => {
    const world = sandbox();
    expect(world.time.hour).toBe(12); // the day shift's hours
    const swing = world.hireStaff('janitor');
    const day = world.hireStaff('janitor');
    const night = world.hireStaff('janitor');
    expect([swing.state, day.state, night.state]).toEqual(['off', 'idle', 'off']);
    runTo(world, 13);
    expect(wagesToday(world)).toBe(STAFF_BALANCE.janitor.wagePerHour);
    runTo(world, 17);
    expect(swing.state).not.toBe('off');
    expect(day.state).toBe('off');
    expect(day.fatigue).toBe(0); // reset off shift
    runTo(world, 1);
    expect(night.state).not.toBe('off');
    expect(swing.state).toBe('off');
  });

  it('setShift moves a member on or off the floor at once', () => {
    const world = sandbox();
    world.hireStaff('janitor');
    const m = world.hireStaff('janitor');
    expect(m.shift).toBe('day');
    expect(world.setStaffShift(m.id, 'graveyard')).toBe(true);
    expect(m.state).toBe('off');
    world.setStaffShift(m.id, 'day');
    expect(m.state).toBe('idle');
  });

  it('the P16 campaigns and a world with no scenario keep staff on every hour', () => {
    for (const def of [...CAMPAIGNS, null]) {
      const world = new CasinoWorld({ seed: 2, autoSpawn: false });
      if (def) world.startScenario(def);
      const ms = [world.hireStaff('janitor'), world.hireStaff('janitor')];
      for (let i = 0; i < 24 * TICKS_PER_HOUR; i++) world.tick();
      for (const m of ms) {
        expect(m.state).not.toBe('off');
        expect(m.fatigue).toBe(0);
        expect(m.morale).toBeCloseTo(70, 6);
      }
    }
  });
});

describe('fatigue, morale and quits on the floor', () => {
  it('a shift tires its staff, and half pay sours them until some quit', () => {
    const world = sandbox(9);
    const ms = Array.from({ length: 9 }, () => world.hireStaff('janitor'));
    runTo(world, 15);
    const day = ms.filter((m) => m.shift === 'day');
    for (const m of day) expect(m.fatigue).toBe(3 * STAFF_DEPTH.fatiguePerHour);
    expect(world.setWage('janitor', 0)).toBe(STAFF_BALANCE.janitor.wagePerHour / 2);
    for (let i = 0; i < 8 * 24 * TICKS_PER_HOUR; i++) world.tick();
    expect(world.staff.size).toBeLessThan(9);
    for (const m of world.staff.values()) expect(m.morale).toBeLessThan(STAFF_DEPTH.lowMorale);
  });

  it('the wage lever clamps to half and double the market wage', () => {
    const world = sandbox();
    expect(world.setWage('dealer', 100)).toBe(2 * STAFF_BALANCE.dealer.wagePerHour);
    expect(world.wageFor('dealer')).toBe(2 * STAFF_BALANCE.dealer.wagePerHour);
    expect(world.setWage('dealer', STAFF_BALANCE.dealer.wagePerHour)).toBe(
      STAFF_BALANCE.dealer.wagePerHour,
    );
    expect(world.wageLevels.size).toBe(0);
    expect(world.setWage('nope' as never, 3)).toBeNull();
  });
});

describe('training', () => {
  it('costs money, adds skill, and takes the member away for a few hours', () => {
    // No scenario, so no shift ends while they train.
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    const m = world.hireStaff('janitor');
    const cash = world.state.cash;
    const skill = m.skill;
    expect(world.trainStaff(m.id)).toBe(true);
    expect(world.state.cash).toBe(cash - STAFF_DEPTH.train.cost);
    expect(m.skill).toBe(skill + STAFF_DEPTH.train.skill);
    expect(m.state).toBe('off');
    expect(world.trainStaff(m.id)).toBe(false); // already away
    runTo(world, 12 + STAFF_DEPTH.train.hours - 1);
    expect(m.state).toBe('off');
    runTo(world, 12 + STAFF_DEPTH.train.hours);
    expect(m.state).toBe('idle');
    expect(m.awayFor).toBeNull();
  });

  it('skill and training survive a save', () => {
    const world = sandbox();
    world.hireStaff('janitor');
    const m = world.hireStaff('janitor');
    world.trainStaff(m.id);
    world.setWage('janitor', 3);
    const copy = CasinoWorld.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    const c = copy.staff.get(m.id)!;
    expect([c.skill, c.shift, c.awayFor, c.awayHours, c.state]).toEqual([
      m.skill,
      m.shift,
      'training',
      STAFF_DEPTH.train.hours,
      'off',
    ]);
    expect(copy.wageFor('janitor')).toBe(3);
  });
});

describe('dealers', () => {
  it('deal faster with skill, and log their mis-pays', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.state.cash = 100_000;
    const t = world.place('blackjack-table', 6, 6)!;
    const d = world.hireStaff('dealer');
    for (let i = 0; i < 200 && d.state !== 'stationed'; i++) world.tick();
    expect(d.assignedTableId).toBe(t.id);
    // No scenario here, so no staff depth: skill changes nothing.
    d.skill = 0;
    expect(world.dealerSpeedFor(t.id)).toBe(1);
    // As in a scenario with staff depth:
    d.depth = true;
    expect(world.dealerSpeedFor(t.id)).toBeCloseTo(STAFF_DEPTH.dealerSpeed.at0, 12);
    d.skill = 100;
    expect(world.dealerSpeedFor(t.id)).toBeCloseTo(STAFF_DEPTH.dealerSpeed.at100, 12);
    d.morale = 10;
    expect(world.dealerSpeedFor(t.id)).toBeCloseTo(
      STAFF_DEPTH.dealerSpeed.at100 * STAFF_DEPTH.lowMoraleSlowdown,
      12,
    );
    d.skill = 0;
    const g = world.spawnGuest();
    let rounds = 0;
    for (let i = 0; i < 12000; i++) rounds += world.playMachine(t.id, g.id)?.rounds ?? 0;
    // 0.1% of rounds at skill 0, within 4σ.
    const p = STAFF_DEPTH.misPay.at0;
    expect(Math.abs(d.misPays - p * rounds)).toBeLessThan(4 * Math.sqrt(p * rounds));
    expect(d.misPaid).toBeGreaterThan(0);
  });
});

describe('without staff depth (P16)', () => {
  it('skill, morale and mis-pays change nothing', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(CAMPAIGNS[1]!);
    world.state.cash = 100_000;
    const t = world.place('blackjack-table', 6, 6)!;
    const d = world.hireStaff('dealer');
    expect(d.depth).toBe(false);
    for (let i = 0; i < 200 && d.state !== 'stationed'; i++) world.tick();
    d.skill = 0;
    d.morale = 5;
    expect(world.dealerSpeedFor(t.id)).toBe(1);
    const g = world.spawnGuest();
    for (let i = 0; i < 3000; i++) world.playMachine(t.id, g.id);
    expect(d.misPays).toBe(0);
    const m = world.hireStaff('mechanic');
    m.skill = 0;
    expect(m.workDurationTicks).toBe(STAFF_BALANCE.mechanic.repairTicks);
  });
});

describe('janitors', () => {
  it('a skilled janitor sweeps the messes around the one they were sent to', () => {
    const swept = (skill: number) => {
      const world = new CasinoWorld({ seed: 1, autoSpawn: false });
      for (const [c, r] of [
        [10, 10],
        [11, 10],
        [12, 12],
        [16, 16],
      ])
        world.dropMess(c!, r!, 'trash');
      const j = world.hireStaff('janitor');
      j.depth = true;
      j.skill = skill;
      for (let i = 0; i < 400 && world.messes.size === 4; i++) world.tick();
      return 4 - world.messes.size;
    };
    expect(swept(0)).toBe(1);
    expect(swept(100)).toBe(3); // the two within 3 tiles, not the far one
  });
});

describe('advantage players and the pit', () => {
  it('arrive at about 1.5% in Sandbox, never in the P16 campaigns or the tutorial', () => {
    const world = sandbox(11);
    const n = 4000;
    let adv = 0;
    for (let i = 0; i < n; i++) if (world.spawnGuest().advantage) adv++;
    const p = ADVANTAGE_BALANCE.share;
    expect(Math.abs(adv / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    const p16 = new CasinoWorld({ seed: 11, autoSpawn: false });
    p16.startScenario(CAMPAIGNS[0]!);
    for (let i = 0; i < 2000; i++) expect(p16.spawnGuest().advantage).toBeNull();
  });

  /**
   * One game day on a blackjack pit where one guest in three counts cards.
   * Unstaffed, they play all day and hold falls well under theo; with a pit
   * boss and a skilled guard on every shift they're spotted and walked out.
   * The gap is measured exactly (`advantageTaken`: theo plus the counter's
   * 0.75% on each of their plays), so one day separates the two without
   * needing the cards to cooperate.
   */
  function pitDay(staffed: boolean) {
    const world = new CasinoWorld({ seed: 21, autoSpawn: true });
    world.startScenario(SANDBOX);
    // Near the door (95, 32), so a shift change isn't a two-hour walk.
    const tables = [78, 82, 86, 90].map((c) => world.place('blackjack-table', c, 26)!);
    for (let i = 0; i < 3 * tables.length; i++) world.hireStaff('dealer');
    if (staffed)
      for (let i = 0; i < 3; i++) {
        world.hireStaff('pitBoss').skill = 70;
        world.hireStaff('security').skill = 70;
      }
    let n = 0;
    eventBus.on('guestSpawned', ({ id }) => {
      // eventBus is global: the other run's world hears this too.
      const g = world.guests.get(id);
      if (g && n++ % 3 === 0) g.advantage = 'counter';
    });
    for (let i = 0; i < 24 * TICKS_PER_HOUR; i++) world.tick();
    let handle = 0;
    let theo = 0;
    for (const t of tables)
      for (const r of [
        ...world.ledger.history.flatMap((d) => d.sources),
        world.ledger.sources.get(t.id),
      ])
        if (r?.id === t.id) {
          handle += r.wagered;
          theo += r.theo;
        }
    return { handle, theoPct: theo / handle, gap: world.advantageTaken / handle };
  }

  it('an unstaffed pit loses hold to counters against theo; a staffed one keeps it', () => {
    const open = pitDay(false);
    const pit = pitDay(true);
    const why = JSON.stringify({ open, pit });
    expect(open.handle, why).toBeGreaterThan(5_000);
    expect(pit.handle, why).toBeGreaterThan(5_000);
    // Expected hold is theo minus the gap: unstaffed, a fifth of it or more
    // goes to the counters; staffed, about half as much.
    expect(open.gap, why).toBeGreaterThan(0.2 * open.theoPct);
    // Measured: 0.28 points unstaffed, 0.15 staffed (theo 1.2%). What's left
    // is what counters take in the hour or so before the boss reads them.
    expect(pit.gap, why).toBeLessThan(0.6 * open.gap);
  }, 120_000);

  it('the player can walk a flagged guest out, and only a flagged one', () => {
    const world = sandbox();
    world.place('slot-machine', 8, 8);
    const g = world.spawnGuest();
    expect(world.removeGuest(g.id)).toBe(false);
    g.suspicious = true;
    expect(world.removeGuest(g.id)).toBe(true);
    expect(g.escorted).toBe(true);
    expect(g.state === 'leaving' || g.state === 'gone').toBe(true);
  });
});
