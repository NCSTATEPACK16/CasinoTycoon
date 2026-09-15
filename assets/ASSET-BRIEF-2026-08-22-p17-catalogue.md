# Asset Brief — 14 New Games + Animation Layers (2026-08-22)

Order form for the P17 catalogue expansion
(`docs/superpowers/specs/2026-08-22-progression-catalog-highrollers-design.md`, Part B).
Companion to `ASSETS.md`, which holds the permanent sprite contract.

**Deliver to:** `assets/` (repo root), filenames exactly as in the table. We splice and
optimize into `public/sprites/` from there.

**This brief is different from the 2026-07-24 batch in one way that matters:** these
objects have to look *alive* when the player zooms in. That is not achieved with extra
art files — it is achieved by drawing the light-bearing parts a specific way so the
build pipeline can slice them into animated overlays. See **The animation contract**
below. Read it before generating anything; it changes how three of the fourteen prompts
have to be drawn, and it is not something a model will do by default.

---

## Delivery table

| File to deliver | Object id | Footprint | Final display size | Proportion | Generate at (long edge) |
| --- | --- | --- | --- | --- | --- |
| `penny-slots.png` | `penny-slots` | 1×1 | 72 × 120 px | 1.7× taller than wide | 1500 px |
| `pachinko.png` | `pachinko` | 1×1 | 78 × 140 px | 1.8× taller than wide | 1500 px |
| `keno-lounge.png` | `keno-lounge` | 2×2 | 220 × 200 px | roughly square | 2000 px |
| `video-poker.png` | `video-poker` | 1×2 | 170 × 180 px | roughly square | 2000 px |
| `sic-bo.png` | `sic-bo` | 2×2 | 220 × 158 px | 1.4× wider than tall | 2000 px |
| `three-card-poker.png` | `three-card-poker` | 2×2 | 220 × 150 px | 1.45× wider than tall | 2000 px |
| `pai-gow.png` | `pai-gow` | 2×2 | 220 × 150 px | 1.45× wider than tall | 2000 px |
| `bingo-hall.png` | `bingo-hall` | 4×3 | 385 × 260 px | 1.5× wider than tall | 3000 px |
| `sports-book.png` | `sports-book` | 3×2 | 275 × 250 px | 1.1× wider than tall | 2500 px |
| `baccarat-pit.png` | `baccarat-pit` | 2×2 | 220 × 170 px | 1.3× wider than tall | 2000 px |
| `french-roulette.png` | `french-roulette` | 2×2 | 220 × 150 px | 1.45× wider than tall | 2000 px |
| `poker-room.png` | `poker-room` | 3×3 | 330 × 230 px | 1.45× wider than tall | 2500 px |
| `salon-prive.png` | `salon-prive` | 3×3 | 330 × 250 px | 1.3× wider than tall | 2500 px |
| `sky-lounge.png` | `sky-lounge` | 3×3 | 330 × 290 px | 1.15× wider than tall | 2500 px |
| `video-poker-alt.png` | *(screen strip)* | — | — | 3 panels in a row | 1800 px wide |
| `sports-book-alt.png` | *(screen strip)* | — | — | 3 panels in a row | 1800 px wide |

Display sizes are the *final on-screen* px, calibrated against the shipped
`blackjack-table.png` (220×161) and `slot-machine.png` (77×130). **Never generate at the
final size** — `npm run optimize-sprites` downscales to ~2× display, and that downscale is
what produces clean edges.

---

## The three rules that have broken past deliveries

Each of these has already cost a full regeneration cycle on this project.

### 1. NO NEON, NO GLOW, NO BLOOM

This is the hard one, because "casino" pulls image models straight toward neon, and this
batch is full of objects that in real life are covered in lights.

**Why it matters technically:** a glow is a soft gradient that bleeds outward into the
background. Our background-removal pass flood-fills inward from the border, matching
against sampled background colour. A glow halo has no clean boundary, so the fill either
leaks across the whole canvas or, at raised tolerance, starts eating the sprite's own
shaded surfaces. `restroom.png`, `plant.png` and `food-stall.png` each needed hand-bisected
per-file tolerance values (45, 30, 30) because of exactly this.

**Also:** the game applies bloom as a camera-level post-process over the whole composited
frame. Glow baked into a sprite gets bloomed *again* at runtime and smears into a blob.

Say it explicitly in the prompt: **no neon tubes, no glowing signage, no light bloom, no
emissive halo, no lens flare, no rim light.**

**Lights are still drawn — they are drawn as paint.** A lit bulb is a hard-edged flat disc
of bright colour with a darker ring. A lit screen is a flat rectangle of bright colour
with a hard bezel. Zero glow radius, zero falloff, zero soft edge. The game supplies the
liveliness by animating them; the art supplies only the shape and the colour.

### 2. ONE ISOLATED OBJECT — not a scene, and not a sheet

The single most common failure, in two flavours:

- `restroom.png` and `food-stall.png` were first delivered as in-context room mockups —
  the object on carpet with slot machines and walls around it. Unusable: there is no
  non-arbitrary way to crop one object out of a scene. Both were regenerated.
- `big-six-wheel.png` was delivered as a **2-up sheet** — a 3/4 iso view *and* a straight-on
  front view side by side. Only one matched the game's projection; the pipeline carries a
  hardcoded `preCrop` to this day to throw the other half away.

Deliver **exactly one object, in exactly one view**, floating, nothing else in frame. No
floor, no carpet, no walls, no other furniture, no background room, no cast shadow on a
surface, no human figures, no second angle, no size-comparison view, no caption.

