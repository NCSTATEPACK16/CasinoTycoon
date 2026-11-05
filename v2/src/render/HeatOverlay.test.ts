import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { heatColor, HeatOverlay } from './HeatOverlay';

describe('HeatOverlay', () => {
  it('ramps mood red → green and traffic blue → red', () => {
    const [r0, g0] = heatColor('mood', 0);
    const [r1, g1] = heatColor('mood', 100);
    expect(r0).toBeGreaterThan(g0);
    expect(g1).toBeGreaterThan(r1);
    expect(heatColor('traffic', 0)[2]).toBeGreaterThan(heatColor('traffic', 0)[0]);
    expect(heatColor('traffic', 1)[0]).toBeGreaterThan(heatColor('traffic', 1)[2]);
  });

  it('covers the lot exactly and puts cell (col,row) in texture row rows−1−row', () => {
    const o = new HeatOverlay();
    const cols = 4;
    const rows = 3;
    const values = new Array(cols * rows).fill(-1);
    values[0 * cols + 1] = 100; // cell (1, 0): the near edge
    o.setData('mood', cols, rows, values);
    expect(o.object.scale.x).toBe(cols);
    expect(o.object.scale.y).toBe(rows);
    expect(o.object.position.x).toBe(cols / 2);
    expect(o.object.position.z).toBe(rows / 2);
    const tex = (o.object.material as THREE.MeshBasicMaterial).map as THREE.DataTexture;
    const data = tex.image.data as Uint8Array;
    const alphaAt = (texRow: number, c: number) => data[(texRow * cols + c) * 4 + 3]!;
    expect(alphaAt(rows - 1, 1)).toBeGreaterThan(0);
    expect(alphaAt(0, 1)).toBe(0);
    // Nothing else painted: unseen cells stay transparent.
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++;
    expect(painted).toBe(1);
  });
});
