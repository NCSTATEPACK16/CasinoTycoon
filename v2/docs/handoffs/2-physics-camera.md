# Handoff 2 — Physics, Camera & Interaction

**Role:** Gameplay Camera & Interaction Engineer. Make building tactile (the RollerCoaster Tycoon feel), make the god camera silky, and make the snap into the avatar feel magical.

Read `v2/docs/handoffs/_common.md` and `v2/docs/SPEC.md` (§8) first.

## You own
`v2/src/camera/**` and `v2/src/input/**`. You may create `v2/src/ui/tools/**` for tool-specific UI: the build toolbar, the rotate hint, cost tags.

## Starting point
- `camera/GodCamera.ts` is a basic orbit rig.
- `input/BuildTool.ts` does a ground raycast, a ghost and click-to-place through `sim.command({type:'place'|'canPlace'|'sell'})`.
- Commands and views live in `src/shared/contracts.ts`.
- `Stage` (Session 1) will expose `pickObject(raycaster)`, `pickAgent(raycaster)` and `ghost`. Until those land, pick via `userData.objectId` on meshes, which is how the placeholder Stage works. Code against both.

## Build
1. **God camera**: damped spring rig. Pan with WASD/arrows, screen-edge scroll and middle-drag; rotate with Q/E, right-drag and 90° snap; zoom with the wheel toward the cursor, with pitch easing with distance (low and cinematic close, top-down far). Clamp to the lot. Double-click focuses. Keep an exportable `CameraState` for the lead's save.
2. **Picking service** (`input/Picker.ts`): screen → ground cell, object id or agent id, with a hover state and a selection event, throttled to one raycast per frame.
3. **Build tools** (`input/tools/*`), one tool active at a time through a `ToolManager`:
   - Place: R rotates, the ghost snaps with a lift and ease, cost tag at the cursor, red/green validity from `canPlace`, shift to place repeatedly.
   - FloorPaint and ZonePaint: drag a rectangle, preview the cells, show the cost, send `paintFloor`/`paintZone`.
   - Wall: drag a line along cell edges with an L-shaped path; click a wall to toggle a door (`wall`, `door` commands).
   - Bulldoze: hover highlight and refund tag.
   - Commands not yet implemented sim-side (Session 3 owns them) reply `not implemented yet`; handle that gracefully.
4. **Avatar controller**:
   - Kinematic capsule (r 0.3, h 1.75), walk 1.4 m/s, run 3 m/s, smooth acceleration.
   - Collision against wall segments (`FloorPlanView.walls`, door gaps passable) and object footprints (`ObjectView` + `data/objects.ts` footprint + rotation), plus soft push from nearby agents. Use a uniform spatial hash; no physics library.
   - Spawn at the entrance.
5. **Camera modes and transition** (`camera/CameraDirector.ts`): God ↔ ThirdPerson ↔ FirstPerson with V to cycle and Esc back to God.
   - Over 0.8 s, blend position along a cubic Hermite from the god rig to the avatar's spring-arm (or head), slerp orientation, and blend FOV 45° → 65° (3rd) or 75° (1st).
   - Pointer lock in 1st person.
   - The 3rd-person spring arm pulls in on wall collision.
   - Fire an event so Session 1 can fade in ceilings.
6. **Interaction at eye level**:
   - Nearest interactable within 2 m gets a prompt ("E — Inspect Blackjack Table", "F — Sit & Play").
   - E sends `inspect` and fires a `inspect` DOM CustomEvent with the reply for the lead's UI.
   - F sits: the camera moves to the seat (catalog `seats`) and fires a `playRequested` CustomEvent with objectId. The lead/Session 4 own the play UI.

## Acceptance
- Unit tests:
  - capsule vs walls/doors/footprints, including corner sliding and no tunnelling at 60 and 20 fps;
  - wall-line edge rasterising;
  - drag-rect normalising;
  - Hermite blend endpoints.
- Browser:
  - building 30 slots in rows with shift-place feels quick;
  - the paint tools preview correctly;
  - the God → 3rd → 1st snap has no pop or jitter (record and inspect frames);
  - walking can't pass through walls or tables, but does pass through doors.
