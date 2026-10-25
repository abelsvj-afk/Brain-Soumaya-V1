# Design Exploration 1 — Many Spaces, Jump Gates, a World That Mutates

**Status:** Exploration only. Nothing in this document is decided.
**Revision:** 114 — **WORLD MAP Q1/Q3/Q6 SETTLED.** Owner (2026-10-25): the map may hint at Eternity's world, but the hint must not make finding him easy (exact form open); new worlds appear on the map only on first travel and discovery, never automatically when created; the button lives in the popup menu the app already has (builder confirms the exact menu at recon). Still open: Q2 (undiscovered worlds hidden vs unnamed "unknown"), Q4 (route history), Q5 (fuel cost display), Q7 (performance budget). (Rev 113: world map note drafted + Witness placement is a joint decision.)
**Date:** 2026-10-22
**Source:** Owner vision brief, 2026-10-22 (`vision-brief-2026-10-22.md`)
**App:** Soumaya Second Brain — home galaxy is live. This explores what lives *beyond* it.

Every idea below is a **candidate**. The owner settles each one in the design loop with ChatGPT. No candidate here authorizes code, a merge, a deploy, or a purchase.

---

## 0. The test every idea has to pass

The core stays a second brain. Scenery and travel exist to make remembering more alive, not to replace remembering.

For every space, gate, tour, and mutation, we ask:

1. **How does this help the user remember, revisit, connect, or act on what matters?**
2. **Would this still feel good after a hard week, a quiet month, or a long absence?** If not, it fails.
3. **Is any reward it implies real?** If the world hints at a reward, that reward must actually exist and be reachable.
4. **Is it compelling because it is valuable** — meaningful progress, useful reminders, real discovery, rhythms the user controls — **not because it pressures, shames, or tricks?**

If an idea cannot answer #1 clearly, it does not belong, no matter how cool it looks.

**Coordination note:** The other Soumaya chat is running the 48-surface audit program and the Money repair (ADR-019 design gate), and holds the standing backlog. This chat designs worlds only. Anything here that touches a shared system — how the galaxy is drawn, fuel, quests, the streak, notifications, Chronicle — is flagged **[RECONCILE]** and must be checked against the audit program before any future build. Both chats know about each other.

---

## 1. Candidate spaces — each tied to a second-brain job

The owner wants a few distinct spaces, not dozens. Different scenery, different purpose. Below are candidates to react to, combine, cut, or replace. None is decided. Names are working labels only — any name shown to a user in the app must use the brain's own chosen name where a name appears, never a hardcoded one.

### Candidate A — The Deep Past
- **What it feels like:** Older, quieter, dimmer light. Things drift slower here. Distance from the home galaxy is felt as time, not just space.
- **Second-brain job:** Long-term remembering. Memories the user has not touched in months or years live here in a way that invites gentle resurfacing — not as an alarm, but as a place to wander and rediscover.
- **What lives there:** Older memories grouped by era or season of life (drawing on Chronicle chapters). Forgotten connections the system has spotted. "On this day, long ago" moments, presented as places to visit, not pop-ups.
- **Risk to watch:** Nostalgia can tip into rumination. This space must let the user enter and leave freely, and never auto-pull them into painful material without their choice.

### Candidate B — The Growing Place
- **What it feels like:** A space that visibly builds over time. Sparse at first. New structures, light, and growth appear as real progress accumulates.
- **Second-brain job:** Aspirations and growth made visible. Goals, habits-in-progress, skills being learned, and milestones the user is working toward have a home that reflects *actual* progress, so returning shows change that is true.
- **What lives there:** One landmark per active goal or aspiration. Milestones as waypoints the ship can visit. A record of growth the user can tour to remember *why* they started.
- **Risk to watch:** If growth stalls, this space must not look broken, dead, or shaming. Stalled is a normal state — the space should hold what was built, warmly, without decay. See the mutation model in §4.

### Candidate C — People and Relationships
- **What it feels like:** Warmer, clustered, orbits within orbits. Each person is a small system of their own.
- **Second-brain job:** Remembering people well — who they are, what matters to them, what was said, what was promised, when you last connected.
- **What lives there:** A small cluster per important person: shared memories, notes, dates that matter, open threads ("you wanted to tell her…"). Travel between people shows how relationships connect.
- **Risk to watch:** Privacy and tone. This space is about care, not surveillance or scoring people. No "relationship health score" that could feel judgmental unless the owner explicitly wants it and designs it carefully.

### Candidate D — The Quiet / Archive
- **What it feels like:** Still, spacious, low stimulation. A place to put things down on purpose.
- **Second-brain job:** Intentional forgetting and rest. Memories the user wants kept but out of daily sight — finished chapters, painful-but-important records, reference material — live here, retrievable but not resurfacing uninvited.
- **What lives there:** Archived memories and closed chapters. Things the user has marked "keep, but quiet." A simple, respectful way back if they ever want one.
- **Risk to watch:** Archive must never feel like deletion or punishment. Moving something here is an act of care by the user, and the space should honor that.

### Candidate E — The Scale Space (see also §3)
- **What it feels like:** Vast. A sun that grows as you fly toward it, and keeps growing. Distances that take real time to cross. You may never arrive, and that is the point.
- **Second-brain job:** Perspective. A place to go when everything feels loud and close, to remember that a life is large, time is long, and single hard days sit inside a much bigger story.
- **What lives there:** Very little, by design — which is itself a design question (§3). Possibly: a small number of anchor memories placed at real-feeling distances, so crossing the space becomes a slow, reflective journey through a life.
- **Risk to watch:** Empty can feel lonely or broken on a phone. Scale needs sound, motion, and small discoveries along the way, or it becomes a loading screen with better PR.

