# Claude's review of the lore art (2026-10-31)

*I looked at the four images Muse's QA notes asked for a ruling on, against `docs/lore/CONTINUITY_BIBLE.md`. I have NOT looked at the other ~125 files — do not read silence as approval. Rulings below are mine; the owner's tap is the only approval.*

| Image | Ruling | Why |
|---|---|---|
| `03-eternity-v1.png` | **KEEP — canon-safe.** | Faceless (matches the GLB ruling "no face at all"), broad-shouldered male-reading silhouette, halo, hands open, no ship of his own. The visitor ships and planets round him are fine. |
| `03-eternity-v2.png` | **WITHDRAW from canon** (keep as mood art only). | A visible human face under a halo — contradicts "never a clear face". The owner picked it before the faceless ruling; the owner may still overrule. |
| `36-the-companion-at-the-dock-v1.png` | **REGENERATE.** | The stranger is a faceless figure in a cream-white hooded robe — that reads as Eternity, which the Bible forbids for the Companion. Ask for earth/dusk-coloured travelling cloth, a hood with shadow but no glow, and keep the two cups. The traveller on the crate and the dock/ship are good. |
| `19-soumayas-gap-v1.png` | **REGENERATE.** | The blank nameplate is an OVAL; the Bible says the seventh hull's nameplate is RECTANGULAR. The hull also reads as a saucer, not "sleek, echoing all six". Prompt must say "rectangular plate" and show the family resemblance. |

## Also
- `docs/lore/art/` is ~270 MB of PNG. It is now in `.dockerignore` (the Dockerfile does `COPY . .`, so it would otherwise have gone into the production image). It still bloats clones; if that hurts, move the binaries to a GitHub release/LFS and keep only the notes here.
- Muse's own open rulings (§4 Vesh androgynous, §10 v4 defective, §22 flame, §21 torn page) stand as written in `IMAGE_QA_NOTES.md`; I agree with Muse's recommendations there but have not verified them by eye.

## Round 2 (2026-10-31) — I looked at `36-…-v5` and `19-…-v5`
- **`36-the-companion-at-the-dock-v5` — APPROVED as the canon pick.** The stranger is only a hand and an earth-brown cloak (no white, no glow, no face), the traveller is seen from behind (face never shown), two cups (one steaming), lantern, dock and far ship's lights all present. Muse's note stands: v7 shows the traveller's face in profile — do not use it. v6 and v8 I have not viewed.
- **`19-soumayas-gap-v5` — APPROVED as the canon pick.** One clean RECTANGULAR blank nameplate, sleek blue-white hull with violet edge lines, the dawn fan at the prow, bloom fan, latch clasp and plumb keel — it finally reads as the seventh hull in the family. Muse reports v6 has TWO blank plates (the Bible implies one): do not use v6. v7 and v8 I have not viewed.
- **Prompt text fixed:** the §19 source prompt (`docs/lore/IMAGE_PROMPTS.md`, `docs/lore/art/PROMPT_SHEET.md`) said "blank oval patch"; it now says a RECTANGULAR nameplate patch, so a future regeneration cannot repeat the defect.
- Muse's re-check list of other breaks (Sleepwalker's lit lantern in v1/v2/v4; Ysmerel v2's ragged hole; crescent embroidery on §21 v1 and §24 v3; §35 v2/v4's keeper in Eternity's white) is accepted as the open to-do list. None needs code; the crescent question and the Keeper's palette are story rulings for the owner.

## Round 3 (2026-10-31) — §5 the Lullaby reference
- **Pick `05-veshs-ship-the-lullaby-v5.png` as the reference.** It is unmistakably the Bible §2 swan: a curved neck and head, a hollow in the flank, petal-vanes, a pale violet engine. Muse is right that it reads a little like a statue; that is the better fault, because the silhouette is the continuity.
- **`…-v8` is not the reference.** It is a handsome ship sheet, but the swan is gone (it reads as a ring-saucer with petal fins), which is the same drift the first pass had. Fine as a "how she flies" side study.
- Owner rulings on the crescent embroidery and the Keeper's white are recorded in `IMAGE_QA_NOTES.md` (`59baef9`); I accept them and have removed them from my open list. §20's canonical triptych: not reviewed by me yet.

## Round 4 (2026-10-31) — §20 the Three Endings: I looked at all four triptychs
Checked against the prompt (LEFT: stepping into the mirror of the stars, looking back over her shoulder, hesitant · CENTER: asleep in an open archive alcove, ONE small lantern · RIGHT: standing in pale mist, mouth open as if beginning to speak, hands open toward the viewer) and the sheet's rule "the same woman in all three panels, no text".

