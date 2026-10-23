# Gemini Research 2 — Verification Record (2026-10-23)

**Subject:** Gemini Deep Research report, "Technical and Legal Evaluation of Free-License 3D Space Station Megastructures" — produced at the owner's request (King-drafted prompt) to find a *truly free* space station model for the Great Station. Per standing rule, every decisive claim was verified against primary sources before any of it enters design. **Verified by King, 2026-10-23, by fetching the cited pages directly.**

## Verdict in one line

Two of seven candidates are real. The five Sketchfab candidates are **unverifiable as cited — their URLs return 404 and no matching models surfaced in search** — and three of them carry triangle counts computed as *portfolio averages*, which is not a measurement of anything.

## Candidate-by-candidate

| Candidate | Cited link | Verification result |
|---|---|---|
| **Profondo** (vostok, BlendSwap) | blendswap.com/blend/11999 | ✅ **REAL.** Page fetched: license field on the page itself = **CC-BY**; Blender 2.6x, 2.46 MB, no textures (Cycles materials only) — all as reported. Triangle count **not stated on the page** (the report's "40k–80k" is an estimate, labelled as such there). Over 12 years old; .blend only — needs a conversion pass and a hands-on inspection before any reliance. |
| **Rotor Nexus** (rivetech, Sketchfab) | sketchfab.com/3d-models/sci-fi-space-station-rotor-nexus | ❌ **404.** Real Sketchfab model URLs carry a hash suffix; this bare slug does not resolve, and search found no matching model. The "license quote" reads as a template attribution string, not verified license text. **Dropped — unverifiable.** |
| **Freeport Space Station 2** (Sketchfab) | sketchfab.com/3d-models/freeport-space-station-2 | ❌ **404**, no matching model in search. Its "125,000 triangles" is the author's *portfolio average* (22M ÷ 176) presented as a per-model spec. **Dropped — unverifiable + fabricated spec.** |
| **Futuristic Open-Concept Space Station** (Sketchfab) | sketchfab.com/3d-models/futuristic-open-concept-space-station | ❌ **404.** Same portfolio-average spec. **Dropped.** |
| **Space Station 4** (re1monsen, Sketchfab) | sketchfab.com/3d-models/space-station-4 | ❌ **404**, no matching model in search. The "ships with 4K textures" warning is therefore also unverified. **Dropped.** |
| **Civil Fuel and Assembly Space Station** (Sketchfab) | sketchfab.com/3d-models/civil-fuel-and-assembly-space-station | ❌ **404.** Same portfolio-average spec. **Dropped.** |
| **Space Station Kit** (Kenney) | kenney.nl/assets/space-station-kit | ✅ **REAL — and upgrades our earlier record** (Research 1 left this page "not confirmed"). Page fetched: **CC0** stated on the page, 90 files, v1.0 (2024). Caveat the report underplays: it is tagged **interior** and is stylized low-poly kit-bash material — not a monumental exterior centerpiece. Cleanest possible license; wrong shape for the Station's hero role, plausible as dressing/modules. |

## The rest of the report

- **Legal framing — sound in conclusion, unverified in citation.** The core claim is right: proprietary "royalty-free" licenses (TurboSquid-style) forbid distributing models in extractable form, which WebGL inherently is; CC0/CC-BY + download + self-host is the safe path. The specific Sketchfab ToS section numbers (§3.3 / §4.2.2) were **not** independently verified and should not be quoted as fact.
- **Technical sections — standard and correct** (texture memory is the real mobile bottleneck; ≤2K textures; KTX2/Draco optimization pipeline; CC-BY attribution via a credits surface). Consistent with the settled D-3 stack and budgets; nothing new to adopt.

## What this changes

Nothing yet. D-2 stands (procedural fictional megastructure, built by King) until the owner decides otherwise. The verified material on the table:

1. **Profondo** — a real, CC-BY, texture-free station model that could be downloaded and inspected hands-on (its look, real triangle count, and conversion effort are all still unknown until someone opens the file).
2. **Kenney Space Station Kit** — CC0 modules, available as dressing/kit-bash material under any approach.

Any adoption decision belongs in the P2-3 design note, when P2-3 is authorized.
