# Phase 1 Builder Brief — The Mockup Trio (throwaway proof-scenes)

**Authority:** owner authorization, 2026-10-22, recorded as **D-27** in `design-exploration-1.md` (§11 decisions log). **Read this brief and the governing documents (§1 below) before writing any code.**
**Scope — exactly this, nothing more:** build three **throwaway** mockup scenes, in order, each graded against the fixed §11 criteria. This authorization does **not** extend to product implementation, merging, deployment, or any later phase. Mockups are disposable proof-scenes on labeled fixture data; they are not the product, not a foundation for the product, and nothing in them merges anywhere.

---

## 1. Read first (governing documents, in this order)

1. `docs/worlds/design-exploration-1.md` — esp. **§11** (decisions + acceptance criteria §11.2–11.3), **§14** (Animation Gate), **§18** (mockup spec + session script V2), **§19–§20** (roadmap + recipe register), decisions **D-3, D-19, D-20, D-21, D-26, D-27**.
2. The recipe for the mockup you are building: `recipe-great-station.md` / `recipe-growing-place.md` / `recipe-deep-past.md` (all ✅ settled).
3. The repository's own governing documents and **current project state** (architecture docs, PROJECT_STATE, standing rules — incl. **no UTC in anything user-facing; the viewer's local timezone governs every label**) — the mockups inherit the project's rules even as throwaway scenes.
4. §10's verified research (technique + asset licensing) — assets only from the verified pool (procedural / NASA public-domain with insignia scrubbed / CC0 / HYG CC BY-SA data file shipped separately with attribution); anything unshippable must be listed in the result record.

## 2. Execution order & the gate between mockups (D-19/D-27)

1. **Mockup 1 — The Great Station: the approach.** Proceed to Mockup 2 **only if it passes** §11's gates.
2. **Mockup 2 — The Growing Place: the rising.** Proceed to Mockup 3 **only if it passes**.
3. **Mockup 3 — The Deep Past: the descent (Chronicle guided)**, exercising the full **A1–A3** chain and **A21/A22**.

**Any failure stops the sequence.** Diagnose the failure class — *technique stack / recipe / animation load / implementation* — record it, and report before anything else proceeds. **Thresholds are never lowered to force a pass** (§11 criteria are fixed and were set before any results existed).

## 3. What each mockup must contain

Follow each recipe's §8 (in/out) exactly. Summaries:
- **Station:** three-stage approach (far silhouette in the backdrop layer → dual-layer handoff → near arrival arc), station traffic at budget (A17), warp in (A11) + drift repeat, route plotting (A19); **plus the D-13 evidence capture** (§4 of this brief). No memories surface (cargo in transit only, A1–A3 script step).
- **Growing Place:** arrival vista, one A7 connection forming, one **A6 landmark rising** for a *staged* milestone (declared staged in the record), A1–A3 evidence placement.
- **Deep Past:** rim reveal, Chronicle guided descent with narration-bearing stops (fixtures), **full A1–A3** placement at the route's end, one **A22 resurfacing rise**, A21 descent fields as ratified in §14.

All three run the **§18 V2 session script** (shared core): cold load/legibility → idle 30 s → warp + signature sequence → one A1–A3 placement → return navigation + canonical identity/home verification → cancelled-departure check → mid-transit turn-back check → zero-fuel free return (test harness only) → 5-min free flight → drift repeat → **reduced-motion run of the same script**.

## 4. The D-13 evidence (Station mockup only)

Capture **sun and Station in one frame at matched approach stages** (far / handoff / near), with a short relative-appearance note (how the sun reads next to the structure at each stage). The sun stays at its **current, unchanged size** — the mockup photographs the question; it does not answer it. The evidence goes in the Station result record; the sun decision remains the owner's separate later call.

## 5. Measurement & the result record (one per mockup, non-negotiable)

Each mockup produces a record file in `docs/worlds/` — `mockup-result-station.md`, `mockup-result-growing-place.md`, `mockup-result-deep-past.md` — pushed to branch `design/worlds-vision` for review. A mockup without a complete record is **not done**, whatever the scene looks like. Each record contains:

