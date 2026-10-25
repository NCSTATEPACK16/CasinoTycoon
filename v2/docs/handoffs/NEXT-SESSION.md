# v2 handoff: from "playable" to "alive" (two parallel tracks)

Rewritten 2026-10-24, after "playable" (SPEC §9) was finished. This file holds the rules both tracks share. Each track also has its own task list. Together with `v2/docs/SPEC.md`, these files are the whole briefing; you need nothing from earlier conversations.

## The two tracks

The next phase runs as two sessions at once. Each session has its own branch and worktree and runs its own `/loop`.

| Track | Task list | Branch | Dev port | Launch config name |
|---|---|---|---|---|
| **A, Alive:** sound, moving reels/wheels/dice, cards and chips on the felt, dealers dealing, graphical table play, lighting, people, exterior | [5-alive.md](5-alive.md) | `v2-alive` | 5175 | `v2-alive` |
| **B, Tycoon:** quality of life, the hidden sim systems, traffic, finance, decor with real effects, progression and campaigns, the remaining game engines, marketing, staff, tutorial | [6-tycoon.md](6-tycoon.md) | `v2-tycoon` | 5176 | `v2-tycoon` |

Every iteration, reread all of this file plus your own track's task list. The loop prompts are in [LOOP-PROMPT.md](LOOP-PROMPT.md).

## What the user decided (2026-10-24)

- **Look: lively stylized.** Keep the current Planet Coaster style and make it alive: things move, light up and make sound, and the people look better. Don't go photoreal. Don't replace the art style, the material system (atlas decals + `ObjectMaterial`) or the VAT crowd.
- **Order: both tracks at the same time,** in separate sessions on separate branches.
- **3D art:** extend the headless Blender build scripts (`v2/assets/blender/*.py`) and use CC0 libraries (Poly Haven, and Poly Pizza items marked CC0). **No AI-generated models;** don't use the Blender MCP's `generate_3d`.
- **Sound:** CC0 packs, Kenney first (as v1 did), mixed with WebAudio and positioned in 3D.

## Where things stand

- "Playable" is done.
  - PR NCSTATEPACK16/CasinoTycoon#19 (`v2-playable` → `v2-foundation`) is open at dfaef57.
  - 813/813 tests pass, the build is clean, and every §9 row is ✅. The evidence is in the PR description and in git history (`git log v2-foundation..v2-playable`).
- PR NCSTATEPACK16/CasinoTycoon#18 (`v2-foundation` → `main`) is also open.
- **Never merge any PR.** The user merges.
- **Already built:**
  - Renderer: instanced pools, 8×8 floor chunks, LODs, a VAT crowd with 8 clips (idle, walk, sit, play, cheer, sad, eat, deal), 18 hero GLBs built by script, HDRI, a fitted sun, N8AO, SMAA, ACES, and global bloom.
  - Sim: 7 games on the real engines, with needs, bankrolls, Recast nav and staff.
  - Content: 3 campaigns plus Sandbox.
  - Integration UI: HUD, inspector, rules editor, P&L, staff, a DOM table-play panel, menus and saves.
- **Two audits on 2026-10-24 found:**
  - v2 works but feels static: no sound; no slot reel, wheel or die ever moves; no cards or chips on the felt; dealers idle.
  - The avatar's table play is a text form.
  - The tycoon loop runs out after about an hour, and most of the sim's depth (comps, players club, rating breakdown, prices) can't be reached from the UI.
  - Each track file opens with the findings that concern it, with file:line references, so you don't need to repeat the audit.

## Branches, PRs and merging

- **Your branch:** cut it from `origin/v2-playable` (dfaef57 or later) in your own worktree. **Never work in the main checkout** at `~/Documents/ClaudeWork/CasinoTycoon`; the user and the other track use it.
- **Your PR:**
  - Push only your own branch.
  - On your first push, open one **draft** PR into `v2-playable`:
    ```
    env -u GITHUB_TOKEN gh pr create --draft --base v2-playable --head <your-branch> --title "..." --body "..."
    ```
  - Keep its description current. It needs your track's checklist, the evidence, and every `contract:` commit and `world.ts` hook you added.
