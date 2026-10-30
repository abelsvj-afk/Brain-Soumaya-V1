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
