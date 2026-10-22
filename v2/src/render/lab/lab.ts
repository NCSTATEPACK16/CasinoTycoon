// Render lab: the Stage on a synthetic, deliberately dense casino, without
// the sim. It is the graphics acceptance harness — 2,000 objects, 500 agents,
// fps / draw calls / GPU time on screen, fixed camera shots for screenshots.
//   /src/render/lab/index.html?objects=2000&agents=500&quality=high&shot=overview&clean
// window.lab exposes { stage, shot(name), setCam(px,py,pz, tx,ty,tz), metrics() }.

import * as THREE from 'three';
import { GodCamera } from '../../camera/GodCamera';
import { getObjectDef } from '../../data/objects';
import { get3D } from '../../shared/catalog';
import {
  AGENT_STRIDE,
  AgentKind,
  Anim,
  FLOOR_TYPES,
  ZONES,
  type FloorPlanView,
  type ObjectView,
  type Rotation,
  type Snapshot,
  type WallSegment,
} from '../../shared/contracts';
import { Stage } from '../Stage';

const q = new URLSearchParams(location.search);
const N_OBJECTS = Number(q.get('objects') ?? 2000);
const N_AGENTS = Number(q.get('agents') ?? 500);
if (q.has('clean')) document.body.classList.add('clean');

const COLS = 100;
const ROWS = 96;

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

// ---------- floor plan ----------

function buildPlan(): FloorPlanView {
  const floor = new Uint8Array(COLS * ROWS);
  const zone = new Uint8Array(COLS * ROWS);
  const F = (t: (typeof FLOOR_TYPES)[number]) => FLOOR_TYPES.indexOf(t);
  const Z = (t: (typeof ZONES)[number]) => ZONES.indexOf(t);
  const rect = (c0: number, r0: number, c1: number, r1: number, f: number, z: number) => {
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
      floor[r * COLS + c] = f;
      zone[r * COLS + c] = z;
    }
  };
  rect(0, 0, 100, ROWS, F('carpet-red'), Z('gaming'));
  rect(0, 80, 100, 82, F('marble'), Z('gaming'));
  rect(50, 0, 76, 40, F('carpet-blue'), Z('gaming')); // table pit
  rect(0, 37, 100, 40, F('marble'), Z('gaming')); // promenade
  rect(47, 0, 50, 80, F('marble'), Z('gaming'));
  rect(76, 0, 100, 30, F('marble'), Z('highLimit')); // high-limit salon
  rect(80, 4, 96, 26, F('carpet-blue'), Z('highLimit'));
  rect(76, 50, 100, 80, F('wood'), Z('foodCourt'));
  rect(76, 40, 90, 50, F('tile'), Z('restrooms'));
  rect(90, 40, 100, 50, F('tile'), Z('backOfHouse'));
  const walls: WallSegment[] = [];
  const hline = (c0: number, c1: number, r: number, doors: number[] = []) => {
    for (let c = c0; c < c1; c++) walls.push({ col: c, row: r, edge: 'n', door: doors.includes(c) });
  };
  const vline = (c: number, r0: number, r1: number, doors: number[] = []) => {
    for (let r = r0; r < r1; r++) walls.push({ col: c, row: r, edge: 'w', door: doors.includes(r) });
  };
  hline(0, 100, 0);
  hline(0, 100, ROWS, [48]);
  vline(0, 0, ROWS);
  vline(100, 0, ROWS, [38]);
  vline(76, 0, 30, [14, 15]);
  hline(76, 100, 30, [88]);
  vline(76, 40, 50, [44]);
  hline(76, 100, 40);
  hline(76, 100, 50, [82, 83]);
  vline(90, 40, 50);
  return { cols: COLS, rows: ROWS, floor, zone, walls, entrance: { col: 99, row: 38 } };
}

// ---------- objects ----------

interface Seat {
  x: number;
  z: number;
  heading: number;
  dealer: boolean;
}

