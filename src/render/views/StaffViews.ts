import Phaser from 'phaser';
import { TILE_H } from '../../config';
import { eventBus } from '../../EventBus';
import { world } from '../../gameContext';
import { gridToScreen } from '../iso';

// Staff sprites polled from world.staff each frame; spawn/despawn via events.
// A carried staffer (pincer) is positioned by the PincerController instead.
export class StaffViews {
  private scene: Phaser.Scene;
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private facingLeft = new Map<string, boolean>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    for (const s of world.staff.values()) this.spawn(s.id, s.kind);
    eventBus.on('staffHired', ({ id, kind }) => this.spawn(id, kind));
    eventBus.on('staffFired', ({ id }) => {
      this.sprites.get(id)?.destroy();
      this.sprites.delete(id);
      this.facingLeft.delete(id);
    });
    eventBus.on('worldReset', () => {
      for (const img of this.sprites.values()) img.destroy();
      this.sprites.clear();
      this.facingLeft.clear();
    });
    eventBus.on('worldLoaded', () => {
      for (const s of world.staff.values()) this.spawn(s.id, s.kind);
    });
  }

  private spawn(id: string, kind: string): void {
    const img = this.scene.add.image(0, 0, `char-${kind}-a`).setOrigin(0.5, 1);
    this.sprites.set(id, img);
    this.facingLeft.set(id, false);
  }

  spriteFor(id: string): Phaser.GameObjects.Image | undefined {
    return this.sprites.get(id);
  }

  /** Topmost staff sprite containing the world point, for pincer picking. */
  hitTest(wx: number, wy: number): string | null {
    let best: string | null = null;
    let bestDepth = -Infinity;
    for (const [id, img] of this.sprites) {
      if (img.getBounds().contains(wx, wy) && img.depth > bestDepth) {
        best = id;
        bestDepth = img.depth;
      }
    }
    return best;
  }

  /** frameAlpha: fraction of the current sim tick already elapsed (0..1). */
  update(frameAlpha: number, carriedId: string | null): void {
    for (const [id, img] of this.sprites) {
      if (id === carriedId) continue;
      const member = world.staff.get(id);
      if (!member) continue;
      const from = member.moveFrom;
      const to = member.moveTo ?? from;
      const t = member.moveTo
        ? Math.min(1, (member.moveTick + frameAlpha) / member.moveTicksPerTile)
        : 0;
      const col = from.col + (to.col - from.col) * t;
      const row = from.row + (to.row - from.row) * t;
      const s = gridToScreen(col, row);
      img.setPosition(s.x, s.y + TILE_H / 2).setDepth(s.y);

      // See GuestViews.update: screen-x delta sign covers all 4 grid directions.
      const dx = to.col - from.col - (to.row - from.row);
      if (member.moveTo && dx !== 0) this.facingLeft.set(id, dx < 0);
      img.setFlipX(this.facingLeft.get(id) ?? false);

      const frame = member.moveTo && (from.col + from.row) % 2 === 0 ? 'b' : 'a';
      const key = `char-${member.kind}-${frame}`;
      if (img.texture.key !== key) img.setTexture(key);
    }
  }
}
