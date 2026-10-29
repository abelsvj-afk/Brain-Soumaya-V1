/**
 * Animation inventory (Phase 4, §14) — the typed registry of A1–A26.
 *
 * Source: `~/workspace/worlds-vision/phase-4-animation-inventory.md`
 * (REVIEWED — verdict READY WITH CHANGES, B1–B3 + S1–S14 + N1–N7 applied,
 * N8 verified). Every entry carries all seven §14.1 fields: trigger ·
 * actors · what moves and how · duration class · reduced-motion equivalent ·
 * cost class · user control (skip, cancel, interruption, repeat-visit
 * behavior). An entry with any field missing does not count as
 * gate-passed — the test next to this module enforces that.
 *
 * Duration classes follow §14.1 (moment <2s / sequence 2–15s /
 * journey >15s), plus the flagged fourth class "ambient (continuous)"
 * for the three entries that run continuously while their scene is
 * visible (A17, A18, A23) — proposed for the owner, not a silent §14.1
 * invention. Cost classes check against §11.2 (cheap ≤5 draw calls, no
 * new geometry · moderate ≤20 draw calls or one new mesh/light ·
 * heavy = a full scene layer, budgeted against the scene's caps).
 *
 * Phase 4 build entries: A6/A7/A8/A23/A24/A25/A26. One landing per
 * approved change: A6/A7/A9 ARE the space-specific form of the A24
 * apply — the generic firming does not also play.
 */

export type AnimationDurationClass = "moment" | "sequence" | "journey" | "ambient";
export type AnimationCostClass = "cheap" | "moderate" | "heavy" | "cheap-moderate";
export type AnimationStatus = "seeded" | "exists" | "phase-4" | "built";

export interface AnimationInventoryEntry {
  id: string;
  /** What starts it. */
  trigger: string;
  /** Ship / the brain / the user / the world. */
  actors: string;
  /** What moves and how, in plain language. */
  moves: string;
  /** moment <2s / sequence 2–15s / journey >15s / ambient (continuous). */
  durationClass: AnimationDurationClass;
  /** The calmer version — a real equivalent, never a removal (§14.2). */
  reducedMotion: string;
  /** cheap / moderate / heavy (or cheap-moderate) against §11.2 budgets. */
  costClass: AnimationCostClass;
  /** Skip, cancel, interruption, and repeat-visit behavior. */
  control: string;
  /** Build status per the inventory's S9 table. */
  status: AnimationStatus;
}

