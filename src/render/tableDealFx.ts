import Phaser from 'phaser';
import { overlayPlacement } from './spriteOverlay';

export interface TableDealSpec {
  nativeW: number;
  nativeH: number;
  // Where the "hand" appears, in native source-art pixel coordinates. Chips
  // and cards scatter around this point.
  anchor: { x: number; y: number };
}

// poker-table.png and high-limit-table.png had their baked-in chip/card art
// patched out to plain felt (see scripts/); blackjack-table.png already ships
// with empty felt, so it just needed an anchor point.
export const POKER_DEAL: TableDealSpec = {
  nativeW: 440,
  nativeH: 297,
  anchor: { x: 235, y: 108 },
};

export const HIGH_LIMIT_DEAL: TableDealSpec = {
  nativeW: 423,
  nativeH: 320,
  anchor: { x: 209, y: 72 },
};

export const BLACKJACK_DEAL: TableDealSpec = {
  nativeW: 439,
  nativeH: 322,
  anchor: { x: 280, y: 160 },
};

const CHIP_KEYS = ['img-chip-white', 'img-chip-blue', 'img-chip-red', 'img-chip-green'];
const CHIP_DISPLAY = 12;
const CARD_DISPLAY_W = 16;
const CARD_DISPLAY_H = 22;

// Scatter offsets in native pixels (pre-scale), roughly matching how the
// original baked art spread chips/cards around the anchor point.
const CHIP_OFFSETS = [
  { x: -18, y: 4 },
  { x: -6, y: -6 },
  { x: 8, y: 6 },
  { x: 20, y: -4 },
];
const CARD_OFFSETS = [
  { x: 30, y: 16 },
  { x: 42, y: 24 },
];

/**
 * Ambient "hand in progress" loop for one table: chips and cards pop in
 * staggered, hold so it reads as a round in play, then clear and repeat.
 * Cosmetic only — not wired to the sim's real bet/deal state.
 */
export class TableDealFx {
  private pieces: Phaser.GameObjects.Image[] = [];
  private timer?: Phaser.Time.TimerEvent;
  private destroyed = false;
  private scale: number;

  constructor(
    private scene: Phaser.Scene,
    private cabinetX: number,
    private cabinetY: number,
    private depth: number,
    displayW: number,
    private spec: TableDealSpec,
  ) {
    this.scale = displayW / spec.nativeW;
    this.dealCycle();
  }

  private placeAt(key: string, offsetX: number, offsetY: number, w: number, h: number): Phaser.GameObjects.Image {
    const box = {
      x0: this.spec.anchor.x + offsetX,
      y0: this.spec.anchor.y + offsetY,
      x1: this.spec.anchor.x + offsetX + 1,
      y1: this.spec.anchor.y + offsetY + 1,
    };
    const pos = overlayPlacement(this.cabinetX, this.cabinetY, this.scale, this.spec.nativeW, this.spec.nativeH, box);
    return this.scene.add
      .image(pos.x, pos.y, key)
      .setDisplaySize(w * this.scale, h * this.scale)
      .setDepth(this.depth + 1)
      .setAlpha(0)
      .setScale(0.4);
  }

  private dealCycle(): void {
    if (this.destroyed) return;
    const pieces: Phaser.GameObjects.Image[] = [];

    CARD_OFFSETS.forEach((offset, i) => {
      const card = this.placeAt('img-card-back', offset.x, offset.y, CARD_DISPLAY_W, CARD_DISPLAY_H);
      pieces.push(card);
      this.scene.tweens.add({
        targets: card,
        alpha: 1,
        scale: this.scale,
        duration: 200,
        delay: i * 120,
        ease: 'Back.easeOut',
      });
    });

    CHIP_OFFSETS.forEach((offset, i) => {
      const key = CHIP_KEYS[i % CHIP_KEYS.length] as string;
      const chip = this.placeAt(key, offset.x, offset.y, CHIP_DISPLAY, CHIP_DISPLAY);
      pieces.push(chip);
      this.scene.tweens.add({
        targets: chip,
        alpha: 1,
        scale: this.scale,
        duration: 180,
        delay: 260 + i * 90,
        ease: 'Back.easeOut',
      });
    });

    this.pieces = pieces;

    this.timer = this.scene.time.delayedCall(3200, () => {
      if (this.destroyed) return;
      this.scene.tweens.add({
        targets: pieces,
        alpha: 0,
        scale: 0.4,
        duration: 220,
        ease: 'Quad.easeIn',
        onComplete: () => {
          for (const p of pieces) p.destroy();
          this.timer = this.scene.time.delayedCall(1400, () => this.dealCycle());
        },
      });
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.timer?.remove();
    for (const p of this.pieces) p.destroy();
    this.pieces = [];
  }
}
