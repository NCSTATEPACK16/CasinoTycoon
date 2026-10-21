// Owns the one render camera and decides who drives it: the god rig, the
// avatar's 3rd-person spring arm, its eyes, or a seat at a game.
//
// V (or Tab) cycles God → 3rd → 1st → God; Esc returns to God from anywhere.
// Every switch blends over 0.8 s: position rides a cubic Hermite (dollying
// forward along the view when going in, backward when coming out),
// orientation slerps, FOV lerps, all on a smootherstep clock so the move
// starts and lands with zero velocity. The destination pose is re-evaluated
// every frame, so the blend tracks an avatar that is still walking.
//
// Fires `cameraModeChange` on window ({ from, to, phase: 'start' | 'end',
// duration }) so the renderer can fade ceilings in and out with the snap.

import * as THREE from 'three';
import type { SimClient } from '../client/SimClient';
import { Keys, KEYS_BACK, KEYS_FORWARD, KEYS_LEFT, KEYS_RIGHT, isTyping } from '../input/Keys';
import type { Avatar } from '../input/avatar/Avatar';
import { AVATAR_HEIGHT } from '../input/avatar/collision';
import { damp, hermite, smootherstep } from './blend';
import { GOD_FOV, type GodCamera } from './GodCamera';

export type CameraMode = 'god' | 'third' | 'first' | 'seat';

export interface CameraModeChange {
  from: CameraMode;
  to: CameraMode;
  phase: 'start' | 'end';
  duration: number;
}

export interface Seat {
  objectId: string;
  /** World position of the seat (y = 0) and the direction it faces. */
  x: number;
  z: number;
  facing: number;
  /** Point the seated camera looks at (the table/machine centre). */
  lookAt: { x: number; z: number };
}

export const TRANSITION_S = 0.8;
const FOV: Record<CameraMode, number> = { god: GOD_FOV, third: 65, first: 75, seat: 70 };
/** How "deep" a mode is: going deeper dollies forward, shallower pulls back. */
const DEPTH: Record<CameraMode, number> = { god: 0, third: 1, first: 2, seat: 3 };
const EYE_Y = AVATAR_HEIGHT - 0.13;
const SEAT_EYE_Y = 1.25;
const ARM_LENGTH = 3.4;
const ARM_MIN = 0.7;
const ARM_PIVOT_Y = 1.5;
const ARM_CLEARANCE = 0.25;
const LOOK_SENS = 0.0022;

interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
}

const pose = (): Pose => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  fov: GOD_FOV,
});

export class CameraDirector {
  mode: CameraMode = 'god';
  /** 0 in god view, 1 at eye level, blended through transitions (for ceiling fades). */
  interior = 0;
  seat: Seat | null = null;
  /** Called whenever the mode changes, before the blend starts. */
  onModeChange: (from: CameraMode, to: CameraMode) => void = () => {};

  /** 3rd-person orbit (god-rig convention: camera sits at pivot + (sin, ·, cos)·arm). */
  armYaw = 0;
  armPitch = 0.32;
  private armLen = ARM_LENGTH;
  /** 1st-person look (heading convention: forward = (sin, cos)). */
  lookYaw = 0;
  lookPitch = -0.08;

