# Track B, part 2: real games, staff and marketing (B9, B10, B11)

Branch `v2-tycoon-2` (cut from `origin/v2-playable` at cea8b80, which already holds Track B's ship cut, PR #20), dev port 5177, launch config `v2-tycoon-2`. The shared rules are in [NEXT-SESSION.md](NEXT-SESSION.md) and still apply (ownership table, contracts append-only in their own `contract:` commits, `gh` as `env -u GITHUB_TOKEN gh`, never merge, push only your own branch). The first part's task list, with every finding and its evidence, is [6-tycoon.md](6-tycoon.md): read its "What exists today", "Design decisions already made" and the B1–B8, B12 "Done" notes before you change anything they built.

The user decided (2026-11-01): B9, B10 and B11 go now, as their own PR; **B6 (decor) waits** for Track A to merge and has its own brief, [8-decor-b6.md](8-decor-b6.md), for a separate fresh session. Do not start B6, and do not touch the `stage`, `statue`, `fountain`, `lamp-post`, `lounge-seating` or `atm` defs.

## What this part is for

The first part made the game readable and gave it a campaign. This part makes the casino deeper to run:

- **B9:** every game on the floor is a real game with real math, not a payout table. Five already are (slots, roulette, blackjack, craps, Ultimate Texas Hold'em); eight still pay out of a `{p, multiplier}` list in `data/balance.ts`.
- **B10:** money buys guests: ads, tournaments, junkets, each with a cost, a duration and a visible effect in B4's charts.
- **B11:** staff matter: skill, morale, shifts, and people who try to beat the house.

Anti-goals, carried over: breaking the campaign economy without re-tuning it; goals that can be won by doing nothing or not at all; panels that show numbers the player can't act on.

## Order and why

**B9 → B11 → B10.** B9 is self-contained and moves game edges, so do it while nothing else is moving the economy. B11 changes wages and what goes wrong on the floor. B10 pushes arrivals up and reads best once the other two settle. Take the first unticked task in this file, one per iteration. B9 is split into four iterations of two games each so each stays reviewable.

**What cannot be done here.** B10's concert needs the `stage` decor item, which is B6's. Build B10 without it (ads, slot tournaments, junkets) and leave a clearly named hook so B6's session can add the concert: the event system takes an event def; a concert is one more def that requires a `stage` object. Write that hook up under "Handing to B6" below.

## Tasks

- [ ] **B9a. Sic bo and three-card poker.**
- [ ] **B9b. Pai gow and keno.**
- [ ] **B9c. Video poker and pachinko.**
- [ ] **B9d. Bingo and big six.**

  For each game:
  - Implement `GameEngine` (`shared/games.ts`), in `sim/games/<game>/`, with no `{p, multiplier}` table. Model it on `sim/games/blackjack/` or `roulette/` (the existing engines) and read `sim/games/ECONOMY.md` first.
  - `theoreticalEdge` comes from exact enumeration where it is feasible, otherwise Monte Carlo of at least 2M rounds within ±0.15%. Cite the published house edge in a test comment. Where a game has several bets, test each bet's edge.
  - Register it in `sim/games/index.ts` (`ENGINES`, `ENGINE_FOR_DEF`) and add its seats in `shared/catalog.ts` / `data/objects`. Point the machine at the engine the way `engineMachines.test.ts` does for the five that exist, and retire the old machine class (`SicBoTable`, `ThreeCardPokerTable`, `PaiGowTable`, `KenoLounge`, `VideoPokerBank`, `PachinkoMachine`, `BingoHall`, `BigSixWheel` in `sim/entities/machines/`) once nothing uses it.
  - Give it rule levers in the rules editor (`ui/rulesSchema.ts`), as the other engines have, each lever changing the edge in a tested way.
  - Each round result carries the data Track A's effects need, in the same shape the existing engines' results use: big six's landed segment index, the dealt cards for three-card poker and pai gow, the dice for sic bo, the drawn numbers for keno and bingo, the held cards and draw for video poker. Keep Track A's one round-recording call in `EngineGame`/`enginePlay` (see the ownership table) when you touch those files. **Check `origin/v2-playable` for what Track A has merged before you shape these**, and ask for nothing you can read there.
  - Pachinko and bingo aren't standard casino maths: define a defensible par sheet for each (what a hall actually pays back), document it in `sim/games/ECONOMY.md`, and say why.
  - Avatar play for these comes from Track A's generic play view (A6). If A6 is merged in your branch, check each new game opens in it; if not, leave the `main.ts` play gate alone and note it under "Requests to Track A".
  - **Re-tune on purpose, and watch what leans on these games.** The career uses them: **House Rules** is an arcade-only scenario (slots, video poker, pachinko, keno, bingo) whose goal is a 4–8% hold band over $12,000 wagered a day; **Lucky Strike** unlocks pachinko and bingo; **Velvet Rope** unlocks three-card poker; **House Rules** unlocks pai gow. When a game's edge or per-play shape changes, the career bots in `sim/__testkit__/career.ts` (`CAREER_PLANS`) and `career.test.ts` (7 seeds, grid and crowd, a reasonable plan wins ≥ 4 of 7, build-and-abandon wins 0 of 7) must be re-run and the goals or plans re-tuned, never loosened until a test passes. The three P16 campaigns have their own guards (`campaigns.test.ts`, `difficulty.test.ts`, `crowd.campaigns.test.ts`).
  - **Evidence per iteration:** the new engine tests (edge per bet, lever effects, determinism for a seed), `tsc`, the campaign suites with before → after numbers (including `career.test.ts` after B9c and B9d, because they touch House Rules), and a browser check.
  - **Evidence for the whole of B9:** hold ≈ theo over a 4× day in the browser for at least two of the new games (the Finances tab's "By game" table shows hold and theo), with the numbers written into the task.

- [ ] **B11. Staff with depth.**
  - **Skill and training:** each staff member has a skill that changes what they do (a dealer's speed and error rate, a mechanic's repair time, a janitor's reach); training costs money and time and raises it.
  - **Morale and fatigue:** wages, shift length, break rooms (use existing services if one fits; do not add decor items, those are B6's) and being understaffed move morale; low morale slows work and raises quits.
  - **Shifts tied to the B3 traffic curve:** a staff member works a shift, not 24 hours; the Staff panel shows who is on and who is off, and the player can set the roster against the day's curve.
  - **Advantage players and cheaters:** blackjack counters and past-posters (and similar for other games) arrive as a small share of guests (new archetypes or a flag, your call; keep the sim deterministic). Pit bosses and security detect and remove them; leaving them alone costs hold. The player must be able to see who is suspicious and act (the Guests tab is the place).
  - **Pick up and drop** for staff, if cheap; skip and say so if not.
  - **Evidence:** unit tests; a sim test where an unstaffed pit loses hold to counters and a staffed pit doesn't; the campaign suites and `career.test.ts` green, re-tuned on purpose with before → after numbers; a browser playthrough of the new Staff panel with screenshots.

- [ ] **B10. Marketing and events the player runs.**
  - **Ad campaigns** that cost money and lift arrivals by archetype for a few days (billboards for tourists, mailers for high rollers, and so on). Arrivals go through `maybeSpawn`/`arrivalChance` (B3, `data/traffic.ts`); extend that, don't bypass it.
  - **Slot tournaments** and **high-roller junkets**: a junket brings a fixed group of high rollers for a day for a cost; a tournament fills the slot floor for an evening.
  - Each is scheduled from a panel (`ui/panels/`), with its cost, duration and expected effect shown beforehand, its real effect visible afterwards in B4's charts and the day report, and a cooldown or price that keeps it from being free money. Scenarios decide whether they are available (`CampaignDef` gains an optional list; the tutorial and the early career don't offer them).
  - The **concert** is B6's (it needs the `stage`): make events defs in data (`data/events.ts` or similar) that can require an object, so adding it later is one def.
  - **Evidence:** unit tests for the effects; a sim test that an ad lifts arrivals for its days only and costs what it says; the campaign suites green with before → after numbers (campaigns that don't offer marketing must be unchanged); a browser check that a campaign visibly lifts arrivals in the charts, with screenshots.

- [ ] **B14. Finish.**
  1. Merge `origin/v2-playable` if it moved (it will have Track A's PR #21 if the user merged it).
  2. Full suite under `caffeinate -i` and `npm run build`; the stress scene (`sim/agents/sandbox.stress.test.ts` with `NAV_PERF=1`): alternate with the previous commit on the same machine when the load average is high, as B13 did.
  3. Screenshots: each new game in the rules editor and on the floor, the new Staff panel, the marketing panel, a suspicious-guest flag.
  4. Update the PR description (checklist, evidence, every `contract:` commit and `world.ts` hook), take the PR out of draft, report, stop the loop.

## Handing to B6

(Fill in as you build.) What B6's session needs from you: the event-def shape the concert plugs into; how to add a staff-facing "rest" service for `lounge-seating` against B11's fatigue; how `atm` interacts with a wallet change if B9 touched bankrolls.

## Requests to Track A

(none yet)

## The loop prompt

```
/loop Track B part 2 of Casino Tycoon v2: B9 real engines for eight games, B11 staff depth, B10 marketing and events. Briefing, read in full every iteration: v2/docs/handoffs/NEXT-SESSION.md (shared rules), v2/docs/handoffs/7-tycoon-2.md (your task list) and v2/docs/SPEC.md. Skim v2/docs/handoffs/6-tycoon.md for what part 1 built.

Each iteration:
1. git fetch origin. If origin/v2-tycoon-2 or origin/v2-playable has commits your branch lacks, bring them in first (fast-forward your own branch; merge v2-playable, not rebase), resolving with the ownership table in NEXT-SESSION.md. Then run git log --oneline -5 and reread the briefing files.
2. Take the first unticked task in 7-tycoon-2.md and do only that. B9 is four iterations (B9a–B9d). Never work in the main checkout at ~/Documents/ClaudeWork/CasinoTycoon. Never start B6 (decor): it is for a later session.
3. Read the code the task touches before changing it. Use subagents where they help (Explore to map code, general-purpose for a self-contained engine, an exact-enumeration derivation or a review), and check their work yourself. Implement the task properly, matching the surrounding code.
4. Verify with evidence:
   - npx tsc --noEmit
   - only the affected test files (cd v2 && npx vitest run <paths>)
   - the campaign suites (src/data/campaigns including crowd.campaigns.test.ts and career.test.ts, src/sim/world.tier2.test.ts, src/sim/agents/crowd.test.ts, src/sim/agents/playshare.test.ts) whenever the change can move guests, money or goals, with before → after numbers
   - the built-in browser (preview_start name "v2-tycoon-2"), driving the change through the UI, with window.__v2 only for setup
   - screenshots of new panels
5. Tick the task in 7-tycoon-2.md with that evidence. Commit the work and the ticked file together, with a message that explains why and ends with the Co-Authored-By line. Push v2-tycoon-2 only, and update the draft PR's checklist.
6. Work through 7-tycoon-2.md in its order (B9a–B9d, B11, B10, then B14). When B14 is done, report to me and stop the loop.

Rules:
- Never merge any PR. Push only v2-tycoon-2. Never edit Track A's files; write what you need under "Requests to Track A" and mention it in your report.
- Scenario goals must be winnable with a reasonable strategy and not winnable by doing nothing, on the real crowd as well as the grid, and every scenario change keeps its automated proof.
- Treat "Test timed out" as Mac sleep or load until proven otherwise; re-run the file alone under caffeinate -i. Run long suites in the background and read only their summaries.
- If you hit a decision only I can make, stop and ask.
```
