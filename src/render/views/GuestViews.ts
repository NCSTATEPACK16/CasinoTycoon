import Phaser from 'phaser';
import { TILE_H } from '../../config';
import { eventBus } from '../../EventBus';
import { GUEST_BALANCE } from '../../data/balance';
import { world } from '../../gameContext';
import { gridToScreen } from '../iso';

// Guest sprites polled from world.guests each frame; spawn/despawn via events.
// Movement interpolates the sim's moveFrom→moveTo step plus the frame fraction.
export class GuestViews {
  private scene: Phaser.Scene;
  private sprites = new Map<string, Phaser.GameObjects.Image>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    eventBus.on('guestSpawned', ({ id }) => {
      const img = this.scene.add.image(0, 0, 'char-guest').setOrigin(0.5, 1);
      this.sprites.set(id, img);
    });
    eventBus.on('guestLeft', ({ id }) => {
      this.sprites.get(id)?.destroy();
      this.sprites.delete(id);
    });
  }

  /** frameAlpha: fraction of the current sim tick already elapsed (0..1). */
  update(frameAlpha: number): void {
    for (const [id, img] of this.sprites) {
      const guest = world.guests.get(id);
      if (!guest) continue;
      const from = guest.moveFrom;
      const to = guest.moveTo ?? from;
      const t = guest.moveTo
        ? Math.min(1, (guest.moveTick + frameAlpha) / GUEST_BALANCE.moveTicksPerTile)
        : 0;
      const col = from.col + (to.col - from.col) * t;
      const row = from.row + (to.row - from.row) * t;
      const s = gridToScreen(col, row);
      img.setPosition(s.x, s.y + TILE_H / 2).setDepth(s.y);
    }
  }
}
