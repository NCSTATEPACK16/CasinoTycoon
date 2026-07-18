# Asset Audit & Sprite Contract

## Sprite contract (all art must comply)

- Iso tiles: 2:1 diamond, **128×64 px** footprint (`TILE_W`/`TILE_H` in `src/config.ts`).
- Objects: anchor at **tile center-bottom** of their origin cell; taller art extends upward.
- Multi-tile objects declare a footprint (e.g. blackjack table 2×2) and are anchored at the origin cell.
- All textures register through the atlas manifest (added in P1 as `src/render/atlas.ts`); game code references keys only — swapping art never touches logic.

## Placeholder art (active)

`src/render/placeholders.ts` generates every needed texture at runtime (flat-shaded iso diamonds and boxes). The game is fully playable with zero downloaded assets. Real art replaces placeholders key-by-key via the manifest.

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
