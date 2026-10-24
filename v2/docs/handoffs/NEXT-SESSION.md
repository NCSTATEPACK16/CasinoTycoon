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
| 1 | `npm test` green: exact edges, MC edges, nav, ported suite | ✅ 804/804 after the UI commits and lot-size work (84 files, 73 s under `caffeinate -i`) |
| 2 | `npm run build` clean | ✅ |
| 3 | Start scenario; paint floor, walls/doors, zones; place all 5 games with tuned rules; hire dealers/janitors/security | ✅ verified in browser. Floor/zone/wall painting was driven by sim commands; drive the drag tools by hand once |
| 4 | Guests navigate, gamble, eat, restrooms, leave; a day at 4× shows hold ≈ theo | ✅ mostly. Entrance bunching fixed (Task 3). ⬜ check the bar, restroom and food visits in a full day |
| 5 | God → 3rd → 1st, walk, inspect, play one round of each game | ✅ all five games played through the table screen |
| 6 | Save → reload → resume | ✅ autosave plus Continue verified |
| 7 | Stress: 2,000 objects + 500 guests at ~60fps | ✅ 2,036 objects, 500 guests and 90 staff on Sandbox: 58–60 fps, ≤ 284 draw calls, ≤ 1.28M triangles, 6.2–6.8 ms worker tick (Task 2) |
| 8 | Looks good in screenshots of each pillar | ✅ mostly; polish list below |

## Tasks, in order

### Task 1: per-scenario lot sizes (blocks §9.7) ✅

**Done.** The WIP patch is applied and finished (the patch file is deleted). Main-thread follow-ups: the plaza ground recentres under the live lot, and a lot of a new size reframes the god cam at its centre (distance 32 × cols/40, so 76.8 on Sandbox). Evidence:
- `src/sim/world.lot.test.ts`: 5/5. The full-floor test fits 2,824 objects (2,285 slots) on 96×64 with every walkable cell reachable from the door.
- Full suite: 804/804. tsc clean.
- Browser (1440×900, Sandbox started from the title card): the 96×64 floor renders with all rooms and the east lobby. Holding D+S pans the focus to x = 96 and clamps there. 194 draw calls on the empty lot. One slot placed by hand drew 18 guests through the lobby at 4×, with 0 repaths, teleports or rescues. Tick mean was 0.55 ms (max 2.3 ms), and the console had no errors.

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

### Task 2: stress test (§9.7) ✅

**Done.** The setup is `furnishSandbox` in `src/sim/agents/testkit.ts`: 2,036 objects (1,382 slots, 241 video poker, 50 tables, plants, neon, restrooms, food, bars), 50 dealers plus 40 other staff, and the floor topped up to 500 guests. The first measurement missed three budgets:

| | Before | After | Budget |
|---|---|---|---|
| Worker tick, mean (browser) | 10.3–12.3 ms | 6.2–6.8 ms | ≤ 8 ms |
| Eye level from the lobby: triangles | 1.95M | 1.28M | ≤ 1.5M |
| Eye level from the lobby: draw calls | 351 | 284 | ≤ 300 |

God view stayed at 60 fps, about 250 calls and 315k triangles throughout. The fixes:
- **Crowd avoidance** (`NavSystem.tuneAvoidance`): `dtCrowd::init` leaves every avoidance preset at Detour's most expensive sampling (7×2×5). Preset 1 is now the Recast demo's "medium" (5×2×2). The crowd step halved.
- **Guest choice** (`utility.ts rankChoices`): the brain scored and sorted all ~2,000 games on every decision. It is now a generator that scores 8×8 chunks outward from the guest and hands a choice out only when it beats an upper bound on every unscored game. The order is exactly the old stable sort, so seeded runs are unchanged. `utility.test.ts` checks this against the full sort for 300 guests and fails if the bound is too tight. `world.machinesRevision` invalidates the chunk index.
- **LOD bands:** objects drop to LOD1 at 16 m (was 24 m) and the crowd's full mesh at 14 m (was 20 m).
- **Shadows from a low camera:** shadow reach scales with camera height (24 m at eye level, 70 m overhead), and below 6 m only LOD0 objects cast. At eye level the shadow pass used to cover a 50 m wedge of casters too far away to see.

Evidence:
- `sandbox.stress.test.ts`, NAV_PERF=1: 4.19 ms mean, 5.66 ms p95 in node.
- Browser: 58.4–60.2 fps in god view, 60.2 fps in third person from the lobby, 60.1 fps in a packed aisle with 500 guests.
- Full suite: see the commit message.

Left for Task 3:
- My stress layout has one-cell aisles, and at 500 guests it jams: about 2,300 repaths and 60 teleports in 90 s. A real floor plan with two-cell aisles should be checked.
- The third-person camera can sit pressed against a partition wall in the lobby.
- One frame hitch of 66–150 ms happens the first time the eye-level view loads new LOD pools.

The worker in the browser runs about 1.6× slower than node, so the browser tick is the number to watch. `NavSystem.test.ts` now asserts its bake times only under NAV_PERF=1, like the other wall-clock tests. It passes standalone (bake 72 ms, budget 150), but under the parallel suite on battery it measured 400–850 ms.

In Sandbox, place about 2,000 objects (mostly slot banks with aisles, plus tables and decor), hire dealers, and push to 500 guests with the `debugSpawn` command. Then measure:
- fps from the render loop;
- `stage.renderer.info.render.calls` (budget ≤ 300);
- worker tick time from the `stats` command (budget ≤ 8 ms);
- view it from god view and at eye level.

Fix whatever misses. The graphics budgets are in SPEC §5.

### Task 3: playtest loop and polish
Play a full Dusty Dime run at 4× through the UI only, with no `__v2` commands. Known items:
- ✅ **Entrance crowding.** Guests who found every seat taken browsed within 6 cells of where they stood, and right after arriving that's the lobby. On a Dusty Dime opening (two slots and one dealt table), the 6×9 lobby held 8.8–10.5 guests on average and peaked at 17. `Guest.nearbyTile` now sends a browser who is off the gaming floor to a random game it may use, and it browses within 3 cells of it. On the floor, browsing stays nearby as before.
  - I left spawn pacing alone. `spawnChance` is the economy's tuned v1 curve, and the campaign goals were measured against it.
  - This only affects nav mode. Grid-mode worlds, including the ported balance suites, never browse.
  - Evidence: the new `crowd.test.ts` "send arrivals … onto the floor" measures a lobby mean of 3.0 (the old code gives 10.5, so the test fails without the fix). In the browser, I built the same opening on Dusty Dime by hand at 4×. Before, about 15 guests stood in the lobby. After, about 5, all passing through, and the rest spread around the table on the floor.
  - Also seen: while the game is paused, the Staff panel's hire count doesn't refresh (it showed Dealer × 0 after a hire). The HUD bar also overlaps the Floor button when the pane is about 800 px wide.
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
