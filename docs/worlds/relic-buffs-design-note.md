# Relic Buffs — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-25, awaiting owner settlement. **No build authorized.**
**Revision (2026-10-25):** §6 extended with tab thresholds (owner's words) — every app tab carries plain, visible thresholds; meeting one feeds the mutating world, Alignment, and can summon events including a fleet (see `docs/worlds/fleet-defense-concept.md`).
**Source direction (owner, 2026-10-25, voice):** once relics are found and discovered, they give buffs to users. The buff must come from what the Lord is behind the object — the lore behind each artifact decides what its buff is. Buffs supply and complement the mechanics that are already established. Some buffs boost one stat and decrease another. There is a fixed, select number of each artifact in the whole universe — not every user gets every relic. Relics are also tied to reaching Eternity's world: certain ones unlock the gate to it. Travel to him is never direct — you jump through different worlds to get there (EVE-style jump chains). Eternity is autonomous, his own agent; you don't interact with him directly except when you discover him, and discovering him is meant to be really, really hard. The creator's account has everything unlocked for testing; other accounts earn it. Eternity will create new worlds over time, pertaining to individual persons' uses — guardrails for that are still to be figured out. Emotional balance (goals attacked, negative vs good memories, growth) is a candidate driver for game elements. Eternity's skills (e.g. a shield for a meteor shower) need REAL assets pulled in, not procedural stand-ins.

## §1 What a buff is

- A relic's buff activates when the relic is **found** in its world and **discovered** — inscribed to the user's codex. Finding without inscribing gives nothing; the codex inscription is the moment the buff binds.
- Buffs are **earned, never bought, never a score**. They are never sold, never traded for money, never awarded by a countdown or a streak.
- A buff applies while the relic is **held**. Holding is explicit: the user can set a relic down (unequip) and the buff leaves with it. Nothing silently decays, nothing is lost for inactivity, nothing shames. **The never-punish invariant stands over the whole system:** a buff's cost is a trade-off the user chose when picking the relic up, stated in plain language at that moment — never a surprise, never a decay, never a loss for a bad week.
- Buffs touch **only mechanics that already exist**. No new currencies, no new progression ladders, no experience points. The stats below are names for things the app already measures.
- All buff arithmetic is **server-side**. The client shows only what the server returns (the F-02 / GH-19 honesty rule: never celebrate unverified success).

## §2 The stats (PROPOSED vocabulary — owner settles names and numbers)

Each stat is one existing mechanic, renamed for the player. Numbers in §3 are starting values for settlement, not final.

| Stat | What it is in the app | Mechanic it touches |
|---|---|---|
| **Fuel** | Travel resource | Fuel cap (200), fuel regen (3.5/hr), warp cost (10) |
| **Drift** | Slow-travel reward | Drift bonus (+3) and its gate (≥30 s, ≤2 per local day) |
| **Review** | Tending memories | Review strength gained per tend — and, as a **separate server operation**, link earnings (EARN_LINK 2). The two share the player-facing label but are calculated independently. |
| **Recall** | Old memories resurfacing | Deep Past rise window (30 days), surfacing |
| **Growth** | Becoming | Progress signal on goals/skills (0..1) |
| **Steadiness** | Emotional balance | The emotionalWeight channel (-1..1) — steadied, never judged |
| **Alignment** | Closeness to Eternity's measure | What earns regular travel to him; never a score, never shame |
| **Discovery** | Finding and recording | Codex discovery earnings (EARN_CODEX_DISCOVERY 4) |

## §3 The fifteen buffs (PROPOSED — each derived from its lore)

**Lore vs balance (review 30):** each relic's **primary buff** is derived from its lore (see the lore hook quoted per relic). A **trade-off** is a gameplay balancing decision, not a lore consequence, unless the lore itself implies it — the note does not claim the lore proves every number. Where a trade-off is balance-only, that is the design, stated plainly.

**Garden**
- **Dawn Leaf** — *"not everything that grows must arrive at a final form before its growth matters."* **+Growth:** partial milestones (25/50/75%) register toward the growth signal; completion is not required for progress to count. No trade-off.
- **Witness Seed** — *"the thing that might become… possibility and growth share the same ground."* **+Recall:** the Deep Past rise window widens 30 → 45 days; dormant memories resurface more readily. **−Growth:** progress toward the growth signal accrues 25% slower (possibility over completion).

**Station**
- **Mooring Ring** — *"a place to pause is part of a journey."* **+Drift:** drift bonus +3 → +4, and the daily cap 2 → 3 per local day. Rest counts. No trade-off.
- **Harbor Nail** — *"a place of arrival without commanding anyone to remain."* **+Fuel:** fuel cap 200 → 225. **−Review:** review strength per tend −1 (arrivals pass through; tending earns a little less while it is held).

**Deep Past**
- **First Light Shard** — *"the difference between a thing and the evidence that the thing was present."* **+Review:** review strength per tend +1; evidence counts. **−Steadiness:** emotional weight reads sharper — swings +25% while held (first light is stark). **Clamp (review 30, H-03, proposed):** emotionalWeight always stays in [-1, 1] — the +25% applies to the swing's presentation only, clamped at the range edges, and never touches the authoritative brain data or access. A negative signal never costs access, rewards, or content.
- **Basin Stone** — *"its uncertainty is part of what survives."* **+Steadiness:** emotional swings from ambiguous/unreviewed memories are dampened by half. **−Recall:** the rise window narrows 30 → 20 days (uncertainty preserved — surfacing is slower).
- **Lantern of Keeping** — *"keeping need not mean disturbing."* **+Recall:** kept memories resurface gently — the rise window widens 30 → 45 days, and a risen memory's risen presentation holds for the visit (a temporary presentation state only — it changes nothing about the memory itself). **−Growth:** progress toward the growth signal accrues 25% slower (keeping over becoming).

**People**
- **Hearth Ember** — *"love given a place to live outside the mind that remembers it."* **+Growth:** progress on people-tagged goals and relationships counts toward the growth signal. **−Fuel:** fuel regen 3.5 → 2.5/hr while held (a hearth burns fuel to stay warm).
- **Thread of Many** — *"separate lights can still belong to a connected world."* **+Review:** link earnings EARN_LINK 2 → 4; connected memories review stronger. **−Recall:** the rise window narrows 30 → 20 days (connection over depth).

**Scale**
- **Star Hanger** — *"the moment the stars were given their places."* **+Alignment:** alignment accrues 25% faster; things in their place bring you closer to his measure. **−Growth:** progress toward the growth signal accrues 25% slower (perspective over progress).
- **Sunward Compass** — *"motion can exist around a fixed center."* **+Steadiness:** emotional balance holds steady while traveling; transit does not swing it. **−Drift:** drift bonus +3 → +2 (a fixed center wanders less).

**Archive**
- **Stillness Seal** — *"rest is not the same as erasure."* **+Fuel:** fuel regen 3.5 → 5.0/hr while held; rest restores. **−Review:** review strength per tend −1 (rest over tending).
- **Unopened Fold** — *"preservation is complete without its contents being revealed."* **+Discovery:** codex discovery earnings EARN_CODEX_DISCOVERY 4 → 6; the unrevealed rewards curiosity. **−Growth:** progress toward the growth signal accrues 25% slower (preservation over progress).

**Eternity**
- **Unnumbered Fragment** — *"the act of numbering had reached the edge of what numbers can describe."* **+Alignment:** alignment accrues 50% faster — the closest thing to his own mystery. **−Review:** review strength per tend −1 (what cannot be numbered cannot be reviewed).
- **Witness Without a Name** — *"a name is not the whole of a thing."* **+Alignment:** alignment accrues 25% faster. **No trade-off** — the only relic with none. It asks for nothing, not even a name, so it takes nothing. It is also a **gate key** (see §5).

## §4 Scarcity — a select number of each artifact in the whole universe

- Every relic has a **fixed number of copies universe-wide**, set by the owner. Proposed starting counts: Station and Scale relics **7 copies each**; Garden, Deep Past, People and Archive relics **one copy per brain** (they live in private worlds — each user finds their own); Eternity relics **3 copies each** (rarest, hardest world).
- A copy is **claimed by discovery**: the first traveler to find and inscribe it holds it. Holding is visible in the codex — who holds a copy is a fact, not a leaderboard.
- Copies **never expire, never decay, never return for inactivity**. A holder who goes quiet keeps their relic. (The never-punish invariant forbids taking a relic back for absence.)
- **Return to the worlds (owner's direction, 2026-10-25, his words: "like dragon balls"):** a copy **eventually goes back to a new place in the worlds to be found again** — never the same place twice ("never in one place," his reading to confirm). The universe stays findable: scarcity means few copies at once, not copies gone forever. **Trigger open (owner settles):** what sends a copy back — a holder releasing it willingly, a holder's brain being deleted, or something else. What it is NOT: inactivity — a copy never returns because its holder went quiet.
- Open: exact copy counts (owner sets); whether copies can be willingly passed to another traveler; the return trigger above; the copy's fate when its holder's brain is deleted — the copy must go somewhere honest, and the answer is the owner's.

## §5 Eternity's gate — relics as the way to him

- Discovering Eternity is meant to be **really, really hard** — the hardest thing in the universe to reach, like the Man-God in the light novel: very difficult even to figure out how to get to where he is.
- **Gate (PROPOSED):** the gate to his world opens for a traveler holding the **Witness Without a Name** (the key) plus **any two other relics**. The exact set is the owner's to settle.
- **BLOCKED — owner's call (review 30, B-01):** the lore says *"These relics do not form a required set. The register is an editorial record of possible discoveries, not a completion target."* The gate as proposed makes the Witness mandatory — a direct contradiction. Either the gate changes (relics stay narrative discoveries; the gate uses something else) or the lore changes (revise that line and settle the key's placement). Nothing in this section is settled until he picks one.
- **Jump chain (PROPOSED):** there is **no direct jump** to his world. You route through at least **two intermediate worlds** — three legs minimum (origin → intermediate → intermediate → his world), e.g. Station → Deep Past → Scale → his world. Each leg is a real journey — fuel, transit, arrival — not a menu teleport. (Review 30, B-02: the earlier example showed only one intermediate world and contradicted the stated minimum — corrected here. The example is illustrative only; which routes are eligible is Q4, and the rule must be validated against the actual world graph before implementation.)
- **Alignment** earns regular travel to him once the gate is open; it is never a score, never a threshold displayed as a number, never shame.
- **Creator unlock:** the owner's account has everything unlocked — every world, every relic, every gate — for testing. Other accounts earn it. The unlock is a property of his account, not a cheat code in the client.
- Eternity himself: autonomous, his own agent, his own skills. You do not interact with him directly — he does his own thing, stewards in good faith most of the time, watches everybody. Direct interaction happens only when you discover him, and only on his terms (he speaks rarely, on cosmic alignment).

## §6 Emotional balance and tab thresholds as drivers (owner's idea — OPEN)

- The owner's idea: an individual brain's **emotional balance** — whether they are attacking their goals, whether their memories run negative or good, whether they are growing — should drive game elements.
- **Tab thresholds (added 2026-10-25, owner's words):** every tab in the app (memories, goals, emotions and mental state, finances, and the rest) carries **thresholds** — plain, visible conditions the owner defines (e.g. a goal with three sessions logged, a memory carried with negative weight for a month, a debt falling below a mark, a skill practiced to a milestone). **No threshold is ever consecutive-day or streak-based** — a missed day is never a failure, a reset, or a disadvantage (review 30, H-02 — the earlier "three days running" example is removed for exactly this reason). Meeting a threshold **contributes to the worlds**: it feeds the mutating world (it grows over time, bigger and bigger), it feeds Alignment, and it can summon events — including a fleet (see `docs/worlds/fleet-defense-concept.md`). Thresholds are never hidden judgments and never gate access — they open opportunities, never close doors. **Event rules (review 30, §6):** a threshold crossing fires once per crossing, not repeatedly while the condition stays true; editing a record cannot re-fire an event for the same crossing; a world event never rewrites the brain facts that triggered it — the brain stays authoritative.
- The mechanical expression proposed here is the **Steadiness** stat (§2): emotional balance steadies or swings the emotionalWeight channel, and relics move it.
- **Hard constraint:** emotional state must **never gate access, never punish, never shame**. A hard week changes nothing about what you can reach. Per the settled mutation rule (D-14), inferred emotion moves weather, never geography. Any emotional-balance mechanic that gates, locks, or degrades access is out by design.
- Open: what exactly emotional balance changes beyond Steadiness — the owner settles the shape.

## §7 Eternity creates new worlds (direction, NOT designed)

- Eternity will create **new worlds over time**, pertaining to individual persons' uses — the universe grows beyond the settled roster (Station, Scale, Deep Past, Growing Place, People, Quiet/Archive, his world).
- Guardrails are **not yet designed**: what limits what he can create, who approves a new world, what it costs, how a world built for one person relates to the shared universe. This section records the direction only. A design note of its own follows when the owner asks for it.

## §8 Real assets for Eternity's skills (standing rule)

- Eternity's skills — e.g. putting up a shield for a meteor shower — use **real assets pulled in**, like the relic GLBs: measured, licensed, slimmed, render-checked.
- **No procedural stand-ins as final art.** A streak of light that is "supposed to represent" a meteor shower is a placeholder, never the shipped thing. Placeholders are labeled as placeholders until the real asset lands.

## §9 Open questions (owner settles)

- **Q1** Stat names and numbers: is the §2 vocabulary right? Are the §3 numbers too strong, too weak?
- **Q2** Copy counts: exact numbers per relic (proposed §4), and whether copies can be willingly passed.
- **Q3** Gate set: is Witness + any two the right key, or a fixed set?
- **Q4** Jump chain: two intermediate worlds, or more? Which routes count?
- **Q5** Trade-off rules: can a user hold many relics at once (buffs stack)? Is there a limit on held relics?
- **Q6** Creator unlock: does it cover relic copies too (does his holding a copy consume one of the scarce copies)?
- **Q7** Emotional balance: what does it change beyond Steadiness, within the §6 constraint?
- **Q8** Eternity-created worlds: what guardrails (approval, cost, scope)?
- **Q9 (review 30, B-01 — the gate fork):** do relics stay narrative discoveries (gate uses something else — alignment, the jump chain, a different key) or are they gate credentials (revise the lore's "not a required set" line and settle the Witness's placement)?

## §10 Acceptance (what "done" looks like when this builds)

- **C1** Every buff traces to its relic's lore in one sentence (the lore hook in §3).
- **C2** Buffs touch only the mechanics named in §2; no new currency, no XP, no leaderboard.
- **C3** Every trade-off is shown in plain language before the relic is picked up, and leaves when the relic is set down. No silent costs.
- **C4** Scarcity and the gate are enforced server-side; the client shows only what the server returns.
- **C5** No punishment path exists: no decay, no loss for absence, no emotional-state gating, no shame visual.
- **C6** Full gate (typecheck, server + web suites, production build) before any merge ask; merge is the owner's separate tap.

## Review 30 reconciliation (2026-10-25 — verdict NOT READY)

Full review: `docs/worlds/chatgpt-review-30.md`. The note stays in draft.

**Fixed in this revision (editorial corrections of the author's own errors — no new settlement):**
- **B-02:** jump-chain example corrected to two intermediates (Station → Deep Past → Scale → his world); eligible routes remain Q4, and the rule must be validated against the actual world graph before implementation.
- **H-02:** the consecutive-day threshold example ("a goal attacked three days running") is removed and replaced with cumulative examples; no consecutive-day condition exists anywhere in the note; event idempotency rules added to §6 (one event per crossing, no re-fire on edit, world events never rewrite brain facts).
- **§3:** lore-derived primary buffs vs balance-chosen trade-offs are now labeled explicitly — the note no longer implies the lore proves every number.
- **M-01:** Review is split into two server operations (review strength per tend; link earnings per link); the Lantern is clarified as rise-window / presentation only, changing nothing about the memory itself; Alignment's earning rules are kept separate from emotional-state measurement (see §2, §5).
- **H-03:** emotionalWeight is clamped to [-1, 1]; the Shard's +25% is presentation-only and never touches authoritative brain data or access.
- **§4:** the owner's Dragon Ball return rule is recorded — copies eventually go back to new places in the worlds to be found again, never the same place twice; the return trigger is open (see below).

**Awaiting the owner's settlement (nothing here is settled until he picks):**
1. **B-01 Gate vs lore** — the fork (Q9): (a) relics stay narrative, the gate uses something else; (b) relics are gate credentials, the lore is revised and the Witness's placement is settled.
2. **B-03 Scarcity lifecycle** — return trigger (what sends a copy back: willing release, brain deletion, or something else — never inactivity), transfers, deleted brains, creator-test isolation.
3. **H-01 Stacking** — additive vs order vs conflict, equipment limits, combined-effect disclosure before pickup, base-value restoration on unequip.
4. **H-04 Mechanic mapping** — the builder verifies at recon which buff operations exist (partial milestones, people-tagged progress, transit/emotion); any operation that does not exist becomes a separate proposed mechanic, not an implied existing one.
5. **M-02 Scarcity scope** — production vs test environments, creator unlock vs ownership of scarce copies.
6. **Q1–Q8 as written** — numbers, copy counts, gate set, chain length, held-relic limits, unlock scope, emotional shape, world-creation guardrails.
7. **Review-strength floor** — the ±1 review changes need a defined floor (review's economy audit).
8. **Mooring Ring drift cap** — the third qualifying drift must be explicitly server-enforced, and it is an additional permitted reward, never a requirement to travel more.
