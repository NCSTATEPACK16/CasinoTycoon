// Bulldoze: hover outlines the object under the cursor in red with its
// refund; click sells it.

import { SELL_REFUND_RATIO } from '../../config';
import { getObjectDef } from '../../data/objects';
import { get3D } from '../../shared/catalog';
import { money } from '../../ui/tools/CursorTag';
import type { PickHit } from '../Picker';
import { footprintOf } from '../WorldView';
import type { Tool, ToolContext } from './Tool';

export class BulldozeTool implements Tool {
  readonly id = 'bulldoze';
  private target: string | null = null;

  constructor(private ctx: ToolContext) {}

  activate(): void {}

  deactivate(): void {
    this.ctx.overlay.setOutline('bulldoze', null);
  }

  pointerDown(): void {}

  pointerMove(hit: PickHit): void {
    const o = hit.objectId ? this.ctx.world.byId.get(hit.objectId) : undefined;
    this.target = o?.id ?? null;
    if (!o) {
      this.ctx.overlay.setOutline('bulldoze', null);
      if (hit.point) this.ctx.tag.show(hit.clientX, hit.clientY, 'Bulldoze', 'info');
      else this.ctx.tag.hide();
      return;
    }
    const fp = footprintOf(o);
    this.ctx.overlay.setOutline(
      'bulldoze',
      { x: o.col, z: o.row, w: fp.w, h: fp.h, height: get3D(o.defId).height },
      0xe74c3c,
    );
    const def = getObjectDef(o.defId);
    const refund = Math.round((def?.cost ?? 0) * SELL_REFUND_RATIO);
    this.ctx.tag.show(hit.clientX, hit.clientY, `Refund ${money(refund)}`, 'bad');
  }

  pointerUp(hit: PickHit): void {
    const id = hit.objectId ?? this.target;
    if (!id) return;
    this.ctx.sim
      .command<number>({ type: 'sell', objectId: id })
      .then((refund) => this.ctx.say(`Sold for ${money(refund)}`))
      .catch((err: Error) => this.ctx.say(`Can't bulldoze: ${err.message}`));
    this.ctx.overlay.setOutline('bulldoze', null);
    this.target = null;
  }

  key(): boolean {
    return false;
  }

  update(): void {}
}
