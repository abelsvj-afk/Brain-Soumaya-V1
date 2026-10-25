# ChatGPT Review 30 — Relic Buffs Design Note

**Reviewer:** ChatGPT (relayed by the owner) · **Date:** 2026-10-25 · **Verdict: NOT READY**
**Scope:** `docs/worlds/relic-buffs-design-note.md` + `docs/worlds/eternity-lore.md` (branch `design/worlds-vision`, Rev 110).
**Standing:** advisory only. No implementation, merge, or deployment authorized. The reviewer states it did not change any files, approve a merge, or authorize a build or deployment.

---

### Soumaya — Relic Buffs Design Review

Repository: `abelsvj-afk/Brain-Soumaya-V1` · Branch: `design/worlds-vision` · Review date: October 25, 2026

### Verdict: NOT READY

The note has a strong foundation, and many of its individual relic buffs have understandable lore connections. However, it is not ready to become an implementation contract.

The main blockers are the contradiction between the relic lore and the gate, an internally inconsistent jump-chain example, unresolved scarcity ownership, ambiguous buff stacking and server-side arithmetic, and a threshold example that reintroduces streak logic. Several proposed buffs also lack a clearly defined underlying mechanic.

### 1. Findings by severity

### Blocker findings

Blocker B-01

The Eternity gate contradicts the relic lore.

Design note §5; lore §6 and Appendix, Relic VII

Exact claims challenged:

* §5: "the gate to his world opens for a traveler holding the Witness Without a Name (the key) plus any two other relics."

* Lore §6: "These relics do not form a required set."

The lore explicitly says the relic register is not a required collection or completion target. The design note makes one relic mandatory and two others mandatory for access to Eternity. That is a significant change in the meaning of the relics, not merely a gameplay detail.

The two Eternity-associated relics also have no finalized in-world placement, so the required key has no settled discovery location.

Fix: Decide whether relics are narrative discoveries or mandatory gate credentials. Reconcile the lore and gate in both documents, and settle the key's placement before defining it as a required object.

Blocker B-02

The jump-chain rule is internally inconsistent.

Design note §5; §9 Q4

Exact claims challenged:

* §5: "You route through at least two intermediate worlds (e.g. Station → Deep Past → his world)."

* §5: "there is no direct jump to his world."

The example contains only one intermediate world: Station → Deep Past → Eternity. It does not demonstrate the stated minimum of two intermediate worlds.

There is a second problem: the gate and the route are underspecified. A traveler might collect the key and any two relics, then take whatever route happens to be available. Nothing defines eligible intermediate worlds, required route connectivity, or whether the traveler must discover the route.

Fix: Specify the exact minimum number of intermediate worlds, distinguish intermediate stops from total journey legs, and define valid route eligibility. Validate the rule against the actual world graph before implementation.

Blocker B-03

The scarcity model has no complete lifecycle for a relic copy.

Design note §4; §9 Q2 and Q6

Exact claims challenged:

* §4: "Every relic has a fixed number of copies universe-wide."

* §4: "A copy is claimed by discovery: the first traveler to find and inscribe it holds it."

* §4: "Copies never expire, never decay, never return for inactivity."

The note proposes two different allocation models:

* Station and Scale: seven copies of each relic universe-wide.

* Garden, Deep Past, People and Archive: one copy per brain.

* Eternity: three copies of each relic universe-wide.

The models can coexist, but ownership transitions are not defined. The note leaves transfers, deleted brains, and creator-account consumption open. These are not minor edge cases: they determine whether the stated copy counts remain true.

For example, if all seven Station copies are held and a holder deletes their brain, the note does not establish whether the copy is permanently gone, recoverable, or transferred. Permanently losing it can make scarcity progressively worse; returning it automatically can violate the no-loss rule.

Fix: Define a complete copy lifecycle, including creation, claim, transfer, brain deletion, account deletion, recovery, and creator testing. Specify whether private-world copies are instantiated per brain and whether their ownership persists independently of a brain's existence. No implementation should assume an answer.

### High-severity findings

High H-01

Buff stacking and trade-off exposure are not specified.

Design note §§1–3; §9 Q5

Exact claims challenged:

* §1: "A buff applies while the relic is held."

* §1: "a buff's cost is a trade-off the user chose when picking the relic up."

* §9 Q5: "can a user hold many relics at once (buffs stack)? Is there a limit on held relics?"

