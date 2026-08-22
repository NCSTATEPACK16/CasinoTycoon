// scripts/capture-screens.mjs
// Screenshot evidence for an outside reviewer.
//
// Claude (and any reviewer working from a link) cannot play the game and cannot
// watch a video. What travels is labelled stills. This drives the real UI in a
// real browser and captures the arc of a session — cold open, first build,
// first guests, the panels, a win, a loss — then renders a contact sheet so the
// whole arc reads in one image.
//
// TIME. The obvious approach — pause the renderer and call world.tick() in a
// loop — is a trap, and this script was written twice because of it. With no
// frame between ticks every floater, thought bubble and deal animation queues
// up and nothing ever culls them, so each tick gets slower than the last: 900
// ticks took 136 seconds. Instead the game's own speed multiplier is turned up
// (WorldScene scales its accumulator by it) and real time is allowed to pass.
// Phaser drains its display list each frame and the rate stays flat.
//
// Playwright is not a dependency of this project — it lives in the npx cache
// the verify skill provisions. Resolved by hand below so the script works
// without adding a browser download to `npm install`.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'review-pack');
const SHOT_DIR = path.join(OUT_DIR, '03-SCREENS');
const PORT = 5199;
const URL = `http://localhost:${PORT}/`;

// 1600x900, not 1280x800: at 1280 the toolbar overflows and the mood,
// reputation and rating readouts are pushed off the right edge — Playwright
// cannot reach #tb-rating there, and a reviewer would never see them. That
// overflow is a real UI defect at 1280; it is reported, not papered over.
const VIEWPORT = { width: 1600, height: 900 };

// Fast-forward multiplier. High enough that a twelve-day campaign is about a
// minute, low enough that the frame loop keeps up and the accumulator in
// WorldScene.update never spirals.
const FF = 30;

/** Headless Chromium falls back to SwiftShader, and software WebGL cannot keep
 *  up with this scene: measured at 19 sim ticks/second, which makes a full
 *  campaign playout an hour. Handing it a real GPU backend takes the same run
 *  to 282 ticks/second — a 15x speedup, and level with a headed browser (298),
 *  so there is no reason to open a window. */
function gpuArgs() {
  const shared = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  if (process.platform === 'darwin') return ['--use-angle=metal', ...shared];
  if (process.platform === 'win32') return ['--use-angle=d3d11', ...shared];
  return ['--use-angle=gl', ...shared];
}

// ---- playwright resolution -------------------------------------------------
const require = createRequire(import.meta.url);
function loadPlaywright() {
  const bases = [
    ROOT,
    ...(process.env.PLAYWRIGHT_PATH ? [process.env.PLAYWRIGHT_PATH] : []),
    path.join(process.env.HOME ?? '', '.npm/_npx'),
  ];
  for (const base of bases) {
    try {
      return require(require.resolve('playwright', { paths: [base] }));
    } catch {
      /* try the next one */
    }
  }
  // The npx cache keys directories by hash, so scan rather than pin.
  const npx = path.join(process.env.HOME ?? '', '.npm/_npx');
  try {
    for (const entry of require('node:fs').readdirSync(npx)) {
      try {
        return require(
          require.resolve('playwright', { paths: [path.join(npx, entry, 'node_modules')] }),
        );
      } catch {
        /* keep scanning */
      }
    }
  } catch {
    /* no npx cache at all */
  }
  throw new Error(
    'playwright not found. Provision it with `npx playwright@1.61 --version`, ' +
      'or set PLAYWRIGHT_PATH to a directory containing node_modules/playwright.',
  );
}

// ---- dev server ------------------------------------------------------------
async function serverUp() {
  try {
    return (await fetch(URL, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) {
    console.log(`  reusing dev server already on :${PORT}`);
    return null;
  }
  console.log(`  starting dev server on :${PORT}`);
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await serverUp()) return child;
  }
  child.kill();
  throw new Error(`dev server never came up on :${PORT}`);
}

