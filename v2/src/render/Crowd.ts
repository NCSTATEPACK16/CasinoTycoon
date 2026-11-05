// Every agent through vertex animation textures: one instanced draw per LOD
// tier, no SkinnedMesh anywhere. The human and its clips are baked in Blender
// (assets/blender/human.py) into rows of a half-float texture — positions then
// normals per frame — and the vertex shader fetches by gl_VertexID.
//
// Per instance: aXform (x, z, heading, ±scale; negative = female build),
// aAnim (clipA + 16·clipB, timeA, timeB, weightA) for 0.25 s cross-fades,
// aLook (outfit row, skin, hair, mood). Walk time advances with distance
// travelled, not wall time, so feet don't slide.

import * as THREE from 'three';
import { AGENT_STRIDE, AgentKind, Anim, type Snapshot } from '../shared/contracts';
import vatJsonUrl from '../../assets/models/human.vat.json?url';
import vatBinUrl from '../../assets/models/human.vat.bin?url';

const MAX = 2048;
/** Metres per walk cycle at the baked 1 s cycle (two steps). */
const STRIDE = 1.3;
const FADE_S = 0.25;
/** Camera distance bands: full VAT mesh, reduced VAT mesh, billboard. The
 *  full mesh (1.6k tris, shadow-casting) stops at 14 m; beyond that a 500-guest
 *  floor seen at eye level was spending ~400k triangles on faces too small to
 *  tell apart. */
export const CROWD_LOD = [14, 48] as const;
/** VAT clip indices past the Anim ids (human.py CLIPS order). */
const CLIP_DEAL = 7;
const CLIP_STANDPLAY = 8;
/** A guest who gets up from a stool without walking off (done playing, now
 *  looking around, or cheering) steps this far back so it isn't standing in
 *  the stool; the sim parks it on the seat marker either way. */
const STEP_OFF = 0.4;
const STEP_OFF_S = 0.35;

interface VatMeta {
  clips: { name: string; start: number; frames: number; fps: number; loop: boolean }[];
  frames: number;
  lods: {
    vertexCount: number;
    indexCount: number;
    width: number;
    height: number;
    indexOffset: number;
    regionOffset: number;
    vatOffset: number;
  }[];
}

// ---------- palette ----------
// Rows 0..31 outfits (8 regions each: skin, hair, top, bottom, shoes, accent,
// forearm, eyes; forearm alpha 0 = bare arm → skin), 32..39 skin, 40..47 hair.
const OUTFITS: number[][] = [
  [0x1fa5a0, 0xc8b48a, 0xe8e8e8, 0x1fa5a0, -1], // tourist
  [0x1c2340, 0x1c2340, 0x111111, 0xd9a441, 0x1c2340], // high roller
  [0xb3172f, 0xb3172f, 0x111111, 0xb3172f, -1], // red dress
  [0x6b6f7a, 0x2f4a7a, 0xf0f0f0, 0x6b6f7a, 0x6b6f7a], // hoodie
  [0x8a2a20, 0x3a4f80, 0x5a3418, 0xc8a050, 0x8a2a20], // cowboy
  [0x9d86c8, 0xd8d0c0, 0xd8c8a8, 0x9d86c8, -1], // retiree
  [0xff5fa2, 0x1c1b22, 0xff5fa2, 0xff5fa2, -1], // party
  [0x50545e, 0x50545e, 0x111111, 0xb3172f, 0x50545e], // grey suit
  [0xe0b020, 0x2a3550, 0xf0f0f0, 0xe0b020, -1], // polo
  [0x2f6b3a, 0x1c1b22, 0x5a3418, 0xf0f0f0, 0x2f6b3a], // green jacket
  [0xececec, 0x1c1b22, 0x111111, 0x1c1b22, 0xececec], // shirt & tie
  [0xe0661a, 0x3a4f80, 0xf0f0f0, 0xe0661a, -1], // orange tee
  [0xf2f2f2, 0x15151a, 0x111111, 0xc01a2e, 0xf2f2f2], // 12 dealer: white shirt, red bowtie
  [0x3d6a8f, 0x3d6a8f, 0x1a1a1a, 0xf0c020, -1], // 13 janitor overalls, hi-vis stripe
  [0x15161c, 0x15161c, 0x0c0c0c, 0x2a2a34, 0x15161c], // 14 security suit
  [0x6a1a2c, 0x1c1b22, 0x111111, 0xd9a441, 0x6a1a2c], // 15 staff
  [0x5a2bb0, 0x1c1b22, 0x111111, 0xf2c14e, 0x5a2bb0], // 16 avatar
];
const GUEST_OUTFITS = 12;
const KIND_OUTFIT: Record<number, number> = {
  [AgentKind.Dealer]: 12,
  [AgentKind.Janitor]: 13,
  [AgentKind.Security]: 14,
  [AgentKind.Staff]: 15,
  [AgentKind.Avatar]: 16,
};
const SKIN = [0xf6d1b0, 0xe8b48a, 0xd29b6c, 0xb07a50, 0x8d5a3a, 0x6a4028, 0xf2c6a0, 0xc48860];
const HAIR = [0x1a1410, 0x3a2414, 0x6a4020, 0xa87038, 0xd8b060, 0xb0b0b0, 0xe8e8e8, 0x8a2a14];

