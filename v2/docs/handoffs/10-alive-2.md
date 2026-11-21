# Track A, part 2 (v2.1): decor art, light, celebrations, people, exterior

Written 2026-11-05, after v2 shipped to casinotycoon.netlify.app. Shared rules: [NEXT-SESSION.md](NEXT-SESSION.md) (read it first; the v2.1 section overrides older lines). History and evidence for Track A's first part: [5-alive.md](5-alive.md). This file replaces 5-alive.md's "After ship" section; A8–A12 below are the specs to build.

Branch `v2-alive-2`, cut from `origin/v2.1`, in its own worktree. Dev port 5175, launch config `v2-alive-2`. One draft PR into `v2.1`.

## What the user decided (2026-11-05)

- **Order:** A10 → A8 → A12 → A9 → A11. A10 goes first so Track B's B6 gets real models early; the exterior goes last.
- **Look:** stay lively stylized. A8 adds a warmer evening mood; it doesn't change the style.
- **Art:** every model is scripted in `assets/blender/*.py`, like the 17 existing GLBs. External downloads are limited to **CC0 textures** (Poly Haven: marble, velvet, brushed brass, water normal, and similar), not whole models, so the style stays consistent. One download batch for the user's OK. No AI-generated models; the Blender MCP is for looking at scenes and searching libraries only.
- **Two look checkpoints:** after A10 and after A8, publish a screenshot page (a private Artifact) and **stop for the user's sign-off** before the next task. Track B keeps working meanwhile.
- **Graphics setting:** A8 adds High/Low. Every later task is checked on both.
- **UI:** all DOM UI (including `Settings.ts`, `TablePlay.ts`, `src/ui/play/**`, `tools.css`, `CursorTag.ts`, `InteractPrompt.ts`) belongs to Track B for v2.1, which is rebuilding the UI (B15). You keep rendering, input logic and WebGL labels/icons. If you need a control (the High/Low toggle, a hold-cards button), add the behaviour and an exported function, and write the request under "Requests to Track B".

## Facts you can rely on (audited 2026-11-04 at 9b8b883)

- **Lighting** (`src/render/Lighting.ts`, `Post.ts`, `Stage.ts:90-106`): one hemisphere light (0.55), one directional sun (2.3) with a 4096 shadow map fitted to the view every frame (`Lighting.ts:68-125`), the `dancing_hall_1k.hdr` environment at 0.45. **No point or spot lights anywhere.** Warm light today is emissive surfaces plus bloom. Post: N8AO (half res, High only), luminance bloom (threshold 1.05, intensity 1.15, mipmap blur), vignette, ACES, SMAA. No day/night in render.
- **Known bug:** at eye level on a dense floor, neon next to the camera blooms into large white shapes (5-alive.md:413).
- **People** (`src/render/Crowd.ts`): one VAT instanced draw per LOD tier (MAX 2048). `aLook` = outfit row, skin, hair, mood (32 outfits, 8 skins, 8 hairs). The female build is the male mesh with a negative scale. LOD bands `[14, 48]`: full mesh 1,620 tris (casts shadows), reduced 824, billboard. `human.py` bakes 9 clips (idle, walk, sit, play, cheer, sad, eat, deal, standplay), 320 frames at 20 fps → `human.vat.bin` 7.1 MB of the 10 MB budget.
- **Decor:** none of the six ids exist in `shared/catalog.ts` or `data/objects.ts`; unknown ids render as `proc:box` (`catalog.ts:262`). Existing decor is procedural: plant, neon-sign, marquee.
- **Exterior:** a 400×400 dark ground plane faded by fog (`Stage.ts:123-130`). The entrance is an open gap at `ENTRANCE_TILE` {39, 15} on the 40×30 grid. God camera: distance 6–90 m, pitch 0.42–1.38, focus clamped to the lot (`GodCamera.ts:25-29`).
- **Celebrations:** `FxDirector.ts:39-41,410-418` — a big win ($1,000 or 50× the stake) plays only the jackpot sound and the coin hopper. The sim's jackpot (≥ 10× wager) sets `Guest.celebrating` → Cheer clip. Broken state reaches the object shader (`ObjectLayer.ts:324`); no attract mode.
- **Pipeline:** `common.py` conventions (front faces −Y, LOD0/1/2 by `decimate_copy`, `__flash`/`__chase`/`__variant`/`decal_` materials, AO baked to COLOR_0, `seat_<n>` empties). `heroes.py` ASSETS table at `:590-608`. GLBs load through `AssetLibrary.ts` with Meshopt; named parts become their own instanced pools. GLBs total ~2.1 MB of 6 MB.
- **Performance at A13** (5-alive.md:393-403): overview 217 calls / 304k tris, mid 129 / 617k, close 87 / 478k, slot bank at 8 m 60–131 / 0.53–1.29M, with 378–434 guests (not 500). Last fps measured was ~54 at A2, already under the 55 target. The 8 m slot-bank view is the risk.