export const ANIMATION_INVENTORY: readonly AnimationInventoryEntry[] = [
  {
    id: "A1",
    trigger:
      "User (or the brain, with the user's yes) starts moving a memory to another space — visit, relocate, or archive journey.",
    actors: "ship, memory, world",
    moves:
      "The memory (its node-object, same canonical identity throughout) lifts from its place, trails the ship at a short tether as visible cargo — a small glowing carry-form, never a generic crate — and the ship flies an unhurried arc toward the gate. The origin keeps a faint “return” marker until the operation completes, so the memory is never shown as gone before it has arrived.",
    durationClass: "sequence",
    reducedMotion:
      "Cross-fade of the memory from origin to gate-side holding position; the route line is drawn statically; no camera movement.",
    costClass: "moderate",
    control:
      "Cancel any time before gate entry — the memory glides back to its origin and the operation visibly didn't happen; repeat visits replay the same arc by default; skip is offered as the direct-travel choice (§9.5) — instant travel that still shows origin → destination context in one still frame.",
    status: "seeded",
  },
  {
    id: "A2",
    trigger: "Ship + carried memory cross the gate threshold (continuation of A1).",
    actors: "ship, memory, world (transit space)",
    moves:
      "Ship and cargo enter the gate together; transit (§2.3) plays as a space the user moves in — the memory stays tethered and visible beside the ship for the whole crossing; on exit both emerge into the destination's light. The memory is never out of frame during the crossing.",
    durationClass: "journey",
    reducedMotion:
      "Static starfield drift + a progress line (origin → destination) with the memory shown docked beside the ship; no camera shake, no streaks.",
    costClass: "moderate",
    control:
      "Turn back mid-transit returns ship + cargo to the origin with state preserved exactly (§15 N3, act ii); skip after the first traversal of the route.",
    status: "seeded",
  },
  {
    id: "A3",
    trigger: "Arrival in the destination space with a carried memory (continuation of A2).",
    actors: "memory, world",
    moves:
      "The memory glides from the gate to its position and settles with a soft glow (echoing the intended tending flash in the home galaxy, not copying it blindly). The settle reads the actual operation (§13 Operations): a visit's placement reads as surfacing (a light halo, “shown here”); a relocation's placement reads as re-homing (the memory takes root — a small ground-ring, “lives here now”); the caption underneath says which one just happened, in plain language.",
    durationClass: "sequence",
    reducedMotion: "Fade-in at the destination position with the same caption; no glide.",
    costClass: "cheap",
    control:
      "Placement commits on arrival: the glide is presentation of an already-committed placement. Interruption mid-glide (backgrounded, connectivity drop) leaves the memory placed at its destination; on return, the settle is replayed from the start or skipped to the final state. Interruption before arrival means the operation never completes (A2 turn-back) — never a half-placed memory. Repeat visits show the memory in place; the placement animation does not replay unless the memory is moved again.",
    status: "seeded",
  },
  {
    id: "A4",
    trigger: "A newly captured memory is sorted in the core app and sent toward its space.",
    actors: "memory, ship (small), world",
    moves:
      "The small, satisfying version of A1–A3 inside the everyday app: the memory lifts from the capture card, the ship (or a light) escorts it toward a small gate glyph, and it departs. Plays alongside the save, never in front of it.",
    durationClass: "moment",
    reducedMotion:
      "The capture card fades and a one-line caption (“Sent to Growing Place”) appears; no motion.",
    costClass: "cheap",
    control:
      "Non-blocking by design — saving never depends on watching it finish; skipping loses nothing; it never replays unasked. Cancel and interruption are not applicable: the send-off plays alongside the save and aborts silently if the app is backgrounded — the memory is already saved. Repeat visits: never replays.",
    status: "seeded",
  },
  {
    id: "A5",
    trigger:
      "(a) User brings a memory back home; (b) user retrieves an archived memory — only ever from a deliberate act inside the Archive (P4).",
    actors: "memory, ship, world",
    moves:
      "The reverse of A1–A3 — the memory lifts, travels with the ship, and settles home. Each return names its §13 operation: end-of-visit (a surfaced memory returns to its primary home), relocate-to-home (the user deliberately re-homes it — its own confirmation, caption says so), or retrieval (Archive-only; restores to the prior primary home unless the user explicitly chooses a different home as part of the retrieval act, P4). The caption under the settle says which one just happened, in plain language.",
    durationClass: "sequence",
    reducedMotion: "Cross-fade between origin and destination with the operation caption.",
    costClass: "moderate",
    control:
      "Cancel before gate entry (returns to origin); retrieval cannot be started from any destination — Archive only, by deliberate act. Retrieval is deliberate, gentle, unhurried; never a “release” spectacle. If a memory is archived while any animation is in progress, P4 wins mid-flight: the carried memory fades from the journey and the operation ends as not-happened, with a plain line saying so. Repeat visits: the return animation plays once per return act.",
    status: "seeded",
  },
  {
    id: "A6",
    trigger:
      "A real milestone completes (a Journey the user marked done, a goal reached) AND the owner approved the landmark proposal (structural = rail-gated, M1). Never triggers on a suggestion alone.",
    actors: "world, landmark, (ship optional as witness)",
    moves:
      "The landmark assembles/rises from its terrace in the garden — foundation ring first, then the form rising and locking in, a warm light coming on at the top. Construction as celebration: visible, unhurried, dignified. The landmark's caption names the milestone and the date (owner's local time). It never rises for a milestone that didn't happen (reward honesty). A6 is the space-specific form of the A24 apply: for this approved change, the rising IS the landing — the generic A24 firming does not also play (one landing per log entry). A6 rises only newly approved landmarks: a landmark already rendering presence-only for a done Journey (D-59) stays as it is and is never re-risen.",
    durationClass: "sequence",
    reducedMotion:
      "The landmark fades in over ~2s with the same caption; no rising motion, no camera move.",
    costClass: "moderate",
    control:
      "Skippable (tap to finish instantly at the final state); never replays unless the user re-opens the landmark's history; undo (A25) lowers it by the compensating path, never a snap-delete. Full length ~8s.",
    status: "phase-4",
  },
  {
    id: "A7",
    trigger:
      "The brain finds a real link between two memories AND the owner approved the path/bridge proposal (structural = rail-gated). The link must be a confirmed (P7 tier i) or user-confirmed suggested (tier ii → confirmed) connection — never an unconfirmed inference rendered as fact.",
    actors: "world, the two memories",
    moves:
      "A path (garden ground) or bridge (across a gap) draws itself between the two memories — a line of light that grows from one end to the other, then settles into the garden's path material. The user can travel it. While the proposal is pending, the path renders only as A23's provisional shimmer, never as a finished bridge. A7 is the space-specific form of the A24 apply: for this approved change, the drawing IS the landing — the generic A24 firming does not also play (one landing per log entry).",
    durationClass: "sequence",
    reducedMotion: "The finished path fades in; the “why” caption is always present.",
    costClass: "cheap",
    control:
      "Skippable; the “why” line is tappable (“Why is this here?” → the evidence in plain language, M6 door one); undo removes it by the compensating path. Full length ~4s.",
    status: "phase-4",
  },
  {
    id: "A8",
    trigger:
      "Ambient presentation change — the garden's warmth signal moves (warm memories accumulate; a sorting session clears the air; a season turns in the owner's local time). Automatic within the recipe (M2 presentation, M3). Inferred emotion (P7 tier iii) may move this and only this (M5).",
    actors: "world (light, fog, sky, particles)",
    moves:
      "Palette and weather crossfade slowly — never a cut, never a jump-scare. Proof change #1 concretely: as warm memories accumulate, the garden's key light warms (cool first-light → warm gold) and the fog takes a warmer tint, over days of accumulated change, not in one jump. A difficult season lends a quieter palette — quieter, never darker-as-punishment (§4.3). The user can ask “why” mid-shift and get the truthful answer, including when the shift rests on an inferred tone (which the explanation says plainly, with a one-tap correction; the rendering follows the correction, the memory is never edited).",
    durationClass: "sequence",
    reducedMotion:
      "Same crossfade (it is already slow); reduced motion removes only the particle drift, never the color information.",
    costClass: "cheap",
    control:
      "Presentation is resettable/disabled without affecting memories (M2 safeguard iii); the “what changed?” digest is on demand, not an approval queue. The visible crossfade is 2–15s; the underlying signal moves over days, and the render lerps continuously and never jumps.",
    status: "phase-4",
  },
  {
    id: "A9",
    trigger:
      "A person's cluster forms/gathers when their memories link up AND the owner approved the cluster proposal (structural; D-9 — only user-confirmed significant people).",
    actors: "world, person cluster",
    moves:
      "Gentle orbital gathering — the person's memories drift into their cluster arrangement, slow and warm. Not an explosion of nodes. A9 is the space-specific form of the A24 apply: for this approved change, the bloom IS the landing — the generic A24 firming does not also play (one landing per log entry).",
    durationClass: "sequence",
    reducedMotion: "Fade into cluster positions.",
    costClass: "moderate",
    control:
      "Skippable; undo disperses by the compensating path. Full length ~6–10s.",
    status: "seeded",
  },
  {
    id: "A10",
    trigger: "User archives a memory (their own deliberate act, P4).",
    actors: "memory, world",
    moves:
      "The memory settles, dims to restfulness (not darkness-as-death), and comes to stillness. Dignity in motion. The dim has a floor: the resting memory stays visible and retrievable, only quieter — it never reads as gone. P4's invariant applies throughout: the memory leaves every other surface at once, including queued/in-progress animations.",
    durationClass: "sequence",
    reducedMotion: "Fade to the resting state.",
    costClass: "cheap",
    control:
      "The archive act itself is the user's choice; skip: the settle can be skipped to the resting state; cancel/interruption: not applicable once the archive act is confirmed — interruption mid-settle leaves the memory archived at rest (the state change commits with the act); repeat visits: the memory rests; the laying-down does not replay. Retrieval is Archive-only (A5). Full length ~3–6s.",
    status: "seeded",
  },
  {
    id: "A11",
    trigger: "Departure with fuel (warp), per D-1.",
    actors: "ship, world (gate, transit, destination)",
    moves:
      "Gate approach → entry → transit movement (§2.3, a space you move in) → exit into the destination's light. The fuel spend is shown before departure and in the sequence.",
    durationClass: "journey",
    reducedMotion:
      "Calm transit — static starfield, progress line, destination light growing; no streaks, no shake.",
    costClass: "moderate",
    control:
      "Cancel before departure (nothing moves, no fuel spent); turn back mid-transit (return to origin, state preserved); skip after first traversal; return home always free. Class by longest leg: short hop 10–20s, long leg 30–60s upper targets per D-11.",
    status: "exists",
  },
  {
    id: "A12",
    trigger: "Departure without fuel (drift), per D-1.",
    actors: "ship, world",
    moves:
      "The same journey, plainly — slower, quieter, minimal spectacle: visible ship, slow starfield, quiet engine ambience, stable camera. Genuinely usable, never miserable, never shaming.",
    durationClass: "journey",
    reducedMotion: "Identical to the warp reduced-motion variant (drift is already calm).",
    costClass: "cheap",
    control:
      "Cancel before departure (nothing moves, no fuel spent); turn back mid-transit (return to origin, state preserved); skip after the first traversal of the route; return home always free. Slower than warp by design, bounded at ≤2× the warp leg for the same route.",
    status: "exists",
  },
  {
    id: "A13",
    trigger: "Travel to the Great Station (home port, D-5).",
    actors: "ship, station, traffic (atmosphere)",
    moves:
      "The long growth of the megastructure — the station grows continuously on approach, traffic lanes flowing, arrival arc. The signature sequence. Interior docking is not in this phase (§9.2) and the approach promises only approach + destination.",
    durationClass: "journey",
    reducedMotion:
      "The station grows via staged cross-fades at fixed waypoints; traffic shown as static lanes; no camera drift.",
    costClass: "heavy",
    control:
      "Skippable after first traversal; turn back returns to origin. Full approach ~20–40s.",
    status: "seeded",
  },
  {
    id: "A14",
    trigger: "Travel in the Scale Space toward the sun / a landmark.",
    actors: "ship, sun/landmark",
    moves:
      "The sun/landmark keeps growing (dual-layer, §10.2); the endless-approach variant for the never-arrive design — PROVISIONAL pending Q10 (still open per §14.3); if built before Q10 settles, it is labeled as an experiment, and the experience says honestly that arrival is not the point — endless approach as meditation, never an implied destination that doesn't exist.",
    durationClass: "journey",
    reducedMotion: "Staged cross-fades; growth shown as discrete, captioned steps.",
    costClass: "moderate",
    control:
      "Turn back any time; skip after the first traversal; cancel before departure moves nothing; the never-arrive variant is exited by turning back or returning home, both always free. Repeat visits offer direct travel. Approach leg 30–60s upper target per D-11; the endless-approach variant is unbounded by design.",
    status: "seeded",
  },
  {
    id: "A15",
    trigger: "First arrival in a new space.",
    actors: "ship, world",
    moves:
      "A distinctive-per-space introduction flight — the space introduces itself (its landmark, its light, its name in the brain's own words). Skippable, never repeated unless requested.",
    durationClass: "sequence",
    reducedMotion: "A still + one-line introduction; same information, no flight.",
    costClass: "moderate",
    control:
      "Skip; cancel: leaving the space ends the flight with no state change; interruption: the flight aborts cleanly and the user arrives (first arrival always lands the user in the space); never auto-replays; repeat visits offer direct travel. ≤15s, skippable.",
    status: "seeded",
  },
  {
    id: "A16",
    trigger: "A new gate/destination is discovered through use or the Station's discovery function (D-10).",
    actors: "gate, world",
    moves:
      "The gate pre-exists; discovery reveals it, it doesn't materialize it — light gathers at the gate's place, the structure resolves from shimmer to solid (presentation of a reveal, not creation of a gate). Discovery governs travel/presentation only; every memory stays directly reachable in the core app regardless.",
    durationClass: "sequence",
    reducedMotion: "Fade-in + the naming line.",
    costClass: "cheap-moderate",
    control:
      "Skip: the reveal can be skipped to the solid gate; cancel/interruption: not applicable — the reveal is presentation only and aborting it leaves the gate usable; repeat visits: the gate stands revealed; the reveal does not replay. Discovery is informational; the gate is usable from reveal; nothing is locked behind it. ~3–6s.",
    status: "seeded",
  },
  {
    id: "A17",
    trigger: "Ambient, whenever the Station scene is visible.",
    actors: "other ships (atmosphere only)",
    moves:
      "Ambient ships on approach/departure lanes — scale cueing and life. Atmosphere, not fact: these ships imply no other real users and represent no brain activity; if they ever map to something real, that mapping gets its own explicit rule first (§14.2, §9.7 Q22). A17 covers non-NPC ambient traffic only. NPC ships (PR #117 autonomy) are distinct agents with their own motion grammar and are visually distinct from ambient traffic; their motions are not inventoried here.",
    durationClass: "ambient",
    reducedMotion: "Ships hold position or drift very slowly; lanes shown statically.",
    costClass: "moderate",
    control:
      "Traffic is atmosphere; it cannot be interacted with and never blocks anything.",
    status: "seeded",
  },
  {
    id: "A18",
    trigger: "Idle / tending / escorting / route-following states.",
    actors: "ship",
    moves:
      "The ship reads as alive and purposeful, never frantic — idle drift, the tending flash (intended, owner-confirmed 2026-10-21, catalogued as-is), escorting (A1), route-following (A19). Motion is small, calm, and purposeful. The flash is a moment; idle drift is ambient (continuous) while the galaxy is visible.",
    durationClass: "ambient",
    reducedMotion:
      "The flash becomes a brief glow; idle drift becomes stillness; escorting uses A1's reduced-motion form.",
    costClass: "cheap",
    control:
      "The tending flash is an intended signal, not an interruption; nothing here demands a response.",
    status: "exists",
  },
  {
    id: "A19",
    trigger: "User selects a destination before departure.",
    actors: "ship, route line, world",
    moves:
      "Selecting a destination draws the route in space (EVE-style route projection) — the user sees the journey before taking it, with the plain summary (from → destination · warp cost · time class · drift is free). Cancelling undraws it cleanly.",
    durationClass: "moment",
    reducedMotion: "The route appears as a static line + the same summary text.",
    costClass: "cheap",
    control: "Cancel freely before departure; the undraw is clean, no residue.",
    status: "exists",
  },
  {
    id: "A20",
    trigger: "Focus shifts, planet/memory selection (touch).",
    actors: "focused object, camera (small)",
    moves:
      "Small motions that make touch feel answered — a gentle highlight ring, a soft scale pulse on the selected memory, the camera easing to frame it. On a phone these must feel instant and stable — feedback that confirms the touch, never a delay added to routine navigation.",
    durationClass: "moment",
    reducedMotion: "Instant highlight, no camera ease, no pulse.",
    costClass: "cheap",
    control: "None needed — feedback, not an interruption; never blocks input.",
    status: "exists",
  },
  {
    id: "A21",
    trigger: "A guided route starts/continues.",
    actors: "ship, world",
    moves:
      "The ship follows the kindling Chronicle thread down the Deep Past helix, stop by stop. Each stop arrival is a gentle settle: the ship eases to a hold beside the stop's memory and the stop's line is shown before narration continues.",
    durationClass: "journey",
    reducedMotion: "Stratified cross-fades between stops, same narration and outcomes.",
    costClass: "moderate",
    control:
      "Pause indefinitely at any stop; skip: skip to the next stop, or skip the whole route to its end (arrival in the space, no state change); leave the route without losing place or changing any memory's state; narration stops cleanly and resumes at the current stop. Repeat visits: the route can be reflown on request, resuming from the last stop unless the user restarts it. Per-stop sequences of ~4–8s within the route.",
    status: "seeded",
  },
  {
    id: "A22",
    trigger: "An explainable resurfacing cause (D-7).",
    actors: "memory, world",
    moves:
      "A deep memory lifts from its alcove to a rim-side resting place when its context returns.",
    durationClass: "sequence",
    reducedMotion: "Fade-rise between positions.",
    costClass: "cheap-moderate",
    control:
      "The cause is shown (“risen because…”); the rise is a derived presentation change only — never a canonical, home, stratum, or identity change; never a duplication; return to depth follows the same explainable rule, never a neglect timer. Interruption: not applicable — the rise is a derived presentation change; aborting it leaves the memory at its alcove with no state changed. Skip: the rise can be skipped to the resting place. ~4–8s.",
    status: "seeded",
  },
  {
    id: "A23",
    trigger:
      "A structural proposal is pending (landmark, path, cluster, anchor) and the user is looking at the affected space.",
    actors: "world (proposed object), user",
    moves:
      "The proposed change renders in its provisional form — a ghost/dashed/soft-shimmer version of the landmark, path, or cluster, visibly a suggestion and never an accomplished fact. It gently pulses (slow, calm) to read as “waiting”, never urgent. A small tag reads “Proposed — tap to review”. It never renders as finished, monumental, or permanent.",
    durationClass: "ambient",
    reducedMotion: "A static dashed outline + the same tag; no pulse.",
    costClass: "cheap",
    control:
      "Tapping opens the review (approve / edit / reject / defer); ignoring it changes nothing — proposals wait quietly (D-15); rejecting removes the preview with a plain fade; defer keeps it pending. Previews render only for proposals already in the batched calm-review queue (D-15); no per-proposal pop-in or interruption — a new proposal never interrupts what the user is doing to announce itself. Continuous while the proposal is pending — entering the space shows it already in place, no entrance animation.",
    status: "phase-4",
  },
  {
    id: "A24",
    trigger: "Owner approves a structural proposal; the change applies atomically with its log entry (M1 beat 4).",
    actors: "world, the changed object",
    moves:
      "The provisional preview (A23) firms into the real thing over ~2s — shimmer resolves into solid material, the “Proposed” tag becomes a one-line “Added because…” caption that fades after a few seconds. Except where the change has its own space-specific landing (A6 rising, A7 drawing, A9 bloom): then that animation IS the landing and this generic firming does not also play (one landing per log entry). One visible landing for one log entry: the change lands whole or not at all — a failed apply shows no partial object, writes no false “applied” log entry, and the proposal still stands (M1 failure rule). The log entry carries the owner's local time and appears in the browsable World Changes view over the same log (M6 door two; door one is the on-demand “Why is this here?”).",
    durationClass: "moment",
    reducedMotion: "Instant firming with the caption; no transition.",
    costClass: "cheap",
    control:
      "Nothing to skip — the approval was the decision; the settle is the receipt. Undo is A25. Repeat visits: the settle plays once, at apply time.",
    status: "phase-4",
  },
  {
    id: "A25",
    trigger: "Owner undoes an applied change (M1 beat 5, D-16).",
    actors: "world, the changed object",
    moves:
      "The change reverses by a compensating path — a landmark lowers and disperses the way it rose (not a snap-delete), a path un-draws from one end, a cluster disperses gently. If later changes depend on the undone change, no silent overwrite: the animation pauses and a plain-language conflict is shown for the owner to resolve (D-16). The log keeps both entries; the world never pretends the change never happened.",
    durationClass: "sequence",
    reducedMotion: "Fade-out of the undone object + the conflict line if any.",
    costClass: "cheap-moderate",
    control:
      "Undo is itself the user's act; conflicts are resolved by the owner, never silently. Undo has no time-based expiry — no change class becomes permanent with time (D-16). The compensating log entry carries the owner's local time. ~4–8s typical for a single-object compensation.",
    status: "phase-4",
  },
  {
    id: "A26",
    trigger:
      "The user tends a plot in the Growing Place — adds a line, links a memory, marks something still true/changed, or visits (per GAME-LOOP-FOUR-VERBS-2026-10-26.md; built on branch verb1-tend-plot).",
    actors: "ship, plot",
    moves:
      "The ship flies a short arc to the plot, a brief tending gesture — a light touch and the intended tending flash — and the plot's marker updates (a new line drawn, a link shown, or the “still true” mark refreshed). The update is a real brain action, never decoration.",
    durationClass: "moment",
    reducedMotion: "Glow + caption, no flight.",
    costClass: "cheap",
    control:
      "User-initiated; cancellable by leaving the plot — nothing is half-tended (the action applies atomically or not at all); tending the same plot again is a new tend, not a replay.",
    status: "built",
  },
];

/** The Phase 4 build entries (A6/A7/A8/A23/A24/A25/A26). */
export const PHASE_4_ANIMATION_IDS = ["A6", "A7", "A8", "A23", "A24", "A25", "A26"] as const;

export function animationById(id: string): AnimationInventoryEntry | undefined {
  return ANIMATION_INVENTORY.find((e) => e.id === id);
}

export function phase4Animations(): AnimationInventoryEntry[] {
  return PHASE_4_ANIMATION_IDS.map((id) => animationById(id)!).filter(Boolean);
}
