import Phaser from 'phaser';
import { eventBus } from '../../EventBus';
import { getObjectDef } from '../../data/objects';
import { gameState } from '../../gameContext';
import { objectTransform } from '../views/ObjectViews';

const DUST_KEY = 'fx-dust';
// Below floaters.ts's DEPTH_FX (20000, jackpot coins/floating text) so those
// still read on top, but above regular objects/characters — ambient haze
// drifting in front of a table, not behind it.
const DEPTH_DUST = 15000;

function bakeDustTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(DUST_KEY)) return;
  const size = 12;
  const canvasTexture = scene.textures.createCanvas(DUST_KEY, size, size);
  if (!canvasTexture) return;
  const ctx = canvasTexture.context;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 235, 200, 0.9)');
  grad.addColorStop(1, 'rgba(255, 235, 200, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  canvasTexture.refresh();
}

/**
 * Dust motes drifting near table games (T6, purely additive/optional per its
 * own doc) — one subtle low-frequency emitter per placed 'game'-category
 * object, mirroring ObjectViews' objectPlaced/objectSold/worldReset/worldLoaded
 * lifecycle so it never leaks emitters across a sell or scenario reset.
 */
export function attachDustMotes(scene: Phaser.Scene): void {
  bakeDustTexture(scene);
  const emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

  const spawn = (id: string, defId: string, col: number, row: number): void => {
    const def = getObjectDef(defId);
    if (!def || def.category !== 'game') return;
    const t = objectTransform(def, col, row);
    const emitter = scene.add.particles(t.x, t.y - 40, DUST_KEY, {
      x: { min: -def.footprint.w * 24, max: def.footprint.w * 24 },
      y: { min: -20, max: 20 },
      lifespan: 4000,
      speedY: { min: -14, max: -6 },
      speedX: { min: -4, max: 4 },
      scale: { start: 0.5, end: 1.1 },
      alpha: { start: 0, ease: 'Sine.easeIn', end: 0.35 },
      frequency: 900,
      quantity: 1,
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(DEPTH_DUST);
    emitters.set(id, emitter);
  };

  const despawn = (id: string): void => {
    emitters.get(id)?.destroy();
    emitters.delete(id);
  };

  for (const po of gameState.allObjects()) spawn(po.id, po.defId, po.col, po.row);
  eventBus.on('objectPlaced', ({ id, defId, col, row }) => spawn(id, defId, col, row));
  eventBus.on('objectSold', ({ id }) => despawn(id));
  eventBus.on('worldReset', () => {
    for (const emitter of emitters.values()) emitter.destroy();
    emitters.clear();
  });
  eventBus.on('worldLoaded', () => {
    for (const po of gameState.allObjects()) spawn(po.id, po.defId, po.col, po.row);
  });
}
