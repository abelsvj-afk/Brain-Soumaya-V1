# NPCs that live, roam and are met — 2026-10-30

Owner: "NPCs can live and free-roam. They don't feel like they are, and they aren't felt, encountered or anything." (Also: the chat ✕ was off-screen — fixed
separately by moving it out of the scrolling tool row; the Gemini key is now on Fly, so two keys exist — see §5.)

## Measured problem
- The Harbor controller is a ship **moored at one berth, forever** (`harbor-controller-ship`, never moves), with no name, no tag, nothing to tap; her
  only door is a "Harbor" dock tile. Eternity is one cosmic figure in a white void; he is "present" only through gestures you perform.
- Nothing ever says "someone is here". No meeting is ever recorded, so nobody is ever *met*.

## Rules that stay (the NPC fence — shared/npcs.ts)
An NPC never acts outside its own world; nothing structural; the harbor controller **answers only** (never initiates speech); Eternity alone initiates, rarely.
So: this increment is **presence**, not new acts. Movement and ambient description are presentation (like a ship's idle motion); no new speech, no logged act.
**Cross-world roaming** (an NPC visiting the home galaxy or another world) would cross the fence — it is NOT built; it needs the owner's explicit OK (§5).

## Design
1. **Roaming (Station):** the controller keeps a daily-rhythm patrol: docked at her berth → leaves → one lap round the Station → returns, on a 5-minute cycle keyed
   to the wall clock (a reload resumes mid-lap; same for every viewer). Pure maths (`graph/npcPresence.ts`: `patrolAt`), continuous at every phase boundary
   (tested), reduced motion = she stays docked (no motion) but is still found, tagged and met.
2. **Seen:** every NPC in the world you are in wears a **name tag** (icon + name + what she's doing: "patrolling" / "docked") that follows her on screen; it is a
   real 44 px button (tap = open her panel). Never colour alone.
3. **Findable:** a **Who's here** dock group lists the NPCs of this world; tapping the Station's controller flies your ship to where she is *now*; Eternity's tile
   says plainly what he is and how to answer him.
4. **Met:** coming near an NPC (your ship or the camera within range, hysteresis so it never flickers) is an **encounter**: one ambient line ("The Harbor controller
   sweeps past on patrol. Tap her tag to talk.") — description, not her speech. The first meeting ever is recorded per brain ("You've met the Harbor controller — she's
   who you ask about routes"); later ones count. Per-visit once, 20-minute cooldown. Stored locally per brain (presentation memory only; the server log is unchanged).
5. **Keys:** the shared LLM provider still prefers OpenAI when both keys exist; **Eternity's voice uses Gemini through his own provider regardless** (shipped
   2026-10-30), so with both keys set nothing changes for him; Soumaya's chat keeps its configured provider.

## Not built / owner questions
- Cross-world visits (an NPC appearing at home or in another world): fence change, needs a decision.
- A roaming Eternity: he is cosmic scale in a void; he stays put and "is here" (tile + first-meeting note). His own acts remain his loop's.
- New NPCs (keeper, guide): the roster/UI is generic now (`NPC_PRESENCES`), so each new one is a table row + a body.

## Acceptance
Pure: patrol is continuous, periodic, deterministic; near/far hysteresis; meeting store counts. Browser (412×915): the controller's world position changes between
samples taken a minute apart in sim-time; her tag is on screen and opens her panel; the Who's here tile flies to her; an encounter toast fires once.
