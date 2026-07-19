import Phaser from 'phaser';
import { eventBus } from '../../EventBus';
import { world } from '../../gameContext';
import { gridToScreen } from '../iso';

// Flat decals just above the floor, below every object and character.
const DEPTH_MESS = 2;

export class MessViews {
  private scene: Phaser.Scene;
  private sprites = new Map<string, Phaser.GameObjects.Image>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    for (const m of world.messes.values()) this.spawn(m.id, m.col, m.row, m.kind);
    eventBus.on('messCreated', ({ id, col, row, kind }) => this.spawn(id, col, row, kind));
    eventBus.on('messCleaned', ({ id }) => this.despawn(id));
    eventBus.on('worldReset', () => {
      for (const img of this.sprites.values()) img.destroy();
      this.sprites.clear();
    });
  }

  private spawn(id: string, col: number, row: number, kind: string): void {
    const s = gridToScreen(col, row);
    const img = this.scene.add
      .image(s.x, s.y, `fx-mess-${kind}`)
      .setDepth(DEPTH_MESS)
      .setAlpha(0)
      .setAngle(Phaser.Math.Between(-12, 12));
    this.scene.tweens.add({ targets: img, alpha: 0.95, duration: 250 });
    this.sprites.set(id, img);
  }

  private despawn(id: string): void {
    const img = this.sprites.get(id);
    if (!img) return;
    this.sprites.delete(id);
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      duration: 220,
      onComplete: () => img.destroy(),
    });
  }
}
