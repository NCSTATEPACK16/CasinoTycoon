// Eye-level interaction. While walking, the nearest object within 2 m (by
// distance to its footprint, ties going to whatever is in front) is
// highlighted and prompts "E — Inspect …" and, for games, "F — Sit & Play".
//
// E sends `inspect` and re-broadcasts the reply as an `inspect` CustomEvent on
// window ({ objectId, ok, data?, error? }) for the lead's inspector panel.
// F sits the avatar at the nearest free seat and fires `playRequested`
// ({ objectId, defId, game }); the play UI is the lead's and Session 4's.
// F again, or V, stands back up.

import { getObjectDef } from '../../data/objects';
import { get3D } from '../../shared/catalog';
import type { ObjectView } from '../../shared/contracts';
import type { SimClient } from '../../client/SimClient';
import type { CameraDirector, Seat } from '../../camera/CameraDirector';
import type { InteractPrompt } from '../../ui/tools/InteractPrompt';
import { isTyping } from '../Keys';
import type { ToolOverlay } from '../tools/ToolOverlay';
import { rotateLocal } from '../tools/gridMath';
import { footprintOf, type WorldView } from '../WorldView';
import type { Avatar } from './Avatar';

export const INTERACT_RANGE = 2;

export interface InspectEventDetail {
  objectId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface PlayRequestedDetail {
  objectId: string;
  defId: string;
  game: string | null;
}

export class Interaction {
  target: ObjectView | null = null;

  constructor(
    private avatar: Avatar,
    private director: CameraDirector,
    private world: WorldView,
    private sim: SimClient,
    private overlay: ToolOverlay,
    private prompt: InteractPrompt,
    private say: (t: string) => void,
  ) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.repeat) return;
      const m = this.director.mode;
      if (m === 'seat' && e.code === 'KeyF') return this.director.stand();
      if (m !== 'third' && m !== 'first') return;
      if (e.code === 'KeyE' && this.target) this.inspect(this.target);
      if (e.code === 'KeyF' && this.target && this.canPlay(this.target)) this.sitAt(this.target);
    });
  }

  update(): void {
    const m = this.director.mode;
    const live = (m === 'third' || m === 'first') && !this.director.transitioning;
    this.target = live ? this.nearest() : null;
    const t = this.target;
    if (!t) {
      this.overlay.setOutline('interact', null);
      this.prompt.set(m === 'seat' ? [['F', 'Stand up']] : null);
      return;
    }
    const fp = footprintOf(t);
    this.overlay.setOutline(
      'interact',
      { x: t.col, z: t.row, w: fp.w, h: fp.h, height: get3D(t.defId).height },
      0xf6c453,
    );
    const name = getObjectDef(t.defId)?.name ?? t.defId;
    const lines: [string, string][] = [['E', `Inspect ${name}`]];
    if (this.canPlay(t)) lines.push(['F', 'Sit & Play']);
    this.prompt.set(lines);
  }

  private canPlay(o: ObjectView): boolean {
    return !!get3D(o.defId).game;
  }

  private nearest(): ObjectView | null {
    const p = this.avatar.pos;
    const fx = Math.sin(this.avatar.heading);
    const fz = Math.cos(this.avatar.heading);
    let best: ObjectView | null = null;
    let bestScore = Infinity;
    for (const o of this.world.objects) {
      const fp = footprintOf(o);
      const cx = Math.max(o.col, Math.min(o.col + fp.w, p.x));
      const cz = Math.max(o.row, Math.min(o.row + fp.h, p.z));
      const d = Math.hypot(cx - p.x, cz - p.z);
      if (d > INTERACT_RANGE) continue;
      // Prefer what we face: an object behind us scores as if 1 m further away.
      const mx = o.col + fp.w / 2 - p.x;
      const mz = o.row + fp.h / 2 - p.z;
      const facing = (mx * fx + mz * fz) / (Math.hypot(mx, mz) || 1);
      const score = d + (1 - facing) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private inspect(o: ObjectView): void {
    const emit = (d: InspectEventDetail) =>
      window.dispatchEvent(new CustomEvent<InspectEventDetail>('inspect', { detail: d }));
    this.sim
      .command({ type: 'inspect', target: { objectId: o.id } })
      .then((data) => emit({ objectId: o.id, ok: true, data }))
      .catch((err: Error) => {
        emit({ objectId: o.id, ok: false, error: err.message });
        if (/not implemented/i.test(err.message))
          this.say('Inspector data isn’t wired in the sim yet');
      });
  }

  private sitAt(o: ObjectView): void {
    const seat = seatFor(o, this.avatar.pos);
    this.director.sit(seat);
    const detail: PlayRequestedDetail = {
      objectId: o.id,
      defId: o.defId,
      game: get3D(o.defId).game ?? null,
    };
    window.dispatchEvent(new CustomEvent<PlayRequestedDetail>('playRequested', { detail }));
  }
}

/** The catalog seat nearest `near`, in world space. Objects without seat data
 *  get one in front of their footprint (unrotated +z side), facing in. */
export function seatFor(o: ObjectView, near: { x: number; z: number }): Seat {
  const def = getObjectDef(o.defId);
  const w = def?.footprint.w ?? 1;
  const h = def?.footprint.h ?? 1;
  const seats = get3D(o.defId).seats ?? [{ x: w / 2, z: h + 0.45, facing: Math.PI }];
  const fp = footprintOf(o);
  let best: Seat | null = null;
  let bestD = Infinity;
  for (const s of seats) {
    const r = rotateLocal(s.x, s.z, s.facing, w, h, o.rot);
    const x = o.col + r.x;
    const z = o.row + r.z;
    const d = Math.hypot(x - near.x, z - near.z);
    if (d < bestD) {
      bestD = d;
      best = {
        objectId: o.id,
        x,
        z,
        facing: r.facing,
        lookAt: { x: o.col + fp.w / 2, z: o.row + fp.h / 2 },
      };
    }
  }
  return best!;
}
