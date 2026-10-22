# Worlds Design — Reviewer Brief

**For:** ChatGPT, reviewing on GitHub at the owner's request
**Branch:** `design/worlds-vision` · **Folder:** `docs/worlds/`
**Status:** Design exploration only. Nothing here is decided, and nothing here authorizes code, a merge, or a deploy.

## Read in this order

1. **`vision-brief-2026-10-22.md`** — the owner's raw vision, in his words, organized: many spaces beyond the home galaxy, EVE-style jump gates whose transit is a space you move in, directed ship travel and tours, at least one space with real felt scale, real celestial content where possible, free/placeholder 3D now and real content later, and a world that mutates with the user's memories, emotions, growth, and aspirations — on top of a second brain that stays the core.
2. **`design-exploration-1.md`** — King's exploration, now at **Revision 2**: candidate spaces each tied to a second-brain job, gate/transit design, the scale question, a mutation model with a never-punish analysis, tours, placeholder-asset strategy, the scenery problem, the open questions — plus §9, which absorbs ChatGPT review 1 (unique-outcome test, environment-recipe method, mutation tightening, settlement sequence) and the owner's fuel-gated warp proposal (§9.10, questions 26–28).
3. **`chatgpt-review-1-2026-10-22.md`** — the record of ChatGPT's first review (verdict: strong vision, design gate still open; ready for the next design iteration, not for architecture or implementation).
4. **`gemini-research-1-2026-10-22.md`** — Gemini Deep Research (scenery study, asset hunt, celestial data) **with King's verification table**: which claims are confirmed, which are corrected (HYG ShareAlike scope; ESA/Hubble is CC BY 4.0), and which are dropped. Exploration §10 absorbs the verified findings as a proposed technique stack (Q25) and adds Q29 (Great Station form).
5. **`chatgpt-review-2-2026-10-22.md`** — the record of ChatGPT's second review (§13 information model + §14 Animation Gate; verdicts: strengthen three boundaries, keep the gate), absorbed into Exploration Revision 7.
6. **`chatgpt-review-3-2026-10-22.md`** — the record of ChatGPT's third review (§15 navigation & scale; utility-first principle, recommendations on Q-N1–Q-N4, the cancel / turn back / return home distinction), absorbed into Exploration Revision 10.
7. **`chatgpt-review-4-2026-10-22.md`** — the record of ChatGPT's fourth review (§17 mutation & control; stricter presentation boundary, dependency-aware undo, calm cadence, dual-door log, failure-atomicity invariant), absorbed into Exploration Revision 12.
8. **`chatgpt-review-5-2026-10-22.md`** — the record of ChatGPT's fifth review (§18 mockup specification; cohesion tested not assumed, travel-guarantee checks in the session script, failure-diagnosis taxonomy, recipe minimum contents), absorbed into Exploration Revision 14.
9. **`chatgpt-review-6-2026-10-22.md`** — the record of ChatGPT's sixth review (§19 architecture & roadmap; failure-independence invariant, per-phase authorization separateness, Q27 as a mandatory Phase 2 gate, design gate stays open after step 6), absorbed into Exploration Revision 16.
10. **`recipe-great-station.md`** — the Phase 0 environment recipe for the Great Station (draft for owner settlement): identity, approach composition, honest content, budget allocation, animation slice, seed traceability table, and the D-13 evidence the mockup must produce.
11. **`chatgpt-review-7-2026-10-22.md`** — the record of ChatGPT's review of the Great Station recipe (no blocker; R-S1–R-S4 recommendations; triangle-boundary and D-13-openness notes), absorbed into the recipe. The recipe itself was **settled by the owner** afterward (R-S1/R-S2/R-S4 approved, R-S3 deferred).
12. **`recipe-growing-place.md`** — the Phase 0 environment recipe for the Growing Place (draft for owner settlement): terraced garden + witness tree, the kindness rule, milestone landmark grammar, A6/A7 animation slice, budget allocation.
13. **`chatgpt-review-8-2026-10-22.md`** — the record of ChatGPT's review of the Growing Place recipe (no blocker; R-G1–R-G4 recommendations incl. the R-G3 non-ranking mapping constraint), absorbed into the recipe. The recipe itself was **settled by the owner** afterward (all four as recommended, R-G3 with its constraint).
14. **`recipe-deep-past.md`** — the Phase 0 environment recipe for the Deep Past (draft for owner settlement): descending helix of lit strata, the depth rule, Chronicle guided descent with the full A1–A3 chain, proposed A21/A22 animation entries. Its settlement completes Phase 0's paper.
15. **`chatgpt-review-9-2026-10-22.md`** — the record of ChatGPT's review of the Deep Past recipe (no blocker with the constraint; R-D1–R-D4 recommendations incl. chronological monotonicity, the rise as derived presentation, and deliberate A21/A22 ratification), absorbed into the recipe. The recipe itself was **settled by the owner** afterward (all four as recommended, constraint included; A21/A22 ratified into §14). **Phase 0 is complete (D-26).**
16. **`phase-1-builder-brief.md`** — the Phase 1 task brief, issued under the owner's **Phase 1 authorization (D-27, 2026-10-22)**: throwaway mockups only, sequential gates, fixed §11 criteria, per-mockup result records, failure-stop protocol. Product implementation, merging, deployment, and later phases remain unauthorized; the design gate remains open.
17. **`mockup-result-station.md`** — the Station mockup's result record: scene **built** (throwaway fixture scene in the worlds workspace), verdict **UNRESOLVED** — §11 grading awaits the owner's phone run (device, measurements, D-13 stills, V1–V3/V6); P6 and V5 supported by construction, V4 partial. Growing Place remains parked until the Station resolves.
18. **`mockups/station/`** (folder on this branch) — the Station mockup's code itself, mirrored here at the owner's decision for implementation review: `index.html` (the scene), `three.module.min.js` (vendored three 0.182.0), `README.md` (how to run it on the grading device). Throwaway fixture code — not the product, not a foundation, merges nowhere.
19. **`chatgpt-review-10-2026-10-22.md`** — the record of ChatGPT's code-level review of the Station mockup (verdict UNRESOLVED) with the builder's dispositions: counter accounting fixed, harness extended to §11 lengths + cold-load, behavioral grammar implemented in-scene at fixture level, V4 derivation table added to the result record. Device run still pending.
20. **`chatgpt-review-11-2026-10-22.md`** — the record of ChatGPT's Revision 28 review (verdict UNRESOLVED) with dispositions: session-peak render counts tracked; behavioral checks upgraded from scripted logs to verified before/after assertions (overlap case closed); the scripted-log vs verified-assertion distinction now carried by the record.
21. **`chatgpt-review-12-2026-10-22.md`** — the record of ChatGPT's Revision 29 review (verdict UNRESOLVED) with the final code-level disposition: an armed-departure policy enforced across all controls (only Cancel live during the window) and fuel floored at 0. The code-level list is closed; remaining Station acceptance work is device-side only.
22. **`chatgpt-review-13-2026-10-22.md`** — the record of ChatGPT's Revision 30 review: Review 12's fix verified closed; one added caution (frame-count animation timing) fixed by converting camera/cargo animation to measured elapsed time. No known code-level items remain.
23. **`chatgpt-review-14-2026-10-22.md`** — the verification closure of the mockup review series: the reviewer inspected the Rev 31 commit itself (timing fix correct; the 100 ms-cap stall-stretch behavior recorded as a grading note) — **no new code-level blocker**. Next step is the owner's phone evidence run; Growing Place stays parked; V6 is the owner's alone.

