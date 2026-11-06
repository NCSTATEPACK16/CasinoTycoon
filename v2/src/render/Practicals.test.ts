import { describe, expect, it } from 'vitest';
import type { FloorPlanView, ObjectView } from '../shared/contracts';
import { classifyGpu } from './gpuTier';
import { collectLights, POOL_RES, splatPools, toWorld } from './Practicals';

function plan(cols: number, rows: number, filled = true): FloorPlanView {
  return {
    cols,
    rows,
    floor: new Uint8Array(cols * rows).fill(filled ? 1 : 0),
    zone: new Uint8Array(cols * rows),
    walls: [],
    entrance: { col: 0, row: 0 },
  };
}

function obj(defId: string, col: number, row: number, rot: 0 | 1 | 2 | 3 = 0, broken = false): ObjectView {
  return { id: `${defId}@${col},${row}`, defId, col, row, rot, broken, open: true, occupants: 0 };
}

const none = () => [];

describe('toWorld', () => {
  it('maps footprint-local points the way ObjectLayer rotates objects', () => {
    // Unrotated: local (x, z) is just offset by the cell.
    expect(toWorld({ col: 10, row: 20, rot: 0 }, 2, 1, 0.5, 0.25)).toEqual({ x: 10.5, z: 20.25 });
    // A quarter turn swaps the footprint and keeps the centre fixed.
    const c = toWorld({ col: 10, row: 20, rot: 1 }, 2, 1, 1, 0.5);
    expect(c.x).toBeCloseTo(10.5);
    expect(c.z).toBeCloseTo(21);
    // The front-left corner of a 2×1 turned once lands inside its 1×2 footprint.
    const p = toWorld({ col: 10, row: 20, rot: 1 }, 2, 1, 0, 1);
    expect(p.x).toBeGreaterThanOrEqual(10);
    expect(p.x).toBeLessThanOrEqual(11);
    expect(p.z).toBeGreaterThanOrEqual(20);
    expect(p.z).toBeLessThanOrEqual(22);
  });
});

describe('collectLights', () => {
  it('hangs chandeliers on the ceiling lattice, only over floor', () => {
    const all = collectLights(plan(12, 12), [], none);
    expect(all.map((l) => [l.x, l.z])).toEqual([
      [3.5, 3.5],
      [9.5, 3.5],
      [3.5, 9.5],
      [9.5, 9.5],
    ]);
    expect(collectLights(plan(12, 12, false), [], none)).toEqual([]);
  });

  it('uses an asset\'s own light empties, rotated into the world', () => {
    const lights = collectLights(null, [obj('lamp-post', 4, 6)], () => [
      { x: 0.5, y: 2.9, z: 0.5, color: 0xffffff, radius: 3 },
    ]);
    expect(lights).toHaveLength(1);
    expect(lights[0]).toMatchObject({ x: 4.5, y: 2.9, z: 6.5, radius: 3, practical: true });
  });

  it('gives tables a pit lamp and glowing fixtures a coloured, non-practical spill', () => {
    const [table, neon] = collectLights(null, [obj('blackjack-table', 0, 0), obj('neon-sign', 10, 0)], none);
    expect(table!.practical).toBe(true);
    expect(neon!.practical).toBe(false);
    // Neon is magenta: red and blue well above green.
    expect(neon!.color[0]).toBeGreaterThan(neon!.color[1] * 4);
  });

  it('skips broken machines', () => {
    expect(collectLights(null, [obj('neon-sign', 0, 0, 0, true)], none)).toEqual([]);
  });
});

describe('splatPools', () => {
  it('peaks under the light, falls off smoothly and stays inside its radius', () => {
    const buf = splatPools(
      [{ x: 5, y: 2, z: 5, color: [1, 0.5, 0], radius: 2, intensity: 1, practical: true }],
      10,
      10,
    );
    const W = 10 * POOL_RES;
    const at = (x: number, z: number) => buf[(Math.floor(z * POOL_RES) * W + Math.floor(x * POOL_RES)) * 3]!;
    expect(at(5, 5)).toBeGreaterThan(0.95);
    expect(at(6, 5)).toBeGreaterThan(0.4);
    expect(at(6, 5)).toBeLessThan(at(5, 5));
    expect(at(7.2, 5)).toBe(0);
    // Green carries the colour ratio, blue none.
    const i = (Math.floor(5 * POOL_RES) * W + Math.floor(5 * POOL_RES)) * 3;
    expect(buf[i + 1]! / buf[i]!).toBeCloseTo(0.5);
    expect(buf[i + 2]).toBe(0);
  });

  it('clips pools at the lot edge without wrapping', () => {
    const buf = splatPools([{ x: 0, y: 2, z: 0, color: [1, 1, 1], radius: 3, intensity: 1, practical: true }], 4, 4);
    const W = 4 * POOL_RES;
    expect(buf[0]).toBeGreaterThan(0.9);
    expect(buf[(W - 1) * 3]).toBe(0); // far corner of the first row: outside the radius
  });
});

describe('classifyGpu', () => {
  it('starts software and weak GPUs on Low, the rest on High', () => {
    expect(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 8192)).toBe('low');
    expect(classifyGpu('llvmpipe (LLVM 15.0.7, 256 bits)', 16384)).toBe('low');
    expect(classifyGpu('ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11)', 16384)).toBe('low');
    expect(classifyGpu('Mali-G52 MC2', 8192)).toBe('low');
    expect(classifyGpu('Adreno (TM) 506', 16384)).toBe('low');
    expect(classifyGpu('Apple M2', 16384)).toBe('high');
    expect(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)', 32768)).toBe('high');
    expect(classifyGpu('Adreno (TM) 740', 16384)).toBe('high');
    expect(classifyGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', 16384)).toBe('high');
    expect(classifyGpu('Apple GPU', 4096)).toBe('low');
  });
});
