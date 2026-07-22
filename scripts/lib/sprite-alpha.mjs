// scripts/lib/sprite-alpha.mjs
// Shared alpha-recovery/crop/downscale primitives for asset-queue PNGs that
// arrive as checkerboard-baked-opaque exports instead of real alpha (see
// assets/ASSETS.md). Used by optimize-sprites.mjs (ongoing cleanup pass on
// registered FILE_ASSETS) and splice-characters.mjs (one-time character
// sheet intake) so the algorithm lives in exactly one place.
import { PNG } from 'pngjs';

// Sampling the actual checker colors from the corners — which this asset
// batch always leaves as clean background padding — and matching by color
// distance is far more precise than a generic "low saturation" rule, which
// misfired on legitimately dark, low-saturation art (see PLAN.md P10.5 log).
// This exact configuration (small corner patches, top 4 colors) is the
// proven-safe baseline for the non-gradient path: a wider full-perimeter
// band was tried as the *default* sampling for every file and it broke the
// wall-panel — dithering noise along a long, noisy checker edge diluted the
// top-N list enough that some border pixels never matched any reference
// color, leaving seed gaps in the border-connected flood fill. The wider
// band is still genuinely needed for the gradient-walk path (see
// `walkGradient` below) — there it's safe because every border pixel is an
// unconditionally-trusted seed regardless of whether it matches a sampled
// color, so a diluted list only weakens the fast-path shortcut, not
// correctness. Any file this doesn't fully clean gets a targeted pre-crop
// in the calling script instead of another change here.
const CORNER_PATCH = 12;
const BORDER_BAND = 16;
const BG_COLOR_TOLERANCE = 22;

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function topColors(counts, max) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([key]) => key.split(',').map(Number));
}

