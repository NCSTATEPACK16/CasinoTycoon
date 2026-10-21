# Rules for every module session

- Read `v2/docs/SPEC.md` first. It wins over this file when they disagree, and you should flag the disagreement in your final report.
- You work in your own git worktree, on your own branch cut from `v2-foundation`. Commit early and often there. **Do not push, do not open a PR, and do not merge.** The lead session merges every module branch into `v2-foundation`.
- Edit only the paths your handoff says you own. If you need a change to `src/shared/*`, `src/worker/*` or `src/client/*`, make the smallest possible change, put it in its own commit whose message starts with `contract:`, and explain it in your final report. If you need to edit `src/sim/world.ts`, add narrow named hooks only and list them.
- Run everything from `v2/`: `npm install`, then `npm test` (the whole suite takes about 6 minutes; use `npx vitest run <path>` while iterating), `npx tsc --noEmit`, and `npm run dev -- --port <your port>`.
- Keep the code idiomatic: TypeScript strict, Prettier settings from `v2/.prettierrc`, comments that explain *why* at the density the forked sim already uses, and no new frameworks.
- Verify in a real browser through the built-in browser pane (`preview_start` with a `.claude/launch.json` entry in your worktree). Take screenshots, and read fps from `renderer.info` or your own counter. `window.__v2` exposes `{ sim, stage, god, build }`.
- Your final report says what landed, which commits, how you verified it (test counts, fps, screenshots), any contract changes, and what is left.
