// scripts/optimize-sprites.mjs
// Two jobs on every FILE_ASSETS sprite (public/sprites/**):
//   1. Alpha recovery — P9/P10 both hit the same bug twice by hand (see
//      assets/ASSETS.md): "transparent" source exports that are actually
//      opaque RGBA with a checkerboard baked into the pixels. Generalized
//      into scripts/lib/sprite-alpha.mjs so every future asset-queue drop
//      gets it automatically instead of hand-patched again.
//   2. Downscale + recompress — the table PNGs are un-downscaled exports
//      (592KB-2.7MB) rendering at ~150-220px on screen. Resizing to ~2x
//      display size and re-deflating at max compression drops them to
//      tens of KB with no visible loss.
// Idempotent: real alpha is left untouched, and images already at or below
// target size are left untouched, so rerunning after an asset lands is safe.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { recoverAlpha, cropToContent, downscale, encode } from './lib/sprite-alpha.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// { file relative to public/, target: [maxW, maxH] | null }
// Target is ~2x the ObjectDef.displaySize (src/data/objects.ts) for catalog
// objects; chips have no ObjectDef (fx-only, not catalog items) so they
// target the 128x128 the P11 chip-arc plan already settled on.
const TARGETS = [
  { file: 'sprites/slot-machine.png', target: [154, 260] },
  { file: 'sprites/blackjack-table.png', target: [440, 322] },
  { file: 'sprites/craps-table.png', target: [440, 288] },
  { file: 'sprites/chips/chip_white.png', target: [128, 128] },
  { file: 'sprites/chips/chip_blue.png', target: [128, 128] },
  { file: 'sprites/chips/chip_red.png', target: [128, 128] },
  { file: 'sprites/chips/chip_green.png', target: [128, 128] },
  { file: 'sprites/chips/chip_black.png', target: [128, 128] },
  { file: 'sprites/wall-panel.png', target: [256, 556] },
  { file: 'sprites/neon-sign.png', target: [134, 220] },
  { file: 'sprites/marquee.png', target: [400, 282] },
  // walkGradient: true — the guest sheet's background is a gradient canvas
  // (lighter center, darker corners, plus ruled gridlines), not a flat
  // checkerboard; point-color matching alone left visible gridline
  // fragments. See sprite-alpha.mjs's recoverAlpha doc comment for why this
  // is opt-in rather than the default (it regressed the wall-panel above).
  { file: 'sprites/characters/guest-highRoller-a.png', target: [200, 72] },
  { file: 'sprites/characters/guest-highRoller-b.png', target: [200, 72] },
  { file: 'sprites/characters/guest-biker-a.png', target: [200, 72] },
  { file: 'sprites/characters/guest-biker-b.png', target: [200, 72] },
  { file: 'sprites/characters/guest-tourist-a.png', target: [200, 72] },
  { file: 'sprites/characters/guest-tourist-b.png', target: [200, 72] },
  { file: 'sprites/characters/guest-0-a.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-0-b.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-1-a.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-1-b.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-2-a.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-2-b.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-3-a.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-3-b.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-4-a.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-4-b.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-5-a.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/guest-5-b.png', target: [200, 72], walkGradient: true },
  { file: 'sprites/characters/mechanic-a.png', target: [200, 72] },
  { file: 'sprites/characters/mechanic-b.png', target: [200, 72] },
  { file: 'sprites/characters/janitor-a.png', target: [200, 72] },
  { file: 'sprites/characters/janitor-b.png', target: [200, 72] },
  { file: 'sprites/characters/bartender-a.png', target: [200, 72] },
  { file: 'sprites/characters/bartender-b.png', target: [200, 72] },
  { file: 'sprites/characters/waitress-a.png', target: [200, 72] },
  { file: 'sprites/characters/waitress-b.png', target: [200, 72] },
  { file: 'sprites/characters/pitBoss-a.png', target: [200, 72] },
  { file: 'sprites/characters/pitBoss-b.png', target: [200, 72] },
  { file: 'sprites/characters/security-a.png', target: [200, 72] },
  { file: 'sprites/characters/security-b.png', target: [200, 72] },
  { file: 'sprites/characters/dealer-a.png', target: [200, 72] },
  { file: 'sprites/characters/dealer-b.png', target: [200, 72] },
  { file: 'sprites/characters/cashier-a.png', target: [200, 72] },
  { file: 'sprites/characters/cashier-b.png', target: [200, 72] },
  // bgTolerance: 45 — the neon-tube glow bleeds a soft gradient into the
  // checkerboard that the default tolerance can't cross (see sprite-alpha.mjs's
  // recoverAlpha doc comment for how this value was found).
  { file: 'sprites/restroom.png', target: [340, 378], bgTolerance: 45 },
  // Same glow-bleed issue as the restroom (its base ring), smaller bleed
  // radius so a lower tolerance (30 vs 45) already separates it cleanly.
  { file: 'sprites/plant.png', target: [240, 288], bgTolerance: 30 },
  // Two neon signs (SNACKS/DRINKS) bleeding into the checkerboard, same
  // family of fix; 30 already fully separates (28 still leaves a full-width
  // leak, per the tolerance bisection in PLAN.md's P10.5 log).
  { file: 'sprites/food-stall.png', target: [380, 316], bgTolerance: 30 },
  { file: 'sprites/cage.png', target: [440, 322] },
  // The delivered art carries a Gemini watermark in the bottom-right. The rect
  // below was measured to contain only watermark (~3.4k non-background px) and
  // no art on all three tables: in those rows the artwork stops at x2428 or
  // further left. It must be erased rather than cropped — roulette's table
  // extends to x2584 at OTHER rows, so a vertical crop would cut real art.
  {
    file: 'sprites/roulette-table.png',
    target: [440, 330],
    sourceSize: [2816, 1536],
    preErase: { x: 2510, y: 1230, w: 306, h: 170 },
  },
  {
    file: 'sprites/poker-table.png',
    target: [440, 320],
    sourceSize: [2816, 1536],
    preErase: { x: 2510, y: 1230, w: 306, h: 170 },
  },
  {
    file: 'sprites/high-limit-table.png',
    target: [440, 320],
    sourceSize: [2816, 1536],
    preErase: { x: 2510, y: 1230, w: 306, h: 170 },
  },
  // Delivered as a 2-up sheet: a 3/4 iso wheel on a stand and a straight-on
  // front view, split by a measured empty column run at x525..787. Only the iso
  // view matches the game's projection. Cropping at x0 rather than at the
  // wheel's left edge (x119) keeps the original top-left pixel, which is what
  // recoverAlpha samples as the background reference; cropToContent trims the
  // left margin immediately afterwards. The watermark sits in the discarded
  // right half, so no preErase is needed here.
  {
    file: 'sprites/big-six-wheel.png',
    target: [180, 280],
    sourceSize: [1456, 720],
    preCrop: { x: 0, y: 0, w: 526, h: 720 },
  },
];

