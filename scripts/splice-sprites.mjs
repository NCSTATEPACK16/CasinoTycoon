// scripts/splice-sprites.mjs
// One-time intake for the P17 catalogue's "-alt.png" screen-content strips
// (assets/ASSET-BRIEF-2026-08-22-p17-catalogue.md, prompts 4b/9b): each
// delivered file is N flat rectangular panels laid out in a single row on a
// solid magenta canvas, separated by a wide magenta gutter (the brief asks
// for at least 40px). This crops each panel out by auto-detecting the
// gutters — the same generalized-format role splice-characters.mjs plays for
// character sheets. Panel PNGs still need scripts/optimize-sprites.mjs
// afterward for alpha recovery/downscale — this script only crops.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const DEST = path.join(ROOT, 'public', 'sprites');

// A column counts as "gutter" if every pixel in it is within this distance
// of the strip's background color (sampled from the top-left pixel — the
// brief asks for the same solid magenta surrounding the whole row, not just
// between panels, so the corner is a safe reference).
const GUTTER_TOLERANCE = 22;

// { source file in assets/, output name prefix, expected panel count }
const STRIP_SOURCES = [
  { file: 'video-poker-alt.png', prefix: 'video-poker-screen', count: 3 },
  { file: 'sports-book-alt.png', prefix: 'sports-book-screen', count: 3 },
];

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function isGutterColumn(png, x, bg) {
  const { height, width, data } = png;
  for (let y = 0; y < height; y++) {
    const o = (y * width + x) * 4;
    if (colorDistance([data[o], data[o + 1], data[o + 2]], bg) > GUTTER_TOLERANCE) return false;
  }
  return true;
}

/** Contiguous non-gutter column runs, left to right — one run per panel. */
function findPanelRanges(png, bg) {
  const ranges = [];
  let start = null;
  for (let x = 0; x < png.width; x++) {
    const gutter = isGutterColumn(png, x, bg);
    if (!gutter && start === null) start = x;
    if (gutter && start !== null) {
      ranges.push([start, x - 1]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, png.width - 1]);
  return ranges;
}

function cropColumns(png, x0, x1) {
  const w = x1 - x0 + 1;
  const out = new PNG({ width: w, height: png.height });
  PNG.bitblt(png, out, x0, 0, w, png.height, 0, 0);
  return out;
}

async function spliceStrip({ file, prefix, count }) {
  const png = PNG.sync.read(await readFile(path.join(ASSETS, file)));
  const bg = [png.data[0], png.data[1], png.data[2]];

  const ranges = findPanelRanges(png, bg);
  if (ranges.length !== count) {
    throw new Error(
      `${file}: expected ${count} panels separated by a magenta gutter, found ${ranges.length}. ` +
        'Check the delivered strip actually has a wide (>=40px) gutter between panels and around the row.',
    );
  }

  await mkdir(DEST, { recursive: true });
  for (const [i, [x0, x1]] of ranges.entries()) {
    const panel = cropColumns(png, x0, x1);
    const name = `${prefix}-${i + 1}.png`;
    await writeFile(path.join(DEST, name), PNG.sync.write(panel));
    console.log(`${file}: panel ${i + 1} -> ${name} (${panel.width}x${panel.height})`);
  }
}

async function main() {
  for (const strip of STRIP_SOURCES) {
    await spliceStrip(strip);
  }
}

main().catch((err) => {
  console.error(`splice-sprites failed: ${err.message}`);
  process.exitCode = 1;
});
