import Phaser from 'phaser';
import { world, worldGrid } from '../gameContext';
import type { Cell } from '../sim/grid/astar';
import type { BuildController } from './BuildController';
import type CameraController from './CameraController';
import { screenToGrid } from './iso';
import type { StaffViews } from './views/StaffViews';

const DEPTH_CARRY = 20001;
const CARRY_SCALE = 1.15;
const INVALID_TINT = 0xff9090;

/**
 * Classic RCT pincer: press on a staffer to pluck them off the floor, drag,
 * release to drop on any walkable tile. Invalid drops send them back where
 * they were picked up. Suppresses camera pan while carrying.
 */
export class PincerController {
  private scene: Phaser.Scene;
  private camera: CameraController;
  private views: StaffViews;
  private build: BuildController;
  private carriedId: string | null = null;
  private origin: Cell | null = null;

  constructor(
    scene: Phaser.Scene,
    camera: CameraController,
    views: StaffViews,
    build: BuildController,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.views = views;
    this.build = build;

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.tryPick(p));
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.refresh(p));
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.drop(p));
    scene.input.keyboard?.on('keydown-ESC', () => this.cancel());
  }

  get carrying(): boolean {
    return this.carriedId !== null;
  }

  get carriedStaffId(): string | null {
    return this.carriedId;
  }

  private tryPick(p: Phaser.Input.Pointer): void {
    if (this.carriedId || this.build.active || !p.leftButtonDown()) return;
    const w = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    const id = this.views.hitTest(w.x, w.y);
    if (!id) return;
    const member = world.staff.get(id);
    if (!member || !world.pickUpStaff(id)) return;
    this.carriedId = id;
    this.origin = { ...member.pos };
    this.camera.suppressed = true;
    this.views.spriteFor(id)?.setScale(CARRY_SCALE);
    this.refresh(p);
  }

  /** Also called from the scene's update so the sprite tracks edge scroll. */
  refresh(p: Phaser.Input.Pointer): void {
    if (!this.carriedId) return;
    const img = this.views.spriteFor(this.carriedId);
    if (!img) return;
    const w = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    img.setPosition(w.x, w.y + 14).setDepth(DEPTH_CARRY);
    const { col, row } = screenToGrid(w.x, w.y);
    if (worldGrid.isWalkable(col, row)) img.clearTint();
    else img.setTint(INVALID_TINT);
  }

  private drop(p: Phaser.Input.Pointer): void {
    if (!this.carriedId) return;
    const w = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    const { col, row } = screenToGrid(w.x, w.y);
    if (!world.dropStaff(this.carriedId, col, row)) this.returnToOrigin();
    this.releaseSprite();
  }

  private cancel(): void {
    if (!this.carriedId) return;
    this.returnToOrigin();
    this.releaseSprite();
  }

  private returnToOrigin(): void {
    if (!this.carriedId || !this.origin) return;
    world.dropStaff(this.carriedId, this.origin.col, this.origin.row);
    // If even the origin got built over mid-carry, the staffer stays carried
    // in the sim; the next successful drop frees them.
  }

  private releaseSprite(): void {
    if (!this.carriedId) return;
    const member = world.staff.get(this.carriedId);
    if (member?.state !== 'carried') {
      this.views.spriteFor(this.carriedId)?.clearTint().setScale(1);
      this.carriedId = null;
      this.origin = null;
      this.camera.suppressed = false;
    }
  }
}
