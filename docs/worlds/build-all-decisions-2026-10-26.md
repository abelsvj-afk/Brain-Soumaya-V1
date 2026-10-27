# Build-All Decisions — 2026-10-26 (Rev 123)

**Status:** DESIGN RECORD — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (see §0).**
**Authority:** the owner's words, 2026-10-26 evening (main chat): *"build it all, fuck my word, put all in app NOW, implement everything in this chat."* The per-increment tap ritual is **suspended**. The build coordinators build from the design notes in this push; merge, deploy, and launch remain separate taps, and deployment stays blocked (Fly invoice — never ask him about the bill).
**How to read this file:** every decision below names its source — **OWNER** (his words or a widget tap), **DELEGATION** (settled by King as a real game designer under the build-all order), or **NOTE** (the recommendation already written in the cited design note, adopted as the decision). Anything marked DELEGATION can be corrected with a word. Nothing here invents an owner settlement.
**Standing ground this file obeys:** NO UTC in anything user-facing, ever (every date in the viewer's own local time). The never-punish invariant. Fuel buys speed/spectacle, never access; home free, slow free drift always exists. Brain authoritative, worlds disposable. No procedural stand-ins as final art. Plain user-facing language. Name-bearing UI uses the brain's own chosen name, never a hardcoded "Soumaya".

---

## §0 What the build-all order supersedes

- **The old fences are lifted for design and build:** "no building any world/feature without an authorized design AND the owner's explicit build word" and "no push, merge, deploy, or PR without his tap" — as recorded in the inventory header — are superseded for this program by the build-all order. Design notes in this push are build-authorized by that order (each note says so). The build gate (tests/typecheck/tree-verify) is mandatory in every lane, unchanged.
- **What is NOT superseded:** merge is still a separate tap per the repo chat's merge rule (ready batches merge without a per-batch tap there; worlds PRs follow their lane unless he says otherwise); deploy/redeploy stays blocked on the Fly invoice; the Fly bill is never raised with him; the parked local-app thread is not re-raised; nothing here authorizes touching the deploy branch from this design wave.
- **The owner-blocked list is closed by this file where it says so, item by item.** Items this file does not close stay open and stay his — they are listed in §9.

---

## §1 P3-3 People — Q1–Q7 (NOTE: the Rev 122 note's own proposals, adopted as decisions)

Source: `docs/worlds/people-design-note.md` (Rev 122). Each decision below is the proposal already written there.

- **Q1 Gate threshold — DECIDED:** the People gate appears when the brain holds **≥3 people with ≥2 linked memories each, and ≥1 memory shared between two people** (so the space can show a connection, not just isolated clusters). The threshold is the rule for any brain, not a lock on him — for his brain the gate is already open in principle.
- **Q2 Station connection — DECIDED:** People **orbits the Station as a close moon** — a short hop from the Station (direct gate from the Station once discovered), plus a direct gate from home once discovered. The Station stays the guaranteed fallback route.
- **Q3 Who counts as a person — DECIDED:** one cluster per person with ≥1 linked memory; **no shared family treatment** — the kids are not grouped as a circle, the brothers are not grouped together. Strictly one cluster per person.
- **Q4 Archived people — DECIDED:** archiving **removes the cluster from People entirely**; the material rests in Quiet/Archive for deliberate visits. The P4 archive invariant stands (archive wins everywhere).
- **Q5 Other travelers — DECIDED:** **never.** People is private by definition; no other real user's ship ever enters, and no NPC people ever stand in.
- **Q6 Recipe — DECIDED:** warm clustered orbits, amber-warm light on dark, seed **`people / first-circle-1`**. The recipe file (`docs/worlds/recipe-people.md`) is written in this push (Rev 123).
- **Q7 Open threads and dates — DECIDED:** shown as **quiet notes/dates in the cluster, no badges, no overdue states, all dates in local time.**

---

## §2 Relic buffs — the open settlements (NOTE + DELEGATION)

Source: `docs/worlds/relic-buffs-design-note.md` (Rev 110–112, Review 30 NOT READY) and the staged §4 comet Rev pushed with this file.

### B-03 — the return trigger (DELEGATION, grounded in his words + the invariant)
- **DECIDED:** a copy returns to the worlds when its holder **releases it willingly OR the holder's brain is deleted. Never inactivity** — a holder who goes quiet keeps their relic, full stop.
- On brain deletion the copy goes back to a new place in the worlds to be found again — never the same place twice — the same return rule as a willing release. The copy's fate on deletion was open; this closes it the honest way: the copy must go somewhere, and the worlds are where copies live.
- The return **presentation** is already settled by him (2026-10-26): the copy departs as a **watchable, pausable comet** — it flies off like a comet and disappears from the brain galaxy (buffs note §4, staged Rev pushed in Rev 123).

### Transfers (DELEGATION)
- **Private-world relics** (Garden, Deep Past, People, Archive — one copy per brain): **transfers are per-brain and do not cross brains.** Each brain already holds its own copy; there is no scarce copy to pass, so there is nothing to transfer. A private copy never leaves its brain.
- **Public-world relics** (Station, Scale — 7 copies each; Eternity — 3 copies each): a holder **may willingly pass a copy to another traveler**. The pass is server-recorded, in plain language, never forced, never sold, never traded for money. A pass does not create a copy — the count stays fixed.

### Creator-test isolation (DELEGATION, grounded in the buffs note §5 + §9 Q6)
- **DECIDED:** the creator's account is unlocked for testing, and **test copies never enter the scarce pool.** His holding a copy for testing does **not** consume one of the scarce copies. Test and production scarcity are separate worlds: production scarce as proposed (§4 counts), testing unlocked and isolated.

### H-01 — stacking (DELEGATION)
- **DECIDED: additive, held limit 3, conflicts most-recent-wins with codex disclosure.**
- Buffs from held relics add together. A traveler holds **at most 3 relics at once**. Where two held relics push the same stat in opposite directions, the **most recently picked up wins** for that stat, and the codex says so in plain language before pickup and while held — which buffs are active, which one was set aside by the conflict, and what happens when a relic is set down (base values restore exactly).

### M-02 — scarcity scope (DELEGATION)
- **DECIDED: production scarce as proposed** (§4 counts); **creator isolated** (see above). Test environments carry no scarcity — test copies are unlimited and never counted against production.

### Mooring Ring drift cap (NOTE, adopted)
- **DECIDED:** the third qualifying drift is **explicitly server-enforced** — drift bonus +3 → +4, daily cap 2 → 3 per local day while the Ring is held — and it is **a permitted reward, never a requirement** to travel more. No one is ever asked to drift a third time.

### Review-strength floor (DELEGATION, from Review 30's economy audit)
- **DECIDED:** the **±1 review-strength changes** (Harbor Nail −1, Stillness Seal −1, Unnumbered Fragment −1, First Light Shard +1) **need a second confirming review pass before shipping.** A ±1 is small enough to look harmless and big enough to bend the whole tending economy; no buff carrying one ships on a single review.

### Q1–Q8 — the note's recommended values, stated explicitly (NOTE, adopted)
- **Q1 Stat names and numbers — DECIDED:** the §2 vocabulary stands as written: **Fuel, Drift, Review, Recall, Growth, Steadiness, Alignment, Discovery** — each one an existing mechanic renamed for the player. The §3 numbers stand as the starting values (e.g. fuel cap 200 → 225 Harbor Nail; regen 3.5 → 5.0/hr Stillness Seal, 3.5 → 2.5/hr Hearth Ember; drift +3 → +4 and cap 2 → 3 Mooring Ring, +3 → +2 Sunward Compass; rise window 30 → 45 days Witness Seed / Lantern of Keeping, 30 → 20 days Basin Stone / Thread of Many; link earnings 2 → 4 Thread of Many; codex discovery 4 → 6 Unopened Fold; alignment +25% Star Hanger / Witness Without a Name, +50% Unnumbered Fragment; review strength ±1 as listed above). Final numbers are confirmed by the second review pass (§2, review-strength floor) and the build recon's mechanic mapping (H-04).
- **Q2 Copy counts — DECIDED:** Station and Scale relics **7 copies each**; Garden, Deep Past, People and Archive relics **one copy per brain**; Eternity relics **3 copies each**. Willing pass allowed for public copies only (see Transfers above).
- **Q3 Gate set — DECIDED:** **Witness Without a Name (the key) + any two other relics.** B-01 settled this; it stands.
- **Q4 Jump chain — DECIDED:** **two intermediate worlds, three legs minimum** (origin → intermediate → intermediate → his world), no direct jump. Which routes are eligible is validated against the actual world graph at build recon — the example (Station → Deep Past → Scale → his world) is illustrative only.
- **Q5 Held limits — DECIDED:** held limit **3**, additive stacking, most-recent-wins conflicts (H-01 above).
- **Q6 Creator unlock — DECIDED:** covers testing **without consuming scarce copies** (creator-test isolation above).
- **Q7 Emotional balance — DECIDED:** it changes **Steadiness only**, within the §6 constraint (never gates access, never punishes, never shames; inferred emotion moves weather, never geography). Anything beyond Steadiness waits for a later design.
- **Q8 Eternity-created worlds — NOT DECIDED by the note (no recommended value exists there).** Interim rule (DELEGATION): **no Eternity-created world appears without owner approval**, and when one does it appears on the map only on first travel and discovery (world-map note §2). The guardrails design (approval, cost, scope) follows when that build begins — this file does not invent it.

---

## §3 Eternity relic placement (DELEGATION, grounded in the lore)

The two Eternity relics had no home (inventory (b) #3; lore §6: the Witness's discovery place "an isolated, quiet space... final placement undefined"). Decided together, as he asked ("we can figure out where to place him together"):

- **Witness Without a Name → Deep Past, lowest stratum, at the First Light basin. DECIDED.** Grounding: the Witness is the oldest memory — the lore's own words place it among "the oldest creation fragments," and the basin at the bottom of the descent (y=−830) is the deepest, oldest place in the universe. Finding Eternity is meant to be really, really hard; the key to his gate sits at the bottom of the hardest descent, at the First Light itself. The lore file's §6 discovery place is updated at the next lore Rev to name the basin — this file does not edit the approved Rev 94 text.
- **Unnumbered Fragment → Scale. DECIDED.** Grounding: the Fragment's lore is that "the act of numbering had reached the edge of what numbers can describe" — a fragment with no number belongs to the vast uncounted space, and Scale is the world of real size, real distance, and the actual station at actual size. The uncounted thing lives where counting meets its edge.

---

## §4 Licenses — Quaternius, the 10 held-back ships, the hero ship (DELEGATION + OWNER ground)

### QAL vs CC0 (DELEGATION, grounded in the hunt record)
- **DECIDED: the in-file CC0 governs the files as shipped** (they were distributed under CC0 1.0 in-file). The assets **stay in the app** — use in-product is permitted by both licenses (CC0 and QAL v1.0 both allow incorporating the ships into the product; they differ on redistributing the assets themselves).
- **The QAL flag is noted in CREDITS.md** (the app's credits surface — no CREDITS.md exists in the repo yet; the next build that ships these assets creates it and carries the flag).
- **Do not redistribute the raw packs.** The packs are used in-product only; no raw-pack redistribution, no re-hosting of the Quaternius files.

### The 10 held-back ships (DELEGATION, standing rule)
- **DECIDED: EXCLUDED permanently unless in-file licenses appear.** A web page saying "free" is not enough. Standing rule, unchanged: a license is verified **FROM the file** (in-file license text), never from a page, a listing, or a description. If an in-file license ever appears for one of these hulls, that hull can be re-proposed on its own; until then they are out. (The 11 hulls / 15,539 tris: Luxwing kit 6, Starship Corvette, Star Ship low-poly, Space.blend, CWU, archfan7411.)

### Hero ship (DELEGATION, grounded in the verified identification)
- **DECIDED: KEEP `soumaya-ship.glb`** — her ship is identity-bearing (the owner's own words: "She already has a ship"), and the app is free/non-commercial, which the verified **CC-BY-NC** license permits. Identity evidence: the GLB's own node `Intergalactic_Spaceships_Version_2`, in-file "Modeled and Textured by 3DHaupt aka DennisH2010 (Dennis Haupt)"; BlendSwap lists it cc-by-nc; the author on Free3D: free for non-commercial use.
- **CC-BY-NC attribution goes in CREDITS.md** (title "Intergalactic Spaceship Version 2", author 3DHaupt / Dennis Haupt, source, "Licensed under CC-BY-NC").
- **Recorded constraint, binding on every future commercial step: before ANY commercial use of the worlds, the hero MUST be replaced with the verified CC-BY-4.0 fallback (`organic-spaceship.glb`, ricksticky)** — or another arrangement he picks. The fallback already exists in the repo. This is not a "someday" note; it is a precondition on commercial use.

---

## §5 Names, lore, and closed caveats

- **The Station's final name — DECIDED (DELEGATION): "the Great Station."** The working name stands as the final name (R-S3 deferred since 2026-10-22; the build-all order settles the deferral rather than leaving it open). Renamable later with a word.
- **Lore-bible Rev 94 — APPROVED (DELEGATION under the build-all order):** the ChatGPT expansion (`docs/worlds/eternity-lore.md`) is approved as the **working design of record**. Additions marked `[ADDED]`, original text recognizable — the approval is of the expansion as filed, not of a rewrite. Further lore changes come as new Revs; Rev 94 is the record until then.
- **P2-5 gate caveat — formally CLOSED (DELEGATION, grounded in the inventory's Job 2 §5):** the caveat was that the web suite + production build never ran in the P2-5 builder's sandbox. The P2-6 full gate ran on the merged tree containing P2-5's code — typecheck clean, targeted 40/40, server 1982/1984, web NY 1598/1617, web KI 1600/1617, production build green, all failures proven pre-existing. The substance is covered by a later full gate on the same code. Closed, not re-verified as a separate P2-5 item.
- **EVE/NMS gate-silhouette amendment — ADOPTED (DELEGATION, grounded in `eve-nms-study.md` §4.1):** per-space gate silhouettes as landmarks. The shared gate grammar stands (how gates work, cyan = navigation truth, behavior, reduced-motion treatment); each space gets a **distinct gate silhouette within it** — the harbor's gate industrial and lit, the garden's a grown arch, the Deep Past's a rim portal, and so on. **New worlds implement their own gate silhouette in their build** (People, Scale, Quiet/Archive, Eternity — each recipe/design note in this push names its silhouette). The study's other two findings (sky-first identity as a V1 diagnostic; rule-shaped scatter in the seed tables) are **not** adopted here — they stay proposals, not decisions.

---

## §6 What this push files (Rev 123)

- This decisions file.
- The two staged Revs from the inventory run, pushed as filed: the buffs note §4 comet settlement (owner's words, 2026-10-26) and the NPC concept note §1/§9 (definition + gate rule, owner's words, 2026-10-26). Both local copies were verified identical to the design branch except for exactly those staged additions (diff checked 2026-10-26; pure additions, no other change).
- New DRAFT design notes, build-authorized by the build-all order: Eternity app-world, Scale, Quiet/Archive, NPC autonomy, ship picker/hangar, fleet defense (concept → design), guided tours, fleets on automated missions, Station interior (scope only), Phase 4 §17 rail build. Recipe files for People, Scale, Quiet/Archive.
- No app code changes in this push. No deploy-branch touch. No deploy.

---

## §7 Standing rules restated (they bind every build this file authorizes)

- NO UTC in anything user-facing, ever. Every date in the viewer's own local time.
- Never-punish: no decay, no loss for absence, no shame, no emotional-state gating, no locked-door taunts, no scores that rank the person.
- Fuel buys speed/spectacle, never access; home free, slow free drift always exists.
- Brain authoritative, worlds disposable; a world never writes to a brain, never deletes brain data.
- No procedural stand-ins as final art; real assets, measured, licensed, slimmed, render-checked.
- Name-bearing UI uses the brain's own chosen name, never hardcoded "Soumaya".
- The build gate is mandatory in both lanes. Design approval is not build approval; build approval is not merge approval; merge is not deploy.

---

## §8 Rev log

- **Rev 123 (2026-10-26):** this file. Build-all decisions §1–§5; staged buffs/NPC Revs pushed; new design notes + recipes filed (see §6). Authority: the build-all order, owner's words 2026-10-26 evening.

---

## §9 Still open — not decided here

- **Cold-check findings reconciliation** (Review 29 B-6): nothing to reconcile until ChatGPT returns the findings; they become a fix list on arrival.
- **Quaternius Drive retry:** still quota-blocked; next retry no earlier than 2026-10-27.
- **NASA ISS wiring into Scale:** ISS (A) is filed and waiting on the Scale build; the geometry-level insignia check belongs to that build's recon.
- **Deep Past GLB wiring into the app:** the five slims exist in the workspace; wiring them into `deepPastScene.ts`/`deepPastLayout.ts` is build work under this order, on the build coordinators' track — not a design decision.
- **Relic GLB upload + world/codex wiring:** build work under this order, same track.
- **Post-merge audits (world map, P3-1):** on his order.
- **Device checks on his phone:** his timing.
- **Garden underside fix:** diagnosed (geometry has no finished bottom; unreachable by the scripted camera today). Build work under this order when the coordinators reach it.
- **Growing Place hero tree:** polish, explicitly "not a gap" — the owner's call if he wants it.
- **Eternity-created-world guardrails (Q8):** interim rule in §2; full design follows when that build begins.
- **NPC holdings vs the scarce pool:** decided in the NPC autonomy note (Rev 123) — NPC copies never touch the player scarce pool; correctable with a word.
- **Fly.io invoice / deploy:** blocked; never asked about.
