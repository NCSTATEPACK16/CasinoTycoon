import Phaser from 'phaser';
import { TILE_H } from '../../config';
import { eventBus } from '../../EventBus';
import { world } from '../../gameContext';
import { gridToScreen } from '../iso';
import { GUEST_VARIANTS } from '../placeholders';

// Guest sprites polled from world.guests each frame; spawn/despawn via events.
// Movement interpolates the sim's moveFrom→moveTo step plus the frame fraction.
// Each guest keeps a stable outfit variant; the walk alternates two frames.
export class GuestViews {
  private scene: Phaser.Scene;
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private baseKeys = new Map<string, string>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    eventBus.on('guestSpawned', ({ id }) => {
      const variant = (Number(id.slice(2)) || 0) % GUEST_VARIANTS;
      const base = `char-guest-${variant}`;
      const img = this.scene.add.image(0, 0, `${base}-a`).setOrigin(0.5, 1);
      this.sprites.set(id, img);
      this.baseKeys.set(id, base);
    });
    eventBus.on('guestLeft', ({ id }) => {
      this.sprites.get(id)?.destroy();
      this.sprites.delete(id);
      this.baseKeys.delete(id);
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
        ? Math.min(1, (guest.moveTick + frameAlpha) / guest.moveTicksPerTile)
        : 0;
      const col = from.col + (to.col - from.col) * t;
      const row = from.row + (to.row - from.row) * t;
      const s = gridToScreen(col, row);
      img.setPosition(s.x, s.y + TILE_H / 2).setDepth(s.y);

      const frame = guest.moveTo && (from.col + from.row) % 2 === 0 ? 'b' : 'a';
      const key = `${this.baseKeys.get(id)}-${frame}`;
      if (img.texture.key !== key) img.setTexture(key);
    }
  }
}
