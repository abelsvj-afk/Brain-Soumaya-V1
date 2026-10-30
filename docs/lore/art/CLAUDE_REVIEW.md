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
