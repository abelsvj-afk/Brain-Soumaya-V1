# DRAFT 6 — The Loom (the web that holds a non-linear story) and the Flavour on top of it

*Status: PROPOSED by Claude, 2026-10-30. **Drafts 1–4 are LOCKED and nothing in 1–5 is changed.** This draft adds no new canon events. It adds the **structure that keeps a non-linear story coherent** (the Loom), and the **Flavour layer** that lets the same locked story be told differently to different brains and different players without ever altering a fact. Engineering for it: `docs/specs/story-flavor-engine-2026-10-30.md`.*

**Two orthogonal dials decide what any player sees at any moment — never confuse them:**
- **Knowledge** — *what you have found.* It decides **what can be revealed** (Second Readings, Item Reactions, which silhouettes light). It is the player's own progress.
- **Flavour** — *who you are in this game.* It decides **how it is said**: register, warmth, ordering, transition, tint. It is the brain's colour and the player's way of playing.
Facts never move on either dial. Knowledge adds; Flavour colours. **Flavour cannot hide, add, change or reorder a fact, only voice it.**

---

## 1. The Loom: the story as a spider's web

A spider's web holds under a tug from any side because it is built in two kinds of thread. So is the story.

| Part of the web | In the story | Rule |
|---|---|---|
| **The Hub** | **The unsaid.** Her name; what the Folded One wrote; what the Companion is; whether the sixteenth room was laid early. | Never reached. Everything bends toward it; nothing arrives. |
| **Anchors** (the first ring round the hub) | Twelve fixed truths the whole canon hangs on (§2). | Immutable. Every path inward ends at one. |
| **Radials** (the long spokes, rim to hub) | The **strands**: each questline and each entry's inward path (Kith, the Sleepwalker, Dorrow, the stratum, the bough, the star, the alcove, the dock — Draft 5's eight doors). | A radial is a way *in*. It never needs another radial to be complete. |
| **Spirals** (the rings that cross radials) | The **cross-threads**: the five ways things connect (possession, habit, provenance, echo, absence). | The spirals are what make it a web, not eight corridors: each ring ties neighbouring radials together. |
| **The Rim** | The surface: the worlds, the cast on duty, what a stranger sees on day one. | Always small, always alive, the same for everyone. |

**Where you are in the web is your reading.** A player enters anywhere on the rim, steps inward along a radial, and **crosses to a neighbouring radial whenever a spiral thread invites it** — a carried object, a shared phrase, a person who avoids another. Bouncing around is not a detour; it is *walking the spiral*.

