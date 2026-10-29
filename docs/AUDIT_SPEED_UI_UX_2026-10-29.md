# Speed, UI and UX audit — 2026-10-29

Method: a real headless browser at 412×915 against a production build, with counters injected into WebGL
(`scripts` in the session scratchpad: `perf-audit`, `perf-ctx`, `ui-shots`). Headless uses software GL, so
**frame rates are not representative; counts (draw calls, triangles, bytes, which canvas draws) are.**
Never claim phone smoothness from this — it is a lens for where work is wasted.

## 1. Why EVE and Albion feel fast — and what that means for us
It is not the engine. It is five habits, none of which need Unreal/Unity:
1. **Never draw what you cannot see** (culling, and *not rendering a covered scene*).
2. **Draw many things in one call** (instancing/batching) — a small, fixed draw-call and triangle budget.
3. **Level of detail**: far things are cheap, near things are detailed.
4. **Stream, don't preload**: tiny first screen, the rest arrives in the background, cached forever.
5. **Small assets** (compressed textures, decimated meshes) and a **frame budget with automatic degradation**.
Albion is built in Unity and is *mostly 2D-isometric sprites with a hard art budget*; EVE draws one system at a time.
Both enforce a budget on every asset. Our scenes are already in the same range (below) — the waste is elsewhere.

## 2. SPEED — measured
| Scenario | Draw calls/frame | Triangles/frame | JS heap | Download (cold) |
|---|---|---|---|---|
| Home galaxy | 37 | 106 k | 18 MB | 23 MB |
| Station | 28 | 75 k | 21 MB | 38 MB (home + station) |
| Growing Place | 20 | 31 k | 29 MB | 29 MB |
| Deep Past | 21 | 50 k | 20 MB | 40 MB |
| People / Quiet | 16 / 15 | 40 k / 34 k | 18–19 MB | 27 MB |
| Scale | 18 | 44 k | 29 MB | 40 MB |
| Eternity | 20 | 62 k | 18 MB | 29 MB |

Scenes are inside a healthy mobile budget (≤ ~100 draw calls, ≤ ~150 k triangles). Findings, by impact:

- **S1 — FIXED. The home galaxy kept rendering behind every world.** Measured: while a world was up, the covered galaxy
  still issued ~780 draw calls per 4 s, the same as at home — the phone drew two full 3D scenes, one invisible. Now
  the galaxy's render loop and tick pause while the worlds layer is up and resume on return (verified: 0 draws behind a
  world, 543/4 s again after returning; the world's own draws rose 345 → 1,300 per 4 s, i.e. ~4× the frame budget in
  the same time). Biggest single win in this audit.
- **S2 — Open. One 2.2 MB JavaScript bundle.** All 224 components, Observatory, Settings, the panels, Eternity, the worlds
  and every tool are in the entry chunk; only `Graph3D` is lazy. Parsing 2.2 MB on a mid phone is ~0.5–1.5 s of blocked main
  thread. Plan: lazy-load the worlds layer (`WorldsSurface` + scenes), Settings, and rarely used panels; target entry < 800 KB.
- **S3 — Open. Cold download is 23 MB before any world.** Models are already slimmed (largest `space_station_3` 3.9 MB, was 14),
  but 15 files are over 1 MB. Targets: nothing over 1 MB on the first screen; load the station/figurines/black hole *after*
  the first interactive frame (the station already defers); texture budget 512 px; KTX2 everywhere (ship already is).
- **S4 — Open. No level of detail on world models.** Each world draws every model at full detail at any distance. Add one
  cheap LOD tier (a 25 %-triangle copy beyond a distance) for models > 20 k triangles — the same trick Albion/EVE use.
- **S5 — Open. The sky bake runs per world mount** (6 renders, ~768² faces). Cache the baked cubemap across mounts (keep one
  renderer for the worlds layer instead of a renderer per world — also removes a WebGL context create/destroy on every warp).
- **S6 — Open. A WebGL context per world.** `WorldsSurface` creates and destroys a renderer for each world and for the
  warp. Context creation costs 50–200 ms on phones and can fail under memory pressure. One persistent renderer, scenes swapped.
- **S7 — Watch. DOM is light (≈ 260 nodes)** — not a problem. Main-thread script time ≈ 1.2–1.8 s per 5 s in software GL
  is dominated by rendering; re-measure on a device.
