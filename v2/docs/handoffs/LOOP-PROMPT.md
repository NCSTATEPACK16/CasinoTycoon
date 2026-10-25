# Loop prompts for the two parallel tracks

Run each prompt in its own fresh session. Ideally that session already has its own worktree: in the desktop app, start a new session with a worktree whose branch is `v2-alive` or `v2-tycoon`, based on `v2-playable`. If it doesn't, task A0/B0 creates one. Never run both tracks in the main checkout.

## Track A: Alive

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
6. When A0 to A12 are all ticked, do A13 (full suite under caffeinate -i, npm run build, screenshot set, PR out of draft), report to me, and stop the loop.

Rules:
- Never merge any PR. Push only v2-alive. Never edit Track B's files; write what you need under "Requests to Track B" and mention it in your report.
- Downloads (sound packs, Poly Haven or Poly Pizza CC0 models) need my OK: ask once per batch with names, URLs, sizes and licences, then carry on with tasks that don't need them. CC0 only, credited in v2/assets/CREDITS.md. No AI-generated models.
- Blender runs headless from the scripts: /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python assets/blender/<script>.py -- <keys>. The Blender MCP is only for searching and importing library assets and for looking at a scene; if it isn't connected when you need it, ask me to open Blender with the addon.
- Treat "Test timed out" as Mac sleep until proven otherwise; re-run under caffeinate -i.
- If you hit a decision only I can make, stop and ask.
```

## Track B: Tycoon

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
6. When B0 to B12 are all ticked, do B13 (full suite under caffeinate -i, npm run build, screenshot set, PR out of draft), report to me, and stop the loop.

Rules:
- Never merge any PR. Push only v2-tycoon. Never edit Track A's files; write what you need under "Requests to Track A" and mention it in your report.
- Scenario goals must be winnable with a reasonable strategy and not winnable by doing nothing, and each needs an automated test proving both.
- Treat "Test timed out" as Mac sleep until proven otherwise; re-run under caffeinate -i.
- If you hit a decision only I can make, stop and ask.
```
