# Track A: Alive. Make the floor look, move and sound like a real casino

Branch `v2-alive`, dev port 5175, launch config `v2-alive`. The shared rules are in [NEXT-SESSION.md](NEXT-SESSION.md); read them first, every iteration.

## Why this track exists

v2 plays, but it reads as a diorama:
- Guests walk and sit, slot toppers glow, and "+$10" labels float up.
- Nothing else moves, and there is no sound at all.
- Up close, a blackjack table has a dealer standing idle and a fixed prop of three white card boxes.
- When you sit down to play, you get a text form.

The user wants the casino to feel real in the lively stylized sense: the busy, warm, noisy room of a good tycoon game, not photorealism.

**Goal.** A 30-second capture, in the god view and at eye level, should read as a living casino:
- reels spin and stop, the roulette ball drops into the right pocket, dice tumble, cards land and chips stack
- dealers deal
- machines chime and the room hums
- light pools warm the carpet

**Non-goals:**
- photorealism
- a new UI framework or a physics engine
- changing economics
- tycoon features (Track B)

**Anti-goals** (failures even if the feature "works"):
- Breaking the performance budget.
- Sound that tires the ear within an hour: too loud, too many voices, or a loop you can hear repeating.
- Motion that contradicts the sim. Examples: a reel lands on a win that wasn't paid, a payout label appears before the reels stop, or the ball lands on a number that isn't the result.

## What exists today (audit, 2026-10-24; paths under `v2/`)

- **Lighting** (`src/render/Lighting.ts:38-125`):
  - HDRI at env intensity 0.45, one warm fitted-shadow sun, a hemisphere fill.
  - No point, spot or rect lights and no light probes anywhere.
- **Bloom:** global, on luminance above 1.05 (`src/render/Post.ts:51-59`). It isn't selective.
- **Quality:** High/Medium/Low exist and auto-step down (`src/render/Stage.ts:211-261`). No in-game toggle.
- **Ceiling:** coffers and chandeliers exist (`src/render/FloorLayer.ts:264-287`) but show only below 3.1 m (`Stage.ts:299-305`), so the god view never sees a light source.
- **Emissive surfaces:** palette slots (`src/render/assets/Palette.ts:66-80`). Shader terms (`src/render/materials/ObjectMaterial.ts:74-87`):
  - win flash: payout event → `Stage.spawnPayout` → `ObjectLayer.flashAt`
  - bulb chase: always on, ignores state
  - an unused hover term (`ObjectMaterial.ts:72`; `setHovered` is never called)
- **Surface flags** are Flash, Variant and Chase only (`Palette.ts:22-29`). There is no UV scroll.
- **Slot reels:** one static painted decal (`src/render/assets/Atlas.ts:43, 563`).
- **Static table hardware:** the roulette wheel (`assets/blender/heroes.py:404-408`), big-six face (`:433-434`) and two dice cubes (`:381-382`).
  - Blender joins each LOD into one object (`assets/blender/common.py:125-157`).
  - `AssetLibrary` flattens each GLB into one geometry per LOD (`src/render/assets/AssetLibrary.ts:115-162`).
  - So no sub-part can move today.
- **Cards and chips:** every card table has a fixed prop of three white card boxes and chip stacks (`heroes.py:167-172, 325-331`).
  - A `cardFace` decal is painted but unused (`Atlas.ts:64, 1054`).
  - `ObjectView.occupants` exists (`src/shared/contracts.ts:77`) but the renderer ignores it.
- **Crowd** (`src/render/Crowd.ts`, `assets/blender/human.py`):
  - One rigidly bound primitive body: ellipsoid head, a single hair cap, eyes on LOD0 only.
  - Variety: 12 outfits plus staff and avatar outfits, 8 skin and 8 hair colours. "Female" is just a shoulder/hip squash in the shader (`Crowd.ts:132-138`).
  - 8 clips: idle, walk, sit, play, cheer, sad, eat, deal.
  - Draw tiers: full VAT, reduced VAT, billboard.
- **Dealers never play `deal`:**
  - `Staff.anim` returns Play only for `working`/`brewing`, and stationed dealers map to Idle (`src/sim/entities/staff/Staff.ts:72-75`).
  - Dealers stand on the first free cell after the seats, not at the dealer edge (`Staff.ts:211-227`).
