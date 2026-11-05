# B6: Decor and amenities with real effects (a fresh session, after Track A has merged)

**Do not start this until the user has merged Track A's PR (NCSTATEPACK16/CasinoTycoon#21, branch `v2-alive`, including its A13 finish and any art task A10).** B6 ships together with Track A's decor art (A10); the six decor items below get their art from it, and starting earlier would mean building on `'proc:box'` placeholders and then merging over them. Check with `git fetch origin && git log --oneline origin/v2-playable` and the state of PR #21; if it is not merged, stop and ask the user.

Branch `v2-decor`, cut from `origin/v2-playable` once Track A is in; dev port 5178, launch config `v2-decor` (`.claude/` is git-ignored: create `.claude/launch.json` in your worktree root, `{"name": "v2-decor", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "v2", "run", "dev", "--", "--port", "5178", "--strictPort"], "port": 5178}`). Draft PR into `v2-playable`. Shared rules: [NEXT-SESSION.md](NEXT-SESSION.md). History and evidence for everything Track B built: [6-tycoon.md](6-tycoon.md); the work that ran in parallel to this: [7-tycoon-2.md](7-tycoon-2.md) (real engines, staff depth, marketing; check whether it has merged, because B6 plugs into it, see "Plug-ins" below).

## Task

- [ ] **B6. Decor and amenities with real effects.**
  - **An appeal-radius system.** Decor raises nearby guests' happiness and nearby games' appeal, with diminishing returns (a second fountain next to the first adds less). Put the maths in one pure module under `src/data/` or `src/sim/`, with the radius, falloff and cap as named constants in `data/balance.ts`.
  - **Floor types gain prestige** (marble and wood count for more than tile; the effect is on the guests standing on or walking across them and on the rating's decor/"signage" terms, your call, but it must show in the Rating tab).
  - **The six pre-agreed items** (footprints, prices and effect sizes are yours; the footprints below are fixed so Track A's art meets them):

    | defId | Footprint | Gameplay |
    |---|---|---|
    | `statue` | 1×1 | Prestige: an appeal radius |
    | `fountain` | 3×3 | Prestige plus a calm area: a larger appeal radius |
    | `lamp-post` | 1×1 | Small appeal |
    | `lounge-seating` | 2×1 | A rest service: restores energy |
    | `atm` | 1×1 | Cash access: guests top up their bankroll and pay a fee |
    | `stage` | 4×3 | Hosts events (see "Plug-ins") |

    On merge keep Track A's `asset`, `height`, `color`, `glow` and `seats` (it has changed them by now) and your `zones`, price and upkeep. Add entries in `shared/catalog.ts` and `data/objects`; read what A10 actually named them before you add any.
  - **Replace or extend the signage cap** so beautifying is a real layout puzzle: today the rating's signage term is capped (neon signs and marquees add a little each, up to +10); decor should compete for the same floor and attention, not stack without limit.
  - **Food rip-off rule, found in B2:** a food item is a rip-off above 3× its cost (`FOOD_BALANCE.ripoffMultiplier`), which the default soda ($2.50 on $0.50) and fries ($3.50 on $1) already exceed, so every untouched stall costs those buyers 6 happiness; the bar uses 2× its default price (`PRICE_BALANCE.ripoffIndex`). Switching food to the bar's rule moved the greedy campaign probe a lot (Neon Nights 5/7 → 2/7 wins, below MIN_WINS 4), so it was left alone. Fix it here, together with the re-tune.
  - **Re-tune on purpose.** Decor changes happiness, which changes dwell, spend and rating, so every scenario's economy moves. Run the P16 guards (`campaigns.test.ts`, `difficulty.test.ts`, `crowd.campaigns.test.ts`) and `career.test.ts` (the nine-scenario career: a reasonable plan wins ≥ 4 of 7 seeds, build-and-abandon wins 0 of 7, grid and crowd), before and after, and re-tune the goals or the bots' plans, never loosening a test until it passes. Record before → after numbers in the commit. Scenarios that restrict objects (`allowedObjects`, `CampaignDef.restriction`) decide which decor is open; new items are locked behind a career unlock (`CampaignDef.unlocks`, see `services/progress.ts`) where that fits.
  - **Evidence:**
    - unit tests for the radius and the falloff
    - a sim test showing a decorated floor beats a bare one on happiness and dwell time
    - the campaign suites and `career.test.ts` green, re-tuned if needed
    - a browser check: place each item, see its effect in the Rating tab and the mood heat map (`M`), screenshots

## Plug-ins from B9–B11 (check which have merged)

- **Concert (from B10).** If B10's event system is merged, add a concert event def that requires a `stage` object (the hook is described in 7-tycoon-2.md, "Handing to B6"): a cost, a duration, an arrivals lift and a mood lift, shown in the marketing panel and the charts like the other events. If B10 is not merged, build the `stage` item and note the concert as the first task of whoever finishes B10.
- **Rest and fatigue (from B11).** If staff fatigue is merged, `lounge-seating` should also serve staff breaks, with a tested effect on morale.
- **ATM and wallets.** If B9 changed how bankrolls work, read how guests spend and top up before adding the ATM's fee loop.

## Finish

Full suite under `caffeinate -i`, `npm run build`, the stress scene (alternate with the previous commit on the same machine if the load average is high), screenshots of each new item and the Rating tab, update the PR description (checklist, evidence, every `contract:` commit and `world.ts` hook), take the PR out of draft, report to the user and stop. Never merge any PR.

## Loop prompt

```
/loop B6 of Casino Tycoon v2: decor and amenities with real effects. Briefing, read in full every iteration: v2/docs/handoffs/NEXT-SESSION.md (shared rules), v2/docs/handoffs/8-decor-b6.md (your task) and v2/docs/SPEC.md. Skim v2/docs/handoffs/6-tycoon.md and 7-tycoon-2.md for what already exists.

First iteration: confirm Track A's PR (#21, v2-alive) is merged into origin/v2-playable; if it is not, stop and ask me. Then set up your own worktree on branch v2-decor cut from origin/v2-playable, launch config "v2-decor" on port 5178, npm install, and a draft PR into v2-playable. Never work in the main checkout at ~/Documents/ClaudeWork/CasinoTycoon.

Each later iteration: git fetch origin and merge origin/v2-playable if it moved (merge, not rebase, resolving with the ownership table in NEXT-SESSION.md); read the code the task touches before changing it; use subagents where they help and check their work; implement, then verify with evidence (tsc, the affected tests, the campaign suites and career.test.ts with before → after numbers, the built-in browser via preview_start "v2-decor", screenshots). Tick B6 in 8-decor-b6.md with the evidence, commit work and ticked file together with a message that explains why and ends with the Co-Authored-By line, push v2-decor only, and update the draft PR. When B6 is done, do the Finish section, report to me and stop the loop.

Rules: never merge any PR; push only v2-decor; never edit Track A's files (write requests in the task file); goals must stay winnable with a reasonable strategy and not winnable by doing nothing, on the real crowd and the grid, each with an automated test; treat "Test timed out" as Mac sleep or load until proven otherwise and re-run the file alone under caffeinate -i; run long suites in the background and read only their summaries; if you hit a decision only I can make, stop and ask.
```