A user could potentially hold multiple relics that modify the same stat. For example, the Stillness Seal raises fuel regeneration to 5.0/hr, while the Hearth Ember lowers it to 2.5/hr. The note does not say whether effects stack additively, apply in a defined order, or conflict.

More importantly, choosing a relic's trade-off at pickup is not necessarily informed consent to an interaction that becomes apparent only after several relics are held.

Fix: Settle stacking, conflict resolution, equipment limits, and the exact before-pickup disclosure for combined effects. Define deterministic server-side calculations and ensure unequipping restores the correct underlying values without overwriting base mechanics.

High H-02

The tab-threshold example introduces streak logic.

Design note §6

Exact claim challenged:

"a goal attacked three days running"

The note also states in §1 that relics are never awarded by a streak and in §6 that thresholds never punish or gate access.

A three-consecutive-day condition is streak logic, even if it is described as a visible threshold rather than a streak counter. It also risks rewarding uninterrupted activity over ordinary progress, although a missed day must never cause loss or shame.

The other examples—such as a debt falling below a mark or a skill reaching a milestone—do not inherently require consecutive days.

Fix: Remove consecutive-day requirements or explicitly settle whether streak-based conditions are permitted at all. Thresholds should recognize progress without making an interruption a failure, reset, or disadvantage.

High H-03

The emotional-balance mechanic is not sufficiently defined to protect the no-punishment invariant.

Design note §§2, 3 and 6

Exact claims challenged:

* §3, First Light Shard: "emotional weight reads sharper — swings +25% while held."

* §6: "The mechanical expression proposed here is the Steadiness stat."

* §6: "what exactly emotional balance changes beyond Steadiness — the owner settles the shape."

Emotional weight already ranges from -1 to +1. Amplifying swings by 25% could push values beyond that range unless the implementation clamps them. The note does not establish whether it amplifies the raw signal, its rate of change, or its visual representation.

The distinction matters: amplifying a display effect is not the same as changing a user's underlying emotional state. A negative emotional signal must not become a source of lost access, degraded rewards, or involuntary consequences.

Fix: Define exactly what changes, preserve the valid range, specify the server-side transformation, and make clear that emotional state never alters access or the authoritative brain data. Settle the open question in §6 before treating Steadiness as an implementable stat.

High H-04

Several buffs do not map cleanly to a defined existing mechanic.

Design note §§2–3; lore §6

Exact claims challenged:

* Dawn Leaf: "partial milestones (25/50/75%) register toward the growth signal."

* Hearth Ember: "progress on people-tagged goals and relationships counts toward the growth signal."

* Sunward Compass: "emotional balance holds steady while traveling; transit does not swing it."

The existing growth signal is described as a 0–1 progress signal on goals and skills. The note does not establish that partial milestone events are currently recorded independently, that relationship progress has a normalized signal, or that transit currently modifies emotional weight.

The lore supports the themes, but a theme does not prove that the named operation exists in the application.

Fix: For each buff, identify the authoritative input, transformation, output, and existing mechanic it modifies. If the operation does not exist, mark it as a proposed mechanic requiring a separate design decision instead of implying that it already exists.

### Medium-severity findings

Medium M-01

Recall and Review are distinct names, but their operational boundaries are unclear.

Design note §2; §3, First Light Shard, Lantern of Keeping and Thread of Many

Exact claims challenged:

* §2 Review: "Tending memories" and "review strength gained per tend; link earnings."

* §2 Recall: "Old memories resurfacing" and "Deep Past rise window."

* §3 Lantern of Keeping: "a risen memory stays risen for the visit without being disturbed."

Review strength and resurfacing are conceptually distinct. Link earnings are also a distinct operation. But "stays risen for the visit without being disturbed" mixes a surfacing duration with a memory-interaction state that is not defined in §2.

Steadiness and Alignment are also conceptually adjacent because both are tied to emotional balance or closeness to Eternity, yet the note does not explain how threshold events contribute to Alignment without turning it into a score.

Fix: Give each stat one measurable responsibility and specify which mechanic consumes it. Define whether the Lantern affects a temporary presentation state, the rise window, or the memory itself. Keep Alignment's earning rules separate from emotional-state measurement.

Medium M-02

The scarcity counts do not yet define public-world availability or creator behavior.

Design note §4; §5; §9 Q6

Exact claims challenged:

* §4: "Station and Scale relics 7 copies each."

* §4: "Eternity relics 3 copies each."