- **Guests ignore the Blender seat markers:**
  - They park at the cell centre plus 0.22 m (`src/sim/agents/seats.ts:9-40`); the markers in `catalog.ts` are used only for the avatar.
  - Every game uses a seated pose (`src/sim/entities/Guest.ts:213-218`), so craps players at the standing rail likely sit on air (inferred from code; not checked in the browser).
- **Table play is DOM only** (`src/ui/TablePlay.ts:275-335`):
  - Cards are CSS boxes and dice are Unicode glyphs; roulette shows "Ball lands on N"; slots show raw strip codes in a grid.
  - One bet per round from a dropdown. Roulette offers only straight, column, dozen and even-money bets, though the engine supports splits, streets and corners (`TablePlay.ts:20-26`).
  - The avatar is hidden while seated (`src/main.ts:128-136`).
- **No exterior:** no facade, windows or sky, and the entrance tile is never drawn. The outside is a dark 400 m plane (`Stage.ts:102-109`).
- **Doors** are gold-framed openings with no door leaves (`FloorLayer.ts:241-251`).
- **Built but unwired:**
  - the hologram ghost (`src/render/Overlays.ts` `showGhost`, no callers; `PlaceTool` still uses a translucent box)
  - the shader hover highlight
- **No audio of any kind:** no AudioContext and no audio files in v2.
- **v1 sounds:** 32 CC0 Kenney OGGs already in the repo at `../public/audio/`:
  - cards, chips, coins, dice, shuffle, jackpot, victory, failure, break, fixed
  - UI click, open, close, place, sell, hire, error, drop, pluck
- **The art pipeline runs headless** (no MCP needed):
  ```
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python assets/blender/heroes.py -- <asset keys>
  ```
  Conventions are at the top of `common.py`: front faces -Y, LOD0/1/2 empties, material suffixes `__flash`/`__chase`/`__variant`, `decal_<key>`, AO baked into vertex colour, and `seat_<n>` empties whose positions are copied into `catalog.ts` by hand. The VAT crowd comes from `human.py`.

## Design decisions already made (don't relitigate)

- **Round effects reach the client as events, filtered by interest.**
  - The client tells the worker which objects are near the camera: a new `setInterest {objectIds}` command, refreshed about twice a second.
  - For those objects only, the worker emits a `roundFx` event with real data: slot stops, roulette number, dice faces, big-six segment, and dealt cards per seat with bets.
  - Objects outside the interest set get no per-round data. They may run cosmetic motion keyed to `occupants` that never shows a result.
  - This keeps the snapshot small at 500 guests and 4× speed.
- **Visuals show sampled real rounds.** A guest visit plays a batch of rounds in one call (`playEngineRounds` in `src/sim/entities/machines/enginePlay.ts`, sized by `ENGINE_BALANCE.playShape`: blackjack 16 hands, high-limit 12, UTH 12, craps 10 rolls, roulette 2, slots 1). Each seat plays its own dealer hand. At 1× a table deals about a dozen hands every real second, so you can't show them all.
  - **Recording:** your `src/sim/fx/` module records the **last** round of each batch with its full data: stops, number, faces, segment, player and dealer cards, bet and result. It reaches `src/sim/fx/` through one call in `EngineGame`/`enginePlay`. Recording must not consume RNG or change outcomes; the economics guard proves it.
  - **Pacing:** each interest object animates one recorded round at a watchable pace, roughly 2–6 s depending on the game and shorter at 2× and 4×. When it finishes, it takes the newest recorded round and drops the rest.
  - **What follows the shown round:** for interest objects, the payout label, win flash and win sound follow the shown round's own result, at the moment the result is revealed. Objects outside the interest set keep today's per-visit payout labels.
  - **Card tables:** the felt shows one seat's round at a time with its dealer hand, because the sim gives each seat its own dealer hand. Show the avatar's seat if it is seated; otherwise cycle through the occupied seats. Other seats show only their chips.
  - **Evidence handle:** add an optional `lastRound` to the `inspect` reply (a `contract:` change) so the inspector, and your evidence, can read the round on screen.
