# Loop prompt for the next session

Paste this into a fresh session after `/clear`, with the working directory at `~/Documents/ClaudeWork/CasinoTycoon`:

```
/loop Continue Casino Tycoon v2 until it is fully playable. The briefing is v2/docs/handoffs/NEXT-SESSION.md (read it in full every iteration) plus v2/docs/SPEC.md.

Each iteration:
1. Run `git log --oneline -5` on v2-foundation and reread NEXT-SESSION.md to see what's done.
2. Take the first unfinished task or ⬜ row. Do only that.
3. Implement it properly, matching the surrounding code. Then verify it with evidence: tests (`cd v2 && npx vitest run <path>`), `npx tsc --noEmit`, and the built-in browser (`preview_start` name "v2"; drive it through the UI, with `window.__v2` only for setup).
4. Tick the item in NEXT-SESSION.md and write down the evidence: test counts, fps, draw calls, tick ms. Commit the work and the ticked file together, with a message that explains why.
5. When every §9 row is ✅: run the full suite under `caffeinate -i` and `npm run build`. If both pass, push v2-foundation, update PR #18's description with the §9 checklist and evidence, report to me, and stop the loop.

Rules:
- Never merge PR #18, and never push any branch except v2-foundation.
- Treat "Test timed out" on a long suite as Mac sleep until proven otherwise; re-run under caffeinate.
- If you hit a decision only I can make, stop and ask.
```