- **Adaptive quality exists** (`adaptiveController`, "switch to Performance Mode?" prompt) — good; extend it to the worlds layer
  (drop DPR/sky stars when frames > 24 ms for 2 s). Today the worlds do not use it.

## 3. UI — measured and observed
- **U1 — FIXED. Observatory header collision.** The 🔍 and × buttons (46 px each) sat on top of "Welcome back, <name>."
  at 412 px. The header now reserves their width on both sides and the title wraps.
- **U2 — Open. 16 of 34 visible controls on the first screen are under 44 px** (target size): the "Switch / Not now" lag prompt
  (25 px tall), "Diagnostics →" (18 px), toast dismiss (19×17), four stacked "Focus …" buttons (18 px). Raise to 44 px or
  make the row itself the target.
- **U3 — Open. Four "Focus …" buttons render at the same coordinates** (28,585): a stacked/overlapping group; only one can be tapped.
- **U4 — Open. Fixed-pixel offsets for floating controls** (documented history in CLAUDE.md: Views, Lens, FAB columns).
  The worlds already moved to one header + one dock with a CSS variable; the home screen should adopt the same "named slots"
  layout (top bar, left rail, right rail, bottom dock) instead of per-control `bottom: Npx`.
- **U5 — Open. Visual language is split.** Home uses glass cards with cyan accents; worlds use plain dark HUD text; travel uses
  amber/white. Define 6 tokens (surface, text, accent, warn, danger, motion) once and use them in both.
- **U6 — Open. Icons are emoji.** Emoji render differently per OS and cannot be tinted; for a space-game feel use one small SVG
  icon set (≈ 30 icons, ~6 KB) for dock tiles and the HUD. Emoji may stay in content.

## 4. UX — observed
- **X1 — Open. First-run stacks three overlays plus toasts** (Welcome → "Reading your galaxy" legend → Observatory → four toasts,
  three marked URGENT for routine "Codex: discovered …" events). A new user needs one thing: *capture a thought*. Plan: show
  one coach at a time, queue the rest behind explicit "later", never label discoveries urgent, cap toasts at 2.
- **X2 — Open. "Soumaya noticed some lag — switch to Performance Mode?" appears during the first-run** (here because software
  GL is slow). Ask once per session, after 20 s of sustained slowness, never over a modal.
- **X3 — Open. Two entry doors to the same places.** Tools menu, Panels, Settings and the bottom FAB columns all open
  panels. The worlds fixed this with one dock; home needs the same: *primary actions on the bottom edge (thumb), secondary in a
  menu*. Recommend: Capture (+), Talk, Journeys, Worlds as the four primary buttons.
- **X4 — Open. Worlds teach nothing about themselves.** First arrival in a world should say in one line what it is for and one
  thing to do (the Growing Place does; Station, Deep Past, People, Quiet, Scale do not).
- **X5 — Done earlier.** Travel feel (align → spool → warp → arrive, ETA, velocity, arrival caption), in-world flight with scale
  captions, one header/dock pattern across worlds.

## 5. Order of work (each a small spec → build → measure → ship)
1. S1 ✅, U1 ✅.
2. **S6 + S5** one persistent renderer for the worlds layer + cached sky (removes the biggest per-warp hitch).
3. **S2** lazy-load the worlds layer and rarely used panels; measure entry size and time-to-first-frame.
4. **X1 + X2** one-overlay-at-a-time first run; toast policy.
5. **U2 + U3** target sizes and the stacked Focus buttons.
6. **S4** one LOD tier for the heaviest world models.
7. **U4–U6 + X3** home layout slots, tokens, SVG icon set, four primary buttons.
8. Adaptive quality in the worlds layer.

## 6. Building characters, worlds and space — tools and engines (free-tier minded)
**Recommendation: stay on the web stack (three.js). Do not switch engines.** Reasons: a Godot/Unity/Unreal rewrite throws away
the working app, the server, the multi-tenant brain, the PWA and every world; web exports are *larger and slower to start*
than what we ship now (Godot's web runtime alone is ~10–40 MB; Unity WebGL is heavier still; Unreal has no practical mobile-web
target). Engines are for shipping a native game. Our constraint — runs in a phone browser, free hosting — favours three.js.

