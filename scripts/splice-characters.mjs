// scripts/splice-characters.mjs
// One-time intake for the P10.6 sub-project-1 character art drop: crops the
// 5 labeled cells out of assets/guests1-5varients.png, then splits every
// source sheet (each a single image with 2 walk frames side by side, per the
// assets/ASSETS.md character prompt) into separate left/right PNGs under the
// exact texture-key naming GuestViews/StaffViews expect. Run once; the
// alpha-recovery/downscale pass happens afterward via `npm run optimize-sprites`
// (this script only crops — scripts/lib/sprite-alpha.mjs owns the pixel work).
//
// guests1-5varients.png has a labeling bug: two cells are duplicates/mismatches
// (a second, redundant "Business Male" cell, and a cell labeled "Elderly Man"
// that's actually a mislabeled Party Female repaint). Cell coordinates below
// were chosen by matching visual content to each variant's stated identity,
// not raw grid position — see docs/superpowers/plans/2026-07-21-staff-character-expansion-roadmap.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const DEST = path.join(ROOT, 'public', 'sprites', 'characters');

// Cropped from the 1408x768 sheet: [x0, y0, x1, y1]. Row bands were located by
// scanning for horizontal bands of non-background pixels per column, then
// verified visually per cell (see roadmap doc for the labeling-bug writeup).
const GUEST_SHEET_CELLS = {
  'guest-1': [0, 52, 469, 247], // Casual Female
  'guest-2': [0, 305, 469, 505], // Business Male (first/correctly-labeled copy)
  'guest-3': [940, 52, 1408, 247], // Party Female
  'guest-4': [940, 305, 1408, 505], // Elderly Man (unlabeled cell in the sheet; content matches)
  'guest-5': [0, 563, 469, 762], // Elderly Woman
};

// Single-variant source files: split down the middle into frame a/b.
const SINGLE_SOURCES = {
  'guest-0': 'guest varient 0.png',
  mechanic: 'mechanic.png',
  janitor: 'janitor.png',
};

// guest varient 0.png (only this file, of the 15+ in this drop) carries a
// faint diagonal smudge artifact in the top strip of each frame — not the
// usual checkerboard bug, and it survives sprite-alpha.mjs's largest-
// component pass because it's apparently pixel-connected to the character.
// It's confined above y=105 (character content starts at y=115, confirmed
// by scanning for the first row with a real cluster of saturated/dark
// pixels), well clear of the character, so trimming it here sidesteps the
// whole problem instead of chasing a general fix that risks regressing the
// other 15 files (a blended-background-color attempt did exactly that).
const PRE_CROP_TOP = { 'guest-0': 105 };

function splitFrames(png) {
  const { width, height } = png;
  const mid = Math.round(width / 2);
  const a = new PNG({ width: mid, height });
  PNG.bitblt(png, a, 0, 0, mid, height, 0, 0);
  const b = new PNG({ width: width - mid, height });
  PNG.bitblt(png, b, mid, 0, width - mid, height, 0, 0);
  return { a, b };
}

async function writeFrames(name, png) {
  const { a, b } = splitFrames(png);
  await writeFile(path.join(DEST, `${name}-a.png`), PNG.sync.write(a));
  await writeFile(path.join(DEST, `${name}-b.png`), PNG.sync.write(b));
  console.log(
    `${name}: split into ${name}-a.png (${a.width}x${a.height}), ${name}-b.png (${b.width}x${b.height})`,
  );
}

async function main() {
  await mkdir(DEST, { recursive: true });

  const sheetPath = path.join(ASSETS, 'guests1-5varients.png');
  const sheet = PNG.sync.read(await readFile(sheetPath));
  for (const [name, [x0, y0, x1, y1]] of Object.entries(GUEST_SHEET_CELLS)) {
    const w = x1 - x0;
    const h = y1 - y0;
    const cell = new PNG({ width: w, height: h });
    PNG.bitblt(sheet, cell, x0, y0, w, h, 0, 0);
    await writeFrames(name, cell);
  }

  for (const [name, file] of Object.entries(SINGLE_SOURCES)) {
    let png = PNG.sync.read(await readFile(path.join(ASSETS, file)));
    const topCrop = PRE_CROP_TOP[name];
    if (topCrop) {
      const trimmed = new PNG({ width: png.width, height: png.height - topCrop });
      PNG.bitblt(png, trimmed, 0, topCrop, png.width, png.height - topCrop, 0, 0);
      png = trimmed;
    }
    await writeFrames(name, png);
  }
}

main().catch((err) => {
  console.error(`splice-characters failed: ${err.message}`);
  process.exitCode = 1;
});
