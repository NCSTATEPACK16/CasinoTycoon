# Track B part 2, the rest: B9b–B9d, B11, B10, B14 (specs and plan)

Written 2026-11-01 after B9a landed (d6617e2 on `v2-tycoon-2`, draft PR NCSTATEPACK16/CasinoTycoon#22). This file is the spec and the plan for everything still unticked in [7-tycoon-2.md](7-tycoon-2.md). That file stays the checklist you tick; this one says how to do each item and how much to test. The shared rules in [NEXT-SESSION.md](NEXT-SESSION.md) still apply. B6 (decor) is still not yours: [8-decor-b6.md](8-decor-b6.md).

## The user's budget rule (2026-11-01): half the testing

The B9a iteration spent most of its time and tokens on simulation and on reading test output. From now on:

- **Per task:** `npx tsc --noEmit`, the new or changed unit test files, and **one** focused campaign run (below). No full campaign sweep, no crowd variants, until B14.
- **Focused campaign run:** only the scenarios whose games or systems you changed, on the grid, with `-t` filters, for example
  `npx vitest run src/data/campaigns/career.test.ts -t "House Rules" --reporter=verbose` and, if the P16 bots could be touched, `src/data/campaigns/campaigns.test.ts`. Read only the `won`/`active:` lines and the summary (`grep -E "won [0-9]|active:|Test Files|Tests |FAIL"`).
- **Before → after numbers:** don't rerun the baseline. The baseline as of d6617e2 is recorded below; compare against it. Rerun a baseline only for a scenario your own previous task changed.
- **Monte Carlo:** ≥ 2M rounds for an edge check, once per engine, in the engine's own test file. Don't add new 40k-play machine sweeps; `engineMachines.test.ts` already loops every `ENGINE_FOR_DEF` entry.
- **Browser:** one pass of at most ~2 minutes of sim time per task, one or two screenshots at `scale: 0.6`, read state with `get_page_text` or a short `javascript_tool` that returns a string. Never `await` more than ~25 s inside one `javascript_tool` call (it times out at 45 s).
- **Long runs** go in the background (`run_in_background`) under `caffeinate -i`, with output to a file in the scratchpad; then wait with one foreground loop that greps for `Test Files` and prints only the summary lines.
- **Timeouts:** "Test timed out" under a parallel run is load. Rerun that file alone, once.
- The full grid + crowd sweep, the full suite, the build and the stress scene run **once**, in B14.

### Baseline at d6617e2 (unchanged by B9a)

| Suite | Result |
|---|---|
| P16 (`campaigns.test.ts`) | Dusty Dime 7/7, Neon Nights 5/7, High Roller 5/7 |
| Career grid, active plan | Lucky Strike `W4 W2 W3 W3 W9 W5 W10`, Velvet Rope `W13 - W7 W11 W13 - W7`, House Rules `W3 W3 W3 W3 W5 W3 W3`, Salon `W3 W4 W4 W5 W2 W5 W6`, Clean Slate `W9 W5 - W11 W14 W10 W12`, Strip `W11 W5 W4 W5 W4 W5 W5` |
| Career crowd, active plan | Lucky Strike `W4 W2 - W4 W6 - W2`, Velvet Rope `W14 W12 W6 W12 - - W9`, House Rules `W3 W3 W4 W4 W4 W6 W3`, Salon `W6 W12 - - W3 W12 W6`, Clean Slate `W5 W12 W14 - W12 W10 W14`, Strip `- W8 W5 W5 W4 W7 W4` |
| Minimal (build and walk away) | 0/7 everywhere |

## The B9 recipe (what B9a did; repeat it per game)

1. **Contract commit first,** alone: append the new kinds to `GameKind` in `src/shared/games.ts`, message `contract: GameKind gains <kinds> for B9x`. The next commit must compile it (the `_complete` check in `sim/games/index.ts` forces an engine per kind; `RULE_FIELDS` in `ui/rulesSchema.ts` is a `Record<GameKind, …>`).
2. **Engine** in `src/sim/games/<kind>/<kind>.ts`, a `CasinoEngine<R>` (`sim/games/types.ts`): `defaultRules`, `validateRules` (use `readLimits`/`readChoice`/`readNumber`), `theoreticalEdge`, `roundsPerHour`, `begin` → a `Round` class, `strategy`, `appeal`, `spotEdge`, `guestBets`. Use injected `RngLike` only. Provide a `…RoundFrom…(fixed outcome)` helper for tests, like `sicBoRoundFromDice` / `tcpRoundFromCards`. Each `RoundResult.detail` carries the data Track A's effects need (shapes below). `sim/games/sicbo/sicbo.ts` (no decisions) and `sim/games/tcp/tcp.ts` (one decision) are the templates.
3. **Exact edge** where feasible, hardcoded as a constant and **re-derived in the test** if the derivation is slow (`TCP_BASE_NET` is the pattern); otherwise Monte Carlo ≥ 2M within ±0.15%. Cite the published figure in a test comment. Test each bet's edge, each lever's effect, determinism for a seed, and the round settlement cases.
4. **Register:** `ENGINES` and `ENGINE_FOR_DEF` in `sim/games/index.ts`; `ENGINE_RULES[defId]` and `ENGINE_BALANCE.playShape[defId]` in `data/balance.ts`; the `*_BALANCE` block loses `payoutTable` and its `…ExpectedRtp()` returns `engineRtp(defId)`.
5. **Machine class:** rewrite the old class in `sim/entities/machines/` as `EngineTable` (seated) or `EngineCabinet` (one player) — see `SicBoTable.ts`. Same file and class name, so `factory.ts` and saves don't change.
6. **If the game has decisions:** add its case to `actionCost` in `GameMath.ts` (extra money an action puts down) and its kind to the `skillPremium` list with a hand count (`PREMIUM_HANDS_*`).
7. **Levers:** `RULE_FIELDS[kind]` in `ui/rulesSchema.ts`. `ui/rulesSchema.test.ts` then checks every option is legal automatically.
8. **Tune `playShape`** so the take per play stays at the old table's, `costToPlay × (1 − rtp)` (table below), measured with a throwaway test (30k plays at 2% errors; delete it after). Keep per-play swing in the same range.
9. **Fix the old-table tests:** drop the game from `ALL_TABLES` and from the `profile(…, payoutTable)` argument in `data/payoutVariance.test.ts` (keep its profile row without the table), and rewrite or delete any claim that named it (e.g. "pai gow is the flattest dealt game", "keno slowest", "video poker thinnest edge": restate them for the games that still have tables, or move the claim into the engine test). Drop it from the RTP-over-40k-plays cases in `world.tier1.test.ts` / `world.tier2.test.ts`. Keep the live-floor and factory tests.
10. **Docs:** `sim/games/ECONOMY.md`: the engine table, "where each edge comes from", levers, appeal, pace, playShape, spot ids.
11. **Catalog `game` field:** leave it unset (it opens avatar play through `main.ts`; that waits on Track A's A6). Check `origin/v2-playable` first: if A6 is merged, set it and check the game opens in A's generic play view.

### Old take per play to preserve

| defId | costToPlay | old RTP | take per play |
|---|---|---|---|
| `pai-gow` | 22 | 0.91 | $1.98 |
| `keno-lounge` | 6 | 0.75 | $1.50 |
| `video-poker` | 5 | 0.96 | $0.20 |
| `pachinko` | 5 | 0.88 | $0.60 |
| `bingo-hall` | 4 | 0.86 | $0.56 |
| `big-six-wheel` | 5 | 0.80 | $1.00 |

### Round-detail shapes for Track A

Match what B9a used: dice as numbers, cards as labels from `cardLabel` (`'As'`), plus a boolean or two for the visible outcome.

- big six `{ segment: number, symbol: string }` (segment index 0–53 on the wheel)
- pai gow `{ player: { high: string[], low: string[] }, dealer: { high, low }, outcome: 'win'|'push'|'lose' }`
- keno `{ picks: number[], drawn: number[], hits: number }`
- bingo `{ called: number[], cards: number[][], winners: number }`
- video poker `{ dealt: string[], held: boolean[], final: string[], hand: string }`
- pachinko `{ balls: number, starts: number, jackpot: boolean, payout: number }`

## B9b. Pai gow poker and keno

**Pai gow poker** (`paigow`, `pai-gow`, 6 seats):
- 53-card deck (one joker: completes straights/flushes/straight flushes, otherwise an ace). Seven cards each; the player and the banker (dealer) each set a five-card high hand that must outrank a two-card low hand.
- Both hands win: player wins 1:1 less 5% commission; one wins: push; both lose or **copy** (tie) goes to the banker.
- Guests and dealer set by the **house way**. Implement a documented house way (Wizard of Odds' "simple house way" or the Commerce Casino house way; name which) as `setHand(cards) → { high, low }`. The player's strategy is the same house way (no decisions in `options()`: one `deal` action).
- Edge: no closed form you can enumerate in a test budget. Monte Carlo ≥ 2M hands, constant within ±0.15%, cited against Wizard of Odds' figure for the player using the house way against a house-way banker (≈ 2.7%, 5% commission). Expect ≈ 41% pushes; assert it.
- Levers: `commission` 5% / 4% / none-on-the-first-$X? (keep it to `0.05 | 0.04`), `jokerRule` `'semi-wild' | 'none'` (52 cards). Each moves the edge (MC each lever once at 2M, or derive the commission one analytically from the measured win rate: edge(c) = P(lose) − P(win)(1 − c)).
- Optional Fortune side bet: skip unless cheap.
- `playShape`: slow game (~30 hands/h), so few rounds and a larger handle multiple; target $1.98 a play.

**Keno** (`keno`, `keno-lounge`, 6 seats):
- 80 numbers, 20 drawn. Guest picks a spot count (mix of 1-, 4-, 6-, 8-, 10-spot) and numbers.
- Exact edge per spot count from the hypergeometric distribution P(hits = k) = C(n,k)C(80−n,20−k)/C(80,20). One paytable per spot count; choose real paytables from a published source and cite it (typical edges 25–30%; Wizard of Odds lists several).
- Levers: `paytable` `'generous' | 'standard' | 'tight'` (three sets of tables), limits.
- `roundsPerHour`: keno is slow (a game every ~5 min live; lounge video keno is faster) — pick and document.
- Target $1.50 a play.

**Evidence:** engine tests; focused career run for **House Rules** (keno is one of its five games) and **Lucky Strike** if it uses keno; P16 campaigns unaffected (no bot buys these) — confirm with `campaigns.test.ts` only if the bots' ladders contain them (`sim/__testkit__/strategies.ts`). Browser: place both, one screenshot of the rules editor.

## B9c. Video poker and pachinko

**Video poker** (`videopoker`, `video-poker`, a 3-cabinet bank):
- Jacks or Better, 52 cards, deal five, hold any, draw. Options: the 32 hold masks as actions `hold:xxxxx` (bits), then settle.
- Strategy: a strategy chart, not per-hand enumeration (holding nothing alone is 1.5M draws). Use Wizard of Odds' simple Jacks-or-Better strategy (cite it) as `strategy()`.
- Edge: published optimal returns per paytable (cite): 9/6 99.54%, 8/5 97.30%, 7/5 96.15%, 6/5 95.00%. The guest plays the chart, which costs ~0.1%: measure the chart's return by MC ≥ 2M per paytable and use that as `theoreticalEdge` (state both numbers in the test).
- **Default paytable 7/5** (3.85%), not 9/6: the old table was a 4% edge and House Rules' 4–8% hold band leans on it. A 9/6 machine at 0.46% would drag the arcade's hold below the band. Levers `paytable` 9/6, 8/5, 7/5, 6/5; appeal rises with return.
- Skill: `actionCost` 0 (the draw is free); add `videopoker` to `skillPremium` (a stray picks a random other hold mask — that's expensive; check the premium at 2% isn't absurd, cap the error to the hold step only).
- Detail: dealt, held, final cards, hand name. Target $0.20 a play (one hand per play is fine at $5).

**Pachinko** (`pachinko`, a cabinet):
- Not casino maths: define a par sheet and document it in `ECONOMY.md` with why. Model: a play buys a cup of balls; each ball has p_start of entering the start pocket; each start spins a digital lottery with p_jackpot (e.g. 1/319 as on modern "max" machines, or a lighter 1/99 "sweet" spec) paying a fixed number of balls, with a chance of a "kakuhen" (probability-up) follow-on. Payback is set by p_start: a hall tunes the nails. Default payback 88% (the old figure; real halls run ~85–90% over a year on balls).
- Edge exact from the model's expectation (closed form or a small Markov chain for kakuhen), MC ≥ 2M to confirm.
- Levers: `spec` `'max' | 'middle' | 'sweet'` (jackpot odds and size: swing), `nails` `'tight' | 'standard' | 'loose'` (payback 85 / 88 / 91%).
- Target $0.60 a play.

**Evidence:** engine tests; **`career.test.ts -t "House Rules"` on grid is mandatory** (both games are in its arcade), plus **Lucky Strike** (it unlocks pachinko). House Rules' hold band is 4–8% over $12,000 a day: compute the arcade's blended hold with the new games before and after and say whether the band still holds; re-tune the default rules or the plan in `sim/__testkit__/career.ts` (`CAREER_PLANS`), never loosen the goal to pass. Minimal must still be 0/7.

## B9d. Bingo and big six

**Bingo** (`bingo`, `bingo-hall`, 12 seats):
- 75-ball bingo, 5×5 cards with a free centre, pattern "any line" (row, column or diagonal). A round calls balls until someone wins; ties split.
- Par sheet (document why): a hall pays a fixed share of card sales as prizes (parimutuel). With the pool at payback × sales, the edge is exact by construction: edge = 1 − payback. Default payback 86% (old figure; real US halls 70–80% of sales, so note it as generous). When the hall has fewer than N cards in play, a guaranteed minimum prize can make a round a loss for the house: implement it, and compute the edge per occupancy exactly (or MC) so `theoreticalEdge` is honest; simplest is no guarantee.
- Guests' cards: the seated guests' cards plus "house" cards for the off-screen crowd (a fixed number, documented), so the prize mechanics work at low occupancy.
- Levers: `payback` 0.75 / 0.80 / 0.86, `cardPrice` (limits), `pattern` `'line' | 'blackout'` (swing).
- Detail: called balls, the guest's card(s), winners.
- Target $0.56 a play. Lucky Strike unlocks bingo: run its focused career check.

**Big six** (`bigsix`, `big-six-wheel`, a wheel guests bet at):
- 54 segments: $1 ×24, $2 ×15, $5 ×7, $10 ×4, $20 ×2, joker ×1, logo ×1; pays 1, 2, 5, 10, 20 and 45 (joker/logo) to 1.
- Exact edge per bet over 54 segments (cite Wizard: $1 11.11%, $2 16.67%, $5 22.22%, $10 18.52%, $20 22.22%, joker/logo 14.81% at 45:1). Guest mix weighted like sic bo's; `theoreticalEdge` is the mix.
- Levers: `jokerPays` 40/45, `segments` `'standard' | 'atlantic-city'` (one documented alternative layout).
- Detail: landed segment index and symbol.
- Target $1.00 a play.

**Whole-of-B9 evidence** (write it under B9d in 7-tycoon-2.md): in the browser, Sandbox, three of each of two new games (e.g. three-card poker and keno), dealers hired, 4× speed for one game day; the Finances tab's "By game" hold and theo for each, written into the task. Then retire anything left in `balance.ts` that only the old tables used (`PayoutOutcome`, `rollPayout` if nothing else calls it — check with `find_references`).

## B11. Staff with depth

Read first: `src/sim/entities/staff/Staff.ts`, the staff parts of `src/sim/world.ts` (hire, wages, dealer assignment, `dealerSpeedFor`), the Staff tab in `ui/SidePanel.ts` (`renderStaff`), `ui/panels/GuestsPanel.ts`, `data/traffic.ts` (`hourFactor`, the B3 curve), and how `Guest.ts` / `sim/agents/utility.ts` pick archetypes. Track A owns the dealer `anim`/spot slice of `Staff.ts`; don't touch those lines.

Spec, in build order (one commit each is fine, one tick at the end):
1. **Skill (0–100) and training.** New hires start at 30–50 (seeded). Effects: dealer → `dealerSpeedFor` (0.8× at 0 to 1.15× at 100) and an error rate (a mis-pay costs the house: a small per-round chance of paying a loser, logged); mechanic → repair time; janitor → cleaning radius. `train` command: costs money (e.g. $200 per 10 points) and takes the staff member off the floor for N game hours. Saved.
2. **Morale (0–100) and fatigue.** Fatigue rises per on-shift hour, resets on a break or off-shift. Morale moves with wage vs. a market wage (a per-kind wage lever), long shifts, being understaffed (too many tables per dealer), and rest (use an existing service if one fits; the `lounge-seating` rest service is B6's, so leave a named hook: "staff rest at any service with `restsStaff: true`"). Low morale (< 30) slows work (×0.8) and raises a daily quit chance. All seeded.
3. **Shifts tied to the B3 curve.** Three shifts (day, swing, graveyard); each staff member has one. Off-shift staff don't work or draw full wage (or draw nothing; choose and document). The Staff panel shows on/off per person and lets the player set each person's shift; it shows the day's traffic curve beside the roster with on-shift counts per hour, so understaffing is visible. Default roster assignment spreads new hires to the busiest uncovered shift.
4. **Advantage players and cheaters.** A guest flag `advantage: 'counter' | 'pastPoster' | 'slotCheat' | null` with a small seeded share of arrivals (1–2%; keep it per scenario-safe: 0 in the tutorial). A counter at blackjack plays at a negative house edge (−0.5 to −1%; implement as a negative skill premium on that guest's rounds); a past-poster at roulette/craps/sic bo gets an occasional illegal win; a slot cheat drains a cabinet. Pit bosses (new staff kind if none fits; else security) detect within a radius with a chance per hour scaled by skill; detection flags the guest **suspicious**; the player removes them from the Guests tab (or security does automatically above a skill threshold). Undetected, they cost hold, visible in the "By game" table.
   - Guests tab: a "Suspicious" filter and badge, the evidence (game, net won, rounds), and a "Remove" action (a `contract:` command appended).
5. **Pick up and drop** staff (move a staff member to another post): do it only if the build tool already supports picking agents; otherwise skip and say so in the task.

Contracts: new `Command`s (`train`, `setShift`, `setWage`, `removeGuest`) and new optional view fields (skill, morale, fatigue, shift, onShift, suspicious) appended in `contract:` commits. List every new `world.ts` hook in the PR.

**Evidence:** unit tests for skill effects, fatigue/morale curves, shift on/off by hour, detection probability, quit chance; a sim test: an unstaffed pit with counters loses hold vs. theo, a staffed pit with a pit boss doesn't (same seed, grid, one game day); focused career runs for the scenarios with the largest staff (The Strip, Clean Slate) on grid, plus P16 `campaigns.test.ts` (wages move every campaign); re-tune wages/defaults on purpose with before → after. Browser: the Staff panel with the roster and curve (one screenshot), a suspicious guest in the Guests tab (one screenshot).

## B10. Marketing and events the player runs

Read first: `data/traffic.ts` and `maybeSpawn`/`arrivalChance` in `world.ts` (B3), the B4 charts (`ui/panels/FinanceChart.ts`, the day report `DayReportCard.ts`), `CampaignDef` in `data/campaigns/index.ts`.

Spec:
1. **Event defs in data**, `src/data/events.ts`: `{ id, name, kind: 'ad'|'tournament'|'junket'|'show', cost, durationDays|durationHours, cooldownDays, effect, requiresObject?: defId }`. Effects are arrival multipliers by archetype and hour, or a fixed arriving group.
2. **Ads:** billboards (tourists ×1.3), mailers (high rollers ×1.5), radio (regulars ×1.2), each for 3 days, with a cooldown. They multiply `arrivalChance` by archetype inside the existing path; never spawn outside it. The guest cap still applies.
3. **Slot tournament:** an evening (e.g. 19:00–23:00): slot-loving arrivals ×2 and slot play preferred for those guests; an entry fee pool; needs ≥ 6 slots.
4. **Junket:** a fixed group of N high rollers arrives at a set hour for one day, at a cost (flight + comps), with larger wallets; they leave at the end.
5. **Concert (hook only):** one more def with `requiresObject: 'stage'`; the panel shows it disabled with "Needs a stage". Write the hook under "Handing to B6" in 7-tycoon-2.md.
6. **Marketing panel** (`ui/panels/MarketingPanel.ts`, a tab or HUD button): each event with cost, duration, cooldown and the expected effect ("+30% tourists for 3 days, about +40 guests a day at your rating"), computed by the sim from the current curve, and a Run button. Active events are marked on the B4 charts and listed in the day report with their real effect (arrivals vs. the same hours without it).
7. **Availability:** `CampaignDef.marketing?: string[]` (event ids). Tutorial and the first career scenarios: none. Decide which later scenarios offer which; Sandbox offers all.
8. Cooldowns and prices keep it from being free money: an ad must not pay for itself at a floor that is already full (the cap binds); write a test for that.

Contracts: `runEvent` command, an optional events field on the snapshot.

**Evidence:** unit tests per effect; a sim test that an ad lifts arrivals for its days only and costs what it says; a test that campaigns without marketing are unchanged (their `marketing` is empty and the sim path is identical — compare one seed's day totals exactly); focused career runs for scenarios that now offer marketing (goals must still not be winnable by doing nothing); browser: run an ad, one screenshot of the panel and one of the chart with the lift.

## B14. Finish

1. `git fetch` and merge `origin/v2-playable` if it moved (Track A's PR #21 may be in). Resolve with the ownership table. If A6 is now in, set the catalog `game` field for the new engines and check each opens in A's play view.
2. Full suite once under `caffeinate -i` in the background; summary lines only. `npm run build`. Stress scene (`NAV_PERF=1`, `sim/agents/sandbox.stress.test.ts`), alternating with the pre-B9a commit if the load average is high.
3. The full campaign sweep once (grid and crowd, all of `src/data/campaigns`, `world.tier2`, `crowd`, `playshare`) with before (table above) → after.
4. Screenshots: each new game's rules editor (one composite pass), the Staff panel, the marketing panel, a suspicious-guest flag.
5. Update PR #22's description (checklist, evidence, every `contract:` commit and `world.ts` hook), mark it ready for review (`env -u GITHUB_TOKEN gh pr ready 22`), report, stop. Never merge.

## The prompt for the next session

```
You are the Track B part 2 session for Casino Tycoon v2, continuing draft PR #22 (branch v2-tycoon-2 → v2-playable). B9a is done (d6617e2).

Setup: make sure your worktree's branch is v2-tycoon-2 tracking origin/v2-tycoon-2 (git checkout -B v2-tycoon-2 origin/v2-tycoon-2 if needed). Create .claude/launch.json in the worktree root with {"version":"0.0.1","configurations":[{"name":"v2-tycoon-2","runtimeExecutable":"npm","runtimeArgs":["--prefix","v2","run","dev","--","--port","5177","--strictPort"],"port":5177}]}. Run cd v2 && npm install. Run gh as env -u GITHUB_TOKEN gh.

Read once at the start: v2/docs/handoffs/9-tycoon-2-rest.md (specs, recipe, test budget, baseline numbers: this is your plan), v2/docs/handoffs/7-tycoon-2.md (the checklist you tick), v2/docs/handoffs/NEXT-SESSION.md (shared rules, ownership table), and v2/src/sim/games/ECONOMY.md. Use sim/games/sicbo and sim/games/tcp as the engine templates.

Work through the tasks in order, one at a time, without stopping between them: B9b, B9c, B9d, B11, B10, B14. For each:
1. git fetch origin; if origin/v2-playable moved, merge it (never rebase) and resolve with the ownership table.
2. Read the code the task touches, then implement it to the spec in 9-tycoon-2-rest.md. New GameKinds and contracts.ts/games.ts changes go first, alone, in a commit whose message starts with "contract:".
3. Verify inside the test budget in 9-tycoon-2-rest.md: tsc, the new/changed test files, one focused campaign run on the grid for the scenarios the task touches (compare with the recorded baseline; re-tune plans or defaults on purpose, never loosen a goal), one short browser pass with one or two screenshots. Run anything long in the background and read only summary lines.
4. Tick the task in 7-tycoon-2.md with its evidence (before → after numbers), commit work and tick together with a message that explains why and ends with "Co-Authored-By: Claude <noreply@anthropic.com>", push v2-tycoon-2 only, update PR #22's checklist.
5. Go straight on to the next task.

B14 is the only place for the full suite, the build, the stress scene and the full grid+crowd campaign sweep. After B14, mark PR #22 ready for review, report, and stop.

Rules: never merge a PR; push only v2-tycoon-2; never start B6 (decor) and don't touch the stage, statue, fountain, lamp-post, lounge-seating or atm defs; never edit Track A's files (write requests under "Requests to Track A" in 7-tycoon-2.md); keep the sim deterministic; scenario goals stay winnable by a reasonable plan and unwinnable by doing nothing. Stop and ask me only for a decision only I can make (for example, a scenario goal that can't be re-tuned without changing what the scenario is about).
```
