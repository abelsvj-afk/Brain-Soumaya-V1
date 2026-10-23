# The Man-God World — Owner Concept Note (brainstorm stage, 2026-10-23)

Status: **owner-directed addition to the worlds plan, CONCEPT STAGE.** No design gate, no build authorization. Recorded from the owner's own description; open questions and builder pushbacks are marked as such. Placement in the build order is unsettled — by its nature (shared, multi-visitor) it stacks on the shared-presence track, which is itself design-only today.

## The concept (owner's words, organized)

- **A world you travel to — the furthest world reachable.** Getting there is meant to be very hard, very difficult, very challenging: the long journey is part of its meaning.
- **The being:** a gigantic cosmic god on a Marvel-Celestial scale, standing in the world while ships float around him. His FORM is inspired by the Man-God of *Mushoku Tensei* — a completely white, featureless humanoid silhouette — at cosmic scale. For the owner, his face is Jesus: the being stands for Christ, and the world exists partly to show what these worlds and this app are for — how they help people.
- **He barely moves, and movement is monumental.** When he moves a hand, things happen on a world scale (the owner's example: a ship is destroyed and blows up — everyone present sees it).
- **A shared world.** Many people can be there at once, each in their own ship (choosing different ships is a future feature). Visitors do NOT all receive the same message from him — **each person can receive a different, personal message — but everyone sees the same emotion and the same animations.** The animation must relate to the message each person received (animation↔message coherence). Sometimes he may choose for everyone to see the same message.
- **He has a real job.** He is not decoration: he serves a function in how the app helps people.
- **He is automated — an agent, not a script.** He will have his own API key and model access (Gemini or the existing key to start; upgraded models later), and **his own tools**, the way Soumaya has tools — tools that let him interact with and manipulate the worlds in certain ways.

## Design seeds (builder's, from the concept)

- **Emotion is the broadcast layer; the message is the private layer.** The workable contract: a small vocabulary of monumental states/gestures (stillness, regard, sorrow, joy, warning, blessing…). Every message he sends carries one of these tags; all visitors render the same tagged gesture at the same moment, while the words stay personal. Coherence is then guaranteed by construction, not hoped for.
- **His job, candidate shape:** he speaks to what a visitor brings — guidance, blessing, challenge, comfort — drawn (with consent) from what their own brain surfaces. His tools would be world-actions only (speak, gesture, move, reorder light/scenery), never brain-writes.
- **Arrival:** "furthest" fits the travel economy honestly — a long chain of journeys through the other worlds; effort in the fiction, never a paywall (D-1: fuel buys speed, never access; home always free).

## Pushbacks recorded (owner invited them; his calls to settle)

1. **The name carries the wrong story.** In *Mushoku Tensei*, the Man-God is a manipulative deceiver who uses people. If this being's face is Jesus, shipping him under a villain's name invites exactly the wrong reading — especially in a faith-forward app. *Recommendation: keep the form (featureless white colossus), choose his name deliberately as his own.*
2. **Destruction vs the never-punish invariant.** The founding rule of these worlds: the world never punishes — no loss, no shame, nothing real is ever taken. A god who blows up a visitor's ship collides with that head-on, and with failure-independence (the worlds layer must never be able to harm the brain or the person's real progress). *Recommendation: his monumental acts are wondrous, protective, or reordering — or any "destruction" is purely theatrical, consented, and instantly restored, with nothing real ever lost.* The owner's example stands in this note as his raw concept; the invariant is flagged against it for settlement.
3. **Shared means later.** Current scope is private single-user (D-24); shared presence is a separate, design-only track. This world is inherently shared, so it cannot jump the queue ahead of that infrastructure — its "furthest world" nature suits it to arriving late in the order anyway.
4. **An autonomous agent needs a fence, not just a key.** His tools must be allow-listed world-actions (the §16 ship-agent pattern), with anything structural going through propose→decide (§17) — he never writes to a brain, never reaches outside his world uninvited, and his spending runs under a budget. Power with a fence is what makes him trustworthy enough to meet.

## Open questions (for the brainstorm, not blockers)

- His name, and how visitors address him.
- What earns arrival — journey chain only, or also milestones (the Growing Place's language)?
- Can he initiate (speak first), or only answer those who come?
- What happens to a visitor who never comes — nothing, presumably (never-punish).
- One being across all visitors, or an instance per visitor rendered in a shared space (the presence model decides).
- His memory: does he remember a visitor between visits — and if so, whose data is that, stored where, deletable how?
