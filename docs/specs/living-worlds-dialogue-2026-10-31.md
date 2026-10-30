# Living worlds: lore you can see, people you can talk to, places that have a past (spec, 2026-10-31)

*Owner (2026-10-31): "I don't see the lore in the Book in the app … lore was also attached to the world in games like Elden Ring — how places were designed, locations … NPCs should be able to stop when you're talking to them and have some dialogue to go through for help with lore immersion and also just good communication … the world has to feel alive and immersive … some things I think you left behind after going the lore direction."* This is the plan; **no code is written until the owner nods** (Rule #1). It does not replace the locked lore (`docs/lore/`), the Book spec, the spots spec (`lore-physical-spots-2026-10-31.md`) or the NPC specs; it joins them.

## 1. What is true today (measured by reading the code, 2026-10-31)
1. **A brand-new brain sees an empty Book.** Every entry is a *find*; none is held at the start. Finds come only from: the shipped relics, a met person's gift after 3–6 meetings, a stranger's cup on a later day, or Regard/Listen **at a physical spot** with the ship parked, **once per local day per world**, in the entry's Hour or on a ~1-in-3 seeded "good day". I made it that slow on purpose (owner: "too easy to surface") and added no cue telling a player where to look. Net: days of play before a first light, and nothing explains why. That is my overcorrection.
2. **The people are not the lore's people.** `NPC_CAST` is nine *provisional* placeholders (Keeper, Archivist, Surveyor, Wayfarer, Cantor, Broker, Dissenter…) with `lore.layers: []`. Item Reactions already map them to the canon voices (wayfarer→Calend, cantor→Ysmerel, broker→Dorrow…) but on screen they are still placeholders with a stat card (activity, faction, wants, an overheard line).
3. **There is nothing to say to them.** Tapping a name tag opens a card; there is no conversation. The harbor controller answers route questions in her own panel; nobody else answers anything. An NPC keeps moving on its clock while you look at it.
4. **Places have names but no past.** The spots anchor *finds* to landmarks, but a landmark itself says nothing. Nothing in a world reads like an Elden Ring item or place description.
5. **The art is not in the app.** The 156 images live in `docs/lore/art/` (excluded from the Docker image). The Book shows words only.

## 2. Slices, in the order I would build them (each is shippable alone, each gets its own tests + a measured check)
**S1 — The Book is never empty (small).**
- Every brain *holds* the opening of the story from the first open (the First Morning anchor, one entry), with a plain line: "More of this is out there — in places, and in people." No counts, no percentages (the Book's no-digit rule stands).
- **Owner preview:** owner-only "Preview all" switch in the Book lights every entry **locally, read-only, recording nothing** — so the owner can read and judge the lore without playing for days. (Keyed on `OWNER_SPACE_IDS`, like the Voices console.)
- **First-visit answer:** the *first* time a brain stands still at a spot in a world it always answers (no good-day roll); the once-a-day limit and Hours stay. The slowness then starts after a first taste.
- **Where to look:** NPCs hint (see S3) so the player is never guessing.

**S2 — The cast becomes the lore's people (medium; needs the owner's naming nod).**
- Rewrite the nine placeholder cast rows to the canon people they already stand in for (ids stay stable so nothing in storage breaks; only name, job, voice, home, `canon: "canon"`, tagline, intro, greetings and `lore.layers` change). Mapping to confirm: wayfarer→Calend, cantor→Ysmerel, broker→Dorrow, plus the Keeper, Archivist, Surveyor and Dissenter as the Bible names them. Eternity and the harbor controller keep their fences.
- Each person gets 2–3 **lore layers** unlocked by meetings (the field exists, empty): a layer is a dialogue topic in S3, never a gate on anything else.

**S3 — Talk to people (the main build).**
- **Stop and face you.** Tap a name tag → "Talk". While the panel is open the NPC **holds its place** (presentation only: its clock position is frozen at the moment you tapped and its ship turns to your ship; its activity reads "talking with you"), then **resumes** where the clock says it should be when you close. No server change; the clock functions stay the single truth.
- **A conversation, not a card.** The NPC's line (their voice, via the existing role-voice narration if sound is on; captions follow) and **3–5 choices**: *Who are you? · What is this place? · What do you do here? · (a layer topic you have unlocked) · Is there something I should look for? · Goodbye.*
- **"Is there something I should look for?"** is the lore help: the person points — in their own words, never a number or a map pin — toward something you have not found in their world ("Sethane keeps a cord at the old station. Stand near it and be quiet."). Chosen deterministically from what you have not yet found; if you have found everything there, they say so kindly. This is how the player learns where lore lives.
- **Authored and offline.** Trees live in `shared/npcDialogue.ts` as data; every choice leads somewhere, nothing dead-ends, no choice costs fuel/credits/anything, lines carry no digits and obey the banned-phrase list. No model is needed (offline stays complete). The daily batched model script may still colour a *greeting*; it never writes the tree.
- **Fences kept:** Eternity **cannot be asked** — he gets no conversation; you stand in his presence with the gestures as today. The harbor controller's route/price answers stay deterministic and become one *topic* in her conversation. Nothing here is a way into a personal brain.
- Placed beside, not over, the HUD at phone width (≤ 55 % of the screen), Escape closes, 44 px choices, reduced-motion = no sliding, never colour alone.

**S4 — Places that have a past (Elden Ring-style).** `shared/placeLore.ts`: one short passage (1–3 sentences, item-description voice) per important landmark, keyed to the same named holders the spots use. **Inspect** (a tap on the landmark while parked beside it, or a button when you are within reach) shows it in the lore card; a few passages are the *surface* of a Book entry (reading it can be the trigger for that entry — still server-validated). First pass: the Station (drydock, the rotating ring, the annexes), Deep Past (rim, stair, basin, spire), Quiet/Archive (the still threshold, the field), People, Scale, the garden's witness tree. Eternity: the three view-spots already there.

**S5 — The world breathes.** Ambient, no new rules: the Hour tints each world's light a little and moves who is where (the Hours clock exists as pure code, with no visible surface); NPC pairs exchange short visible exchanges (the clock already pairs them); a **rumour** line on arrival ("Dorrow's ledger has gone quiet this week") drawn from the person's layers; the lore art appears **in the Book** beside its entry, but only once found (images downsized to a web-friendly size and served from the app, not committed at 270 MB — see §4).

## 3. Left behind / still open (so nothing is forgotten)
Not built: Hours clock surface (S5) · Rumours (Draft 5; folded into S5) · NPC economy (money/fuel are captions) · faction consequences and rivalries · per-faction visuals · Eternity free flight · Eternity physical model beyond three view-spots · invitations into personal brains · Scale's missing models (owner upload) · first-visit weight (Muse slimming) · tap-to-fly and everything in the Pending Validation list still needs the owner's phone · lore art not yet shown in the app (S5) · image-prompt §§37–42 (Draft 5) never generated.

## 4. Decisions I am making by default (owner may overrule)
- Conversation is **authored choices**, not free text — free text to an NPC would need a model call per line, break offline, and re-open the "she only answers" fence.
- The Book **starts with one light**, never empty; everything else stays discoverable. Owner preview is read-only.
- Art in the app = **web-sized copies** (WebP, ~1280 px) generated by a script, kept out of git history growth: store in a release/volume, not the repo.
- S1 first (hours, not days), then S3 with S2's names, then S4, then S5.

## 5. Questions only the owner can answer
1. **Names:** may I rename the placeholder cast to the canon people as in S2 (wayfarer→Calend, cantor→Ysmerel, broker→Dorrow, the rest per the Bible)?
2. **Pace:** with the first-visit answer and the NPC pointers, is "once a day per world after that" still the pace you want, or looser?
3. **Art in the Book:** show the canon-pick image beside each found entry (S5)?