- **Test environment (exact):** phone model, OS version, browser/runtime + version, build configuration, measurement method/tool, session script version.
- **Performance results vs §11.2:** fps average, 1%-low over the 5-minute session (incl. warp + signature sequence), longest stall, draw calls, visible triangles, texture sizes, backdrop size, cold-load time, 15-minute soak outcome. *Unrecorded numbers don't count.*
- **Visual outcomes vs §11.3:** distinctness material for the owner's blind review (V1), landmark silhouette evidence (V2), artifact check on the signature sequence (V3), **seed traceability** — every visible parameter traced to the recipe's seed table; a hand-tweaked value fails V4 and must be listed (V4), content-honesty notes incl. any unshippable elements (V5). V6 (owner pass/fail per mockup) is recorded after the owner's review — leave the field ready.
- **Behavioral results (recorded separately, §18 V2):** session-script step outcomes — identity/home verification, cancel/turn-back behavior, zero-fuel return, reduced-motion run behavior. Behavioral results never substitute for the visual/performance gates.
- **Animation accounting (§14):** which inventory entries ran, the combined-load case exercised, fallback behavior observed.
- **Verdict field:** PASS / FAIL against §11, with the failure class if FAIL (stack / recipe / animation load / implementation) and the diagnosis.

## 6. Fixtures, disposability & hard boundaries

- **Fixture data only**, labeled as fixtures wherever a user could see it; no real memories, no real accounts, no production data paths.
- Mockup code lives **outside** the product build; it must not alter product behavior, schemas, or state. If a mockup seems to *need* a product change, that is a stop-and-report event, not an improvisation.
- **No merging, no deployment, no arming of anything** (TTS/push stay as they are). No purchases. No new services.
- Time labels, if any appear, use the viewer's local timezone — **never UTC**.
- The brain's chosen display name is used where a name is needed — never a hardcoded product name in captions.

## 7. The review standard (owner-set, 2026-10-22 — read before you claim anything)

**A builder's claimed PASS is not an independently supported PASS.** The record is reviewed criterion by criterion against §11: each criterion is checked against the *actual evidence in the record* — reproducible build details, full performance measurements, visual evidence, seed traceability, reduced-motion results, behavioral results kept separate. **Missing or contradictory proof leaves that criterion unresolved** — unresolved is not a pass, and a mockup does not advance the sequence on unresolved criteria. The builder supplies evidence; **the owner retains the V6 pass/fail decision and design-gate closure.** Write the record expecting this review: claims without evidence will be returned, not rounded up.

## 8. Reporting

After each mockup: push its result record, update this brief's status table (§9), and report to the owner in the worlds chat (or the channel the owner directs): verdict, headline numbers, failure class if any, and the evidence locations. **Do not start the next mockup until the previous one's PASS is recorded *and supported under §7's review*** — and the owner may still pause the sequence at any point; a recorded PASS is a gate condition, not an obligation to continue.

## 9. Status

| Mockup | State | Record |
|---|---|---|
| 1 — Great Station (approach + D-13 evidence) | 🟡 Scene built; **reviews 10–13 applied** (both-pass counters + session-peak tracking, harness at §11 lengths + cold-load, behavioral checks as verified assertions under an enforced armed-departure policy, fuel floored at 0, elapsed-time animation, V4 table documented) — **no known code-level items remain; §11 measurement pending owner's device run** — verdict UNRESOLVED, no PASS claimed | `mockup-result-station.md` · `chatgpt-review-10–13-2026-10-22.md` |
| 2 — Growing Place (the rising) | ⬜ Blocked on Mockup 1 PASS | — |
| 3 — Deep Past (the descent; A1–A3, A21/A22) | ⬜ Blocked on Mockup 2 PASS | — |

*Brief ends. The design gate remains OPEN throughout Phase 1; it closes only when the results are reviewed and the owner explicitly closes it (D-27).*