The 3×3 and 4×3 objects (`poker-room`, `salon-prive`, `sky-lounge`, `bingo-hall`) are the
ones most at risk here, because they *sound* like rooms. They are single pieces of
furniture with a low decorative surround — a railed enclosure, a platform, a low partition
— not architecture with a floor plan.

### 3. FLAT MAGENTA BACKGROUND — not a checkerboard

Ask for a **solid, uniform `#FF00FF` magenta background**. It appears nowhere in the
artwork, so the flood-fill separates it on the first try with no tolerance bisection. The
2026-07-24 batch proved this out: four files, zero `bgTolerance` overrides. If the model
can output genuine alpha, better still, but they usually cannot.

Explicitly reject: checkerboards, gradient backgrounds, vignettes, drop shadows onto the
background, "studio backdrop" lighting.

### 3b. Leave the bottom-right corner empty

Gemini stamped a watermark at roughly `x2510..2816, y1230..1400` on three of the four
files in the last batch, and the pipeline carries a hardcoded `preErase` rect for it.
Ask for **the bottom-right corner of the canvas — 15% of the width by 15% of the height —
to be pure empty background with no artwork in it.** Then a watermark costs nothing: it
gets erased with the background it sits on, no measuring, no per-file rect.

---

## The animation contract

This is the part that makes an object look alive when zoomed in, and it is new to this
brief. **Read it before generating the keno, video-poker, bingo, sports-book, pachinko,
french-roulette and penny-slots prompts** — those seven are the ones it constrains.

### How "alive" actually works here

There are no animation frames, no sprite sheets, no per-frame art. The shipped slot
machine blinks its marquee, pulses three side-light banks out of phase, and pops a
jackpot on its reel — all from **one delivered PNG**. The build does this:

1. Crops a named rectangle out of the delivered art, at full brightness, into its own
   sibling texture (`slot-machine-lights-a.png`, 33×11 px).
2. Multiplies that same rectangle **in the base image** down to ~34% brightness.
3. At runtime, draws the bright crop on top of the dim base and alpha-tweens it.

Measured on the shipped art: base pixel `[14,7,5]` under overlay pixel `[40,22,15]` — a
clean ×2.9. Fading the overlay in and out *is* the light turning on and off.

The consequence for you: **draw every light in its fully-ON state, at full brightness, as
flat paint.** Do not draw anything half-lit, do not draw an "attract mode", do not try to
show a light mid-blink. The pipeline derives the OFF state. Art that arrives pre-dimmed
gives us a dim overlay and a *very* dim base, and the blink disappears.

The same trick drives the roulette and big-six wheels: an elliptical crop of the wheel
face is rotated in place over an unmodified base, so the stand, rail and pointer stay put
while the disc spins.

### Rule A — the light-box rule

Every element intended to animate has to be croppable as an **axis-aligned rectangle**.
So:

- Put each light group inside a **tight rectangle that contains nothing which must stay
  bright.** A bulb strip running diagonally across a cabinet cannot be cropped without
  taking the cabinet with it — run it straight, vertically or horizontally.
- Separate distinct light groups by at least **2% of the image's long edge** of ordinary
  non-light artwork, so a crop boundary can be drawn between them without clipping either.
- Where a **sequence** is wanted (chasing bulbs, a board lighting row by row), lay the
  lights out in **3 or 4 evenly-spaced parallel bands of equal height**, with a visible
  gap between bands. Each band becomes one crop and one tween phase. Uneven, organic
  scattering cannot be sequenced.
- Give lights a **hard dark ring or bezel** so the crop edge lands on dark pixels. A light
  that fades to the surrounding surface has no clean box.

### Rule B — the spinner rule

Anything that rotates — a roulette wheel, a bingo ball cage, a pachinko drum — must be:

- A **complete, unoccluded circle.** Nothing may cross in front of it. The pointer, flapper,
  rail, hub arm and any frame belong to the static base and must sit **entirely outside the
  circle's bounding box**, or above it, never overlapping.
- **Centred in its own square-ish region**, with a margin of plain surface around it.
- **Radially symmetric** in its decoration — alternating wedges, evenly spaced pockets, a
  ring of numbers. Rotation reads as spin only if the pattern is rotationally regular. A
  wheel with one big logo on it reads as a picture being spun.
- Drawn **as close to a true circle as the isometric view allows.** This is a deliberate
  cheat: the shipped roulette disc is a 110×82 ellipse, and rotating an ellipse in 2D
  wobbles. Flatten the perspective on the wheel face specifically — round it up toward a
  circle — even though the rest of the object stays in strict iso.

### Rule C — the screen rule

Any video screen, odds board or keno board must be:

- A **flat rectangle with a hard 1-px bezel**, presented straight-on within the isometric
  plane (parallel to one of the two iso axes), not tilted and not curved.
- Filled with content at **full brightness** on a dark screen ground.
- Free of anything overlapping it — no glare streak, no reflection sweep, no bezel glow.

### Rule D — scale consistency with the shipped tables

This is what makes the new games sit *seamlessly* beside the old ones. The card-dealing FX
draws real card and chip sprites onto the felt at fixed proportions. If the art's printed
felt features are a different scale, the animated pieces look like they belong to a
different game. Calibrated against the shipped tables:

- A **playing card** printed on the felt should be about **3% of the image width** wide and
  **4%** tall.
- A **casino chip** should be about **1.8% of the image width** in diameter.
- A **betting circle or box** on the felt should be about **5–6% of the image width** across
   — big enough to hold a card without spilling over.

