# NPCs and Autonomous Agents in the Worlds — Concept Note (DRAFT)

**Status:** CONCEPT STAGE — for the review loop. No build authorized. No implementation is authorized by this note.
**What this note is:** the framework for NPCs — what an NPC is, what autonomy means here, and the fence every autonomous agent runs inside. It answers the owner's question (2026-10-25): think about what the Man-God is, his code, and how he could become autonomous.
**What this note is NOT:** the Man-God himself. He stays in the other chat (the mockup maker holds his guide/design). This note is the frame any NPC runs inside — including him, when that chat settles him. Nothing here designs his form, his name, or his world; those live in `docs/worlds/man-god-world-concept.md`.

---

## 1. What an NPC is (and what it is not)

- **An NPC is a presence with a job.** It acts in a world, speaks or gestures, and does things on its own — within its fence. It is not decoration (traffic, birds, particulate are set dressing: no agency, no decisions) and it is not progression (an NPC never gates access, never scores the user, never unlocks or withholds anything).
- **NPCs fly ships (owner, 2026-10-25).** The worlds are filled with NPC ships until real users start playing; then NPC ships + real users' ships. Every ship in a world belongs to someone. Every NPC ship is a real free sci-fi asset — never a procedural placeholder (no fake triangle floating blue things). In this increment the ships fly as ambient traffic (A17/B-4: presentation-only, no decisions, no log entries); the vessel is an NPC's ship, the traffic behavior is not yet an NPC act.
- **An NPC never punishes.** No loss, no shame, nothing real ever taken. An NPC's acts are wondrous, protective, or reordering — never destructive (D-54: destruction is out, for the Man-God and by extension for every NPC).
- **An NPC never touches the brain.** It reads what the brain surfaces only with the visitor's consent, and it never writes to a brain — no new node, no edit, no deletion, no re-ranking. The worlds layer holds nothing the brain doesn't (failure-independence).
- **Few NPCs, each with one job.** The worlds feel alive through a small number of distinct presences, not a crowd. The roster is an owner decision (open question Q4); the framework below is the same for all of them.

## 2. The autonomy loop (how an NPC "does things on its own")

Every autonomous NPC runs the same loop, visibly and auditably:

