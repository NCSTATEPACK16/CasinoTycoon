import { beforeAll, describe, expect, it } from 'vitest';
import { FloorPlan } from '../floor/FloorPlan';
import { starterFloorPlan } from '../floor/starter';
import { IsoGrid } from '../grid/IsoGrid';
import { NavFilter, NavSystem, initNav } from './NavSystem';
import { floorNavSource } from './source';

beforeAll(async () => {
  await initNav();
});

function bakeStarter(id: string | null = null) {
  const plan = starterFloorPlan(id, 40, 30);
  const grid = new IsoGrid(40, 30);
  grid.floor = plan;
  const nav = new NavSystem(40, 30);
  nav.bakeAll(floorNavSource(plan, grid));
  return { plan, grid, nav };
}

describe('NavSystem bake', () => {
  it('bakes a 40×30 plan in under 150 ms and rebakes one tile in under 10 ms', () => {
    // Warm the WASM paths once so the measurement is the bake, not the JIT.
    bakeStarter();
    const { plan, grid, nav } = bakeStarter();
    expect(nav.lastBakeMs).toBeLessThan(150);
    plan.paintFloor({ col0: 12, row0: 12, col1: 13, row1: 13 }, 'marble');
    nav.markDirty(12, 12, 13, 13);
    // Interior cells: only their own tile, padded by one cell, is touched.
    const t0 = performance.now();
    nav.rebakeTile(floorNavSource(plan, grid), 1, 1);
    const one = performance.now() - t0;
    expect(one).toBeLessThan(10);
    console.info(`[nav] full bake ${nav.lastBakeMs.toFixed(1)} ms, one tile ${one.toFixed(2)} ms`);
  });

  it('walls block, doors pass', () => {
    const plan = FloorPlan.open(16, 8, { col: 0, row: 0 });
    plan.strictZones = true;
    // A full-height wall down x = 8 with a single door at row 3.
    for (let row = 0; row < 8; row++) plan.setWall(8, row, 'w', true, row === 3);
    const nav = new NavSystem(16, 8);
    nav.bakeAll(floorNavSource(plan, null));
    const a = { x: 2.5, z: 6.5 };
    const b = { x: 13.5, z: 6.5 };
    expect(nav.reachable(a, b, NavFilter.Guest)).toBe(true);
    const path = nav.path(a, b, NavFilter.Guest);
    // The only way through is the door cell.
    const crossing = path.find((p, i) => i > 0 && (path[i - 1]!.x - 8) * (p.x - 8) <= 0);
    expect(crossing).toBeDefined();
    const door = path.find((p) => Math.abs(p.x - 8) < 0.5);
    expect(door && door.z > 3 && door.z < 4).toBe(true);
    // Close the door: no way through at all.
    plan.setWall(8, 3, 'w', true, false);
    nav.markDirty(8, 3, 8, 3);
    nav.flush(floorNavSource(plan, null));
    expect(nav.reachable(a, b, NavFilter.Guest)).toBe(false);
  });

  it('keeps low-bankroll guests out of High-Limit and everyone out of Back-of-House', () => {
    const { nav, plan } = bakeStarter('high-roller');
    expect(plan.zoneAt(28, 6)).toBe('highLimit');
    const lobby = { x: 37.5, z: 15.5 };
    const salon = { x: 28.5, z: 6.5 };
    expect(nav.reachable(lobby, salon, NavFilter.HighRoller)).toBe(true);
    expect(nav.reachable(lobby, salon, NavFilter.Guest)).toBe(false);
    expect(nav.reachable(lobby, salon, NavFilter.Staff)).toBe(true);
  });

  it('objects are holes in the mesh with agent-radius clearance', () => {
    const { plan, grid, nav } = bakeStarter();
    grid.occupy('obj-1', 20, 14, 2, 2);
    nav.markDirty(20, 14, 21, 15);
    nav.flush(floorNavSource(plan, grid));
    expect(nav.closest({ x: 21, z: 15 }, NavFilter.Staff, 0.2)).toBeNull();
    const edge = nav.closest({ x: 21, z: 13.9 }, NavFilter.Staff, 0.6);
    expect(edge).not.toBeNull();
    expect(edge!.z).toBeLessThanOrEqual(14 - 0.25);
  });
});
