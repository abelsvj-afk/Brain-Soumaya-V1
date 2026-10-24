# ChatGPT Review 28 (FORMAL) — P2-5 Warp Gates & Transit Space

**Status:** FORMAL — verdict READY WITH CHANGES. Reconciled into the note (D-66).
**Relayed:** 2026-10-24 ~17:57 EDT (owner-relayed; reviewer worked ~1m).
**Scope:** P2-5 design note + review relay + Design Exploration 1, all read from
`design/worlds-vision` (the earlier 404 was a branch-selection issue, confirmed
by the reviewer).
**Verdict:** READY WITH CHANGES. Design recommendation only — authorizes no
implementation, merge, deployment, or additional world.

## 1. Blocking findings

- **B-1 — Gate topology.** "Every world's gate is reachable from the Station"
  is ambiguous (direct connection vs reachable through the network). Required:
  Station = guaranteed fallback route; D-10 direct-gate discovery preserved;
  C1 applies only to worlds authorized and actually reachable in the current
  release; future worlds receive gates when their own increments are approved.
  Test: enumerate authorized destinations + permitted routes; verify every
  permitted departure/arrival, the Station fallback, and unavailable/
  undiscovered route behavior. Never require unapproved worlds to exist.
- **B-2 — Combined transit performance.** HYG's single-draw-call point field
  does not prove the combined scene (ship GLB + HYG + streaks + lighting +
  audio) fits the phone budget. Required: a combined-load budget and a
  complete device measurement protocol — ship, starfield, streaks, gate
  transition, audio lifecycle measured together, on the owner's phone, for
  warp, drift, and reduced motion, cold-load + sustained. Miss → optimize or
  design return; thresholds never lowered after testing.
- **B-3 — Acceptance criteria must prove behavior, not just rendering.** C2
  must verify continuous movement; C3's "first-time viewer" is subjective;
  C5 must define what stays identical; C6 must test recovery from
  interrupted/reversed travel. Required: measurable behavioral assertions
  (see the note's revised C1–C6).

## 2. Required design changes

- **R-1 — Ship provenance.** A credit line alone does not establish the
  license. Verify source asset, license terms, attribution, modifications,
  and the shipped GLB's identity; confirm the credit in `public/CREDITS.md`
  before enabling the new surface. Keep the shared loader, tint, and
  procedural fallback. Define graceful load failure: no broken scene, no
  missing-ship gap, no misleading success — fallback within budget.
- **R-2 — Arrival wording.** Close Q3 at the design level: common contract
  is gate exit → world-specific arrival sequence → existing canonical scene.
  Length/composition vary by world. Station 3-stage + garden lowest terrace
  stay. No duplicate destination scenes.
- **R-3 — Reflection rule.** Only genuine, canonically sourced memory or
  Chronicle content; provenance preserved; visibility/archive choices
  honored; optional, dismissible, non-repeating within a journey. No
  archived/sensitive exposure merely because the user warped. Warp only. No
  fake memories, no implied brain activity, no new surfacing engine in P2-5.
- **R-4 — Camera comfort + transition continuity.** Stable framing, bounded
  movement, no forced rapid rotation, non-streaking reduced-motion mode.
  Entering/leaving transit preserves travel state: no duplicate arrival,
  destination never lost. Modes differ in presentation, not in access,
  completion, or state correctness.

## 3. Non-blocking recommendations

- Shared gate structure; dressing changes materials/palette/atmosphere, not
  the interaction contract.
- Drift restrained: slow starfield, visible ship, gentle engine ambience,
  stable framing. No debris, collectibles, or interaction requirements.
- First trip special without being a trap: unskippable first traversal
  (D-11), rule clear before departure, never delays access to the brain or
  essential controls.
- Future-world compatibility declarative: each world supplies destination
  identity, gate dressing, arrival sequence, accessibility/performance
  constraints; the shared system needs no new implementation per world.
- Design acceptance ≠ implementation readiness; P2-5 must not absorb other
  world increments or bypass release gates.

## 4. Recommended settlements for Q1–Q5 (reviewer's, not the owner's)

| Q | Recommendation |
|---|---|
| Q1 Gate form | Shared gate, dressed per world |
| Q2 Transit content | HYG stars + motion only for MVP |
| Q3 Arrival depth | Common arrival contract, world-specific execution |
| Q4 Ship camera | Chase view by default (stable framing + reduced-motion mandatory) |
| Q5 Drift minimum | Visible ship, slow starfield, quiet engine ambience, stable camera |

## 5. Scope audit

Consistent with D-1, D-10, D-11, D-12, D-23, D-48. Clarification: the shared
system for the future roster is a compatibility commitment, not permission
to make those worlds reachable now. The §5 build sketch (`gateScene.ts`,
`transitScene.ts`, WorldsSurface transition) is plausible but unvalidated;
the combined-scene performance gate + travel-behavior tests must pass
before release.
