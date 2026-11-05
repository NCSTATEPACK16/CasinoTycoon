# B6: Decor and amenities with real effects (Track B part 3, after B15)

**v2.1 update (the user, 2026-11-05): don't wait for Track A.** B6 runs in Track B's part-3 session on branch `v2-tycoon-3` (see [11-ui-b15.md](11-ui-b15.md)), right after the UI rebuild B15. Track A builds the six items' art in A10 ([10-alive-2.md](10-alive-2.md)) in parallel; until it reaches your branch through `origin/v2.1`, the items render through the `proc:box` fallback. Build the gameplay, defs and catalog entries now; when A10's art merges, keep A's `asset`/`height`/`color`/`glow`/`seats` and your zones, prices and upkeep. B9, B10 and B11 are all merged, so every plug-in below applies.

**Decisions for v2.1:**
- **Appeal replaces the signage cap entirely.** Neon signs, marquees, plants and the six new items all feed one appeal system with radius and diminishing returns.
- **Ceiling:** a well-decorated floor adds **up to about +10 rating points**. Pick the curve so the first few pieces matter and saturation is reached before the floor is wall-to-wall decor.
- **Statue, fountain and lamp post** work by radius; the **ATM** earns a small fee; the **lounge** rests guests and staff (B11); the **stage** unlocks concerts (B10's `concert` def at `src/data/events.ts:140`, `requiresObject: 'stage'`).
- **An Appeal info view** joins Mood and Traffic in B15's info-view strip.
- Re-check the campaign suites and `career.test.ts` before and after, as below.

Branch: `v2-tycoon-3` (shared with B15; no separate `v2-decor` branch). Shared rules: [NEXT-SESSION.md](NEXT-SESSION.md). History: [6-tycoon.md](6-tycoon.md), [7-tycoon-2.md](7-tycoon-2.md), [9-tycoon-2-rest.md](9-tycoon-2-rest.md).

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
  - **Replace the signage cap with appeal** (decided above): today the rating's signage term sums `ratingBonus` up to `signageBonusCap` (`sim/world.ts:762-766`). Fold neon signs, marquees and plants into the appeal system, so decor competes for the same floor and attention instead of stacking without limit.
  - **Food rip-off rule, found in B2:** a food item is a rip-off above 3× its cost (`FOOD_BALANCE.ripoffMultiplier`), which the default soda ($2.50 on $0.50) and fries ($3.50 on $1) already exceed, so every untouched stall costs those buyers 6 happiness; the bar uses 2× its default price (`PRICE_BALANCE.ripoffIndex`). Switching food to the bar's rule moved the greedy campaign probe a lot (Neon Nights 5/7 → 2/7 wins, below MIN_WINS 4), so it was left alone. Fix it here, together with the re-tune.
  - **Re-tune on purpose.** Decor changes happiness, which changes dwell, spend and rating, so every scenario's economy moves. Run the P16 guards (`campaigns.test.ts`, `difficulty.test.ts`, `crowd.campaigns.test.ts`) and `career.test.ts` (the nine-scenario career: a reasonable plan wins ≥ 4 of 7 seeds, build-and-abandon wins 0 of 7, grid and crowd), before and after, and re-tune the goals or the bots' plans, never loosening a test until it passes. Record before → after numbers in the commit. Scenarios that restrict objects (`allowedObjects`, `CampaignDef.restriction`) decide which decor is open; new items are locked behind a career unlock (`CampaignDef.unlocks`, see `services/progress.ts`) where that fits.
  - **Evidence:**
    - unit tests for the radius and the falloff
    - a sim test showing a decorated floor beats a bare one on happiness and dwell time
    - the campaign suites and `career.test.ts` green, re-tuned if needed
    - a browser check: place each item, see its effect in the Rating window and the new Appeal info view (and Mood, `M`), screenshots

## Plug-ins from B9–B11 (check which have merged)

- **Concert (from B10).** If B10's event system is merged, add a concert event def that requires a `stage` object (the hook is described in 7-tycoon-2.md, "Handing to B6"): a cost, a duration, an arrivals lift and a mood lift, shown in the marketing panel and the charts like the other events. If B10 is not merged, build the `stage` item and note the concert as the first task of whoever finishes B10.
- **Rest and fatigue (from B11).** If staff fatigue is merged, `lounge-seating` should also serve staff breaks, with a tested effect on morale.
- **ATM and wallets.** If B9 changed how bankrolls work, read how guests spend and top up before adding the ATM's fee loop.

## Finish

B6 has no finish of its own: Track B's B16 in [11-ui-b15.md](11-ui-b15.md) covers both B15 and B6. The loop prompt is in [LOOP-PROMPT.md](LOOP-PROMPT.md).
