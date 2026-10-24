// One place that assembles Session 2's input stack — picking, build tools,
// the avatar, eye-level interaction and the camera director — so main.ts
// only has to construct it, call update() each frame and render with
// `camera`.

import type * as THREE from 'three';
import type { SimClient } from '../client/SimClient';
import { CameraDirector, type CameraMode } from '../camera/CameraDirector';
import { GodCamera } from '../camera/GodCamera';
import type { Stage } from '../render/Stage';
import { BuildToolbar } from '../ui/tools/BuildToolbar';
import { CursorTag } from '../ui/tools/CursorTag';
import { InteractPrompt } from '../ui/tools/InteractPrompt';
import { Avatar } from './avatar/Avatar';
import { Interaction } from './avatar/Interaction';
import { BuildTool } from './BuildTool';
import { Keys } from './Keys';
import { Picker } from './Picker';
import { ToolManager } from './tools/Tool';
import { ToolOverlay } from './tools/ToolOverlay';
import { WorldView } from './WorldView';

export interface PlayerControlsOptions {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  stage: Stage;
  sim: SimClient;
  /** Optional: reuse an existing god rig (it must not have its own update call). */
  god?: GodCamera;
}

export class PlayerControls {
  readonly keys = new Keys();
  readonly world: WorldView;
  readonly god: GodCamera;
  readonly picker: Picker;
  readonly tools: ToolManager;
  readonly build: BuildTool;
  readonly avatar: Avatar;
  readonly director: CameraDirector;
  readonly interaction: Interaction;
  readonly overlay: ToolOverlay;
  private toolbar: BuildToolbar;
  private prompt: InteractPrompt;
  private say: (t: string) => void = () => {};

  constructor(o: PlayerControlsOptions) {
    this.world = new WorldView(o.sim);
    this.god = o.god ?? new GodCamera(o.canvas, this.keys);
    this.overlay = new ToolOverlay(o.stage.scene);
    this.picker = new Picker(o.canvas, o.stage, o.sim, this.world, () => this.god.camera);
    const tag = new CursorTag(o.ui);
    this.tools = new ToolManager(o.canvas, {
      sim: o.sim,
      stage: o.stage,
      world: this.world,
      picker: this.picker,
      overlay: this.overlay,
      tag,
      keys: this.keys,
      say: (t) => this.say(t),
    });
    this.build = new BuildTool(this.tools);
    this.avatar = new Avatar(o.stage.scene, this.world);
    this.director = new CameraDirector(o.canvas, this.god, this.avatar, o.sim, this.keys);
    this.prompt = new InteractPrompt(o.ui);
    this.interaction = new Interaction(
      this.avatar,
      this.director,
      this.world,
      o.sim,
      this.overlay,
      this.prompt,
      (t) => this.say(t),
    );
    this.toolbar = new BuildToolbar(o.ui, this.build, () => this.director.setMode('third'));
    this.director.onModeChange = (_from, to) => this.onMode(to);
    // The avatar stays hidden until the first snap; compile its shaders now so
    // that snap doesn't open with a shader-compile stall.
    this.avatar.mesh.visible = true;
    void o.stage.renderer
      .compileAsync(this.avatar.mesh, this.god.camera, o.stage.scene)
      .finally(() => {
        if (!this.avatar.spawned) this.avatar.mesh.visible = false;
      });
    // Lot bounds follow the floor plan once one arrives. A lot of a new size
    // (Sandbox after a campaign, or back) is framed whole, as the 40×30 lot is
    // at boot: centred, from a distance that scales with its width.
    o.sim.onSnapshot((s) => {
      if (!s.floor) return;
      const { cols, rows } = s.floor;
      if (cols === this.god.bounds.cols && rows === this.god.bounds.rows) return;
      this.god.bounds = { cols, rows };
      this.god.focusOn(cols / 2, rows / 2, (32 * cols) / 40);
      this.god.settle();
    });
    // Until the avatar first appears it waits, invisible, at the entrance.
  }

  /** Where player-facing messages go (the HUD toast). */
  set onMessage(fn: (t: string) => void) {
    this.say = fn;
    this.build.onMessage = fn;
  }

  get camera(): THREE.PerspectiveCamera {
    return this.director.camera;
  }

  update(dt: number): void {
    this.picker.update();
    this.tools.update(dt);
    this.director.update(dt);
    this.interaction.update();
  }

  resize(w: number, h: number): void {
    this.god.resize(w, h);
  }

  private onMode(to: CameraMode): void {
    const building = to === 'god';
    if (!building) this.tools.set(null);
    this.tools.enabled = building;
    this.picker.enabled = building;
    this.toolbar.setVisible(building);
    this.prompt.mode(to);
  }
}
