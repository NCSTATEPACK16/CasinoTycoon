// Thought icons over guests' heads (A12): a bubble with the thought's glyph
// (THOUGHT_EMOJI in data/thoughts.ts, read-only). Shown only for the hovered
// or selected guest, and for guests near the camera in the Mood view, never
// for everyone all the time. One instanced billboard draw; the glyphs live in a
// small canvas atlas painted once.

import * as THREE from 'three';
import { THOUGHT_EMOJI } from '../data/thoughts';

export const MAX_ICONS = 48;
/** In the Mood view, only guests this close to the camera get a bubble. */
export const MOOD_RANGE = 40;
const HEAD_Y = 2.15;
const CELL = 64;
const FALLBACK = '💭';

/** What the feed hands over: a guest and the glyph of their latest recent thought. */
export interface ThoughtIcon {
  agentId: number;
  glyph: string;
}

export interface GuestThoughtRow {
  agentId: number;
  thought: { glyph: string } | null;
  thoughtIds: string[];
}

/**
 * Pure: which guests get a bubble. A guest with no thought in the recent
 * window gets none (the bubble is a sampled, current thought, not a history).
 * Hovered and selected guests always come first.
 */
export function pickIcons(
  rows: readonly GuestThoughtRow[],
  focus: ReadonlySet<number>,
  moodView: boolean,
  max = MAX_ICONS,
): ThoughtIcon[] {
  const first: ThoughtIcon[] = [];
  const rest: ThoughtIcon[] = [];
  for (const r of rows) {
    if (!r.thought || r.thoughtIds.length === 0) continue;
    const icon = { agentId: r.agentId, glyph: r.thought.glyph };
    if (focus.has(r.agentId)) first.push(icon);
    else if (moodView) rest.push(icon);
  }
  return [...first, ...rest].slice(0, Math.max(max, first.length));
}

const VERT = /* glsl */ `
  attribute vec3 aPos;
  attribute vec2 aCell;
  attribute float aAlpha;
  uniform vec2 uGrid;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = (aCell + uv) / uGrid;
    vUv.y = 1.0 - vUv.y;
    vAlpha = aAlpha;
    // Billboard: offset the quad corner in view space, so it always faces the camera.
    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
    float s = 0.5 * clamp(-mv.z / 12.0, 0.75, 2.2);
    mv.xy += (position.xy) * s;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 c = texture2D(uAtlas, vUv);
    if (c.a < 0.05) discard;
    gl_FragColor = vec4(c.rgb, c.a * vAlpha);
  }
`;

export class ThoughtIcons {
  readonly mesh: THREE.Mesh;
  private cells = new Map<string, number>();
  private cols: number;
  private geo: THREE.InstancedBufferGeometry;
  private pos = new Float32Array(MAX_ICONS * 3);
  private cell = new Float32Array(MAX_ICONS * 2);
  private alpha = new Float32Array(MAX_ICONS);
  private want: ThoughtIcon[] = [];
  /** Per agent fade-in, so a bubble pops gently rather than blinking on. */
  private shown = new Map<number, number>();

