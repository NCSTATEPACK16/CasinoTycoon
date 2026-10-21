// The god camera: an orbit rig around a ground focus point. Input moves a
// set of *targets* (focus, yaw, distance, tilt); the rig chases them with
// critically damped springs, so every gesture glides to rest instead of
// stopping dead. Pitch is not a free axis: it eases with distance, low and
// cinematic close in, near top-down far out, plus a small user tilt.
//
// Controls: WASD/arrows, screen edges or middle-drag pan; Q/E tap snaps 90°,
// hold spins; right-drag orbits and tilts; the wheel zooms toward the cursor;
// double-click focuses. The rig only reads input while `active`.

import * as THREE from 'three';
import { GRID_COLS, GRID_ROWS } from '../config';
import { Keys, KEYS_BACK, KEYS_FORWARD, KEYS_LEFT, KEYS_RIGHT, isTyping } from '../input/Keys';
import { damp, dampAngle, dampFactor, smootherstep } from './blend';

/** What the lead's save stores to bring the view back exactly. */
export interface CameraState {
  focus: { x: number; z: number };
  yaw: number;
  distance: number;
  tilt: number;
}

export const GOD_FOV = 45;
const MIN_DIST = 6;
const MAX_DIST = 90;
const PITCH_NEAR = 0.42; // ~24° above the horizon at 6 m
const PITCH_FAR = 1.38; // ~79°, nearly top-down at 90 m
const MAX_TILT = 0.3;
const EDGE_PX = 14;
const SNAP_HOLD_MS = 220;
const QUARTER = Math.PI / 2;

/** Pitch for a given zoom distance, before user tilt. */
export function pitchForDistance(d: number): number {
  const t = (d - MIN_DIST) / (MAX_DIST - MIN_DIST);
  return PITCH_NEAR + (PITCH_FAR - PITCH_NEAR) * smootherstep(Math.pow(Math.max(0, t), 0.6));
}

