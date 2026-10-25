# Track B: Tycoon. Give the player hours of decisions worth making

Branch `v2-tycoon`, dev port 5176, launch config `v2-tycoon`. The shared rules are in [NEXT-SESSION.md](NEXT-SESSION.md); read them first, every iteration.

## Why this track exists

A player who sits down with v2 today runs out of game in about an hour:
- **Campaigns:** three of them, all on the same 40×30 lot, all with the same goal of $1,000 a day. Nothing carries over between them.
- **Sandbox:** natural arrivals are capped at 30 guests, so a 96×64 floor feels empty.
- **Hidden depth:** the sim has comps, a players club, reputation, daily modifiers, a nine-term rating breakdown and food prices. Almost none of it can be seen or used from the UI.

The user wants a real tycoon: read the floor, react, and grow.

**Goal.** A new player can:
- learn the game in a tutorial
- play a campaign of 8–12 scenarios with rising, varied goals and medals that unlock content
- understand why guests are happy or leaving
- act on that with prices, comps, decor, staff and marketing
- see the results in charts

**Non-goals:**
- art, animation, sound and lighting (Track A)
- multiple floors, a hotel, a sports book (later)
- cloud saves

**Anti-goals:**
- breaking the campaign economy without re-tuning it
- panels that show numbers the player can't act on
- goals that can be won by doing nothing, or that can't be won at all
- a UI that hides the casino behind windows

## What exists today (audit, 2026-10-24; paths under `v2/src/`)

- **Time:** a day lasts 2 minutes at 1× (50 ticks per in-game hour at 10 Hz, `config.ts:13`).
- **Campaigns** (`data/campaigns/index.ts:34-95`):

  | Campaign | Start | Goal | Deadline | Note |
  |---|---|---|---|---|
  | Dusty Dime | $4k | $1k/day averaged over 4 days | day 12 | |
  | Neon Nights | $3.5k | $1k/day over 3 days | day 11 | |
  | High Roller Club | $5k | $1k/day over 3 days | day 10 | tables only |

  - Sandbox is at `:102-114`.
  - Win and lose are in `sim/scenario/ScenarioManager.ts:63-111`; the end card is in `ui/Menus.ts:134-157`.
  - There is no progression. `data/score.ts` is imported only by its test.
- **Guest cap:** `maxGuests: 30` (`data/balance.ts:31`, checked at `sim/world.ts:820`). `spawnChance` has no hour term (`world.ts:108-120, 819-827`).
- **Catalog:** 15 games, 4 services and 3 decor items (`data/objects.ts:35-317`).
  - Only 7 games run the real engines (`sim/games/index.ts:26-34`). The other 8 still use `{p, multiplier}` tables, which SPEC §6 bans: sic bo, three-card poker, pai gow, keno, video poker, pachinko, bingo, big six.
  - The avatar can't play those 8 ("no player seat yet", `main.ts:97`).
  - The "VIP Cage" is a cash-advance cashier (`balance.ts:472-476`).
  - Decor: the plant does nothing, the neon sign gives +2 rating and the marquee +4, with signage capped at +10 in total (`balance.ts:58`, `world.ts:677-681`).
  - Floor types only change the price.
- **Palette:** one flat 22-button text list (`ui/Hud.ts:25-33`). It shows items the scenario forbids.
- **Thoughts** exist (`data/thoughts.ts:84-163`), but the inspector shows only the latest one (`worker/inspect.ts:118`, `ui/SidePanel.ts:128`).
- **Rating:** the nine-term breakdown (`world.ts:671-716`) never reaches the UI. Reputation is sim-only (`balance.ts:716-733`, `world.ts:536`).
- **Players club:** Silver, Gold and Black patrons return on later days (`balance.ts:869-900`, `world.ts:582-590`). They show only as toasts.
- **Comps:** `sendComp` exists (`world.ts:1440`), but there is no command for it.
- **Prices:** food prices can be set in the sim (`sim/entities/FoodStall.ts:28`), but there is no command or UI. Bar drinks are fixed at $12 (`balance.ts:526`).
- **Daily modifiers:** five random ones (`balance.ts:672-711`), each shown as one toast (`sim/modifiers.ts:59`).
- **Staff:**
  - 6 hireable roles (`ui/SidePanel.ts:16-23`). Waitress and pit boss exist but can't be hired (`sim/entities/staff/Staff.ts:24-25`).
  - Wages are flat $2–4 an hour (`balance.ts:455-466`). There is no training, morale or shifts.
  - Security only escorts drunk or angry guests (`Staff.ts:230-245`).
  - Breakdowns and mechanics work.
  - Staff pick-up exists in the sim (`world.ts:960-967`) but has no UI.
