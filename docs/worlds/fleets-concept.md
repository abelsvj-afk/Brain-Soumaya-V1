# Soumaya's Fleets — Owner Concept Note (brainstorm stage, 2026-10-23)

Status: **owner-directed concept, brainstorm stage.** No design gate, no build authorization. Recorded from the owner's words: *"I want Soumaya's fleets. I want her to be able to dispatch them to different worlds on automated missions, of course bounded, with end-game costs."*

## The concept

- **The brain has fleets** — plural ships under Soumaya's command (the home galaxy already shows a fleet in its art; the owner's ship is the one he flies himself).
- **Dispatch:** Soumaya can send fleet ships to different worlds on **automated missions** — they go, they work, they return, without the owner piloting each one.
- **Bounded:** missions run inside strict limits (the §16 ship-agent pattern is the natural fence: world-actions only, allow-listed, never a brain-write).
- **End-game costs:** dispatching is priced as an end-game sink — expensive in the mature economy, so a grown brain has something meaningful to spend its abundance on (the fuel economy's late-game problem: income with nowhere to go).

## Design seeds (builder's)

- **Missions are journeys.** The travel ledger (P2-2) already models depart → transit → arrive with server authority, fuel charges, and idempotency. A fleet mission is the same shape flown by an NPC ship: the ledger pattern reuses, the pilot differs.
- **The ship-agent queue (§16) is the pilot.** A dispatched fleet ship is the fenced world-actions agent made visible: it can travel, tend, gather, and report — propose→decide for anything structural (§17), never self-applying changes to the brain.
- **What missions could return:** the honest reward vocabulary only (ethical-retention rule) — charted routes (faster future warps), scenery/keepsakes for worlds, scouting reports ("the Growing Place has grown"), and end-game cosmetics. Never fabricated urgency, never pay-to-win against one's own brain.
- **Costs as end-game sink:** distance × duration × fleet size, priced in fuel at rates that only a mature economy sustains — dispatch becomes the thing a rich brain DOES, the way the warp is what a young brain saves for.

## Open questions

- Fleet size and ship variety (ties to the owner's "people can select different ships" future feature — one ship system or two?).
- Are fleet ships visible in worlds while on missions (crossing the Station's traffic from decoration into residents)?
- Mission duration: real-time voyages (hours/days) vs session-scale (minutes)?
- Can a mission fail — and if so, what does failure cost (never-punish says: time and the dispatch price, never cargo or progress)?
- Does Soumaya propose missions for a yes (her existing proposal rule), or dispatch autonomously inside bounds the owner sets?