- **Moving parts come out of Blender as named nodes.**
  - Export a moving part (reel band, roulette wheel head, ball, big-six wheel, dice) as a separate named mesh node under each LOD it appears in. Use names like `spin_wheel`, `spin_ball`, `reel_0..2`, `die_0..1`.
  - `AssetLibrary` loads named parts into their own instanced pools, so each part costs one extra draw call per asset type, not per object.
  - Use per-instance attributes for spin start time and target angle, and keep the motion maths in the shader where possible.
- **Audio uses WebAudio directly** unless you can justify a dependency. Requirements:
  - buses: master, sfx, ambience, ui
  - unlock on the first user gesture
  - positional sound relative to the active camera, with distance attenuation
  - a global voice cap and pooling
  - volumes saved in `localStorage` (wrapped in try/catch)

## Tasks (one per iteration, in order)

Each task lists what to build, then how to prove it. Tick it (✅) in this file with the evidence: test counts, screenshots described, fps, draw calls and triangles before → after.

- [x] ✅ **A0. Setup.**
  - Get onto branch `v2-alive`, cut from `origin/v2-playable`, in your own worktree. If this session already runs in one on that branch, keep it; otherwise use the EnterWorktree tool or `git worktree add`.
  - Run `npm install` in `v2/` and create `.claude/launch.json` with `v2-alive` on port 5175.
  - Confirm the dev server renders.
  - Push the branch and open the draft PR into `v2-playable` with this checklist.
  - In the same iteration, send the user one download request: the extra CC0 sounds A2 will need (room tone/crowd murmur, slot reel spin and stop, roulette ball roll and drop, coin hopper, soft lounge music bed). Give names, URLs, sizes and licences, Kenney packs first.
  - **Done 2026-10-24.**
    - The app's worktree branch was renamed to `v2-alive`. It sits at 7bf4122, which is `origin/v2-playable`.
    - `npm install` is done, and `npx tsc --noEmit` is clean.
    - `.claude/launch.json` has `v2-alive` on 5175. The dev server renders the title menu and, on Continue, the floor (195 draw calls, 99k triangles).
    - **Stress baseline** (in-browser furnishSandbox pattern through `place` commands: 1,971 objects, 90 staff, 500 guests; High, auto-quality pinned):

      | View | Draw calls | Triangles |
      |---|---|---|
      | Overview (76.8 m) | 287 | 304k |
      | Mid (30 m) | 132 | 642k |
      | Close (10 m) | 88 | 513k |

      Worker tick is 7.5–9 ms. fps could not be measured: the pane was hidden, so rAF ran at about 1 Hz. Later fps numbers need the pane visible.
    - **Download request sent to the user:** 13 freesound clips and Kenney Impact Sounds.
      - Every freesound page states CC0 (publicdomain/zero/1.0).
      - The freesound originals need a login, so the plan uses the public HQ OGG previews, trimmed and re-encoded with ffmpeg.
      - That comes to about 6.7 MB downloaded and about 2 MB kept, against the 8 MB audio budget.
      - The list is in the PR description. The approval is pending.

- [ ] **A1. Audio engine plus v1 sounds.**
  - Build `src/audio/` with the engine as designed above.
  - Copy the 32 v1 OGGs into v2 (served from `v2/public/audio/` or imported through Vite) and credit them in `v2/assets/CREDITS.md`.
  - Map existing events to sounds:
    - payouts: coin; big wins: jackpot
    - place, sell and hire
    - UI open, close, click and error
    - table play: cards, chips, dice and shuffle
  - Add a Settings panel (`src/ui/Settings.ts`). It opens from a gear button mounted into `#hud-slot-a` when that element exists (Track B adds it in B1), and otherwise from your own fixed-position button. The panel has:
    - master/sfx/ambience/ui volume, mute
    - graphics quality: Auto/High/Medium/Low, using the existing `Stage` quality API
  - **Evidence:**
    - unit tests for voice limiting, bus gain and settings persistence
    - in the browser: `AudioContext.state === 'running'` after a click, a per-sound play counter rising as payouts happen, volume sliders audibly changing gain (read the gain values), and quality switching the tier

