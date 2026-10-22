# Casino math and the economy (Session 4)

Every gambling object that used to roll an abstract `{p, multiplier}` table now plays its real game:

| Object             | Engine      | Default rules                                                            |
| ------------------ | ----------- | ------------------------------------------------------------------------ |
| `slot-machine`     | `slots`     | Lucky Cherries (3×1 stepper, 92.1%, σ 1.27), 25¢ × 40 credits            |
| `penny-slots`      | `slots`     | Penny Fortune (5×3, 20 lines, 88.0%), 1¢ × 200 credits                   |
| `roulette-table`   | `roulette`  | Double zero, $5–$1,000                                                   |
| `blackjack-table`  | `blackjack` | 6D S17 DAS 3:2, split to 4, no RSA/surrender, 75% penetration, $5–$1,000 |
| `high-limit-table` | `blackjack` | As above plus late surrender, $25–$10,000                                |
| `craps-table`      | `craps`     | 3-4-5x odds, field 12 pays 2:1, $2–$1,000                                |
| `poker-table`      | `uth`       | Ultimate Texas Hold'em, Trips 50-40-30-8-7-4-3, $2–$500                  |

Sic bo, big six, video poker, three-card poker, pai gow, keno, bingo and pachinko still use v1 payout tables (follow-up).

## Where each edge comes from

- **Slots:** enumerated. `parStats()` walks every stop combination of a par sheet (up to ~1M) and returns the exact RTP, hit frequency and per-spin SD. A sheet's filed `rtp` is checked against the enumeration to 1e-9 (`parSheet.test.ts`). At runtime the engine reads the filed value, so the worker never enumerates.
- **Roulette:** enumerated over the wheel's pockets per bet. Every standard bet is 1/37 or 2/38, the five-number bet 3/38, and La Partage halves even-money bets.
- **Craps:** exact Markov ratios per bet: Pass 7/495, Don't Pass (bar 12) 3/220, odds 0, place 6/8 1/66, field 1/18 (1/36 with 3:1 on 12), hardways 1/9 and 1/11, any 7 1/6.
- **Blackjack:** rule-adjustment table (Wizard of Odds rule variations; see `blackjack/rules.ts` for each value), verified by 2M-hand Monte Carlo runs of the engine's own generated basic strategy on three rule sets (`blackjack.mc.test.ts`).
- **UTH:** Ante edge 2.43% for the standard decision table. That's Wizard of Odds' figure for this "simple strategy"; optimal play is 2.185%. Checked by a 2M-hand Monte Carlo run. Trips edges are exact, from the seven-card category counts, which the evaluator re-derives over all 133,784,560 hands.

## Theo, hold and skill

`theo` for a round is Σ opening bets × each spot's edge, plus the guest's **skill premium**. Raises, doubles and odds add handle but no theo, because edges are quoted per initial wager.

Guests stray from the reference strategy with probability `ENGINE_BALANCE.skillErrorByArchetype`: high roller 1%, regular 2%, biker 3%, tourist 5%. A stray picks uniformly among the other legal actions. The premium is the extra edge that produces. `GameMath.skillPremium` measures it by common-random-numbers Monte Carlo (the same deals played perfectly and with errors), cached per rule set and error rate. This follows the casino convention of rating players at an average-player edge rather than a perfect one, which is why theo predicts hold. At 2% errors the premium is about +1.0 point on blackjack and +2.3 on UTH. Roulette and slots have no decisions; craps' only decision is the zero-edge odds, which guests take with a per-archetype appetite (`ENGINE_BALANCE.oddsAppetiteByArchetype`: high roller 25%, biker 5%, regulars and tourists never). Declining odds costs nothing, so it is a variance dial, not a skill.

The avatar's rounds book theo at the book edge with no premium.

## Levers (`setRules`)

`setRules(objectId, rules)` validates and clamps every field. It replies `{ rules, issues }`, where `issues` lists every field it had to change, and the guest stake moves inside the new limits. Rules are saved with the machine.

| Game      | Levers                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Slots     | `sheet`, `denomination` (0.01/0.25/1/5), `credits` (bet = denomination × credits)                                                        |
| Roulette  | `wheel` single/double, `laPartage` (single zero only), `minBet`, `maxBet`                                                                |
| Blackjack | `decks` 1/2/6/8, `h17`, `blackjackPays` 3:2/6:5, `das`, `rsa`, `surrender` none/late, `maxSplitHands` 2–4, `penetration` 0.5–0.9, limits |
| Craps     | `odds` 1x/2x/3-4-5x/5x/10x/20x, `field12Pays` 2/3, limits                                                                                |
| UTH       | `trips` paytable, limits                                                                                                                 |

### The appeal curve

`engine.appeal(rules)` returns a 0.5–1.5 multiplier for guests who notice the rules. Session 3's guest AI weights it by archetype: sharp players (high rollers, high skill) feel it fully, tourists barely notice.

