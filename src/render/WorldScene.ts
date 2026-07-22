import Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS, SIM_TICK_MS, TILE_H } from '../config';
import { eventBus } from '../EventBus';
import { world, worldGrid } from '../gameContext';
import type { IsoGrid } from '../sim/grid/IsoGrid';
import { audio } from '../services/AudioService';
import { createSkylineBackdrop } from './atmosphere';
import { BuildController } from './BuildController';
import CameraController from './CameraController';
import { attachAudioFx } from './fx/audioFx';
import { attachDustMotes } from './fx/dustMotes';
import { attachFx } from './fx/floaters';
import { ThoughtBubbles } from './fx/ThoughtBubbles';
import { gridToScreen, screenToGrid, worldBounds } from './iso';
import { GlowPool } from './neon';
import { PincerController } from './PincerController';
import { tileVariantIndex } from './tileVariant';
import { GuestViews } from './views/GuestViews';
import { MessViews } from './views/MessViews';
import { ObjectViews } from './views/ObjectViews';
import { StaffViews } from './views/StaffViews';

// Floors render below everything; walls and (later) objects depth-sort by screen y.
const DEPTH_FLOOR = 0;
const DEPTH_HIGHLIGHT = 1;
// Width matches TILE_W so panels tile edge-to-edge along a wall run.
const WALL_DISPLAY_SIZE = { w: 128, h: 278 };

export default class WorldScene extends Phaser.Scene {
  private grid!: IsoGrid;
  private cameraController!: CameraController;
  private buildController!: BuildController;
  private guestViews!: GuestViews;
  private staffViews!: StaffViews;
  private thoughtBubbles!: ThoughtBubbles;
  private pincer!: PincerController;
  private glowPool!: GlowPool;
  private highlight!: Phaser.GameObjects.Image;
  private tickAccumulator = 0;
  private speed = 1;

  constructor() {
    super('world');
  }

  create() {
    this.grid = worldGrid;

    createSkylineBackdrop(this);
    this.drawFloor();
    this.drawEdgeWalls();

    this.highlight = this.add
      .image(0, 0, 'tile-highlight')
      .setAlpha(0.55)
      .setDepth(DEPTH_HIGHLIGHT)
      .setVisible(false);

    const bounds = worldBounds();
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    const center = gridToScreen(GRID_COLS / 2, GRID_ROWS / 2);
    this.cameras.main.centerOn(center.x, center.y);
    this.cameraController = new CameraController(this);
    // One shader pass over the composited frame, not per-sprite — doesn't
    // reopen P10's "no per-object postFX" perf decision.
    this.cameras.main.postFX.addBloom(0xffffff, 1, 1, 1, 1.2);
    this.cameras.main.postFX.addVignette(0.5, 0.5, 0.8);
    // T6: glossy-marble read for the floor. A per-tile preFX pass would
    // reopen the per-object-postFX perf concern above (1200 floor tiles); a
    // whole-frame camera pass is the same one-shader-pass tradeoff T1 already
    // made for bloom/vignette, just a subtler sweep so it reads fine over
    // objects/characters too.
    this.cameras.main.postFX.addShine(0.3, 0.4, 5);

    this.glowPool = new GlowPool(this);
    const views = new ObjectViews(this);
    this.buildController = new BuildController(this, this.cameraController, views);
    this.guestViews = new GuestViews(this);
    this.staffViews = new StaffViews(this);
    this.thoughtBubbles = new ThoughtBubbles(this, this.guestViews);
    new MessViews(this);
    attachFx(this, views);
    attachDustMotes(this);
    attachAudioFx();
    audio.init(this);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateHover(p));
    // Clicking a machine or food stall (outside build mode) opens its inspector window.
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.buildController.active || this.cameraController.isDragging) return;
      if (this.pincer.carrying) return; // releasing a carried staffer, not a click
      if (!p.leftButtonReleased() || p.getDistance() >= 6) return;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const { col, row } = screenToGrid(w.x, w.y);
      if (!this.grid.inBounds(col, row)) return;
      const occupant = this.grid.occupantAt(col, row);
      if (!occupant) return;
      if (world.machines.has(occupant)) {
        eventBus.emit('machineClicked', { machineId: occupant });
      } else if (world.foodStalls.has(occupant)) {
        eventBus.emit('foodStallClicked', { standId: occupant });
      }
    });

    // Registered after the click handler above so `carrying` is still true
    // when that handler runs during a pincer drop.
    this.pincer = new PincerController(
      this,
      this.cameraController,
      this.staffViews,
      this.buildController,
    );

    eventBus.on('speedChanged', ({ speed }) => (this.speed = speed));
  }

  getGlowPool(): GlowPool {
    return this.glowPool;
  }

  override update(_time: number, delta: number) {
    // Fixed-timestep sim: accumulate render time, tick at 10 Hz, interpolate views.
    // Game speed scales accumulation; paused (0) simply stops feeding it.
    this.tickAccumulator += delta * this.speed;
    while (this.tickAccumulator >= SIM_TICK_MS) {
      this.tickAccumulator -= SIM_TICK_MS;
      world.tick();
    }
    this.cameraController.update();
    // Camera may move without the pointer moving (edge scroll, drag) — re-derive hover.
    this.updateHover(this.input.activePointer);
    this.buildController.refresh(this.input.activePointer);
    const frameAlpha = this.tickAccumulator / SIM_TICK_MS;
    this.guestViews.update(frameAlpha);
    this.thoughtBubbles.update();
    this.staffViews.update(frameAlpha, this.pincer.carriedStaffId);
    this.pincer.refresh(this.input.activePointer);
  }

  private updateHover(p: Phaser.Input.Pointer): void {
    if (this.cameraController.isDragging || this.buildController.active) {
      this.highlight.setVisible(false);
      return;
    }
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const { col, row } = screenToGrid(world.x, world.y);
    if (!this.grid.inBounds(col, row)) {
      this.highlight.setVisible(false);
      return;
    }
    const s = gridToScreen(col, row);
    this.highlight.setPosition(s.x, s.y).setVisible(true);
  }

  private drawFloor(): void {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const s = gridToScreen(col, row);
        this.add.image(s.x, s.y, this.floorKey(col, row)).setDepth(DEPTH_FLOOR);
      }
    }
  }

  private floorKey(col: number, row: number): string {
    const edge = col === 0 || row === 0 || col === GRID_COLS - 1 || row === GRID_ROWS - 1;
    const style = edge
      ? 'floor-wood-dark'
      : col % 10 < 2 || row % 10 < 2
        ? 'floor-marble-night'
        : 'floor-carpet-plum';
    return `${style}-${tileVariantIndex(col, row)}`;
  }

  private drawEdgeWalls(): void {
    // Walls line the two far edges (north = row 0, west = col 0) so they never
    // cover the floor; the near edges stay open for the camera view. The art
    // depicts one wall face's orientation; the perpendicular run mirrors it
    // via setFlipX rather than needing a second orientation asset.
    const wall = (col: number, row: number, flip: boolean) => {
      const s = gridToScreen(col, row);
      // Anchor at tile center-bottom per the sprite contract; depth = screen y.
      this.add
        .image(s.x, s.y + TILE_H / 2, 'img-wall-panel')
        .setOrigin(0.5, 1)
        .setDisplaySize(WALL_DISPLAY_SIZE.w, WALL_DISPLAY_SIZE.h)
        .setFlipX(flip)
        .setDepth(s.y);
    };
    for (let col = 0; col < GRID_COLS; col++) wall(col, 0, false);
    for (let row = 1; row < GRID_ROWS; row++) wall(0, row, true);
  }
}
