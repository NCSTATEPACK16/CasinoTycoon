import Phaser from 'phaser';

const SKYLINE_KEY = 'bg-skyline';
const SKYLINE_W = 2400;
const SKYLINE_H = 700;

/**
 * Bakes a static gradient-sky + parallax-silhouette skyline once onto an
 * offscreen canvas (same "pay the cost once" idiom as neon.ts's glow bake).
 * Procedural, not a delivered asset — T6 explicitly allows this instead of
 * commissioning art.
 */
function bakeSkyline(scene: Phaser.Scene): void {
  if (scene.textures.exists(SKYLINE_KEY)) return;
  const canvasTexture = scene.textures.createCanvas(SKYLINE_KEY, SKYLINE_W, SKYLINE_H);
  if (!canvasTexture) return;
  const ctx = canvasTexture.context;

  const sky = ctx.createLinearGradient(0, 0, 0, SKYLINE_H);
  sky.addColorStop(0, '#0c0818');
  sky.addColorStop(0.6, '#1c1230');
  sky.addColorStop(1, '#3a1f3d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SKYLINE_W, SKYLINE_H);

  // Deterministic pseudo-random silhouette skyline — same seed every boot so
  // screenshots/diffs are stable, no need to pull in the sim's seeded rng.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  let x = 0;
  while (x < SKYLINE_W) {
    const w = 40 + rand() * 90;
    const h = 80 + rand() * 260;
    const shade = 10 + Math.floor(rand() * 10);
    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 6})`;
    ctx.fillRect(x, SKYLINE_H - h, w, h);
    // A few lit windows per building — small warm dots, not a grid (reads as
    // scattered late-night office lights, cheap to draw).
    const windowCount = Math.floor(w / 14);
    for (let i = 0; i < windowCount; i++) {
      if (rand() > 0.35) continue;
      const wx = x + 6 + rand() * (w - 12);
      const wy = SKYLINE_H - h + 10 + rand() * (h - 20);
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 200, 120, 0.8)' : 'rgba(255, 90, 180, 0.6)';
      ctx.fillRect(wx, wy, 3, 3);
    }
    x += w + 6 + rand() * 20;
  }
  canvasTexture.refresh();
}

/**
 * Distant skyline glimpsed past the wall edges (T6). Screen-fixed
 * (scrollFactor 0) rather than true world-parallax: it only needs to fill
 * the negative space around the diamond floor and above the wall roofline,
 * and a screen-fixed backdrop guarantees that regardless of camera bounds
 * clamping, with zero risk of exposing an edge. Sits at depth below the
 * floor (0) so it never occludes anything.
 */
export function createSkylineBackdrop(scene: Phaser.Scene): void {
  bakeSkyline(scene);
  const image = scene.add
    .image(0, 0, SKYLINE_KEY)
    .setOrigin(0.5, 1)
    .setScrollFactor(0)
    .setDepth(-1);

  const resize = () => {
    const { width, height } = scene.scale;
    image.setPosition(width / 2, height).setDisplaySize(Math.max(width, SKYLINE_W), height);
  };
  resize();
  scene.scale.on('resize', resize);
}