  constructor() {
    const glyphs = [...new Set([FALLBACK, ...Object.values(THOUGHT_EMOJI)])];
    this.cols = 8;
    const rows = Math.ceil(glyphs.length / this.cols);
    const canvas = document.createElement('canvas');
    canvas.width = this.cols * CELL;
    canvas.height = rows * CELL;
    const g = canvas.getContext('2d')!;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    glyphs.forEach((glyph, i) => {
      const cx = (i % this.cols) * CELL + CELL / 2;
      const cy = Math.floor(i / this.cols) * CELL + CELL / 2 - 3;
      // Bubble: white disc, a tail, a soft outline.
      g.fillStyle = 'rgba(255,255,255,0.96)';
      g.strokeStyle = 'rgba(40,20,30,0.45)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, CELL * 0.4, 0, Math.PI * 2);
      g.moveTo(cx - 6, cy + CELL * 0.36);
      g.lineTo(cx, cy + CELL * 0.48);
      g.lineTo(cx + 6, cy + CELL * 0.36);
      g.fill();
      g.stroke();
      g.font = `${CELL * 0.5}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.fillStyle = '#000';
      g.fillText(glyph, cx, cy + 2);
      this.cells.set(glyph, i);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;

    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (a: Float32Array, n: number) => {
      const b = new THREE.InstancedBufferAttribute(a, n);
      b.setUsage(THREE.DynamicDrawUsage);
      return b;
    };
    this.geo.setAttribute('aPos', attr(this.pos, 3));
    this.geo.setAttribute('aCell', attr(this.cell, 2));
    this.geo.setAttribute('aAlpha', attr(this.alpha, 1));
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uAtlas: { value: tex }, uGrid: { value: new THREE.Vector2(this.cols, rows) } },
        transparent: true,
        depthWrite: false,
        // Sit above the crowd but behind walls: depth-tested.
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.name = 'thought-icons';
  }

  set(icons: ThoughtIcon[]): void {
    this.want = icons;
    const keep = new Set(icons.map((i) => i.agentId));
    for (const id of [...this.shown.keys()]) if (!keep.has(id)) this.shown.delete(id);
  }

  /** Place each wanted bubble over its guest where the crowd drew them this frame. */
  update(
    drawn: readonly { id: number; x: number; z: number }[],
    cam: THREE.Vector3,
    moodView: boolean,
    focus: ReadonlySet<number>,
    dt: number,
  ): void {
    if (!this.want.length) {
      this.geo.instanceCount = 0;
      this.mesh.visible = false;
      return;
    }
    const at = new Map<number, { x: number; z: number }>();
    for (const d of drawn) at.set(d.id, d);
    // Focused guests first, then the Mood view's nearest, up to the pool size.
    const shown: { w: ThoughtIcon; p: { x: number; z: number }; d: number }[] = [];
    for (const w of this.want) {
      const p = at.get(w.agentId);
      if (!p) continue;
      const d = focus.has(w.agentId) ? -1 : Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d >= 0 && (!moodView || d > MOOD_RANGE)) continue;
      shown.push({ w, p, d });
    }
    if (shown.length > MAX_ICONS) shown.sort((a, b) => a.d - b.d).length = MAX_ICONS;
    let n = 0;
    for (const { w, p } of shown) {
      const a = Math.min(1, (this.shown.get(w.agentId) ?? 0) + dt * 4);
      this.shown.set(w.agentId, a);
      const c = this.cells.get(w.glyph) ?? this.cells.get(FALLBACK)!;
      this.pos.set([p.x, HEAD_Y, p.z], n * 3);
      this.cell.set([c % this.cols, Math.floor(c / this.cols)], n * 2);
      this.alpha[n] = a;
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    for (const k of ['aPos', 'aCell', 'aAlpha']) this.geo.attributes[k]!.needsUpdate = true;
  }
}

/**
 * Feeds the icons. It polls the worker's guest list once a second, and only
 * while there's someone to show: a hovered or selected guest, or the Mood view.
 * Otherwise it asks for nothing.
 */
export class ThoughtFeed {
  hovered: number | null = null;
  selected: number | null = null;
  moodView = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private fetchRows: () => Promise<readonly GuestThoughtRow[]>,
    private icons: ThoughtIcons,
  ) {}

  get focus(): Set<number> {
    const f = new Set<number>();
    if (this.hovered !== null) f.add(this.hovered);
    if (this.selected !== null) f.add(this.selected);
    return f;
  }

  start(everyMs = 1000): void {
    this.timer ??= setInterval(() => void this.poll(), everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    const focus = this.focus;
    if (!focus.size && !this.moodView) {
      this.icons.set([]);
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      // In the Mood view every recent thinker is a candidate; the icons keep the nearest drawn ones.
      this.icons.set(pickIcons(await this.fetchRows(), focus, this.moodView, this.moodView ? Infinity : MAX_ICONS));
    } catch {
      // A failed poll just leaves the last bubbles up; the next one retries.
    } finally {
      this.busy = false;
    }
  }
}
