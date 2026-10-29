# Muse task — put every world mock-up in the repo, and say what each one does

**From:** Claude · **For:** Muse (via Sajacous) · **Written:** 2026-10-29 · **Type:** asset/doc collection — no app code.
**Branch:** `design/worlds-mockups` (from current `main`). **Do not merge to `main`** — Claude reviews.

## Why

The owner expected the worlds to look and behave like the mock-ups Muse built. The built worlds do not. Claude
could not compare, because most mock-ups are not in the repo — only in Muse's chats. Right now:

| World | Mock-up in the repo? | Where |
|---|---|---|
| Great Station | yes (early) | `design/worlds-vision:docs/worlds/mockups/station/` |
| Growing Place | yes (Phase 1) | `design/worlds-vision:docs/worlds/mockups/growing-place/` |
| Deep Past | yes (v1 there; a later v6/v7 on `mockup/deep-past-v6-audit`) | two places — **say which is the owner-approved one** |
| **Eternity's World** | **NO** — the design note says the build must "match the mockup **v3.4** behavior" | missing |
| People | no | missing |
| Quiet/Archive | no | missing |
| Scale | no | missing |

## What to deliver, per world

1. **The mock-up itself, runnable**, in `docs/worlds/mockups/<world>/` — `index.html` plus every file it needs
   (three.js module **and** its core file, any GLBs). A single self-contained file is fine **if it is under
   ~900 KB**; a chat upload truncates at 1 MiB (the Growing Place file the owner sent was cut off mid-script and
   could not run). Anything bigger: upload through the **GitHub website** (the connector pushes text only).
2. **Which version is the owner-approved one** (e.g. Eternity "v3.4", Deep Past v1 vs v6/v7) and its record
   (`docs/worlds/mockup-result-<world>.md` if one exists).
3. **A short "what you can do here" list** — this is the part that is missing from every written record:
   - how the camera moves (auto orbit? stage buttons? drag/pinch? free flight?);
   - every control on screen, what it does, and which ones are *fixture/test only* vs *meant for the product*;
   - what the traveller can DO in the world (place a memory, grow a landmark, gestures, tools…);
   - the look: lighting/time of day, haze/fog, palette, density (e.g. the Growing Place's ~300 instanced trees).
4. **Screenshots** at a phone size (412×915) of the main view, so the look can be compared without running it.

## Eternity first

The owner's most specific complaints are about Eternity, so start there. What the built version gets wrong, as the
owner described it: the controls are 13 plain buttons stacked in a header ("corny … not supposed to be just
sitting up there"), and the world is still — "you can't move around … you're supposed to be able to fly around."
The design note says his words appear **in the world** on a floating tablet near his mouth, the heavens shake
when he speaks, and there is a 13-ship fleet; none of the visual treatment of the controls is written down.
So for Eternity especially: **how were the gestures and tools presented in the mock-up?**

## What Claude does with it

Compares each built world against its mock-up (rendered side by side at the same viewport), and writes a short
fix list per world. Nothing is rebuilt blind.
