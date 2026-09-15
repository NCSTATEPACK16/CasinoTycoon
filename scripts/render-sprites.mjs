// scripts/render-sprites.mjs
// Drives the Blender iso render rig (scripts/render/) and turns its output into shipped
// pixel art.
//
// Why the rig exists rather than another hand-prompted image batch: see the header of
// scripts/render/lib.py and the first three sections of
// assets/ASSET-BRIEF-2026-08-22-p17-catalogue.md. In short, a fixed orthographic camera
// makes the isometric projection identical across every object by construction, and
// film_transparent gives true alpha -- so bgTolerance, preErase and preCrop, every one of
// which exists in optimize-sprites.mjs because of a specific delivery that went wrong,
// simply do not apply to anything rendered here.
//
// Two jobs on top of the render:
//   1. Pixel post-pass. Blender renders flat-shaded emission, so a full-res frame holds a
//      small EXACT set of colours. Downscaling blends them, which would give the smooth
//      anti-aliased edges the RCT house style does not have -- so every downscaled pixel
//      is snapped back to the nearest colour the render actually used, and alpha is hard
//      thresholded. That restores flat fields and hard edges without a hand-authored
//      palette, and it is how RCT's own sprites were made: render, then quantize.
//   2. Light-box transport. The rig emits each animated region's rectangle in render
//      pixels; this carries those through the same crop and scale into final sprite
//      pixels, for scripts/lib/light-layers.mjs to slice. The shipped slot machine's crops
//      were measured off finished art by hand; these are exact.
//
// Idempotent: re-rendering an object produces byte-identical output, and `--only` limits
// the run. Usage:
//   npm run render-sprites                 # every object
//   npm run render-sprites -- --only pachinko
//   npm run render-sprites -- --res 3072   # override render resolution
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { downscale, encode } from './lib/sprite-alpha.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const PUBLIC_SPRITES = path.join(ROOT, 'public', 'sprites');
const ENTRY = path.join(__dirname, 'render', 'render.py');

// Final sprite size = 2x the on-screen display size, matching the convention every
// TARGETS entry in optimize-sprites.mjs already follows. Display sizes come from the
// delivery table in assets/ASSET-BRIEF-2026-08-22-p17-catalogue.md.
const OBJECTS = [
  { id: 'penny-slots', display: [72, 120] },
  { id: 'pachinko', display: [78, 140] },
  { id: 'keno-lounge', display: [220, 200] },
  { id: 'video-poker', display: [170, 180] },
  // Tier 2 -- the working floor.
  { id: 'sic-bo', display: [220, 158] },
  { id: 'three-card-poker', display: [220, 150] },
  { id: 'pai-gow', display: [220, 150] },
  { id: 'bingo-hall', display: [385, 260] },
  { id: 'sports-book', display: [275, 250] },
];

// Render well above the target so the downscale has real information to average, then
// quantize. 2048 is ~8x the longest final edge.
const DEFAULT_RES = 2048;

