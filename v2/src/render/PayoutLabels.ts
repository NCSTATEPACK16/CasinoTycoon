// Floating "+$1,250" payout labels, all in one draw call. Each label is an
// instance of a camera-facing quad; its text is up to 12 glyphs packed into a
// per-instance attribute and spelled out in the fragment shader from a small
// glyph atlas painted once, so spawning a label uploads 32 bytes, not a
// texture. Labels pop in, drift up and fade over LIFE seconds; sized for the
// god view and shrinking with distance up close, as the sprites they replaced.

import * as THREE from 'three';

const GLYPHS = '0123456789$+−,';
const CELL_W = 64;
const CELL_H = 80;
const COLS = 16;
const MAX_CHARS = 12;
const CAPACITY = 64;
export const LABEL_LIFE_S = 1.8;
/** Payouts this large get the bigger label. */
const BIG = 1_000;
const FULL_SIZE_M = 18;
const MIN_FACTOR = 0.12;

/** The label text for an amount, as the old sprites printed it. */
export function labelText(amount: number): string {
  return `${amount >= 0 ? '+' : '−'}$${Math.abs(Math.round(amount)).toLocaleString('en-US')}`;
}

/** Glyph indices packed four to a float (base 16), three floats; plus the count. */
export function packLabel(text: string): { packed: [number, number, number]; count: number } {
  const ids = [...text]
    .map((c) => GLYPHS.indexOf(c))
    .filter((i) => i >= 0)
    .slice(0, MAX_CHARS);
  const packed: [number, number, number] = [0, 0, 0];
  ids.forEach((g, i) => (packed[Math.floor(i / 4)]! += g * 16 ** (i % 4)));
  return { packed, count: ids.length };
}

