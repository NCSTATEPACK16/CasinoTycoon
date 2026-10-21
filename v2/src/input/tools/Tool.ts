// The build-tool contract and the manager that keeps exactly one tool live.
// Tools get pointer events already resolved to a PickHit, plus a frame tick
// for easing their previews; the manager owns the DOM listeners.

import type { SimClient } from '../../client/SimClient';
import type { Stage } from '../../render/Stage';
import type { CursorTag } from '../../ui/tools/CursorTag';
import type { Keys } from '../Keys';
import { isTyping } from '../Keys';
import type { PickHit, Picker } from '../Picker';
import type { WorldView } from '../WorldView';
import type { ToolOverlay } from './ToolOverlay';

export interface ToolContext {
  sim: SimClient;
  stage: Stage;
  world: WorldView;
  picker: Picker;
  overlay: ToolOverlay;
  tag: CursorTag;
  keys: Keys;
  /** Short player-facing message (the HUD toast). */
  say(text: string): void;
  /** Leave this tool (e.g. a one-shot placement finished). */
  done(): void;
}

export interface Tool {
  readonly id: string;
  activate(): void;
  deactivate(): void;
  pointerDown(hit: PickHit, e: PointerEvent): void;
  pointerMove(hit: PickHit, e: PointerEvent | null): void;
  pointerUp(hit: PickHit, e: PointerEvent): void;
  /** Return true when the key was consumed. */
  key(e: KeyboardEvent): boolean;
  update(dt: number): void;
}

/** Sim commands that Session 3/4 haven't wired yet reply with this. */
export function isNotImplemented(err: unknown): boolean {
  return err instanceof Error && /not implemented/i.test(err.message);
}

export class ToolManager extends EventTarget {
  active: Tool | null = null;
  /** Off while the avatar has the camera. */
  enabled = true;
  private lastHit: PickHit | null = null;

  constructor(
    dom: HTMLElement,
    private ctx: Omit<ToolContext, 'done'>,
  ) {
    super();
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.active || e.button !== 0) return;
      dom.setPointerCapture(e.pointerId); // keep drags alive over UI panels
      this.active.pointerDown(this.ctx.picker.pickAt(e.clientX, e.clientY), e);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.active) return;
      // Hover uses the per-frame pick in update(); drags need every event for responsiveness.
      if (e.buttons & 1) this.active.pointerMove(this.ctx.picker.pickAt(e.clientX, e.clientY), e);
    });
    dom.addEventListener('pointerup', (e) => {
      if (!this.enabled || !this.active || e.button !== 0) return;
      this.active.pointerUp(this.ctx.picker.pickAt(e.clientX, e.clientY), e);
    });
    dom.addEventListener('pointerleave', () => this.ctx.tag.hide());
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || !this.active || isTyping(e)) return;
      if (this.active.key(e)) {
        e.preventDefault();
        return;
      }
      if (e.code === 'Escape') this.set(null);
    });
  }

  set(tool: Tool | null): void {
    if (tool === this.active) return;
    this.active?.deactivate();
    this.ctx.overlay.clear();
    this.ctx.tag.hide();
    this.active = tool;
    this.ctx.picker.selectEnabled = !tool;
    this.lastHit = null;
    tool?.activate();
    this.dispatchEvent(new Event('change'));
  }

  /** The context handed to tools; `done` clears the active tool. */
  context(): ToolContext {
    return { ...this.ctx, done: () => this.set(null) };
  }

  update(dt: number): void {
    if (!this.enabled || !this.active) return;
    const h = this.ctx.picker.hover;
    if (h !== this.lastHit) {
      this.lastHit = h;
      this.active.pointerMove(h, null);
    }
    this.active.update(dt);
  }
}