- [ ] **A2. Dealers deal; guests sit and stand where the art says.**
  - Dealers stand at the table's dealer edge facing the players. They play `deal` while players are seated and `idle` when the table is empty.
  - Guests snap to the catalog seat markers (position and facing) instead of the cell centre plus 0.22 m.
  - Craps uses a standing pose at the rail: a standing `play` variant. Adding the clip to `human.py` and re-baking the VAT is allowed here.
  - **Evidence:**
    - economics guard green, with crowd metrics unchanged within noise
    - close-up screenshots of a full blackjack table and a full craps table showing the dealer at the dealer edge and players on their stools and at the rail

- [ ] **A3. Slot reels spin and stop on the real result.**
  - Blender: split the reel window into its own reel-band mesh or material with UVs laid out down the strip, in the slot and penny cabinets.
  - Atlas: paint vertical reel strips with the par sheets' real symbols (`src/sim/games/slots/sheets.ts`) instead of the static decal.
  - Shader or per-instance: a spin start time and target stop per reel, stopping left to right with a small overshoot and settle.
  - `roundFx` for slots carries the stops. Idle cabinets run an attract shimmer that never shows a winning line.
  - Sounds: spin, reel stops, win.
  - **Evidence:**
    - a unit test for the stop-timing maths
    - a sequence of browser screenshots showing a spin and a stop that matches the cabinet's `lastRound`
    - payout label held until the stop
    - stress scene before → after numbers, with draw calls up by no more than a couple per cabinet type

- [ ] **A4. Wheels and dice move.**
  - Roulette: the wheel head spins and decelerates. The ball orbits, drops, bounces and settles in the pocket of the real result, using the European or American pocket order from the layout.
  - Big six: the wheel stops on a segment showing what was actually paid, with the clapper ticking (sound). Big six still runs a `{p, multiplier}` table until Track B's B9 lands, so pick a segment whose payout matches the multiplier paid. After merge: use the exact segment B9's engine reports.
  - Craps: two dice arc from the shooter's spot, tumble and land showing the rolled faces. Scripted motion is fine; no physics engine.
  - **Evidence:**
    - unit tests for pocket angle and face orientation
    - screenshots of each at rest matching the inspector's result
    - stress scene numbers

- [ ] **A5. Live cards and chips on the felt.**
  - Use instanced card and chip pools; card faces come from the existing `cardFace` atlas.
  - For interest tables running card engines today (blackjack, high-limit blackjack, UTH), following the card-table rule above. After merge: three-card poker and pai gow once B9 gives them real engines.
    - chips appear on each occupied seat's betting circle, coloured by denomination and stacked by amount
    - cards are dealt from the shoe in the right order and land at the seat
    - the dealer's hole card flips
    - settled chips are paid or collected, then cleared
  - Remove the fixed white card boxes from the hero GLBs once real cards show.
  - Sounds: cards, chips, shuffle.
  - **Evidence:**
    - a unit test turning a `roundFx` into a deal sequence
    - close-up screenshots mid-hand and at settle that match the round's data
    - stress scene numbers

