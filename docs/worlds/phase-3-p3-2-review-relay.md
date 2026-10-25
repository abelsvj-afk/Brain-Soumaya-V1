# P3-2 Review Relay — for ChatGPT

**From:** King (owner's agent) — prepared 2026-10-25
**To:** ChatGPT (GitHub-connected reviewer)
**What to review:** `docs/worlds/phase-3-p3-2-design-note.md` (DRAFT) on branch `design/worlds-vision` — the Deep Past, the second memory-bearing world.
**Context to read first:** `docs/worlds/design-exploration-1.md` (Rev 88 — the governing design doc, especially §1 Deep Past, §13 information model, §14 Animation Gate A21/A22, §17 mutation & control, §20 recipe register), `docs/worlds/recipe-deep-past.md` (R-D1–R-D4, settled), `docs/worlds/phase-3-p3-1-design-note.md` (the P3-1 pattern this note follows), and `docs/worlds/worlds-cold-check-relay.md` (the cold check now running over the live worlds — its findings may change this note; if you spot anything in P3-2 that the cold check should also hunt, say so).
**What is settled (do not re-litigate):** the Deep Past recipe (R-D1–R-D4, depth semantics, chronological monotonicity), D-7 membership (explainable age + resurfacing-context rule, never "forgotten" by age alone), D-6 Chronicle Path as guided mode, the roster order (Deep Past is next per D-23), and the flag being ON (D-70 — no more dark shipping).
**What to test hard:**
1. **The membership rule (§3.3, Q1).** Is the proposed rule — `createdAt` + `lastTendedAt` + a resurfacing-context signal — actually definable from the graph payload the client holds? If the payload cannot carry one of the inputs, say so. Is the rule explainable in one plain line per member? Can it ever classify a memory as forgotten by age alone?
2. **The rise (§3.4, Q2).** The note recommends shipping A22 as derived presentation in P3-2. Test this boundary against §17: does the rise need the propose→decide→apply rail, or is per-visit derivation from brain facts genuinely rail-free? If it needs the rail, the rise waits for Phase 4 — say so plainly.
3. **Completeness (§3.5, C9).** The owner directed that every reachable angle be finished. Is C9 testable as written? Are the camera bounds actually enforceable in the scene design, or is there a reachable void the note misses?
4. **Guided mode depth (Q3).** Is follow-only the right scope, or does the guided mode need tour machinery to be worth building? Check A21 against §15 N7.
5. **The budget (§4 C4).** ≤90 calls / ≤440k tris for a helix + alcoves + lanterns + thread + particulate + basin + ships. Is the allocation credible? The Phase 1 Deep Past mockup was never run — what does that do to the confidence of this budget?
6. **Kindness (C3).** Nostalgia tipping into rumination is the named risk. Does the note's design actually prevent auto-pull into painful material? Read every user-facing behavior in §3.6 and §4 with that risk in mind.
7. **Anything the note contradicts** — in the recipe, the design doc, or the P3-1 precedent. If the note and the settled ground disagree, the settled ground wins and the disagreement is a finding.
**How to report:** verdict first (READY / READY WITH CHANGES / NOT READY), then findings ordered by severity, each with file + section, what is wrong, and what should change. Do not propose new features or redesign the world. Do not repeat the note back.
