import Phaser from 'phaser';
import { FILE_ASSETS } from './atlas';
import { overlayPlacement } from './spriteOverlay';

export interface Spot {
  x: number;
  y: number;
}

export interface TableDealSpec {
  nativeW: number;
  nativeH: number;
  /** Felt center in native source-art pixels. Cards are laid from each seat
   *  toward this point, the way a player's hand sits in front of their bet. */
  center: Spot;
  /** Betting spots on the felt, in native source-art pixels. Chips stack on
   *  the spot; cards land just inside it. Empty for games with no per-seat
   *  card action (craps). */
  seats: Spot[];
  /** Shared board cards (poker), left→right in native pixels. */
  community?: Spot[];
  /** Where thrown dice come to rest (craps), in native pixels. */
  dice?: Spot[];
}

// Native-pixel piece sizes, tuned against the betting boxes printed on the
// felt art: a card fills a box (~25x18 native on blackjack) without spilling
// over it, and a chip is a bit over half a card wide. These are pre-scale —
// TableDealFx multiplies by displayW/nativeW (0.5 at the shipped table sizes).
const CARD_W = 14;
const CARD_H = 18;
const CHIP = 8;
const DIE = 9;

// poker-table.png and high-limit-table.png had their baked-in chip/card art
// patched out to plain felt (see scripts/); blackjack-table.png and
// craps-table.png already ship with usable felt.
export const POKER_DEAL: TableDealSpec = {
  nativeW: 440,
  nativeH: 297,
  center: { x: 215, y: 113 },
  // Six seats spaced around the inner rim of the felt oval.
  seats: [
    { x: 324, y: 140 },
    { x: 215, y: 168 },
    { x: 106, y: 140 },
    { x: 106, y: 86 },
    { x: 215, y: 58 },
    { x: 324, y: 86 },
  ],
  community: [
    { x: 185, y: 113 },
    { x: 200, y: 113 },
    { x: 215, y: 113 },
    { x: 230, y: 113 },
    { x: 245, y: 113 },
  ],
};

export const HIGH_LIMIT_DEAL: TableDealSpec = {
  nativeW: 423,
  nativeH: 320,
  center: { x: 185, y: 110 },
  seats: [
    { x: 143, y: 157 },
    { x: 196, y: 159 },
    { x: 240, y: 148 },
    { x: 272, y: 139 },
  ],
};

export const BLACKJACK_DEAL: TableDealSpec = {
  nativeW: 439,
  nativeH: 322,
  center: { x: 215, y: 105 },
  // The six betting boxes printed on blackjack-table.png, measured off the art.
  seats: [
    { x: 302, y: 63 },
    { x: 303, y: 94 },
    { x: 273, y: 127 },
    { x: 227, y: 147 },
    { x: 175, y: 151 },
    { x: 128, y: 143 },
  ],
};

export const CRAPS_DEAL: TableDealSpec = {
  nativeW: 438,
  nativeH: 288,
  center: { x: 240, y: 130 },
  // Craps has no player cards — chips ride the line bets, dice land in the middle.
  seats: [
    { x: 200, y: 155 },
    { x: 236, y: 143 },
    { x: 272, y: 124 },
    { x: 300, y: 108 },
  ],
  dice: [
    { x: 249, y: 132 },
    { x: 259, y: 137 },
  ],
};

const CHIP_KEYS = ['img-chip-white', 'img-chip-blue', 'img-chip-red', 'img-chip-green', 'img-chip-black'];
const DIE_KEYS = ['fx-die-1', 'fx-die-2', 'fx-die-3', 'fx-die-4', 'fx-die-5', 'fx-die-6'];
// Whatever card faces the atlas actually ships (the sheet came up short of a
// full deck) — face-up cards read as a hand in play far better than backs.
const CARD_FACE_KEYS = FILE_ASSETS.map((a) => a.key).filter(
  (k) => k.startsWith('img-card-') && k !== 'img-card-back',
);

/**
 * Ambient "round in progress" loop for one table: bets go down on a random
 * subset of seats, cards (or dice) follow, the round holds long enough to
 * read, then everything clears and the next round starts.
 * Cosmetic only — not wired to the sim's real bet/deal state.
 */
