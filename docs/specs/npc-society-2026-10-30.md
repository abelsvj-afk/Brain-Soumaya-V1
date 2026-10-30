# NPC society — they live, roam the worlds, speak, and carry the lore (owner 2026-10-30)

Owner: "Let NPCs cross worlds too. I do want NPCs speaking. We need multiple NPCs, and canon NPCs tied to the lore — open-ring, deep like Elden Ring: people
still discover things years in. NPCs have their own identity, life and jobs. They can cross into different worlds, but NOT into personal brains — only if invited,
and people will really only invite other players, once there are other people."

## The new fence (replaces "an NPC never acts outside its own world")
- An NPC has a **home world** and a list of worlds it **roams**. It may be in, and act in, its home world or any world it roams — never anywhere else.
- **Personal brains (the home galaxy) are never entered.** `NPC_NEVER_WORLDS = ["home"]`, enforced in the server fence and in the shared location function.
  An invitation mechanism (a player inviting an NPC, or another player, into their brain) is a future feature — NOT built, and nothing here prepares a back door.
- Allow-lists, budgets, "nothing structural self-applies" and the kill switch are unchanged. Roaming and speaking add no structural power.

## Where they are (their lives)
- `npcLocation(member, nowMs)` — a pure function in `shared`: the day is cut into 2-hour slots; per slot each NPC is at home with its own probability or at one of the
  worlds it roams, chosen by a hash of (id, slot). Server and web compute the same answer from the clock — no new server state, no table, nothing to drift, the same
  place for every viewer. Non-roamers (Eternity: cosmic, and he does not leave his world) always answer their home world.
- Each NPC has a **job** and a short **life** (what they do and where they go), shown on their card and fed to the daily script so their words fit who they are.
- When you are watching and one leaves/arrives the world, you get one quiet line ("The Harbor controller has left for Scale").

## Speaking
- NPCs **speak** in encounters (first person, in quotes, short). The harbor controller still ANSWERS your questions in her panel from live state (routes, prices, arrivals
  stay deterministic code, never model text); what changes is that she and the others also say a line when you cross paths.
- The words come from the daily batched script (docs/specs/npc-daily-script-2026-10-30.md) — still ONE call per brain per day for the WHOLE cast; offline each NPC has
  its own greetings, so nobody goes silent when there's no key. Situations: near / first meeting / visiting-away-from-home (+ the legacy harbor/Eternity ones).

## The cast (a data table — adding an NPC is a row + a ship)
- `NPC_CAST` in `shared/npcs.ts`: id, name, home world, roams, job, life, voice, ship model + trail colour, `speaks`, `canon`, `lore`.
- **Autonomous** NPCs (the harbor controller, Eternity) keep their loops/allow-lists/budgets; the other cast members are **ambient**: presence, location, words — no act loop yet.
- Provisional cast shipped now (clearly `canon: "provisional"` — placeholders so the world has people, to be rewritten or replaced once the owner defines the lore):
  the Keeper (Growing Place), the Archivist (Quiet), the Surveyor (Scale), the Wayfarer (no home world; roams everywhere, the lore's loose thread).
- NPC bodies are real ships (Quaternius low-poly, already in the repo), each with an engine flame + trail like Soumaya's (graph/enginePlume.ts), roaming a lap of the
  world they are in, with a name tag, a Who's-here entry, and meetings recorded per brain.

## Lore (the open-ring framework — content is the owner's, mechanism is ours)
- Principle: **never explain; leave threads.** A little on the surface, more for those who keep meeting people and looking, some of it only discoverable by connecting
  two NPCs' words. Years of finding things, not a quest log.
- Data hooks, ready now and empty of canon: each cast member has `canon` ("canon" | "provisional"), `lore.tagline` (the surface line), and `lore.layers` (planned: a deeper
  line unlocked at N meetings, and keys that link NPCs together). Meetings are already recorded per brain; a layer reads them.
- **NOT written, and not invented by me:** the story. A dedicated lore session with the owner comes first (the owner said so). Until then provisional NPCs carry no canon claims.

## Not built
- Invitations into personal brains. NPC acts beyond speech/presence for the ambient cast. Lore layers' content. NPC-to-NPC conversations. Per-NPC models/keys (they share the one batch).

## Acceptance
Pure: location is deterministic, never `home`, non-roamers stay put, roamers spend roughly their home share at home, and two calls agree. Server: the fence allows a roamed world and
refuses `home`/unlisted worlds. Script: one call covers the whole cast; speakers may be quoted. Browser: with the clock moved, an NPC that lives elsewhere appears in the world it is
visiting, with a flame, a tag and a Who's-here tile; the Station controller still patrols; no NPC is ever shown at home.
