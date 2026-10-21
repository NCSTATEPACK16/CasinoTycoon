# Handoff 3 — Guest AI, Floor Plan & NavMesh

**Role:** AI & Navigation Engineer. Build the floor plan the whole game stands on, the Recast navmesh, and guests who behave like real casino patrons.

Read `v2/docs/handoffs/_common.md` and `v2/docs/SPEC.md` (§7) first.

## You own
`v2/src/sim/floor/**`, `v2/src/sim/nav/**`, `v2/src/sim/agents/**`, `v2/src/sim/entities/{Guest,Walker,Mess}.ts`, `v2/src/sim/entities/staff/**`, `v2/src/sim/grid/**`, and the floor/build parts of `v2/src/sim/build.ts`. In `v2/src/worker/commands.ts` you own the `paintFloor`, `paintZone`, `wall` and `door` cases plus rotation on `place`/`canPlace`; flag those `contract:`.

## Starting point
- This is the forked v1 sim. `CasinoWorld` (`sim/world.ts`) ticks guests that walk a 40×30 grid via `grid/astar.ts`, with needs (energy, bladder, hunger, thirst, happiness), archetypes and staff (dealer, janitor, security…).
- `worker/snapshot.ts` interpolates `Walker` grid steps into x/z. Once agents move on the navmesh, make the snapshot read their float positions directly.
- The ported tests must stay green, or be consciously rewritten where behaviour intentionally changes. Say which ones in your report.

## Build
1. **FloorPlan** (`sim/floor/FloorPlan.ts`): per-cell `FloorType` and `Zone` (Uint8Arrays), `WallSegment`s on cell edges, doors, the entrance, `toJSON`/`fromJSON`, and `toView(): FloorPlanView`.
   - Painting has a cost per cell per floor type (put the price in `data/`).
   - The world bumps `floorVersion` (worker `SnapshotBuilder.floorVersion`) on change.
   - Placement checks: footprint inside the floored area, every cell's zone ∈ `catalog.ts` zones (empty = any), no wall crossing the footprint interior, and rotation swapping w/h. Expose `place(defId,col,row,rot)`.
   - Sandbox starts with a pre-built starter floor (lobby with an entrance, a gaming floor, a restroom corner); scenarios define their own lot size and starter plan.
2. **NavMesh** (`sim/nav/`):
   - `@recast-navigation/core` + `generators` run in the worker. Init the WASM once (in Vitest too).
   - Input is triangles for every floored cell. Obstacles are walls (thin boxes, door gaps open) and object footprints (inflated boxes).
   - Tiled navmesh with 8 m tiles; incremental rebake of only the dirty tiles on any floor/object change.
   - Areas: zones → area ids, with query filters per agent class (guest, high-roller guest, staff).
   - `Crowd` for ≤ 500 agents, stepped once per sim tick with dt = 0.1 s × speed-independent fixed step, so it stays deterministic.
   - Path queries for targets (seat position from `catalog.ts` seats → world point).
3. **Agents** (`sim/agents/`): replace grid `Walker` movement with crowd agents, while keeping ids and v1 state semantics where sensible.
   - Utility AI: score candidate activities (each game by preference × appeal × distance × crowding × bankroll fit, bar/food/restroom by need urgency, rest, leave) and pick with hysteresis.
   - Queueing at full tables (stand behind, then take a freed seat). Seat assignment uses seat points.
   - Bankroll model (SPEC §7): session bankroll, unit bet, stop-loss/win-goal, BJ skill, comp sensitivity. Session 4's game engines resolve the rounds; you call the `GameEngine` interface (`shared/games.ts`) through the machine objects Session 4 owns. Until those land, keep calling v1's `CasinoGame` play path.
   - Drunk state from the bar; rage-quit; litter.
   - Staff: dealers walk to and stay at their assigned table (a table is closed without one); janitors path to messes; security responds to drunk/raging guests and escorts them out.
4. **Snapshot**: write float x/z/heading from crowd agents, Anim from activity (Walk / Sit / Play / Eat / Cheer on a big win / Sad when broke), and mood.

## Acceptance
- Unit tests:
  - FloorPlan paint/walls/doors/zones and JSON round-trip;
  - placement validity with rotation and zones;
  - navmesh bake on a 40×30 plan in < 150 ms in Node;
  - single-tile rebake < 10 ms;
  - paths respect walls and doors and avoid High-Limit for low-bankroll guests;
  - the crowd keeps 500 agents moving with no NaNs and none stuck after 10k ticks (stuck → re-path → teleport fallback, counted).
- The worker tick at 500 guests stays ≤ 8 ms (measure and report).
- Browser: guests flow through doors, queue at tables, sit at seats, visit restrooms and the bar, and leave through the entrance.
