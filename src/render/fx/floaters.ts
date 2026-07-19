import Phaser from 'phaser';
import { eventBus } from '../../EventBus';
import { JACKPOT_PAYOUT_MULT } from '../../config';
import { getObjectDef } from '../../data/objects';
import { world } from '../../gameContext';
import { objectTransform, type ObjectViews } from '../views/ObjectViews';

const DEPTH_FX = 20000;
// Full jackpot celebration (shake + flash + ticker) at most this often; the
// coin burst and fanfare still fire per jackpot.
const CELEBRATION_COOLDOWN_MS = 8000;
const COINS_PER_BURST = 12;

// Machines fire floaters constantly at full load — recycle the display
// objects instead of allocating/destroying them every play.
class ImagePool {
  private free: Phaser.GameObjects.Image[] = [];
  constructor(
    private scene: Phaser.Scene,
    private key: string,
  ) {}

  obtain(): Phaser.GameObjects.Image {
    return (
      this.free.pop()?.setVisible(true).setActive(true) ??
      this.scene.add.image(0, 0, this.key).setDepth(DEPTH_FX)
    );
  }

  release(img: Phaser.GameObjects.Image): void {
    img.setVisible(false).setActive(false);
    this.free.push(img);
  }
}

class TextPool {
  private free: Phaser.GameObjects.Text[] = [];
  constructor(private scene: Phaser.Scene) {}

  obtain(): Phaser.GameObjects.Text {
    return (
      this.free.pop()?.setVisible(true).setActive(true) ??
      this.scene.add
        .text(0, 0, '', { fontFamily: 'Verdana', fontSize: '13px', fontStyle: 'bold' })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH_FX)
    );
  }

  release(label: Phaser.GameObjects.Text): void {
    label.setVisible(false).setActive(false);
    this.free.push(label);
  }
}

let texts: TextPool;
let smokes: ImagePool;
let coins: ImagePool;

/** Floating money text on plays, smoke on breakdowns, coin bursts on jackpots. */
export function attachFx(scene: Phaser.Scene, views: ObjectViews): void {
  texts = new TextPool(scene);
  smokes = new ImagePool(scene, 'fx-smoke');
  coins = new ImagePool(scene, 'fx-coin');
  const smokeTimers = new Map<string, Phaser.Time.TimerEvent>();
  let lastCelebration = -Infinity;

  const machineTop = (machineId: string): { x: number; y: number } | null => {
    const po = world.state.getObject(machineId);
    if (!po) return null;
    const def = getObjectDef(po.defId);
    if (!def) return null;
    const t = objectTransform(def, po.col, po.row);
    return { x: t.x, y: t.y - 64 };
  };

  eventBus.on('machinePlayed', ({ machineId, wager, payout }) => {
    const at = machineTop(machineId);
    if (!at) return;
    floatText(scene, at.x, at.y, `+$${wager}`, '#7ee787');
    if (payout > 0) floatText(scene, at.x, at.y + 16, `-$${payout}`, '#ff7b72', 180);

    if (payout >= wager * JACKPOT_PAYOUT_MULT) {
      coinBurst(scene, at.x, at.y + 20);
      floatText(scene, at.x, at.y - 14, 'JACKPOT!', '#e8b93c');
      const now = scene.time.now;
      if (now - lastCelebration >= CELEBRATION_COOLDOWN_MS) {
        lastCelebration = now;
        scene.cameras.main.flash(220, 255, 214, 90, false);
        scene.cameras.main.shake(180, 0.0035);
        eventBus.emit('tickerMessage', { text: `Jackpot! A lucky guest wins $${payout}!` });
      }
    }
  });

  eventBus.on('machineBroke', ({ machineId }) => {
    views.spriteFor(machineId)?.setTint(0x8a8a8a);
    if (smokeTimers.has(machineId)) return;
    const timer = scene.time.addEvent({
      delay: 550,
      loop: true,
      callback: () => {
        const at = machineTop(machineId);
        if (at) puff(scene, at.x + Phaser.Math.Between(-6, 6), at.y + 8);
      },
    });
    smokeTimers.set(machineId, timer);
  });

  eventBus.on('machineFixed', ({ machineId }) => {
    views.spriteFor(machineId)?.clearTint();
    smokeTimers.get(machineId)?.remove();
    smokeTimers.delete(machineId);
    const at = machineTop(machineId);
    if (at) floatText(scene, at.x, at.y, 'Fixed!', '#7ee787');
  });

  eventBus.on('objectSold', ({ id }) => {
    smokeTimers.get(id)?.remove();
    smokeTimers.delete(id);
  });

  eventBus.on('worldReset', () => {
    for (const timer of smokeTimers.values()) timer.remove();
    smokeTimers.clear();
  });
}

function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string,
  delay = 0,
): void {
  const label = texts.obtain();
  label
    .setText(text)
    .setColor(color)
    .setPosition(x, y)
    .setAlpha(delay > 0 ? 0 : 1);
  scene.tweens.add({
    targets: label,
    alpha: { from: 1, to: 0 },
    y: y - 46,
    delay,
    duration: 900,
    ease: 'Quad.easeOut',
    onComplete: () => texts.release(label),
  });
}

function puff(scene: Phaser.Scene, x: number, y: number): void {
  const img = smokes.obtain();
  img.setPosition(x, y).setAlpha(0.8).setScale(0.6);
  scene.tweens.add({
    targets: img,
    y: y - 34,
    alpha: 0,
    scale: 1.4,
    duration: 750,
    ease: 'Quad.easeOut',
    onComplete: () => smokes.release(img),
  });
}

/** Coins spray upward then rain past the machine, fading as they fall. */
function coinBurst(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < COINS_PER_BURST; i++) {
    const coin = coins.obtain();
    coin.setPosition(x, y).setAlpha(1).setScale(Phaser.Math.FloatBetween(0.7, 1.1));
    const dx = Phaser.Math.Between(-46, 46);
    const rise = Phaser.Math.Between(30, 70);
    scene.tweens.add({
      targets: coin,
      x: x + dx * 0.6,
      y: y - rise,
      angle: Phaser.Math.Between(-180, 180),
      duration: Phaser.Math.Between(160, 260),
      ease: 'Quad.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: coin,
          x: x + dx,
          y: y + 46,
          angle: coin.angle + Phaser.Math.Between(-180, 180),
          alpha: 0,
          duration: Phaser.Math.Between(380, 560),
          ease: 'Quad.easeIn',
          onComplete: () => coins.release(coin),
        });
      },
    });
  }
}
