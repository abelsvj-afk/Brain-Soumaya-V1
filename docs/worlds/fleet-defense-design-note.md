# Fleet Defense — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What this note is:** the concept note (`docs/worlds/fleet-defense-concept.md`, owner's direction 2026-10-25) carried into a design. The concept's open questions are settled here as a designer (correctable with a word).
**Settled ground it obeys:** the never-punish invariant; brain authoritative, worlds disposable — a purge fleet **never deletes brain data**; D-55 fleets (bounded, end-game costs); the §16 ship-agent fence; tab thresholds feed the mutating world and Alignment and can summon events (buffs note §6); no threshold is ever consecutive-day or streak-based (Review 30 H-02); no UTC in anything user-facing.

---

## §1 The loop in one paragraph

Something in your brain crosses a threshold (see §2) → a fleet arrives from another world, coming to purge the negative thing → Soumaya and her fleet defend your galaxy in a Space Invaders-style defense → she plays it autonomously, or you take the helm and play it yourself → the negative charge is cleared and what matters is kept.

## §2 Triggers — tab thresholds (concept Q1, DECIDED)

- Every tab in the app (memories, goals, emotions and mental state, finances, and the rest) carries **thresholds** — plain, visible conditions the owner defines. The real thresholds are his to set; the design's examples (cumulative, never streak-based): a goal with three sessions logged; a memory carried with negative weight for a month; a debt falling below a mark; a skill practiced to a milestone.
- **Which thresholds can summon a fleet — DECIDED:** only thresholds the owner marks as fleet-summoning, and only thresholds about **a negative charge the user already chose to release** (an emotion they want let go of, a memory they archived, a debt they are paying down). A threshold about something the user wants to keep never summons a purge fleet.
- **Event rules (buffs note §6):** a threshold crossing fires once per crossing, not repeatedly while the condition stays true; editing a record cannot re-fire an event for the same crossing; a world event never rewrites the brain facts that triggered it.
- Thresholds are never hidden judgments and never gate access. They open opportunities; they never close doors.

## §3 The invaders — what a "purge" is allowed to mean

- **Hard line, stated plainly:** a purge fleet **never deletes brain data**. "Purge" in the game means clearing **a charge the user already chose to release**. The fleet takes only what was offered. Anything the user wants to keep is defended, never purged.
- **Purge-target consent (concept Q2, DECIDED):** the user marks something "offered for release" in the brain itself — an explicit, plain-word release action on the record (archive with release, let go of an emotion, mark a debt as being worked down). The defense never invents a target; it only ever defends the release the user already made. No release, no fleet.
- The design tension, named rather than hidden: purging a memory would be loss, and loss is forbidden. The game is about **defending what matters while letting go of what was already released** — not about destroying anything.

## §4 The defense — Soumaya and her fleet

- **Space-defender play:** invader ships fly around your galaxy / second-brain space; Soumaya's fleet meets them. Space Invaders at its simplest — incoming ships, defensive fire, positions that matter — inside the real galaxy view, not a separate game screen.
- **Two modes, same game:** (a) **Autonomous** — Soumaya plays it herself, on her own, as the agent she is. You watch your defender work. (b) **Take the helm** — you jump in and control the defense yourself.
- **Autonomy handoff (concept Q4, DECIDED):** switching is free and instant, either direction, mid-defense. Taking the helm pauses nothing — Soumaya hands you the controls the moment you reach for them and takes them back the moment you let go. Neither mode is "the real one."
- **Winning:** the negative charge is cleared and what matters is kept. **Losing (concept Q3, DECIDED):** nothing is lost. The fleet disperses, the charge stays, and the defense can be tried again later. Losing is a quiet "not yet," never a penalty. The loss shape is "the fleet disperses, try again later" — there is no better one; a loss that cost something would break the invariant.
- **Eternity's role (concept Q8, DECIDED):** he watches; he does not intervene in the defense. Defending yourself is okay with Eternity (owner's words).
- **Fleet sizes and difficulty (concept Q5, DECIDED):** small and calm at first — a handful of invaders (3–5), one wave, no scaling with anything the user hasn't chosen. Difficulty scales only with the size of the release (a bigger release draws a bigger fleet, in plain words before the defense starts). Never with a bad week, never with a score.

## §5 Costs and rewards (concept Q6, DECIDED)

- **Defending your own brain is free** (home defense). **Taking a fleet out to another world costs fuel** (the concept's proposal, adopted — the fleet is a journey, and journeys cost warp).
- **Winning earns:** the release itself (the charge cleared — that is the reward), plus a codex entry recording the defense in plain words ("on this day, the fleet dispersed and the charge was let go"). No fuel, no bonus, no currency. The defense is not a farm.
- **Relic interplay:** relics may steady or align a defense (e.g. Hearth Ember steadies it, Star Hanger aligns it) — the buffs note settles which, when it builds. No relic is required to defend.

## §6 Assets — real ships, no stand-ins

- **Defenders: Kenney craft. Invaders: Quaternius fighters. (Concept Q7, DECIDED — the concept's proposal, adopted.)** The two sets are visually distinct by kit — you can tell a defender from an invader at a glance, by hull, never by color alone.
- **Standing rule:** real assets, measured, licensed, slimmed, render-checked. A streak of light that is "supposed to represent" a ship is a placeholder, never the shipped thing.

## §7 Relation to existing systems

- **D-55 fleets:** the defense fleet is one dispatched mission; the same bounds apply (see `docs/worlds/fleet-missions-design-note.md`).
- **§16 ship-agent queue:** Soumaya acts as a fenced world-actions-only sub-agent; the defense runs inside that fence (allow-listed world actions, budgeted, propose→decide for anything structural).
- **The mutating world:** fleet events are one of the things that make it grow (Phase 4).

## §8 Acceptance (what "done" looks like when this builds)

- **C1** A defense can only ever start from a user-marked release; no release, no fleet — tested with a threshold that has no release attached.
- **C2** Losing costs nothing — tested: after a lost defense, every brain fact is unchanged and the charge is still releasable.
- **C3** Autonomous and helm modes switch freely mid-defense; neither is privileged.
- **C4** Invaders and defenders are distinct by hull; all ships are real GLBs.
- **C5** Budgets §11.2 hold during a defense; reduced-motion equivalent carries the same information (defense becomes a calm turn-based presentation, same outcome).
- **C6** Full gate before any merge ask; merge is the owner's separate tap (repo lane).