function glyphAtlas(): { tex: THREE.Texture; adv: number[] } {
  const canvas = Object.assign(document.createElement('canvas'), {
    width: COLS * CELL_W,
    height: CELL_H * 2,
  });
  const g = canvas.getContext('2d')!;
  g.font = `900 ${CELL_H * 0.66}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const adv: number[] = [];
  for (const [row, top, bottom] of [
    [0, '#fff6c0', '#f2a91e'],
    [1, '#ffd0d0', '#e0303c'],
  ] as const) {
    [...GLYPHS].forEach((ch, i) => {
      const x = i * CELL_W + CELL_W / 2;
      const y = row * CELL_H + CELL_H / 2 + 2;
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(40,16,0,0.9)';
      g.strokeText(ch, x, y);
      const grad = g.createLinearGradient(0, y - CELL_H * 0.32, 0, y + CELL_H * 0.32);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bottom);
      g.fillStyle = grad;
      g.fillText(ch, x, y);
      if (row === 0) adv.push(Math.min(1, (g.measureText(ch).width + 8) / CELL_W));
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, adv };
}

export class PayoutLabels {
  readonly mesh: THREE.InstancedMesh;
  private pos = new Float32Array(CAPACITY * 4);
  private text = new Float32Array(CAPACITY * 4);
  private aPos: THREE.InstancedBufferAttribute;
  private aText: THREE.InstancedBufferAttribute;
  private next = 0;
  private lastSpawn = -Infinity;
  private uniforms = {
    uTime: { value: 0 },
    uMap: { value: null as THREE.Texture | null },
    uAdv: { value: [] as number[] },
  };

  constructor() {
    const { tex, adv } = glyphAtlas();
    this.uniforms.uMap.value = tex;
    this.uniforms.uAdv.value = [...adv, ...new Array<number>(16 - adv.length).fill(0.5)];
    this.pos.fill(0);
    for (let i = 0; i < CAPACITY; i++) this.pos[i * 4 + 3] = -1e6;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aText = new THREE.InstancedBufferAttribute(this.text, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aText', this.aText);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uAdv[16];
        attribute vec4 aPos;
        attribute vec4 aText;
        varying vec2 vUv;
        varying float vAlpha;
        varying vec4 vText;
        float glyphAt(vec4 t, int i) {
          float p = i < 4 ? t.x : i < 8 ? t.y : t.z;
          return mod(floor(p / pow(16.0, float(i - (i / 4) * 4))), 16.0);
        }
        void main() {
          float t = (uTime - aPos.w) / ${LABEL_LIFE_S.toFixed(2)};
          vText = aText;
          vUv = position.xy + vec2(0.5, 0.0);
          if (t < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
          float meta = aText.w;
          int count = int(mod(meta, 16.0));
          bool big = mod(floor(meta / 16.0), 2.0) == 1.0;
          float width = 0.0;
          for (int i = 0; i < ${MAX_CHARS}; i++) if (i < count) width += uAdv[int(glyphAt(aText, i))];
          // Pop in with an overshoot, drift up, fade over the last third.
          float pop = t < 0.12 ? (t / 0.12) * 1.25 : 1.0 + 0.25 * exp(-(t - 0.12) * 18.0);
          vec4 view = viewMatrix * vec4(aPos.xyz + vec3(0.0, t * 1.3, 0.0), 1.0);
          float near = clamp(-view.z / ${FULL_SIZE_M.toFixed(1)}, ${MIN_FACTOR}, 1.0);
          float h = (big ? 2.2 : 1.5) * pop * near * ${(72 / 256).toFixed(4)};
          view.xy += position.xy * vec2(h * width * ${(CELL_W / CELL_H).toFixed(4)}, h) - vec2(0.0, h * 0.5);
          gl_Position = projectionMatrix * view;
          vAlpha = t > 0.66 ? 1.0 - (t - 0.66) / 0.34 : 1.0;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uAdv[16];
        varying vec2 vUv;
        varying float vAlpha;
        varying vec4 vText;
        float glyphAt(vec4 t, int i) {
          float p = i < 4 ? t.x : i < 8 ? t.y : t.z;
          return mod(floor(p / pow(16.0, float(i - (i / 4) * 4))), 16.0);
        }
        void main() {
          int count = int(mod(vText.w, 16.0));
          float row = mod(floor(vText.w / 32.0), 2.0);
          float width = 0.0;
          for (int i = 0; i < ${MAX_CHARS}; i++) if (i < count) width += uAdv[int(glyphAt(vText, i))];
          float x = vUv.x * width;
          float g = 0.0;
          float local = 0.0;
          float start = 0.0;
          for (int i = 0; i < ${MAX_CHARS}; i++) {
            if (i >= count) break;
            float gi = glyphAt(vText, i);
            float a = uAdv[int(gi)];
            if (x < start + a || i == count - 1) { g = gi; local = clamp((x - start) / a, 0.0, 1.0); break; }
            start += a;
          }
          float cu = 0.5 + (local - 0.5) * uAdv[int(g)];
          vec2 uv = vec2((g + cu) / ${COLS.toFixed(1)}, 1.0 - (row + 1.0 - vUv.y) * 0.5);
          vec4 c = texture2D(uMap, uv);
          gl_FragColor = vec4(c.rgb, c.a * vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.mesh.name = 'payout-labels';
  }

  spawn(x: number, z: number, amount: number, now: number): void {
    const i = this.next;
    this.next = (this.next + 1) % CAPACITY;
    const { packed, count } = packLabel(labelText(amount));
    this.pos.set([x, 2.2, z, now], i * 4);
    const meta = count + (Math.abs(amount) >= BIG ? 16 : 0) + (amount < 0 ? 32 : 0);
    this.text.set([...packed, meta], i * 4);
    for (const a of [this.aPos, this.aText]) {
      a.addUpdateRange(i * 4, 4);
      a.needsUpdate = true;
    }
    this.lastSpawn = now;
    this.mesh.visible = true;
  }

  update(now: number): void {
    this.uniforms.uTime.value = now;
    // No live label, no draw call.
    if (this.mesh.visible && now - this.lastSpawn > LABEL_LIFE_S) this.mesh.visible = false;
  }
}
