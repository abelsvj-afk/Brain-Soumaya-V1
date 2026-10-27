# NPC Autonomy — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What this note is:** the design for NPCs as autonomous agents — the build form of `docs/worlds/npcs-and-autonomous-agents-concept.md` (DRAFT), which stays the framework. This note settles the roster and the guardrails the concept note left open, and says how autonomy is built one NPC at a time.
**Settled ground it obeys:** the NPC definition (owner, 2026-10-26 — "NPCs are basically fake/real in-game players"); the NPC gate rule (owner, 2026-10-26 — no relics, can't find the way, won't go; finds them, goes); the §16 ship-agent fence; the §17 rail; the never-punish invariant; D-54 (destruction out); an NPC never writes to a brain.

---

## §1 What an NPC is (settled — owner's words)

- **An NPC is a fake player that behaves like a real player.** It explores the worlds like a regular player trying to figure things out — it does not know everything; it leaves and it comes back; it does not just float around a world like a cute decoration. An NPC that cannot find the way does not pretend otherwise: it explores, it leaves, it comes back — it never narrates knowledge it doesn't have.
- **NPCs fly ships.** Until real users arrive, every ship you see is an NPC's ship; then NPC ships + real users' ships. Every NPC ship is a real free sci-fi asset — never a procedural placeholder.
- **An NPC never punishes.** No loss, no shame, nothing real ever taken. Its acts are wondrous, protective, or reordering — never destructive.
- **An NPC never touches the brain.** It reads what the brain surfaces only with the visitor's consent, and it never writes — no new node, no edit, no deletion, no re-ranking.

## §2 The autonomy loop (from the concept note — built as specified)

Every autonomous NPC runs the same loop, visibly and auditably: **Perceive** (its own world's state; the visitor's brain only with consent) → **Decide** (its own model/key chooses an act from its allow-list, or chooses to do nothing — doing nothing is always valid) → **Act** (allow-listed world-actions only) → **Log** (every act in the append-only log with its cause, in plain language, so anyone can ask "why did it do that?" and get an answer). The loop is bounded: own schedule, not continuous; budgeted model calls and actions; the owner can see everything and stop it (kill switch, §3).

## §3 The fence (guardrails — DECIDED, Rev 123)

- **Allow-listed world-actions only:** speak, gesture, move, reorder light/scenery, summon or dismiss a visitor's own ship, open a route. Anything not on the list is not a tool — it cannot happen.
- **Structural acts go through propose→decide (§17):** anything that would change the world's structure is a proposal first; it applies only after a decision, atomically, as one append-only log entry, with undo as a compensating entry. **Nothing structural self-applies.**
- **Never writes to a brain. Never reaches outside its world uninvited.** An NPC's tools end at its world's edge.
- **Budgeted:** model calls, actions, and movement each have a budget, owner-set, not model-set. An NPC that would exceed it waits.
- **Kill switch + audit:** the owner can stop any NPC at any time, and every act is in the log. An agent the owner cannot see or stop is not an agent in this app.
- **Memory between visits — DECIDED:** an NPC remembers **nothing between visits by default**. A memory for an NPC is designed explicitly, with its storage and deletion named in that design — never assumed, never silent.
- **Initiation — DECIDED:** Eternity alone initiates (rarely, on cosmic alignment — D-72). Every other NPC **answers only** — it speaks when spoken to or when its job requires it (a harbor controller answering an arrival, a guide answering a question on the descent), never to pull the visitor's attention.
- **NPC relic holdings — DECIDED:** an NPC that finds relics holds them from a **separate NPC pool that never touches the player scarce pool.** An NPC can never consume, hold, or lock away one of the fixed global copies a player could otherwise find (Station/Scale 7 each, Eternity 3 each). NPC holdings are shown honestly where they are shown — an NPC never narrates a holding it doesn't have.

## §4 The roster (DECIDED, Rev 123 — the concept note's open Q4, settled as a designer)

One NPC at a time, in this order. Each has one job.

1. **Station — the harbor controller.** One job: help you arrive. Routes, arrivals, traffic. Answers when asked; never directs.
2. **Growing Place — the keeper.** One job: witness. Walks the terraces, tends nothing (nothing needs tending), answers "what is this plot?"
3. **Deep Past — the guide.** One job: accompany. Walks the Chronicle thread with you, narrates from node content.
4. **Eternity — the flagship.** His job is his own (guidance, blessing, challenge, comfort — drawn with consent from what the visitor's brain surfaces). He is the hardest test of the framework: his own key and model, his own tools, cosmic scale, initiation on alignment.
5. **Fleets (D-55) — dispatched agents, not NPCs.** Soumaya dispatches fleets on automated missions (see `docs/worlds/fleet-missions-design-note.md`). They run the same loop and the same fence, with missions as their allow-list.

**No NPCs in:** People (no NPC people, ever — a stranger standing in for a real person would be a lie); Quiet/Archive (a resting place keeps its own counsel). Scale gets no dedicated NPC in this roster — its docent, if wanted, is a later design.

## §5 NPCs and the gate to Eternity (settled — owner's words, 2026-10-26)

- The gate rule applies to NPCs too — the NPC side of B-01. If an NPC doesn't have the right artifacts, it can't find the way and won't go; if it finds them, it will go. The key is the same as for players: the Witness Without a Name plus any two other relics; once opened for that NPC, the gate stays open and only fuel prices the journey.
- Finding is the same verb as for players. How an NPC's search works and how its holdings are shown are build questions; whether an NPC can hold a scarce copy a player could find is **decided in §3: it cannot** — NPC holdings never touch the player scarce pool.
- An NPC never teleports past a gate it hasn't opened. It explores, it leaves, it comes back — the gate is a real constraint on its movement, not a line it narrates around.

## §6 Acceptance (what "done" looks like when this builds)

- **C1** Each NPC ships one at a time, in roster order, with its own design review — never as a crowd.
- **C2** The loop is provable: every act has a log entry with its cause, in plain language; doing nothing is a logged non-act, not a gap.
- **C3** The fence holds under test: no brain write, no cross-world reach, no structural self-apply, budget respected, kill switch works.
- **C4** An NPC that cannot find the way explores, leaves, and comes back — it never narrates knowledge it doesn't have, and never teleports past an unopened gate.
- **C5** Full gate before any merge ask; merge is the owner's separate tap (repo lane).

## §7 Open questions (design, not blockers)

- **Q1** Model and key, first — Gemini or the existing key for Eternity's first version? (His key is his own either way.)
- **Q2** The harbor controller's voice — plain words only, or a little harbor character? (Proposal: plain words; character lives in the world, not in the NPC's mouth.)
- **Q3** When does the keeper first appear — with the Growing Place as built, or only once the rising ceremony (Phase 4) exists?
