# Muse → Claude: lore image QA notes (for image review)

*From Muse, 2026-10-30. Companion to `CONTINUITY_REPORT.md` (same folder). The owner uploads the image binaries into `docs/lore/art/` himself; filenames follow `NN-short-title-vK.png`. These notes record, per set, what I verified by eye, what I judge shaky, and what I need you to double-check when the images land — you can judge the images directly. Nothing here rewrites a prompt or the Bible; open questions are marked RULING.*

## Current status (2026-10-30, post-audit — read this first)

The status board below is Round 1 history and no longer describes the present. Current state: Rounds 1-2 complete (156 canon originals). Sheet 3 (King-authored, owner's takeover directive 2026-10-30) generated paintings for all 51 Book entries that had none; every set is QA'd in the King Sheet sections below with PROVISIONAL picks. Placement is verified complete on main: STORY_ART holds 87 entries, packages/web/public/lore holds 87 web copies, all 87 canon entries have art. ChatGPT's independent audit (2026-10-30) ACCEPTED the placement, the narration fix, and the voices console with corrections; its two lore findings (L-01 Sunward Compass, L-02 Doorkeeper's Nail) are answered in the correction sections at the foot of this file. Claude's visual ratification of the Sheet 3 picks is still pending. The 281 Sheet 3 originals are uploading to docs/lore/art in batches.

## Status board

- Generated and kept so far: §§1, 2, 3 (2 keepers), 4, 5 (redone — see below), 6, 7 (3 variants), 8, 9, 10, 11, 12, 16, 17, 19, 21, 22, 26, 28, 31, 32, 33, 34, 36 — 93 keeper files.
- Still to generate: §§13, 14, 15, 18, 20, 23, 24, 25, 27, 29, 30, 35, plus a clean §2 v3 redo and a §10 replacement variant (see §10 note). §7 has 3 variants (4th was cut off mid-pass).
- Out of scope per the spec: §§37–42 (Draft 5) exist in `IMAGE_PROMPTS.md` but were not in the 36-prompt sheet; untouched.

## Items that need your eye or a ruling

1. **§5 Lullaby — RESOLVED, verify the fix.** First pass drifted to a wooden crescent pier-boat (prompt was always swan-correct — see corrected `CONTINUITY_REPORT.md` §1). Old v1–v4 withdrawn. New v5–v8 generated with the Bible §2 silhouette as the first prompt line: swan hull, petal-vanes, flank hollow, pale violet. Check v5 (most literal swan, slightly statue-like) vs v8 (most ship-like) and pick the reference.
2. **§3 Eternity v2 — RULING.** Keeper `03-eternity-v2.png` shows a visible man's face under a veil; Bible says "never a clear face" and the owner's later GLB ruling says no face at all. v1 complies with both. Owner picked v2 *before* the GLB ruling. Rule on whether v2 stands or is regenerated faceless.
3. **§4 Vesh — REGENERATION QUEUED.** All four read as an elderly woman; Bible: they/them, androgynous. Hollow is correct (clean circle, no gore) in all four. I will regenerate with an explicit androgynous direction line; the owner also hasn't picked a canonical Vesh face from this set — the redo supersedes that pick.
4. **§10 v4 — DEFECTIVE, replacement queued.** Only five figures (Nuaré missing entirely) and Vesh's hollow is a whole missing midsection instead of the clean circle. v1–v3 are complete and in Bible order with the lit gap before Vesh. Sky ships are generic silhouettes — individual Bible silhouettes (§2) are not separately readable in any variant; flag if a lineup needs them legible.
5. **§19 Soumaya's gap — RULING.** The blank patch came out OVAL in all four; Bible §2 says the seventh hull's nameplate is RECTANGULAR. Hulls also read as rounded pods rather than "sleek, echoing all six." Rule: accept, or I regenerate with the rectangle + silhouette line.
6. **§22 Sleepwalker — partial.** Lantern shows a lit flame in v1, v2, v4; Bible says FLAMELESS. v3 complies (also the only one holding it two-handed as written). If one variant ships, v3 is the canon-safe one.
7. **§36 Companion — RISK, your call.** Face correctly never visible in all four, two cups present, but the stranger's white/cream hooded robe + warm glow may read "Eternity-looking," which the Bible forbids for the Companion. Judge the files directly.
8. **§21 Ysmerel — minor.** Torn page: v2 has a large ragged hole through the spread (Bible: ONE page cleanly torn out — v3 is closest); v1's robe has star-and-moon embroidery, borderline against the spirit of the global negative (no crescents). Check v1 if it matters.
9. **§2 v3 — DISCLOSED PROMPT ERROR, redo queued.** I mistyped the generation prompt for v3 only (one descriptive line duplicated); its ring order drifts furthest from the prompt (gardens innermost). v1/v2/v4 carry the required clean gap in the violet archive ring. A clean v3 redo is queued; until it lands, treat v3 as the weakest of the set.
10. **§11 v1 — minor.** The waiting dark patch renders as a small figure standing ON the sea (too solid); v2–v4 keep it as a dark shape within the reflection, v3 most literal.
11. **§17 — note.** First pass (faced figure) was rejected and moved out of the keepers; the filed set is faceless per the GLB ruling. Reference-image generation against the owner's GLB screenshots failed 4× at the generation service (integrity check), so §17 is text-directed only — verify the filed set still matches the GLB's build (tall, broad, ring behind head).
12. **Eternity white-void deviation (all Eternity images).** Prompts ask for a pure white void; the generator consistently renders deep indigo space instead (the standing universe palette). Consistent across §§1/3/6/17, but it is a deviation from the prompt text — flagging in case the white void is load-bearing for key art.
13. **Aspect ratios.** The generator has no ratio parameter; ratio lives in prompt text only and is frequently ignored (§6 and §22 came out portrait/landscape against their asks, §19 landscape against 1:1). If exact ratios matter for layout, plan on crops — check per file.
14. **Ships inventory for §2 cross-checks.** Standalone sheets exist for: Lullaby (§5 redone, §16 in scene) and the Latch (§8, reads vary — v2's giant open door is closest). No standalone sheets for Dawnward, Plumb, Slow Bloom, Ember Ark — nothing to cross there yet. The Necklace (§34) correctly has no hulls (lamps only).

## What I verified as consistent

One universe throughout (indigo-black, warm gold + pale cyan, painterly), no text/logos/UI in any keeper. Bible spot-checks that passed: §26 Kith (drawing torn at mouth level in v4; extra place set in all), §28/§33 Follower from behind with face never visible, §9 Archive (the one dark alcove with the folded letter), §12 Hush as soft mist front (eight ships, reaching hand, nothing burning), §16 Lullaby matching the redone §5.

## Update — §13 filed (97 keepers)

§13 The Fading of the Growing Place: consistent across all four — top-down terraces, great tree, outer ring ghost-white with pencil-sketch trees, gold-green heart. Slow Bloom present in all four as seed-pod + petal-vanes. Minor: v4's Bloom is ornate enough to read slightly like a mask/face — check if it bothers; v1–v3 are cleaner. Terrace count is approximately six, not exact, in every variant.

## Update — §14 filed (101 keepers)

§14 Oru and the Siege of the First Light: consistent across all four and with §10's Oru (old, pale robes, hand to forehead, passing the ball of light to the witness-from-behind; edges dissolving into the Hush). The Dawnward now has a reference look: a great pale unfolded fan of light above a slim hull — v3 is the cleanest read of the silhouette; v1/v2 carry a visible hull under the fan, v4 spreads the fan horizontally. Cross-check any future Dawnward against v3 first. v4 came out portrait against the 16:9 ask (see item 13).

## Update — §15 filed (105 keepers)

§15 Calend closes the last door: Calend is recognisably the same man as §8/§10 in all four (wiry, patchwork coat with the unfinished burlap patch, wry tired face), on the wrong side of the door, pulling it shut against the Hush, farewell wave toward the fleet lights. The always-warm nail reads clearest in v2/v3 (small glowing nail held upright); v1 drives it horizontally into the frame, v4 holds it glowing against the door. The Latch: v2 makes the door-frame the ship's own front (closest to the Bible's door-shaped hull), v3/v4 set the frame on a long hull with a warm light bar/seam.

## Update — ALL 105 IMAGES NOW IN THIS FOLDER (2026-10-30)

The owner approved Muse uploading the binaries: all 105 keeper PNGs are now in `docs/lore/art/` alongside these notes (upload commits f2208d0, 7bba740, cd0447c, 770dc44, 0e5b536, 866ff03, 48fa358, 35a041f, 1233b78; folder count verified: 105 PNG + 4 MD). Claude: you can now open every file named in this document and judge it directly. Sets still to come (§§18, 20, 23, 24, 25, 27, 29, 30, 35, the §4 Vesh redo, the §10 replacement, the clean §2 v3) will be uploaded the same way as they land.

## Update — §§18, 20 filed (113 keepers)

