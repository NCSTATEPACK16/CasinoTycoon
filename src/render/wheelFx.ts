import Phaser from 'phaser';
import { overlayPlacement } from './spriteOverlay';

export interface WheelSpec {
  diskKey: string;
  nativeW: number;
  nativeH: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  // Force a square (circular) display even if the box crop isn't perfectly
  // square, so the disc spins in place instead of wobbling into an oval.
  circular?: boolean;
}

// Disc crops (public/sprites/wheels/*.png) are the same pixels as the base
// cabinet art, elliptically masked and re-saved. Overlaying one atop the
// identical spot on the (unmodified) base sprite and rotating it in place
// simulates a spinning wheel without a per-frame sprite sheet — the static
// stand/rail/pointer around it belongs to the base layer and never moves.
export const ROULETTE_WHEEL: WheelSpec = {
  diskKey: 'img-roulette-disc',
  nativeW: 440,
  nativeH: 269,
  box: { x0: 283, y0: 86, x1: 393, y1: 168 },
};

export const BIG_SIX_WHEEL: WheelSpec = {
  diskKey: 'img-big-six-disc',
  nativeW: 162,
  nativeH: 280,
  box: { x0: 5, y0: 12, x1: 157, y1: 182 },
  circular: true,
};

/**
 * A wheel that gets "spun": fast decelerating rotation, a pause to read the
 * result, spin again. Continuous constant rotation reads more like a fan
 * than a game in progress, so this fakes the arcade rhythm instead.
 */
export class WheelFx {
  private disc: Phaser.GameObjects.Image;
  private timer?: Phaser.Time.TimerEvent;
  private tween?: Phaser.Tweens.Tween;
  private destroyed = false;

  constructor(
    private scene: Phaser.Scene,
    cabinetX: number,
    cabinetY: number,
    depth: number,
    displayW: number,
    spec: WheelSpec,
  ) {
    const scale = displayW / spec.nativeW;
    const pos = overlayPlacement(cabinetX, cabinetY, scale, spec.nativeW, spec.nativeH, spec.box);
    const size = spec.circular ? Math.min(pos.w, pos.h) : undefined;
    this.disc = scene.add
      .image(pos.x, pos.y, spec.diskKey)
      .setDisplaySize(size ?? pos.w, size ?? pos.h)
      .setDepth(depth + 1);
    this.spin();
  }

  private spin(): void {
    if (this.destroyed) return;
    const revolutions = 4 + Math.floor(Math.random() * 3);
    this.tween = this.scene.tweens.add({
      targets: this.disc,
      rotation: this.disc.rotation + Math.PI * 2 * revolutions,
      duration: 3200,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (this.destroyed) return;
        this.timer = this.scene.time.delayedCall(1800, () => this.spin());
      },
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.timer?.remove();
    this.tween?.remove();
    this.disc.destroy();
  }
}
