// The renderer's public face. main.ts, the camera rig and the build tools
// talk to this class only; the layers behind it are:
//   ObjectLayer  placed objects as per-(asset, LOD) instance pools
//   FloorLayer   floor / walls / decor / ceiling merged per 8×8 chunk
//   Crowd        every agent through vertex-animation textures
//   Overlays     ghost, zone tint, selection, payout labels
//   FxDirector   sampled real rounds on the objects near the camera
//   Lighting + Post   HDRI, fitted shadows, N8AO, bloom, ACES, SMAA

import * as THREE from 'three';
import { ENTRANCE_TILE, GRID_COLS, GRID_ROWS } from '../config';
import {
  AGENT_STRIDE,
  AgentKind,
  Anim,
  FLOOR_TYPES,
  ZONES,
  type FloorPlanView,
  type ObjectView,
  type Rotation,
  type SimEvent,
  type Snapshot,
  type WallSegment,
} from '../shared/contracts';
import { AssetLibrary } from './assets/AssetLibrary';
import { Crowd } from './Crowd';
import { Exterior } from './Exterior';
import { GameSpots } from './gameSpots';
import { FloorLayer } from './FloorLayer';
import { FxDirector } from './fx/FxDirector';
import { FeltParts } from './fx/FeltParts';
import { TableParts } from './fx/TableParts';
import { Lighting } from './Lighting';
import { objectUniforms } from './materials/ObjectMaterial';
import { ObjectLayer } from './ObjectLayer';
import { Overlays, type GhostPose } from './Overlays';
import { Post, type Quality } from './Post';
import { Practicals } from './Practicals';
import { suggestedQuality } from './gpuTier';
import { CROWD_LOD } from './Crowd';
import { Celebrations, type BigWinEvent } from './fx/Celebrations';
import { get3D } from '../shared/catalog';
import { ThoughtIcons } from './ThoughtIcons';

/** Render-side events for the UI (A12). Track B's news line listens via Stage.onRenderEvent. */
export type RenderEvent = BigWinEvent;
const _box = new THREE.Box3();

// High: shadows, N8AO, full bloom, real point lights, full crowd LOD bands.
// Low: baked light pools only, no shadows or AO, cheaper bloom, shorter crowd bands.
const QUALITY: Record<
  Quality,
  { pixelRatio: number; shadow: number; shadows: boolean; realLights: boolean; crowdLod: readonly [number, number] }
> = {
  // The shadow frustum is refitted to the view every frame, so 2048² is
  // already ~2 cm texels at god-cam range; 4096² cost ~3× as much on an A18 Pro.
  high: { pixelRatio: 2, shadow: 2048, shadows: true, realLights: true, crowdLod: CROWD_LOD },
  medium: { pixelRatio: 1.5, shadow: 2048, shadows: true, realLights: false, crowdLod: CROWD_LOD },
  low: { pixelRatio: 1, shadow: 1024, shadows: false, realLights: false, crowdLod: [9, 30] },
};

