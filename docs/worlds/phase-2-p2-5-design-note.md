# P2-5 Design Note — Real Warp Gates & the Transit Space (built once, for all worlds)

**Status:** DRAFT — owner-directed 2026-10-24 ("lets do that" + "we gotta add all the worlds").
**Lane:** design note → review loop → owner settlement → build authorization → build → full gate → owner's merge tap.
**Predecessors:** P2-1…P2-4 (travel skeleton), P3-1 (Growing Place, merged `aaaeb1a`).
**Launch:** PR #107 (flag flip) is open; this increment ships under the same flag.
**Review:** ChatGPT review 28 FORMAL, 2026-10-24 (record `chatgpt-review-28.md`): verdict READY WITH CHANGES — reconciled below (D-66). Preliminary record: `chatgpt-review-28-preliminary.md`.

## §1. What exists today — and what is missing

Today a trip is a panel and a countdown. The travel state machine is real
(depart / cancel / turn-back / arrive, server-authoritative, P2-2…P2-4) and the
destination scenes are real (Station, P2-3; Growing Place, P3-1). But between
them there is nothing: no gate you pass through, no space you travel in, no
ship. The warp is 12 seconds of waiting; the drift is 45.

That contradicts the founding vision (2026-10-22): EVE-style jump gates
whose **transit is itself a space**, and the design doc §2: "transit is a
space you move in, not a cutscene or a plain loading screen" and "gate as
threshold moment — passing through triggers transit."

Meanwhile the ship already exists and never appears in transit:
`soumaya-ship.glb` (her ship, loaded by `graph/soumaya.ts`, in-app tinted
blue-steel with a cyan sheen because the shipped GLB is bare gray;
`organic-spaceship.glb` fallback variant; `E45-fleet.glb` for the fleet;
engine start/loop audio wired). The gap is not a model. The gap is that the
journey has no place.

## §2. The proposal

Build the connective tissue **once**, as a shared system, so every world —
the three reachable today and the rest of the roster as they land — plugs
into it the same way.

### §2.1 Warp gates

- **One gate per world edge.** Every reachable world gets a gate where you
  leave it and a gate where you arrive: home, Great Station, Growing Place
  now; Deep Past, People, Scale, Quiet/Archive as their P3 increments land.
- **A gate is a threshold, not a menu.** Passing through triggers transit
  (settled §2 principle). No menus mid-flight unless the user asks for one.
- **Form:** one shared gate design, dressed per world — the same ring-and-light
  grammar everywhere (amber = working/inhabited, cyan = navigation truth
  only, per the Station recipe), so a gate is recognizable at a glance in any
  world and cheap to build once. Per-world dressing (Station steel, garden
  dawn-gold) is surface, never structure.
