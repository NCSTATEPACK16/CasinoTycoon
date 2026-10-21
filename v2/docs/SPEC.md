# Casino Tycoon v2 — "High Roller": Master Architecture Spec

Status: foundation landed on `v2-foundation`. This document is the source of truth for v2. Each module session reads it together with its own handoff in `docs/handoffs/`.

## 1. Goal and bar
v2 is a 3D browser casino tycoon that should look and feel like a AAA tycoon game: Planet Coaster readability, RollerCoaster Tycoon tactility, and casino math rigorous enough to satisfy a gaming analyst. "Done" means all of §9 passes in one build, verified by playing it.

Pillars:
1. Grid construction with floors, walls, doors and zones.
2. Real casino math for Slots, Roulette, Blackjack, Craps and Ultimate Texas Hold'em.
3. Guests driven by needs and bankrolls, navigating a Recast NavMesh.
4. A god camera that snaps into a 3rd/1st-person avatar who can walk the floor, inspect anything and play real rounds.
5. 2,000 objects and 500 animated guests at 60fps.

## 2. Stack
- Vite 8, TypeScript 6 strict, Vitest 4, Prettier (100 cols, single quotes). No UI framework: UI panels are vanilla DOM (`src/ui/`).
- three r186. Post-processing uses `postprocessing` + `n8ao` (SSAO). Navigation uses `recast-navigation` 0.43 (`@recast-navigation/core|generators|three`).
- Free assets only:
  - Blender MCP for hero GLBs.
  - Poly Haven CC0 for HDRIs and textures.
  - Procedural geometry for everything else.

