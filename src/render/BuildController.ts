import Phaser from 'phaser';
import { eventBus } from '../EventBus';
import { getObjectDef } from '../data/objects';
import { world, worldGrid } from '../gameContext';
import type CameraController from './CameraController';
import { gridToScreen, screenToGrid } from './iso';
import { objectTransform, type ObjectViews } from './views/ObjectViews';

// Preview elements draw above every world object (max world depth ≈ 2200) so
// validity feedback is never occluded by what's already built.
const DEPTH_MARKER = 10000;
const DEPTH_GHOST = 10001;
const GHOST_ALPHA = 0.65;
const INVALID_TINT = 0xff9090;
const BULLDOZE_TINT = 0xff6b6b;
// Clicks that traveled further than this were camera drags, not placements.
const CLICK_SLOP = 6;

type Mode = 'off' | 'place' | 'bulldoze';

// Render-side build tool: ghost preview + validity markers + click handling.
// All mutations go through sim/build.ts; views update via the EventBus.
export class BuildController {
  private scene: Phaser.Scene;
  private camera: CameraController;
  private views: ObjectViews;
  private mode: Mode = 'off';
  private defId: string | null = null;
  private ghost: Phaser.GameObjects.Image;
  private markers: Phaser.GameObjects.Image[] = [];
  private bulldozeTarget: string | null = null;

  constructor(scene: Phaser.Scene, camera: CameraController, views: ObjectViews) {
    this.scene = scene;
    this.camera = camera;
    this.views = views;

    this.ghost = scene.add.image(0, 0, 'obj-plant').setOrigin(0.5, 1).setVisible(false);
    // Marker pool sized for the largest footprint in the catalog (2×2).
    for (let i = 0; i < 4; i++) {
      this.markers.push(
        scene.add.image(0, 0, 'tile-valid').setDepth(DEPTH_MARKER).setAlpha(0.7).setVisible(false),
      );
    }

    eventBus.on('buildModeChanged', ({ mode, defId }) => this.setMode(mode, defId ?? null));

    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.refresh(p));
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.active && p.rightButtonDown()) this.exit();
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    scene.input.keyboard?.on('keydown-ESC', () => this.exit());
  }

  get active(): boolean {
    return this.mode !== 'off';
  }

  /** Called from the scene's update so the ghost tracks camera motion (edge scroll). */
  refresh(p: Phaser.Input.Pointer): void {
    if (!this.active || this.camera.isDragging) {
      this.hidePreview();
      return;
    }
    const worldPoint = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    const { col, row } = screenToGrid(worldPoint.x, worldPoint.y);

    if (this.mode === 'place' && this.defId) {
      const def = getObjectDef(this.defId);
      if (!def) return;
      const valid = world.canPlace(this.defId, col, row).ok;
      const { w, h } = def.footprint;
      let m = 0;
      for (let dr = 0; dr < h; dr++) {
        for (let dc = 0; dc < w; dc++) {
          const cell = gridToScreen(col + dc, row + dr);
          this.markers[m++]
            ?.setTexture(valid ? 'tile-valid' : 'tile-invalid')
            .setPosition(cell.x, cell.y)
            .setVisible(worldGrid.inBounds(col + dc, row + dr));
        }
      }
      for (; m < this.markers.length; m++) this.markers[m]?.setVisible(false);

      const t = objectTransform(def, col, row);
      this.ghost
        .setTexture(def.spriteKey)
        .setPosition(t.x, t.y)
        .setDepth(DEPTH_GHOST)
        .setAlpha(GHOST_ALPHA)
        .setVisible(true);
      if (valid) this.ghost.clearTint();
      else this.ghost.setTint(INVALID_TINT);
      return;
    }

    // Bulldoze: mark the hovered object red.
    this.ghost.setVisible(false);
    const target = worldGrid.inBounds(col, row) ? worldGrid.occupantAt(col, row) : null;
    this.setBulldozeTarget(target);
    const cell = gridToScreen(col, row);
    this.markers[0]
      ?.setTexture(target ? 'tile-invalid' : 'tile-highlight')
      .setPosition(cell.x, cell.y)
      .setVisible(worldGrid.inBounds(col, row));
    for (let m = 1; m < this.markers.length; m++) this.markers[m]?.setVisible(false);
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (!this.active || !p.leftButtonReleased()) return;
    if (p.getDistance() >= CLICK_SLOP) return; // was a camera drag
    const worldPoint = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    const { col, row } = screenToGrid(worldPoint.x, worldPoint.y);

    if (this.mode === 'place' && this.defId) {
      if (!world.place(this.defId, col, row)) {
        const check = world.canPlace(this.defId, col, row);
        if (!check.ok && check.reason === 'insufficient-funds') {
          eventBus.emit('tickerMessage', { text: 'Not enough cash!' });
        }
      }
      this.refresh(p);
      return;
    }

    const target = worldGrid.inBounds(col, row) ? worldGrid.occupantAt(col, row) : null;
    if (target) {
      this.setBulldozeTarget(null);
      world.sell(target);
      this.refresh(p);
    }
  }

  private setMode(mode: Mode, defId: string | null): void {
    this.mode = mode;
    this.defId = defId;
    if (!this.active) this.hidePreview();
    else this.refresh(this.scene.input.activePointer);
  }

  private exit(): void {
    if (this.active) eventBus.emit('buildModeChanged', { mode: 'off' });
  }

  private hidePreview(): void {
    this.ghost.setVisible(false);
    for (const m of this.markers) m.setVisible(false);
    this.setBulldozeTarget(null);
  }

  private setBulldozeTarget(id: string | null): void {
    if (this.bulldozeTarget === id) return;
    if (this.bulldozeTarget) this.views.spriteFor(this.bulldozeTarget)?.clearTint();
    this.bulldozeTarget = id;
    if (id) this.views.spriteFor(id)?.setTint(BULLDOZE_TINT);
  }
}