- **Blackjack** (multiplicative, from 1.0): 6:5 ×0.70, H17 ×0.95, DAS ×1.03, late surrender ×1.04, RSA ×1.02, 1–2 decks ×1.08, no resplit ×0.97. Default rules come to 1.03. A 6:5 H17 table is 0.71, about a 30% cut in sharp-player traffic for +1.6 points of edge.
- **Roulette:** single zero 1.15, double 0.95, La Partage +0.10.
- **Craps** (by odds): 1x 0.80, 2x 0.90, 3-4-5x 1.00, 5x 1.05, 10x 1.15, 20x 1.20. Field 3:1 adds 0.05.
- **Slots:** linear in RTP, 1 + 4 × (RTP − 0.92). An 88% sheet reads as tight (0.84), 97% as loose (1.20).
- **UTH:** Trips 9-7-4-3 is 1.08, 8-7-4-3 is 1.00, 8-6-5-3 is 0.97.

Price and limits tune who sits down: the guest's wallet must cover the opening bet (`minBet` and `costToPlay`), and the v1 table-minimum dial and `minWallet` gates still apply.

## Pace: rounds per hour, dealers, plays

`roundsPerHour(rules, seated)`:

| Game      | Formula                                                  | Values                                  |
| --------- | -------------------------------------------------------- | --------------------------------------- |
| Blackjack | 400 / (n + 1)                                            | 200 heads-up, 133 at 2 players, 57 at 6 |
| Roulette  | 112 / (1 + 0.33 n)                                       | about 84 → 38                           |
| Craps     | 110 rolls / (1 + 0.03 n), ÷ 3.38 rolls per pass decision | about 31 decisions an hour              |
| UTH       | 60 / (1 + 0.15 n)                                        | 52 → 32                                 |
| Slots     | the sheet's `spinsPerHour`                               | 400 for a stepper, 600 for video        |

A table with an assigned dealer runs at full speed. Without one it deals at `ENGINE_BALANCE.noDealerSpeed` = 0.5.

The forked guest AI still makes one decision per play interval, so one "play" is a batch of small real rounds. `ENGINE_BALANCE.playShape` gives, per machine, the rounds per play (at two seated players with a dealer) and the total opening handle as a multiple of the machine's stake (`costToPlay`). Each round bets stake × handle / rounds:

| Machine    | Rounds × per-round stake | Effective edge                          |
| ---------- | ------------------------ | --------------------------------------- |
| Blackjack  | 16 × $7.80               | ~1.4% with a regular's errors           |
| Craps      | 10 × $5                  | ~2.7% of opening bets (line plus props) |
| UTH        | 12 × $2.30 Ante          | ~5.3% of the Ante                       |
| Roulette   | 2 × $15                  | 5.26%                                   |
| High-limit | 12 × $65                 | ~1.0%                                   |
| Slots      | 1 spin                   | —                                       |

These shapes hold each game's take per play, and its swing per play, near what v1's economy (wages, upkeep, campaign goals, and P16's "a day is not a coin flip" bar) was tuned on. For a fixed take, n rounds at stake/n swing 1/√n as much. Occupancy and dealer speed scale the round count by `roundsPerHour(seated) × dealerSpeed`, with fractions rounded stochastically. Once Session 3's bankroll guests call `GameMath.playRound` per round at the table's real pace, `playShape` can retire.

## Books

`Ledger` rows, per object per day and per hour (the last 24 hours), carry handle (`wagered`), paid (`won`), win (`revenue`), `theo`, `rounds` and seat occupancy (`occupiedTicks / capacityTicks`). Wages are charged hourly; F&B and comps already had their own rows.

`casinoFinancials(world.ledger)` (`sim/economy/financials.ts`) returns today, yesterday and the last 7 days as P&L lines (gaming handle, win, hold, theo, rounds and occupancy; F&B; other revenue; wages, comps, upkeep, fines and interest), today's per-game breakdown, today's hours, and the avatar's book.

## Avatar play

The `roundBegin(objectId, bets)` and `roundAct(objectId, action)` commands reply `{ options, view, wallet }`, plus `result` once the round settles.

The player has a $1,000 wallet of their own (`world.player`, saved). Their losses are the house's win, booked to the machine's row and to `ledger.todayPlayer`. Bets must be within the table's limits (side bets may go under the minimum) and covered by the wallet, as must every double, split, raise and odds bet.

Spot ids by game:

| Game      | Spots                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blackjack | `main`                                                                                                                                                           |
| Roulette  | `straight:N`, `straight:00`, `split:a-b`, `street:a`, `corner:a`, `sixline:a`, `basket`, `column:1-3`, `dozen:1-3`, `red`, `black`, `odd`, `even`, `low`, `high` |
| Craps     | `pass`, `dontPass`, `come`, `dontCome`, `place:N`, `hard:N`, `field`, `any7`, `anyCraps`, `yo`; odds via the `odds:<spot>` action                                |
| UTH       | `ante`, plus optional `trips`                                                                                                                                    |
| Slots     | `spin` (the bet is fixed by the rules)                                                                                                                           |
