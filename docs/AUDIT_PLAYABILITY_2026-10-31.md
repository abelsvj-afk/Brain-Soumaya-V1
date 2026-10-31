# Playability gap audit — worlds, lore and "can a real player actually do it?" (2026-10-31)

Requested by the owner after the eighth seam world: *"you said there's no way to open it — we need certain gaps filled in that fashion, amongst worlds and actual playability."* This is a measured audit, not an opinion: the numbers come from `scripts`-style runs over the real data (`STORY_*`, `RELICS`, `NPC_CAST`) and a real headless browser. Gap ids are stable (G1…); status says what shipped in this pass.

## How it was measured
1. **Reachability fixpoint** — start a *non-owner* brain in the base worlds; add everything their triggers can give (a relic counts only if it is `discoverable` in the app); open every story door whose gate is satisfied; repeat. Now a permanent test: `packages/shared/src/worldReachability.test.ts` (falsified: re-breaking a gate fails it).
2. **Verbs per world** — what a player can *do* in each: entries / spots / passages / people / roads.
3. **Real browser** — fly to the place, open the card, press the buttons, read what the server stored.

## Findings

### G1 — Two of the eight new worlds could not be reached by anyone but the owner — **FIXED**
`the-long-morning` (gate: the Unnumbered Fragment) and `the-folded-letter` (gate: the Unopened Fold) both opened on relics that live in worlds whose relics are `discoverable: false` (Scale ×3, Quiet/Archive ×2) because their scenes do not place relics yet. Nothing failed loudly; every test passed because the gate was checked against a Book entry that nobody could ever obtain. Five Book entries in total were unobtainable (`relic.star-hanger`, `relic.sunward-compass`, `relic.stillness-seal`, `relic.unopened-fold`, `relic.unnumbered-fragment`) and the 20 entries inside the two worlds with them.
**Fix:** every story gate is now a list of *ways in* (`STORY_WORLD_GATES` in `shared/worlds.ts`, one source for the server and the test). The Long Morning also opens for **Orsolya's Shard** (the other half of the first record, found in the Deep Past). The Folded Letter also opens for **the open alcove + Vesh's paper boat** together (the Archive, and company with Vesh; either alone is not enough). The original relic keys still work the day those relics become discoverable.
**Still open (G1b):** the five relics themselves stay undiscoverable until Scale and the Archive place them in-scene (GLBs + anchors) — an owner/Muse art task. The test lists them as a *known* gap and fails on any *new* unobtainable entry.

### G2 — The Folded Letter had no choice in it — **FIXED**
The ending "reached only by choice" offered no choice: there was no way to open the letter, so nothing was being chosen. **Now:** in the room, the letter's card offers *Keep it folded* or *Open it*. Opening asks a second time and is final (a read sentence cannot be unread); keeping is not final. The sentence is never shown, stored or paraphrased, and the card says so plainly ("…will not say what it said, or whether it was kind"). The server (`story/choices.ts`, `GET /api/story/choices`, `PUT /api/story/choices/fold-letter`) stores **only which** — in the existing `story_roads` table under a reserved `choice.` id, so backups and account deletion already cover it; it can only be set from inside the room (checked against the travel ledger). Nothing is counted or rewarded; the door stays ajar. A voice from the seat by the door answers either way (kept: *thank you, the thing I needed most*; opened: *nothing is asked; a kettle is put on*). Tests: 3 server, 4 component; real-browser run stored `kept`.

### G3 — The seam worlds were thinly peopled — **FIXED**
Four of the eight story worlds (Ward, Road, Village, Unmade Hour) had only **2** people in or roaming into them. Now every story world has **≥ 3** (the Archivist into the Ward; the Surveyor onto the Road; the Wayfarer into the Village and the Unmade Hour; the Dissenter into the Unmade Hour). Pinned by a test.

### G4 — Roads end with a sentence, nothing you can keep — **OPEN (design)**
23 roads; **all 23** pay out as one line of text. Finishing one changes nothing in the world, the Book, or the Archivist's/Keeper's later talk. *Proposal:* a finished road lights one small, quiet Book mark (a "keepsake" light with no count) and changes one later line of its giver. Needs a spec and the owner's say on whether roads should reward at all (the lore's "nothing is scored" stance is the reason they don't).

### G5 — Thin worlds: Eternity and the Garden — **OPEN (content)**
Eternity: 3 entries, **0 passages, 0 roads**, 2 people. Growing Place: 4 entries, 1 passage, 1 road — rich mechanics, little lore. Both are easy to deepen (Eternity needs holders for passages; the Garden's landmarks already exist) but the lore for them is the owner's.

### G6 — Nothing in the worlds *responds* to what you do — **OPEN (design)**
Every seam world offers the same six verbs: fly to a place, be still (Regard/Listen), Look closely, talk, take a road, and now (in one room) choose. A brain that has found everything in a world has nothing left to do there and the world does not change. The strongest candidates, each needing its own spec: a place that remembers a visit (the lamp lit lower after you stay), a world that changes once its Book entries are all found, and the Hours already tint worlds (S5) but do not change what can be found.

### G7 — The gates are not discoverable as *hints* — **OPEN (design)**
A brain learns a door exists only from rumours (8 lines) once it already has the key. Nothing tells a player *why* a door is shut, or which kind of thing would open it, beyond the plain refusal. The refusals are deliberately gentle ("it appears once you have found…") and name the *kind* of thing; a hint line on the route board for a locked world (not a spoiler: the kind of thing) would close it.

### G8 — Relics and Book are two systems for the same finds — **OPEN (architecture)**
The Codex (relics, GLBs, buffs) and the Book (entries, triggers) both hold "relic" finds and are kept in step by a mirror. A relic the Codex cannot offer is invisible to the Book (G1b). Unifying them is a larger change; for now the test makes the gap visible.

## What shipped in this pass
`STORY_WORLD_GATES` + multi-way gates + `worldReachability.test.ts` (reachability, entry obtainability, every road walkable, ≥3 people per story world) · the Folded Letter choice (server, UI, tests, real-browser proof) · seam-world company.

## Suggested order for what remains
G4 (decide whether roads reward) → G7 (route-board hints) → G1b (place the five relics) → G5 → G6 → G8.
