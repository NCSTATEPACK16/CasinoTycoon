import Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS, SIM_TICK_MS, TILE_H } from '../config';
import { eventBus } from '../EventBus';
import { world, worldGrid } from '../gameContext';
import type { IsoGrid } from '../sim/grid/IsoGrid';
import { BuildController } from './BuildController';
import CameraController from './CameraController';
import { attachFx } from './fx/floaters';
import { gridToScreen, screenToGrid, worldBounds } from './iso';
import { GuestViews } from './views/GuestViews';
import { ObjectViews } from './views/ObjectViews';

// Floors render below everything; walls and (later) objects depth-sort by screen y.
const DEPTH_FLOOR = 0;
const DEPTH_HIGHLIGHT = 1;

export default class WorldScene extends Phaser.Scene {
  private grid!: IsoGrid;
  private cameraController!: CameraController;
  private buildController!: BuildController;
  private guestViews!: GuestViews;
  private highlight!: Phaser.GameObjects.Image;
  private tickAccumulator = 0;

  constructor() {
    super('world');
  }

  create() {
    this.grid = worldGrid;

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

    const views = new ObjectViews(this);
    this.buildController = new BuildController(this, this.cameraController, views);
    this.guestViews = new GuestViews(this);
    attachFx(this, views);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateHover(p));
    // Clicking a machine (outside build mode) opens its inspector window.
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.buildController.active || this.cameraController.isDragging) return;
      if (!p.leftButtonReleased() || p.getDistance() >= 6) return;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const { col, row } = screenToGrid(w.x, w.y);
      if (!this.grid.inBounds(col, row)) return;
      const occupant = this.grid.occupantAt(col, row);
      if (occupant && world.machines.has(occupant)) {
        eventBus.emit('machineClicked', { machineId: occupant });
      }
    });
  }

  override update(_time: number, delta: number) {
    // Fixed-timestep sim: accumulate render time, tick at 10 Hz, interpolate views.
    this.tickAccumulator += delta;
    while (this.tickAccumulator >= SIM_TICK_MS) {
      this.tickAccumulator -= SIM_TICK_MS;
      world.tick();
    }
    this.cameraController.update();
    // Camera may move without the pointer moving (edge scroll, drag) — re-derive hover.
    this.updateHover(this.input.activePointer);
    this.buildController.refresh(this.input.activePointer);
    this.guestViews.update(this.tickAccumulator / SIM_TICK_MS);
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
    if (edge) return 'floor-wood';
    // Marble aisles cross the carpet every 10 tiles.
    if (col % 10 < 2 || row % 10 < 2) return 'floor-marble';
    return 'floor-carpet-red';
  }

  private drawEdgeWalls(): void {
    // Walls line the two far edges (north = row 0, west = col 0) so they never
    // cover the floor; the near edges stay open for the camera view.
    const wall = (col: number, row: number) => {
      const s = gridToScreen(col, row);
      // Anchor at tile center-bottom per the sprite contract; depth = screen y.
      this.add
        .image(s.x, s.y + TILE_H / 2, 'obj-wall')
        .setOrigin(0.5, 1)
        .setDepth(s.y);
    };
    for (let col = 0; col < GRID_COLS; col++) wall(col, 0);
    for (let row = 1; row < GRID_ROWS; row++) wall(0, row);
  }
}
