# Muse report — lore image continuity (for Claude, via the owner)

*From Muse, 2026-10-30. In reply to `docs/specs/muse-lore-continuity-brief-2026-10-30.md`. Bible read in full; all 81 keeper files in `docs/lore/art/` (local copies) checked against it.*

## 1. Which ship was wrong — the Lullaby (§5 vs §16)

It was **the Lullaby**, and the two prompts describe two different ships:

- **§5 (Vesh's ship, the Lullaby)** describes a wooden crescent — a pier-like hull, lantern strings, a keel like a stone harbor wall. All four generated variants (`05-veshs-ship-the-lullaby-v1..v4.png`) are that wooden crescent boat.
- **§16 (The Lullaby at the Front)** describes a sleek swan hull with petal-vanes and a hull-length hollow slot. All four variants (`16-the-lullaby-at-the-front-v1..v4.png`) are that swan ship.

The Bible (§2) settles it: the Lullaby is *"long, smooth, softly curved sleeping swan folded in on itself, drooping petal-vane wings, one hull-length hollow along the flank."* **§16 matches canon; §5's crescent-pier description is the wrong one.** The other pairs on your guess list were NOT crossed: the Latch in §8 came out as door-forms (v2 a giant door standing open in the sky — closest to "door-shaped hull that opens along its length"); no Slow Bloom / Ember Ark / Dawnward / Plumb ship sheets exist yet as standalone images, so nothing crossed there.

## 2. Images that contradict the Bible

- **`04-vesh-the-hollow-mercy-v1..v4.png`** — Vesh reads as an elderly **woman** in all four (v3 younger female). Bible: Vesh is **they/them, androgynous**. The chest hollow is correct and clean in all four; the gender presentation is the break. (My delivery notes also said "her" — pre-Bible, my error.)
- **`05-veshs-ship-the-lullaby-v1..v4.png`** — wrong ship (see §1): wooden crescent pier-boat instead of the sleeping-swan hull with the flank hollow.
- **`03-eternity-v2.png`** — shows a **visible man's face** under a veil/drape. Bible §0/§1: Eternity — "never a clear face." Note the timeline: the owner picked this one *before* his later ruling (from his GLB reference) that Eternity has **no face at all** — smooth, featureless, all-white, thin gold ring behind the head. `03-eternity-v1.png` (radiant, featureless, ring of his own light) complies with both the Bible and the GLB. Owner/Claude ruling needed on v2.
- **`10-the-firstborn-v4.png`** — only **five** figures: **Nuaré is missing entirely** (no ember figure, no hearth-lantern). Also Vesh's hollow in v4 is a whole missing mid-torso (robe hanging open), not the Bible's "clean, soft, perfectly circular hollow through the chest." v1–v3 have all six + the gap and correct hollows.
- **`19-soumayas-gap-v1..v4.png`** — the wiped nameplate came out as a blank **oval** patch in all four. Bible §0.5: a **blank rectangular nameplate**. Hulls also read as rounded pods rather than "sleek, echoing all six."
- **`22-the-sleepwalker-v1, v2, v4.png`** — the lantern shows a small lit flame. Bible: the Sleepwalker's signature is a **flameless** lantern. v3 complies (dark lantern, glint only).
- **`36-the-companion-at-the-dock-v1..v4.png`** — risk flag, not a hard break: the stranger's face is correctly never visible (hood shadow), BUT in all four the stranger wears a **white/cream hooded robe** and glows warm — close to Eternity's white-on-white. Bible: the Companion is "**never Eternity-looking**." Ruling needed on whether the pale robe is too close.
- Minor: **`21-ysmerel-the-last-choirmaster-v2.png`** — the torn page is a ragged hole through the spread; Bible says ONE page **cleanly** torn out (v3 is closest). v1's robe has star-and-moon embroidery — decorative, not a religious symbol, but flagging since crescents are on the never list in spirit.

Compliant where it matters: §17's standing set (faceless, male, white, ring) after rejecting a faced first pass; §26 Kith (child, faceless-woman drawing); §28/§33 Follower from behind, no face; §34 Necklace (lamps, no hulls); §2 mandala archive gap; §9 Archive.

## 3. Where I had to guess

- **Eternity's look** was owner-ruled mid-run (male; then faceless/all-white per his GLB) before the Bible existed — the Bible and the owner agree, so no open guess remains except the §3 v2 face (above).
- **PROPOSED defaults (Maren, Nuaré, Tamsin, Ossian, Pell, Wim):** where my art already touches them it matches your proposals — Maren a woman with seedling (§10), Nuaré a woman in ember robes (§10 v1–v3), Ossian a wiry man (§32), Pell hooded/from-behind with gender not visible (§33, §28). Tamsin (§23) and Wim (no image) not yet drawn; I'll use the PROPOSED defaults and the Bible's gender-word rule from here on.
- **§2 v3** was generated from a prompt I mistyped (hearth-lights arc duplicated). Its ring order drifts from spec. Disclosed to the owner; a clean redo is queued.
- Sethane in §10 reads gender-hidden under a hood (instrument ring correct; the knotted cord with the last knot untied is not visible in any variant).

## 4. Sheet + rules

- `PROMPT_SHEET.md` re-pulled: §3 now carries the MALE prompt verbatim, and the sheet header carries the Bible banner. Pushed to `main` with this report.
- Remaining generation (§11–§15, §18, §20, §23–§25, §27, §29, §30, §35) will run with a gender word in every character prompt and Bible §2 silhouettes as the first line of any ship prompt, per your brief. Redos queued for §5 (swan Lullaby) and §4 (androgynous Vesh) under the same rules.

## 5. Music beds — plain answer

**I cannot produce the music beds.** My ElevenLabs connection is speech-only (its key has Voices/User/Models access; the connector cannot do music generation), and my media pipeline generates images and video, not mastered audio loops. Per your spec's instruction, I'm saying so and stopping there. So the owner can still move fast, I've attached paste-ready generation prompts for the four beds + the find sting, written to your spec (60–90 s seamless loops, −24 LUFS, ≤ −3 dBFS peak, thin 1–4 kHz, MP3 128k names as specified).
