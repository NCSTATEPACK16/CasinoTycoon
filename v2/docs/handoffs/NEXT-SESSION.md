# v2 handoff: finish "playable" (SPEC §9)

Rewritten 2026-10-24 by the session that ran the first four loop iterations: lot sizes, the stress test, lobby crowding, and need balance. This file and `v2/docs/SPEC.md` are the whole briefing. You need nothing from earlier conversations.

## Where things stand

- **Branch:** `v2-playable`, cut from `v2-foundation`, in the main checkout at `~/Documents/ClaudeWork/CasinoTycoon`.
- **PR:** `v2-playable` → `v2-foundation` (see the PR line at the bottom of this section). Every loop iteration commits to `v2-playable` and pushes it, so the PR grows as the loop runs.
- **Older PR:** NCSTATEPACK16/CasinoTycoon#18 is `v2-foundation` → `main`. Leave it alone. Never merge either PR.
- **Pushing:** push only `v2-playable`. Don't push `v2-foundation`; its remote is still at f04e94c.
- **Done so far:** every commit since f04e94c is on `v2-playable`: the integration UI, the avatar, and this session's four fixes (below).
- **PR:** filled in after creation.

### §9 exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | `npm test` green: exact edges, MC edges, nav, ported suite | ✅ 808/808 at 7baff56, plus the focused suites for the need-balance commit (42/42) |
| 2 | `npm run build` clean | ✅ (re-run at the end) |
| 3 | Start scenario; paint floor, walls/doors, zones; place all 5 games with tuned rules; hire dealers/janitors/security | ✅ in browser. ⬜ drive the Floor, Zone and Walls drag tools by hand once (Task 3) |
| 4 | Guests navigate, gamble, eat, restrooms, leave; a day at 4× shows hold ≈ theo | ✅ lobby bunching fixed; food, bar and restrooms used (see Done) |
| 5 | God → 3rd → 1st, walk, inspect, play one round of each game | ✅ all five games played through the table screen |
| 6 | Save → reload → resume | ✅ autosave plus Continue, verified again this session |
| 7 | Stress: 2,000 objects + 500 guests at ~60fps | ✅ 2,036 objects, 500 guests and 90 staff: 58–60 fps, ≤ 284 calls, ≤ 1.28M tris, 6.2–6.8 ms tick |
| 8 | Looks good in screenshots of each pillar | ✅ mostly. ⬜ the polish items in Task 3 |

## Done (one line each; commit messages have the evidence)

- **cfeef4b: per-scenario lots.** Sandbox is 96×64 with its own starter layout. Campaigns stay 40×30. Save/load round-trips the lot. The camera reframes to a new lot. (`world.lot.test.ts`)
- **17ab077: §9.7 stress budgets.**
  - Crowd avoidance runs at the "medium" preset.
  - `rankChoices` is a chunk-pruned lazy heap that keeps the exact old order (`utility.test.ts`).
  - LOD0 bands are 16 m for objects and 14 m for the crowd.
  - From a low camera the shadow reach is shorter and only LOD0 objects cast.
  - Test: `sandbox.stress.test.ts`.
  - `NavSystem.test` bake times are asserted only under NAV_PERF=1.
- **7baff56: lobby crowding.** Guests who find every seat taken browse beside a game on the floor, not by the door. The lobby mean went from 10.5 to 3.0. (`crowd.test.ts`)
- **Need balance (the user chose this option).** On the nav crowd, guests arrive with bladder in [45, 100] and hunger and thirst in [35, 100] (`GUEST_BALANCE.arrivalNeedsMin`, `Guest.varyArrivalNeeds`). Two days on the furnished floor went from 0 meals, 0 drinks and 3 restroom visits to 11 meals, 7 drinks and 12 visits (`crowd.test.ts`). In the browser, the Sandbox Finances panel showed $141 of F&B in 2 days. Grid-mode worlds, which the ported balance suites and campaign goals were tuned on, are untouched.

Notes for later, not blocking:
- The one-cell-aisle stress layout jams at 500 guests: about 2,300 repaths and 60 teleports in 90 s.
- The third-person camera can press against a partition wall in the lobby.
- One frame hitch of 66–150 ms happens the first time eye-level LOD pools load.
- While paused, the Staff panel's hire count doesn't refresh.
- At a pane width of about 800 px, the HUD bar overlaps the Floor button.
- Build placement is one object per tool pick unless Shift is held. That's by design, but worth a hint in the UI.

## What's left: Task 3, polish (one item per iteration, in this order)

