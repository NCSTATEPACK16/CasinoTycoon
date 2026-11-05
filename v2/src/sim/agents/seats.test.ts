import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { Anim } from '../../shared/contracts';
import { CasinoWorld } from '../world';
import { approachPose, artSeats, dealerPose, dealerSpot, fitSeats, playsStanding } from './seats';

afterEach(() => eventBus.clear());

const near = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;

describe('art seat poses', () => {
  it('turns the markers with the table', () => {
    // Blackjack's middle stool is at (1.0, 1.7) facing -z; a quarter turn
    // clockwise puts it on the west side facing +x.
    expect(artSeats('blackjack-table', 10, 20, 0)[2]).toEqual({ x: 11, z: 21.7, heading: Math.PI });
    const turned = artSeats('blackjack-table', 10, 20, 1)[2]!;
    expect(turned.x).toBeCloseTo(10.3);
    expect(turned.z).toBeCloseTo(21);
    expect(turned.heading).toBeCloseTo(Math.PI / 2);
    expect(artSeats('plant', 0, 0, 0)).toEqual([]);
  });

  it('gives each stand cell its own stool in reach, in seat order', () => {
    const stools = artSeats('blackjack-table', 0, 0, 0);
    // The world's one-per-side blackjack seats: west, north, east, south.
    const cells = [
      { col: -1, row: 0 },
      { col: 0, row: -1 },
      { col: 2, row: 1 },
      { col: 1, row: 2 },
    ];
    const fit = fitSeats(stools, cells);
    expect(near(fit[0]!, stools[0]!)).toBe(true);
    // The north cell is on the dealer's side: no stool in reach, so it keeps the nudge.
    expect(fit[1]).toBeNull();
    expect(near(fit[2]!, stools[4]!)).toBe(true);
    expect(near(fit[3]!, stools[2]!)).toBe(true);
    // A later seat never takes an earlier seat's stool.
    expect(fitSeats(stools, [cells[3]!, cells[3]!]).map((p) => p && stools.indexOf(p))).toEqual([
      2, 3,
    ]);
  });

  it('never parks a guest more than a step from the cell it walked to', () => {
    for (const defId of ['blackjack-table', 'craps-table', 'roulette-table', 'bar', 'slot-machine'])
      for (const rot of [0, 1, 2, 3] as const) {
        const stools = artSeats(defId, 7, 9, rot);
        for (let c = 4; c < 12; c++)
          for (let r = 6; r < 14; r++) {
            const p = fitSeats(stools, [{ col: c, row: r }])[0];
            if (p) expect(Math.hypot(c + 0.5 - p.x, r + 0.5 - p.z)).toBeLessThan(1.05);
          }
      }
  });

  it('puts the dealer behind the edge opposite the stools, facing them', () => {
    expect(dealerPose('blackjack-table', 10, 20, 0)).toEqual({ x: 11, z: 19.7, heading: 0 });
    const turned = dealerPose('blackjack-table', 10, 20, 1)!;
    expect(turned.x).toBeCloseTo(12.3);
    expect(turned.heading).toBeCloseTo(-Math.PI / 2);
    // Craps players ring three sides; the dealer takes the fourth.
    expect(dealerPose('craps-table', 0, 0, 0)!.z).toBeLessThan(0);
    // Nothing deals at a slot or a bar.
    expect(dealerPose('slot-machine', 0, 0, 0)).toBeNull();
    expect(dealerPose('bar', 0, 0, 0)).toBeNull();
  });
});

describe('dealers and players in the world', () => {
  it('seats guests on the stools of the cells the world already gives them', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const po = world.place('blackjack-table', 10, 10)!;
    const stools = artSeats('blackjack-table', 10, 10, 0);
    const poses = [0, 1, 2, 3].map((i) => {
      const res = world.reserveMachine(`g-${i}`, 500)!;
      return approachPose(world, res.stand, po.id)!;
    });
    expect(poses.filter((p) => stools.some((s) => near(s, p)))).toHaveLength(3);
    expect(new Set(poses.map((p) => `${p.x},${p.z}`)).size).toBe(4);
  });

  it('a dealer stands at the dealer edge, idle at an empty table, dealing once a player sits', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    const po = world.place('blackjack-table', 10, 10)!;
    const spot = dealerSpot(world, po.id)!;
    expect(spot.pose).toEqual({ x: 11, z: 9.7, heading: 0 });
    // Not the north seat's cell: the dealer never takes a guest's chair.
    expect(spot.cell).toEqual({ col: 11, row: 9 });
    const dealer = world.hireStaff('dealer');
    for (let i = 0; i < 600 && dealer.state !== 'stationed'; i++) world.tick();
    expect(dealer.state).toBe('stationed');
    expect(dealer.assignedTableId).toBe(po.id);
    // Test worlds walk in grid mode, which ignores park poses: check the cell.
    expect(dealer.pos).toEqual(spot.cell);
    world.tick();
    expect(dealer.anim).toBe(Anim.Idle);

    const guest = world.spawnGuest();
    guest.wallet = 1000;
    for (let i = 0; i < 3000 && guest.state !== 'play'; i++) world.tick();
    expect(guest.state).toBe('play');
    world.tick();
    expect(dealer.anim).toBe(Anim.Play);
  });

  it('craps players stand at the rail instead of sitting on air', () => {
    expect(playsStanding('craps-table')).toBe(true);
    expect(playsStanding('blackjack-table')).toBe(false);
    expect(playsStanding(null)).toBe(false);
    const world = new CasinoWorld({ seed: 9, autoSpawn: false });
    world.place('craps-table', 10, 10);
    world.hireStaff('dealer');
    const guest = world.spawnGuest();
    guest.wallet = 1000;
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      world.tick();
      if (guest.state === 'play') seen.add(guest.anim);
    }
    expect(seen.has(Anim.StandPlay)).toBe(true);
    expect(seen.has(Anim.Sit)).toBe(false);
    expect(seen.has(Anim.Play)).toBe(false);
  });
});