/** Paint a rect with the image's top-left background color (pre-alpha-recovery). */
function eraseRect(png, { x, y, w, h }) {
  const bg = [png.data[0], png.data[1], png.data[2], png.data[3]];
  for (let row = y; row < Math.min(y + h, png.height); row++) {
    for (let col = x; col < Math.min(x + w, png.width); col++) {
      const i = (row * png.width + col) * 4;
      png.data[i] = bg[0];
      png.data[i + 1] = bg[1];
      png.data[i + 2] = bg[2];
      png.data[i + 3] = bg[3];
    }
  }
  return png;
}

/** Hard crop to a source-space rect (used to pick one sprite off a 2-up sheet). */
function cropRect(png, { x, y, w, h }) {
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const src = ((y + row) * png.width + (x + col)) * 4;
      const dst = (row * w + col) * 4;
      out.data[dst] = png.data[src];
      out.data[dst + 1] = png.data[src + 1];
      out.data[dst + 2] = png.data[src + 2];
      out.data[dst + 3] = png.data[src + 3];
    }
  }
  return out;
}

// preErase / preCrop are applied ONLY when the file still has its original
// source dimensions, which makes them idempotent: after the first run the image
// has been cropped and downscaled, so the source-space coordinates no longer
// apply and must not be re-applied to a different region.
async function optimizeOne({ file, target, walkGradient, bgTolerance, sourceSize, preErase, preCrop }) {
  const abs = path.join(ROOT, 'public', file);
  const before = await readFile(abs);
  let png = PNG.sync.read(before);

  const isPristine = !sourceSize || (png.width === sourceSize[0] && png.height === sourceSize[1]);

  if (isPristine && preErase) png = eraseRect(png, preErase);
  if (isPristine && preCrop) png = cropRect(png, preCrop);

  const recovered = recoverAlpha(png, { walkGradient, bgTolerance });
  if (recovered) png = cropToContent(png);

  const [maxW, maxH] = target;
  const resized = downscale(png, maxW, maxH);
  const changedSize = resized !== png;

  // A pre-pass that changed pixels must be written even if nothing else did —
  // otherwise the file stays pristine-sized and the pre-pass reruns forever.
  const prePassed = isPristine && (Boolean(preErase) || Boolean(preCrop));
  if (!recovered && !changedSize && !prePassed) {
    console.log(`${file}: already optimized (${(before.length / 1024).toFixed(0)}KB) — skipped`);
    return;
  }

  const after = encode(resized);
  await writeFile(abs, after);
  console.log(
    `${file}: ${(before.length / 1024).toFixed(0)}KB -> ${(after.length / 1024).toFixed(0)}KB` +
      ` (${png.width}x${png.height} -> ${resized.width}x${resized.height})` +
      (recovered ? ' [alpha recovered]' : ''),
  );
}

async function main() {
  for (const target of TARGETS) {
    await optimizeOne(target);
  }
}

main().catch((err) => {
  console.error(`optimize-sprites failed: ${err.message}`);
  process.exitCode = 1;
});
