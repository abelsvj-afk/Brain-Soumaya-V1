# Free Spaceship Shortlist — no-account downloads, licenses verified from the source

**Prepared:** 2026-10-25 (research by subagent; Kenney Space Station Kit CC0 confirmed by King from the kenney.nl page itself)
**Why:** the owner ordered free spaceships, no accounts, to replace the placeholder ships in the mockups and to dress the Station (EVE-like) and the Deep Past. Every entry below is downloadable without creating an account, with its license verified from the source page — never from a roundup.
**Rule (standing):** no model ships until its license is verified FROM the file and it has a `public/CREDITS.md` entry. Tri counts marked "not stated" must be measured at import (glTF-Transform inspect, same as the Profondo workflow) before any model is committed to the Station's ≤88-call / ≤750k-tri budget.

## Shortlist

### 1. Kenney — Space Station Kit ★ best first pull
- **Author:** Kenney · **License:** CC0 — verified on the kenney.nl asset page ("License: Creative Commons CC0") — confirmed by King, 2026-10-25
- **Download:** https://kenney.nl/assets/space-station-kit (Download button → donation prompt → "Continue without donating" → direct zip; no account)
- **Format:** OBJ, FBX, glTF · **90 files** · Tri count: not stated (Kenney low-poly style — verify per model at import)
- **Role:** Station dressing + ships. 80+ models for building stations *and* ships — the single best fit for the Great Station's EVE-style dressing (docking arms, modules, hangars) plus traffic.

### 2. Kenney — Space Kit ★ best first pull
- **Author:** Kenney · **License:** CC0 — verified on the kenney.nl asset page
- **Download:** https://kenney.nl/assets/space-kit (same no-account flow as above)
- **Format:** OBJ/FBX/glTF (Kenney standard) · **150 files** · Tri count: not stated
- **Role:** Hero-adjacent ships + station traffic. Ships, planets, port structures — the ships in this kit are the most likely hero-ship candidates (stylized, low-poly, consistent art direction with the Station Kit).

### 3. Quaternius — Ultimate Spaceships Pack ★ best first pull
- **Author:** Quaternius · **License:** CC0 — verified on the Godot Asset Library record ("CC0; 2023-02-19", submitted by Malcolm Nixon); the pack is listed on the quaternius.com homepage
- **Download:** https://quaternius.com (pack page) or the Godot-converted copy at https://godotengine.org/asset-library/asset/1674 — both direct, no account
- **Format:** FBX/OBJ + Godot conversion · Tri count: not stated · **Note:** models include animated exhaust meshes
- **Role:** Fighters / shuttles / varied fleet. Multiple distinct ships in one pack — the fastest way to get varied station traffic and NPC ships.

### 4. reodesuxz — Low Poly Space Pack
- **Author:** reodesuxz · **License:** permissive, stated on the page — "Free for personal and commercial projects. No attribution required. Please do not resell or redistribute the files." (Not CC0 — credit it by its stated wording, not as CC0.)
- **Download:** https://reodesuxz.itch.io/low-poly-space-pack (itch.io free download, no account — no login wall on the page)
- **Format:** FBX, GLB, OBJ, .blend · **26 models, 4,868 triangles total** · flat-shaded, no textures needed
- **Role:** Rockets, satellites, space-station pieces, small craft. The whole pack costs less than one hero ship's budget — ideal filler traffic and station props.

### 5. FlexUnit — 3D Game Ready UFO Spaceship
- **Author:** FlexUnit · **License:** CC0 — verified on the itch.io page
- **Download:** https://flexunit.itch.io/3d-game-ready-ufo-spaceship (no account)
- **Format:** FBX · **1,906 polygons, 2,400 vertices**
- **Role:** Small craft / odd visitor ship. Saucer form reads instantly as "alien/other" — good for one distinctive NPC or a Man-God-world visitor craft.

### 6. archfan7411 — Stylized Spaceship (OpenGameArt)
- **Author:** archfan7411 · **License:** CC0 — verified on the OGA page ("I'm releasing it as CC0")
- **Download:** http://opengameart.org/content/stylized-spaceship-untextured-unwrapped-w-materials (direct attachment, 490.1 KB zip; OGA login is only needed to comment, not to download — verified)
- **Format:** FBX, OBJ (+MTL), source .blend · Tri count: not stated
- **Role:** Hero ship candidate. Stylized, untextured and unwrapped with materials — needs the app's own material pass (same treatment as Profondo), but the form is clean and game-ready.

### 7. NASA 3D Resources (conditional — real spacecraft, check weight at import)
- **Author:** NASA · **License:** public domain — verified on https://science.nasa.gov/3d-resources/ ("All of these assets are free to download and use"; the old hub states "free and without copyright"). Mirrored on GitHub per NASA's own page.
- **Download:** https://science.nasa.gov/3d-resources/ (no account)
- **Format:** glTF 2.0 / .glb with Draco compression in the GitHub mirror
- **Role:** One real spacecraft as a hero shuttle — *but* poly counts must be checked at import. The Apollo Lunar Module is verified at **100,628 polygons** (data.gov catalog) — too heavy, rejected on budget. Lighter models in the collection (e.g. New Horizons, Kepler) are the ones to try; do not ship any NASA model without a tri-count check first.

## Checked and rejected

- **Sketchfab / BlendSwap** — excluded: both require an account to download.
- **CGTrader** (incl. its "free" spaceship listings) — account required to download, even for free models; several "free" listings are paid or subscription-gated.
- **rigmodels.com** — login wall ("Please login to continue") on model pages.
- **3DExport** — paid ($13 for the spacecraft pack) + account.
- **Unity Asset Store** — account required; the relevant station/ship packs are paid ($9–$15).
- **Poly Haven** — no spaceship models in the library at all (nature/architecture/HDRI only); nothing to take.
- **OpenGameArt "Cartoon Spaceship"** — ~835 polys, FBX, but the license field is not stated on the fetched page. Unverified → do not use until the author/license is confirmed.
- **Meshy AI free models** — AI-generated, license terms unclear. Not verified, not recommended.
- **Kenney All-in-1 bundle (itch.io)** — $19.95 paid bundle. The individual kits above are the free route; don't pay for the bundle for these ships.
- **NASA Apollo Lunar Module** — public domain but 100,628 polys; rejected on the Station's ≤750k-tri total budget (it would eat a seventh of the scene alone).

## Notes for the build

- Best first pull: Kenney Space Station Kit + Space Kit + Quaternius Ultimate Spaceships Pack — three downloads cover station dressing, hero candidates, and traffic, all CC0, all no-account.
- The reodesuxz pack is the only non-CC0 item on the list; credit it by its stated wording, not as CC0.
- Nothing here replaces the verified `organic-spaceship.glb` (CC-BY-4.0, ricksticky) — that stays the credited fallback. And `soumaya-ship.glb` is not recommended (license unverified).
- All tri counts "not stated" above must be measured at import (glTF-Transform inspect, same as the Profondo workflow) before any model is committed to the Station's ≤88-call / ≤750k-tri budget.
