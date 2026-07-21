import Phaser from 'phaser';
import { eventBus } from '../../EventBus';
import type { GuestViews } from '../views/GuestViews';

const DEPTH_BUBBLE = 20000;
const HOLD_MS = 1500;
const POP_MS = 220;
const FADE_MS = 260;
const MAX_ACTIVE = 40;

// Presentation-side glyphs for the sim's thought ids (data/thoughts.ts).
const EMOJI: Record<string, string> = {
  bathroom: '🚽',
  hungry: '🍔',
  tired: '😴',
  'low-cash': '💸',
  broke: '💰',
  great: '🤩',
  awful: '😠',
  filthy: '🤢',
  raging: '😡',
  celebrate: '💰',
};

interface Bubble {
  container: Phaser.GameObjects.Container;
  emoji: Phaser.GameObjects.Text;
  hold: Phaser.Time.TimerEvent | null;
}

/**
 * Emoji thought bubbles that pop in above a guest, follow them, then fade.
 * One bubble per guest (a new thought retargets it); bubbles are pooled.
 */
export class ThoughtBubbles {
  private scene: Phaser.Scene;
  private views: GuestViews;
  private active = new Map<string, Bubble>();
  private pool: Bubble[] = [];

  constructor(scene: Phaser.Scene, views: GuestViews) {
    this.scene = scene;
    this.views = views;
    eventBus.on('guestThought', ({ guestId, thoughtId }) => {
      this.show(guestId, EMOJI[thoughtId] ?? '💭');
    });
    eventBus.on('guestLeft', ({ id }) => this.dismiss(id));
    eventBus.on('worldReset', () => {
      for (const id of [...this.active.keys()]) this.dismiss(id);
    });
  }

  /** Called every frame after GuestViews.update so bubbles track their guest. */
  update(): void {
    for (const [guestId, bubble] of this.active) {
      const img = this.views.spriteFor(guestId);
      if (!img || !img.visible) {
        this.dismiss(guestId);
        continue;
      }
      bubble.container.setPosition(img.x, img.y - img.displayHeight - 4);
    }
  }

  private show(guestId: string, glyph: string): void {
    const existing = this.active.get(guestId);
    if (existing) {
      // Retarget: swap the glyph and restart the hold; no re-pop.
      existing.emoji.setText(glyph);
      existing.hold?.remove();
      existing.hold = this.scene.time.delayedCall(HOLD_MS, () => this.fadeOut(guestId));
      return;
    }
    if (this.active.size >= MAX_ACTIVE) return;

    const bubble = this.obtain();
    bubble.emoji.setText(glyph);
    bubble.container.setVisible(true).setAlpha(1).setScale(0);
    this.active.set(guestId, bubble);
    this.scene.tweens.add({
      targets: bubble.container,
      scale: 1,
      duration: POP_MS,
      ease: 'Back.easeOut',
    });
    bubble.hold = this.scene.time.delayedCall(HOLD_MS, () => this.fadeOut(guestId));
    this.update();
  }

  private fadeOut(guestId: string): void {
    const bubble = this.active.get(guestId);
    if (!bubble) return;
    this.scene.tweens.add({
      targets: bubble.container,
      alpha: 0,
      y: bubble.container.y - 10,
      duration: FADE_MS,
      ease: 'Quad.easeIn',
      onComplete: () => this.dismiss(guestId),
    });
  }

  private dismiss(guestId: string): void {
    const bubble = this.active.get(guestId);
    if (!bubble) return;
    this.active.delete(guestId);
    bubble.hold?.remove();
    bubble.hold = null;
    this.scene.tweens.killTweensOf(bubble.container);
    bubble.container.setVisible(false);
    this.pool.push(bubble);
  }

  private obtain(): Bubble {
    const pooled = this.pool.pop();
    if (pooled) return pooled;
    const back = this.scene.add.image(0, 0, 'fx-bubble').setOrigin(0.5, 1);
    const emoji = this.scene.add
      .text(0, -17, '💭', { fontSize: '14px' })
      .setOrigin(0.5, 0.5)
      .setResolution(2);
    const container = this.scene.add
      .container(0, 0, [back, emoji])
      .setDepth(DEPTH_BUBBLE)
      .setVisible(false);
    return { container, emoji, hold: null };
  }
}
