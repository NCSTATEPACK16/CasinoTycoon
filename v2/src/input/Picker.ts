// Screen → world picking: the ground cell, object id and agent id under the
// cursor. Pointer moves only mark the pick dirty; `update()` raycasts at most
// once per frame (and again when the camera moved under a still cursor).
//
// Objects and agents go through Stage's pickObject/pickAgent when Session 1's
// renderer provides them, then a mesh raycast on `userData.objectId`, then a
// CPU grid lookup, so picking keeps working whichever Stage is in.
//
// Events: 'hover' when the hovered object/agent/cell changes, and 'select'
// (detail: PickHit) on a click that didn't drag, while `selectEnabled`.

import * as THREE from 'three';
import { AGENT_STRIDE } from '../shared/contracts';
import type { SimClient } from '../client/SimClient';
import type { Stage } from '../render/Stage';
import type { Cell } from './tools/gridMath';
import type { WorldView } from './WorldView';

export interface PickHit {
  /** Ground-plane point under the cursor (y = 0), or null off the horizon. */
  point: THREE.Vector3 | null;
  /** Cell under the cursor, or null outside the lot. */
  cell: Cell | null;
  objectId: string | null;
  agentId: number | null;
  clientX: number;
  clientY: number;
}

/** The optional picking surface Session 1's Stage will add. */
interface PickableStage {
  pickObject?(ray: THREE.Raycaster): string | null;
  pickAgent?(ray: THREE.Raycaster): number | null;
}

const AGENT_PICK_RADIUS = 0.45;
const CLICK_SLOP_PX = 5;

export class Picker extends EventTarget {
  hover: PickHit = emptyHit();
  /** Off while a build tool owns left-clicks. */
  selectEnabled = true;
  /** Off while the avatar has the camera: nothing under a cursor to pick. */
  enabled = true;
  readonly ray = new THREE.Raycaster();

  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private client: { x: number; y: number } | null = null;
  private dirty = false;
  private lastCam = new THREE.Matrix4();
  private down: { x: number; y: number } | null = null;
  private key = '';

  constructor(
    private dom: HTMLElement,
    private stage: Stage,
    private sim: SimClient,
    private world: WorldView,
    private camera: () => THREE.Camera,
  ) {
    super();
    dom.addEventListener('pointermove', (e) => {
      this.client = { x: e.clientX, y: e.clientY };
      this.dirty = true;
    });
    dom.addEventListener('pointerleave', () => {
      this.client = null;
      this.dirty = true;
    });
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.down = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (e.button !== 0 || !d || !this.enabled || !this.selectEnabled) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      this.dispatchEvent(new CustomEvent<PickHit>('select', { detail: hit }));
    });
  }

  /** Once per frame: refresh `hover` if the cursor or the camera moved. */
  update(): void {
    if (!this.enabled) {
      if (this.key !== '') this.setHover(emptyHit());
      return;
    }
    const cam = this.camera();
    if (!cam.matrixWorld.equals(this.lastCam)) {
      this.lastCam.copy(cam.matrixWorld);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.setHover(this.client ? this.pickAt(this.client.x, this.client.y) : emptyHit());
  }

  /** Immediate pick at a client position (used for clicks, which can't wait a frame). */
  pickAt(clientX: number, clientY: number): PickHit {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera());
    const hit: PickHit = { ...emptyHit(), clientX, clientY };
    const p = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.plane, p)) {
      hit.point = p;
      const col = Math.floor(p.x);
      const row = Math.floor(p.z);
      if (col >= 0 && row >= 0 && col < this.world.cols && row < this.world.rows)
        hit.cell = { col, row };
    }
    hit.objectId = this.pickObject(hit);
    hit.agentId = this.pickAgent(hit);
    return hit;
  }

  private pickObject(hit: PickHit): string | null {
    const s = this.stage as Stage & PickableStage;
    if (s.pickObject) return s.pickObject(this.ray);
    // Placeholder Stage: meshes carry userData.objectId. A tall cabinet seen
    // obliquely is hit on its face, which the ground lookup would miss.
    const mesh = this.ray
      .intersectObjects(this.stage.scene.children, true)
      .find((h) => typeof h.object.userData.objectId === 'string');
    if (mesh) return mesh.object.userData.objectId as string;
    return hit.cell ? (this.world.objectAt(hit.cell.col, hit.cell.row)?.id ?? null) : null;
  }

  private pickAgent(hit: PickHit): number | null {
    const s = this.stage as Stage & PickableStage;
    if (s.pickAgent) return s.pickAgent(this.ray);
    const snap = this.sim.curr;
    if (!snap || !hit.point) return null;
    let best: number | null = null;
    let bestD = AGENT_PICK_RADIUS * AGENT_PICK_RADIUS;
    const a = snap.agents;
    for (let i = 0; i < snap.agentCount; i++) {
      const o = i * AGENT_STRIDE;
      const dx = a[o]! - hit.point.x;
      const dz = a[o + 1]! - hit.point.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = a[o + 7]!;
      }
    }
    return best;
  }

  private setHover(h: PickHit): void {
    this.hover = h;
    const key = `${h.cell?.col},${h.cell?.row}|${h.objectId}|${h.agentId}`;
    if (key === this.key) return;
    this.key = key;
    this.dispatchEvent(new CustomEvent<PickHit>('hover', { detail: h }));
  }
}

function emptyHit(): PickHit {
  return { point: null, cell: null, objectId: null, agentId: null, clientX: 0, clientY: 0 };
}