export class TableDealFx {
  /** Every piece currently on the table, including a cycle that is still
   *  fading out while the next one deals — destroy() has to catch them all. */
  private live = new Set<Phaser.GameObjects.Image>();
  private cycle: Phaser.GameObjects.Image[] = [];
  /** Cards left to deal this round — drawn without replacement so the same
   *  face never shows up twice on one table. */
  private shoe: string[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
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

  /** Place one piece at a native-pixel point on the table art, starting small
   *  and transparent; the caller tweens it up to its target size. */
  private placeAt(key: string, nx: number, ny: number, w: number, h: number, angle: number): Phaser.GameObjects.Image {
    const pos = overlayPlacement(this.cabinetX, this.cabinetY, this.scale, this.spec.nativeW, this.spec.nativeH, {
      x0: nx,
      y0: ny,
      x1: nx + 1,
      y1: ny + 1,
    });
    const targetW = w * this.scale;
    const targetH = h * this.scale;
    const piece = this.scene.add
      .image(pos.x, pos.y, key)
      .setDisplaySize(targetW * 0.4, targetH * 0.4)
      .setAngle(angle)
      .setDepth(this.depth + 1)
      .setAlpha(0)
      .setData('targetW', targetW)
      .setData('targetH', targetH);
    this.cycle.push(piece);
    this.live.add(piece);
    return piece;
  }

  private drawCard(): string {
    if (this.shoe.length === 0) this.shoe = Phaser.Utils.Array.Shuffle([...CARD_FACE_KEYS]);
    return this.shoe.pop() as string;
  }

  private popIn(piece: Phaser.GameObjects.Image, delay: number, duration = 190): void {
    this.scene.tweens.add({
      targets: piece,
      alpha: 1,
      displayWidth: piece.getData('targetW') as number,
      displayHeight: piece.getData('targetH') as number,
      duration,
      delay,
      ease: 'Back.easeOut',
    });
  }

  /** A short stack of chips sitting on a betting spot. */
  private betAt(seat: Spot, delay: number): void {
    const count = Phaser.Math.Between(1, 3);
    const key = Phaser.Utils.Array.GetRandom(CHIP_KEYS);
    for (let i = 0; i < count; i++) {
      const chip = this.placeAt(
        i === 0 ? key : Phaser.Utils.Array.GetRandom(CHIP_KEYS),
        seat.x + Phaser.Math.Between(-1, 1),
        seat.y - i * 1.4,
        CHIP,
        CHIP,
        0,
      );
      this.popIn(chip, delay + i * 70, 150);
    }
  }

  /** Two cards laid just inside the betting spot, angled toward the felt center. */
  private handAt(seat: Spot, delay: number): void {
    const dx = this.spec.center.x - seat.x;
    const dy = this.spec.center.y - seat.y;
    const len = Math.hypot(dx, dy) || 1;
    const towardCenter = { x: (dx / len) * 12, y: (dy / len) * 12 };
    for (let i = 0; i < 2; i++) {
      const card = this.placeAt(
        this.drawCard(),
        seat.x + towardCenter.x + i * 4,
        seat.y + towardCenter.y + i * 2.5,
        CARD_W,
        CARD_H,
        Phaser.Math.Between(-14, 14),
      );
      this.popIn(card, delay + i * 130);
    }
  }

  /** Dice hop into the middle of the layout and settle. */
  private throwDice(spots: Spot[], delay: number): void {
    spots.forEach((spot, i) => {
      const die = this.placeAt(
        Phaser.Utils.Array.GetRandom(DIE_KEYS),
        spot.x,
        spot.y,
        DIE,
        DIE,
        Phaser.Math.Between(-25, 25),
      );
      this.popIn(die, delay + i * 90, 160);
      const restY = die.y;
      this.scene.tweens.add({
        targets: die,
        y: restY - 5 * this.scale,
        delay: delay + i * 90,
        duration: 130,
        yoyo: true,
        repeat: 1,
        ease: 'Quad.easeOut',
      });
    });
  }

  private dealCycle(): void {
    if (this.destroyed) return;
    this.cycle = [];

    const seats = Phaser.Utils.Array.Shuffle([...this.spec.seats]).slice(
      0,
      Phaser.Math.Between(2, Math.max(2, this.spec.seats.length - 1)),
    );

    // Bets first, then the deal — the order a real round plays in.
    seats.forEach((seat, i) => this.betAt(seat, i * 110));
    const dealStart = seats.length * 110 + 260;
    if (this.spec.dice) {
      this.throwDice(this.spec.dice, dealStart);
    } else {
      seats.forEach((seat, i) => this.handAt(seat, dealStart + i * 150));
    }
    if (this.spec.community) {
      this.spec.community.forEach((spot, i) => {
        const card = this.placeAt(
          this.drawCard(),
          spot.x,
          spot.y,
          CARD_W,
          CARD_H,
          Phaser.Math.Between(-4, 4),
        );
        // Flop lands together, turn and river follow.
        this.popIn(card, dealStart + 420 + (i < 3 ? i * 90 : 320 + (i - 3) * 380));
      });
    }

    const pieces = this.cycle;
    const hold = dealStart + Phaser.Math.Between(2600, 3600);
    this.timers.push(
      this.scene.time.delayedCall(hold, () => {
        if (this.destroyed) return;
        this.scene.tweens.add({
          targets: pieces,
          alpha: 0,
          displayWidth: (target: Phaser.GameObjects.Image) => target.displayWidth * 0.4,
          displayHeight: (target: Phaser.GameObjects.Image) => target.displayHeight * 0.4,
          duration: 220,
          ease: 'Quad.easeIn',
          onComplete: () => {
            for (const p of pieces) {
              this.live.delete(p);
              p.destroy();
            }
            this.timers.push(
              this.scene.time.delayedCall(Phaser.Math.Between(900, 1800), () => this.dealCycle()),
            );
          },
        });
      }),
    );
  }

  destroy(): void {
    this.destroyed = true;
    for (const t of this.timers) t.remove();
    this.timers = [];
    for (const p of this.live) {
      this.scene.tweens.killTweensOf(p);
      p.destroy();
    }
    this.live.clear();
    this.cycle = [];
  }
}