What to add instead (all free, none needs a rewrite):
- **Blender + a Blender MCP server** (`ahujasid/blender-mcp`, Blender add-on + MCP server; it can also pull from Poly Haven and
  Sketchfab and call Hyper3D Rodin text/image → 3D). This is the closest thing to "an engine I connect Claude to" for
  *making* characters, gates, props and planets. It needs a desktop Blender, so it runs on **Muse's computer or the owner's
  PC**, not in this cloud sandbox. Pipeline: Muse (Blender + MCP) → export `.glb` → `gltf-transform` web-slim recipe (weld →
  simplify → 512 px textures → draco/KTX2) → upload via GitHub site → Claude wires and verifies.
- **Godot MCP servers** (`Coding-Solo/godot-mcp`, `ee0pdt/Godot-MCP`, `youichi-uda` Godot MCP Pro, `hi-godot/godot-ai`)
  exist and let an agent drive the Godot editor. Useful *only* if the owner later wants a separate native game (e.g. a real
  character creator or a walkable station) — as a prototyping/authoring tool, exporting glTF back to the web app.
- **Character creation**: do it as data + a modular rig, not a game engine: a base glTF body with morph targets and swappable
  parts (the hangar already swaps ship skins). Free sources: Quaternius, Kenney, KayKit, Mixamo (animation retargeting),
  VRoid for stylized humanoids. License and credit each (Settings → Credits).
- **Procedural worlds**: three.js + seeded noise (already used for the sky); keep content as data (layout JSON) so Claude can
  generate worlds without art tools.
- **Already available to us in this environment:** a Three.js viewer demo connector and a SketchUp connector exist in the
  registry (neither is a build pipeline). Figma/Sketchfab-style design MCPs help mock-ups, not runtime.
- **Free-tier realities:** Fly hosts the app; keep models on the static server with the service-worker cache (done); keep the
  first load under ~3 MB of code + ~5 MB of art. Anything bigger is lazy.

## 7. What I need from the owner / Muse
- Muse: find the gate GLB (`specs/muse-gate-asset-2026-10-29.md`) — still the highest-visibility fix.
- Owner decision: approve the order in §5 (default: go top to bottom).
- Optional: tell Muse to set up **Blender + blender-mcp** on a desktop if we want to create characters/worlds assets directly.

## 8. Status — updated 2026-10-30 (all measured in a real browser at 412×915)
| Item | Result |
|---|---|
| S1 home galaxy paused under a world | ✅ 0 draw calls behind a world; the world's own frame budget ~4× |
| S2 entry bundle | ✅ 2,251 KB → 701 KB (gzip 720 → ~215 KB): rarely used panels, the worlds layer, the prefetcher and the People star catalog load on demand |
| S3 cold download (home) | ✅ 28.7 → 21.9 MB: the 5 MB music loop loads on first play (`preload="none"`), the 921 KB alternate ship on first visitor. Still open: `space_station_3.glb` 3.9 MB (already deferred ≥ 6 s), `soumaya-ship.glb` 2.3 MB (needed at once), `pp-comet.glb` 1.8 MB, `sun.glb` 1.5 MB |
| S4 level of detail | ⏸ Not built, deliberately: measured scenes are 15–37 draw calls and 31–106 k triangles (budget ≤ 100 / ≤ 150 k), so an LOD tier would add code for no measured gain. Revisit if a world's triangles pass ~150 k (the per-world numbers are in §2 and `perf-audit` re-measures them) |
| S5/S6 one renderer + cached sky | ✅ WebGL contexts after 3 world visits 4 → 2 |
| U1 Observatory header | ✅ |
| U2 tap targets | ✅ 16 → 0 controls under 44 px on the galaxy screen |
| U3 stacked Focus buttons | ✅ closed fan is `visibility:hidden` (out of the tab order and the accessibility tree) |
| U4 home layout slots, U5 tokens, U6 SVG icons, X3 four primary buttons | ⏳ open — design work that needs the owner's eye on the home screen |
| X1/X2 first run | ✅ one surface at a time, toasts calm, no URGENT for routine news |
| X4 purpose line per world | ✅ once per world on first arrival |
| Adaptive quality in the worlds layer | ⏳ open |