// ---- capture ---------------------------------------------------------------
const shots = [];
const T0 = Date.now();
const step = (m) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${m}`);

/** Day / cash / guest count, appended to a shot's log line. */
const stats = (page) =>
  page
    .evaluate(() => {
      const { world } = window.__casino;
      return `  day ${world.time.day} · $${Math.round(world.state.cash)} · ${world.guests.size} guests`;
    })
    .catch(() => '');

async function main() {
  const { chromium } = loadPlaywright();
  const server = await ensureServer();
  await rm(SHOT_DIR, { recursive: true, force: true });
  await mkdir(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: gpuArgs() });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20_000);

  // Muted before the first frame. Headless WebAudio is slow and every play,
  // win and jackpot fires a cue; AudioService reads these settings in its
  // constructor, so this has to land before the bundle runs.
  await page.addInitScript(() => {
    localStorage.setItem('casino-audio-v1', JSON.stringify({ music: 0, sfx: 0, muted: true }));
  });

  try {
    let n = 0;
    const shot = async (name, caption, opts = {}) => {
      const file = `${String(n++).padStart(2, '0')}-${name}.png`;
      const resume = speedNow;
      if (resume !== 0) await setSpeed(page, 0);
      await settle(page);
      // Crops go through page.screenshot({clip}), never locator.screenshot():
      // panels poll their readouts twice a second (FinancePanel, Toolbar), so
      // Playwright's "wait for the element to be stable" never returns on them.
      let clip;
      if (opts.selector) {
        const box = await page
          .locator(opts.selector)
          .first()
          .boundingBox()
          .catch(() => null);
        if (box) {
          clip = {
            x: Math.max(0, box.x - 4),
            y: Math.max(0, box.y - 4),
            width: Math.min(VIEWPORT.width - box.x, box.width + 8),
            height: Math.min(VIEWPORT.height - box.y, box.height + 8),
          };
        } else {
          step(`(no ${opts.selector} on screen — falling back to a full frame)`);
        }
      }
      // Generous, and non-fatal. Compositing a busy WebGL frame can blow well
      // past the default 20s, and losing one frame is not worth losing the run —
      // a pack with a gap in it still reviews fine.
      try {
        await page.screenshot({
          path: path.join(SHOT_DIR, file),
          timeout: 90_000,
          ...(clip ? { clip } : {}),
        });
        shots.push({ file, caption });
        step(`${file}${await stats(page)}`);
      } catch (err) {
        step(`(${file} failed: ${String(err).split('\n')[0].slice(0, 70)} — carrying on)`);
      }
      if (resume !== 0) await setSpeed(page, resume);
    };

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sc-overlay', { timeout: 30_000 });
    await shot(
      'title-scenario-select',
      'Cold open: the scenario picker is the first thing a player sees.',
    );

    // --- opening a campaign ---
    await ensureCampaign(page);
    await shot('empty-floor', 'The starting floor — an empty hall and $2,000.');

    await openPanel(page, 'Build');
    await shot('build-panel', 'The build catalogue, where every run begins.');
    await shot('build-panel-crop', 'Build panel at native resolution — a legibility check.', {
      selector: '.ui-window',
    });
    await closeAllPanels(page);

    // --- the opening build ---
    await page.evaluate(() => {
      const p = window.__makePlacer(1);
      p('blackjack-table');
      p('slot-machine');
      p('slot-machine');
      p('toilet');
      p('food-stall');
      const { world } = window.__casino;
      world.hireStaff('mechanic');
      world.hireStaff('janitor');
    });
    await shot(
      'first-build',
      'The opening build: one table, two slots, a toilet, a food stall, two staff.',
    );

    // --- first guests ---
    await fastForwardHours(page, 8);
    await shot(
      'first-guests',
      'Guests on the floor, playing. This is the loop the whole game hangs on.',
    );

    // --- day one closes ---
    await fastForwardToDay(page, 2);
    await openPanel(page, 'Finance');
    await shot('finance-panel', 'The finance ledger after the first full day.', {
      selector: '.ui-window',
    });
    // The daily report opens off a ledger row, not a toolbar button: FinancePanel
    // marks each row .p-tool and labels it "Day N".
    const dayRow = page
      .locator('.ui-window .p-tool')
      .filter({ hasText: /^Day \d/ })
      .first();
    if (await dayRow.count()) {
      await dayRow.click().catch(() => {});
      await shot('daily-report', "A single day's books, broken out by source.");
    } else {
      step('(no closed day in the ledger yet — skipping the daily report)');
    }
    await closeAllPanels(page);

    // --- mid game ---
    await page.evaluate(() => {
      const p = window.__makePlacer(2);
      for (let k = 0; k < 4; k++) p('blackjack-table');
      for (let k = 0; k < 6; k++) p('slot-machine');
      p('plant');
      p('plant');
      const { world } = window.__casino;
      world.hireStaff('dealer');
      world.hireStaff('security');
    });
    await fastForwardToDay(page, 4);
    await shot('midgame-floor', 'Day 4: a built-out floor at full guest load.');

    // The whole panel tour runs frozen: none of it needs the sim advancing, and
    // a still floor keeps every panel's readouts self-consistent.
    await setSpeed(page, 0);
    for (const [label, name, caption] of [
      ['Objectives', 'objectives-panel', 'The campaign goal and how close the run is to it.'],
      ['Staff', 'staff-panel', 'Staff roster, wages and assignments.'],
      ['Guests', 'guests-panel', 'Individual guests, their mood and their bankroll.'],
      ['Patrons', 'patrons-panel', 'Returning patrons — the reputation system surfaced.'],
    ]) {
      await openPanel(page, label);
      await shot(name, caption, { selector: '.ui-window' });
      await closeAllPanels(page);
    }

    // The rating readout is a div with a click handler and no keyboard route.
    await page.locator('#tb-rating').dispatchEvent('click');
    await page.waitForSelector('.ui-window', { timeout: 10_000 }).catch(() => {});
    await shot(
      'rating-breakdown',
      'Casino rating, itemised — the game explaining its own scoring.',
      {
        selector: '.ui-window',
      },
    );
    await closeAllPanels(page);

    await openPanel(page, 'Overlays');
    await shot('overlays', 'Diagnostic overlays: traffic, mood and coverage heatmaps.');
    await closeAllPanels(page);

    // --- the win card, played out rather than forced ---
    await setSpeed(page, 1);
    step('playing out for a win');
    if (await playOutForWin(page)) {
      await shot('win-card', 'The win state, reached by playing the campaign out.');
    } else {
      step('(no win inside the time budget — skipping the win card)');
    }
    await closeAllPanels(page);

    // --- the loss card: a fresh run of the same campaign that never builds ---
    step('playing out for a loss');
    await ensureCampaign(page);
    await page.evaluate(() => {
      const { world } = window.__casino;
      world.startScenario(world.scenario?.def ?? null);
    });
    if (await fastForwardUntilEvent(page, 'scenarioFailed', 180_000)) {
      await shot('loss-card', 'The failure state: an empty floor runs out of money and time.');
    } else {
      step('(no failure inside the time budget — skipping the loss card)');
    }

    await buildContactSheet(page);
    await writeFile(
      path.join(SHOT_DIR, 'CAPTIONS.md'),
      ['# Screens', '', ...shots.map((s) => `- **${s.file}** — ${s.caption}`), ''].join('\n'),
      'utf8',
    );

    step(`wrote ${shots.length} screens + contact sheet to review-pack/`);
  } finally {
    // Always, even on a thrown capture: an orphaned browser keeps rendering the
    // game at full tilt and quietly starves the next run.
    await browser.close().catch(() => {});
    if (server) server.kill();
  }
}

// ---- time ------------------------------------------------------------------

let speedNow = 1;
async function setSpeed(page, speed) {
  await ready(page);
  await page.evaluate((s) => window.__casino.eventBus.emit('speedChanged', { speed: s }), speed);
  speedNow = speed;
}

/** Run at FF until `read` reports done, then drop back to 1x so the capture
 *  that follows is a normally-paced frame rather than a blur. */
async function fastForward(page, read, isDone, budgetMs) {
  await setSpeed(page, FF);
  const deadline = Date.now() + budgetMs;
  try {
    while (Date.now() < deadline) {
      if (isDone(await page.evaluate(read))) return true;
      await page.waitForTimeout(250);
    }
    return false;
  } finally {
    await setSpeed(page, 1);
  }
}

const fastForwardToDay = (page, day, budgetMs = 120_000) =>
  fastForward(
    page,
    () => window.__casino.world.time.day,
    (d) => d >= day,
    budgetMs,
  );

async function fastForwardHours(page, hours) {
  const clock = () => window.__casino.world.time.day * 24 + window.__casino.world.time.hour;
  const from = await page.evaluate(clock);
  return fastForward(page, clock, (h) => h >= from + hours, 60_000);
}

/** Run until an event fires or the budget expires. Returns whether it fired. */
async function fastForwardUntilEvent(page, event, budgetMs) {
  await page.evaluate((ev) => {
    window.__capture = { fired: false };
    window.__casino.eventBus.on(ev, () => (window.__capture.fired = true));
  }, event);
  return fastForward(
    page,
    () => window.__capture.fired === true,
    (f) => f,
    budgetMs,
  );
}

/** Play fresh runs of the campaign properly until one wins, for the win card.
 *
 *  Two problems solved here. First, the screenshot floor built earlier is
 *  deliberately dense — it photographs well — but it outspends its income and
 *  ends day 4 in debt, so letting it run produces a failure, not a win. This
 *  restarts and plays with the same discipline the tournament's `greedy` bot
 *  uses (src/sim/__testkit__/strategies.ts): revenue engine, services, staff,
 *  then expansion only on a cash buffer.
 *
 *  Second, it retries. The browser seeds its world from Date.now(), and this
 *  campaign is tight by design — the tournament measures greedy at 6/7 seeds,
 *  so roughly one run in seven is unwinnable no matter how well it is played.
 *  reset() deliberately does not reseed, so each restart draws fresh from the
 *  RNG stream and three attempts make a missing win card very unlikely.
 *
 *  The bot runs on a wall-clock interval rather than a tick count because the
 *  sim is advanced by the render loop, not by this driver. At FF the sim moves
 *  ~240 ticks/second, so 150ms lands close to the bot's every-50-ticks cadence.
 */
async function playOutForWin(page, attempts = 3) {
  // Listeners are installed once and only the outcome is reset per attempt:
  // re-subscribing each round would stack duplicate handlers on the shared bus.
  await ensureCampaign(page);
  await page.evaluate(() => {
    window.__capture = { outcome: null };
    window.__casino.eventBus.on('goalReached', () => (window.__capture.outcome = 'won'));
    window.__casino.eventBus.on('scenarioFailed', () => (window.__capture.outcome = 'failed'));
  });

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.evaluate(() => {
      clearInterval(window.__autoplay);
      const { world } = window.__casino;
      window.__capture.outcome = null;
      world.startScenario(world.scenario?.def ?? null);
      const place = window.__makePlacer(1);
      window.__autoplay = setInterval(() => {
        const w = window.__casino.world;
        if (w.scenario?.status !== 'active') return;
        const objs = w.state.allObjects();
        const has = (id) => objs.some((o) => o.defId === id);
        const cash = () => w.state.cash;
        if (w.machines.size === 0) {
          if (w.isObjectAllowed('blackjack-table') && cash() >= 1200) place('blackjack-table');
          else if (w.isObjectAllowed('slot-machine') && cash() >= 500) place('slot-machine');
        }
        if (w.isObjectAllowed('toilet') && !has('toilet') && cash() >= 500) place('toilet');
        if (w.isObjectAllowed('food-stall') && !has('food-stall') && cash() >= 600) {
          place('food-stall');
        }
        const kinds = [...w.staff.values()].map((m) => m.kind);
        if (w.machines.size > 0 && !kinds.includes('mechanic') && cash() >= 400) {
          w.hireStaff('mechanic');
        }
        if (w.machines.size > 0 && !kinds.includes('janitor') && cash() >= 400) {
          w.hireStaff('janitor');
        }
        // Expand only on a buffer — the one thing separating a winning run
        // from a bankrupt one.
        const BUFFER = 150;
        for (;;) {
          if (w.isObjectAllowed('blackjack-table') && cash() >= 1200 + BUFFER) {
            if (!place('blackjack-table')) break;
          } else if (w.isObjectAllowed('slot-machine') && cash() >= 500 + BUFFER) {
            if (!place('slot-machine')) break;
          } else break;
        }
      }, 150);
    });

    // A campaign is at most ~12 in-game days; 90s at FF is comfortably past it.
    await fastForward(
      page,
      () => window.__capture.outcome,
      (o) => o !== null,
      90_000,
    );
    const outcome = await page.evaluate(() => window.__capture.outcome);
    await page.evaluate(() => clearInterval(window.__autoplay)).catch(() => {});
    if (outcome === 'won') return true;
    step(`attempt ${attempt}/${attempts}: ${outcome ?? 'no result'} — playing another run`);
  }
  return false;
}

/** Wait until the dev bundle has published its test handle.
 *  A Vite dev server can full-reload the page at any moment (dependency
 *  re-optimisation, an HMR invalidation), and an evaluate that lands during
 *  that window sees a bare document with no __casino on it. */
const ready = (page) =>
  page.waitForFunction(() => Boolean(window.__casino?.world), { timeout: 60_000 });

/** Put the page into "campaign running, placer installed" state, whether it is
 *  already there or has just been reloaded out from under us. Cheap enough to
 *  call before any phase that assumes a live scenario. */
async function ensureCampaign(page) {
  await ready(page);
  if (await page.locator('.sc-overlay').count()) {
    await page.getByRole('button', { name: /The Dusty Dime/ }).click();
    await page.waitForSelector('.sc-overlay', { state: 'detached' });
  }
  // __makePlacer lives on window, so a reload takes it with it.
  if (!(await page.evaluate(() => typeof window.__makePlacer === 'function'))) {
    await installPlacer(page);
  }
}

// ---- page helpers ----------------------------------------------------------

/** Object placement confined to whatever the camera can actually see.
 *
 *  Read off the live camera's worldView rather than reproducing the projection
 *  by hand, so it stays correct at any viewport size or zoom. The first run of
 *  this script placed a dozen objects outside the frame and photographed an
 *  empty room; this is the fix for that.
 *
 *  Spots are ordered by distance from the centre of view, so the floor fills
 *  outward and the earliest, cheapest builds are the ones guaranteed to be in
 *  shot.
 */
function installPlacer(page) {
  return page.evaluate(() => {
    const view = window.__casino.game.scene.getScene('world').cameras.main.worldView;
    // Margin in world px: keeps tall sprites clear of the top edge and the
    // toolbar clear of the bottom one.
    const M = 140;
    const spots = [];
    for (let row = 1; row < 29; row++) {
      for (let col = 1; col < 39; col++) {
        const x = (col - row) * 64;
        const y = (col + row) * 32;
        if (x > view.x + M && x < view.right - M && y > view.y + M && y < view.bottom - M) {
          spots.push([col, row, (x - view.centerX) ** 2 + (y - view.centerY) ** 2]);
        }
      }
    }
    spots.sort((a, b) => a[2] - b[2]);
    window.__makePlacer = (pass) => {
      // Later passes start further out so a mid-game build-out spreads across
      // the floor instead of stacking on the opening set's doorstep.
      let i = pass === 1 ? 0 : Math.floor(spots.length * 0.2);
      return (id) => {
        const { world } = window.__casino;
        while (i < spots.length) {
          const [col, row] = spots[i++];
          if (world.canPlace(id, col, row).ok) return world.place(id, col, row);
        }
        return null;
      };
    };
  });
}

/** Toolbar panels are driven by their own keyboard shortcuts rather than by
 *  clicking the toolbar. An open window overlaps the bar and swallows the
 *  click, and Playwright will wait forever for a click it keeps intercepting.
 *  Toolbar.ts binds panels to digits by position; Escape closes the topmost. */
const PANEL_KEYS = {
  Build: '1',
  Finance: '2',
  Guests: '3',
  Patrons: '4',
  Thoughts: '5',
  Staff: '6',
  Overlays: '7',
  Objectives: '8',
  Sound: '9',
  Save: '0',
};

async function openPanel(page, label) {
  await page.keyboard.press(PANEL_KEYS[label]);
  await page.waitForSelector('.ui-window', { timeout: 10_000 }).catch(() => {});
}

async function closeAllPanels(page) {
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('.ui-window').count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
}

/** Wait for the ticker to clear and the renderer to draw a frame.
 *  Ticker messages fire at ~1s/7.5s/14s and linger 5.4s; without this every
 *  early screenshot carries a toast a reviewer would mistake for chrome.
 *
 *  Every wait here is bounded. An unbounded rAF evaluate wedges the whole run
 *  if the page ever stops painting — which is how an earlier version died. A
 *  late frame is worth a slightly stale screenshot; it is not worth a hang. */
async function settle(page) {
  await page
    .waitForFunction(() => document.querySelectorAll('.ticker-msg').length === 0, { timeout: 6000 })
    .catch(() => {});
  await Promise.race([
    page
      .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .catch(() => {}),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
}

/** Contact sheet rendered as a real web page and screenshotted, so the
 *  thumbnails carry readable captions — which a pixel-tiled montage cannot. */
async function buildContactSheet(page) {
  const files = (await readdir(SHOT_DIR)).filter((f) => f.endsWith('.png')).sort();
  const cells = [];
  for (const file of files) {
    const b64 = (await readFile(path.join(SHOT_DIR, file))).toString('base64');
    const caption = shots.find((s) => s.file === file)?.caption ?? '';
    cells.push(
      `<figure><img src="data:image/png;base64,${b64}"><figcaption><b>${file.replace(/\.png$/, '')}</b><br>${caption}</figcaption></figure>`,
    );
  }
  await page.setContent(
    `<style>
      body{margin:0;padding:24px;background:#14101c;color:#e8e2f4;
           font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      h1{font-size:20px;margin:0 0 4px}
      p.sub{margin:0 0 20px;color:#9b91b0}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
      figure{margin:0}
      img{width:100%;display:block;border:1px solid #3a3350;border-radius:4px}
      figcaption{margin-top:6px;color:#b9b0cc}
      b{color:#e8e2f4}
    </style>
    <h1>Casino Tycoon — session arc</h1>
    <p class="sub">${files.length} frames, in play order. Full-resolution originals in 03-SCREENS/.</p>
    <div class="grid">${cells.join('')}</div>`,
  );
  await page.screenshot({ path: path.join(OUT_DIR, '04-contact-sheet.png'), fullPage: true });
}

await main();
