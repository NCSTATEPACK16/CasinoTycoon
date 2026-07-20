import Phaser from 'phaser';

export interface GlowSpec {
  key: string;
  color: number; // neon tube color, e.g. 0xff3ec8
  width: number;
  height: number;
  radius?: number;
}

const GLOWS: GlowSpec[] = [
  { key: 'glow-sign-small', color: 0xff3ec8, width: 60, height: 24 },
  { key: 'glow-sign-large', color: 0x3ec8ff, width: 120, height: 40 },
];

/**
 * Bakes a soft glow (blurred rounded rect) once onto an offscreen canvas and
 * uploads it as a normal texture. shadowBlur is a Canvas2D idiom we can't
 * afford per-frame in WebGL — paying the cost once here means every future
 * use of this texture is a plain, cheap sprite draw.
 */
function bakeGlow(scene: Phaser.Scene, spec: GlowSpec): void {
  if (scene.textures.exists(spec.key)) return;
  const pad = 24;
  const w = spec.width + pad * 2;
  const h = spec.height + pad * 2;
  const canvasTexture = scene.textures.createCanvas(spec.key, w, h);
  if (!canvasTexture) return;
  const ctx = canvasTexture.context;
  const hex = `#${spec.color.toString(16).padStart(6, '0')}`;
  const r = spec.radius ?? 6;

  ctx.save();
  ctx.fillStyle = hex;
  ctx.shadowColor = hex;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.roundRect(pad, pad, spec.width, spec.height, r);
  ctx.fill();
  ctx.shadowBlur = 4; // second pass so the tube itself reads bright, not just its halo
  ctx.fill();
  ctx.restore();
  canvasTexture.refresh();
}

export function generateNeonGlows(scene: Phaser.Scene): void {
  for (const spec of GLOWS) bakeGlow(scene, spec);
}

/**
 * One shared alpha-pulse tween drives every sprite added to a pool — N glow
 * sprites cost one tween, not N (perf guardrail: no per-object postFX).
 */
export class GlowPool {
  private sprites: Phaser.GameObjects.Image[] = [];
  private pulse = 1;

  constructor(scene: Phaser.Scene) {
    scene.tweens.add({
      targets: this,
      pulse: 0.75,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        for (const s of this.sprites) s.setAlpha(this.pulse);
      },
    });
  }

  add(sprite: Phaser.GameObjects.Image): void {
    this.sprites.push(sprite);
  }

  remove(sprite: Phaser.GameObjects.Image): void {
    this.sprites = this.sprites.filter((s) => s !== sprite);
  }
}
