// scripts/lib/light-layers.mjs
// Generalizes the P11 slot-machine "bright overlay on a dimmed base" trick
// (src/render/slotMachineFx.ts's MARQUEE_BOX/REEL_BOX/LIGHTS_BOXES, built by
// hand for that one object) to any object: crop a named box out of the
// delivered art at full brightness into its own sibling texture, then
// multiply that same box in the base image down to ~34% brightness in
// place. At runtime the bright crop is alpha-tweened over the dim base,
// faking a light turning on/off from a single delivered PNG — see the P17
// brief's "animation contract" (assets/ASSET-BRIEF-2026-08-22-p17-catalogue.md).
//
// Box coordinates are in the FINAL, already-optimized sprite's pixel space
// (post alpha-recovery/crop/downscale — matching slotMachineFx.ts's
// NATIVE_W/NATIVE_H, which equal the optimize-sprites target size, not the
// multi-thousand-px delivered art), so this pass has to run after
// optimize-sprites, not before. Per-object box constants can only be
// measured once the real art exists; this file is just the mechanism —
// see the P17 catalogue's per-object runner for the actual box list.
import { PNG } from 'pngjs';

const DIM_FACTOR = 0.34;

/** Crops a native-pixel box out of `png`, unmodified, into a new PNG. */
export function cropBox(png, { x0, y0, x1, y1 }) {
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x0, y0, w, h, 0, 0);
  return out;
}

/** Multiplies RGB (never alpha) inside a box down to `factor`, in place. */
export function dimBox(png, { x0, y0, x1, y1 }, factor = DIM_FACTOR) {
  const { width, data } = png;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      data[o] = Math.round(data[o] * factor);
      data[o + 1] = Math.round(data[o + 1] * factor);
      data[o + 2] = Math.round(data[o + 2] * factor);
    }
  }
  return png;
}

/**
 * Applies one object's full light-layer plan to its already-optimized base
 * PNG: crops every named box to its own full-brightness sibling PNG first
 * (before any dimming happens, so no crop ever sees an already-darkened
 * pixel), then dims every box in the base, in place.
 *
 * `boxes`: [{ suffix: string, box: {x0,y0,x1,y1} }] — suffix becomes the
 * sibling file's `<baseName><suffix>.png` (e.g. `-marquee`, `-lights-a`),
 * matching the `img-slot-machine-marquee` / `img-slot-machine-lights-a`
 * texture-key convention already in use.
 *
 * Returns the (now-dimmed) base PNG plus each sibling as `{ suffix, png }`.
 * Caller owns encoding/writing — this module only touches pixels.
 */
export function applyLightLayers(basePng, boxes) {
  const siblings = boxes.map(({ suffix, box }) => ({ suffix, png: cropBox(basePng, box) }));
  for (const { box } of boxes) dimBox(basePng, box);
  return { base: basePng, siblings };
}
