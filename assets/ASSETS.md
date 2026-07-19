# Asset Audit & Sprite Contract

## Sprite contract (all art must comply)

- Iso tiles: 2:1 diamond, **128×64 px** footprint (`TILE_W`/`TILE_H` in `src/config.ts`).
- Objects: anchor at **tile center-bottom** of their origin cell; taller art extends upward.
- Multi-tile objects declare a footprint (e.g. blackjack table 2×2) and are anchored at the origin cell.
- All textures register through the atlas manifest (added in P1 as `src/render/atlas.ts`); game code references keys only — swapping art never touches logic.

## Placeholder art (active)

`src/render/placeholders.ts` generates every needed texture at runtime (flat-shaded iso diamonds and boxes). The game is fully playable with zero downloaded assets. Real art replaces placeholders key-by-key via the manifest.

**Characters (P6):** guests and staff are now generated *pixel people* (12×18 logical px at 2× scale → 24×36 textures), not boxes — 6 guest outfit variants plus mechanic (hard hat) and janitor (bucket), each with an `-a`/`-b` walk frame pair. Keys: `char-guest-{0..5}-{a|b}`, `char-mechanic-{a|b}`, `char-janitor-{a|b}`.

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

## Recommended CC0 packs (manual download → drop into `assets/`)

| Pack | Source | Use for |
|---|---|---|
| Kenney — Casino Pack | kenney.nl/assets/casino-pack | Cards, chips, slot symbols (reel icons, UI decoration) |
| Kenney — Isometric Miniature packs (Library / Dungeon / Farm) | kenney.nl/assets | Floor styles, walls, decor to adapt |
| Kenney — UI Pack (RPG expansion) | kenney.nl/assets/ui-pack | Beveled RCT-style window chrome, buttons |
| Kenney — Interface Sounds + Casino Audio | kenney.nl/assets | UI clicks, chimes, jackpot stingers |
| freesound.org (CC0 filter) | freesound.org | Casino ambiance loop |

**Known gaps** (no good free isometric source; placeholders stay until commissioned art):
slot machine cabinets, blackjack tables, guest/staff character sprites in iso perspective.

## License notes

Kenney assets are CC0. Record any non-Kenney addition here with its license before committing it.
