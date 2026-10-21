// Skeleton build tool: raycast the ground, snap to the grid, show a ghost
// tinted by placeability, click to place, X toggles bulldoze. Session 2 owns
// the full tool set (drag-paint, rotation, walls).

import * as THREE from 'three';
import { getObjectDef } from '../data/objects';
import { get3D } from '../shared/catalog';
import type { SimClient } from '../client/SimClient';
import type { Stage } from '../render/Stage';

export class BuildTool {
  defId: string | null = null;
  bulldoze = false;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private cell: { col: number; row: number } | null = null;
  private checkSeq = 0;
  onMessage: (text: string) => void = () => {};

  constructor(
    private dom: HTMLElement,
    private stage: Stage,
    private sim: SimClient,
    private camera: () => THREE.Camera,
  ) {
    dom.addEventListener('pointermove', (e) => this.hover(e));
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) void this.click(e);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(null);
      if (e.key.toLowerCase() === 'x') {
        this.select(null);
        this.bulldoze = !this.bulldoze;
      }
    });
  }

  select(defId: string | null): void {
    this.defId = defId;
    this.bulldoze = false;
    this.stage.ghost.visible = false;
  }

  private setNdc(e: PointerEvent): void {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.ndc, this.camera());
  }

  private hover(e: PointerEvent): void {
    if (!this.defId) return;
    this.setNdc(e);
    const hit = this.ray.intersectObject(this.stage.ground)[0];
    if (!hit) return void (this.stage.ghost.visible = false);
    const def = getObjectDef(this.defId);
    const w = def?.footprint.w ?? 1;
    const h = def?.footprint.h ?? 1;
    const col = Math.floor(hit.point.x - w / 2 + 0.5);
    const row = Math.floor(hit.point.z - h / 2 + 0.5);
    const g = this.stage.ghost;
    g.visible = true;
    g.position.set(col, 0, row);
    g.scale.set(w, get3D(this.defId).height, h);
    if (this.cell?.col === col && this.cell?.row === row) return;
    this.cell = { col, row };
    const seq = ++this.checkSeq;
    void this.sim
      .command<{ ok: boolean }>({ type: 'canPlace', defId: this.defId, col, row, rot: 0 })
      .then((r) => {
        if (seq === this.checkSeq)
          (g.material as THREE.MeshBasicMaterial).color.setHex(r.ok ? 0x2ecc71 : 0xe74c3c);
      });
  }

  private async click(e: PointerEvent): Promise<void> {
    this.setNdc(e);
    if (this.bulldoze) {
      const hit = this.ray
        .intersectObjects(this.stage.scene.children, true)
        .find((h) => h.object.userData.objectId);
      if (!hit) return;
      const refund = await this.sim
        .command<number>({ type: 'sell', objectId: hit.object.userData.objectId as string })
        .catch(() => null);
      if (refund !== null) this.onMessage(`Sold for $${refund.toLocaleString()}`);
      return;
    }
    if (!this.defId || !this.cell) return;
    try {
      await this.sim.command({
        type: 'place',
        defId: this.defId,
        col: this.cell.col,
        row: this.cell.row,
        rot: 0,
      });
      this.cell = null; // force a fresh validity check under the cursor
    } catch (err) {
      this.onMessage(`Can't build: ${(err as Error).message}`);
    }
  }
}