function paletteTexture(): THREE.DataTexture {
  const W = 8;
  const H = 64;
  const data = new Uint8Array(W * H * 4);
  const c = new THREE.Color();
  const put = (row: number, col: number, hex: number, a = 255) => {
    c.setHex(hex, THREE.SRGBColorSpace);
    const i = (row * W + col) * 4;
    // Stored linear so the shader can multiply straight into diffuseColor.
    data[i] = Math.round(c.r * 255);
    data[i + 1] = Math.round(c.g * 255);
    data[i + 2] = Math.round(c.b * 255);
    data[i + 3] = a;
  };
  OUTFITS.forEach(([top, bottom, shoes, accent, forearm], r) => {
    put(r, 2, top!);
    put(r, 3, bottom!);
    put(r, 4, shoes!);
    put(r, 5, accent!);
    put(r, 6, forearm! < 0 ? 0 : forearm!, forearm! < 0 ? 0 : 255);
    put(r, 7, 0x141018);
  });
  SKIN.forEach((s, i) => put(32 + i, 0, s));
  HAIR.forEach((h, i) => put(40 + i, 0, h));
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

// ---------- shader ----------

const VAT_COMMON = /* glsl */ `
  uniform highp sampler2D uVat;
  uniform int uVatF;
  uniform vec4 uClips[16];
  attribute vec4 aXform;
  attribute vec4 aAnim;
  attribute vec4 aLook;
  vec3 vatRow(int row) { return texelFetch(uVat, ivec2(gl_VertexID, row), 0).xyz; }
  void vatClip(int clip, float time, out vec3 p, out vec3 n) {
    vec4 c = uClips[clip];
    float f = mod(time * c.z, c.y);
    float f0 = floor(f);
    float t = f - f0;
    int r0 = int(c.x + f0);
    int r1 = int(c.x + mod(f0 + 1.0, c.y));
    p = mix(vatRow(r0), vatRow(r1), t);
    n = mix(vatRow(r0 + uVatF), vatRow(r1 + uVatF), t);
  }
  void crowdVertex(out vec3 p, out vec3 n) {
    int clipA = int(mod(aAnim.x, 16.0));
    int clipB = int(aAnim.x / 16.0);
    vec3 pa; vec3 na; vatClip(clipA, aAnim.y, pa, na);
    if (aAnim.w < 0.999) {
      vec3 pb; vec3 nb; vatClip(clipB, aAnim.z, pb, nb);
      pa = mix(pb, pa, aAnim.w);
      na = mix(nb, na, aAnim.w);
    }
    // Female build: narrower shoulders, fuller hips. Applied in model space so
    // it follows the pose closely enough at crowd scale.
    if (aXform.w < 0.0) {
      float shoulder = smoothstep(1.15, 1.35, pa.y);
      float hip = smoothstep(0.75, 0.9, pa.y) * (1.0 - smoothstep(1.0, 1.12, pa.y));
      pa.x *= 1.0 - 0.1 * shoulder + 0.1 * hip;
    }
    float s = abs(aXform.w);
    float ch = cos(aXform.z);
    float sh = sin(aXform.z);
    // Heading 0 = +z, counter-clockwise from above (contracts.ts).
    mat2 rot = mat2(ch, -sh, sh, ch);
    p = pa * s;
    p.xz = rot * p.xz;
    p.xz += aXform.xy;
    n = na;
    n.xz = rot * n.xz;
  }
`;

function patchStandard(m: THREE.MeshStandardMaterial, u: Record<string, THREE.IUniform>): void {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${VAT_COMMON}
        uniform sampler2D uPalette;
        attribute float aRegion;
        varying vec3 vCrowdCol;
        vec3 gCrowdPos;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal;
        crowdVertex(gCrowdPos, objectNormal);
        {
          int region = int(aRegion + 0.5);
          int outfit = int(aLook.x);
          vec4 col = texelFetch(uPalette, ivec2(region, outfit), 0);
          vec3 skin = texelFetch(uPalette, ivec2(0, 32 + int(aLook.y)), 0).rgb;
          vec3 hair = texelFetch(uPalette, ivec2(0, 40 + int(aLook.z)), 0).rgb;
          if (region == 0 || (region == 6 && col.a < 0.5)) col.rgb = skin;
          if (region == 1) col.rgb = hair;
          // Unhappy guests visibly wilt: their clothes go grey.
          float sad = clamp((0.3 - aLook.w) / 0.3, 0.0, 1.0) * step(1.5, float(region));
          float l = dot(col.rgb, vec3(0.3, 0.59, 0.11));
          vCrowdCol = mix(col.rgb, vec3(l * 0.8), sad * 0.6);
        }`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = gCrowdPos;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrowdCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vCrowdCol;');
  };
  m.customProgramCacheKey = () => 'crowd-vat';
}

function patchDepth(m: THREE.Material, u: Record<string, THREE.IUniform>): void {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VAT_COMMON}`)
      .replace('#include <begin_vertex>', 'vec3 transformed; vec3 nIgnored; crowdVertex(transformed, nIgnored);');
  };
  m.customProgramCacheKey = () => 'crowd-vat-depth';
}

