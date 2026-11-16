# Soumaya NPC Autonomy Audit — Ambient Life Benchmark

**Date:** 2026-11-15  
**Status:** Read-only audit findings; design/review artifact only  
**Audited repository:** `abelsvj-afk/Brain-Soumaya-V1`  
**Audited ref:** `main`  
**Audited HEAD:** `185eb0bfc54a4c7698d19f90247579e0ab3deef7`  
**Comparison scope:** NPC autonomy only — crowd density, activity variety, routines, NPC-to-NPC interaction, trading/economy, conversation depth, and player responsiveness.

## Verdict

Soumaya has a substantial authored NPC-presence system, but it is not yet at the requested GTA 6-level ambient-life bar. The Station has a cast with identities, jobs, goals and factions; scheduled world presence; movement; encounter dialogue; and player-facing conversations. Most of that life is presentation driven by deterministic clocks and captions, not independent NPC behavior. The inspected ambient cast does not demonstrate real NPC-to-NPC conversations, an operating ambient economy, persistent social relationships, or independent background work. The Harbor controller is the one ambient Station NPC with a server-side action loop, and that loop is deterministic and lazy. The Station interior explicitly has no NPCs. The audit is scoped to `main` at the HEAD above. The repository default branch is `claude/soumaya-second-brain-v1-m4z4hc`; the requested file paths could not all be verified on that ref through the available repository interface, so this report does not claim to represent that branch.

## Scope and evidence rules

- Eternity is excluded from the NPC autonomy assessment as requested; Eternity is a separate Presence/Oracle.
- No setting, graphics, city scale, budget, tone, or crime/violence comparison is made.
- No punishment mechanics or universal NPC voice requirement is proposed.
- A design statement is not counted as an implemented behavior.
- Unverified means the inspected source did not establish the behavior; it does not prove that no other branch or uninspected system contains it.
- The owner's report that waypoint wandering is being introduced is recorded as **not verified on audited `main`**. The fetched `npcPresence.ts` still contains circular `roamAt` movement.
- This is an audit only. No implementation is authorized by this document.

## Autonomy gap table

| Behavior | Designed | Built on audited `main` | GTA-level ambient-life bar | Gap |
|---|---|---|---|---|
| Crowd density | A populated Station with a recognizable cast and background inhabitants. | `NPC_CAST` contains 15 entries including Eternity. Excluding Eternity leaves 14 entries. Seven entries have `great-station` as their home. Presence is selected in two-hour slots with deterministic home/away probabilities. | A convincingly occupied hub with a range of simultaneous background activities. | Very large |
| Movement and wandering | NPCs move through their worlds and are encountered naturally. | The Harbor controller has a five-minute docked → leaving → patrol → return cycle. Other cast ships use `roamAt`, producing circular laps with seeded periods/directions. | Movement should communicate destination and purpose, not simply continuous motion. | Large |
| Waypoint wandering | Owner reports circular movement is being replaced by seeded waypoint wandering. | Not verified on audited `main`: `npcPresence.ts` still defines circular `roamAt`; `npcBodies.ts` calls it for ordinary cast ships. | NPCs choose destinations, travel, arrive, linger and choose another activity. | Large |
| Activity variety | Work, trade, refueling, travel, discussion, worship, rest, patrol and wandering. | Cast data includes jobs, life descriptions, goals and activity weights. Presence code often presents generic activity descriptions such as “about their work.” The full activity-selection-to-action path was not established by the inspected source. | Distinct activities visibly occur and are recognizable without relying on captions. | Large |
| Daily routines | Activity selection is intended to reflect time slots, job, faction calling, temperament and daily ordinance. | Society calculations produce currents, faction standings, daily callings and ordinances. The inspected evidence did not establish that every cast member executes a persisted daily routine. | NPCs have recognizable routines that unfold over time and produce observable behavior. | Large |
| NPC-to-NPC interaction | Design describes paired activities and chatter situations. | Daily-script/society designs describe paired captions and chatter. They explicitly distinguish these from implemented NPC-to-NPC conversation. The inspected movement code does not establish reciprocal interaction behavior. | NPCs actually meet, face one another, exchange information, respond and separate. | Very large |
| Trading and economy | NPCs are intended to trade and participate in Station life. | Ambient society design treats money, fuel and trade references as flavor/captions rather than a transactional ledger. A separate captain economy exists in other repository work, but that is not evidence of an ambient-cast economy. | NPCs exchange goods/resources with observable consequences for their own holdings and future choices. | Very large |
| Conversation depth | Authored identities, lore threads and dialogue that can reveal more over repeated encounters. | `npcDialogue.ts` contains authored dialogue structures, ordered thread steps, meeting thresholds and dependencies. This is structured authored dialogue, not open-ended NPC cognition. | Conversations should respond to context and history while preserving authored character identity. | Medium |
| Player responsiveness | NPCs are discoverable, react to proximity and can be approached and spoken to. | Presence code implements near/far hysteresis, meeting counts, encounter lines and first-meeting handling. Body management supports stopping the selected NPC and facing the player during Talk. | NPCs notice and respond naturally to player presence and interaction without making the rest of the world stop. | Small–medium |
| Independent decisions and actions | NPCs should have lives and make decisions independently of the player. | The Harbor controller has a server-side Perceive → Decide → Act → Log loop, but its policy is deterministic. The ambient cast has no equivalent population-wide action loop established by the inspected society design. | NPCs independently choose and carry out actions within world rules. | Very large |
| NPC memory and relationships | Individual identity and social connections are part of the intended living society. | Player-side encounter counts and aggregate player-memory-derived faction currents exist. These do not establish persistent individual NPC memories or NPC-to-NPC relationship histories. | NPCs remember their own experiences with other NPCs and let those histories influence later behavior. | Very large |
| Life while player is absent | The world should have life beyond the player's immediate presence. | Ambient presence is clock-derived. The Harbor controller loop is lazy (triggered by read/question), not a demonstrated continuous background process. No population-wide background simulation was verified. | Work, travel, social activity and economic changes continue independently of player observation. | Very large |
| Station interior population | Great Station is the public hub for docking and social activity. | `stationInteriorLayout.ts` explicitly states “No NPCs inside.” The Harbor controller meets the player at arrival outside. | Where the experience calls for populated spaces, people should be visible doing meaningful things. | Very large for the interior |