/** Rounds play out on games within this distance of the camera. */
const INTEREST_RADIUS_M = 24;
const focus = new THREE.Vector3();
const fwd = new THREE.Vector3();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** The ground plane under and around the lot; build tools raycast it. */
  readonly ground: THREE.Mesh;
  /** A11: the outside, the doors and the sky; `setHour` follows the sim clock. */
  readonly exterior: Exterior;
  private hourShown = -1;
  /** Legacy box ghost kept for the skeleton BuildTool; prefer showGhost(). */
  readonly ghost: THREE.Mesh;
  readonly assets = new AssetLibrary();
  readonly objects: ObjectLayer;
  readonly floor: FloorLayer;
  readonly crowd = new Crowd();
  private gameSpots = new GameSpots();
  readonly overlays: Overlays;
  readonly fx: FxDirector;
  /** Roulette heads and balls, dice, big six faces on watched tables. */
  readonly parts: TableParts;
  /** Dealt cards and chips on watched card tables. */
  readonly felt: FeltParts;
  readonly lighting: Lighting;
  /** Light pools on the floor and, on High, real lights near the camera (A8). */
  readonly practicals: Practicals;
  /** Big-win beacons, confetti and cheers (A12). */
  readonly celebrations = new Celebrations();
  /** Thought bubbles over the hovered/selected guest and in the Mood view (A12); main.ts feeds them. */
  readonly thoughts = new ThoughtIcons();
  /** Who gets a bubble this frame; set by main.ts's ThoughtFeed. */
  thoughtFocus: { focus: ReadonlySet<number>; moodView: boolean } = { focus: new Set(), moodView: false };
  /** Render events for the UI: a big win for the news line (A12). Replace to listen. */
  onRenderEvent: (e: RenderEvent) => void = () => {};
  private post: Post;
  private quality: Quality = 'high';
  private lastCamera: THREE.PerspectiveCamera | null = null;
  private lastAgentsAt = performance.now();
  private clock = new THREE.Clock();
  private hasFloor = false;
  private ceilingWarm = false;
  private lastAgents: { prev: Snapshot | null; curr: Snapshot; alpha: number } | null = null;
  private selected: string | null = null;
  /** null = automatic (from camera height); otherwise forced ceiling fade. */
  viewMode: 'god' | 'avatar' | null = null;
  /** Per-frame stats, read by the lab page and playtests. */
  readonly stats = { calls: 0, triangles: 0, frameMs: 0, renderScale: 1 };
  /** Dynamic resolution: when the GPU can't hold ~60 fps, render fewer pixels
   *  (down to 70 %) rather than drop frames; climb back when there's headroom. */
  dynamicResolution = true;
  private renderScale = 1;
  private frameEma = 16.7;
  private lastFrameAt = 0;
  private scaleCheckAt = 0;
  private upscaleBlockedUntil = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA in post
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(Math.min(QUALITY.high.pixelRatio, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    // Hardware 2×2 PCF: soft enough with the fitted frustum, far cheaper per pixel than PCFSoft.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Tone mapping runs in the post stack (ToneMappingEffect, ACES).
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.lighting = new Lighting(this.scene, this.renderer);
    this.objects = new ObjectLayer(this.assets);
    this.floor = new FloorLayer(this.assets);
    this.overlays = new Overlays(this.assets);
    this.fx = new FxDirector(this.objects, this.overlays);
    this.parts = new TableParts(this.assets);
    this.felt = new FeltParts(this.assets);
    this.floor.onZones = (g) => this.overlays.rebuildZones(g);
    this.practicals = new Practicals((key) => this.assets.get(key).lights);
    // ObjectLayer already listens for loaded assets; chain on, don't replace.
    const objectsOnUpdate = this.assets.onUpdate;
    this.assets.onUpdate = (a) => {
      objectsOnUpdate(a);
      if (a.lights.length) this.practicals.markDirty();
    };
    this.scene.add(
      this.floor.group,
      this.objects.group,
      this.parts.group,
      this.felt.group,
      this.crowd.group,
      this.overlays.group,
      this.practicals.group,
      this.celebrations.group,
      this.thoughts.mesh,
    );
    this.fx.onBigWin = (id, fx, at) => this.bigWin(id, fx.returned, at.x, at.z);
    this.crowd.gameAt = (x, z) => this.gameSpots.at(x, z);

    // Exterior: a dark stone plaza the lot sits on, faded out by fog.
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1b1720, roughness: 0.85, metalness: 0 }),
    );
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground);
    // A11: facade, street, doors and the sky over them.
    this.exterior = new Exterior(this.assets, this.scene, this.ground);
    this.scene.add(this.exterior.group);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({
        color: 0x2ecc71,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.post = new Post(this.renderer, this.scene, new THREE.PerspectiveCamera());
    this.setQuality('high');
    // Until the sim sends a floor plan, show the v1 lot: carpeted, walls north and west.
    this.setFloor(defaultPlan());
  }

  // ---------- data in ----------

  /** Diff the object list into the instance pools (no Mesh per object). */
  setObjects(objects: ObjectView[]): void {
    this.objects.setObjects(objects);
    this.practicals.setObjects(objects);
    this.gameSpots.set(objects);
    if (this.selected && !this.objects.get(this.selected)) this.setSelected(null);
  }

  setFloor(plan: FloorPlanView): void {
    this.floor.setFloor(plan);
    this.practicals.setFloor(plan);
    this.exterior.setFloor(plan);
    // The plaza stays centred under whatever lot the scenario brought.
    this.ground.position.set(plan.cols / 2, -0.02, plan.rows / 2);
    this.hasFloor = true;
  }

  /** The player's avatar, drawn as one more crowd agent (the Avatar outfit)
   *  so it is the same rigged, animated human as everyone else. Null hides it. */
  avatar: AvatarPose | null = null;
  private avatarPrevSrc: Snapshot | null = null;
  private avatarPrev: Snapshot | null = null;

  /** Interpolate agents between two snapshots matched by numeric id. */
  updateAgents(prev: Snapshot | null, curr: Snapshot, alpha: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastAgentsAt) / 1000);
    this.lastAgentsAt = now;
    if (this.avatar) {
      // Same pose in prev and curr, so interpolation leaves it where the
      // controller put it. prev is rebuilt only when the sim's prev changes:
      // the crowd caches its id index by snapshot identity.
      if (prev !== this.avatarPrevSrc) {
        this.avatarPrevSrc = prev;
        this.avatarPrev = prev ? withAgent(prev, this.avatar) : null;
      } else if (this.avatarPrev) writeAgent(this.avatarPrev, this.avatar);
      prev = this.avatarPrev;
      curr = withAgent(curr, this.avatar);
    }
    this.lastAgents = { prev, curr, alpha };
    this.exterior.setAgents(curr);
    const hour = curr.hud ? curr.hud.hour + curr.hud.minute / 60 : -1;
    // Sky colours move slowly; refresh on each in-game minute change.
    if (hour >= 0 && hour !== this.hourShown) {
      this.hourShown = hour;
      this.exterior.setHour(hour);
    }
    if (this.lastCamera) this.crowd.update(prev, curr, alpha, this.lastCamera, dt);
  }

  /** Convenience for main.ts: payout labels + win flashes from sim events,
   *  and the rounds sampled at watched objects. */
  handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'payout') this.spawnPayout(e.x, e.z, e.amount);
      else if (e.type === 'roundFx') this.fx.round(e.objectId, e.fx);
    }
  }

  /** Engine games close enough to watch a round on (setInterest), nearest first. */
  interestIds(): string[] {
    const ids = this.lastCamera
      ? this.objects.nearGames(this.lastCamera, INTEREST_RADIUS_M, 48)
      : [];
    this.fx.retain(new Set(ids));
    return ids;
  }

  // ---------- interaction ----------

  pickObject(raycaster: THREE.Raycaster): string | null {
    return this.objects.pick(raycaster.ray);
  }

  pickAgent(raycaster: THREE.Raycaster): number | null {
    return this.crowd.pick(raycaster.ray);
  }

  showZoneOverlay(on: boolean): void {
    this.overlays.showZones(on);
  }

  /** Floating "+$1,250" and a topper flash on whatever stands at (x, z). */
  spawnPayout(x: number, z: number, amount: number): void {
    // elapsedTime, not getElapsedTime(): that would eat the next frame's delta.
    const t = this.clock.elapsedTime;
    this.overlays.spawnPayout(x, z, amount);
    if (amount > 0) this.objects.flashAt(x, z, t);
  }

  /** A big win landed on a machine: beacon, confetti, a bell after the
   *  jackpot sting, nearby standing guests cheer, and a news-line event.
   *  Only ever called for a real round the sim paid (FxDirector.reveal). */
  bigWin(objectId: string, amount: number, x: number, z: number): void {
    const o = this.objects.get(objectId);
    const defId = o?.view.defId ?? '';
    // Sit the beacon on the model's real top (the catalog height is nominal).
    const geo = o?.asset.lods[0];
    if (geo && !geo.boundingBox) geo.computeBoundingBox();
    const top = geo?.boundingBox ? _box.copy(geo.boundingBox).applyMatrix4(o!.matrix).max.y : 0;
    const height = top > 0.3 ? top : defId ? get3D(defId).height : 1.8;
    this.celebrations.start(x, z, height, this.clock.elapsedTime);
    this.fx.sound('bell', { x, y: height, z }, 0.9);
    this.crowd.cheerNear(x, z, 5, 4);
    this.onRenderEvent({ type: 'bigWin', objectId, defId, amount, x, z });
  }

  /** Hologram placement ghost from the real asset; defId null hides it. */
  showGhost(defId: string | null, col = 0, row = 0, rot: Rotation = 0, valid = true, pose?: GhostPose): void {
    this.ghost.visible = false;
    this.overlays.showGhost(defId, col, row, rot, valid, pose);
  }

  setSelected(id: string | null): void {
    this.selected = id;
    const o = id ? this.objects.get(id) : null;
    this.overlays.setSelected(o ? { geometry: o.asset.lods[0], matrix: o.matrix } : null);
  }

  setHovered(id: string | null): void {
    this.objects.setHovered(id);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const cfg = QUALITY[q];
    this.renderScale = 1;
    this.applyPixelRatio();
    this.lighting.setShadowSize(cfg.shadow, cfg.shadows);
    this.post.setQuality(q);
    this.practicals.setRealLights(cfg.realLights);
    this.crowd.lodBands = cfg.crowdLod;
    const c = this.renderer.domElement;
    this.resize(c.clientWidth || 1, c.clientHeight || 1);
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** The tier to start on for this GPU: Low on software and weak integrated or
   *  mobile GPUs, else High. For Settings' Auto (Track B request in 10-alive-2.md). */
  suggestedQuality(): Quality {
    return suggestedQuality(this.renderer.getContext());
  }

  private applyPixelRatio(): void {
    const base = Math.min(QUALITY[this.quality].pixelRatio, window.devicePixelRatio);
    this.renderer.setPixelRatio(base * this.renderScale);
    this.stats.renderScale = this.renderScale;
  }

  private adaptResolution(now: number): void {
    if (this.lastFrameAt) {
      const dt = Math.min(100, now - this.lastFrameAt);
      this.frameEma += (dt - this.frameEma) * 0.05;
    }
    this.lastFrameAt = now;
    if (!this.dynamicResolution || now < this.scaleCheckAt) return;
    this.scaleCheckAt = now + 1500;
    let next = this.renderScale;
    if (this.frameEma > 18.2 && this.renderScale <= 0.7 && this.quality !== 'low') {
      // Already at the resolution floor and still slow: shed a quality tier.
      this.setQuality(this.quality === 'high' ? 'medium' : 'low');
      this.upscaleBlockedUntil = now + 8000;
      return;
    }
    if (this.frameEma > 18.2 && this.renderScale > 0.7) {
      next = Math.max(0.7, this.renderScale - 0.1);
      // Just came down from a failed step up: stay put for a while.
      if (next < this.renderScale)
        this.upscaleBlockedUntil = Math.max(this.upscaleBlockedUntil, now + 8000);
    } else if (this.frameEma < 17.2 && this.renderScale < 1 && now > this.upscaleBlockedUntil) {
      next = Math.min(1, this.renderScale + 0.1);
      this.upscaleBlockedUntil = now + 4000;
    }
    if (next === this.renderScale) return;
    this.renderScale = Math.round(next * 100) / 100;
    this.applyPixelRatio();
    const c = this.renderer.domElement;
    this.resize(c.clientWidth || 1, c.clientHeight || 1);
  }

  // ---------- frame ----------

  resize(w: number, h: number): void {
    // The composer resizes the renderer and every pass at the renderer's pixel ratio.
    this.post.setSize(w, h);
  }

  render(camera: THREE.Camera): void {
    const t0 = performance.now();
    this.adaptResolution(t0);
    const dt = this.clock.getDelta();
    const now = this.clock.elapsedTime;
    const cam = camera as THREE.PerspectiveCamera;
    this.lastCamera = cam;
    objectUniforms.uTime.value = now;
    this.fx.update(now);
    this.fx.drawParts(this.parts, this.felt);
    if (!this.ceilingWarm && this.floor.hasCeiling && this.crowd.ready && this.lastAgents?.curr.agentCount) this.warmEyeLevel(cam, now);
    this.updateView(cam);
    this.objects.update(cam, now);
    this.overlays.update(now, cam);
    this.practicals.update(cam, now);
    this.celebrations.update(now, dt);
    this.exterior.update(dt);
    this.thoughts.update(this.crowd.drawnAgents, cam.position, this.thoughtFocus.moodView, this.thoughtFocus.focus, dt);
    if (this.lighting.sun.castShadow) this.lighting.update(cam);
    this.renderer.info.reset();
    this.post.render(cam, dt);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.frameMs = performance.now() - t0;
    void this.hasFloor;
  }

  /**
   * A12 fix for the first-eye-level hitch (190–1,000 ms). Four shaders exist
   * only for cameras under the ceiling: the ceiling's alpha-hashed material
   * (two variants), the full-detail crowd mesh and its shadow-depth pass. They
   * used to compile on the first avatar frame. Instead, once there is a ceiling
   * and someone on the floor, render one throwaway frame from eye level behind
   * the first agent, then put the crowd back for the real camera. The real
   * frame draws over it before anything reaches the screen.
   * renderer.compileAsync isn't enough: outside the post stack's half-float
   * target it builds a different variant, and it never sees the shadow pass.
   */
  private warmEyeLevel(cam: THREE.PerspectiveCamera, now: number): void {
    this.ceilingWarm = true;
    const { prev, curr, alpha } = this.lastAgents!;
    const x = curr.agents[0]!;
    const z = curr.agents[1]!;
    const eye = new THREE.PerspectiveCamera(65, cam.aspect, 0.1, 500);
    eye.position.set(x - 2.5, 1.6, z);
    eye.lookAt(x, 1.2, z);
    eye.updateMatrixWorld();
    this.crowd.update(prev, curr, alpha, eye, 0);
    this.updateView(eye);
    this.objects.update(eye, now);
    if (this.lighting.sun.castShadow) this.lighting.update(eye);
    this.post.render(eye, 0);
    this.crowd.update(prev, curr, alpha, cam, 0);
  }

  /** God cam: walls between camera and focus cut down, ceiling hidden. Low
   *  (avatar) cameras: full walls and the coffered ceiling fade in. */
  private updateView(cam: THREE.PerspectiveCamera): void {
    cam.getWorldDirection(fwd);
    const r = new THREE.Ray(cam.position, fwd);
    if (!r.intersectPlane(groundPlane, focus)) focus.copy(cam.position);
    objectUniforms.uFocus.value.set(focus.x, focus.z);
    const flat = Math.hypot(fwd.x, fwd.z) || 1;
    objectUniforms.uCamDir.value.set(fwd.x / flat, fwd.z / flat);
    // The ceiling (3.4 m) only exists for cameras under it: avatar views, or a
    // god cam zoomed right down to eye level. From above it would hide the floor.
    const y = cam.position.y;
    const auto = 1 - THREE.MathUtils.smoothstep(y, 2.4, 3.1);
    const fade = this.viewMode === 'avatar' ? 1 : this.viewMode === 'god' ? 0 : auto;
    objectUniforms.uCutOn.value = 1 - fade;
    this.floor.setCeiling(fade);
  }
}

