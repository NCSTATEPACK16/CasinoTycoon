import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { CAMPAIGNS, SANDBOX } from '../data/campaigns';
import type { Cell } from './grid/astar';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Every cell a guest can reach on foot from the entrance. */
function reachable(world: CasinoWorld): Set<number> {
  const { grid } = world;
  const start = world.entranceTile;
  const seen = new Set<number>([start.row * grid.cols + start.col]);
  const queue: Cell[] = [start];
  while (queue.length > 0) {
    const c = queue.pop()!;
    for (const [dc, dr] of DIRS) {
      const col = c.col + dc;
      const row = c.row + dr;
      const k = row * grid.cols + col;
      if (seen.has(k) || !grid.canStep(c.col, c.row, col, row)) continue;
      seen.add(k);
      queue.push({ col, row });
    }
  }
  return seen;
}

function sandbox(): CasinoWorld {
  const world = new CasinoWorld({ seed: 3, starterFloor: true, autoSpawn: false });
  world.startScenario(SANDBOX);
  return world;
}

describe('the lot follows the scenario', () => {
  it('builds Sandbox on a 96×64 lot whose every floored cell is reachable', () => {
    const world = sandbox();
    expect([world.grid.cols, world.grid.rows]).toEqual([96, 64]);
    expect([world.floor.cols, world.floor.rows]).toEqual([96, 64]);
    expect(world.entranceTile).toEqual({ col: 95, row: 32 });
    const zones = new Set<string>();
    let floored = 0;
    for (let row = 0; row < 64; row++) {
      for (let col = 0; col < 96; col++) {
        if (!world.floor.isFloored(col, row)) continue;
        floored++;
        zones.add(world.floor.zoneAt(col, row));
      }
    }
    expect(zones).toEqual(
      new Set(['gaming', 'highLimit', 'restrooms', 'foodCourt', 'backOfHouse', 'none']),
    );
    // Every room has a door: nothing floored is sealed off.
    expect(reachable(world).size).toBe(floored);
  });

  it('keeps campaigns on the default 40×30 lot', () => {
    for (const def of CAMPAIGNS) {
      const world = new CasinoWorld({ seed: 1 });
      world.startScenario(def);
      expect([world.grid.cols, world.grid.rows, world.floor.cols, world.floor.rows]).toEqual([
        40, 30, 40, 30,
      ]);
      expect(world.entranceTile).toEqual({ col: 39, row: 15 });
    }
  });

  it('resizes back down when a campaign follows Sandbox', () => {
    const world = sandbox();
    world.place('slot-machine', 60, 30);
    world.startScenario(CAMPAIGNS[0]!);
    expect([world.grid.cols, world.grid.rows]).toEqual([40, 30]);
    expect(world.state.allObjects()).toHaveLength(0);
    world.traffic.enter(39, 29); // in bounds on the new lot, would throw on a stale field
    expect(world.mood.toJSON().sum.cols).toBe(40);
  });

  it('round-trips the lot size through a save', () => {
    const world = sandbox();
    world.place('slot-machine', 70, 40);
    for (let i = 0; i < 50; i++) world.tick();
    const json = JSON.parse(JSON.stringify(world.toJSON()));
    const loaded = CasinoWorld.fromJSON(json);
    expect([loaded.grid.cols, loaded.grid.rows]).toEqual([96, 64]);
    expect([loaded.floor.cols, loaded.floor.rows]).toEqual([96, 64]);
    expect(loaded.entranceTile).toEqual({ col: 95, row: 32 });
    expect(loaded.traffic.toJSON().cols).toBe(96);
    expect(loaded.grid.occupantAt(70, 40)).not.toBeNull();
    expect(loaded.toJSON().floor).toEqual(world.toJSON().floor);
  });
});

describe('a full Sandbox floor', () => {
  it('takes 2,000 slots and decor with every aisle still walkable', () => {
    const world = sandbox();
    const { floor } = world;
    // A clear apron two cells deep either side of every doorway, so a bank
    // can never seal a room by standing across its door.
    const nearDoor = new Set<number>();
    for (const w of floor.allWalls()) {
      if (!w.door) continue;
      const other =
        w.edge === 'w' ? { col: w.col - 1, row: w.row } : { col: w.col, row: w.row - 1 };
      for (const c of [w, other]) {
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (Math.abs(dc) + Math.abs(dr) <= 2)
              nearDoor.add((c.row + dr) * floor.cols + c.col + dc);
          }
        }
      }
    }
    // Back-to-back banks two rows deep with an aisle row between pairs, and a
    // cross aisle every eleventh column; slots where the zone takes them,
    // plants or neon elsewhere.
    for (let row = 0; row < floor.rows; row++) {
      if (row % 3 === 1) continue; // aisle rows: 4, 7, … meet the north wall and every partition
      for (let col = 0; col < floor.cols; col++) {
        if (col % 11 === 0 || nearDoor.has(row * floor.cols + col)) continue;
        if (col === world.entranceTile.col) continue; // the street-door column
        for (const defId of ['slot-machine', 'plant', 'neon-sign']) {
          if (world.place(defId, col, row)) break;
        }
      }
    }
    const objects = world.state.allObjects();
    const slots = objects.filter((o) => o.defId === 'slot-machine').length;
    console.info(`[lot] ${objects.length} objects (${slots} slots) on 96×64`);
    expect(objects.length).toBeGreaterThanOrEqual(2000);

    // Every open cell is still connected to the door, and every slot has an
    // open, reachable neighbour to be played from (decor needs no stand).
    const open = reachable(world);
    let walkable = 0;
    for (let row = 0; row < floor.rows; row++) {
      for (let col = 0; col < floor.cols; col++) if (world.grid.isWalkable(col, row)) walkable++;
    }
    expect(open.size).toBe(walkable);
    for (const o of objects) {
      if (o.defId !== 'slot-machine') continue;
      const touches = DIRS.some(([dc, dr]) => open.has((o.row + dr) * floor.cols + (o.col + dc)));
      expect(touches, `${o.defId} at ${o.col},${o.row}`).toBe(true);
    }
  });
});