## Tasks

- [x] ✅ **A0. Setup.** Worktree on `v2-alive-2` from `origin/v2.1`, launch config `v2-alive-2` on 5175, `npm install`, draft PR into `v2.1`. Then ask the user once for the CC0 texture batch (names, Poly Haven URLs, sizes, licence) for A10 and A11; carry on with untextured work while you wait. Measure and record a baseline on the stress scene (fps, calls, tris at overview, mid, close and the 8 m slot bank, with 500 guests) — every later task compares to it.
  - **Done 2026-11-04.**
    - Worktree `.claude/worktrees/v2-alive-2-1ff92c` from `origin/v2.1` (d277f72), pushed as `v2-alive-2`; launch config `v2-alive-2` on 5175; `npm install` clean.
    - **Texture batch approved by the user and downloaded 2026-11-04** (credited in `assets/CREDITS.md`; 512 px copies in `assets/textures/`, 832 KB in all) (Poly Haven, CC0, 1k JPG diffuse/normal/roughness, shipped downscaled to 512): `marble_01` (plinth, ATM, stage front), `velour_velvet` (sofa, curtain), `clean_asphalt` (street), `concrete_pavers` (sidewalk), `beige_wall_001` (facade). Brass/bronze stay plain PBR metal; the fountain water uses a procedural normal.
    - **Stress baseline** (A0 `stress.js` floor through the command path: 1,971 objects, 90 staff, 500 guests spawned and topped back up to 500 before the slot-bank views; High, auto-quality off, renderScale 1). The pane was hidden, so fps could not be measured (rAF throttled) and the in-browser tick is inflated (12–22 ms against the 24 ms budget per 300 ms tick).

      | View | Calls | Triangles | Guests on floor |
      |---|---|---|---|
      | Overview (focus 48,32; 76.8 m) | 217 | 304k | 480 |
      | Mid (40,30; 30 m) | 129 | 617k | 457 |
      | Close (40,30; 10 m) | 87 | 478k | 444 |
      | Slot bank 8 m at (16,30) | 66 | 819k | 482 |
      | Slot bank 8 m at (24,12) | 62 | 1.02M | 471 |
      | Slot bank 8 m at (70,44) | 129 | 1.49M | 463 |

      Overview/mid/close match A13 exactly. The (70,44) slot-bank spot sits at the 1.5M edge: the risk view for every later task.

