// Floor, walls and static decor, merged per 8×8 chunk. Each chunk owns at
// most three meshes: floor (FloorMaterial), walls+decor (object material with
// cutaway), ceiling (avatar mode only). A FloorPlanView diff rebuilds only the
// chunks ChunkGrid reports dirty; every mesh has a tight bounding box, so
// three's frustum culling works per chunk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ZONES, type FloorPlanView, type WallSegment } from '../shared/contracts';
import type { AssetLibrary } from './assets/AssetLibrary';
import { GeoBuilder, at } from './assets/GeoBuilder';
import { PALETTE, surf, type Surface } from './assets/Palette';
import { buildProcedural } from './assets/procedural';
import { CHUNK, ChunkGrid, chunkKey } from './core/ChunkGrid';
import { createFloorMaterial } from './materials/FloorMaterial';
import { createObjectMaterial } from './materials/ObjectMaterial';

export const WALL_H = 3.0;
const WALL_T = 0.16;
const DOOR_H = 2.3;
const CEIL_H = 3.4;
const HIGH_LIMIT = ZONES.indexOf('highLimit');

const WAINSCOT: Surface = surf('mahogany');
const WALLPAPER: Surface = { color: 0xffffff, rough: 0.8, metal: 0, decal: 'wallpaper' };
const MOULDING: Surface = surf('plaster', { color: 0xf1e3c8, rough: 0.5 });

interface Chunk {
  floor?: THREE.Mesh;
  walls?: THREE.Mesh;
  ceiling?: THREE.Mesh;
}

export class FloorLayer {
  readonly group = new THREE.Group();
  readonly grid = new ChunkGrid();
  readonly floorMaterial: THREE.MeshStandardMaterial;
  readonly wallMaterial: THREE.MeshStandardMaterial;
  readonly ceilingMaterial: THREE.MeshStandardMaterial;
  private chunks = new Map<number, Chunk>();
  private ceilingGroup = new THREE.Group();
  /** Decor geometry templates, built once. */
  private column: THREE.BufferGeometry;
  private stanchion: THREE.BufferGeometry;
  private chandelier: THREE.BufferGeometry;
  /** Fired with the new plan after chunks rebuild (zone overlay listens). */
  onZones: (grid: ChunkGrid) => void = () => {};

  constructor(private lib: AssetLibrary) {
    this.group.name = 'floor';
    this.floorMaterial = createFloorMaterial(lib.atlas);
    this.wallMaterial = createObjectMaterial(lib.atlas.texture, false, true);
    this.ceilingMaterial = createObjectMaterial(lib.atlas.texture, false, false);
    this.ceilingMaterial.alphaHash = true;
    this.ceilingMaterial.transparent = false;
    this.ceilingMaterial.opacity = 0;
    this.ceilingGroup.visible = false;
    this.group.add(this.ceilingGroup);
    const ctx = { atlas: lib.atlas, w: 1, h: 1, height: 1, color: 0 };
    this.column = buildProcedural('proc:column', ctx, 0);
    this.stanchion = buildProcedural('proc:stanchion', ctx, 0);
    this.chandelier = buildProcedural('proc:chandelier', ctx, 0);
  }

  setFloor(plan: FloorPlanView): void {
    const { dirty, zonesChanged } = this.grid.apply(plan);
    // A wall or zone edge on a chunk border also decorates the neighbour
    // (columns, rope runs), so widen the rebuild by one ring when walls move.
    for (const key of dirty) this.rebuild(key);
    if (zonesChanged) {
      // Rope runs follow the high-limit boundary: rebuild every chunk's decor.
      for (const key of this.allKeys()) if (!dirty.has(key)) this.rebuild(key, true);
      this.onZones(this.grid);
    }
    // Drop chunks outside a shrunken plan.
    for (const key of [...this.chunks.keys()]) {
      const cx = key % 4096;
      const cz = Math.floor(key / 4096);
      if (cx >= this.grid.chunksX || cz >= this.grid.chunksZ) this.drop(key);
    }
  }

  private *allKeys(): IterableIterator<number> {
    for (let cz = 0; cz < this.grid.chunksZ; cz++)
      for (let cx = 0; cx < this.grid.chunksX; cx++) yield chunkKey(cx, cz);
  }

  private drop(key: number): void {
    const c = this.chunks.get(key);
    if (!c) return;
    for (const m of [c.floor, c.walls, c.ceiling]) {
      if (!m) continue;
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.chunks.delete(key);
  }

  private rebuild(key: number, decorOnly = false): void {
    const cx = key % 4096;
    const cz = Math.floor(key / 4096);
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, (c = {}));
    if (!decorOnly) {
      c.floor = this.swap(c.floor, this.buildFloor(cx, cz), this.floorMaterial, this.group);
      c.ceiling = this.swap(c.ceiling, this.buildCeiling(cx, cz), this.ceilingMaterial, this.ceilingGroup);
    }
    c.walls = this.swap(c.walls, this.buildWalls(cx, cz), this.wallMaterial, this.group);
  }

