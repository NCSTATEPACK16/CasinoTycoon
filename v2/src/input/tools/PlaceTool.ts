// Place an object: the ghost follows the cursor cell by cell with a little
// lift and ease, tints green/red from the sim's canPlace, and lands with a
// thunk. R rotates. Holding Shift keeps the tool armed after a placement, and
// Shift-dragging lays a row, one footprint per step: the quick way to fill a
// floor with slots.

import * as THREE from 'three';
import { getObjectDef } from '../../data/objects';
import { get3D } from '../../shared/catalog';
import type { Rotation } from '../../shared/contracts';
import { money } from '../../ui/tools/CursorTag';
import type { PickHit } from '../Picker';
import { damp, dampFactor } from '../../camera/blend';
import { footprintOrigin, rotatedSize, type Cell } from './gridMath';
import type { Tool, ToolContext } from './Tool';

type Check = { ok: true } | { ok: false; reason: string };

const REASONS: Record<string, string> = {
  'insufficient-funds': 'Not enough cash',
  blocked: 'Blocked',
  'not-allowed': 'Not allowed here',
  'unknown-object': 'Unknown object',
};
const HOVER_Y = 0.1;
const LIFT_Y = 0.35;
const OK = 0x2ecc71;
const BAD = 0xe74c3c;

export class PlaceTool implements Tool {
  readonly id = 'place';
  rot: Rotation = 0;
  private cell: Cell | null = null;
  private check: Check | null = null;
  private seq = 0;
  /** Eased ghost state. */
  private pos = new THREE.Vector3();
  private lift = 0;
  private squash = 0;
  private shown = false;
  private lastClient = { x: 0, y: 0 };
  /** The current shift-drag: where it started and which origins it has laid. */
  private row: { start: Cell; placed: Set<string> } | null = null;

  constructor(
    private ctx: ToolContext,
    readonly defId: string,
  ) {}

  private get size(): { w: number; h: number } {
    const def = getObjectDef(this.defId);
    return rotatedSize(def?.footprint.w ?? 1, def?.footprint.h ?? 1, this.rot);
  }

  private get cost(): number {
    return getObjectDef(this.defId)?.cost ?? 0;
  }

  activate(): void {
    this.shown = false;
    this.ctx.stage.ghost.visible = false;
  }

  deactivate(): void {
    this.ctx.stage.ghost.visible = false;
    this.ctx.stage.ghost.scale.set(1, 1, 1);
    this.ctx.tag.hide();
    this.row = null;
  }

  pointerMove(hit: PickHit, e: PointerEvent | null): void {
    if (e) this.lastClient = { x: e.clientX, y: e.clientY };
    else if (hit.point) this.lastClient = { x: hit.clientX, y: hit.clientY };
    if (!hit.point) {
      this.cell = null;
      this.ctx.stage.ghost.visible = false;
      this.ctx.tag.hide();
      return;
    }
    const { w, h } = this.size;
    const origin = footprintOrigin(hit.point.x, hit.point.z, w, h);
    if (this.cell?.col !== origin.col || this.cell?.row !== origin.row) this.moveTo(origin);
    // layRow skips footprints already laid this drag, so calling it on every move is safe.
    if (this.row) this.layRow(origin);
    this.renderTag();
  }

  pointerDown(hit: PickHit, e: PointerEvent): void {
    this.pointerMove(hit, e);
    if (!this.cell) return;
    if (e.shiftKey) {
      this.row = { start: this.cell, placed: new Set() };
      this.layRow(this.cell);
    } else void this.placeAt(this.cell, !e.shiftKey);
  }

