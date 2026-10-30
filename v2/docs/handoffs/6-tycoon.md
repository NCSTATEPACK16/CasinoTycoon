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

- [x] ✅ **B3. Traffic with a daily rhythm, and a cap that grows with the casino.**
  - Arrivals follow an hour-of-day curve: a quiet morning, an evening peak, a 4 a.m. lull, plus a weekend lift.
  - The guest cap scales with capacity (seats, services) and rating, up to 500.
  - Old campaigns keep their tuned behaviour, or are re-tuned on purpose.
  - **Evidence:**
    - unit tests for the curve and the cap
    - campaign suites green, with numbers recorded
    - in the browser, a Sandbox floor built for about 300 guests reaching about 300 at the evening peak
    - the stress scene tick still ≤ 7 ms
  - **Done 2026-10-25** (contract 90bb497: optional `HudView.guestCap`):
    - **Built:** `data/traffic.ts` holds the profiles and the pure maths. `CampaignDef.traffic` is optional: omitted means `CAMPAIGN_TRAFFIC` (flat rate, fixed cap 30), so the three campaigns and every test world are untouched; `SANDBOX` opts into `OPEN_TRAFFIC` (daily curve, scaled cap), as new B8 scenarios should.
      - Curve: 24 hourly anchors eased linearly and normalised to a mean of exactly 1 (it moves arrivals around the clock without adding any). Lull 0.12× at 04:00, morning 0.45–0.75×, peak 2.05× at 21:00. Weekdays: day 1 is a Monday; Fri ×1.15, Sat ×1.3, Sun ×1.15.
      - Cap: `clamp(room × 1.1 × (0.6 + 0.8 × rating/100), 30, 500)`, where room is every seat at a game plus 4 per restroom, food stall, bar or cage. Cached for 10 ticks.
      - Arrivals: `world.arrivalChance()` = the campaign formula × spawn modifiers, then (daily only) × hour × weekday × cap/30 × `fill` 0.6, so a bigger floor draws proportionally more people.
      - Planned stays (daily only): each guest arrives planning 4–8 in-game hours (`Guest.leaveAtTick`). When it's up, a walker, queuer or wanderer heads home at once; a player finishes the current run of plays. Leaving early for the old reasons still applies.
      - HUD: the clock reads "Tue · Day 2 · 13:00" and the guest count "249 / 344 guests", with a tooltip on what raises the cap and when guests come.
    - **What tuning found:** walking is real time on a compressed clock (about 10 cells an in-game hour), so crossing the 96-cell Sandbox lot takes hours, and the population lags the arrival curve by a few hours. Without planned stays nobody left overnight (340 on the floor at 04:00), because energy takes about four days to run down. At 1.6 guests per seat, 230 of 340 guests were stuck walking in gridlocked aisles, so 1.1 per seat it is. The probe floor first walled off the lobby's double door; a Sandbox player has to keep door aprons clear the same way.
    - **Tests:** `data/traffic.test.ts` 8/8 (mean exactly 1, peak 19–22, lull at 04:00, continuity, weekdays, cap growth, 30/500 bounds, profiles). `world.traffic.test.ts` 8/8: every campaign gets flat arrivals at 04:00 and 21:00 equal to the old formula, cap 30, no planned stays; a world with no scenario is flat; in Sandbox the 21:00/04:00 ratio equals the curve and a Saturday is ×1.3; the cap and arrival chance grow when 120 slots and a restroom go down; stays fall in 4–8 h. On the crowd, a ~210-seat Sandbox floor (cap 299 at ★87) fills to ≥ 90% of its cap by 20–23:00 and is under 60% of that by 09–12:00 on day 2. Fill sweep on seeds 5/9/13 at fill 0.6: about 299 by 22:00 every day, 90–150 by late morning; 0.35–0.5 never filled, 0.7 sat at the cap 20:00–04:00.
    - **Economics guard:** campaigns, `world.tier2`, `sim/agents` (including both stress tests), `world.*`, `entities`, `worker`: 48 files, 450/450. Greedy probe identical before → after: Dusty Dime 7/7, Neon Nights 5/7, High Roller Club 5/7, same per-seed best days.
    - **Stress scene** (`sandbox.stress`, NAV_PERF=1, runs alternated on one machine): B2 tick mean 2.90/5.26/4.82 ms against B3 3.30/5.44/5.43 ms, within noise and under 7 ms. Repaths fell 5,922 → 3,841 and teleports 192 → 63, since guests now leave and are replaced instead of piling up.
    - **Browser (1280×800, new Sandbox):** 7 blackjack tables, 162 slots, 4 restrooms, 4 stalls, 2 bars, staff; cap 344 at ★95. At 4× from 14:00 on Monday: 7, 41, 80, 112, 188, 211, 263, then 311 at 22:00 and the 344 cap from 23:00 to 02:00. Then 319 at 04:00, 266 at 06:00 and 227 at 09:00, back up through 255 at 14:00, 318 at 18:00 and the cap from 19:00 to 22:00 on Tuesday. The guests tooltip read "The floor holds 342 right now… Guests come by the clock…". No errors while running.