* §5: "the owner's account has everything unlocked — every world, every relic, every gate — for testing."

"Everything unlocked" could mean the creator can inspect and equip a relic without claiming a globally scarce copy, or it could mean the creator actually owns a copy. Those interpretations have different effects on the available supply.

Also, fixed global counts require a defined scope: production universe, test environment, or each environment separately. Public-world relics cannot be reliably scarce if test accounts or resets can claim copies from the same pool unintentionally.

Fix: Define scarcity scope and separate creator testing permissions from ownership of scarce copies. Ensure test activity cannot silently reduce the production supply.

Medium M-03

Eternity-created worlds introduce unresolved authority and scope decisions.

Design note §7; §9 Q8

Exact claim challenged:

"Eternity will create new worlds over time, pertaining to individual persons' uses."

The section correctly says that guardrails are not yet designed. However, this is a major architecture boundary: who approves worlds, how personal worlds relate to shared space, and whether generated worlds can create new scarce relics are all unresolved.

The risk is not that the note pretends these decisions are settled—it explicitly marks them as open. The risk is treating the autonomous agent's future behavior as authorized before its permissions and resource limits are designed.

Fix: Preserve §7 as direction only. Before implementation, settle approval authority, world ownership, persistence and recovery, resource costs, and whether an agent-created world can alter global scarcity or gate routes.

### 2. Economy audit — calculate the actual impact

The current mechanics provided in the relay give us enough information to calculate the direct effects. These are mathematical consequences of the proposed values, not claims that the application has already implemented or tested them.

### Fuel and travel

### Fuel regeneration comparison

Assuming an empty fuel tank and constant regeneration, ignoring travel consumption.

| State          | Regen/hour | Theoretical fuel/day | Time to fill 200 fuel |
| -------------- | ---------- | -------------------- | --------------------- |
| Base           | 3.5        | 84                   | 57.14 h               |
| Hearth Ember   | 2.5        | 60                   | 80 h                  |
| Stillness Seal | 5.0        | 120                  | 40 h                  |

The cap is 200, so the hourly figures above do not mean a user can store more than 200 fuel. A 225 cap changes the time needed to fill the tank.

Fuel findings

* Harbor Nail — actually the Mooring Ring? The note's fuel-cap buff is assigned to the Harbor Nail, not the Mooring Ring. Harbor Nail's +25 cap changes capacity from 200 to 225: a 12.5% increase. At 3.5/hour, filling 225 from empty takes 64.29 hours, compared with 57.14 hours to fill 200. The extra capacity stores 25 additional fuel, equivalent to 2.5 warp costs.

* Hearth Ember: regeneration falls by 1 fuel/hour, a 28.57% reduction. Over 24 hours, that is 24 fewer fuel regenerated before accounting for the cap.

* Stillness Seal: regeneration rises by 1.5 fuel/hour, a 42.86% increase. Over 24 hours, that is 36 more fuel than baseline before the cap. From empty, the tank reaches 200 in 40 hours instead of 57.14 hours.

* Stacking risk: if the Hearth Ember and Stillness Seal stack additively as changes from baseline, the net rate would be fuel/hour. If the relics instead overwrite each other, the outcome depends on application order. The note does not settle this.

* Warp cost: none of the proposed relics explicitly reduces the 10-fuel warp cost. That is good for the principle that fuel should not buy access. But the gate and valid-route rules must not make fuel a de facto access barrier.

* Fuel cap and regeneration interaction: the cap increase and regeneration increase are not inherently an economy break. They are meaningful convenience buffs. Whether they create excessive travel requires the actual travel cadence and any other fuel sources to be accounted for.

### Drift and journey bonuses

| Mechanic                  | Baseline | Proposed buff | Change                       |
| ------------------------- | -------- | ------------- | ---------------------------- |
| Drift bonus               | +3       | +4            | +33.33% per qualifying drift |
| Daily drift cap           | 2        | 3             | +50% qualifying journeys     |
| Maximum drift bonuses/day | +6       | +12           | +100% daily maximum          |
| Warp journey bonus        | +5       | +5            | Unchanged                    |
| Warp cost                 | 10       | 10            | Unchanged                    |

The Mooring Ring's drift proposal doubles the maximum daily drift reward from 6 to 12. It preserves free drift and does not directly alter warp costs.

The existing eligibility rule of at least 30 seconds and at most two qualifying drifts per local day needs to be extended explicitly. Otherwise, changing the number to three in the design could be ignored by an existing server-side cap, or the client could display a reward the server refuses to grant.