## 3. Repository layout (`v2/`)
| Path | Owner | Contents |
|---|---|---|
| `src/shared/` | Integration (this repo's lead session) | `contracts.ts` (wire types), `games.ts` (GameEngine), `catalog.ts` (3D metadata). Changes need sign-off from the lead. |
| `src/worker/` | Integration | `sim.worker.ts` tick loop, `snapshot.ts`, `commands.ts` dispatch |
| `src/client/` | Integration | `SimClient` (request/reply + snapshot interpolation) |
| `src/render/`, `assets/` | Session 1, Graphics | Scene, instancing, materials, post, crowd, GLBs |
| `src/camera/`, `src/input/` | Session 2, Physics & Camera | God cam, avatar controllers, picking, build/paint tools |
| `src/sim/nav/`, `src/sim/floor/`, `src/sim/agents/`, `src/sim/entities/{Guest,Walker,staff}` | Session 3, Guest AI | Recast bake, crowd, floor plan, needs/bankroll AI, staff |
| `src/sim/games/`, `src/sim/economy/`, `src/sim/entities/machines/`, `src/data/balance.ts`, `src/sim/economy.ts` | Session 4, Economy | Game engines, levers, ledger, scenarios |
| `src/ui/`, `src/main.ts` | Integration | HUD, palettes, inspectors, rules editor, menus |
| `src/sim/world.ts` | Shared, hooks only | Sessions 3 and 4 may add **narrow, named hooks** (one method each) and must list them in their PR. The lead merges. |

The ported v1 code under `src/sim`, `src/data` and `src/services` is a fork; v1 in `../src` is frozen and must never be imported.

## 4. Threading and state
```
 main thread (60fps)                         worker (10 Hz × speed)
 ┌──────────────┐  Command{reqId}  ┌────────────────────────────┐
 │ UI / input   ├─────────────────►│ commands.ts → CasinoWorld  │
 │ SimClient    │◄─────────────────┤ reply{reqId,ok,data}       │
 │  prev, curr  │◄── Snapshot ─────┤ tick() ×N → SnapshotBuilder│
 │ Stage.render │  (agents buffer  │ seeded Rng, deterministic  │
 └──────────────┘   transferred)   └────────────────────────────┘
```
- The sim is authoritative and deterministic for a seed plus a command sequence. The main thread never mutates sim state; it sends `Command`s (`shared/contracts.ts`).
- The fixed step is `SIM_TICK_MS` = 100 ms, with 50 ticks per in-game hour. Speeds are 0/1/2/4. A wake-up runs at most 40 ticks.
- `Snapshot` carries:
  - `agents`: a `Float32Array`, SoA with stride 8 — x, z, heading, Anim, AgentKind, variant, mood, id. It is transferred, never copied.
  - `objects`: sent only when `objectsVersion` changes.
  - `floor`: sent only when `floorVersion` changes.
  - `hud` and `events`.
- The render interpolates agents between `prev` and `curr` by numeric id using `SimClient.alpha(now)`. Session 1 may add a velocity extrapolation.
- Save: the worker has no `localStorage`. `save` replies with world JSON; the main thread persists it through `services/SaveService` (new `SAVE_VERSION` line for v2, starting at 1); `load` hands it back.
- Coordinates: 1 cell = 1 m. Cell (col,row) spans x∈[col,col+1), z∈[row,row+1), y up. Heading 0 = +z.

## 5. Scene graph and rendering (Session 1)
- **Static objects**: one `InstancedMesh` per (asset, LOD, material slot). An `InstancePool` maps entityId → instance index with a free-list; removal swaps the last index into the hole. Never one `Mesh` per object.
- **Chunks**: the floor is split into 8×8-cell chunks. Floor tiles, carpets, walls and static decor are merged per chunk into one `BufferGeometry` per material. A chunk rebuilds only when its cells change (`floorVersion` diff). Each chunk gets a frustum-culled bounding box.
- **LOD**: GLB heroes get LOD0 (≤6k tris), LOD1 (≤1.5k) and an impostor/box LOD2 beyond 45 m. LOD is chosen per chunk, not per instance.
- **Crowd**: one skinned base mesh rendered through GPU-instanced vertex animation textures (VAT): walk, idle, sit, play, cheer, sad, eat. Per-instance attributes are anim id, phase and outfit palette index. There is no `SkinnedMesh` per guest. Agents get 3 LOD tiers (VAT mesh → low VAT → billboard).
- **Lighting and post**:
  - ACES tone mapping, sRGB output.
  - A Poly Haven HDRI for IBL at low intensity.
  - One `DirectionalLight` with cascaded or fitted shadows over the visible area, plus warm `RectAreaLight`-style fake lighting baked into the materials.
  - Emissive neon feeds selective bloom.
  - N8AO SSAO, SMAA.
  - Night/day exterior through the windows. The interior is always lit.
- **Look**: stylized PBR in the Planet Coaster vein. Saturated jewel tones (crimson carpet, emerald felt, brass, gold), soft AO, chunky readable silhouettes. Signage and slot toppers glow.
- **Overlays**: build ghost (valid green / invalid red), zone tint (translucent per-zone colour plus outline), wall preview, selection outline, floating "+$" payout text pooled as sprites.
- **Budget**: ≤ 300 draw calls, ≤ 1.5M triangles on screen, ≤ 4 ms CPU per frame.

## 6. Casino math (Session 4)
Every game implements `GameEngine` (`shared/games.ts`): pure, seeded and step-based (`begin → options/act → result`). The same engine serves guests and the player avatar. There are no `{p, multiplier}` tables.
- **Slots**:
  - Real par sheets: 3- or 5-reel strips with weighted stops, a paytable and a line count.
  - `theoreticalEdge` = 1 − RTP, computed exactly by enumerating the strips.
  - Several bundled par sheets span 88–97% RTP and low/med/high volatility. Hit frequency and volatility index are computed.
  - Denominations: 1¢, 25¢, $1, $5.
- **Roulette**: European (2.70%) and American (5.26%; the 5-number bet at 7.89%). Bet types: straight, split, street, corner, six-line, column, dozen, even-money. Optional La Partage on single zero.
- **Blackjack**:
  - A real shoe (1/2/6/8 decks) with a cut card. Rule options: H17/S17, 3:2 / 6:5, DAS, RSA, surrender, max split hands.
  - Basic strategy tables are generated for the rule set.
  - `theoreticalEdge` = 0.5% baseline from published rule-adjustment tables (Wizard of Odds style), MC-verified to within ±0.15% over 2M hands.
  - Guests deviate from basic strategy at their skill error rate.
- **Craps**:
  - Pass/Don't Pass with the bar on 12, Come/Don't Come, free odds (3-4-5x or up to 10x), place bets, field, any-7, hardways.
  - Exact edges: Pass 1.414%, Don't Pass 1.364%, odds 0%, field and the props per standard tables.
  - Guests run multi-roll rounds: a "round" is one shooter sequence, settled per decision.
- **Ultimate Texas Hold'em**:
  - Ante = Blind, Trips optional. Play 4x/3x preflop, 2x on the flop, 1x on the river, or fold.
  - The dealer qualifies with a pair or better. The Blind pays per paytable on straight+ when the player wins.
  - The reference strategy is the standard decision table (e.g. raise 4x with any pair 3s+, A-x, K5s+…; flop 2x with two pair+ or hidden pair; river 1x with a hidden pair or ≤20 dealer outs).
  - The edge is ~2.19% of the ante (≈0.53% of total action), MC-verified.
  - A 7-card evaluator (lookup or bit tricks) handles ≥2M hands/s.
- **Levers** (per object, `setRules`): min/max bet, plus each game's rule set above. Every lever maps to `theoreticalEdge`, `roundsPerHour` and `appeal`. Sharp guests (high skill, high-roller archetype) weight appeal; tourists barely notice.
- **Economy**:
  - The ledger records handle (total wagered), win (house net), hold % = win/handle, theoretical win = Σ edge × handle, wages, F&B revenue, comps and upkeep, all per object and per hour/day.
  - Dealers are required to open a table. Their wage is hourly, and their speed affects rounds/hour.
  - Scenario goals run over the ledger, reusing v1 `ScenarioManager` concepts.

## 7. Guests and navigation (Session 3)
- **Floor plan** (`sim/floor/FloorPlan`):
  - Per-cell floor type and zone, with wall segments on cell edges ('n'/'w' ownership, so every edge has one owner) and doors.
  - It is the source of `FloorPlanView`. Placement validity covers floor present, zone allowed (`catalog.ts` zones), footprint free and rotation (w/h swap).
- **NavMesh**:
  - `recast-navigation` runs in the worker. Input geometry is a walkable floor quad per floored cell, with walls and objects as obstacles (footprint boxes, inflated by agent radius 0.3 m).
  - A tiled navmesh uses 8×8 m tiles; a floor/object change rebakes only the touched tiles (≤ 5 ms per tile).
  - Zones map to Recast area flags, so the query filter excludes High-Limit for guests below a bankroll threshold and Back-of-House for all guests.
  - `Crowd` gives local avoidance for ≤ 500 agents at 10 Hz (agent radius 0.3, max speed 1.3 m/s; staff 1.6).
- **Guest brain**: a utility-scored state machine over the v1 needs (energy, bladder, hunger, thirst, happiness). States:
  - `enter → browse → seekGame/seekService → queue → play/consume → leave`.
  - Plus `wander`, `rageQuit` and `drunk` (security target).
- **Bankroll**:
  - Session bankroll by archetype (lognormal), unit bet = clamp(bankroll × riskFrac, table min, table max).
  - Stop-loss 60–100%, win-goal 30–150%.
  - Game preference weights by archetype × appeal × distance × crowding.
  - Blackjack skill (basic-strategy error rate 0–25%) and comp sensitivity.
  - Guests leave when broke, at the stop-loss or win-goal, when exhausted, or when unhappy.
- **Staff**: dealers (assigned to a table; a table closes without one), janitors (patrol to litter/mess), security (respond to drunks/cheats/rage). Each staff member is an agent in the same crowd.

## 8. Camera, physics and interaction (Session 2)
- **God cam**: orbit rig with damped pan (WASD/edge/middle-drag), rotate (Q/E/right-drag), zoom (wheel, 6–90 m), and a tilt that eases with zoom. Clamped to the lot.
- **Picking**: raycast against a ground plane for cells; per-instance raycast (InstancedMesh `instanceId`) or a CPU grid lookup for objects and agents.
- **Build tools**: place with R to rotate; drag-rectangle paint for floor and zone; drag-line walls with door insertion; bulldoze; an RCT-style tactile feel (snap, hover lift, placement thunk, cost tag).
- **Avatar**:
  - The capsule controller (radius 0.3, height 1.75) collides against wall segments and object footprints from the latest `FloorPlanView`/`ObjectView`. There are no physics engine dependencies.
  - Third person: a spring-arm camera with collision pull-in. First person: pointer lock, head bob.
  - The camera snaps God ↔ 3rd ↔ 1st (V / Tab) over 0.8 s: a cubic spline on position, slerp on orientation and a blended FOV (45° → 70°).
- **Interaction**:
  - Hover highlights the nearest interactable within 2 m. E inspects it, showing live stats over the `inspect` command.
  - Sit at a game to enter a play UI driven by `roundBegin`/`roundAct`.

## 9. Exit criteria (the definition of "playable")
1. `npm test` is green, including:
   - exact roulette, craps and slot edges;
   - MC-converged BJ and UTH edges;
   - nav bake/rebake;
   - the ported sim suite.
2. `npm run build` is clean.
3. Browser playtest:
   - start a scenario;
   - paint floor, walls/doors and zones;
   - place all five game types with tuned rules;
   - hire dealers, janitors and security.
4. Guests navigate smoothly, gamble, eat, use restrooms and leave. One day at 4× shows hold% ≈ theoretical edge within noise.
5. In the avatar, snap God → 3rd → 1st, walk, inspect, and play one round of each game.
6. Save → reload → resume.
7. Stress: 2k objects + 500 guests at ~60fps.
8. The look holds up in screenshots of each pillar.