- [x] ✅ **B4. Finance depth.**
  - Charts from `ledger.history`: revenue, win, hold %, guests and cash by hour and by day.
  - An end-of-day report card: P&L, best and worst game, rating change, notable events.
  - Structured loans: take, repay and interest, alongside the overdraft.
  - **Evidence:** loan maths unit tests, and browser screenshots of the charts and the report after two days.
  - **Done 2026-10-25** (contract 487e196: `financeHistory`, `dayReport`, `loans`, `takeLoan`, `repayLoan`):
    - **Built:**
      - Sim: `sim/economy/loans.ts` (`LoanBook`, `installmentFor`). `LOANS` offers 7/14/28 days at 1.5/2/2.5% a day, against the overdraft's 5%; borrowing is in $250 steps. Installments are level, come out of cash at midnight interest first, and are charged before the overdraft interest so a payment that tips the house into the red pays for it. Early repayment from cash has no penalty and re-spreads the rest over the days left. Loan cash moves the balance, never the P&L, and only interest is booked (as interest, broken out as `loanInterest`). `CampaignDef.loanLimit`: the three campaigns can borrow half their starting stake ($2,000/$1,750/$2,500); open play defaults to $50,000. Saved; older saves load with no loans.
      - Books: `HourlySample` gains the games' win and closing cash. `DailyRecord` gains the rating, cash and debt at the close, `loanInterest` and `notes` (fines, overdraft interest, forced sales, loans taken and paid off; at most 12 a day). A forced sale at midnight goes in the report of the day that caused it.
      - Worker: `worker/finance.ts` with `financeHistory` (a week of hours and 60 days plus today so far: revenue, expenses, profit, handle, win, hold, guests, cash), `dayReport` (P&L, the day before's profit, best and worst game by net with hold, rating and its change, reputation, visits, jackpots, rage-quits, comps, overdraft and loan interest, cash, debt, conditions, top winners and losers, notes) and `loansView` (limit, owed, available, offers with installment and total interest, due tonight).
      - UI: the Finances tab is built once and patched. It holds the P&L, a Trends chart drawn on canvas with no library (Profit, Revenue and Win as green/red bars; Hold %, Guests and Cash as lines; by hour or by day; day labels; a hover readout), and Bank loans (terms, a live installment preview, Borrow, and each loan's owed, daily and days left, with Repay). The report card opens by itself at each midnight (it never pauses; "Show this at the end of every day" is a per-browser preference), and from "Last day's report" in Finances.
    - **Tests:** `loans.test.ts` 7/7 (the amortising payment against the closed form, $10k/10 d/2% = $1,113.27; zero rate; limit and terms; paid off in exactly its term with Σ principal = borrowed and Σ payments = n × installment; first-day interest; early repayment with re-spread and overpayment capped; JSON round-trip). `world.finance.test.ts` 6/6 (a loan moves cash and not the P&L, and at midnight cash falls by exactly the installment while only the interest is booked; runs to zero in its term; repay is capped by cash on hand; each campaign's limit, and the book survives a save; a midnight forced sale lands in the closed day's notes; commands for offers, borrowing and repaying; two days of history where the hours' win sums to the day's, cash on every hour, and the report's profit, previous profit, rating change and best ≥ worst).
    - **Economics guard:** 49 files, 474/474. Greedy probe identical: Dusty Dime 7/7, Neon Nights 5/7, High Roller Club 5/7 (the bot never borrows).
    - **Browser (1280×800, The Dusty Dime, driven through the UI):**
      - The Loans form offered $2,000; its preview read "$82.60 a day for 14 days: $156 in interest on $1,000", which is correct.
      - Borrowed $1,500 over 7 days: cash $4,000 → $5,500, "$227.33 due at midnight", today's P&L still $0, and the ticker said "Borrowed $1,500 over 7 days."
      - Day 1's card opened at midnight: win $170 − wages $72 − upkeep $180 − interest $23 (1.5% of $1,500) = −$105. It listed $1,295 owed, best game Slot Machine $190, worst Blackjack −$190, winners and losers, one jackpot, and the loan.
      - Day 2's card: $451 (+$555 on the day before), ★92 ▲1, reputation +4.8, conditions, interest $19, $1,087 owed.
      - Day 4's card: −$886, ★22 ▼16, a $400 health-inspection fine and $62 of interest, both listed in its notes.
      - The hourly Profit chart showed red midnight bars for upkeep and interest. Guests by hour showed the 30 cap filling on Monday, with the hover readout "Tue 2 · 14:00 — Guests 30". Guests by day rose 13 → 20 → 30, and Cash by hour showed the slide into overdraft by Thursday.
      - After an autosave reload the loan was still there.
      - With cash at −$770, Repay was refused with a message.
      - Found and fixed: the loans table was 458 px in a 438 px panel and scrolled the whole tab sideways. It now has its own scroller, a tighter row, and fits at 410 px.
      - No console errors.

### Ship cut (decided by the user, 2026-10-30)

v2 ships to Netlify after this cut. Do these next, in this order, then the finish task. Everything under "After ship" waits until the user says so.

- [x] ✅ **B5. The feedback loop.**
  - A thoughts summary panel: the top thoughts across guests, with counts and a trend.
  - Mood and traffic heat-map overlays built from `MoodField`/`TrafficField`, drawn by a new `src/render/HeatOverlay.ts` you own, added to `stage.scene` from `main.ts`.
  - A guests list panel with sorting and follow/locate.
  - **Evidence:** browser screenshots of each, with a heat map that visibly changes after you move a game.
  - **Done 2026-10-30** (contract 6cab386: `thoughts`, `guestList`, `heatMap`):
    - **Built:**
      - Worker (`worker/feedback.ts`): `thoughtSummary` covers thoughts held in the last 4 in-game hours, with guests per thought (distinct), a trend (newer half of the window minus the older half), sentiment, what to do (null where nothing can be done) and who. `guestList` gives every guest's mood, wallet, net, tier, the most pressing need under 40, latest thought, recent thought ids and hours on the floor (new `Guest.arrivedTick`). `heatMap` gives mood 0–100 per cell, or traffic scaled to the 90th percentile of visited tiles with a 10% cut-off (scaled to the busiest tile, the entrance outshone the floor and only the door corridor showed: 34 cells against 228 now), −1 where there is nothing to say.
      - Render (`render/HeatOverlay.ts`, Track B's own): one plane the size of the lot with a cols×rows DataTexture, linear-filtered, depth-tested without depth writes, just above the zone tint; one draw call at any lot size. Mood runs red → amber → green; traffic runs blue → yellow → red, and its alpha rises with the value. Added to `stage.scene` from `main.ts`.
      - UI:
        - The Guests tab (`G`): "What guests are thinking", thought rows with glyph, latest wording, count, a trend arrow (green when it's good news, grey for neutral thoughts) and advice. Clicking one filters the list to the guests who had it.
        - "On the floor": a sortable list (name, mood, wallet, won, hours here; sub-lines for archetype, activity, need and latest thought), a name search, up to 120 rows, rows keyed by id and patched in place, with Find ⌖ and Follow 👁.
        - The map control (Off · Mood M · Traffic T) sits above the news line with a legend and a live summary (average mood, busiest tile). It hides while the News drawer or table play is open.
        - Follow (`ui/panels/follow.ts`) keeps the god camera on a guest every frame and lets go on WASD, arrows, Esc, a click on the floor, or when the guest leaves. The inspector's Follow button, which was wired to nothing since playable, now uses it.
      - `THOUGHT_EMOJI` gains `drunk` 🥴 and `homeTime` 👋.
    - **Tests:** `world.feedback.test.ts` 3/3 (distinct-guest counts, trend from window halves, an old thought dropped, advice and agent ids; list rows with need, thought and hours, and gone guests omitted; on the crowd, heat maps blank before play, then mood ≤ 100 and traffic scaled with more than the entrance showing). `HeatOverlay.test.ts` 2/2 (ramps; the plane spans the lot and cell (c, r) lands in texture row rows − 1 − r, the rest transparent). Thought-glyph coverage, traffic, worker and UI suites green; `tsc` clean.
    - **Economics guard:** nothing that moves guests or money changed (an arrival tick and two glyphs). Still run: 18 files, 188/188; greedy probe identical (Dusty Dime 7/7, Neon Nights 5/7, High Roller Club 5/7).
    - **Browser (1280×800, a Sandbox with 7 blackjack tables, ~100 slots, staff, 70–120 guests):**
      - Traffic map (`T`): a hot lane from the lobby door into the nearest slot banks, cooling to blue toward the far ones.
      - Mood map (`M`): a yellow-green wash where guests have been, legend "average 71".
      - Guests tab (`G`): 9 thoughts ranked; "Good night. Time to head home." ▲36 in grey; "Not a bad little place." ▼9 in red; "I could really use a drink." 3 ▲3 with "Add a bar with a bartender, or hire waitresses…". Clicking it filtered the list to those 3 guests ("thirst 25").
      - Follow 👁 on Duke Delgado: "Following Duke Delgado…", and the camera focus stayed within 0.1 m of him over 6 s at 1×; `W` released it (the camera stayed at 77.6, 27.2 while he walked on to 81.0, 27.7).
      - Moving a game: I moved 14 slots from rows 33–34 by the door corridor to rows 24–25 in the north-west and ran the clock to 19:00. The old spot became an aisle and the hot corridor ran straight through it: 20 → 36 cells (summed intensity 8.4 → 12.9). The new spot stayed empty (0 → 0), since guests from the door play nearer games.
      - Fixed during the check: the guest list was 467 px in a 410 px area (Find and Follow off-screen), so the activity column was folded into the name line and it now fits exactly. No console errors.
    - **Found, not fixed (needs the user's call): on a big Sandbox floor almost nobody is at a game.** Walking is real time (about 1 m/s) on a 5-second hour, and a guest plays a short run at a machine before walking to the next. On a ~210-seat Sandbox floor with B3's rule, about 0.5% of guests are at a game at any moment (1 of ~200; the rest are walking or leaving). Starting the stay at the first seat lifts it to 8.8% but loses the nightly rhythm. On the 40×30 campaign lot it is about 36% (46–49% walking to a game). B3's evidence measured how full the floor was, not this. Fixing it means longer play runs per machine, faster walking, or a slower clock, and each moves the campaign economy, so it is left as found and reported.

- [x] ✅ **B7. A palette you can browse.**
  - Category tabs: Slots, Tables, Services, Decor.
  - Items the scenario forbids are hidden or greyed, with the reason.
  - Leave room for a lock badge and its unlock hint; B8, next, fills them in.
  - Price and upkeep appear on hover.
  - A hint about Shift for placing several.
  - Thumbnails are optional; if you want them, request `Stage.renderThumbnail(defId)` from Track A.
  - **Evidence:** browser screenshots, and a forbidden item that can't be picked.
  - **Done 2026-10-30:**
    - **Built:** `ui/panels/Palette.ts`, mounted by the HUD in place of the flat 22-button row.
      - Tabs: Slots (slot machines, penny slots, video poker, pachinko, keno, bingo), Tables (the nine table and wheel games), Services (restroom, food stall, bar, cage) and Decor. Each tab shows "usable/total"; a tab with nothing usable is dimmed, and a new game opens on the first tab with something to place.
      - Forbidden items stay visible but go last, dashed and dimmed, with "Not here" by the price. Clicking one selects nothing and the toast gives the reason.
      - The reason comes from a new optional `CampaignDef.restriction` (The High Roller Club: "Members play blackjack here: no slots, wheels or dice on this carpet."), falling back to "Not part of {scenario}".
      - B8's hook: `palette.setLock(defId, hint)` shows 🔒, blocks the pick and puts the hint in the card. `hud.palette` is exposed for it.
      - Hover card: price, upkeep per day, size, the zone it needs, seats and "needs a dealer" (or what a service does, or a decor item's rating bonus), and either the reason it's blocked or "Shift+click places a row · R rotates". The Shift hint also sits at the palette's right end.
      - It stays one row (tabs at the left), so the news line, tool hint and map control above it don't move.
    - **Tests:** `ui/panels/palette.test.ts` 2/2 (every catalogue item in exactly one tab, with the expected members, and every restricted campaign has a reason). UI and catalogue suites green; `tsc` clean. No sim or economics change (one data field), so the campaign suites aren't affected.
    - **Browser (1280×800):**
      - The High Roller Club: "Slots 0/6 · Tables 1/9 · Services 2/4 · Decor 1/3", opening on Tables with Blackjack first and the other eight greyed. Hovering Craps showed $900, $35/day, 2×2 m, a Gaming or High-limit zone, 6 seats and a dealer, and the club's reason. Clicking it left nothing selected and toasted the reason. Blackjack selected normally.
      - Sandbox: "Slots 6 · Tables 9 · Services 4 · Decor 3". Hovering Video Poker Bank showed $560, $18/day, 1×2 m, 2 seats, and the Shift/R hint.
      - Found and fixed: the badge on its own line pushed the palette 3 px into the news line; it now sits inline after the price (palette top 724 px against the news line's bottom at 716). No console errors.

- [ ] **B7a. Guests stay at a game.** (Added 2026-10-30 by the user's decision on B5's finding.) Guests play much longer runs at one machine, so a big floor isn't all walking.
  - Measure the share of guests actually playing, before and after, on the ~210-seat Sandbox floor (B3/B5's probe layout) and on the 40×30 campaign lot. Record both here and in the commit.
  - Keep B3's nightly traffic rhythm (`world.traffic.test.ts` stays green).
  - Re-tune the campaigns on purpose: campaign suites green, with before and after numbers.
  - A unit or sim test pins the new playing share so it can't silently regress.
  - Choose the target share and say why.

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
     List the "After ship" tasks in the PR description as post-ship work, not as missing.
  6. Report to the user and stop the loop.

### After ship (backlog: don't start these until the user says so)

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

## Requests to Track A

(Write here anything you need from Track A's files. Commit it and mention it in your report.)