Finding — Medium: §3, Mooring Ring. Define whether the increased cap is genuinely server-enforced, and clarify that the third qualifying drift is an additional permitted reward—not a requirement to travel more often.

### Review, Growth and Discovery

| Buff                                               | Proposed change              | Mathematical effect                                                   |
| -------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| First Light Shard                                  | Review strength +1           | Absolute increment; baseline value is unspecified                     |
| Harbor Nail / Stillness Seal / Unnumbered Fragment | Review strength −1           | Absolute decrement; could reach zero or below without a defined floor |
| Thread of Many                                     | Link earnings 2 → 4          | Doubles earnings per eligible link                                    |
| Unopened Fold                                      | Discovery earnings 4 → 6     | +50% per eligible discovery                                           |
| Growth trade-offs                                  | Progress accrues 25% slower  | Multiplier of 0.75 on the affected progress rate                      |
| Star Hanger                                        | Alignment accrues 25% faster | Multiplier of 1.25                                                    |
| Unnumbered Fragment                                | Alignment accrues 50% faster | Multiplier of 1.50                                                    |

The important distinction is that the absolute changes to Review strength cannot be fully evaluated without knowing the baseline and whether strength is bounded. A reduction of one unit could be negligible or could eliminate the benefit entirely.

The two earnings buffs are straightforward if their underlying events are already authoritative:

* Link earnings double from 2 to 4, a net increase of 2 per eligible link.

* Codex discovery earnings rise from 4 to 6, a net increase of 2 per eligible discovery.

If either can trigger repeatedly through retries, duplicate events, or repeated inscription requests, the buffs could magnify an existing exploit. The note's server-side rule is necessary, but event idempotency and eligibility must also be specified.

Finding — Medium: §3, Thread of Many and Unopened Fold. Settle the earning boundaries, valid ranges and duplicate-event behavior. The numbers themselves do not establish an economy break, but they amplify the effects of any weaknesses in the underlying earning system.

### 3. Lore-to-buff audit — all 15 relics

I checked the proposed buff against each relic's lore description and codex inscription in `eternity-lore.md`, §6 and the detailed relic register. The source lore itself is still draft material requiring owner approval, so these are assessments of thematic consistency, not declarations that the relics are canon.

| Relic                  | Assessment | Reason                                                                                                                                                   |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dawn Leaf              | Strong     | Growth without a required final form directly supports counting partial milestones.                                                                      |
| Witness Seed           | Strong     | Potential without a predetermined outcome supports widening Recall while reducing emphasis on completion.                                                |
| Mooring Ring           | Strong     | The freedom to pause without losing the road supports a more generous drift reward.                                                                      |
| Harbor Nail            | Partial    | Arrival and a home port fit greater travel capacity, but the 225 fuel cap is a gameplay translation rather than a direct lore consequence.               |
| First Light Shard      | Partial    | Evidence and the trace of light support stronger review. Amplifying emotional swings is a separate, weakly supported interpretation.                     |
| Basin Stone            | Partial    | Keeping uncertainty supports emotional ambiguity, but narrowing the Recall window is not clearly implied by the stone's waterline marks.                 |
| Lantern of Keeping     | Strong     | Making something present without forcing it into view fits gentle resurfacing. Slower Growth is less directly supported.                                 |
| Hearth Ember           | Strong     | Love living outside one mind supports progress on people-tagged goals and relationships. Lower fuel regeneration is only loosely connected.              |
| Thread of Many         | Strong     | Connection without merging separate lives fits link-related rewards. Narrower Recall is a weakly justified trade-off.                                    |
| Star Hanger            | Partial    | Giving stars their places supports perspective, but faster Alignment and slower Growth are not directly established by the hook-shaped relic.            |
| Sunward Compass        | Partial    | A fixed center with motion around it supports steadiness during travel. Reducing drift rewards is not clearly implied.                                   |
| Stillness Seal         | Strong     | Rest without erasure supports fuel recovery and is thematically consistent with the Archive.                                                             |
| Unopened Fold          | Strong     | Preserving without revealing supports discovery rewards only loosely; slower Growth is not a clear consequence of keeping something closed.              |
| Unnumbered Fragment    | Partial    | Refusing to assign an age fits Eternity's mystery, but faster Alignment and weaker Review are not clearly derived from the fragment itself.              |
| Witness Without a Name | Partial    | The boundary between a name and a thing supports the relic's thematic uniqueness. Its mandatory gate-key function is not established by the inscription. |