- **The Station is the gateway hub.** The §1 open question ("gateway hub
  where all jump gates anchor") is settled here by recommendation: the Great
  Station anchors the gates. **Topology contract (review 28, B-1):** the
  Station is the *guaranteed fallback route* — every authorized world remains
  reachable through the Station network; direct world-to-world gates may be
  discovered through use (D-10) but are never required. A gate exists only
  for a world that is authorized and actually reachable in the current
  release; future worlds receive gates when their own increments are
  approved, never in advance.

### §2.2 The transit space ("warp areas")

- **The in-between is a real space.** Warp and drift each get a transit
  area you fly through for the transit duration — not a loading screen, not
  a fade. The ship is visible in it, flying (chase view by default; see Q4).
- **Warp vs drift, by the owner's own rule (D-1):** warp is the fast, full,
  rich transit; drift is slower, quieter, plainer — "less entertaining"
  means plain and slow, never miserable or shaming. The drift stays
  dignified, comfortable, and reduced-motion friendly. Fuel buys
  speed/spectacle, never access: both always arrive.
- **Content:** the HYG sky (already real data, P2-3 F-02) plus motion —
  streaking stars on warp, slow starfield on drift. No fabricated content:
  nothing in the transit space pretends to be a memory it is not. One
  offered (never forced) moment of reflection is allowed on warp only —
  never on drift (the drift is the quiet mode) — under this rule
  (review 28, R-3): only genuine, canonically sourced memory or Chronicle
  content, provenance preserved, the user's existing visibility and archive
  choices honored; optional, dismissible, and non-repeating within the same
  journey. No archived or sensitive material surfaces merely because the
  user warped. No fake memories, no implied brain activity, and no new
  surfacing engine is built as part of P2-5.
- **Durations:** unchanged from the settled targets (D-11) — 10–20 s short /
  30–60 s long as upper targets, never compulsory waits; skippable after the
  first traversal; first trip to a new world feels special and is not
  skippable.
- **Controls in transit:** turn back (exists in the state machine) and skip
  (after first traversal) both stay available. Cancel window unchanged
  (P2-2). Reduced motion: a calm transit — the ship holds steady, the stars
  do not streak, the trip still completes in the same time. Reduced motion is
  never a held or lesser trip.
- **Camera comfort (review 28, R-4):** chase view by default (see Q4) with
  stable framing, bounded camera movement, and no forced rapid rotation.
  Entering and leaving transit preserves travel state: no duplicate arrival,
  the destination is never lost. Normal and reduced-motion modes differ in
  presentation only — never in access, completion, or travel-state
  correctness.
- **First trip is special, never a trap (review 28):** the first traversal
  to a new world cannot be skipped (D-11), and the rule is made clear before
  departure. It never delays access to the brain or essential controls.
- **Transit is not a second world (review 28):** no progression systems, no
  debris, no collectibles, no interaction requirements in the corridor. The
  drift stays restrained by design: slow starfield, visible ship, gentle
  engine ambience, stable framing.

### §2.3 Arrival areas

- **Every world gets an arrival area:** the place you come out of the gate
  into the world — a short approach into the existing scene, not a hard cut.
  **Common contract (review 28, R-2 — Q3 closed at the design level):**
  gate exit → world-specific arrival sequence → existing canonical scene.
  Length and composition vary by world; there is never a duplicate
  destination scene. Station: the existing 3-stage approach (far → handoff
  → arrival) is the arrival area. Garden: arrival on the lowest terrace
  (the present), from which you climb (D-61). Future worlds define their
  arrival sequence in their own P3 note, against this same contract.
- **Arrival is honest:** the gate deposits you at the world; the world scene
  is the same scene you would reach by any route. No separate "arrival
  version" of a world.

### §2.4 The ship in transit

- **Her ship, the one that exists.** `soumaya-ship.glb` via the shared GLB
  loader, the same in-app tint the home galaxy already applies, the same
  procedural hull visible while loading — never a missing ship, never a gray
  box. Engine audio (start on departure, loop in transit) is already wired
  and comes along.
- **The ship is the vehicle, never the cargo.** It carries the user between
  worlds; it never carries memories, never edits the brain, never appears
  inside a world scene (worlds are visited on foot, in their own grammar).
- **Provenance (review 28, R-1):** a credit line alone does not establish
  the license. Before the ship appears on this new surface, verify the
  actual source asset, its license terms, attribution requirements, any
  modifications made, and the shipped GLB's identity — and confirm the
  required credit is in `public/CREDITS.md`. Keep the shared loader, tint,
  and procedural fallback. If model loading fails: no broken scene, no
  missing-ship gap, no misleading success state — the procedural hull
  carries the trip, within the performance budget.

### §2.5 What does NOT change

- **Economy:** warp 10, drift free, bonuses as settled (P2-4). No new costs,
  no new rewards. The richer warp transit is what the 10 fuel already buys.
- **State machine:** depart / cancel / turn-back / arrive are untouched.
  This increment is presentation on top of settled behavior.
- **Worlds order (D-23):** Growing Place → Deep Past → People → Scale →
  Quiet/Archive, one at a time, each with its own design note and the owner's
  word. This increment does not authorize any of them — it builds the road
  they will all travel on.
- **Man-God:** stays in the other chat (2026-10-24). Its gates, if any, are
  that chat's decision.
- **Shared system ≠ reachable roster (review 28, §5).** This note builds a
  system every future world can plug into. That is a compatibility
  commitment, not permission to make those worlds reachable now.

## §3. Open questions (for the owner + reviewers)

Review 28's recommended settlements are recorded under each question. They
are recommendations, not settlements — the owner settles them.

- **Q1 — Gate form:** one shared gate design dressed per world (recommended),
  or a distinct gate per world? A shared gate is cheaper and more legible;
  distinct gates are more wondrous per world but multiply the budget.
  *Review 28 recommends: shared gate, dressed per world — consistent
  interaction grammar; world identity comes from the environment.*
- **Q2 — Transit content:** stars only, or should the corridor carry more —
  debris fields of loose notes, distant signals, the brain's own activity
  made visible (§2.3's candidates)? More content is more wonder and more
  risk of implying meaning that is not there.
  *Review 28 recommends: HYG stars and motion only for MVP — warp streaks
  supply spectacle, drift supplies calm; extra content adds provenance and
  performance risk without being necessary.*
- **Q3 — Arrival depth:** gate + short approach (recommended), or a real
  arrival area per world with its own content? The Station already has the
  approach; the garden's is the lowest terrace.
  *Review 28 recommends: common arrival contract, world-specific execution
  (R-2) — and Q3 is closed at the design level by §2.3's contract.*
- **Q4 — Ship camera:** chase view (recommended — you see her fly), cockpit,
  or side view? Chase keeps the ship visible and the motion readable.
  *Review 28 recommends: chase view by default, with stable framing and
  reduced-motion support mandatory (R-4).*
- **Q5 — How plain is the drift?** The drift must be dignified. What is the
  minimum transit that still feels like a journey rather than a wait?
  *Review 28 recommends: visible ship, slow starfield, quiet engine
  ambience, stable camera — a journey, not a loading screen, without
  becoming a punishment for choosing free travel.*

## §4. Acceptance criteria (revised per review 28, B-2/B-3)

- **C1 — Gates are real thresholds, for authorized routes only.** Every
  authorized, reachable world has a gate at both ends; passing through it is
  what starts transit. Test: enumerate the currently authorized destinations
  and their permitted routes; verify every permitted departure and arrival,
  the Station fallback, and that an unavailable or undiscovered route stays
  unavailable. Unapproved worlds are never required to exist.
- **C2 — The transit space is a space, with visible progress.** Warp and
  drift each render a fly-through area with the ship visible, the scene
  changing continuously, and a clear departure transition and arrival
  transition. Test: transit renders on the owner's phone (flag on) for warp
  and for drift, and a recording shows the ship progressing through a
  changing scene — not a spinner, a fade, or a static image.
- **C3 — Warp and drift are honestly different, both dignified.** Warp is
  fast/rich, drift is slow/plain, both arrive at the same destination.
  Test: a small, predefined blinded comparison — viewers who are not told
  which is which can distinguish warp from drift, while both sessions are
  rated comfortable. No arbitrary aesthetic threshold; the protocol is
  written before the test runs.
- **C4 — The combined scene fits the phone budget.** §11 criteria apply to
  the transit session as a whole (≥50 fps avg, ≥30 fps 1%-low, no stall
  >100 ms, ≤200 draw calls, ≤750k visible tris), measured with the ship,
  starfield, streaks, gate transition, and audio lifecycle running
  together — not as isolated components (review 28, B-2). Static assertions
  in tests; measured half on the owner's phone at the launch check (device
  and runtime versions, scene configuration, draw calls, visible tris,
  frame-time distribution, longest stall, memory behavior, for warp, drift,
  and reduced motion; cold-load + sustained-session checks). A measured miss
  → optimize or design return, never silent relaxation; thresholds are never
  lowered after testing.
- **C5 — Reduced motion is a full trip.** Calm transit under
  `prefers-reduced-motion`: streaking and unnecessary camera movement off,
  ship steady, same destination, same travel-state correctness, same
  controls, same completion behavior. Test: a reduced-motion session
  completes with destination, state, controls, and completion identical to
  the normal mode — the modes differ in presentation only.
- **C6 — Dark + reversible, recovery honest, full gate.** Ships under the
  flag; flag-off produces no transit rendering and no travel calls.
  Cancellation, turn-back, skip eligibility, and repeated journeys preserve
  the existing server-authoritative travel rules. Full suites (server + web)
  + typecheck + production build, zero failures. These behavior tests
  supplement, never replace, the existing suites.

## §5. Build sketch (for the builder, at build recon)

*Review 28: this sketch is plausible but unvalidated — `gateScene.ts`,
`transitScene.ts`, and the WorldsSurface transition are architectural
suggestions, not implementation decisions. The combined-scene performance
gate (C4) and travel-behavior tests (C1–C3, C5–C6) must pass before
release.*

- New `graph/gateScene.ts` (shared gate: ring + light grammar, per-world
  dressing via palette params) + `graph/transitScene.ts` (transit area:
  HYG sky, streaks, ship via shared loader + engine audio) + tests.
- `WorldsSurface` gains a transit state: while a journey is active, render
  the transit scene for its kind (warp/drift) instead of the destination
  scene; on arrival, swap to the destination scene (existing registry).
- TravelPanel keeps its countdown/skip/turn-back controls; they now sit over
  a real journey instead of a wait.
- No server change. No economy change. No new routes.
