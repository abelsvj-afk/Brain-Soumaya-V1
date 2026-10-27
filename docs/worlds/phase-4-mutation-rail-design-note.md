# Phase 4 — The §17 Rail (Mutating World) — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What this note is:** the build design for Phase 4 — the mutating world. The rail's rules (M1–M4) were settled 2026-10-22 (D-14–D-17, design-exploration-1 §17); Phase 4 itself ("layered in once there's something worth changing") was never started. This note designs the build. It does not re-settle the rules.
**Settled ground it obeys:** §17 M1–M4 (five-beat rail; structural vs presentation with the four safeguards; propose-only structural at MVP; correction edits the derivation, never the memory); D-14–D-17 (presentation bounds; batched calm review; no time-based permanence; both doors, one record); the never-punish invariant; the §16 ship-agent fence.

---

## §1 What Phase 4 is — and what it is not

- **Phase 4 is the world learning to change, under the owner's pen.** Worlds today render brain facts; they create no world-side structural state of their own. Phase 4 layers in the governed ability for the world to change — landmarks that rise, clusters that form, chapters that reorder — always proposed, always decided, always logged, always undoable.
- **Phase 4 is NOT a world that changes itself.** Nothing structural self-applies — not by the brain, not by the ship, not by an NPC, not by Eternity. The rail is the whole point: change arrives through the rail or not at all.
- **Phase 4 is NOT a new progression system.** The mutating world grows from tab thresholds (buffs note §6) and from proposals — it never scores, never ranks, never gates access. A world that has grown is a world with more in it, not a world that is ahead.

## §2 The rail, as built (M1 — five beats, in code)

1. **Propose** — the brain or the ship proposes a change with its reason and its evidence, in plain language ("These three memories all mention the move — should they form a cluster in People?"). Tool: `propose_world_change`. A proposal carries: what would change, why, the evidence (source node/edge IDs), and what it would supersede.
2. **Present as proposal** — the change renders, if at all, in its provisional form (P7 tier ii: visibly a suggestion, never an accomplished fact). A proposal is unmistakably a proposal — marked, provisional, never mistaken for the world as it is.
3. **Owner decides** — approve, edit, or reject; silence is not approval, and under notification-cap pressure the correct behavior is to wait quietly. Proposals are **batched into a calm review moment** (D-15) — no interruptions, no urgency, no approval from silence.
4. **Apply as one log entry** — an approved change lands atomically and is written to an **append-only transition log**: what changed, why, on what evidence, when (owner's local time — never UTC), and what it superseded.
5. **Undo is a new entry, never a rewrite** — `undo_world_change` appends a compensating entry that restores the prior state; the log keeps both, so the world's history is never falsified. **No time-based permanence** (D-16): undo works through dependency-aware compensating entries — never a blind snapshot restore, never a silent overwrite of newer work; conflicts are explained and resolved by the owner.

## §3 Structural vs presentation (M2 — the line the rail guards)

- **Structural (rail required):** creating or removing landmarks, changing confirmed connections, forming clusters, adding or removing anchors, changing primary homes, changing persistent chapter or tour membership — anything §9.4 calls world state. **Rewriting a saved tour or chapter sequence is structural.**
- **Presentation (allowed without individual approval):** palette and weather **within the space's established recipe**, ambient traffic and drift, reversible emphasis, and **temporary display ordering**. One subtlety: ordering is presentation only while it is a *display* choice — rewriting a saved sequence is structural.
- **Four safeguards bind every presentation change:** (i) no hidden structural effects; (ii) explainable — the user can ask why and get a truthful, plain-language answer; (iii) reversible and controllable — reset or disabled without affecting memories; (iv) never-punish — no decay, shame, ominous deterioration, productivity pressure, or any visual implication that an inferred emotional state is established fact.
- **The user can ask "what changed?"** and get the presentation deltas in plain language — a digest on demand, not an approval queue (guard against approval fatigue).

## §4 Automation levels (M3) and correction (M4)

- **M3 — Structural: propose-only, full stop, at MVP.** No structural class is eligible for auto-apply, even with undo waiting. Presentation: automatic within M2's bounds. Revisit either only with real usage evidence, as a new decision.
- **M4 — Correction edits the derivation, never the memory.** When the user corrects a mis-inference, the correction lands on the interpretation layer and is itself a log entry; every surface updates from the corrected derivation. The underlying memory is untouched — the world may be wrong about a memory; it may never rewrite one.

## §5 The log's home (D-17 — both doors, one record)

- **One append-only log, two doors:** on-demand explanations at the point of use ("why did it do that?" — answered where you are) plus a browsable **"World Changes"** view over the same log. The view is a reference/control surface, not a notification stream.
- **The log is the world's memory.** If the worlds layer vanished, the brain would lose nothing but scenery — but while the worlds live, the log is how they remember what they became.

## §6 What Phase 4 builds first

- **The rail itself** (tools, log, World Changes view, calm review batching) — exercised against representative proposals **before** full integration (the late-integration risk, answered 2026-10-22: designing early is how Phase 4 avoids arriving untested, without building the mutating world prematurely).
- **The first governed change: the Growing Place rising ceremony** — the landmark that rises for a Journey the owner marked done (D-59, presence-only landmarks; the ceremony explicitly "still waits for Phase 4"). It is the smallest real structural change the rail can govern, and the proof the rail works.
- **Then, in order:** People cluster formation (proposals from shared memories), Deep Past anchor changes, tour/chapter membership changes, tab-threshold growth (the world growing from thresholds, buffs note §6).

## §7 Sequencing

- This note → build the rail → exercise against representative proposals → the rising ceremony as the first governed change → full gate → merge → audit → the next governed change, one at a time, in the default lane.
- **Not in Phase 4:** any change to the brain's canonical data (the rail governs world state only); any auto-apply of structural changes (M3); any presentation change that touches geography from inferred emotion (M5 — inferred feeling moves weather, never geography, never depth).

## §8 Acceptance (what "done" looks like when this builds)

- **C1** Every structural change in the built worlds passes through the five beats; a test proves no structural path bypasses the rail.
- **C2** The log is append-only and complete; undo is a compensating entry; the World Changes view and on-demand explanations read the same record.
- **C3** The rising ceremony lands as one log entry, undoable, with its evidence named.
- **C4** No presentation change violates the four safeguards — tested, including an inferred-emotion case (weather moves, geography does not).
- **C5** Full gate before any merge ask; merge is the owner's separate tap (repo lane).

## §9 Open questions (design, not blockers)

- **Q1** The calm review moment's exact shape — a daily digest, or a "when you ask" surface? (Proposal: "when you ask" first — a digest that arrives unasked is a notification wearing a calm coat.)
- **Q2** Does the World Changes view live in the app's existing history surfaces, or stand alone? (Builder's call at recon — reuse first.)
- **Q3** Tab-threshold growth: which threshold is the first to grow the world, and what does the growth look like? (Proposal: the first growth is a single new landmark in the Growing Place, named in the log.)
