import './style.css';
import { SimClient } from './client/SimClient';
import { GodCamera } from './camera/GodCamera';
import { BuildTool } from './input/BuildTool';
import { Stage } from './render/Stage';
import { Hud } from './ui/Hud';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;

const sim = new SimClient();
const stage = new Stage(canvas);
const god = new GodCamera(canvas);
const build = new BuildTool(canvas, stage, sim, () => god.camera);
const hud = new Hud(ui, sim, build);
build.onMessage = (t) => hud.say(t);

sim.onSnapshot((s) => {
  if (s.objects) stage.setObjects(s.objects);
  hud.update(s.hud);
  hud.events(s.events);
});

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  stage.resize(w, h);
  god.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
stage.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  god.update(dt);
  if (sim.curr) stage.updateAgents(sim.prev, sim.curr, sim.alpha(now));
  stage.render(god.camera);
});

// Debug/test hook for browser playtests.
Object.assign(window, { __v2: { sim, stage, god, build } });