## What currently works against autonomy

1. **Circular movement — verified on audited `main`.** Ordinary cast ships move around a fixed anchor through `roamAt`. This reads as a loop rather than purposeful travel. Owner-reported waypoint replacement is not reflected in the audited ref.
2. **Generic activity descriptions.** The inspected presence helper can describe an NPC as “about their work” without showing the work being performed.
3. **Caption-based social life.** A paired caption or chatter label is not an NPC-to-NPC exchange.
4. **Two-hour presence slots.** Clock-derived home/away changes establish presence, not a demonstrated journey or routine.
5. **Lazy Harbor-controller loop.** Its action loop runs when read or questioned rather than as a continuously progressing ambient process.
6. **No ambient population loop verified.** The broader cast does not share the Harbor controller's action loop in the inspected evidence.
7. **Empty interior by design.** The interior specification explicitly excludes NPCs; this is a settled design constraint, not a rendering bug.
8. **Talk holds the selected NPC.** This is intentional and reasonable for conversation. The inspected body-management comments indicate the world clock is not stopped and the NPC resumes based on its clock position; this is not evidence that the entire world freezes.
9. **Reduced-motion behavior.** NPC movement can intentionally be held for reduced-motion accessibility. This should not be treated as a general autonomy defect.
10. **Voice-rule discrepancy requires reconciliation.** The voice design document's narration modes should be compared with the owner's reported “speak on tap unless Never” behavior before changing anything. The current deployed behavior was not independently verified in this audit.

## Ranked recommendations by ambient-life impact

1. **Real, observable NPC-to-NPC interactions.** Move beyond partner labels/captions: two existing NPCs meet, face each other, exchange a short contextually appropriate interaction, then resume their own activity.
2. **Activities that produce visible behavior.** Job, goal and activity data should lead to recognizable actions, not only descriptive text.
3. **A real ambient Station market.** NPC-to-NPC exchanges should change inventories/holdings and inform subsequent decisions. Do not conflate this with the separate captain economy.
4. **A convincing unvoiced background population.** Preserve the named cast and the rule that only main NPCs have voices. Background population can add movement, work, docking, trading and group activity without voices.
5. **Persistent NPC social memory.** NPCs should remember their own interactions with other NPCs and let that history shape later behavior.
6. **Reconcile the interior's no-NPC rule with the hub-life vision.** This requires explicit design approval; do not silently change the settled four-room design.
7. **Expand the autonomous action framework.** Reuse the Harbor controller's bounded server-side execution principles while designing population-level scheduling, budgets and validated actions. This must align with the owner's approved LLM-cognition direction.

## Smallest next step

**Design one real, observable NPC-to-NPC interaction on the Great Station exterior using two existing cast members and one existing activity pairing.**

The first proposed interaction should have a minimal lifecycle:
1. Select two existing Station-present NPCs using existing roster/activity data.
2. Have them converge on a shared waypoint.
3. Stop them and orient them toward each other.
4. Present a short two-sided exchange using existing authored or daily-script lines.
5. Resume their individual movement/activity afterward.

This is a design target, not implementation authorization. The interaction should not require new characters, new voices, universal LLM calls, a new economy, punishment mechanics, or changes to player holdings. Before code, define the state model, triggers, server authority, persistence, cancellation/recovery, concurrency rules, and acceptance tests under the project's design-first workflow.

## Design conflicts and decisions to reconcile

- The hive-society design describes the ambient population as not being individual agents, coordinated through shared callings. The owner's now-approved direction is individual model-backed NPC decisions with server-side validation. The old design must be reconciled with the approved direction before implementation.
- The Station interior specification explicitly excludes NPCs. Any populated interior proposal requires a separate owner-approved design change.
- The waypoint-wandering change reported by the owner was not present in the audited `main` source. Verify the intended authoritative branch/ref before treating the movement issue as resolved.
- The voice-mode rules should be reconciled against current product behavior without expanding voice access to every NPC.

## Source files inspected

- `docs/specs/npcs-alive-2026-10-30.md`
- `docs/specs/npc-society-2026-10-30.md`
- `docs/specs/npc-hive-society-2026-10-30.md`
- `docs/specs/npc-daily-script-2026-10-30.md`
- `docs/specs/living-worlds-dialogue-2026-10-31.md`
- `docs/specs/npc-dialogue-voice-2026-10-31.md`
- `packages/shared/src/npcs.ts`
- `packages/shared/src/npcDialogue.ts`
- `packages/shared/src/society.ts`
- `packages/web/src/graph/npcPresence.ts`
- `packages/web/src/graph/npcBodies.ts`
- `packages/web/src/graph/stationInteriorLayout.ts`
- `packages/server/src/npcs/loop.ts`

**No code, runtime behavior, existing design files, or application configuration was changed as part of this audit.**