  private swap(
    old: THREE.Mesh | undefined,
    geo: THREE.BufferGeometry | null,
    mat: THREE.Material,
    parent: THREE.Object3D,
  ): THREE.Mesh | undefined {
    if (old) {
      old.removeFromParent();
      old.geometry.dispose();
    }
    if (!geo) return undefined;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = mat !== this.floorMaterial;
    m.matrixAutoUpdate = false;
    parent.add(m);
    return m;
  }

  private buildFloor(cx: number, cz: number): THREE.BufferGeometry | null {
    const g = this.grid;
    const pos: number[] = [];
    const ids: number[] = [];
    const c0 = cx * CHUNK;
    const r0 = cz * CHUNK;
    for (let r = r0; r < Math.min(g.rows, r0 + CHUNK); r++)
      for (let c = c0; c < Math.min(g.cols, c0 + CHUNK); c++) {
        const f = g.floorAt(c, r);
        pos.push(c, 0, r, c, 0, r + 1, c + 1, 0, r + 1, c, 0, r, c + 1, 0, r + 1, c + 1, 0, r);
        for (let k = 0; k < 6; k++) ids.push(f);
      }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setAttribute('aFloor', new THREE.Float32BufferAttribute(ids, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  private buildWalls(cx: number, cz: number): THREE.BufferGeometry | null {
    const g = this.grid;
    const parts: THREE.BufferGeometry[] = [];
    const tag = (geo: THREE.BufferGeometry, x: number, z: number) => {
      const n = geo.attributes.position!.count;
      const c = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        c[i * 2] = x;
        c[i * 2 + 1] = z;
      }
      geo.setAttribute('aWallC', new THREE.BufferAttribute(c, 2));
      parts.push(geo);
    };
    for (const w of g.wallsIn(cx, cz)) {
      const { geo, x, z } = this.wallGeometry(w);
      tag(geo, x, z);
    }
    // Columns where walls turn a corner or end: grid vertices owned by this chunk.
    const c0 = cx * CHUNK;
    const r0 = cz * CHUNK;
    for (let r = r0; r < Math.min(g.rows + 1, r0 + CHUNK); r++)
      for (let c = c0; c < Math.min(g.cols + 1, c0 + CHUNK); c++) {
        const h = +!!g.hasWall(c - 1, r, 'n') + +!!g.hasWall(c, r, 'n');
        const v = +!!g.hasWall(c, r - 1, 'w') + +!!g.hasWall(c, r, 'w');
        const corner = h > 0 && v > 0;
        const end = h + v === 1;
        if (!corner && !end) continue;
        const geo = this.column.clone().applyMatrix4(at(c, 0, r));
        tag(geo, c, r);
      }
    // Brass divider strips where floor types meet, and velvet-rope runs along
    // the high-limit boundary wherever no wall already separates it.
    const decor = new GeoBuilder(this.lib.atlas);
    for (let r = r0; r < Math.min(g.rows, r0 + CHUNK); r++)
      for (let c = c0; c < Math.min(g.cols, c0 + CHUNK); c++) {
        const f = g.floorAt(c, r);
        if (c > 0 && f !== g.floorAt(c - 1, r) && f && g.floorAt(c - 1, r))
          decor.box(0.04, 0.012, 1, c, 0, r + 0.5, PALETTE.brass);
        if (r > 0 && f !== g.floorAt(c, r - 1) && f && g.floorAt(c, r - 1))
          decor.box(1, 0.012, 0.04, c + 0.5, 0, r, PALETTE.brass);
        const hl = g.zoneAt(c, r) === HIGH_LIMIT;
        if (c > 0 && hl !== (g.zoneAt(c - 1, r) === HIGH_LIMIT) && !g.hasWall(c, r, 'w'))
          this.ropeRun(decor, c, r, c, r + 1);
        if (r > 0 && hl !== (g.zoneAt(c, r - 1) === HIGH_LIMIT) && !g.hasWall(c, r, 'n'))
          this.ropeRun(decor, c, r, c + 1, r);
      }
    // Decor is knee-high and never cuts away; the shader skips x < -5000.
    if (!decor.empty) tag(decor.build(), -1e4, 0);
    if (!parts.length) return null;
    const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
    for (const p of parts) p.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  private ropeRun(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number): void {
    // Stanchion at each end; a sagging rope between them.
    for (const [x, z] of [
      [x0, z0],
      [x1, z1],
    ] as const)
      b.addBuilt(this.stanchion, at(x, 0, z));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, 0.9 - Math.sin(t * Math.PI) * 0.16, z0 + (z1 - z0) * t));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.022, 6), PALETTE.velvet);
  }

  /** One 1 m wall segment: wainscot, chair rail, wallpaper, crown; door cut-out. */
  private wallGeometry(w: WallSegment): { geo: THREE.BufferGeometry; x: number; z: number } {
    const b = new GeoBuilder(this.lib.atlas);
    // Build along +x in local space, then rotate for 'w' edges.
    const L = 1;
    const seg = (x0: number, x1: number, y0: number, y1: number, t: number, s: Surface) =>
      b.box(x1 - x0, y1 - y0, t, (x0 + x1) / 2, y0, 0, s);
    const span = (x0: number, x1: number, top: number) => {
      seg(x0, x1, 0, 0.14, WALL_T + 0.04, surf('walnut'));
      seg(x0, x1, 0.14, Math.min(top, 1.0), WALL_T, WAINSCOT);
      if (top > 1.0) {
        seg(x0, x1, 1.0, 1.05, WALL_T + 0.03, PALETTE.brass);
        seg(x0, x1, 1.05, top, WALL_T, WALLPAPER);
      }
    };
    if (!w.door) {
      span(0, L, WALL_H - 0.18);
      seg(0, L, WALL_H - 0.18, WALL_H, WALL_T + 0.08, MOULDING);
    } else {
      const j = 0.1; // jamb width
      span(0, j, WALL_H - 0.18);
      span(L - j, L, WALL_H - 0.18);
      seg(0, L, WALL_H - 0.18, WALL_H, WALL_T + 0.08, MOULDING);
      seg(j, L - j, DOOR_H + 0.12, WALL_H - 0.18, WALL_T, WALLPAPER);
      // Brass frame around the opening.
      seg(j, L - j, DOOR_H, DOOR_H + 0.12, WALL_T + 0.06, PALETTE.gold);
      seg(j - 0.03, j + 0.03, 0, DOOR_H, WALL_T + 0.06, PALETTE.gold);
      seg(L - j - 0.03, L - j + 0.03, 0, DOOR_H, WALL_T + 0.06, PALETTE.gold);
    }
    const geo = b.build();
    const m =
      w.edge === 'n'
        ? at(w.col, 0, w.row)
        : // 'w' edge runs along +z from (col,row): rotate -90° about y (x → z).
          at(w.col, 0, w.row, -Math.PI / 2);
    geo.applyMatrix4(m);
    const x = w.edge === 'n' ? w.col + 0.5 : w.col;
    const z = w.edge === 'n' ? w.row : w.row + 0.5;
    return { geo, x, z };
  }

  /** Coffered ceiling with warm cove light, plus chandeliers on a 6 m lattice. */
  private buildCeiling(cx: number, cz: number): THREE.BufferGeometry | null {
    const g = this.grid;
    const b = new GeoBuilder(this.lib.atlas);
    const c0 = cx * CHUNK;
    const r0 = cz * CHUNK;
    let any = false;
    for (let r = r0; r < Math.min(g.rows, r0 + CHUNK); r++)
      for (let c = c0; c < Math.min(g.cols, c0 + CHUNK); c++) {
        if (!g.floorAt(c, r)) continue;
        any = true;
        const coffer = (c + r) % 2 === 0;
        b.box(1, 0.08, 1, c + 0.5, CEIL_H + (coffer ? 0.25 : 0), r + 0.5, surf('plaster', { color: 0x3a2030 }));
        if (coffer) {
          b.box(0.9, 0.02, 0.9, c + 0.5, CEIL_H + 0.24, r + 0.5, PALETTE.lampWarm);
          b.box(1, 0.25, 0.06, c + 0.5, CEIL_H, r + 0.03, PALETTE.gold);
        }
        if (c % 6 === 3 && r % 6 === 3) b.addBuilt(this.chandelier, at(c + 0.5, CEIL_H, r + 0.5));
      }
    if (!any) return null;
    return b.build();
  }

  /** 0 = hidden (god cam), 1 = fully shown (avatar). Dithered, no sorting. */
  setCeiling(fade: number): void {
    this.ceilingGroup.visible = fade > 0.01;
    this.ceilingMaterial.opacity = fade;
  }

  /** Cell-grid helpers for the zone overlay and picking. */
  get plan(): ChunkGrid {
    return this.grid;
  }

  chunkCount(): number {
    return this.chunks.size;
  }
}
