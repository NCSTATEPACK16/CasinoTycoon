# Loop prompts

Run each prompt in its own fresh session with its own worktree. Never run a track in the main checkout.

## v2.1 Track A part 2 (current)

```
/loop Track A part 2 of Casino Tycoon v2 (v2.1): decor art, lighting, celebrations, people, exterior. Briefing, read in full every iteration: v2/docs/handoffs/NEXT-SESSION.md (shared rules; its v2.1 section overrides older lines), v2/docs/handoffs/10-alive-2.md (your task list) and v2/docs/SPEC.md.

Each iteration:
1. git fetch origin. If origin/v2.1 has commits your branch lacks, merge them in (merge, not rebase), resolving with the ownership rules in NEXT-SESSION.md. Then git log --oneline -5 and reread the briefing.
2. Take the first unticked task in 10-alive-2.md and do only that, in its order (A0, A10, A8, A12, A9, A11, then A14). A0 sets up your worktree on branch v2-alive-2 from origin/v2.1, launch config "v2-alive-2" on port 5175, npm install, a draft PR into v2.1, the CC0 texture download request, and the stress baseline. Never work in the main checkout at ~/Documents/ClaudeWork/CasinoTycoon.
3. Read the code the task touches before changing it. Use subagents where they help and check their work yourself.
4. Verify with evidence: npx tsc --noEmit; only the affected test files; the economics guard if you touched src/sim; the built-in browser (preview_start "v2-alive-2"), driving the change through the UI, window.__v2 only for setup; screenshots; stress-scene fps, draw calls, triangles and tick before and after, on High and (once A8 lands) Low.
5. Tick the task with that evidence. Commit work and ticked file together (message explains why, ends with the Co-Authored-By line). Push v2-alive-2 only, and update the draft PR.
6. Checkpoints: after A10 and after A8, publish the screenshots as a private Artifact page, report the link to me and stop the loop until I sign off. After A14, report and stop the loop.

Rules: never merge any PR; push only v2-alive-2; don't edit DOM UI or CSS (Track B owns it in v2.1) — write requests under "Requests to Track B"; downloads need my OK per batch (CC0 textures only, credited in v2/assets/CREDITS.md); no AI-generated models; Blender runs headless from the scripts, the Blender MCP only to look or search; run long suites in the background and read only summaries; treat "Test timed out" as Mac sleep until proven otherwise; if you hit a decision only I can make, stop and ask.
```

## v2.1 Track B part 3 (current)

```
/loop Track B part 3 of Casino Tycoon v2 (v2.1): rebuild the UI in the style of Cities: Skylines and RollerCoaster Tycoon (B15), then decor with real effects (B6). Briefing, read in full every iteration: v2/docs/handoffs/NEXT-SESSION.md (shared rules; its v2.1 section overrides older lines), v2/docs/handoffs/11-ui-b15.md (your task list), v2/docs/handoffs/8-decor-b6.md (B6's spec) and v2/docs/SPEC.md.

Each iteration:
1. git fetch origin. If origin/v2.1 has commits your branch lacks, merge them in (merge, not rebase), resolving with the ownership rules in NEXT-SESSION.md. Then git log --oneline -5 and reread the briefing.
2. Take the first unticked task in 11-ui-b15.md and do only that, in its order (B15a–B15g, B6, then B16). B15a sets up your worktree on branch v2-tycoon-3 from origin/v2.1, launch config "v2-tycoon-3" on port 5176, npm install, a draft PR into v2.1, and builds the mockup. Never work in the main checkout at ~/Documents/ClaudeWork/CasinoTycoon.
3. Read the code the task touches before changing it. Use subagents where they help and check their work yourself.
4. Verify with evidence: npx tsc --noEmit; only the affected test files; for B6 and anything that moves guests, money or goals, the campaign suites and career.test.ts with before → after numbers; the built-in browser (preview_start "v2-tycoon-3") at the B15g sizes, driving changes through the UI, window.__v2 only for setup; screenshots.
5. Tick the task with that evidence. Commit work and ticked file together (message explains why, ends with the Co-Authored-By line). Push v2-tycoon-3 only, and update the draft PR.
6. Checkpoint: after B15a, publish the mockup as a private Artifact page, report the link and stop the loop until I pick a variant. After B16, report and stop the loop.

Rules: never merge any PR; push only v2-tycoon-3; don't edit Track A's render, input, audio or asset files — write requests under "Requests to Track A"; restyle Track A's UI panels without changing their behaviour; scenario goals must stay winnable with a reasonable strategy and not by doing nothing, each with an automated test; run long suites in the background and read only summaries; treat "Test timed out" as Mac sleep until proven otherwise; if you hit a decision only I can make, stop and ask.
```

## Earlier prompts (v2 ship cut; finished)

### Track A: Alive

