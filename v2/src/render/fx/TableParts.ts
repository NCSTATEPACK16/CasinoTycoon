// The moving hardware of the table games: roulette heads and balls, big six
// heads and craps dice. Each part type is one InstancedMesh on the object
// material (one draw call per type, and none while no instance is live), and
// only tables FxDirector is animating have instances. The part sits a few
// millimetres over the hero's own painted wheel, so a table nobody is
// watching keeps its static art and a watched one shows the live part.
//
// Built here from the atlas rather than split out of the Blender heroes: the
// dice need a pip face per side, which the heroes' plain boxes don't carry.

import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { GeoBuilder } from '../assets/GeoBuilder';
import { PALETTE, type Surface } from '../assets/Palette';
import { createObjectMaterial } from '../materials/ObjectMaterial';
import { DIE } from './dice';
import { POCKET_R } from './wheel';

export type PartKind = 'headEU' | 'headUS' | 'ball' | 'die' | 'bigSix';

/** Table-local placements of the painted wheels (see heroes.py). */
export const ROULETTE_HUB = new THREE.Vector3(1.55, 0.8, 1.0);
const ROULETTE_R = 0.31;
export const BIG_SIX_HUB = new THREE.Vector3(0.5, 1.86, 0.556);
const BIG_SIX_R = 0.58;
const CAPACITY = 64;

const surf = (key: keyof typeof PALETTE, extra: Partial<Surface> = {}): Surface => ({
  ...PALETTE[key],
  ...extra,
});

/** A disc in the xz plane facing +y, planar UVs: u along +x, v along −z. */
function discUp(r: number, seg = 48): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2);
  const p = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < p.count; i++)
    uv.setXY(i, 0.5 + p.getX(i) / (2 * r), 0.5 - p.getZ(i) / (2 * r));
  return g;
}

/** A disc in the xy plane facing +z, planar UVs: u along +x, v along +y. */
function discFront(r: number, seg = 48): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, seg);
  const p = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < p.count; i++)
    uv.setXY(i, 0.5 + p.getX(i) / (2 * r), 0.5 + p.getY(i) / (2 * r));
  return g;
}

/** A die: a cube whose six faces show the pip tiles of the dieFaces decal. */
function dieGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(DIE, DIE, DIE);
  // BoxGeometry groups: +x, −x, +y, −y, +z, −z. Values per dice.ts FACES.
  const value = [2, 5, 1, 6, 3, 4];
  const uv = g.attributes.uv!;
  for (let face = 0; face < 6; face++) {
    const tile = value[face]! - 1;
    const tx = tile % 3;
    const ty = Math.floor(tile / 3);
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, (tx + uv.getX(i)) / 3, 1 - (ty + 1 - uv.getY(i)) / 2);
    }
  }
  return g;
}

class PartPool {
  readonly mesh: THREE.InstancedMesh;
  private used = 0;

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, name: string) {
    for (const [k, def] of [
      ['aState', [-100, 0, 0, 0]],
      ['aReelA', [-1000, -1, 0, 0]],
      ['aReelB', [0, 0, 0, 1]],
    ] as const) {
      const a = new Float32Array(CAPACITY * 4);
      for (let i = 0; i < CAPACITY; i++) a.set(def, i * 4);
      geo.setAttribute(k, new THREE.InstancedBufferAttribute(a, 4));
    }
    this.mesh = new THREE.InstancedMesh(geo, material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = `part:${name}`;
  }

  begin(): void {
    this.used = 0;
  }

  push(m: THREE.Matrix4): void {
    if (this.used >= CAPACITY) return;
    this.mesh.setMatrixAt(this.used++, m);
  }

  end(): void {
    this.mesh.count = this.used;
    this.mesh.visible = this.used > 0;
    if (this.used) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class TableParts {
  readonly group = new THREE.Group();
  private pools: Record<PartKind, PartPool>;

  constructor(lib: AssetLibrary) {
    this.group.name = 'table-parts';
    const material = createObjectMaterial(lib.atlas.texture);
    const build = (f: (b: GeoBuilder) => void) => {
      const b = new GeoBuilder(lib.atlas);
      f(b);
      return b.build();
    };
    const head = (decal: string) =>
      build((b) => {
        b.add(discUp(ROULETTE_R), surf('white', { decal, rough: 0.35 }));
        b.add(new THREE.ConeGeometry(0.04, 0.09, 12).translate(0, 0.045, 0), surf('gold'));
        b.add(
          new THREE.TorusGeometry(POCKET_R + 0.01, 0.006, 6, 40).rotateX(Math.PI / 2),
          surf('brass'),
        );
      });
    this.pools = {
      headEU: new PartPool(head('rouletteWheel'), material, 'headEU'),
      headUS: new PartPool(head('rouletteWheelUS'), material, 'headUS'),
      ball: new PartPool(
        build((b) =>
          b.add(new THREE.SphereGeometry(0.011, 12, 8), surf('ceramic', { rough: 0.15 })),
        ),
        material,
        'ball',
      ),
      die: new PartPool(
        build((b) => b.add(dieGeometry(), surf('white', { decal: 'dieFaces', rough: 0.3 }))),
        material,
        'die',
      ),
      bigSix: new PartPool(
        build((b) =>
          b.add(discFront(BIG_SIX_R), surf('white', { decal: 'bigSixFace', rough: 0.4 })),
        ),
        material,
        'bigSix',
      ),
    };
    for (const p of Object.values(this.pools)) this.group.add(p.mesh);
  }

  begin(): void {
    for (const p of Object.values(this.pools)) p.begin();
  }

  push(kind: PartKind, m: THREE.Matrix4): void {
    this.pools[kind].push(m);
  }

  end(): void {
    for (const p of Object.values(this.pools)) p.end();
  }
}
