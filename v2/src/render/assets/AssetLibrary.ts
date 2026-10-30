// Asset key → three single-material LOD geometries. Heroes come from the
// meshopt GLBs that assets/blender/*.py export; everything else, and any hero
// still loading, is built procedurally. The GLB's materials are flattened
// into the vertex layout of GeoBuilder, so the object shader never sees them.
//
// Blender naming contract (assets/blender/common.py writes it):
//   meshes under empties LOD0 / LOD1 / LOD2
//   material '<name>[__flash][__chase][__variant]'  or  'decal_<key>[__…]'
//   COLOR_0 = baked ambient occlusion (grey)
//   empties 'seat_<n>' = where a player sits/stands (logged for catalog.ts)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { getObjectDef } from '../../data/objects';
import { OBJECT_3D } from '../../shared/catalog';
import { DecalAtlas } from './Atlas';
import { GeoBuilder } from './GeoBuilder';
import { REEL_DECALS, SurfaceFlag, type Surface } from './Palette';
import { buildProcedural, type Lod } from './procedural';

const GLB_URLS = import.meta.glob('../../../assets/models/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function glbUrl(key: string): string | undefined {
  for (const [path, url] of Object.entries(GLB_URLS))
    if (path.endsWith(`/${key}.glb`)) return url;
  return undefined;
}

export interface Asset {
  key: string;
  /** Footprint in cells (unrotated) and the nominal height. */
  w: number;
  h: number;
  height: number;
  lods: [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];
  /** v-offset per instance variant for its Variant decal, 0 when it has none. */
  variantStep: number;
  variantRows: number;
  /** True once the GLB replaced the stand-in (or the asset is procedural). */
  final: boolean;
  /** Seat empties read from the GLB, cell-local metres. */
  seats: { x: number; z: number; facing: number }[];
  /** Bumped when lods are replaced, so pools know to swap geometry. */
  version: number;
}

export class AssetLibrary {
  readonly atlas = new DecalAtlas();
  private assets = new Map<string, Asset>();
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  /** Fired when a GLB finishes and replaces a stand-in. */
  onUpdate: (asset: Asset) => void = () => {};

  /** Synchronous: returns the asset now (stand-in if the GLB is pending). */
  get(key: string): Asset {
    let a = this.assets.get(key);
    if (a) return a;
    const meta = footprintFor(key);
    const procedural = key.startsWith('proc:');
    const url = procedural ? undefined : glbUrl(key);
    const gen = procedural ? key : 'proc:box';
    const ctx = { atlas: this.atlas, ...meta };
    a = {
      key,
      ...meta,
      lods: [0, 1, 2].map((l) => buildProcedural(gen, ctx, l as Lod)) as Asset['lods'],
      variantStep: 0,
      variantRows: 1,
      final: procedural || !url,
      seats: [],
      version: 0,
    };
    if (key === 'proc:neon') this.useVariant(a, 'neonWords');
    if (key === 'proc:marquee') this.useVariant(a, 'marquee');
    this.assets.set(key, a);
    if (url) void this.loadGlb(a, url);
    return a;
  }