§18 The Fifteen Witnesses: all four faithful — fifteen coloured doorways in an arc, pedestal objects readable (nail first in every variant; v2/v3 most legible: ring, hook, compass, seal, letter all identifiable), sixteenth doorway dark and empty with the small figure before it, back to camera.
§20 The Three Endings: true triptychs, all three beats in every variant (stepping into the star-mirror looking back / asleep in the archive alcove with the single lantern / standing in mist, mouth opening, hands open). Within each variant she is the same woman; ACROSS variants her face and hair differ (v1/v2 loose wavy hair, v3/v4 dark bun) — pick one triptych as canonical.
Also §19 cross-reference: the one prompt-text break — IMAGE_PROMPTS.md §19 still says "blank oval patch" where the Bible requires the blank RECTANGLE (Bible §2; §40's text has it right). Flagged for the lore side to fix in the prompt text; my §19 images follow the current prompt (oval).

## Update — §23 filed (117 keepers)

§23 Tamsin tends the Faded: one of the strongest sets. Tamsin is the same middle-aged woman in all four (greying brown hair in a bun, rolled-sleeve green apron) kneeling with bowl and spoon; the Faded are half-transparent with watercolour-soft edges, no gore, per the Bible. Ember lanterns overhead in all; the Hush's thin pale line on the horizon is most literal in v1/v3 (v4 renders a horizon glow with a falling arc instead — still reads correctly). PROPOSED detail "buttons in pockets" not visible at this scale in any variant.

## Update — §24 filed (121 keepers)

§24 Dorrow Quint: consistent man and wardrobe across all four (heavy, burgundy velvet coat, gold trim), Great Book enormous and open, ledger shelves rising into shadow, brass lamps. The smile-that-doesn't-reach-his-eyes is strongest in v1/v4; v2's smile is warmer (least canon), v3 sterner than smiling. Fresh-ink line: v2 most literal (one dark line on the lit page); v4's lit page carries several lines of pseudo-script (not legible words). NOTE for your eye: v3's coat and desk are embroidered with stars and a CRESCENT MOON — decorative astronomy, but it echoes the negative prompt's no-crescents line the way §21 v1's robe embroidery did; ruling welcome.

## Update — §25 filed (125 keepers)

§25 The Hollow Choir: all four faithful — archive hall (shelves line the walls in v2–v4), rows of pale translucent singers mid-note with mist-dissolving edges, grey hush creeping at the walls, and the centre beat exact: ONE empty choir stall under a shaft of pure gold light (v1/v2 most literal — a single empty bench dead centre; v4's empty place is a whole stall-block and v4 came out PORTRAIT despite the 16:9 ask, see the standing ratio note). Observation, not a flagged break: the singers read predominantly as women in all four variants; the Bible does not gender the Choir, noting it only in case it matters to you.

## Update — §27 filed (129 keepers)

§27 The Sixteenth Doorway: clean set, no flags. All four: stone-blue hall of smaller sealed doors, ONE tall open doorway with pure soft white beyond, the hooded player from behind (face and gender never shown, per the Bible) holding out all three objects — nail, pale smooth stone, folded letter — readable in every variant. v1 most balanced (objects split across both hands); v4 closest framing and PORTRAIT despite the 16:9 ask.

## Update — §29 filed (133 keepers)

§29 Calend's Second Door: clean, no flags. Calend is recognisably the same man as §§8/10/15 in all four — patchwork coat of many faded colours, palm flat on the harbour wall beside the seam, head bowed, not pushing. The seam is open exactly a hand's-breadth in every variant: one thin vertical slit of pale white light spilling across the floor, dust motes in the beam. v2 is PORTRAIT despite the 16:9 ask (standing ratio note).

## Update — §30 filed (137 keepers)

§30 The Sitters: all four complete and truly wide. Every beat present in every variant: the pale Hush wall on the horizon (v1/v3 render it as a literal towering wall, matching §12's canon; v2/v4 lower, more mist-bank), ordinary people in a loose line on stools/blankets/chairs, one small warm lantern, a blanket shared round shoulders (v4 adds an arm around another — most tender), ONE empty chair beside them, and the tall warden a little back with a folded chair under one arm. "Pretending not to look" is weakest in v2 (he half-faces the group); v1/v3/v4 have his gaze averted. The warden is not yet cross-checkable as Hesk — he has no solo portrait in §§1–36 to match against.

## Update — §35 filed (141 keepers) — ALL 36 PROMPTS NOW GENERATED

§35 The Eighth Bell: the full line reads left to right in every variant — lamp, measure, gate, leaf, hearth, lock, stillness (stacked stones; v3's stillness is a smooth round stone figure with closed eyes), each tender carrying its own small bell, and at the end the eighth keeper, plain-coated, closed fist raised to ring empty air, concentric rings of light spreading from where the bell should be. v3 alone gives a true white void (left half of frame); the rest sit in indigo (standing white-void note). Minor observation: in v2/v4 the keeper is white-hooded and faceless, which borrows Eternity's palette; v1 (bald man, pale coat, profile) and v3 (hooded but earth-toned, seen from behind) read as ordinary people. Your call whether the keeper may share that palette.

## Update — §4 REDO filed (145 keepers) — supersedes v1–v4

§4 Vesh regenerated as v5–v8 with an explicit androgynous direction line added to the verbatim prompt. The fix worked: all four now read as genuinely ungendered — one consistent gaunt, ageless, tired face that settles as neither man nor woman — hooded dusk-violet robes, the hollow a clean perfectly circular gap with the archive visible through it, no gore, one empty open palm, the other hand raised as if letting go. **v5–v8 are the canonical Vesh; the female-reading v1–v4 still in this folder are SUPERSEDED — do not use them.** This set can serve as the Vesh face reference for future art.

## Update — §10 replacement variants filed (147 keepers) — v4 superseded

§10 replacement generated with Bible gender lines added (Oru/Calend men; Sethane/Maren/Nuaré women; Vesh androgynous; hollow specified as a small clean circular hole through the chest only). All four candidates came back correct this time (six figures, Nuaré present, gap of lit air, clean circular hollow); two are filed: **v5** (clearest gap; Vesh most androgynous; nail rides on top of Calend's door-frame) and **v6** (most distinct ship silhouettes behind each figure, including a violet swan-form at Vesh's end). Two further correct candidates exist locally unfiled if wanted. **v4 (five figures, Nuaré missing, hollow = whole midsection) is SUPERSEDED — do not use it.** Minor: Oru reads middle-aged rather than old in the replacements, as in v1–v3.

## Update — §2 clean variant filed (148 keepers) — v3 superseded

§2 clean redo filed as v5, generated from the verbatim prompt (the earlier v3 was generated from a mistyped prompt with one descriptive line duplicated — disclosed at the time; v5 replaces it). v5 check: top-down mandala, bright white centre, each of the seven worlds present exactly once — morning basin, planets at scale, harbour dock-arms with the glowing nail-beacon at the right edge, terraced gardens round the great tree, ring of warm hearth-lights, dark archive arc with ONE clean break in its alcoves at the bottom of the ring. **v3 is SUPERSEDED — do not use it.** As with the whole §2 set, the radial order of the arcs is approximate rather than a literal 1–7 reading.

## FINAL — generation complete (148 PNGs in this folder)

All 36 prompts on the sheet are generated and uploaded; the three queued redos are done (§§2, 4, 10 above). Superseded files still in the folder, marked do-not-use in the updates above: §4 v1–v4 (female-reading Vesh), §10 v4 (five figures), §2 v3 (mistyped prompt). Still awaiting rulings: §3 v2's visible face; §19 oval-vs-rectangle (the §19 prompt text itself still says "oval" — Bible says rectangle); §36 Companion's Eternity-adjacent palette; §35 keeper's white-hooded palette in v2/v4; §20 — one triptych must be picked as canonical (her face differs across variants). Standing deviations: the generator has no aspect-ratio control (several sets came out portrait against a wide ask — crop plan needed), and Eternity's white void renders as indigo space except where noted. §7 has 3 variants (the 4th was cut off mid-pass; a top-up was never promised). Draft prompts §§37–42 exist in IMAGE_PROMPTS.md but were outside the spec's scope and were not generated.

## Update — CLAUDE_REVIEW rulings acted on (156 keepers)

Acted on `docs/lore/art/CLAUDE_REVIEW.md` (2026-10-31) as relayed by the owner:

1. **§3** — `03-eternity-v1.png` stands as the canon keeper. **`03-eternity-v2.png` is MOOD ART ONLY, not canon** (visible face), per the ruling; the review notes the owner may still overrule.
2. **§36 REGENERATED as v5–v8.** The stranger now wears plain earth/dusk travelling cloth with a shadowed hood in all four — no white robe, no glow, nothing Eternity-like; face still never drawn (in v5 the stranger is only warm hands holding out the flask, the most literal reading). Two cups kept, one steaming; dock, crate, lantern and the far ship's lights kept. One minor note: in v7 the TRAVELLER's face is partly visible in profile — the Bible never shows the player's face, so v5/v6/v8 are the safer picks. **v1–v4 SUPERSEDED** (the ruling named v1; the same white-robe defect ran through the set).
3. **§19 REGENERATED as v5–v8.** Generation followed the review's instruction: Bible silhouette first (seventh hull echoing all six) and the nameplate as a RECTANGLE (the §19 prompt text's own word "oval" was corrected for this pass only, exactly as the review directed — the source prompt text itself is unchanged, and fixing it in IMAGE_PROMPTS.md remains the lore side's call). Results: sleek blue-white hulls with violet edge, glowing cockpit, ember engines, blue trail. The blank plate is rectangular in all four — clearest in v5 and v7. Family resemblance: v5 reads the most echoes (dawn-fan prow, bloom fan, latch clasp, plumb keel); v7 is the sleekest single hull. One deviation: v6 carries TWO blank rectangular plates; the Bible implies one nameplate. **v1–v4 SUPERSEDED** (ovals/pods; the ruling named v1, same defect throughout).

## Re-check of the remaining files against the Bible (breaks by filename)

As asked, the rest were re-checked; nothing outside the four reviewed images is treated as approved. Current state after all redos:

**Hard breaks still in the folder (all already superseded or ruled on):**
- `03-eternity-v2.png` — face; mood art only (above).
- `04-vesh-the-hollow-mercy-v1..v4.png` — Vesh reads as an elderly woman; superseded by v5–v8.
- `10-the-firstborn-v4.png` — five figures, Nuaré missing, hollow = whole midsection; superseded by v5/v6.
- `02-the-seven-hours-v3.png` — generated from a mistyped prompt; superseded by v5.
- `19-soumayas-gap-v1..v4.png`, `36-the-companion-at-the-dock-v1..v4.png` — superseded by this update.

**Breaks/deviations in files that are NOT superseded (Claude's eye or a ruling still wanted):**
- `22-the-sleepwalker-v1.png`, `-v2.png`, `-v4.png` — the lantern shows a lit flame; the Bible's lantern is FLAMELESS. Only v3 complies. Standing recommendation: treat v3 as the canon pick.
- `21-ysmerel-v2.png` — ragged hole in the hymnal vs ONE page cleanly torn out; v3 is closest to canon.
- `21-ysmerel-v1.png` and `24-dorrow-quint-v3.png` — star-and-crescent embroidery; borderline against the negative prompt's no-crescents line. Ruling still open.
- `35-the-eighth-bell-v2.png`, `-v4.png` — the eighth keeper is white-hooded and faceless, borrowing Eternity's palette; v1/v3 keepers read as ordinary people. Ruling still open.
- `11-the-player-as-the-witness-v1.png` — the waiting dark patch is too solid (minor).
- `13-the-fading-v4.png` — the Slow Bloom reads slightly mask/face-like (minor); v1–v3 cleaner.
- §31 set — the literal door count is not exact in any variant (v3 strongest).
- §20 set — not a break, an open pick: the woman's face/hair differ across the four triptychs; one must be chosen as canonical.
- §5 set — open pick from earlier notes: v5 (most literal swan) vs v8 (most ship-like) as the Lullaby reference.

**Standing deviations (whole-run, not per-file):** no aspect-ratio control at generation (several portrait results against wide asks — crop plan); Eternity's white void renders as indigo space in most images. Nothing in this update needs a code change, and no story rulings were invented — the open items above are flagged, not settled.

## Owner rulings — 2026-10-30 (both flagged items cleared)

The owner reviewed the images directly and ruled both open items FINE as they stand:

1. **Crescent embroidery — ALLOWED.** The star-and-crescent embroidery on `21-ysmerel-the-last-choirmaster-v1.png` (robe) and `24-dorrow-quint-and-the-great-book-v3.png` (coat and desk) is fine as decoration; it does not breach the no-crescents line. Both files stand as usable keepers, no marking.
2. **The Keeper's white — ALLOWED.** The eighth keeper in `35-the-eighth-bell-v2.png` and `35-the-eighth-bell-v4.png` may wear the white hood / faceless read. Both files stand as usable keepers alongside v1/v3, no marking.

Remaining open items after these rulings: §20 canonical triptych pick; §5 Lullaby reference pick (v5 vs v8); §22 — v3 is the only flameless-lantern variant (standing recommendation: canon pick); §19 source prompt text still says "oval" (lore side's call).

## Lullaby reference settled — per CLAUDE_REVIEW (2026-10-31)

Claude picked by eye and recorded in `docs/lore/art/CLAUDE_REVIEW.md`: **`05-veshs-ship-the-lullaby-v5.png` is THE Lullaby reference** (Bible §2 swan: curved neck and head, flank hollow, petal-vanes, pale violet engine; its slight statue-like quality accepted — silhouette is the continuity; the three-angle sheet works as a turnaround). `05-…-v8.png` is NOT the reference (handsome ship, swan gone, ring-saucer read) — kept only as a "how she flies" side study. Cross-check all future Lullaby art against v5. Still open: the §20 canonical triptych pick only.

## §22 canon pick settled — per CLAUDE_REVIEW (2026-10-31)

Claude checked `22-the-sleepwalker-v3.png` by eye and approved it as **the canon pick for §22**: pale nightgown, barefoot, lantern held in both hands, and the lantern is dark glass with only a single faint gold glint — FLAMELESS, as the Bible requires. `22-…-v1.png`, `-v2.png` and `-v4.png` (lit lanterns) are marked NOT CANON. v3 came out landscape rather than the asked 2:3 — covered by the standing crop-plan note. With this, every ruling Claude was asked for is made; the only art item still open is the owner's confirmation of Claude's §20 pick (v1).

## §20 canon pick CONFIRMED by the owner — 2026-10-30

The owner confirmed Claude's pick: **`20-the-three-endings-v1.png` is the canonical §20 triptych** (same woman in all three panels — loose wavy light-brown hair, pale gown; mirror of stars / archive alcove / pale mist). v4 was Claude's second choice; v2/v3 not recommended. With this confirmation, **every pick and ruling on the lore art is settled**: canon picks — §5 Lullaby reference v5, §19 v5, §20 v1, §22 v3, §36 v5; §3 v1 canon with v2 mood-only; crescent embroidery and the Keeper's white allowed by owner ruling. The lore art lane is closed.

# PROMPT SHEET 2 (Drafts 7 & 8) — §§43–64, then §§37–42

## §43 The Lamp Nobody Pays For (162 keepers)
Mara Halvane established: the SAME weathered old woman in all four (grey hair, deep-lined face, long dark-green scarf) — this set is her face reference. All beats present in every variant: iron gate-post (clearest as a gate in v2/v4; v1's post reads more as a mooring post), oil poured into the lantern with care, lantern warm and steady, no ship moored near, harbor lights and vast dark sky beyond, rope coil and a stack of empty oil tins at her feet, eyes never raised. Palette exact (dusk blue, lantern gold, deep green). All four came out wide 16:9 as asked. No text. Nothing flagged.

## §44 Teru Steps Through the First Door (166 keepers)
Teru established: the same travel-worn, hollow-eyed man in all four, nail visible in his hand in every variant (clearest v3/v4), stepping through the tall narrow door, frame glowing warm; behind it only sky and the first low lamps. Calend beside the door in the patchwork coat, palm on the frame, never touching him — correct in all four. **For the pick:** Calend's FACE splits the set — v1/v2 give him a younger dark-haired face (v2 hair in a bun), while v3/v4 give the older, greyer, gaunt face that matches the §8/§15/§29 reference. v4's door is arched at the top (prompt says a plain tall door — minor). All four wide 16:9.

## §45 Hesk's Locked Room (170 keepers)
Hesk established: the same big, stern, grey-bearded man in the brown Warden's coat in all four — this set is his face reference (needed again in §§46/57 and §42). Every beat present in every variant: ring of small keys at the belt, tin soldier polished with a cloth, long narrow store-room under one hanging lamp, hundreds of belongings each with a BLANK tag (single boot, ribbon, child's pale-blue mitten, coat, cup all identifiable), cold blue at the starfield doorway. His expression is effort and tenderness, never cruelty. Tags carry no readable writing. All four wide. Clean set, nothing flagged.

## §44 — owner rejection (2026-10-30)

The owner viewed `44-terus-first-door-v3.png` and rejected it ("I don't like this one"). **v3 is OWNER-REJECTED — do not pick it.** The set's live candidates are v1, v2 and v4. (File left in place, marked here, per the standing superseded-file practice.)

## §46 — Three Parts of One (Sheet 2, triptych)

Files: `46-three-parts-of-one-v1.png` … `v4.png`. All four are true triptychs — three equal vertical panels — and all four came out at exactly 2352×1008 (21:9 as specified; no crop needed).

- **Left panel (all four):** the long coat alone on its hook under a single lamp, with Kith's pinned child's drawing beside it. The drawn woman is **faceless in every variant** (blank face, simple line figure) — the never-list holds.
- **Center panel (all four):** Linnet asleep on the narrow cot, watercolour-soft and faintly transparent at the edges, soup bowl beside her. She reads as sleeping/resting, never dead. The green-aproned hand is at the frame's edge in v1–v3; **minor note on v4:** the hand grips the green blanket, as if tucking her in, rather than just leaving the frame.
- **Right panel (all four):** Kith from behind in the patched dress, setting the extra place at the long table. Face never shown.
- Same warm-gold light carries across all three panels in every variant; no text anywhere.

Verdict: a complete, clean set — no flags beyond the small v4 hand note. Your pick, as usual.

## §44 — correction and replacement (2026-10-30, owner's words)

Clarifying the §44 note above: the owner did not reject the set — he approved **v1** ("the second one looks perfect") and asked for **v3 to be REPLACED** because its camera angle is wrong: v3 is shot side-on, Calend looming in the left foreground and Teru crossing the doorway in profile, so the stepping-through does not read. In v1 the door is centred, shot straight-on at eye level, and Teru steps toward the viewer over the threshold.

- **Replacement filed: `44-terus-first-door-v5.png`** — generated with v1 as the angle/composition reference: same straight-on view, door centred, Teru stepping toward the viewer with the nail in his closed hand, Calend at the right in the many-coloured patchwork coat (unfinished pale patch visible), palm on the frame, not touching him. Wide 16:9.
- v3 stays in the folder marked **do-not-use (superseded by v5 at the owner's word)** — do not pick it.
- Live candidates for §44 are now v1, v2, v4, v5. The Calend face question from the original §44 note still stands for your pick (v1/v2/v5 younger dark-haired; v4 older greyer).

## §47 — Tamsin Beside a Laughing Patient (Sheet 2)

Files: `47-tamsin-beside-a-laughing-patient-v1.png` … `v4.png`. All four wide 16:9, all elements present in every variant: the half-transparent patient (Ruel) sitting up in his cot laughing, the laugh rendered as warm gold light; Tamsin at the foot of the cot, back half-turned, hand to her mouth, bowl in her other hand, greying bun and rolled-sleeve green apron — consistent with her §23 face reference; rows of pale patients asleep behind them under ember lanterns. Nobody reads as dead; the laugh keeps the ward alive. No text.

- **v1 / v4:** the laugh is a single soft ring of gold light, as written. v4 has the strongest watercolour-soft edges on the patient.
- **v2:** the ring is more constructed — concentric circles, reads slightly like a portal — and the ward leans hard-sci-fi (bare metal ship interior, large viewport).
- **v3:** the ring multiplies into large concentric swirls around his head; the background opens to space with ships — the busiest of the four.

Verdict: clean set, no rule breaks; the differences are taste in how literal the laugh-ring should be. Your pick.

**Correction to the §47 note above:** the four files are 1920×1280 — **3:2, not 16:9**. The generator ignored the stated ratio (the standing deviation); a 16:9 crop is available from the 3:2 frame if you want one. Everything else in the note stands.

## §48 — Aldous's Alcove (Sheet 2)

Files: `48-aldouss-alcove-v1.png` … `v4.png`. Aldous in all four: tall, gentle, white-haired, pale-gold choir robe, faintly translucent, hymnal held against his chest, empty choir stalls in rows behind him, the pale hush gathered as mist on the floor around — not on — him. He stands at rest, eyes peaceful; no body, no grave, nothing dead. No readable writing anywhere (books closed or blank).

- **Ratio miss:** v1–v3 came out **portrait**; only **v4 is wide** as the sheet's 16:9 asks. Same standing generator deviation.
- **Torn page:** clearest in v4 (the open hymnal has a cleanly torn-out section) and v2 (a torn chunk out of the book at his chest); v1 shows a torn corner; v3's book is slim and the tear is not really visible.
- **Eyes:** closed in v1, v2, v4; open and meeting the viewer in v3 — the one that least matches "eyes at peace."
- **Alcove:** v2 frames him squarely inside the stone alcove; v4 opens into the archive aisle instead (alcove weakest there, but the stalls and shelves are strongest).

Verdict: complete set, no rule breaks; v4 is the only one at the asked ratio. Your pick.

## §49 — Ysmerel Hums the Gap (Sheet 2)

Files: `49-ysmerel-hums-the-gap-v1.png` … `v4.png`. All four wide. Ysmerel is the same woman in every variant — tall, weathered, grey-braided, pale-gold choir robe, eyes closed, mouth closed mid-breath, one hand flat at her chest keeping the note she is not singing. The hall of pale translucent singers sits (v1, v3) or stands (v2, v4) silent behind her; the small hooded visitor is in the aisle, seen from behind; a shaft of gold light picks out the single empty stall. No text.

- **Empty stall + light shaft:** clearest in v2 (lit empty stall, lower left, light falling from above); v1 and v4 land the light on the right-hand stalls/steps; v3 on the raised platform at right.
- **Minor note, v3:** the visitor is caught in slight profile rather than purely from behind — a sliver of face in shadow. The other three keep him fully from behind.
- Her robe carries fine star-chart embroidery in v1, v2 and v4 — decoration, no symbols.

Verdict: clean, consistent set; the held-breath mood lands in all four. Your pick.

## §50 — Dorrow's Blank Line (Sheet 2)

Files: `50-dorrows-blank-line-v1.png` … `v4.png`. All four wide. **The hard rule holds in all four: the ledger script is fine pseudo-handwriting — no readable word anywhere.** Dorrow is a heavy man in the burgundy velvet coat with gold trim at the enormous ledger, shelves rising into shadow, brass lamps lit; in every variant his eyes are somewhere else in the room, never on the page.

- **The blank line:** clearest in **v2** (one big empty ruled space at the very bottom of the near page, his pen hovering right at it, every line above filled) and **v4** (a long empty ruled line at the foot of the near page; his pen is a feather quill). In v1 the blank is a wide empty band at the foot of the left page. In **v3 it is weakest** — the pages are scripted nearly to the bottom.
- **The smile:** v3 has the full famous trader's smile, bright-eyed, but its pen floats unheld in mid-air over the ledger — a generator slip, though an oddly literal one ("his pen hovers"). v1 has the wry half-smile. In v2 and v4 the smile is gone — he reads worried, almost afraid.
- Dorrow's face varies a little across the set (hair length and beard shape); v2/v4 are the closest pair.

Verdict: no rule breaks; the trade-off is blank-line clarity (v2, v4) against the smile (v3, v1). Your pick.

## §51 — Wim and the Empty Cradle (Sheet 2)

Files: `51-wim-and-the-empty-cradle-v1.png` … `v4.png`. All four wide. Every variant has the full set: the young clerk in the neat dark Ledger coat with brass buttons, berth-log under one arm, the small slip in his other hand, the vast empty drydock cradle swept and ready, and the mooring ring on its post beside him glowing faintly warm. **No readable writing** — the slips are blank or carry only faint marks, the logs stay shut. The mood (faithful, quiet, a little sad) lands in all four.

- **Wim's age drifts:** v2 reads as a young man in his twenties and carries the confusion-and-tenderness best; v1 is late-teens; v4 is a soft-faced older teen; **v3 reads youngest — close to a boy** — which may sit young against his identity card.
- **The cradle:** v3's is the largest and most hull-like; v1's is a long ribbed slipway; v2's a clean timber cradle; v4's a broad empty berth basin.
- **The ring:** textbook in v1 (wooden post, warm glow, right beside him); larger and more foreground in v2–v4.

Verdict: clean set, no rule breaks; the only real question is Wim's age. Your pick.

## §44 — OWNER RULING: Calend's face (2026-10-30)

Asked to choose between the younger dark-haired Calend of §44 v1/v2/v5 and the older Calend the Bible describes, the owner ruled: **Calend stays older, as the Bible says.** §44 v4 is the face reference for Calend; the younger faces in v1, v2 and v5 are the deviation. (The owner still approved v1 as an image — the ruling is about which face is canon, not about the painting.) This closes the Calend question flagged in the original §44 note.

## §52 — Pell Walks in the Late Light (Sheet 2)

Files: `52-pell-walks-in-the-late-light-v1.png` … `v4.png`. All four wide. **The hard rule holds in every variant: Pell is hooded, in shadow, seen only from behind — her face is never shown.** The full set is in all four: the quiet dock, the distant single warm star, its light arriving as one long slow ribbon across the water, the dark unlit skiff moored nearby, and the leavings behind her — a ribbon, a coin and a folded note (blank; no readable writing).

- **The leavings:** clearest in v1, all three items together on top of the bollard; v3 also on the bollard top; in v2 and v4 the ribbon is tied to the bollard and the coin and note rest on the planks at its base.
- **The ribbon of light:** straightest in v1 (the star is also the most literal single star there); a slow S-curve in v2 and v3; a winding double ribbon in v4, where the pier itself stretches far into the distance.
- The mood — always arriving just after — lands in all four: the left things, the empty planks, her already walking away.

Verdict: a clean set with no flags. Your pick.

## §53 — Ossian Tells It Wrong (Sheet 2)

Files: `53-ossian-tells-it-wrong-v1.png` … `v4.png`. All four wide. The set is complete in every variant: wiry Ossian in the patchwork many-pocketed coat, the coin flipping above his offered hand, the travellers leaning in, and the crooked patchwork ship with its patchwork sail-fins berthed behind him. The grin with truth underneath it lands; the mood (playful, loving, a little sad) holds.

**Flag for Claude — the hovering word.** The prompt asks for one word hovering above his head; the global style says no text. The generator resolved it literally in three variants: v1, v2 and v4 each spell **"truth"** in glowing thread-like letters above him (lowercase in v1, capitals in v2, title case in v4). Only v3 keeps the idea abstract — a loose thread of pale light drifting above him with no letters at all. Whether a legible word is acceptable here (it is the set's own concept) is a ruling for Claude; v3 is the text-free option if not.

Two smaller notes: Ossian's age drifts (v3 is notably older, grey hair in a topknot; v1/v2/v4 are dark-haired and middle-aged), and v3's crowd includes one clearly non-human traveller (grey-blue skin, goggles) — the only non-human face in the harbor sets so far. In v2 he stands beside the crate rather than on it.

Verdict: strong set; the word question is Claude's to rule on.

## §54 — Ilsabet's Lane (Sheet 2)

Files: `54-ilsabets-lane-v1.png` … `v4.png`. All four wide. Ilsabet is established consistently: the same dark-haired woman, hair in a loose bun, ink-stained hands and sleeves, patient and absorbed. The long chart unrolls across the drafting table in every variant, the harbor window is beside her, a wide vessel floats outside, and there is **no readable writing anywhere** — the charts carry lines only.

- **The shifting ink** reads as the lane itself moving like water: liquid and streaming in v1 and v2; in v3 it lifts off the page in glowing blue threads — the most literal "ink mid-change."
- **The seam and the pale continuation** are the least literal beat. v1 has a stitched seam running the chart's length; v4 reads best overall — the left sheet carries the ink lane and the right sheet is nearly blank with faint pencil lines, her pencil in hand.
- **The barge:** widest and most patient in v4; in v1–v3 it leans toward a lit spaceship (most warship-like in v1).
- She draws with a pencil in v2 and v4, a pen in v1 and v3.

Verdict: a good set; the seam-and-continuation moment is quietest in v1–v3 and clearest in v4. Your pick.

## §55 — Maren's Winter (Sheet 2)

Files: `55-marens-winter-v1.png` … `v4.png`. All four wide. The hard rule holds in every variant: Maren is **asleep, not dead** — she rests in the cradle of the great tree's roots, eyes closed, peaceful, with nothing funereal anywhere. Everything asked for is present in all four: the green-gold robes, the watering can beside her, frost across the ground, the single bare branch at the lowest bough pointing at the sky, faint new green shoots at the frame's edge, and the Keeper small and far at the terrace edge, seen from behind.

- **The stopper** on the can is clearest in v3 (a cork in the can's mouth); the can is a plain brass watering can in the others.
- **The Keeper's colour varies:** dark-cloaked in v1, v2 and v4; pale/white in v3 (consistent with the white the owner allowed the Keeper in §35 — the sheet doesn't specify here, noted for the record).
- Maren's hair drifts a little (grey braid in v2 and v4, darker in v1), within a weathered woman's range.

Verdict: a clean, strong set with no rule breaks. Your pick.

## §56 — Iselle's One Dawn (Sheet 2)

Files: `56-iselles-one-dawn-v1.png` … `v4.png`. Iselle is established consistently: a young gardener with brown hair tied back, in green work clothes and an apron, kneeling in the bed. The set's heart is present in every variant — the empty patch of soil in the middle of the bed that she has left unplanted, her hand reaching gently toward it, every leaf and petal around it glowing in dawn colours, and the sky behind her still half-dark with stars: a dawn that never finishes becoming day. The mood (tender, tragic, unfinished) lands, most sorrowfully in v1 and v3.

- **Ratio note:** v2 came out portrait (1280×1920) against the sheet's 16:9; v1, v3 and v4 are landscape (1920×1280). A 16:9 crop of v2 is available if it is picked.
- The half-dawn split is most literal in v4 (rose dawn on one side, indigo starfield on the other).
- In v2 and v4 the bed sits on a floating terrace of earth; in v1 and v3 it is a grounded raised bed.

Verdict: a clean set; only the v2 orientation to note. Your pick.

## §57 — The Forty-Second (Sheet 2)

Files: `57-the-forty-second-v1.png` … `v4.png`. The composition lands in all four: the long column of travellers in plain clothes walking into the tall luminous doorway, the single glowing gold thread running hand to hand the whole length of the line, the village of lit windows behind them in the deep blue night — and at the back, the woman who stayed, stopped with her hand still half-extended to the thread, looking back toward the village. The choice-to-stay mood is strongest in v2 and v3, where her backward look is closest and clearest.

- **Count, honestly:** the columns read as a few dozen figures — the exact forty-one is carried by the column's length rather than a countable head-count at this size; v4's line is the longest and most single-file, v1's the shortest.
- **Ratio note:** v2 came out portrait (1280×1920) against the sheet's 16:9; the others are landscape. A crop is available if v2 is picked.
- v1 has a few extra standing figures near the houses right of the doorway; they read as villagers watching, not part of the column.

Verdict: a strong set; the count and the v2 orientation are the only notes. Your pick.

## §58 — Brannoch and the Mooring Ring (Sheet 2)

Files: `58-brannoch-and-the-mooring-ring-v1.png` … `v4.png`. All four wide. Brannoch is established consistently: the same heavy, grey-bearded, calm man at the end of the long stone quay in every variant, one hand resting on the ring, the coil of rope beside him, the distant harbor lights behind, and the patient smile of a man who has been here a very long time and wants nothing. The ring glows faintly warm in all four.

- **The rope that ends in nothing:** truest in v1, where it trails off the quay and frays out in the water; clear in v3 and v4, where it drops from the ring into the water and fades. In v2 the rope runs along the quay's edge and its entry into the water is the least clear.
- He sits directly in the coil in v3 (closest to the prompt's "sits on a coil of rope"); in the others the coil is beside him.
- v3's ring reads as worn stone with the warm glow at its knot; the others are metal rings glowing gold.

Verdict: a clean, consistent set. Your pick.

## §59 — Sahl Hangs a Star (Sheet 2)

Files: `59-sahl-hangs-a-star-v1.png` … `v4.png`. All four wide. The whole story is in every variant: Sahl alone on the high rock, hooded and cloaked, reaching up with both hands to hang the one small warm star on its hook, lit only by the star's own light; far below, tiny on the winding road, the stranger looks up; and the star's light falls toward them in a long slow ribbon of pale cyan. The mood — care for a stranger — lands in all four.

- **The "not yet":** the ribbon's shortfall is clearest in v2 (it fades well above the valley) and v4 (it splits and thins before the road). In v1 and v3 the ribbon comes very close to the traveller, who still stands in their own small pool of dark.
- **The hook:** a large wrought hook in v1; a bracket arm from the rock face in v2–v4.
- Sahl's face is never shown — hood and shadow in all four, which suits a witness painting.

Verdict: a clean, consistent set with no flags. Your pick.

## §60 — Noor Asks Vesh (Sheet 2)

Files: `60-noor-asks-vesh-v1.png` … `v4.png`. Vesh is right in all four and consistent with the §4 canon: tall and androgynous, face gentle and ungendered, hooded dusk-violet robes, and the clean, perfectly circular hollow through the chest showing the starfield beyond — no gore. The painting's heart is present every time: Vesh's hands open in their lap, empty — the kindly non-answer. Noor is established as a young archivist with dark hair in a bun and ink-blackened fingers (heaviest in v2 and v3). Between them on the stone floor sit the small round seal and the paper boat in all four, and the alcove is lit by one candle's gold.

- The candle stands on the floor between them in v4 — the most literal shared light; in the others it burns at the alcove's edge.
- Small slips only: v2 has a second paper boat in the mid-background, and its seal's ringed-planet emblem reads slightly like a coin. Neither touches continuity.

Verdict: a clean, consistent set with no flags. Your pick.

- **Owner review, 2026-10-31** (from the Stillness Seal card on his phone; the variant shown reads as v4 — candle standing on the floor between them): the lore goes with the image — quiet alcove, the smooth dark seal, the paper boat, Noor, and the rest of it all match the entry. Two flags recorded at the owner's direction: (1) Vesh's face reads **feminine** to the owner, where canon wants androgynous (the §4 axis); (2) the hollow reads as a **framed spiral galaxy** — a small portal held in the chest — rather than a clean hollow showing what lies beyond. Neither flag breaks the entry; a retake is the owner's call, not yet ordered. **Retake done the same day:** a replacement set (v5–v8) was generated from a tightened prompt — face pinned trait-by-trait, hollow defined as see-through emptiness with the galaxy/portal reading banned. v5/v6/v8 solved both flags by making Vesh wholly faceless (a drift from the §4 canon face); **the owner picked v7 (2026-10-31)**: Vesh keeps a face — pale, smooth, eyes lowered, ungendered — the hollow shows a candlelit shelf through the chest, and the seal sits as a stamp beside the boat. **v7 is the canon pick for §60 and the Stillness Seal card painting**; v1–v4 superseded for the card, v5/v6/v8 filed as alternates.

## §61 — Sethane's Cord (Sheet 2)

Files: `61-sethanes-cord-v1.png` … `v4.png`. All four wide. The sheet's rule holds in every variant: Sethane is small and distant at the far end, tall, slim and dark-clad, with her back to us — the last place she was seen — standing at the edge of the vast pale gap with a ring of measuring arms around her. The long pale-gold cord crosses a wide field of planets from a tiny station, its knots tied along the way and its measure never closing.

- **Closest to the sheet: v1** — one cord, big clear knots, the end coming undone in open space, Sethane and her ring of articulated arms on the ledge before the gap.
- v2 multiplies the cord into a fan of ropes running to her station of arms; the sheet says one cord.
- v3's single cord is the cleanest diagonal, but its open end finishes mid-frame, apart from Sethane's corner.
- v4 makes the measuring arms a radial burst of instruments around her in the gap — the most literal ring — while the cord runs in long parallel strands.
- The station renders as contemporary hardware (solar panels) in v1, v3 and v4; the prompt's own words — "a tiny, real-sized station" — invite that read, but flagging it in case the Station should stay mythic.

Verdict: a strong set; the cord-count in v2 and the hardware-station read are the notes for Claude. Your pick.

## §62 — The Dig-Warden Counts the Strata (Sheet 2)

Files: `62-the-dig-warden-counts-the-strata-v1.png` … `v4.png`. All four wide. The Dig-Warden is established consistently: a woman with dark hair tied back and a chalk-stained apron, kneeling at the vast layered cliff in warm dawn light and dust, fingertip pressed to the strata as she counts. The small child is beside her in every variant, chalk in hand, with the puzzled look the sheet asks for. No readable writing anywhere — the chalk marks are lines, not letters.

- **The missing sixth layer** is rendered through the sheet's own page metaphor, made literal: the cliff face turns like a page. It reads truest in v2, where the strata sweep into one smooth curve with no line crossing it, and v3, where a single smooth pale stretch sits between lined strata above and below, her finger on it. In v1 and v4 the page is a full peeling sheet — striking, but the most literal.
- **The child's seven lines:** clearest in v2 (a neat column on the rock face) and v4 (drawn on the flat stone, the last lines wavering — the puzzling one).
- Flagging the interpretation for Claude, not as a defect: the prompt's "turns from one page to the next" is painted as an actual page in all four.

Verdict: a strong set; only the literal-page read to note. Your pick.

## §63 — The Sleepwalker's Cup (Sheet 2)

Files: `63-the-sleepwalkers-cup-v1.png` … `v4.png`. All four wide, and one of the cleanest sets of the round. The Sleepwalker is the same woman throughout — dark wavy hair loose, pale nightgown, the plain cup held in both hands, gazing at the first light with the sheet's exact expression: she does not know where she is, and is quietly content. Her face is simply a woman's face again; nothing strange rides in it.

- **Both lantern and second cup survive every roll** — rare for a two-prop set. The dock lantern is lit and tended in all four (this is the pier's lamp, lit by design; not §22's flameless hand lantern — no conflict), standing on the rail or post in v1–v3 and hanging from its post in v4. The second, empty cup sits on the pier beside the lantern in all four.
- Dawn is held exactly as specified: rose and pale gold on the horizon under a still-starry sky, harbor mist, soft blue water.

Verdict: a clean set with no flags. Your pick.

## §64 — Oru's Bead (Sheet 2)

Files: `64-orus-bead-v1.png` … `v4.png`. Oru is the same man in all four — old, calm and slight, white-haired in pale robes, consistent with §14 — and the set's two gestures survive every roll: one hand holding out the bead, the other at his forehead, trying to remember. The small hooded witness is seen only from behind in all four; no face is ever shown. Around the bead, the light carries the faint, half-erased outline of the younger student in every variant — clearest and most affecting in v4, where the outline reaches as it dissolves, and v2, where it is drawn in a few golden lines; faintest in v3, where it is barely more than a swirl.

- **Bead size:** pearl-sized as specified in v2, v3 and v4. In v1 it swells into a large glowing orb with a tiny figure inside it — beautiful, but not the pearl the sheet describes.
- **Ratio note:** v1 also came out portrait (1280×1920) against the sheet's 16:9; the others are landscape.
- The bead's light leans brighter toward the witness in v2–v4, as the sheet asks.

Verdict: a strong closing set for the sheet; v1's orb and orientation are the only notes. Your pick.

## §37 — The Seven Kept from the Night (Round 1 leftover, Draft 5)

Files: `37-the-seven-kept-from-the-night-v1.png` … `v4.png`. All four wide, all four complete: the seven stations stand in the sheet's order on the dark stone — the chipped bead of pale gold light (the hair-thin crack visible in every variant), the knotted cord, the iron nail faintly ember-warm, the seed with its tiny label, the cushion still pressed into a seated shape and glowing warm, the folded paper with a single ink stroke, and at the arc's end the empty patch of stone, lit as if something belonged there (a ring of light in v1 and v4, a pool of white in v2). No hands, no people anywhere; the only person is the cushion's shape. No readable writing — the seed's label is blank in v1 and v3, and in v4 it carries a tiny line-drawing of two hands, the "two-handed label" as a wordless pictogram; v1 even gives the seed two tiny green hands holding its label card.

- **One real flag: the nail.** The sheet specifies a *headless* iron nail; all four variants give it a flat round head — it reads as a heavy iron spike. Everything else matches the list item for item, so if the headless detail matters to the lore, this set misses it the same way four times; Claude's call whether to accept or ask for a redo.

Verdict: a reverent set with a single consistent miss on the nail. Your pick.

## §38 — What the Hush Leaves (Round 1 leftover, Draft 5)

Files: `38-what-the-hush-leaves-v1.png` … `v4.png`. All four wide. The frame is the same in every variant: the great ring harbor at dusk, ships moored in ordered rows, and on the horizon the Hush standing as a vast pale wall of mist, perfectly still, spanning the whole sky — a wall, never an army, never fire, exactly per canon. Ash blue and mist white throughout.

- **The one gold window** holds in v1 (a lit doorway with the watcher's silhouette), v2 (one warm archway, a figure standing in it — the most literal "someone still watching") and v4 (a single gold window in the harbour building). v3 lets a few subsidiary doorways glow on the right-hand building alongside its watcher window — a minor multiplication.
- **The absent berth** reads best in v2 and v3: a conspicuous empty rectangular basin in the foreground quay with no ship in it, the dockworkers walking around its edges without looking in. v4 has a smaller quay gap; in v1 the rows are dense and no single absence stands out — v1 is weakest on the set's central detail.
- Interpretation note for Claude: in v2/v3 the absence takes the shape of an empty dry-dock basin rather than a gap in a row of moored ships, and the Hush wall's texture leans toward a frozen waterfall in all four — still mist and still still, but worth his eye.

Verdict: a strong, dread-quiet set; v2 and v3 carry the absence best. Your pick.

## §39 — The Sixth Account (Round 1 leftover, Draft 5)

Files: `39-the-sixth-account-v1.png` … `v4.png`. All four wide, all top-down as specified. Five aged scrolls lie side by side on the dark table, each under its own small lamp in the sheet's sequence — gold, green, brass, violet, steel blue — and the thin line of pale light runs from scroll to scroll through all four variants, gathering at the centre into something almost standing: most complete in v3, where the outline has a head above the table and arms reaching to the outer scrolls, and v1, where it rises head-and-shoulders over the middle scroll; implied by a knot of threads in v2 and most abstract in v4.

- **The writing varies, and one end of the range misses the sheet.** v3's five pages are fully written in five visibly different hands, all of it illegible pseudo-script — no readable word, the same class as §50's ledger. v4's pages carry faint sketchy scrawls. But v1 and v2 leave the parchment **blank**: they satisfy "no readable writing" trivially while dropping "each written in a different hand." Flagged for Claude — if the five hands matter, v3 is the only full match.
- No other flags; the dawning-recognition mood lands in all four.

Verdict: v3 is the sheet's fullest match; the blank pages in v1/v2 are the note. Your pick.

## §40 — Soumaya's Ship, the Seventh Hull (Round 1 leftover, Draft 5)

Files: `40-soumayas-ship-the-seventh-hull-v1.png` … `v4.png`. All four wide, all four true concept sheets: the same ship in side, three-quarter and front views on a dark neutral ground, and within each sheet the three views plausibly describe one design (each variant is a different candidate design, as a concept round should be).

- **The nameplate is right in all four** — the detail this set lives or dies by. On the flank, where a name would go, there is a clean empty RECTANGLE of bare metal: clearest in v2's side view (one large blank grey plate) and present in the side and three-quarter views of v1, v3 and v4. No lettering anywhere on any hull.
- Engine glow is soft blue-white with a violet edge throughout; the family echoes read across the set — swept prow, plumb keel, bloom-curved wings in the front views of v2 and v4.
- One delight worth Claude's eye either way: v4 makes the "latch-like fin" literal — an actual latch mechanism rides the dorsal fin in its side and three-quarter views. Charming or too on-the-nose is a taste call, not a defect.

Verdict: the strongest possible outcome for this set — the rectangle survived every roll. Your pick.

## §41 — Ysmerel at the Hush's Edge (Round 1 leftover, Draft 5)

Files: `41-ysmerel-at-the-hushs-edge-v1.png` … `v4.png`. All four wide. Ysmerel is herself in every variant — the same tall, weathered woman from §21 and §49, grey hair tied back, seated in profile on the low stool at the plain's edge — and the sheet's discipline holds in all four: mouth closed, eyes open, gaze on the Hush, and her thin hand resting flat on the ground beside the stool, counting a breath. The choir-robe is carried folded over her arm, not worn; her clothes stay plain and dark, as written. Down the line, far off, the other quiet sitters keep their distance in every variant — chosen company, not a crowd.

- **The Hush** stands as a still pale wall on the horizon throughout; the v3 and v4 walls are the smoothest and most mist-true, while v1 and v2 carry the same faint frozen-waterfall streaking noted in §38 — flagged there, same note here.
- The single pale gold glint is kept to one in every variant (a lone star in v1/v3, a distant point of light on the line in v2/v4).

Verdict: a clean, consistent set; no new flags. Your pick.

## §42 — Hesk's Room and Tamsin's Ward (Round 1 leftover, Draft 5 — the last of the sheet)

Files: `42-hesks-room-and-tamsins-ward-v1.png` … `v4.png`. All four wide, all four true diptychs: two rooms, one thin wall down the middle. Left, the storeroom in lamp-gold and wood — shelves of small ordinary belongings, every one with its careful tag: the tin toy (a soldier in v1, a doll-figure in v4, a tin robot in v3), the ribbon, the boot and the spoon all present across the set. Hesk stands in the doorway with his back to us in every variant, big in the Warden's coat, the ring of keys in his hand (fullest in v2 and v4). Right, the ward in ember amber and green: cots of pale, half-transparent patients, resting — the Faded exactly as canon draws them, no gore, no fear — and Tamsin among them in her green apron, the same face as §23 and §47.

- **The keyhole window** — the set's signature — is in the dividing wall and glowing in all four: a round window with a keyhole at its heart in v1 and v2, a tall glowing keyhole in v3 (the largest and most dramatic), a lit keyhole plate in v4. Same wall, same place, both sides, every time.
- **The counting** reads clearly only in v1, where Tamsin's raised finger is mid-count; in v2–v4 she holds a small count-slip and looks down the row — the count implied rather than shown.
- One near-miss for Claude's eye: v4's shelf tags carry the closest-to-legible pseudo-writing of the round — still no readable word at full size, but the nearest the generator came.

Verdict: two halves of one grief, delivered as written. The sheet is complete. Your pick.

## Owner findings — 2026-10-30 evening (from King, at the owner's direction)

The owner reviewed the Book in dev view and raised three things. All three checked against main's code tonight; findings and fix shapes below. He wants all of it solved.

### 1. Art: 41 of 77 Book entries have no painting anywhere

`STORY_ENTRIES` (packages/shared/src/storyCanon.ts) holds **77 entries**. `STORY_ART` (packages/web/src/lib/storyArt.ts) places **36**, and all 36 web copies are verified present in `packages/web/public/lore/`. The other **41 entries have no painting in existence** — they were never in any prompt sheet, so there is nothing to place until a Sheet 3 round is written and generated:

- **Faded Ward cluster (12):** sight.ward-door, sight.ward-long-hall, sight.ward-lanterns, sight.ward-window, sight.ward-blank-cot, obj.ward-bowl, obj.ward-soldier, obj.ward-button, obj.ward-wake, echo.ward-hum, echo.ward-far-breath, echo.ward-count
- **Road cluster (10):** sight.road-mouth, sight.road-lamps, sight.road-chalk, sight.road-chalk-end, sight.road-post, sight.road-far, obj.road-nails, obj.road-doorframe, obj.road-oil, echo.road-steps
- **Relic cluster (9):** relic.witness-without-a-name, relic.witness-seed, relic.first-light-shard, relic.basin-stone, relic.lantern-of-keeping, relic.hearth-ember, relic.sunward-compass, relic.unopened-fold, relic.unnumbered-fragment
- **Singletons (10):** sight.dead-bough, sight.open-alcove, sight.second-seam, sight.empty-chair, sight.unlooked-direction, obj.tin-soldier, obj.faded-ticket, obj.vesh-paper-boat, obj.doorkeepers-nail, obj.dissenters-chart

Also: the §37 (Seven Kept), §39 (Sixth Account) and §42 (diptych) paintings sit in docs/lore/art but match no unplaced entry id King can find (the seventh hull is covered by sight.blank-nameplate; Hesk's room and Tamsin's ward are already placed from earlier picks). Claude to say where those three belong, or confirm they are gallery-only.

### 2. Narration: the dev-view fallback is the server's discovery rule, proven in code

`GET /story/narration/:entryId` (packages/server/src/api/routes/story.ts) refuses any entry not in the brain's finds — `403 "You have not found that yet."` — and the client (packages/web/src/lib/narration.ts) treats any non-200 as "no clip" and falls back to the browser's own voice. The dev view shows unfound entries, but the route still gates them, so the owner hears Chrome's TTS for everything he hasn't discovered. His guess was exactly right. **Fix shape:** exempt owner spaces on that route (the same `isOwnerSpace` check the Voices console already uses) so the owner can hear every entry in dev view, while real players keep the discovery rule. Found entries are unaffected either way; clips are voiced once and cached on the volume.

### 3. Voices: the console works, but the labeling the owner asked for isn't there

The Voices console exists (owner-only, in the Book) and assignments are live per role — a character's voice is heard when one of their reaction/talk lines plays; ordinary entry narration is always the Narrator. Two gaps against the owner's standing requirement (wherever a voice is assigned, the character's sex, age and personality must show at that spot):

- `ROLE_LABEL` in packages/web/src/components/VoiceConsole.tsx names only 9 of the 15 `VOICE_ROLES`; **hesk, tamsin, ossian, ilsabet, pell and wim render as raw lowercase keys.**
- No role shows the character's sex, age or personality. The cast data (CastMember, packages/shared/src/npcs.ts) carries a prose `voice` personality line but no structured sex/age; the Continuity Bible's identity table is the only complete source. The console needs a per-role character card (name, sex, age, personality) fed from canon, so the owner can cast by ear with the person in view.

## King Sheet — set relic.witness-without-a-name (generated 2026-10-30, King's prompts, picks PROVISIONAL until Claude/owner rule)

All four: a smooth, plain, opal-white ovoid resting at the edge of still basin water in a towering stratified canyon in the Deep Past — on-brief in every variant; no figure anywhere (the Unnamed is present only as her object, per the Bible). Caveat for the pick: the object reads egg-like in all four; the Bible fixes only "smooth, plain, opal-white", so an ovoid is a fair reading, but Claude should confirm the shape sits right beside the relic's 3D model. v1 (object right foreground, glow from within, strata and basin balanced) is King's provisional pick; v3 is the widest vista with the strongest first-light sky; v2's object is the most flattened; v4's glow pools in the water at the shore.

## King Sheet — set relic.witness-seed (generated 2026-10-30, picks PROVISIONAL)

All four hold the registry facts: a bare, matte, UNGLOWING seed-shaped relic at the witness tree's base, seedlings crowding the soil, terraced growing place, dawn through the canopy. v1 is King's provisional pick (seed centred between the roots, terraces balanced both sides). v3's seed is the most textured/pitted and reads the most egg-like; v4's is the flattest and quietest, nested in moss; v2 gives the tree the most grandeur. No figures, no glow violations.

## King Sheet — set relic.first-light-shard (generated 2026-10-30, picks PROVISIONAL)

All four: a translucent shard with warm-white light held inside it, resting on dark rock at a basin's rim, mirrored in the still water — the registry's transmission/glow description made visible. Scale note: in v1/v2 the shard stands monumental; the registry doesn't fix a size, and v3 (reclined, thin, most fragment-like) and v4 (long and low against a pale amphitheatre basin wall — the basin reads truest here) keep it smaller. King's provisional pick is v1 (strongest shard-and-reflection composition); v4 is the alternate if Claude wants the basin itself to carry the scene.

## King Sheet — set relic.basin-stone (generated 2026-10-30, picks PROVISIONAL)

All four hold the registry line exactly: one dark stone, bare and unglowing, its surface ringed with shallow waterline striations, alone on the floor of a vast empty basin with a thin skin of still water nearby. King's provisional pick is v1 (stone nearest, waterlines clearest, the pool mirroring the cliffs). v3's stone is the largest and most ovoid; v2 loses the stone a little in the basin's scale; v4's is the roundest, like a kept pebble at world scale.

## King Sheet — set relic.lantern-of-keeping (generated 2026-10-30, picks PROVISIONAL)

The cleanest relic set so far: all four place one small sealed lantern with a quiet warm light in a low stratum alcove above dark basin water, scrolls and plain vessels in the neighbouring alcoves, and exactly one soft reflection below — "keeping need not mean disturbing" in every frame. King's provisional pick is v1 (lantern hung in its rounded alcove, reflection directly beneath it). v2's alcoves read most built/architectural; v4 shrinks the lantern against a vast mirrored deep — beautiful, but the relic nearly leaves the frame.
Addendum (lantern-of-keeping): v2 rendered at 2240×1120 (2:1) against the 2048×1152 (16:9) of v1/v3/v4 — a ratio miss on that one variant only.

## King Sheet — set relic.hearth-ember (generated 2026-10-30, picks PROVISIONAL)

All four keep the hard rule: the ember never burns — no flame anywhere, only a low amber light breathing in the cracks of one coal-like fragment in the ash, with cushions and plain clay vessels around a stone hearth under a low roof. King's provisional pick is v1 (ember centred in its ring of hearth stones, cushions left, vessels right, the room warmest). v4's ember is the smallest and its room the coldest blue — the relic nearly leaves the scene; v3's hearth reads as a floor scatter rather than a built hearth.

## King Sheet — set relic.sunward-compass (generated 2026-10-30, picks PROVISIONAL)

All four keep the canon refusal: the needle swings to the rising sun and the paintings say nothing more about what it points to. King's provisional pick is v1 (needle and sunrise in one line, chart folded plain beside the rope). Flags: v2 carries a tiny engraved "N" glyph at the needle's hub — a near-text artifact against the no-text line; v3's folded chart bears a glowing cyan diagram that reads like a display/UI rather than sail-cloth. v4's needle is an oversized rod — the clearest sunward geometry, the least compass-like object.
Addendum (sunward-compass): v1 and v2 rendered at 2240×1120 (2:1); v3/v4 at 2048×1152 (16:9).

## King Sheet — set relic.star-hanger (generated 2026-10-30, picks PROVISIONAL)

All four: a chart-dome exhibit hall, rows of empty seats, dark instrument panels, and one warm navigation star hung low on a fine chain, brought down to touching height while everything keeps its distance — the registry's inversion of "a star is for distance" holds in every frame. King's provisional pick is v2 (dead-centre aisle, the star a small point of light at the chain's end, hall geometry strongest). Caution on v1 and v4: their hanging stars are textured golden spheres that read slightly ornamental, like baubles; v3's star is a pure spark under a glass constellation dome.

## King Sheet — set relic.unopened-fold (generated 2026-10-30, picks PROVISIONAL) — RELICS COMPLETE (9 of 9)

The set splits the registry's deliberate ambiguity both ways: v1's fold is brass and angular — a folded HULL; v3 and v4 are pale folios — a folded PAGE; nothing in any variant shows contents. King's provisional pick is v1 (the hull-reading, and the strongest composition), with v3 as the page-side alternate. One flag: v2's object lies spread flat like an open blank book — of the four it comes closest to breaking "unopened", and Claude may want it marked do-not-use on that ground.

## King Sheet — set sight.unlooked-direction (generated 2026-10-30, picks PROVISIONAL) — 3 variants only

Process note: one of the four generation calls was declined by the image tool, so this set has three variants (as §7 did in Round 1). Composition held in all three: Eternity entirely from behind above the basin, all white, no face, no hair, one hand slightly raised and NOT pointing; the subject is the direction of his attention. King's provisional pick is v2 (ring vertical behind his head, the gaze-line to the lit far shore strongest, raised hand clearest). Flags for Claude: v1 gives the figure mild anatomical definition, against the Bible's "no body detail"; v3 renders the ring HORIZONTAL, like a flat halo seen from behind, where canon is a thin ring behind the head — v3 is the weakest on canon.
Addendum (unlooked-direction): v1 rendered at 1920×1280 (3:2); v2/v3 at 2048×1152 (16:9).

## King Sheet — set obj.doorkeepers-nail (generated 2026-10-30, picks PROVISIONAL)

Composition is right in all four: the nail hangs from a cord loop beside the gate, lamplight warm on it like a hearthstone, bells and harbour lights beyond. But the standing §37 flag repeats exactly — the prompt says headless and all four nails carry a flat round HEAD (disc cap in v1/v3, T-bar in v2, flat head in v4), and in v1/v3/v4 the nail is oversized, reading almost dagger-like. King's provisional pick is v2 (smallest, most nail-like, hung on the door-frame with the harbour framed beyond it). If Claude wants a true headless nail at hand scale, this set needs a redo with the head and size called out harder.
Addendum (doorkeepers-nail): v4 rendered at 1920×1280 (3:2); v1–v3 at 2048×1152 (16:9).

## King Sheet — set sight.uncrossed-threshold (generated 2026-10-30, picks PROVISIONAL)

The cleanest singleton set: all four sit low across the sill with lamplight and lived-in clutter on this side and an unbroken pale dust floor beyond — not one footprint in any variant, which is the entire entry. King's provisional pick is v1 (sill running the full width, dust mirror-clean, lamp low). v4 makes the "door stands open and patient" most literal with its open double doors deep in the hall.
Addendum (uncrossed-threshold): v1 and v3 rendered at 1920×1280 (3:2); v2/v4 at 2048×1152 (16:9).

## OWNER SCALE RULING (2026-10-30 ~8:47 PM EDT) — Eternity is cosmic scale

Owner's words, in substance: Eternity is cosmic scale. He can shrink if he wants, so smaller depictions are usable as variation — but he IS cosmic scale, the way he'd look down at a planet from the sky, the majority of the time. Consequences: (1) the sight.unlooked-direction set above is human-scale and so reads as a shrunk visit — permitted, but Claude/owner may prefer a cosmic-scale take for that entry; (2) all future Eternity depictions default to cosmic scale, including echo.first-light-basin later in this sheet (the Shape at the rim, distant over the basin).

## King Sheet — set obj.mended-banner (generated 2026-10-30, picks PROVISIONAL)

All four hang the banner whole again over an empty dawn muster field — no army, no legible emblem, and the mending carries the meaning in each. King's provisional pick is v2: dark cloth crossed by several seams of golden, plainly mismatched stitching, the repair visibly the most beautiful thing in the frame. v1's single long laced seam down pale cloth is the close alternate; v3 adds honest patch squares; v4's banner is narrowest and its field the wettest.

## King Sheet — set sight.road-not-taken (generated 2026-10-30, picks PROVISIONAL) — SINGLETONS COMPLETE (5 of 5)

All four hold both roads in one frame from the junction stone and judge neither: the walked road runs lamplit to the town, the unwalked climbs moss-green with its lamps long dark. King's provisional pick is v1 (junction stone in the foreground, the parting clearest, the unlit lamps on the climb most readable). Small note: the junction stones in v1/v2 carry carved abstract geometry — star and line patterns, no letters — which reads as waymark carving, not text.

## King Sheet — set sight.ward-window (generated 2026-10-30, picks PROVISIONAL)

The Ward opens gently, as its entries demand: all four are quiet faded rooms with one tall window open to a kind night sky, the curtain moving in mild air, and an empty resting-chair turned toward the sky rather than the room. Nothing frightening anywhere. King's provisional pick is v1 (chair nearest the window, curtain streaming furthest into the room, the night air visibly the clearest thing present). v3 adds a lit side lantern as a warm counter-note. The rooms lean derelict-peeling rather than infirmary-plain; the mood stays gentle, and "faded" covers it.

## King Sheet — set sight.ward-plain-rooms (generated 2026-10-30, picks PROVISIONAL)

The content is exact in all four: a corridor of plain rooms, every door open, and inside each the same kept kindness — made bed, folded blanket, chair, small table, cup — repeated like a held note. King's provisional pick is v2 (the repetition and the folded blankets read clearest, warmest lamplight). Styling note for Claude: the generator housed the Ward in a station corridor with space windows along one side rather than in a house interior; given the Ward's place in the worlds this reads as a setting choice, not an error — but it sets the visual register for the remaining Ward interiors, so he should confirm it once here. v4's cyan floor light-strips are the most tech-forward detail in the set.
Addendum (ward-plain-rooms): v4 rendered at 2240×1120 (2:1); v1–v3 at 2048×1152 (16:9).

## King Sheet — set sight.ward-counting-room (generated 2026-10-30, picks PROVISIONAL)

All four deliver the room whole: shelves of counted linen piles, jars in careful rows, and the tall ledger open on the desk with ruled, patiently filled columns — the handwriting stays texture throughout; no name or number is legible in any variant (v3's tally-mark columns come closest to readable counting and still resolve to marks, not figures). King's provisional pick is v1 (ledger largest, lantern at its shoulder, the worn pencil on the desk). The Ward's station-register from the plain-rooms set continues here (space windows in v1/v3/v4).

## King Sheet — set obj.ward-bell (generated 2026-10-30, picks PROVISIONAL)

All four keep the bell what the entry says it was: a small brass hand-bell on its folded cloth on the sill, handle worn smooth, corridor quiet beyond the open door — gentle and domestic in every variant, never an alarm. King's provisional pick is v1 (bell, cloth, window light, and corridor in the best balance). v3 leans hardest into the station register (bulkhead corridor, a planet at its end); v2 shows the ward's made beds through the doorway.
Addendum (ward-bell): ratio misses — v1/v3 at 1920×1280 (3:2), v2 at 2240×1120 (2:1); only v4 is true 2048×1152.

## King Sheet — set sight.ward-chairs (generated 2026-10-30, picks PROVISIONAL)

All four keep the arrangement intact, which is the painting: two worn chairs facing one another across the low table, two cups set down, a shawl over one chair's back — the conversation only paused. King's provisional pick is v1 (intact room, gentlest light). v3 is the outlier in mood: its room is half-ruined with cobwebs, leaning mournful where the entry's arrangement itself is not; usable, but it argues with the brief.

## King Sheet — set obj.ward-lamp-stand (generated 2026-10-30, picks PROVISIONAL)

The painting's whole point lands in all four: the lamp is cold, but the stand's post carries a band of polished brass at exactly hand height — care recorded as wear, unmistakable in every variant. King's provisional pick is v2 (stand closest, the bright band widest, the corridor of ajar doors behind). FLAG for Claude: v4 carries legible wall signage — "WARD 3 - RESTING" on the left wall and again over the corridor arch — actual rendered text against the sheet's no-text rule; v4 should be marked do-not-use or the signs cropped. v1–v3 are text-free.
Addendum (ward-lamp-stand): ratios — v1 2240×1120 (2:1), v2/v3 1920×1280 (3:2), v4 2048×1152 (16:9).

## King Sheet — set obj.ward-folded-blanket (generated 2026-10-30, picks PROVISIONAL)

The refusal held in all four: the blanket is folded with deliberate, somebody-owns-this care at the bed's end, and in its corner sit two small stitched marks side by side — abstract thread crosses, never letters, never names. King's provisional pick is v2 (the two marks largest and clearest as a pair, the room plainest around the one deliberate fold). v1's marks are smallest; v3/v4 place them on the fold's top face.
Addendum (ward-folded-blanket): v3 rendered at 1920×1280 (3:2); v1/v2/v4 at 2048×1152.

## King Sheet — set echo.ward-night-rounds (generated 2026-10-30, picks PROVISIONAL) — THREE VARIANTS ONLY

One of the four generation calls failed with a tool error and produced no file; per the standing rule it was not retried, so this set ships with three variants, like §7 and sight.unlooked-direction. All three show the travelling light paused at a door at walking height, no hand and no figure anywhere. King's provisional pick is v2 (the light hangs free in the air mid-pause, plainly un-carried; in v1 it sits close enough to the door frame to read as a wall lamp). Mood note: these corridors are the darkest of the Ward sets — the light itself stays warm and unhurried, but Claude should check the set against the Ward's not-frightening rule with his own eye.

## King Sheet — set echo.sound-through-wall (generated 2026-10-30, picks PROVISIONAL)

All four solve the hard composition the same faithful way: one frame split by the thin shared wall — music room on the left (empty chair, music stand, resting instrument case), listening bed on the right with its blanket turned down, and a lamp lit in each room, as if each kept a light on for the other. Nothing played, no one present. King's provisional pick is v1 (the wall most central, the two lamps most plainly mirrored). v2's instrument case stands open-shape against the wall as a cello case; all cases stay closed and resting.
Addendum (sound-through-wall): ratios — v1 2240×1120 (2:1), v2 1920×1280 (3:2), v3/v4 2048×1152.

## King Sheet — set echo.first-light-basin (generated 2026-10-30, picks PROVISIONAL) — WARD CLUSTER COMPLETE

Painted under the owner's scale ruling given during this session (Eternity is cosmic scale by default; he can shrink, but the majority of depictions are cosmic): all four put the basin below him like a map and the Shape vast and distant on the horizon — all white, no face, no hair, thin ring of his own light behind his head. King's provisional pick is v2 (the basin the cleanest sheet of first light, the figure smallest, the ring thinnest). v3/v4 give him more stature and slight bodily definition (limbs readable at distance; still no face and no detail) — Claude's eye decides whether that stays inside "no body detail." This closes the Ward cluster (12 of 12).
Addendum (first-light-basin): v3 rendered at 1920×1280 (3:2); v1/v2/v4 at 2048×1152.

## King Sheet — set sight.road-first-mile (generated 2026-10-30, picks PROVISIONAL) — ROAD CLUSTER OPEN

All four are the same true composition: cobbles in the foreground giving way to packed earth, the harbour town lamplit behind, the road running ahead into open dawn country, and the mile-marker stone blank-faced at the roadside. Departure without sorrow, as briefed. King's provisional pick is v1 (the cobble-to-earth transition, the town, and the stone all clearest in one frame). v4's stone shows its blank face most frontally.

## King Sheet — set sight.road-carters-rest (generated 2026-10-30, picks PROVISIONAL)

All four carry the full inventory — stone shelter, worn bench, trough full of water, hitching rail, and the cart parked with its shafts lowered to the ground — and the kept-not-abandoned difference reads: lamps lit, troughs full, nothing broken. King's provisional pick is v2 (trough nearest, cart and the road beyond both in frame). No people and no animals in any variant, as briefed.

## King Sheet — set obj.road-waystones (generated 2026-10-30, picks PROVISIONAL)

All four keep the row at a walker's interval with blank, weather-smooth faces, and the nearest stone holding the day's warmth as an amber afterglow in the rock. King's provisional pick is v1 (the afterglow softest — remembered heat rather than light — and the row longest). v4 runs hottest: its glow is a bright lit seam down the stone, closest to reading as magic rather than warmth; Claude's call.
Addendum (road-waystones): v2 at 1920×1280 (3:2), v4 at 2240×1120 (2:1); v1/v3 at 2048×1152.

## King Sheet — set sight.road-inn-porch (generated 2026-10-30, picks PROVISIONAL)

All four give the full composition: long porch, lanterns lit along it, benches, the open door with the hearth's edge inside, and the road passing in front and going on into dusk — a pause, not an end. No sign or lettering anywhere on the inn in any variant. King's provisional pick is v1. Register note for Claude (like the Ward station question): the generator set this inn in arid canyon country with dust drifted against the porch boards, where the earlier Road sets are green country — the cluster now has two landscapes; bless or split with his eye.

## King Sheet — set sight.road-ford (generated 2026-10-30, picks PROVISIONAL)

All four hold the brief exactly: the road runs down one bank, through the shallows over flat stones between worn marker posts, and up the far bank without breaking stride — and no bridge appears in any variant. King's provisional pick is v1 (the crossing's line clearest end to end, the far bank already in morning sun). The landscape here is the green country of the earlier Road sets, not the inn porch's canyon.
Addendum (road-ford): v3/v4 at 1920×1280 (3:2); v1/v2 at 2048×1152.

## King Sheet — set sight.road-long-hill (generated 2026-10-30, picks PROVISIONAL)

All four climb in switchbacks to a great skyline cairn, with the walkers' little stone piles lining the whole ascent — the census reads at a glance, and no person appears in any variant. King's provisional pick is v2 (the foreground piles read clearest as humble one-stone-each records against the summit cairn's height). v1's right side falls away into open star-space rather than valley — beautiful, but it moves the hill off the world; Claude's call.

## King Sheet — set obj.road-shrine (generated 2026-10-30, picks PROVISIONAL)

The hard rule held in all four: the niche is EMPTY — no figure, no icon, nothing carved — and the bowl at its foot holds exactly the small habit of offerings (pebbles, a dried sprig, a button readable in v1/v2/v4, a coin and folded cloth in v3), with the candle-lantern kept lit beside it. King's provisional pick is v2 (the crossing reads in four directions and the bowl sits front and centre). Setting note: these stand in the canyon country of the inn-porch set, not the green country — the Road cluster's two landscapes now have two sets each.
Addendum (road-shrine): v1 at 1920×1280 (3:2); v2/v3/v4 at 2048×1152.

## RECONCILIATION — 2026-10-30 late evening (King, self-audit before set 32)

King stopped and checked the generated files against the Book's actual entry list on main (storyCanon ids minus STORY_ART placements, both re-fetched fresh). Findings, plainly:

- Of the sets generated under Sheet 3, **11 match real unplaced entries** and are placeable as planned: the eight relics (witness-without-a-name, witness-seed, first-light-shard, basin-stone, lantern-of-keeping, hearth-ember, sunward-compass, unopened-fold), obj.doorkeepers-nail, sight.unlooked-direction, sight.ward-window.
- **20 generated sets match NO entry in the Book** and cannot be placed: relic.star-hanger (a relic the Book has no entry for — the Book's ninth unplaced relic is the Unnumbered Fragment), echo.first-light-basin, echo.sound-through-wall, echo.ward-night-rounds, obj.mended-banner, obj.road-shrine, obj.road-waystones, obj.ward-bell, obj.ward-folded-blanket, obj.ward-lamp-stand, sight.road-carters-rest, sight.road-first-mile, sight.road-ford, sight.road-inn-porch, sight.road-long-hill, sight.road-not-taken, sight.uncrossed-threshold, sight.ward-chairs, sight.ward-counting-room, sight.ward-plain-rooms. These came from a working list used during this session that was NOT the sheet's — the sheet on disk (PROMPT_SHEET_KING.md, built from the canon extract) was right all along. The 20 sets are kept in the art folder as unattached paintings; whether any become gallery pieces or future entries is Claude's/owner's call. Their QA sections above stand as honest records of what they depict.
- **41 real entries still need paintings** (the true remainder): relic.unnumbered-fragment; singletons sight.dead-bough, sight.open-alcove, sight.second-seam, sight.empty-chair, obj.tin-soldier, obj.faded-ticket, obj.vesh-paper-boat, obj.dissenters-chart; Ward sight.ward-door, sight.ward-long-hall, sight.ward-lanterns, sight.ward-blank-cot, obj.ward-bowl, obj.ward-soldier, obj.ward-button, obj.ward-wake, echo.ward-hum, echo.ward-far-breath, echo.ward-count; Road sight.road-mouth, sight.road-lamps, sight.road-chalk, sight.road-chalk-end, sight.road-post, sight.road-far, obj.road-nails, obj.road-doorframe, obj.road-oil, echo.road-steps; Village sight.village-gate, sight.village-windows, sight.village-chair, sight.village-hearth, sight.village-door, obj.village-well, obj.village-hooks, obj.village-bread, obj.village-thread-end, echo.village-count.
- Count note: canon scan finds 86 entry ids and 34 placed ids (52 unplaced) vs the audit's 87/36 (51) — a two-id counting difference in the scans, not in the work; the per-id lists above are the verified ground truth.
Correction to the reconciliation count: the still-to-generate remainder is 41 — the 40 named above plus relic.what-she-held-when-she-asked, a relic entry the original briefs extract missed (its text lives with the relic registry, like the other relics). Its prompt will be written from the registry lore when its turn comes.

## King Sheet — set relic.unnumbered-fragment (generated 2026-10-30, picks PROVISIONAL) — first set on the corrected list

All four hold the canon refusal: a small translucent fragment adrift in uncounted dark, pale glow held inside, one face covered in fine markings worn past all reading — in no variant does any marking resolve into legible text. King's provisional pick is v1 (the fragment smallest against the expanse, the markings visible but unreadable, the unclaimed rest most complete). v4's fragment is the flattest and most leaf-like; v2's the most tablet-like.

## King Sheet — set sight.dead-bough (generated 2026-10-30, picks PROVISIONAL)

All four are exact to the entry: the colossal tree over the terraced growing place, the canopy vast and green, and one great bough bare and pale pointing out over the unlooked direction — with a few small new leaves just greening at its very tip, as the entry promises for those who carry a Journey to its end. Tiny travellers pass on the path below. King's provisional pick is v1 (the bough longest against the dark, the greening tips clearest). This painting and sight.unlooked-direction are the same fact from two sides; Claude may want them hung as a pair.

## King Sheet — set sight.open-alcove (generated 2026-10-30, picks PROVISIONAL)

All four hold the entry: a long archive wall of sealed alcoves, every tag blank (no writing on any tag in any variant), exactly one alcove open and lamplit with the letter inside still folded — never unfolded — and the nightly watcher present only as a hooded back, face never shown. King's provisional pick is v2 (the open door swung widest, the envelope plainly a letter, the wall's sealed length most overwhelming). v3's alcove is grander, almost a doorway; v1's letter lies flattest.

## King Sheet — set obj.tin-soldier (generated 2026-10-30, picks PROVISIONAL)

All four give the store-room of kept belongings, the blank tags, the folded polishing cloth beside the soldier, and paint worn bright at the edges — treasured, not discarded, in every frame. Honest flag: the missing arm is plainly visible only in v1 (a stub at the shoulder) and v3 (a broken stump); in v2 and v4 the soldier reads two-armed at a glance. King's provisional pick is v3 (faces outward on guard over the room, the broken arm readable, the cloth at his side). The soldier's moulded toy face is a toy's, not a person's — no canon issue.

## King Sheet — set sight.second-seam (generated 2026-10-30, picks PROVISIONAL)

All four hold the brief: the immense curved harbour metal at night, the seam never opened, and the thin line of white lying along it like held breath — the brightest thing in every frame — with tiny lamp-lit workers giving the scale. King's provisional pick is v3 (the line sweeps the full curve and leads the eye out of the frame, the harbour floor and its lamps spread below). Note for Claude: the generator rendered the harbour structure as a vast hull-like curve; if the Second Seam belongs to the harbour ring rather than a hull, v2 (the ring seen from above) is the closest alternate.

## King Sheet — set obj.faded-ticket (generated 2026-10-30, picks PROVISIONAL)

All four hold the refusal: the old ticket lies face-up in harbour lamplight with every mark smudged soft into texture — nothing readable on any of them — the folded coat and the cup resting nearby, the ticket the warm centre. King's provisional pick is v3 (harbour lights beyond the table, the ticket's creases most handled-looking). Small notes: v1's cup steams faintly though the brief says cold; v4's cup lies tipped on its side.

## King Sheet — set obj.vesh-paper-boat (generated 2026-10-30, picks PROVISIONAL)

All four are gentle and exact: the little boat folded from archive paper on the stone basin's edge, dusk coming through the paper, and Vesh present only as the violet-grey edge of a hooded robe at the frame's edge, already turning away — no face, nothing shown that canon guards. The unfinished name stays unfinished: v2 and v4 carry a single faint pen-stroke on the inside fold, unreadable in both. King's provisional pick is v2 (the stroke present, the boat nearest the water, the robe barely in frame).

## King Sheet — set sight.empty-chair (generated 2026-10-30, picks PROVISIONAL)

All four keep the rule: the place is kept, not mourned — a modest lamplit home, the table laid for one more than the household holds, no one in the room, the evening harbour beyond the window. King's provisional pick is v1 (the kept chair drawn up in the foreground, its place set, the others pushed in). v2 and v4 pull the extra chair apart from the table entirely — a stronger absence, a slightly different sentence; Claude's call between them. Note: v3 moors a very large vessel directly outside the window, which pushes the harbour toward fleet spectacle.

## King Sheet — set obj.dissenters-chart (generated 2026-10-30, picks PROVISIONAL)

All four hold the chart's paradox: one perfect smooth circle with no coastline — the chart of the place no one has charted — ringed by margins of angry handwriting worn down to strokes and scribble; no word resolves into reading in any variant, the last lines are struck through, and a hand rests flat at the edge stilling the sheet. No face anywhere. King's provisional pick is v1 (the circle most perfect against the chaos of its margins, the stilling hand strongest).

## King Sheet — set sight.ward-door (generated 2026-10-30, picks PROVISIONAL)

All four give the ajar door, the hand's breadth of warm light on the threshold, the watercolour-soft figure slipping through, and the cots resting under trimmed lanterns. King's provisional pick is v2 (the gap narrowest, the figure mid-slip without widening it). Flags for Claude: in v3 and v4 the door stands well open rather than ajar; the slipping figure leans ghostly in all four and v1's hooded bowed form is the most defined — check against the Ward's hushed-not-frightening rule. The Ward again renders as a station corridor with space beyond the windows (same register question as sight.ward-plain-rooms).

## King Sheet — set sight.ward-long-hall (generated 2026-10-30, picks PROVISIONAL)

All four deliver the hall that goes on: crisp made-up cots in the near ground softening into pale fog that never resolves into an end, lanterns at even heights the whole way. Nobody says where the cots stop, and no variant shows it. King's provisional pick is v3 (the most symmetrical endlessness, the fog swallowing the rows dead centre). Same standing register note as the other Ward interiors: the hall reads as a station colonnade — Claude to rule once for the cluster.

## King Sheet — set sight.ward-lanterns (generated 2026-10-30, picks PROVISIONAL)

The sameness is the subject and all four deliver it: lantern after lantern at exactly the same height with the same even flame, down a hall with no visible end, over half-transparent resting figures in watercolour softness — care, repeated perfectly, by unseen hands. King's provisional pick is v3 (the lanterns closest and most identical, in a double row). Caution for Claude: the nearest resting figures in v1 and v4 show soft profile faces; they are unnamed shades, not cast members, so no faceless rule is breached, but the mood check (resting, never corpselike) is his to make.

## King Sheet — set obj.ward-bowl (generated 2026-10-30, picks PROVISIONAL)

All four hold the small mystery exactly: one bowl on a plain table in the aisle, a thin curl of steam rising whatever the hour, lantern light pooled on the table, the resting figures watercolour-pale on the cots either side. Nobody is eating; nobody has refilled it; it is simply warm. King's provisional pick is v1 (the steam curl strongest, the bowl dead centre between the two cots).

## King Sheet — set obj.ward-soldier (generated 2026-10-30, picks PROVISIONAL)

All four keep the bed watched over, not lost: the small made bed, the child's dent in the pillow, the cot-lantern burning low, and the soldier on guard with his paint worn through. King's provisional pick is v2 — the soldier is smallest and most toy-like there, standing between the bed and the open doorway, facing out as the brief asks (v4 turns him toward the bed instead). Honest notes: the generator scaled the soldier large in v1, v3 and v4 (knee-to-waist height against the bed rather than a hand's height); and he carries a toy rifle in most variants, where Hesk's soldier (obj.tin-soldier) is unarmed — Claude may want the two soldiers kept distinct, or may not mind.

## King Sheet — set obj.ward-button (generated 2026-10-30, picks PROVISIONAL)

All four give the healer as the entry has her: green apron, rolled sleeves, one weathered hand turning buttons over in the pocket — and the buttons are plainly a collection, brass, pearl, star-stamped, cloth-covered, no two from the same coat — while she talks with someone off-frame and the ward goes on behind her. King's provisional pick is v1 (the pocket fullest, the buttons most varied, her profile warmest). She is an unnamed ward healer, not a cast portrait; Claude to confirm her face is welcome here.

## King Sheet — set sight.ward-blank-cot (generated 2026-10-30, picks PROVISIONAL)

All four keep the entry's restraint: among the occupied cots, one cot made up fresh — blanket folded, pillow smooth — with a paper tag at its foot that is blank in every variant, and the plain coat on the hook above that belongs to no one in the ward. Whoever it is ready for is never said. King's provisional pick is v2 (the blank tag largest and plainest, the coat hanging directly above the cot). Mood note for Claude: v1 and v4 put oxygen masks on some occupants, which leans clinical against the Ward's resting-shade register; v2's sleepers are plain.

## King Sheet — set echo.ward-hum (generated 2026-10-30, picks PROVISIONAL)

A sound, painted: the healer stands still in the aisle, head tilted, listening — and one cot among the rows is quietly the source, its resting figure lit from within, the nearest lantern flames leaning toward it. The hum belongs to no one in the hall and nothing explains it. King's provisional pick is v1 (the source cot plainest, the listening clearest). Continuity flag for Claude: the generator rendered this healer as a bearded man in all four variants, where obj.ward-button's healer is a woman — the sheet's hum prompt does not pin the healer's sex, so this is only a conflict if the two are meant to be the same person.

## King Sheet — set echo.ward-far-breath (generated 2026-10-30, picks PROVISIONAL)

All four paint the second sound: the near hall still and lamplit, and at the far end the mist itself swelling slow and even, like a breath the hall is taking in its own time — not any one sleeper's. King's provisional pick is v3 (the swell biggest and most breath-like, curling up between the last cots). Note: this is ward fog, not the Hush — but v1 and v2 roll it almost like surf, and Claude may want the texture kept gentler.

## King Sheet — set echo.ward-count (generated 2026-10-30, picks PROVISIONAL)

The third Ward sound, and the fondest: she walks the rows at night with two fingers raised mid-count, lips just moving, the cots running on past any number she reaches — there is always one more, and she begins again without complaint. The healer here is a woman in the green apron, matching obj.ward-button (which makes echo.ward-hum's bearded healer the odd one out — see that set's flag). King's provisional pick is v2 (an indoor hall, the count and the endless rows both clearest). Register note: v1 and v3 drift the ward outdoors under open sky; v2 and v4 keep it a hall.

## King Sheet — set obj.ward-wake (generated 2026-10-30, picks PROVISIONAL)

The Ward cluster closes with its smallest picture: the polished tin soldier left on the sill by the door overnight, bright in the last lantern light, the dark hall resting behind him. By morning he'll be gone again, and nobody says where he goes. All four keep him palm-small against the door (the scale wobble from obj.ward-soldier does not repeat). King's provisional pick is v1 (closest and warmest, the soldier plainly on guard beside the lantern).

## King Sheet — set sight.road-mouth (generated 2026-10-30, picks PROVISIONAL)

The Road cluster opens where the road does: a plain stone arch in the harbour wall, no sign naming it, no berth listing it, the road dropping away into quiet dark while the harbour stays lit behind. Dockhands cross toward it on errands; the ones coming back walk quieter. King's provisional pick is v1 (the arch most massive and plainest, the descending dark road clearest). Note: v4 gives the wall two arches; the entry's mouth is singular, and v1 keeps it so.

## King Sheet — set sight.road-lamps (generated 2026-10-30, picks PROVISIONAL)

All four keep the road's discipline: lamps at the same height and the same distance along both walls, the hooded traveller small and seen from behind, no lighter anywhere. The entry's gradient — lit a little ahead of him, dimming behind, dark far on — is closest in King's provisional pick v1 (the pair directly ahead of him burn brightest, the far lamps hang dark). v4 inverts it (near lamps dark, far ones lit) and v3 lights everything evenly; both noted so Claude can judge the mechanic, not just the mood.

## King Sheet — set obj.road-nails (generated 2026-10-30, picks PROVISIONAL)

All four keep the fact: a nail at every stride along the right-hand wall, each head shimmering faintly amber as if just set, and the line of them running straighter than anything else on the road into the lamplit distance. King's provisional pick is v4 (the most nail-like — heads against the wall, the line straightest). Honest deviation for Claude: the generator renders them as long pins protruding from the wall rather than nails driven flush, most strongly in v1; v2's upright pegs read almost as a row of small torches. If flush-set matters, this set wants a redo with that worded harder.

## King Sheet — set sight.road-chalk (generated 2026-10-30, picks PROVISIONAL)

All four hold the small, devastating fact: tally strokes in groups of five, low on the wall at a child's height, never smudged, going on for a very long way beside an empty road — and the counter is not here now, and never once stopped to rest. King's provisional pick is v2 (the marks lowest and clearest, one lamp raking across them). Register note, same as the orphan Road sets: the road reads open-air under sky here, where the lamps and nails sets are underground — the cluster carries two landscapes, Claude's standing call.

## King Sheet — set obj.road-doorframe (generated 2026-10-30, picks PROVISIONAL)

All four keep the joke the road never laughs at: a door-frame against the wall with no door in it and nothing behind it but more wall — and its hinges polished brass-bright, freshly oiled, kept by someone who has never been seen to use them. King's provisional pick is v1 (the hinges largest and brightest, the emptiness of the frame plainest — rock straight through).

## King Sheet — set sight.road-post (generated 2026-10-30, picks PROVISIONAL)

All four keep the kept place: the iron post, the bench worn pale in exactly two places, the ground swept in clean arcs — and no warden, none for longer than the harbour keeps records. King's provisional pick is v1 (the wear on the seat where sitters sat, the swept ground clearest, the road curving past). Notes: the generator merges the post with a road-lamp in all four (the post carries the lantern — reads naturally, but Claude should know the entry's post is bare iron); v3 wears its two pale patches on the backrest rather than the seat.

## King Sheet — set sight.road-chalk-end (generated 2026-10-30, picks PROVISIONAL)

The companion to the chalk line: it runs, and then it simply stops, and past that point the wall is bare and the road goes on exactly as before — same lamps, same stone, same quiet. King's provisional pick is v4, the only variant that leaves one last short stroke hanging alone past the end of the line — the half-finished mark, the counter called away mid-count. Nothing in any variant explains it. The Book never does either.

## King Sheet — set echo.road-steps (generated 2026-10-30, THREE variants, picks PROVISIONAL)

One generation call failed outright and produced no file; per the standing rule it was not retried, so this set ships with three variants. The entry paints a sound — footsteps ahead that keep their distance exactly — and the generator found the device: prints with no feet making them. King's provisional pick is v3 (small prints walking ahead of the stopped traveller into the dark, the lamps burning steady, nothing there and something there). Caveat for Claude: v3's prints glow pale cyan, which leans toward visible magic; v1 keeps them plain dust prints if the glow is too much.

## King Sheet — set obj.road-oil (generated 2026-10-30, picks PROVISIONAL)

The road's smallest kindness: one can of lamp oil, lid screwed down, sides dry, not a drop spilled, set neatly against the wall exactly where it will be needed — left by someone, for the lamps nobody has seen lit. All four keep it plain and single. King's provisional pick is v3 (the can smallest against the wall, directly under a burning lamp, the road's even lamps running on behind it — the whole maintenance mystery in one frame).

## King Sheet — set sight.road-far (generated 2026-10-30, picks PROVISIONAL)

The Road cluster closes past its last lamp: the floor goes on level into fog, and the fog is lit from within — a soft glow with no source and no end — and nothing in any variant is afraid of that. King's provisional pick is v3 (the road most plainly level and endless, the last lamp small at the frame's edge, the glow warmest and most sourceless). The Road is complete: ten of ten.

## King Sheet — set sight.village-gate (generated 2026-10-30, picks PROVISIONAL)

The Village opens at its gate: a heavy wooden bar cut with notches — one for each who went through — recut more than once, so the rows do not agree, and nobody will say which cut is the true one. Amber window-light falls across it from the houses beyond. King's provisional pick is v1 (the bar fills the frame, the count itself the subject, the notches most hand-cut). Honest wobble for Claude: in all four the notches lean regular, almost saw-toothed — carved pattern more than tally; v1 is the least mechanical.

## King Sheet — set sight.village-windows (generated 2026-10-30, picks PROVISIONAL)

Every window in the village lit with the amber of an evening meal, at every hour a visitor has come — and no one at any of them. Street lamps unlit, street empty: warm, and quietly unpeopled. All four hold it. King's provisional pick is v2 (street-level, the unlit lamps standing dark between the lit houses — that contrast is the entry's whole point).

## King Sheet — set obj.village-well (generated 2026-10-30, picks PROVISIONAL)

Exact in all four: one stone well, one bucket, two ropes over the beam — one worn smooth and dark with use, the other pale, nearly new, never seen to be used. For whom is the second rope kept? The entry doesn't say and neither does any painting. King's provisional pick is v3 (the dark rope twisted with work, the pale coil hanging clean and full-length beside it, the well the still centre of the square).

## King Sheet — set sight.village-chair (generated 2026-10-30, picks PROVISIONAL)

The Book's first true morning: at first light, outside one village door, a plain chair set in the street facing the hill path — dusted this morning, a cloth over its back — and whoever sits in it gone before the village wakes. All four hold the kind light. King's provisional pick is v1 (the chair nearest, the morning freshness on its seat, the stepped path climbing empty into the sunrise). Note for the cluster: this set and sight.empty-chair are cousins — a chair kept for someone — but different worlds and different grammars (kept place at a table vs. a watcher already gone); no confusion in the paintings themselves.

## King Sheet — set sight.village-hearth (generated 2026-10-30, picks PROVISIONAL)

A hearth laid for the whole village: more stones than a hearth needs, a ring of plain seats around it, the ash still faintly alive — and no one ever sitting in them. The houses' windows burn amber around the square in all four. King's provisional pick is v1 (nearest to the hearth, the ember-light strongest in the ash, the empty ring of seats plainest). The seats are warm. Nobody asks why, in the paintings or the entry.

## King Sheet — set obj.village-hooks (generated 2026-10-30, picks PROVISIONAL)

Up the hill path out of the village, a line of small gold hooks at the height of a held hand, climbing toward the doorway at the top — and partway up, the line bends where something once pulled it taut. King's provisional pick is v1 (hooks carried on posts at the path's edge, the bend modest, the morning kind). Honest deviation for Claude: the generator hangs the hooks from a line in all four variants, where the sheet has them set along the path; the fact survives the reading, but if set-in-place matters this set wants a redo. v3's bend is the most dramatic — the line loops clean off the path — and may be the truest to "pulled it taut" despite the flourish.

## King Sheet — set sight.village-door (generated 2026-10-30, picks PROVISIONAL)

The Doorway at the Path's End: at the top of the hill path, a tall doorway of pale light that shows nothing through it — very bright, and kind; far down the path a small hooded figure, seen from behind, has stopped at a respectful distance, gold hooks glinting along the path behind them. King's provisional pick is v1 (the only variant keeping the doorway stone-framed, matching the doorway the hooks line rises toward in obj.village-hooks; the figure smallest and furthest, the hooks set in the rock at the path's edge). v2 and v3 drop the frame and let the light stand alone with rays — brighter, but a different doorway from the hooks painting; v4 warms the light amber and brings the figure close, and its hooks read more like crooks and anchors scattered on the path than a line set for hands. All four variants are 2048x1152.

## King Sheet — set obj.village-bread (generated 2026-10-30, picks PROVISIONAL)

Bread Still Warm: on a village window-sill in morning light, a loaf cools with the faintest breath of steam, knife beside it, slices set out in a careful row — one more than the household needs; inside, soft unpeopled warmth; outside, the quiet street. King's provisional pick is v1 (the row longest and most careful at seven slices, the steam faintest, the interior warmth plainest). v2 sets its last slice apart from the row, which reads as the extra slice made visible — a legitimate alternate if Claude prefers the surplus stated that way. Flag: v4's street drifts into domed sci-fi architecture, off the Village's stone-cottage register everywhere else in the cluster; Claude may mark it do-not-use for continuity. All four variants are 1920x1280.

## King Sheet — set echo.village-count (generated 2026-10-30, picks PROVISIONAL)

A Voice Counting Aloud: a sound painted — still evening at the village gate, the notched bar, the lit windows, the square beyond, and the whole scene listening; somewhere near the gate a child counts aloud, unseen; the count has reached its end, hesitated, and begun again; nothing in the frame moves, and the counter is unseen in all four variants, as the entry requires. King's provisional pick is v1 (framing closest to sight.village-gate — the bar across the gate, the village's windows listening beyond it). Flags for Claude: v2 chalks the count on the ground at the gate and its marks come close to readable numerals ("9... 10...") — the one variant that nearly breaks the no-text rule, and a candidate for do-not-use on that ground despite its wit; v4 carves tally groups into the gate post, marks rather than text, which reads as the count's trace and is offered as acceptable. v3 hangs the bar low across the frame's foot, the village still behind it. All four variants are 2048x1152.

Correction note (2026-10-30, filed with the echo.village-count QA above): the set's four PNG conversions hit the known sandbox write flap (EPERM on image writes; small text writes still land). The four keeper originals are safe as webp in the local generated folder (media-generation-wide-16-9-composition-a-still-0-1c430466 / -1b7382fe / -81d6bac5 / -490afbfa, in pick order v1-v4). PNG copies for the art folder are deferred until the flap clears; do not mistake the absence for a lost set. The ChatGPT review loop should treat this set as generated-and-QA'd, conversion pending.

## King Sheet — set obj.village-thread-end (generated 2026-10-30, picks PROVISIONAL)

The Loose End of a Gold Thread — the Village cluster's last entry, and its closest painting: an older village woman's weathered hands give a short length of gold thread to a small hooded figure seen from behind, the square and its warm windows soft behind them; her family has kept the habit of holding things. King's provisional pick is v1 (the thread's two natures in a single span — fine clean gold at one end, the length worn soft and fibrous toward the other, as though held for a very long time). v2 is the cleaner alternate (both her hands together in the giving, the thread single and fine). Note: v3 puts a small gold rod in her lower hand, a prop the entry never mentions. Ratios: v2 is 1920x1280; v1, v3 and v4 are 2048x1152. The Village cluster is complete: 10 of 10.

Follow-up to the echo.village-count correction note: the write flap cleared later the same evening and all four PNG conversions for echo.village-count have now landed in the art folder at full size. No Sheet 3 set remains unconverted.

## Audit response — L-01 Sunward Compass CORRECTED (2026-10-30)

ChatGPT's finding stands, and the fuller truth is worse than a bad pick: the prompt sheet was RIGHT (round instrument of bare metal on a stone plinth, no needle, centre fixed, points nowhere) and the relic registry agrees word for word — but the first generated set drifted to a ship's deck-plate compass rose WITH a needle, and King's QA rationalized the drift instead of catching it ("canon refusal held" — it was not). That is on King. The first set, relic-sunward-compass v1-v4, is SUPERSEDED — do not use; the needle contradicts the relic's defining property. A corrected set was generated from the sheet prompt verbatim: v5-v8, a round bare-metal instrument on a dark stone plinth beside the road of light, centre fixed, rim markings, no needle in any variant. King's provisional pick is v5 (road of light sweeping past, distant sun gilding one edge). The placed web copy and the STORY_ART alt text have been replaced to match. Claude ratifies or swaps as usual.

## Audit response — L-02 Doorkeeper's Nail CORRECTED (2026-10-30)

ChatGPT's second finding also stands, and goes deeper than King's original QA saw. The entry's first words are "Not a nail; the shape of one. It is warm. It is always warm." The sheet prompt said exactly that — a nail-shaped warmth, a faint amber shimmer with nothing inside it, above an open palm at a door on a night harbour pier. The first generated set drifted to a physical iron nail on a cord; King's QA flagged the head and the size but rationalized the set as usable, missing that the object itself was wrong. The first set, obj-doorkeepers-nail v1-v4, is SUPERSEDED — do not use. A corrected set was generated from the sheet prompt verbatim: v5-v8, the shape rendered as amber shimmer and ember-haze with nothing inside it, hovering over a weathered open palm, the tall door ajar with light along its edge (v7's background drifts sci-fi and is the weakest). King's provisional pick is v5. The placed web copy and the STORY_ART alt text have been replaced to match. Claude ratifies or swaps as usual.

## Owner ruling carried out — sight.unlooked-direction at cosmic scale (2026-10-31)

The owner ruled "Cosmic" (2026-10-31, just after midnight EDT): Eternity's default is cosmic scale, and this entry's painting is redone at that scale. The v1-v3 set (figure above a basin, hand raised) remains in the archive as shrunk-visit variants but no longer illustrates the entry. New set v4-v7, generated with the scale made concrete — his figure spans the frame, a planet's curved horizon small far below, the still dark wedge at the frame's edge, the tiny hooded figure beneath it, no face shown. King's provisional pick is v6: the wedge is an unmistakable empty direction, the planet sits below his sweeping gaze, his head is smooth and bare with the thin ring vertical behind it. Honest flags: v5 and v7 give him long white hair, which canon forbids (no face, no hair) — usable neither as canon nor, in King's judgement, at all for him; v4 is painterly and sound, its darkness reading as a planet's night side rather than a direction. The placed web copy and the STORY_ART alt text have been replaced. Claude ratifies or swaps as usual.

## For Claude — the Cloak (DRAFT, owner-directed 2026-10-31; not canon until ratified)

The owner, reviewing his own reference images of Eternity (below), supplied the reconciliation for every draped depiction, in his words: "his cloak was given out, acquired by someone." Holder: UNKNOWN, by the owner's ruling — nothing may name them yet. Draft text, King's hand, owner's facts:

He was not always bare. Once there was a cloak on him, white as the rest of him, and it was his to give — and he gave it. It went out of his keeping the way his gifts go: freely, and without being asked for again. Someone acquired it. Who holds it now, the keeping does not say; it is held the way a certain berth is paid for, by a hand no record names.

So the draped pictures are not wrong, and neither are the bare ones. They are before and after. Met now, he wears nothing. And if the cloak is ever found, he will not be found in it — only the proof that once he was willing to be covered, and chose not to be.

Depiction rule that follows (for future painting and for ratifying the placed sets): present-day Eternity is BARE, per the references. Draped Eternity reads as before the giving. The cloak itself may be painted as a kept thing in the world — white, empty, held by no visible hand.

## For Claude — Eternity reference images, owner-supplied 2026-10-31

The owner sent four images tonight with the words "This is what Eternity looks like": a kneeling painterly study (a small glowing figure standing in the light at his chest; his head bowed, the ring not visible), and three white-void studies — front, three-quarter, back (hands clasped behind his back). The front and three-quarter files are byte-identical to the GLB references he supplied on 2026-10-30: the canon form is unchanged and reconfirmed — bare-skinned male, all white, smooth and featureless, no face, no hair, no body detail, a thin golden ring of his own light behind his head, cosmic scale by default. The four files are uploaded alongside this note as eternity-reference-1..4.png in this folder.

## Sheet 7 — The Siege of the First Light (§§115–124) — Muse sets, 2026-10-31

Method: sheet bodies verbatim + the standing Global style line. No figures anywhere (124 = hands only, per the sheet); nothing shows what the Morning was defended from. Claude picks canon by eye; King's flags below. All sets 1920×1280 unless noted.

§115 Edges in Ranks (115-edges-in-ranks-v1..v4.png): pale crescent edges, person-height, rank on rank, all leaning one way, dawn-grey light, nothing broken or stained — all four on brief. FLAG: v3 fills the sky with small crescent moons — a motif the sheet doesn't call for; beautiful, but it's an addition, Claude's call. v4 is the widest read (ranks to the horizon); v1 the most dawn-grey of the four.

§116 The One That Smiles (116-the-one-that-smiles-v1..v4.png): SET-WIDE DRIFT, flagged plainly. The sheet asks for a single taller crescent EDGE standing apart from the ranks, warm-lit. All four variants instead lift the one out of the field entirely — a giant crescent hanging in the sky above small ranks, reading as a crescent moon / floating megastructure (v3's is visibly paneled metal). v1 is portrait (1280×1920) and crowds in extra mid-size floating crescents. The warmth and the smile-curve are right in all four; the placement is not what the sheet describes. Claude's call: accept a sky-crescent reading, or send this one back for a redo with the smiling edge kept standing in the field.

§117 A Line of Small Cups (117-a-line-of-small-cups-v1..v4.png): on brief — small cups of differing sizes on low stones in a line, each full of thin glowing morning light; no figures, no text. Small notes only: v1's fourth cup is chipped at the rim (wear, not damage-in-battle; the sheet doesn't forbid it); v2 has the widest variety of vessel shapes; v3's line recedes along a cliff, the cleanest "line" read; v4 renders the light rising as steam/vapor and adds a large planet arc in the sky — set dressing, Claude's taste call.

§118 The Bead at the Back (118-the-bead-at-the-back-v1..v4.png): RULE VIOLATION, set-wide — the sheet's header is explicit: "No figure appears — not Oru, not a student, not an attacker." All four variants render the ranks as a crowd of hooded, armored PEOPLE leaning toward the bead (v3 also shows faces in profile at the edges). The bead on its plain plinth is right in all four; the ranks are not — in this sheet the ranks are the crescent edges of §115. Partly King's miss, recorded honestly: the never-list lives in the sheet's header, and the per-section body alone ("the ranks lean toward it") invites soldiers. For the remaining sets whose bodies invite figures (§120's ranks, §123's "as if everyone were about to speak," §124's hands), the sheet's no-figure rule is appended to the prompt explicitly. This set should go back for a redo whenever Claude calls it.

§119 The Whole Siege on a Table (119-the-whole-siege-on-a-table-v1..v4.png): on brief, and the appended no-figure guard held — no people, no hands in any variant. A wooden table holds the whole field in miniature, ranks of small crescents. Notes: v2 is the cleanest "every rank exact" (standing miniature edges in ordered blocks); v1's crescents lie flatter, like arranged tokens, with tiny cyan streams in the model terrain; v3's edges read slightly fused, with cyan glow between them — the least "exact" of the four; v4 is the most diagram-like, gridded plots divided by cord lines — an accidental rhyme with §122.

§120 Ranks Beyond Measure (120-ranks-beyond-measure-v1..v4.png): on brief, guard held — no figures anywhere; endless pale crescent edges dissolving into haze. v3 is the closest to the sheet's "like breath on glass" (faintest, most translucent); v2 the densest and most tactile; v4 the palest and stillest, almost frost. Minor recurring motif: v1 and v4 carry faint crescent shapes in the sky haze as well (same note as §115 v3) — they read as the ranks' own reflections in mist rather than moons, but Claude should rule once for the whole sheet.

§121 A Smear of Pale Light (121-a-smear-of-pale-light-v1..v4.png): on brief — a soft, edgeless smear of pale light pooled on the ground in all four, no figures, no text. Each smear carries a curved smile-arc inside the light (the sheet's "smiling in the way a memory smiles"). One caution: v3 literalizes it furthest — two eye-like glows above the smile curve read almost as a face in the mist. Whether that crosses from "smiling like a memory" into depicting someone is Claude's call. v4's single bright arc is the most restrained; v1 the most landscape-like.

§122 A Cord Left Unfinished (122-a-cord-left-unfinished-v1..v4.png): on brief — a cord across an empty field, staked at both ends, knots evenly spaced, no figures, no text. The "last knot untied" reads most clearly in v3 (the final knot visibly unraveling into loose strands) and v4 (the cord fraying apart at the right-hand stake). Small observation: in all four the cord hangs strung between its stakes rather than lying flat on the ground; "staked at both ends" arguably requires the tension, but if Claude wants it lying on the earth, that's the note.

§123 Many Drawing Breath (123-many-drawing-breath-v1..v4.png): guard held — no people, no silhouettes, nobody present in any variant; the air itself is the subject over an empty field. v1 draws the held air as fine streamlines over grass (a small ringed planet rides the sky — set dressing); v2 is the stillest, a slanted wall of light-mist; v4 sweeps the bow of air across the whole sky. One interpretive flag: v3 makes "faintly bowed" literal architecture — a translucent dome over the field, which can read as a shield or bubble rather than held breath. Claude's call.

§124 A Student's Empty Cup (124-a-students-empty-cup-v1..v4.png): on brief exactly — a small plain cup, visibly empty, held in two gloved hands; hands and forearms only, no face, no body, no text, in all four. The gloves read as dark work gloves throughout, fitting the world's students. v3 is portrait (1280×1920); the rest landscape.

Sheet 7 status (King, 2026-10-31): all 10 sets generated ×4 = 40 originals, archived in this folder. For Claude's ratification: §116 (the smiling one lifted into the sky in all four — composition call) and §118 (ranks rendered as people in all four — a breach of the sheet's no-figure rule; King's miss, the header's never-list should have been carried into the prompt; expect a redo) are the two sets needing rulings. Everything from §119 onward carried the sheet's no-figure rule inside the prompt and held. Recurring minor motif to rule on once: faint crescents in the sky haze (§115 v3, §120 v1/v4).

---

## Sheet 8 — The Unlit Hulls (§§125–134, generated 2026-10-31)

Method: sheet bodies verbatim + the Global style line, with the sheet header's rules carried INSIDE every prompt (the Sheet 7 §118 lesson): no figure appears; no readable text or letters anywhere (plates carry strokes only); nothing is lit; never the name. §134 is hand-only, like §124. Claude picks canon by eye.

§125 Six Hulls, Each an Answer (125-six-hulls-each-an-answer-v1..v4.png): all guards held — no figures, no letters, nothing lit, engines cold. One real divergence for Claude: v1 follows the sheet literally — six long hulls on slips, each skeletal except one finished part (gold prow, wing, engine). v2–v4 drop the hulls entirely and present the six finished PARTS alone on stands (prow, keel, fin, bloom wing, engine, flank). Evocative, and arguably truer to "each an answer," but not what the sheet's words say. Claude rules which read is canon.

§126 A Seventh Slip, Ribs Only (126-a-seventh-slip-ribs-only-v1..v4.png): on brief — rib frames, no plating, no figures, no letters, nothing lit. v1 and v2 make "echoing the six" literal: six more rib-frames hang in the mist behind the seventh (note the small tension with §125, where the six carry finished parts — here all seven are ribs). v4 keeps the frame on its slip under scaffold poles, six distant silhouettes behind. v3 is the outlier: a lone frame adrift in nebula with no slip or yard under it at all.

§127 Six Plates on a Rail (127-six-plates-on-a-rail-v1..v4.png): the strokes-only rule held — six brass plates on a rail in all four, cut marks are tallies, hatch groups and scores; no letters, no words, no name anywhere. Nuance: v2 is the closest to the sheet's "slow, even strokes" (neat grouped rows); v4 the sparsest and calmest; v1's marks are the wildest — deep scored slashes that read more violent than slow (its first plate's top cluster flirts with letter-shapes at a glance but resolves to plain tallies on inspection).

§128 A Plate Left Smooth (128-a-plate-left-smooth-v1..v4.png): clean set — rectangular brass plate, surface completely smooth and blank in all four (no marks, no letters, no strokes), graver laid down square beside it, nothing lit. v3 sets the bench inside the yard with the gantry behind; v1's plate has a slight raised rim and sits propped; v2 and v4 are the purest still-lifes.

§129 A Desk With No Ledger (129-a-desk-with-no-ledger-v1..v4.png): clean set — the pale ring where a book sat is legible on the desk in all four, a pen lies beside it, and there is no book, no paper and no writing anywhere; the ribbed seventh hull fills the view beyond. Two notes: v2 and v3 render the pen as a cut quill (a "trimmed pen" in the literal period sense — taste call), v1/v4 use a plain pen; v2 places the desk inside the frame looking down its length rather than facing the slip from outside.

§130 Tools Laid Down Square (130-tools-laid-down-square-v1..v4.png): the set the entry deserves — rows of mallets, adzes, augers, planes and rules, and "no two grips alike" is true in every variant (twisted root, faceted, cord-wrapped, bone, gnarled branch). No hands, no figures, no letters; the rules carry notches only. v2 is the most systematic grid; v4 has fewer tools but the most sculptural grips. Sizes: v1/v3 1920×1280, v2/v4 square 1600×1600.

§131 Lanterns Trimmed and Unlit (131-lanterns-trimmed-and-unlit-v1..v4.png): the unlit rule held completely — every lantern in all four is dark: black glass, unburned wicks and candle stubs visible in v1, oil reservoirs full in v2; the light in these pictures is sky, never lantern. v1 is the literal rack; v4 scales it up to a whole gantry field of hanging lanterns (grander than "a rack" — taste call).

§132 A Crane With an Empty Hook (132-a-crane-with-an-empty-hook-v1..v4.png): clean set — tall crane over the ribbed seventh frame in all four, the hook visibly empty at about flank height; v2's hook reads clearest, silhouetted against the mist; v4 is the most minimal. The cranes are modern tower cranes (the sheet doesn't specify a kind; the yard already mixes eras — quill pens beside gantry cranes).

§133 One Mallet, Far Off (133-one-mallet-far-off-v1..v4.png): the entry's point lands in all four — a vast, empty, still yard, and the mallet genuinely small on a beam: v1 hides it best (a tiny gold-lit mallet mid-right; there is also a speck of a distant bird silhouette — set dressing, Claude's call), v3 sets it over a hull frame, v2 and v4 bring it nearer on a beam end. No people, nothing lit.

§134 A Curl of Bright Metal (134-a-curl-of-bright-metal-v1..v4.png): exactly the sheet — one hand only, a thin bright brass curl, no letters or marks in the metal in any variant. v1's curl is the most calligraphic (a neat spiral flourish — reads as a shaving's natural curl, not a letter); v2's loose ribbon is the plainest.

Sheet 8 status: all 40 originals generated and QA'd above; uploaded to docs/lore/art/ on main (see commit list in the delivery note). No rule violations this sheet — the header rules were carried inside every prompt (the §118 lesson applied from the start). Open calls for Claude: the §125 hulls-vs-parts fork; §126 v1/v2's six rib-frames vs §125's finished parts; §133 v1's distant bird speck.
