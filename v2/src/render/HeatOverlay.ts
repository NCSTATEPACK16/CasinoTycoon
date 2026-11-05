// B5 (Track B): the mood and traffic heat maps, painted over the floor.
//
// One plane the size of the lot, a hair above the carpet, textured by a
// cols×rows DataTexture with one texel per cell, so the whole overlay is a
// single draw call however big the floor. Linear filtering softens the cells
// into a heat map; cells with nothing to say are fully transparent, so an
// empty corner reads as "no data", never as cold. Objects and walls still
// draw over it (depth-tested, no depth write), like the zone tint.

import * as THREE from 'three';

export type HeatKind = 'mood' | 'traffic';

/** Height above the floor: just over the zone tint (0.03–0.035). */
const Y = 0.045;
const ALPHA = 0.62;

/** Mood 0–100: red when miserable, amber around neutral, green when happy. */
const MOOD_STOPS: [number, [number, number, number]][] = [
  [0, [214, 48, 49]],
  [40, [230, 126, 34]],
  [60, [241, 196, 15]],
  [100, [46, 204, 113]],
];

/** Traffic 0–1 of the busiest tile: cool blue through yellow to hot red. */
const TRAFFIC_STOPS: [number, [number, number, number]][] = [
  [0, [52, 152, 219]],
  [0.5, [241, 196, 15]],
  [1, [231, 76, 60]],
];

function ramp(stops: [number, [number, number, number]][], v: number): [number, number, number] {
  if (v <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i]!;
    if (v <= b) {
      const [a, ca] = stops[i - 1]!;
      const t = (v - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k]! + (cb[k]! - ca[k]!) * t)) as [
        number,
        number,
        number,
      ];
    }
  }
  return stops.at(-1)![1];
}

/** The colour a cell gets, for the legend and the tests. */
export function heatColor(kind: HeatKind, v: number): [number, number, number] {
  return ramp(kind === 'mood' ? MOOD_STOPS : TRAFFIC_STOPS, v);
}

export class HeatOverlay {
  readonly object: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private texture: THREE.DataTexture | null = null;
  private size = { cols: 0, rows: 0 };

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.object.rotation.x = -Math.PI / 2;
    this.object.renderOrder = 6;
    this.object.visible = false;
    this.object.name = 'heat-overlay';
  }

  setVisible(on: boolean): void {
    this.object.visible = on && this.texture !== null;
  }

  /**
   * Paint a map: row-major values, one per cell (mood 0–100 or traffic 0–1),
   * −1 for "nothing to say". Traffic's alpha also rises with the value, so a
   * quiet tile is a faint wash and a corridor glows.
   */
  setData(kind: HeatKind, cols: number, rows: number, values: readonly number[]): void {
    if (cols !== this.size.cols || rows !== this.size.rows || !this.texture) {
      this.texture?.dispose();
      const tex = new THREE.DataTexture(new Uint8Array(cols * rows * 4), cols, rows);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.texture = tex;
      this.material.map = tex;
      this.material.needsUpdate = true;
      this.size = { cols, rows };
      // The plane spans the lot exactly: x ∈ [0, cols], z ∈ [0, rows].
      this.object.scale.set(cols, rows, 1);
      this.object.position.set(cols / 2, Y, rows / 2);
    }
    const data = this.texture.image.data as Uint8Array;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const v = values[r * cols + c] ?? -1;
        // The plane's v runs from z = rows (texture row 0) to z = 0, so cell
        // row r lives in texture row rows − 1 − r.
        const o = ((rows - 1 - r) * cols + c) * 4;
        if (v < 0) {
          data[o + 3] = 0;
          continue;
        }
        const [R, G, B] = heatColor(kind, v);
        data[o] = R;
        data[o + 1] = G;
        data[o + 2] = B;
        const a = kind === 'traffic' ? ALPHA * (0.35 + 0.65 * v) : ALPHA;
        data[o + 3] = Math.round(a * 255);
      }
    this.texture.needsUpdate = true;
  }
}
