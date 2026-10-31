import './style.css';
import './ui/ui.css';
import { GameAudio, audio } from './audio';
import { AmbienceFeed } from './audio/AmbienceFeed';
import { SimClient } from './client/SimClient';
import { PlayerControls } from './input/PlayerControls';
import type { PlayRequestedDetail } from './input/avatar/Interaction';
import type { PickHit } from './input/Picker';
import type { SoundName } from './audio/sounds';
import { Stage } from './render/Stage';
import { Anim } from './shared/contracts';
import { Hud } from './ui/Hud';
import { Menus } from './ui/Menus';
import { Settings } from './ui/Settings';
import { SidePanel } from './ui/SidePanel';
import { TablePlay } from './ui/TablePlay';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;

const sim = new SimClient();
const stage = new Stage(canvas);
const controls = new PlayerControls({ canvas, ui, stage, sim });
const { god, build } = controls;
const hud = new Hud(ui, sim, build);
const panel = new SidePanel(sim);
const table = new TablePlay(sim);
const menus = new Menus(sim);
ui.append(panel.root, table.root, menus.root);
controls.onMessage = (t) => hud.say(t);
const settings = new Settings(audio, stage);
settings.mount(ui);
audio.unlockOn(window);
const gameAudio = new GameAudio(audio, sim);
gameAudio.watchPanels([panel.root, table.root, menus.root, settings.root]);
gameAudio.watchClicks(ui);
stage.fx.sound = (name, at, delay, rate) => audio.play(name as SoundName, { at, delay, rate });
const ambience = new AmbienceFeed(audio);

// ---------- sim → screen ----------

/** Autosave only once a game is under way — never the idle world behind the title. */
let playing = false;
menus.onStarted = () => (playing = true);
let lastHour = -1;
sim.onSnapshot((s) => {
  if (s.objects) stage.setObjects(s.objects);
  if (s.floor) stage.setFloor(s.floor);
  if (s.objects) ambience.setObjects(s.objects);
  if (s.floor) ambience.setFloor(s.floor);
  ambience.setHud(s.hud.guests, s.hud.speed);
  stage.fx.speed = s.hud.speed;
  stage.handleEvents(s.events);
  hud.update(s.hud);
  hud.events(s.events);
  for (const e of s.events) {
    if (e.type === 'gameOver') {
      void sim.command({ type: 'setSpeed', speed: 0 });
      menus.gameOver(e.won, e.reason, () => {
        void sim.command({ type: 'continueScenario' });
        void sim.command({ type: 'setSpeed', speed: 1 });
      });
    }
  }
  // Autosave on the in-game hour while a game is running.
  if (s.hud.hour !== lastHour) {
    if (playing && lastHour !== -1 && !menus.isOpen) void menus.autosave().catch(() => {});
    lastHour = s.hud.hour;
  }
});

// Tell the worker which games are near the camera, so their rounds play out.
let interestKey = '';
setInterval(() => {
  const ids = stage.interestIds();
  const key = ids.join(',');
  if (key === interestKey) return;
  interestKey = key;
  void sim.command({ type: 'setInterest', objectIds: ids }).catch(() => (interestKey = ''));
}, 500);

// ---------- management UI ----------

hud.menu.finances.onclick = () => panel.toggle('finances');
hud.menu.staff.onclick = () => panel.toggle('staff');
hud.menu.save.onclick = () => void menus.saveMenu((t) => hud.say(t));
hud.menu.load.onclick = () => void menus.title();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'KeyP') panel.toggle('finances');
  if (e.code === 'KeyH') panel.toggle('staff');
  if (e.code === 'KeyZ') stage.showZoneOverlay((zonesOn = !zonesOn));
});
let zonesOn = false;

panel.onSell = (id) =>
  void sim
    .command<number>({ type: 'sell', objectId: id })
    .then((refund) => {
      hud.say(`Sold for $${Math.round(refund).toLocaleString()}`);
      panel.close();
    })
    .catch((err: Error) => hud.say(err.message));
panel.onClose = () => stage.setSelected(null);

// God-view click with no build tool active → inspect what's under the cursor.
controls.picker.addEventListener('select', (ev) => {
  const hit = (ev as CustomEvent<PickHit>).detail;
  if (controls.tools.active || controls.director.mode !== 'god') return;
  if (hit.agentId !== null) panel.inspect({ agentId: hit.agentId });
  else if (hit.objectId) {
    stage.setSelected(hit.objectId);
    panel.inspect({ objectId: hit.objectId });
  }
});

// Eye-level: E inspects, F sits down to play.
window.addEventListener('inspect', (ev) => {
  const d = (ev as CustomEvent<{ objectId: string; ok: boolean }>).detail;
  if (d.ok) panel.inspect({ objectId: d.objectId });
});
window.addEventListener('playRequested', (ev) => {
  const d = (ev as CustomEvent<PlayRequestedDetail>).detail;
  if (!d.game) return hud.say('This one has no player seat yet');
  panel.close();
  void table.open(d.objectId, d.game);
});
table.view = {
  setOwn: (id) => (stage.fx.own = id),
  play: (id, fx) => stage.fx.playOwn(id, fx, controls.avatar.pos),
  hand: (id, seen, wagered, settled) =>
    stage.fx.ownHand(id, seen, wagered, controls.avatar.pos, settled),
};
table.onLeave = () => {
  if (controls.director.mode === 'seat') controls.director.stand();
};
window.addEventListener('cameraModeChange', () => {
  if (controls.director.mode !== 'seat' && table.isOpen) table.leave();
});

// ---------- frame loop ----------

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
  // The capsule stays as the collision/visibility proxy; the crowd draws the person.
  const av = controls.avatar;
  for (const c of av.mesh.children) c.visible = false;
  const mode = controls.director.mode;
  // Seated, the body stays in its seat in front of the lens, playing.
  stage.avatar =
    (av.mesh.visible || mode === 'seat') && mode !== 'first'
      ? {
          x: av.pos.x,
          z: av.pos.z,
          heading: av.heading,
          moving: Math.hypot(av.vel.x, av.vel.z) > 0.2,
          anim: mode === 'seat' ? Anim.Play : undefined,
        }
      : null;
  if (sim.curr) stage.updateAgents(sim.prev, sim.curr, sim.alpha(now));
  stage.render(controls.camera);
  audio.update(controls.camera);
  ambience.update(controls.camera, now / 1000);
});

// Title screen once the worker is up; the sim idles at speed 0 behind it.
void sim.command({ type: 'setSpeed', speed: 0 }).then(() => menus.title());

// Debug/test hook for browser playtests.
Object.assign(window, {
  __v2: { sim, stage, god, build, controls, panel, table, menus, audio, settings, ambience },
});