export class GodCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Whether keyboard/mouse drive the rig (false while the avatar has the camera). */
  active = true;
  /** Lot extent the focus is clamped to, in metres. */
  bounds = { cols: GRID_COLS, rows: GRID_ROWS };
  /** Where the rig wants to be; input writes here. */
  readonly target = {
    focus: new THREE.Vector3(20, 0, 15),
    yaw: Math.PI / 4,
    distance: 32,
    tilt: 0,
  };
  /** Where the rig is now; springs chase `target`. */
  readonly focus = new THREE.Vector3(20, 0, 15);
  yaw = Math.PI / 4;
  distance = 32;
  tilt = 0;
  /** The rig's own pose this frame, whether or not it is driving `camera`. */
  readonly pose = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    fov: GOD_FOV,
  };

  private keys: Keys;
  private drag: 'orbit' | 'pan' | null = null;
  private pointer: { x: number; y: number; overCanvas: boolean } | null = null;
  private qeDown = new Map<string, number>();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  // A camera, not an Object3D: Camera.lookAt points -z at the target, which is what we want.
  private look = new THREE.PerspectiveCamera();

  constructor(
    private dom: HTMLElement,
    keys?: Keys,
  ) {
    this.keys = keys ?? new Keys();
    this.camera = new THREE.PerspectiveCamera(GOD_FOV, 1, 0.1, 500);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.button === 2) this.drag = 'orbit';
      if (e.button === 1) {
        this.drag = 'pan';
        e.preventDefault(); // no autoscroll cursor
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 1 || e.button === 2) this.drag = null;
    });
    window.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY, overCanvas: e.target === dom };
      if (!this.active || !this.drag) return;
      if (this.drag === 'orbit') {
        this.target.yaw -= e.movementX * 0.006;
        this.target.tilt = THREE.MathUtils.clamp(
          this.target.tilt + e.movementY * 0.003,
          -MAX_TILT,
          MAX_TILT,
        );
      } else {
        // Grab-and-drag: one pixel of mouse is about one pixel of ground at the focus.
        const k =
          (this.distance * Math.tan(THREE.MathUtils.degToRad(GOD_FOV / 2)) * 2) / dom.clientHeight;
        this.panBy(-e.movementX * k, (-e.movementY * k) / Math.max(0.35, Math.sin(this.pitch)));
      }
    });
    document.addEventListener('pointerleave', () => (this.pointer = null));
    window.addEventListener('blur', () => {
      this.pointer = null;
      this.drag = null;
    });
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    dom.addEventListener('dblclick', (e) => {
      if (!this.active) return;
      const p = this.groundAt(e.clientX, e.clientY);
      if (!p) return;
      this.target.focus.set(p.x, 0, p.z);
      this.target.distance = Math.min(this.target.distance, 18);
      this.clampTarget();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active || isTyping(e) || e.repeat) return;
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.qeDown.set(e.code, performance.now());
    });
    window.addEventListener('keyup', (e) => {
      const t = this.qeDown.get(e.code);
      if (t === undefined) return;
      this.qeDown.delete(e.code);
      // A tap snaps to the next quarter turn; a hold already spun freely in update().
      if (this.active && performance.now() - t < SNAP_HOLD_MS)
        this.snapYaw(e.code === 'KeyQ' ? 1 : -1);
    });
  }

  get pitch(): number {
    return pitchForDistance(this.distance) + this.tilt;
  }

  /** Rotate to the next multiple of 90° in `dir` (+1 = Q, counter-clockwise). */
  snapYaw(dir: 1 | -1): void {
    const k = this.target.yaw / QUARTER;
    // Nudge off an exact quarter so a tap from one always moves a full step.
    const next = dir > 0 ? Math.floor(k + 1e-3) + 1 : Math.ceil(k - 1e-3) - 1;
    this.target.yaw = next * QUARTER;
  }

  focusOn(x: number, z: number, distance?: number): void {
    this.target.focus.set(x, 0, z);
    if (distance !== undefined)
      this.target.distance = THREE.MathUtils.clamp(distance, MIN_DIST, MAX_DIST);
    this.clampTarget();
  }

  /** Jump the springs to their targets (after a load, or to hand over cleanly). */
  settle(): void {
    this.focus.copy(this.target.focus);
    this.yaw = this.target.yaw;
    this.distance = this.target.distance;
    this.tilt = this.target.tilt;
    this.computePose();
  }

  getState(): CameraState {
    const t = this.target;
    return {
      focus: { x: t.focus.x, z: t.focus.z },
      yaw: t.yaw,
      distance: t.distance,
      tilt: t.tilt,
    };
  }

  setState(s: CameraState): void {
    this.target.focus.set(s.focus.x, 0, s.focus.z);
    this.target.yaw = s.yaw;
    this.target.distance = THREE.MathUtils.clamp(s.distance, MIN_DIST, MAX_DIST);
    this.target.tilt = THREE.MathUtils.clamp(s.tilt ?? 0, -MAX_TILT, MAX_TILT);
    this.clampTarget();
    this.settle();
  }

  /** Ground-plane point under a client-space position, using the live camera. */
  groundAt(
    clientX: number,
    clientY: number,
    camera: THREE.Camera = this.camera,
  ): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, camera);
    return this.ray.ray.intersectPlane(this.plane, this.tmp) ? this.tmp.clone() : null;
  }

  update(dt: number, drive = true): void {
    if (this.active) this.readHeldInput(dt);
    // Springs: focus and zoom settle in ~0.3 s, rotation a touch slower so snaps read as a swing.
    this.focus.lerp(this.target.focus, dampFactor(14, dt));
    this.distance = damp(this.distance, this.target.distance, 12, dt);
    this.yaw = dampAngle(this.yaw, this.target.yaw, 10, dt);
    this.tilt = damp(this.tilt, this.target.tilt, 12, dt);
    this.computePose();
    if (drive) {
      this.camera.position.copy(this.pose.position);
      this.camera.quaternion.copy(this.pose.quaternion);
      if (this.camera.fov !== GOD_FOV) {
        this.camera.fov = GOD_FOV;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readHeldInput(dt: number): void {
    const k = this.keys;
    const speed = this.distance * 0.9 * dt;
    let f = k.axis(KEYS_BACK, KEYS_FORWARD);
    let s = k.axis(KEYS_LEFT, KEYS_RIGHT);
    // Screen-edge scroll, only while the pointer is actually over the 3D view.
    const p = this.pointer;
    if (p?.overCanvas && !this.drag) {
      if (p.x < EDGE_PX) s -= 1;
      else if (p.x > window.innerWidth - EDGE_PX) s += 1;
      if (p.y < EDGE_PX) f += 1;
      else if (p.y > window.innerHeight - EDGE_PX) f -= 1;
    }
    if (f || s) this.panBy(s * speed, -f * speed);
    // Q/E held past the tap threshold spin freely.
    const now = performance.now();
    for (const [code, t] of this.qeDown)
      if (now - t >= SNAP_HOLD_MS) this.target.yaw += (code === 'KeyQ' ? 1 : -1) * 1.6 * dt;
  }

  /** Pan in screen terms: +right is screen-right, +down is toward the viewer. */
  private panBy(right: number, down: number): void {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // Camera sits at focus + (sin yaw, ·, cos yaw)·d, so "toward the viewer" is (sin, cos).
    this.target.focus.x += cy * right + sy * down;
    this.target.focus.z += -sy * right + cy * down;
    this.clampTarget();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.active) return;
    const before = this.target.distance;
    const after = THREE.MathUtils.clamp(before * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
    this.target.distance = after;
    // Zoom toward the cursor: slide the focus toward the ground point under it
    // by the same fraction the distance shrank (and away when zooming out).
    const p = this.groundAt(e.clientX, e.clientY);
    if (p) {
      const f = 1 - after / before;
      this.target.focus.x += (p.x - this.target.focus.x) * f;
      this.target.focus.z += (p.z - this.target.focus.z) * f;
      this.clampTarget();
    }
  }

  private clampTarget(): void {
    const f = this.target.focus;
    f.x = THREE.MathUtils.clamp(f.x, 0, this.bounds.cols);
    f.z = THREE.MathUtils.clamp(f.z, 0, this.bounds.rows);
  }

  private computePose(): void {
    const c = Math.cos(this.pitch);
    const d = this.distance;
    this.pose.position.set(
      this.focus.x + Math.sin(this.yaw) * c * d,
      Math.sin(this.pitch) * d,
      this.focus.z + Math.cos(this.yaw) * c * d,
    );
    this.look.position.copy(this.pose.position);
    this.look.lookAt(this.focus);
    this.pose.quaternion.copy(this.look.quaternion);
  }
}