- **Never** push `v2-playable`, `v2-foundation` or `main`. Never merge any PR.
- **Neither track waits on the other.** The user may merge either PR whenever they like, mid-run or at the end. Work that only makes sense with the other track's code is written as an "after merge" line in the task, done if the code is already in your branch, and otherwise left for the finish task to note.
- **At the start of every iteration:**
  1. Run `git fetch origin && git log --oneline HEAD..origin/v2-playable`.
  2. If the user has merged something there (for example the other track), `git merge origin/v2-playable` into your branch. Use merge, not rebase: your branch is already pushed.
  3. Resolve conflicts with the ownership table below.
  4. Re-run `npx tsc --noEmit` and the affected tests.
  5. Push.

## Who owns what (this keeps the two branches mergeable)

| Path | Owner |
|---|---|
| `src/render/**`, `assets/**` (Blender scripts, `.blend`, GLBs, VAT, HDRI, textures, **audio files**) | A |
| `src/audio/**` (new), `src/ui/TablePlay.ts`, `src/ui/play/**` (new), `src/ui/Settings.ts` (new), `src/input/**` | A |
| `src/sim/agents/seats.ts`, `src/sim/fx/**` (new: round-effect records) | A, under the economics guard below |
| Narrow slices inside B's sim files, each kept to the lines named here and listed in A's PR: dealer position and animation in `src/sim/entities/staff/Staff.ts` (`anim`, the dealer-spot choice); the animation/pose choice in `src/sim/entities/Guest.ts` (`:213-218`); one call per play in `src/sim/entities/machines/EngineGame.ts`/`enginePlay.ts` that records round data into `src/sim/fx/` | A |
| `src/data/**` (balance, objects, campaigns, floorPrices, score, thoughts), `src/sim/games/**`, `src/sim/economy/**`, `src/sim/scenario/**`, `src/sim/modifiers.ts`, `src/services/**` | B |
| `src/sim/entities/machines/**`, `src/sim/entities/Guest.ts`, `src/sim/agents/utility.ts`, `src/sim/entities/staff/**`, all apart from A's slices above | B |
| Existing logic in `src/sim/world.ts` for arrivals and the guest cap (`:108-120`, `:819-827`), rating and signage (`:671-716`), comps, patrons and prices | B may rewrite it. A adds named hooks only. |
| `src/ui/Hud.ts`, `src/ui/SidePanel.ts`, `src/ui/Menus.ts`, `src/ui/tools/BuildToolbar.ts`, `src/ui/panels/**` (new) | B |
| New files B needs under `src/render/` for its own overlays (heat maps), e.g. `src/render/HeatOverlay.ts` | B. Don't edit existing render files; add the overlay to `stage.scene` from `main.ts`. |

Files both tracks may touch, under these rules:
- **`src/shared/contracts.ts`:** append only. Add new members at the end of `Command` / `SimEvent` and new **optional** fields on view types. Each change goes in its own commit whose message starts with `contract:`. Never reorder, rename or reformat.
- **`src/shared/catalog.ts`:**
  - B adds entries for new defs, with a placeholder asset (`'proc:box'`) where no art exists yet.
  - A changes only `asset`, `height`, `color`, `glow` and `seats` of existing entries, and adds the art for the pre-agreed decor below.
- **`src/worker/commands.ts`, `src/worker/snapshot.ts`, `src/worker/sim.worker.ts`:** add new cases at the end of switches and new functions. No refactors.
- **`src/sim/world.ts`:** B may change the existing logic it owns (row above). Anything else is narrow named hooks only (one method each), listed in your PR description.
- **`src/shared/games.ts`:** append only, with optional fields and methods, in `contract:` commits. A may add optional bet-layout metadata for its play view; B's new engines fill it in where it exists.
- **The HUD mount point:** B1 adds an empty `<div id="hud-slot-a">` at the right-hand end of the HUD bar and keeps it through every later HUD change. A mounts its Settings gear there when the element exists, and otherwise falls back to its own fixed-position button.
- **`src/main.ts`:** wiring lines only. The logic lives in your new modules.
- **`src/ui/ui.css`:** append new blocks under a `/* Track A */` or `/* Track B */` comment. Don't restyle existing rules.