function buildObjects(): { views: ObjectView[]; seats: Seat[] } {
  const views: ObjectView[] = [];
  const seats: Seat[] = [];
  let n = 0;
  const add = (defId: string, col: number, row: number, rot: Rotation = 0) => {
    views.push({ id: `o${n++}`, defId, col, row, rot, broken: rnd() < 0.01, open: true, occupants: 0 });
    const d3 = get3D(defId);
    const def = getObjectDef(defId);
    const w = def?.footprint.w ?? 1;
    const h = def?.footprint.h ?? 1;
    // Tables: guests on the front arc, the dealer behind.
    if (d3.game && d3.game !== 'slots') {
      for (let k = 0; k < 3; k++)
        seats.push({ x: col + 0.4 + k * 0.6, z: row + h + 0.15, heading: Math.PI, dealer: false });
      seats.push({ x: col + w / 2, z: row - 0.2, heading: 0, dealer: true });
    } else if (d3.game === 'slots') {
      // rot 0 faces +z, rot 2 faces -z.
      seats.push(
        rot === 0
          ? { x: col + 0.5, z: row + 1.25, heading: Math.PI, dealer: false }
          : { x: col + 0.5, z: row - 0.25, heading: 0, dealer: false },
      );
    }
  };
  // Slot floor: back-to-back banks of ten along x, two-cell aisles between.
  const bank = (c0: number, c1: number, r0: number, r1: number, vp: boolean) => {
    for (let r = r0; r + 1 < r1; r += 4) {
      LANES.push([c0, r + 3, c1, r + 3]);
      for (let c = c0; c + 10 <= c1; c += 11)
        for (let k = 0; k < 10; k++) {
          if (c + k >= 46 && c + k < 51) continue; // keep the north-south promenade clear
          if (vp && k === 0) {
            add('video-poker', c + k, r, 0);
            continue;
          }
          const def = (k + r) % 4 === 0 ? 'penny-slots' : 'slot-machine';
          add(def, c + k, r, 2);
          add(def, c + k, r + 1, 0);
        }
    }
  };
  bank(2, 46, 2, 36, false);
  bank(2, 75, 42, 80, true);
  bank(2, 99, 82, 95, false);
  // Table pit.
  const tables = ['blackjack-table', 'roulette-table', 'craps-table', 'poker-table', 'three-card-poker', 'blackjack-table'];
  let t = 0;
  for (let r = 3; r + 2 <= 36; r += 5)
    for (let c = 52; c + 2 <= 75; c += 4) add(tables[t++ % tables.length]!, c, r, 0);
  // High-limit salon.
  for (let r = 6; r + 2 <= 26; r += 6)
    for (let c = 81; c + 2 <= 96; c += 5) add(r === 12 ? 'roulette-table' : 'high-limit-table', c, r, 0);
  add('cage', 72, 41);
  add('big-six-wheel', 46, 44);
  add('big-six-wheel', 46, 47);
  add('pachinko', 50, 44);
  add('pachinko', 50, 47);
  // Food court and bars.
  for (let c = 78; c < 98; c += 3) add('food-stall', c, 52, 0);
  add('bar', 80, 60);
  add('bar', 84, 60);
  add('bar', 90, 66);
  add('bar', 94, 66);
  for (let c = 78; c < 98; c += 2) add('plant', c, 78);
  // Restrooms.
  for (let c = 77; c < 89; c += 2) add('toilet', c, 41);
  // Decor along the promenade.
  for (let c = 2; c < 98; c += 4) {
    if (c > 46 && c < 51) continue;
    add(c % 8 === 2 ? 'neon-sign' : 'plant', c, 36);
    add(c % 8 === 6 ? 'neon-sign' : 'plant', c, 40);
  }
  add('marquee', 94, 34);
  add('marquee', 94, 42);
  // Fill to the requested count with more slot banks in the far rows, then trim.
  views.length = Math.min(views.length, N_OBJECTS);
  return { views, seats };
}

// ---------- agents ----------

interface Walker {
  id: number;
  kind: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  heading: number;
  anim: number;
  variant: number;
  mood: number;
  seat?: Seat;
  until: number;
}

/** Walkable lanes: slot aisles (filled by buildObjects), promenades, pit edges. */
const LANES: [number, number, number, number][] = [];

function walkTarget(): [number, number] {
  const lanes: [number, number, number, number][] = [
    ...LANES,
    [1, 38, 99, 39],
    [48, 1, 49, 79],
    [1, 81, 99, 81],
    [51, 2, 75, 2],
    [51, 7.5, 75, 7.5],
    [51, 17.5, 75, 17.5],
    [78, 57, 98, 57],
    [78, 72, 98, 72],
  ];
  const [x0, z0, x1, z1] = lanes[Math.floor(rnd() * lanes.length)]!;
  return [x0 + (x1 - x0) * rnd(), z0 + (z1 - z0) * rnd()];
}