1. **Felt text:** the blackjack felt always reads "BLACKJACK PAYS 3 TO 2", even at 6:5. Use a dynamic felt texture or a decal swap from the table's rules.
2. **Table occupancy:** the avatar can sit at a full table (4/4). It should need a free seat, or take one.
3. **Wallet display:** during a round, the table-play wallet shows the pre-bet amount. Show the stake as committed.
4. **Win/lose card:** see it when a scenario actually ends (play or fast-forward a campaign to its verdict), not only by calling `menus.gameOver`.
5. **Drag tools:** drive Floor, Zone and Walls with the real mouse, and check the previews and costs. This ticks the ⬜ in §9.3.
6. **Payout text:** the floating payout labels are very large at eye level. Scale them by camera distance.

Then **Task 4, finish:** run the full suite under `caffeinate -i` and `npm run build` in `v2/`, push `v2-playable`, update the PR description with the §9 checklist and evidence, and report to the user.

## Testing policy (the user asked for less)

- **Per iteration:** `npx tsc --noEmit`, plus only the test files that touch the change (`npx vitest run <paths>`), plus a browser check of the change. Don't run the full suite each iteration.
- **Full suite:** once, in Task 4, under `caffeinate -i`. This Mac sleeps and throttles on battery. "Test timed out", or a wall-clock assertion failing only under the parallel suite, is load until proven otherwise; re-run the file alone.
- **Balance:** if a change could move guest behaviour in grid mode, also run `src/data/campaigns` and `src/sim/world.tier2.test.ts`. Those suites pin the economy the campaign goals were tuned on.

## How to work here

- **Run:** `cd v2 && npm install`. The dev server is `.claude/launch.json` config **`v2`** on port 5174; use `preview_start {name:"v2"}`.
- **Browser viewport:** the built-in browser pane is often narrow. `resize_window` 1280×800 works. If screenshots come back quarter-size, use `find`/`read_page` refs instead of coordinates.
- **Placing objects:** hover before clicking, so the build ghost follows the pointer.
- **Title menu:** the buttons aren't in the accessibility tree. Click `button.scenario` or the Continue button through the DOM.
- **Debug hook:** `window.__v2 = { sim, stage, god, build, controls, panel, table, menus }`. Use it for setup and reading state only. Drive what you verify through the UI. The worker command list is in `src/shared/contracts.ts`.
- **Map:**
  - `src/worker/` is the sim thread.
  - `src/ui/` is the integration UI.
  - `src/main.ts` wires them.
  - `src/sim/agents/` is the guest brain: `utility.ts`, `stands.ts`, `testkit.ts`, with `furnish` and `furnishSandbox`.
  - Module docs: `src/sim/games/ECONOMY.md` and the per-module handoffs in this folder.
- **Repo rules:**
  - `v2/docs` is committed and pushed (the user's explicit exception for v2).
  - `PLAN.md`, `.claude/` and `docs/superpowers/` stay local.
  - Never import v1 (`../src`) from v2.
- **Commits:** messages explain *why* and end with `Co-Authored-By: Claude <noreply@anthropic.com>`. Format only the files you touch with Prettier (`v2/.prettierrc`); several existing files are not Prettier-clean, so don't reformat them.
- **`gh`:** `GITHUB_TOKEN` in the environment shadows the keyring login. Run `gh` with `env -u GITHUB_TOKEN`.

## Loop prompt

The user runs the loop with:

```
/loop Continue Casino Tycoon v2 until it is fully playable. The briefing is v2/docs/handoffs/NEXT-SESSION.md (read it in full every iteration) plus v2/docs/SPEC.md.

Each iteration:
1. Run `git log --oneline -5` on v2-playable and reread NEXT-SESSION.md to see what's done.
2. Take the first unfinished item in "What's left". Do only that.
3. Implement it properly, matching the surrounding code. Verify it with evidence, following the testing policy in NEXT-SESSION.md: `npx tsc --noEmit`, only the affected test files (`cd v2 && npx vitest run <paths>`), and the built-in browser (`preview_start` name "v2"; drive it through the UI, with `window.__v2` only for setup). Don't run the full suite each iteration.
4. Tick the item in NEXT-SESSION.md and write down the evidence. Commit the work and the ticked file together, with a message that explains why, then push v2-playable so the PR grows.
5. When every §9 row and every "What's left" item is ✅: run the full suite under `caffeinate -i` and `npm run build`. If both pass, push v2-playable, update the v2-playable PR's description with the §9 checklist and evidence, report to me, and stop the loop.

Rules:
- Never merge any PR. Push only v2-playable.
- Treat "Test timed out" on a long suite as Mac sleep until proven otherwise; re-run under caffeinate.
- If you hit a decision only I can make, stop and ask.
```
