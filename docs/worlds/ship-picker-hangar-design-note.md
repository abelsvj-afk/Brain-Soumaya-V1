# Ship Picker / Hangar — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What this is:** the hangar — where you unlock new ships and change out your ship. Recorded as a later feature since 2026-10-25 ("users choosing/changing ships, different ships for different uses"); the Eternity mockup v3.4 now has the real ship GLBs, so the hangar is what is still pending.
**Settled ground it obeys:** the free-ship shortlist (26 verified ships, ~131k tris — 11 Quaternius hulls, 8 Kenney, 5 NASA probes, 1 WATO; licenses verified from the files); the 10 held-back ships are EXCLUDED permanently unless in-file licenses appear (Rev 123 decisions §4); her ship is identity-bearing (`soumaya-ship.glb`, CC-BY-NC — keep with attribution, replace with the CC-BY-4.0 fallback before any commercial use); no procedural stand-ins as final art; fuel buys speed/spectacle, never access.

---

## §1 The hangar — where it lives

- **The hangar is a bay of the Great Station.** You fly up to the Station and enter the hangar — it is the one interior space that exists before the Station interior proper (which stays a later phase; see `docs/worlds/station-interior-design-note.md`). The hangar is a working bay: ships berthed in a row, warm work light, your current ship lit and ready.
- **The hangar is a destination, not a menu.** You travel there (Station route, normal travel rules — warp 10, drift free, home always free). Changing ships happens in the world, beside the ships, not in a settings screen.
- **Gate silhouette (adopted amendment):** the hangar's gate is the Station's own gate — industrial and lit — with a berth marker: a lit docking cradle that reads as "ships live here."

## §2 The ships — what you can fly

- **The fleet (26 verified):** 11 Quaternius hulls, 8 Kenney Space Kit craft, 5 NASA probes, 1 WATO. Every hull is a real free sci-fi asset, measured, licensed, slimmed, render-checked. The 4 Kenney speeders (verified P2-6 staging assets) are in the fleet.
- **Your ship, by default, is hers:** `soumaya-ship.glb` is the default ship — her ship is the ship you fly. Changing ships changes YOUR ship; her ship stays berthed as the hero of the bay.
- **Different ships for different uses (later):** the design allows a ship per use (a hauler for cargo runs, a racer for fast transits) — the first build ships one active ship at a time; per-use assignment follows when a use exists that needs it.

## §3 Unlocking — earned, never bought

- **Ships are unlocked by discovery and travel, never bought.** You unlock a hull by finding it (berths hold ships you have met in the worlds — a hull you flew beside in traffic, a probe you visited in Scale) or by traveling (milestones of journeys flown, in plain words). Fuel buys speed, never access — no ship is ever locked behind a fuel price, a purchase, or a countdown.
- **Unlocks are plain and honest:** the hangar shows each hull with how it was unlocked (or what would unlock it, in plain words — "fly beside this hull in Station traffic" — never a locked-door taunt, never a count of what you are missing).
- **No ship is ever taken away.** An unlocked ship stays unlocked. Absence changes nothing.

## §4 Changing ships

- **Change out your ship in the hangar:** walk the bay (or glide it), pick a berthed hull, and it becomes the ship you fly — in transit, in arrival, in every world. The change is instant, free, and reversible; switching back costs nothing.
- **Your ship's identity travels with you:** the ship you fly is the ship other travelers and NPCs see. Its nose direction is measured per hull (Kenney + Quaternius −Z, soumaya-ship +Z — P2-6 recon); the loader orients every hull forward, never mirrored, never faked.
- **Ship choice is per traveler, stored server-side** (part of the traveler's state, not the brain — a ship is yours, not a memory). It survives across devices and sessions.

## §5 Acceptance (what "done" looks like when this builds)

- **C1** The hangar renders as a Station bay with the verified fleet berthed; every hull is a real GLB, none procedural.
- **C2** Unlock rules are server-enforced and plain-spoken; no ship is buyable, no unlock is a countdown or a streak.
- **C3** Changing ships works in-world, persists server-side, and shows the right hull in transit and in every world.
- **C4** Budgets §11.2 hold with the berthed fleet in frame; reduced-motion equivalent carries the same information.
- **C5** Full gate before any merge ask; merge is the owner's separate tap (repo lane).

## §6 Open questions (design, not blockers)

- **Q1** Unlock by meeting vs by journeys — is "fly beside it once" the right unlock for traffic hulls, or should some hulls ask for more?
- **Q2** Do NASA probes fly as player ships, or are they Scale dressing only? (Proposal: dressing only — a probe is a real mission, not a hull you wear.)
- **Q3** Per-use ships — which use earns a second active ship first: cargo, speed, or defense?
