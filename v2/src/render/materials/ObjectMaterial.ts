// The one material every static asset draws with. A MeshStandardMaterial
// patched to read surface data per vertex (aPbr: rough, metal, emit, flags)
// and per instance (aState: flashStart, broken, highlight, variant-v-offset),
// so a whole asset — felt, brass, glass and bulbs — is a single draw.

import * as THREE from 'three';

export const objectUniforms = {
  uTime: { value: 0 },
  // Wall cutaway (god cam): walls between the camera and the focus point drop
  // to uCutH so the floor behind them stays readable; uCutOn = 0 in avatar mode.
  uFocus: { value: new THREE.Vector2() },
  uCamDir: { value: new THREE.Vector2(0, -1) },
  uCutH: { value: 0.9 },
  uCutOn: { value: 1 },
};

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
      ${instanced ? 'attribute vec4 aState;' : ''}
      ${cutaway ? 'attribute vec2 aWallC; uniform vec2 uFocus; uniform vec2 uCamDir; uniform float uCutH; uniform float uCutOn;' : ''}`,
    )
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${cutaway ? CUTAWAY_VERTEX : ''}`)
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vPbr = aPbr;
      ${instanced ? 'vState = aState;' : 'vState = vec4(-100.0, 0.0, 0.0, 0.0);'}
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
        totalEmissiveRadiance += diffuseColor.rgb * emit;
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
