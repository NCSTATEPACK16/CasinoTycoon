# v2 handoff: finish "playable" (SPEC §9)

Written 2026-10-23 by the lead session that built the v2 foundation, merged the four module branches and built the integration UI. This file and `v2/docs/SPEC.md` are the whole briefing: you need nothing from earlier conversations.

## Where things stand

- **Branch:** `v2-foundation`, in the main checkout at `~/Documents/ClaudeWork/CasinoTycoon`. PR: NCSTATEPACK16/CasinoTycoon#18 (base `main`).
- **Pushed:** f04e94c (all four modules merged, 799/799 tests green).
- **Not pushed:**
  - 1f7cbd6: integration UI.
  - 5d12119: avatar drawn as a human, polish.
  - This handoff commit.
  - Run the full suite before pushing them.
- **The four module branches** (graphics, camera, guest-ai, economy) are all merged. Their sessions are finished. Don't restart them; do the remaining work yourself.

### §9 exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | `npm test` green: exact edges, MC edges, nav, ported suite | ✅ at f04e94c (799/799). ⬜ re-run after the UI commits and lot-size work |
| 2 | `npm run build` clean | ✅ |
| 3 | Start scenario; paint floor, walls/doors, zones; place all 5 games with tuned rules; hire dealers/janitors/security | ✅ verified in browser. Floor/zone/wall painting was driven by sim commands; drive the drag tools by hand once |
| 4 | Guests navigate, gamble, eat, restrooms, leave; a day at 4× shows hold ≈ theo | ✅ mostly. ⬜ guests bunch in the entrance lobby; check the bar, restroom and food visits in a full day |
| 5 | God → 3rd → 1st, walk, inspect, play one round of each game | ✅ all five games played through the table screen |
| 6 | Save → reload → resume | ✅ autosave plus Continue verified |
| 7 | Stress: 2,000 objects + 500 guests at ~60fps | ⬜ **blocked on lot size**; see Task 1 |
| 8 | Looks good in screenshots of each pillar | ✅ mostly; polish list below |

## Tasks, in order

### Task 1: per-scenario lot sizes (blocks §9.7)
`CampaignDef.lot` exists, and Sandbox has `lot`, but the sim hard-codes 40×30 (`GRID_COLS`/`GRID_ROWS` in `world.ts`, `IsoGrid`, `TileField`, `starterFloorPlan`, `randomWalkableTile`, the nav bake). 40×30 is only 1,200 cells, so 2,000 objects can't fit.

The guest-AI session had nearly finished this when it hit its usage limit. Its uncommitted work is saved as **`v2/docs/handoffs/lot-size-wip.patch`**. It covers 8 files plus a new `src/sim/world.lot.test.ts`, and applies cleanly on `v2-foundation`.

1. Apply it from the repo root: `git apply v2/docs/handoffs/lot-size-wip.patch`.
2. Read it and finish it. Intent:
   - `startScenario(def)` sizes the grid, floor, starter layout, TileFields and nav from `def.lot ?? 40×30`.
   - Sandbox is 96×64, with a starter layout of gaming, high-limit, food court, restrooms and back-of-house rooms, all with doors. The entrance is at (95, 32).
   - Campaigns stay 40×30 and play byte-identical for a seed.
   - Save/load round-trips the lot.
   - A test places 2,000 slots and decor on Sandbox with every aisle still walkable.
3. Also check the main-thread side. `WorldView` and the god-cam bounds read `snapshot.floor`. `Stage.defaultPlan` uses the constants only before the first floor arrives. Confirm a 96×64 lot renders, culls, and that the camera clamps to it.

### Task 2: stress test (§9.7)
In Sandbox, place about 2,000 objects (mostly slot banks with aisles, plus tables and decor), hire dealers, and push to 500 guests with the `debugSpawn` command. Then measure:
- fps from the render loop;
- `stage.renderer.info.render.calls` (budget ≤ 300);
- worker tick time from the `stats` command (budget ≤ 8 ms);
- view it from god view and at eye level.

Fix whatever misses. The graphics budgets are in SPEC §5.

### Task 3: playtest loop and polish
Play a full Dusty Dime run at 4× through the UI only, with no `__v2` commands. Known items:
- **Entrance crowding:** guests bunch in the entrance lobby on arrival. Look at spawn pacing and lobby flow in `src/sim/agents`.
- **Felt text:** the blackjack felt always reads "BLACKJACK PAYS 3 TO 2", even at 6:5. Use a dynamic felt texture or a decal swap from the table's rules.
- **Table occupancy:** the avatar can sit at a full table (4/4). Either the avatar needs a free seat, or it should take one.
- **Wallet display:** during a round, the table-play wallet shows the pre-bet amount. Show the stake as committed.
- **Win/lose card:** check it when a scenario actually ends, not just by calling `menus.gameOver` directly (the only way it's been seen so far).
- **Drag tools:** drive Floor, Zone and Walls with the real mouse and check the previews and costs.
- **Payout text:** the floating payout labels are very large at eye level. Consider scaling them by camera distance.

### Task 4: finish
- Run the full suite under `caffeinate -i` and `npm run build` in `v2/`.
- Commit, push `v2-foundation`, and update PR #18's description with a §9 checklist.
- Merge only if the user says to.

## How to work here

- **Run:** `cd v2 && npm install`. The dev server is `.claude/launch.json` config **`v2`** on port 5174; use `preview_start {name:"v2"}`. The built-in browser works well at a 1440×900 viewport.
- **Debug hook:** `window.__v2 = { sim, stage, god, build, controls, panel, table, menus }`. `sim.command({type: ...})` reaches every worker command; the list is in `src/shared/contracts.ts`.
- **Title screen:** the game boots to it. Start a scenario by clicking a `button.scenario`.
- **Map:**
  - `src/worker/` is the sim thread: `commands.ts` dispatch, `inspect.ts` panel views, `snapshot.ts`.
  - `src/ui/` is the integration UI: `SidePanel`, `TablePlay`, `Menus`, `Hud`, `rulesSchema`.
  - `src/main.ts` wires them together.
  - Module docs: `src/sim/games/ECONOMY.md` and the per-module handoffs in this folder.
- **Tests:** the full suite takes about 80 s of wall clock on an awake Mac. **This Mac sleeps on battery**, and that shows up as "test timed out" failures that aren't real. Run long suites under `caffeinate -i` with the Mac plugged in, and judge performance by CPU time.
- **Recast:** the WASM init is async. `SimClient` queues commands until the worker posts `ready`.
- **Repo rules:** `v2/docs` is committed and pushed (the user's explicit exception for v2). Everything else under `PLAN.md`, `.claude/` and `docs/superpowers/` stays local. Never import v1 (`../src`) from v2.
- **Commits:** commit messages explain *why*, end with the `Co-Authored-By: Claude` line, and use `Prettier` (`v2/.prettierrc`).
- **Done means** every row in the §9 table above is ✅, with evidence (test counts, fps numbers, screenshots). Tick the rows in this file as you go, and commit it with each step.