### Rule E — clean felt on any table that gets dealing animation

`poker-table.png` and `high-limit-table.png` shipped with chips and cards **painted onto
the felt**, and the pipeline had to patch those regions back to plain felt so the animated
cards had somewhere clean to land. Do not repeat it.

On `three-card-poker`, `pai-gow`, `baccarat-pit`, `poker-room`, `salon-prive` and
`sky-lounge`: draw the betting circles and the printed layout, **but no loose cards and no
chips lying on the felt.** The dealer's chip tray and the chip rack are fine — those are
fixtures, they sit outside the betting spots, and they never move.

### Per-object animation plan

What each object gets, so the artwork is drawn to support it:

| Object | Animated regions | Driven by |
| --- | --- | --- |
| `penny-slots` | top marquee band; two vertical side bulb strips; reel window | slot-machine pattern |
| `pachinko` | 3 horizontal playfield bands; digital score panel | light bands |
| `keno-lounge` | number board in 4 horizontal bands; ball-blower dome | light bands + spinner |
| `video-poker` | 3 screens; button row under each; header sign | screens + alt strip |
| `sic-bo` | 3 bands of the printed layout; dice dome | light bands |
| `three-card-poker` | — (dealing FX only) | card/chip overlay |
| `pai-gow` | — (dealing FX only) | card/chip overlay |
| `bingo-hall` | number board in 4 bands; ball cage | light bands + spinner |
| `sports-book` | screen wall; odds board in 3 bands | screens + alt strip |
| `baccarat-pit` | scoreboard panel | light band + dealing FX |
| `french-roulette` | wheel face | spinner |
| `poker-room` | — (dealing FX only) | card/chip overlay |
| `salon-prive` | chandelier bulb ring; door sign panel | light bands + dealing FX |
| `sky-lounge` | window wall skyline | light band + dealing FX |

---

## Shared style preamble

Every prompt below already includes this. For reference, the house style is:

> Isometric pixel art in the style of RollerCoaster Tycoon (1999) / Theme Park. Viewed from
> a fixed front-left 3/4 isometric angle, roughly 30° above horizontal, drawn on a 2:1
> isometric diamond grid (128 × 64 px per tile). Chunky pixel clusters, flat colour fills,
> simple hard-edged dithered shading, no anti-aliasing, no outline, no gradients. Dark
> casino interior palette — the game's floors are charcoal and plum, so objects must read
> against a dark ground.

The isometric angle must match across all fourteen **and** match the shipped
`blackjack-table.png` / `craps-table.png` / `roulette-table.png`.

