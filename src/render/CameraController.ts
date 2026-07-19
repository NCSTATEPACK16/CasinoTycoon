import Phaser from 'phaser';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.001; // wheel deltaY multiplier
const EDGE_MARGIN = 24; // px from canvas edge that triggers edge scroll
const EDGE_SPEED = 12; // px per frame at zoom 1
// Pan starts only after the pointer travels this far, so P3 build clicks stay clicks.
const DRAG_THRESHOLD = 6;

/**
 * RCT-style camera: left/middle-drag pan, wheel zoom toward the cursor (clamped),
 * edge scroll, all clamped to the world bounds set on the camera.
 */
export default class CameraController {
  private scene: Phaser.Scene;
  private dragging = false;
  private downAt: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const input = scene.input;

    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown() || p.middleButtonDown()) {
        this.downAt = { x: p.x, y: p.y };
        this.dragging = false;
      }
    });

    input.on('pointerup', () => {
      this.downAt = null;
      this.dragging = false;
    });

    input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.downAt || !(p.leftButtonDown() || p.middleButtonDown())) return;
      if (!this.dragging) {
        const dist = Phaser.Math.Distance.Between(p.x, p.y, this.downAt.x, this.downAt.y);
        if (dist < DRAG_THRESHOLD) return;
        this.dragging = true;
      }
      const cam = this.scene.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });

    input.on('wheel', (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, -dy * ZOOM_STEP);
    });
  }

  /** True while a pan drag is active — scenes use this to suppress hover/click handling. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Zoom by `delta` keeping the world point under screen (sx,sy) fixed. */
  private zoomAt(sx: number, sy: number, delta: number): void {
    const cam = this.scene.cameras.main;
    const oldZoom = cam.zoom;
    const newZoom = Phaser.Math.Clamp(oldZoom * (1 + delta), MIN_ZOOM, MAX_ZOOM);
    if (newZoom === oldZoom) return;

    // World point at screen (sx,sy): w = scroll + center + (s - center) / zoom
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const wx = cam.scrollX + cx + (sx - cx) / oldZoom;
    const wy = cam.scrollY + cy + (sy - cy) / oldZoom;
    cam.setZoom(newZoom);
    cam.scrollX = wx - cx - (sx - cx) / newZoom;
    cam.scrollY = wy - cy - (sy - cy) / newZoom;
  }

  /** Call from the scene's update() — handles edge scrolling. */
  update(): void {
    if (this.downAt) return; // no edge scroll mid-drag
    const p = this.scene.input.activePointer;
    const cam = this.scene.cameras.main;
    const speed = EDGE_SPEED / cam.zoom;
    if (p.x <= EDGE_MARGIN && p.x >= 0) cam.scrollX -= speed;
    else if (p.x >= cam.width - EDGE_MARGIN && p.x <= cam.width) cam.scrollX += speed;
    if (p.y <= EDGE_MARGIN && p.y >= 0) cam.scrollY -= speed;
    else if (p.y >= cam.height - EDGE_MARGIN && p.y <= cam.height) cam.scrollY += speed;
  }
}