function makeAgents(seats: Seat[]): Walker[] {
  const out: Walker[] = [];
  const guestSeats = seats.filter((s) => !s.dealer).sort(() => rnd() - 0.5);
  const dealerSeats = seats.filter((s) => s.dealer);
  let id = 1;
  for (const s of dealerSeats) {
    if (out.length >= N_AGENTS) break;
    out.push({ id: id++, kind: AgentKind.Dealer, x: s.x, z: s.z, tx: s.x, tz: s.z, heading: s.heading, anim: Anim.Play, variant: 0, mood: 0.8, seat: s, until: Infinity });
  }
  while (out.length < N_AGENTS) {
    const r = rnd();
    const kind = r < 0.03 ? AgentKind.Security : r < 0.05 ? AgentKind.Janitor : AgentKind.Guest;
    const seat = kind === AgentKind.Guest && rnd() < 0.4 ? guestSeats.pop() : undefined;
    const [x, z] = seat ? [seat.x, seat.z] : walkTarget();
    const [tx, tz] = walkTarget();
    out.push({
      id: id++,
      kind,
      x,
      z,
      tx,
      tz,
      heading: seat?.heading ?? 0,
      anim: seat ? (rnd() < 0.8 ? Anim.Play : Anim.Sit) : Anim.Walk,
      variant: Math.floor(rnd() * 8),
      mood: rnd(),
      seat,
      until: seat ? Infinity : 0,
    });
  }
  return out;
}

function step(agents: Walker[], dt: number, now: number): void {
  for (const a of agents) {
    if (a.seat) {
      if (a.kind === AgentKind.Guest && rnd() < 0.002) a.anim = a.anim === Anim.Play ? Anim.Cheer : Anim.Play;
      continue;
    }
    if (a.until > now) continue;
    if (a.anim !== Anim.Walk) a.anim = Anim.Walk;
    const dx = a.tx - a.x;
    const dz = a.tz - a.z;
    const d = Math.hypot(dx, dz);
    const speed = a.kind === AgentKind.Guest ? 1.25 : 1.5;
    if (d < 0.2) {
      [a.tx, a.tz] = walkTarget();
      // Pause sometimes: idle, eat in the food court, sulk.
      const r = rnd();
      if (r < 0.35) {
        a.anim = a.z > 50 && a.x > 76 ? Anim.Eat : r < 0.05 ? Anim.Sad : Anim.Idle;
        a.until = now + 2 + rnd() * 4;
      }
      continue;
    }
    const s = Math.min(d, speed * dt);
    a.x += (dx / d) * s;
    a.z += (dz / d) * s;
    a.heading = Math.atan2(dx, dz);
  }
}

function snapshot(agents: Walker[], tick: number): Snapshot {
  const buf = new Float32Array(agents.length * AGENT_STRIDE);
  agents.forEach((a, i) => {
    const o = i * AGENT_STRIDE;
    buf[o] = a.x;
    buf[o + 1] = a.z;
    buf[o + 2] = a.heading;
    buf[o + 3] = a.anim;
    buf[o + 4] = a.kind;
    buf[o + 5] = a.variant;
    buf[o + 6] = a.mood;
    buf[o + 7] = a.id;
  });
  return {
    tick,
    time: performance.now(),
    agentCount: agents.length,
    agents: buf,
    objectsVersion: 1,
    floorVersion: 1,
    hud: {} as Snapshot['hud'],
    events: [],
  };
}

// ---------- boot ----------

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const stage = new Stage(canvas);
const god = new GodCamera(canvas);
god.focus.set(40, 0, 36);
god.distance = 60;
const fixedCam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
let useFixed = false;

stage.setFloor(buildPlan());
const { views, seats } = buildObjects();
stage.setObjects(views);
const agents = makeAgents(seats);
const quality = q.get('quality');
if (quality === 'medium' || quality === 'low' || quality === 'high') stage.setQuality(quality);
if (q.get('dynres') === '0') stage.dynamicResolution = false;

const SHOTS: Record<string, [number, number, number, number, number, number, number?]> = {
  overview: [12, 46, 70, 46, 0, 30],
  pit: [62, 13, 30, 63, 0, 16],
  blackjack: [53.3, 2.6, 7.6, 53, 0.7, 4],
  roulette: [57.3, 2.6, 7.6, 57, 0.7, 4],
  craps: [61.3, 2.6, 7.6, 61, 0.7, 4],
  uth: [65.3, 2.6, 7.6, 65, 0.7, 4],
  carnival: [69.3, 2.6, 7.6, 69, 0.7, 4],
  highlimit: [90, 2.1, 19.5, 84, 0.7, 7],
  slots: [7, 2.2, 6.2, 4, 1.2, 3],
  eye: [40, 1.65, 39, 20, 1.5, 38, 70],
  food: [86, 9, 76, 86, 0, 58],
  entrance: [104, 4, 38, 90, 1, 38],
};

function shot(name: string): void {
  const s = SHOTS[name];
  if (!s) return;
  useFixed = true;
  fixedCam.position.set(s[0], s[1], s[2]);
  fixedCam.fov = s[6] ?? 45;
  fixedCam.lookAt(s[3], s[4], s[5]);
  fixedCam.updateProjectionMatrix();
}
if (q.get('shot')) shot(q.get('shot')!);

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  stage.resize(w, h);
  god.resize(w, h);
  fixedCam.aspect = w / h;
  fixedCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// 10 Hz fake sim feeding the same Snapshot shape the worker sends.
