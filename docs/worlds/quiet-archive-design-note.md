# Phase 3 · Quiet/Archive World — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What Quiet/Archive is:** the resting place. The last world in the roster order (Growing Place → Deep Past → People → Scale → Quiet/Archive, D-23). PRIVATE (PRIVATE = Deep Past, Growing Place, People, Quiet/Archive).
**Settled ground it obeys:** the P4 archive invariant (archiving removes a person/material from *every* surface — home, People, tours, resurfacing — including derived clusters and in-flight animations; the archive state wins, mid-flight); the never-punish invariant; D-1 (fuel buys speed, never access; home always free); no UTC in anything user-facing; name-bearing UI uses the brain's own chosen name.

---

## §1 The purpose — rest, not loss

- **Quiet/Archive is where archived things rest.** Archiving removes a person from People entirely, and removes material from every surface — but nothing is deleted. The archived material lives here, where it can be visited **deliberately**.
- **The governing sentence:** rest is not the same as erasure (Stillness Seal's lore — the relic that belongs to this world). Nothing here reads as loss, ending, or failure. A visit here is quiet by design: low light, still air, nothing asking anything of you.
- **Deliberate visits only.** Nothing in the app ever pulls you here — no notification, no nudge, no "while you were away," no auto-pull on a bad week. You come because you chose to come. The world never comes to get you.

## §2 What it shows — and what it never shows

- **Shows:** archived people (their clusters, stilled — the whole story held together, old lights and new lights), archived memories (their own quiet lights), dates that matter as quiet records. Everything is shown as it was, honestly, with nothing added and nothing taken away.
- **Never shows:** a score, a judgment, a comparison, a "last visited" counter, a "you have N archived items" count presented as a burden, a suggestion to restore or delete, or anything the brain does not hold. No dimming for absence, no thinning, no "while you were away" state.
- **Restoring:** if the owner restores an archived person or memory in the brain, it leaves Quiet/Archive quietly on the next visit and returns to its home surface. The world does not announce it, celebrate it, or ask why. Restoration is a brain act, never a world act.

## §3 The scene (product code)

- New modules beside the other worlds': a layout module (deterministic placement under the recipe seed; budget constants **≤60 draw calls / ≤300k triangles planned**, test-asserted like `stationLayout`) and a scene module (still field, dim cool light, archived clusters at rest, baked glow only, no post-processing, per the settled stack).
- **Arrival vista:** you arrive at the edge of a still field — low, even light, archived clusters resting like quiet lamps, far apart, nothing moving fast. The field is walked among, slowly.
- **Camera:** arrival at the field's edge, slow drift only. Reduced motion: the field *held* — no drift at all; information identical.
- **Gate silhouette (adopted amendment):** Quiet/Archive's gate is a **low still threshold** — a quiet doorway of dim light, low and wide, that you pass through without ceremony. No fanfare, no kindling, no reveal animation. The gate does not announce itself.
- **Ships:** the traveler's own ship in transit as usual. No NPCs here — no harbor controller, no keeper, no guide. A resting place keeps its own counsel. No NPC people, ever.
- **Relics of this world:** Stillness Seal (+Fuel regen, rest restores) and Unopened Fold (+Discovery, preservation complete without revealing) live in the Archive's relic set — one copy per brain, found here.

## §4 Travel

- Server allow-list gains `"quiet-archive"`; the client chart gains the matching entry (name "Quiet/Archive" or the brain's own plain name for it; blurb in plain language). Same economy: warp 10, drift free, bonuses exactly as P2-4 settled — no economy change.
- The Station stays the guaranteed fallback route; direct world-to-world gates are discoverable through use (D-10).

## §5 Acceptance (what "done" looks like when this builds)

- **C1** Archived people/material render exactly as archived — whole story held, nothing presented as loss.
- **C2** Archive invariant holds: archiving removes the person/material from every other surface, including mid-flight; restoring returns it quietly.
- **C3** No pull exists: no notification, nudge, badge, or auto-route ever sends the traveler here.
- **C4** Budgets §11.2 hold; reduced-motion equivalent carries the same information.
- **C5** Full gate before any merge ask; merge is the owner's separate tap (repo lane).
- **C6** Failure honesty: a failed load renders the error/retry state, never an empty field.

## §6 Open questions (design, not blockers)

- **Q1** The world's display name — "Quiet/Archive" is the roster name; does it carry a quieter proper name in-world, or stay plain?
- **Q2** Does an archived person's cluster show its dates and open threads, or only its memories? (Proposal: memories only — threads belong to the living relationship, and rest here is rest.)
- **Q3** Is there a limit to what rests here, or does the field grow without bound as the brain archives? (Proposal: it grows; the field's spacing rule keeps it readable at any size.)
