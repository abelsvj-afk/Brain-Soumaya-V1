# P3-1 Review Relay — paste-ready package (owner-relayed 2026-10-24)

**What to read (all on branch `design/worlds-vision`):**
- The note under review: `docs/worlds/phase-3-p3-1-design-note.md`
- The settled recipe: `docs/worlds/recipe-growing-place.md`
- The design record for context: `docs/worlds/design-exploration-1.md` (§13 information model, §17 mutation & control) and the reviewer brief `docs/worlds/README.md` (items 67–68).

**Direct links:**
- https://github.com/abelsvj-afk/Brain-Soumaya-V1/blob/design/worlds-vision/docs/worlds/phase-3-p3-1-design-note.md
- https://github.com/abelsvj-afk/Brain-Soumaya-V1/blob/design/worlds-vision/docs/worlds/recipe-growing-place.md

## Paste this into ChatGPT (and Gemini — same prompt works for both)

> You are an independent design reviewer for the "worlds" expansion of Soumaya Second Brain, a private second-brain app. Read the P3-1 design note at the link above (plus the Growing Place recipe). P3-1 is the first memory-bearing world: a garden that renders the brain's own data — plots = memories, paths = connections, landmarks = completed life-chapters.
>
> SETTLED — do not reopen: Phase 3 order (Growing Place first); recipe R-G1–R-G4; Q1 = presence-only landmarks for Journeys the user has marked done (the rising ceremony stays Phase 4); the build ships dark behind the worlds flag (flag flip, deploy, and device checks are separate owner steps); no §17 mutation rail in P3-1; the home galaxy is untouched.
>
> REVIEW FOCUS:
> 1. **Q2 — all memories as plots.** Does the layout scale honestly (245 memories now, thousands later)? Does age-banding stay readable and non-ranking?
> 2. **§2.5 galaxy-vs-garden.** Verify the comparison against the galaxy's real behavior as described. Does any P3-1 mapping re-encode a signal the galaxy already carries (progress, review strength, importance) differently, or duplicate a galaxy job (navigation, editing)?
> 3. **Tier-ii deferral.** The note defers faint "suggested connection" trails because the graph payload doesn't distinguish confirmed from suggested. Sound — or is there a better honest treatment?
> 4. **C1/C2 testability.** Are determinism and traceability actually testable as the acceptance criteria are written?
> 5. **Budget realism.** ≤95 draw calls / ≤700k triangles for terraces + witness tree + instanced vegetation + plots + paths + landmarks — credible against the recipe's allocation?
> 6. **Honesty and kindness.** Any invented data, any place the garden could punish, shame, or mislead — including for a brain with very few memories, or a user in a bad week?
> 7. **Gaps.** Missing acceptance criteria, missing risks, anything the note assumes that it should prove.
>
> RETURN: a findings table (finding / severity / suggested fix), then a verdict — READY / READY WITH CHANGES / NOT READY — and anything you would settle differently, with reasons. Your text is a recommendation to the owner; he settles.

**After the reviews return:** the builder (King) reconciles them into the note (revisions, never replacements) and the owner settles any remaining questions — then, and only then, his separate word authorizes the build.