- **Money:** an overdraft at 5% a day with a credit limit and forced sales (`balance.ts:563-570`, `world.ts:538-548, 786`). There are no loans.
- **Finances panel:** tables only (`ui/SidePanel.ts:252-279`), though `ledger.history` exists (`sim/economy.ts:165`).
- **Notifications:** a single toast, overwritten by the next one in the same batch (`ui/Hud.ts:70-81`).
- **Missing basics:** Space to pause, and the Menu button doesn't pause (`main.ts:60`). No tutorial, keyboard help, undo or settings. Settings belong to Track A.
- **Unused fields:** `MoodField` and `TrafficField` exist in the sim but are never shown.
- **v1 references** (read for ideas only, never import; paths under `../src/`):
  - `ui/Ticker.ts`, `ui/ConditionsBanner.ts`
  - `services/progress.ts`, `ui/endCard.ts`
  - `ui/panels/FinancePanel.ts`, `DailyReportPanel.ts`, `FoodStallPanel.ts`, `GuestsPanel.ts`, `PatronsPanel.ts`, `RatingPanel.ts`, `ThoughtsPanel.ts`, `OverlayPanel.ts`

## Design decisions already made (don't relitigate)

- **Every new sim action is a `Command`,** appended to `contracts.ts` in a `contract:` commit and dispatched in `worker/commands.ts`. The UI never reads sim state directly.
- **New panels live in `src/ui/panels/`** and follow `SidePanel`'s vanilla DOM style. Charts are drawn on `<canvas>` with no chart library.
- **Campaign economics are pinned by tests.** Any change to arrivals, prices, needs or caps must keep `src/data/campaigns` and `src/sim/world.tier2.test.ts` green. Re-tune goals where needed, and record before → after numbers in the commit.
  - The suggested way to keep old goals valid: let each scenario fix its own traffic settings, so caps and curves apply to Sandbox and new scenarios without silently moving the old campaigns.
- **Progress is stored per player in `localStorage`** under a versioned key (`casino-v2-progress`), wrapped in try/catch. Missing or corrupt progress means "fresh player", never a crash.
- **The six decor ids in NEXT-SESSION.md are fixed** (ids and footprints). Give them `'proc:box'` placeholders until Track A's art merges.
- **You own the guest brain and the machines** (`Guest.ts`, `utility.ts`, `entities/machines/**`, `entities/staff/**`) and the arrival, rating and signage logic in `world.ts`. Track A has small named slices in some of these files (see the ownership table); leave those lines alone.

## Tasks (one per iteration, in order)

Each task lists what to build, then how to prove it. Tick it (✅) in this file with the evidence.

- [x] ✅ **B0. Setup.**
  - Get onto branch `v2-tycoon`, cut from `origin/v2-playable`, in your own worktree. If this session already runs in one on that branch, keep it; otherwise use the EnterWorktree tool or `git worktree add`.
  - Run `npm install` in `v2/` and create `.claude/launch.json` with `v2-tycoon` on port 5176.
  - Confirm the dev server renders.
  - Push the branch and open the draft PR into `v2-playable` with this checklist.
  - **Done 2026-10-24:** the session's app worktree (`.claude/worktrees/v2-tycoon-99386f`) was cut at 7bf4122 = `origin/v2-playable`; its branch was renamed to `v2-tycoon`. `npm install` ran clean, `.claude/launch.json` has `v2-tycoon` on 5176 (strictPort), and `npx tsc --noEmit` is clean. In the built-in browser at 1280×800 the title menu lists the three campaigns plus Sandbox, and The Dusty Dime opens on its 3D lot (HUD $4,000 · Day 1 · ★48, 52 draw calls, no console errors). Draft PR opened into `v2-playable`.