- [x] ✅ **A10. Art for the six decor items.**
  - Build in `heroes.py` (or a new `decor.py` using `common.py`): `statue`, `fountain`, `lamp-post`, `lounge-seating`, `atm`, `stage`, at the fixed footprints (NEXT-SESSION.md, "Pre-agreed decor").
    - Statue: bronze figure on a marble plinth.
    - Fountain: basin with UV-scrolling water and a soft splash sound (positional, through the existing audio system).
    - Lamp post: brass, emissive globe; it's a practical light for A8.
    - Lounge seating: velvet sofa with `seat_<n>` markers.
    - ATM: kiosk with a lit screen.
    - Stage: raised platform, curtain, lighting truss with emissive heads; a practical light group for A8.
  - Mark practical-light positions with empties (`light_<n>`, with colour and radius as custom properties) so A8 can read them. Do the same on the existing chandelier, bar and slot assets where it helps.
  - Catalog: add entries with real `asset` keys. Track B adds the `data/objects.ts` defs in B6; on merge keep your art fields and B's zones/prices.
  - **Evidence:** a render-lab screenshot of each (`src/render/lab/`); LOD triangle counts and GLB sizes (stay inside the 6 MB total); once B6's defs are in your branch, each placed on the floor.
  - **Checkpoint 1:** publish the screenshots as a private Artifact page, report the link, and **stop until the user signs off.**
  - **Done 2026-11-05.**
    - **`assets/blender/decor.py`** (new; imports `heroes.py`'s game-space builder, whose `main()` is now guarded). Run: `Blender -b --factory-startup --python assets/blender/decor.py -- [key ...]`.

      | Asset | Footprint | LOD0 / LOD1 / LOD2 tris | GLB | Seats | Lights |
      |---|---|---|---|---|---|
      | `statue`: bronze Lady Luck raising a star, marble plinth, brass plaque | 1×1 | 1,848 / 456 / 128 | 75 KB | — | — |
      | `fountain`: marble basin, two-tier bronze centrepiece, falling sheets, scrolling water | 3×3 | 2,906 / 878 / 218 | 104 KB | — | — |
      | `lamp-post`: brass post, three warm globes and a crown globe | 1×1 | 1,756 / 636 / 156 | 53 KB | — | 1 (warm, 4.5 m) |
      | `lounge-seating`: tufted velvet sofa, brass feet | 2×1 | 1,204 / 164 / 48 | 70 KB | 2, facing +z | — |
      | `atm`: gunmetal kiosk, lit screen and ATM sign, keypad | 1×1 | 724 / 88 / 50 | 62 KB | 1 (standing, front) | 1 (cyan, 2 m) |
      | `stage`: marble riser, wood deck, steps, pleated velvet curtain, truss with four can lights | 4×3 | 1,868 / 588 / 72 | 110 KB | — | 4 (warm, pink, blue, warm; 5 m) |

      All under the 6k/1.5k LOD budgets. GLBs now total 2.38 MB of 6 MB. Everything stays under the 3.4 m avatar-view ceiling (the stage was first drawn at 4.1 m and pushed its truss through it; lowered).
    - **Practical lights:** `light_<n>` empties with `color`/`radius` custom properties, exported as glTF extras (`common.export_glb(extras=True)`); `AssetLibrary` reads them into `Asset.lights` (checked in the browser: lamp 1, ATM 1, stage 4). Not added to the existing chandelier/bar/slot GLBs yet; A8 decides whether it needs them there or derives pools from emissive surfaces.
    - **Textures:** the CC0 marble and velvet become atlas tiles (`texMarble`, `texVelvet`, `Atlas.loadImages()` paints the 512 px photos over procedural stand-ins once they load). `decor.py`'s `tex_uv` box-projects UVs inside 0..1 because atlas tiles can't wrap. Normal/roughness maps aren't used: the single object material has no normal map (kept for A11's exterior).
    - **Water:** `decal_water__scroll` → new `SurfaceFlag.Scroll` (16); `ObjectMaterial` scrolls two copies of a seamless water tile against each other inside `uWaterRect`. (Found and fixed while verifying: the water painter's `putImageData` ignored the atlas translate and wrote over the atlas corner.)
    - **Splash sound:** a fifth ambience bed, `fountain` (`amb-fountain`, already in the repo from part 1's batch, unused until now). `AmbienceFeed` weighs fountains from their rim (squared falloff over 9 m); the mix fades it with camera height. Tests in `ambience.test.ts`.
    - **Catalog:** six entries with real `asset` keys, `height`, `color`, `glow`, seats; `zones: []` for Track B to set in B6. Until B6's defs exist, `render/assets/decor.ts` gives the agreed footprints to the renderer and the ambience.
    - **Render lab:** `?decor` swaps the south slot bank for a decor gallery; shots `decor`, `statue`, `fountain`, `lamppost`, `lounge`, `atm`, `stage`.
    - **Checks:** `tsc` clean; `src/audio` + `catalog.test.ts` 32/32, `src/render` 44/44. No `src/sim` change, so no economics guard.
    - **Stress scene** (same method as A0; pane hidden, so no fps): overview 211 calls / 300k tris, mid 119 / 582k, close 83 / 462k, slot bank 8 m 65 / 816k, 62 / 1.02M, 116 / 1.43M (A0: 217/304k, 129/617k, 87/478k, 66/819k, 62/1.02M, 129/1.49M). Same within guest-position noise: the stress floor has no decor, and the water branch only runs on Scroll surfaces.
    - **Checkpoint 1:** screenshot page https://claude.ai/artifact/TSkusgsFWFnvgwL58C1ZGQ (private). **Signed off by the user 2026-11-06** ("Signed off, go A8"); the solid rippling water sheets were kept.
    - **Not yet possible:** placing them on a real floor needs B6's `data/objects.ts` defs; do it once they merge into `v2.1`. Also check then that a guest's sit clip looks right on the sofa's 0.46 m seat.

- [x] **A8. Light you can see, and a graphics setting.**
  - **Baked light pools:** a per-chunk light texture (or equivalent) splatted onto the carpet from practical lights and emissive fixtures — chandeliers, lamp posts, table lamps, slot banks, neon (coloured spill) — rebuilt on `objectsVersion`/`floorVersion`. This is the god-view look.
  - **Real lights near the camera:** up to ~8 point lights for the practicals nearest the camera in avatar view, pooled and reused, no shadows from them.
  - **Bloom fix:** stop near-camera neon blowing out. True selective bloom (only emissive surfaces) or a capped emissive range; your call, measured.
  - **Warmer evening mood:** retune the sun, hemisphere and environment so the floor reads as an evening casino, inside the lively stylized look.
  - **High/Low setting:** High = shadows, N8AO, bloom, real lights, full crowd LOD bands. Low = baked pools only, no AO, cheaper bloom, shorter crowd LOD bands. Default to Low when the GPU is weak (a short fps probe on first load, or `renderer.capabilities` heuristics; your call). Export a function for Track B's Settings window and write the request.
  - **Evidence:** before/after god-view and eye-level screenshots on High and Low; the neon blowout before/after; stress numbers on both settings (High must meet the budgets: ≥ 55 fps, ≤ 300 calls, ≤ 1.5M tris).
  - **Checkpoint 2:** publish the screenshots as a private Artifact page, report the link, and **stop until the user signs off.**
  - **Done (2026-11-06).**
    - **Light pools:** `src/render/Practicals.ts` collects chandeliers (the ceiling's 6 m lattice), asset `light_<n>` empties (lamp post, ATM, stage), a pit lamp over every table and a coloured spill in front of everything with a `glow` (toppers, neon, marquees), then splats them into one lot-sized half-float texture (4 texels/m) that `FloorMaterial` adds to the floor's albedo. One texture for the lot, not per chunk: 400×384 for the Sandbox, baked in 3–6 ms. It rebakes when the floor changes, when an asset with lights finishes loading, or when an object is placed, moved, removed or breaks (a hash of those fields, so occupancy-only snapshots don't rebake). Broken machines drop their light.
    - **Real lights (High only):** a fixed pool of 8 `PointLight`s (decay 2, no shadows) follows the practicals nearest the camera, re-picked every 0.2 s, faded out above 9 m and towards the 22 m edge. The count never changes at runtime, so turning them on recompiles once.
    - **Bloom fix (capped emissive):** in `ObjectMaterial`, emitters fade to 55 % within 0.8–4.5 m of the lens, and the brightest emissive channel is capped at `uEmitCap` = 1.6 (still over the 1.05 bloom threshold; a win flash may go 2.5× past it). The cap scales all three channels, so a yellow strip stays yellow instead of clipping to white under ACES. Before/after: the slot side strips read white-hot at 1.5 m before and yellow after; on Low the whole slot field glowed gold from the god view before, and doesn't now.
    - **Evening mood:** hemisphere 0.55 → 0.26 (warmer sky), key light 2.3 → 1.1 at 0xffd6a0, environment 0.45 → 0.3, and the ceiling's coffer cove 0.55 → 0.1 emit, tinted amber, so the chandeliers carry the room.
    - **High/Low:** `Stage`'s QUALITY table now also carries `realLights` and `crowdLod`. High = shadows, N8AO, half-res 8-level bloom, real lights, crowd bands 14/48 m. Low = pools only, no shadows/AO, quarter-res 4-level bloom, crowd bands 9/30 m. Medium is unchanged apart from the new fields (shadows, no AO, no real lights).
    - **Weak-GPU default:** `src/render/gpuTier.ts` `classifyGpu(renderer, maxTextureSize)` → Low for SwiftShader/llvmpipe/software, pre-Iris Intel HD/UHD, GMA, old Mali/Adreno, PowerVR, or MAX_TEXTURE_SIZE < 8192; else High. Exposed as `stage.suggestedQuality()`. Auto's existing runtime fallback (dynamic resolution sheds a tier when frames run slow) is the fps probe; no extra probe added. Settings is Track B's, so the request is below.
    - **Checks:** `npx tsc --noEmit` clean. `src/render/Practicals.test.ts` (8 tests: toWorld rotation, chandelier lattice, asset lights, table/neon spill, broken skip, splat falloff and clipping, GPU classes) and all of `src/render` (8 files, 52 tests) pass. `src/sim` untouched, so no economics guard.
    - **Stress scene** (1,971 objects, 90 staff, 500 guests, `stress.js`; dynamic resolution off, renderScale 1; 1,808 pool lights):

      | view | High calls / tris | Low calls / tris | A10 High |
      |---|---|---|---|
      | overview (76.8 m) | 215 / 304k | 152 / 254k | 211 / 300k |
      | mid (30 m) | 127 / 617k | 73 / 298k | 119 / 582k |
      | close (10 m) | 87 / 478k | 64 / 325k | 83 / 462k |
      | slot 8 m (16,30) | 66 / 819k | 41 / 445k | 65 / 816k |
      | slot 8 m (24,12) | 62 / 1.02M | 36 / 526k | 62 / 1.02M |
      | slot 8 m (70,44) | 103 (max 128) / 1.29M (max 1.45M) | 104 / 886k | 116 / 1.43M |

      High stays inside ≤ 300 calls and ≤ 1.5M tris; the 8 real lights add no draw calls. **fps not measurable** (Browser pane hidden, rAF throttled). The in-browser worker tick read 16–51 ms on High and 12–49 ms on Low, inflated by the hidden page as in A0 and noisy rather than tracking the tier. The sim is untouched.
    - **Checkpoint 2:** screenshot page https://claude.ai/artifact/GSvX7hvxsCEgfSjrcXfyZ3 (private). **Signed off by the user 2026-11-06** ("Signed off, go A12").

- [x] ✅ **A12. Celebrations and life.**
  - **Big win** (keep `FxDirector`'s threshold unless you have a reason): a beacon light on the machine, confetti particles (pooled, capped), a bell, nearby guests cheering with the clip. Also emit a client-side news-line entry (a render event Track B's news line can show; write the request). **No camera moves.**
  - **Attract mode** on idle machines (cosmetic only: never a winning line or payout flash; NEXT-SESSION.md's sampled-rounds rule). **Broken machines** go dark with a blinking fault light.
  - **Thought icons:** sampled `thought` events become icon sprites over heads, **only for the hovered or selected guest and in the Mood view** — never always-on. Categories come from `src/data/thoughts.ts`, read-only.
  - **Fixes:** the 66–150 ms hitch the first time eye-level LOD pools load; the third-person camera pressing into lobby partition walls.
  - **Evidence:** screenshots of a big win mid-effect and an attract/broken pair; stress numbers; the hitch measured before → after.
  - **Done (2026-11-18):**
    - **Big win:** `src/render/fx/Celebrations.ts`. `FxDirector.onBigWin` fires from `reveal()` at its existing threshold (≥ $1,000 or ≥ 50× the bet, real sampled rounds only), and `Stage.bigWin` does the rest. A red dome beacon sits on the model's real top (its world bounding box; the catalog height was nominal and buried the dome in the topper). Two sweeping beam fins spin at 7 rad/s for 6 s, then fade over 1 s. 150 confetti quads per win in a pool of 600 pop 0.2–0.8 m (they hit the ceiling before the tune) and flutter down at a terminal speed. They lie flat on the carpet, then fade at 4.5 s. Also: the `bell` sound after the jackpot sting, standing guests within 5 m switching to the Cheer clip for 4 s (cosmetic; the sim keeps its pose), and a `{ type: 'bigWin', … }` render event on `stage.onRenderEvent` for B's news line (request below). Up to 4 beacons; a fifth reuses the oldest. 0 draw calls at rest, 3 while celebrating. No camera moves.
    - **Attract / broken:** `ObjectLayer` sets idle bit 2 in `aState.z` for an open, unbroken, seated machine with nobody on it. `ObjectMaterial` runs a chase across the chase bulbs, or a slow breathe on other flash surfaces, only when that bit is set. Occupied machines' bulbs are steady now. Emissive only: no reel stop, no win line, no payout flash. Broken machines already went dark (A8). They now get a red fault blink on the chase bulbs at 1.1 Hz.
    - **Thought icons:** `src/render/ThoughtIcons.ts`. One instanced, camera-facing bubble draw; the glyphs come from `THOUGHT_EMOJI` (read-only) in a canvas atlas. `ThoughtFeed` polls the existing `guestList` command once a second, and only while a guest is hovered or selected or the Mood view is on; otherwise it fetches nothing and clears. A guest gets a bubble only with a thought in the recent window. In the Mood view the 48 nearest drawn guests within 40 m get one; the first version took the first 48 in list order, which were off-screen. Wiring in `main.ts`: picker hover, guest select and panel close, and a `heatControl.set` wrapper (B's hook request below).
    - **Hitch:** the first eye-level frame compiled the ceiling's alpha-hashed material (2 variants) plus the crowd's LOD0 material and its depth material. `compileAsync` made it worse (wrong colour-space variant outside the composer target, no shadow or AO passes: 438 ms). `Stage.warmEyeLevel` instead renders one throwaway eye-level frame behind agent 0, once, as soon as the ceiling and crowd exist. Lab at High, first `shot('eye')`: **before** 192 ms with 1 new program, and 1,016 ms with 3 on another run; **after** max 33.5 ms, 0 new programs (other frames 3–10 ms).
    - **Camera vs partitions:** `src/camera/arm.ts`. The spring arm casts three parallel rays (the centre and ±0.22 m, the near plane's footprint), keeps its clearance on the shortest, and may shrink to 0.3 m instead of stopping at 0.7 m. The old single ray slipped past a partition's end while the near plane cut into it, and with the avatar backed against a wall the 0.7 m minimum put the camera behind it.
    - **Checks:** `npx tsc --noEmit` clean. New tests: `src/camera/arm.test.ts` (open floor, a wall end the centre ray misses, backed against a wall, pitch), `src/render/fx/celebrations.test.ts` (burst bounds and apex under the ceiling, beacon life) and `src/render/thoughtIcons.test.ts` (nobody without focus or Mood, focus only, Mood order and cap, stale thoughts skipped). `src/camera`, `src/render` and `src/input/avatar`: 13 files, 83 tests pass. `src/sim` untouched, so no economics guard.
    - **Browser:** lab at High: a big win on a front-row slot (beacon on the topper, confetti under the ceiling); a broken centre machine dark and grey with the fault blink, beside attract chases on idle neighbours. App, stress floor: Mood view (M) → 48 bubbles over the nearest guests; Mood off → none; one selected guest → exactly one bubble, matching the inspector's thought ("Not a bad little place.").
    - **Stress scene** (same method as A8; pane hidden, so no fps):

      | view | High calls / tris | Low calls / tris | A8 High |
      |---|---|---|---|
      | overview | 217 / 305k | 152 / 254k | 215 / 304k |
      | mid | 129 / 617k | 74 / 299k | 127 / 617k |
      | close | 87 / 478k | 65 / 327k | 87 / 478k |
      | slot 8 m (16,30) | 66 / 819k | 41 / 445k | 66 / 819k |
      | slot 8 m (24,12) | 62 / 1.02M | 36 / 526k | 62 / 1.02M |
      | slot 8 m (70,44) | 129 / 1.46M | 104 / 887k | 103–128 / 1.29–1.45M |

      Unchanged within guest-position noise; High stays inside ≤ 300 calls and ≤ 1.5M tris. The in-browser tick read 12–19 ms on High and 19–30 ms on Low (hidden page, inflated, as before).

- [x] ✅ **A9. People who look like people.**
  - In `human.py`: 4–6 hairstyles; skirt/dress and jacket silhouettes; a few hats; a simple face (eyes, brows, mouth) through the atlas; a **real female body mesh** (replacing the negative-scale trick).
  - **Staff uniforms by role:** dealer vest and bow tie, security suit, janitor overalls, bartender, mechanic, pit boss.
  - New clips: slot button press, chip place, croupier wheel spin, clap. Wire them where they apply (slots, table bets, roulette dealer, cheering bystanders from A12).
  - Bake as VAT variants chosen per agent. Stay inside **10 MB** for the VAT (trim frames or share clips if you must).
  - **Evidence:** a close-up of 20 guests showing variety and one of each staff role; VAT size; 500 guests inside the frame budget on High and Low.
  - **Done (2026-11-21):**
    - **One superset body** (`assets/blender/human.py`): every garment, hairstyle and hat is in the mesh, tagged with a part number (vertex attribute `aPart`). Each agent carries a bitmask (`aStyle`), and the vertex shader collapses parts it doesn't wear to a point under the floor. A **real female build** (narrower shoulders, bust, hips; its own torso part) replaces the negative-scale trick. 18 parts: male/female torsos; hair (short cap, long, bun, ponytail, curly; bald men wear none); skirt, jacket hem, male/female vests, bow tie, tie, male/female bibs (overalls), apron; fedora, cap, cowboy hat. Face (eyes, brows, mouth) is geometry on LOD0 only: the crowd has no UVs, so an atlas face would have meant adding a UV set and texture fetch to every vertex for 3 small features.
    - **Staff uniforms** (`Crowd.ts` `lookFor`, `OUTFITS`): dealer white shirt, black vest, red bow tie; security dark suit and tie; janitor blue overalls and cap; bartender burgundy vest and apron; waitress white apron; cashier navy vest; pit boss charcoal suit and gold tie; mechanic orange overalls and cap. The worker's snapshot now sends a per-role variant for staff (`STAFF_VARIANT` in `snapshot.ts`, a new constant only).
    - **Clips:** press (slot button), chips (place a bet), spin (croupier wheel), clap. `simClip` maps the sim's Play pose by the game under the agent (`gameSpots.ts`, rebuilt on `setObjects`): slots, pachinko, keno, bingo and seated machines with no game → press; other tables → chips; dealers → deal, or spin at roulette. A12's big-win bystanders now cheer or clap by hash. Cosmetic only; the sim is untouched.
    - **VAT:** new `u16-oct` format (RGBA16UI per vertex per frame: position quantized to the LOD's bounds, normal octahedral in 2 bytes), and slow loops (idle, sit, sad, eat, deal, standplay, chips, spin) baked at 12 fps instead of 20. **human.vat.bin 6.81 MB** (was 7.11 MB before the new parts and clips; cap 10 MB). LOD0 1,838 verts / 3,292 tris superset; LOD1 1,024 / 1,744.
    - **Draw cost:** each LOD is drawn as two builds (male, female), each with an index buffer that skips the parts that build never wears: LOD0 2,388 / 2,838 tris, LOD1 1,268 / 1,452. LOD0 no longer draws itself into the shadow map; a shadow-only proxy per build draws the LOD1 mesh with the LOD0 instances (`ShadowProxy`). Its draw range opens only in `onBeforeShadow`, so other passes issue one empty call and no triangles.
    - **Checks:** `npx tsc --noEmit` clean. New `src/render/crowdLook.test.ts` (one build per agent, at most one hat, build-specific garments match the build, no part from the other build's never-list, >40 guest looks, all hairstyles, skirts and cowboy hats appear, bald men, no bun under a hat, each staff uniform, the clip mapping, `GameSpots` lookup). All of `src/render`: 11 files, 63 tests pass. `src/sim` untouched, so no economics guard.
    - **Browser:** lab `?lineup` at High: 20 guests and one of each staff role, all distinct; a face close-up shows eyes, brows, nose and mouth; female builds, a cowboy hat and ties visible. App, stress floor, eye-level over a dense slot aisle: varied hair, hats, builds and outfits with shadows intact. In-app clip histogram after the settle: walk 496, press 27, sit 3; no guest had reached a table seat in the 20 s settle, so chips, deal and spin are covered by the unit test, not seen in the app.
    - **Stress scene** (A8 method; 1280×800; frames pumped from the page because the pane was hidden, so no fps). Same fresh floor run once on A12's code and once on A9's:

      | view | A9 High | A12 High | A9 Low | A12 Low |
      |---|---|---|---|---|
      | overview | 217 / 304k | 217 / 304k | 152 / 254k | 152 / 254k |
      | mid | 129 / 617k | 129 / 617k | 73 / 298k | 74 / 298k |
      | close | 87 / 478k | 87 / 478k | 64 / 325k | 65 / 326k |
      | slot 8 m (16,30) | 66 / 819k | 66 / 819k | 41 / 445k | 41 / 445k |
      | slot 8 m (24,12) | 62 / 1.02M | 62 / 1.02M | 36 / 526k | 36 / 526k |
      | slot 8 m (70,44) | 132 / 1.47M | 129 / 1.48M | 106 / 896k | 105 / 898k |
      | dense crowd (84,42) at 12 m | 152 / 1.31M (30 LOD0, 348 LOD1) | — | 119 / 995k | — |

      Crowd hidden, every view's non-crowd numbers are identical between the two runs, so the deltas are the crowd's. The standard views rarely hold guests (they cluster near the entrance after spawning), so the dense row is the real test. Worst case seen, 170 LOD0 guests within 9 m on High: **1.49M tris with the shadow proxies, 1.70M without**; calls 143 either way. High stays inside ≤ 300 calls and ≤ 1.5M tris, but a crowd that dense leaves about 10k of headroom. The worker tick read 12 ms (hidden page, inflated as before).

- [x] ✅ **A11. Exterior, entrance, day and night, and unwired juice.**
  - A facade on the entrance side with a **marquee canopy** (lettering) and **glass entrance doors**; interior doors that swing when an agent passes.
  - **Outside:** sidewalk, a street with street lamps and **a few static parked cars** (scripted, low-poly). **No moving traffic, no parking lot to manage.**
  - **Sky:** a sky dome whose colour follows the in-game hour, day to night; street lamps and the marquee switch on at dusk. **The interior always stays lit.**
  - Draw the entrance tile.
  - **Unwired juice:** the hologram ghost in `PlaceTool`; the shader hover highlight on the avatar's hover target.
  - Keep the god camera's limits sensible so the player can see the facade without leaving the lot.
  - **Evidence:** god-view screenshots at noon and midnight; an eye-level shot of the entrance; the ghost and hover shown working; stress numbers on High and Low.
  - **Done (2026-11-21):** all in the new `src/render/Exterior.ts` layer (Stage builds it next to the ground plane), plus three small wirings.
    - **Street side:** the lot edge the entrance tile sits on (east on every shipped layout; north, south and west also handled). Built in a street frame (x out, z along) and mapped once: a 4 m sidewalk with joints, curb, 7.4 m street with a dashed centre line, far curb and sidewalk; street lamps every 8 m (clear of the canopy); five static low-poly parked cars along the near curb, never in front of the doors. No traffic, no parking lot.
    - **Facade and entrance:** stone cladding with a plinth, cornice and gold band on the outer face of every boundary wall, taller on the street side; it uses the wall material's cutaway, so it drops with the walls in the god view. Over the street doors: a stone header with a brass frame, a black marquee canopy with gold fascia, brass posts and bulb rows, and a "CASINO" sign board in marquee lettering (canvas texture) facing the street. A red carpet with gold edges runs from the doors to the curb, and the entrance tile gets a red mat with a gold border and cross.
    - **Doors:** door segments are joined into runs (`doorRuns`). Street runs get two sliding glass panes; interior runs up to 2 m get one or two hinged mahogany leaves; wider runs (the 7 m and 11 m lobby archways) stay open so the arrival rush never queues. Each snapshot, `doorTriggers` finds the nearest agent within 1.3 m of each run, and the leaves swing away from them (eased, 1.4 rad). One instanced draw for leaves, one for panes.
    - **Day and night:** a gradient sky dome (zenith/horizon keyed at 0, 4:30, 6, 8, 12, 16:30, 18:30, 20 h) follows the HUD clock, with scene background and fog matched to the horizon. Lamps, bulbs and the sign come on from 18:30–19:30 to 5:30–6:30 (`nightAt`), with additive light pools under the lamps; outdoor surfaces darken at night and the ground plane lightens by day. Interior lights, lighting rig and quality settings are untouched: the interior stays lit.
    - **Unwired juice:** `PlaceTool` now drives `stage.showGhost` (the real asset as the scan-line hologram, green or red from `canPlace`) with its eased glide, hop and landing squash passed as a new optional `GhostPose`; the legacy box ghost stays hidden. `main.ts` gets one wiring line: `stage.setHovered(controls.interaction.target?.id ?? null)`, so the avatar's interact target gets `ObjectLayer`'s shader highlight.
    - **God camera:** the focus may now go 13 m past the east edge (`GodCamera.clampTarget`), out over the sidewalk and street, so the facade is visible without leaving the lot.
    - **Checks:** `npx tsc --noEmit` clean. New `src/render/exterior.test.ts` (street frame east and north, door runs and street flags, door triggers and sides, sky colours at midnight, noon and dusk, lamp hours). `src/render`, `src/camera`, `src/input`: 16 files, 109 tests pass. `src/sim` untouched, so no economics guard. No DOM UI or CSS touched.
    - **Browser** (sandbox lot, 96×64): noon god view of the facade, street, lamps and a parked car; noon street view with the sky gradient, canopy and sign; eye-level at the doors with guests streaming through the open glass panes; midnight street and god views with a dark sky, lamp pools, glowing sign and bulbs, and a lit interior; a restroom double door closed, then swung away from a (forced) occupant. Build bar → Slot Machine → hologram ghost with its price tag; walk mode next to the placed slot → interact prompt, outline and shader highlight (`hovered` = the target id).
    - **Stress scene** (A9 method; 1280×800; frames pumped from the page, pane hidden, so no fps). Exterior hidden = "without":

      | view | High with / without | Low with / without |
      |---|---|---|
      | overview | 229 / 318k · 217 / 304k | 159 / 263k · 152 / 254k |
      | mid | 140 / 629k · 129 / 617k | 79 / 305k · 73 / 298k |
      | close | 93 / 482k · 87 / 478k | 67 / 326k · 64 / 325k |
      | slot 8 m (16,30) | 71 / 820k · 66 / 819k | 44 / 445k · 41 / 445k |
      | slot 8 m (24,12) | 67 / 1.02M · 62 / 1.02M | 39 / 527k · 36 / 526k |
      | slot 8 m (70,44) | 144 / 1.49M · 132 / 1.48M | 113 / 903k · 107 / 892k |
      | street (100,32.5) at 30 m | 118 / 765k · 104 / 752k | 70 / 128k · 61 / 120k |

      The exterior costs 5–14 calls and at most 14k triangles; 5 calls even off-screen (sky dome, door leaves and panes are not frustum-culled, plus their shadow pass). High stays inside ≤ 300 calls and ≤ 1.5M tris. The worker tick read 11 ms (hidden page).

- [ ] **A14. Finish.** Merge `origin/v2.1` if it moved. Full suite under `caffeinate -i` (background; read the summary), `npm run build`, the stress scene on High and Low against A0's baseline, a screenshot set (one per task), the PR description complete (checklist, evidence, every `contract:` commit and `world.ts` hook), PR out of draft. Report to the user and stop the loop.

## Requests to Track B

(Write here anything you need from Track B's files. Commit it and mention it in your report.)

- **A8, graphics setting (for B's Settings window):** please show the choice as **Auto / High / Low**. Keep Medium out of the menu, though `Stage` still accepts it and Auto can still drop to it. Rendering side, already in place: `stage.setQuality('high' | 'low')`, `stage.getQuality()`, and `stage.suggestedQuality()`, which returns `'low'` on software and weak GPUs and `'high'` otherwise. In `applyQuality`, Auto should start at `stage.suggestedQuality()` instead of `'high'` (keep `dynamicResolution = true` so it can still shed a tier). Explicit High/Low should keep `dynamicResolution = false`, as they do now. Keep the persisted key `v2-graphics-quality`; a stored `'medium'` can map to Auto.
- **A12, big-win news line:** `stage.onRenderEvent` fires `{ type: 'bigWin', objectId, defId, amount, x, z }` whenever a celebration plays (a real sampled round the sim paid, FxDirector's threshold: ≥ $1,000 or ≥ 50× the bet). Please show it on the news line (for example "Big win! $2,500 on a Slot Machine") and, if you like, make the entry click-to-focus at (x, z). It's a client-side render event, not a SimEvent, so it only fires for wins the renderer revealed. It is not wired to anything yet (`main.ts` leaves the default no-op).
- **A12, HeatControl change hook:** the thought bubbles show for everyone near the camera in the Mood view. `main.ts` currently finds out by wrapping `heatControl.set` (wiring lines only). Please add an `onChange(kind)` callback to `HeatControl` (fired from `set`). I'll then swap the wrapper for `heatControl.onChange = (k) => { thoughtFeed.moodView = k === 'mood'; … }`.
- **A12, FYI (no action):** `ThoughtFeed` (src/render/ThoughtIcons.ts) polls the existing `guestList` command once a second, and only while a guest is hovered or selected, or the Mood view is on. `main.ts` sets `thoughtFeed.selected` from the guest panel's open and close, and `hovered` from the picker's `hover` event. If B's guest panel changes how it opens or closes, keep those two lines in step.
- **Carried over from part 1:** the seat-cell reorder request in [5-alive.md](5-alive.md) ("Requests to Track B") still stands; the user is holding it. Don't forward it.
