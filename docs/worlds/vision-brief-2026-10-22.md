# Vision Brief — Many Spaces, Jump Gates, a World That Mutates (owner ideation, 2026-10-22)

RAW VISION — captured from the owner's voice notes the day he said it. Nothing here is a settled decision except the direction itself: **take the space layer up a notch, designed properly before anything is built.** Design happens in the dedicated worlds chat, co-designed with ChatGPT via the relay pattern. No implementation is authorized by this brief.

## The idea in his words, organized

1. **Many spaces, not one galaxy.** Beyond the home galaxy there are other distinct spaces the ship can travel to and the user can witness. A few of them, not dozens — each with **different scenery** and a **different purpose** (the purposes are still his to figure out, with ChatGPT's help in the design loop).
2. **Jump gates (EVE Online is the touchstone).** Travel between spaces happens through gates. The transit is not a cutscene or a plain loading screen — it's a space you move around in while you travel, and then you arrive. Gates may have conditions or discovery attached ("certain things you can do to get to the jump gates").
3. **Directed travel.** When the ship is the focus, the user can direct her — click places and she flies there: guided tours, directed visits. (He mused about freer flying, EVE-style, but directed navigation from the focus state is the core ask.)
4. **Real scale, somewhere.** In the home galaxy the sun is symbolic, not to scale. He wants at least some spaces where scale is FELT: fly toward the sun and it grows; distances read as vast; you may never arrive, and that's the point — space at scale (his EVE memory).
5. **Real and placeholder content.** Real celestial content where it can be pulled in (real asteroids, real bodies) instead of only invented ones. 3D assets for now are free/placeholder — "player" content for the current build. Later, with a computer and money, he'll swap in real produced content for the final version. This phase is about getting it **fleshed out properly** as something to reach toward.
6. **A mutating world.** The world changes depending on the person: their memories — good or bad, the emotion in them, their growth, their aspirations — and on how they interact with it and its gamification. The brain shapes the universe it lives in.
7. **The core stays a second brain.** All of this sits ON TOP of the brain, to make coming back to remember things *entertaining* — scenery and gamification in service of memory, never instead of it. The design question every space must answer: **how does this space contribute to the second brain?**
8. **Inspiration, not copies.** EVE Online (gates, warp, scale, different spaces with different characters) and No Man's Sky (variety, discovery) are references for feel — not templates to clone.

## Foundation this builds on (already shipped in the home galaxy)

- One galaxy: sectors per category (Views), a Money sky, Journeys layers, a sun the camera can approach (with a gentle floor stop), planets = memories/nodes, tubes/links between them.
- The ship: focus/follow mechanics (🎯 Focus fan: ship, Station, Fleet, Beacon, Visitor, Figurine), fuel gauge, streak ember, ship-status stack.
- Chronicle (chapters/seasons of a life), quests, Codex, Awards — the existing gamification skeleton any travel system must plug into honestly.
- Standing design rules that apply here too: name-bearing UI reflects the brain's own name (never hardcoded); NO UTC anywhere user-facing; reward honesty (never imply a reward that doesn't exist); ethical retention — compelling and valuable, never compulsive, no punishment for absence.

## Open questions the design loop owns (owner decides, ChatGPT + King explore)

- What is each space FOR — what second-brain function lives there that the home galaxy doesn't already serve? (Candidate territory to explore, none decided: memory types, life domains, time — a "deep past" space; growth/aspiration — a space that visibly grows; people/relationships; a quiet/archive space; a scale space that exists for awe and perspective.)
- How are gates found, unlocked, or earned — and does "earn" fit the reward-honesty rule?
- What does transit feel like, how long, what can the user do inside it?
- What exactly mutates, driven by which signals (memory emotion? growth milestones? interaction patterns?), and can mutation ever feel like punishment for a bad week — if so, how is that prevented? (Owner's guardrail: the world must never punish.)
- How do tours work — who authors them (Soumaya? the user? the system from Chronicle?), and what do they surface?
- Scale space: one destination or a mode? What lives there besides scale itself?
- Placeholder-asset strategy: which free 3D sources, what visual coherence rules so placeholders can be swapped 1:1 later?

## Coordination (two chats on one app)

- **This work lives in the worlds design chat.** The Soumaya repo chat runs the audit program (48 surfaces), the Money repair (ADR-019 design gate), and the standing backlog. Both chats know about each other through memory; designs from here that touch shared systems (fuel, quests, notifications, the galaxy renderer) must be reconciled against the audit program's findings before anything is built.
- Workflow here mirrors the house pattern: explore → short design draft → owner relays to ChatGPT → review returns → revise → owner settles decisions → (much later, separately) implementation authorization. Nothing in this chat authorizes code.
