import Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS } from '../config';
import { eventBus } from '../EventBus';
import { gridToScreen, worldBounds } from './iso';
import { colorFor, OVERLAYS, type OverlayId } from './overlays';

/** Depth between the floor (0) and the hover highlight (1): overlays sit on
 *  the carpet, under everything the player interacts with. */
const DEPTH_OVERLAY = 0.5;

/** How often the texture is repainted, in ms. Heat data moves on a human
 *  timescale; repainting per frame would upload a full-map texture 60 times a
 *  second to show changes nobody can perceive. */
const REDRAW_MS = 500;

/** Translucent enough that the floor art and the objects on it stay readable
 *  through the heat map. */
const TILE_ALPHA = 0.55;

/**
 * Paints a data overlay across the map as a single RenderTexture.
 *
 * A RenderTexture rather than a dynamic tilemap layer: heat data changes on a
 * slow cadence while the camera moves every frame, so the right trade is to
 * pay once per data change and nothing per frame. A per-tile tinted layer
 * would re-upload on every change and still cost a draw per tile.
 */
export class OverlayLayer {
  private texture: Phaser.GameObjects.RenderTexture;
  private active: OverlayId = 'none';
  private timer: Phaser.Time.TimerEvent;

  constructor(private scene: Phaser.Scene) {
    const b = worldBounds();
    this.texture = scene.add
      .renderTexture(b.x, b.y, b.width, b.height)
      .setOrigin(0, 0)
      .setDepth(DEPTH_OVERLAY)
      .setVisible(false);

    this.timer = scene.time.addEvent({
      delay: REDRAW_MS,
      loop: true,
      callback: () => {
        if (this.active !== 'none') this.redraw();
      },
    });

    eventBus.on('overlayChanged', ({ id }) => this.setOverlay(id as OverlayId));
    // A load or reset replaces the field wholesale; repaint rather than wait
    // out the cadence with stale data on screen.
    eventBus.on('worldLoaded', () => this.active !== 'none' && this.redraw());
    eventBus.on('worldReset', () => this.active !== 'none' && this.redraw());
  }

  private setOverlay(id: OverlayId): void {
    this.active = id;
    this.texture.setVisible(id !== 'none');
    if (id !== 'none') this.redraw();
  }

  private redraw(): void {
    const def = OVERLAYS[this.active as Exclude<OverlayId, 'none'>];
    if (!def) return;
    const b = worldBounds();
    this.texture.clear();
    const { min, max } = def.range();
    const span = max - min || 1;

    // One batch for the whole map. `draw()` opens and closes a batch per call,
    // so painting up to 1200 tiles that way is 1200 batches — enough to stall
    // the main thread visibly on a busy floor, which is how this was found.
    this.texture.beginDraw();
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const value = def.valueAt(col, row);
        // null is "no data", which must stay transparent. Painting it as the
        // bottom of the scale would accuse every unvisited tile of being bad.
        if (value === null) continue;
        const t = (value - min) / span;
        const s = gridToScreen(col, row);
        // Translucent so the floor art and objects stay readable underneath —
        // an overlay that hides the casino stops being a diagnostic.
        this.texture.batchDraw(
          'tile-overlay',
          s.x - b.x,
          s.y - b.y,
          TILE_ALPHA,
          colorFor(def.stops, t),
        );
      }
    }
    this.texture.endDraw();
  }

  /** Hover readout for the panel, or null when this tile has nothing to say. */
  readoutAt(col: number, row: number): string | null {
    if (this.active === 'none') return null;
    const def = OVERLAYS[this.active as Exclude<OverlayId, 'none'>];
    if (!def) return null;
    const value = def.valueAt(col, row);
    // Human color perception cannot rank adjacent intensities reliably, so the
    // exact number is not a nicety — it is how the overlay is actually read.
    return value === null ? null : def.format(value);
  }

  get activeOverlay(): OverlayId {
    return this.active;
  }

  destroy(): void {
    this.timer.destroy();
    this.texture.destroy();
  }
}

