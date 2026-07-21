import Phaser from 'phaser';
import { TILE_H } from '../../config';
import { eventBus } from '../../EventBus';
import { world } from '../../gameContext';
import { gridToScreen } from '../iso';
import { GUEST_VARIANTS } from '../placeholders';

const POOL_MAX = 160;
const BOB_AMPLITUDE = 1.6; // px — subtle excitement while seated at a game
const BOB_SPEED = 0.008; // radians per ms
const SHAKE_AMPLITUDE = 3; // px — sine-wave horizontal shake while raging
const SHAKE_SPEED = 0.02; // radians per ms
const CELEBRATE_BOB_MULT = 2.2; // bigger bob than the normal seated bob

// Guest sprites polled from world.guests each frame; spawn/despawn via events.
// Movement interpolates the sim's moveFrom→moveTo step plus the frame fraction.
// Each guest keeps a stable outfit variant; the walk alternates two frames.
// Despawned sprites go to a pool instead of being destroyed — guests churn
// constantly and a full casino holds 100+ at once.
export class GuestViews {
  private scene: Phaser.Scene;
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private baseKeys = new Map<string, string>();
  private pool: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    eventBus.on('guestSpawned', ({ id }) => {
      const variant = (Number(id.slice(2)) || 0) % GUEST_VARIANTS;
      const base = `char-guest-${variant}`;
      this.sprites.set(id, this.obtain(`${base}-a`));
      this.baseKeys.set(id, base);
    });
    eventBus.on('guestLeft', ({ id }) => {
      const img = this.sprites.get(id);
      if (img) this.release(img);
      this.sprites.delete(id);
      this.baseKeys.delete(id);
    });
    eventBus.on('worldReset', () => {
      for (const img of this.sprites.values()) this.release(img);
      this.sprites.clear();
      this.baseKeys.clear();
    });
  }

  spriteFor(id: string): Phaser.GameObjects.Image | undefined {
    return this.sprites.get(id);
  }

  /** frameAlpha: fraction of the current sim tick already elapsed (0..1). */
  update(frameAlpha: number): void {
    const now = this.scene.time.now;
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
      // Playing guests bob in their seat; celebrating guests bob bigger.
      // The phase offset (guest id) desyncs neighbors.
      const idPhase = Number(id.slice(2)) || 0;
      const bobActive = guest.state === 'play' || guest.celebrating;
      const bobMult = guest.celebrating ? CELEBRATE_BOB_MULT : 1;
      const bob = bobActive
        ? Math.abs(Math.sin(now * BOB_SPEED + idPhase)) * BOB_AMPLITUDE * bobMult
        : 0;
      const shake = guest.raging ? Math.sin(now * SHAKE_SPEED + idPhase) * SHAKE_AMPLITUDE : 0;
      img.setPosition(s.x + shake, s.y + TILE_H / 2 - bob).setDepth(s.y);
      img.setTint(guest.raging ? 0xff6b6b : 0xffffff);

      const frame = guest.moveTo && (from.col + from.row) % 2 === 0 ? 'b' : 'a';
      const key = `${this.baseKeys.get(id)}-${frame}`;
      if (img.texture.key !== key) img.setTexture(key);
    }
  }

  private obtain(key: string): Phaser.GameObjects.Image {
    const img = this.pool.pop();
    if (img) {
      return img.setTexture(key).setVisible(true).setActive(true);
    }
    return this.scene.add.image(0, 0, key).setOrigin(0.5, 1);
  }

  private release(img: Phaser.GameObjects.Image): void {
    if (this.pool.length >= POOL_MAX) {
      img.destroy();
      return;
    }
    img.setVisible(false).setActive(false);
    this.pool.push(img);
  }
}