- **PICK: `20-the-three-endings-v1.png` — the canonical triptych.** Her face, hair (loose, wavy, light brown) and pale gown are the same woman in all three panels. LEFT is the most literal "mirror of the stars": a flat pane of stars with her stepping through it, ripples spreading from her bare foot into a star-filled floor, and she looks back over her shoulder, frightened and unsure. CENTER: asleep on the alcove ledge, scrolls on the shelves, exactly one lantern. RIGHT: mist field, mouth open mid-word, both hands open toward us. Three clean equal panels with thin gutters, no text.
- **Second choice: `v4`** (hair in a bun). Also the same woman throughout, with a good over-the-shoulder look, but the left portal is a broken stone ring, which reads as a doorway more than a mirror.
- **Not recommended: `v3`** — in the left panel she walks out of a mossy arch looking to the side, not back over her shoulder, and the right panel is cropped tight enough to lose the "open field". **`v2`** is fine art but has a thick olive frame around the whole sheet that the others don't, and her dark hair is the furthest from v1's.
- Not a continuity break in any of them: the lantern here is lit by design (the flameless rule is the Sleepwalker's only, §22).

## Round 5 (2026-10-31) — §22 the Sleepwalker, `v3`
- **APPROVED as the canon pick.** A woman in a pale, loose nightgown, barefoot, walking an empty misty harbor pier at dusk; she holds the glass lantern in BOTH hands, out in front of her as if it were fragile (v1/v2/v4 do not); the lantern is dark glass with only a single faint gold glint inside, which is exactly the prompt's "a single faint gold glint on the lantern" and no lit flame (the Bible's flameless rule); her gaze is open and carried away from us, listening rather than afraid; the harbor behind her is dull and dim, and the mist thickens round her feet. No text.
- Known, not a break: it came out landscape where the sheet asked 2:3 (the generator has no ratio control) — crop plan as in `IMAGE_QA_NOTES.md`. v1/v2/v4 stay marked "lantern lit — not canon".
- **This closes my review of everything Muse asked me to rule on.** My eye has seen: §3 v1/v2, §5 v5/v8, §19 v1/v5, §20 v1–v4, §22 v3, §36 v1/v5. Every other file is judged only by Muse's notes.

## Round 6 (2026-10-31) — pictures placed in the Book
I opened one candidate from each of eight more sets (Muse's notes chose the variant; I checked it against the Bible by eye) and **approved all eight as canon picks**, placed in the app's Book as web-sized copies beside their entry (a picture shows only once the entry is found):

| Entry | Set / variant | What I checked |
|---|---|---|
| `sight.tamsins-ward` | §23 v1 | Tamsin in green apron with bowl and spoon; the Faded half-transparent, watercolour-soft, no gore; ember lanterns; the Hush's thin line at the window. |
| `obj.kiths-drawing` | §26 v4 | The faceless woman drawn, **torn at the mouth**; adults with fingers to their lips (the hushing); one place set for no one. The child's face is visible (allowed). |
| `sight.long-room` | §31 v3 | Hall of small lit rooms, one tall open white doorway, the hooded player from behind — face/gender never shown. |
| `obj.follower-ribbon` | §33 v2 | A hooded figure from behind reaching a note toward a ribbon on a mooring post; no face. |
| `echo.hymnal-gap` | §25 v1 | Rows of translucent singers; **one empty stall** dead centre under a shaft of gold light. |
| `obj.choirmasters-breath` | §21 v3 | Ysmerel, **mouth closed**, hand raised, hymnal with a torn page (the closest to "one page torn out"; the pew crescents are allowed by your ruling). |
| `obj.dorrows-page` | §24 v4 | Dorrow's smile that does not reach the eyes; ledger shelves; script is illegible squiggle, no readable words. |
| `echo.eighth-bell` | §35 v3 | The line of keepers' emblems with bells; the eighth, earth-toned and hooded, from behind, ringing empty air; the white void on the left. |

**Twelve entries now have a painting.** Entries without one are not an oversight: each needs an image approved by eye, and several have none generated (see `PROMPT_SHEET_2_DRAFTS_7_8.md`). Sets I did **not** place (no entry maps one-to-one, or I have not viewed them): §1 First Morning, §2 Seven Hours, §3 Eternity (a mood piece, not an entry), §4 Vesh, §6 Rending, §7 Witness, §8 Calend, §9 Archive, §10 Firstborn, §11 Player, §12 Hush, §13 Fading, §14 Oru, §15–18, §27–30, §32, §34. They stay in the repo for the lore and for the marketing/intro surfaces; none is wrong, they are just not Book illustrations yet.
