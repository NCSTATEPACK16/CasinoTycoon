// Walls run along cell edges. Drag from one grid corner to another to lay an
// L-shaped run (longer axis first); hold Alt (or Ctrl) while dragging to tear
// one down instead. Clicking an existing wall without dragging toggles a door
// in it.

import { DOOR_PRICE_PER_SEGMENT, WALL_PRICE_PER_SEGMENT } from '../../data/floorPrices';
import { money } from '../../ui/tools/CursorTag';
import type { PickHit } from '../Picker';
import { nearestEdge, nearestVertex, wallPath, type EdgeKey, type Vertex } from './gridMath';
import { isNotImplemented, type Tool, type ToolContext } from './Tool';

const DOOR_PICK_DIST = 0.22;

export class WallTool implements Tool {
  readonly id = 'wall';
  private anchor: Vertex | null = null;
  private end: Vertex | null = null;
  private removing = false;

  constructor(private ctx: ToolContext) {}

  activate(): void {}

  deactivate(): void {
    this.anchor = null;
  }

  pointerDown(hit: PickHit, e: PointerEvent): void {
    if (!hit.point) return;
    this.anchor = this.end = this.vertexOf(hit);
    this.removing = e.altKey || e.ctrlKey;
    this.preview(hit);
  }

  pointerMove(hit: PickHit, e: PointerEvent | null): void {
    if (e && this.anchor) this.removing = e.altKey || e.ctrlKey;
    if (hit.point && this.anchor) this.end = this.vertexOf(hit);
    this.preview(hit);
  }

  pointerUp(hit: PickHit): void {
    const a = this.anchor;
    const b = this.end;
    this.anchor = null;
    if (!a || !b) return;
    const path = wallPath(a, b);
    if (path.legs.length === 0) {
      // A click, not a drag: toggle a door in the wall under the cursor.
      const door = this.doorTarget(hit);
      if (door) this.send({ type: 'door', ...door }, 'Doors');
      this.preview(hit);
      return;
    }
    for (const leg of path.legs)
      this.send({ type: 'wall', from: leg.from, to: leg.to, remove: this.removing }, 'Walls');
    this.preview(hit);
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' && this.anchor) {
      this.anchor = null;
      this.preview(this.ctx.picker.hover);
      return true;
    }
    return false;
  }

  update(): void {}

  private vertexOf(hit: PickHit): Vertex {
    return nearestVertex(hit.point!.x, hit.point!.z, this.ctx.world.cols, this.ctx.world.rows);
  }

  /** The edge a click would put a door in: a known wall when the floor plan
   *  has arrived, otherwise just the nearest edge (the sim decides). */
  private doorTarget(hit: PickHit): EdgeKey | null {
    if (!hit.point) return null;
    const e = nearestEdge(hit.point.x, hit.point.z, DOOR_PICK_DIST);
    if (!e) return null;
    if (this.ctx.world.floor && !this.ctx.world.wallAt(e.col, e.row, e.edge)) return null;
    return e;
  }

  private underObject(e: EdgeKey): boolean {
    const w = this.ctx.world;
    const a = w.objectAt(e.col, e.row);
    const b = e.edge === 'n' ? w.objectAt(e.col, e.row - 1) : w.objectAt(e.col - 1, e.row);
    return !!a && a === b;
  }

  private send(cmd: Parameters<ToolContext['sim']['command']>[0], what: string): void {
    this.ctx.sim.command(cmd).catch((err: Error) => {
      this.ctx.say(
        isNotImplemented(err)
          ? `${what} aren't wired in the sim yet`
          : `Can't build: ${err.message}`,
      );
    });
  }

  private preview(hit: PickHit): void {
    const o = this.ctx.overlay;
    if (!hit.point) {
      o.setVertex(null);
      o.setEdges([], 0);
      this.ctx.tag.hide();
      return;
    }
    if (!this.anchor) {
      const door = this.doorTarget(hit);
      o.setVertex(door ? null : this.vertexOf(hit));
      o.setEdges(door ? [door] : [], 0x66e0ff);
      if (door) {
        const isDoor = this.ctx.world.wallAt(door.col, door.row, door.edge)?.door;
        // A wall turned into a door is charged the difference (see sim/build.ts).
        const cost = DOOR_PRICE_PER_SEGMENT - WALL_PRICE_PER_SEGMENT;
        this.ctx.tag.show(
          hit.clientX,
          hit.clientY,
          isDoor ? 'Click: remove door' : `Click: add door · ${money(cost)}`,
        );
      } else this.ctx.tag.show(hit.clientX, hit.clientY, 'Drag to build · Alt-drag to remove');
      return;
    }
    const path = wallPath(this.anchor, this.end ?? this.anchor);
    o.setVertex(this.end);
    o.setEdges(path.edges, this.removing ? 0xe74c3c : 0xf6c453);
    const n = path.edges.length;
    // Only new segments are charged: existing walls and edges inside an
    // object's footprint are skipped, as the sim does.
    const fresh = path.edges.filter(
      (e) => !this.ctx.world.wallAt(e.col, e.row, e.edge) && !this.underObject(e),
    ).length;
    const label = this.removing
      ? `Remove ${n} m`
      : `${n} m · ${fresh ? money(fresh * WALL_PRICE_PER_SEGMENT) : 'Free'}`;
    this.ctx.tag.show(hit.clientX, hit.clientY, label, this.removing ? 'bad' : 'ok');
  }
}
