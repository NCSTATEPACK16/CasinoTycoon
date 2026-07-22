# Asset Audit & Sprite Contract

## Sprite contract (all art must comply)

- Iso tiles: 2:1 diamond, **128×64 px** footprint (`TILE_W`/`TILE_H` in `src/config.ts`).
- Objects: anchor at **tile center-bottom** of their origin cell; taller art extends upward.
- Multi-tile objects declare a footprint (e.g. blackjack table 2×2) and are anchored at the origin cell.
- All textures register through the atlas manifest (added in P1 as `src/render/atlas.ts`); game code references keys only — swapping art never touches logic.

## Real object art (active — P9)

Self-generated isometric pixel art, transparent PNGs, served from `public/sprites/` (same pattern as `public/audio/`) and preloaded in `BootScene`:

| Texture key           | File                                 | Used by                  |
| --------------------- | ------------------------------------ | ------------------------ |
| `img-slot-machine`    | `public/sprites/slot-machine.png`    | `slot-machine` object    |
| `img-blackjack-table` | `public/sprites/blackjack-table.png` | `blackjack-table` object |
| `img-craps-table`     | `public/sprites/craps-table.png`     | `craps-table` object     |
| `img-wall-panel`      | `public/sprites/wall-panel.png`      | edge walls (`WorldScene.drawEdgeWalls`, mirrored via `setFlipX` for the west run) |
| `img-neon-sign`       | `public/sprites/neon-sign.png`       | `neon-sign` object       |
| `img-marquee`         | `public/sprites/marquee.png`         | `marquee` object         |
| `img-restroom`        | `public/sprites/restroom.png`        | `toilet` object          |
| `img-plant`           | `public/sprites/plant.png`           | `plant` object           |
| `img-food-stall`      | `public/sprites/food-stall.png`      | `food-stall` object      |

These replace the flat-shaded placeholder boxes for those object types via `ObjectDef.displaySize` (explicit on-screen px size, since the source PNGs are captured at arbitrary export resolution, not pre-sized to the iso grid) or, for the wall, an explicit `setDisplaySize()` call at the call site (no `ObjectDef` to hang it on). Only floor tiles and all characters' fallback path remain placeholders now — **T3's full object list (wall, restroom, food stall, plant) is done, closing out P10.5 T3.**

