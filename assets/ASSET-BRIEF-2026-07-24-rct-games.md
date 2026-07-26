# Asset Brief — Four New Casino Games (2026-07-24)

Prompts to feed Gemini (or any image model) for the four new game objects. Copy each block
verbatim. Companion to `ASSETS.md`, which holds the permanent sprite contract — this file is
the one-off order form for this batch.

**Deliver to:** `assets/` (repo root `assets/`, same as every prior batch). Filenames matter —
use exactly the names in the table. We splice/optimize into `public/sprites/` from there.

| File to deliver | Object | Grid footprint | Final on-screen size | Calibration reference |
| --- | --- | --- | --- | --- |
| `roulette-table.png` | Roulette | 2×2 | **220 × 165 px** | `blackjack-table.png` (220×161) |
| `poker-table.png` | Poker Room | 2×2 | **220 × 160 px** | `blackjack-table.png` (220×161) |
| `big-six-wheel.png` | Big Six Wheel | 1×1 | **90 × 140 px** | `slot-machine.png` (77×130) |
| `high-limit-table.png` | High-Limit Table | 2×2 | **220 × 160 px** | `blackjack-table.png` (220×161) |

Those are *final* display sizes. Generate large — **1500–3000 px on the long edge** — and the
`npm run optimize-sprites` pass downscales to ~2× display size. Never generate at the final
size; the downscale is what gives clean edges.

---

## The three rules that have broken past deliveries

Read these before generating anything. Each one has cost a full regeneration cycle on this
project already.

### 1. NO NEON, NO GLOW, NO BLOOM — on any of the four

This is the hard one, because "casino" pulls image models straight toward neon.

**Why it matters technically:** a glow is a soft gradient that bleeds outward into the
background. Our background-removal pass works by flood-filling inward from the border and
matching against sampled background color. A glow halo has no clean boundary, so the fill
either leaks across the entire canvas (leaving the background baked in) or, when we raise the
tolerance to compensate, starts eating the sprite's own shaded surfaces. On `restroom.png`,
`plant.png`, and `food-stall.png` this forced per-file tolerance bisection (45, 30, and 30
respectively) and one full regeneration. See `ASSETS.md` for the full writeup.

**Also:** the game applies bloom as a camera-level post-processing pass over the whole
composited frame. Glow baked into the sprite gets bloomed *again* at runtime and turns into a
smeared blob.

Say this explicitly in the prompt: **no neon tubes, no glowing signage, no light bloom, no
emissive halo, no lens flare, no rim light.** Where a real-world version of the object would
have lights — the bulbs ringing a Big Six wheel, for instance — draw them as **flat painted
dots with a hard edge**, like an unlit bulb. Zero glow radius.

Richness has to come from **color and ornament**, not light: brass, gold trim, deep red and
green velvet, polished dark wood, inlaid patterns.

### 2. ONE ISOLATED OBJECT — not a scene

The single most common failure. `restroom.png` and `food-stall.png` were both first delivered
as full in-context room mockups — the object sitting on carpet, with slot machines and walls
around it. Those are unusable: there's no non-arbitrary way to crop one object out of a scene
without inventing where its boundary is, so both had to be regenerated from scratch.

Deliver **exactly one object**, floating, nothing else in frame. No floor, no carpet, no walls,
no other furniture, no background room, no cast shadow on a surface, no human figures.

### 3. FLAT MAGENTA BACKGROUND — not a checkerboard

**This is a change from previous batches.** Prior deliveries used a checkerboard "transparency"
background, and every single one needed hand-tuned tolerance values to strip cleanly.

Ask for a **solid, uniform `#FF00FF` magenta background** instead. It's a single flat color that
appears nowhere in the artwork, so the flood-fill separates it perfectly on the first try with
no bisection. If the model can output genuine alpha transparency, that's better still — but
models usually can't, and flat magenta is the reliable fallback.

Explicitly reject: checkerboards, gradient backgrounds, vignettes, drop shadows onto the
background, and "studio backdrop" lighting. Any of those reintroduce the exact problem flat
magenta exists to avoid.

---

## Shared style preamble

Every prompt below already includes this, but for reference — the house style is:

> Isometric pixel art in the style of RollerCoaster Tycoon (1999) / Theme Park. Viewed from a
> fixed front-left 3/4 isometric angle, roughly 30° above horizontal. Chunky pixel clusters,
> flat color fills with simple hard-edged dithered shading, no anti-aliasing, no outline, no
> gradients. Dark casino interior palette — the game's floors are charcoal and plum, so objects
> read against a dark ground.

The isometric angle must match across all four, and match the existing tables. Everything in
the scene is drawn on a 2:1 isometric diamond grid (128 × 64 px per tile).

---

## Prompt 1 — Roulette Table (`roulette-table.png`)

```
Isometric pixel art of a casino roulette table, in the style of RollerCoaster Tycoon (1999).
Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above horizontal, drawn
on a 2:1 isometric grid.

The table is an oval green-felt betting layout with the printed number grid visible in
perspective, and a polished dark-wood roulette wheel set into one end. The wheel shows its
alternating red and black numbered pockets and a brass central cone. Brass rail around the
table edge. Rich dark wood base.

Chunky pixel clusters, flat color fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

CRITICAL REQUIREMENTS:
- Exactly ONE object, floating in empty space. No floor, no carpet, no walls, no chairs, no
  other furniture, no people, no background scene of any kind.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette, no
  drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO rim lighting, NO lens flare.
  Light nothing up. Richness comes from brass, dark wood, and green felt color only.
- The object occupies a footprint of 2x2 isometric tiles and should read as wider than it is
  tall.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 2 — Poker Table (`poker-table.png`)

```
Isometric pixel art of a casino poker table, in the style of RollerCoaster Tycoon (1999).
Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above horizontal, drawn
on a 2:1 isometric grid.

