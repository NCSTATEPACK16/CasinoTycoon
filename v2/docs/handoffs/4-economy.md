# Handoff 4 — Economy & Casino Math

**Role:** Casino Mathematician and Economy Engineer. Replace every abstract payout roll with the real game, played to its real rules, and make the books something a casino CFO would trust.

Read `v2/docs/handoffs/_common.md` and `v2/docs/SPEC.md` (§6) first.

## You own
`v2/src/sim/games/**` (new), `v2/src/sim/economy/**` (new), `v2/src/sim/entities/machines/**`, `v2/src/sim/economy.ts`, `v2/src/data/balance.ts`, `v2/src/data/campaigns/**`, `v2/src/sim/scenario/**`, `v2/src/sim/tableTuning.ts`. In `v2/src/worker/commands.ts` you own the `setRules`, `roundBegin` and `roundAct` cases; flag those `contract:`.

## Starting point
- `shared/games.ts` defines `GameEngine` / `Round` / `RoundResult` / `RngLike`.
- In the forked v1 sim, `entities/machines/CasinoGame.ts` exposes `rollPayout(rng, PayoutOutcome[])` over `{p, multiplier}` tables in `data/balance.ts`. That is what you replace for slots (`slot-machine`, `penny-slots`), `roulette-table`, `blackjack-table`/`high-limit-table`, `craps-table` and `poker-table` (which becomes Ultimate Texas Hold'em).
- Other v1 games (sic bo, pai gow, keno, bingo, pachinko, big six, video poker, three-card poker) can keep their tables for now. Note them as follow-ups, but if time permits give sic bo, big six and video poker (9/6 Jacks or Better) real math too.

## Build
1. **Engines** (`sim/games/<game>/`), each pure and seeded, implementing `GameEngine`, with `defaultRules`, `theoreticalEdge`, `roundsPerHour`, `begin`, `strategy` and `appeal`:
   - **Slots**: a par sheet type (reels → weighted strips, paytable with wild/scatter, lines). Write 4+ bundled par sheets at RTP 88/92/95/97% and low/med/high volatility. Exact RTP, hit frequency and SD come from full enumeration (cached), and a test asserts the par sheet's declared RTP equals the computed one to 1e-9.
   - **Roulette**: wheels 0 / 00 (+ La Partage). Every inside/outside bet with exact edges by enumeration.
   - **Blackjack**:
     - Shoe with cut-card penetration. Rules: decks, H17/S17, BJ payout 3:2 or 6:5, DAS, RSA, surrender, max splits.
     - Generate the basic strategy (total-dependent is fine) for any rule set, by a combinatorial dealer-outcome calculator or by loading published charts per rule family.
     - `theoreticalEdge` uses a rule-adjustment table (document the source values).
     - Tests: MC of 2M hands with perfect basic strategy lands within ±0.15% of the table for 3 rule sets, and 6:5 costs about 1.39%.
   - **Craps**: the full shooter state machine (come-out/point). Pass, Don't Pass with the bar on 12, Come/Don't Come, odds at 3-4-5x and 10x (true-odds payouts), place 4–10, field (2:1 or 3:1 on 12 option), hardways, any 7. Exact edges by Markov/enumeration, with a test that Pass = 7/495 and Don't Pass = 3/220.
   - **UTH**:
     - A fast 7-card evaluator with a test against known hand counts over all 133,784,560 seven-card hands, or a verified sample if that's too slow, documented.
     - Ante/Blind/Play/Trips, dealer qualification, and Blind and Trips paytables.
     - The reference strategy is the standard decision table (preflop 4x list, flop 2x on two pair+/hidden pair/four to a flush with a hidden 10+, river 1x on hidden pair or < 21 dealer outs).
     - Tests: MC of 2M hands gives the ante edge ≈ 2.19% ±0.2%.
2. **Machine integration**: the game machines own a rules object (validated and clamped) and call the engine. The guest AI (Session 3) asks a machine to play one round for a guest with a bet and the guest's skill/error rate. Expose that as one method (`playRound(guestCtx, rng): RoundResult`) and keep v1's `machinePlayed` event.
3. **Economy** (`sim/economy/`): extend `Ledger` with handle, win, hold%, theoretical win, rounds and occupancy per object, per hour and per day; F&B and comps; staff wages per hour; dealers' effect on `roundsPerHour`. Add a `CasinoFinancials` view for the lead's P&L panel: today, yesterday, 7-day, per-game breakdown.
4. **Levers**: `setRules(objectId, rules)` validates and applies. `appeal(rules)` drops for player-hostile rules (6:5, H17, 00, low odds, 88% par), while price/limits tune who sits down. Document the curve.
5. **Avatar play**: `roundBegin(objectId, bets)` starts a player round; the reply carries `{options, view}`. `roundAct(objectId, action)` advances it, and the final reply carries the `RoundResult`. Player money moves through the ledger as "house vs player" with a separate player wallet, starting at $1,000 and saved.
6. **Scenarios**: port the v1 campaigns to the v2 economy, or rebalance them. Each gets a starting lot, cash, goal (average daily profit or net worth by day N) and allowed objects. Add a Sandbox with effectively unlimited cash. Re-run the headless campaign tests (`data/campaigns/*.test.ts`) and rebalance until the first scenario is winnable by a sensible strategy and loses to a bad one.

## Acceptance
- Every exact-edge test passes, and the MC tests pass at their tolerances under a fixed seed (mark the heavy ones with a larger timeout).
- Over one simulated day at 4×, each game's realised hold% converges toward its theoretical edge as handle grows; there is a test with a large handle.
- Report a table of every game × rule set → edge, rounds/hour and expected theoretical win per seat-hour.
