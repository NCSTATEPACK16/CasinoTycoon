// scripts/capture-evidence.mjs
// Builds review-pack/ — the folder you hand to a reviewer who cannot run the
// repo, cannot play the game, and cannot watch a video.
//
//   01-BRIEF.md          what the game is, and the tuning it currently ships
//   02-RUN-LOG.md        measured difficulty, from the strategy tournament
//   02-run-log.csv       the same numbers, machine-readable
//   03-SCREENS/          labelled stills across one session
//   04-contact-sheet.png the whole arc in a single image
//   05-OPEN-QUESTIONS.md what you actually want answered
//
// The brief and the questions are scaffolded once and then left alone — they
// carry the judgement a generator has no business inventing, and overwriting a
// human's edit on every run would make the pack worthless. Everything else is
// regenerated each time.
//
// Usage:
//   npm run capture              full pack
//   npm run capture -- --screens only the browser capture
//   npm run capture -- --runlog  only the tournament
import { access, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'review-pack');

const args = process.argv.slice(2);
const only = args.find((a) => a === '--screens' || a === '--runlog');

const run = (script, extra = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script), ...extra], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)),
    );
  });

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

/** Scaffold a file only if it isn't there. Never clobbers an edited brief.
 *  `makeBody` is a thunk so the brief's generator — which spins up a Vite
 *  server to read the campaign table out of TS — is never paid for on the
 *  common path where the brief already exists. */
async function scaffold(name, makeBody) {
  const file = path.join(OUT_DIR, name);
  if (await exists(file)) {
    console.log(`  ${name} already exists — left as it is`);
    return;
  }
  await writeFile(file, await makeBody(), 'utf8');
  console.log(`  scaffolded ${name}`);
}

/** The half of the brief that can be read off the source is read off the
 *  source; the half that is judgement is left as a prompt to fill in. A brief
 *  with invented positioning in it is worse than a brief with a blank in it. */
async function briefBody() {
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    server: { middlewareMode: true, watch: null },
  });
  try {
    const { CAMPAIGNS } = await server.ssrLoadModule('/src/data/campaigns/index.ts');
    const config = await server.ssrLoadModule('/src/config.ts');
    const campaigns = CAMPAIGNS.map(
      (c) =>
        `| ${c.name} | $${c.startingCash} | $${c.goalDailyProfit}/day | ${c.goalConsecutiveDays} | ${c.dayLimit} | $${c.creditLimit} | ${c.allowedObjects ? c.allowedObjects.join(', ') : 'everything'} |`,
    ).join('\n');
    return `# Casino Tycoon — design brief

> Written for a reviewer who has never seen this game and cannot run it.
> Sections marked TODO are judgement calls; fill them in before sending the pack.

## What it is

TODO — one paragraph. Genre, perspective, the fantasy, and the single sentence
you would put on a store page.

## The core loop

TODO — what does the player do in the first sixty seconds, in minute five, and
in minute thirty? Name the decision that repeats.

## Win and lose

Campaigns are won by holding a daily-profit goal for a run of consecutive days
before a day limit expires, and lost by running past a credit limit into forced
liquidation, or by the clock running out.

| Campaign | Start | Goal | Days at goal | Day limit | Credit limit | Buildable |
| --- | --- | --- | --- | --- | --- | --- |
${campaigns}

## Shipped tuning

- Sim rate: ${config.SIM_TICKS_PER_SECOND} ticks/sec, ${config.TICKS_PER_HOUR} ticks per in-game hour, ${config.HOURS_PER_DAY}-hour days.
- Day 1 opens at ${config.START_HOUR}:00, so it is a half day.
- Floor: ${config.GRID_COLS}x${config.GRID_ROWS} tiles. Sandbox bankroll $${config.STARTING_CASH}.
- Bulldozing refunds ${Math.round(config.SELL_REFUND_RATIO * 100)}% of cost.

## Session length

TODO — how long is one campaign in wall-clock minutes at 1x? At 3x?

## What I am unsure about

TODO — the honest list. This is the part a reviewer is most useful on, and the
part most people leave out.

## What has already been measured

See 02-RUN-LOG.md. The headline finding driving current work: the mid-game was
solving itself — a player who built once and walked away scored the same as one
who kept managing. The tuning above is the answer to that; the run log says
whether it worked.
`;
  } finally {
    await server.close();
  }
}

const QUESTIONS = `# Open questions for the reviewer

Ranked. A reviewer who answers only the first three has still earned their keep.

1. Does the core loop give the player a decision that repeats and stays
   interesting, or does the casino run itself once it is built?
2. Look at 02-RUN-LOG.md section 4. Is that difficulty curve the right *shape*
   for this genre, or is it sawtoothing where it should be climbing?
3. From the screenshots alone: what reads as amateur or unfinished?
4. Is the failure state (credit limit into forced liquidation) legible to a
   player *before* it happens, or does it arrive as a surprise?
5. Which of the panels in 03-SCREENS/ are carrying their weight, and which are
   data dumps a player would open once and never again?
6. What does this genre's audience expect that is completely missing here?
7. If you had to cut one system to ship, which one and why?
`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  if (only !== '--screens') {
    console.log('\nTournament (this takes about two minutes)');
    await run(
      'capture-runlog.mjs',
      args.filter((a) => a.startsWith('--seeds=')),
    );
  }
  if (only !== '--runlog') {
    console.log('\nScreens');
    await run('capture-screens.mjs');
  }

  console.log('\nScaffolding');
  await scaffold('01-BRIEF.md', briefBody);
  await scaffold('05-OPEN-QUESTIONS.md', () => QUESTIONS);

  console.log(`\nreview-pack/ is ready: ${OUT_DIR}`);
  console.log('Upload the whole folder into a Claude Desktop Project.\n');
}

await main();