let prev: Snapshot | null = null;
let curr = snapshot(agents, 0);
let currAt = performance.now();
let tick = 0;
setInterval(() => {
  step(agents, 0.1, performance.now() / 1000);
  prev = curr;
  curr = snapshot(agents, ++tick);
  currAt = performance.now();
  // Slot wins: a payout label and topper flash somewhere on the floor.
  if (q.get('payouts') !== '0' && tick % 3 === 0) {
    const s = seats[Math.floor(rnd() * seats.length)]!;
    const big = rnd() < 0.15;
    stage.spawnPayout(s.x, s.z + (s.heading === 0 ? 0.6 : -0.6), big ? 1000 + Math.round(rnd() * 9000) : 5 + Math.round(rnd() * 200));
  }
}, 100);

// GPU timing via EXT_disjoint_timer_query_webgl2 (Chrome on Apple silicon supports it).
const gl = stage.renderer.getContext() as WebGL2RenderingContext;
const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
const queries: WebGLQuery[] = [];
let gpuMs = 0;

const frameTimes: number[] = [];
let last = performance.now();
stage.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  frameTimes.push(now - last);
  if (frameTimes.length > 120) frameTimes.shift();
  last = now;
  if (!useFixed) god.update(dt);
  const cam = useFixed ? fixedCam : god.camera;
  const span = prev ? Math.max(1, curr.time - prev.time) : 100;
  stage.updateAgents(prev, curr, Math.min(1, (now - currAt) / span));
  let qy: WebGLQuery | null = null;
  if (timerExt && queries.length < 4) {
    qy = gl.createQuery()!;
    gl.beginQuery(timerExt.TIME_ELAPSED_EXT, qy);
  }
  stage.render(cam);
  if (qy && timerExt) {
    gl.endQuery(timerExt.TIME_ELAPSED_EXT);
    queries.push(qy);
  }
  while (queries.length && timerExt && gl.getQueryParameter(queries[0]!, gl.QUERY_RESULT_AVAILABLE)) {
    const done = queries.shift()!;
    if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT))
      gpuMs = gpuMs * 0.9 + (gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6) * 0.1;
    gl.deleteQuery(done);
  }
  if (frameTimes.length % 15 === 0) drawHud();
});

function metrics() {
  const avg = frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
  const o = stage.objects.stats();
  return {
    fps: Math.round(1000 / avg),
    frameMs: +avg.toFixed(2),
    gpuMs: +gpuMs.toFixed(2),
    cpuRenderMs: +stage.stats.frameMs.toFixed(2),
    calls: stage.stats.calls,
    triangles: stage.stats.triangles,
    objects: o.instances,
    objectPools: o.pools,
    objectsByLod: o.byLod,
    agents: stage.crowd.count,
    agentTiers: stage.crowd.tierCounts(),
    quality: stage.getQuality(),
    renderScale: stage.stats.renderScale,
    size: `${canvas.width}x${canvas.height}`,
  };
}

function drawHud(): void {
  if (document.body.classList.contains('clean')) return;
  const m = metrics();
  hud.textContent = `${m.fps} fps  ${m.frameMs} ms  gpu ${m.gpuMs} ms  cpu ${m.cpuRenderMs} ms
calls ${m.calls}  tris ${(m.triangles / 1e6).toFixed(2)}M  ${m.size}
objects ${m.objects} (pools ${m.objectPools}, lod ${m.objectsByLod.join('/')})
agents ${m.agents} (tiers ${m.agentTiers.join('/')})  ${m.quality} @ ${m.renderScale}\n`;
  for (const name of ['god', ...Object.keys(SHOTS)]) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => (name === 'god' ? (useFixed = false) : shot(name));
    hud.appendChild(b);
  }
  hud.appendChild(document.createElement('br'));
  for (const ql of ['high', 'medium', 'low'] as const) {
    const b = document.createElement('button');
    b.textContent = ql;
    b.onclick = () => stage.setQuality(ql);
    hud.appendChild(b);
  }
  const z = document.createElement('button');
  z.textContent = 'zones';
  let zon = false;
  z.onclick = () => stage.showZoneOverlay((zon = !zon));
  hud.appendChild(z);
}

Object.assign(window, {
  lab: {
    stage,
    god,
    shot,
    metrics,
    setCam(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 45) {
      useFixed = true;
      fixedCam.position.set(px, py, pz);
      fixedCam.fov = fov;
      fixedCam.lookAt(tx, ty, tz);
      fixedCam.updateProjectionMatrix();
    },
    free() {
      useFixed = false;
    },
  },
});
