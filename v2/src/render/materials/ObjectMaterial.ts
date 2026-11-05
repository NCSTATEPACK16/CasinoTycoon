// The one material every static asset draws with. A MeshStandardMaterial
// patched to read surface data per vertex (aPbr: rough, metal, emit, flags)
// and per instance (aState: flashStart, broken, highlight, variant-v-offset),
// so a whole asset — felt, brass, glass and bulbs — is a single draw.

import * as THREE from 'three';
import { MAX_REELS, REEL_GLSL } from '../fx/reels';

export const objectUniforms = {
  uTime: { value: 0 },
  // Wall cutaway (god cam): walls between the camera and the focus point drop
  // to uCutH so the floor behind them stays readable; uCutOn = 0 in avatar mode.
  uFocus: { value: new THREE.Vector2() },
  uCamDir: { value: new THREE.Vector2(0, -1) },
  uCutH: { value: 0.9 },
  uCutOn: { value: 1 },
  // Live reels (Track A): where the reel window, the video screen and the
  // symbol strips sit in the atlas, and per sheet (reels, strip length, rows).
  // ObjectLayer fills these once the atlas exists.
  uReelRect: { value: new THREE.Vector4() },
  uScreenRect: { value: new THREE.Vector4() },
  uStripRect: { value: new THREE.Vector4() },
  uStripGrid: { value: new THREE.Vector2(1, 1) },
  uSheets: { value: Array.from({ length: 8 }, () => new THREE.Vector4(3, 16, 1, 0)) },
};

/** The reel surfaces' colour: the decal's frame, and inside its window the
 *  instance's reels scrolled through the atlas strips (see fx/reels.ts). */
const REEL_FRAGMENT = /* glsl */ `
  uniform vec4 uReelRect;
  uniform vec4 uScreenRect;
  uniform vec4 uStripRect;
  uniform vec2 uStripGrid;
  uniform vec4 uSheets[8];
  varying vec4 vReelA;
  varying vec4 vReelB;
  varying float vSeed;
  float reelGlow = 0.0;
  ${REEL_GLSL}
  vec4 stripTap(float col, float fx, float k, float len, vec2 gx, vec2 gy) {
    float idx = mod(floor(k), len);
    vec2 cell = vec2((col + fx) / uStripGrid.x, (idx + fract(k)) / uStripGrid.y);
    vec2 suv = vec2(mix(uStripRect.x, uStripRect.z, cell.x), mix(uStripRect.w, uStripRect.y, cell.y));
    return textureGrad(map, suv, gx, gy);
  }
  vec4 reelColor(vec2 uv) {
    vec4 frame = texture2D(map, uv);
    bool video = mod(floor(vPbr.w / 2.0), 2.0) == 1.0;
    vec4 rect = video ? uScreenRect : uReelRect;
    vec2 ruv = video ? uv + vec2(0.0, vState.w) : uv;
    vec2 loc = vec2((ruv.x - rect.x) / (rect.z - rect.x), (rect.w - ruv.y) / (rect.w - rect.y));
    vec4 win = video ? vec4(0.035, 0.175, 0.965, 0.965) : vec4(0.03, 0.05, 0.97, 0.95);
    float sheet = vReelA.y;
    if (sheet < 0.0 || loc.x < win.x || loc.x > win.z || loc.y < win.y || loc.y > win.w) return frame;
    vec4 info = uSheets[int(sheet)];
    float n = info.x;
    float len = info.y;
    bool lines3 = info.z > 1.5;
    vec2 w = vec2((loc.x - win.x) / (win.z - win.x), (loc.y - win.y) / (win.w - win.y));
    float r = min(floor(w.x * n), n - 1.0);
    float fx = w.x * n - r;
    float p[5] = float[5](vReelA.z, vReelA.w, vReelB.x, vReelB.y, vReelB.z);
    float pr = p[int(r)];
    float pos = reelPos(uTime, vReelA.x, vReelB.w, r, n, pr, len);
    float span = lines3 ? 3.0 : 2.2;
    float k = pos + (w.y - 0.5) * span + 0.5;
    float col = sheet * ${MAX_REELS.toFixed(1)} + r;
    // Gradients from the unwrapped coordinate, so wrapping a strip never picks a tiny mip.
    vec2 cont = vec2(
      mix(uStripRect.x, uStripRect.z, (col + fx) / uStripGrid.x),
      uStripRect.w - (uStripRect.w - uStripRect.y) * k / uStripGrid.y);
    vec2 gx = dFdx(cont);
    vec2 gy = dFdy(cont);
    vec4 c = stripTap(col, fx, k, len, gx, gy);
    // Motion blur along the strip while it spins.
    float speed = abs(reelPos(uTime + 0.02, vReelA.x, vReelB.w, r, n, pr, len) - pos) / 0.02;
    if (speed > 1.5) {
      float d = clamp(speed * 0.012, 0.0, 0.42);
      c = (c + stripTap(col, fx, k - d, len, gx, gy) + stripTap(col, fx, k + d, len, gx, gy)
        + stripTap(col, fx, k - d * 0.5, len, gx, gy)) * 0.25;
    }
    float edge = abs(w.y - 0.5) * 2.0;
    // A classic reel is a drum: darker toward the top and bottom of the window.
    c.rgb *= lines3 ? 1.0 - 0.15 * edge * edge : 1.0 - 0.6 * pow(edge, 2.2);
    if (fx < 0.025 || fx > 0.975) c.rgb *= 0.15;
    if (!lines3 && abs(w.y - 0.5) < 0.012) c.rgb = mix(c.rgb, vec3(0.9, 0.08, 0.08), 0.85);
    // Attract mode on an idle cabinet: light sweeping the glass, never the symbols.
    if (uTime - vReelA.x > 4.0) {
      float ph = fract(uTime * 0.16 + vSeed) * 1.8 - 0.4;
      c.rgb += (1.0 - smoothstep(0.0, 0.07, abs(w.x * 0.75 + w.y * 0.25 - ph))) * 0.22;
    }
    reelGlow = lines3 ? 0.75 : 0.3;
    return c;
  }`;