  /** Resolves once every GLB that `get` has started has settled. */
  private pending = new Set<Promise<void>>();
  async whenReady(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private useVariant(a: Asset, decal: string): void {
    const r = this.atlas.rect(decal);
    a.variantStep = r.stepV;
    a.variantRows = r.rows;
  }

  private loadGlb(a: Asset, url: string): Promise<void> {
    const p = this.loader
      .loadAsync(url)
      .then((gltf) => {
        const lods = this.flatten(gltf.scene, a);
        if (!lods) return;
        for (const g of a.lods) g.dispose();
        a.lods = lods;
        a.final = true;
        a.version++;
        this.onUpdate(a);
      })
      .catch((e: unknown) => console.warn(`AssetLibrary: ${a.key} failed`, e))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
    return p;
  }

  private flatten(root: THREE.Object3D, a: Asset): Asset['lods'] | null {
    root.updateMatrixWorld(true);
    const builders = [0, 1, 2].map(() => new GeoBuilder(this.atlas));
    const seats: Asset['seats'] = [];
    root.traverse((o) => {
      const seat = /^seat_?\d*/i.exec(o.name);
      if (seat && !(o as THREE.Mesh).isMesh) {
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const dir = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
        seats.push({ x: round(p.x), z: round(p.z), facing: round(Math.atan2(dir.x, dir.z)) });
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const lod = lodOf(mesh);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const geo = mesh.geometry;
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
      for (const grp of groups) {
        const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
        let part = geo.clone();
        if (geo.groups.length) part = subset(part, grp.start, grp.count);
        // COLOR_0 carries the Blender AO bake; GeoBuilder multiplies it in.
        if (part.attributes.color) {
          const c = part.attributes.color;
          const ao = new Float32Array(c.count);
          for (let i = 0; i < c.count; i++) ao[i] = c.getX(i);
          part.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
          part.deleteAttribute('color');
        }
        // glTF stores UVs with v down from the top; the atlas is GL-style (v up).
        const uv = part.attributes.uv as THREE.BufferAttribute | undefined;
        if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
        const s = surfaceOf(mat);
        // A decal painted in rows is a variant decal whether or not the
        // Blender material says so (the blackjack felt's rows are its rules).
        if (s.decal && this.atlas.rect(s.decal).rows > 1)
          s.flags = (s.flags ?? 0) | SurfaceFlag.Variant;
        if (s.decal && s.flags && s.flags & SurfaceFlag.Variant) this.useVariant(a, s.decal);
        if (s.decal && REEL_DECALS.has(s.decal)) s.flags = (s.flags ?? 0) | SurfaceFlag.Reel;
        builders[lod]!.add(part, s, mesh.matrixWorld);
      }
    });
    if (builders[0]!.empty) return null;
    a.seats = seats;
    const l0 = builders[0]!.build();
    const l1 = builders[1]!.empty ? l0 : builders[1]!.build();
    const l2 = builders[2]!.empty ? l1 : builders[2]!.build();
    return [l0, l1, l2];
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function lodOf(o: THREE.Object3D): Lod {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const m = /^LOD([012])/.exec(p.name);
    if (m) return Number(m[1]) as Lod;
  }
  return 0;
}

function subset(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  if (!g.index) return g;
  const idx = g.index.array.slice(start, Math.min(g.index.count, start + count));
  g.setIndex(Array.from(idx));
  return g;
}

function surfaceOf(m: THREE.MeshStandardMaterial): Surface {
  const name = m.name ?? '';
  let flags = 0;
  if (name.includes('__flash')) flags |= SurfaceFlag.Flash;
  if (name.includes('__chase')) flags |= SurfaceFlag.Chase;
  if (name.includes('__variant')) flags |= SurfaceFlag.Variant;
  const decal = /^decal_([A-Za-z0-9]+)/.exec(name)?.[1];
  const e = m.emissive ?? new THREE.Color(0);
  const emit = Math.max(e.r, e.g, e.b) * (m.emissiveIntensity ?? 1);
  // Emissive surfaces glow in their own colour; the shader emits base × emit.
  const base = emit > 0 && !decal ? e.clone().multiplyScalar(1 / Math.max(e.r, e.g, e.b)) : m.color;
  return {
    color: 0xffffff,
    rgb: [base.r, base.g, base.b],
    rough: m.roughness ?? 0.5,
    metal: m.metalness ?? 0,
    emit,
    decal,
    flags,
  };
}

/** Footprint and nominal height for an asset key, from the first catalog def using it. */
function footprintFor(key: string): { w: number; h: number; height: number; color: number } {
  for (const [defId, d3] of Object.entries(OBJECT_3D)) {
    if (d3.asset !== key) continue;
    const def = getObjectDef(defId);
    return { w: def?.footprint.w ?? 1, h: def?.footprint.h ?? 1, height: d3.height, color: d3.color };
  }
  return { w: 1, h: 1, height: 1, color: 0x888888 };
}
