// Which quality tier to start on (A8). Software rasterisers, old integrated
// GPUs and small mobile parts start on Low; everything else on High. Auto then
// sheds tiers at runtime if frames run slow (Stage.adaptResolution), so this
// only has to catch the machines that would stutter through the first seconds.

import type { Quality } from './Post';

const WEAK = [
  /swiftshader/i,
  /llvmpipe/i,
  /software/i,
  /microsoft basic render/i,
  /intel.*(hd|uhd) graphics( \d{3,4})?\b/i, // pre-Iris Intel integrated
  /intel.*gma/i,
  /mali-[gt]\d{2}\b/i, // Mali-G52 and older two-digit parts
  /adreno.*\b[1-5]\d{2}\b/i, // Adreno 500 series and older
  /powervr/i,
];

/** Pure: the renderer string (WEBGL_debug_renderer_info) and MAX_TEXTURE_SIZE → a tier. */
export function classifyGpu(renderer: string, maxTextureSize: number): Quality {
  if (maxTextureSize > 0 && maxTextureSize < 8192) return 'low';
  if (WEAK.some((re) => re.test(renderer))) return 'low';
  return 'high';
}

/** Reads the live context. Browsers that hide the renderer string get High
 *  (Auto still drops a tier if it can't hold the frame rate). */
export function suggestedQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  return classifyGpu(name, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0);
}