If you need something in a file the other track owns, don't change it. Write it under "Requests to the other track" at the bottom of your task list, commit that, and mention it in your iteration report so the user can pass it on.

## Pre-agreed new decor (so art and gameplay meet cleanly at merge)

| defId | Footprint (w×h cells) | B builds the gameplay | A builds the art |
|---|---|---|---|
| `statue` | 1×1 | Prestige: an appeal radius | Bronze figure on a marble plinth |
| `fountain` | 3×3 | Prestige plus a calm area: a larger appeal radius | Basin with animated water (UV scroll), soft splash sound |
| `lamp-post` | 1×1 | Small appeal | Brass lamp; emissive; casts a light pool on the carpet |
| `lounge-seating` | 2×1 | A rest service: restores energy | Velvet sofa with seat markers |
| `atm` | 1×1 | Cash access: guests top up their bankroll and pay a fee | ATM kiosk with a lit screen |
| `stage` | 4×3 | Shows and events (B10) | Raised stage, curtain and lighting truss |

- Prices, upkeep, zones and effect sizes are B's call.
- On merge, keep A's `asset`/`height`/`color`/`glow`/`seats` and B's `zones`.

## Shared guardrails

- **Performance:** the stress scene is Sandbox with 2,000 objects, 500 guests and 90 staff on High (see `src/sim/sandbox.stress.test.ts` and the 17ab077 commit message for how it was built). Targets:
  - ≥ 55 fps at 1280×800 in the built-in browser
  - ≤ 300 draw calls (`renderer.info.render.calls`)
  - ≤ 1.5M triangles
  - ≤ 7 ms sim tick

  Measure before and after any change that adds rendering, agents or per-tick work, and put the numbers in the commit message.
- **Asset sizes:** GLBs ≤ 6 MB in total, human VAT ≤ 10 MB, audio ≤ 8 MB in total. Prefer OGG, and confirm it decodes in the built-in browser.
- **Determinism:** the sim stays deterministic for a seed plus a command sequence. Render and audio randomness may use `Math.random`; the sim never does.
- **What you see happened, but not everything that happened is shown.** The clock is compressed: an in-game hour is 5 s at 1× (`TICKS_PER_HOUR` 50 at 10 Hz), and one guest visit plays several rounds at once (`ENGINE_BALANCE.playShape` in `data/balance.ts`; blackjack plays 16 hands per visit). A table deals around a dozen hands every real second, so no animation can show every round.
  - The rule: every reel stop, ball, die or card shown in detail is a **real round the sim played**, sampled from the latest batch.
  - Labels, flashes and sounds tied to a shown round use that round's own result.
  - Cosmetic motion is fine only where it can't contradict the sim. For example, an idle attract animation must never show a winning line or flash when nothing was paid.
- **Economics guard:**
  - A must not change game outcomes. After touching anything under `src/sim/`, run `src/data/campaigns`, `src/sim/world.tier2.test.ts` and `src/sim/agents/crowd.test.ts`.
  - B changes economics on purpose. Run the same suites, re-tune, and record the before and after numbers in the commit.
- **Licensing:** CC0 only. Record every external file in `v2/assets/CREDITS.md`: path, source URL, author and licence.
- **Downloads need the user's OK.** Ask once per batch with names, source URLs, sizes and licences. Don't skip tasks while you wait. If a task needs a sound that isn't approved yet, synthesize a WebAudio stand-in under the same sound key, tick the task with a note, and swap in the real file when the user says yes.
- **v1:** never import it (`../src`, `../public`) from v2. You may read it for ideas, and you may copy its CC0 Kenney audio files from `../public/audio/` into v2. They are already in the repo, so copying them needs no download.

## Testing policy

