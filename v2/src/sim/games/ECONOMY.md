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
| `sic-bo`           | `sicbo`     | 180:1 triples, any triple 30:1, singles 1-2-3:1, $2–$200                 |
| `three-card-poker` | `tcp`       | Pair Plus 40-30-6-4-1, Ante bonus 5-4-1, queen-high dealer, $2–$500      |
| `pai-gow`          | `paigow`    | 53 cards (semi-wild joker), 5% commission, house way both sides, $5–$1,000 |
| `keno-lounge`      | `keno`      | 20 of 80, 1/4/6/8/10-spot tickets on the standard tables, $1–$100        |

Big six, video poker, bingo and pachinko still use v1 payout tables (B9c–B9d).

## Where each edge comes from

- **Slots:** enumerated. `parStats()` walks every stop combination of a par sheet (up to ~1M) and returns the exact RTP, hit frequency and per-spin SD. A sheet's filed `rtp` is checked against the enumeration to 1e-9 (`parSheet.test.ts`). At runtime the engine reads the filed value, so the worker never enumerates.
- **Roulette:** enumerated over the wheel's pockets per bet. Every standard bet is 1/37 or 2/38, the five-number bet 3/38, and La Partage halves even-money bets.
- **Craps:** exact Markov ratios per bet: Pass 7/495, Don't Pass (bar 12) 3/220, odds 0, place 6/8 1/66, field 1/18 (1/36 with 3:1 on 12), hardways 1/9 and 1/11, any 7 1/6.
- **Blackjack:** rule-adjustment table (Wizard of Odds rule variations; see `blackjack/rules.ts` for each value), verified by 2M-hand Monte Carlo runs of the engine's own generated basic strategy on three rule sets (`blackjack.mc.test.ts`).
- **UTH:** Ante edge 2.43% for the standard decision table. That's Wizard of Odds' figure for this "simple strategy"; optimal play is 2.185%. Checked by a 2M-hand Monte Carlo run. Trips edges are exact, from the seven-card category counts, which the evaluator re-derives over all 133,784,560 hands.

- **Sic bo (B9a):** enumerated. Every bet's edge is 1 − E[return] over the 216 ordered rolls (`sicBoSpotEdge`): small/big 7/252 = 2.78% (triples lose), singles 17/216 = 7.87%, doubles 18.52%, specific triple 16.2% at 180:1, any triple 13.89% at 30:1, two-dice combination 16.67%, totals 9.72–18.98% by number (`TOTAL_PAYS`). `sicbo.test.ts` checks each against the published figure and a 2M-round Monte Carlo of the guest mix. The engine's `theoreticalEdge` is that mix's stake-weighted edge (8.3%), because the money sits on the long shots, not the 2.78% even-money bets.
- **Three-card poker (B9a):** exact. Pair Plus is enumerated over the 22,100 hands (2.32% on 40-30-6-4-1, 7.28% on 40-30-6-3-1). The Ante edge for the reference strategy (play Q-6-4 or better) is the sum over all 407,170,400 disjoint (player, dealer) pairs, hardcoded as `TCP_BASE_NET` and re-derived in `tcp.test.ts` (about 10 s): −3.373% of the Ante with the 5-4-1 bonus, which is Wizard of Odds' 3.37%. A 3M-hand Monte Carlo of the engine confirms it within ±0.15%.

- **Pai gow poker (B9b):** Monte Carlo, because the house way has no closed form a test can enumerate. Both player and banker set by the same documented house way (`setHand` in `paigow/paigow.ts`; a simple posted-style way close to the ones Wizard of Odds lists). A 10M-hand run per deck gives win 28.88% / push 40.99% / lose 30.13% with the joker and 29.66% / 39.40% / 30.94% without, hardcoded as `PAI_GOW_RATES`. The edge is then exact in the commission: P(lose) − P(win)(1 − c), so 2.69% at 5% (Wizard of Odds: about 2.7% for house way against house way) and 2.40% at 4%; 2.76% with no joker. `paigow.test.ts` re-measures 2M hands per deck within ±0.15 points and asserts the ~41% pushes.
- **Keno (B9b):** exact. P(k catches on an n-spot ticket) = C(n,k)·C(80−n,20−k)/C(80,20), summed against each ticket's paytable (`kenoReturn`). Three sets of tables (generous / standard / tight) shaped like the live and lounge tickets Wizard of Odds surveys (Las Vegas live keno returned 65–80% in 2001), with the tops capped at lounge sizes. The standard tickets return 72–75% each (1-spot 3 for 1 is exactly 75%); the guest mix (1-spot 30%, 4-spot 40%, 6-spot 20%, 8-spot 7%, 10-spot 3%, equal stakes) is a 26.2% edge, generous 21.3%, tight 33.6%. `theoreticalEdge` is that mix.

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
| Sic bo    | `triple` 150/180, `anyTriple` 24/30, `singleTriple` 2/3, limits                                                                          |
| 3-card    | `pairPlus` 40-30-6-4-1 / 40-30-6-3-1 / 50-40-6-3-1, `anteBonus` 5-4-1 / 3-2-1, limits                                                    |
| Pai gow   | `commission` 5% / 4%, `jokerRule` semi-wild (53 cards) / none (52), limits                                                               |
| Keno      | `paytable` generous / standard / tight, limits                                                                                           |

