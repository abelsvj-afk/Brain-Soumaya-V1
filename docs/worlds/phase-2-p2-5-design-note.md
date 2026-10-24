# P2-5 Design Note — Real Warp Gates & the Transit Space (built once, for all worlds)

**Status:** DRAFT — owner-directed 2026-10-24 ("lets do that" + "we gotta add all the worlds").
**Lane:** design note → review loop → owner settlement → build authorization → build → full gate → owner's merge tap.
**Predecessors:** P2-1…P2-4 (travel skeleton), P3-1 (Growing Place, merged `aaaeb1a`).
**Launch:** PR #107 (flag flip) is open; this increment ships under the same flag.

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
  Station anchors the gates. Every world's gate is reachable from the
  Station, and the Station route is always the fallback (D-10).

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
  offered (never forced) moment of reflection is allowed — a resurfaced
  memory or a Chronicle line, dismissible, per §2.3 — and only on warp, never
  on drift (the drift is the quiet mode).
- **Durations:** unchanged from the settled targets (D-11) — 10–20 s short /
  30–60 s long as upper targets, never compulsory waits; skippable after the
  first traversal; first trip to a new world feels special and is not
  skippable.
- **Controls in transit:** turn back (exists in the state machine) and skip
  (after first traversal) both stay available. Cancel window unchanged
  (P2-2). Reduced motion: a calm transit — the ship holds steady, the stars
  do not streak, the trip still completes in the same time. Reduced motion is
  never a held or lesser trip.

### §2.3 Arrival areas

- **Every world gets an arrival area:** the place you come out of the gate
  into the world — a short approach into the existing scene, not a hard cut.
  Station: the existing 3-stage approach (far → handoff → arrival) is the
  arrival area. Garden: arrival on the lowest terrace (the present), from
  which you climb (D-61). Future worlds define their arrival area in their
  own P3 note, against this same pattern.
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
- **Provenance check (audit item):** the ship GLB's license/credit line must
  be confirmed in `public/CREDITS.md` before it appears on a new surface —
  it already ships in the app, but a new surface is the moment to verify the
  credit rather than assume it.

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

## §3. Open questions (for the owner + reviewers)

- **Q1 — Gate form:** one shared gate design dressed per world (recommended),
  or a distinct gate per world? A shared gate is cheaper and more legible;
  distinct gates are more wondrous per world but multiply the budget.
- **Q2 — Transit content:** stars only, or should the corridor carry more —
  debris fields of loose notes, distant signals, the brain's own activity
  made visible (§2.3's candidates)? More content is more wonder and more
  risk of implying meaning that is not there.
- **Q3 — Arrival depth:** gate + short approach (recommended), or a real
  arrival area per world with its own content? The Station already has the
  approach; the garden's is the lowest terrace.
- **Q4 — Ship camera:** chase view (recommended — you see her fly), cockpit,
  or side view? Chase keeps the ship visible and the motion readable.
- **Q5 — How plain is the drift?** The drift must be dignified. What is the
  minimum transit that still feels like a journey rather than a wait?

## §4. Acceptance criteria

- **C1 — Gates are real thresholds.** Every reachable world has a gate at
  both ends; passing through it is what starts transit. Test: depart from
  each world, arrive at each world; no world is reachable without its gate.
- **C2 — The transit space is a space.** Warp and drift each render a
  fly-through area with the ship visible; the scene is not a spinner, a
  fade, or a static image. Test: transit renders on the owner's phone
  (flag on) for warp and for drift.
- **C3 — Warp and drift are honestly different.** Warp is fast/rich, drift
  is slow/plain, both arrive, both are dignified. Test: side-by-side
  sessions; a first-time viewer can tell which is which without being told,
  and neither feels like a punishment.
- **C4 — Budgets hold.** §11 criteria apply to the transit session too
  (≥50 fps avg, ≥30 fps 1%-low, no stall >100 ms, ≤200 draw calls, ≤750k
  visible tris). Static assertions in tests; measured half on the owner's
  phone at launch check. A measured miss → optimize or design return, never
  silent relaxation.
- **C5 — Reduced motion is a full trip.** Calm transit under
  `prefers-reduced-motion`: ship steady, no streaks, same duration, same
  arrival. Test: reduced-motion session completes identically.
- **C6 — Dark + reversible, full gate.** Ships under the flag; flag-off
  renders nothing and makes no travel calls. Full suites (server + web) +
  typecheck + production build, zero failures.

## §5. Build sketch (for the builder, at build recon)

- New `graph/gateScene.ts` (shared gate: ring + light grammar, per-world
  dressing via palette params) + `graph/transitScene.ts` (transit area:
  HYG sky, streaks, ship via shared loader + engine audio) + tests.
- `WorldsSurface` gains a transit state: while a journey is active, render
  the transit scene for its kind (warp/drift) instead of the destination
  scene; on arrival, swap to the destination scene (existing registry).
- TravelPanel keeps its countdown/skip/turn-back controls; they now sit over
  a real journey instead of a wait.
- No server change. No economy change. No new routes.
