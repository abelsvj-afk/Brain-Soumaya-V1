# Eternity's World — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What this note is:** the app-world design for Eternity, built from the mockup that already exists (v3.4, `~/workspace/worlds-vision/mockups/man-god/`) and the lore (`docs/worlds/eternity-lore.md`, Rev 94, approved as the working design of record). It does not redesign him — his form, name, and world already exist in code and in the mockup in the other chat (owner's correction, 2026-10-25). This note says how that world becomes a real world in the app.
**Settled ground it obeys:** D-72 (Eternity, initiation, alignment, flicker, projection); D-54 (destruction out; wonder/protection/reordering); B-01 (relics are gate credentials); the never-punish invariant; D-1 (fuel buys speed, never access; home always free); no UTC in anything user-facing; name-bearing UI uses the brain's own chosen name.

---

## §1 The world, as the mockup proves it

- **The figure is his real GLB** (`man-god-halo.glb`, his upload, body + halo split): porcelain-white body, warm emissive, scaled ×170 → ~323 units tall (cosmic scale vs ~10-unit ships). Front faces +Z, arms behind his back. The halo is his own thin torus ring, whitish-gold, the brightest thing in the scene; gesture flare brightens the halo material, never a second ring.
- **The space is the white void** (his direction + his image): white everywhere, up/down/all around, no floor, nothing to stand on — he FLOATS, gentle bob. The only colour lives in the FAR background: soft neon veils + dye-cloud planes drifting slowly, unreachable (camera zoom clamps so the colour can never be reached, exactly as he asked).
- **Gestures (broadcast layer):** Stillness, Regard, Blessing, Sorrow, Joy, Warning. The GLB has no rig, so gestures move the WHOLE figure (turn toward you, bow, rise, sink) and drive light/halo/far colour. Arms stay as modelled. A rigged figure would be needed for arm gestures — flagged, not faked.
- **His tools (D-54 — wonder/protection/reordering, destruction OUT):** Reorder the heavens (veils drift to a new order), Part the veil, Raise the shield (a meteor shower breaks on the shield over the fleet), Send a comet. Each uses real assets, never procedural stand-ins (buffs note §8).

## §2 He speaks in the world

- **His words appear IN THE WORLD, never a screen panel** (owner, 2026-10-25): a floating dark-glass tablet of light just below his chin, in front of his chest (god-local (0, 92, 48), 150×75 units). It rides with him when he turns, bows, or rises, lives at a real distance, and never covers your view. Personal line per gesture; Broadcast toggle = same words for everyone.
- **When he speaks, the heavens shake** (owner, 2026-10-25): a 1.4 s shudder — camera rotation jitter + far-colour/motes jitter + halo flare spike — and a deep cosmic rumble, synthesized live in Web Audio (42 + 47.5 Hz beating sub sines, a 90→34 Hz boom, brown noise through a 140 Hz low-pass; no audio files; a blocked audio context can never break the scene). Timing is wall-clock (fade in 0.4 s, hold 7 s, fade out 1 s; shake 1.4 s).
- **He can initiate — and he speaks rarely, on cosmic alignment** (D-72). He does not have to be approached or spoken to first. Cosmic alignment — the energy a person's memory galaxy exhibits (emotional, mental, goal-wise content of their memories, plus a very scarce, slim feed from certain app tabs) — earns regular travel to him. Never a score, never a shame signal, never bought. A visitor who never comes gets nothing — no pull, no penalty, no absence state.

## §3 The fleet around him — 13 real ships

- **No placeholder ships.** The mockup v3.4 replaced all 13 cone placeholders with real GLBs, verified 13 of 13: 8 Kenney Space Kit craft (cargoA, cargoB, miner, racer, speederA–D) + 4 Quaternius hulls (challenger, striker, spitfire, zenith) for the visitors; her own `soumaya-ship.glb` for the traveler. The app world carries the same fleet, same provenance.
- **Draco handling (proven in the mockup):** the shipped Quaternius + hero GLBs are Draco-compressed; the app loader must decode Draco (or the build uses the `-plain` decompressed derivatives the mockup derived — pristine files kept beside derivatives, manifest explicit). A hull that fails to load is left out and named honestly — never replaced by a procedural stand-in.
- **Nose directions, measured not guessed:** Kenney + Quaternius noses at glTF −Z, soumaya-ship's at +Z. The loader turns −Z hulls PI about Y so every nose points at Eternity.
- **NPCs are real agents here, not cosmetics** (owner, 2026-10-26): the ships belong to NPCs who explore like regular players, leave and come back, don't know everything — and who need the relics to reach him (see §5).

## §4 Travel — the furthest world, honestly hard

