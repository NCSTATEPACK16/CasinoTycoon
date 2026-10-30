// Every placed object as an instance in a per-(asset, LOD) InstancedMesh.
// setObjects diffs the incoming ObjectView[] against what is drawn: new ids
// are appended, gone ids swap-removed, moved ones rewritten — never a Mesh
// per object. LOD is chosen per 8×8 chunk (SPEC §5): when a chunk crosses a
// distance band its objects hop between the LOD pools of their asset.

import * as THREE from 'three';
import { getObjectDef } from '../data/objects';
import { get3D } from '../shared/catalog';
import type { ObjectView } from '../shared/contracts';
import type { Asset, AssetLibrary } from './assets/AssetLibrary';
import type { Lod } from './assets/procedural';
import { CHUNK, chunkKey } from './core/ChunkGrid';
import { InstancePool } from './core/InstancePool';
import { createObjectMaterial } from './materials/ObjectMaterial';

const CH_MATRIX = 0;
const CH_STATE = 1;
/** Chunk-centre distance bands for LOD0→1 and LOD1→2. LOD0 stops at 16 m:
 *  a chunk centre that far still puts every object within ~10 m of the eye at
 *  full detail, and the 24 m band drew ~220 full slot cabinets (2.3k tris each)
 *  at eye level in a dense Sandbox bank, over SPEC §5's 1.5M-triangle budget. */
export const LOD_DIST = [16, 70] as const;
/** A chunk outside the view frustum: its objects leave every pool. */
const CULLED = -1;
type Slot = Lod | typeof CULLED;
const HYSTERESIS = 3;
const THUNK_S = 0.42;
/** Below this camera height (m) only LOD0 casts shadows; see shadowsNearOnly. */
const LOW_CAMERA_Y = 6;

/** One InstancedMesh fed by an InstancePool. */
class PoolMesh {
  readonly pool = new InstancePool<string>([16, 4], 64);
  mesh: THREE.InstancedMesh;
  /** Whether only full-detail instances cast (a low camera); see ObjectLayer.update. */
  private nearOnly = false;

  constructor(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    readonly asset: Asset,
    readonly lod: Lod,
    private parent: THREE.Object3D,
  ) {
    this.mesh = this.make(geo, material);
  }

  private make(src: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    // A view sharing the asset's vertex buffers: LOD levels may alias one
    // geometry, and each pool needs its own aState attribute on it.
    const geo = new THREE.BufferGeometry();
    geo.setIndex(src.index);
    for (const [k, a] of Object.entries(src.attributes)) if (k !== 'aState') geo.setAttribute(k, a);
    geo.boundingBox = src.boundingBox;
    geo.boundingSphere = src.boundingSphere;
    const m = new THREE.InstancedMesh(geo, material, 0);
    m.instanceMatrix = new THREE.InstancedBufferAttribute(this.pool.channels[CH_MATRIX]!.array, 16);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const state = new THREE.InstancedBufferAttribute(this.pool.channels[CH_STATE]!.array, 4);
    state.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', state);
    m.count = 0;
    m.castShadow = this.castsShadow();
    m.receiveShadow = true;
    m.name = `${this.asset.key}#${this.lod}`;
    this.parent.add(m);
    return m;
  }

  /** Far LOD boxes are below shadow-texel size anyway. LOD1 casts too, except
   *  from a low camera: there it is everything past 16 m, whose shadows are
   *  too far off to see and cost most of the shadow pass's triangles. */
  private castsShadow(): boolean {
    return this.lod === 0 || (this.lod === 1 && !this.nearOnly);
  }

  setShadowsNearOnly(nearOnly: boolean): void {
    this.nearOnly = nearOnly;
    this.mesh.castShadow = this.castsShadow();
  }

  /** The asset's GLB landed: keep instances, swap geometry. */
  setGeometry(geo: THREE.BufferGeometry): void {
    const mat = this.mesh.material as THREE.Material;
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = this.make(geo, mat);
    this.pool.grown = true;
    this.sync();
  }

  sync(): void {
    const p = this.pool;
    if (!p.dirty && !p.grown && this.mesh.count === p.count) return;
    if (p.grown) {
      this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(p.channels[CH_MATRIX]!.array, 16);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const st = new THREE.InstancedBufferAttribute(p.channels[CH_STATE]!.array, 4);
      st.setUsage(THREE.DynamicDrawUsage);
      this.mesh.geometry.setAttribute('aState', st);
    } else if (p.dirty) {
      const lo = p.dirtyMin;
      const n = p.dirtyMax - p.dirtyMin + 1;
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(lo * 16, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      const st = this.mesh.geometry.attributes.aState as THREE.InstancedBufferAttribute;
      st.clearUpdateRanges();
      st.addUpdateRange(lo * 4, n * 4);
      st.needsUpdate = true;
    }
    this.mesh.count = p.count;
    this.mesh.visible = p.count > 0;
    // Culling uses the instances' bounds; recompute lazily after any change.
    this.mesh.boundingSphere = null;
    this.mesh.boundingBox = null;
    p.clearDirty();
  }
}

interface Placed {
  view: ObjectView;
  asset: Asset;
  chunk: number;
  lod: Slot;
  base: THREE.Matrix4;
  /** World AABB of the footprint × nominal height, for picking. */
  box: THREE.Box3;
  variant: number;
  flashAt: number;
}

const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const state4 = [0, 0, 0, 0];
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();
const chunkBox = new THREE.Box3();

export class ObjectLayer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private pools = new Map<string, PoolMesh>();
  private shadowsNearOnly = false;
  private placed = new Map<string, Placed>();
  private byChunk = new Map<number, Set<string>>();
  private chunkLod = new Map<number, Slot>();
  private anims = new Map<string, number>();
  private settled = false;
  private hovered: string | null = null;
  private now = 0;

