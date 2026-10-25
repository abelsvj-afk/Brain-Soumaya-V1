# ChatGPT Review 29 — P2-6 Great Station Scale-Up (formal design review)

**Relayed by the owner, 2026-10-25. Verdict: READY WITH CHANGES.**
**Scope reviewed:** `docs/worlds/phase-2-p2-6-design-note.md` (DRAFT) + `docs/worlds/design-exploration-1.md` + `docs/worlds/recipe-great-station.md` + `docs/worlds/free-spaceship-shortlist.md` + `docs/worlds/worlds-cold-check-relay.md`, all on `design/worlds-vision`.
**Standing:** a design verdict only. It does not authorize implementation, merging, deployment, or changes to the settled recipe. Note: the owner had already authorized the P2-6 build (D-71, "Lets start building all of this") before this review arrived — the findings below are reconciled into the note and the build/fix list, not treated as a pre-build gate. That bypass is recorded in the design doc (Rev 90).

## Findings (ordered by severity)

### B-1 — The triangle budget has no enforceable margin rule
The note says "materially below" 750,000 triangles but never defines it. "Cut or LOD'd" is insufficient: LOD can reduce visible triangles at one distance without guaranteeing the total stays below the ceiling in every required view. The recipe's own allocation already consumes the full 750,000 allowance. C4's response to a measured miss (optimize or design return) is valid, but there is no predetermined margin distinguishing acceptable from warning before the build.
**Required:** a numeric internal triangle target below 750,000 with explicit reserve for uncertainty and combined scene load (750,000 stays the hard rejection boundary); measurements for actual assets and worst-case visible configurations, not estimates; a defined fallback if assets exceed the internal target (remove/replace lower-priority accessories, reduce measured visible geometry, or return to design — never quietly consume the reserve or weaken visuals to force a pass); the same principle for the ≤88 draw-call target. The exact internal target is an owner/design decision; the reviewer will not invent it.

### B-2 — C8's asset-license gate needs an auditable procedure
The policy requires license verified from the file + credits entry + measured tri count per asset; the shortlist records verification from source pages. The note does not reconcile the two standards, nor say whether the builder inspects all 240 Kenney files or only selected assets.
**Required:** an inventory of every model actually selected for shipping (source pack, exact model/file identity, license evidence, attribution/modifications note, measured tri count, final asset identity); inspect the downloaded archive's license/readme material and map it to the selected models (a pack-level license can cover multiple models if the evidence clearly establishes coverage); resolve what happens when the source page states CC0 but the downloaded files contain no license evidence (under the strict rule the asset must not silently pass on the source-page claim alone — the owner must clarify an acceptable evidence standard or the asset is excluded); the credit record and measured ledger must correspond to the actual shipped files, including converted/modified GLBs.

### B-3 — The scale criteria need objective acceptance thresholds
"Overfills the view," "reads at a glance," "shares the frame" are subjective. Q1 leaves the ratio and far-stage distance unsettled while C1 expects the settled ratio in the layout constants.
**Required:** settle the ship-length-to-wheel-diameter ratio and the far-stage distance as explicit design values after measuring the Profondo hull; define how C1 is evaluated from the recorded approach (e.g. a specified view/framing condition for final-approach coverage, a defined frame where the scale witness must be visible); record the final measured hull dimensions, resulting approach-stage distances, and approved ratio in the build evidence; verify the changes preserve the crown-and-stem silhouette, four-arm form, amber/indigo identity, and middle-distance witness composition. The ratio and distance are settled by the owner, not guessed by the builder or reviewer.

### B-4 — The animation proposal needs a clear boundary against new state machinery
Ambient traffic, work-light animation, and a first-arrival orbit reveal fit the existing inventory (A15 first arrival, A17 traffic). The ambiguity is "docking sequences (a ship easing onto an arm)" — without a boundary that could be read as persistent docking state, ship schedules, or autonomous traffic behavior. §14.1 requires each animation's trigger, actors, movement, duration, reduced-motion equivalent, cost, and user controls (skip, cancel, interruption, repeat) — the note does not complete those fields for the new animations.
**Required:** state docking is a presentation-only ambient animation (no persistent docking state, schedules, simulated users, or new travel/state-machine behavior); keep the orbit reveal within the existing A15 contract (skippable, not repeated unless requested, reduced-motion equivalent); complete the §14.1 control and cost fields for docking, work-light, and first-arrival behaviors; include these animations in the combined worst-case load and fallback accounting; reduced motion must preserve the same scene information and arrival behavior, not merely hide the effects. The "traffic implies no users" rule stays explicit.

### B-5 — C7's camera-completeness test is not yet reproducible
"Drive the camera to every allowed extreme" does not define the set of allowed extremes or how coverage is recorded. The test must cover the actual reachable camera bounds of the WorldsSurface camera system.
**Required:** record the actual camera-control limits and identify every reachable boundary (min/max zoom or distance, orbit-angle extremes, allowed pan/target offsets, approach-corridor limits); define a repeatable coverage sweep over those bounds including relevant combinations of extremes, and retain evidence for each tested view; include scripted approach transitions and the reduced-motion path; if a view cannot be completed, constrain the camera so that view is genuinely unreachable and test that constraint. Do not count an undocumented or untested angle as complete. This is a testability gap, not evidence the existing Station is defective.

### B-6 — The pending cold-check result is a required reconciliation input
The note says the cold check's Station-scale findings may change P2-6; the relay identifies the scale hunt as an active check of the live code. The relay supplied is the hunt brief, not completed findings — the reviewer cannot claim the live Station passed or failed.
**Required:** before owner settlement, reconcile the returned cold-check findings against §3.1 and C1; if the live scene exposes a scale defect, record whether the proposed dimensions and witnesses actually address it; keep unverified device-scale observations explicitly marked as pending. (Recorded against the actual sequence: owner settlement D-71 already happened at his word — the cold-check findings reconcile into the build/fix list when they return, per the recorded bypass.)

## Cleared points and consistency check

- R-S1–R-S4 retained: crown-and-stem form, palette, deferred name, slow ring rotation. No reopening of the recipe.
- D-37: Profondo remains the hull; procedural crown-and-stem remains backup. The accessory layer is consistent with the settled direction.
- D-5: Station remains a home port for orientation, routes, journeys — not a memory surface.
- D-2: fictional megastructure; interior stays out of scope.
- Budget limits: ≤88 draw calls / ≤750,000 tris correctly retained as the stricter Station design budget; global §11 ceilings unchanged. The problem is margin enforcement, not the ceilings.
- Traffic honesty: ambient traffic remains atmosphere, not a claim about real users or brain activity.
- Fallback hierarchy: silhouette, guidance lights, route information, arrival preserved as non-degradable essentials.
- Scope boundary: economy/state-machine changes, home galaxy, other worlds, Station interior, and the separate NPC/autonomous-agent track explicitly excluded. Keep that boundary.

## Final disposition

**READY WITH CHANGES.** Before P2-6 design settlement, resolve the measurable budget margin, make the per-asset provenance gate auditable, make the scale acceptance thresholds objective, specify the animation-state boundary and required control fields, and make the camera coverage test reproducible. Reconcile the live Station-scale cold-check results when they arrive. Directionally sound; no redesign needed. No implementation, merge, or deployment is authorized by this review.