- [x] ✅ **B1. Quality-of-life basics.**
  - Space pauses and resumes; the in-game Menu pauses.
  - A queued news ticker (RCT style) with:
    - severity colours
    - a history list
    - click-to-locate, which moves the god camera to the object or guest
  - A conditions banner that keeps today's modifiers on screen.
  - A `?` keyboard-help overlay.
  - An empty `<div id="hud-slot-a">` at the right-hand end of the HUD bar. Track A mounts its Settings gear there; keep it through every later HUD change.
  - Fix the Staff panel hire count not refreshing while paused, and the HUD overlapping the Floor button at about 800 px wide.
  - **Evidence:**
    - unit tests for ticker queueing
    - browser checks: pause by key, several events in one batch all appearing in the ticker history, click-to-locate moving the camera, help overlay opening
  - **Done 2026-10-25** (contract 42b5b5e: optional x/z/objectId/agentId on `ticker`, optional `HudView.modifiers`):
    - **Built:** `ui/panels/newsQueue.ts` (alerts jump queued chatter, per-severity dwell 4/6/8 s that shortens to ≥1.5 s under a backlog, identical lines about the same subject fold to "×N", 100-line history), `Ticker.ts` (line above the palette, News drawer with day/hour stamps and an unread badge), `locate.ts` (god camera to the spot at 16 m; a guest is found at their live position in the latest snapshot; opens the inspector), `ConditionsBanner.ts`, `HelpOverlay.ts`. Ticker emitters now name their subject (breakdown, repair, patron arrival/carded/promoted/neglected, rage-quit); `worker/snapshot.ts` `tickerEvent()` turns that into a place. The HUD is one wrapping row (bar · menu · speeds · `?` · `#hud-slot-a`, last) with the conditions under it; it publishes `--hud-bottom`, and the toolbar, drawer and toast hang off that. Menu opens a pause card (Resume / Save / Load / Main menu, which autosaves first); Space and Esc resume from it.
    - **Hire count:** didn't reproduce as stated (paused, scripted and real clicks both updated). The real fault was the Staff tab rebuilding its whole body every 1 s poll, which swaps the Hire button out from under a press that straddles a poll; it now builds once and patches counts and state cells (buttons and rows verified to survive polls).
    - **Tests:** `newsQueue.test.ts` 9/9 (batch order, alert priority, dwell, backlog floor, folding, subject separation, history cap, place kept, clear); `snapshot.test.ts` +2 (HUD modifiers; ticker placed on a rotated table's footprint centre and on a guest's pose, unplaced when the subject is gone). Affected suites 48/48; `tsc` clean. Campaign suites (`src/data/campaigns`, `world.tier2`, `crowd`) 56/56: no economics changed (events gained fields only).
    - **Browser (1280×800, The Dusty Dime):** Menu → pause card at speed 0, Esc → speed 1. Clicking 2× then Space → 0 with ❚❚ lit and a Paused badge, Space → back to 2× (a first try found Chrome reports a mouse-focused button `:focus-visible` once a key is down, so Space re-pressed 2×; Space now always blurs the button). Three hires sent together arrived as one snapshot of 3 ticker events and a fast-forward as one of 15; all are in the News drawer. Clicking "A machine has broken down!" moved the camera from (20, 15) at 32 m to (31.5, 8.5) at 16 m, the centre of the broken slot, and opened it (Broken, reliability 0%). Clicking "Harriet Farrow (Silver) is back" went to her live position (28.4, 14.9), not where she arrived (39.5, 15.5), and opened her. `?` opens the controls card and Esc closes it. Paused, two real Hire clicks on Janitor gave × 2 and Roster (2). At 800×600 nothing overlaps: the speeds wrap to a second row, `--hud-bottom` becomes 97 px, and the toolbar starts at 107 px (Floor 116–153), where before the bar covered it (bar 56–98, Floor 79–116).