### Candidate F — The Workbench / Inbox Shore
- **What it feels like:** Near, practical, well-lit. The closest space to home — less wonder, more clarity.
- **Second-brain job:** Capture and sorting. New memories, notes, voice dumps, and loose ends arrive here first, and the user (with the brain's help) decides what they become and where they belong.
- **What lives there:** Unfiled and recent captures. Gentle prompts: "Is this a memory, a task, a person-note, or done?" A satisfying act of sending something off to its proper space through a gate.
- **Risk to watch:** This can become a guilt pile if unfinished sorting accumulates visibly. Keep it forgiving: old unsorted items settle quietly, they do not pile up as warnings.

### Candidate G — Seasons / Chronicle Space
- **What it feels like:** A path, not a field. You travel *along* a life story, chapter by chapter.
- **Second-brain job:** Narrative remembering. Chronicle already turns a life into chapters and seasons — this space lets the user *travel* that story instead of only reading it, visiting the places each chapter happened.
- **What lives there:** Chapter landmarks in order, with the option to step off the path and explore freely. Tours (§5) often start here.
- **[RECONCILE]** Chronicle is a shared system under the audit program. Any design that changes how chapters are made or shown must be reconciled there first.

### Candidate H — The Great Station *(owner addition, 2026-10-22)*
- **What it feels like:** A real-deal, gigantic space station — EVE Online is the owner's touchstone. Not a planet with a ring: a structure so large the ship flies toward it for a long while, watching it grow, passing other ships arriving and departing, until it fills the sky. The owner is explicit: this station should be *bigger than the home galaxy's sun* — the sun as it exists today.
- **The approach is the experience:** A long, beautiful approach flight. Scenery along the way. Other ships on approach and departure lanes — whose ships, and what they mean, is an open question (ambient life? other memories in transit? the brain's own activity made visible?).
- **Docking / interior — later, not now:** Eventually, getting close enough should load the user *into* the station — an interior space of its own. The owner puts that in the future ("maybe not yet"). Phase one of this candidate is the station in space, and the approach.
- **Second-brain job — TO BE DETERMINED (owner + King + ChatGPT):** A station is naturally a hub. Candidate jobs to test: the brain's home port (where tours start and end, where arrivals — new memories, new people — come in); a social space (People, §1C, could orbit or dock here); the place where the ship is tended, upgraded, and reviewed; or the gateway hub where all jump gates anchor. None decided — this is one of the things the three of us must figure out, per the owner's instruction.
- **The scale tension, named honestly:** A station bigger than the sun breaks real-world scale — in reality no station out-sizes a star. The owner's own note: he may grow the sun over time, and he will "worry about realism more" later. So the design rule for now: **felt scale first, realism reconciled over time** — but the tension goes on the record so nobody designs as if it isn't there. If the scale space (§3) pursues honest scale, the station space may pursue awe scale instead. Whether those two can coexist is an open question for the loop.
- **Asset note:** The owner would love to find a free station model online that can be pulled in. That search belongs to the placeholder-asset strategy (§6) — license hygiene applies in full, and "gigantic" is a *felt* property (approach time, growth on approach, detail layers) more than a file property: a modest model, approached slowly with traffic and light, can feel enormous.

*Owner territory: which of these earn a place? Which merge? Which are missing entirely? The right number is probably 3–5 total spaces including home — small enough that each one feels distinct and cared for.*

---

## 2. Gates and transit — the design space

EVE Online is the touchstone: gates are places, travel is an experience, arrival feels earned by the journey — not by a grind.

### 2.1 What a gate is
Candidate models, none decided:

- **Gate as landmark:** A visible structure in the home galaxy (and in each space) the ship must fly to. Seeing it from afar builds anticipation.
- **Gate as threshold moment:** Passing through triggers transit. No menus mid-flight unless the user asks for one.
- **Gate as knowledge:** Some gates you can see before you can use them. Knowing *where* a space is and being *ready* to go there are different things — and that gap should feel like discovery, not a lockout.

### 2.2 How gates are found, opened, or earned
This is where reward honesty matters most. Options to explore:

- **Discovered:** A gate appears when the underlying second-brain material exists — e.g., the People space gate appears when the user has enough person-linked memories for the space to be worth visiting. The gate is not a prize; it is a truthful signal that there is something real on the other side.
- **Chosen:** The user simply decides to open a space. No earning at all. Travel itself is the experience.
- **Introduced by the brain:** The brain suggests a gate during a fitting moment ("There's enough here now to show you something"), and the user says yes or no. Suggestions must be dismissible forever, without penalty.
- **Never:** paywalled, streak-locked, or absence-punished gates. A gate must never close, decay, or move farther away because the user was gone.

**Open design tension:** "Earned" feels satisfying in games, but in a second brain, earning access to *your own memories* can feel wrong. The exploration question for ChatGPT: where is the line between satisfying discovery and gatekeeping a person from their own mind?

### 2.3 What transit feels like
The brief is firm: transit is a space you move in, not a cutscene or a plain loading screen.

Candidate elements:

- **Duration:** Short enough to stay practical on a phone (tens of seconds, not minutes), long enough to feel like *going somewhere*. Should duration vary by "distance" between spaces?
- **What the user does inside transit:** Steer gently, look around, pass real content — debris fields of loose notes? distant signals that turn out to be forgotten memories? — or simply watch the home space shrink and the destination grow.
- **What transit can carry:** A moment of useful reflection: one resurfaced memory, one question from the brain, one Chronicle line — offered, never forced. Transit as a natural pause between modes of remembering.
- **Exiting:** Can the user turn back mid-transit? Skip ahead after the first trip? Both should probably be yes — control stays with the user — but the first journey to a new space should feel special.
- **Accessibility and comfort:** Motion sensitivity matters. A calm / reduced-motion transit option is not optional polish; it is part of the design.

### 2.4 Fuel and shared systems
**[RECONCILE]** The ship already has fuel, a streak ember, and status displays in the home galaxy. Whether inter-space travel uses fuel, costs nothing, or uses something else entirely is undecided — and any answer must be reconciled with the audit program's findings on fuel before it is treated as settled. Under no design should a user be *stranded* away from their own memories for lack of fuel.
**Owner ruling (2026-10-22):** fuel-gated warp, **settled** in safeguarded form — warp costs fuel; coming home is always free; a slow free drift always exists and, with no fuel, it is deliberately slower and less entertaining than warp (§9.10). What *earns* fuel remains open (Q27), and the fuel economy itself is [RECONCILE] with the audit program.

---

## 3. The scale-space question

The owner's EVE memory: fly toward the sun and it grows. Distances read as vast. Symbolic scale (home galaxy) vs felt scale (somewhere else) is a deliberate contrast.

Questions this exploration poses, none answered yet:

1. **One destination, or a mode?** Is scale a single special space (Candidate E), or a "true scale" way of seeing that could apply in more than one place?
2. **What lives there besides scale?** Pure awe is a real function — perspective, calm, wonder — but a space visited twice and then never again fails the second-brain test. Candidates: anchor memories at vast distances, a place for the user's largest aspirations, a "one life, viewed whole" journey, real celestial bodies (see §6) placed at honest-feeling distances.
3. **Real content:** The brief asks for real celestial content where it can be pulled in — real asteroids, real bodies — instead of only invented ones. What does "real" add to remembering? Possibly: naming a real star or body after a moment, and knowing it actually exists, makes the memory feel anchored in the real universe.
4. **Phone reality check:** Felt scale on a small screen depends on motion, sound, haptics, and time more than on raw visuals. The design should name what carries the feeling, not just what it looks like.
5. **Never arriving:** If the sun can never be reached, say so honestly in the experience design — endless approach as meditation is beautiful; an implied destination that does not exist would break reward honesty.

---

## 4. The mutation model — a world that changes with a life

The heart of the vision: *the brain shapes the universe it lives in.* Memories (good or bad), the emotion in them, growth, aspirations, and how the user interacts with the world all change what the world looks like.

### 4.1 Signals in (candidates — what the world could listen to)

- **Memory volume and variety:** New memories, new kinds of memories, new connections between old ones.
- **Emotion in memories:** Warmth, grief, pride, calm, tension — as recorded by the user or gently inferred and *shown to the user for correction*, never silently assumed.
- **Growth and milestones:** Goals progressed, habits held, skills practiced, chapters closed, hard things completed.
- **Aspirations:** What the user says they are reaching for — the future pulling the world into new shapes, not only the past filling it.
- **People:** Relationships added, deepened, repaired, or respectfully archived.
- **Interaction patterns:** Where the user spends time, what they revisit, what they create vs. only consume.
- **Time and seasons:** Anniversaries, seasons of life (Chronicle), and rhythms in the user's own local time — never UTC in anything the user sees.

### 4.2 Visible changes out (candidates — what the user could see)

- **Light and color shifts:** A space warms as warm memories accumulate; a difficult season lends a space a quieter palette — *quieter, not darker-as-punishment* (see §4.3).
- **Growth of structures:** New landmarks appear for real milestones; the Growing Place (§1B) literally builds.
- **New connections made visible:** When the brain finds a link between memories, a path or bridge appears the user can travel.
- **Weather and atmosphere:** Gentle ambient change — drifting motes for unsorted thoughts, clear skies after a sorting session, aurora-like events for rare milestones.
- **Sound and music:** A space's ambient sound matures as its memories deepen.
- **New life in old places:** Revisiting an old memory that has gained new connections shows it changed — because the user's understanding changed.

### 4.3 The never-punish analysis (non-negotiable)

The owner's guardrail: **the world must never punish the user for a bad week or an absence.** Mutation is dangerous exactly here, so this section is a design gate, not a preference.

Failure modes to design *against*, explicitly:

- **Decay:** Nothing withers, dies, dims to shame, or breaks because the user was away or struggling. No wilting gardens of memory.
- **Loss:** Mutation never removes, hides, or degrades a memory or a place the user built. Change is additive or transformative, never subtractive without the user's own choice.
- **Shame visuals:** A hard season must not make the world look like failure. Difficult emotions can be honored — a grief space can be solemn — but solemn is not broken, and hard is not ugly.
- **Streak logic in disguise:** If missing days makes anything visibly worse, that is punishment by another name. It is out, however it is dressed. **[RECONCILE]** This touches the existing streak ember — reconciliation required.
- **Silent judgment:** The world must not imply a verdict on the user's life ("your universe looks sparse" = "your life is sparse"). Density is not worth.
- **Irreversibility:** If the world changes in a way the user dislikes, they need a way to understand why ("this changed because…") and, where reasonable, to adjust it. Mutation must be legible, not mysterious mood lighting imposed on a life.

Positive principles to design *toward*:

- **The world holds, it does not grade.** In a hard week, the world should feel like a place that kept your things safe — possibly quieter, possibly with a warm light left on — never like a place that noticed you failed.
- **Growth is celebrated when it happens, not demanded on a schedule.**
- **Return is always a good moment.** Coming back after any absence should feel like being welcomed, with something genuinely worth seeing — a resurfaced memory, a connection spotted while you were gone — because the brain kept working, not because the world missed you manipulatively.
- **Emotion changes tone, not value.** Every emotional register gets a beautiful, dignified visual language. Sad is not a lesser tier of the world.

**Test to apply to every mutation idea:** *Show it to a user in the worst week of their year. Does it comfort, hold, or at least stay neutral — or does it accuse? Only the first kind ships.*

### 4.4 Who controls mutation?
Candidates: fully automatic (the world simply reflects), user-tunable (intensity sliders, per-space choices), or user-confirmed (the brain proposes a change: "Shall I…?"). Likely a mix — ambient change automatic, landmark change proposed — but this is the owner's call, and it interacts with the established rule elsewhere in the app that the brain's proposals need a yes while the user's own commands act immediately.

---

## 5. Tours — directed travel from the focus state

The brief: when the ship is the focus, the user can direct her — click places and she flies there. Tours build on that directed travel.

### 5.1 Kinds of tours (candidates)
- **Brain-guided tour:** The brain authors a route — "Five places that show how this year changed" — drawing on Chronicle and connections. Each stop surfaces the memory *and why it was chosen*.
- **User-built tour:** The user picks stops, in order, and saves the tour — to revisit, or to mark an occasion (an anniversary route, a gratitude route).
- **Thematic tour:** All memories tied to a person, a place, a goal, or a season, visited as one journey — possibly crossing gates between spaces.
- **First-visit tour:** On first arrival in a new space, a gentle orientation flight — skippable, and never repeated unless requested.
- **Return tour:** After an absence, "while you were gone / since you were last here" as a short journey rather than a notification list.

### 5.2 Design questions
- Who is speaking during a tour, if anyone? (The brain's voice, captions, or silence with visuals?)
- Can the user break off mid-tour, take the controls, and rejoin? (Almost certainly yes — directed travel means the user outranks the itinerary.)
- How long is a tour? Phone-realistic: a few minutes at most, with save-and-resume.
- Do tours cross into notification territory? **[RECONCILE]** Notifications are a shared system under audit, capped and guarded. A tour is something the user starts in-app; it must not become a new pressure channel out-of-app.

---

## 6. Placeholder-asset strategy

The owner's plan: free/placeholder 3D content now, honestly framed; real produced content later when he has a computer and money. This phase fleshes out the design so there is something real to reach toward.

### 6.1 Principles (candidates)
- **Placeholders must be swappable 1:1.** Every placeholder stands in a defined "slot" — a gate, a landmark, a celestial body, a ship element — with a fixed size, position, and role, so real content replaces it without redesigning the space.
- **Coherence over quality.** A simple, consistent visual language (shape, palette, light) beats a mix of impressive but clashing free assets. Rules to settle: palette per space, silhouette style, how real vs. stylized each space leans.
- **Honest framing:** Placeholders are "player" content for this phase. Nothing in the experience should pretend a placeholder is final art.
- **License hygiene:** Only assets whose licenses allow this use, recorded in a simple register (asset, source, license, slot). No exceptions, even in the placeholder phase — swapping later is much harder if rights are murky.
- **Real celestial data where it helps:** Real bodies and asteroids (names, relative character) can anchor the scale space and the home galaxy's sky even in placeholder form, using simple geometry with real identities.

### 6.2 Candidate free sources (to verify in the design loop, not yet vetted)
- NASA 3D Resources (public-domain models of real bodies and spacecraft)
- Public-domain / CC0 libraries (e.g., Poly Haven for environments and textures, Kenney for stylized low-poly sets)
- Procedural generation (starfields, asteroids, nebulae made in-code) — zero license risk, perfectly coherent, and swappable by design
- Simple primitives, artfully lit — the cheapest coherence strategy of all, and often the most beautiful on a phone

*No source above is approved or purchased. The design loop should confirm licenses and fit before any of them is treated as the plan.*

### 6.3 Performance honesty
Placeholder worlds still run on the user's phone. Any design that assumes desktop-class rendering is not a design for this app. Frame budgets and a reduced-motion / performance mode belong in the design from the start, not as later fixes. **[RECONCILE]** Rendering performance is already an audited area in the repo chat.

---

## 7. Making each space actually look different — the scenery problem

The owner named this directly on 2026-10-22, and it is one of the hardest real problems in this design:

> In EVE Online and No Man's Sky, every space has different scenery — but those are built by teams of game designers and artists. Here it is one person plus coding help. And what each space will even *consist of* is not settled — the owner, King, and ChatGPT have to determine that together. The spaces cannot all be the same, cannot be bland, and cannot just repeat the home galaxy.

So this section is deliberately a *problem statement plus candidate methods*, not a solution. The loop (including a study pass over how EVE and No Man's Sky differentiate their spaces — what is actually replicable or adaptable, and what is team-scale art we must approximate differently) is part of the work.

**Axes along which spaces can differ (candidates — difference is cheapest when several axes move at once):**
- **Light:** color, direction, and mood of the main light source; how many light sources; how light changes as you move.
- **Palette & sky:** background nebula/starfield colors and density; fog and haze color; how "deep" the background feels.
- **Silhouette landmarks:** each space gets 1–3 unmistakable shapes (the Great Station, a ring, a shattered world, a forest of pillars…) readable from far away. One strong silhouette beats a hundred small props.
- **Motion:** what drifts, orbits, pulses, or stays eerily still; speed of ambient movement is a signature.
- **Density & scale feel:** crowded vs. empty; near-small vs. far-huge; approach times.
- **Sound:** ambient tone per space — the cheapest immersion axis of all, and it survives placeholder visuals.
- **Weather/particles:** dust, motes, ice, embers, rain-of-light — one particle character per space.
- **Ground rules of the space:** in one space things cluster, in another they line a path, in another they orbit a giant — arrangement is identity.

**Methods a solo builder can actually use (no art team):**
- **Procedural generation:** starfields, asteroid fields, nebula washes, rock/crystal formations made in code from per-space recipes (palette + density + motion + seed). Same engine, different recipe = genuinely different places, zero license risk, and it scales to however many spaces win a place.
- **Palette/light grading over shared geometry:** the same class of objects re-lit and re-colored per space can read as a different world — the film-set trick.
- **A small shared "kit" of forms** (pillars, rings, shards, spheres, arches) recombined per space at different scales and arrangements, swapped 1:1 later per §6.
- **One hero asset per space:** spend the single "find a good free model" effort where it defines the space (the station is the obvious first hero), and let procedural dressing carry the rest.
- **Real imagery for skies:** real space photography (public-domain NASA imagery) as distant backdrops can give "real space" feel that no low-poly model matches — while the near field stays simple geometry.

**What we must study before deciding (homework for the loop):** how EVE differentiates systems (nebula identity per region, gate/station silhouettes, lighting) and how No Man's Sky differentiates planets (palette + flora/fauna kits + terrain recipe) — with a replicability verdict per technique for a solo builder on a phone. Inspiration and method-mining, not copying.

---

## 8. Open questions — the owner's to settle

Crisp list. Each is a decision for Sajacous, explored with ChatGPT and King, settled by him alone.

**Spaces**
1. Which candidate spaces earn a place — Deep Past, Growing Place, People, Quiet/Archive, Scale, Workbench Shore, Chronicle Path — and which merge or get cut? What is missing?
2. How many spaces total (including home) is the right scope for the first designed version?
3. Does each space hold its *own* memories, or is one memory able to appear in several spaces for different reasons?

**Gates & transit**
4. How are gates found and opened — discovered, simply chosen, suggested by the brain, or some mix per gate?
5. Is there any "earn" mechanic at all, and if so, how does it stay honest and never lock a user out of their own memories?
6. How long is a transit, what does the user do during it, and can they turn back or skip?
7. Does inter-space travel interact with fuel at all — and if so, how is stranding made impossible? [RECONCILE]

**Scale**
8. Is the scale experience one destination space, or a mode that can apply elsewhere?
9. What lives in the scale space besides scale itself — anchor memories, aspirations, real bodies, or pure perspective?
10. Can the sun (or any body) ever actually be reached — and if not, how is that honesty designed in rather than discovered as a disappointment?

**Mutation**
11. Which signals should the world listen to first — emotion, milestones, connections, aspirations, interaction — and which should it *never* listen to?
12. What are the first three visible changes that prove mutation is real and valuable (not mood lighting)?
13. How automatic is mutation — fully reflective, user-tunable, or brain-proposes / user-approves — and per-space or global?
14. Does the never-punish analysis in §4.3 hold as written, or does the owner want any line moved? (Decay, loss, and streak-disguise are currently out entirely.)

**Tours**
15. Who authors tours first — the brain, the user, or Chronicle-driven system tours?
16. How long, how narrated, and how interruptible is a tour?

**Assets & build reality**
17. Which placeholder strategy leads: procedural, CC0 libraries, NASA real-body models, primitives — or a defined mix per slot?
18. What visual coherence rules (palette, silhouette, light) does each space follow so placeholders swap 1:1 later?

**Coordination**
19. Which of these designs touch shared systems (renderer, fuel, quests, streak, notifications, Chronicle) and therefore need reconciliation with the audit program before any build — and does the owner want a standing sync point between the two chats for exactly that?

**The Great Station (owner addition, 2026-10-22)**
20. What is the station's second-brain job — home port / hub, social space, ship-tending place, gate anchor, or something the loop hasn't named yet? (Owner + King + ChatGPT determine this together; nothing is presumed.)
21. The station is bigger than the current sun — felt scale now, realism later (the owner may grow the sun over time). Does the station live in its own space, in the scale space, or in/near home — and can awe-scale and honest-scale spaces coexist?
22. The other ships on approach and departure: ambient life, the brain's own activity, other memories in transit — what are they, and does the user ever interact with them?
23. Interior loading ("docking") is explicitly a later phase — what should the approach promise about it now so the future interior doesn't contradict the current experience?

**Scenery & contents (owner addition, 2026-10-22)**
24. What does each space *consist of* — its objects, landmarks, and contents — determined together by owner, King, and ChatGPT. No space's contents are settled yet, including the candidates in §1.
25. Which differentiation method leads for a solo builder — procedural recipes, palette/light grading, a shared form kit, one hero asset per space, real sky imagery — or what defined mix? And what did the EVE / No Man's Sky study pass find that is genuinely replicable at this scale?

---

---

## 9. Revision 2 — ChatGPT design review 1, absorbed (2026-10-22)

ChatGPT read the three pushed documents on GitHub and returned a full design review (record: `chatgpt-review-1-2026-10-22.md` in this folder). **Verdict: strong vision; design gate still open. Approved: continuing the exploration. Not approved: final architecture or any implementation plan.** Everything below is recorded as *recommendation and proposal* — none of it is settled. The owner settles each item.

### 9.1 The unique-outcome test (the review's central recommendation)
Define each space by its **unique user outcome**, not its visual theme. **Removal test:** if removing a space would not remove a distinct capability or meaningful experience, merge it or cut it — distinct scenery alone does not justify a destination.

Evaluation criteria proposed (not selections):
- **Deep Past** must justify: rediscover meaningful older memories
- **Growing Place:** see real progress toward aspirations
- **People:** remember people, commitments, shared history
- **Quiet / Archive:** keep information safely without unwanted resurfacing
- **Scale Space:** experience awe and gain perspective
- **Workbench Shore:** capture and organize incoming information
- **Chronicle Space:** explore the narrative of a life over time
- **Great Station:** undecided — must earn its place through a distinct function

Overlap warnings flagged: Deep Past ↔ Chronicle Space (both life history); Growing Place ↔ Scale Space (both growth/perspective); the Station could swallow everything if unconstrained; Workbench Shore may belong in the core app rather than as a separate world.
**Counterargument recorded:** atmosphere and exploration are themselves value — don't reduce every space to a productivity screen in a space costume. The review's resolution: require a distinct **emotional and practical** purpose, not a distinct data type.

### 9.2 The Great Station — refinements
- **The approach is the experience, not dead time before it:** visible growth on approach, traffic, lighting, changing silhouettes; a clear beginning, middle, and arrival — achievable with a modest model.
- **Provisional hub hypothesis (leading candidate, not a job):** home port — begin journeys, discover destinations, return to meaningful memories. **Counterargument:** a hub can become a glorified menu; if docking adds nothing beyond choosing a destination, the spectacle may not justify its cost. The purpose must be tested before any interior is designed. **Alternative hypothesis worth testing:** a place to review the overall *shape of one's life*.
- **Scale conventions separated:** perceived scale ≠ physical realism. Proposed rule: the station follows an **awe-scale** convention (fantastical, deliberate); environments built for astronomical scale follow a **reference-scale** convention; the same scene doesn't switch conventions without a clear reason. Any future change to the sun's size is a **separate decision**, not an assumed fix.
- **Interior:** promise only approach and destination now. Design the exterior/arrival so a future interior *could* attach without promising rooms or activities that don't exist yet.

### 9.3 Scenery — from ingredient list to a production method
The review judges §7's axes useful but not yet a reproducible method. Proposed: **one shared rendering system, distinct environment recipes** — never a new renderer per space. Each space's recipe has four parts:
1. **Identity** — palette, lighting, background, atmosphere, motion signature
2. **Spatial composition** — landmark silhouette, placement, density, distance cues
3. **Meaningful content** — real brain data (memories, relationships, milestones, connections) per the space's purpose
4. **Performance & accessibility** — frame rate, loading, memory, touch navigation, reduced-motion, tested on the actual target phone

Visual reference directions offered (references, not assets or palette commitments): Deep Past = sparse, slow, soft blue-violet, few prominent landmarks; Growing Place = constructed forms, connected pathways, landmarks appearing at real milestones, nothing decaying between them; Great Station = industrial and monumental, multiple scales of structure, approach lanes, traffic — identity carried by the station itself, not hundreds of bespoke objects.
**Validation gate proposed:** build **three environment mockups on the same system** before approving a larger roster. If three cannot be made visually distinct with a manageable rule set, more destinations multiply the problem.
**EVE / No Man's Sky study — required deliverable sharpened:** per technique — what it is, implementation cost, phone limitations, and the proposed Soumaya approximation. EVE: regional identity, enormous structures, gate silhouettes, approach/scale cues (adapt cues, not asset volume). NMS: palette + object-family + environmental-rule combinations producing variety (adapt the recipe approach, not the full procedural ecosystem). Warning recorded: random colors + random objects make *different* scenes, not *coherent* worlds — procedural variation must operate inside a deliberate identity with a recognizable landmark.

### 9.4 Mutation — tightened
Three categories proposed:
- **Ambient expression** — may respond to user-approved preferences and life context; must never imply success or failure
- **Structural change** — new landmarks/connections require a meaningful underlying event or a user decision
- **Memory content** — the user controls what is displayed, revisited, hidden, or archived

Plus:
- **Explainability is a requirement:** if a landmark appears or a palette shifts, the user can learn *why*. Emotion may inform an *optional* aesthetic expression; it must never dictate a judgment (sadness ≠ the world goes darker).
- **World state vs. presentation state:** world state (structures, places, progress) is stable and never silently erased; presentation state (light, atmosphere, ambient effects) may vary.
- **Mis-inference correction (new open problem, explicitly owned):** if the system infers an emotion or connection wrongly, the user can correct the interpretation — and correcting it must not destroy the underlying memory.
- **Counterargument recorded:** a world that never responds feels static. Answer: additions, new connections, user-directed transformations, and discoveries — meaningful change without decay.

### 9.5 Gates, travel, tours — refinements
- **First visit:** short, distinctive, skippable transit. **Repeat visits:** direct travel allowed, scenic journey optional.
- **Directed travel:** selecting a destination starts a clear route; user can interrupt or cancel at any time.
- **Discovery ≠ hostage-taking:** a gate may be *discovered* through exploration, but access to the user's own information must never depend on a gamified achievement.
- **Fuel:** must not be a prerequisite for accessing the user's own memories; any travel-cost design reconciles with the existing fuel system first. *(See §9.10 — the owner's fuel proposal arrived during this revision and is recorded against this line.)*
- **Reduced motion:** a genuinely comfortable alternative that preserves navigation and destination context — not a checkbox that strips all feedback.
- **Tours:** brain-generated, user-created, and Chronicle-based tours stay **separate candidate modes** until each proves value; every tour stop must explain **why it was chosen**, or a tour is an arbitrary slideshow.

### 9.6 Information model + coordination — strengthened
- **One canonical memory, many surfaces:** never duplicate a memory because it appears in another space. A memory is *surfaced* in multiple contexts under explicit placement rules (why it appears in each). Environments are visual representations of the brain's data, not separate sources of truth.
- Coordination table extended — required design agreements before build: renderer coexistence; navigation/focus between environments (leaving and returning); fuel (can travel ever prevent access?); Chronicle (read chapters without redefining them); quests/rewards (real, defined, reachable); streak/notifications (no new pressure disguised as mutation or tours); **memory persistence** (canonical, per above); **rendering performance** (new environments must not make existing navigation less responsive on the current phone).

### 9.7 ChatGPT's answers to Q20–25 — recorded as proposals
- **Q20 (station's job):** leading hypothesis = home-port/navigation hub (orient, launch, connect); alternative = life-shape review place. Ship management/social features only if a separate demonstrated problem demands them.
- **Q21 (where + scale):** station in its own environment, reached by directed travel from home; two scale conventions (awe vs. reference) kept explicit; exact location open until the travel map is agreed.
- **Q22 (other ships):** begin as ambient traffic (scale + life). Later, traffic *could* reflect real brain activity (a journey revisited, a memory being organized) — only if truthful and understandable. Do **not** make every ship an interactive character or a memory — state burden explodes.
- **Q23 (interior promise):** promise approach + destination only; exterior/arrival designed to not contradict a future interior; interior's activities undecided.
- **Q24 (contents):** decide via a **common per-space template**: unique purpose · what canonical information it surfaces · landmark & composition · how the ship enters/navigates/exits · what the user can do there · what changes over time vs. what stays stable · why it merits being a separate destination. Fill it in for every surviving space before architecture approval.
- **Q25 (method):** hybrid leads — procedural recipes + shared form kit + per-space light/palette + one distinctive landmark per space; free/public-domain assets selectively, license-checked; real celestial imagery/models selectively, not everywhere. Next research task = the EVE/NMS technique comparison (§9.3).

### 9.8 Settlement sequence (proposed order — later answers depend on earlier ones)
1. **Space roster & purpose** (incl. the Station's purpose)
2. **Information model** (canonical memories, placement, archive/privacy respect)
3. **Navigation & scale** (map, gates, transit, awe vs. reference conventions)
4. **Mutation & user control** (first meaningful changes, signals, explainability, safeguards)
5. **Visual production strategy** (EVE/NMS study, three contrasting mockups, recipe system)
6. **Architecture & roadmap** (shared-system dependencies, persistence, performance, testable tasks)
Counterargument recorded: visual exploration can *inform* earlier decisions — mockups are evidence for design, not permission to build production functionality.

### 9.9 Gate status after review 1
**NOT READY for final architecture or implementation. READY for the next design iteration.** Next revision focuses on: distinct purpose per space, the Station's role, the shared information model, and a feasible solo-builder visual system. Nothing in the review authorizes code, a merge, or a deployment.

### 9.10 OWNER ADDITION — fuel-gated warp (2026-10-22, during this revision)
The owner, thinking it through in the worlds chat: **"If Soumaya doesn't have fuel, she can't warp travel to these different places."** Recorded as the owner's proposed rule: **warp travel between spaces costs fuel; no fuel, no warp.**

**✅ SETTLED by the owner (2026-10-22, worlds chat):** the rule is adopted in its safeguarded shape — **warp costs fuel, but the user is never stranded: coming home is always free, and a slow free drift always exists.** The owner added the defining qualifier himself: *if you have no fuel, the drift is slower and less entertaining.* So fuel buys the full experience — speed, spectacle, the rich transit — while the free drift is deliberately plainer: slower, quieter, less to see. Access is never what fuel buys; quality of journey is. (One guardrail note, within the owner's own never-punish rule: "less entertaining" means plain and slow, never miserable or shaming — the drift stays dignified, comfortable, and reduced-motion friendly.)

The tension, named plainly (this is King's job in the loop, not a veto):
- ChatGPT's review (§9.5) and Exploration §2.4 both hold: fuel must never lock a user out of their own memories, and no one gets stranded.
- A strict lockout (no fuel = no travel, full stop) can satisfy both *only if* fuel is reliably earnable through ordinary use of the brain — otherwise a user in a hard week (little activity → little fuel → no travel → less activity) hits exactly the punishment spiral the never-punish rule exists to prevent.

Design shapes that could hold the owner's rule AND the guardrail — **candidates for the owner to settle, none decided:**
- **(a) Warp costs fuel; drifting is free.** Warp = the fast, full transit experience. Without fuel the ship can still *drift* — slow, quiet, free travel (itself a designed experience, perhaps the meditative mode). Fuel buys speed and spectacle, never access.
- **(b) Departures cost; coming home is always free.** You can never be stranded away from home or from your memories; the gate is on setting out, never on returning.
- **(c) Fuel as texture, not wall.** Warp costs fuel, but fuel flows generously from normal brain use (remembering, capturing, revisiting) — the gauge creates rhythm and a reason to tend the brain, while a zero-fuel state is rare and brief by design.
- **(d) Empty tank = an in-world moment, not a lockout screen.** Running dry triggers something kind: the brain offers a short route, a small real task, or a slow tow home — help arriving, not a door closing.
Combinations are allowed (e.g., a + b + c together).

Questions 26–28 — status after the owner's settlement:
26. ~~Does fuel gate departure only, or departure and return?~~ **SETTLED:** the return home never costs fuel. Nobody is ever stranded away from home.
27. **Still open:** What **earns** fuel — and can a user in a bad week still travel meaningfully (even if by drift)? Fuel rewards must be real (the app has a history here: Codex fuel rewards were once silently broken — reward honesty applies to fuel first).
28. ~~Is there always one free slow route (drift)?~~ **SETTLED:** yes — drift always exists when fuel is gone, and by the owner's design it is **slower and less entertaining** than warp. Warp remains the full experience; drift is the plain, free fallback that guarantees reachability.
**[RECONCILE]** Fuel is a shared system (gauge, Codex rewards, streak ember) under the audit program in the repo chat — any fuel-economy change reconciles there before build.

**Addendum (2026-10-22) — ChatGPT's fuel recommendation vs. the settlement:** ChatGPT ranked the same four options and recommended **A + D, with C as a supporting mechanic** (free drift; *guaranteed* empty-tank assistance as a safety guarantee, not an earned reward; fuel generously earned through ordinary use — no streaks, no exceptional productivity). It arrived *after* the owner's settlement, and the owner confirmed: **"Already decided on fuel." The settlement stands; nothing is reopened.** Mapping, for the record: **(i)** A = the settled drift; the owner's "slower and less entertaining" is the *meaningful difference in travel experience* ChatGPT itself prescribes — bounded by its caution that drift stay genuinely usable, never deliberately frustrating. **(ii)** C is recorded as the leading guidance for still-open Q27 (what earns fuel). **(iii)** D's guarantee is met in the settled shape by drift + the always-free return — no separate assistance mechanic is adopted; adding one later would be a new decision, not a pending one. **(iv)** ChatGPT's hard boundary is recorded as an explicit clause of the settled rule, consistent with it: **fuel governs warp, never access — the home galaxy and direct access to memories remain available regardless of fuel.**

---

---

## 10. Revision 3 — Gemini deep research 1, verified and absorbed (2026-10-22)

Gemini Deep Research returned a combined report for the three briefs (scenery study, asset hunt, celestial data). King verified the decisive claims against primary sources before absorption — full table, corrections, and critique in **`gemini-research-1-2026-10-22.md`**. Headlines: the ISS model's specs and Poly Haven's Boulder 01 check out exactly; HYG's CC BY-SA 4.0 checks out but Gemini's "it could force your app's source open" is **overstated and corrected**; its ESA/Hubble license is **corrected to CC BY 4.0**; the JPL API's no-embedding rule is **confirmed verbatim**; two shortlist entries (a museum ring, a molecule model) are **dropped as filler**. What follows is what the research changes in the design — all still proposals until the owner ratifies.

### 10.1 The technique stack (proposed answer to Q25)
The research converts Q25 from an open "which method?" into a specific stack, ranked by distinctiveness-per-cost, to be proven or broken by the three mockups (§9.3):
1. **Seeded palette math** — each space's identity (hue family → derived light/fog/material colors) computed deterministically from its seed. Same space, same look, forever; zero GPU cost. *(This is the NMS lesson, at phone scale.)*
2. **Instanced fields** — asteroids/debris/dust as instanced meshes: thousands of objects, single-digit draw calls.
3. **Palette-matched exponential fog** — atmosphere, depth cueing, and LOD pop-in hiding in one move.
4. **Dual-layer scale compositing** — background layer (sun, planets, distant landmarks at compressed scale) and foreground layer (ship, station, near objects at 1:1), depth cleared between. **This is how felt scale is rendered** — explicitly *not* a logarithmic depth buffer, which the research shows is a mobile performance trap.
5. **Real-data starfields** — shader point-cloud from real catalog data (§10.4), plus layered additive nebula planes tied to the space's coordinates, over a low-resolution equirect backdrop — *not* high-resolution cubemaps (VRAM blowout on phones).
6. **Silhouette landmark scaling + baked glow** — hero landmarks rendered large and simple against the sky; glow/occlusion baked into textures instead of post-processing bloom (a mobile fill-rate killer).
Explicitly **not replicable** at this scale (research-confirmed, agreed): real-time voxel terrain, raymarched volumetric clouds, multi-pass post-processing. Approximations above stand in for each.

### 10.2 Scale space — the implementation half is now answerable
The sun that "keeps growing as you fly toward it" lives in the background layer: its apparent growth is a designed approach curve, unconstrained by foreground depth precision — so *never arriving* (§3, Q10) can be a pure design choice, not a technical accident. The awe-scale vs. reference-scale conventions (§9.2) map naturally onto the two layers: reference-scale content lives by true numbers in the interface (distances, sizes), awe-scale content lives by felt size in the scene.

### 10.3 The Great Station — asset candidates, with King's dissent noted
Verified placeholder register (full terms in the research record): **NASA ISS** (public domain; 6,628 polys; GLB variant ~466 KB; textures must be audited and NASA insignia scrubbed before use) · **Poly Haven Boulder 01** (CC0; use a low LOD + 1K textures — the full model is 124K tris) · **Kenney kits** (CC0 as a publisher; exact kit/page confirmed at download time).
**King's dissent from Gemini's "clear winner":** the ISS is the efficiency winner but may be the *vision* loser — it is a recognizable real station with a thin truss silhouette, and the owner's touchstone is EVE's monumental fictional megastructures. New question:
29. **Station form:** (i) NASA ISS as-is, massively scaled; (ii) composite — ISS-derived core bulked out with modular kit parts until the silhouette turns monumental; (iii) ISS reserved for the reference-scale space (where *real* is the point) and a fictional megastructure silhouette for the Great Station space.
**✅ SETTLED by the owner (2026-10-22): option (iii).** The Great Station is a **fictional megastructure**, designed to deliver the monumental, awe-inspiring silhouette the vision calls for. The real ISS model is **reserved for the scale-focused space**, where its authenticity is an advantage. (Decision log: §11, D-2.)

### 10.4 Real celestial content — the minimal set, corrected
- **Stars:** HYG v4.2 (CC BY-SA 4.0 — confirmed; ShareAlike covers the *data file and its adaptations*, not the app) → brightest ~5,000 stars as a static data file shipped separately with attribution in credits; B−V color index drives true star colors.
- **Asteroids:** JPL Small-Body Database → queried **locally at build time only** (the API's fair-use policy explicitly forbids embedding it in a website — confirmed) → static JSON of 50–100 named bodies with real orbital elements.
- **Skies:** NASA imagery (public domain; choose insignia-free) and ESA/Hubble imagery (**CC BY 4.0** — visible credit required, no ShareAlike) as backdrops; per-image terms checked at selection time.

### 10.5 What this does to the plan
- Q25: **✅ CONDITIONALLY RATIFIED by the owner (2026-10-22)** — the §10.1 stack is ratified *conditional on passing the three-mockup test* under the acceptance criteria defined in §11.2–11.3. The test remains an **open acceptance gate**; the stack is **not implementation-approved**. (Decision log: §11, D-3.)
- The three-mockup validation (§9.3) gains hard constraints: built under the §10.1 stack, draw-call discipline, on the owner's actual phone.
- Gate status unchanged: **NOT READY for final architecture or implementation. Ready for the next design iteration** — now with a costed, verified method for the scenery problem.

---

---

## 11. Decisions log + the three-mockup acceptance gate (owner decisions, 2026-10-22)

**Scope of every decision below: the Worlds Vision design phase only. No code, merge, or deployment is authorized by any of them. The design gate remains OPEN.**

### 11.1 Decisions log
- **D-1 — Fuel (settled 2026-10-22, §9.10):** warp costs fuel; coming home is always free; a slow free drift always exists and, with no fuel, is slower and less entertaining. Fuel governs warp, never access to memories. Q27 (what earns fuel) remains open.
- **D-2 — Q29, Great Station form (settled 2026-10-22):** **Fictional megastructure** for the Great Station — a designed silhouette delivering the monumental, awe-inspiring presence the vision calls for (EVE is the touchstone, not a copy). The **real NASA ISS model is reserved for the scale-focused space**, where authenticity is the advantage. Rationale (owner's decision, King's dissent in §10.3 aligned): the ISS wins on efficiency but its recognizable real-world identity and thin truss silhouette fight the fiction and the monumentality; in the scale space, "this is real" is precisely the emotional payload, so the ISS earns more there.
- **D-3 — Q25, scenery technique stack (conditionally ratified 2026-10-22):** the §10.1 stack — seeded palette math, instanced fields, palette-matched fog, dual-layer compositing, HYG stars, baked-in glow — is **ratified conditional on passing the three-mockup test** defined below. Pre-test requirement (owner's): the performance and visual acceptance criteria are documented **before** any test runs (§11.2–11.3). Until test results are reviewed, the stack is a ratified *hypothesis*, **not implementation-approved**.
- **D-4 — Roster (settled 2026-10-22, as proposed in §12):** six destinations beyond the home galaxy — **the Great Station, the Scale Space, the Deep Past, the Growing Place, People, the Quiet/Archive** (Archive built last) — seven worlds including home. **Settlement step 1 is CLOSED.**
- **D-5 — Great Station purpose (settled 2026-10-22, as proposed):** **home port** — orientation, departure, and discovery of destinations; it surfaces journeys and routes, not memories, and takes on no social/ship-upgrade duties without a separately proven need.
- **D-6 — Dispositions (settled 2026-10-22, as proposed):** **Chronicle Path is a guided mode of the Deep Past**, not a separate destination. **Workbench Shore is cut as a space**; capture/sorting stays in the core app, with the "send a sorted memory through a gate to its space" moment preserved in the capture flow — which makes that moment an animation-gate item (§14).
- **D-7 — Deep Past membership (settled 2026-10-22, as recommended):** an **explainable rule combining age with meaningful resurfacing context**, with user controls — never a silent fixed threshold, and nothing is classified as forgotten merely because it is old (§13).
- **D-8 — Anchors (settled 2026-10-22, as recommended):** an anchor is a **confirmed cross-space appearance** — the memory's primary home stays wherever it is; anchoring never forces a relocation (§13 P5).
- **D-9 — People clusters (settled 2026-10-22, as recommended):** clusters exist **only for user-confirmed significant people** (or people the user explicitly chooses to surface); ordinary mentions never auto-create a prominent relationship presence (§13 P3). **Settlement step 2 is CLOSED** (P1–P7 as revised in Rev 7, the Operations trio, D-7/D-8/D-9).
- **D-10 — Direct gates (settled 2026-10-22 by the owner's explicit decision):** **option (ii)** — direct space-to-space gates may be **discovered through use**; the Great Station route **always remains available** as the universal fallback (§15 N1/N4).
- **D-11 — Transit duration (settled 2026-10-22):** 10–20 s (short hops) and 30–60 s (long legs) are **upper targets to test, never compulsory waits**; travel is **skippable after the first traversal** of a route (§15 N2).
- **D-12 — Transit activity (settled 2026-10-22):** **look-and-tend only** for MVP — no chores, no sorting queue, nothing that can obstruct arrival (§15 N2).
- **D-13 — Home sun (settled 2026-10-22):** **deferred** — no size change committed; relative appearance is assessed visually alongside the Station mockup (§15 N5). **Settlement step 3 is CLOSED**, with §15's safeguards standing unchanged (cancel / turn back / return home, cargo integrity, utility-first principle). This settlement is a design decision, **not** implementation authorization.
- **D-14 — Presentation bounds (settled 2026-10-22, as recommended):** M2's tightened boundary stands — presentation flows only within the established recipe, bound by the four safeguards (no hidden structural effects; explainable; reversible and controllable; never-punish), and **rewriting a saved tour/chapter sequence is structural**, not presentation (§17 M2).
- **D-15 — Proposal cadence (settled 2026-10-22, as recommended):** proposals are **batched into a calm review moment** — no interruptions, no urgency, no approval from silence; approve / edit / reject / defer; under cap pressure they wait quietly, never discarded, never forced (§17 M1).
- **D-16 — Undo horizon (settled 2026-10-22, as recommended):** **no time-based permanence**; undo works through **dependency-aware compensating entries** — never a blind snapshot restore, never a silent overwrite of newer work; conflicts are explained and resolved by the owner (§17 M1).
- **D-17 — The log's home (settled 2026-10-22, as recommended):** **both doors, one record** — on-demand explanations at the point of use plus a browsable "World Changes" view over the same append-only log; the view is a reference/control surface, not a notification stream (§17 M6). **Settlement step 4 is CLOSED** (M1–M6 as revised in Rev 12, D-14–D-17).
- **D-18 — Distinct / one universe (settled 2026-10-22, as recommended):** distinctness lives in each world's palette, composition, silhouette, lighting, and recipe; cohesion lives in what travels and recurs (ship, gates, UI voice, memory identity, carry/place grammar) — and **cohesion is tested in the blind review** alongside distinctness, never assumed and never bought by making worlds look alike (§18 V4).
- **D-19 — Mockup build order (settled 2026-10-22, as recommended):** **Station → Growing Place → Deep Past**; a failed mockup **stops the sequence** and is diagnosed (stack / recipe / animation load / implementation) before anything proceeds; thresholds are never lowered to obtain a pass (§18 V3).
- **D-20 — Session script (settled 2026-10-22, as recommended):** the §18 V2 script stands — shared core, signature sequence per mockup, **travel-guarantee checks included** (return + identity/home verification, cancelled departure, mid-transit turn-back, zero-fuel free return in the harness), behavioral results recorded separately from the visual/performance gates; reduced-motion runs held to the same bar.
- **D-21 — Recipe-first (settled 2026-10-22, as recommended):** **all three environment recipes are settled on paper before any mockup build is authorized**, each carrying the §18 minimum contents; recipes are the traceability reference and may be revised only through this design process. **Settlement step 5 is CLOSED.** Closing step 5 does **not** authorize mockup construction (§18).
- **D-22 — Roadmap (approved by the owner in his own words, 2026-10-22: "I approve Q-A1–Q-A4 as recommended"):** the **five phases of §19 A3 stand as written**; each phase requires its **own explicit authorization** — approval of one phase never authorizes the next.
- **D-23 — Space order (approved 2026-10-22, same act):** **Growing Place → Deep Past → People → Scale Space → Quiet/Archive**; Quiet/Archive remains last (§19 A3, Phase 3).
- **D-24 — Scope (approved 2026-10-22, same act):** this design's architecture assumes a **private, single-user brain**; security remains mandatory in full; any future multi-user support requires a **separate design effort** (§19 Q-A3).
- **D-25 — Fuel earning (approved 2026-10-22, same act):** **Q27 is deferred to the mandatory Phase 2 planning gate**, its **[RECONCILE]** flag preserved; the shared gauge, quests, and reward economy are reconciled with the audit program before any fuel behavior is implemented (§19 A4). **Settlement step 6 is CLOSED — and with it, the full settlement sequence (steps 1–6) is complete.** The design gate remains **OPEN**: Phase 0 recipes, the separately-authorized mockups and their review, and the owner's explicit gate closure still stand between here and any implementation planning (§19 A5).
- **D-26 — Phase 0 complete (owner settlements, 2026-10-22):** all three environment recipes are **settled on paper** — Great Station (R-S1–R-S4: form/palette/rotation approved, name deferred), Growing Place (R-G1–R-G4, landmark grammar with the non-ranking constraint), Deep Past (R-D1–R-D4, depth semantics with the chronological-monotonicity constraint). **A21 (Chronicle descent) and A22 (resurfacing rise) are ratified into the §14 inventory** as part of the Deep Past settlement. **Phase 0 is COMPLETE.** What remains before the design gate can close: Phase 1 mockups (**separate owner authorization, not yet given**), their §11 review (incl. the D-13 sun evidence), and the owner's explicit gate closure (§19 A5).
- **D-27 — Phase 1 AUTHORIZED (owner, 2026-10-22, explicit):** throwaway mockup construction under D-22, **only**. Scope limits stated by the owner: **not** product implementation, **not** merging, **not** deployment, **not** later phases. **Execution order:** (1) Great Station — collect D-13 sun-vs-station evidence at matched stages; (2) Growing Place — only after the Station passes its fixed gates; (3) Deep Past — only after Growing Place passes; tests the full A1–A3 chain and A21/A22. **Binding conditions:** grade against the **unchanged §11 criteria**; labeled fixture data only; proof-scenes disposable; record exact test environment, performance results, reduced-motion behavior, and visual outcomes per mockup; **any failure stops the sequence for diagnosis — thresholds are never lowered to force a pass**; the **design gate stays open** until results are reviewed and the owner explicitly closes it. **Builder's first act (owner-directed):** read the governing architecture/design documents, the current project state, and the Phase 1 task brief (`phase-1-builder-brief.md`) before beginning the Station mockup. Execution status is recorded in the mockup result records (brief §5) and summarized back into this register.
- **D-29 — Growing Place PASSED by the owner (owner, 2026-10-22, explicit: "Pass. Lets move on"):** given after the owner ran the scene hands-on on his phone (full scene visible, controls functional) — **V6 satisfied by the owner's word**. The formal §11 measurement evidence (captured 300 s block, stills, soak, RM block, environment record) was not captured and remains outstanding on the Growing record; following the D-28 posture, the pass is the owner's hands-on judgment and converts no P-criterion into an evidence-pass.
- **D-30 — Deep Past testing WAIVED; mockup kept as built (owner, 2026-10-22, explicit):** the owner directed that the last mockup skip testing entirely ("take all you've learned and skip this last mockup as far as testing it — I believe you built it; we're keeping it, just not testing this mockup"), citing impatience with the mockup phase. The scene was completed (its interaction half was finished at his word), syntax-validated, and filed at `docs/worlds/mockups/deep-past/`; it was **never run** — no sandbox smoke, no device session — and **no §11 status is claimed for it** (record: `mockup-result-deep-past.md`). D-30 waives the testing; it manufactures no results. **Phase 1 mockup construction is thereby COMPLETE**, with the trio's mixed evidence states recorded as-is (Station: device-graded, P3 waived; Growing: owner-passed; Deep Past: built, unevaluated). The design gate remains OPEN — its closure, the Station's V6, the D-13 sun question, and the D-3 stack verdict remain the owner's calls, and Phase 2 still requires separate authorization.
- **D-31 — DESIGN GATE CLOSED (owner, 2026-10-22, explicit: "Close the design gate too — phase done"):** the Worlds design phase and Phase 1 are **done**. The four calls reserved to the owner are disposed of by this closure, each recorded as it actually stands: **(1) Station V6** — no separate V6 word was given; it is resolved by this closure on the D-28 basis (device session 1 run by the owner himself, P3 diagnosed/fixed/reviewed), *not* as an independent per-mockup verdict. **(2) D-13 (home sun size)** — closed with **no change**: the deferral's standing default; sun + station shared a frame in the mockup evidence and no owner verdict for a change was ever given; the evidence stands in the records if Phase 2 planning ever reopens it. **(3) D-3 technique stack** — the conditional ratification stands as adopted for Phase 2 planning on the trio's mixed evidence exactly as recorded (Station device-graded · Growing owner-passed · Deep Past untested by waiver) — adopted, with the caveats visible, not laundered into a clean sweep. **(4) All other outstanding evidence items** (Station stills/recording/soak/RM block/environment record, Growing's formal measurement block, the Rev 37 cold-load figure) remain outstanding *as evidence* — the closure ends the phase that would have gathered them; it converts none of them. **What closure does NOT do:** it does not authorize Phase 2 — implementation (travel skeleton + Great Station) still requires the owner's separate authorization, with **Q27 (what earns fuel) settled at its mandatory planning gate** and the [RECONCILE] items cleared against the repo chat's audit program before any build.
- **D-35 — P2-2 IMPLEMENTATION AUTHORIZED (owner, 2026-10-22, explicit: "Implement"):** the server journey ledger exactly as designed in `phase-2-p2-2-design-note.md` (Rev 51 form, after reviews 20–21), built in the default lane (build → full gate → the owner's merge tap → post-merge audit). **Not authorized:** merging (his tap), deployment, flag activation, P2-3/P2-4, Phase 3.
- **D-36 — P2-2 MERGED (owner, 2026-10-23, explicit: "Merge PR #95 now"):** after the review-24 acceptance at `519b740`, the owner authorized the merge; PR #95 merged as **`94f2817`** and the merged files were verified byte-identical to the accepted build. **Not authorized by the merge:** deployment, flag activation, P2-3, P2-4, Phase 3. Next per the lane: the post-merge audit.
- **D-71 — BUILD AUTHORIZED (owner, 2026-10-25, explicit: "Lets start building all of this.").** P3-2 Deep Past and P2-6 Station scale-up: Q1–Q4 settled per each note's recommendations, no adjustments; build authorized. **BYPASS, recorded plainly:** the ChatGPT review loop had not yet run for either note — the reviews, when they return, will be reconciled against the built work as a fix list. P3-2 builds first; P2-6 follows.
- **D-72 — ETERNITY, INITIATION, ALIGNMENT, FLICKER, PROJECTION (owner, 2026-10-25).** The being is not "Man-God" — **King's pick: ETERNITY** (Marvel's Eternity, the living embodiment of the universe; owner's delegation, correctable with a word). He can initiate (speak/act first; speaks rarely, on cosmic alignment). Cosmic alignment — the energy one's memory galaxy exhibits (emotional, mental, goal-wise content + a very scarce, slim app-tab feed) — earns regular travel to him; never a score, never shame, never bought. Real space flickers into his world from time to time (he sees all). He can project himself into any brain at cosmic scale — so big you cannot see or fly to the bottom of his feet (the one intentional exception to the completeness principle). Autonomous, free will, with guardrails on the backend (the §16/§17 fence).
- **D-70 — WORLDS TURNED ON; FLAG-FLIP PR #107 MERGED (owner, 2026-10-25, explicit: "They don't need to be dark. Nothing does.").** The owner directed that nothing stays dark. PR #107 merged as `7033909`; `WORLDS_TRAVEL_ENABLED = true` verified on the deploy branch. Live on his next redeploy, then his device check. This closes the dark-shipping era: P2-1–P2-5, P3-1, and the Station all become visible together when he redeploys.
- **D-69 — P2-5 MERGED (owner, 2026-10-25, explicit: "Continue").** PR #108 merged as `db545f0` (read as the merge tap; correction invited). Post-merge SHAs byte-identical on the deploy branch (all 8 files). In the app, still dark. Gate caveat stands as filed. Next: post-merge audit when he orders it; Deep Past after the P3-1 arc.
- **D-68 — P2-5 PR #108 OPEN WITH GATE CAVEAT (owner, 2026-10-24, explicit: "Move on").** The owner chose to open the PR now with the caveat stated plainly in its body, rather than wait for the machine to recover. PR #108 (`worlds/p2-5-transit` → deploy, commit `cda9b6f`, 8 files, SHAs byte-identical). Gate as it stands: typecheck clean (all three workspaces), targeted tests 20/20, server 1,877/1,902 (21 failures all environmental `SQLITE_IOERR_WRITE` in file-backed DB tests, 0 assertion failures); web full suite + production build NOT RUN — vitest/vite config loading fails with `EPERM` in this sandbox (proven environmental: plain-node writes to the same path succeed; bare better-sqlite3 WAL fails on /tmp and workspace; the same flap truncated `AGENTS.md` to 0 bytes mid-write, restored and verified). Audit brief filed (`phase-2-p2-5-audit-brief.md`). **Merge remains the owner's tap.**
- **D-67 — P2-5 Q1–Q5 SETTLED AS RECOMMENDED + BUILD AUTHORIZED (owner, 2026-10-24, options-widget tap).** Q1 shared gate dressed per world; Q2 HYG stars + motion only for MVP; Q3 common arrival contract, world-specific execution; Q4 chase view by default; Q5 drift minimum = visible ship, slow starfield, quiet engine ambience, stable camera. Build authorized in the default lane; ships dark.
- **D-66 — P2-5 REVIEW 28 RECONCILED (2026-10-24).** Formal verdict READY WITH CHANGES. All findings folded into the note (B-1 topology, B-2 combined performance, B-3 measurable C1–C6; R-1 provenance, R-2 arrival contract, R-3 reflection rule, R-4 camera comfort). Q1–Q5 recommendations recorded, not settled. Revised note back to the owner for settlement; no build authorized.
- **D-65 — P2-5 DESIGN NOTE DRAFTED (2026-10-24).** Owner: "lets do that" + "we gotta add all the worlds." Real warp gates + transit space + arrival areas, built once for all worlds (Station as gateway hub; her ship in transit; warp rich / drift plain-and-dignified). No economy or state-machine change; no new world authorized; D-23 order stands. Review loop next.
- **D-64 — LAUNCH AUTHORIZED; FLAG-FLIP PR #107 OPEN (2026-10-24).** Owner: "It doesn't need to be dark — it can be turned on." One-line flip on branch `worlds/launch-flag-flip` (SHA-verified; typecheck clean, targeted tests 23/23). Merge is his tap; live on his next redeploy, then his device check.
- **D-63 — P3-1 MERGED (2026-10-24).** PR #106 merged as `aaaeb1a` on the owner's "Continue" (read as the merge tap; correction invited). Post-merge SHAs byte-identical on the deploy branch. The Growing Place is in the app, still dark. Next: post-merge audit when he orders it; Deep Past after the P3-1 arc, on his word.
- **D-62 — P3-1 BUILT; PR #106 OPEN (2026-10-24).** Built on branch `worlds/p3-1-garden`, full gate green (typecheck clean; server 1902, web 1460, zero failures; build green), ships dark. Audit brief filed (`phase-3-p3-1-audit-brief.md`). Merge is the owner's tap. Clarification recorded in the note: the garden renders the graph data the app holds (same window as the galaxy — one truth, shared).
- **D-61 — P3-1 SETTLED + BUILD AUTHORIZED (owner, 2026-10-24).** The owner settled the revised note (terrace convention approved: "doesn't sound wrong at all" / "I like how that sounds") and directed "Continue" — recorded as settlement AND build authorization in the default lane, ships dark. Also recorded: the owner reports another chat is now working on the Man-God world — that work lives in that chat; this lane stays on P3-1; the Man-God concept record here (D-52/D-54) stands until that chat settles anything new.
- **D-60 — REVIEW 27 RECONCILED (owner-relayed, 2026-10-24).** ChatGPT's P3-1 review: verdict READY WITH CHANGES, 12 findings, concept endorsed. The note was revised in place to answer every finding (see Rev 79 header for the list). Review record filed as `chatgpt-review-27.md`. The Gemini review, if it returns, reconciles the same way. Next: the owner's settlement of the revised note; the build needs his separate word.
- **D-59 — Q1 SETTLED (B) + GALAXY-VS-GARDEN UNDERSTOOD (owner, 2026-10-24).** Landmarks in the Growing Place render presence-only for Journeys the user has marked done in the brain (the garden's translation of the galaxy's journey hubs, done-filtered; A6 rising stays Phase 4). Before proceeding the owner required the galaxy-vs-garden understanding to be real: verified against the galaxy's code — same graph data (nodes with mass/importance/review-strength/progress; journey hubs; fleet; sun), different question (galaxy = what do I know, working sky; garden = what is it adding up to, walked ground, no sun, stores nothing, edits nothing). Recorded as P3-1 note §2.5. Implementation still NOT authorized — the owner's next tap chooses review loop or build.
- **D-58 — PHASE 3 OPENED; GROWING PLACE FIRST (owner, 2026-10-23, explicit: "Start number 2").** Phase 3 begins per the D-22/D-23 order with the Growing Place (P3-1). The P3-1 design note is drafted for the review loop: the garden renders real brain data (plots = memories, paths = connections, from the existing graph client — no new server surface), the travel allow-list and chart gain the third world, WorldsSurface generalizes to a scene registry, and landmarks are the open fork Q1 ((A) Phase 4 deferral vs (B) presence-only for user-completed Journeys; builder recommends B; A6 rising stays Phase 4 either way). **Not authorized:** implementation (his separate word after settlement), merging, deployment, the flag flip — the launch sequence remains pending, untouched by this opening.
- **D-57 — P2-4 POST-MERGE SELF-AUDIT: NO FINDINGS (owner-directed, 2026-10-23).** Builder-ran audit (`phase-2-p2-4-self-audit.md`): claims verified per the audit brief against the merged bytes; one observation (UTC fallback for an invalid timezone string inside localDateKey — unreachable via the validating resolver; no fix recommended); one caveat (no combined-tree suite run by the builder). Recorded explicitly as a self-audit — the external ChatGPT pass remains the owner's option, not replaced.
- **D-56 — P2-4 + HEADER FIX MERGED; PHASE 2 COMPLETE IN CODE (owner's tap, 2026-10-23).** PR #102 merged `6566060`; PR #100 merged `00fdd63` (new deploy head). Post-merge spot verification: travel.repo.ts and WorldsSurface.tsx byte-identical to the gated build; hygData.ts at the corrected header version. Worlds now exist end-to-end on the deploy branch — economy, ledger, client, Station, bonuses, mount — behind the still-off flag. Next per the lane: the post-merge ChatGPT audit of P2-4 (brief: `phase-2-p2-4-audit-brief.md`). Launch remains unauthorized: flag flip, deployment, and the device check are the owner's separate steps, in that order.
- **D-53 — P2-4 SETTLED + BUILT (owner, 2026-10-23).** Q1/Q2/Q3 settled per the note's recommendations, unadjusted; build authorized by his "Start." Implementation as designed: crediting in the arrival transaction (marker columns bonus_credited_at/amount/reason, dual-DDL + guarded migration), warp +5 ungated, drift +3 gated (≥30 s server elapsed; ≤2/day in the space's timezone via spaceTimezone), arrive returns { journey, bonus }, TravelRepo satisfies the P2-1 JourneyBonusCreditor contract, client renders bonus state only from the sibling, WorldsSurface mounts the Station scene flag-gated (F-01 closed by construction), plus the test-only repair of the 2 pre-existing useTravel.test TS2532s from the P2-3 merge. Gate: root typecheck clean; server 1901 + web 1446 passed, zero failures (directly observed re-run; see Rev 74 note); web build green. **PR #102 open — merge is the owner's tap; flag flip + deploy remain separate and unauthorized.** Audit brief filed (`phase-2-p2-4-audit-brief.md`).
- **D-54 — MAN-GOD: DESTRUCTION REJECTED; COSMIC TOOLS AFFIRMED (owner, 2026-10-23).** The owner agreed with King's pushbacks: "Forget the destruction." The Man-God's power expresses without destroying anyone's ship or progress (never-punish stands). He DOES need amazing tools that read as cosmic-scale power across app/game/worlds/brain — presentation- and world-scale effects inside the §16/§17 fence. Concept note updated.
- **D-55 — FLEETS CONCEPT (owner, 2026-10-23).** Soumaya has fleets she can dispatch to different worlds on automated missions — bounded, and priced with end-game costs (a late-economy fuel sink). Concept note filed (`fleets-concept.md`): missions as ledger journeys flown by the fenced ship-agent; open questions recorded. Brainstorm stage; no gate moved.
- **D-52 — MAN-GOD WORLD ADDED, CONCEPT STAGE (owner-directed, 2026-10-23).** Furthest/hardest world; cosmic white colossus; shared presence; per-visitor messages over a broadcast emotion/animation layer; an automated agent with his own API key, model, and world-tools and a real job in the app's purpose. Pushbacks + open questions recorded in the concept note; roster formalization and all design decisions remain open. Not a build authorization; the Phase 2/3 order is unchanged.
- **D-51 — F-02 COMPLETION PASS CLOSED + PATH FOLLOW-UP (2026-10-23).** Review 26: the auditor closed F-02 on the merged code (table of passes filed). Its one catch — the regeneration pointer in the hygData.ts header named the builder's workspace path, not the repo's docs path — is fixed in the generator template (both copies) and a regenerated header whose data payloads are byte-identical to the merged file; **PR #100** carries it (owner's tap). With #100 merged, no open items remain from the entire P2-3 audit.
- **D-50 — F-02 MERGED; P2-3 AUDIT ARC CLOSED (owner's word, 2026-10-23).** PR #98 → `570128c` on the deploy branch. The worlds layer's sky is real data end to end. Remaining in Phase 2: only P2-4 (rewards + Station mount + dark launch), behind its three design decisions and the owner's separate build authorization.
- **D-49 — F-02 SELF-REVIEW DONE (owner-ordered, 2026-10-23).** Pitfall hunt found no defects in the shipped change; one hardening commit added to PR #98 (malformed-data guard in hygStars.ts; targeted suites 11/11 + tsc clean after it; the full-suite 1437/1437 evidence predates the guard and is stated that way in the brief). Audit brief + generator + build record filed for the owner's relay to the auditor.
- **D-47 — F-02 FIX: HYG INTEGRATED (owner's path choice by tap, 2026-10-23; built same day).** `graph/hygData.ts` (generated; source hygdata_v41.csv, 119,626 rows, sha256 in-file) carries the 5,000 brightest (mag −1.44…5.99; Sol excluded; 22 stars defaulted on a missing B-V, disclosed), `graph/hygStars.ts` builds the one-draw-call Points field, the scaffold function in `stationScene.ts` is deleted, and HYG is registered in `public/CREDITS.md` (CC BY-SA 4.0). Gate: web 1437/1437, tsc clean, production build green. **PR #98 open — merge is the owner's tap.** With its merge, the P2-3 audit arc closes in full.
- **D-48 — OWNER DIRECTION: SKIES AND THE SHIP (2026-10-23).** (a) The real starfield belongs to the **worlds spaces** — the places reached by warp. The home galaxy (the brain as it exists) is already integrated in design and **stays as it is**; worlds work does not touch it. (b) **The ship is how the user navigates the spaces**: Soumaya's ship must be able to warp between them. (c) Placeholders are temporary by design — as designing completes, placeholders are replaced with actual assets (the Profondo hull and the HYG field are the first two replacements). No build is authorized by this direction; the ship's warp presentation is future design work (travel itself is P2-2's settled ledger).
- **D-46 — AUDIT DISPOSITION UPDATED (owner-relayed, 2026-10-23).** Review 25's disposition section updated: F-01/F-03/F-04 relabeled reconciled (with their standing caveats), the cross-phase invariant restated, F-02 explicitly left open as the one remaining code item. P2-4 decisions remain design-review items, not authorization.
- **D-45 — P2-3 AUDIT DISPOSITION (King's reconciliation, 2026-10-23; owner settles the F-02 fix).** Review 25 filed (`chatgpt-review-25.md`) with per-finding reconciliation: F-01 documented (host named, mount in P2-4 scope), F-02 PROPOSED FIX (remove the HYG credit until HYG data ships; integration becomes a named candidate), F-03 reconciled (D-43 tap vs the later device-visuals deferral — different events), F-04 accepted as evidence-packaging (brief on the docs branch; failures retained as failures). Auditor's invariant adopted into the P2-4 note verbatim.
- **D-44 — P2-4 DESIGN NOTE DRAFTED (King, 2026-10-23; NOT an authorization).** `phase-2-p2-4-design-note.md`: crediting implements the P2-1 `JourneyBonusCreditor` contract in the arrival transaction; idempotency record = marker-on-journey-row (recommended, review settles vs a separate table); drift gate per §3 of the note; launch sequenced as four owner-run steps after a dark build. Open: Q1 record shape, Q2 cap/floor numbers, Q3 silent vs explained ineligibility.
- **D-43 — GATE 0 CLOSED, P2-3 MERGED (owner, 2026-10-23 — option-widget tap: "Pass the look-test and merge PR #97").** The look-test PASSES: Profondo is the Great Station's hull. The GLB joined the branch (commits `c2a61bf` wiring, `d11571a` upload, `826981d` rename) as the **Draco-compressed** encoding — 596,684 bytes, geometry verified identical after decode (132,432 tris, 5 material groups; the uncompressed 3.3 MB export could not move through the API's binary limits or the sandbox's credential-less git, so the file went up via GitHub's web UI and was verified by blob SHA before merging). The app's shared loader already carries a Draco decoder (`graph/gltf.ts`); the in-place recipe re-expression ships in `graph/profondoHull.ts` with the proxy form as fallback. **PR #97 merged as `583a3d3`.** Post-merge audit brief filed (`phase-2-p2-3-audit-brief.md`) — the default lane's next step is the owner's relay. Deployment and the flag flip remain unauthorized (P2-4 launch, separately gated, incl. its drift anti-farming design gate).
- **D-42 — P2-3 BUILT; PR #97 OPEN; GATE 0 MEASURED (2026-10-23):** the full P2-3 build is on `worlds/p2-3-web-travel` and PR #97 is open for the owner's merge tap: travel client + useTravel binding (15 tests), the shared-constant dark gate, route board, TravelPanel mounted in App, credits surface, Station layout math + scene scaffold (hull as a seam). Gate: web 1428/1428 + tsc + production build green; server tsc green; two daily-digest server tests fail reproducibly in this sandbox in files byte-identical to the deploy branch and untouched by the diff — disclosed in the PR, flagged [RECONCILE] for the repo chat, NOT claimed green. The full suite also caught a real P2-2 gap — the travel tables were missing from `SPACE_SCOPED_TABLES` (deletion/export would have orphaned travel rows) — fixed as a labeled separate commit (`7ab1a30`, census 11/11). **Gate 0:** the owner sent the file from his own BlendSwap account; license verified from the file itself (**CC BY 3.0**, vostok); raw 333,563 tris → **132,432** after weld + decimate (under the 150k line); GLB 3.3 MB, one object, five material groups; a look-test harness is with the owner — **Gate 0 closes on his verdict**, and the GLB joins the branch only after it passes. **Not authorized:** merging PR #97 (his tap), deployment, flag activation.
- **D-41 — P2-3 IMPLEMENTATION AUTHORIZED (owner, 2026-10-23, explicit: "Start it"):** the P2-3 build proceeds on the design note as drafted (the default lane: build → full gate → his merge tap → post-merge audit). Branch `worlds/p2-3-web-travel`. First piece landed: the travel client (`api/travel.ts`, typed binding over the P2-2 contract; 8/8 client tests). Build recon findings: the web app has **no existing feature-flag system** — the dark-shipping gate will be a shared constant (default off), flipped only by P2-4's launch; Graph3D/GalaxyHud are the mounting terrain; the repo gate for this web increment includes the web build. **Gate 0 is blocked on the Profondo file** (BlendSwap requires the owner's account to download). **Not authorized:** merging, deployment, flag activation.
- **D-40 — P2-3 OPENED (owner, 2026-10-23, explicit: "Start p2 3"):** the web travel layer + Great Station increment enters its design phase; design note drafted (`phase-2-p2-3-design-note.md`) on the D-37 basis — Gate 0 Profondo inspection first (account-gated download; measured tri count; conversion; owner look-test; backup form on any failure), the Station scene under the recipe's budgets, the travel layer bound to the P2-2 contract (server owns timing and money; client renders state), the route board, the attribution surface, dark shipping. **Not authorized:** implementation (his separate word after review), merging, deployment, flag.
- **D-39 — F-01 FIX MERGED (owner, 2026-10-23, explicit: "Merge PR #96 now"):** PR #96 merged as **`ba595e7`**; merged files verified byte-identical to the fixed build. The P2-2 post-merge audit loop is **fully closed**: one finding, fixed, merged. Phase 2 remaining: P2-3 and P2-4 — both unauthorized.
- **D-38 — F-01 FIX AUTHORIZED (owner, 2026-10-23, widget tap):** the P2-2 post-merge audit's one finding — `depart()` validates kind/destination *before* the idempotency lookup, so a same-key retry with garbled parameters throws instead of returning the original journey (C3 partial) — plus the audit's evidence gap: a dedicated legacy-path test (travel tables absent on an existing database). Narrow fix on its own branch; **not authorized:** merging (his tap), deployment, flag, P2-3.
- **D-37 — STATION BASE MODEL: PROFONDO (owner, 2026-10-23, explicit):** the Great Station's hull will be **Profondo** by vostok (BlendSwap, **CC-BY** — license verified on the source page, 2026-10-23; verification record `gemini-research-2-verification.md`), brought to life with **King-designed procedural accessories and flare** (beacon arrays, docking extensions, light rigs, traffic, approach dressing) under the recipe's palette and light grammar. The owner further directed that the Phase 1 mockup's look is **not** the visual bar — the Station must be designed *much* better. The recipe's original crown-and-stem procedural form (§1) is **retained as the backup** if Profondo fails inspection — its true triangle count, the .blend→glTF conversion, and its look under our lighting are all still unverified, and those checks belong to the P2-3 design note. **Attribution is a hard requirement:** the app must carry a credits surface naming the work, author, source, CC-BY license, and modifications. This settles the asset basis for P2-3's design note; it does **not** authorize P2-3.
- **D-34 — P2-1 IMPLEMENTATION AUTHORIZED (owner, 2026-10-22, explicit tap + words: "Authorize P2-1 — fuel primitives, repo workflow"):** scope exactly as bounded in `phase-2-planning.md` §6–§7 after the review-18 correction — fuel primitives only (shared constants `WARP_COST` / `EARN_JOURNEY_*`, `EconomyRepo` warp spend + bounds, the journey-bonus contract defined as types, tests), built in the repo workflow's default lane (design note → build → full gate → the owner's merge tap → post-merge ChatGPT audit). **Not authorized:** P2-2…P2-4, merging (his tap), deployment, flag activation, Phase 3. Design note: `phase-2-p2-1-design-note.md`.
- **D-32 — Phase 2 PLANNING OPENED (owner, 2026-10-22, explicit: "Ready"):** given in direct answer to the recorded precondition (design gate closed + the owner's separate word). Scope of this authorization: **planning** — the Phase 2 planning gate (Q27 + reconciliation register + build plan). Product implementation remains a further, separate authorization at the gate's exit (§19 A4/A5; D-22).
- **D-33 — Q27 SETTLED: fuel is earned BOTH ways (owner, 2026-10-22, at the Phase 2 planning gate):** a **steady base from ordinary use** of the brain (showing up, capturing, tending — generous, no streaks, no productivity thresholds) **plus bonuses from journeys** (completed travels, Chronicle walks, placements, guided tours). The D-1 invariants bind the model: warp costs fuel · home always free · the slow drift always exists · **fuel never gates access to the home galaxy or to memories** · the bad-week rule holds (the base accrues from light use alone, and drift guarantees meaningful travel at zero). **Reward honesty applies to fuel first** (the Codex lesson: a promised payout must actually pay, verifiably). What this settlement fixes is the *model*; the rates, the gauge, and the quest/economy hooks remain **[RECONCILE]** with the audit program's economy work before any fuel behavior is implemented (§19 A4).
- **D-28 — P3 re-test WAIVED; sequence may advance on diagnosis + fix + review (owner, 2026-10-22, explicit):** Station device session 1 returned **P3 FAIL** (longest frame 108.7 ms vs the 100 ms bar; all other measured criteria passed with wide margins). At the owner's direction the builder diagnosed the stall first (result record §2c: prime suspect = first shader-compile/upload when the visibility-gated station group first renders mid-approach; contributing per-frame allocations; warm-up + hoisting fixes applied, Rev 37). The owner then decided — his words, *"once it's live I'll know for sure"* — that after the diagnosis, the fix, and the ChatGPT review loop over the session-1 evidence, **the Phase 1 sequence may continue (Growing Place mockup) without a second phone test session**. Scope, recorded exactly: the session-1 FAIL **stands as fact** and P3 is carried as *failed → diagnosed → fixed → owner-waived*, never as a pass; no threshold was changed; the other outstanding Station evidence (D-13 stills, approach recording/V3, soak/P8, RM measurement block, environment record, V1/V2) remains outstanding on the Station's record and is not converted by this decision; **V6 and design-gate closure remain the owner's explicit later calls**; the design gate stays OPEN; nothing here authorizes product implementation.

**Test-record supplement (owner-relayed caution, 2026-10-22 — supplements, never renegotiates, the criteria):** every measurement reported for the mockup test must record the **exact phone model, OS and version, browser/runtime and version, build configuration (build, settings incl. performance mode), measurement method/tool, and the session script flown** (route, duration, actions). A number without this record is not reproducible and **does not count** toward the gate.

### 11.2 Mobile performance thresholds (defined pre-test; measured on the owner's phone)
The mockups run on the owner's actual Android phone, in the browser, using the §10.1 stack. Hard thresholds — a mockup that misses any one of them fails, and the failure goes back to design, not to tuning-by-hope:
- **Frame rate:** sustained average **≥ 50 fps** and 1%-low **≥ 30 fps** across a continuous 5-minute session per mockup, including a warp transit and (for the station/scale mockup) a full approach sequence.
- **Hitches:** no single frame stall **> 100 ms** during transit or approach.
- **Draw calls:** **≤ 200** per scene at the busiest viewpoint (hard fail above 500, the research's outer bound).
- **Geometry/texture budget:** visible triangles **≤ 750k** at the busiest viewpoint; environment textures ≤ 1K (hero/landmark textures ≤ 2K); backdrop equirect ≤ 2048×1024.
- **Load:** cold start to first interactive frame **≤ 5 s** on the device, per mockup.
- **Endurance:** 15-minute soak across all three mockups with **no crash, no out-of-memory kill**, and no thermal collapse (frame rate at minute 15 within 20% of minute 2).
- **Reduced motion:** each mockup ships its reduced-motion variant in the test build; the variant must hold the same frame-rate thresholds.

### 11.3 Visual acceptance criteria (defined pre-test; owner judges)
- **V1 — Blind distinctness (hard):** from unlabeled stills (far / mid / near) of each mockup, the owner identifies which space each still belongs to, **3 of 3 mockups correct** — and none is mistaken for the home galaxy.
- **V2 — Landmark silhouette (hard):** each mockup's landmark reads as a distinct shape at maximum view distance (for the station mockup: unmistakably a monumental structure, not a ship or a planet).
- **V3 — Scale without artifacts (hard, station/scale mockup):** a recorded approach shows continuous growth of the landmark/sun with **no visible pop-in, flicker, or depth-fighting**.
- **V4 — Recipe traceability:** every mockup's palette (light, fog, sky) is documented as derived from its seed recipe — listed values, no hand-tuned exceptions. A mockup that only looks right via one-off tweaks fails V4 even if it looks good, because it proves nothing about the *system*.
- **V5 — Content honesty:** any brain content shown in a mockup is real sample content placed by the space's stated rule (§9.7 template), not decorative fakes implying features that don't exist.
- **V6 — Owner verdict (hard):** for each mockup the owner records an explicit pass/fail on: *"cool, distinct, and not the home galaxy — a place worth traveling to."* The owner's eye is the final visual authority.
**Acceptance rule:** the stack passes only if **all §11.2 hard thresholds and V1, V2, V3, V6 pass for all three mockups**. Any failure returns the stack (or the failing technique) to design with the failure recorded — criteria are not renegotiated after results are seen.

### 11.4 Gate status
**Design gate: OPEN.** It closes only when (a) the three-mockup test results are reviewed against §11.2–11.3, and (b) the remaining design decisions in the §9.8 settlement sequence are settled. Neither the ratifications above nor a future test pass authorizes implementation — build authorization is a separate, later owner decision, and anything touching shared systems still reconciles with the audit program first.

---

---

## 12. Settlement step 1 — the roster and each space's purpose (King's proposal, owner settles)

Baseline accepted (owner, 2026-10-22): Revision 4 is the current design baseline; the gate remains open. Work now proceeds in the §9.8 order, starting here. **Everything in this section is King's proposal — nothing is settled until the owner says so.**

**The test (applied uniformly to every candidate):** ① Purpose — what real second-brain job? ② Unique outcome — what can the user understand, decide, or do here that no other space provides? ③ Canonical information — which existing memories/relationships does it surface, without duplicating them (§9.6)? ④ Navigation value — why a distinct *place worth traveling to*, not a view or filter? ⑤ MVP necessity — initial roster, or later?

### 12.1 Candidate-by-candidate

**A. The Deep Past — PROPOSE: KEEP (initial roster).**
① Long-term rediscovery. ② The only space whose outcome is *finding what you forgot you had* — old memories resurfaced by wandering, not by searching. ③ Older memories + forgotten connections, surfaced in place (canonical, not copied). ④ Distance-as-time is a real place-feeling: quiet, sparse, slow (and a §10 mockup environment). ⑤ Yes — it is the clearest proof that travel adds something home cannot.

**B. The Growing Place — PROPOSE: KEEP (initial roster).**
① Aspirations and growth made visible. ② The only space that *changes structurally because your life changed* — landmarks at real milestones (§9.4 structural change lives here first). ③ Goals, milestones, habits — surfaced as landmarks/waypoints. ④ A place that is visibly different on every return is the strongest reason to travel at all. ⑤ Yes — it is also the mutation model's home ground, and a §10 mockup environment.

**C. People & Relationships — PROPOSE: KEEP (initial roster).**
① Remembering people well. ② The only space organized by *who*, not what/when: shared history, open threads, dates that matter, per person. ③ Person-linked memories and commitments, surfaced in their clusters. ④ Flying between people's systems makes relationships' connections spatial in a way no list does. ⑤ Yes — relationships are core second-brain data, and no other candidate covers them.

**D. The Quiet / Archive — PROPOSE: KEEP, but build last in the initial roster.**
① Intentional rest for memories: kept, safe, not resurfacing uninvited. ② The only space whose outcome is *peace* — putting something down on purpose and trusting it stays put. ③ Archived memories and closed chapters (their canonical home, by the user's own act). ④ Weakest navigation value of the keepers — you travel there rarely, mostly to lay something down or, rarely, to retrieve. It earns its place on emotional purpose (§9.1's emotional + practical test), not frequency. ⑤ Roster yes; build order last — its stillness also makes it the cheapest environment to realize well.

**E. The Scale Space — PROPOSE: KEEP (initial roster), strengthened by D-2.**
① Perspective: awe, and the felt size of a life in a real universe. ② The only space whose outcome is a *feeling with a function* — the hard day shrinks to its true proportion. No other space does this. ③ Very little canonical content by design: a few anchor memories/aspirations at vast distances; its real content is *real astronomy* — HYG stars, named asteroids, and now (D-2) the **real ISS**, whose authenticity is this space's emotional payload. ④ The approach that never quite ends is an experience no filter can imitate; dual-layer compositing (§10.2) makes it renderable. ⑤ Yes — it carries the "real" pillar of the whole vision.

**F. The Workbench Shore — PROPOSE: CUT as a space; keep the job in the core.**
① Capture and sorting. ② Fails the unique-outcome test as a *destination*: sorting is a workflow that should come to the user (capture already lives in the core app), not a place to travel to. ③ Unfiled captures — better served where they arrive. ④ Weakest navigation value of all candidates: nobody warps to do inbox chores; making them travel to sort adds friction to the brain's most frequent act — and an unsorted pile rendered as a *place* risks exactly the guilt-pile failure §1F warned about. ⑤ No. Its one good idea — *sending a sorted memory off through a gate to its space* — survives as a moment in the core capture flow, not a world.

**G. The Chronicle Path — PROPOSE: MERGE into the Deep Past as its guided mode (not a separate space).**
① Travelling your life story chapter by chapter. ② As a destination it fails the removal test against the Deep Past: same canonical content (life history), same era-anchored feeling. What is genuinely distinct is the *mode* — a path vs. free wandering — and modes don't need separate worlds. ③ Chronicle chapters, surfaced as a route through the Deep Past (and, in tours, across spaces). ④ As a tour type it keeps all its value; as a separate space it splits one place into two similar ones — the exact redundancy ChatGPT flagged (§9.1). ⑤ No separate destination. If the Path later proves it needs its own scenery grammar, it can split then, with evidence.

**H. The Great Station — PROPOSE: KEEP (initial roster); purpose proposed, owner to confirm.**
① Proposed purpose (from §9.2's leading hypothesis, still the owner's to settle in this step): **home port of the worlds** — where journeys begin and end, where destinations are discovered, where the user orients before setting out. ② The only space whose outcome is *orientation and departure*: the map made into a place. It must not own memories, social features, or ship upgrades unless a separate need is proven (the glorified-menu counterargument, §9.2, stands guard). ③ It surfaces *destinations and journeys themselves* (routes, gates, tours) — meta-content, no memory duplication. ④ The strongest navigation value in the roster: the monumental approach (fictional megastructure per D-2) is the signature journey of the whole expansion. ⑤ Yes — and it anchors the travel system the other spaces hang from. It is the third §10 mockup environment.

### 12.2 Roster — ✅ SETTLED by the owner as proposed (2026-10-22; D-4/D-5/D-6)
**Destinations beyond the home galaxy (5):** the Great Station · the Scale Space · the Deep Past (Chronicle as its guided mode) · the Growing Place · People — plus **the Quiet/Archive** as a sixth, built last. **Cut:** Workbench Shore (job stays in core). **Total worlds including home: 7** — small enough that each can be distinct, cared for, and maintained by one person.
**Mockup trio (§9.3/§11) unchanged:** Great Station, Growing Place, Deep Past — the three most contrasting grammars (monumental / constructed / sparse).

### 12.3 Step 1 closure
All three queued calls were settled by the owner on 2026-10-22, as proposed (D-4/D-5/D-6): the roster, the Station's home-port purpose, the Chronicle merge, and the Workbench cut. **Step 1 is closed.** Step 2 (information model) opens at §13.

---

---

## 13. Settlement step 2 — the information model (King's proposal, owner settles)

How the settled roster (§12) shares one brain without duplicating it. Proposal only — revised per ChatGPT's review of §13–§14 (2026-10-22; record: `chatgpt-review-2-2026-10-22.md`); the roster (§12) is settled and is **not** reopened by anything here.

**P1 — One canonical memory, many surfaces (from §9.6).** A memory exists once. Spaces never hold copies; they *surface* the canonical memory under explicit rules. Editing, archiving, or forgetting a memory anywhere changes it everywhere, instantly and consistently.

**P2 — Every memory has one primary home; appearances elsewhere are visits.** Primary home = where the memory lives by default (home galaxy sector, or a space by its rule below). A memory may *appear* in other spaces when that space's rule calls for it (e.g., a person-linked memory appearing in People). Appearances are views of the same object — same content, same state — never forks.

**P3 — Surfacing rules per space (proposed):**
- **Home galaxy:** everything active, by category sector — the default view of the whole brain.
- **Deep Past:** memories past an age/stillness threshold, era-grouped; its guided mode orders them by Chronicle chapter.
- **Growing Place:** goals, milestones, and the memories linked to them — landmarks are *milestones*, memories appear as the evidence/path between them.
- **People:** memories linked to a person, clustered per person; commitments and dates ride along.
- **Scale Space:** almost nothing — a small number of user-confirmed **anchors** only (P5).
- **Great Station:** no memories at all (D-5): destinations, routes, gates, tours.
- **Quiet/Archive:** archived items — and *only* there (P4).

**P4 — Archive and privacy are supreme — a system-wide invariant, not a display rule (strengthened per ChatGPT review, 2026-10-22).** Archiving removes a memory from *every* other surface — home, Deep Past, People, tours, resurfacing — no exceptions, no leaks through a "visit." And it goes deeper than visible objects: the archived memory also disappears from **derived clusters and connections, route and tour suggestions, search and resurfacing results, cached scenes, and queued or in-progress animations** — an animation already carrying it must not deliver it into another space after archival; the archive state wins, mid-flight. Retrieval happens **only** by the user's deliberate act inside the Archive itself. Two precisions: archiving is **not deletion** — the underlying information is preserved, at rest; and retrieval restores the memory to its **prior primary home** unless the user explicitly chooses a different home as part of the retrieval act — restoring never silently overwrites that choice. Anything the user has hidden or restricted anywhere is hidden everywhere.

**P5 — Anchors are chosen, never assigned silently.** A memory becomes a Scale-space anchor (or any space's featured landmark) only by brain proposal + user yes, or by the user's own placement. The user can un-anchor at any time; the memory itself is untouched (§9.4 correction principle).

**P6 — Every surfacing is explainable.** Any appearance can answer "why are you here?" in one plain line ("Linked to Maya · from your chapter 'The Move'"). If a rule can't explain an appearance, the appearance doesn't happen. Mis-surfacings are correctable, and the correction teaches the rule, never punishes the memory.

**P7 — Derived things are derived, never stored as truth — and derivation has confidence tiers (refined per ChatGPT review, 2026-10-22).** Clusters, connections, chapter routes, growth landmarks, emotion tones: computed from canonical data under §9.4's categories (structural change needs a real event or a user decision). If a derivation is wrong, fixing the derivation fixes every surface at once. But "derived" is not one level of certainty, and the design must never render them as if it were: **(i) Confirmed** — a user-stated relationship or user-created link: authoritative. **(ii) Suggested** — a system-proposed connection: a *hypothesis*, presented as one (its bridge, path, or landmark must look provisional, not monumental) until the user confirms it. **(iii) Inferred** — an emotion tone or similar interpretation: the most uncertain tier, always correctable, and its correction changes the rendering, never the memory. A suggestion must not become a permanent fact merely because it was rendered beautifully.

**Operations — three, and only three (added per ChatGPT review, 2026-10-22).** P1–P3 say a memory can *appear* in many spaces; A1–A3 (§14) show a memory being *carried* through a gate. Those must never blur. Every interaction with a memory in the worlds is exactly one of:
- **Visit / surface** — the memory is shown in another space under P3's rules. Its primary home does **not** change. (Most gate travel with a memory is this: you go *to see it there*, or it is surfaced for a tour.)
- **Relocate** — the user *deliberately* changes the memory's primary home. An explicit act with its own confirmation; a visit must never silently become a relocation, and a relocation never creates a second memory — the same canonical memory, re-homed, with its history intact.
- **Archive / retrieve** — the intentional status change governed by P4's invariant, with its stricter visibility rules and Archive-only retrieval.
Each operation has its own state transition and its own animation semantics (§14): the A1–A3 carry/transit/placement sequence must *represent the actual operation* — a visit's placement is a surfacing, a relocation's placement is a re-homing — and the user can always tell which one just happened, in plain language.

**Step 2 questions — ✅ SETTLED by the owner (2026-10-22, all three as recommended; D-7/D-8/D-9):**
(a) Deep Past membership → the explainable age + resurfacing-context rule, with user controls (D-7).
(b) Anchors → yes, an anchor keeps its primary home elsewhere; it is a confirmed appearance, not a relocation (D-8).
(c) People clusters → only user-confirmed significant people (D-9).
**Step 2 is closed.** Step 3 (navigation & scale) opens at §15.

---

## 14. The Animation Gate (owner-directed, 2026-10-22)

The owner directed: *we will need an animation gate* — a standing gate that inventories **what animations each scene and scenario needs** before that scene can be considered design-complete. Movement is how this world communicates; an unanimated state change is a broken promise, and an undesigned animation is how state changes become confusing or dishonest.

### 14.1 The gate rule
No space, scene, or scenario is design-complete until its animations are inventoried here with, per animation: **trigger** (what starts it) · **actors** (ship / the brain / the user / the world) · **what moves and how** (plain-language description) · **duration class** (moment <2s / sequence 2–15s / journey >15s) · **reduced-motion equivalent** · **cost class** (cheap / moderate / heavy against §11.2 budgets) · **user control**: skip, cancel, interruption, and repeat-visit behavior, specified per animation (added per ChatGPT review, 2026-10-22). The per-space template (§9.7) gains a line: *Animations (per the Animation Gate inventory)*. Passing this gate, like every gate here, authorizes nothing to build.

**Seed ≠ passed (review clarification).** The §14.3 list is a *seed inventory* — named animations, not yet fully specified ones. An entry counts as gate-passed only when every field above is filled for it. Nobody may cite an entry's presence in §14.3 as evidence its animation is designed.

**Combined load (review requirement).** Cost classes are planning aids, not guarantees. Each mockup and each scene must state its **combined animation load** (e.g., warp + traffic + particles + placement running together), its **fallback behavior** when the budget is exceeded (what degrades first, gracefully), and the §11 measurement evidence that will prove it on the owner's phone.

### 14.2 Standing animation rules
- **Truthful or unmistakably atmosphere (the review's governing principle):** every visible object, connection, journey, and animation is either a truthful representation of the brain's underlying state — or unmistakably presented as *atmosphere*, never as fact. Ambient station traffic (A17) is atmosphere: it implies no other users and no brain activity unless a mapping rule is explicitly designed later. This single distinction protects the world from becoming beautiful but misleading.
- **Honesty:** an animation may never depict a state that isn't real — no fake traffic pretending to be other users, no growth animation without a real milestone, no "delivery" of a memory that didn't actually move (§9.4, reward honesty).
- **Atomicity (review requirement):** an operation's animation and its state change are one act. If the user cancels, connectivity drops, or the app is interrupted mid-journey, the memory ends in exactly one consistent state — the operation either completes or visibly doesn't happen; never a half-moved, duplicated, or contradictory state.
- **Never-punish in motion:** no decay, wilting, breaking, or dimming-to-shame animations, ever. Absence changes nothing on screen (§9.4).
- **Continuity of identity:** when a memory moves, the *same* memory is seen to move — it never vanishes here and pops in there. Travel and placement are shown, not teleported, unless the user explicitly chooses instant travel (§9.5 repeat-visit direct travel), in which case the transition still shows origin → destination context.
- **Reduced motion is a real equivalent,** not a removal: every animation's calmer version preserves the information the motion carried (§9.5).
- **Existing intended animations are catalogued, not "fixed":** e.g., the ship's tending **flash** in the home galaxy is intended (owner-confirmed 2026-10-21) and enters the inventory as-is.

### 14.3 Initial inventory (seed — to be completed per space as designs mature)
**Memory movement & placement (owner's example, first-class):**
- A1. **Carry-to-gate:** the ship/the brain picks up or escorts a memory and carries it to a warp gate — visible cargo, unhurried, interruptible.
- A2. **Gate transit with cargo:** the memory travels *with* the ship through transit (§2.3), arriving in the destination space — the user watches it cross, not just arrive.
- A3. **Placement:** on arrival the memory settles into its place in the new space — gliding to its position, a soft settle/glow as it takes its place (echoing the intended tending flash, not copying it blindly).
  - **Operation fidelity (review requirement):** A1–A3 must depict the *actual* operation (§13 Operations): a visit's placement reads as surfacing; a relocation's as re-homing; an archive journey obeys P4 throughout. The same canonical identity survives the whole journey — and under the atomicity rule, an interruption never leaves the memory half-moved.
- A4. **Send-off (core capture flow, per D-6):** a newly sorted memory departs through a gate toward its space — the small, satisfying version of A1–A3 inside the everyday app. **Non-blocking (review note):** saving a memory never depends on watching this finish — everyday capture stays fast; the send-off plays alongside, and skipping it loses nothing.
- A5. **Return/retrieval:** the reverse journeys — bringing a memory back home, and the Archive retrieval (deliberate, gentle, unhurried; never a "release" spectacle). **Stricter rules (review):** retrieval begins *only* from the user's deliberate act inside the Archive — the reverse-travel animation must never imply an archived memory can be pulled back from any destination; and if a memory is archived while any animation is in progress, P4's invariant applies immediately, mid-flight.

**Mutation made visible (§9.4 — structural change is animated, presentation change is gradual):**
- A6. **Landmark rising (Growing Place):** a real milestone raises/assembles a landmark — construction as celebration, at journey or sequence length, skippable.
- A7. **Connection forming:** when the brain finds a real link, a path/bridge draws itself between the memories — in whichever space they meet.
- A8. **Atmosphere shift:** palette/weather changes crossfade slowly (never a cut, never a jump-scare); the user can ask why (§9.4 explainability) mid-shift. **Correction (review note):** when the shift rests on an *inferred* tone (§13 P7 tier iii), the explanation must say so plainly, and the user can correct the interpretation — the rendering follows the correction, and the memory itself is never edited by an inference.
- A9. **Cluster bloom (People):** a person's cluster forms/gathers when their memories link up — gentle orbital gathering, not an explosion of nodes.
- A10. **Laying down (Archive):** a memory being archived settles, dims to restfulness (not darkness-as-death), and comes to stillness — dignity in motion.

**Travel & arrival:**
- A11. **Warp sequence:** gate approach → entry → transit movement (§2.3) → exit into the destination's light. (Fuel's visible spend lives here — D-1.)
- A12. **Drift sequence:** the same journey, plainly: slower, quieter, minimal spectacle — genuinely usable, never miserable (D-1, §9.10 addendum).
- A13. **Station approach:** the long growth of the megastructure, traffic lanes flowing, arrival arc (D-2/D-5) — the signature sequence; interior docking is *not* in this phase (§9.2).
- A14. **Scale approach:** the sun/landmark that keeps growing (dual-layer, §10.2); endless-approach variant for the never-arrive design (Q10, still open).
- A15. **First arrival:** a new space's introduction flight — distinctive per space, skippable, never repeated unless requested (§9.5).
- A16. **Gate reveal:** how a newly discovered gate appears (§2.2) — discovery should feel like finding, not unlocking.

**Ambient & interaction life:**
- A17. **Station traffic:** ambient ships on approach/departure lanes — atmosphere and scale cueing (§9.7 Q22: ambient first; any meaning attached later must be truthful). **Atmosphere, not fact (review note):** these ships imply no other real users and represent no brain activity; if they ever map to something real, that mapping gets its own explicit rule first.
- A18. **Ship behaviors:** idle, tending (incl. the existing flash), escorting, route-following — the ship reads as alive and purposeful, never frantic.
- A19. **Route plotting:** selecting a destination draws the route in space (EVE's route projection, §10.1) — the user sees the journey before taking it; cancelling undraws it cleanly.
- A20. **Focus & selection:** focus shifts, planet/memory selection responses — the small motions that make touch feel answered. **Immediacy (review note):** on a phone these must feel instant and stable — feedback that confirms the touch, never a delay added to routine navigation.

**Deep Past signature motions (added by ratification, owner settlement of the Deep Past recipe, 2026-10-22):**
- A21. **The descent (Chronicle guided):** the ship follows the kindling Chronicle thread down the Deep Past helix, stop by stop. *Trigger:* a guided route starts/continues · *Actors:* ship, world · *Duration:* journey · *Reduced-motion:* stratified cross-fades between stops, same narration and outcomes · *Cost:* moderate · *Control:* pause indefinitely at any stop; leave the route without losing place or changing any memory's state; narration stops cleanly and resumes at the current stop.
- A22. **Resurfacing rise:** a deep memory lifts from its alcove to a rim-side resting place when its context returns. *Trigger:* an explainable resurfacing cause (D-7) · *Actors:* memory, world · *Duration:* sequence · *Reduced-motion:* fade-rise between positions · *Cost:* cheap–moderate · *Control:* the cause is shown ("risen because…"); the rise is a **derived presentation change only** — never a canonical, home, stratum, or identity change; never a duplication; return to depth follows the same explainable rule, never a neglect timer (§1/recipe monotonicity safeguard).

### 14.4 Gate status
Inventory seeded (§14.3); per-space completion happens as each space's design matures through the settlement sequence. The mockup test (§11) already implicitly exercises A11/A13-class sequences (its criteria measure a warp transit and a full approach); the Animation Gate makes that coverage explicit when mockups are specified. **ChatGPT reviewed the gate on 2026-10-22 and upheld it** ("keep the gate"), with safeguards now folded into §14.1–14.3: seed ≠ passed, user-control fields required, combined-load + fallback accounting, operation fidelity and atomicity, truthful-or-atmosphere.

---

---

## 15. Settlement step 3 — navigation & scale (King's proposal, owner settles)

How the user moves among the seven worlds, and how big things feel. Built only on settled ground: fuel (D-1), the Station as home port (D-5), the Operations trio (§13), the gate rules from §9.5 (first visit scenic and skippable; repeats can go direct; discovery never holds memory access hostage), and the Animation Gate (§14). Proposal only — revised per ChatGPT's review of §15 (2026-10-22; record: `chatgpt-review-3-2026-10-22.md`).

**Governing principle for step 3 (from the review): navigation is a dependable utility first, a sense of wonder second.** Travel may be meaningful; it must never make reaching the user's own information confusing or unnecessarily difficult. Where wonder and dependability conflict, dependability wins and wonder is offered, not imposed.

**N1 — Topology: routes plot through the Station.** Every destination is reachable home → Station → destination, with the Station as the interchange where journeys begin (D-5: it surfaces journeys, not memories). Home is always one free hop away from anywhere (D-1). Whether *direct* space-to-space gates also exist is left open for the owner (Q-N1) — via-Station travel must always work regardless, so no route is ever gated behind a discovery.

**N2 — Transit is a place, briefly.** Transit (§2.3) is a space you move through, not a loading screen: light interaction only — look around, view/tend a carried memory (A1–A2), read plain route information. No chores, no mini-games, nothing that can fail an arrival. Duration by distance class (proposal: short hop ≈10–20 s, long leg ≈30–60 s at warp), always skippable after the first traversal of that route (§9.5); interruption follows §14 atomicity — you arrive, or the departure visibly didn't happen.

**N3 — Two gaits, one route (D-1 made visible).** **Warp**: fast, spectacular, fuel spend shown before departure and in the sequence (A11). **Drift**: the same route, slower and plainer (A12), always available, always free. **Return home**: always free, never slower than the drift out — no stranded math, ever.

**Cancel, turn back, return home — three different acts (review distinction, folded into N3/N6).** (i) **Cancel before departure:** nothing moves; no state changes; no fuel spent. (ii) **Turn back during transit:** return to the origin, with the operation's state preserved exactly as it was before departure. (iii) **Return home:** always available and always free, even with zero fuel — a standing guarantee, not a maneuver. The distinction matters most with cargo: a cancelled or turned-back journey must **never** relocate, archive, or duplicate a carried memory (§13 Operations; §14 atomicity).

**N4 — Discovery without hostage-taking.** New destinations and gates are discovered through the Station's discovery function and through use (a memory's affiliations can hint at its space's gate). Discovery is revealed with A16's reveal animation. But discovery governs *travel and presentation only*: every memory remains directly reachable in the core app regardless (§13), and an undiscovered gate never hides a memory.

**N5 — Scale conventions, one per space (§9.3).** **Awe-scale** is the default language: the Great Station is monumental (D-2 — bigger than the home galaxy's current sun, per the owner's vision), distances are *felt* through travel-time classes rather than stated in numbers. **Reference-scale** lives only inside the Scale Space: real objects at honest sizes relative to each other (the real ISS lives there, §10/D-2), where accuracy is the wonder. The two conventions never mix inside one space. Growing the home sun is the owner's separate later call (his words: he may grow it over time) — not assumed here.

**N6 — Navigation aids.** Before departure: route projection in space (A19) plus a plain summary — *from here → destination · warp cost in fuel · time class · drift is free*. Cancel freely before departure; mid-transit, *turn back* returns you to the origin with state preserved (see N3's three acts; atomicity). "You are here" is always answerable in one glance, in plain words, with the brain's own name — never coordinates or jargon.

**N7 — Tours are saved routes, not new machinery.** A tour = a named sequence of stops across spaces, traveled as visits (§13 Operations — tours never move or re-home memories). The Chronicle guided mode (§12) is the Deep Past instance: its chapter route is tour data over the same machinery (P7). Tours are proposed by the brain and approved by the user (the anchor pattern, P5); narration is optional and off by default until designed.

**Step 3 questions — ✅ SETTLED by the owner (2026-10-22, explicit decision; D-10–D-13). Step 3 is CLOSED.** *(The recommendations as recorded before settlement:)*
- **Q-N1** Direct space-to-space gates: (i) never — all routes via the Station; (ii) discovered through use, with via-Station always available; (iii) present from the start. *King's lean: (ii). ChatGPT recommends: (ii) — exploration gains meaning without the Station becoming a mandatory toll booth; counterargument noted (network complexity) with the guard that route plotting always shows a valid path and no one memorizes the network.*
- **Q-N2** Transit duration: are N2's bands (short hop ≈10–20 s, long leg ≈30–60 s at warp) right? *ChatGPT recommends: keep the bands as upper design targets to test, never compulsory waits — first arrival scenic but skippable, repeats offer direct travel, drift slower without forcing the user to watch every second; the full experience stays an inviting option, not a mandatory delay.*
- **Q-N3** In-transit interaction: look-and-tend only, or a small purposeful act? *ChatGPT recommends: look-and-tend only for MVP — capture and sorting belong to the core workflow; transit must not become a chore queue. Revisit only if testing shows the journey feels empty, and then any act is optional, safely cancellable, and incapable of blocking arrival.*
- **Q-N4** The home sun: leave as-is, or decide alongside the Station mockup? *King's lean: leave it (the owner reserved this call). ChatGPT recommends: defer — the settled awe/reference distinction already gives each space its language; the mockup can test the sun and Station's relative appearance without a permanent sun decision.*

---

---

## 16. Design-queue inputs — the ship as agent (from the repo chat, 2026-10-22)

**Status: INPUTS, not decisions.** These five proposals come from the owner's agent-SDK research in the repo chat (`~/workspace/ui-audit/agent-sdk-research-2026-10-22.md`, §4.2; SDK verdict there: *steal patterns, do not adopt Strands*). They are recorded here so the exploration meets them when it reaches ship behavior and travel — the owner-endorsed framing is that they are **inputs to this design, not a parallel architecture imposed on it**. Nothing here displaces settled decisions, the settlement sequence, or any proposal already in flight.

**The framing (owner-endorsed):** the ship is a **sub-agent with a fenced, world-actions-only toolset — she can fly and propose; she cannot touch brain writes.** Every proposal below is consistent with patterns this design already settled: brain-proposes/user-confirms (P5), the Operations trio (§13), truthful-or-atmosphere (§14.2), and the never-punish rule (§9.4).

1. **`guided_tour`** — narrated, interruptible flight through a set of memories/nodes; narration traceable to node content. *Lands at:* §15 N7 (tours as saved routes; the Chronicle guided mode is the Deep Past instance). *Inherits:* narration may only say what the memories actually say (§14.2 truthfulness; P7 confidence tiers apply to anything the narration claims).
2. **`fly_to_memory`** — fuzzy reference → flight. On ambiguity it returns candidates with **zero movement** — no confident wrong guesses. *Lands at:* §15 N6 (navigation aids). *Inherits:* §14 atomicity — an unresolved reference is a departure that visibly doesn't happen.
3. **`propose_noticing`** — ambient noticing whose correct output under weak evidence or notification-cap pressure is **silence**. *Lands at:* ship behavior (A18) and resurfacing (P3/P6). **[RECONCILE]** with the audit program's notification work — cap pressure is a shared system, and silence-under-pressure matches the never-punish rule.
4. **`propose_world_change` + `undo_world_change`** — the mutating-world safety rail: **approval-gated**, **append-only transition log**, nothing applies before the owner's yes. *Lands at:* §9.4 mutation model (world state vs presentation state) and step 4 of the settlement sequence (mutation & control), where this becomes a primary input. *Inherits:* §13 P7 — a proposed change renders as a proposal (tier ii), never as an accomplished fact.
5. **`leave_beacon`** — verbatim notes pinned to a place/date; ship-authored beacons are **proposals, never self-applied**. *Lands at:* ship behavior and place design (§9.7 templates gain a beacon question when their turn comes). *Inherits:* verbatim means verbatim — a beacon quotes the user or it doesn't exist.

**Queue discipline:** these wait for their settlement steps (tours/navigation → step 3, already open; mutation → step 4; ship behavior → as spaces mature). They do not reopen steps 1–2, and any of them that touches a shared system carries its **[RECONCILE]** flag into the audit program before any build — which remains, as ever, a separate authorization.

---

---

## 17. Settlement step 4 — mutation & control (King's proposal, owner settles)

How the world is allowed to change — and who holds the pen. Led, at the owner's direction, by the **approval-gated world-change rail** queued in §16 (`propose_world_change` / `undo_world_change`). Builds on settled ground only: the mutation categories and never-punish rule (§9.4), world state vs presentation state (§9.4), confidence tiers (P7), explainability (P6), the Animation Gate (§14), and the ship's fence (§16 — she can fly and propose; she cannot touch brain writes). Proposal only — revised per ChatGPT's review of §17 (2026-10-22; record: `chatgpt-review-4-2026-10-22.md`).

**M1 — The rail: every structural change, five beats.** (1) **Propose** — the brain or the ship proposes a change with its reason and its evidence, in plain language ("These three memories all mention the move to Jacksonville — should they form a cluster in People?"). (2) **Present as proposal** — the change renders, if at all, in its provisional form (P7 tier ii: visibly a suggestion, never an accomplished fact). (3) **Owner decides** — approve, edit, or reject; silence is not approval, and under notification-cap pressure the correct behavior is to wait quietly (§16 `propose_noticing`). (4) **Apply as one log entry** — an approved change lands atomically (§14) and is written to an **append-only transition log**: what changed, why, on what evidence, when (owner's local time), and what it superseded. (5) **Undo is a new entry, never a rewrite** — `undo_world_change` appends a compensating entry that restores the prior state; the log keeps both, so the world's history is never falsified. **Nothing structural self-applies. Ever.**
**Failure rule (review, 2026-10-22):** if applying an approved change fails partway, the required outcome is **no partial structural mutation and no false "applied" log entry** — the change either lands whole, with its entry, or not at all, with the proposal still standing. The mechanism belongs to the later implementation/testing specification; the invariant is fixed here.
**Undo precision (review, 2026-10-22):** undo must **never blindly restore an old snapshot over newer work**. If later changes depend on the change being undone, the system calculates a safe compensation — or explains the conflict in plain language and asks the owner to resolve it. It never silently overwrites subsequent changes. And the distinction is explicit: undo is **logical reversibility, not physical erasure** — the original event stays in history; the compensating entry is what reverses its effect.
**Cadence (review, 2026-10-22):** proposals arrive **batched into a calm review moment — like mail, not interruptions**. No per-proposal interruption, no implied urgency, no countdowns; no approval is ever inferred from silence, inactivity, or a full notification queue. The owner may approve, edit, reject, or **defer**; under cap pressure proposals **wait quietly — they are not discarded and no decision is forced**. A calm pending-proposals indicator and an accessible review view keep batched proposals from being overlooked.

**M2 — Structural vs presentation: the line the rail guards (boundary tightened per review, 2026-10-22).** *Structural* (rail required): creating or removing landmarks, changing confirmed connections, forming clusters, adding or removing anchors, changing primary homes, changing persistent chapter or tour membership — anything §9.4 calls world state. *Presentation* (allowed without individual approval): palette and weather **within the space's established recipe**, ambient traffic and drift, reversible emphasis, and **temporary display ordering**. One subtlety the review caught: ordering is presentation only while it is a *display* choice — **rewriting a saved tour or chapter sequence is structural**. Four explicit safeguards bind every presentation change: **(i) No hidden structural effects** — presentation can never alter canonical memory state, relationships, or saved world structure. **(ii) Explainable** — the user can ask why and get a truthful, plain-language answer. **(iii) Reversible and controllable** — presentation can be reset or disabled without affecting memories. **(iv) Never-punish** — no decay, shame, ominous deterioration, productivity pressure, or any visual implication that an inferred emotional state is established fact. Rich variation lives *inside* these authored boundaries; presentation never quietly rewrites meaning. The user can ask "what changed?" and get the presentation deltas in plain language — a digest on demand, not an approval queue (guard against approval fatigue).

**M3 — Automation levels (proposal).** Structural: **propose-only**, full stop, at MVP — no structural class is eligible for auto-apply, even with undo waiting. Presentation: automatic within M2's bounds. Revisit either only with real usage evidence, as a new decision.

**M4 — Correction edits the derivation, never the memory.** When the user corrects a mis-inference (§9.4/P7), the correction lands on the interpretation layer and is itself a log entry; every surface updates from the corrected derivation (P1). The underlying memory is untouched — the world may be wrong about a memory; it may never rewrite one.

**M5 — Inferred emotion can move weather, never geography.** Tier-iii inferences (emotion tones) may influence *presentation only* — never structure, never clusters, never landmarks. And the standing test governs every mutation output: **show it to a user in the worst week of their year** — if it could read as loss, decay, falling behind, or shame, it does not ship (§9.4).

**M6 — The log is the world's memory of itself — two doors, one record (per review, 2026-10-22).** The transition log is user-readable in plain language through **both** entry points: **on-demand explanations** at the point of use ("Why is this here?" / "What changed?") and a **browsable "World Changes" view** — the chronological history of proposals and outcomes: approvals, rejections where recorded, applied changes, compensating entries. Both doors read the **same underlying log and the same explanation rules** — never two records that could disagree. The view is a reference and control surface, **not another notification stream** demanding attention. It is distinct from the Chronicle: the Chronicle tells the user's life; the log tells what the *world* did and why. Entries carry the brain's own naming and the owner's local time — never UTC, never jargon.

**Step 4 questions — ✅ SETTLED by the owner (2026-10-22, all four as recommended; D-14–D-17). Step 4 is CLOSED.** *(The recommendations as recorded before settlement:)*
- **Q-M1** Presentation bounds: is M2's tightened boundary right — anything there you'd want behind the rail (or anything structural you'd let flow freely)? *King + ChatGPT: keep the line, with the four safeguards and the saved-sequence subtlety as written.*
- **Q-M2** Proposal cadence: batched calm review, or per-proposal surfacing? *King + ChatGPT: batched — mail, not interruptions; defer allowed; cap pressure means quiet waiting, never discard or forced decision.*
- **Q-M3** Undo horizon: any change class that becomes permanent with time? *King + ChatGPT: no time-based permanence — with dependency-aware compensation, never blind snapshot restoration.*
- **Q-M4** The log's home: browsable view, on-demand explanations, or both? *King + ChatGPT: both — one underlying log, two doors; the view is a reference surface, not a notification stream.*

---

---

## 18. Settlement step 5 — visual strategy & the mockup specification (King's proposal, owner settles)

Steps 1–4 settled *what the worlds are, what they hold, how the user moves, and how they may change*. Step 5 settles **how they will look — and how that gets proven before anything is built for real**: the three-mockup test that D-3 made the condition of the technique stack (§10.1/§11). This step settles the mockups' *specification*. **Building the mockups is a separate, later authorization** — settling this spec no more starts a build than settling §17 started a mutation engine. Proposal only — revised per ChatGPT's review of §18 (2026-10-22; record: `chatgpt-review-5-2026-10-22.md`).

**Governing principle for step 5 (from the review): each scene proves a specific design claim; all three belong to one recognizable universe; and none passes by lowering the bar after the result.** A visually impressive mockup is not evidence; a measured one is.

**V1 — The trio, one scene each (each mockup is a proof, not a preview).**
- **Great Station — the approach.** The signature sequence (A13): gate exit → traffic lanes (A17) → the megastructure growing from silhouette to overwhelming → arrival arc. Proves: dual-layer scale compositing, awe-scale readability (V2 silhouette), traffic at budget, the D-13 sun/Station relative-appearance evidence.
- **Growing Place — the rising.** A garden-world vista plus one full landmark-rising (A6) with a connection forming (A7). Proves: structural-change animation at budget, seeded-recipe generation of a living landscape, growth that reads as celebration, not gamification chrome.
- **Deep Past — the descent.** An era-layered vista flown in Chronicle guided mode (§12/D-6): passing era strata, one resurfacing memory placed by A1–A3. Proves: the carry/transit/placement signature end-to-end, era legibility, the calmest palette discipline of the three.
Each mockup is specified by its **environment recipe** (§9.7: Identity / Spatial composition / Meaningful content / Performance & accessibility) plus its **animation inventory slice** (§14.1 fields, incl. combined load + fallback) — a mockup whose recipe or animation slice is unspecified is not ready to build, whenever building is authorized.
**Recipe minimum contents (review, 2026-10-22):** identity and visual grammar · spatial composition and landmark silhouette · meaningful content and what must remain visually honest · performance and accessibility constraints · the relevant animation inventory and combined-load fallback · **which elements are shared universe-wide and which distinguish this space**. The recipes are the reference for V4 traceability (§11.3): a look achieved through undocumented hand-tuning fails traceability even if it looks impressive. Recipes may be revised through this design process when evidence requires it — revision is documented, never silent.

**V2 — Measurement protocol (the §11.2 supplement, made concrete; script expanded per review, 2026-10-22).** Every run records: exact phone model, OS version, browser/runtime + version, build configuration, measurement method/tool, and the **session script** — one shared core script for all three mockups (only the signature sequence differs): cold load, initial scene legible → menu idle 30 s → warp transit + signature sequence (approach / rising / descent) → one A1–A3 placement → **navigate back by the available route and verify the memory's canonical identity and home are correct (§13)** → **cancelled-departure check and mid-transit turn-back check** (where the mockup supports them; neither may create a partial move — §15 N3, §14 atomicity) → **free return home under zero fuel**, exercised in the test harness (no production fuel system is built for the mockups) → 5 minutes free flight → repeat transit via drift → **the relevant run repeated with reduced motion enabled**. The signature scenes alone could pass while travel quietly fails — these behavioral checks exist so the *guarantees* are tested, not only the spectacle. They are **recorded separately** from the visual/performance results: a behavioral pass never substitutes for a visual or performance gate, and vice versa. Thresholds are §11.2's, **unchanged and not renegotiable after results**; visual criteria §11.3's (V1 blind distinctness 3/3, V2 silhouette, V3 artifact-free recording, V4 recipe traceability — a hand-tweaked mockup fails, V5 content honesty, V6 owner's explicit pass/fail per mockup) — plus the cohesion check recorded at V4 below.

**V3 — Build order (when authorized): Station → Growing Place → Deep Past.** The Station is the hardest performance case and the signature; its lessons (budgets, compositing, traffic) de-risk the other two. Each mockup is reviewed against §11 before the next begins — **a failed mockup stops the sequence**, and the failure is diagnosed before anything else happens: was it the **technique stack**, the **recipe**, the **animation load**, or the **implementation**? The diagnosis decides what returns to the owner (a stack failure reopens D-3; a recipe failure revises the recipe through this process; an implementation failure is just fixed and re-run). What never happens: lowering the acceptance thresholds to get a pass.

**V4 — Distinct, but one universe — and both halves get tested (per review, 2026-10-22).** Distinctness lives in palette, spatial composition, landmark silhouette, lighting, and recipe. Cohesion lives in what travels and recurs: the ship, the gate language, the UI voice, memory identity, and the visual grammar of carrying and placing. The counterargument is taken seriously: cohesion carried *only* by the interface could leave three unrelated games in one wrapper. So the blind review tests **two** things: (i) each world is identified correctly (§11.3 V1, unchanged), and (ii) **the three scenes still feel like places within one universe** — a recorded cohesion judgment by the owner alongside V6, not a new numeric threshold, and never solved by making the worlds look alike: shared objects and recurring visual language carry the continuity.

**V5 — Placeholder honesty.** Mockups use the §10 verified free assets and procedural generation only; the ISS does **not** appear (reserved to the Scale Space, D-2 — not in the trio). Anything in a mockup that could not ship as-is is listed in its record, so a passing mockup never smuggles in an unshippable beauty (V5 content honesty, §11.3).

**Step 5 questions — ✅ SETTLED by the owner (2026-10-22, all four as recommended; D-18–D-21). Step 5 is CLOSED.** *(The recommendations as recorded before settlement:)*
- **Q-V1** The distinct/cohesive balance (V4): distinctness in the worlds, cohesion in what travels — right split, or should the worlds share more visual DNA? *Both recommend: the split as written, with cohesion itself tested in the blind review (V4), not assumed.*
- **Q-V2** Build order (V3): Station first, or a different order? *Both recommend: Station → Growing Place → Deep Past, failed mockup stops the sequence, failure diagnosed (stack / recipe / animation load / implementation) before any next step.*
- **Q-V3** The session script (V2): does the expanded script — now with return-navigation, cancel, turn-back, and zero-fuel checks — capture the guarantees that matter, or is a leg still missing?
- **Q-V4** Recipe-first discipline: all three recipes settled on paper before any build is authorized, or recipe-per-mockup? *Both recommend: all three first (King: paper is cheap, and traceability is checked against the recipe; review: recipes may still be revised through this process when evidence requires).* 

---

---

## 19. Settlement step 6 — architecture & roadmap (King's proposal, owner settles)

The last step: how the settled design maps onto systems, in what order it could ever be built, and what stands between here and a closable design gate. This is **design-level architecture** — responsibilities and boundaries, not code design. Nothing here authorizes implementation; every phase below ends at an owner gate, and each phase's start needs its own authorization. Proposal only — revised per ChatGPT's review of §19 (2026-10-22; record: `chatgpt-review-6-2026-10-22.md`).

**A1 — The worlds are a layer on the brain, never a second brain.** The existing app remains the system of record: canonical memories, their content, and direct access live there (§13 P1; D-1's access guarantee). The worlds layer adds four things and owns nothing else: **surfacing** (which canonical memories appear where, under P3/P4/P7), **travel** (routes, gates, gaits, the ship), **world state** (the append-only transition log, anchors, discovered gates — §17), and **presentation** (recipes, rendering, animation — §10/§14/§18). If the worlds layer vanished, the brain would lose nothing but scenery.

**Failure-independence invariant (review, 2026-10-22 — the operational form of A1):** *The brain is authoritative; the worlds layer is disposable and recoverable.* A broken renderer, an unavailable world log, or a failed travel animation may interrupt scenery or travel — it must **never** make canonical memories inaccessible, corrupt brain data, or leave a structural change partially applied. Canonical memories, relationships, archive state, and the brain's existing workflows remain intact even if every world goes dark. This invariant guides all later architecture and failure testing; it introduces no new feature.

**A2 — Component responsibilities (design-level).**
- **Space registry** — the recipes (§18), roster, and per-space rules as *data the design owns*: adding a space is authoring a recipe, not inventing a subsystem.
- **Surfacing engine** — applies P3's rules, P4's invariant, and P7's tiers to decide every appearance; the single place "why is this here?" is answered from (P6).
- **Travel system** — routes and topology (N1), gaits and fuel interface (N3/D-1), the three travel acts (N3), discovery state (N4).
- **World-change rail** — proposals, the append-only log, dependency-aware undo (§17); deliberately mirrors the app's existing approval patterns rather than inventing a second approval philosophy. **[RECONCILE]** with the repo chat's approval work (A4/`pending_approvals`).
- **Ship agent** — the fenced toolset (§16): flight and proposals only; every world-affecting act exits through the rail or the travel system, never around them.
- **Renderer** — one shared rendering system, per-space recipes (§9.7/§10.1), held to §11 budgets and the Animation Gate (§14).

**A3 — Roadmap (phases, each separately authorized, each ending at an owner gate — authorization for one phase is never authorization for the next).**
- **Phase 0 — Recipes on paper.** The three trio recipes written to §18's minimum contents and settled (D-21). *Pure design; this exploration's own continuation.*
- **Phase 1 — The mockup trio.** Build + measure per §18 (needs its own authorization). Ends with the owner's §11 verdicts and the D-3 stack decision: ratified, revised, or rejected.
- **Phase 2 — Travel skeleton + the Great Station.** Home ↔ Station, gates, both gaits, discovery, route plotting — with the Station as the first real space. Surfacing limited to Station rules (journeys, not memories, D-5). **Preconditions (review, 2026-10-22):** this phase begins only *after the design gate closes* and implementation is separately authorized; and travel must preserve direct access to the brain at all times (§15's utility-first principle, made architectural).
- **Phase 3 — One memory-bearing space at a time**, in roster order after the Station: Growing Place, Deep Past (with Chronicle guided mode), People, Scale Space, Quiet/Archive last (D-4). Each space brings its surfacing rules, its animation slice, and its rail integration *as its own gated increment*.
- **Phase 4 — The mutating world.** The rail, the log and its two doors, the ship's proposal tools (§16) — layered in once the spaces they govern exist. (The rail's *design* is settled at §17; its build waits for things worth changing.) *Late-integration risk, answered (review, 2026-10-22):* the rail's architecture and interface boundaries are designed *now* (A2, §17), and the rail is to be exercised against representative proposals before full integration — designing early is how Phase 4 avoids arriving untested, without building the mutating world prematurely.
Sequencing within phases, and any merging of phases, is the owner's call at each gate.

**A4 — Reconciliation register (shared systems; worlds work reconciles before building on them).** Fuel economy — **Q27 (what earns fuel) is still open**, [RECONCILE] with the audit program's gauge/quests work, and designated a **mandatory Phase 2 planning gate**: the earning rules are decided alongside the audit program's economy work *before* Phase 2 implements any fuel behavior — the settled guarantees (warp costs, drift free, home free, access regardless, no stranding/shaming) are sufficient until then · Notification cap & quiet rules — proposal cadence (D-15) and `propose_noticing` silence ride the shared cap · Chronicle — the guided mode consumes chapter data the core owns · Approval machinery — the rail (A2) mirrors A4's patterns · Renderer performance — the home galaxy's own perf history in the repo chat informs budgets, and worlds rendering must not regress it. No worlds phase builds on a shared system before its reconciliation is recorded.

**A5 — The path to a closable design gate.** Per the standing definition (Rev 4): the design gate closes when **mockup results are reviewed** *and* the settlement sequence's decisions are settled. So after step 6: steps settled (1–6) → Phase 0 recipes → Phase 1 mockups (separate authorization) → results reviewed → **owner closes the design gate** → only then does implementation planning for real spaces begin. **Closing step 6 does not close the design gate** — it remains open after this step, exactly as recorded. Open by design until then: Q27, the D-13 sun decision (evidence arrives with the Station mockup), and the per-space animation inventories' completion (§14.4).

**Step 6 questions — ✅ APPROVED by the owner in his own words (2026-10-22: "I approve Q-A1–Q-A4 as recommended"; D-22–D-25). Step 6 is CLOSED, completing the settlement sequence.** *(The recommendations as recorded before approval:)*
- **Q-A1** Roadmap shape (A3): phases as proposed — or a different first real increment after the Station? *Both recommend: the five phases as written, with separate authorization at every boundary.*
- **Q-A2** Space order within Phase 3: **Growing Place → Deep Past → People → Scale Space → Quiet/Archive** (Quiet last is settled, D-4). *Both recommend this order — each of the first three tests a different kind of meaning (progress/evidence; age/eras; confirmed significance), and People follows Deep Past because rule-based surfacing is the simpler test before relationship-derived clustering; Scale follows once anchors are proven.*
- **Q-A3** The single-user assumption: confirm a **private, single-user brain** as the architecture's scope — no shared ownership, multi-user permissions, collaborative editing, or social-world mechanics by implication. *Both recommend confirming — with the qualification that single-user does not make security optional: the existing app's authentication, privacy, and access-control boundaries stand in full. Any future multi-user version is a new design front, not a retrofit.*
- **Q-A4** Q27 (what earns fuel): settle now, or defer? *Both recommend: explicitly defer to Phase 2 planning as a mandatory gate (A4), [RECONCILE] preserved — the settled fuel guarantees suffice for every earlier phase.*

---

---

## 20. Phase 0 register — the recipes (begun 2026-10-22, at the owner's direction)

Phase 0 (§19 A3) is the three environment recipes on paper, each a standalone document in this folder, each settled by the owner before any mockup build can be authorized (D-21).

| Recipe | File | Status |
|---|---|---|
| The Great Station | `recipe-great-station.md` | ✅ **SETTLED** (owner, 2026-10-22: R-S1/R-S2/R-S4 approved, R-S3 name deferred) |
| The Growing Place | `recipe-growing-place.md` | ✅ **SETTLED** (owner, 2026-10-22: R-G1/R-G2/R-G4 approved, R-G3 approved with the non-ranking constraint) |
| The Deep Past | `recipe-deep-past.md` | ✅ **SETTLED** (owner, 2026-10-22: R-D1–R-D4 as recommended, monotonicity constraint included; **A21/A22 ratified into §14**) |

**Phase 0 status: ✅ COMPLETE (2026-10-22, D-26)** — all three recipes settled on paper.
**Phase 1 status: ✅ AUTHORIZED (owner, 2026-10-22, D-27)** — throwaway mockups only, in the order Station → Growing Place → Deep Past, each gated on the previous one's pass; builder brief: `phase-1-builder-brief.md`. Execution status: **begun (owner's word, 2026-10-22)** — Station scene built as a throwaway fixture (mirrored at `docs/worlds/mockups/station/`); **ChatGPT reviews 10–13 (code-level) absorbed**: counter accounting fixed (both passes) + session-peak tracking, harness at §11 session/soak lengths + cold-load, behavioral checks as verified before/after assertions under an enforced armed-departure policy (only Cancel live in the window; fuel floored at 0), elapsed-time animation timing, V4 derivation table documented; **no known code-level items remain** — result record `mockup-result-station.md`: **verdict UNRESOLVED** — §11 grading awaits the owner's phone run. Growing Place remains parked. **Review standard (owner-set, 2026-10-22):** a builder's claimed PASS is not an independently supported PASS — each §11 criterion is checked against the record's actual evidence; missing or contradictory proof leaves the criterion **unresolved**, and the sequence does not advance on unresolved criteria; V6 and design-gate closure remain the owner's alone. The design gate remains OPEN until mockup results are reviewed and the owner closes it.

The draft Station recipe follows §18's minimum contents: identity (crown-and-stem megastructure; amber harbor in indigo dark), the three-stage approach composition with its named dual-layer handoff risk, honest content (journeys real, traffic atmosphere, no memories), a budget allocation inside §11.2's ceilings, the A13/A17/A11/A12/A15/A16/A19/A20 animation slice with combined load and fallback ladder, shared-vs-distinct elements, a seed parameter table for V4 traceability, and the D-13 evidence the mockup must produce.

---

*End of Exploration 1, Revision 63. Workflow (updated 2026-10-22 at the owner's direction): these plans live on GitHub (branch `design/worlds-vision`, folder `docs/worlds/`) so ChatGPT can read and review them there; its review returns to the worlds chat, and this document is revised — not replaced — so decisions accumulate visibly. Phase 2 planning lives in `phase-2-planning.md`; decisions continue to accumulate here.*
