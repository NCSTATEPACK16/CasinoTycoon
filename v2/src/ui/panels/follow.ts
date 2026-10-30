// Follow a guest with the god camera: every frame the camera's focus is set
// to where they stand in the latest snapshot, and its springs ease it there.
// It lets go when the guest leaves, when the player takes the camera (WASD,
// arrows, a click on the floor, Esc), or when the view leaves god mode.

import type { SimClient } from '../../client/SimClient';
import type { PlayerControls } from '../../input/PlayerControls';
import { guestPosition } from './locate';

const TAKE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
]);

export class GuestFollower {
  private agentId: number | null = null;
  private raf = 0;
  /** A short note for the player: following, or why it stopped. */
  onMessage: (text: string) => void = () => {};

  constructor(
    private sim: SimClient,
    private controls: PlayerControls,
    canvas: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => {
      if (this.agentId !== null && TAKE_KEYS.has(e.code)) this.stop();
    });
    canvas.addEventListener('pointerdown', () => {
      if (this.agentId !== null) this.stop();
    });
  }

  get following(): number | null {
    return this.agentId;
  }

  /** Returns false when the camera can't follow: the player is seated at a game. */
  start(agentId: number, name: string): boolean {
    const { director } = this.controls;
    if (director.mode === 'seat') return false;
    if (director.mode !== 'god') director.setMode('god');
    this.agentId = agentId;
    this.onMessage(`Following ${name}. WASD or a click takes the camera back.`);
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.agentId === null) return;
      const at = guestPosition(this.sim.curr, this.agentId);
      if (!at) {
        this.onMessage(`${name} has left.`);
        return this.stop();
      }
      if (this.controls.director.mode !== 'god') return this.stop();
      this.controls.god.focusOn(at.x, at.z);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    return true;
  }

  stop(): void {
    this.agentId = null;
    cancelAnimationFrame(this.raf);
  }
}