### What this means

The buffs are not simply random assignments to relic names. Several are thoughtfully derived from the lore. The weakest area is the trade-off design: the primary buff often fits the story, but the penalty appears to have been added to balance the gameplay rather than emerging from the artifact's meaning.

That is not automatically unacceptable. A trade-off can be a legitimate design choice, but it should be identified as a gameplay balancing decision rather than presented as though the lore proves it.

The strongest examples are Dawn Leaf, Witness Seed, Mooring Ring, Lantern of Keeping, Hearth Ember and Stillness Seal. The weakest trade-off connections are First Light Shard's emotional amplification, Basin Stone's narrower Recall, Thread of Many's narrower Recall, and Sunward Compass's reduced drift reward.

Finding — Medium: §3. Preserve the strong thematic links, but distinguish lore-derived effects from balance-driven trade-offs. Do not claim that every numerical consequence follows naturally from the lore.

### 4. Punishment audit

The note's stated principle is unusually clear: nothing decays, nothing is lost for inactivity, and emotional state never gates access. The proposed design mostly respects that principle, but there are several places where the implementation could undermine it.

| Mechanic                       | Risk                                                                | Finding                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Growth reduced by 25%          | Slower progress while holding a relic                               | Allowed only as an explicit, reversible trade-off—not as a hidden penalty or a forced consequence of finding a relic. |
| Fuel regeneration reduced      | Less fuel available over time                                       | A transparent trade-off is consistent with §1, provided fuel never becomes a barrier to accessing content.            |
| Emotional swings increased 25% | Negative emotional signals may be amplified                         | High risk until the transformation and its consequences are defined.                                                  |
| Three-day goal threshold       | Rewards uninterrupted activity                                      | Conflicts with the no-streak principle if consecutive days are required.                                              |
| Scarce relics never return     | A deleted brain or permanently unavailable holder may reduce supply | Unresolved lifecycle problem; scarcity must not silently become irreversible loss.                                    |
| Alignment and gate             | Emotional or progress thresholds could become access requirements   | The note says thresholds never gate access, but the gate and regular travel rules need a precise separation.          |

### Important distinction: voluntary trade-off versus punishment

The design note explicitly allows the user to accept a cost when equipping a relic. That means a reversible reduction in Growth or Fuel is not automatically a violation.

However, finding a relic must never impose its trade-off automatically. The note already says discovery alone is insufficient and inscription binds the buff, but it should be clear that the user is informed of the trade-off before activation and can decline to equip the relic.

Likewise, a negative emotional signal may influence a voluntary, non-access-related world effect, but it must never reduce the user's ability to use their brain, access memories, or reach content.

Finding — High: §§1, 3 and 6. Explicitly separate the optional gameplay effects from authoritative brain data and access permissions. Preserve the user's ability to opt out without losing the relic or its recorded discovery.

### 5. Stats audit — is the vocabulary clean?

The eight names are understandable, but they are not yet eight equally well-defined stats. Some are resources, some are event rewards, some are time windows, and others are conceptual signals.

| Stat       | What it really represents                    | Assessment                                                       |
| ---------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Fuel       | Resource with a cap and regeneration rate    | Distinct and measurable                                          |
| Drift      | Journey reward with eligibility rules        | Distinct, but the name could be confused with travel mode        |
| Review     | Tending strength and link earnings           | Combines two different operations                                |
| Recall     | Resurfacing window and presentation behavior | Distinct in concept, but multiple behaviors are grouped together |
| Growth     | Goal/skill progress signal, 0–1              | Distinct, provided relationship progress is explicitly defined   |
| Steadiness | Emotional-weight transformation or balance   | Not yet a clear, independent measurement                         |
| Alignment  | Progress toward regular travel to Eternity   | Distinct purpose, but its earning formula is unspecified         |
| Discovery  | Codex discovery earnings                     | Distinct, though the name describes an event more than a stat    |

The most important overlap is between Steadiness and Alignment. Steadiness describes emotional balance; Alignment describes closeness to Eternity's measure. The note proposes that emotional balance feeds Alignment through tab thresholds, but does not specify whether Alignment is earned from events, computed from emotional state, or both.

Review also groups review strength and link earnings together. They may belong under one player-facing category, but the server should treat their underlying calculations as separate operations.

