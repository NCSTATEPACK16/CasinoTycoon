import Phaser from 'phaser';
import { overlayPlacement } from './spriteOverlay';

// Pixel-space boxes within the 154x260 slot-machine.png source art (see
// scripts/optimize-sprites.mjs sibling crops slot-machine-{marquee,reel,lights-*}.png).
// The base texture already has these regions baked in dim/idle — these overlays
// are the same crops at full brightness, animated on top so the cabinet never
// needs a per-frame sprite sheet.
const NATIVE_W = 154;
const NATIVE_H = 260;
const MARQUEE_BOX = { x0: 15, y0: 0, x1: 146, y1: 63 };
const REEL_BOX = { x0: 26, y0: 84, x1: 128, y1: 152 };
const LIGHTS_BOXES = [
  { key: 'img-slot-machine-lights-a', y0: 57, y1: 68 },
  { key: 'img-slot-machine-lights-b', y0: 68, y1: 79 },
  { key: 'img-slot-machine-lights-c', y0: 79, y1: 91 },
] as const;
const LIGHTS_X0 = 121;
const LIGHTS_X1 = 154;

/**
 * Marquee + side-light + reel-spin overlays for one placed slot machine.
 * Three independent Phaser tweens per instance (not pooled like GlowPool)
 * since each cabinet's reel cycle runs on its own random outcome timer.
 */
export class SlotMachineFx {
  private images: Phaser.GameObjects.Image[] = [];
  private tweens: Phaser.Tweens.Tween[] = [];
  private reelTimer?: Phaser.Time.TimerEvent;

  constructor(
    private scene: Phaser.Scene,
    cabinetX: number,
    cabinetY: number,
    depth: number,
    displayW: number,
  ) {
    const scale = displayW / NATIVE_W;

    const marqueePos = overlayPlacement(cabinetX, cabinetY, scale, NATIVE_W, NATIVE_H, MARQUEE_BOX);
    const marquee = scene.add
      .image(marqueePos.x, marqueePos.y, 'img-slot-machine-marquee')
      .setDisplaySize(marqueePos.w, marqueePos.h)
      .setDepth(depth + 1);
    this.images.push(marquee);
    // Bulbs snap to 30% dim (matching the base art underneath), hold, snap
    // back to full brightness, hold — a blink, not a smooth sine pulse.
    this.tweens.push(
      scene.tweens.add({
        targets: marquee,
        alpha: 0.3,
        duration: 90,
        hold: 200,
        yoyo: true,
        repeatDelay: 300,
        repeat: -1,
      }),
    );

    for (const [i, spec] of LIGHTS_BOXES.entries()) {
      const box = { x0: LIGHTS_X0, y0: spec.y0, x1: LIGHTS_X1, y1: spec.y1 };
      const pos = overlayPlacement(cabinetX, cabinetY, scale, NATIVE_W, NATIVE_H, box);
      const light = scene.add
        .image(pos.x, pos.y, spec.key)
        .setDisplaySize(pos.w, pos.h)
        .setDepth(depth + 1);
      this.images.push(light);
      this.tweens.push(
        scene.tweens.add({
          targets: light,
          alpha: 0.4,
          duration: 700,
          yoyo: true,
          repeat: -1,
          delay: i * 350,
          ease: 'Sine.easeInOut',
        }),
      );
    }

    const reelPos = overlayPlacement(cabinetX, cabinetY, scale, NATIVE_W, NATIVE_H, REEL_BOX);
    const reel = scene.add
      .image(reelPos.x, reelPos.y, 'img-slot-machine-reel')
      .setDisplaySize(reelPos.w, reelPos.h)
      .setDepth(depth + 1)
      .setAlpha(0);
    this.images.push(reel);
    this.runReelCycle(reel);
  }

  // Base art already shows the reel window dim/blurred (idle). Every cycle:
  // hold idle for the "spin" duration, then reveal the jackpot art with a
  // quick pop-in, hold it, fade back to idle, repeat. Only one outcome
  // (jackpot) exists in the source art today — win/loss variants would need
  // new symbol art, which is out of scope here.
  private runReelCycle(reel: Phaser.GameObjects.Image): void {
    const SPIN_MS = 3000;
    const HOLD_MS = 1000;
    this.reelTimer = this.scene.time.delayedCall(SPIN_MS, () => {
      const targetScale = reel.scaleY;
      reel.setScale(reel.scaleX, targetScale * 0.9);
      this.scene.tweens.add({
        targets: reel,
        alpha: 1,
        scaleY: targetScale,
        duration: 220,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.reelTimer = this.scene.time.delayedCall(HOLD_MS, () => {
            this.scene.tweens.add({
              targets: reel,
              alpha: 0,
              duration: 250,
              ease: 'Quad.easeIn',
              onComplete: () => this.runReelCycle(reel),
            });
          });
        },
      });
    });
  }

  destroy(): void {
    this.reelTimer?.remove();
    for (const t of this.tweens) t.remove();
    for (const img of this.images) img.destroy();
    this.images = [];
    this.tweens = [];
  }
}
