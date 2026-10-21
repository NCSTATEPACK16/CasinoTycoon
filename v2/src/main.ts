import './style.css';
import { SimClient } from './client/SimClient';
import { PlayerControls } from './input/PlayerControls';
import { Stage } from './render/Stage';
import { Hud } from './ui/Hud';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;

const sim = new SimClient();
const stage = new Stage(canvas);
const controls = new PlayerControls({ canvas, ui, stage, sim });
const { god, build } = controls;
const hud = new Hud(ui, sim, build);
controls.onMessage = (t) => hud.say(t);

sim.onSnapshot((s) => {
  if (s.objects) stage.setObjects(s.objects);
  hud.update(s.hud);
  hud.events(s.events);
});

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  stage.resize(w, h);
  controls.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
stage.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  controls.update(dt);
  if (sim.curr) stage.updateAgents(sim.prev, sim.curr, sim.alpha(now));
  stage.render(controls.camera);
});

// Debug/test hook for browser playtests.
Object.assign(window, { __v2: { sim, stage, god, build, controls } });
