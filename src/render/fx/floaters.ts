import Phaser from 'phaser';
import { eventBus } from '../../EventBus';
import { getObjectDef } from '../../data/objects';
import { world } from '../../gameContext';
import { objectTransform, type ObjectViews } from '../views/ObjectViews';

const DEPTH_FX = 20000;

/** Floating money text on plays + gray-out and smoke puffs on breakdowns. */
export function attachFx(scene: Phaser.Scene, views: ObjectViews): void {
  const smokeTimers = new Map<string, Phaser.Time.TimerEvent>();

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
  const label = scene.add
    .text(x, y, text, { fontFamily: 'Verdana', fontSize: '13px', fontStyle: 'bold', color })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH_FX)
    .setAlpha(delay > 0 ? 0 : 1);
  scene.tweens.add({
    targets: label,
    alpha: { from: 1, to: 0 },
    y: y - 46,
    delay,
    duration: 900,
    ease: 'Quad.easeOut',
    onComplete: () => label.destroy(),
  });
}

function puff(scene: Phaser.Scene, x: number, y: number): void {
  const img = scene.add.image(x, y, 'fx-smoke').setDepth(DEPTH_FX).setAlpha(0.8).setScale(0.6);
  scene.tweens.add({
    targets: img,
    y: y - 34,
    alpha: 0,
    scale: 1.4,
    duration: 750,
    ease: 'Quad.easeOut',
    onComplete: () => img.destroy(),
  });
}
