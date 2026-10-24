// Drag-rectangle painting for floors and zones. Hover previews the cell under
// the cursor; a drag previews the whole rectangle with its cell count and
// cost; release sends one paintFloor/paintZone command. The cost counts only
// cells that would change, at the sim's own prices, so the tag matches the bill.

import { FLOOR_PRICE_PER_CELL, ZONE_PRICE_PER_CELL } from '../../data/floorPrices';
import { FLOOR_TYPES, ZONES, type FloorType, type Zone } from '../../shared/contracts';
import { money } from '../../ui/tools/CursorTag';
import type { PickHit } from '../Picker';
import { normaliseRect, type Cell } from './gridMath';
import { isNotImplemented, type Tool, type ToolContext } from './Tool';

export const FLOOR_COLORS: Record<FloorType, number> = {
  none: 0x333333,
  'carpet-red': 0xc0392b,
  'carpet-blue': 0x2e4fa8,
  marble: 0xeae6dd,
  wood: 0xa0703f,
  tile: 0xc9d2d6,
};

export const ZONE_COLORS: Record<Zone, number> = {
  none: 0x666666,
  gaming: 0xf6c453,
  highLimit: 0xa569bd,
  foodCourt: 0xeb984e,
  restrooms: 0x5dade2,
  backOfHouse: 0x95a5a6,
};

export type PaintTarget = { kind: 'floor'; value: FloorType } | { kind: 'zone'; value: Zone };

export class PaintTool implements Tool {
  readonly id: string;
  private anchor: Cell | null = null;
  private last: Cell | null = null;

  constructor(
    private ctx: ToolContext,
    public target: PaintTarget,
  ) {
    this.id = target.kind === 'floor' ? 'paintFloor' : 'paintZone';
  }

  activate(): void {}

  deactivate(): void {
    this.anchor = null;
  }

  private get color(): number {
    const t = this.target;
    return t.kind === 'floor' ? FLOOR_COLORS[t.value] : ZONE_COLORS[t.value];
  }

  private get unitCost(): number {
    const t = this.target;
    return t.kind === 'floor' ? FLOOR_PRICE_PER_CELL[t.value] : ZONE_PRICE_PER_CELL;
  }

  /** Whether painting this cell would change it (and so be charged). */
  private changes(col: number, row: number): boolean {
    const plan = this.ctx.world.floor;
    if (!plan) return true;
    const t = this.target;
    const i = row * plan.cols + col;
    return t.kind === 'floor'
      ? FLOOR_TYPES[plan.floor[i]!] !== t.value
      : ZONES[plan.zone[i]!] !== t.value;
  }

  pointerDown(hit: PickHit): void {
    if (!hit.cell) return;
    this.anchor = hit.cell;
    this.preview(hit);
  }

  pointerMove(hit: PickHit): void {
    if (hit.cell) this.last = hit.cell;
    this.preview(hit);
  }

  pointerUp(hit: PickHit): void {
    const a = this.anchor;
    this.anchor = null;
    const end = hit.cell ?? this.last;
    if (!a || !end) return;
    const rect = normaliseRect(a, end, this.ctx.world.cols, this.ctx.world.rows);
    this.preview(hit);
    if (!rect) return;
    const t = this.target;
    const cmd =
      t.kind === 'floor'
        ? ({ type: 'paintFloor', rect, floor: t.value } as const)
        : ({ type: 'paintZone', rect, zone: t.value } as const);
    this.ctx.sim.command(cmd).catch((err: Error) => {
      this.ctx.say(
        isNotImplemented(err)
          ? `${t.kind === 'floor' ? 'Floor' : 'Zone'} painting isn't wired in the sim yet`
          : `Can't paint: ${err.message}`,
      );
    });
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

  private preview(hit: PickHit): void {
    const cell = hit.cell ?? this.last;
    if (!cell) {
      this.ctx.overlay.setCells([], 0);
      this.ctx.tag.hide();
      return;
    }
    const rect = normaliseRect(this.anchor ?? cell, cell, this.ctx.world.cols, this.ctx.world.rows);
    if (!rect) return;
    const cells: Cell[] = [];
    let changed = 0;
    for (let row = rect.row0; row <= rect.row1; row++)
      for (let col = rect.col0; col <= rect.col1; col++) {
        cells.push({ col, row });
        if (this.changes(col, row)) changed++;
      }
    this.ctx.overlay.setCells(cells, this.color);
    const w = rect.col1 - rect.col0 + 1;
    const h = rect.row1 - rect.row0 + 1;
    const cost = changed * this.unitCost;
    this.ctx.tag.show(
      hit.clientX,
      hit.clientY,
      `${w}×${h} · ${cost ? money(cost) : 'Free'}`,
      this.anchor ? 'ok' : 'info',
    );
  }
}