  pointerUp(_hit: PickHit, e: PointerEvent): void {
    if (this.row && !e.shiftKey && !this.ctx.keys.shift) this.ctx.done();
    this.row = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.code !== 'KeyR') return false;
    this.rot = ((this.rot + (e.shiftKey ? 3 : 1)) % 4) as Rotation;
    // Re-centre the rotated footprint on the cursor and re-check.
    const p = this.ctx.picker.hover;
    this.cell = null;
    if (p.point) this.pointerMove(p, null);
    this.lift = LIFT_Y;
    return true;
  }

  update(dt: number): void {
    const g = this.ctx.stage.ghost;
    if (!this.cell) return;
    const { w, h } = this.size;
    const d3 = get3D(this.defId);
    if (!this.shown) {
      // First appearance: start at the target, no slide in from the origin.
      this.pos.set(this.cell.col, 0, this.cell.row);
      this.shown = true;
    }
    this.pos.lerp(new THREE.Vector3(this.cell.col, 0, this.cell.row), dampFactor(28, dt));
    this.lift = damp(this.lift, HOVER_Y, 9, dt);
    this.squash = damp(this.squash, 0, 14, dt);
    g.visible = true;
    g.position.set(this.pos.x, this.lift, this.pos.z);
    // The placeholder ghost is a unit box anchored at its min corner; Session 1's
    // ghost reads defId/rot from userData to swap in the model.
    g.scale.set(
      w * (1 + this.squash * 0.5),
      d3.height * (1 - this.squash),
      h * (1 + this.squash * 0.5),
    );
    g.userData.defId = this.defId;
    g.userData.rot = this.rot;
    const mat = (g as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    mat?.color?.setHex(this.check === null || this.check.ok ? OK : BAD);
  }

  private moveTo(origin: Cell): void {
    this.cell = origin;
    this.lift = LIFT_Y; // each new cell pops up and eases back down: the RCT hop
    this.validate();
  }

  private validate(): void {
    const cell = this.cell;
    if (!cell) return;
    const seq = ++this.seq;
    this.check = null;
    void this.ctx.sim
      .command<Check>({
        type: 'canPlace',
        defId: this.defId,
        col: cell.col,
        row: cell.row,
        rot: this.rot,
      })
      .then((r) => {
        if (seq !== this.seq) return;
        this.check = r;
        this.renderTag();
      })
      .catch(() => {
        if (seq === this.seq) this.check = { ok: false, reason: 'blocked' };
      });
  }

  private renderTag(): void {
    if (!this.cell) return this.ctx.tag.hide();
    const c = this.check;
    const hint = this.rot ? ` · ${this.rot * 90}°` : '';
    if (c && !c.ok)
      this.ctx.tag.show(
        this.lastClient.x,
        this.lastClient.y,
        `${money(this.cost)} <span>${REASONS[c.reason] ?? c.reason}</span>`,
        'bad',
      );
    else
      this.ctx.tag.show(this.lastClient.x, this.lastClient.y, `${money(this.cost)}${hint}`, 'ok');
  }

  /** Shift-drag lays a straight row from the drag start toward `to`, along
   *  whichever axis the drag mostly follows, one footprint per step. Every
   *  step is filled even when the pointer skips cells on a fast drag. */
  private layRow(to: Cell): void {
    const row = this.row;
    if (!row) return;
    const { w, h } = this.size;
    const dc = to.col - row.start.col;
    const dr = to.row - row.start.row;
    const alongCols = Math.abs(dc) >= Math.abs(dr);
    const step = alongCols ? w : h;
    const n = Math.trunc((alongCols ? dc : dr) / step);
    for (let k = 0; k <= Math.abs(n); k++) {
      const off = Math.sign(n) * k * step;
      const cell = alongCols
        ? { col: row.start.col + off, row: row.start.row }
        : { col: row.start.col, row: row.start.row + off };
      const key = `${cell.col},${cell.row}`;
      if (row.placed.has(key)) continue;
      row.placed.add(key);
      void this.placeAt(cell, false);
    }
  }

  private async placeAt(cell: Cell, oneShot: boolean): Promise<void> {
    try {
      await this.ctx.sim.command({
        type: 'place',
        defId: this.defId,
        col: cell.col,
        row: cell.row,
        rot: this.rot,
      });
      if (this.cell?.col === cell.col && this.cell?.row === cell.row) {
        // Thunk: drop onto the floor with a quick squash, then lift back to hover.
        this.lift = 0;
        this.squash = 0.12;
      }
      if (oneShot && !this.ctx.keys.shift) this.ctx.done();
      else this.validate(); // the cell under the cursor is now occupied
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'insufficient-funds') this.row = null; // stop laying a row we can't pay for
      if (oneShot || msg === 'insufficient-funds')
        this.ctx.say(`Can't build: ${REASONS[msg] ?? msg}`);
    }
  }
}