- [x] ✅ **B2. Surface the hidden sim.** New commands and panels:
  - a rating breakdown with all nine terms and what to do about each
  - reputation on the HUD
  - a patrons / players-club roster with tiers and visit history
  - comps: a `sendComp` command, with buttons in the guest inspector and the roster
  - food-stall and bar prices: a `setPrice` command and a price panel. The bar becomes priceable, and demand responds to price.
  - hiring waitresses and pit bosses, if the sim supports them end to end (verify; finish them if not)
  - **Evidence:** command tests, and browser checks that each panel shows live values and that each action changes the sim (a comp raises a patron's happiness; a price change moves F&B revenue over a day).
  - **Done 2026-10-25** (contract 05b0508: read-only `rating`, `patrons`, `prices` commands; `sendComp`, `setPrice`; optional `HudView.reputation`):
    - **Built:**
      - Sim: `PRICE_BALANCE` and `priceAppeal(index) = clamp(exp(−0.9 × (index − 1)), 0.05, 1.25)`, exactly 1 at default prices. Appeal scales how hard hunger and thirst pull a guest to a stall or bar (`utility.ts`), and how thirsty a seated guest gets before flagging a waitress (`Guest.ts`). The bar has its own price ($4–36, saved; older saves load at $12); a drink past 2× default is a rip-off (−6 happiness, a thought). `findBar`/`findFoodStall` pick the cheapest counter; ties keep placement order, so rng use is unchanged on an untouched floor. `world.setPrice`/`serviceAppeal`. Patrons remember their last 4 visits (day, theo, comps), saved as flat triples.
      - Worker: `ratingReport` (nine terms with their ranges, the counts behind them, reputation and today's drift), `patronList` (tier, next tier, recent visits, wants-host/neglected, due today, on the floor with comp headroom), `priceList` (per item: price, default, cost, band, rip-off line; per object: today's take and stock cost, pull %). The guest inspector carries patron tier and comp eligibility/headroom. `sendComp` refuses in the player's words (not played enough, budget spent, left).
      - UI: the HUD's ★ is a button showing rating · reputation word and value, opening the Rating tab (each term with a bar and what to do about it). Club tab (`C`): cards sorted on-floor → due today → lifetime theo, with tier progress, recent visits, host warnings, comp buttons and Find ⌖. Prices tab, plus the same editor inside a stall's or bar's inspector: inputs per item, margin, rip-off flag, pull %, and a note when a price is held to its band. Guest inspector: club card and comp buttons (costs, disabled with the reason). Staff tab hires waitresses and pit bosses. Everything with a button is built once and patched by the 1 s poll.
      - **Bar stock-cost fix:** `brewDrink` booked the $4 drink cost every brew even at a full bar (stock capped at 6), so any staffed bar showed ~$260–320 a day in stock costs against a handful of drinks — bar prices could never matter. A full bar now pours and costs nothing.
    - **Waitress and pit boss** already worked end to end in the sim; they only lacked Hire buttons. Proved on the crowd: a hired waitress carries a drink to a seated guest and the bar books the player's $15 price; a hired pit boss walks off the entrance and lifts the security term.
    - **Tests:** `world.b2.test.ts` 12/12 (appeal curve and untouched-floor identity; `setPrice` clamps and refusals; till price, rip-off flag and save round-trip; cheaper of two bars wins; on the crowd, 2.5× prices sell under 75% of the drinks and meals of default prices over 1,200 ticks; `sendComp` refusal then landing with happiness up and cash down; nine rating terms summing to the total within their ranges; roster with tier, 4 recent visits, save round-trip and old-save load; HUD reputation; waitress; pit boss). `world.bar.test.ts` +1 (full bar charges nothing). `patrons.test.ts` worst-case roster ceiling raised 25 → 32 KB for visit history (measured 30.5 KB). Affected suites (B2, bar, patrons, comps, worker, ui, entities, foodstall) green; `tsc` clean.
    - **Economics guard:** `src/data/campaigns`, `world.tier2`, `crowd` 56/56. The greedy probe is identical before and after the brew fix (the bot never staffs a bar): Dusty Dime 7/7, Neon Nights 5/7, High Roller Club 5/7, with the same per-seed best days. Default prices give appeal exactly 1, so nothing else moves.
    - **Price → demand on the crowd** (furnished nav floor, 60 guests, bartender; the bar's ledger for the 12 hours after midnight, seeds 11/12/13): $12 sold 9/3/10 drinks ($108/$36/$120); $18 sold 11/4/9 ($198/$72/$162); $30 sold 0/0/1 ($0/$0/$30). Food at 2.5× took $27/$3/$6 against $19.50/$12/$12 at default. So a modest rise pays and a steep one empties the counter, as designed (margin × appeal peaks near $17).
    - **Browser (1280×800, a day-13 Sandbox save with 21 games, a bar and a stall; driven through the UI):**
      - The HUD reads "★ 72 · Unremarkable 56"; clicking it opens Rating with all nine terms, live (happiness +33, games +25 "21 games: this term is full", variety +10, cleanliness 0 "35 messes on the floor, −3 each. Hire janitors.").
      - Club lists Cliff Farrow (Silver, tourist, on the floor, $61 of $400 to Gold). Clicking Drink: happiness 60.2 → 62.5, thirst 61 → 100, comped $0 → $4 (budget $64 → $60), toast "Comp sent: a drink."
      - Prices: drink 12 → 18 gave margin $14 and 64% pull; 50 was held to $36 with the note "held to $36.00 (allowed $4.00–$36.00)", a rip-off flag and 17% pull. The same editor in the bar's inspector set $20 at 4× speed (margin $16, 55%).
      - Guest inspector (Tony Ainsworth): Meal comp took hunger 58 → 100 and the budget $53 → $39.
      - Staff tab while paused: Waitress and Pit boss hired (×0 → ×1 each); the security term went 1.5 → 3.0.
      - After the brew fix, a full, idle bar's stock cost stayed at $56 from 06:00 to 14:00 (the old code added about $13 an hour). No console errors.
      - A live A/B of drink sales per hour on this save was too sparse to read (about 0.1–0.4 drinks an hour among 70 guests, since thirst rarely crosses the threshold in one visit), so the demand effect is shown by the crowd probe above.

- [ ] **B3. Traffic with a daily rhythm, and a cap that grows with the casino.**
  - Arrivals follow an hour-of-day curve: a quiet morning, an evening peak, a 4 a.m. lull, plus a weekend lift.
  - The guest cap scales with capacity (seats, services) and rating, up to 500.
  - Old campaigns keep their tuned behaviour, or are re-tuned on purpose.
  - **Evidence:**
    - unit tests for the curve and the cap
    - campaign suites green, with numbers recorded
    - in the browser, a Sandbox floor built for about 300 guests reaching about 300 at the evening peak
    - the stress scene tick still ≤ 7 ms

- [ ] **B4. Finance depth.**
  - Charts from `ledger.history`: revenue, win, hold %, guests and cash by hour and by day.
  - An end-of-day report card: P&L, best and worst game, rating change, notable events.
  - Structured loans: take, repay and interest, alongside the overdraft.
  - **Evidence:** loan maths unit tests, and browser screenshots of the charts and the report after two days.

- [ ] **B5. The feedback loop.**
  - A thoughts summary panel: the top thoughts across guests, with counts and a trend.
  - Mood and traffic heat-map overlays built from `MoodField`/`TrafficField`, drawn by a new `src/render/HeatOverlay.ts` you own, added to `stage.scene` from `main.ts`.
  - A guests list panel with sorting and follow/locate.
  - **Evidence:** browser screenshots of each, with a heat map that visibly changes after you move a game.

- [ ] **B6. Decor and amenities with real effects.**
  - An appeal-radius system: decor raises nearby guests' happiness and nearby games' appeal, with diminishing returns.
  - Floor types gain prestige.
  - The six pre-agreed items, using `'proc:box'` placeholders until Track A's art merges:
    - `statue` and `fountain`: appeal
    - `lamp-post`: small appeal
    - `lounge-seating`: a rest service that restores energy
    - `atm`: cash access with fee revenue
    - `stage`: hosts events in B10
  - Replace or extend the signage cap so beautifying is a real layout puzzle.
  - **Evidence:**
    - unit tests for the radius and falloff
    - a sim test showing a decorated floor beats a bare one on happiness and dwell time
    - campaign suites green and re-tuned if needed

  - **Found in B2, fix here with the re-tune:** a food item is a rip-off above 3× its *cost* (`FOOD_BALANCE.ripoffMultiplier`), which the default soda ($2.50 on $0.50) and fries ($3.50 on $1) already exceed, so every untouched stall costs those buyers 6 happiness. The bar uses 2× its default price (`PRICE_BALANCE.ripoffIndex`). Switching food to the bar's rule moved the greedy campaign probe a lot (Neon Nights 5/7 → 2/7 wins, below MIN_WINS 4), so it was left as is in B2; the Prices panel shows the current line truthfully.

- [ ] **B7. A palette you can browse.**
  - Category tabs: Slots, Tables, Services, Decor.
  - Items the scenario forbids are hidden or greyed, with the reason.
  - Locked items show how to unlock them (after B8).
  - Price and upkeep appear on hover.
  - A hint about Shift for placing several.
  - Thumbnails are optional; if you want them, request `Stage.renderThumbnail(defId)` from Track A.
  - **Evidence:** browser screenshots, and a forbidden item that can't be picked.

- [ ] **B8. Progression and a real campaign.**
  - 8–12 scenarios with rising, varied goals, for example:
    - reach a rating
    - hold N guests at once
    - hit a hold % within a band
    - sign N Gold patrons
    - build a high-limit room
    - make $X in one day
    - finish with no debt
  - Lots, starting layouts and restrictions vary between scenarios.
  - Medal tiers (bronze, silver, gold) and a score from `data/score.ts` on the end card.
  - Unlocks gate objects and scenarios by completion; progress is saved under `casino-v2-progress`.
  - The title menu shows medals and locks.
  - Reach both the win card and the lose card in the browser. The win card was never reached in the browser during playable.
  - **Evidence:**
    - per scenario, an automated test that a reasonable furnished strategy wins it, and that doing nothing does not
    - progress storage tests
    - browser screenshots of the title with medals, and of a win card and a lose card reached by playing

- [ ] **B9. Real engines for the remaining eight games:** sic bo, three-card poker, pai gow, keno, video poker, pachinko, bingo, big six.
  - Each implements `GameEngine` (`shared/games.ts`) with no `{p, multiplier}` tables.
  - `theoreticalEdge` comes from exact enumeration where possible, or Monte Carlo with at least 2M rounds within ±0.15%. Cite the published edge in a test comment.
  - Pachinko and bingo aren't standard casino maths: define a defensible par sheet for each and document it in `src/sim/games/ECONOMY.md`.
  - Register them in `sim/games/index.ts`, add seats in `catalog.ts`, and give each rule levers in the rules editor.
  - Each round result carries the data Track A's effects need: big six's landed segment index, the dealt cards for three-card poker and pai gow, and the dice for sic bo, in the same shape the existing engines' results use.
  - Keep Track A's one round-recording call in `EngineGame`/`enginePlay` when you touch those files (see the ownership table).
  - Avatar play for these comes from Track A's generic play view (A6). If A6 isn't merged yet, leave the `main.ts:97` gate alone and note it in "Requests to Track A".
  - **Evidence:** edge tests per game, campaign suites green, and hold ≈ theo over a 4× day in the browser for at least two of the new games.

- [ ] **B10. Marketing and events the player runs.**
  - Ad campaigns that cost money and lift arrivals by archetype for a few days.
  - Slot tournaments, a concert on a `stage`, and high-roller junkets.
  - Each is scheduled from a panel, with its cost, duration and expected effect shown, and its real effect visible in B4's charts.
  - **Evidence:** unit tests for the effects, and a browser check that a campaign visibly lifts arrivals in the charts.

- [ ] **B11. Staff with depth.**
  - Skill and training, morale and fatigue, and shifts tied to the B3 traffic curve.
  - Advantage players and cheaters, such as blackjack counters and past-posting: pit bosses and security detect and remove them, and leaving them alone costs hold.
  - Pick-up and drop for staff, if cheap.
  - **Evidence:** unit tests, a sim test where an unstaffed pit loses hold to counters and a staffed pit doesn't, and campaign suites green.

- [ ] **B12. Onboarding.**
  - A tutorial scenario ("Opening Night") with step objectives and UI pointers: paint a zone, place a slot, hire a dealer, open a table, set a price, read the rating.
  - First-time tooltips.
  - A clean first-run title screen.
  - **Evidence:** a browser playthrough of the whole tutorial, with screenshots of each step.

- [ ] **B13. Finish.**
  1. Merge `origin/v2-playable` if it moved.
  2. Run the full suite under `caffeinate -i` and `npm run build`.
  3. Measure the stress scene.
  4. Take browser screenshots of the title and medals, a scenario's goal panel, the charts, the rating breakdown, the heat map and the tutorial.
  5. Push and update the PR description with the checklist and evidence; take the PR out of draft.
  6. Report to the user and stop the loop.

## Requests to Track A

(Write here anything you need from Track A's files. Commit it and mention it in your report.)