- [ ] **A6. Graphical table play for the avatar.**
  - Replace the DOM debug form with a proper play view:
    - the camera frames the felt from the player's seat, and the avatar stays visible in its seat
    - the real 3D cards, chips, wheel, dice and reels from A3–A5 show your own round
  - Betting:
    - a chip tray (denominations from the table's min and max)
    - click the layout to place several bets
    - roulette offers every bet the engine supports (straight, split, street, corner, six-line, column, dozen, even money)
    - clear, rebet and double
  - Slots: real reels, payline highlights, bet per line or lines.
  - DOM is for buttons and text only.
  - Make the view generic over `GameEngine` options and actions, so engines Track B adds later (B9) appear without per-game UI. Then enable avatar play for any engine that has seats; the gate is at `main.ts:97`.
  - Keep the wallet/onTable behaviour from playable.
  - **Evidence:**
    - existing `avatarPlay.test.ts` green, plus tests for bet-layout hit mapping
    - in the browser, one full round of each of the 5 core games through the new view, screenshots of each

- [ ] **A7. Ambience.** Use the A0 download if approved, or synthesize what was declined.
  - Room tone plus distant slot chatter plus crowd murmur, scaled by guest count and camera height (quieter and wider in the god view, close and detailed at eye level).
  - An optional low music bed on the ambience bus.
  - Zone-aware: the bar and food court sound different from the slot floor.
  - Paused (speed 0) ducks the ambience.
  - **Evidence:**
    - a unit test for the mix curve
    - in the browser: gain readings at god view versus eye level and at 0 versus 200 guests, plus a short listening note: no audible loop seam over 60 s

- [ ] **A8. Light you can see from the god view.**
  - Warm light pools under chandeliers and lamp posts, and over tables.
  - Coloured spill from slot banks and neon onto the carpet.
  - A few real point lights near the avatar camera (nearest N).
  - True selective bloom, so only emissive surfaces glow.
  - Approach is your call. One option: a per-chunk light texture splatted from fixture and emissive positions, rebuilt on `objectsVersion`/`floorVersion`.
  - **Evidence:** before and after god-view and eye-level screenshots, and stress scene numbers within budget.

- [ ] **A9. People who look like people.**
  - In `human.py`, add:
    - 4–6 hairstyles
    - skirt/dress and jacket silhouettes
    - a few hats
    - a simple face (eyes, brows, mouth) through the atlas
    - a real female body mesh
  - Bake them as VAT variants chosen per guest.
  - New clips: slot button press, chip place, croupier wheel spin, clap. Wire them where they apply.
  - **Evidence:**
    - close-up screenshot of 20 guests showing visible variety
    - VAT size within budget
    - 500 guests still inside the frame budget on the stress scene

- [ ] **A10. Art for the six pre-agreed decor items** (`statue`, `fountain`, `lamp-post`, `lounge-seating`, `atm`, `stage`):
  - Build them in `heroes.py`. A Poly Haven or Poly Pizza CC0 base is allowed after the user OKs the download; record it in CREDITS.md.
  - Use the footprints in NEXT-SESSION.md, and add seat markers for the lounge.
  - Fountain water scrolls; the lamp post and stage lights are emissive.
  - Catalog entries: add them with real `asset` keys if Track B's placeholders aren't merged yet. On merge, keep yours for art fields and B's for zones.
  - **Evidence:**
    - a screenshot of each in the render lab (`src/render/lab/`), because they can't be placed in the game until B6 adds their `data/objects.ts` definitions
    - LOD sizes within budget
    - After merge: a screenshot of each placed on the floor.

- [ ] **A11. Exterior, entrance, day and night, and unwired juice.**
  - A facade and an entrance canopy with marquee lettering.
  - Door leaves: glass entrance doors and interior doors that swing when an agent passes.
  - Pavement and street, a sky, and a day/night look outside tied to the HUD hour (the interior stays lit).
  - Draw the entrance tile.
  - Wire the hologram ghost into `PlaceTool`, and the shader hover highlight into the avatar's hover.
  - **Evidence:** god-view screenshots at noon and midnight, an eye-level screenshot of the entrance, and the ghost and hover shown working.

- [ ] **A12. Celebrations and life.**
  - Big wins (a payout of at least 50× the bet; your call) set off:
    - a beacon light on the machine
    - confetti particles
    - a bell
    - nearby guests cheering with the clip
  - Idle machines run an attract mode; broken machines go dark with a fault light.
  - Thought bubbles: sampled `thought` events for interest agents become icon sprites above heads. The icons come from the categories in `src/data/thoughts.ts`, read-only.
  - Fix the first-load LOD hitch and the third-person camera pressing into lobby walls (notes from playable).
  - **Evidence:** screenshots, stress scene numbers, and the hitch measured before → after.

- [ ] **A13. Finish.**
  1. Merge `origin/v2-playable` if it moved.
  2. Run the full suite under `caffeinate -i` and `npm run build`.
  3. Measure the stress scene.
  4. Take a screenshot set: god-view overview, eye-level slot bank mid-spin, roulette at rest, blackjack mid-hand, craps roll, entrance at night.
  5. Push and update the PR description with the checklist and evidence; take the PR out of draft.
  6. Report to the user and stop the loop.

## Requests to Track B

(Write here anything you need from Track B's files. Commit it and mention it in your report.)
