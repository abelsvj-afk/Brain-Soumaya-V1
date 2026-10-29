# Worlds controls: the galaxy's controls travel with you

**Status:** owner direction 2026-10-29 ("Our controls in home galaxy should be on screen
anywhere we travel. Just certain buttons, which you'll audit, will have to change what they
access or control on different worlds.") — companion to
[worlds-controls-2026-10-29.md](./worlds-controls-2026-10-29.md), which covers the worlds'
own header + dock. This note covers the HOME galaxy's chrome inside the worlds.

## The problem (measured in the code)

The worlds surface is an opaque fixed layer at z-index 70. Every home-galaxy control lives
at z 30–57 (FAB tier 40, views 45, ship-status 55, fuel gauge 30). Travelling therefore
buried the entire control set under the world: no Tools menu, no world map, no chat, no add —
the only way back to them was dismissing the world view. The world map had the same disease
inside itself (below).

## The audit — every home control, classified

**Persist, unchanged** (they act on the brain, not on the galaxy scene):

| Control | Why it is safe anywhere |
|---|---|
| Tools menu (Search, Lenses, Connections, Review, Timeline, Legend, Travel, Help, Calm) | Opens global panels/sheets; those layers already sit at 71–98 |
| World map (Tools item) | Global by definition — it is how you travel; the map itself rises to z 74 (below) |
| NavRail "Panels" (dock) | Opens the global dock panels |
| Action rail: Add, Observatory, Chat, Settings | Brain-level actions; chat dock is z 90 |
| Fuel gauge | Passive readout, and fuel is a travel decision — it stays visible |

**Re-pointed at the world** (same buttons, new target while a world is on screen):

| Control | At home | In a world |
|---|---|---|
| NavRail Recenter | Galaxy camera recenter + follow/lens reset | The world's view back to its own framing — the free-look reset, identical to the world's double-tap |
| NavRail Zoom + / − | Galaxy `zoomBy` | The world's free-look zoom, identical to its pinch/wheel |

WorldsSurface owns every world's camera and layers one free-look offset
(`graph/worldLook.ts`) over each world's own pose, so there is exactly one honest target for
these buttons: that offset, exposed to the host as `WorldControlsHandle`
(`controlsRef` prop). While a world runs a scripted camera move (Station arrival glide,
guided descent, Station interior) the offset is not applied, and zoom does nothing — the
same behaviour as the traveller's own wheel in those moments.

**Home-only** (hidden while a world is on screen — their targets are galaxy objects that
are not in the world; showing them would be a lie):

- Galaxy category views (presets/lenses fly the galaxy camera)
- The 🎯 focus fan + Calm toggle in the camera cluster (follow ship/station/fleet/…)
- Ship-status stack (follow/beacon/audio chips act on galaxy objects)
- Level-view pill, Exit-system-view button, empty-galaxy cue

## How it is wired

- `WorldsSurface` reports what is actually on screen through `onChrome`
  (`{ world, docked }`, or `null` at home / when dismissed). It is the only component that
  knows: visibility needs this session's engagement, the dismiss state, and the server's
  travel state together.
- `App` stores that as `worldView`, puts `worlds-open` (+ `worlds-docked`) on the app root,
  hides the home-only set, and re-points Recenter/Zoom.
- CSS (all scoped to `.app.worlds-open`, so home layering is untouched): persistent FABs
  and the fuel gauge rise to z 71 (above the surface at 70, below the Tools menu at 72 and
  dialogs at 90+); panels opened from them rise to 75; the Tools FAB and menu shift below
  the world's header (and its dock, when the world has one) so they never cover the world's
  Back button or tiles.

## The world map exit fix (owner report: "the map doesn't have a way to exit it")

Two defects, both in the map's own layering/behaviour:

1. The map canvas (`<svg>`, full-screen) comes after the header in the DOM at the same
   stacking tier, so it painted over the header and swallowed every tap meant for
   **Back to your galaxy**. The button's click handler was always correct — the unit test
   clicks the button directly and happy-dom does no hit-testing, so the gate could not see
   it. Fix: the bar, controls, detail card and fallback line get `z-index: 2` over the
   canvas's `0`, pinned textually in `indexCss.worldsChrome.test.ts` (the batchO pattern).
2. The map was the one `role="dialog"` overlay without the standard dialog behaviour. It
   now uses `useDialogA11y` like the others: Escape closes it, Tab stays inside, focus
   returns to the opener.

The map layer also rises from z 70 to **74** so it can be opened from inside a world
(it shares tier 70 with the surface, which is later in the DOM and won).

## Not in scope

- New controls inside worlds, or changes to the worlds' own header/dock (Claude's
  2026-10-29 controls pass owns that surface).
- Making scripted camera moments (interior, guided descent) free-look — the offset stays
  unapplied there by the worlds' own design.
- The Tools menu's individual items keep their home meanings; none needed a world variant.