### The appeal curve

`engine.appeal(rules)` returns a 0.5–1.5 multiplier for guests who notice the rules. Session 3's guest AI weights it by archetype: sharp players (high rollers, high skill) feel it fully, tourists barely notice.

- **Blackjack** (multiplicative, from 1.0): 6:5 ×0.70, H17 ×0.95, DAS ×1.03, late surrender ×1.04, RSA ×1.02, 1–2 decks ×1.08, no resplit ×0.97. Default rules come to 1.03. A 6:5 H17 table is 0.71, about a 30% cut in sharp-player traffic for +1.6 points of edge.
- **Roulette:** single zero 1.15, double 0.95, La Partage +0.10.
- **Craps** (by odds): 1x 0.80, 2x 0.90, 3-4-5x 1.00, 5x 1.05, 10x 1.15, 20x 1.20. Field 3:1 adds 0.05.
- **Slots:** linear in RTP, 1 + 4 × (RTP − 0.92). An 88% sheet reads as tight (0.84), 97% as loose (1.20).
- **UTH:** Trips 9-7-4-3 is 1.08, 8-7-4-3 is 1.00, 8-6-5-3 is 0.97.
- **Sic bo** (additive from 1.0): 180:1 triple ±0.04, any triple at 30 ±0.03, single-number triple at 3:1 ±0.02.
- **Three-card poker** (multiplicative): Pair Plus 40-30-6-4-1 1.06, 50-40-6-3-1 1.00, 40-30-6-3-1 0.94; Ante bonus 5-4-1 ×1.02, 3-2-1 ×0.94.
- **Pai gow:** 4% commission ×1.05; no joker ×0.97.
- **Keno:** generous 1.08, standard 1.00, tight 0.93. Keno players are loyal and barely price-sensitive.

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
| Sic bo    | 80 / (1 + 0.12 n)                                        | about 64 → 47                           |
| 3-card    | 75 / (1 + 0.1 n)                                         | about 62 → 50                           |
| Pai gow   | 36 / (1 + 0.08 n)                                        | about 33 → 24                           |
| Keno      | 15, whoever is seated                                    | a game every 4 minutes, one draw for all |

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
| Sic bo     | 6 × $2.04 (any one bet)  | ~8.3% of the guest mix (long shots)     |
| 3-card     | 8 × $2.65 Ante (+Pair Plus 40%) | ~4.3% of the Ante before errors |
| Pai gow    | 8 × $9 (22 × 3.3 / 8)    | 2.69%: theo $1.94 a play, the old table's $1.98 |
| Keno       | 6 × $1 tickets           | 26.2%: $1.49 a play over 30k, the old $1.50; per-play SD ~$31 (the 8- and 10-spot tops) against the old table's $4 |

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
| Sic bo    | `small` (or `main`), `big`, `single:N`, `double:N`, `triple:N`, `anyTriple`, `total:4-17`, `pair:a-b`; action `roll`                                                          |
| 3-card    | `ante` (or `main`), plus optional `pairPlus`; actions `play` (a Play bet equal to the Ante) and `fold`                                                             |
| Pai gow   | `main`; action `deal` (both hands set by the house way)                                                                                                          |
| Keno      | `spot:1`, `spot:4`, `spot:6`, `spot:8`, `spot:10` (a plain `main` is a 4-spot); action `draw`                                                                    |
| Slots     | `spin` (the bet is fixed by the rules)                                                                                                                           |
