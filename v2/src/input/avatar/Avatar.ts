// The player's avatar: a kinematic capsule that walks the floor. Movement is
// requested as a world-space direction; the avatar accelerates toward it
// smoothly, is nudged aside by nearby guests, then slides through the
// collision world. The mesh is a placeholder until Session 1 supplies one.

import * as THREE from 'three';
import { AGENT_STRIDE } from '../../shared/contracts';
import type { Snapshot } from '../../shared/contracts';
import { dampAngle, dampFactor } from '../../camera/blend';
import type { WorldView } from '../WorldView';
import { AVATAR_HEIGHT, AVATAR_RADIUS, CollisionWorld, type Vec2 } from './collision';

export const WALK_SPEED = 1.4;
export const RUN_SPEED = 3;
/** Speed-up/slow-down rate: reaches walking pace in ~0.25 s, stops a touch quicker. */
const ACCEL = 9;
const DECEL = 12;
/** Guests closer than this push the avatar gently aside. */
const PUSH_RANGE = 0.65;
/** Push acceleration (m/s²) at full overlap. */
const PUSH_ACCEL = 10;

export class Avatar {
  readonly pos: Vec2 = { x: 0, z: 0 };
  readonly vel: Vec2 = { x: 0, z: 0 };
  /** Facing, contract convention: 0 = +z, direction (sin h, cos h). */
  heading = 0;
  readonly mesh = new THREE.Group();
  readonly collision = new CollisionWorld();
  /** Accumulated walking distance, for head bob. */
  stride = 0;
  private builtFor = -1;
  /** False until the avatar first appears at the entrance. */
  spawned = false;

  constructor(
    scene: THREE.Scene,
    private world: WorldView,
  ) {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        AVATAR_RADIUS * 0.9,
        AVATAR_HEIGHT - AVATAR_RADIUS * 1.8,
        6,
        16,
      ).translate(0, AVATAR_HEIGHT / 2, 0),
      new THREE.MeshStandardMaterial({ color: 0xf6c453, roughness: 0.35, metalness: 0.3 }),
    );
    // A visor so facing reads from above.
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, 0.12).translate(
        0,
        AVATAR_HEIGHT - 0.22,
        AVATAR_RADIUS * 0.8,
      ),
      new THREE.MeshStandardMaterial({ color: 0x14101f, roughness: 0.2 }),
    );
    body.castShadow = visor.castShadow = true;
    this.mesh.add(body, visor);
    this.mesh.name = 'avatar';
    scene.add(this.mesh);
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Place the avatar at the entrance, once; later entries resume where it stood. */
  spawnIfNeeded(): void {
    this.syncCollision();
    if (this.spawned) return;
    this.spawned = true;
    const e = this.world.entrance;
    this.teleport(e.col + 0.5, e.row + 0.5, -Math.PI / 2);
  }

  teleport(x: number, z: number, heading = this.heading): void {
    this.pos.x = x;
    this.pos.z = z;
    this.vel.x = this.vel.z = 0;
    this.heading = heading;
    this.syncCollision();
    // Never start embedded in something placed on the spawn point.
    this.collision.move(this.pos, this.vel, 0);
    this.syncMesh();
  }

  /** Rebuild the static collision world when the floor plan or objects changed. */
  syncCollision(): void {
    if (this.builtFor === this.world.version) return;
    this.builtFor = this.world.version;
    this.collision.rebuild(this.world.floor, this.world.objects, this.world.cols, this.world.rows);
  }

  /**
   * @param dir desired world-space direction (unit or zero)
   * @param run sprint instead of walk
   * @param faceMove turn to face the movement (3rd person) rather than keep `heading`
   */
  step(dt: number, dir: Vec2, run: boolean, faceMove: boolean, agents: Snapshot | null): void {
    this.syncCollision();
    const speed = run ? RUN_SPEED : WALK_SPEED;
    const tx = dir.x * speed;
    const tz = dir.z * speed;
    const moving = dir.x !== 0 || dir.z !== 0;
    const k = dampFactor(moving ? ACCEL : DECEL, dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    if (agents) this.softPush(agents, dt);
    const before = { ...this.pos };
    this.collision.move(this.pos, this.vel, dt);
    this.stride += Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    if (faceMove && moving)
      this.heading = dampAngle(this.heading, Math.atan2(dir.x, dir.z), 12, dt);
    this.syncMesh();
  }

  syncMesh(): void {
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
  }

  /** Guests are soft: they nudge the avatar's velocity rather than block it,
   *  so a crowd can be waded through and nobody gets stuck on a queue. */
  private softPush(snap: Snapshot, dt: number): void {
    const a = snap.agents;
    for (let i = 0; i < snap.agentCount; i++) {
      const o = i * AGENT_STRIDE;
      const dx = this.pos.x - a[o]!;
      const dz = this.pos.z - a[o + 1]!;
      const d2 = dx * dx + dz * dz;
      if (d2 >= PUSH_RANGE * PUSH_RANGE || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const f = ((PUSH_RANGE - d) / PUSH_RANGE) * PUSH_ACCEL * dt;
      this.vel.x += (dx / d) * f;
      this.vel.z += (dz / d) * f;
    }
  }
}