```
/loop Track A of Casino Tycoon v2, "Alive": make the floor look, move and sound like a real casino, in the current lively stylized style. Briefing, read in full every iteration: v2/docs/handoffs/NEXT-SESSION.md (shared rules), v2/docs/handoffs/5-alive.md (your task list) and v2/docs/SPEC.md.

Each iteration:
1. git fetch origin. If origin/v2-playable has commits your branch lacks, merge them in first (merge, not rebase), resolving with the ownership table in NEXT-SESSION.md. Then run git log --oneline -5 and reread both briefing files.
2. Take the first unticked task in 5-alive.md and do only that. A0 comes first: your own worktree on branch v2-alive cut from origin/v2-playable, launch config "v2-alive" on port 5175, npm install, a draft PR into v2-playable, and the one download request for sounds. Never work in the main checkout at ~/Documents/ClaudeWork/CasinoTycoon.
3. Read the code the task touches before changing it. Use subagents where they help (Explore to map code, general-purpose for a self-contained test or a CC0 search), and check their work yourself. Implement the task properly, matching the surrounding code.
4. Verify with evidence:
   - npx tsc --noEmit
   - only the affected test files (cd v2 && npx vitest run <paths>)
   - the economics guard if you touched src/sim
   - the built-in browser (preview_start name "v2-alive"), driving the change through the UI, with window.__v2 only for setup
   - screenshots for anything visual
   - for anything that renders or ticks: fps, draw calls, triangles and tick ms on the stress scene, before and after
5. Tick the task in 5-alive.md with that evidence. Commit the work and the ticked file together, with a message that explains why and ends with the Co-Authored-By line. Push v2-alive only, and update the draft PR's checklist.
6. Work through the "Ship cut" section of 5-alive.md in its order (A3, A4, A7, A5, A6). When those are all ticked, do A13 (full suite under caffeinate -i, npm run build, screenshot set, PR out of draft), report to me, and stop the loop. Don't start anything under "After ship".

Rules:
- Never merge any PR. Push only v2-alive. Never edit Track B's files; write what you need under "Requests to Track B" and mention it in your report.
- Downloads (sound packs, Poly Haven or Poly Pizza CC0 models) need my OK: ask once per batch with names, URLs, sizes and licences, then carry on with tasks that don't need them. CC0 only, credited in v2/assets/CREDITS.md. No AI-generated models.
- Blender runs headless from the scripts: /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python assets/blender/<script>.py -- <keys>. The Blender MCP is only for searching and importing library assets and for looking at a scene; if it isn't connected when you need it, ask me to open Blender with the addon.
- Treat "Test timed out" as Mac sleep until proven otherwise; re-run under caffeinate -i.
- If you hit a decision only I can make, stop and ask.
```

### Track B: Tycoon

```
/loop Track B of Casino Tycoon v2, "Tycoon": give the player hours of decisions worth making. Briefing, read in full every iteration: v2/docs/handoffs/NEXT-SESSION.md (shared rules), v2/docs/handoffs/6-tycoon.md (your task list) and v2/docs/SPEC.md.

Each iteration:
1. git fetch origin. If origin/v2-playable has commits your branch lacks, merge them in first (merge, not rebase), resolving with the ownership table in NEXT-SESSION.md. Then run git log --oneline -5 and reread both briefing files.
2. Take the first unticked task in 6-tycoon.md and do only that. B0 comes first: your own worktree on branch v2-tycoon cut from origin/v2-playable, launch config "v2-tycoon" on port 5176, npm install, and a draft PR into v2-playable. Never work in the main checkout at ~/Documents/ClaudeWork/CasinoTycoon.
3. Read the code the task touches before changing it. Use subagents where they help (Explore to map code, general-purpose for a self-contained test, an edge derivation or a review), and check their work yourself. Implement the task properly, matching the surrounding code.
4. Verify with evidence:
   - npx tsc --noEmit
   - only the affected test files (cd v2 && npx vitest run <paths>)
   - the campaign suites (src/data/campaigns, src/sim/world.tier2.test.ts, src/sim/agents/crowd.test.ts) whenever the change can move guests, money or goals, with before → after numbers
   - the built-in browser (preview_start name "v2-tycoon"), driving the change through the UI, with window.__v2 only for setup
   - screenshots of new panels
5. Tick the task in 6-tycoon.md with that evidence. Commit the work and the ticked file together, with a message that explains why and ends with the Co-Authored-By line. Push v2-tycoon only, and update the draft PR's checklist.
6. Work through the "Ship cut" section of 6-tycoon.md in its order (B5, B7, B8, B12). When those are all ticked, do B13 (full suite under caffeinate -i, npm run build, screenshot set, PR out of draft), report to me, and stop the loop. Don't start anything under "After ship".

Rules:
- Never merge any PR. Push only v2-tycoon. Never edit Track A's files; write what you need under "Requests to Track A" and mention it in your report.
- Scenario goals must be winnable with a reasonable strategy and not winnable by doing nothing, and each needs an automated test proving both.
- Treat "Test timed out" as Mac sleep until proven otherwise; re-run under caffeinate -i.
- If you hit a decision only I can make, stop and ask.
```

## After the ship cut (added 2026-11-01)

The ship cut of both tracks is done or nearly so. Further work runs from its own task file, each with its loop prompt at the bottom:

- [7-tycoon-2.md](7-tycoon-2.md): B9 real engines for eight games, B11 staff depth, B10 marketing. Branch `v2-tycoon-2`, port 5177. Can run now.
- [8-decor-b6.md](8-decor-b6.md): B6 decor and amenities. Branch `v2-decor`, port 5178. Only after Track A's PR is merged.