**Restroom + plant + food-stall alpha recovery needed a per-file tolerance override (P10.5 T3, 2026-07-22):** all three regenerated assets carry a neon glow (restroom's door-frame tubes, plant's base ring, food-stall's SNACKS/DRINKS signs) that bleeds a soft gradient into the surrounding checkerboard. At the default `BG_COLOR_TOLERANCE` (22), the corner-sampled color match never fully separates object from background — confirmed by dumping connected-component sizes: exactly one opaque component remained, spanning the *entire* canvas, not just the real art. The already-existing `walkGradient` mode (built for the P10.6 guest sheets) overshoots the other way here, eating into the object's own soft-shaded surfaces — same failure mode documented above for the wall panel. Fix: `recoverAlpha` now takes an optional `bgTolerance` override (default still 22, so every other file is byte-for-byte unaffected). Found by bisecting per file: restroom needed 45 (30 still left one full-canvas component; 60 already shrank the kept component from ~774k px to ~195k, i.e. started cutting real art), plant and food-stall each needed only 30 (smaller/tighter glow, separates sooner — food-stall's bisection: 22 left a full-canvas component, 28 still left a full-width leak, 30 cleanly separated to an 1182×983 bbox). Values are per-file `TARGETS` entries in `scripts/optimize-sprites.mjs`, not a shared default.

**Process note:** the downscaled restroom output looked like it had white blotches baked into the green wall panels when opened with the `Read` tool — turned out to be the tool's own transparency-compositing quirk on an image with heavy partial-alpha edge pixels, not a real defect. Confirmed clean by manually alpha-compositing the PNG over a solid background in a throwaway script and by placing the object in a live headed browser (Playwright) — this project's established rule of verifying with real pixel/browser data over a rendered preview held again.

**Delivery history:** the `food-stall.png` and `restroom.png` originally delivered 2026-07-21 were full in-context scene mockups (baked-in slot machines/carpet/walls), not isolated sprites — flagged blocked, never wired. Both were regenerated and redelivered 2026-07-22 as proper isolated sprites with real footprint outlines; `plant.png` landed fresh the same day (never delivered before). All three are now wired in as above.

**Wall panel note (P10.5):** the delivered `assets/wall-panel.png` wasn't the single straight segment the prompt asked for — it rendered as a symmetric two-face corner preview (both the north and west wall orientations meeting at a vertex, sharing one wall-sconce). Used the right half only (which has a complete, correctly-lit face) as the canonical `img-wall-panel` texture; the code mirrors it with `setFlipX` for the perpendicular run, so the shared sconce repeats identically down both walls by design, not by accident.

**Alpha-recovery algorithm fix (P10.5):** `scripts/optimize-sprites.mjs`'s original "near-gray = background" heuristic (generalized from the P9/P10 ad hoc fixes) wrongly ate a real chunk of the wall panel's dark, low-saturation damask wallpaper pattern, mistaking it for checkerboard. Replaced with color-distance matching against colors sampled from the image's own corners (always clean background padding in this asset batch) — precise enough to leave legitimately dark art alone. Re-verify this holds if a future asset's background padding is ever thin enough that a corner sample catches real art instead.

## Real character art (active — P10.6 sub-project 1)

Guests 0–5, the mechanic, and the janitor all now use real art loaded directly into the same `char-*` keys the procedural generator uses (`char-guest-{0..5}-{a|b}`, `char-mechanic-{a|b}`, `char-janitor-{a|b}`) — unlike objects there's no `spriteKey` indirection, so real art has to occupy the exact final key; `generatePlaceholders()` already no-ops any key that's preloaded, so a variant without real art keeps the procedural fallback automatically. Source PNGs: `assets/guest varient 0.png` (→ `guest-0`), `assets/guests1-5varients.png` (5 labeled cells → `guest-1`..`guest-5`), `assets/mechanic.png`, `assets/janitor.png`. Spliced by `scripts/splice-characters.mjs` (one-time intake: crops the sheet cells, splits every 2-frame image into separate `-a`/`-b` PNGs under `public/sprites/characters/`), then cleaned by `npm run optimize-sprites` same as every other `FILE_ASSETS` entry. Display size fixed at 72px tall (2× the old 36px procedural scale — richer art needs more room for detail to read), width preserved per character's natural aspect ratio.

**`guests1-5varients.png` labeling bug:** two cells don't match their own printed label — a duplicate "Business Male" cell, and a cell labeled "Elderly Man" that's actually a mislabeled Party Female repaint (the real elderly man sits in an unlabeled cell elsewhere on the sheet). `splice-characters.mjs`'s cell coordinates were chosen by matching visual content to each variant's stated identity, not raw grid position — see the roadmap doc for the full writeup.

**Background removal needed a second algorithm mode.** `guest varient 0.png` and `guests1-5varients.png` (unlike every other file in this asset batch) have a *gradient* canvas background — lighter center, darker corners, plus thin ruled gridlines — not a flat checkerboard. Point-color matching against a handful of sampled reference colors (the algorithm that correctly handles every checkerboard-background file) left visible gridline fragments and a large uncleared gradient region, because no small fixed color list can cover a continuous gradient. `scripts/lib/sprite-alpha.mjs`'s `recoverAlpha` now takes an opt-in `walkGradient` flag: when set, the border-connected flood fill also accepts a pixel if it's only a small step away from the already-accepted neighbor that reached it (walks the gradient one tiny step at a time), in addition to matching known reference colors (still handles the abrupt tone-to-tone jumps in a flat checkerboard, which a pure local-step walk can't cross). This is opt-in, not the default: tried as the default once, and it ate straight through the wall-panel's dark, subtly-shaded wallpaper down to a thin sliver, because that real art's own local pixel-to-pixel shading steps are often just as small as a genuine gradient step. Only `guest-0` through `guest-5` set `walkGradient: true` in `optimize-sprites.mjs`'s `TARGETS`; `mechanic`/`janitor` (clean, ordinary checkerboard backgrounds) don't need it. `guest-0` also needed one extra manual fix: a faint diagonal smudge artifact confined to the top ~105px of the source, unrelated to the background-removal problem, trimmed by `splice-characters.mjs`'s `PRE_CROP_TOP` before the general pipeline ever sees it.

## Placeholder art (active)

`src/render/placeholders.ts` generates every needed texture at runtime (flat-shaded iso diamonds and boxes). The game is fully playable with zero downloaded assets. Real art replaces placeholders key-by-key via the manifest.

**Characters (fallback):** the procedural _pixel people_ generator (12×18 logical px at 2× scale → 24×36 textures) remains the automatic fallback for any `char-*` key without real art loaded — currently none, all 8 character slots (6 guests + mechanic + janitor) have real art, but the mechanism still applies to any future new variant.

## Generating real character art (Gemini / any image model)

No coherent CC0 RCT-style "peep" set exists (checked OpenGameArt + Kenney, 2026-07). To replace the generated pixel people with real art, produce sheets matching this spec and register them under the keys above:

> Pixel-art sprite of a tiny casino guest in the style of RollerCoaster Tycoon (1999)
> peeps, viewed from a front-left 3/4 isometric angle. The figure is 24 px wide and
> 36 px tall on a fully transparent background, standing centered at the bottom edge.
> Chunky 2-px pixel clusters, flat colors, no outline, no anti-aliasing, no drop
> shadow. Two frames side by side: (1) standing with legs apart, (2) mid-stride with
> legs together. [VARIANT: red shirt / blue shirt / … | orange mechanic overalls with
> yellow hard hat | purple janitor uniform carrying a gray bucket]

- One sheet per variant, 2 frames each, 24×36 px per frame (or any integer multiple — we can downscale).
- Deliver as PNG with transparency into `assets/characters/`, then we slice + register them in the manifest; game code never changes.

## Chip sprites (P10 — for the P11 chip-arc jackpot upgrade)

`npm run fetch-assets` (`scripts/fetch-assets.mjs`) was written expecting a Kenney "Casino
Kit" pack with chip sprites — **that pack does not exist** (confirmed 2026-07-19: kenney.nl
has no dedicated casino/chip pack; the closest hit, Playing Cards Pack, contains only cards).
The script is kept as-is (idempotent, fails loudly with a manual-download fallback) in case
Kenney adds one later, but is not expected to succeed today.

Chip art is instead self-generated (2026-07-19), same convention as the P9 table sprites
(`slot-machine.png` et al. in `public/sprites/`): five PNGs (`chip_white`, `chip_blue`,
`chip_red`, `chip_green`, `chip_black`) delivered as one sheet (`assets/chips.png`), split
and processed the same way as the table sprites — the "transparent" background was again
opaque pixels with a baked-in checkerboard rather than real alpha (same failure mode as the
P9 table sprites), recovered via the same border-flood-fill + bimodal-pocket technique and
cropped to content. Registered in `public/sprites/chips/` (not `kenney-chips/` — these aren't
Kenney assets) and in `src/render/atlas.ts` as `img-chip-{white,blue,red,green,black}`.

**Re-processed 2026-07-20** from the same `assets/chips.png` sheet (kept local-only, not
committed — same convention as other raw `assets/*` source deliveries): the checkerboard
recovery was redone with a border-connected flood fill (any near-grayscale pixel connected
to the sheet's edge treated as background, converted to real alpha), then a second pass kept
only the largest opaque connected component per chip to drop a few disconnected background
specks the first pass left behind (visible on `chip_black` only). Each chip trimmed to its
alpha bounding box, padded to a shared square, and downsampled to 128×128 — small enough to
keep the atlas light while still crisp once P11 displays them at coin size (~14px) via
`setDisplaySize`, not `setScale` (the raw art is far larger than the on-screen footprint).
Still not consumed by any render code — P11 Task 7 swaps the `fx-coin` jackpot-burst texture
for these.

## Audio (active — P8)

Downloaded 2026-07-19 from kenney.nl (all CC0), curated into `public/audio/` with semantic
names; Vite serves them at `/audio/<key>.ogg` and `BootScene` preloads every key listed in
`src/services/AudioService.ts` (`AUDIO_KEYS`). Widened 2026-07-22 (P10.6 sub-project 2)
using the fuller source zip the user provided directly, plus a dedicated Craps dice-sound
pool replacing its earlier fallback to chip sounds.

| Keys                                                   | Source pack      | Original files                                                                                              |
| ------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `sfx-chips-{1..6}`, `sfx-coin-{1,2}`                   | Casino Audio     | chips-handle-1/3/5, chips-collide-2, chips-stack-3, chip-lay-1/2/3                                          |
| `sfx-card-{1..5}`, `sfx-shuffle`                       | Casino Audio     | card-slide-1/4, card-place-2/4, card-shove-2, card-shuffle                                                  |
| `sfx-dice-{1..4}`                                      | Casino Audio     | dice-throw-1/2, dice-shake-2/3 — dedicated pool for Craps plays (P10.6 sub-project 2), chips no longer used |
| `sfx-jackpot`, `sfx-victory`, `sfx-failure`            | Music Jingles    | jingles_NES03, jingles_PIZZI07, jingles_NES10                                                               |
| `sfx-break`, `sfx-fixed`                               | Interface Sounds | error_005, confirmation_002                                                                                 |
| `ui-click/open/close/error/place/sell/pluck/drop/hire` | Interface Sounds | click_001, maximize_004, minimize_004, error_001, drop_002, drop_003, pluck_001, drop_001, confirmation_001 |

There is no CC0 casino ambiance loop worth shipping; instead the "music" bus plays a
**generative ambiance** — quiet randomized chip/card/dice sounds with pitch jitter
(see `AudioService.startAmbiance`). Swap in a real loop later by adding the file and
looping it on the music bus.

## Recommended CC0 packs (manual download → drop into `assets/`)

| Pack                                                          | Source                   | Use for                                  |
| ------------------------------------------------------------- | ------------------------ | ---------------------------------------- |
| Kenney — Isometric Miniature packs (Library / Dungeon / Farm) | kenney.nl/assets         | Floor styles, walls, decor to adapt      |
| Kenney — UI Pack (RPG expansion)                              | kenney.nl/assets/ui-pack | Beveled RCT-style window chrome, buttons |
| Kenney — Interface Sounds + Casino Audio                      | kenney.nl/assets         | UI clicks, chimes, jackpot stingers      |
| freesound.org (CC0 filter)                                    | freesound.org            | Casino ambiance loop                     |

**Known gaps** (no good free isometric source; placeholders stay until commissioned art):
slot machine cabinets, blackjack tables, guest/staff character sprites in iso perspective.

## License notes

Kenney assets are CC0. Record any non-Kenney addition here with its license before committing it.
