# Muse request (optional): painted / rendered button art for the HUD

**From:** Claude · **Owner direction 2026-10-30:** buttons should not be "just emoji'd up"; if images can be made, make them.
**What already exists:** a complete **SVG icon set drawn in code** (`components/icons/Icon.tsx`, 53 icons, one stroke style, tinted
by button state). The app looks consistent without any image. **This request is the optional next step up** — richer, game-style
art for the *hero* buttons — and nothing depends on it.

## Which buttons (16 — the always-on HUD)
Tools · Panels · Search · Settings · Chat · Briefing (the Observatory) · Add a memory · Music · Focus · Views · Recenter · Zoom + ·
Zoom − · Notices · Fuel gauge cap · Home-galaxy "← Galaxy".

## Look
"Cosmic glass": a dark translucent disc, a thin cyan rim light (`#7af9ff`, the app's accent), a single soft key light from the
upper left, and one clear symbol in warm white. Planet-surface / instrument-panel feel, never cartoon, never photoreal clutter. The
symbol must read at **22 px** on a phone — one idea per button, no text inside the art (the visible word under it stays code text).

## Deliverables (per button)
- `packages/web/public/hud/<name>.webp`, **128×128**, transparent background, **≤ 6 KB** each (whole set ≤ 100 KB).
- **Three states** per button: `<name>.webp` (idle), `<name>-on.webp` (active/pressed: brighter rim + glow), `<name>-off.webp`
  (disabled: desaturated, 50 % alpha). Names match the SVG icon names (`search`, `settings`, `tools`, `panels`, `chat`, `observatory`,
  `add`, `music`, `music-off`, `focus`, `views`, `recenter`, `zoom-in`, `zoom-out`, `notices`, `fuel`).
- Rights: your own render, CC0, or CC-BY with the credit line (goes into Settings → Credits). No trademarked symbols.
- Tools: any — Blender (via the blender-mcp you set up), an image generator, or hand-drawn; export via the web-slim recipe (webp, no
  metadata). Upload through the GitHub website (binaries can't go through the connector).

## How Claude wires it (≈ 40 lines, after the files land)
`renderIcon` learns a second form, `img:<name>`, drawn as `<img>` with the three states and `alt=""` (the button keeps its own
accessible name); any button without art keeps its SVG icon. The offline fallback is the SVG set, so a missing file never shows a
broken image. Claude verifies at 412×915 and reports.

## Open for the owner
Pick a direction before Muse starts: (a) *cosmic glass* as above (default), (b) *flat neon line* (closest to today's SVGs), or
(c) *engraved metal* (more EVE/industrial). One reference image or screenshot of a game UI you like settles it.