function findBlender() {
  const candidates = [
    process.env.BLENDER,
    '/Applications/Blender.app/Contents/MacOS/Blender',
    `${os.homedir()}/Applications/Blender.app/Contents/MacOS/Blender`,
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  const which = spawnSync('which', ['blender'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

/** Content bounding box. Computed here rather than via cropToContent because the light
 *  boxes need the crop offset, which that helper does not return. */
function contentBox(png) {
  const { width, height, data } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) throw new Error('render is fully transparent');
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function crop(png, box) {
  const out = new PNG({ width: box.w, height: box.h });
  PNG.bitblt(png, out, box.x, box.y, box.w, box.h, 0, 0);
  return out;
}

/** Every exact opaque colour in the render. Flat emission shading keeps this small. */
function sourcePalette(png) {
  const seen = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 250) continue;
    const key = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
}

/** Snap to the nearest rendered colour and hard-threshold alpha.
 *  This is the step that turns a smooth 3D render into pixel art: it removes the
 *  anti-aliased gradient the downscale introduced, restoring the flat fills and hard
 *  edges the shipped sprites have. */
function quantize(png, palette) {
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 128) {
      png.data[i] = png.data[i + 1] = png.data[i + 2] = png.data[i + 3] = 0;
      continue;
    }
    png.data[i + 3] = 255;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    let best = palette[0];
    let bestD = Infinity;
    for (const c of palette) {
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    png.data[i] = best[0];
    png.data[i + 1] = best[1];
    png.data[i + 2] = best[2];
  }
  return png;
}

async function renderOne(blender, { id, display }, res) {
  const tmpPng = path.join(os.tmpdir(), `casino-render-${id}.png`);
  const tmpBoxes = path.join(os.tmpdir(), `casino-render-${id}.json`);

  const run = spawnSync(
    blender,
    ['--background', '--python', ENTRY, '--',
     '--object', id, '--out', tmpPng, '--boxes', tmpBoxes, '--res', String(res)],
    { encoding: 'utf8' },
  );
  if (run.status !== 0 || !existsSync(tmpPng)) {
    process.stderr.write(run.stdout ?? '');
    process.stderr.write(run.stderr ?? '');
    throw new Error(`blender failed for ${id}`);
  }

  const full = PNG.sync.read(await readFile(tmpPng));
  const palette = sourcePalette(full);

  const box = contentBox(full);
  const cropped = crop(full, box);
  const [tw, th] = [display[0] * 2, display[1] * 2];
  const small = downscale(cropped, tw, th);
  const scale = small.width / cropped.width;
  quantize(small, palette);

  const bytes = encode(small);
  await mkdir(ASSETS, { recursive: true });
  await writeFile(path.join(ASSETS, `${id}.png`), bytes);
  // Also write the shipped copy. optimize-sprites' ensureSourceCopied only copies a file
  // into public/ the first time it sees it, so without this a re-render would land in
  // assets/ and never reach the game. Writing both is correct here in a way it would not
  // be for a hand-delivered file: the rig emits final-size art with real alpha, so
  // optimize-sprites has nothing left to do and correctly reports it as already optimized.
  await mkdir(PUBLIC_SPRITES, { recursive: true });
  await writeFile(path.join(PUBLIC_SPRITES, `${id}.png`), bytes);

  // Carry the rig's rectangles through the same crop and scale into final sprite pixels.
  const raw = JSON.parse(await readFile(tmpBoxes, 'utf8'));
  const boxes = raw.boxes.map((b) => ({
    kind: b.kind,
    name: b.name,
    x: Math.round((b.x - box.x) * scale),
    y: Math.round((b.y - box.y) * scale),
    w: Math.max(1, Math.round(b.w * scale)),
    h: Math.max(1, Math.round(b.h * scale)),
  }));
  await writeFile(
    path.join(ASSETS, `${id}.boxes.json`),
    `${JSON.stringify({ sprite: `${id}.png`, width: small.width, height: small.height, boxes }, null, 2)}\n`,
  );

  await rm(tmpPng, { force: true });
  await rm(tmpBoxes, { force: true });
  return { size: [small.width, small.height], colours: palette.length, boxes: boxes.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const res = argv.includes('--res') ? Number(argv[argv.indexOf('--res') + 1]) : DEFAULT_RES;

  const blender = findBlender();
  if (!blender) {
    console.error(
      'Blender not found. Install it, or set BLENDER=/path/to/blender.\n' +
        'On macOS the default is /Applications/Blender.app/Contents/MacOS/Blender.',
    );
    process.exit(1);
  }

  const wanted = only ? OBJECTS.filter((o) => o.id === only) : OBJECTS;
  if (wanted.length === 0) {
    console.error(`unknown object "${only}" -- known: ${OBJECTS.map((o) => o.id).join(', ')}`);
    process.exit(1);
  }

  for (const obj of wanted) {
    const r = await renderOne(blender, obj, res);
    console.log(
      `${obj.id.padEnd(14)} ${String(r.size[0]).padStart(4)}x${String(r.size[1]).padEnd(4)}` +
        ` ${String(r.colours).padStart(3)} colours  ${r.boxes} light boxes`,
    );
  }
  console.log('\nWritten to assets/ and public/sprites/. npm run optimize-sprites will report these\nas already optimized -- the rig emits final-size art with real alpha, so there is\nnothing left for it to do.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
