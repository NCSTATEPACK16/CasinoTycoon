// Floors: one material for every floor type. Each vertex carries its
// FloorType index; the fragment shader tiles that type's atlas region in
// world space, using textureGrad so wrapping inside an atlas cell doesn't
// blow up the mip level at tile seams.

import * as THREE from 'three';
import type { DecalAtlas } from '../assets/Atlas';
import { FLOOR_TYPES } from '../../shared/contracts';

/** Per FloorType: atlas decal, metres per texture repeat, roughness, tint. */
const FLOOR_LOOK: Record<(typeof FLOOR_TYPES)[number], [string, number, number, number]> = {
  none: ['tile', 2, 0.9, 0x6d6873],
  'carpet-red': ['carpetRed', 1.5, 0.95, 0xffffff],
  'carpet-blue': ['carpetBlue', 1.5, 0.95, 0xffffff],
  marble: ['marble', 1, 0.22, 0xcbc2b6],
  wood: ['wood', 2, 0.45, 0xffffff],
  tile: ['tile', 1.2, 0.3, 0xffffff],
};

export function createFloorMaterial(atlas: DecalAtlas): THREE.MeshStandardMaterial {
  const rects: THREE.Vector4[] = [];
  const tiles: number[] = [];
  const rough: number[] = [];
  const tints: THREE.Color[] = [];
  for (const t of FLOOR_TYPES) {
    const [decal, tile, r, tint] = FLOOR_LOOK[t];
    const u = atlas.rect(decal);
    rects.push(new THREE.Vector4(u.u0, u.v0, u.u1 - u.u0, u.v1 - u.v0));
    tiles.push(tile);
    rough.push(r);
    tints.push(new THREE.Color().setHex(tint, THREE.SRGBColorSpace));
  }
  const m = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uRects = { value: rects };
    s.uniforms.uTiles = { value: tiles };
    s.uniforms.uRough = { value: rough };
    s.uniforms.uTints = { value: tints };
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aFloor;
        varying float vFloor;
        varying vec2 vWorldXZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFloor = aFloor;
        vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;`,
      );
    const n = FLOOR_TYPES.length;
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec4 uRects[${n}];
        uniform float uTiles[${n}];
        uniform float uRough[${n}];
        uniform vec3 uTints[${n}];
        varying float vFloor;
        varying vec2 vWorldXZ;
        int floorId() { return int(vFloor + 0.5); }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          int id = floorId();
          vec4 r = uRects[id];
          vec2 w = vWorldXZ / uTiles[id];
          // Flip z so the motif reads the right way up from the default camera.
          vec2 f = fract(vec2(w.x, -w.y));
          vec2 uv = r.xy + f * r.zw;
          vec4 texel = textureGrad(map, uv, dFdx(w) * r.zw, dFdy(w) * r.zw);
          diffuseColor *= texel;
          diffuseColor.rgb *= uTints[id];
          // Unfinished slab: show the build grid.
          if (id == 0) {
            vec2 g = abs(fract(vWorldXZ) - 0.5);
            float line = smoothstep(0.47, 0.49, max(g.x, g.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.15, 0.2), line * 0.6);
          }
        }`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uRough[floorId()];');
  };
  m.customProgramCacheKey = () => 'casino-floor';
  return m;
}
