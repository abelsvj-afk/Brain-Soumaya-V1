# P2-5 Review Relay — Real Warp Gates & the Transit Space

**What this is:** the design note for P2-5 (`phase-2-p2-5-design-note.md`,
on the `design/worlds-vision` branch under `docs/worlds/`). P2-5 builds the
connective tissue once — warp gates at every world's edge, a real transit
space you fly through in her ship, and an arrival area per world — so all
worlds (the three reachable today, the rest of the roster as they land) plug
into the same road. It changes no economy, no state machine, and authorizes
no new world.

**Paste-ready prompt for the reviewer (ChatGPT / Gemini):**

> You are reviewing a design note for the Soumaya Second Brain's Worlds
> layer (a private single-user second brain; the worlds are a layer on the
> brain, never a second brain). Read `docs/worlds/phase-2-p2-5-design-note.md`
> on the `design/worlds-vision` branch, plus `docs/worlds/design-exploration-1.md`
> §2 (gates/transit) and the settled decisions D-1 (fuel buys speed/spectacle,
> never access), D-10 (Station route always the fallback), D-11 (transit
> durations are upper targets, skippable after first traversal), D-12
> (look-and-tend only for MVP), D-23 (Phase 3 world order), and D-48 (the
> ship is the vehicle that warps; placeholders yield to real assets).
>
> Challenge the design in these areas, without reopening the settled
> decisions:
> 1. **Gate system:** is one shared gate dressed per world the right call,
>    or does it flatten the worlds? Does the Station-as-gateway-hub hold?
> 2. **Transit space:** is the warp/drift distinction honest and dignified
>    — rich vs plain without the drift feeling like a punishment? Is the
>    "one offered reflection, warp only" rule the right line?
> 3. **Ship reuse:** `soumaya-ship.glb` already exists in the home galaxy.
>    Is reusing it in transit sound, and what must the provenance check
>    cover?
> 4. **Arrival areas:** does gate + short approach satisfy "arrival" for
>    each world, or does some world need more?
> 5. **Budgets:** are the §11 criteria applied to transit realistic for a
>    phone (ship GLB + HYG sky + streaks inside the draw-call / tri
>    budgets)? What is the concrete risk?
> 6. **Acceptance testability:** are C1–C6 measurable, or is any criterion
>    subjective? Propose a concrete test for each gap.
> 7. **Gaps:** what is missing, misleading, or unbuildable as written?
>
> Give a verdict: READY / READY WITH CHANGES / NOT READY, then findings
> split into blocking (correctness, honesty, untestable acceptance,
> unacceptable performance risk), required changes (concrete edits), and
> non-blocking recommendations. Be specific and cite the note's sections.
> This is a recommendation only — the owner settles the design.

**After the review returns:** King reconciles it into the note in place
(Rev + D-number), the owner settles the open questions, and only then is the
build authorized.