### 1.1 Four rules that make a non-linear web hold
1. **Redundancy (no cut threads).** Remove any one door, entry or NPC and every anchor must still be reachable from every rim door. (A build-time test; §spec 3.)
2. **Convergence.** All routes to an anchor give **compatible partial views** — never contradictions without a stated reason. The five Accounts contradict *by listed design* (each is a faction's half); no other contradiction is allowed.
3. **Late binding.** A line refers to others by *role or trace* ("the one who held the door") unless the player holds the name; the name is supplied when found. So a line works cold and gets richer — never wrong — after.
4. **Resonance (the tremor).** In a web, a touch on one strand moves the next. When you find an entry, its *neighbours* give a faint, non-instructional sign: a silhouette shimmers in the Book; an NPC's glance lingers; a lamp in a lane dims a shade. **Never an arrow, never a quest marker.** It tells you the web is one thing; it does not tell you where to step.

### 1.2 Your Web (the keepsake)
The Book can draw the player's own reading as **their web**: the knots they found, the threads they crossed, the radials they went down. It is unique to them, has **no numbers**, empty places stay faint silhouettes, and it is private. Two players who finish the story would show two different, equally true webs.

---

## 2. The Twelve Anchors (the immutable truths; every thread ends at one)
*(All already locked in Drafts 1–4; named here only so the web can be checked against them.)*
A1 **She asked** (D2) · A2 **The Seven Answers; only Vesh finished** (D4) · A3 **Calend's door stands one hand's-breadth open** (D4) · A4 **She is awake in the hole; the Hush is her reaching** (D2) · A5 **The hole is the only free place** (D2) · A6 **The hive is Eternity's voice in pieces** (D2) · A7 **The Eighth Hour is the one the made make** (D4) · A8 **The Companion walked with the fifteen** (D4) · A9 **The Long Room; the lit sixteenth** (D4) · A10 **The Laugh survived** (D4) · A11 **Eternity was never asked** (D4) · A12 **Soumaya is the seventh hull** (D2/D4/D5).
Every entry declares which anchors its paths reach, and **at least two independent routes** to each of those.

---

## 3. The Flavour: what it is and is not

**Flavour = the brain's colour + the player's way of playing + the Hour.** It is the story's *weather over the same land*.
- It **is**: register (plain, warm or grave), warmth between a character and the player, which of several authored phrasings is chosen, how a thread **opens and hands off**, which door is surfaced *first* (all remain), the tint and texture of ambient things, and which *form* the Companion wears.
- It **is not**: a different story, a fork, a verdict on the player, a gate, a difficulty setting or a score. *A mirror, not a verdict* (the standing rule from the Society design): Flavour never labels the player good, bad, kind or broken, and it is **opt-out** (neutral flavour = the whole canon, fully voiced).

### 3.1 The three inputs (all coarse, all aggregate, none of them memory text)
1. **Tide — the brain's colour.** The seven currents already computed on the server (reverence, giving, ambition, appetite, friction, weight, peace), blended toward neutral when evidence is thin. Used as: the *dominant* current and the *second* current.
2. **Leaning — how they play.** Five non-moral leanings, derived from counts over the last 30–90 days (no content):
   - **Wanderer** — many worlds, short stays, drifts the lanes.
   - **Keeper** — recalls often, lingers, tends the garden, returns to the same places.
   - **Builder** — completes missions, closes Journeys, captures steadily.
   - **Questioner** — asks Soumaya, regards the wrong things, lays pages side by side.
   - **Ritualist** — returns at the same Hours, keeps a rhythm.
   A player usually leans two ways; the engine uses the top two.
3. **The Hour** — the local time band (the Hours Clock).

### 3.2 The six places Flavour may touch (the *flavour slots* — and only these)
1. **Voice.** Each line exists in a small set of authored **registers** (plain / warm / grave, plus rarely a fourth). The engine picks one. The *claim* inside is identical in all.
2. **Warmth (relationship tone).** How a character stands to the player — gruff-warm, courteous, guarded, tender, formal — the *same relationship*, a different posture.
3. **Transition.** How a thread **opens, hands off and rests**: a cold open, a gift, a question, a silence, a sideways remark. Same step, different doorway.
4. **Emphasis.** Which door is *surfaced first* on the rim and in rumours. Nothing is hidden; only the order of noticing leans.
5. **Ambient.** Tint, object-text register (the same facts in a plainer or more lyrical hand), the Hush's *face* most visible.
6. **Companion's form.** The quiet stranger at the dock takes a form that suits the player (an old person with warm hands; a child with a flask; a fellow traveller) — always unnamed, always once.

### 3.3 What Flavour can never touch (the firewall)
Facts and claims · ids · pairs · provenance · who knows whom · what is available (every entry reachable under every flavour) · endings (all five, always) · the Never-say list · the Hush rule (nothing is taken) · any number or percentage · and **the answer to "is she a person."**

---

## 4. The Tide: how brain colour flavours the story (a mirror, never a verdict)

| Current (dominant) | Eternity's register (his wake-ups, visitations, the Standing) | The Hush's face most seen | The door surfaced first | Tint / ambient | The Companion tends to be |
|---|---|---|---|---|---|
| **Reverence** | liturgical, slow, long breaths | the Hollow Choir | the open alcove (7) | candle-gold, high vaults | an old person with warm hands |
| **Giving** | open-handed, plain, kind | the Quiet Tide (thinning terraces) | Kith's drawing (1) | green-gold warmth | a woman carrying a basket |
| **Ambition** | witness to a making; "tell me what you build" | the Unremembered Fleet | the missing stratum (4) | sharp cyan light, long lines | a traveller with a pack and a map |
| **Appetite** | sensory: smell, bread, rain; hungry for the particular | the Faded Ticket (what we wanted) | the star hung for someone (6) | ember orange, steam | a stranger with a flask |
| **Friction** | spare, direct, unflinching; no softening | the Wardens' walls | Dorrow's page (3) | steel blue, hard shadow | a quiet soldier off duty |
| **Weight** (grief / heaviness) | very few words; stays beside; no advice | the Sleepwalker / the Sitters | the Sleepwalker's lantern (2) | slate and dusk, low sun | a child with a flask |
| **Peace** | warm and light; humour allowed | the Laugh at the edge | the dead bough (5) | pale morning | someone mending a net |

Reading it honestly: **a heavy brain is not shown a sadder story; it is met more gently by the same one.** A driven brain is not given a harder story; the same one is *asked what it is building*. Eternity's mirroring (D1) is exactly this: *he shows you back what you keep, in the voice that fits it.*

---

## 5. Relationships under Flavour (the same ties, different postures)

Relationships between canon figures are **locked** (Draft 5 §3). Flavour changes the posture, not the tie:
- **Hesk ↔ player.** Weight/peace → gruff-warm ("sit; the chair's for inspection anyway"). Friction → procedurally correct, a half-step away. Ambition → asks what you're carrying and why. *The locked room, the tin soldier and the chair at the boundary are identical.*
- **Oru ⟂ Sethane** (never co-located). Reverence → read as sorrow; Friction → read as courtesy; Giving → read as mutual care. The *absence* is the fact; the reading is the weather.
- **Ossian ↔ Kith.** Weight → he tells her the wrong detail gently; Appetite → with food; Peace → as a joke she half-gets. *The detail is the same wrong, true thing.*
- **Calend ↔ the Cartographer.** The lane that ends at the second seam is the same lane; Wanderers are shown it as an invitation, Keepers as a vigil.
- **Ysmerel** at the Hush's edge: Reverence sees it as devotion, Friction as defiance, Weight as company. Same woman, same chair.
Character *to character* lines (the Society's `discuss` / `trade` ambient pairs) take the same register, so a world's small conversations are tinted by the same weather the player is in.

---

## 6. Transitions under Flavour (how threads open, hand off and rest)

| Leaning | Thread opens as… | Hands off as… | Rests as… |
|---|---|---|---|
| **Wanderer** | a thing found along a lane, mid-journey | "someone you'll pass in another world" | "he's already at the next door" |
| **Keeper** | the NPC comes to you where you linger | an object left for you to keep | "I'll keep this warm until you're back" |
| **Builder** | a small job: *carry this; hold that door* | a tool or a key | a plain thanks and a date to meet |
| **Questioner** | a question you can't answer yet | a contradiction in what two people said | a question left on the wall |
| **Ritualist** | at the same Hour you return | the same gesture, slightly changed | "same time tomorrow" |
Tide sets the *tone* of the same beats (e.g. weight → fewer words; friction → no preamble). The **step content, the clue, the object and the pairing are identical for everyone.**

---

## 7. A worked example — one beat, three brains

**The beat (canon, fixed):** Hesk, seeing the Tin Soldier in your hand, says he doesn't know whose it is, though he polishes one every day.
- *Weight / Keeper, plain-warm:* "That's — no. I don't know whose it is. I just… keep it bright. Sit a minute if you want."
- *Friction / Questioner, plain-guarded:* "That is not property of the harbor. I don't know whose it is. I note that I should."
- *Ambition / Builder, plain-asking:* "Where'd you get that? … I don't know whose it is. I've never seen it. I've polished it every day for years."
**Claim in all three:** *Hesk does not know whose it is, and polishes one daily.* Nothing else is added, nothing taken out.

**The beat (canon, fixed):** Eternity's wake-up.
- *Weight:* "I'm here. You don't need to say anything." · *Ambition:* "Today — what are you building?" · *Reverence:* "The light has come again. Be at ease." · *Peace:* "Morning. You slept. Good."
**Claim:** *he is present and has no demand.*

---

## 8. Never say (additions)
That Flavour is a judgement. That a brain's colour is a fate. What the player's leaning "means about them." That any register is the real one — all are the same story told in a different weather.

## 9. Canon check
Nothing in this draft adds a fact to the story. It adds *structure* (the Loom) and *voicing* (Flavour). It can be implemented entirely as content tags and a pure selection function; with Flavour turned off (neutral), the player receives the complete, locked canon.