const CUTAWAY_VERTEX = `
  {
    vec2 rel = aWallC - uFocus;
    // Positive when the wall sits on the camera's side of the focus point.
    float near = dot(rel, -uCamDir);
    float cut = uCutOn * smoothstep(-1.0, 1.5, near) * step(-5000.0, aWallC.x);
    float lowered = min(transformed.y, uCutH + max(0.0, transformed.y - 2.75) * 0.6);
    transformed.y = mix(transformed.y, lowered, cut);
  }`;

function patch(
  shader: THREE.WebGLProgramParametersWithUniforms,
  instanced: boolean,
  cutaway: boolean,
): void {
  Object.assign(shader.uniforms, objectUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      attribute vec4 aPbr;
      varying vec4 vPbr;
      varying vec4 vState;
      varying float vChaseX;
      varying vec4 vReelA;
      varying vec4 vReelB;
      varying float vSeed;
      ${instanced ? 'attribute vec4 aState; attribute vec4 aReelA; attribute vec4 aReelB;' : ''}
      ${cutaway ? 'attribute vec2 aWallC; uniform vec2 uFocus; uniform vec2 uCamDir; uniform float uCutH; uniform float uCutOn;' : ''}`,
    )
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${cutaway ? CUTAWAY_VERTEX : ''}`)
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vPbr = aPbr;
      ${instanced ? 'vState = aState;' : 'vState = vec4(-100.0, 0.0, 0.0, 0.0);'}
      ${
        instanced
          ? 'vReelA = aReelA; vReelB = aReelB; vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);'
          : 'vReelA = vec4(-1000.0, -1.0, 0.0, 0.0); vReelB = vec4(0.0, 0.0, 0.0, 1.0); vSeed = 0.0;'
      }
      // Variant decals (topper themes, neon words) stack rows downward.
      if (mod(floor(aPbr.w / 2.0), 2.0) == 1.0) vMapUv.y -= vState.w;
      vChaseX = position.x + position.y;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform float uTime;
      varying vec4 vPbr;
      varying vec4 vState;
      varying float vChaseX;`,
    )
    .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${REEL_FRAGMENT}`)
    .replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = mod(floor(vPbr.w / 8.0), 2.0) == 1.0 ? reelColor(vMapUv) : texture2D(map, vMapUv);
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    )
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      // Broken machines go dull grey; selection/hover lifts the whole asset.
      float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum * 0.5), vState.y);
      diffuseColor.rgb += vState.z * 0.12;`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float flags = vPbr.w;
        float emit = vPbr.z;
        float flash = mod(flags, 2.0) == 1.0 ? exp(-max(0.0, uTime - vState.x) * 1.6) * step(vState.x, uTime) : 0.0;
        // Win flash: a hard strobe that decays, on toppers and bulbs.
        emit *= 1.0 + flash * (2.5 + 2.5 * step(0.5, fract(uTime * 7.0)));
        if (mod(floor(flags / 4.0), 2.0) == 1.0)
          emit *= 0.35 + 0.65 * step(0.5, fract(vChaseX * 3.0 - uTime * 2.5));
        emit *= 1.0 - vState.y * 0.95;
        totalEmissiveRadiance += diffuseColor.rgb * (emit + reelGlow);
      }`,
    );
}

export function createObjectMaterial(
  atlas: THREE.Texture,
  instanced = true,
  cutaway = false,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: atlas,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 1,
  });
  m.onBeforeCompile = (s) => patch(s, instanced, cutaway);
  m.customProgramCacheKey = () => `casino-object-${instanced ? 'i' : 's'}${cutaway ? 'c' : ''}`;
  return m;
}