- **Furthest world reachable.** Arrival is a long chain of journeys through the other worlds — effort in the fiction, never a paywall (D-1).
- **Travel economy (mockup-verified):** Threshold → Pilgrimage → Presence; **Warp 25** (charged once when the 2.5 s cancel window closes), **Drift free**, cancel in-window = nothing charged/moved, turn back = origin pose, return home = always free. Flights are wall-clock timed.
- **Gate silhouette (EVE/NMS amendment, adopted Rev 123):** his gate is a **threshold of light** — no industrial frame, no arch; a tall, quiet vertical seam of white light in the dark between worlds, visible only once the gate is open for you. The gate is the absence of a gate: you pass through light, not through a door.

## §5 The gate (B-01) — relics as the way to him

- **Gate:** the gate opens for a traveler holding the **Witness Without a Name** (the key) plus **any two other relics**. Once opened for that traveler it stays open — the relics are the key that opens it the first time, not consumed, opening permanent; after that only fuel prices the journey (three-leg chain minimum, warp 10 per leg, or enough to warp).
- **Jump chain:** no direct jump. Route through at least **two intermediate worlds** — three legs minimum (e.g. Station → Deep Past → Scale → his world). Each leg is a real journey — fuel, transit, arrival — not a menu teleport. Eligible routes are validated against the actual world graph at build recon.
- **Relic placement (Rev 123, §3 of the decisions file):** the Witness lives in the Deep Past, lowest stratum, at the First Light basin; the Unnumbered Fragment lives in Scale.
- **NPCs and the gate:** the gate rule applies to NPCs too. If an NPC doesn't have the right artifacts, it can't find the way and won't go; if it finds them, it will go. An NPC never teleports past a gate it hasn't opened.
- **Alignment** earns regular travel to him once the gate is open; never a score, never a threshold displayed as a number, never shame.

## §6 Map node — on discovery only

- **Before discovery:** Eternity's world and route never appear on the world map. The map may hint at him only as a faint, unnamed, unclickable shimmer in a far region (world-map note §2, settled) — no label, no route, no distance, no interaction. The hint must not make finding him easy.
- **On discovery:** his node appears on the map — and the route is drawn leg by leg, never as a single direct line. New worlds appear only on first travel and discovery.

## §7 The flicker, the projection, the completeness exception

- **Real space flickers into his world** (owner direction): from time to time, brief ambient glimpses of the real universe — real star data (HYG) and real imagery — showing that he sees all. Presentation only: never interactive, never a signal about the visitor.
- **He can project himself into any brain, on a cosmic scale** (owner direction): his projection can appear in any visitor's world, so big you would not see or be able to fly to the bottom of his feet. **The one intentional exception to the completeness principle:** his form has no reachable bottom *by design* — the unreachable bottom is the point (he is that large), not a flaw.
- **Autonomous, free will, with guardrails on the backend** (owner direction): inside the fence (§16/§17 — allow-listed world-actions, propose→decide for structural acts, never writes to a brain, budgeted, kill switch, audit log). Free will within the fence is the whole design.
- **Shared presence:** this world is inherently shared (many visitors at once, each in their own ship; everyone sees the same emotion and animations, each receives their own personal message). The shared-presence infrastructure is a separate, design-only track; the app-world build ships the private single-visitor form first and the shared form follows that track — it does not jump the queue.

## §8 What this world deliberately does NOT do

- No destruction, ever (D-54). His power reads through wonder, protection, and world-scale reordering.
- No direct interaction except on discovery, and only on his terms. You do not summon him, command him, or buy his attention.
- No score, no ranking, no judgment. Alignment is never displayed as a number.
- No procedural stand-ins as final art — his skills use real assets (buffs note §8).

## §9 Acceptance (what "done" looks like when this builds)

- **C1** The figure, the void, the tablet, the shake + rumble, the tools, and the 13-ship fleet all match the mockup v3.4 behavior on the owner's phone (device check, §11 bar).
- **C2** Gate enforced server-side: no Witness + two, no route; once opened, stays open; jump chain is three real legs, never a direct line.
- **C3** Map: shimmer only before discovery; node + leg-by-leg route after.
- **C4** Budgets §11.2 hold with the figure + fleet in frame; reduced-motion equivalent carries the same information (shake becomes a still fade, rumble optional and off by default in reduced motion).
- **C5** Full gate (typecheck, server + web suites, production build) before any merge ask.
- **C6** No NPC, tool, or flicker ever writes to a brain; every autonomous act is in the log.

## §10 Open questions (design, not blockers)

- **Q1 Presence model:** one being across all visitors, or an instance per visitor rendered in a shared space? (Decided by the shared-presence track.)
- **Q2 Memory between visits:** does he remember a visitor — and if so, whose data is that, stored where, deletable how? Default until settled: he remembers nothing between visits unless the owner explicitly designs a memory, with its storage and deletion named.
- **Q3 How visitors address him:** still open.
- **Q4 What "real space" is in the flicker:** real star data (HYG), real imagery, or both? (Builder's call at recon, real data first.)