  private prevAvatarMode: 'third' | 'first' = 'third';
  private blend: { t: number; from: Pose; fromMode: CameraMode; deeper: boolean } | null = null;
  private live = pose();
  private dummy = new THREE.PerspectiveCamera();
  private dragging = false;
  private releasingLock = false;
  private m0 = new THREE.Vector3();
  private m1 = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  constructor(
    private dom: HTMLElement,
    private god: GodCamera,
    private avatar: Avatar,
    private sim: SimClient,
    private keys: Keys,
  ) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.repeat) return;
      if (e.code === 'KeyV' || e.code === 'Tab') {
        e.preventDefault();
        this.cycle();
      } else if (e.code === 'Escape' && this.mode !== 'god') this.setMode('god');
    });
    dom.addEventListener('pointerdown', (e) => {
      if (this.mode === 'third' || (this.mode === 'first' && !this.locked)) this.dragging = true;
      if (this.mode === 'first' && !this.locked && e.button === 0) this.lock();
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => this.onLook(e));
    document.addEventListener('pointerlockchange', () => {
      // The browser eats Esc to release pointer lock, so a lost lock in first
      // person *is* the Esc press. Our own releases are flagged and ignored.
      if (!this.locked && this.mode === 'first' && !this.releasingLock) this.setMode('god');
      this.releasingLock = false;
    });
  }

  get camera(): THREE.PerspectiveCamera {
    return this.god.camera;
  }

  get transitioning(): boolean {
    return this.blend !== null;
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  cycle(): void {
    if (this.mode === 'seat') return this.stand();
    const next: Record<CameraMode, CameraMode> = {
      god: 'third',
      third: 'first',
      first: 'god',
      seat: 'third',
    };
    this.setMode(next[this.mode]);
  }

  setMode(to: CameraMode): void {
    const from = this.mode;
    if (to === from) return;
    // Hand-offs keep the view continuous: the new mode starts looking the way the old one did.
    if (to === 'third' && from === 'god') {
      this.avatar.spawnIfNeeded();
      this.armYaw = this.god.yaw;
      this.armPitch = 0.32;
      this.armLen = ARM_LENGTH;
    }
    if (to === 'third' && from === 'first') this.armYaw = this.lookYaw + Math.PI;
    if (to === 'first' && from === 'third') {
      this.lookYaw = this.armYaw + Math.PI;
      this.lookPitch = -0.08;
    }
    if (to === 'first' && from === 'god') {
      this.avatar.spawnIfNeeded();
      this.lookYaw = this.god.yaw + Math.PI;
      this.lookPitch = -0.08;
    }
    if (to === 'god') {
      // Come out above wherever the avatar is, facing the way we were looking.
      const yaw = from === 'third' ? this.armYaw : this.lookYaw + Math.PI;
      this.god.target.yaw = yaw;
      this.god.focusOn(
        this.avatar.pos.x,
        this.avatar.pos.z,
        Math.min(this.god.target.distance, 26),
      );
      this.god.settle();
      this.seat = null;
    }
    if (from === 'third' || from === 'first') this.prevAvatarMode = from;
    if (to !== 'first' && this.locked) {
      this.releasingLock = true;
      document.exitPointerLock();
    }
    if (to === 'first') this.lock();

    this.blend = {
      t: 0,
      from: {
        position: this.camera.position.clone(),
        quaternion: this.camera.quaternion.clone(),
        fov: this.camera.fov,
      },
      fromMode: from,
      deeper: DEPTH[to] > DEPTH[from],
    };
    this.mode = to;
    this.god.active = false; // re-enabled when a blend into god lands
    this.onModeChange(from, to);
    this.emit(from, to, 'start');
  }

  /** Sit at a game: the camera moves to the seat and the avatar sits there. */
  sit(seat: Seat): void {
    if (this.mode === 'god') return;
    this.seat = seat;
    this.avatar.teleport(seat.x, seat.z, seat.facing);
    this.setMode('seat');
  }

  stand(): void {
    if (this.mode !== 'seat') return;
    this.seat = null;
    this.setMode(this.prevAvatarMode);
  }

  update(dt: number): void {
    this.god.update(dt, this.mode === 'god' && !this.blend);
    if (this.mode === 'third' || this.mode === 'first') this.moveAvatar(dt);
    else this.avatar.syncMesh();

    this.livePose(dt, this.live);
    const target = this.live;
    const cam = this.camera;
    if (this.blend) {
      const b = this.blend;
      b.t = Math.min(1, b.t + dt / TRANSITION_S);
      const s = smootherstep(b.t);
      this.blendPose(b, target, s);
      const inner = this.mode === 'god' ? 1 - s : DEPTH[b.fromMode] > 0 ? 1 : s;
      this.interior = inner;
      if (b.t >= 1) {
        this.blend = null;
        if (this.mode === 'god') this.god.active = true;
        this.emit(b.fromMode, this.mode, 'end');
      }
    } else {
      cam.position.copy(target.position);
      cam.quaternion.copy(target.quaternion);
      this.setFov(target.fov);
      this.interior = this.mode === 'god' ? 0 : 1;
    }
    // Hide the body once the lens is inside the head (1st person, seated, or mid-snap).
    const hx = cam.position.x - this.avatar.pos.x;
    const hz = cam.position.z - this.avatar.pos.z;
    const hy = cam.position.y - EYE_Y;
    this.avatar.mesh.visible = this.avatar.spawned && hx * hx + hz * hz + hy * hy > 0.6 * 0.6;
  }

  private blendPose(b: NonNullable<CameraDirector['blend']>, to: Pose, s: number): void {
    const p0 = b.from.position;
    const p1 = to.position;
    const chord = this.m0.copy(p1).sub(p0);
    const len = chord.length();
    const sign = b.deeper ? 1 : -1;
    // Tangents: half the chord plus half a dolly along each end's view direction.
    this.fwd.set(0, 0, -1).applyQuaternion(b.from.quaternion);
    const m0 = chord
      .clone()
      .multiplyScalar(0.5)
      .addScaledVector(this.fwd, sign * len * 0.5);
    this.fwd.set(0, 0, -1).applyQuaternion(to.quaternion);
    const m1 = this.m1
      .copy(chord)
      .multiplyScalar(0.5)
      .addScaledVector(this.fwd, sign * len * 0.5);
    hermite(this.camera.position, p0, m0, p1, m1, s);
    // Never dip under the floor on a low swoop.
    this.camera.position.y = Math.max(0.3, this.camera.position.y);
    this.camera.quaternion.slerpQuaternions(b.from.quaternion, to.quaternion, s);
    this.setFov(b.from.fov + (to.fov - b.from.fov) * s);
  }

  private setFov(f: number): void {
    if (Math.abs(this.camera.fov - f) < 1e-4) return;
    this.camera.fov = f;
    this.camera.updateProjectionMatrix();
  }

  /** The pose the current mode wants this frame, ignoring any blend. */
  private livePose(dt: number, out: Pose): void {
    const a = this.avatar;
    out.fov = FOV[this.mode];
    switch (this.mode) {
      case 'god':
        out.position.copy(this.god.pose.position);
        out.quaternion.copy(this.god.pose.quaternion);
        return;
      case 'third': {
        const cp = Math.cos(this.armPitch);
        const dx = Math.sin(this.armYaw);
        const dz = Math.cos(this.armYaw);
        // Spring arm: pull in at once when a wall comes between camera and
        // avatar, ease back out when it clears.
        const free = a.collision.raycastWalls(
          a.pos.x,
          a.pos.z,
          dx,
          dz,
          ARM_LENGTH * cp + ARM_CLEARANCE,
        );
        const allowed = Math.max(
          ARM_MIN,
          Math.min(ARM_LENGTH, (free - ARM_CLEARANCE) / Math.max(cp, 0.2)),
        );
        this.armLen = allowed < this.armLen ? allowed : damp(this.armLen, allowed, 3, dt);
        const pivotY = ARM_PIVOT_Y;
        out.position.set(
          a.pos.x + dx * cp * this.armLen,
          pivotY + Math.sin(this.armPitch) * this.armLen,
          a.pos.z + dz * cp * this.armLen,
        );
        this.dummy.position.copy(out.position);
        this.dummy.lookAt(a.pos.x, pivotY, a.pos.z);
        out.quaternion.copy(this.dummy.quaternion);
        return;
      }
      case 'first': {
        // Head bob: a gentle vertical bounce, two per stride cycle, scaled by speed.
        const bob = Math.sin(a.stride * 4.2) * 0.025 * Math.min(1, a.speed / 1.4);
        out.position.set(a.pos.x, EYE_Y + bob, a.pos.z);
        out.quaternion.setFromEuler(
          new THREE.Euler(this.lookPitch, this.lookYaw + Math.PI, 0, 'YXZ'),
        );
        return;
      }
      case 'seat': {
        const s = this.seat!;
        out.position.set(s.x, SEAT_EYE_Y, s.z);
        this.dummy.position.copy(out.position);
        this.dummy.lookAt(s.lookAt.x, 0.75, s.lookAt.z);
        out.quaternion.copy(this.dummy.quaternion);
        return;
      }
    }
  }

  private moveAvatar(dt: number): void {
    const k = this.keys;
    const f = k.axis(KEYS_BACK, KEYS_FORWARD);
    const r = k.axis(KEYS_LEFT, KEYS_RIGHT);
    // Forward is where the camera looks, flattened onto the floor.
    const yaw = this.mode === 'third' ? this.armYaw + Math.PI : this.lookYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let x = fx * f + -fz * r;
    let z = fz * f + fx * r;
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    if (this.mode === 'first') this.avatar.heading = this.lookYaw;
    this.avatar.step(dt, { x, z }, k.shift, this.mode === 'third', this.sim.curr);
  }

  private onLook(e: PointerEvent): void {
    if (this.mode === 'first' && (this.locked || this.dragging)) {
      this.lookYaw -= e.movementX * LOOK_SENS;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - e.movementY * LOOK_SENS, -1.3, 1.3);
    } else if (this.mode === 'third' && this.dragging) {
      this.armYaw -= e.movementX * 0.006;
      this.armPitch = THREE.MathUtils.clamp(this.armPitch + e.movementY * 0.004, -0.15, 1.2);
    }
  }

  private lock(): void {
    // Can be refused (no user gesture, embedded pane); drag-look still works then.
    try {
      const p = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* drag-look fallback */
    }
  }

  private emit(from: CameraMode, to: CameraMode, phase: 'start' | 'end'): void {
    window.dispatchEvent(
      new CustomEvent<CameraModeChange>('cameraModeChange', {
        detail: { from, to, phase, duration: TRANSITION_S },
      }),
    );
  }
}
