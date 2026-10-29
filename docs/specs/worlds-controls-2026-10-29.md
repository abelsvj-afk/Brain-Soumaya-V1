# Worlds controls: one header, one dock

**Status:** owner direction 2026-10-29 ("make the buttons yourself… and for navigation") — designed by Claude, no mock-up
needed. Supersedes the "wait for Muse's Eternity v3.4 mock-up" blocker for the *controls* only; the v3.4 mock-up
can still refine them later.

## Problem (measured)

Every world put its controls as plain pills in one wrapping header: Eternity 13 of them (937px in a row on a 412px
phone), the Station 6, the garden 3. The header's height changed per world and per wrap, so every other overlay
(suggestions, caption, room card, groves list, harvest row) had to guess where the header ended — the cause of the
Station overlaps fixed earlier today. The owner called Eternity's "corny … not supposed to be just sitting up there".

## Design

**Header (every world, always one row):** the world's title on the left, **← Galaxy** on the right (≥44px target).
Nothing else lives here, so its height is a constant (`--worlds-bar-h`).

**Dock (second row, only where a world has controls):** one horizontally scrollable row of **tiles** — an icon over a
short visible label, ≥56×56px, snap-scrolling, with edge fades. Tiles are grouped; a group may carry a small label
("Gestures", "Tools"). Rules:
- Meaning is never colour alone: every tile has an icon AND a visible word; an active/open tile also gets a ✓/▾
  badge and a heavier outline.
- The accessible name keeps the full phrase ("Go to the Fleet Deck", "Part the veil"); the visible label is contained
  in it (WCAG label-in-name).
- `prefers-reduced-motion`: no tile animation at all.

**Per world**

| World | Dock tiles |
|---|---|
| Growing Place | 🌳 Groves ▾ (opens the list), 🌾 Meadow |
| Great Station | 🛰 Harbor · 🚪 Go inside / 🌌 Back outside · (inside) 🛠 Hangar, 📋 Board, 🚀 Fleet, 🔭 Deck (the other rooms; you are in the current one) |
| Deep Past | ⬇ Descend / ⬆ Rim (when there is a thread) |
| Eternity | **Gestures:** 🕊 Stillness, 👁 Regard, ✨ Blessing, 💧 Sorrow, ☀ Joy, ✋ Warning (held one ✓) · **Tools:** 🌀 Reorder, 🌫 Veil, 🛡 Shield, ☄ Comet |
| People, Quiet/Archive, Scale | none (header only) |

**Overlay offsets** become `calc(var(--worlds-bar-h) + …)` of one of two constants (header only, header + dock), instead of
per-overlay guesses.

## Not in scope
Eternity's tablet/heavens behaviour, the gestures' effects, and the world scenes. Controls only.