/** Dominant colors found in small patches at each corner — the checker's ~2 tones. */
function sampleCornerColors(width, height, data) {
  const counts = new Map();
  const corners = [
    [0, 0],
    [width - CORNER_PATCH, 0],
    [0, height - CORNER_PATCH],
    [width - CORNER_PATCH, height - CORNER_PATCH],
  ];
  for (const [cx, cy] of corners) {
    for (let y = Math.max(0, cy); y < Math.min(height, cy + CORNER_PATCH); y++) {
      for (let x = Math.max(0, cx); x < Math.min(width, cx + CORNER_PATCH); x++) {
        const o = (y * width + x) * 4;
        if (data[o + 3] === 0) continue;
        const key = `${data[o]},${data[o + 1]},${data[o + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return topColors(counts, 4);
}

/** Dominant colors found in a band around the full perimeter — for the gradient-walk path. */
function sampleBorderBandColors(width, height, data) {
  const counts = new Map();
  const sample = (x, y) => {
    const o = (y * width + x) * 4;
    if (data[o + 3] === 0) return;
    const key = `${data[o]},${data[o + 1]},${data[o + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let y = 0; y < Math.min(BORDER_BAND, height); y++) {
    for (let x = 0; x < width; x++) sample(x, y);
  }
  for (let y = Math.max(0, height - BORDER_BAND); y < height; y++) {
    for (let x = 0; x < width; x++) sample(x, y);
  }
  for (let x = 0; x < Math.min(BORDER_BAND, width); x++) {
    for (let y = 0; y < height; y++) sample(x, y);
  }
  for (let x = Math.max(0, width - BORDER_BAND); x < width; x++) {
    for (let y = 0; y < height; y++) sample(x, y);
  }
  return topColors(counts, 10);
}

export function hasRealAlpha(png) {
  const { data } = png;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/** 4-connected BFS flood fill from a set of seed pixels, matching `predicate`. */
function floodFill(width, height, seeds, predicate, visited) {
  const stack = [...seeds];
  const region = [];
  while (stack.length > 0) {
    const idx = stack.pop();
    if (visited[idx]) continue;
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (!predicate(idx)) continue;
    visited[idx] = 1;
    region.push(idx);
    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }
  return region;
}

const LOCAL_STEP_TOLERANCE = 26;

/**
 * Border-connected flood fill that also walks smooth color gradients: a
 * pixel is accepted if it matches a known background color OR if it's only
 * a small step away from the neighbor that reached it. Some sources aren't
 * a flat checkerboard but a gradient canvas background (lighter center,
 * darker corners) — no fixed list of reference colors covers a gradient,
 * but each step along it is tiny, while a real pixel-art edge (character
 * silhouette outline) is a sharp jump. Global color matching alone stops at
 * the gradient's edge; a pure local-step walk alone can't cross a flat
 * checkerboard's abrupt tone changes — this combines both so either one
 * accepts a pixel. Restricted to the border-connected region specifically
 * (never used for the enclosed-pocket pass) since a small local-step
 * tolerance chained pixel-by-pixel across a whole image can, in principle,
 * drift into unrelated colors; anchoring every walk back to the image edge
 * keeps that from mattering in practice for this asset style (generous
 * background padding, no gradient anywhere near the character).
 */
function floodFillBackground(width, height, seeds, isBgColor, pixelAt, visited) {
  // Seeds are unconditionally trusted (border pixels, by asset convention
  // always background — see caller). Everything reached from them still has
  // to earn acceptance via isBgColor or the local-step walk.
  const stack = seeds.map((idx) => [idx, null, true]);
  const region = [];
  while (stack.length > 0) {
    const [idx, parentColor, isSeed] = stack.pop();
    if (visited[idx]) continue;
    const color = pixelAt(idx);
    const accepted =
      isSeed ||
      isBgColor(idx) ||
      (parentColor && colorDistance(color, parentColor) < LOCAL_STEP_TOLERANCE);
    if (!accepted) continue;
    visited[idx] = 1;
    region.push(idx);
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x > 0) stack.push([idx - 1, color, false]);
    if (x < width - 1) stack.push([idx + 1, color, false]);
    if (y > 0) stack.push([idx - width, color, false]);
    if (y < height - 1) stack.push([idx + width, color, false]);
  }
  return region;
}

/**
 * Recovers real alpha from a checkerboard-baked-opaque export in place.
 * No-ops (returns false) if the image already carries real alpha.
 *
 * `walkGradient` opts into floodFillBackground's local-step walk (see its
 * doc comment) for sources with a gradient canvas background instead of a
 * flat checkerboard — confirmed necessary for the guest character sheets
 * (P10.6). Defaults off: tried as the default once, and it ate straight
 * through the wall-panel's dark, subtly-shaded wallpaper down to a sliver,
 * because that art's own local pixel-to-pixel steps are often smaller than
 * the tolerance too. The two asset batches need different handling, not a
 * shared default (see PLAN.md's P10.6 log for the regression).
 *
 * `bgTolerance` overrides `BG_COLOR_TOLERANCE` for the non-gradient corner-
 * match path only. Needed for the restroom asset (P10.5 T3): its neon-tube
 * glow bleeds a soft gradient into the surrounding checkerboard, which the
 * default tolerance can't cross — every background pixel stays one giant
 * component fused to the real art (a single connected region spanning the
 * full canvas, confirmed by dumping connected-component sizes), while
 * `walkGradient` overshoots the other way and eats into the object's own
 * soft-shaded surfaces (same failure mode as the wall-panel above). 45 was
 * found by bisecting tolerance values against the resulting content bbox:
 * <=30 still leaves one full-canvas component, 60 already shrinks the kept
 * component from ~774k px to ~195k (starts cutting real art), 45 lands
 * cleanly in between.
 */
export function recoverAlpha(png, { walkGradient = false, bgTolerance = BG_COLOR_TOLERANCE } = {}) {
  if (hasRealAlpha(png)) return false;
  const { width, height, data } = png;
  const pixelAt = (idx) => {
    const o = idx * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };

  const bgColors = walkGradient
    ? sampleBorderBandColors(width, height, data)
    : sampleCornerColors(width, height, data);
  const isBgColor = (idx) => {
    const [r, g, b] = pixelAt(idx);
    return bgColors.some((bg) => colorDistance([r, g, b], bg) < bgTolerance);
  };

  const visited = new Uint8Array(width * height);
  const background = new Uint8Array(width * height);

  // Pass 1: border-connected region is unambiguously background.
  const borderSeeds = [];
  for (let x = 0; x < width; x++) {
    borderSeeds.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    borderSeeds.push(y * width, y * width + width - 1);
  }
  const borderRegion = walkGradient
    ? // Every image in this asset batch keeps generous background padding
      // all the way to the edge, so every border pixel is a safe seed —
      // not just ones that already match the sampled reference colors (a
      // gradient's corner tone may not be in that list, only reachable by
      // walking).
      floodFillBackground(width, height, borderSeeds, isBgColor, pixelAt, visited)
    : floodFill(width, height, borderSeeds.filter(isBgColor), isBgColor, visited);
  for (const idx of borderRegion) background[idx] = 1;

  // Pass 2: enclosed checker-colored pockets not reached from the border
  // (holes fully inside the art, e.g. between card-outline strokes). Same
  // exact-color match, so it can't misfire on unrelated dark art the way a
  // generic "low saturation" rule did.
  for (let seed = 0; seed < width * height; seed++) {
    if (visited[seed] || !isBgColor(seed)) continue;
    const component = floodFill(width, height, [seed], isBgColor, visited);
    for (const idx of component) background[idx] = 1;
  }

  for (let idx = 0; idx < width * height; idx++) {
    if (background[idx]) data[idx * 4 + 3] = 0;
  }

  // Pass 3: keep only the largest opaque connected component — drops the
  // handful of disconnected background specks the flood fill misses at
  // anti-aliased edges (documented on chip_black specifically).
  const opaqueVisited = new Uint8Array(width * height);
  let largest = [];
  for (let seed = 0; seed < width * height; seed++) {
    if (opaqueVisited[seed] || data[seed * 4 + 3] === 0) continue;
    const component = floodFill(
      width,
      height,
      [seed],
      (idx) => data[idx * 4 + 3] !== 0,
      opaqueVisited,
    );
    if (component.length > largest.length) largest = component;
  }
  const keep = new Uint8Array(width * height);
  for (const idx of largest) keep[idx] = 1;
  for (let idx = 0; idx < width * height; idx++) {
    if (!keep[idx]) data[idx * 4 + 3] = 0;
  }

  return true;
}

/** Tight-crops to the bounding box of non-transparent pixels. */
export function cropToContent(png) {
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
  if (maxX < minX) return png; // fully transparent, nothing to crop
  const cropped = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 });
  PNG.bitblt(png, cropped, minX, minY, cropped.width, cropped.height, 0, 0);
  return cropped;
}

/** Alpha-premultiplied box downsample so transparent pixels' garbage RGB never bleeds in. */
export function downscale(png, maxW, maxH) {
  const { width, height, data } = png;
  const scale = Math.min(1, maxW / width, maxH / height);
  if (scale >= 1) return png;
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const out = new PNG({ width: outW, height: outH });

  for (let oy = 0; oy < outH; oy++) {
    const sy0 = Math.floor((oy * height) / outH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((oy + 1) * height) / outH));
    for (let ox = 0; ox < outW; ox++) {
      const sx0 = Math.floor((ox * width) / outW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((ox + 1) * width) / outW));
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * width + sx) * 4;
          const a = data[o + 3];
          rSum += data[o] * a;
          gSum += data[o + 1] * a;
          bSum += data[o + 2] * a;
          aSum += a;
          n++;
        }
      }
      const oo = (oy * outW + ox) * 4;
      out.data[oo + 3] = Math.round(aSum / n);
      out.data[oo] = aSum > 0 ? Math.round(rSum / aSum) : 0;
      out.data[oo + 1] = aSum > 0 ? Math.round(gSum / aSum) : 0;
      out.data[oo + 2] = aSum > 0 ? Math.round(bSum / aSum) : 0;
    }
  }
  return out;
}

export function encode(png) {
  return PNG.sync.write(png);
}