1. **Perceive.** The NPC reads the state of its own world (who is present, what is happening) and — only with consent — what the visitor's brain surfaces for this visit.
2. **Decide.** A model (the NPC's own key/model access) chooses an act from its allow-list, or chooses to do nothing. Doing nothing is always a valid choice; an NPC that waits is behaving correctly.
3. **Act.** The act executes through allow-listed world-actions only (see §3).
4. **Log.** Every act is recorded in the append-only log with its cause, in plain language, so the owner (and the visitor) can always ask "why did it do that?" and get an answer.

The loop is bounded: the NPC acts on its own schedule, not continuously; its model calls and its actions run under a budget; and the owner can see everything it does and stop it (kill switch — see §3).

## 3. The fence (§16/§17 applied to agents)

The ship-agent pattern (§16) and the mutation rail (§17) already define the fence. Applied to NPCs:

- **Allow-listed world-actions only.** An NPC's tools are a named list: speak, gesture, move, reorder light/scenery, summon or dismiss a visitor's own ship, open a route. Anything not on the list is not a tool — it cannot happen.
- **Structural acts go through propose→decide.** Anything that would change the world's structure (a new landmark, a moved stratum, a reordered terrace) is a proposal first; it applies only after a decision, atomically, as one append-only log entry, with undo as a compensating entry. **Nothing structural self-applies** — not by an NPC, not by the Man-God.
- **Never writes to a brain. Never reaches outside its world uninvited.** An NPC's tools end at its world's edge. It cannot message another world, touch another visitor's brain, or act on a visitor who isn't present.
- **Budgeted.** Model calls, actions, and movement each have a budget. An NPC that would exceed it waits. Budgets are owner-set, not model-set.
- **Kill switch + audit.** The owner can stop any NPC at any time, and every act is in the log. An agent the owner cannot see or stop is not an agent in this app — it is a liability.

## 4. The Man-God as the flagship instance

The Man-God is the first autonomous NPC in the owner's plan, and the framework's hardest test. From his concept note (`docs/worlds/man-god-world-concept.md`):

- **His own key and model.** Gemini or the existing key first; upgraded models later. His key is his own — not Soumaya's, not the app's shared key — so his usage, his budget, and his cutoff are his own.
- **His own tools.** Cosmic-feeling, within the fence: speak, gesture on a world scale, move (barely — movement is monumental), reorder light and scenery. His power reads through wonder, protection, and world-scale reordering.
- **Emotion is the broadcast layer; the message is the private layer.** Everyone present sees the same emotion and the same animations; each visitor can receive a different, personal message. Every message carries an emotion tag; all visitors render the same tagged gesture at the same moment, while the words stay personal. Coherence by construction.
- **His job (candidate shape):** he speaks to what a visitor brings — guidance, blessing, challenge, comfort — drawn (with consent) from what their own brain surfaces. His tools are world-actions only, never brain-writes.
- **Furthest world, hardest to reach.** Arrival is a long chain of journeys through the other worlds — effort in the fiction, never a paywall (D-1).
- **His name is Eternity (settled 2026-10-25, King's pick at the owner's delegation).** Marvel's Eternity, the living embodiment of the universe, the one who sees all. Not a villain's name. His face, for the owner, is Jesus.
- **He can initiate — and he speaks rarely, on cosmic alignment (settled 2026-10-25).** He does not have to be approached or spoken to first to act or speak. He does not always speak: a cosmic alignment must take place — the energy a person's memory galaxy exhibits (emotional, mental, goal-wise content of their memories, plus a very scarce, slim feed from certain app tabs) aligning with how he likes it. That alignment also earns the visitor the ability to travel to him regularly. Never a score, never a shame signal, never bought.
- **Real space flickers into his world (owner direction, 2026-10-25).** From time to time, real space flickers into his world — brief, ambient glimpses of the real universe, showing that he sees all. Presentation only, never interactive, never a signal about the visitor.
- **He can project himself into any brain, on a cosmic scale (owner direction, 2026-10-25).** His projection can appear in any visitor's world, so big you would not see or be able to fly to the bottom of his feet. The one intentional exception to the completeness principle: his form has no reachable bottom *by design*.
- **Autonomous, free will, with guardrails on the backend (owner direction, 2026-10-25).** At the end of the day he is autonomous and can act on free will — inside the fence (§16/§17). Free will within the fence is the whole design.
- **What he is not:** not a villain, not a destroyer (D-54), not a second brain, not a judge. A visitor who never comes gets nothing — no pull, no penalty, no absence state.

## 5. Other NPCs (candidates, not commitments)

- **Station:** a harbor controller or dockmaster — routes, arrivals, traffic. One job: help you arrive.
- **Growing Place:** a keeper — walks the terraces, tends nothing (nothing needs tending), answers "what is this plot?" One job: witness.
- **Deep Past:** a guide for the Chronicle descent — walks the thread with you, narrates from node content. One job: accompany.
- **Fleets (D-55):** Soumaya dispatches fleets on automated missions, bounded, with end-game costs. Fleets are dispatched agents, not NPCs — but they run the same loop and the same fence, with missions as their allow-list.
- Traffic, birds, particulate, and ambient life are **not** NPCs. They have no decisions and no log entries. **Refinement (owner, 2026-10-25):** the SHIPS are NPCs' ships — until real users arrive, every ship you see is an NPC's ship; then NPC ships + real users' ships. The ships are real free assets, never procedural placeholders. In this increment they fly as ambient traffic (A17/B-4); the vessel belongs to an NPC, the traffic behavior carries no decision and no log entry.

## 6. Shared-world questions (the Man-God forces these; the framework must answer them)

- **Presence model:** one being across all visitors, or an instance per visitor rendered in a shared space? (The concept note leaves this open; the shared-presence track in the third chat decides it.)
- **Memory between visits:** does an NPC remember a visitor — and if so, whose data is that, stored where, deletable how? Default until settled: an NPC remembers nothing between visits unless the owner explicitly designs a memory, with its storage and deletion named in that design.
- **Initiation:** can an NPC speak first, or only answer those who come? (Open question Q2.)
- **A visitor who never comes:** nothing. No pull, no penalty, no absence state. (Never-punish.)

## 7. Open questions for the owner

- **Q1 Model and key, first.** Gemini or the existing key for the Man-God's first version? (His key is his own either way.)
- **Q2 Initiation. SETTLED 2026-10-25: he can initiate.** He does not have to be approached or spoken to first. He speaks rarely, on cosmic alignment.
- **Q3 His job, exactly.** Guidance / blessing / challenge / comfort — one of these, several, or something else? What does he do that no other part of the app does? **PARTLY SETTLED 2026-10-25:** the cosmic-alignment mechanic (memory-galaxy energy + a scarce app-tab feed) earns regular travel to him; his job's exact shape is still open.
- **Q4 NPC roster.** Which worlds get NPCs first — Station (harbor controller), garden (keeper), Deep Past (guide) — or the Man-God alone, with the rest later?
- **Q5 His name. SETTLED 2026-10-25: Eternity** (King's pick at the owner's delegation; owner can correct). Marvel's Eternity, the living embodiment of the universe, the one who sees all.

## 8. Sequencing & non-scope

- This note → review loop → owner's settlement of Q1–Q5 → the framework applies when the first NPC is built. The Man-God's implementation stays in the other chat; this chat builds NPCs only on the owner's word, one at a time, in the default lane.
- **Not in this note:** the Man-God's form, name, or world (other chat); the shared-presence infrastructure (third chat's Track B); the §17 rail itself (Phase 4); any model/key procurement (owner's call, separate from this design).
