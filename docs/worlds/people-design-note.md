# Phase 3 · P3-3 Design Note — The People (third memory-bearing world)

**Status:** DRAFT — filed 2026-10-26 (Rev 122). **No build is authorized by this note.**
**What P3-3 is:** the third world that shows *memories* — the people they belong to. The Growing Place answers "what is it all adding up to?"; the Deep Past answers "what did I live through, and is it still mine?"; People answers "who is with me in this life, and what do we owe each other?" — by gathering: each person is a small system of their own, warm light with their shared memories, notes, dates that matter, and open threads orbiting it. Travel between people shows how relationships connect.
**Order:** People is next per D-23 (Growing Place → Deep Past → People → Scale → Quiet/Archive). P3-1 merged (D-63); P3-2 merged (D-71); P2-6 Station scale-up merged (PR #111, `661e2b52`); the worlds layer is ON (D-70) — P3-3 ships **visible**, not dark. There is no more dark shipping.
**Owner direction folded in:** the standing delegation (2026-10-25) — King makes the open design calls as if this were a real game; the recommendations below are those picks. Settlements are the owner's alone, by his own words or a widget tap.

---

## 1. Settled ground this note obeys

- **The recipe is not yet settled.** Form/palette/seed are proposed in §3.2 (`people / first-circle-1`); the recipe file (`recipe-people.md`) is settled with the owner before any build (see Q6). Until then, everything about look and feel in this note is a proposal.
- **Non-ranking rule, per visual channel (P3-1 precedent):** importance, review strength, progress, emotional weight, and degree must NOT drive cluster size, brightness, color, height, density, or orbit emphasis. A cluster's form says *what kind of thing it is* — never *how much it matters*. The count of memory-lights orbiting a cluster is a true count of linked memories — a fact, not a judgment — and is the only thing that varies between clusters.
- **§13 P3 surfacing:** a presence must be able to answer "why are you here?" — a cluster exists because the brain holds linked memories for that person; touching it shows the real thing.
- **§17 rail boundary:** world *structure* changes only through the propose→decide→apply rail — that rail is Phase 4. P3-3 therefore **renders** brain facts; it creates no world-side structural state of its own. Nothing is edited from People.
- **Never-punish / kindness rule:** no scores, no judgments, no "last contacted X days ago" counters, no red badges, no overdue states. A quiet cluster is a resting person, never a neglected one. Absence changes nothing.
- **Privacy:** People is PRIVATE (PUBLIC = Great Station + Scale only; PRIVATE = Deep Past, Growing Place, People, Quiet/Archive). Only the owner ever sees it. No visitors, no other travelers' ships, no NPC people.
- **The cross-phase invariant (P2-4):** nothing about a world may ever affect the ability to access memories, drift, or return home.
- **P4 archive invariant:** archiving removes a person from *every* surface — home, People, tours, resurfacing — including derived clusters and in-flight animations. The archive state wins, mid-flight.
- **Completeness principle (owner, 2026-10-25):** every world must be complete from every reachable angle. A camera that can reach a place must find it finished; an angle that cannot be finished must be unreachable.
- **NO UTC in anything user-facing, ever:** every date in People — dates that matter, open threads, anything dated — is shown in the viewer's own local time.
- **Name-bearing UI uses the brain's own chosen name** for each person — never a hardcoded label, and never a hardcoded "Soumaya" anywhere.

## 2. Recon facts (to be confirmed at build recon)

- Travel admits four worlds: server `TRAVEL_WORLD_KEYS = ["home", "great-station", "growing-place", "deep-past"]` mirrored by the client chart `WORLD_CHART`. Adding a destination is the known, small, two-sided change — the P2-2/P2-3/P3-1/P3-2 pattern.
- `WorldsSurface` is a scene registry keyed by the current world. People adds a fourth entry; the transit scene already serves all journeys.
- **The web client already loads the brain's graph** for the home galaxy: `getGraph()` → `GraphData { nodes, edges }`, plus `/graph/edges`. The People's clusters can derive from this same real data — **no new server surface is required for the evidence layer** (to be confirmed at build recon — the person model must be identified in the payload; see §3.3).
- **The brain already has relationships** — the owner keeps people in the app's relationships, and the graph carries person-linked memories. What counts as "a person" in the payload (person nodes vs. name mentions vs. relationship records) is the first recon question; the builder records it, and the eligibility contract follows from it.
- **No Phase 1 mockup exists for People** (unlike the garden and the Deep Past). The arrival vista in §3.2 is prose, not a proven scene — the build gate's device check matters more here than it did for P3-1.

## 2.5 The home galaxy vs People — same data, different question

The galaxy answers *"what do I know, and how does it connect?"* People answers *"who is with me, and what do we owe each other?"* — and it answers by gathering, not by a second truth:

| | Home galaxy | People |
|---|---|---|
| What it is | The brain, working — sky | A visit — among the people of a life |
| Space | Free 3D, bodies by mass, sun at center | A warm field of clusters, like lights in a neighborhood at dusk |
| What a node is | A star/planet/moon, brightness by review strength | A memory-light orbiting a person, form by kind |
| What a link is | A constellation line | A bridge of light between two people who share a memory |
| What a journey is | A hub in the sky | A shared chapter — visible as the bridges and lights it left behind |
| What you do there | Read, navigate, act (tools, chat, fleet) | Visit, remember, sit with people; nothing is edited from here |
| What it stores | The brain | Nothing — it re-reads the brain on every visit |

Guardrails: one truth, two arrangements (the garden's rule, applied here — People must never re-encode a galaxy signal differently); the world is a lens, not a second brain (delete a memory in the brain and its light is gone next visit); warmth vs sky is the identity — the galaxy is flown through, People is walked among. If the People scene starts to feel like a second galaxy — stars, orbits, a sun — the design is wrong.

## 3. Design

### 3.1 Travel extension
- Server allow-list gains `"people"`; the client chart gains the matching entry (name "The People"; blurb in plain language). Same economy: warp 10, drift free, bonuses exactly as P2-4 settled — **no economy change**.
- `WorldsSurface` registry gains the `people` entry. Title, close (view-only), credits, WebGL-failure honesty: unchanged behavior per world.

### 3.2 The People scene (product code)
- New modules beside the Station's, the garden's, and the Deep Past's: a layout module (deterministic cluster math under the recipe seed; budget constants **≤80 draw calls / ≤400k triangles planned**, test-asserted like `stationLayout`) and a scene module (warm cluster field, instanced memory-lights, shared-memory bridges, baked glow only, no post-processing, per the settled stack).
- **Arrival vista:** you arrive at the edge of a warm field — clusters spread before you like lights in a neighborhood at dusk. Each cluster is a warm central presence with its memory-lights in slow orbit. The field is walked among, not flown through at speed.
- **Camera:** arrival at the field's edge, clusters opening outward. Reduced motion: the field *held* — no orbit drift, no sway; information identical.
- **Placement:** deterministic seeded placement (mulberry32 over recipe seed + person id) — same person, same place, every visit, every device. No cluster is nearer, larger, or brighter for recency, importance, or any other rank.
- **Ships:** the traveler's own ship appears in transit as usual. A few small silent ships may drift outside the clusters as set dressing (P3-2 precedent). **No NPC people, ever** — a stranger standing in for a real person would be a lie in this space.

### 3.3 Content mapping — clusters, lights, bridges (the heart of P3-3)

**Eligibility contract.** A cluster exists for every person in the *eligible set*, defined exactly:
- **Eligible:** a person the brain knows with ≥1 linked memory (person node / relationship record with linked memories — the exact payload shape is the builder's first recon finding, recorded in the build record).
- **Excluded, deliberately:** people with no linked memories (nothing is invented — no cluster for a name alone); `status` archived (P4 — the archive wins everywhere); nothing else is excluded.
- **Counts reconcile against the eligible set, never against all graph nodes.** Exclusions are deliberate and testable: a test asserts the eligible count for a fixture graph and the cluster count equals it exactly.
- **Form by kind, never by rank:** a memory-light's shape says what kind of thing it is (memory / note / date / open thread) — never how much it matters. Cluster size, brightness, color, and height are identical across people.

**Clusters.** One cluster per eligible person: a warm central presence (the brain's own chosen name, in plain words beside it) with the person's linked memories as lights in slow orbit. **Dates that matter** (birthdays, anniversaries) rest in the cluster as quiet dates — in the viewer's local time, never a countdown, never a "missed" state. **Open threads** ("you wanted to tell her…") rest as quiet notes — reachable, never nagging, never badged, never dated as overdue.

**Bridges.** A memory shared between two people (or a confirmed link between their clusters) renders as a fine bridge of light between the clusters — travel between people shows how relationships connect. Edges with missing or excluded endpoints are **omitted**, never drawn to an invented endpoint. A person with no bridges stands alone, honestly — alone is not lesser.

**What a cluster shows, and what it never shows.** Shows: the person's linked memories, their dates, their open threads, their bridges. Never shows: a score, a judgment, a comparison, a "last contacted" counter, a contact suggestion, a feed of their activity, or anything the brain does not hold.

**Touching a presence** surfaces the person through the app's existing memory mechanisms (the same focus/citation path the galaxy uses) — reuse, never a parallel viewer. Touching a memory-light surfaces its memory the same way.

**Empty or young brain:** the field stands with its warmth and its empty ground — honestly unfilled, quietly lit. A brain with one person holds one cluster, warmly, not a locked door. People never fabricates a person to look fuller.

### 3.4 When a relationship changes in the brain

- **Added:** a new person with linked memories grows a cluster calmly on the next visit — a quiet arrival, no fanfare, no announcement.
- **Deepened:** new linked memories join the orbit as new lights. The cluster's form does not change — only the true count of lights.
- **Repaired:** when new memories reframe a relationship, the cluster holds the whole story — old lights and new lights together. There is no "repaired" badge, no before/after, no score that says better now. The story is the record.
- **Archived:** archiving a person (or their memories) removes the cluster from People entirely, quietly, on the next visit — and the archived material lives in Quiet/Archive, where it can be visited deliberately. Never deleted, never shown as loss, never an animation of leaving.
- **Data changes while visiting:** the world re-derives from the live graph on data change; a change mid-visit is a quiet re-derivation, never an animation of loss.
- **Long absence / bad week:** People is identical on return. Absence changes nothing — no dimming, no thinning, no "while you were away" state.

### 3.5 What People deliberately does NOT do

- **No relationship health score** (the §1C risk, named and refused — unless the owner explicitly wants it and designs it carefully, which this note does not propose).
- No judgments, no comparisons between people, no rankings of any kind.
- No social feed, no activity stream, no "what they've been up to."
- No contact suggestions, no reminders to reach out, no guilt mechanics of any kind.
- No messaging, no contact actions — People is a place to remember, not a place to act. Anything the owner wants to do about a person happens in the brain, not in the world.
- No NPC people, no invented people, no stand-ins.
- Nothing in People may ever affect access to memories, drift, or return home.

### 3.6 Loading, error, and staleness behavior (P3-1 precedent)

- **Graph load fails:** the world renders an honest error with a retry path — **never an empty field**. A failed fetch presented as an empty circle of people would be a technically plausible but emotionally misleading result, and it is forbidden by name.
- **Inconsistent data:** people with missing data are omitted, never ghosted; stale references are dropped from the render. If the data is unusable as a whole, the error state above applies.

## 4. Acceptance criteria (for the build, when authorized)

- **C1 Determinism:** same *logical* graph data → identical field layout. Canonical input ordering (nodes sorted by id ascending before layout), stable tie-breakers (tied timestamps → id), seeded placement (mulberry32 over recipe seed + person id), deterministic bridge routing (path derived from endpoint ids only). Tests: shuffled input order, repeated runs, tied timestamps.
- **C2 Traceability (identity-level):** every cluster carries its source person ID; every memory-light carries its source node ID; every bridge records its source edge IDs and both endpoint IDs. Tests assert identity correspondence — not just totals — including duplicate nodes, missing endpoints, and stale references.
- **C3 Kindness (review cases):** no rendering state represents decline, neglect, judgment, or loss — by construction (no such state exists in the scene's vocabulary) **and by review case**: long absence, bad-week use, archived person, reduced motion, empty brain, one person, a painful memory (enter and leave freely, no auto-pull). Absence never changes the world into a visibly worse state; accessibility preserves the same information.
- **C4 Budget — static and measured:** *Static:* layout/scene constants assert the proposed budget (≤80 calls, ≤400k planned tris). *Measured:* on a defined representative device (the owner's phone, per §11) with a defined graph size (including a large fixture) and the worst credible combined animation load, record actual draw calls, triangle count, cold-load time, average FPS, and 1%-low FPS. A constant passing is **not** described as proof of performance. A measured miss triggers optimization or a design return — never a silent relaxation of the limits.
- **C5 Flag-on behavior (no more dark shipping, D-70):** the world ships visible. The build verifies the world works with the flag on and the home galaxy and existing worlds are unchanged.
- **C6 Full gate:** complete suites + typecheck + production build, evidence stated exactly.
- **C7 Failure honesty:** a failed graph load renders the error/retry state, never an empty field; inconsistent data is omitted, never ghosted (§3.6). Tested with a failing fetch and a fixture containing missing endpoints.
- **C8 Empty/sparse fixtures:** zero people, one person, one memory, no bridges, no dates, no threads — each renders clear, gentle, honest ground with no fabricated content, no locked-door taunts, no misleading cues.
- **C9 Completeness (owner direction, 2026-10-25):** for every camera position the controls allow, the scene is finished. Any angle that cannot be finished is outside the allowed range, and the range itself is tested.

## 5. Open questions for the owner

- **Q1 Gate threshold.** Proposed: the People gate appears when the brain holds **≥3 people with ≥2 linked memories each, and ≥1 memory shared between two people** (so the space can show a connection, not just isolated clusters). For his brain the gate is already open in principle — six kids, a partner, two little brothers, two mothers, a father, and more are already in the record — the threshold is the rule for any brain, not a lock on him. Alternatives: (a) lower — 2 people × 2 memories; (b) higher — 5 people × 3 memories. What counts as "a person" in the payload is the builder's first recon finding either way.
- **Q2 Station connection.** Proposed: People **orbits the Station as a close moon** — a short hop from the Station (direct gate from the Station once discovered), plus a direct gate from home once discovered (D-10: direct world-to-world gates discoverable through use; the Station stays the guaranteed fallback route). Alternatives: (a) home-only gate, Station not involved; (b) People docks inside the Station (interior — future, not now).
- **Q3 Who counts as a person?** Proposed: every person the brain knows with ≥1 linked memory; people with no linked memories get no cluster. Should family groupings get any shared treatment — the kids as a circle, the brothers together — or strictly one cluster per person?
- **Q4 Archived people.** Proposed: archiving removes the cluster from People entirely; the material lives in Quiet/Archive for deliberate visits. Alternative: an archived cluster stays visible but stilled. (The P4 invariant says archive wins everywhere — this question tests whether "respectfully archived" means anything more than that.)
- **Q5 Other travelers.** Proposed: never — People is private by definition; no other real user's ship ever enters, and no NPC people ever stand in. Confirm?
- **Q6 Recipe.** Proposed form/palette/seed: warm clustered orbits, amber-warm light on dark, seed `people / first-circle-1`. The recipe file (`recipe-people.md`) is settled with the owner before build — confirm this palette, or name a different one?
- **Q7 Open threads and dates.** Proposed: shown as quiet notes/dates in the cluster, no badges, no overdue states, all dates in local time. Do you want open threads shown at all in the world, or should they stay in the brain only?

## 6. Sequencing & non-scope

- This note → review loop (ChatGPT + the cold-check findings, which may change this note) → owner's settlement of Q1–Q7 → recipe settled → owner's separate implementation word → build → full gate → owner's merge tap → post-merge audit. The lane that built Phase 2, P3-1, P3-2, and P2-6, unchanged.
- **Not in P3-3:** the §17 rail (Phase 4); Scale, Quiet/Archive; the Station interior (future); Eternity (other chat — already in code and in a mockup there; this chat does not design him); NPCs and the autonomous agent (separate design track — §16 fence); any change to the home galaxy; any change to the P2-5 gate caveat (stated, not re-litigated here).
- **No build is authorized by this note.**
