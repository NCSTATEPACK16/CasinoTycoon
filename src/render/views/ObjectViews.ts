import Phaser from 'phaser';
import { TILE_H } from '../../config';
import { eventBus } from '../../EventBus';
import { getObjectDef, type ObjectDef } from '../../data/objects';
import { gameState } from '../../gameContext';
import { gridToScreen } from '../iso';

/**
 * Screen placement for an object anchored at footprint origin (col,row):
 * x centers on the footprint, y sits on the front (south) corner, and depth is
 * the front tile's screen y — the "origin depth + footprint bias" scheme from
 * PLAN.md, matching how edge walls sort.
 */
export function objectTransform(
  def: ObjectDef,
  col: number,
  row: number,
): { x: number; y: number; depth: number } {
  const { w, h } = def.footprint;
  const center = gridToScreen(col + (w - 1) / 2, row + (h - 1) / 2);
  const front = gridToScreen(col + w - 1, row + h - 1);
  return { x: center.x, y: front.y + TILE_H / 2, depth: front.y };
}

// Sprites bound to sim placed-objects via EventBus — never mutated directly.
export class ObjectViews {
  private scene: Phaser.Scene;
  private sprites = new Map<string, Phaser.GameObjects.Image>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    for (const po of gameState.allObjects()) this.spawn(po.id, po.defId, po.col, po.row, false);
    eventBus.on('objectPlaced', ({ id, defId, col, row }) => this.spawn(id, defId, col, row, true));
    eventBus.on('objectSold', ({ id }) => this.despawn(id));
    eventBus.on('worldReset', () => {
      for (const img of this.sprites.values()) img.destroy();
      this.sprites.clear();
    });
    eventBus.on('worldLoaded', () => {
      for (const po of gameState.allObjects()) this.spawn(po.id, po.defId, po.col, po.row, false);
    });
  }

  spriteFor(id: string): Phaser.GameObjects.Image | undefined {
    return this.sprites.get(id);
  }

  private spawn(id: string, defId: string, col: number, row: number, animate: boolean): void {
    const def = getObjectDef(defId);
    if (!def) return;
    const t = objectTransform(def, col, row);
    const img = this.scene.add.image(t.x, t.y, def.spriteKey).setOrigin(0.5, 1).setDepth(t.depth);
    if (def.displaySize) img.setDisplaySize(def.displaySize.w, def.displaySize.h);
    this.sprites.set(id, img);
    if (animate) {
      // Bounce in toward whatever scale setDisplaySize established above (1 for
      // placeholders, whose native texture size already matches, or the ratio
      // setDisplaySize computed for real art) — never an absolute scale of 1,
      // which would override displaySize and snap real art to native pixel size.
      const targetScaleX = img.scaleX;
      const targetScaleY = img.scaleY;
      img.setScale(targetScaleX * 0.6, targetScaleY * 0.6);
      this.scene.tweens.add({
        targets: img,
        scaleX: targetScaleX,
        scaleY: targetScaleY,
        duration: 260,
        ease: 'Back.easeOut',
      });
    }
  }

  private despawn(id: string): void {
    const img = this.sprites.get(id);
    if (!img) return;
    this.sprites.delete(id);
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      scaleY: 0.4,
      duration: 180,
      ease: 'Quad.easeIn',
      onComplete: () => img.destroy(),
    });
  }
}
