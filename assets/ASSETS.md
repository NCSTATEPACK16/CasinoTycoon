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

These replace the flat-shaded placeholder boxes for those three object types via `ObjectDef.displaySize` (explicit on-screen px size, since the source PNGs are captured at arbitrary export resolution, not pre-sized to the iso grid). Floor tiles, walls, toilet, food stall, plant, and all characters remain placeholders.

## Placeholder art (active)

`src/render/placeholders.ts` generates every needed texture at runtime (flat-shaded iso diamonds and boxes). The game is fully playable with zero downloaded assets. Real art replaces placeholders key-by-key via the manifest.

**Characters (P6):** guests and staff are now generated _pixel people_ (12×18 logical px at 2× scale → 24×36 textures), not boxes — 6 guest outfit variants plus mechanic (hard hat) and janitor (bucket), each with an `-a`/`-b` walk frame pair. Keys: `char-guest-{0..5}-{a|b}`, `char-mechanic-{a|b}`, `char-janitor-{a|b}`.

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

Chip art is instead self-generated, same convention as the P9 table sprites (`slot-machine.png`
et al. in `public/sprites/`): five PNGs (`chip_white`, `chip_blue`, `chip_red`, `chip_green`,
`chip_black`) with real alpha transparency, dropped into `public/sprites/kenney-chips/` and
registered in `src/render/atlas.ts` as `img-chip-{white,blue,red,green,black}`. Not consumed
by any render code yet — P11 swaps the `fx-coin` jackpot-burst texture for these.

## Audio (active — P8)

Downloaded 2026-07-19 from kenney.nl (all CC0), curated into `public/audio/` with semantic
names; Vite serves them at `/audio/<key>.ogg` and `BootScene` preloads every key listed in
`src/services/AudioService.ts` (`AUDIO_KEYS`).

| Keys                                                   | Source pack      | Original files                                                                                              |
| ------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `sfx-chips-{1..3}`, `sfx-coin-{1,2}`                   | Casino Audio     | chips-handle-1/3/5, chip-lay-1/2                                                                            |
| `sfx-card-{1,2}`, `sfx-shuffle`                        | Casino Audio     | card-slide-1, card-place-2, card-shuffle                                                                    |
| `sfx-dice-{1,2}`                                       | Casino Audio     | dice-throw-1, dice-shake-2                                                                                  |
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