Finding — Medium: §2. Retain the vocabulary if it helps the player understand the world, but document each stat's source, range, calculation, and consuming mechanics separately. A shared label must not imply that two different server calculations are interchangeable.

### 6. §6 and §7 — open questions versus hidden decisions

### §6: Emotional balance and tab thresholds

The section correctly marks the overall emotional-balance design as open. The problem is that it already proposes several concrete effects:

* Thresholds feed the mutating world.

* Thresholds feed Alignment.

* Thresholds can summon events, including a fleet.

* The example includes a three-consecutive-day goal condition.

* Emotional weight can change how the world behaves.

These are more than general direction. They establish a potentially broad event-generation system without specifying deduplication, frequency limits, or the difference between a threshold being met once and remaining true over time.

For example, a debt falling below a mark might remain below it for weeks. Does that generate one event or repeatedly summon events? Can editing a record cause the threshold to be crossed repeatedly? Can an event be generated from an inferred emotional signal that later changes?

Finding — High: §6. Before implementation, define event idempotency, threshold crossing semantics, repeat limits, and how corrections to brain data affect previously triggered events. The underlying brain remains authoritative; a world event must not rewrite the facts that triggered it.

### §7: Eternity-created worlds

This section is appropriately labeled as direction, not design. It does not authorize the agent to create production worlds, change shared routes, mint scarce relics, or consume resources.

The unresolved decisions are substantial:

* Who approves a generated world?

* Can a personal world become shared?

* Can an agent-created world contain relics that affect global scarcity?

* Can a generated world create or unlock a route to Eternity?

* What is the recovery behavior if a world fails to generate or becomes unavailable?

Finding — Medium: §7. Keep it explicitly out of scope for the relic-buffs implementation until those guardrails have their own approved design.

### 7. Cleared items — what held up

These points are sound in the current draft, subject to the remaining issues above.

* The brain remains authoritative. §1 correctly makes worlds a disposable layer and requires server-side buff arithmetic. The client should never independently award fuel, Growth, Alignment, or Discovery.

* Discovery is distinct from activation. Finding a relic does not automatically bind its buff. Requiring an inscription before activation is a clear, understandable rule.

* Trade-offs are reversible in principle. The idea that a buff's cost leaves when the relic is unequipped is compatible with the never-punish invariant, provided stacking and base-value restoration are defined.

* The fuel cap increase is modest. Moving from 200 to 225 is a 12.5% capacity increase, not an unbounded resource increase.

* The drift reward is transparent. The proposed +4 reward and three-per-day cap are easy to communicate. They preserve free drift and do not directly discount warp costs.

* Discovery earnings are mathematically straightforward. Moving from 4 to 6 is a 50% increase, provided eligibility and duplicate-event handling are correct.

* Several lore links are strong. Dawn Leaf, Witness Seed, Mooring Ring, Lantern of Keeping, Hearth Ember and Stillness Seal have clear thematic relationships to their primary buffs.

* The no-punishment constraint is explicit. §6 says inferred emotion changes weather, never geography, and emotional state never gates access. That is the correct boundary.

* §7 acknowledges its own incompleteness. It does not pretend that Eternity-created worlds have already been designed.

* The real-asset rule in §8 is clear. It is appropriately separate from the buff economy and should remain a standing art-quality requirement.

### 8. Required decisions before another review

I recommend resolving these in order rather than attempting to settle every number at once.

### Design completion checklist

0 of 8 reviewed as settled

Gate and lore — Reconcile the mandatory key with the lore's statement that relics are not a required set.

Jump-chain definition — Settle the number of intermediate worlds and define eligible routes.

Scarcity lifecycle — Define transfers, deletion, recovery, and creator-test isolation.

Buff application — Settle stacking, conflicts, equipment limits, and reversible base-value calculations.

Threshold safety — Remove or explicitly resolve streak-like conditions; define event deduplication and repeat behavior.

Emotional semantics — Specify the emotional-weight transformation and prevent it from affecting access or authoritative data.

Stat definitions — Separate the underlying calculations for Review, Recall, Steadiness, and Alignment.

Lore approval — Distinguish lore-derived effects from numerical trade-offs chosen for gameplay balance.

Final recommendation: keep the design note in draft. The core concept is promising, but the gate, scarcity lifecycle, stacking rules and threshold semantics need explicit decisions before the note can serve as a reliable implementation contract.

This is a design review only. I have not changed any files, approved a merge, or authorized a build or deployment.
