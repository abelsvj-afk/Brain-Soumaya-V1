# Guided Tours (N7) — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What this note is:** the design for tour mode — §16's `guided_tour` design-queue input, carried into a buildable design. Transit today is warp/drift with no narration; a tour adds the narration.
**Settled ground it obeys:** §17 M2 (rewriting a saved tour/chapter sequence is structural, not presentation); the never-punish invariant; D-1 (fuel buys speed, never access); no UTC in anything user-facing; name-bearing UI uses the brain's own chosen name.

---

## §1 What a tour is

- **A tour is a saved route with a voice.** A Chronicle route (a done Journey's linked memories, in chronological order — Journeys ARE saved Chronicle routes, D-7) with narration laid over it in plain language: what each stop is, why it matters, what connects it to the next. The route is the tour's spine; the narration is the tour's voice.
- **A tour is a visit, not a lesson.** It shows you your own life back, in order, at a walking pace. It never grades, never summarizes you, never tells you what anything means — it says what happened, in your own words from the brain, and lets the meaning stay yours.

## §2 Who guides — the ship proposes, you decide

- **Soumaya proposes tours; you decide.** The ship may propose a tour ("these three memories all mention the move — should they form a tour?") through the §16 proposal path — batched into a calm review moment, never an interruption, never from silence. You approve, edit, reject, or defer. Silence is not approval.
- **Tours are never forced, never auto-played, never auto-started on arrival.** A tour starts when you ask for it, and only then. A tour never pulls you out of a world, never interrupts a journey, never nags.
- **The guide's voice is plain words.** Narration is the brain's own words for the memories, in plain language, read aloud or shown quietly — the traveler's choice. No invented color, no editorializing, no "here is what this means."

## §3 The tour in the world

- **A tour is flown, not clicked through.** The ship carries you stop by stop along the route — the same travel the route already is (depart → transit → arrive per leg, fuel as usual, cancel window as usual). The narration arrives with each stop.
- **Stops are the route's own stops:** the Chronicle thread's beads in the Deep Past, the clusters in People, the plots in the Growing Place — wherever the route's memories live. The tour goes where the memories are; it never re-stages them somewhere else.
- **Leaving a tour is free, instant, and unpunished.** Step off at any stop, drift home free, come back later — the tour waits, unchanged, no "incomplete" state, no progress lost (there is no progress to lose — a tour is not a task).

## §4 Saved tours are structural (§17 M2)

- **Creating, editing, or deleting a saved tour goes through the rail** (Phase 4): propose → decide → apply as one append-only log entry, undo as a compensating entry. Rewriting a saved tour sequence is structural — it is never a silent presentation change.
- **A tour playing is presentation:** the order of stops during playback, the narration's pacing, the camera's framing — all presentation within the established recipe, reversible and controllable, never rewriting the saved tour or the memories.

## §5 Acceptance (what "done" looks like when this builds)

- **C1** A tour plays a real Chronicle route, stop by stop, with narration in the brain's own plain words — nothing invented, nothing editorialized.
- **C2** No tour ever starts unasked; proposal follows the §16 calm-review path; silence is never approval.
- **C3** Leaving a tour mid-way costs nothing and leaves no "incomplete" state.
- **C4** Saved-tour changes go through the §17 rail; playback changes nothing saved.
- **C5** Reduced-motion equivalent carries the same information (still frames + text narration, same stops, same order).
- **C6** Full gate before any merge ask; merge is the owner's separate tap (repo lane).

## §6 Open questions (design, not blockers)

- **Q1** Read-aloud voice — the tour narration read aloud (ElevenLabs-style, word-by-word highlighting is the Re:NeWrld pattern) or text-first with audio optional? (Proposal: text-first; audio follows when the read-aloud work lands.)
- **Q2** Can a tour cross worlds (a route whose stops live in two worlds), or is a tour one world at a time? (Proposal: cross-world — the route already is what it is; the ship flies it.)
- **Q3** Who can propose a tour — the ship only, or can Eternity propose one? (Proposal: the ship only. Eternity does not propose tours.)
