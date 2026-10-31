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
      - The list is in the PR description. The user approved it on 2026-10-25, and the files were downloaded and credited in A1.

- [x] ✅ **A1. Audio engine plus v1 sounds.**
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
  - **Done 2026-10-25.**
    - **Built:**
      - `src/audio/`:
        - `mix.ts`: bus gains, settings persistence, the distance model, and a listener that slides down the view ray in the god view.
        - `voices.ts`: a 24-voice limiter with per-sound caps and priority stealing, plus a token bucket.
        - `sounds.ts`: the catalog.
        - `AudioEngine.ts`: WebAudio buses master→sfx/ambience/ui, unlocked on the first gesture, positional voices, and gains glided on change.
        - `GameAudio.ts`: payout coin/jackpot sounds, positional and nearest first, at most 6 coins/s, with jackpots always ringing. Place/sell/hire/error come from command outcomes; open/close from the panels' `hidden` attribute; a click for each button.
      - `src/ui/Settings.ts`: volume sliders, mute, and quality Auto/High/Medium/Low, saved. With no `#hud-slot-a`, the gear floats bottom-left above the palette; top-right would cover the side panel's ✕.
      - `TablePlay.ts`: shuffle on sitting at a card game, chips on each bet, a card per newly visible card, dice per roll, the roulette ball, chips plus a win sting on a winning settle.
    - **Assets:**
      - The 32 v1 OGGs, plus the approved batch of 17 new files (Ogg Opus) in `v2/public/audio/`. That's 1.4 MB in all, against the 8 MB budget.
      - All 49 decode in the built-in browser, and the loop beds decode at exact lengths (crowd 15.5 s, murmur 18.2 s, lounge 51.2 s).
      - Credited in `v2/assets/CREDITS.md`.
    - **Big win** is a payout of at least $1,000 for now. The `payout` event carries no wager; A3's `roundFx` will, and A12 moves to 50× the bet.
    - **Tests:** `src/audio/{voices,mix}.test.ts` and `src/ui/Settings.test.ts` cover voice limiting, rate limiting, bus gain, mute, persistence (round trip, corrupt entries, throwing storage), attenuation and listener placement: 24 tests. With `avatarPlay.test.ts`: 33/33 across 4 files. `tsc` is clean.
    - **Browser (driven through the UI):**
      - After a real click on Continue, `AudioContext` is `running`.
      - Settings sliders: master 80→50% took the gain from 0.64 to 0.25, and effects 80→25% took it from 0.64 to 0.0625. Mute took master to 0. The values survived a reload.
      - Quality: Low gave 164 draw calls, Medium 213, and Auto came back as High (239) with stepping on.
      - Play counters rose as these happened:
        - hire 1 from the Staff panel; sell 1 from the Inspector; place 1 from the palette
        - shuffle 1 on sitting at blackjack; deal: chips 1 and card 3 (three face-up cards); stand: card 1 for the hole card turning over
        - a $2,000 bet: error 1
        - craps pass line: chips 1; roll 7: dice 1, win 1, chips 1
        - roulette red: ball 1, win 1
      - Floor coins under 500 guests: 6.0, 6.0 and 5.8 a second at overview, mid and close, with 1–2 voices live. In the stress build, 2,701 voices were stolen and none went over the cap.
    - **Stress scene,** audio running vs suspended in the same session (High, auto-quality pinned):

      | View | Running: calls, triangles, tick | Suspended: calls, triangles, tick |
      |---|---|---|
      | Overview | 292, 335k, 6.8 ms | 319, 335k, 7.9 ms |
      | Mid | 150, 873k, 8.3 ms | 150, 875k, 8.4 ms |
      | Close | 99, 529k, 9.0 ms | 101, 531k, 13.0 ms |

      fps was 33.7 vs 35.6, 36.7 vs 35.7 and 35.7 vs 34.2. No difference within noise. The pane was hidden again, with ~1 s rAF stalls, so the absolute fps doesn't count. A1 changes no render code.
    - **Found:** floating "+$" payout labels cost a draw call each. At overview, paused gives 236 calls and running 331, which breaks the 300 budget with audio on or off. This predates A1; see the note under A3.

