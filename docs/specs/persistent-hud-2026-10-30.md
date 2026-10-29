# Persistent HUD — your buttons never disappear when you change place

**Status:** owner direction 2026-10-30 ("your buttons … should not be gone because you went to a different world … like EVE
Online, the menus on the side and the map … stay on screen regardless of what you do"; "no redundancy"; "not just emoji").
Supersedes the "two doors to the same room" comment in `App.tsx` (the Calm button).

## Measured problem (412×915, real browser)
- Home has **23** visible controls; inside a world there are **5**. Lost on entering a world: Tools, Panels, Settings, Talk to
  Soumaya, Add a memory, the Observatory, Music, the account chip, Zoom/Recenter/Focus/Views/Calm, notices. The worlds layer is a
  full-screen cover (z-index 70) above the HUD (z-index 30–57), and each world draws its own header + dock at the screen edges.
- Inside a world the only exit is "← Galaxy"; the main menu is unreachable (you cannot open Settings, Chat or Panels in the Station).

## Principle
**The HUD is one shell that lives above every scene** — home galaxy, each world, the warp. A button is either *core* (always
there, always works), *contextual* (appears only where it makes sense, in the same slot), or *scene-owned* (the world's own
actions, in the world's context bar). Nothing is ever replaced wholesale by a scene.

## Slots (same positions everywhere)
| Slot | Contents |
|---|---|
| Top-left | account chip (core) |
| Top-right | **Tools** (core), notices; the streak ember is **home-only** (it covered a world's ← Galaxy button) |
| Left rail | Music (core) · Panels (core) · *camera controls: Focus, Views, Recenter — home galaxy only* |
| Right rail | Settings · Chat · Observatory home · Add a memory (all core) · *Zoom ± — home galaxy only* |
| Under the top row | **Context bar:** in a world, the world's title + **← Galaxy** + its dock (Fly to, gestures, Harbor…). At home it is absent |
| Status | fuel gauge (core) |

- **Core** = identical in every scene. **Camera controls** (Focus, Views, Recenter, Zoom ±) move the *galaxy* camera, so they
  belong to the galaxy and are replaced in worlds by the world's own camera controls (its dock + pinch/drag + "Overview").
- **In the warp** the core buttons stay (EVE keeps its UI in warp) but dim to 55 % so the cinematic leads; Cancel departure stays
  the only prominent control during the countdown.
- The notification banner is suppressed in worlds (its content is in Notices and the Inbox); the fuel gauge stays, and world overlays on the left are inset past it.
- **Panels and dialogs** (Panels, Settings, Chat, Tools menu, Observatory, legend…) open *above* the world, exactly as at home.
- World overlays (sheets, hints, the room card) are inset so they never sit under a rail button.

## Redundancy rulings (one place per action)
| Duplicate found | Ruling |
|---|---|
| **Calm mode** — left-rail button (class `fab-focus-toggle`) AND Tools entry | Keep the **Tools** entry (and the command palette); **remove the rail button** |
| Legend glyph for Calm is 🎯 — the same glyph as the 🎯 Focus button | Calm gets its own icon; the Legend matches the real controls |
| **Focus / Recenter / Level camera** — three camera controls | No change: "Level view" is a pill that appears **only while following the ship**, so it is contextual, not a duplicate |
| **Search** — Tools entry, Observatory 🔍, header search, command palette | one door in the Tools menu + ⌘K; the Observatory keeps its own because it is that screen's own search (documented) |
| **Travel** vs **World map** — two Tools entries | No change: they do different jobs (the map = where things are, with "Travel to X"; the Travel sheet = routes, fuel, tours, approvals) |
| The 🔭 button's caption **"Home"** — inside a world "Home" reads as "go back to the galaxy", but it opens the Observatory | Caption is now **"Briefing"**; "← Galaxy" is the only way back |
| Views chip "🧭 Journeys 3" vs the Journeys panel vs the Observatory's "Your journeys" | the Views chip is a *filter*, renamed **"Journeys only"** so the words stop colliding |
| Inbox (Panels tab) vs notices badge vs toast overflow note | one concept: the badge opens the Inbox; the toast note links to it (already true) — no change |

## Icons
Emoji are replaced by one **SVG icon set** (single stroke style, `currentColor`, tintable by state) for the rail buttons, Tools
menu, Panels tabs and the worlds' dock. Accessible names and captions do not change. A larger painted/3D-rendered button art
pass is optional and goes to Muse with a written spec (`specs/muse-button-art-2026-10-30.md`); nothing depends on it.

## Acceptance (measured per scene)
A script visits home, each of the 7 worlds and a warp at 412×915 and asserts: every **core** control is visible, hit-testable
(`elementFromPoint`) and ≥ 44 px; no core control overlaps a world control (bounding boxes); the camera-only controls are absent
in worlds; Panels/Settings/Chat open above a world; reduced motion unaffected; the earlier worlds-check still PASSes.