// ---------- billboard tier ----------

function billboardMaterial(palette: THREE.DataTexture): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ alphaTest: 0.5 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uPalette = { value: palette };
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aXform;
        attribute vec4 aLook;
        varying vec2 vBB;
        varying vec3 vTop; varying vec3 vBottom; varying vec3 vSkin;
        uniform sampler2D uPalette;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vBB = position.xy;
        int outfit = int(aLook.x);
        vTop = texelFetch(uPalette, ivec2(2, outfit), 0).rgb;
        vBottom = texelFetch(uPalette, ivec2(3, outfit), 0).rgb;
        vSkin = texelFetch(uPalette, ivec2(0, 32 + int(aLook.y)), 0).rgb;
        // Cylindrical billboard: face the camera around the vertical axis.
        vec3 base = vec3(aXform.x, 0.0, aXform.y);
        vec3 toCam = cameraPosition - base;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        float s = abs(aXform.w);
        vec3 transformed = base + right * position.x * s + vec3(0.0, position.y * s, 0.0);`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vBB; varying vec3 vTop; varying vec3 vBottom; varying vec3 vSkin;`,
      )
      .replace(
        '#include <color_fragment>',
        `{
          // A person-shaped silhouette from bands: head, shoulders, legs.
          float y = vBB.y;
          float hw = y > 1.5 ? 0.11 * sqrt(max(0.0, 1.0 - pow((y - 1.64) / 0.13, 2.0)))
                   : y > 0.9 ? mix(0.15, 0.2, smoothstep(0.95, 1.4, y))
                   : 0.14;
          if (abs(vBB.x) > hw) discard;
          vec3 c = y > 1.5 ? vSkin : y > 0.92 ? vTop : vBottom;
          // Fake top-light shading so they don't read as flat cut-outs.
          diffuseColor.rgb = c * (0.55 + 0.45 * smoothstep(0.0, 1.8, y)) * (1.0 - abs(vBB.x) * 1.6);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'crowd-billboard';
  return m;
}

// ---------- tiers ----------

class Tier {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly xform = new Float32Array(MAX * 4);
  readonly anim = new Float32Array(MAX * 4);
  readonly look = new Float32Array(MAX * 4);
  count = 0;

  constructor(base: THREE.BufferGeometry, material: THREE.Material, depth?: THREE.Material) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const [k, a] of Object.entries(base.attributes)) g.setAttribute(k, a);
    for (const [k, arr] of [
      ['aXform', this.xform],
      ['aAnim', this.anim],
      ['aLook', this.look],
    ] as const) {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, a);
    }
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; // agents are culled per instance on the CPU
    if (depth) {
      this.mesh.customDepthMaterial = depth;
      this.mesh.castShadow = true;
    }
    this.mesh.receiveShadow = true;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, z: number, heading: number, scale: number, a: Float32Array, l: Float32Array) {
    const i = this.count++ * 4;
    this.xform[i] = x;
    this.xform[i + 1] = z;
    this.xform[i + 2] = heading;
    this.xform[i + 3] = scale;
    this.anim.set(a, i);
    this.look.set(l, i);
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (const k of ['aXform', 'aAnim', 'aLook']) {
      const a = this.geo.attributes[k] as THREE.InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * 4);
      a.needsUpdate = true;
    }
  }
}

// ---------- agents ----------

interface AgentState {
  x: number;
  z: number;
  heading: number;
  clip: number;
  prevClip: number;
  tA: number;
  tB: number;
  fade: number;
  frame: number;
  look: Float32Array;
  scale: number;
  /** Where the agent last sat, facing the table; NaN when it isn't on a seat. */
  seatX: number;
  seatZ: number;
  seatHeading: number;
  /** 0 on the seat, 1 stepped back off it. */
  off: number;
}

const animBuf = new Float32Array(4);
const sphere = new THREE.Sphere();
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();

export class Crowd {
  readonly group = new THREE.Group();
  private tiers: Tier[] = [];
  private states = new Map<number, AgentState>();
  private prevIndex = new Map<number, number>();
  private indexedPrev: Snapshot | null = null;
  private frame = 0;
  private uniforms: Record<string, THREE.IUniform> = {};
  private palette = paletteTexture();
  ready = false;
  /** Agents drawn last frame: [key, x, z] for picking. */
  private drawn: { id: number; x: number; z: number }[] = [];
  private clipDur: number[] = [];

  constructor() {
    this.group.name = 'crowd';
    void this.load();
  }

  private async load(): Promise<void> {
    const [meta, bin] = await Promise.all([
      fetch(vatJsonUrl).then((r) => r.json() as Promise<VatMeta>),
      fetch(vatBinUrl).then((r) => r.arrayBuffer()),
    ]);
    const clips = meta.clips.map((c) => new THREE.Vector4(c.start, c.frames, c.fps, c.loop ? 1 : 0));
    while (clips.length < 16) clips.push(new THREE.Vector4(0, 1, 1, 1));
    this.clipDur = meta.clips.map((c) => c.frames / c.fps);
    for (const [li, L] of meta.lods.entries()) {
      const tex = new THREE.DataTexture(
        new Uint16Array(bin, L.vatOffset, L.width * L.height * 4),
        L.width,
        L.height,
        THREE.RGBAFormat,
        THREE.HalfFloatType,
      );
      tex.needsUpdate = true;
      const u = {
        uVat: { value: tex },
        uVatF: { value: meta.frames },
        uClips: { value: clips },
        uPalette: { value: this.palette },
      };
      if (li === 0) this.uniforms = u;
      const geo = new THREE.BufferGeometry();
      geo.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, L.indexOffset, L.indexCount), 1));
      const region = new Float32Array(L.vertexCount);
      const r8 = new Uint8Array(bin, L.regionOffset, L.vertexCount);
      for (let i = 0; i < L.vertexCount; i++) region[i] = r8[i]!;
      geo.setAttribute('aRegion', new THREE.BufferAttribute(region, 1));
      // Rest positions only satisfy three's attribute bookkeeping; the shader
      // reads the pose from the VAT.
      const rest = new Float32Array(L.vertexCount * 3);
      const half = new Uint16Array(bin, L.vatOffset, L.width * 4);
      for (let i = 0; i < L.vertexCount; i++)
        for (let k = 0; k < 3; k++) rest[i * 3 + k] = THREE.DataUtils.fromHalfFloat(half[i * 4 + k]!);
      geo.setAttribute('position', new THREE.BufferAttribute(rest, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(L.vertexCount * 3), 3));
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
      patchStandard(mat, u);
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      patchDepth(depth, u);
      const tier = new Tier(geo, mat, li === 0 ? depth : undefined);
      this.tiers.push(tier);
      this.group.add(tier.mesh);
    }
    const quad = new THREE.PlaneGeometry(0.5, 1.82).translate(0, 0.91, 0);
    const bb = new Tier(quad, billboardMaterial(this.palette));
    this.tiers.push(bb);
    this.group.add(bb.mesh);
    this.ready = true;
  }

  get count(): number {
    return this.drawn.length;
  }

  update(prev: Snapshot | null, curr: Snapshot, alpha: number, camera: THREE.Camera, dt: number): void {
    if (!this.ready) return;
    this.frame++;
    if (prev !== this.indexedPrev) {
      this.prevIndex.clear();
      if (prev)
        for (let i = 0; i < prev.agentCount; i++) {
          const o = i * AGENT_STRIDE;
          this.prevIndex.set(prev.agents[o + 7]! * 8 + prev.agents[o + 4]!, o);
        }
      this.indexedPrev = prev;
    }
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    const cam = camera.position;
    for (const t of this.tiers) t.begin();
    this.drawn.length = 0;
    const a = curr.agents;
    const n = Math.min(MAX, curr.agentCount);
    const walkDur = this.clipDur[1] ?? 1;
    for (let i = 0; i < n; i++) {
      const o = i * AGENT_STRIDE;
      const kind = a[o + 4]!;
      const id = a[o + 7]!;
      const key = id * 8 + kind;
      let x = a[o]!;
      let z = a[o + 1]!;
      const po = prev ? this.prevIndex.get(key) : undefined;
      if (prev && po !== undefined) {
        x = prev.agents[po]! + (x - prev.agents[po]!) * alpha;
        z = prev.agents[po + 1]! + (z - prev.agents[po + 1]!) * alpha;
      }
      let st = this.states.get(key);
      if (!st) {
        st = this.spawn(key, id, kind, a[o + 5]!, x, z, a[o + 2]!);
        this.states.set(key, st);
      }
      st.frame = this.frame;
      const dx = x - st.x;
      const dz = z - st.z;
      const dist = Math.hypot(dx, dz);
      st.x = x;
      st.z = z;
      const simAnim = a[o + 3]!;
      let clip =
        simAnim === Anim.Play && kind === AgentKind.Dealer
          ? CLIP_DEAL
          : simAnim === Anim.StandPlay
            ? CLIP_STANDPLAY
            : simAnim;
      // The sim may still say Idle for a tick while the agent is visibly moving.
      if (clip === Anim.Idle && dist > 0.6 * dt) clip = Anim.Walk;
      if (clip !== st.clip) {
        st.prevClip = st.clip;
        st.tB = st.tA;
        st.tA = clip === Anim.Walk ? st.tA % walkDur : 0;
        st.clip = clip;
        st.fade = 0;
      }
      st.fade = Math.min(1, st.fade + dt / FADE_S);
      st.tA += clip === Anim.Walk ? (dist / STRIDE) * walkDur : dt;
      st.tB += dt;
      // Face the direction of travel while moving, the sim's heading otherwise;
      // ease toward it so a 10 Hz heading doesn't snap.
      const target = dist > 0.15 * dt ? Math.atan2(dx, dz) : a[o + 2]!;
      let dh = target - st.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      st.heading += dh * (1 - Math.exp(-dt * 10));
      st.look[3] = a[o + 6]!;
      if (kind === AgentKind.Guest) {
        const seated = clip === Anim.Sit || clip === Anim.Play;
        if (seated) {
          st.seatX = x;
          st.seatZ = z;
          st.seatHeading = a[o + 2]!;
        } else if (Math.hypot(x - st.seatX, z - st.seatZ) > 0.05) st.seatX = NaN;
        const want = seated || Number.isNaN(st.seatX) ? 0 : 1;
        st.off += Math.sign(want - st.off) * Math.min(Math.abs(want - st.off), dt / STEP_OFF_S);
        if (st.off > 0) {
          const k = STEP_OFF * st.off * st.off * (3 - 2 * st.off);
          x -= Math.sin(st.seatHeading) * k;
          z -= Math.cos(st.seatHeading) * k;
        }
      }
      sphere.center.set(x, 0.9, z);
      sphere.radius = 1.1;
      if (!frustum.intersectsSphere(sphere)) continue;
      const d = cam.distanceTo(sphere.center);
      const tier = d < CROWD_LOD[0] ? 0 : d < CROWD_LOD[1] ? 1 : 2;
      animBuf[0] = st.clip + 16 * st.prevClip;
      animBuf[1] = st.tA;
      animBuf[2] = st.tB;
      animBuf[3] = st.fade;
      this.tiers[tier]!.push(x, z, st.heading, st.scale, animBuf, st.look);
      this.drawn.push({ id, x, z });
    }
    for (const t of this.tiers) t.end();
    // Forget agents that left; keeps the map from growing over a long day.
    if (this.frame % 120 === 0)
      for (const [k, s] of this.states) if (this.frame - s.frame > 60) this.states.delete(k);
  }

  private spawn(key: number, id: number, kind: number, variant: number, x: number, z: number, heading: number): AgentState {
    const h = hash32(key);
    const outfit =
      kind === AgentKind.Guest ? ((variant | 0) * 5 + (h % 7)) % GUEST_OUTFITS : (KIND_OUTFIT[kind] ?? 15);
    const female = kind === AgentKind.Guest ? (h >>> 8) % 2 === 0 : (h >>> 8) % 3 === 0;
    const scale = (0.93 + ((h >>> 12) % 100) / 100 * 0.12) * (female ? -0.96 : 1);
    return {
      x,
      z,
      heading,
      clip: Anim.Idle,
      prevClip: Anim.Idle,
      tA: ((h >>> 4) % 100) / 37,
      tB: 0,
      fade: 1,
      frame: this.frame,
      look: new Float32Array([outfit, (h >>> 16) % SKIN.length, (h >>> 20) % HAIR.length, 0.6]),
      scale,
      seatX: NaN,
      seatZ: NaN,
      seatHeading: 0,
      off: 0,
    };
    void id;
  }

  /** Nearest drawn agent hit by the ray (a 0.6 × 1.8 m column per agent). */
  pick(ray: THREE.Ray): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    for (const d of this.drawn) {
      box.min.set(d.x - 0.3, 0, d.z - 0.3);
      box.max.set(d.x + 0.3, 1.8, d.z + 0.3);
      if (!ray.intersectBox(box, hit)) continue;
      const dist = hit.distanceToSquared(ray.origin);
      if (dist < bestD) {
        bestD = dist;
        best = d.id;
      }
    }
    return best;
  }

  /** Where an agent is drawn right now (for camera follow, inspectors). */
  positionOf(id: number): { x: number; z: number } | null {
    return this.drawn.find((d) => d.id === id) ?? null;
  }

  tierCounts(): number[] {
    return this.tiers.map((t) => t.count);
  }
}

function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
