// scripts/capture-runlog.mjs
// Difficulty-curve evidence for an outside reviewer.
//
// The P16 finding — the mid-game solves itself — is a claim about *numbers*,
// not pixels. No screenshot can show it. This replays the same strategy
// tournament difficulty.test.ts asserts on (src/sim/__testkit__/strategies.ts,
// a plain module precisely so non-test callers like this one can import it)
// and writes the measurements out as prose a reviewer with no access to the
// repo can read.
//
// The tests answer "did the bars pass?". This answers "what shape is the
// curve?" — which is the question a design reviewer actually asks, and the one
// a pass/fail assertion throws away.
//
// Loading TS: the sim imports extensionless ('../../EventBus'), so plain node
// can't resolve it even with type-stripping. Vite's SSR loader resolves exactly
// the way the app does, and vite is already a devDependency.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'review-pack');

// One run is ~0.9s, and the full field is campaigns x seeds x strategies.
// --seeds=N trims the seed list for a fast iteration pass; the default is the
// whole tournament (~2 min) because a trimmed field is not evidence.
const seedLimit = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8)) || Infinity;

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const money = (n) => (n === null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n))}`);

// Block-glyph sparkline. A reviewer reads the shape first and the digits
// second, and the shape is the whole point of a difficulty curve.
const BLOCKS = '▁▂▃▄▅▆▇█';
function sparkline(values, floor, ceil) {
  if (values.length === 0) return '';
  const lo = floor ?? Math.min(...values);
  const hi = ceil ?? Math.max(...values);
  const span = hi - lo || 1;
  return values
    .map((v) => {
      const t = Math.max(0, Math.min(1, (v - lo) / span));
      return BLOCKS[Math.min(BLOCKS.length - 1, Math.round(t * (BLOCKS.length - 1)))];
    })
    .join('');
}

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)),
  );
  const line = (cells) =>
    `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [
    line(headers),
    `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

const server = await createServer({
  configFile: false,
  root: ROOT,
  logLevel: 'error',
  server: { middlewareMode: true, watch: null },
});

try {
  const { runCampaign, STRATEGIES, TOURNAMENT_SEEDS } = await server.ssrLoadModule(
    '/src/sim/__testkit__/strategies.ts',
  );
  const { CAMPAIGNS } = await server.ssrLoadModule('/src/data/campaigns/index.ts');

  const seeds = TOURNAMENT_SEEDS.slice(0, seedLimit);
  const total = CAMPAIGNS.length * STRATEGIES.length * seeds.length;
  let done = 0;

  // results[campaignId][strategy] = CampaignRun[] parallel to `seeds`
  const results = {};
  const startedAt = Date.now();
  for (const def of CAMPAIGNS) {
    results[def.id] = {};
    for (const strategy of STRATEGIES) {
      results[def.id][strategy] = seeds.map((seed) => {
        const run = runCampaign(def, seed, strategy);
        done++;
        process.stdout.write(`\r  ${done}/${total} runs  (${def.name} / ${strategy})          `);
        return run;
      });
    }
  }
  process.stdout.write(
    `\r  ${total} runs in ${Math.round((Date.now() - startedAt) / 1000)}s${' '.repeat(30)}\n`,
  );

  const wins = (id, s) => results[id][s].filter((r) => r.outcome === 'won').length;

  // ---- Markdown report -----------------------------------------------------
  const md = [];
  md.push('# Run log — measured difficulty', '');
  md.push(
    'Every number here is produced by replaying the game, not by hand-tuning. Seven scripted',
    'players compete on identical seeds; the spread between them *is* the difficulty. A game',
    'where every strategy scores the same is a game that plays itself.',
    '',
    '**The players**',
    '',
    '- `greedy` — buys a revenue engine, hires a mechanic and janitor, then expands on a thin buffer. The reference "competent player".',
    '- `minimal` — builds the opening set once, then never touches the casino again. The do-nothing baseline.',
    '- `oneGame` — greedy, but capped at exactly one revenue object.',
    '- `noStaff` — greedy, but never hires anyone.',
    '- `reckless` — greedy, but spends to $0 with no cash reserve.',
    '- `managed` — greedy, but always holds back 25% of the credit limit.',
    '- `levered` — greedy, but expands *on credit*, spending down to the exact balance the bank liquidates against. The only bot that borrows: every other strategy gates expansion on a non-negative cash threshold, so none of them can reach the credit line at all.',
    '',
    `Seeds: ${seeds.join(', ')}. Campaigns run to a win, a bankruptcy, or the day limit.`,
    '',
  );

  md.push('## 1. Does the game solve itself?', '');
  md.push(
    'The core question. `greedy` minus `minimal` is the value of playing at all — if a player who',
    'walks away after the opening build does as well as one who keeps managing, the mid-game is decorative.',
    '',
  );
  // difficulty.test.ts asserts margin >= 3 over the full 7 seeds. Held
  // proportional so a trimmed --seeds run is judged on the same standard
  // rather than silently reporting against a bar it never had to clear.
  const bar = Math.ceil(seeds.length * (3 / TOURNAMENT_SEEDS.length));
  if (seeds.length < TOURNAMENT_SEEDS.length) {
    md.push(
      `> **Partial run.** ${seeds.length} of ${TOURNAMENT_SEEDS.length} seeds. Verdicts below use a`,
      `> proportional bar (margin ≥ ${bar}); the shipped acceptance bar is ≥ 3 over all 7 seeds.`,
      '',
    );
  }
  md.push(
    table(
      ['Campaign', 'Goal', 'Days', 'greedy', 'minimal', 'Margin', 'Reads as'],
      CAMPAIGNS.map((d) => {
        const g = wins(d.id, 'greedy');
        const m = wins(d.id, 'minimal');
        const margin = g - m;
        const verdict =
          margin >= bar
            ? 'active play clearly wins'
            : margin >= 1
              ? 'thin separation'
              : 'SOLVES ITSELF';
        return [
          d.name,
          `${money(d.goalDailyProfit)}/day x${d.goalConsecutiveDays}`,
          d.dayLimit,
          `${g}/${seeds.length}`,
          `${m}/${seeds.length}`,
          margin >= 0 ? `+${margin}` : String(margin),
          verdict,
        ];
      }),
    ),
    '',
  );

  md.push('## 2. The whole strategy field', '');
  md.push(
    'Wins out of ' + seeds.length + ' seeds, with the median day the win landed and the median',
    'worst cash position along the way. A strategy that never dips has no tension in it.',
    '',
  );
  for (const d of CAMPAIGNS) {
    md.push(`### ${d.name}`, '');
    md.push(
      table(
        ['Strategy', 'Wins', 'Median win day', 'Median trough', 'Interest paid', 'Forced sales'],
        STRATEGIES.map((s) => {
          const runs = results[d.id][s];
          const won = runs.filter((r) => r.outcome === 'won');
          return [
            s,
            `${won.length}/${seeds.length}`,
            median(won.map((r) => r.wonOnDay)) ?? '—',
            money(median(runs.map((r) => r.minCash))),
            money(runs.reduce((a, r) => a + r.interestPaid, 0)),
            runs.reduce((a, r) => a + r.forcedSales, 0),
          ];
        }),
      ),
      '',
    );
  }

  md.push('## 3. Does risk management matter?', '');
  const managedTotal = CAMPAIGNS.reduce((a, d) => a + wins(d.id, 'managed'), 0);
  const recklessTotal = CAMPAIGNS.reduce((a, d) => a + wins(d.id, 'reckless'), 0);
  const interestTotal = CAMPAIGNS.reduce(
    (a, d) =>
      a +
      STRATEGIES.reduce((b, s) => b + results[d.id][s].reduce((c, r) => c + r.interestPaid, 0), 0),
    0,
  );
  md.push(
    `\`managed\` (holds a reserve) won **${managedTotal}**; \`reckless\` (spends to zero) won **${recklessTotal}**.`,
    `Total interest charged across the whole tournament: **${money(interestTotal)}**.`,
    '',
    interestTotal === 0
      ? '> Interest never fired. Debt costs nothing, so there is no reserve decision to get right.'
      : managedTotal > recklessTotal
        ? '> Holding a reserve pays. The credit limit is creating a real decision.'
        : '> Reserving does not pay. Either the buffer is mistuned or debt is too cheap to matter.',
    '',
  );

  md.push('## 4. The shape of the curve', '');
  md.push(
    'Median daily profit across seeds for each strategy, day by day, against the goal line.',
    'This is the difficulty curve: where it crosses the goal is where the campaign is actually won.',
    '',
  );
  // Curves for every campaign are computed up front so they can share ONE
  // scale across the whole section. Per-campaign autoscaling — which is what
  // this used to do — renders each campaign's own peak as a full block, so a
  // $600/day goal and a $1000/day goal look equally hard and the difficulty
  // delta between campaigns, the thing this section exists to show, is exactly
  // what the scale hides.
  const byCampaign = CAMPAIGNS.map((d) => ({
    d,
    curves: STRATEGIES.map((s) => {
      const runs = results[d.id][s];
      const maxDays = Math.max(0, ...runs.map((r) => r.profits.length));
      const perDay = [];
      // Runs that ended early contribute nothing to later days, so the tail is
      // a median over survivors only. Carried alongside the medians and
      // printed, because a median over 24 of 49 runs that looks identical to
      // one over 49 is the difference between evidence and decoration.
      const nPerDay = [];
      for (let day = 0; day < maxDays; day++) {
        const vals = runs.map((r) => r.profits[day]).filter((v) => v !== undefined);
        if (vals.length) {
          perDay.push(median(vals));
          nPerDay.push(vals.length);
        }
      }
      return { s, perDay, nPerDay };
    }),
  }));
  const everyValue = byCampaign.flatMap(({ curves }) => curves.flatMap((c) => c.perDay));
  const lo = Math.min(0, ...everyValue);
  const hi = Math.max(...CAMPAIGNS.map((d) => d.goalDailyProfit), ...everyValue);
  md.push(
    `**One scale for every campaign below: ${money(lo)} (▁) to ${money(hi)} (█).**`,
    'Curves are directly comparable between campaigns as well as between strategies.',
    '',
    '`N by day` is how many runs the median on that day was taken over. It falls as',
    'runs win or go bankrupt and stop producing days, so the right-hand end of every',
    'curve is a survivor median — read it with the N, not on its own.',
    '',
  );
  for (const { d, curves } of byCampaign) {
    md.push(`### ${d.name} — goal ${money(d.goalDailyProfit)}/day`, '');
    md.push(
      table(
        ['Strategy', 'Curve', 'Median profit by day', 'N by day', 'Peak'],
        curves.map(({ s, perDay, nPerDay }) => [
          s,
          sparkline(perDay, lo, hi),
          perDay.map((v) => Math.round(v)).join(', ') || '—',
          nPerDay.join(', ') || '—',
          money(Math.max(0, ...perDay)),
        ]),
      ),
      '',
    );
    md.push(
      `The goal line, ${money(d.goalDailyProfit)}/day, sits at \`${sparkline([d.goalDailyProfit], lo, hi)}\` on the shared scale.`,
      '',
    );
  }

  md.push('## 5. Per-seed detail', '');
  for (const d of CAMPAIGNS) {
    md.push(`### ${d.name}`, '');
    md.push(
      table(
        ['Seed', ...STRATEGIES],
        seeds.map((seed, i) => [
          seed,
          ...STRATEGIES.map((s) => {
            const r = results[d.id][s][i];
            if (r.outcome === 'won') return `won d${r.wonOnDay}`;
            if (r.outcome === 'failed')
              return r.failReason === 'insolvent' ? `BUST d${r.failedOnDay}` : `timeout`;
            return 'timeout';
          }),
        ]),
      ),
      '',
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, '02-RUN-LOG.md'), md.join('\n'), 'utf8');

  // ---- CSV -----------------------------------------------------------------
  const csv = [
    'campaign,strategy,seed,outcome,wonOnDay,failReason,failedOnDay,bestDailyProfit,minCash,interestPaid,forcedSales,revenueObjectsAtEnd,dailyProfits',
  ];
  for (const d of CAMPAIGNS) {
    for (const s of STRATEGIES) {
      results[d.id][s].forEach((r, i) => {
        csv.push(
          [
            d.id,
            s,
            seeds[i],
            r.outcome ?? 'timeout',
            r.wonOnDay ?? '',
            r.failReason ?? '',
            r.failedOnDay ?? '',
            r.best,
            Math.round(r.minCash),
            r.interestPaid,
            r.forcedSales,
            r.revenueObjectsAtEnd,
            `"${r.profits.map((p) => Math.round(p)).join(' ')}"`,
          ].join(','),
        );
      });
    }
  }
  await writeFile(path.join(OUT_DIR, '02-run-log.csv'), csv.join('\n'), 'utf8');

  console.log(`  wrote review-pack/02-RUN-LOG.md and 02-run-log.csv`);
} finally {
  await server.close();
}
