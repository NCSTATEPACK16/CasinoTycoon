// The build-mode façade the HUD talks to. It keeps the skeleton's surface
// (select(defId), defId, bulldoze, onMessage) and maps it onto the
// ToolManager, so the palette can arm a placement without knowing about
// tools. X toggles bulldoze; Esc (handled by the manager) drops the tool.

import type { FloorType, Zone } from '../shared/contracts';
import { isTyping } from './Keys';
import { BulldozeTool } from './tools/BulldozeTool';
import { PaintTool } from './tools/PaintTool';
import { PlaceTool } from './tools/PlaceTool';
import type { ToolManager } from './tools/Tool';
import { WallTool } from './tools/WallTool';

export class BuildTool extends EventTarget {
  floorType: FloorType = 'carpet-red';
  zone: Zone = 'gaming';
  onMessage: (text: string) => void = () => {};

  constructor(private tools: ToolManager) {
    super();
    tools.addEventListener('change', () => this.dispatchEvent(new Event('change')));
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || !tools.enabled || e.code !== 'KeyX') return;
      this.bulldoze = !this.bulldoze;
    });
  }

  /** Id of the active tool ('place', 'paintFloor', 'paintZone', 'wall', 'bulldoze') or null. */
  get toolId(): string | null {
    return this.tools.active?.id ?? null;
  }

  /** The def being placed, if the place tool is active. */
  get defId(): string | null {
    const t = this.tools.active;
    return t instanceof PlaceTool ? t.defId : null;
  }

  get bulldoze(): boolean {
    return this.tools.active instanceof BulldozeTool;
  }

  set bulldoze(on: boolean) {
    if (on !== this.bulldoze) this.select(null, on ? 'bulldoze' : undefined);
  }

  /** Arm placement of `defId`, or with null clear the tool (or switch to `other`). */
  select(defId: string | null, other?: 'bulldoze'): void {
    const ctx = this.tools.context();
    if (defId) {
      // Re-arming the same def keeps its rotation, as RCT does.
      const cur = this.tools.active;
      if (cur instanceof PlaceTool && cur.defId === defId) return;
      const t = new PlaceTool(ctx, defId);
      if (cur instanceof PlaceTool) t.rot = cur.rot;
      this.tools.set(t);
    } else this.tools.set(other === 'bulldoze' ? new BulldozeTool(ctx) : null);
  }

  paintFloor(floor: FloorType): void {
    this.floorType = floor;
    this.setPaint({ kind: 'floor', value: floor });
  }

  paintZone(zone: Zone): void {
    this.zone = zone;
    this.setPaint({ kind: 'zone', value: zone });
  }

  walls(): void {
    this.tools.set(new WallTool(this.tools.context()));
  }

  private setPaint(target: PaintTool['target']): void {
    const cur = this.tools.active;
    if (cur instanceof PaintTool && cur.target.kind === target.kind) {
      cur.target = target; // switch swatch mid-tool without losing the hover preview
      this.dispatchEvent(new Event('change'));
      return;
    }
    this.tools.set(new PaintTool(this.tools.context(), target));
  }
}