**On lettering:** assume every word will be downscaled to near-illegibility (the Big Six
wheel's hub reads "CASINO LOGO" at 81×140 and nobody can tell). Use short words in big
chunky high-contrast letters, and never rely on text to say what the object is — the
silhouette and colour have to do that alone.

---

# Tier 1 — throughput

## Prompt 1 — Penny Slots (`penny-slots.png`)

```
Isometric pixel art of a small, cheap penny slot machine cabinet, in the style of
RollerCoaster Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30
degrees above horizontal, drawn on a 2:1 isometric grid.

A short, stubby, budget slot cabinet — visibly cheaper and smaller than a full-size
machine. Scuffed cream and faded orange plastic housing, a chrome pull handle on the right
side, a coin tray at the bottom, and a three-reel window in the middle showing cherry and
bar symbols. A rectangular illuminated sign panel across the very top reading "1c". A
straight vertical strip of round bulbs down each side of the cabinet.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The top sign panel must be a flat horizontal rectangle spanning the full cabinet width,
  with a hard dark border, drawn at FULL BRIGHTNESS.
- The two side bulb strips must run PERFECTLY VERTICALLY, be the same width, and be
  divided into 3 evenly spaced groups of bulbs with a visible dark gap between groups.
- Each bulb is a hard-edged flat bright disc with a dark ring around it. No glow.
- The three-reel window must be a plain flat rectangle with a hard bezel, with nothing
  overlapping it.
- All of these are drawn fully ON, at full brightness, as flat paint.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no other machines, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare. The bulbs and sign are FLAT PAINTED SHAPES with hard edges.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- Proportions: a narrow upright object, about 1.7 times taller than it is wide.
- High resolution: at least 1500 px on the long edge.
```

## Prompt 2 — Pachinko Machine (`pachinko.png`)

```
Isometric pixel art of a Japanese pachinko machine, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A tall narrow upright cabinet with a large vertical glass playfield facing the viewer. The
playfield is covered in a regular grid of small metal pins with a scattering of silver
balls resting among them, painted in bright red, blue and yellow decorative panels behind
the pins. A small square digital score panel sits at the top of the playfield showing three
numerals. A chrome ball tray runs across the bottom, and a round chrome launch knob sits at
the lower right.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The playfield must be divided into 3 HORIZONTAL BANDS of equal height, separated by a
  visible dark horizontal divider strip. Each band has its own colour of backing panel.
  The bands must be straight, level, and span the full playfield width.
- The digital score panel must be a flat rectangle with a hard dark bezel and nothing
  overlapping it, drawn at full brightness.
- Everything bright is drawn fully ON, at full brightness, as flat paint.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no walls, no other
  machines, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare. The lit panels are FLAT PAINTED RECTANGLES with hard edges.
- No reflection sweep, glare streak or shine on the glass playfield — the glass is
  indicated by a hard-edged pixel highlight at one corner only, or not at all.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- Proportions: a narrow upright object, about 1.8 times taller than it is wide.
- High resolution: at least 1500 px on the long edge.
```

## Prompt 3 — Keno Lounge (`keno-lounge.png`)

```
Isometric pixel art of a casino keno lounge station, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A low padded lounge counter in dark wood and burgundy vinyl, with a large flat keno results
board mounted on a post rising behind it. The board is a dark panel printed with a grid of
80 small numbered circles in 4 rows of 20, drawn in bright yellow on black. A round glass
ball-blower dome sits on the counter at one end, containing numbered ping-pong balls. Keno
paper slips and a cup of crayons sit on the counter surface.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers — this object's board is
the main event and must be drawn exactly as described):
- The number board must be a FLAT RECTANGLE presented straight-on, parallel to one
  isometric axis, with a hard dark bezel. Not tilted, not curved, not angled away.
- The 80 numbers must sit in 4 STRAIGHT HORIZONTAL ROWS of equal height, with a clear dark
  horizontal gap between each row. Rows must be level and span the same width.
- Every number circle is drawn LIT: a hard-edged flat bright yellow disc with a dark ring,
  full brightness, no glow, no falloff.
- The ball-blower dome must be a COMPLETE UNOCCLUDED CIRCLE with nothing crossing in front
  of it, centred in its own square area with clear margin around it, and the balls inside
  arranged evenly so it reads the same at any rotation. Its base, tube and frame must sit
  entirely OUTSIDE the circle, below it.
- Draw the dome as close to a true circle as possible, even though the rest of the object
  is in strict isometric perspective.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no chairs, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO light spill from the board onto the counter. The board is a FLAT PAINTED
  RECTANGLE of bright dots on black.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 2x2 isometric tiles: roughly square overall, the board raised behind
  a wider low counter.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 4 — Video Poker Bank / Jacks or Better (`video-poker.png`)

```
Isometric pixel art of a bank of three video poker machines, in the style of
RollerCoaster Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30
degrees above horizontal, drawn on a 2:1 isometric grid.

Three identical upright video poker cabinets bolted side by side into one unit, sharing a
single continuous base and a single continuous sign header across the top reading "JACKS OR
BETTER" in chunky white letters on dark blue. Each cabinet has a rectangular screen showing
five playing cards face up in a row on a dark blue-green screen ground, and below each
screen a row of five square coloured buttons (yellow, red, yellow, red, yellow). Brushed
steel and dark blue plastic housing, a coin tray along the bottom.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The three screens must be IDENTICAL IN SIZE, evenly spaced, level with each other, and
  each a flat rectangle with a hard dark bezel, presented straight-on and parallel to one
  isometric axis. Nothing may overlap any screen — no glare, no reflection, no bezel glow.
- There must be a clear band of plain cabinet housing between each screen, at least as wide
  as one card, so each screen can be cropped separately.
- The five cards on each screen sit in ONE STRAIGHT HORIZONTAL ROW, evenly spaced, all the
  same size, all fully visible, none overlapping.
- The button row under each screen must be a straight horizontal strip of equal-sized
  square buttons with a dark gap above and below it.
- The header sign must be one flat horizontal rectangle spanning the full width of the unit,
  with a hard dark border.
- Screens, buttons and header are all drawn fully ON, at full brightness, as flat paint.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no stools, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO screen glow spilling onto the cabinet. Screens are FLAT PAINTED
  RECTANGLES with hard bezels.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 1x2 isometric tiles: roughly square overall, a compact bank standing
  upright.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 4b — Video Poker screen strip (`video-poker-alt.png`)

*Second file. This is what makes the hand actually change instead of just brightening. It
does **not** need to be pixel-identical to anything — only the same shape and style as one
screen in the base art.*

```
Three separate flat rectangular video poker screen images, laid out side by side in a
single row, in the style of RollerCoaster Tycoon (1999) pixel art.

Each panel is just the SCREEN CONTENTS — a dark blue-green screen ground with five playing
cards face up in one straight horizontal row, evenly spaced, all the same size, none
overlapping. No cabinet, no housing, no bezel, no buttons, no frame. Each panel is a plain
rectangle presented straight-on, not in perspective.

The three panels show three different poker hands:
1. A pair of jacks, with three unrelated low cards.
2. A full house — three of a kind plus a pair.
3. A royal flush in hearts — ten, jack, queen, king, ace.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

CRITICAL REQUIREMENTS:
- All three panels must be exactly the same width and height as each other, level with each
  other, in one straight horizontal row.
- Separate the panels with a wide gutter of solid magenta (#FF00FF) — at least 40 px —
  and surround the whole row with the same solid magenta background.
- Each panel is a plain rectangle about 1.6 times wider than it is tall.
- Absolutely NO glow, NO bloom, NO screen glare, NO reflection, NO scanlines, NO curvature.
  Flat paint only.
- No cabinet, no bezel, no border, no labels, no caption text outside the panels.
- High resolution: at least 1800 px wide overall.
```

---

# Tier 2 — the working floor

## Prompt 5 — Sic Bo Table (`sic-bo.png`)

```
Isometric pixel art of a casino sic bo dice table, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A rectangular gaming table with a bright blue felt top printed with the sic bo betting
layout — a dense grid of rectangular betting cells showing dice combinations and payout
numbers, in white and yellow on blue. A small chrome-and-glass dice shaker dome sits at the
dealer's end containing three white dice. Padded black leather armrest rail around the
edge, dark wood base, and a dealer's chip rack at the dealer end.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The printed betting layout must be organised into 3 STRAIGHT HORIZONTAL BANDS of roughly
  equal height, separated by a visible darker divider line running the full width of the
  layout. Bands must be level and parallel — no diagonal or radial arrangement.
- Each betting cell has a hard-edged bright border. Drawn fully ON, at full brightness.
- The dice shaker dome must be a COMPLETE UNOCCLUDED CIRCLE with nothing crossing in front
  of it, with clear margin around it, and its stand entirely outside and below the circle.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no chairs, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO overhead lamp.
- No loose chips and no loose dice on the felt — the dice live inside the dome and the
  chips live in the dealer's rack. The felt layout itself must be clean and unobstructed.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 2x2 isometric tiles: about 1.4 times wider than it is tall.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 6 — Three-Card Poker (`three-card-poker.png`)

```
Isometric pixel art of a three-card poker casino table, in the style of RollerCoaster
Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A compact semicircular card table with royal blue felt. Printed on the felt in white and
gold: FOUR player positions arranged in an even arc along the curved player edge, each
position showing three labelled betting circles in a row (ANTE, PLAY, PAIR PLUS). A curved
dealer's chip rack and a card shoe sit at the flat dealer edge. Padded black leather
armrest rail around the curved edge, dark wood base.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (the game draws animated cards and chips onto this felt):
- Exactly FOUR player positions, evenly spaced along the arc, all the same size.
- Each betting circle must be an empty flat ring printed on the felt, clearly visible, and
  about 5% of the image width across.
- The felt must be CLEAN: no loose playing cards, no chip stacks, no dice anywhere on the
  playing surface. Chips belong only in the dealer's rack at the dealer edge.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no chairs, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO overhead lamp.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 2x2 isometric tiles: about 1.45 times wider than it is tall.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 7 — Pai Gow Poker (`pai-gow.png`)

```
Isometric pixel art of a pai gow poker casino table, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A broad oval card table with deep jade green felt and a red-and-gold oriental border
pattern printed around the rim. Printed on the felt: SIX player positions evenly spaced
around the outer edge, each showing one large betting circle with a smaller "HIGH" and
"LOW" hand box printed above it. A dealer's chip rack, a card shoe and a small dice cup
containing three dice sit at the dealer position. Padded black leather armrest rail, dark
lacquered wood base with gold trim.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (the game draws animated cards and chips onto this felt):
- Exactly SIX player positions, evenly spaced around the oval, all the same size.
- Each betting circle must be an empty flat ring printed on the felt, about 5% of the image
  width across.
- The felt must be CLEAN: no loose playing cards, no chip stacks on the playing surface.
  Chips belong only in the dealer's rack.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no chairs, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO overhead lamp. Richness comes from felt, lacquer and gold colour only —
  matte gold, never shining gold.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 2x2 isometric tiles: about 1.45 times wider than it is tall.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 8 — Bingo Hall (`bingo-hall.png`)

```
Isometric pixel art of a casino bingo hall station, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A long low bank of twelve bingo player desks in two rows of six, in pale wood with red
vinyl edging, each desk carrying a printed bingo card and a dauber pen. Behind them, raised
on a low platform, stands a caller's podium with a wire-cage bingo ball tumbler on it and a
large flat number board mounted on a post above and behind the podium. The number board is
a dark panel printed with a grid of small numbered circles in 4 rows, drawn in bright
yellow on black, with the letters B I N G O down the left edge.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The number board must be a FLAT RECTANGLE presented straight-on, parallel to one
  isometric axis, with a hard dark bezel. Not tilted, not curved.
- Its numbers must sit in 4 STRAIGHT HORIZONTAL ROWS of equal height with a clear dark gap
  between rows. Rows level, same width, evenly spaced.
- Every number is drawn LIT: a hard-edged flat bright yellow disc with a dark ring, full
  brightness, no glow.
- The ball tumbler cage must be a COMPLETE UNOCCLUDED CIRCLE with NOTHING crossing in front
  of it. Its crank handle, axle mounts and frame must sit entirely OUTSIDE the circle's
  bounding box, to the sides or below — never over it. The wire mesh and the balls inside
  must be evenly and radially distributed so the cage reads the same at any rotation.
- Draw the tumbler as close to a true circle as possible even though the rest of the object
  is in strict isometric perspective.

CRITICAL REQUIREMENTS:
- This is ONE PIECE OF FURNITURE, not a room. No floor, no carpet, no walls, no ceiling, no
  architecture, no doorways, no people. The desks, podium and board are a single connected
  unit floating in empty space.
- Exactly ONE object in ONE view. No second angle, no caption, no floor plan.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO light spill from the board onto the desks.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 4x3 isometric tiles: a large wide object, about 1.5 times wider than
  it is tall.
- High resolution: at least 3000 px on the long edge.
```

## Prompt 9 — Sports Book (`sports-book.png`)

```
Isometric pixel art of a casino sports book counter, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A dark wood betting counter with three brass-grilled teller windows, and behind it a wall
unit carrying a grid of six flat television screens in two rows of three, each showing a
simple blocky green sports pitch or a race track. Beneath the screens runs a long dark odds
board printed with rows of white and yellow team names and numbers. Racing forms and pens
sit on the counter.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The six screens must be IDENTICAL IN SIZE, in 2 straight rows of 3, evenly spaced, level
  with each other, each a flat rectangle with a hard dark bezel presented straight-on and
  parallel to one isometric axis. A clear band of dark wall between every screen.
- Nothing may overlap any screen — no glare, no reflection sweep, no bezel glow.
- The odds board must be split into 3 STRAIGHT HORIZONTAL BANDS of equal height with a
  visible dark divider line between them, spanning the full board width.
- Screens and odds board are drawn fully ON, at full brightness, as flat paint on a dark
  ground.

CRITICAL REQUIREMENTS:
- This is ONE PIECE OF FURNITURE, not a room. The counter and the screen wall behind it are
  a single connected unit floating in empty space. No floor, no carpet, no side walls, no
  ceiling, no architecture, no people.
- Exactly ONE object in ONE view. No second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO screen glow spilling onto the counter.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 3x2 isometric tiles: about 1.1 times wider than it is tall.
- High resolution: at least 2500 px on the long edge.
```

## Prompt 9b — Sports Book screen strip (`sports-book-alt.png`)

*Second file, same purpose as the video poker strip: it lets the wall actually change what
it is showing rather than just brighten.*

```
Three separate flat rectangular television screen images, laid out side by side in a single
row, in the style of RollerCoaster Tycoon (1999) pixel art.

Each panel is just the SCREEN CONTENTS on a dark screen ground — no television set, no
housing, no bezel, no frame, no stand. Each panel is a plain rectangle presented
straight-on, not in perspective.

The three panels show:
1. A simple blocky green football pitch seen from above, with white line markings and a few
   tiny coloured player dots.
2. A brown oval horse racing track with a white rail and four tiny horse silhouettes.
3. A plain dark results screen filled with rows of white and yellow numbers and short
   team abbreviations.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

CRITICAL REQUIREMENTS:
- All three panels must be exactly the same width and height as each other, level with each
  other, in one straight horizontal row.
- Separate the panels with a wide gutter of solid magenta (#FF00FF) — at least 40 px — and
  surround the whole row with the same solid magenta background.
- Each panel is a plain rectangle about 1.4 times wider than it is tall.
- Absolutely NO glow, NO bloom, NO screen glare, NO reflection, NO scanlines, NO curvature.
  Flat paint only.
- No television housing, no bezel, no border, no labels, no caption text outside the panels.
- High resolution: at least 1800 px wide overall.
```

---

# Tier 3 — prestige

## Prompt 10 — Baccarat Pit (`baccarat-pit.png`)

```
Isometric pixel art of a high-stakes baccarat table, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A large kidney-shaped baccarat table with deep midnight blue felt and silver printed
layout. Printed on the felt: SEVEN player positions evenly spaced around the outer curve,
each with a numbered betting circle and small PLAYER / BANKER / TIE boxes. A card shoe and
a discard tray sit at the dealer notch, with a tall chip rack of high-denomination chips
behind it. A small flat scoreboard panel on a short post stands at one end of the table,
printed with a grid of red and blue result marks. Padded black leather rail, polished
dark rosewood base with brushed silver trim.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS:
- Exactly SEVEN player positions, evenly spaced, all the same size. Each betting circle is
  an empty flat ring about 5% of the image width across.
- The felt must be CLEAN: no loose playing cards, no chip stacks on the playing surface.
  Chips belong only in the dealer's rack.
- The scoreboard panel must be a FLAT RECTANGLE with a hard dark bezel, presented
  straight-on, parallel to one isometric axis, with nothing overlapping it, drawn at full
  brightness.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no chairs, no velvet ropes, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO overhead lamp, NO sparkles. Convey expense through ORNAMENT AND COLOUR
  ONLY — silver trim, carved detail, rich fabric. Matte silver, never shining silver.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 2x2 isometric tiles: about 1.3 times wider than it is tall.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 11 — French Roulette (`french-roulette.png`)

```
Isometric pixel art of a French roulette table, in the style of RollerCoaster Tycoon
(1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

An elegant oval roulette table, grander than a standard one: deep burgundy felt with the
full French betting layout printed in gold and white, including the racetrack oval for call
bets. A polished dark mahogany roulette wheel is set into one end. The wheel face shows a
regular ring of alternating red and black numbered pockets with a SINGLE green zero, a
brass central cone, and evenly spaced brass deflector studs. Ornate brass rail around the
table edge, carved mahogany base with gold inlay.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (the wheel face is cropped out and rotated — draw it accordingly):
- The wheel face must be a COMPLETE, UNOCCLUDED CIRCLE. Nothing may cross in front of it:
  no rail, no arm, no cone bracket, no chips, no ball track lip, no marker dolly. The
  surrounding wooden bowl, rail and table edge must sit entirely OUTSIDE the circle's
  bounding box.
- Draw the wheel face as close to a TRUE CIRCLE as you can, flattening the perspective on
  the wheel specifically, even though the rest of the table stays in strict isometric
  perspective. An oval wheel wobbles when rotated.
- The wheel decoration must be RADIALLY SYMMETRIC — evenly sized pockets, evenly spaced
  studs, a centred hub. No logo, no lettering, and no single feature that breaks the
  rotational regularity.
- Leave a clear margin of plain wooden bowl all the way around the wheel face.
- The felt layout must be CLEAN: no chips and no marker on the printed numbers.

CRITICAL REQUIREMENTS:
- Exactly ONE object in ONE view, floating in empty space. No floor, no carpet, no walls,
  no chairs, no people, no background scene, no second angle, no caption.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO overhead lamp, NO shine highlight on the brass. Matte brass, never
  glowing brass.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 2x2 isometric tiles: about 1.45 times wider than it is tall.
- High resolution: at least 2000 px on the long edge.
```

## Prompt 12 — Poker Room (`poker-room.png`)

```
Isometric pixel art of a dedicated casino poker room table, in the style of RollerCoaster
Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A large tournament-grade oval poker table set inside a low waist-high brass-post rail that
runs around it — a rail, not a wall. Dark green felt with a padded black leather armrest,
printed with EIGHT numbered player positions evenly spaced around the edge, a dealer notch
with a sunken chip tray, and a printed rectangle for the five community cards across the
centre. A small flat tournament clock panel is mounted on a short post at one end, showing
blocky numerals. Heavy carved dark wood pedestal base.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (the game draws animated cards and chips onto this felt):
- Exactly EIGHT player positions, evenly spaced, all the same size, each an empty flat
  printed betting ring about 5% of the image width across.
- The five community-card boxes must sit in ONE STRAIGHT ROW across the centre of the felt,
  evenly spaced, all the same size, all empty.
- The felt must be CLEAN: no loose playing cards, no chip stacks on the playing surface.
  Chips belong only in the dealer's sunken tray.
- The tournament clock panel must be a flat rectangle with a hard dark bezel, nothing
  overlapping it, drawn at full brightness.

CRITICAL REQUIREMENTS:
- This is ONE PIECE OF FURNITURE, not a room. The rail is a low freestanding barrier
  attached to the object. No floor, no carpet, no walls, no ceiling, no doorway, no
  architecture, no chairs, no people.
- Exactly ONE object in ONE view. No second angle, no caption, no floor plan.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO overhead hanging lamp.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 3x3 isometric tiles: about 1.45 times wider than it is tall.
- High resolution: at least 2500 px on the long edge.
```

## Prompt 13 — Salon Privé (`salon-prive.png`)

```
Isometric pixel art of an exclusive private casino salon, in the style of RollerCoaster
Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30 degrees above
horizontal, drawn on a 2:1 isometric grid.

A single opulent card table enclosed by a low ornate gold-and-glass partition screen that
wraps around three sides — a decorative screen, not a building. The table has deep royal
purple felt with FIVE printed betting positions, gold-leaf edge scrollwork, a padded
oxblood leather rail and a carved gilt base. A short brass post at the front corner carries
a small flat plaque panel reading "SALON PRIVE". Above the table, attached to a slim gold
arm rising from the partition, hangs a small crystal chandelier ring set with evenly spaced
round bulbs.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The chandelier bulb ring must be a horizontal band containing evenly spaced, identical,
  hard-edged flat bright bulbs, each with a dark ring. The band must be straight and
  level, with a clear dark gap above and below it, and nothing crossing through it.
- The plaque panel must be a flat rectangle with a hard dark border, nothing overlapping.
- Both are drawn fully ON, at full brightness, as flat paint. No glow of any kind.
- The felt must be CLEAN: exactly FIVE evenly spaced empty printed betting rings, each about
  5% of the image width across, with no loose cards and no chip stacks on the surface.

CRITICAL REQUIREMENTS:
- This is ONE PIECE OF FURNITURE plus its decorative surround, not a room. No floor, no
  carpet, no wall, no ceiling, no doorway, no architecture, no chairs, no people.
- Exactly ONE object in ONE view. No second angle, no caption, no floor plan.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO sparkles, NO shine on the gold, NO light cast from the chandelier onto the
  table. The chandelier bulbs are FLAT PAINTED DOTS with hard edges.
- Convey luxury through ORNAMENT AND COLOUR ONLY — matte gold, carved detail, rich fabric,
  inlay patterns. Never through light.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 3x3 isometric tiles: about 1.3 times wider than it is tall.
- High resolution: at least 2500 px on the long edge.
```

## Prompt 14 — Sky Lounge (`sky-lounge.png`)

```
Isometric pixel art of an elevated luxury casino sky lounge platform, in the style of
RollerCoaster Tycoon (1999). Viewed from a fixed front-left 3/4 isometric angle, about 30
degrees above horizontal, drawn on a 2:1 isometric grid.

A raised circular platform of black marble with two shallow gold-edged steps up to it. On
the platform stands a single small round card table with black felt and TWO printed betting
positions, plus one tall-backed leather lounge chair. Curving around the back of the
platform is a freestanding panoramic window screen — a tall glass panel in a slim brass
frame — showing a flat night city skyline in dark blue with a regular grid of small square
windows in yellow and white. The whole piece is the most expensive-looking object in the
casino.

Chunky pixel clusters, flat colour fills, hard-edged dithered shading, no anti-aliasing, no
outlines, no smooth gradients.

ANIMATION REQUIREMENTS (this art gets sliced into animated layers):
- The skyline window panel must be a FLAT RECTANGLE presented straight-on, parallel to one
  isometric axis, with a hard brass frame border and nothing overlapping it — no glare, no
  reflection sweep, no curtain, no plant in front.
- The little city windows inside it must be small, identical, hard-edged flat bright
  squares laid out on a REGULAR GRID, arranged so they fall into 3 clear horizontal bands
  with a darker band of building mass between each. Drawn fully ON, at full brightness.
- The city skyline is a flat painted backdrop panel, not a real view — no depth, no haze,
  no atmosphere, no moon, no stars.
- The felt must be CLEAN: exactly TWO empty printed betting rings, each about 5% of the
  image width across, no loose cards, no chip stacks.

CRITICAL REQUIREMENTS:
- This is ONE PIECE OF FURNITURE plus its decorative surround, not a room and not a
  building. The window is a freestanding screen attached to the platform. No floor beyond
  the platform, no carpet, no side walls, no ceiling, no architecture, no people.
- Exactly ONE object in ONE view. No second angle, no caption, no floor plan.
- Solid uniform magenta (#FF00FF) background. No checkerboard, no gradient, no vignette,
  no drop shadow onto the background.
- Absolutely NO neon, NO glow, NO bloom, NO emissive light, NO halo, NO rim lighting, NO
  lens flare, NO sparkles, NO shine on the marble or brass, NO light spill from the window
  onto the platform. The city windows are FLAT PAINTED SQUARES with hard edges.
- The bottom-right corner of the canvas, 15% of the width by 15% of the height, must be
  completely empty background with no artwork in it.
- The object occupies 3x3 isometric tiles: about 1.15 times wider than it is tall.
- High resolution: at least 2500 px on the long edge.
```

---

## Check before you send them over

Run this against every PNG. Catching a miss here saves a full wiring cycle — five of these
failure modes have each already cost one on this project.

**Every file:**

- [ ] **One object, one view.** No floor, walls, carpet, chairs, people, surrounding scene,
      second angle, size comparison, or caption.
- [ ] **Background is flat uniform magenta** (or true alpha). Not a checkerboard, not a
      gradient, no vignette, no shadow cast onto it.
- [ ] **Zero glow.** No neon, no bloom, no halo, no light spill, no sparkle, no lens flare.
      Every light is a flat painted shape with a hard edge.
- [ ] **Bottom-right corner is empty** — 15% × 15% of the canvas, pure background, so a
      watermark costs nothing.
- [ ] **Isometric angle matches** the shipped `blackjack-table.png` / `craps-table.png`.
- [ ] **Proportions match the delivery table.**
- [ ] **Large enough** — see the "generate at" column.
- [ ] **Filename exact**, dropped in `assets/`.

**Animated objects (`penny-slots`, `pachinko`, `keno-lounge`, `video-poker`, `sic-bo`,
`bingo-hall`, `sports-book`, `baccarat-pit`, `french-roulette`, `salon-prive`,
`sky-lounge`):**

- [ ] **Every light drawn fully ON at full brightness.** Nothing pre-dimmed, nothing
      mid-blink, no attract-mode state.
- [ ] **Light groups are croppable** — each sits in a tight axis-aligned rectangle
      containing nothing that must stay bright, with plain artwork between groups.
- [ ] **Sequenced lights are in 3–4 equal parallel bands** with visible gaps, level and
      straight — never diagonal, radial or scattered.
- [ ] **Screens and boards are flat rectangles**, straight-on, hard bezel, nothing
      overlapping them.
- [ ] **Rotating parts are complete unoccluded circles**, radially symmetric, centred with
      margin, with every arm/pointer/frame outside the circle's bounding box.

**Tables that get dealing FX (`three-card-poker`, `pai-gow`, `baccarat-pit`, `poker-room`,
`salon-prive`, `sky-lounge`):**

- [ ] **Felt is clean** — no loose cards, no chip stacks on the playing surface. Chips only
      in the dealer's rack or tray.
- [ ] **Seat count is exactly right** (4 / 6 / 7 / 8 / 5 / 2 respectively), evenly spaced,
      identically sized.
- [ ] **Betting rings are empty and visible**, about 5% of image width across.

If a model refuses to drop the neon after two tries, it is usually the word "casino"
driving it. Swapping in "gaming parlour" or "card room" and adding "1970s daytime interior,
no lighting effects" tends to break the association.

---

## What happens after delivery

No action needed beyond dropping the files in `assets/`. The wiring is:

1. **`scripts/splice-sprites.mjs`** *(new)* — slices the `-alt.png` strips into per-panel
   PNGs, the same one-time-intake role `splice-characters.mjs` plays for character sheets.
2. **`scripts/optimize-sprites.mjs`** — new `TARGETS` entries do background removal,
   content-bbox crop, and alpha-premultiplied downscale to ~2× display size. Flat magenta
   should need no `bgTolerance` override; that knob exists for the glow-bleed problem this
   brief is written to avoid.
3. **A new `lightLayers` pass** *(new, this batch)* — for each animated object, crop the
   named native-pixel boxes into sibling textures at full brightness, then multiply those
   same boxes in the base down to ~34%. This is the step that currently exists only as
   hand-made output for the slot machine; generalising it is what makes fourteen animated
   objects affordable instead of fourteen manual Photoshop jobs. The boxes get measured off
   the delivered art once and recorded next to the `TARGETS` entry, exactly like the
   existing `MARQUEE_BOX` / `REEL_BOX` / `LIGHTS_BOXES` constants in `slotMachineFx.ts`.
4. **`src/render/atlas.ts`** — register `img-<id>` for each base sprite plus every derived
   light/disc/screen sibling.
5. **`src/data/objects.ts`** — catalog entries carrying the `displaySize` values from the
   delivery table, plus this batch's new `unlock`, `prestigePoints` and `archetypeAffinity`
   fields.
6. **`src/render/views/ObjectViews.ts`** — wire each id to its FX class per the per-object
   animation plan above.
7. **`scripts/build-icons.mjs`** — each new id also needs an `IconName` from `lucide-static`
   for the Build panel. Not an art deliverable; noted so it does not get forgotten.

Per the sprite contract, game logic never changes when art lands — only the manifest and
the catalog. If a PNG turns out unusable, the procedural placeholder stays the automatic
fallback and the game remains fully playable, exactly as the Bar does today. **Balance work
does not wait on art:** ship placeholders for all fourteen first, per the spec's B1.