A classic oval poker table: dark green felt top with a padded black leather armrest rail
around the edge, a small dealer's chip tray at one end, and a scattering of chips and two
face-down playing cards on the felt. Dark wood pedestal base.

Chunky pixel clusters, flat color fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

CRITICAL REQUIREMENTS:
- Exactly ONE object, floating in empty space. No floor, no carpet, no walls, no chairs, no
  other furniture, no people, no background scene of any kind.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette, no
  drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO rim lighting, NO lens flare.
  No overhead lamp. Richness comes from felt, leather, and wood color only.
- The object occupies a footprint of 2x2 isometric tiles and should read as wider than it is
  tall.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 3 — Big Six Wheel (`big-six-wheel.png`)

```
Isometric pixel art of a casino Big Six money wheel (wheel of fortune), in the style of
RollerCoaster Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30
degrees above horizontal, drawn on a 2:1 isometric grid.

A tall vertical wheel mounted upright on a slim dark-wood floor stand. The wheel face is
divided into many narrow wedge segments in alternating red, blue, yellow and white, each
marked with a payout number, with a leather flapper pointer at the top. Round bulbs are
spaced around the wheel's outer rim.

Chunky pixel clusters, flat color fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

CRITICAL REQUIREMENTS:
- The rim bulbs must be drawn as FLAT PAINTED DOTS with hard edges, like switched-off bulbs.
  They must NOT glow, emit light, or have any halo or soft edge around them.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO rim lighting, NO lens flare.
- Exactly ONE object, floating in empty space. No floor, no carpet, no walls, no other
  furniture, no people, no background scene of any kind.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette, no
  drop shadow onto the background.
- The object occupies a footprint of only 1x1 isometric tiles: it is NARROW and TALL, a
  vertical object roughly 1.5x taller than it is wide.
- High resolution: at least 1500 px on the long edge.
```

## Prompt 4 — High-Limit Table (`high-limit-table.png`)

```
Isometric pixel art of an opulent VIP high-limit casino gaming table, in the style of
RollerCoaster Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30
degrees above horizontal, drawn on a 2:1 isometric grid.

A luxurious semicircular card table, clearly more expensive than an ordinary one: deep
burgundy or royal purple felt, heavy ornate gold-and-brass trim around the rail, carved dark
mahogany base with gold inlay detailing, and tall stacks of high-denomination chips on the
felt. It should read instantly as the most expensive object in the casino.

Chunky pixel clusters, flat color fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

CRITICAL REQUIREMENTS:
- Convey luxury through ORNAMENT AND COLOR ONLY - gold trim, carved detail, rich fabric,
  inlay patterns. Do NOT convey it with light.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO rim lighting, NO lens flare,
  NO sparkles, NO shine highlights on the gold. Matte gold, not glowing gold.
- Exactly ONE object, floating in empty space. No floor, no carpet, no walls, no chairs, no
  velvet ropes, no other furniture, no people, no background scene of any kind.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette, no
  drop shadow onto the background.
- The object occupies a footprint of 2x2 isometric tiles and should read as wider than it is
  tall.
- High resolution: at least 2000 px on the long edge.
```

---

## Check before you send them over

Run this list against each PNG. Catching a miss here saves a full wiring cycle — three of the
four failure modes below have each already cost one on this project.

- [ ] **One object only.** No floor, walls, carpet, chairs, people, or any surrounding scene.
- [ ] **Background is flat uniform magenta** (or true alpha). Not a checkerboard, not a
      gradient, no vignette, no shadow cast onto it.
- [ ] **Zero glow.** No neon, no bloom, no halo, no light spill, no sparkle. Big Six bulbs are
      flat dots with hard edges. High-limit gold is matte, not shining.
- [ ] **Isometric angle matches** across all four, and matches the existing
      `blackjack-table.png` / `craps-table.png`.
- [ ] **Proportions match the footprint** — the three 2×2 tables read wide; the Big Six wheel
      reads narrow and tall.
- [ ] **Large enough** — 1500 px minimum on the long edge, 2000+ preferred for the tables.
- [ ] **Filenames exact** — `roulette-table.png`, `poker-table.png`, `big-six-wheel.png`,
      `high-limit-table.png`, dropped in `assets/`.

If a model refuses to drop the neon after two tries, it's usually the word "casino" driving it.
Swapping in "gaming parlor" or "card room" and adding "1970s daytime interior, no lighting
effects" tends to break the association.

## What happens after delivery

No action needed from you beyond dropping the files in `assets/`. The wiring is:

1. `scripts/optimize-sprites.mjs` — new `TARGETS` entries do background removal, content-bbox
   crop, and alpha-premultiplied downscale to ~2× display size. Flat magenta should need no
   `bgTolerance` override at all; that knob exists for the glow-bleed problem this brief is
   written to avoid.
2. `src/render/atlas.ts` — register `img-roulette-table`, `img-poker-table`,
   `img-big-six-wheel`, `img-high-limit-table`.
3. `src/data/objects.ts` — catalog entries carrying the `displaySize` values from the table at
   the top of this file.

Per the sprite contract, game logic never changes when art lands — only the manifest and
catalog. If a PNG turns out unusable, the procedural placeholder stays the automatic fallback
and the game remains fully playable, exactly as the Bar does today.
