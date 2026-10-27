# Soumaya's Fleets on Automated Missions — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What this note is:** the design for fleet missions — the owner's direction (2026-10-23): *"I want Soumaya's fleets. I want her to be able to dispatch them to different worlds on automated missions, of course bounded, with end-game costs."* The concept note is `docs/worlds/fleets-concept.md`. This note goes beyond the fleet-defense concept: defense is one mission; this is the mission system.
**Settled ground it obeys:** D-55 (bounded, end-game costs); the §16 ship-agent fence; the §17 rail; the never-punish invariant; the honest-reward vocabulary (no fabricated urgency, no pay-to-win against one's own brain); D-1 (fuel buys speed, never access; home always free).

---

## §1 What a mission is

- **A mission is a journey flown by an NPC ship.** The travel ledger (P2-2) already models depart → transit → arrive with server authority, fuel charges, and idempotency. A fleet mission is the same shape with a different pilot: Soumaya dispatches a fleet ship, it goes, it works, it returns — without the owner piloting each one.
- **Fleets are dispatched agents, not NPCs** — but they run the same loop and the same fence as NPCs (see `docs/worlds/npc-autonomy-design-note.md`), with missions as their allow-list.

## §2 Mission kinds (first set)

- **Charting:** fly a route and chart it — future warps along a charted route are faster (the honest reward: a route you have flown is a route you know).
- **Scouting:** visit a world and report — "the Growing Place has grown," "the Deep Past has a new stratum lantern lit." A report is a plain-words observation of a true fact, never a fabrication, never urgency.
- **Keeping:** carry scenery or keepsakes to a world — a small, true thing placed where it belongs (a lantern for a terrace, a bead for a route). Placing is structural and goes through the §17 rail.
- **Defense:** the fleet-defense mission (see `docs/worlds/fleet-defense-design-note.md`) — one mission kind among others, same bounds.

## §3 Bounds — what "bounded" means, concretely

- **Allow-listed missions only.** A fleet ship can travel, tend, gather, and report — propose→decide for anything structural (§17), never self-applying changes to the brain. It never writes to a brain, never reaches outside its mission's worlds, never acts on a visitor who isn't present.
- **Budgets:** each mission has a fuel budget and a time budget, owner-set. A mission that would exceed its budget waits or returns — it never overspends.
- **Visibility:** every mission is visible in the log — where the ship went, what it did, what it brought back — in plain language. A fleet the owner cannot see is not a fleet in this app.

## §4 Costs — the end-game sink (DECIDED)

- **Dispatch costs fuel, priced distance × duration × fleet size** — at rates only a mature economy sustains. Dispatch becomes the thing a rich brain DOES, the way warp is what a young brain saves for. The exact rates are set at build recon against the live fuel economy (cap 200, regen 3.5/hr, warp 10) and recorded in the build record.
- **Failure costs time and the dispatch price — never cargo, never progress.** A mission can fail (a route uncharted, a report ungathered) and the cost is the fuel already spent and the time waited. Nothing the brain holds is ever at stake. Never-punish covers missions too.
- **Mission duration — DECIDED:** real-time voyages (hours), not session-scale minutes. A fleet goes away and comes back later; its return is a quiet arrival, never an interruption, never a notification that demands attention. The owner checks in when he wants to.

## §5 Rewards — the honest vocabulary only

- **Charted routes** (faster future warps), **scenery/keepsakes** for worlds, **scouting reports** (true observations in plain words), and **end-game cosmetics** (a berth dressing, a fleet livery — spectacle, never access).
- **Never:** fabricated urgency ("your fleet needs you NOW"), pay-to-win against one's own brain, XP, levels, ranks, or anything that turns the brain into a game board.

## §6 Who decides — propose-for-yes at MVP (DECIDED)

- **Soumaya proposes missions for a yes** — her existing proposal rule (§16 `propose_noticing`): batched into a calm review moment, approve / edit / reject / defer, silence never approval. At MVP she does not dispatch autonomously.
- **Autonomous dispatch inside owner-set bounds** follows later, as its own design, only with real usage evidence. The bounds are his to set when he wants them.

## §7 Acceptance (what "done" looks like when this builds)

- **C1** A dispatched mission follows the travel ledger shape — depart → transit → arrive, server authority, idempotent.
- **C2** Costs are fuel only, priced as §4, recorded in the build record; failure costs time + dispatch price only.
- **C3** Every mission is visible in the log in plain language; every reward is from the honest vocabulary.
- **C4** No mission ever writes to a brain or self-applies a structural change (§17 rail holds).
- **C5** Full gate before any merge ask; merge is the owner's separate tap (repo lane).

## §8 Open questions (design, not blockers)

- **Q1** Fleet size and ship variety — one ship system with the hangar, or two? (Proposal: one — the hangar's fleet IS the mission fleet; a ship you unlocked is a ship you can dispatch.)
- **Q2** Are fleet ships visible in worlds while on missions — crossing the Station's traffic from decoration into residents? (Proposal: yes — a ship on a mission is a resident of the world it is in, named in the log, visible in traffic.)
- **Q3** End-game cosmetics — what is the first one? (Proposal: fleet livery — your fleet's colors, chosen by you, spectacle only.)