- **Each iteration:**
  - `npx tsc --noEmit`
  - only the test files that touch the change (`npx vitest run <paths>`)
  - the economics guard when it applies
  - a browser check of the change, with screenshots for anything visual

  Don't run the full suite every iteration.
- **Full suite:** once, at your track's finish task, under `caffeinate -i`. This Mac sleeps and throttles on battery. Treat "Test timed out", or a wall-clock assertion failing only under the parallel suite, as load until proven otherwise; re-run the file alone.
- **New logic gets unit tests:** pure modules such as audio voice limiting, reel-stop timing, loan maths, traffic curves, appeal radius and progression storage. Rendering is verified in the browser.

## How to work here

- **Setup (in your worktree):**
  1. Run `cd v2 && npm install`.
  2. `.claude/` is git-ignored, so create `.claude/launch.json` in your worktree root with one configuration named after your track: `{"name": "v2-alive", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "v2", "run", "dev", "--", "--port", "5175", "--strictPort"], "port": 5175}` (Track B uses `v2-tycoon` and 5176).
  3. Start it with `preview_start {name: "<that name>"}`.
- **Browser viewport:** the built-in browser pane is often narrow. `resize_window` 1280×800 works. If screenshots come back quarter-size, use `find`/`read_page` refs instead of coordinates.
- **Placing objects:** hover before clicking, so the build ghost follows the pointer.
- **Title menu:** the buttons aren't in the accessibility tree. Click `button.scenario` or the Continue button through the DOM.
- **Sandbox starts empty.** For a furnished floor, use these from `window.__v2.sim.command(...)`:
  - place objects with `{type:'place', defId, col, row, rot}`
  - hire with `{type:'hire', kind:'dealer'}`
  - add guests with `{type:'debugSpawn', count}`

  Frame the camera with `window.__v2.god.setState({...god.getState(), focus:{x,z}, distance})`. Starting a new Sandbox overwrites the autosave.
- **Debug hook:** `window.__v2 = { sim, stage, god, build, controls, panel, table, menus }`. Use it for setup and reading state only. Drive what you verify through the UI. The worker command list is in `src/shared/contracts.ts`.
- **Map:**
  - `src/worker/` is the sim thread.
  - `src/ui/` is the integration UI.
  - `src/main.ts` wires them.
  - `src/sim/agents/` is the guest brain: `utility.ts`, `stands.ts`, `testkit.ts`, with `furnish` and `furnishSandbox`.
  - Module docs: `src/sim/games/ECONOMY.md` and the handoffs `1-graphics.md` through `4-economy.md` in this folder.
- **Code search:** the jCodemunch index also covers old worktrees under `.claude/worktrees/`. Ignore hits there.
- **Repo rules:**
  - `v2/docs` is committed and pushed (the user's explicit exception for v2).
  - `PLAN.md`, `.claude/` and `docs/superpowers/` stay local.
- **Commits:** messages explain *why* and end with `Co-Authored-By: Claude <noreply@anthropic.com>`. Format only the files you touch with Prettier (`v2/.prettierrc`); several existing files are not Prettier-clean, so don't reformat them.
- **`gh`:** `GITHUB_TOKEN` in the environment shadows the keyring login. Run `gh` with `env -u GITHUB_TOKEN`.
- **Subagents** are welcome when they help: an Explore agent to map code before a big task, or a general-purpose agent for a self-contained test, a CC0 asset search or a review. Check their work yourself before you tick anything.

## Notes from "playable" (not blocking; take one if you are in the area)

- The one-cell-aisle stress layout jams at 500 guests: about 2,300 repaths and 60 teleports in 90 s.
- The third-person camera can press against a partition wall in the lobby. (A)
- One frame hitch of 66–150 ms happens the first time eye-level LOD pools load. (A)
- While paused, the Staff panel's hire count doesn't refresh. (B)
- At a pane width of about 800 px, the HUD bar overlaps the Floor button. (B)
- Build placement is one object per tool pick unless Shift is held. That's by design, but worth a hint in the UI. (B)
- The campaign win card was verified only by tests, never reached in the browser. (B, in B8)
