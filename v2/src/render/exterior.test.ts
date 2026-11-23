import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { WallSegment } from '../shared/contracts';
import { doorRuns, doorTriggers, nightAt, skyAt, streetFrame } from './Exterior';

const door = (col: number, row: number, edge: 'n' | 'w'): WallSegment => ({ col, row, edge, door: true });

describe('streetFrame', () => {
  it('puts the street on the east edge for the shipped entrance and maps out/along to +x/+z', () => {
    const f = streetFrame({ cols: 40, rows: 30, entrance: { col: 39, row: 15 } });
    expect(f.side).toBe('e');
    expect(f.length).toBe(30);
    expect(f.entrance).toBe(15.5);
    const p = new THREE.Vector3(2, 0, 15.5).applyMatrix4(f.matrix);
    expect([p.x, p.z]).toEqual([42, 15.5]);
  });

  it('turns the frame for a north entrance so "out" points to -z', () => {
    const f = streetFrame({ cols: 40, rows: 30, entrance: { col: 10, row: 0 } });
    expect(f.side).toBe('n');
    const p = new THREE.Vector3(3, 0, 10.5).applyMatrix4(f.matrix);
    expect(p.x).toBeCloseTo(10.5);
    expect(p.z).toBeCloseTo(-3);
  });
});

describe('doorRuns', () => {
  const walls = [
    door(10, 6, 'w'),
    door(10, 7, 'w'),
    door(34, 12, 'w'),
    door(34, 13, 'w'),
    door(34, 14, 'w'),
    door(40, 14, 'w'),
    door(40, 15, 'w'),
    door(40, 16, 'w'),
    door(5, 20, 'n'),
    { col: 11, row: 6, edge: 'w', door: false } as WallSegment,
  ];
  const runs = doorRuns({ cols: 40, rows: 30, walls });

  it('joins consecutive door segments on one line into runs', () => {
    expect(runs.map((r) => [r.edge, r.line, r.from, r.to])).toEqual([
      ['n', 20, 5, 6],
      ['w', 10, 6, 8],
      ['w', 34, 12, 15],
      ['w', 40, 14, 17],
    ]);
  });

  it('marks only boundary runs as street doors', () => {
    expect(runs.map((r) => r.street)).toEqual([false, false, false, true]);
  });
});

describe('doorTriggers', () => {
  const runs = doorRuns({ cols: 40, rows: 30, walls: [door(10, 6, 'w'), door(5, 20, 'n')] });
  const agents = (pts: [number, number][]) => {
    const a = new Float32Array(pts.length * 8);
    pts.forEach(([x, z], i) => {
      a[i * 8] = x;
      a[i * 8 + 1] = z;
    });
    return a;
  };

  it('is 0 with nobody near and gives the side of the nearest agent', () => {
    expect([...doorTriggers(runs, agents([[20, 20]]), 1)]).toEqual([0, 0]);
    // Runs sort 'n' first: north of the 'n' door at z=20 (-1), east of the 'w' door at x=10 (+1).
    expect([...doorTriggers(runs, agents([[10.6, 6.5], [5.5, 19.4]]), 2)]).toEqual([-1, 1]);
    expect([...doorTriggers(runs, agents([[9.2, 6.5]]), 1)]).toEqual([0, -1]);
  });

  it('ignores agents beyond the run ends or reach', () => {
    expect([...doorTriggers(runs, agents([[10.5, 9], [5.5, 22]]), 2)]).toEqual([0, 0]);
  });
});

describe('sky and night', () => {
  it('is dark at midnight, blue at noon, warm at dusk', () => {
    const mid = skyAt(0);
    const noon = skyAt(12);
    const dusk = skyAt(18.5);
    expect(noon.zenith.b).toBeGreaterThan(mid.zenith.b * 4);
    expect(noon.horizon.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(0.6);
    expect(dusk.horizon.r).toBeGreaterThan(dusk.horizon.b);
  });

  it('switches lamps on from dusk to dawn', () => {
    expect(nightAt(12)).toBe(0);
    expect(nightAt(0)).toBe(1);
    expect(nightAt(21)).toBe(1);
    expect(nightAt(19)).toBeGreaterThan(0.3);
    expect(nightAt(7)).toBe(0);
    expect(nightAt(24 + 3)).toBe(1);
  });
});
