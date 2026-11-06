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
    - **Checkpoint 2:** screenshot page https://claude.ai/artifact/GSvX7hvxsCEgfSjrcXfyZ3 (private). Waiting for the user's sign-off before A12.

- [ ] **A12. Celebrations and life.**
  - **Big win** (keep `FxDirector`'s threshold unless you have a reason): a beacon light on the machine, confetti particles (pooled, capped), a bell, nearby guests cheering with the clip. Also emit a client-side news-line entry (a render event Track B's news line can show; write the request). **No camera moves.**
  - **Attract mode** on idle machines (cosmetic only: never a winning line or payout flash; NEXT-SESSION.md's sampled-rounds rule). **Broken machines** go dark with a blinking fault light.
  - **Thought icons:** sampled `thought` events become icon sprites over heads, **only for the hovered or selected guest and in the Mood view** — never always-on. Categories come from `src/data/thoughts.ts`, read-only.
  - **Fixes:** the 66–150 ms hitch the first time eye-level LOD pools load; the third-person camera pressing into lobby partition walls.
  - **Evidence:** screenshots of a big win mid-effect and an attract/broken pair; stress numbers; the hitch measured before → after.

- [ ] **A9. People who look like people.**
  - In `human.py`: 4–6 hairstyles; skirt/dress and jacket silhouettes; a few hats; a simple face (eyes, brows, mouth) through the atlas; a **real female body mesh** (replacing the negative-scale trick).
  - **Staff uniforms by role:** dealer vest and bow tie, security suit, janitor overalls, bartender, mechanic, pit boss.
  - New clips: slot button press, chip place, croupier wheel spin, clap. Wire them where they apply (slots, table bets, roulette dealer, cheering bystanders from A12).
  - Bake as VAT variants chosen per agent. Stay inside **10 MB** for the VAT (trim frames or share clips if you must).
  - **Evidence:** a close-up of 20 guests showing variety and one of each staff role; VAT size; 500 guests inside the frame budget on High and Low.

- [ ] **A11. Exterior, entrance, day and night, and unwired juice.**
  - A facade on the entrance side with a **marquee canopy** (lettering) and **glass entrance doors**; interior doors that swing when an agent passes.
  - **Outside:** sidewalk, a street with street lamps and **a few static parked cars** (scripted, low-poly). **No moving traffic, no parking lot to manage.**
  - **Sky:** a sky dome whose colour follows the in-game hour, day to night; street lamps and the marquee switch on at dusk. **The interior always stays lit.**
  - Draw the entrance tile.
  - **Unwired juice:** the hologram ghost in `PlaceTool`; the shader hover highlight on the avatar's hover target.
  - Keep the god camera's limits sensible so the player can see the facade without leaving the lot.
  - **Evidence:** god-view screenshots at noon and midnight; an eye-level shot of the entrance; the ghost and hover shown working; stress numbers on High and Low.

- [ ] **A14. Finish.** Merge `origin/v2.1` if it moved. Full suite under `caffeinate -i` (background; read the summary), `npm run build`, the stress scene on High and Low against A0's baseline, a screenshot set (one per task), the PR description complete (checklist, evidence, every `contract:` commit and `world.ts` hook), PR out of draft. Report to the user and stop the loop.

## Requests to Track B

(Write here anything you need from Track B's files. Commit it and mention it in your report.)

- **A8, graphics setting (for B's Settings window):** please show the choice as **Auto / High / Low**. Keep Medium out of the menu, though `Stage` still accepts it and Auto can still drop to it. Rendering side, already in place: `stage.setQuality('high' | 'low')`, `stage.getQuality()`, and `stage.suggestedQuality()`, which returns `'low'` on software and weak GPUs and `'high'` otherwise. In `applyQuality`, Auto should start at `stage.suggestedQuality()` instead of `'high'` (keep `dynamicResolution = true` so it can still shed a tier). Explicit High/Low should keep `dynamicResolution = false`, as they do now. Keep the persisted key `v2-graphics-quality`; a stored `'medium'` can map to Auto.
- **Carried over from part 1:** the seat-cell reorder request in [5-alive.md](5-alive.md) ("Requests to Track B") still stands; the user is holding it. Don't forward it.
