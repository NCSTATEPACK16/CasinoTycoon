// Render-lab bench: drives Chrome over CDP (no dependencies; Node ≥ 22 for
// the global WebSocket). Loads the lab at 2560×1440, lets it settle, prints
// window.lab.metrics() and saves screenshots of each named shot.
//
//   node src/render/lab/bench.mjs --chrome "<path to Chrome binary>" \
//        --url http://localhost:5181/src/render/lab/index.html --out <dir> \
//        [--shots overview,pit,eye] [--headed] [--query objects=2000&agents=500]

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : (process.argv[i + 1] ?? true);
};
const chrome = arg('chrome');
const url = arg('url', 'http://localhost:5181/src/render/lab/index.html');
const out = arg('out', '.');
const shots = String(arg('shots', 'overview')).split(',');
const query = arg('query', '');
const headed = process.argv.includes('--headed');
const W = Number(arg('w', 2560));
const H = Number(arg('h', 1440));
mkdirSync(out, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(
  chrome,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lab-'))}`,
    `--window-size=${W},${H}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-gpu',
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    ...(headed ? [] : ['--headless=new']),
    // --uncapped: measure true frame cost instead of the 60 Hz vsync cap.
    ...(process.argv.includes('--uncapped') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
}
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') console.error('page error', m.params.exceptionDetails.text);
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
    ?.result?.value;

await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${url}?clean&${query}` });
await sleep(6000);
console.log(
  'gpu:',
  await evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2');
    const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL); })()`),
);
const results = {};
for (const s of shots) {
  await evaluate(`lab.shot(${JSON.stringify(s)})`);
  await sleep(4000);
  results[s] = await evaluate('lab.metrics()');
  console.log(s, JSON.stringify(results[s]));
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${s}.png`), Buffer.from(png.result.data, 'base64'));
}
// --profile: toggle one feature at a time in place on the overview shot,
// measure, restore. fps over 3 s windows; GPU timer for reference.
if (process.argv.includes('--profile')) {
  await evaluate(`lab.shot('overview')`);
  const toggles = String(arg('profile-set', '')).split('@@').filter(Boolean);
  const base = [
    ['baseline', '', ''],
    ['noAO', 'P[1].enabled=false', 'P[1].enabled=true'],
    ['noGrade', 'P[2].enabled=false', 'P[2].enabled=true'],
    ['noSMAA', 'P[3].enabled=false;P[2].renderToScreen=true', 'P[3].enabled=true;P[2].renderToScreen=false'],
    ['noShadowMap', 's.renderer.shadowMap.autoUpdate=false', 's.renderer.shadowMap.autoUpdate=true'],
    ['noCrowd', 's.crowd.group.visible=false', 's.crowd.group.visible=true'],
    ['noObjects', 's.objects.group.visible=false', 's.objects.group.visible=true'],
    ['noFloor', 's.floor.group.visible=false', 's.floor.group.visible=true'],
  ];
  for (const t of toggles) base.push(t.split('|'));
  for (const [name, on, off] of base) {
    await evaluate(`(() => { const s = lab.stage; const P = s.post.composer.passes; ${on} })()`);
    await sleep(3500);
    const m = await evaluate('lab.metrics()');
    console.log('profile', name.padEnd(12), String(m.fps).padStart(3), 'fps', m.frameMs, 'ms  gpu', m.gpuMs, ' calls', m.calls);
    await evaluate(`(() => { const s = lab.stage; const P = s.post.composer.passes; ${off} })()`);
  }
}
writeFileSync(join(out, 'metrics.json'), JSON.stringify(results, null, 1));
ws.close();
proc.kill();
process.exit(0);