## The most important instruction

**What the separate spaces will consist of is NOT settled — it is to be determined jointly by the owner, King, and you (ChatGPT).** Every space, contents list, and mechanic in the exploration is a candidate to critique, merge, cut, or replace — not a decision to implement or polish. The owner is especially clear on two points:

- The spaces **cannot all look the same** and cannot repeat the home galaxy. In EVE Online and No Man's Sky, different spaces mean different scenery — but those are built by design/art teams. Here it is one owner plus coding help, making each space's look likely has to be *generated or systematically varied*, not hand-authored asset by asset. Exploration §7 states this problem and candidate methods; your strongest thinking on how a solo builder actually achieves distinct, cool, real-feeling spaces — including what from EVE / No Man's Sky is genuinely replicable at this scale — is explicitly requested.
- One space should house a **real-deal gigantic space station** (EVE is the touchstone): an approach flight where the station grows and grows — the owner wants it bigger than the home galaxy's current sun — with other ships arriving and departing, beautiful scenery along the way, and *eventually* (not yet) loading into the station's interior. Its second-brain job is **undetermined** — propose and argue, don't assume. See Exploration §1, Candidate H, and questions 20–23.

## Guardrails your review must respect

- **Second brain first:** every space must answer "how does this contribute to remembering, revisiting, connecting, or acting on what matters?"
- **Ethical retention only:** compelling because valuable — meaningful progress, useful reminders, discovery, user-controlled rhythms. No deceptive urgency, no fabricated rewards.
- **The world must never punish the user** — not for a bad week, not for an absence. No decay, no loss, no shame visuals, no streak logic in disguise.
- **Reward honesty:** a hinted reward must exist and be reachable.
- **Phone-realistic:** session length, motion comfort, performance.
- **Plain language** in anything user-facing; no UTC in user-facing design; name-bearing UI uses the brain's own chosen name, never a hardcoded one.

## What to return

Section-by-section design thinking on the exploration — recommendations, reasoning, and the strongest argument against your own recommendation — ending with the decisions you believe the owner must settle first, in priority order, and your answers/proposals for open questions 20–25 (station + scenery + contents). The owner relays your review back to King in the worlds design chat; documents are then revised, not replaced, so decisions accumulate.

## Coordination note

A separate chat runs this app's audit program and repairs; designs here that touch shared systems (galaxy renderer, fuel, quests, streak, notifications, Chronicle) must be reconciled there before any build. Flag any such touchpoints you spot.