/** The v1 lot until a real FloorPlanView arrives: red carpet, walls on the
 *  north and west edges, the entrance gap on the east. */
export function defaultPlan(): FloorPlanView {
  const cols = GRID_COLS;
  const rows = GRID_ROWS;
  const floor = new Uint8Array(cols * rows).fill(FLOOR_TYPES.indexOf('carpet-red'));
  const zone = new Uint8Array(cols * rows).fill(ZONES.indexOf('gaming'));
  const walls: WallSegment[] = [];
  for (let c = 0; c < cols; c++) walls.push({ col: c, row: 0, edge: 'n', door: false });
  for (let r = 0; r < rows; r++) walls.push({ col: 0, row: r, edge: 'w', door: false });
  return { cols, rows, floor, zone, walls, entrance: { ...ENTRANCE_TILE } };
}

/** The avatar's slot: id 0 with AgentKind.Avatar never collides with a sim agent. */
export interface AvatarPose {
  x: number;
  z: number;
  heading: number;
  moving: boolean;
  /** A pose other than walking or standing (seated at a game). */
  anim?: Anim;
}

function writeAgent(s: Snapshot, p: AvatarPose): void {
  const o = (s.agentCount - 1) * AGENT_STRIDE;
  const a = s.agents;
  a[o] = p.x;
  a[o + 1] = p.z;
  a[o + 2] = p.heading;
  a[o + 3] = p.anim ?? (p.moving ? Anim.Walk : Anim.Idle);
}

function withAgent(s: Snapshot, p: AvatarPose): Snapshot {
  const n = s.agentCount;
  const agents = new Float32Array((n + 1) * AGENT_STRIDE);
  agents.set(s.agents.subarray(0, n * AGENT_STRIDE));
  const o = n * AGENT_STRIDE;
  agents[o + 4] = AgentKind.Avatar;
  agents[o + 5] = 0;
  agents[o + 6] = 1;
  agents[o + 7] = 0;
  const out = { ...s, agents, agentCount: n + 1 };
  writeAgent(out, p);
  return out;
}
