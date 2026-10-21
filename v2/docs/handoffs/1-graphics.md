# Handoff 1 — Graphics & WebGL

**Role:** Lead Graphics Engineer. Make v2 look like a AAA tycoon game. Planet Coaster is the reference: a crisp, stylized, readable, lush casino interior that is fun to look at. You are the only session that may drive the Blender MCP.

Read `v2/docs/handoffs/_common.md` and `v2/docs/SPEC.md` (§5 especially) first.

## You own
`v2/src/render/**`, `v2/assets/**` (Blender sources `.blend`, exported `.glb`, textures, HDRI), `v2/public/models/**` if you serve from public, and `v2/src/style.css` for the canvas only.

## Starting point
`src/render/Stage.ts` is a placeholder: one Mesh per object, a capsule `InstancedMesh` for agents, and one sun. `main.ts` depends on this public surface, so keep or extend it:
- `new Stage(canvas)`
- `.scene`, `.renderer`, `.ground`, `.ghost`
- `setObjects(ObjectView[])`
- `updateAgents(prev, curr, alpha)`
- `resize(w,h)`, `render(camera)`

Add:
- `setFloor(FloorPlanView)`
- `pickObject(raycaster): string | null`
- `pickAgent(raycaster): number | null`
- `showZoneOverlay(bool)`
- `spawnPayout(x, z, amount)`

Session 2 calls the pick methods, and the lead wires the rest.

## Build
1. **Renderer core**:
   - `InstancePool` (entityId ↔ instance index, swap-remove) and one `InstancedMesh` per (asset, LOD, material).
   - 8×8 chunk manager for floor tiles, carpets, walls and decor, merged per chunk and per material, with dirty-chunk rebuilds driven by `FloorPlanView` diffs.
   - Frustum culling per chunk.
2. **Hero assets** in Blender. Model them clean, low-to-mid poly, bevelled, with good silhouettes; bake AO into vertex colour or a small texture; export GLB with meshopt compression. Each asset sits at its footprint from `data/objects.ts`, origin at the min-corner, +z the front, and named seat empties where players sit or stand (feed these into `shared/catalog.ts` `seats`, flagged `contract:`).
   - **Slots**: a slot cabinet (lit topper, reel window, button deck) and a penny variant.
   - **Tables**: blackjack (kidney table, felt with printed arcs, chip rack, shoe), high-limit blackjack, craps (full rail, printed layout), roulette (wheel plus layout), UTH table, and a generic carnival table.
   - **Other heroes**: big-six wheel, bar counter with back-bar shelves, food counter, restroom block, cashier cage, video poker bank, pachinko.
   - **People**: one rigged low-poly human base (male/female body morph or two meshes) with walk, idle, sit, play (tap/deal), cheer, sad and eat clips, plus outfit material slots for guest archetypes, dealer vest and bowtie, janitor overalls, security suit and the avatar.
3. **Procedural** (code): patterned casino carpet shader (tiling motif and colour per FloorType), marble/wood/tile floors, walls with baseboard and crown moulding, doors, columns, chandeliers and ceiling light coffers (no visible ceiling from god cam; fade it in only in avatar mode), plants, velvet ropes, neon signs (text via canvas texture), marquee.
4. **Crowd**: bake the clips to vertex-animation textures and render all agents with one instanced draw per LOD. Per-instance data is anim, phase, outfit and mood tint. 500 agents must cost ≤ 1.5 ms GPU on an M-series laptop. Turn-to-heading smoothing and a walk-speed-synced phase prevent foot sliding.
5. **Lighting and post**: Poly Haven HDRI (CC0) IBL, a fitted-shadow sun, warm practical lights faked through emissive materials and light probes, `postprocessing` with N8AO + selective bloom + SMAA + vignette, and ACES. Add a quality preset toggle (High/Medium/Low) that falls back gracefully.
6. **Overlays and juice**: placement ghost from the real asset in green/red hologram material; zone tint overlay; selection outline; pooled floating "+$1,250" payout sprites; slot topper flash on a win; build "thunk" squash-and-stretch.

## Acceptance
- A scene with 2,000 mixed objects and 500 agents runs at ≥ 55 fps in Chrome on Apple silicon at 1440p with High quality. Draw calls ≤ 300 (`renderer.info.render.calls`).
- No per-object `Mesh` creation on `setObjects`; a diff updates the pools.
- Screenshots: a god-cam overview of a dense floor, a close-up of each table, and an eye-level view. They should read as professional.
- Unit tests for `InstancePool` (add/remove/swap correctness) and chunk dirtiness.