  constructor(private lib: AssetLibrary) {
    this.group.name = 'objects';
    this.material = createObjectMaterial(lib.atlas.texture);
    lib.onUpdate = (a) => {
      for (const p of this.pools.values())
        if (p.asset === a) p.setGeometry(a.lods[p.lod]);
    };
  }

  get size(): number {
    return this.placed.size;
  }

  private poolFor(asset: Asset, lod: Lod): PoolMesh {
    const key = `${asset.key}|${lod}`;
    let p = this.pools.get(key);
    if (!p) {
      p = new PoolMesh(asset.lods[lod], this.material, asset, lod, this.group);
      p.setShadowsNearOnly(this.shadowsNearOnly);
      this.pools.set(key, p);
    }
    return p;
  }

  setObjects(views: ObjectView[]): void {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      const have = this.placed.get(v.id);
      if (!have) this.add(v);
      else if (
        have.view.defId !== v.defId ||
        have.view.col !== v.col ||
        have.view.row !== v.row ||
        have.view.rot !== v.rot
      ) {
        this.remove(v.id);
        this.add(v);
      } else if (
        have.view.broken !== v.broken ||
        have.view.open !== v.open ||
        have.view.decalRow !== v.decalRow
      ) {
        have.view = v;
        have.variant = v.decalRow ?? hash(v.id);
        this.writeState(have);
      } else have.view = v;
    }
    for (const id of [...this.placed.keys()]) if (!seen.has(id)) this.remove(id);
    this.settled = true;
    this.syncPools();
  }

  private add(v: ObjectView): void {
    const d3 = get3D(v.defId);
    const def = getObjectDef(v.defId);
    const asset = this.lib.get(d3.asset);
    const w = def?.footprint.w ?? asset.w;
    const h = def?.footprint.h ?? asset.h;
    const odd = v.rot % 2 === 1;
    const fw = odd ? h : w;
    const fh = odd ? w : h;
    const cx = v.col + fw / 2;
    const cz = v.row + fh / 2;
    // Rotate about the footprint centre; rot is clockwise from above, which is
    // a negative turn about +y in this right-handed, y-up frame.
    const base = new THREE.Matrix4()
      .makeTranslation(cx, 0, cz)
      .multiply(tmpM.makeRotationY((-v.rot * Math.PI) / 2))
      .multiply(tmpS.makeTranslation(-w / 2, 0, -h / 2));
    const chunk = chunkKey(Math.floor(cx / CHUNK), Math.floor(cz / CHUNK));
    const lod = this.chunkLod.get(chunk) ?? 0;
    const p: Placed = {
      view: v,
      asset,
      chunk,
      lod,
      base,
      box: new THREE.Box3(
        new THREE.Vector3(v.col, 0, v.row),
        new THREE.Vector3(v.col + fw, d3.height, v.row + fh),
      ),
      variant: v.decalRow ?? hash(v.id),
      flashAt: -100,
    };
    this.placed.set(v.id, p);
    let set = this.byChunk.get(chunk);
    if (!set) this.byChunk.set(chunk, (set = new Set()));
    set.add(v.id);
    if (this.settled) this.anims.set(v.id, this.now);
    this.insert(p);
  }

  private insert(p: Placed): void {
    if (p.lod === CULLED) return;
    const pool = this.poolFor(p.asset, p.lod).pool;
    const i = pool.add(p.view.id);
    pool.set(CH_MATRIX, i, this.matrixOf(p).elements);
    this.writeState(p);
  }

  private remove(id: string): void {
    const p = this.placed.get(id);
    if (!p) return;
    if (p.lod !== CULLED) this.poolFor(p.asset, p.lod).pool.remove(id);
    this.byChunk.get(p.chunk)?.delete(id);
    this.placed.delete(id);
    this.anims.delete(id);
  }

  private writeState(p: Placed): void {
    if (p.lod === CULLED) return;
    const pool = this.poolFor(p.asset, p.lod).pool;
    const i = pool.indexOf(p.view.id);
    if (i === undefined) return;
    state4[0] = p.flashAt;
    state4[1] = p.view.broken ? 1 : p.view.open ? 0 : 0.35;
    state4[2] = this.hovered === p.view.id ? 1 : 0;
    state4[3] = (p.variant % p.asset.variantRows) * p.asset.variantStep;
    pool.set(CH_STATE, i, state4);
  }

  private matrixOf(p: Placed): THREE.Matrix4 {
    const t0 = this.anims.get(p.view.id);
    if (t0 === undefined) return p.base;
    // Build "thunk": drop in, squash on landing, overshoot, settle.
    const t = Math.min(1, (this.now - t0) / THUNK_S);
    const drop = t < 0.35 ? (1 - t / 0.35) ** 2 * 0.8 : 0;
    const k = t < 0.35 ? 0 : (t - 0.35) / 0.65;
    const squash = t < 0.35 ? 0.12 : Math.sin(k * Math.PI * 2.2) * Math.exp(-k * 4) * 0.22;
    const sy = 1 - squash;
    const sxz = 1 + squash * 0.5;
    const { w, h } = p.asset;
    tmpM
      .makeTranslation(w / 2, drop, h / 2)
      .multiply(tmpS.makeScale(sxz, sy, sxz))
      .multiply(new THREE.Matrix4().makeTranslation(-w / 2, 0, -h / 2));
    return tmpS.multiplyMatrices(p.base, tmpM);
  }

  /** Per-frame: chunk LODs, thunk animations, pool uploads. */
  update(camera: THREE.Camera, now: number): void {
    this.now = now;
    const cam = camera.position;
    const nearOnly = cam.y < LOW_CAMERA_Y;
    if (nearOnly !== this.shadowsNearOnly) {
      this.shadowsNearOnly = nearOnly;
      for (const p of this.pools.values()) p.setShadowsNearOnly(nearOnly);
    }
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    for (const [chunk, ids] of this.byChunk) {
      if (!ids.size) continue;
      const x0 = (chunk % 4096) * CHUNK;
      const z0 = Math.floor(chunk / 4096) * CHUNK;
      // Margin so tall casters just off-screen still throw their shadows in.
      chunkBox.min.set(x0 - 2, 0, z0 - 2);
      chunkBox.max.set(x0 + CHUNK + 2, 3.5, z0 + CHUNK + 2);
      const cur = this.chunkLod.get(chunk) ?? 0;
      let next: Slot;
      if (!frustum.intersectsBox(chunkBox)) next = CULLED;
      else {
        const d = tmpV.set(x0 + CHUNK / 2, 0, z0 + CHUNK / 2).distanceTo(cam);
        next = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
        // Only switch once clearly past a band edge, so a chunk on the boundary
        // doesn't flicker between pools as the camera drifts.
        if (next !== cur && cur !== CULLED) {
          const edge = LOD_DIST[Math.min(next, cur) as 0 | 1];
          if (Math.abs(d - edge) < HYSTERESIS) next = cur;
        }
      }
      if (next === cur) continue;
      this.chunkLod.set(chunk, next);
      for (const id of ids) {
        const p = this.placed.get(id)!;
        if (p.lod !== CULLED) this.poolFor(p.asset, p.lod).pool.remove(id);
        p.lod = next;
        this.insert(p);
      }
    }
    for (const [id, t0] of this.anims) {
      const p = this.placed.get(id);
      if (now - t0 >= THUNK_S) this.anims.delete(id);
      if (!p || p.lod === CULLED) continue;
      const pool = this.poolFor(p.asset, p.lod).pool;
      const i = pool.indexOf(id);
      if (i !== undefined) pool.set(CH_MATRIX, i, this.matrixOf(p).elements);
    }
    this.syncPools();
  }

  private syncPools(): void {
    for (const p of this.pools.values()) p.sync();
  }

  /** Win flash on whatever object covers (x, z). */
  flashAt(x: number, z: number, now: number): string | null {
    for (const p of this.placed.values()) {
      const b = p.box;
      if (x >= b.min.x && x < b.max.x && z >= b.min.z && z < b.max.z) {
        p.flashAt = now;
        this.writeState(p);
        return p.view.id;
      }
    }
    return null;
  }

  setHovered(id: string | null): void {
    if (id === this.hovered) return;
    const old = this.hovered;
    this.hovered = id;
    for (const k of [old, id]) {
      const p = k ? this.placed.get(k) : undefined;
      if (p) this.writeState(p);
    }
    this.syncPools();
  }

  /** Nearest object whose footprint box the ray enters. */
  pick(ray: THREE.Ray): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, p] of this.placed) {
      const hit = ray.intersectBox(p.box, tmpV);
      if (!hit) continue;
      const d = hit.distanceToSquared(ray.origin);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  get(id: string): { asset: Asset; matrix: THREE.Matrix4; box: THREE.Box3; view: ObjectView } | null {
    const p = this.placed.get(id);
    return p ? { asset: p.asset, matrix: p.base, box: p.box, view: p.view } : null;
  }

  stats(): { pools: number; instances: number; byLod: number[] } {
    const byLod = [0, 0, 0];
    let pools = 0;
    for (const p of this.pools.values()) {
      if (p.pool.count) pools++;
      byLod[p.lod]! += p.pool.count;
    }
    return { pools, instances: this.placed.size, byLod };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