- [x] ✅ **A2. Dealers deal; guests sit and stand where the art says.**
  - Dealers stand at the table's dealer edge facing the players. They play `deal` while players are seated and `idle` when the table is empty.
  - Guests snap to the catalog seat markers (position and facing) instead of the cell centre plus 0.22 m.
  - Craps uses a standing pose at the rail: a standing `play` variant. Adding the clip to `human.py` and re-baking the VAT is allowed here.
  - **Evidence:**
    - economics guard green, with crowd metrics unchanged within noise
    - close-up screenshots of a full blackjack table and a full craps table showing the dealer at the dealer edge and players on their stools and at the rail
  - **Done 2026-10-25.**
    - **Built:**
      - `src/sim/agents/seats.ts`: seat markers turned into world poses with the table's rotation. `fitSeats` hands each of a table's seat cells, in seat order, the nearest stool no earlier seat took, within 1.05 m (so nobody visibly jumps). `dealerPose`/`dealerSpot` put the dealer 0.3 m behind the edge opposite the stools, facing them, on the nearest walkable non-seat perimeter cell. `playsStanding` marks craps and the big six.
      - `Staff.ts` (A's slice): a stationed dealer plays `deal` while its table's `seatedCount` > 0 and `idle` otherwise, and walks to `dealerSpot` (the old perimeter pick is the fallback when that cell is blocked).
      - `Guest.ts` (A's slice): guests at a standing game play the new `standplay` clip and wait on their feet (`Idle`) instead of sitting on air. The flag is set where the pose is chosen.
      - `contracts.ts` (`contract:` commit): `Anim.StandPlay = 7`, appended.
      - `human.py`: a 2 s looping `standplay` clip (leaning on both forearms, the right hand reaching out to lay chips or toss dice, weight shifting). VAT re-baked: 9 clips, 7.1 MB (budget 10 MB).
      - `Crowd.ts`: `StandPlay` maps to VAT clip 8, and the shader's clip table grows from 8 to 16 entries. A guest who stands up from a stool without walking off (done playing and looking around, or cheering) eases 0.4 m back, so it doesn't stand inside the stool. In the browser such a guest lingered up to 20 s; the arrival idle lasts a single 0.1 s snapshot.
    - **Seat cells are unchanged, on purpose.** First version: reorder `seatCellsFor` (a `world.ts` hook) so every seat index walks to the stool side. That moved the campaign measurements. `difficulty.test.ts` "rewards holding a reserve" went from managed 18 / reckless 15 to 16 / 19 and failed. With the hook removed and everything else kept, the wins per campaign and strategy are identical to HEAD: managed 7/6/5, reckless 6/5/4, greedy 7/5/5, minimal 0/0/0. Grid-mode test worlds ignore park poses, and dealer position and animation don't touch outcomes. So guests still walk to the world's one-per-side seat cells and only the pose comes from the art. Result: on blackjack the west, east and south seats land on stools (both ends and the centre), and the north seat sits on the dealer side. Craps puts three players at the rail ends and front, and one on the boxman side. See "Requests to Track B".
    - **Tests:** `src/sim/agents/seats.test.ts`, 8 new: marker rotation, stool fitting, reach, dealer pose per rotation, world seating, dealer idle→deal, craps standing. With `world.tables`/`world.staff`: 40/40. `tsc` is clean.
    - **Economics guard:** `src/data/campaigns`, `world.tier2`, `src/sim/agents` (crowd included), `world.tables`/`staff`/`newgames` and `src/sim/entities`: 26 files, 240/240.
    - **Browser** (a sandbox with 35 blackjack and craps tables, 40 dealers, 220 guests; each scene caught by polling the snapshot and pausing):
      - Blackjack, 4 seated players: three sit on stools facing the felt, reaching for the cards; the fourth sits on the dealer side. The dealer stands behind the far edge facing them, dealing (snapshot: dealer at (x+1, z−0.3), heading 0, `deal`).
      - Craps, 4 players: all standing at the rail, leaning in on the `standplay` clip, with the dealer behind the far edge. None sit.
      - An empty table's dealer stands idle; the clip changes to `deal` as the first player sits.
    - **Stress scene** after A2 (High, auto-quality pinned, pane visible): overview 222 calls (max 231), 300k triangles, 53.8 fps; mid 117 calls, 582k, 53.9 fps; close 80 calls, 408k, 54.4 fps. Worker tick 8.2–9.6 ms. A2 adds no draw calls. The in-browser tick is over 7 ms, as at the A0 baseline (7.5–9 ms) with this Mac loaded. Headless `sandbox.stress.test.ts` with `NAV_PERF=1` (2,036 objects, 500 guests, 90 staff; asserts a mean tick ≤ 8 ms), alternating HEAD and A2: all four runs pass, with wall time 9.9 and 9.7 s at HEAD against 13.6 and 8.1 s with A2. That's noise; A2's per-tick cost is one `seatedCount` read per stationed dealer.

### Ship cut (decided by the user, 2026-10-30)

v2 ships to Netlify after this cut. Do these next, in this order, then the finish task. Everything under "After ship" waits until the user says so.

- [x] ✅ **A3. Slot reels spin and stop on the real result.**
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
  - **Note from A1:** the payout labels (`Overlays.spawnPayout`) draw one sprite per label. On the stress overview at 1×, that's about 95 extra draw calls: 236 paused vs 331 running, over the 300 budget. Since this task reworks when labels appear, batch them too, into one instanced or atlas-text pool.
  - **Done 2026-10-30.**
    - **Built:**
      - `contract:` 6e08c94: the `setInterest` command, the `roundFx` event (replaces a watched play's `payout`) and the inspector's optional `lastRound`.
      - `src/sim/fx/rounds.ts`: `recordRound`, one call at the end of `playEngineRounds`, keeps each machine's last round in a WeakMap keyed by its `GameMath`. It reads the settled round only. Slots carry the sheet, a stop per reel (`stopsFor` turns the engine's window back into strip stops) and the winning lines.
      - Worker: `setInterest` stores the watched ids; a watched play sends `roundFx` once per new round (a per-object sequence), and unwatched plays keep their `payout` events.
      - `src/render/fx/reels.ts`: the stop timing (first reel at 0.85 s, then every 0.32 s on 3 reels or 0.24 s on 5; shorter by 1/√speed at 2× and 4×), an eased spin that lands exactly on the target and rings down with a small overshoot, and a GLSL twin of it. `restingStops` gives each unplayed cabinet a scattered window that the engine itself scores as paying nothing.
      - `Atlas.ts`: `reelStrips` paints every par sheet's real strips, one 48 px column per reel, symbol by symbol (cherries, bars, sevens, diamonds, the video sheets' A/K/Q/J/10, coins, bells, wilds). The old static `slotReels` and `pennyScreen` faces become the frame around the window.
      - Reel surface: no Blender re-export was needed. The reel window is already its own material surface (`decal_slotReels`, and `decal_pennyScreen` on the penny cabinet), so `AssetLibrary` flags those decals `SurfaceFlag.Reel` and the object shader draws the reels into that window: per instance `aReelA`/`aReelB` (spin start, sheet, five packed stops, duration scale), a strip lookup with motion blur while spinning, drum shading on the classic reels, and the payline. Idle cabinets get an attract sweep of light across the glass; it never changes a symbol.
      - `src/render/fx/FxDirector.ts`: one round per watched object at a time, the newest queued round next and the rest dropped. Spin and reel-stop sounds at the stop times; at the reveal, the label, flash and a coin, bell (a win above the stake) or jackpot plus hopper (≥ $1,000 or ≥ 50× the stake), from that round's own numbers.
      - `src/render/PayoutLabels.ts`: every floating "+$" label in one instanced draw. The glyphs are packed into a per-instance attribute and spelled out from a small glyph atlas in the shader, so spawning a label uploads 32 bytes; with no live label it draws nothing.
      - `Stage.interestIds` (engine games within 24 m and in view, nearest 48), sent from `main.ts` every 0.5 s when it changes.
    - **Tests:** `src/render/fx/reels.test.ts` (stop timing left to right, speed scaling, exact landing from any previous stop, the overshoot settling, packing, resting windows never paying on any sheet), `src/sim/fx/rounds.test.ts` (recorded stops reproduce the engine's window; recording changes no outcome or RNG draw against an unrecorded twin), `src/render/PayoutLabels.test.ts` (label text, packing round trip). 35/35 with the audio tests; `tsc` clean.
    - **Economics guard:** `src/data/campaigns`, `world.tier2`, `crowd`, `src/sim/entities`, `src/sim/fx`: 23 files, 223/223.
    - **Browser** (stress floor with penny cabinets mixed in, 500 guests, 1×):
      - A penny cabinet, `obj-1253`, caught as a new round arrived: 0.9 s in, reel 1 has landed (blank, Q, J) and reels 2–5 are blurred mid-spin. At rest every visible symbol matches the strips at stops [13, 9, 7, 2, 5] (blank/Q/J, K/10/WILD, $/10/Q, $/J/K, J/Q/J). That is the inspector's `lastRound` (`pays 0.80× (1 line)`), identical to the round the director showed and to the stops on the reels.
      - A classic cabinet, `obj-1254`: cherry, BAR, cherry on the line for `lastRound` stops [0, 0, 13], `pays 1.00×` (the leading cherry).
      - Timeline of that penny round from the spin's start: `reelSpin` at 0, `reelStop` at 0.85 s and then per reel, and the "+$2" label and coin both at 1.80 s, the moment the last reel stopped.
      - 219–319 rounds shown over the measuring runs, with newer rounds dropped as designed while a spin is showing.
    - **Stress scene, A/B in the same session** (HEAD 83d98d0 on a second dev server vs A3; identical layout; 1280×800, High, auto-quality pinned, camera set with `god.setState`):

      | View | HEAD calls, triangles | A3 calls, triangles |
      |---|---|---|
      | Overview, running | 304, 311k | 223, 311k |
      | Overview, paused | 222, 311k | 222, 311k |
      | Mid (30 m) | 142, 575k | 112, 557k |
      | Close (10 m) | 127, 460k | 80, 415k |
      | Slot bank close (8 m) | 114, 916k | 70, 965k |

      The reels add no draw calls; the labels went from about one call each to one in all (running = paused + 1). Tick, headless `sandbox.stress.test.ts` alternating: HEAD 3.23 and 2.95 ms mean, A3 3.06 and 2.86 ms. fps not measured: the session window was closed, so the page ran as a background tab; for the same reason the in-browser tick read 20–77 ms on both builds.

- [x] ✅ **A4. Wheels and dice move.**
  - Roulette: the wheel head spins and decelerates. The ball orbits, drops, bounces and settles in the pocket of the real result, using the European or American pocket order from the layout.
  - Big six: the wheel stops on a segment showing what was actually paid, with the clapper ticking (sound). Big six still runs a `{p, multiplier}` table until Track B's B9 lands, so pick a segment whose payout matches the multiplier paid. After merge: use the exact segment B9's engine reports.
  - Craps: two dice arc from the shooter's spot, tumble and land showing the rolled faces. Scripted motion is fine; no physics engine.
  - **Evidence:**
    - unit tests for pocket angle and face orientation
    - screenshots of each at rest matching the inspector's result
    - stress scene numbers
  - **Done 2026-10-31.**
    - **Built:**
      - `contract:` 83b528c: optional `roulette {pocket, wheel}`, `craps {dice}` and `bigSix {segment}` on `RoundFx`.
      - `src/sim/fx/rounds.ts` now also records roulette (the engine's pocket, 37 = 00, and the table's wheel) and craps (a round is a shooter sequence; the floor throws the roll that settled it). Still the same one call in `playEngineRounds`, reading the settled round only.
      - Big six: it pays from `BIG_SIX_BALANCE.payoutTable`, not an engine, so the worker records each spin from the real `machinePlayed` wager and payout (`src/sim/fx/bigSix.ts`, no change to Track B's files). The segment agrees with the payout: a 2× return is a $1 segment, a loss any non-$1 segment. The table's 4× return has no exact segment (no wheel pays 3:1), so it shows the nearest, $2. The inspector's `lastRound` shows it too. After B9: use the segment the engine reports.
      - Motion (`src/render/fx/wheel.ts`, `dice.ts`): the roulette head gets a push that decays to an idle turn; the ball runs the other way, picked from its last pocket, drops off the track at 3.0 s, rattles over the frets and settles in the result's pocket at 4.1 s, then rides the head. The European and American pocket orders are real wheel orders. The big six face spins three-plus turns and slows onto the segment under the clapper at 5.0 s. The dice are scripted backwards from their resting pose: arc from the shooter's end, hit the felt at 0.75 s, hop and tumble, at rest at 1.35 s showing the roll. All shorter by 1/√speed at 2× and 4×.
      - `src/render/fx/TableParts.ts`: five instanced part pools on the object material (EU head, US head, ball, die, big six face), drawn a few millimetres over each hero's painted wheel only for watched tables that have shown a round, so an unwatched table keeps its static art. No Blender split was needed: the parts are built from the atlas.
      - Atlas: a double-zero head (`rouletteWheelUS`, with 00) and a die-face sheet (`dieFaces`). Roulette tables default to the double-zero wheel, so the live head matches the rules, not the static art.
      - `heroes.py`: the craps table's two baked dice are gone (`table-craps.glb` re-exported, LOD0 1,860 triangles, seats unchanged). A pair baked in would lie beside the live dice showing a number nobody rolled. The big six already had its clapper at the top.
      - The big six joins the watched set (`ObjectLayer.nearGames`), since its catalog entry has no engine `game`.
      - Sounds: the ball rolling down (`ballRoll`, sped up to end with the spin at 2× and 4× through a new `rate` play option), the ball dropping into the pocket at the reveal, dice on the felt at the bounce, and the big six's clapper spin.
    - **Tests:** `src/render/fx/tables.test.ts` (both wheel orders complete and correct; pocket angle ↔ pocket for every number; the ball settled in the result's pocket at the reveal and after; the ball launched from where it lay, running against the head; each value on top in its resting orientation; dice landing on the rolled faces with no jump into rest; dice apart; big six segment agreeing with the payout and spreading losses; big six slowing onto the segment, continuous into the stop, every rest angle mapping back) and `src/sim/fx/rounds.test.ts` (roulette pocket matches the engine's summary on both wheels, 00 included; craps dice match the summary's last roll): 47/47 with the A3 and audio tests. `tsc` clean.
    - **Economics guard:** `src/data/campaigns`, `world.tier2`, `crowd`, `src/sim/entities`, `src/sim/fx`: 24 files, 235/235.
    - **Browser** (open floor: 4 roulette, 4 craps, 6 big six, 10 dealers, 160 guests; each round caught as it started, the sim paused there so the inspector keeps that round, render time then frozen or stepped):
      - Roulette `obj-1`: mid-spin, the ball out on the track; at rest it sits on the red pocket beside "3" on the double-zero head. Inspector `lastRound` "3 red", pocket 3, wheel double, identical to the round shown. Reading the drawn instance matrices back: the ball is 0.205 m from the hub, in pocket 3 relative to the head.
      - Craps `obj-2`: at rest the tops read 5 and 6 for the inspector's `[6, 5]` ("1 roll, last 11"). Next throw: at 0.95 s both dice tilted mid-hop; at rest 2 and 5 for `[5, 2]`.
      - Big six `obj-9`: mid-spin at 2 s; at rest the $1 between $2 and $10 (segment 6) under the clapper, for `lastRound` "$1 pays" on a $5 stake returning $10.
      - Sounds over 25 s after a real click: `ballRoll` 11, `ball` 10, `dice` 7, `bigSixSpin` 2.
    - **Performance:**
      - Parts on vs off on the table floor, same frames: 126 vs 119 calls with four part types live (each type draws once plus its shadow pass; ten at most with all five). Triangles by geometry: about 550 per head, 170 per ball, 12 per die, 48 per big six face, so about 1.6k on that floor; the measured difference was lost in crowd noise. Nothing draws while no watched table has shown a round.
      - Stress scene after A4, same layout and method as A3: 223 / 112 / 77 / 70 calls (A3: 223 / 112 / 80 / 70), overview paused 222; triangles 312k / 506k / 378k at overview / mid / close. The stress layout's tables sit boxed in by slot banks and never get a player, so no parts show there.
      - Headless tick, `sandbox.stress.test.ts`, HEAD (A3) vs A4 in alternating order: HEAD 3.87, 3.97, 4.00 ms; A4 4.02, 4.07, 3.10 ms. Whichever runs second is slower, so the difference is run order.
      - fps not measured: the session window was closed again.
    - **Found (not A4):** at the close slot-bank view (8 m) the scene reads 1.8–2.0M triangles, over the 1.5M budget, and the crowd is 1.27M of it (objects 517k). HEAD read 2.25M there in A3's first run. It depends on how many guests stand near the camera at full VAT detail. Measured again in A13.

- [x] ✅ **A7. Ambience.** Use the A0 download if approved, or synthesize what was declined.
  - Room tone plus distant slot chatter plus crowd murmur, scaled by guest count and camera height (quieter and wider in the god view, close and detailed at eye level).
  - An optional low music bed on the ambience bus.
  - Zone-aware: the bar and food court sound different from the slot floor.
  - Paused (speed 0) ducks the ambience.
  - **Evidence:**
    - a unit test for the mix curve
    - in the browser: gain readings at god view versus eye level and at 0 versus 200 guests, plus a short listening note: no audible loop seam over 60 s
  - **Done 2026-10-31.**
    - **Built:**
      - `src/audio/ambience.ts` (pure): four looped beds from the approved A0 download: the slot room (`amb-slots`), distant crowd walla (`amb-crowd`), close conversation (`amb-murmur`) and the lounge music (`music-lounge`). The mix takes the guest count (crowd density 1 − e^(−guests/150)), camera height (eye level below 3 m, full god view from 45 m), speed, and what stands within 12 m of the ears.
        - God view: every bed lower (−45 % at the top), murmur gone, and a low-pass sliding from 16 kHz to 2.5 kHz, so the room sounds wide and far off.
        - Eye level: the murmur comes in with the crowd and the full bandwidth.
        - Zones: the share of bar, food stalls and food-court floor near the ears raises music (up to 3.5×) and murmur and lowers the slot room; from high up a corner's character fades (×0.3).
        - Paused: everything ducks to 0.35×, music included.
        - Lounge music is optional: a new "Lounge music" switch in Settings, saved with the volumes (`AudioSettings.music`, default on).
      - `AudioEngine`: the beds loop from a random offset each (no two line up), each through its own gain into a shared low-pass and on to the ambience bus. They sit outside the 24-voice cap. Mixes glide (0.6 s time constant), so a camera move swells rather than jumps.
      - `src/audio/AmbienceFeed.ts`: gathers guests and speed from each snapshot, sorts objects into machines, tables and lounge, and recomputes the mix 4 times a second around the listener point (on the camera at eye level, down the view ray from the god view).
      - `amb-slots.ogg` re-made: its A1 loop had a step at the seam (left channel −604 → 10,893, about 5× the file's 99th-percentile sample step: a click every 38 s). Now a 2 s equal-power crossfade of tail into head, 36 s, 46 kb/s, 196 KB (was 213 KB). Noted in CREDITS.md.
    - **Tests:** `src/audio/ambience.test.ts`, 8: the crowd filling with guests and levelling off, empty floor left to the machines; god view lower on every bed with no murmur and a falling cutoff; bar vs slot floor; the pause duck; music off; gains within 0..1 on any input; object classes; distance weighting and the 12 m cut. With `mix`, `voices` and `Settings`: 32/32. `tsc` clean.
    - **Browser** (65 slot machines and 2 bars on a fresh Sandbox; audio unlocked by a real click; camera through the Walk button and Esc; pause and the music switch through the HUD and Settings):

      | Where | Guests | Slots | Crowd | Murmur | Music | Cutoff |
      |---|---|---|---|---|---|---|
      | God view (camera 70 m) over the slots | 3 | 0.440 | 0.005 | 0 | 0.055 | 2.5 kHz |
      | Eye level (2.6 m) in the slot bank | 11 | 0.794 | 0.048 | 0.025 | 0.099 | 15.8 kHz |
      | Eye level in the slot bank | 211 | 0.799 | 0.528 | 0.271 | 0.100 | 16.0 kHz |
      | Eye level by the bar | 211 | 0.121 | 0.686 | 0.633 | 0.350 | 16.0 kHz |
      | God view over the slots | 211 | 0.439 | 0.291 | 0.001 | 0.055 | 2.5 kHz |
      | The same, paused from the HUD | 211 | 0.154 | 0.102 | 0 | 0.019 | 2.5 kHz |

      The Lounge music switch took music from 0.055 to 0 and back, saved as `"music":false` while off. On the stress floor the food court corner read music 0.26 and murmur 0.56 at 10 m.
    - **Loop seams** (instead of a listening note, which this session can't give): each bed decoded in the browser at its exact length (36, 15.5, 18.2, 51.2 s), and the jump from last sample to first is below the file's own 99th-percentile sample step: slots 0.021 vs 0.066, crowd 0.001 vs 0.011, murmur 0.0007 vs 0.0014, music 0.003 vs 0.017. The user should still give it a listen.
    - **Performance:** no rendering. The feed's update costs 0.03–0.06 ms on the stress floor (1,680 sound-relevant objects), 4 times a second. Four looping sources and one filter in WebAudio.

- [x] ✅ **A5. Live cards and chips on the felt.**
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
  - **Done 2026-10-31.**
    - **Built:**
      - `contract:` 8fadb92: optional `RoundFx.cards {dealer, hands, board?, folded?}` and `RoundFx.player {seat, x, z}`. `src/sim/fx/rounds.ts` records blackjack (dealer and every hand, splits included) and UTH (player, dealer, board, folded); the worker adds the seat that played and where its guest sits.
      - `src/render/fx/felt.ts` (pure): a round becomes a timed deal plan in the real order (bet, player card, dealer up, player card, dealer hole face down, hits, hole flip, dealer draws; UTH flop/turn/river and folds), seat spots on the felt from the player's angle, chip stacks by denomination.
      - `FeltParts.ts` (instanced card and chip pools on the object material, faces from a new atlas `cardFaces` sheet, 52 faces plus a back) and `FeltShow.ts` (cards slide from the shoe, the hole card turns over, chips go to the seat, are paid or collected to the rack at settle, then everything clears).
      - `FxDirector`: card tables keep one pending round per seat and cycle round the occupied seats; every seat's bet shows even while another seat's cards are dealt. Sounds: `chips` on the bet and settle, `card` on each landing and flip, `shuffle` every seventh hand.
      - `heroes.py`: the baked cards and bet chips are gone from the card-table hero; `table-blackjack`, `-hl`, `-uth` and `-carnival` re-exported.
    - **Tests:** `src/render/fx/felt.test.ts` (roundFx → deal order, hole flip, UTH board and fold, positions, chip stacks): 8/8; with the fx suites 33/33. `tsc` clean.
    - **Browser** (Sandbox: 4 blackjack and 2 poker tables, 9 dealers, 160 guests): after about a minute, 33 blackjack and 10 UTH hands shown in 35 s. Caught `obj-3` and froze render time: at 2.6 s the dealer's 3♦ up and the hole card face down, the player's Q♣ 4♣ A♠ at the seat with the $8 bet; at 4.4 s the dealer's 3♦ 5♦ 8♦ A♠ (17) face up, identical to the inspector's round (player 15, lose). Overview of the poker tables: 40 calls, 73k triangles.
    - **Note:** the "nothing shown" in the first attempt was the title menu still open over a scripted Sandbox (sim at tick 0). Click `button.scenario` first.

- [x] ✅ **A6. Graphical table play for the avatar.**
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
  - **Done 2026-10-31** (c233e07, e0c20d7, and the seat-camera pan with this tick).
    - **Built:**
      - Your round plays on the table: `TableView` (wired in `main.ts` to `FxDirector.playOwn` / `ownHand` / `setStakes`). Spins, rolls and pulls run the A3/A4 parts at 1× whatever the sim speed; blackjack and UTH deal live from the engine's round view (`felt.ts` `seenCards` + `livePlan`): new cards dealt, the hole card and the board turn as the engine reveals them, then paid or collected. While you sit at a table its guests' rounds stay off the felt. `fxOf` in `src/sim/fx/rounds.ts` builds the RoundFx from your settled result (no worker change).
      - Seat camera (`CameraDirector`): above and beside your shoulder (1.95 m, 0.3 m back, 0.38 m aside, 48° FOV), aimed at your spot on the felt and panned so it sits left of the panel. The avatar is drawn seated (`Anim.Play`, `Stage.avatar.anim`).
      - Panel at the right edge, buttons and text only; it says "the ball is spinning" (etc.) until the table has shown the result.
      - Betting: a chip tray from the table limits (`layouts.ts` `trayChips`); roulette bets by clicking the printed layout (`feltPoint.ts` raycast → `rouletteSpotAt`: straight incl. 0/00, split, street, corner, six-line, basket, column, dozen, even money); spot buttons elsewhere; any number of bets; Clear, Rebet, Double. Laid chips show on the felt at their spots and stay for the spin. An engine without spots of its own gets one main bet, and the action buttons come from the engine's options, so B9's engines play without per-game UI.
    - **Tests:** `src/ui/play/layouts.test.ts` (every engine bet reachable on the layout and back, clicks read like the printed layout, sheet↔felt, tray chips): 4/4; `avatarPlay.test.ts` and the fx suites: 13/13 and 42/42. `tsc` clean.
    - **Browser** (Sandbox, sim paused, a row of the five games; sat with F; bets and actions through the panel and the layout):
      - Roulette: chips laid by clicking 17, the 1|4 line and Red sat on those spots; slip "Straight 17 $50 · Red $25 · Split 1-4 $25"; the live double-zero head and ball spun; 14 red: Red paid, net −$50.
      - Craps: pass $5 + field $5; Roll threw the live dice to 1–1; "1 roll, last 2 — +$5.00" (pass lost, field paid double).
      - Slots: the machine's own reels stopped on cherry, cherry, BAR with the payline drawn; "pays 2.00× (1 line) — +$10.00".
      - Blackjack: K♦ 3♣ vs 2♦ and a face-down hole card on the felt mid-hand; another hand J♠ 6♠ stood, dealer 2♠ J♦ 9♠: −$5; 9♠ 9♥ with Split offered.
      - UTH: 2♥ 8♦ dealt to the seat, two dealer and five board cards face down, Check / Raise 4× / Raise 3×.
    - **Not done:** slots "bet per line or lines": the slot engine takes one stake per spin from the machine's rules (denomination × credits), so there is nothing to choose without a Track B engine change. Craps bets are buttons, not layout clicks (the printed craps felt has no hit map yet). The main.ts gate needs no change: any catalog entry with an engine `game` already opens the view.
    - **Known:** sitting down mid-round after leaving a table answers "a round is already in progress" (pre-existing PlayerPlay behaviour).

- [ ] **A13. Finish.**
  1. Merge `origin/v2-playable` if it moved.
  2. Run the full suite under `caffeinate -i` and `npm run build`.
  3. Measure the stress scene.
  4. Take a screenshot set: god-view overview, eye-level slot bank mid-spin, roulette at rest, blackjack mid-hand, craps roll, your own round in the play view.
  5. Push and update the PR description with the checklist and evidence; take the PR out of draft.
     List the "After ship" tasks in the PR description as post-ship work, not as missing.
  6. Report to the user and stop the loop.

### After ship (backlog: don't start these until the user says so)

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

## Requests to Track B

(Write here anything you need from Track B's files. Commit it and mention it in your report.)

- **Seat cells on the stool side (from A2, 2026-10-25).** `CasinoWorld.seatCellsFor` hands out seats one per side: west, north, east, south. So a blackjack player and a craps player always get the dealer's side. A2 had a one-line hook that reorders those cells by the art's stools (all players on the stool side, dealer cell last, same ring and capacity). It changes nothing but where guests walk, yet it moved `difficulty.test.ts` criterion 3 from managed 18 / reckless 15 to 16 / 19 over the tournament seeds, failing it. Per campaign, managed 7/6/5→6/6/4 and reckless 6/5/4→7/6/6; greedy kept 17 in total and minimal stayed 0. That reads as a thin margin meeting trajectory noise, not a bias, but the measurement and the economics are B's. Ask: when B next retunes, either widen that margin enough to survive a change in where guests stand, or say that the reorder may land with re-measured numbers. A will then add the hook (`artSeatOrder`-style, ordering seat cells by `fitSeats`) and re-run the guard.
