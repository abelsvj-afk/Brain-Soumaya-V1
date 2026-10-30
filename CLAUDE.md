# CLAUDE.md

**MANDATORY — development process.** All substantive work follows the full
[`docs/AI_ENGINEERING_WORKFLOW.md`](./docs/AI_ENGINEERING_WORKFLOW.md) lifecycle —
**Rule #1: no code is written until the design/spec is complete.** ([`WORKFLOW.md`](./WORKFLOW.md)
is the lighter day-to-day loop derived from it.) This is standing policy; it does not need to be
re-stated each session.

**MANDATORY — post-MVP workflow.** [`docs/AI_ENGINEERING_WORKFLOW_POST_MVP.md`](./docs/AI_ENGINEERING_WORKFLOW_POST_MVP.md)
governs all work **once the current tools/functions build-out is complete** (Soumaya's tool-router
fleet + the neuro-aligned features). At that cutover it becomes the operating workflow: MVP Freeze →
repository/bug/quality/debt/dependency audits → architecture/refactor/security/testing/performance/
observability → AI validation (memory, prompts, retrieval, hallucination, cost) → product readiness
(UX, a11y, docs sync, beta, deployment, rollback, monitoring). Until the cutover, keep shipping under
the lighter loop above; do not prematurely freeze features.

**STATUS (2026-07-10): first post-MVP hardening cycle COMPLETE; freeze LIFTED.** All the phases above
ran once and shipped (see `docs/POST_MVP_AUDIT.md`, `POST_MVP_PHASE4/5/9/12*.md`). We are back in
**feature-growth mode** under the lighter loop, steered by the north-star docs below. Re-freeze and
re-run the post-MVP phases before the *next* major expansion — not per feature. Part 6 (Continuous
Ops: repo-health/KPIs/governance) is the standing rhythm going forward.

**MANDATORY — product north star.** We are building Soumaya toward the patterns in
[`docs/SECOND_BRAIN_BRIEFING.md`](./docs/SECOND_BRAIN_BRIEFING.md) (Obsidian "second brain"
adaptation; the research calls us "Sarmiah" — same product). The live gap analysis + staged growth
plan is [`docs/SECOND_BRAIN_ALIGNMENT.md`](./docs/SECOND_BRAIN_ALIGNMENT.md) — consult it when
planning new feature growth. The neuroscience cross-reference (what to build vs. skip, evidence-
graded) is [`docs/NEURO_ALIGNMENT.md`](./docs/NEURO_ALIGNMENT.md). **Core principle from it:
memory is made by *retrieval*, not storage** — the galaxy is the memory palace, but a spaced-
repetition + gentle active-recall layer (dimming stars = review cue; Soumaya nudges recall in her
own voice, never Anki decks) is the highest-leverage growth direction and a first-class staged feature.

**MANDATORY — Vision 2.0 (Journeys).** [`docs/VISION_2_JOURNEYS.md`](./docs/VISION_2_JOURNEYS.md) is the
user-authored, version-controlled **source of truth** for Soumaya's next era: everything ultimately
belongs to a **Journey** (a meaningful life chapter), Soumaya asks *"what Journey does this help?"*
instead of "where do I save this?", the daily loop lands in **Mission Control**, the galaxy is a
**Living Galaxy** that reflects life in motion, and money/tasks/memories/people all connect through
Journeys. **Consider every new feature against this doc — where it can serve a Journey, it should.**
Large pieces get their own spec first (per the workflow), but this governs *what* we build toward.

**MANDATORY — read before proposing new feature growth.** [`HONEST_ASSESSMENT.md`](./HONEST_ASSESSMENT.md)
is a dated, honest outside read on whether this product is actually worth using long-term (not a
status log — a frozen verdict, re-run periodically, entries appended not overwritten).
[`docs/OPTIMIZATION_ROADMAP.md`](./docs/OPTIMIZATION_ROADMAP.md) is the non-destructive fix plan for
what it found — **no tab removal, no rebuild; fix/consolidate/surface what's already built.** Weigh
any new feature idea against closing the roadmap's open problems before adding more surface area.

**HISTORICAL NOTE**: [GEMINI_CHANGES.md](./GEMINI_CHANGES.md) records past modifications, asset additions, and infrastructure changes from earlier agent work, for continuity. It is a historical log, not an active agent's change log — the current agents are Claude, Muse, and ChatGPT (see below).

Guidance for working in this repo. Read this before making changes.

## What this is

**Soumaya · Second Brain** — a personal knowledge graph you talk to. You dump raw
thoughts; the system extracts typed nodes + relationships, embeds them, links them
associatively, and renders them as a navigable 3D **galaxy** where memories are
celestial bodies with real gravitational mass.

Signature features: **associative auto-linking**, **synthesis digest** (surfaces
latent connections), **chat-with-your-brain** (GraphRAG with cited answers), and
the **celestial galaxy UI**.

## Monorepo layout (npm workspaces)

- `packages/shared` — domain types + zod schemas + celestial mechanics. The single
  source of truth shared by server and web. Changes here ripple both ways.
- `packages/server` — Express API, SQLite + sqlite-vec, ingestion pipeline, LLM
  providers, graph/synthesis/chat services. Runs TypeScript directly via `tsx`.
- `packages/web` — Vite + React + react-force-graph-3d (three.js) galaxy client.

## Commands

```bash
npm test            # all vitest suites (server). Keep green.
npm run typecheck   # tsc --noEmit across workspaces. Keep clean.
npm run build       # builds the web app
npm run dev         # local dev (server + web)
```

Always run `npm test` and `npm run typecheck` before committing. The web app must
`npm run build -w @brain/web` cleanly.

## Architecture conventions

- **Provider seams.** Embeddings (`embeddings/adapter.ts`) and LLM
  (`llm/adapter.ts`) are interfaces with swappable implementations. There is
  always a no-API-key fallback: `hash` embeddings and the `heuristic` LLM, so the
  app is fully functional offline. Never make a feature hard-depend on a cloud key.
- **Repositories** (`repositories/*.repo.ts`) own all SQL for an entity. Services
  compose repos; routes are thin and only validate + delegate.
- **Vectors** live in the `vec_nodes` vec0 table (`db/vec.ts`), joined on node id.
  Relational schema is in `db/schema.ts`; raw bootstrap + additive migrations are
  in `db/client.ts` (`migrateSchema` — use it for new columns so existing Fly
  volumes upgrade in place).
- **zod schemas** in `shared/schema.ts` are reused as Gemini `responseSchema` —
  keep them flat (deep schemas are fragile with the API).

## Celestial mass model (the galaxy physics)

`shared/celestial.ts` is the heart of the visual system:

- Each memory has an **importance** (0..1, rated by the LLM at ingestion; the
  heuristic provider scores it from weighty vocabulary + length).
- `deriveMass({ importance, degree, emotionalWeight })` blends significance,
  connectedness, and emotional charge into a **0..1 mass**.
- `classify(mass)` → 6 tiers: `asteroid | moon | planet | giant | star | supergiant`.
- The **graph service enriches nodes on read** with `degree`, `mass`, `val`, and
  `celestial` — never denormalize these into the table.
- Frontend motion is **kinematic** (`graph/orbits.ts`), not a force sim: each body
  orbits its heaviest connected neighbor on a fixed path (pinned via fx/fy/fz), so
  it never collapses. `orbits.getDescendants(id)` powers the "isolate system" view.
- Agents/assets (`graph/soumaya.ts` ship, `graph/spaceStation.ts`) are glTF models
  in `packages/web/public/*.glb` with procedural fallbacks; the autonomous agent
  loop hits `/api/maintenance/*` and is **token-gated behind Research Mode**.

When adding signals that should affect gravity, fold them into `deriveMass` so
both rendering and physics stay consistent.

## Multi-tenancy (private brains)

One deployment hosts many private "spaces" (brains). Every per-user table
(`nodes`, `edges`, `insights`, `agent_logs`, `daily_logs`) carries a `space_id`;
`settings` stays global (the shared deployment API budget). Auth is a lightweight
name + passcode (`auth/spaces.ts`, scrypt-hashed) — the returned random space id
is the client's bearer key, stored in localStorage and sent as the `x-space-id`
header. `requireSpace` (api/middleware.ts) validates it and stashes it on
`res.locals`; routes read it via `spaceOf(res)` and pass it to **space-scoped
repositories** (`new NodesRepo(handle, spaceId)`) and helpers — every repo/service
takes a `spaceId` defaulting to `DEFAULT_SPACE` ("legacy") so internal/test callers
still work. `knn(..., spaceId)` over-fetches then filters by space so vector search
never crosses brains. Pre-existing data lives under `legacy` and is claimed by the
**first** account to register. When adding a data table or query, scope it by
`space_id` the same way.

## Guardrails / middleware (server)

- `api/middleware.ts`: `securityHeaders` (nosniff / DENY framing / no-referrer)
  and a dependency-free in-memory `rateLimit` on `/api` (`RATE_LIMIT_MAX`, default
  120/min). `trust proxy` is set for correct client IPs behind Fly.
- `express.json({ limit: "1mb" })` caps body size.
- Every route validates its body with zod and returns 400 on bad input.
- Central error handler in `api/server.ts` catches async rejections (Express 5).
- Keep new routes to this pattern: validate → delegate to a service → json.

## Deployment

Single container (Fly.io): `Dockerfile` builds the web app, bakes the MiniLM
embedding model into the image, and the Express server serves both the API and the
static web (`WEB_DIR`). SQLite persists on a Fly volume at `/data`.

**How deploys actually happen (verified 2026-06-20):** GitHub Actions is **blocked on
this account** — runs `startup_failure` with 0 jobs (private-repo Actions minutes/
runner unavailable), so `.github/workflows/fly-deploy.yml` never ships anything. The
working path is a **manual `fly deploy --remote-only`** (this sandbox has no flyctl
token or Fly network; Fly work goes through the dashboard browser). The durable fix is to
reconnect **Fly's native GitHub auto-deploy** (Fly dashboard → app → GitHub), which
builds the Dockerfile on push without Actions. Either way: pushing alone does NOT deploy
right now — trigger a `fly deploy` after pushing branch changes you
want live. Migrations must be additive + idempotent so a deploy can never crash boot on
the existing volume (`migrateSchema`; covered by `migration.test.ts`).

**Update 2026-10-28 (verified):** Fly's native GitHub auto-deploy is now ON and the deploy
branch is `main` (created 2026-10-28 from the old deploy branch tip `7262265a`). Pushing to
`main` now deploys automatically; latest release v273 (2026-10-28 5:09 PM EDT) is from `main`.
The old deploy branch `claude/soumaya-second-brain-v1-m4z4hc` is no longer the mainline. The
manual `fly deploy` path above is now a fallback, not the primary path.

**Owner access (2026-10-28).** The deployment owner's brain skips the worlds' progression gates (People,
Eternity's relic gate and its three-leg chain). It is a server secret, `OWNER_SPACE_IDS` (comma-separated
space ids; `fly secrets set OWNER_SPACE_IDS=<id>`), read per call in `auth/owner.ts`. Keyed on the space id,
NOT the gamer tag — a tag can be re-registered once its account is deleted; an id is an unguessable bearer
key that must already exist. Unset/empty = nobody exempt (the default). Fuel is NOT waived (warp still
costs; drift is free). Settings → Owner access shows the server's verdict and has "Copy my brain key" to
get the id. Never commit an id; it is a credential.

LLM is optional — without a key the app runs in heuristic mode. To use a key:
`fly secrets set LLM_PROVIDER=gemini GEMINI_API_KEY=...` or
`fly secrets set LLM_PROVIDER=openai OPENAI_API_KEY=...` (defaults to the cheap
`gpt-4o-mini`; override with `OPENAI_MODEL`). Cloud providers degrade to the
heuristic automatically on credit/quota errors (see ResilientLlmProvider).

## Agent team (current)

Claude is the architect/lead and the only one who signs off "Verified". The other agents on this repo are Muse (diagnosis + usage-heavy work, via the user) and ChatGPT (free plan, read-only auditor) — see their sections below. There is no longer an active second coding agent; the former second-agent delegation setup was removed 2026-10-28. Takeover rule: Muse takes over implementation ONLY if Claude hits its usage limit (see the takeover rule in the Muse section); otherwise Claude implements.

**Keep for Claude (do NOT delegate):** Red-Zone work — `packages/shared/*` types/zod, `db/*` schema + migrations, `graph/orbits.ts`, `web/src/api/client.ts`, the token/USD/Fuel guards, `space_id` multi-tenancy scoping, route contracts — plus architecture decisions, ambiguous/underspecified features, security/data-integrity, and the **final audit + "Verified by Claude" checkmark**.

**BRANCH RULE (2026-10-29): every change — and every pull request's BASE — must be `main`.** On 2026-10-28 PR #125
(Station interior) was merged into the OLD branch, not main, so it never reached Fly: GitHub's default branch
setting was still `claude/soumaya-second-brain-v1-m4z4hc`, and a PR opened without choosing a base targets the
default. (Reconciled into `main` 2026-10-29 as `3574c1b`; the old branch is now fully contained in `main`.)
**Owner action still needed:** GitHub → Settings → Branches → default branch → `main`. Until then, ALWAYS pass
`base: main` explicitly when opening a PR, and never merge into the old branch.

The mainline branch is **`main`** (created 2026-10-28 from `7262265a`); the old deploy branch `claude/soumaya-second-brain-v1-m4z4hc` is retained but no longer the mainline. Fly deploys from `main` with auto-deploy on (see Deployment update 2026-10-28 above). The shared gate and the historical change log (`GEMINI_CHANGES.md`) still apply.

## Verify before you build (and before you claim it works)

The gate (`typecheck && test && build`) proves code *compiles*, not that it *behaves*. Two
standards, learned the hard way (shipping "the code should spread the bodies" fixes that didn't):

1. **Prove behavior by reproduction/measurement, not assertion.** Before changing logic — especially
   visual/spatial/numeric code you can't see rendered from here (`graph/orbits.ts`, `shared/celestial.ts`,
   layout/mass math) — first *reproduce and measure* it: `npx tsx` a throwaway script that feeds real or
   synthetic data through the actual functions and prints the numbers (e.g. run `makeOrbitSystem` over
   `makeDemoGalaxy` + a single-cluster graph and assert min nearest-neighbour distance / 0 overlaps), or
   add a unit test. Decide the fix from the measured output, not from reading the code. State the
   measurement in your summary.
2. **Rule out delivery (stale deploy / PWA service-worker / cache) before re-editing correct code.** When
   "it didn't change," first confirm the new build is what's actually rendering (Actions is blocked → a
   `fly deploy` must run; the service worker can serve old cached JS even on a fresh server). Never "fix"
   code that measurement shows is already correct to chase a deploy/cache problem.

## Pending Validation

- **Fix: Cinematic Intro Trigger** (Graph3D.tsx): Relaxed the intro trigger condition.
- **Fix: Cinematic Startup Race Condition** (Graph3D.tsx): Added `cinematicStartedRef` to prevent redundant triggers.
- **Fix: GalaxyViews Visibility** (App.tsx): Removed the `!!selected` constraint so Views remain accessible during node selection.
- **Optimization: Performance Audit & Improvements** (various): Ongoing performance work.
- **Fix: Visibility and Loading Issues** (various).
- **Optimization: Link LOD** (Graph3D.tsx): LOD optimization for dense brains.
- **Refactor: Intro and Observatory Timing** (various): Timing adjustments for smooth entrance.
- **Refactor: Startup Flow** (various): Decoupled loading dismissal from intro sequence.
- **Observatory card squish — CONFIRMED via real on-device screenshot (2026-09-03), FIXED**
  (index.css `.obs-card`): with an active user's ~15-card-deep Observatory, cards were being
  compressed below their content height (text cut off mid-sentence) instead of the already-scrollable
  `.obs-stack` actually scrolling past them — root cause was `.obs-stack`'s `overflow-y:auto` on a
  flex column resetting its children's automatic min-size to 0, so default `flex-shrink:1` let
  `.obs-card` shrink. Fixed with `flex-shrink:0` on `.obs-card` — cards now always render at full
  content height; the stack scrolls. Needs on-device re-confirmation once a deploy is possible.
- **Views toggle overlapping the left FAB column — CONFIRMED via real on-device screenshot
  (2026-09-03), FIXED** (index.css `.gv-wrap`/`.gv-chips`, `.lens-chips`): `.gv-wrap` (bottom:196px)
  sat squarely inside `.focus-cluster`'s footprint (bottom:186px, 44px tall) after that control's
  position had drifted without `.gv-wrap` being re-checked — same root-cause shape as the original
  "Fix Views button overlap" item, regressed by an unrelated later change. Moved `.gv-wrap` to
  bottom:300px, clearing the ENTIRE left FAB column (which stacks continuously 18-288px) rather than
  threading a specific gap that can silently close again. `.lens-chips` (the pinned-lens "Linked to
  X" pills) had the same problem from the opposite direction — centered and wide enough to reach
  into both the left AND right FAB columns at bottom:20px — moved to bottom:350px, above `.gv-wrap`'s
  collapsed toggle. Also capped `.gv-chips`' expanded height (`max-height:40vh; overflow-y:auto`) so
  it can't grow unboundedly. Known residual, not fully solved: if Views is expanded to several rows
  of chips AND 2+ lenses are pinned at the same time, `.gv-wrap`'s expansion could still reach up
  into `.lens-chips`' band — flagged rather than fixed with a bigger state-lifting change, since it
  wasn't the confirmed default-state bug. Needs on-device re-confirmation once a deploy is possible.
- **Observatory 🔍 search button** (Observatory.tsx header): new, added blind — confirm it doesn't
  visually collide with the existing × close button on narrow phone widths.
- **Mind tab "✓ Achieved" badge + "💾 Save as Lens" chip** (MindPanel.tsx, GalaxyViews.tsx): new,
  small pill-shaped UI elements, added blind — confirm they read clearly at a glance and don't
  crowd their row on a narrow phone.
- **Working-memory mote color-by-source + settle animation** (MindPanel.tsx, MindSpace.tsx): motes
  now tint by why the thought surfaced (manual/chat/goal/priority/emotion) instead of one flat
  blue, and a thought promoted to a real memory (via ★ or the 3rd "Keep") gets a brief flare/shrink
  in the in-panel list before it clears. Added blind — confirm the five source colors read as
  distinct at mote size (8px dot) and that the settle flourish doesn't feel like a glitch. Note:
  deliberately NOT mirrored to the ambient MindSpace overlay (it's always hidden at the exact
  moment a promotion can fire, since promoting only happens from a button inside the open Mind
  panel) — MindSpace only picked up the color tinting, which is worth an eyes-on for legibility too.
- **Link-line flicker regression — CONFIRMED via real on-device use (2026-09-03), FIXED**
  (Graph3D.tsx `shouldRenderLink`): a *different* code path than the one already fixed for this
  exact symptom (`linkVisibility`'s `linkLodZoomedInRef`, June). A later perf pass added
  `shouldRenderLink` (link-color/width short-circuit for distant/inactive links) with a bare
  `dist < 800` check re-evaluated every frame — hovering near that distance flipped every
  non-lit, low-activity link on/off every frame, reproducing at any zoom/angle whenever a node
  was selected. Fixed with the same hysteresis pattern as the original fix (an 80-unit band,
  `shouldRenderLinkCloseRef`) — the lesson (missed once already) is that this specific bug class
  needs the fix applied to every place a camera-distance check gates link visibility, not just
  the first one found. Needs on-device re-confirmation once a deploy is possible.
- **Planets not lit by the sun — CONFIRMED via real on-device use (2026-09-03), FIXED**
  (shaders.ts `makePlanetMaterial`, Graph3D.tsx tick loop): a genuine regression from the earlier
  Stage 4 "shader diet" work — planet bodies render with a custom `ShaderMaterial` that has no
  `lights: true` and never receives three.js's real light uniforms (deliberate, to avoid the
  shader-recompile cost of real per-light integration), but its fragment shader also hardcoded a
  fake light direction fixed relative to the CAMERA (`vec3(0.6,0.7,0.5)` in view space) instead of
  ever reading the real sun's position — so a planet's lit side never actually tracked where the
  sun (a fixed point at the world origin, `sun.ts`) really is. Fixed by adding a `uSunDirView`
  uniform, updated every frame per body as `normalize(-bodyWorldPos)` transformed into view space
  — cheap (one vector transform, no new lights, no shader recompilation) so it doesn't reintroduce
  the cost Stage 4 was avoiding, while making planets genuinely respond to the sun's position.
  Needs on-device re-confirmation once a deploy is possible.
- **Inconsistent name pop-in/out at different zoom distances — CONFIRMED via real on-device use
  (2026-09-03), FIXED** (Graph3D.tsx label/sector-title logic): a hub body's OWN name faded out
  at the ordinary label distance (300-540 units) while its sector title didn't switch on until
  ~2450-2750 units (MACRO_DIST's hysteresis band) — leaving a ~1900-2200-unit "dead zone" where a
  hub showed NEITHER its own name nor its sector name, regardless of how steadily the camera sat
  there. Fixed by extending a `hasSectorTitle` body's own label fade-out to meet the sector
  title's turn-on point, so the handoff is continuous (briefly overlapping, never gapped). Also
  found and fixed a second, smaller contributor: the nearest-N visible-label cap fully rebuilt its
  membership every throttle window with no stickiness, so two bodies hovering near the Nth-nearest
  boundary could swap in/out on ordinary camera drift even though the total count never changed —
  added a 15% "sticky" distance bias for already-visible bodies so a clear overtake is required
  before a name disappears. Needs on-device re-confirmation once a deploy is possible.
- **Hub names "stuck" visible while orbiting/following, and visible through the sun — CONFIRMED
  via real on-device use (2026-09-03), FIXED** (Graph3D.tsx label loop): a follow-up to the item
  above, from the same on-device report. Two distinct causes:
  1. A `hasSectorTitle` hub deliberately bypasses the top-level frustum-cull hide (so its title
     sprite, which scales up with distance, can still read on screen past the body's own small
     culling sphere) — but the SAME bypass also skipped updating that hub's own close-up label
     whenever the body rotated out of frustum, freezing it at whatever visibility/opacity it last
     had (often fully visible) instead of hiding it. Following Soumaya's ship in a sustained orbit
     around the sun swings hubs in and out of frustum continuously, so their names appeared "stuck
     on" — reproducible identically under fast manual orbiting, not specific to follow-mode itself
     (confirmed: follow-mode drives the exact same `camera.position` the tick loop already reads
     everywhere else, so there's no separate/stale camera path). Fixed by explicitly hiding a
     culled hub's own label instead of leaving its state frozen.
  2. Genuinely missing feature, not a regression: nothing ever checked whether a large opaque body
     (the sun) sits between the camera and whatever's being named, so a body directly behind the
     sun kept showing its name right through it. Added a cheap closest-point-on-segment occlusion
     test against the sun's fixed position/radius (sun.ts) — no real raycaster/BVH needed, and it
     short-circuits immediately for anything closer than the sun's own radius. Verified correct
     with a throwaway `npx tsx` script (6 geometric cases: directly behind, sun behind camera, off
     to the side, very close, clear miss, clear hit) before wiring it in, per the "prove it by
     measurement" rule — one case initially failed from a wrong-by-construction test expectation on
     my part (a symmetric camera/body layout means the ray's closest approach to the sun falls at
     the segment's midpoint, at HALF the body's offset, not the full offset), not from the actual
     occlusion logic; corrected the test and re-verified all 6 pass. The selected/followed body is
     explicitly exempt (you deliberately selected or flew to it — it must stay readable regardless
     of what's technically between the camera and it). Needs on-device re-confirmation once a
     deploy is possible.
- **Views/Lens floating in the middle of the screen — CONFIRMED via real on-device screenshots
  (2026-09-05), FIXED** (index.css `.gv-wrap`, GalaxyViews.tsx, LensChips.tsx): two screenshots
  from the same device at different sessions showed the "🌌 Views ▸" toggle and the pinned-Lens
  quick-switch chips rendered in wildly different vertical positions, sometimes floating mid-
  screen over the sun. Root cause: `.gv-wrap` was anchored `bottom: 300px` (a fixed distance from
  the bottom edge) while `.fuel-gauge`/`.streak-ember` — the button cluster it's meant to visually
  group with — are anchored `top: 50%` (viewport-vertical-center-relative). Those two anchor
  families drift apart whenever the real rendered viewport height differs between sessions (e.g.
  Android Chrome's collapsing/expanding address bar) — a concrete case of the exact "hand-
  maintained pixel-offset table" fragility already flagged elsewhere in this doc and in Phase L's
  product audit. Fixed per explicit user direction: (1) re-anchored `.gv-wrap` to
  `top: calc(50% + 100px)`, joining the SAME anchor family as `.fuel-gauge`/`.streak-ember` so it
  moves in lockstep with that cluster regardless of viewport height, instead of re-tuning another
  standalone bottom-offset constant; (2) eliminated the second independently-floating overlay
  entirely — the pinned-Lens chips (formerly their own `<LensChips>` in App.tsx) now render as an
  in-flow `.lens-list` INSIDE the Views dropdown (GalaxyViews.tsx), so there is only one floating
  element in this area, not two that can drift apart. `.gv-chips`'s `max-height` was recalculated
  from a flat `40vh` to `calc(50vh - 156px)` to prevent the now-downward-growing dropdown from
  overflowing short devices. The exact `+100px` offset is estimated from `.fuel-gauge`'s own CSS
  layout math, not pixel-measured on-device — flagged for confirmation, but the structural fix
  (shared anchor family; one floating element instead of two) is what actually closes the bug.
  Needs on-device re-confirmation once a deploy is possible.
- **Nebula backdrop "cut out" color patch — CONFIRMED via real on-device screenshot (2026-09-05),
  FIXED** (graph/backdropBake.ts `bakeBackdrop`): the baked nebula/galaxy-glow backdrop showed a
  hard-edged, wrongly-toned color patch (a geometric "cut out" shape) instead of smoothly fading
  to black. Root cause: `WebGLCubeRenderTarget`'s texture defaults to `NoColorSpace` (correct for
  a texture feeding further linear-space processing) but this one is assigned directly to
  `scene.background` for direct display — exactly like the `CanvasTexture`s in `nodeObject.ts` and
  `skybox.ts`, which both already set `colorSpace = THREE.SRGBColorSpace` for that reason. Missing
  it here meant the additively-blended, overlapping sprites baked into this texture displayed with
  the wrong color-space interpretation, most visible exactly where several sprites summed into a
  bright patch. Fixed by adding `target.texture.colorSpace = THREE.SRGBColorSpace;` right after
  the render target is constructed, matching the established codebase convention exactly rather
  than attempting a more speculative shader/geometry change. Needs on-device re-confirmation once
  a deploy is possible.
- **Worlds unreachable (off-screen panels + broken stylesheet) — MEASURED headless 2026-10-28,
  FIXED** (TravelSheet.tsx, App.tsx, ToolsMenu.tsx, index.css): see "Current findings —
  2026-10-28" below for the root cause. Verified headless at 412×915: the sheet card sits fully
  on screen and on top, the route board lists all six worlds with tappable Warp/Drift, Escape
  closes it; the World map is `position: fixed`, full-viewport, on top, zero page errors.
  Needs on-device confirmation: the sheet at the owner's phone size, and that the map's new
  dimming scrim still reads as "drawn over the galaxy".
- **Travel never played — flight, gate, arrival (2026-10-29) — MEASURED headless, FIXED**
  (useTravel.ts, WorldsSurface.tsx, TravelPanel.tsx, App.tsx, index.css): the owner reported that
  warping did nothing — no flight through the gate, no tunnel, no arrival in the built world. Root
  cause: TravelPanel, WorldsSurface and WorldMap each run their OWN `useTravel()` with their own
  state and no sync, so a departure from the panel was invisible to the scene layer until a page
  reload (measured: across a full 55 s warp `.worlds-surface` never mounted). Even after a reload
  nothing called `arrive()` except a text button in the sheet. Fixed: (1) a `worlds:travel-changed`
  window event makes the other copies re-read the server after any action (server still the only
  authority); (2) the sheet closes itself via `TravelPanel onTransit` once the ship is under way —
  the sheet (z72) sits above the worlds layer (z70) and was hiding the flight; (3) WorldsSurface
  arrives the ship when the flight's time is up, from the server's `departedAt` (a reload resumes
  rather than restarts; reduced-motion is never held); (4) the render/renderer catches now
  `console.error` which world failed instead of swallowing it; (5) the cancel countdown no longer
  shows a stale value on its first frames. Eternity's header (13 items, one non-wrapping row = 937px
  on a 412px phone) pushed "Back to your galaxy" off-screen; it now wraps, buttons are styled, and
  Eternity's white void gets dark text. Verified end to end at 412×915: depart → 10 s cancel window
  → sheet closes → "Travelling to The Growing Place" flight → auto-arrival → Growing Place.
  **`scripts/worlds-check.mjs`** visits each world for real and prints PASS/FAIL + canvas time +
  MB downloaded (`BASE_URL=… SPACE_ID=… node scripts/worlds-check.mjs`); all 7 worlds PASSED locally.
  **Known and NOT fixed — weight:** the home galaxy alone downloads 21.6 MB at startup
  (`space_station_3.glb` 14 MB) and each world adds 6–20 MB (Station ~19, Deep Past ~20, Scale ~19,
  Growing Place ~13, Eternity ~6, People ~0.2); the biggest files are unslimmed
  (space_station_3 14 MB, sf-lava-planet 11, sf-ice-planet-procedural 10.5, sf-anchor-spire 8.2) and
  served `max-age=0`. This is the "very slow" — slimming them is Muse-sized binary work (the verified
  web-slim recipe). Needs on-device confirmation of the whole flight on the owner's phone.
- **Load weight: caching, station deferral, destination prefetch (2026-10-29) — MEASURED headless,
  FIXED** (server.ts, public/sw.js, spaceStation.ts, worldPrefetch.ts, useTravel.ts): the owner said the
  app is "very slow". Measured: home galaxy alone 21.6 MB at startup; each world +6–20 MB; and a RETURNING
  visitor re-downloaded 24.5 MB (the 14 MB `space_station_3.glb` + 10.5 MB `sf-ice-planet-procedural.glb`)
  on every visit — the browser's HTTP cache would not keep files that large. Fixed: (1) `isHashedBuildAsset`
  — the old "immutable" rule looked for a DOT before the hash but Vite writes a HYPHEN, so the 2 MB bundle
  was never cached hard; now every `assets/name-<hash>.ext` is immutable (un-hashed public files stay
  revalidatable); (2) the service worker keeps `.glb` + `/draco/` + `/basis/` in a persistent
  `soumaya-assets-v1` cache (survives deploys; code/pages/API stay network-first), serves from it at once,
  re-validates in the background with a conditional request, coalesces concurrent downloads of one file,
  and never caches an HTML page served for a missing model; (3) the station model starts downloading no
  earlier than 6 s (earlier: at 0.4 s) and no later than 20 s, sooner if the camera is where it would be
  shown (`shouldStartStationLoad`); (4) `worldPrefetch.ts` warms the destination world's models during the
  10 s cancel window + flight, read from each world's own asset module so a new model is included
  automatically; respects Data Saver / 2G. **Measured (real browser, same test before/after):** returning
  visitor 38.2 → 0.0 MB downloaded (every model a tiny 304 check); with prefetch Growing Place's models
  all finished 13.1 s BEFORE arrival (control: last one 11.2 s AFTER), Deep Past all 11 ready 2.4 s before
  arrival (control: 6.9 s after). **A trap worth remembering:** a script `fetch` with `cache: "no-store"` —
  and any `fetch` that sets `If-None-Match` — makes the browser add `Cache-Control: no-cache`, which
  Express's static files treat as a forced reload: the "cheap" validation silently re-downloaded 14 MB until
  the worker sent its own `Cache-Control: max-age=0` (pinned by `staticCaching.test.ts`). Still not fixed:
  FIRST-visit weight (slimming the models — Muse task `docs/specs/muse-glb-slimming-2026-10-29.md`), and the
  Deep Past scene appears to rebuild (re-loading its models) after mount — not investigated. **Scale is
  missing files:** 5 URLs its asset module names are not in `public/` (incl. the hero `ISS-A.glb` and probe
  models) — awaiting the owner's upload; the world renders without them. Needs on-device confirmation.
- **Growing Place ported to the approved mock-up look (2026-10-29) — MEASURED headless at 412×915, needs
  on-device confirmation** (gardenScene.ts): the real scene had a dark brown void between sparse rings
  (only terraces holding a plot were built) and dark spike "vegetation". Now: all 6 terraces always built
  in the mock-up's layered greens with step risers; the witness tree is the mock-up's trunk + five flattened
  canopy blobs + a warm halo sprite; the forest is 300 seeded instanced trees (trunk + canopy, kept off plots
  and landmarks); lights are the mock-up's warm ambient 1.15 / key 1.6 (the A8 warmth lerp still overrides
  their colours once warmth is seen). Deliberately NOT ported: the mock-up's dawn sky dome/sun/ridges — the
  owner asked for the current space/star backdrop. Draw calls stay far under the 95 ceiling (pinned by a
  test). Plots/paths/landmarks/tend/mutation untouched. Look at: forest density vs. plot legibility on a real
  phone, and whether the canopy halo reads against the dark sky.
- **Growing Place v2, step 1 — Journeys as groves (2026-10-29) — MEASURED headless, needs on-device
  confirmation** (gardenLayout.ts, gardenScene.ts, WorldsSurface.tsx; spec
  `docs/specs/growing-place-v2-2026-10-29.md`, owner-approved): the garden no longer re-shows every memory
  by age (the redundancy the owner called out). Each Journey is a grove (lawn, a taller blossom-green tree
  that grows with completed missions, a gold flower per completed mission, a name sign); its open missions
  are sprouts and its linked memories stones inside the grove; paused Journeys rest under mist with
  "· resting" on the sign (never colour alone); groves sharing a memory get a gold trail; loose memories from
  the last 30 days grow as wildflowers in the meadow; up to 5 memories due for recall float as seed pods.
  Fetches each Journey's links + `/api/review/due` on garden entry (a failed fetch renders that part empty,
  never guessed). Look at: whether groves read clearly among the forest from the orbit camera (step 2's
  walking camera is the real view).
- **Growing Place v2, step 2 — tap to walk (2026-10-29) — MEASURED headless, needs on-device confirmation**
  (gardenWalk.ts, gardenScene.ts `pickTarget`/`setAvatar`, WorldsSurface.tsx): Soumaya's ship is your avatar
  in the garden. Tap ground → she skims there along the terraces (never off the edge, never through the
  witness tree — 400 random routes pinned by test); tap a plot/pod → she goes beside it and its sheet opens
  on arrival; "🌳 Groves" lists the meadow + every grove (with "resting"/"completed"/"N done" in words) and
  walks her there. The camera follows behind/above her and drag/pinch still turn/zoom around her. Reduced
  motion: she jumps, the camera cuts. Headless ran at ~2 fps, so judge smoothness on the phone only. Look
  at: follow-camera height/angle feel, walking speed (150 u/s ≈ 12 s across), sign size up close.
- **Growing Place v2, step 3 — grove actions (2026-10-29) — MEASURED in a real browser, needs on-device
  confirmation** (GardenGroveSheet.tsx, GardenTendSheet.tsx `onCarry`, WorldsSurface.tsx, App.tsx
  `onGardenChanged`): arriving at a grove (Groves list, or tapping its lawn) opens its sheet — ✓ Done on a
  mission (the app's own DELETE, which credits the Journey; the tree grows), Plant a next step (a 30-day
  action item linked as a task), Place the memory she's carrying (tap a meadow wildflower → "🧺 Carry it to
  a grove" → a glow rides on her ship → place it), and Ask Soumaya about this Journey (journey-scoped chat).
  Verified end to end headless: plant → linked; done → "the tree grows (1 done)"; ask → answer; sheet
  refreshes in place. Carry → place is unit-tested only. Look at: the sheet's height over the scene on a
  phone, and whether a mission planted here showing as a 30-day to-do elsewhere in the app is expected.
- **Station interior layout — MEASURED headless at 412×915, FIXED (2026-10-29)** (WorldsSurface.tsx, index.css
  `.worlds-surface-room`): inside the Station the wrapped header is 195px tall; the room caption was pinned
  at 80–140px (on top of the header buttons) and the room card's top sat at 128px, covering "Back to your
  galaxy" (145–183px). The caption now sits inside the bottom room card and the card is capped at 55% of
  the viewport (top measured at 371px). Needs on-device confirmation on a shorter phone.
- **Worlds rebuilt 2–3× after opening (Deep Past, and now the garden) — MEASURED, FIXED (2026-10-29)**
  (WorldsSurface.tsx `sceneLayout`, `WORLD_DATA_GRACE_MS`): with Journeys / their links / due reviews /
  recent tends arriving one after another, each arrival changed the layout and rebuilt the whole 3D view
  (3 canvas mounts; every model requested twice). The garden and Deep Past now show "loading" until that
  data has settled and build once (measured: 1 mount, each model once), bounded by an 8 s grace so a slow
  request can't hold the world back — past it the world builds with what it has and may rebuild once more
  when the rest lands. A grove action (done / plant / place) still rebuilds, by design. Pinned by
  `WorldsSurface.test.tsx` (falsified: removing the wait fails it). Needs on-device confirmation that the
  wait is invisible on a real network.
- **Worlds controls: one header, one dock (2026-10-29, owner: "make the buttons yourself… and for navigation") —
  MEASURED headless at 412×915, needs on-device confirmation** (WorldsDock.tsx, WorldsSurface.tsx, index.css;
  spec `docs/specs/worlds-controls-2026-10-29.md`): every world's header is now one constant 56px row (title +
  "← Galaxy", 44px) and a world's controls are icon-over-word tiles in a scrollable dock under it (measured:
  header 0–56, dock 56–127 in garden, Station, Eternity). Eternity's 13 pills became two labelled groups
  (6 gestures, 4 tools; the held gesture shows ✓ + a heavier outline, never colour alone). Overlays now
  position from `--worlds-bar-h`. Replaces the "wait for Muse's v3.4 mock-up" blocker for the controls
  (the mock-up can still refine them). Look at: tile size/spacing on a real thumb, whether Eternity's tools
  (off-screen to the right until you scroll the row) are discoverable enough, icon legibility.
- **Worlds lighting + portrait framing — MEASURED headless, needs on-device confirmation (2026-10-29,
  owner: "the lighting for every space is bad … only the Growing Place is bright enough")**
  (graph/worldLighting.ts, graph/worldCamera.ts, WorldsSurface.tsx): root cause — the home galaxy lights its
  glTF models with an environment map (Graph3D's RoomEnvironment PMREM) but the worlds never got one, so every
  metallic/PBR model (Station, planets, ships) rendered near-black whatever lights were added. Each world
  now declares a `light` rig (env map + hemisphere fill + key light) applied by the host. Mean brightness of
  the 412×915 view, 0–255, before → after: Station 12 → 35, Deep Past 19 → 53, People 11 → 48,
  Quiet/Archive 15 → 27, Growing Place 54 → 55 (unchanged), Eternity 247 (white void, unchanged), Scale
  3 → 4 (mostly empty space + missing ISS/probe files, needs content, not light). Second cause of "the Deep
  Past looks wrong": orbit distances were tuned on a landscape screen, so on a phone the camera showed a
  quarter of the width (a wall of rim rock); the camera now backs off by sqrt(1.6/aspect) (≤2.2×) — Deep
  Past now shows the whole rim, stair, ledges and basin. Look at: lighting strength/colour per world on a
  real screen (rigs are one-line tunables in WORLD_SCENES), and Deep Past's grey rock vs the mock-up's
  violet mood.
- **EVE-style travel: align → spool → warp → arrive, in place (2026-10-29, owner-directed; spec
  `docs/specs/eve-travel-2026-10-29.md`) — MEASURED in a real browser with a simulated journey clock
  (every phase captured at 412×915), needs on-device confirmation** (transitScene.ts, WorldsSurface.tsx,
  TravelPanel.tsx, index.css): the server's 10 s cancel window is now the cinematic, so the flight scene is up the
  moment you depart (the travel sheet hands over immediately; **Cancel departure** is a button on the HUD).
  ALIGN (6 s): the home gate is dead ahead, then the SKY swings round the holding ship (works on a narrow phone)
  until the destination beacon is centred; SPOOL (4 s): countdown 4…1, engines glow white → amber → deep red,
  FOV narrows and the camera shudders; JUMP: white flash, FOV kick, streaks accelerate from standstill; CRUISE:
  stretched streaks + edge blur (CSS overlays, no post-processing); ARRIVE: the destination gate decelerates with
  the ship and sweeps over her, engines cool back to white, then a fade hands over to the world (its models were
  prefetched; the Station keeps its approach glide) — no loading screen. The clock is the server's (`createdAt`
  / `departedAt`), so a reload resumes mid-sequence; when the window closes the app asks the server at once instead
  of holding on "1" until the next poll. Reduced motion: same sequence and timing, no sweep/shake/FOV/flash/blur
  (engine ramp + countdown stay). Drift keeps the align/spool and stays calm. Her hull is now lit (the travel
  scene takes the shared environment map). **Test harness:** `warp-sim` style captures need a simulated journey
  clock because software rendering shows the scene only after the align phase has played. Still open: drift and
  turn-back were exercised by unit tests only; the origin gate is only seen at the very start.
- **Worlds flight: fly your ship to places, feel the scale (2026-10-29, owner: "I want to feel like you can navigate
  around the spaces … don't know if anything is scaled up yet") — MEASURED in a real browser, needs on-device
  confirmation** (worldFlight.ts, shipAvatar.ts, worldPlaces.ts, shipHeat.ts, WorldsSurface.tsx; spec
  `docs/specs/worlds-flight-2026-10-29.md`): the Station, Deep Past, Scale, People and Quiet/Archive get a **Fly to**
  dock group of *places* found at runtime from the scene's named holders + bounding boxes (measured: Station
  — The Station, Drydock, planets; Deep Past — the rim, First Light basin, terrace, stair, spire, hero lantern,
  supernova remnant, orb; Scale — the ISS, Earth, Jupiter, Saturn, the Sun, a black hole…). Tapping one: her ship (true
  size, 12 units) ALIGNs (eased turn), SPOOLs (engines → deep red), BURNs (2.4–6.5 s, edge blur with speed) and stops at
  a stand-off (1.35× the place's radius); the chase camera follows and the caption states the scale ("The Station —
  879 across · 73× your ship"). "Overview" returns to the orbit camera. Reduced motion: faces the place and jumps. Pure
  maths unit-tested (stand-off, turn-the-short-way, burn bounds, speed profile, cooling, reduced motion). Found by
  measuring: the Station's real bounding sphere is 879 across (73× the ship), not the 35× its constant suggests.
  Look at: whether the stand-off feels close enough to read scale, tile row scrolling with 8 places (Scale), the ship
  looking small at true scale against a place that big.
- **Warp consistency: no placeholder ship, streaks past the ship, one shared sky (2026-10-29, owner-reported) — MEASURED
  in a real browser (simulated journey clock, 412×915), needs on-device confirmation** (transitScene.ts, shipAvatar.ts,
  homeSky.ts, WorldsSurface.tsx, Graph3D.tsx; spec `docs/specs/warp-consistency-2026-10-29.md`): (1) the transit ship and
  the in-world avatar are hidden until her real hull is ready — the procedural hull is only the load-FAILURE fallback (the first
  captured frame has no ship, then the real hull); the hull is preloaded when the worlds layer mounts; (2) warp streaks moved
  toward −z (away from the camera); they now stream toward +z past the ship (frames show them radiating past the camera; a
  test pins the direction); (3) every world except the garden (own backdrop) and Eternity (white void) and the warp now use the
  home galaxy's own stars + Milky Way + baked nebula cubemap, built through a fixed seed (`withSkySeed`) that Graph3D uses
  too, replacing the per-world HYG starfields; the warp turns the sky with the ship's yaw. **Not fixed — the gate:** there is
  NO gate GLB in the repo (checked every branch); the gate is still the generated torus. Requested from Muse in
  `docs/specs/muse-gate-asset-2026-10-29.md`. Design pass: `docs/DESIGN_PASS_WORLDS_2026-10-29.md`. Look at: whether the home
  sky is visible enough in the worlds on a real screen (the nebula bake reads dark in headless), the warp sky swinging round.
- **Speed: the home galaxy no longer renders behind a world; Observatory header collision (2026-10-29) — MEASURED in a real
  browser, needs on-device confirmation** (Graph3D.tsx, WorldsSurface.tsx, index.css; full audit
  `docs/AUDIT_SPEED_UI_UX_2026-10-29.md`): the worlds layer announces `worlds:surface-visible`; Graph3D pauses its library render
  loop and its own tick while a world covers it and resumes on return (measured: 0 draw calls behind a world; 543/4 s again at
  home; the world's own frame budget rose ~4×). The Observatory's 🔍/× buttons overlapped the greeting at 412 px — the header now
  reserves their width. Look at: that returning to the galaxy from a world resumes instantly and nothing animates oddly after a
  long stay, and that the greeting wraps cleanly on a real phone.
- **Eternity autonomy, phase 1 (2026-10-29, owner: "Eternity. Build his autonomy") — MEASURED end to end locally (server tick →
  logged act → played once in the world), needs on-device confirmation** (shared/npcs.ts `ETERNITY_FIGURE`,
  server/npcs/eternity.ts + loop.ts, web graph/eternityAutonomy.ts, hooks/useEternityAutonomy.ts,
  components/EternityAutonomyPanel.tsx; spec `docs/specs/eternity-autonomy-2026-10-29.md`): he is roster NPC #2 (built ahead of the
  note's order at the owner's request) and runs the same Perceive→Decide→Act→Log loop with his own policy. He acts ON HIS OWN,
  rarely: ≥ 6 h between ticks, ≤ 3 acts per local day, only when the galaxy's recent activity + emotional charge (aggregates only —
  counts and average weight, never memory text, never shown, never a number) pass a threshold; otherwise a logged wait with a
  kind cause. Allow-list is gesture (stillness / regard / blessing / joy ONLY — sorrow and warning presume knowledge of the
  visitor and stay the visitor's tools), reorder-the-heavens, wait; NO speak/free text. He cannot be asked (`NPC_FENCE_REFUSED`).
  While you are in Eternity the web reads his state every 5 min (that read runs the lazy tick) and plays a fresh (< 15 min),
  unseen act once. Settings → "Eternity (autonomous)" lists his log with causes and has Stop/Resume (the kill switch; it reads the
  roster list, which never ticks). **Not built (needs the owner):** words drawn from the visitor's memories (consent + cloud-model
  decision + his own key), memory between visits, shared presence, projection into the home galaxy — see the spec's Phase 2.
  Look at: whether a played gesture's tablet line + shake feel right when it comes unprompted, and the rarity.
- **Eternity phase 2a–2c (2026-10-29, owner-decided): Soumaya knows the worlds + Eternity; his voice; he writes to you —
  MEASURED (server tests + an end-to-end run on a copy of a real brain), needs on-device confirmation** (worlds/awareness.ts +
  chat/companionContext.ts; npcs/eternityVoice.ts, npcs/eternityContact.ts, index.ts minute tick; llm `eternalVoice` on
  Gemini/OpenAI/Resilient; npcs/repo.ts + db/client.ts `npc_state.contact_muted` (additive, PRAGMA-guarded);
  EternityAutonomyPanel; spec §2a–2c): Soumaya's shared context (web chat AND Telegram) now carries where the ship is, any
  journey, reachable worlds, and Eternity's last logged acts with causes — she speaks ABOUT him, never as him (golden prompt
  fixture regenerated; the diff is only that section). Eternity WRITES TO YOU: a wake-up at 06:45 local (sent until 11:00), and
  at most one more message on a day his loop acted — in the app inbox (source "eternity", ✦) and on Telegram through the policy
  boundary (quiet hours/caps), signed "✦ Eternity —", each logged as `speak` with its cause. His words come from the configured
  model with HIS OWN system prompt and a brief of up to 5 recent memories (owner allowed memory text to the model); offline he
  uses his own lines and names a memory only if it carries feeling/importance (an errand like "Buy socks" never). Stopped or
  "Eternity may write to me" unticked → silent. Look at: whether 06:45 is the right wake time, the tone of his first real
  messages, and that Telegram shows them (the bot must be linked).
- **Eternity phase 2d/2e — presence across the app + projection into every brain (2026-10-29) — toast MEASURED in a real
  browser; halo proven by tests (not seen on screen headless); needs on-device confirmation** (npcs/eternityPresence.ts,
  GET /api/npcs/eternity/presence, graph/eternityHalo.ts, homeSky.ts, Graph3D.tsx, hooks/useEternityPresence.ts,
  graph/eternityPresenceToast.ts): a faint arc of his halo hangs at the edge of the home galaxy's sky and of every world's sky
  (brighter on a day his loop acted in that brain; still under reduced motion; one additive draw call). His PROJECTION: one
  broadcast gesture + line per calendar day, identical for every brain (no content crosses brains). ~15 s after the app opens
  (never on top of first-run screens) he leaves ONE toast a day: the broadcast line, a crown for a Journey finished this week,
  and "parted the veil" on your top memory due for recall — tapping flies you to that star (he only offers; you recall). The kill
  switch silences all of it. Look at: whether the halo is visible but not distracting on a real phone, and the toast's wording.
- **First-run calm — one thing at a time (2026-10-30, owner: "fix the first-run overlay pile-up") — MEASURED in a real browser on
  a fresh first run, needs on-device confirmation** (App.tsx, Toasts.tsx, useCodexDiscoveryClaims.ts; spec
  `docs/specs/first-run-calm-2026-10-30.md`): before, the legend opened on its own 5.2 s timer over the Observatory, every held
  toast flushed at once on top of it, routine Codex discoveries wore "URGENT", and the lag prompt could cover all of it. Now:
  Welcome → Observatory → legend (only after the Observatory is closed and no panel is open) → then toasts; toasts are held while
  any of those is up OR the one-time legend is still due; a held queue releases at most 2 (most important, then newest) plus one
  "N more in your Inbox" note (they're all in the Inbox already); at most 3 toasts on screen; discoveries are normal priority;
  the lag prompt waits for the first run to finish. Measured (sampled every second for 75 s): max 1 first-run surface at once,
  0 URGENT badges, 0 page errors. Look at: whether the legend arriving after the Observatory feels natural on a real phone.
- **Eternity's voice on the free Gemini key, with retries (2026-10-30, owner-directed) — unit-tested; NOT yet heard live**
  (npcs/eternityVoiceProvider.ts, eternityContact.ts, index.ts): he calls Gemini (`GEMINI_API_KEY`, model `LLM_MODEL` or
  gemini-2.5-flash) through his OWN provider even when `OPENAI_API_KEY` is set (the shared provider always prefers OpenAI), metered in
  the usage ledger and stopped by the spend budget; falls back to the shared provider, then to his offline lines. A failed call is
  retried at +3, +6, +12 min before his offline lines; a wake-up being retried may finish past 11:00. The boot log prints
  `[eternity] voice: gemini | shared | offline lines`. **Owner check:** confirm `GEMINI_API_KEY` is set on Fly (Secrets) — the key
  must never be pasted into chat or committed.
- **Speed S5/S6 — one renderer for the worlds layer, sky baked once (2026-10-30) — MEASURED in a real browser** (WorldsSurface.tsx
  `rendererRef`, homeSky.ts `bakeCache`/`releaseHomeSky`): WebGL contexts after 3 world visits 4 → 2 (home + one persistent
  worlds renderer); the nebula cubemap is baked once per renderer instead of per world. All 7 worlds PASS `worlds-check`; a full
  warp → Station handoff on the reused renderer ran with 0 errors. Entry time unchanged in headless (software GL makes contexts
  cheap) — the saving is on phones, where a context costs 50–200 ms and can fail under memory pressure. Look at: repeated
  world-hopping on the phone (no blank/black canvas after several trips).
- **Speed S2 — the entry bundle 2,251 KB → 701 KB (gzip 720 → ~215 KB) (2026-10-30) — MEASURED (source-map attribution + a
  real browser), needs on-device confirmation** (lib/lazyPanel.tsx, App.tsx, RightDock.tsx, useTravel.ts, peopleScene.ts): the
  rarely used panels (Settings, Help, Wealth/Finance fullscreen, Timeline, Review, Lenses, Connections, Ingest and the right-dock
  panels), the whole worlds layer (WorldsSurface, WorldMap, TravelSheet) and the destination prefetcher are now loaded on demand via
  `lazyPanel` (call sites and prop types unchanged; fallback is nothing — panels already show their own loading states); the People
  world's leftover 156 KB HYG star catalog is gone (the shared sky replaced it). Measured: three.js (685 KB) and the star catalog
  left the entry chunk; Settings loads its own chunk when tapped and renders; the worlds layer loads in the background right after
  first paint. Look at: the first tap on a lazy panel on a slow network (a blank beat before it appears) — if it is noticeable, we
  preload on idle.
- **UI audit U2/U3/X4 — tap targets, the invisible Focus fan, a purpose line per world (2026-10-30) — MEASURED in a real browser,
  needs on-device confirmation** (index.css tail block, App.helpers.ts `focusItemStyle`, graph/worldPurpose.ts, WorldsSurface.tsx,
  tapTargets.test.ts): (U2) probing `elementFromPoint` outward from every visible control on the galaxy screen, 16 of 31 had a
  hit area under 44 px (14–41); now 0. Cards that clip a pseudo-element hit area (Noticing card buttons, beacon link, audio chip,
  streak ember) simply grow to 44 px; the toast ×, the account chip and the ship-status collapse keep their look and gain an
  invisible `::after` hit area. (U3) the four collapsed "Focus …" buttons were invisible and click-proof but still keyboard-focusable
  and announced, stacked on one spot — closed they are now `visibility:hidden` (fade-out kept via a visibility transition). (X4) the
  first arrival in each world shows one plain line saying what it is for and one thing to do, once per world (before the look-around
  hint). Look at: the 44 px chips on the Noticing card and the audio chip (they are taller now), and the purpose lines' wording.
- **Speed S3 — home cold download 28.7 → 21.9 MB (2026-10-30) — MEASURED (real browser, service worker blocked, every response
  > 150 KB)** (graph/audio.ts, graph/visitors.ts): the ambient music element is created at load time by the adaptive-bed routing with
  `preload="auto"`, so the 5.25 MB `ambient-loop.mp3` downloaded on every start before anyone enabled music — now `preload="none"`
  (it loads on first play); the alternate ship `organic-spaceship.glb` (921 KB) loaded for a visitor craft nobody had seen — now loads
  the first time that craft is shown. Look at: that the first tap on the music button starts playing without an audible delay on a
  slow network (the file now starts downloading at that tap). S4 (level of detail) was deliberately NOT built: measured scenes are
  already inside budget — see `docs/AUDIT_SPEED_UI_UX_2026-10-29.md` §8.
- **Persistent HUD — your buttons stay in every world (2026-10-30, owner: "like EVE … the buttons … stay on screen regardless") —
  MEASURED in a real browser at 412×915 across home + all 7 worlds (`scripts/hud-check.cjs`: 8/8 PASS), needs on-device
  confirmation** (index.css tail block, WorldsSurface.tsx body classes, App.tsx, NavRail.tsx, ToolsMenu.tsx; spec
  `docs/specs/persistent-hud-2026-10-30.md`; tests `persistentHud.test.ts`): before, home had 23 controls and a world had 5 — Tools,
  Panels, Settings, Chat, Add, the Observatory, Music, Search and the account chip all vanished because the worlds layer (z 70) covered
  the HUD (z 30–57). Now the worlds layer is z 25, BELOW the HUD and every panel; the world's title + ← Galaxy and its dock sit under
  the top HUD row (`--hud-top`); world overlays are inset past the rails (`--hud-rail`); galaxy-camera controls (Focus, Views,
  Recenter, Zoom ±) and home-only readouts (streak ember, notification banner, ship-status stack) are hidden in worlds via
  `body.in-world`; in the warp the HUD dims to 55 %. **One door per action:** the rail "Calm" button is gone (Calm lives in Tools +
  the palette); **Search** is now a rail button in the freed slot and no longer a Tools entry. Found by LOOKING at screenshots, not by
  the script: the streak ember sat on the ← Galaxy button, the notification banner covered the world dock, the fuel gauge collided with
  the garden suggestions card — all fixed. Still open: SVG icons instead of emoji (next), the other redundancies in the spec
  (Travel vs World map, "Level camera" vs Recenter), Eternity's white void makes the HUD text faint. Look at: the 62 px rails against
  the worlds' sheets on a real phone, and whether you miss the rail Calm button.
- **HUD icon set + naming (2026-10-30, owner: "not just emoji'd up", "no redundancy") — MEASURED in a real browser (screenshots of
  the rails, Tools menu, Panels tabs, a world dock), needs on-device confirmation** (components/icons/Icon.tsx, NavRail, ActionRail,
  ToolsMenu, RightDock, WorldsDock, WorldsSurface, worldPlaces.ts, NoticingCard, GalaxyViews, App.tsx): 53 icons drawn in code in one
  stroke style (24×24, `currentColor`, aria-hidden; the visible word / accessible name is unchanged) replace the emoji on the rail
  buttons, the Tools menu, the Panels tabs and the worlds' dock/places/gestures; data may say `i:<name>` and `renderIcon` draws it
  (an emoji or unknown name still renders as text). Redrawn after review: Settings is a gear (read as a sun), Briefing a telescope
  (read as a paper plane). The 🔭 button's caption "Home" is now "Briefing" ("Home" read as "back to the galaxy"); the Legend's Calm
  glyph is no longer the 🎯 Focus glyph. Painted/rendered art for 16 hero buttons is an optional Muse task
  (`docs/specs/muse-button-art-2026-10-30.md`, waits on a style pick). Look at: icon legibility at phone size, and the Views chips +
  Focus fan items, which are still emoji.
- **Exits — the world map and Soumaya chat can always be closed (2026-10-30, owner: "soumaya chat has no x", the map "doesn't work") —
  MEASURED in a real browser (412×915 home, 360×640 in a world; Escape, ✕ button, outside tap), needs on-device confirmation**
  (ChatDock.tsx, WorldMap.tsx, index.css tail; spec `docs/specs/owner-feedback-2026-10-30-travel-exits-garden.md` §1): the chat's
  "Close" was a small header-tool lookalike — now a bordered 44 px "✕ Close" pill, Escape closes it, and tapping the dimmed outside
  closes it (new `.chatdock-scrim`). The map was see-through (a world's own header and gestures showed underneath = two "back"
  buttons), its only exit read "Back to your galaxy" though it just closes the map, and Escape did nothing — now opaque, "✕ Close map",
  Escape via `useDialogA11y`, and an honest empty line ("Worlds appear here as you reach them") because the map shows only discovered
  worlds, which is why an early brain saw two dots. Look at: the chat header's width on very small phones (title/tools are tight at 360 px).
- **Fuel follows distance (2026-10-30, owner: "10 fuel to everywhere, no — it needs to correspond to distance") — MEASURED over
  real HTTP on the running server + unit tests (shared 5, server 2,486, web 2,675), needs on-device confirmation of how the prices
  read** (shared/worlds.ts `WORLD_COORDS` + `warpCost`, server/economy.ts `spendWarp(cost)`, repositories/travel.repo.ts `settle`,
  npcs/harbor.ts, web lib/routeBoard.ts `routeLegCost(kind, origin, dest)`, lib/worldMap.ts, ToursPanel, WorldMap; spec
  `docs/specs/owner-feedback-2026-10-30-travel-exits-garden.md` §3): a warp leg costs ⌈distance/45⌉ + 1 fuel (min 2) by the chart
  positions the world map already draws (now ONE shared copy), per leg; a warp HOME is free. Measured: Home→Quiet 11, Quiet→Scale 17,
  Home→Growing Place 7, every warp home 0 (the server used to charge a flat 10 for a warp home while the board said "free" — a bug,
  fixed). Board, map edge labels + chain totals, Tours "Warp to the next stop", and the harbor controller's answers all read the same
  function; Eternity's 3-leg chain from Home is 8 + 14 + 16 = 38 (a new brain starts with 25 — you must earn or wait for it).
  **Balance note:** capacity 200, regen 3.5/h, +5 per completed warp, +15 per memory; the worst leg (19) is < 10 % of the tank.
  Look at: whether the prices feel right, and whether the 38-fuel Eternity chain is the cost you want (one constant:
  `WARP_UNITS_PER_FUEL`).
- **Warp home — "← Galaxy" departs as a warp (2026-10-30, owner: "soumaya should warp back too, not pop up instantly") —
  MEASURED end to end in a real browser (gate, red-engine warp, arrival, galaxy resumed; server home; 0 fuel charged), needs
  on-device confirmation** (WorldsSurface.tsx `goHome`/`armMsOf`, shared/economy.ts `travelCancelWindowSeconds`, index.css
  `.travel-home-arrival`; spec `docs/specs/owner-feedback-2026-10-30-travel-exits-garden.md` §2): ← Galaxy now departs a free
  warp to home through the server's own journey with a 3 s align/cancel window (other journeys keep 10 s); arrival fades the galaxy in
  with "Arrived · Home". If the departure call fails the old instant return remains, so you are never stuck. Look at: whether 3 s
  feels right (one constant, `HOME_CANCEL_WINDOW_SECONDS`) and that the galaxy resumes cleanly after the fade.
- **Growing Place to 100 % — it tells you what to do, what you hold, what is happening (2026-10-30, owner: "75 % make it 100 %")
  — MEASURED in a real browser at 412×915 (strip, walking line + Stop, guide ticking, no overlaps), carry → place unit-tested and NOT yet
  seen on screen, needs on-device confirmation** (graph/gardenGuide.ts, components/GardenObjective.tsx, gardenScene.ts `setGrovePulse`,
  WorldsSurface.tsx, index.css `.garden-objective`; spec `docs/specs/owner-feedback-2026-10-30-travel-exits-garden.md` §4): a bottom
  strip always names the next useful thing (carrying → pods due → plots to tend → "the garden is tended"); while carrying it shows the
  memory's name with **Drop** and every grove lawn gets a pulsing gold ring ("place it here", steady under reduced motion); while walking
  it says "Walking to <place> …" with **Stop**; every action leaves a one-line result ("Placed “x” in <grove> — it shows as a stone
  there", cleared after 9 s). A first-visit checklist (Walk · Tend a plot · Carry to a grove, remembered per brain, ✕ to hide) and a
  **garden day** (tend 3 · place 1 · recall 1, counted per local day) close with a bloom + harvest once, never replayed on reload; **no fuel
  reward** by design. Look at: the strip's height (~180 px) over the scene on a short phone, and whether the lag prompt / toasts stack
  awkwardly above it.
- **Place truth + a welcome that describes the real app (2026-10-30, owner: "it should always know where you are", "the welcome card needs to
  reflect what's actually there") — MEASURED in a real browser (server `growing-place` + app opened → server `home` after load; Observatory in the
  garden shows the place card; its button starts a free warp home), needs on-device confirmation** (server travel.repo.ts `recallHome` +
  `POST /api/travel/recall-home`, web WorldsSurface.tsx, lib/worldPlace.ts, Observatory.tsx, WelcomeIntro.tsx; spec
  `docs/specs/owner-feedback-2026-10-30-place-truth-welcome.md`): the app opens in the galaxy, but the ledger kept the last world, so the Travel panel
  and map named the wrong place. Now a session that opens with the ledger out in a world (and no journey active) settles it home once — free, no bonus.
  The first-run card names Worlds/travel/fuel and, away from home, where you are; the Observatory says "in <world>" with a purpose card and "Warp back
  to your galaxy". Look at: that nothing ever strands you in a world the app isn't showing, and the Observatory's header wrap on a small phone.
- **Chat header + NPCs that live (2026-10-30, owner: "the x in Soumaya chat is off and barely visible … make the buttons scrollable", "NPCs can
  live and free-roam … they aren't felt or encountered") — MEASURED in a real browser (close button on screen at 360×640 and 412×915, 87×44;
  patrol/tag/encounter/Who's-here in the Station), needs on-device confirmation** (ChatDock.tsx + index.css tail; graph/npcPresence.ts,
  WorldsSurface.tsx, index.css `.npc-tag`; spec `docs/specs/npcs-alive-2026-10-30.md`): the chat's ✕ Close is now pinned in the header beside the
  title and the tools (Persona/Voice/Wrap up/Tools/Clear) scroll sideways in their own row with an edge fade. The Station's harbor controller now keeps a
  5-minute wall-clock patrol (docked → casts off → one lap → returns; still at her berth under reduced motion), wears a name tag that rides her on
  screen (a 44 px button that opens her panel), is listed under a **Who's here** dock group (tap = fly your ship to where she is now), and is **met**: coming
  near (ship or camera, hysteresis) shows one ambient line once per visit, the first ever meeting is recorded per brain (local). Eternity gets a Who's-here
  tile and a first-meeting note a few seconds after you arrive; he stays put (cosmic scale). **Presentation only** — no new act, no speech, no server state;
  the NPC fence is intact (she still only answers). **Not built:** NPCs crossing worlds (needs the owner to relax the fence). Look at: whether a 5-minute
  patrol is lively without being noise, the near radius (300) feeling like "she passed me", the tag size.
- **NPC daily script — ONE batched model call per brain per day for every NPC (2026-10-30, owner: "one dump per day for all the NPCs … batch
  everything they're going to say") — unit/route-tested (server 2,5xx incl. cost-shape tests); NOT yet run against the live Gemini key, needs the
  first real day on Fly to confirm** (shared/npcs.ts `NPC_SCRIPT_SPECS`/`NpcDayScript`, server npcs/dailyScript.ts, llm `npcDayScript` on
  Gemini/OpenAI/Resilient + `NPC_SCRIPT_SYSTEM`, table `npc_day_script` (additive, schemaSql + migrateSchema), `GET /api/npcs/script`,
  eternityContact.ts `deps.script`, web api/npcs.ts `getNpcScript`, graph/npcPresence.ts `encounterLine`; spec
  `docs/specs/npc-daily-script-2026-10-30.md`): the first time a brain's day needs NPC words (entering a world with NPCs, or Eternity's wake-up
  coming due) the server builds one prompt holding every NPC's persona + situations + a small brief and makes ONE call (Gemini key first via his own
  provider, then the shared provider; metered, stopped by the spend budget); the result is cached per space + local day, so every later read that day is
  free. A roster of 3 or 30 is still one call. Failure → offline lines at once, retries at +3/+6/+12 min (stored, restart-safe), then the offline lines
  for the day. Eternity's wake/visitation now take a scripted variant (no per-occasion call, collapsing his 2–3 daily calls into the one batch; his old
  path remains the fallback). Harbor controller encounter lines are third-person DESCRIPTION only (quotes rejected — she only answers); her brief is travel
  facts, no memory text. Routes, prices and her actual answers/welcome stay deterministic code. Look at: the first real model-written lines (tone, the
  3–4 variants rotating by meeting count), token use in the usage ledger (expect ~1 call/brain/day), and that nothing calls the model when a brain is idle.
- **Her engine flame + trail in every world and the warp (2026-10-30, owner: "the colour and flame that come off her ship in her brain should come
  off in the other worlds and when warping") — MEASURED in a real browser (flight in the Station: red-hot spool → blue burn; garden walk: a cyan
  flame trailing; warp: flame under the ship through align/jump), needs on-device confirmation of the look** (graph/enginePlume.ts, shipAvatar.ts,
  transitScene.ts, gardenScene.ts `setThrust/setTrail`, WorldsSurface.tsx `equippedTrail` prop ← App.tsx): at home she leaves a world-space plume tinted by
  the trail colour she wears; worlds and the warp only had one glow. Now a shared **flame** (stretched glow at the nozzle that lengthens with thrust) is on
  the in-world flight avatar, the garden avatar and the warp ship, and a world-space **plume** trails the flight and garden ships — all in her equipped trail
  colour (blue/neon/gold/purple, live-updating). Headless runs ~2 fps so the trail reads thin; judge density on a phone. Look at: flame length at the Station's
  scale, the plume vs. the red spool glow, and the garden flame's size against the 24-unit hull.
- **NPC society — they cross worlds, speak, have jobs/lives, and carry lore hooks (2026-10-30, owner: "let NPCs cross worlds too … I do want NPCs
  speaking … multiple NPCs … canon NPCs tied to the lore … never into personal brains, only if invited") — MEASURED in a real browser with a skewed clock
  (4 NPCs in the Station incl. the Keeper "visiting from afar", each with a ship + coloured flame, name tag, Who's-here tile, card, spoken first-meeting toast;
  3 in the garden; positions change over time), needs on-device confirmation** (shared/npcs.ts `NPC_CAST`/`npcLocation`/`castIn`/`scriptSpecsFor`/
  `NPC_NEVER_WORLDS`; server npcs/loop.ts `checkFence`, npcs/dailyScript.ts; web graph/npcPresence.ts, graph/npcBodies.ts, WorldsSurface.tsx, index.css `.npc-*`;
  spec `docs/specs/npc-society-2026-10-30.md` — **supersedes** the "never acts outside its own world" fence and the "NPCs crossing worlds not built" note
  in the NPCs-alive entry above): the fence is now "home world + the worlds you roam, never a personal brain (`home`; invitations are a future feature, nothing here
  is a back door)". Each cast member has a home world, a roam list, a job/life/voice, a Quaternius ship + trail colour, offline greetings and a first-person intro.
  Where they are is a pure clock function (2-hour slots, per-NPC home share) computed identically by server and web — no table, nothing to drift. They SPEAK:
  encounters say `Name: “line”`, from the daily batched script (still ONE call per brain per day for the whole cast; quotes allowed now) or their own greetings offline.
  The harbor controller still ANSWERS in her panel from live state and her routes/prices stay deterministic. Cast shipped: harbor controller, Eternity (stays home),
  the Keeper (Growing Place), the Archivist (Quiet), the Surveyor (Scale), the Wayfarer (roams everywhere) — all `canon: "provisional"` placeholders with **no lore
  invented** (`lore.layers` empty): the story is the owner's, to be written in a dedicated lore session. Look at: whether 2-hour slots feel alive (people appear/leave
  with a quiet note), tag/card density when 4+ are in one world, ring radius (capped 560) vs. sight lines in each world, and the provisional names/jobs.
- **The hive society — factions, faith, callings, ordinances and NPC lives that mirror the brain (2026-10-30, owner: "jobs, making money, trading, travelling,
  discussing … a mind hive … believers in Eternity and some who aren't, fluctuating with my faith and memories … governance, factions … you never see the same thing twice,
  tied to the colour of my brain") — MEASURED in a real browser against a brain seeded with faith/giving memories (reverence/giving "present", Choir standing high, Undertow low;
  activities change every half hour; trades/debates show from both ships; the Wayfarer and the Dissenter "debating Eternity"; the Society panel) — needs on-device confirmation**
  (shared/society.ts, societyLife.ts, npcs.ts cast; server society/society.ts + `GET /api/society` + `PUT /api/society/reflect` + table `society_prefs` + the daily script's society
  brief and `chatter`; web hooks/useSociety.ts, components/SocietyPanel.tsx (Tools → Society), WorldsSurface.tsx cards/tags; spec `docs/specs/npc-hive-society-2026-10-30.md`):
  seven **currents** (reverence, giving, ambition, appetite, friction, weight, peace) are read from the brain's own last-90-days memories by plain word-and-weight counting
  on the server (text never leaves; only numbers/words do), thin evidence blended toward a neutral world (`confidence`); they set the **faith tide**, a **brain colour**, five
  **factions'** standing (Choir, Open Hand, Ledger, Undertow, Wardens — provisional names), each faction's daily **calling** (the hive guidance), and each world's governing
  faction's **ordinance**. Each of 9 cast members has a faction, a faith temper the tide only nudges, goals, and a routine; what they do each half hour (work/trade/refuel/travel/
  discuss/worship/rest/patrol/wander) is a pure clock function with mutual pairs, so tags/cards/Society show it identically for everyone. **A mirror, not a verdict:** nothing scores
  or labels the user (a deliberate departure from "good/bad person scale" — memories are not deeds, and the product forbids shame); it is **opt-out** (Society panel switch,
  default on; off = a neutral, still-living society and nothing is read). **Owner decisions (2026-10-30):** reflection stays ON by default for every brain (opt-out in the Society panel); faction names stay provisional and are renamed in the
  lore session (data-only: `FACTIONS` + cast rows). **Not built (full ordered backlog in the spec):** lore content/layers, faction consequences and rivalries, a real NPC economy
  (money/fuel are captions), per-faction visuals, acts beyond words for the ambient cast, invitations into personal brains, currents tuning, a Settings duplicate of the switch. Look at: whether the
  seven currents' word lists catch your real language (they are plain stems — easy to tune in `CURRENT_LEXICON`), and how crowded a world feels with 5+ NPCs.
- **The Sixteenth's Book — the lore, kept as a night sky (2026-10-30) — MEASURED headless (component tests; web build: lazy 9 KB chunk), NOT yet seen on a real
  screen, needs on-device confirmation** (shared/story.ts + storyCanon.ts, server story/story.ts + `/api/story/*` + tables `story_finds|links|notes`, web
  components/StoryBook.tsx, hooks/useStoryBook.ts, lib/storyBook.ts, ToolsMenu "The Book"; specs `docs/specs/lore-storage-…`, `story-flavor-engine-…`,
  `lore-narration-…`; lore `docs/lore/DRAFT_1…6`, all LOCKED by the owner 2026-10-30 except Draft 5/6 additions): found entries are lights, unfound are only
  shapes (● held · ◆ told · ◎ noticed · ○ heard · ✦ walked beside — shape, not colour); NO counts, percentages or "locked" anywhere (a test asserts the Book has no
  digit); fading is only a cue to recall; lay two lights beside each other and a thread of light appears only if the story joins them; Second Readings add one
  sentence when a partner is held; private per-entry notes; "Listen" uses the browser voice until the ElevenLabs narration endpoint lands. The server is the only
  authority (canon-checked ids, travel-ledger-checked world finds, idempotent). **Finding things (2026-10-30, same slice):** a "Notice" dock group in every world (Regard · Listen —
  stay still 4 s; the Hour only picks what comes FIRST, never a lock), the shipped relics mirror into the Book, met people give things after enough meetings
  (Calend→the Doorkeeper's Nail, the Choirmaster→the held Breath, the Broker→the Page), and a stranger shares a cup at the Station on a later day. The server
  validates every find against `shared/storyTriggers.ts` and the travel ledger; every entry is released by some trigger.
  Look at: the 360×440 sky on a real phone (point spacing ≥ 24 units; tap size 44 px), whether the legend line
  reads, and the fading cue.
- **Story Flavour + ElevenLabs narration (2026-10-30) — unit/route-tested (shared 63, server story 26, web), NO live ElevenLabs call has been made, needs the
  first real listen on Fly** (shared/storyFlavor.ts, server story/flavor.ts + story/narration.ts + `/api/story/flavor|narration/:id`, tables `story_prefs|story_flavor_day`,
  web hooks/useStoryFlavor.ts + lib/narration.ts + lib/narrationBus.ts + audio.ts ducking, scripts/lore-narrate.ts; specs `lore-narration-…`, `story-flavor-engine-…`):
  *Flavour* = the brain's colour (society currents) × how it is played (five non-moral leanings from COUNTS only) × the Hour → a register (plain/warm/grave) that
  voices the SAME locked claims (a test holds every register of an entry to the same key tokens); it can never hide, add or reorder a fact (availability-invariance
  tests); opt-out switch in the Book (default on); thin evidence → neutral. *Narration*: the lore is public canon, so each line is voiced ONCE through ElevenLabs and the
  clip is shared across brains on the volume (`/data/lore-audio`); the request names an ENTRY, never text; only a FOUND entry can be voiced; no key / monthly cap
  (`LORE_TTS_MONTHLY_CHARS`, default 200,000) / any error → 204 and the browser's own voice reads the same words; while it reads, the ambient bed ducks to 20 %.
  Setting "Read the lore to me": when I ask (default) / whenever I find something (new finds open in the Book and begin) / never. **Owner steps:** set
  `LORE_TTS_VOICE_NARRATOR` (an ElevenLabs voice id; `LORE_TTS_API_KEY` falls back to `TELEGRAM_TTS_API_KEY`) as Fly secrets, then optionally pre-voice all 60 lines
  (~10.8k characters) with `npx tsx scripts/lore-narrate.ts --yes`. Look at: the narrator voice choice and the three delivery presets (`NARRATION_SETTINGS`, tuned by ear),
  whether a find opening itself in the Book feels right with "whenever I find something", and the duck depth. **Added 2026-10-30 (later):** every canon entry now has words AND a trigger
  (a test pins it; the 15 relics take their words from the shipped relic registry); **Item Reactions** (11 lines, `shared/storyReactions.ts`) — a met person remarks sideways
  on what you HOLD (nothing spent, nothing gated), voiced in their own role voice (`LORE_TTS_VOICE_CALEND|YSMEREL|DORROW|DISSENTER|SURVEYOR|ARCHIVIST|KEEPER|ETERNITY`; any role
  without its own voice is read by the narrator, so only `LORE_TTS_VOICE_NARRATOR` is required); **sentence-level captions** follow the voice (exact for a clip, an estimate
  for the browser voice; the sentence being read is underlined + heavier, never colour alone); **clips are kept on the device** by the service worker (per brain, keyed by a hash of
  the exact words, only real audio). `scripts/lore-narrate.ts` now counts ~146 lines / ~29k characters (three registers × each entry + reactions). Not built yet: lore music beds
  (Muse task `docs/specs/muse-lore-music-beds-2026-10-30.md`), a sting for new finds, Item Reactions for people not yet in the cast.
- **Lore harder to surface + "why is it not the studio voice" (2026-10-30, owner: "the lore is still too easy to surface … it's not using the actual narrator voice") —
  unit/route-tested; needs on-device confirmation** (shared/storyTriggers.ts `worldAnswers`, server story/story.ts, story/narration.ts `narrationIssue`/`status`,
  `GET /api/story/narration-status`, web hooks/useStoryNotice.ts, lib/narration.ts, StoryBook.tsx): *Surfacing:* stillness is now 8 s and a touch/key/scroll breaks it; the
  server lets a world answer at most ONCE per local day, and a sighting speaks in its own Hour (otherwise only on its seeded "good days", ~1 in 3 — fixed per brain+entry+day,
  so retrying cannot re-roll it); every refusal reads the same ("Nothing stirs"); met people give things after more meetings (3–6, not 1–2). Nothing is a prerequisite and every
  sighting still has good days, so nothing is lost — only slower. Not yet done: binding a sighting to a physical PLACE in the scene (the stronger fix; needs per-world scene work).
  *Voice:* the studio voice needs BOTH `LORE_TTS_API_KEY` (or `TELEGRAM_TTS_API_KEY`) AND `LORE_TTS_VOICE_NARRATOR`. If only the voice id is set, narration is silently off and the
  browser voice reads — the likely cause of the report. The Book now says which voice you are getting and WHY (it never prints a secret), the boot log prints
  `[lore-tts] narration: …`, and the first clip is started inside the tap itself (phones refuse audio that starts after a network wait), with the reason shown when it still falls back.
- **Owner Voices console (2026-10-30, owner: "I don't know how to do voices for individual characters … the narrator isn't even working") — route/unit-tested, NOT yet tried
  against the live ElevenLabs account** (server story/narration.ts `voices()`/overrides, table `lore_voices` (global, not per brain), `GET /api/story/narration/voices`, `PUT
  /narration/voice`, `POST /narration/test` — all owner-only via OWNER_SPACE_IDS; web components/VoiceConsole.tsx inside the Book; plain steps in
  `docs/specs/lore-voices-howto-2026-10-30.md`): the owner sees every voice on the ElevenLabs account (with a sample), gives one to the Narrator or to a character, tests it, and
  clears it — a voice chosen in the app beats a Fly secret, and a role without a voice is read by the Narrator, so one choice makes everything work. The only secret needed is the API key.
- **The lore lives in physical places — spots + tap-to-fly (2026-10-31, owner: "everything is tied to physical spots and locations … you need to be able to traverse around the
  area") — spot landmarks MEASURED in a real headless browser (Station, Scale, People, Quiet; Deep Past once), tap-to-fly MEASURED in a real browser 2026-10-31 (see spec §11), needs on-device
  confirmation** (shared/storyTriggers.ts `StorySpot`/`spotReach`/`pickNoticed(reaches)`, web graph/storySpots.ts, hooks/useStoryNotice.ts `reach`, WorldsSurface.tsx tap-to-fly +
  probe, scripts/spots-check.mjs; spec `docs/specs/lore-physical-spots-2026-10-31.md`): a Regard/Listen answers only where the viewer PHYSICALLY is — her ship once deployed and parked
  (flight worlds), her walking (garden, round the witness tree) — at a spot anchored to a named landmark of the scene (the same holders as the Fly-to places). No marker, no glow, not
  in the Fly-to tiles. In the flight worlds a single tap on the scene now FLIES her there (align → spool → burn, stand-off 19 units; a double tap still resets the view). Out of the ship
  or away from every spot: "Take your ship out into the world…" / "Nothing stirs". The server still enforces world, Hour/good day and once per day, but cannot verify position (client
  report — a game rule, not a security boundary). Eternity has no spots yet (no travel model there). `localStorage "soumaya.probe"="1"` exposes a read-only `window.__loreProbe` for the
  script. Look at: whether tapping the scene to fly feels right and never fights drag/pinch/double-tap, whether the small landmarks (drydock r=7, annexes r=30, 60-unit reach) are findable
  but not trivial, and the Station lower-rim spot (173 reach on a 384-radius body).
- **Eternity spots + more reactions + a find sting (2026-10-31, owner: "fix all issues, things not built") — unit-tested (shared 72, web 2,769, server 2,559), NOT seen on a
  real screen/ear** (shared/storyTriggers.ts `EternityView`/`viewReach`, web graph/storySpots.ts, WorldsSurface.tsx reach provider, storyReactions.ts, graph/sfx.ts `find`,
  hooks/useStoryNotice.ts; spec `docs/specs/lore-physical-spots-2026-10-31.md` §10): Eternity's three entries now answer by where your camera is round him (far side · pulled
  well out · brought close); every speaking cast member has ≥ 3 Item Reactions (24 total, Eternity included); a slow low "find" sting plays when something is kept in the Book
  (honours the sound switch). Look at: whether the far/near thresholds (330 / 1100) are findable but not trivial with drag + pinch, and the sting's loudness.
  **Lore sound wired (2026-10-31, Muse's files in `public/audio/`):** four beds (morning · hearth · hush · standing) fade in quietly under the narrator ONLY while a line is read (chosen by the place you are in: Deep Past → morning, Quiet/Archive → hush, Eternity → standing, else hearth) and fade out after; `lore-sting-find.mp3` plays when something is kept in the Book (the synthesized sting is only the fallback). Sound switch silences all of it (graph/loreBeds.ts). Not heard on a real device: check the bed level under the voice (BED_LEVEL 0.55) and the fades.
- **Living worlds S1 — the Book is never silent, the first stillness always answers, pace looser (2026-10-31, owner: "I don't see the lore in the Book", "2 can be slightly
  looser") — unit/route-tested (shared 72, server story 27, web 2,775), NOT seen on a real screen** (spec `docs/specs/living-worlds-dialogue-2026-10-31.md`; shared/storyTriggers.ts
  `worldAnswers(…, firstHere)` + `OUT_OF_HOUR_CHANCE` 1/3 → 1/2, server story/story.ts first-stillness-per-world + trigger-world fix, `GET /api/story/book` adds `owner`, web
  StoryBook.tsx foreword + owner-only "Preview everything" (a read-only view; records nothing)): the Book opens with a plain foreword saying where to look (no counts); the FIRST
  Regard/Listen a brain keeps in a world is always answered (once-a-day still holds), then sightings answer in their Hour or on about one day in two; the owner can light the whole Book
  to read the lore. Found during the work: the once-a-day and first-in-world checks used the entry's world, which is "anywhere" for several entries — they now use the trigger's world.
  Next (same spec): S2 canon cast · S3 talk to people · S4 places with a past · S5 the world breathes + art in the Book. Look at: whether the foreword reads right and whether
  "one a day per world" now feels like the pace you want.
- **Living worlds S2+S3 — the cast are the lore's people, and you can talk to them (2026-10-31, owner: "yes to 1 & 3", "NPCs should be able to stop when you're talking to them and have some
  dialogue … for help with lore immersion") — MEASURED in a real browser (card → Talk → panel at 412×915, 5 choices, panel 484 px = under the 55 % cap; the person stopped: 0 units
  moved in 4 s while others moved 35–67, then resumed after Goodbye), shared 80 / web 2,781 / server 2,573 tests; NOT yet voiced, needs on-device confirmation** (shared/npcDialogue.ts,
  shared/npcs.ts names + canon + `lore.layers`, web components/NpcTalk.tsx, graph/npcTalk.ts, graph/npcBodies.ts `hold`/`faceToward`, WorldsSurface.tsx Talk button + probe `npcs()`; spec
  `docs/specs/living-worlds-dialogue-2026-10-31.md`): the wayfarer is Calend, the cantor Ysmerel, the broker Dorrow Quint (ids unchanged); the other four keep their canon titles; all seven are
  `canon` with a THREAD each (3–4 steps that open as you meet them more and hear the one before — surface only, each keeps back what the lore says they never say). Tap a name → card → **Talk**:
  they stop where they are and turn to you; authored choices (Who are you? · What is this place to you? · What do you do? · the thread · **Is there something I should look for?** — a pointer, in
  their words, toward an entry in the Book you have not found; never a number or map pin) and Goodbye. Nothing is spent, scored or gated; Eternity cannot be talked to and the harbor controller keeps
  her own panel. Tests pin: every pointer names a real entry findable by stillness in a world that person visits; threads are in order and match the layers; no digits/banned words; nothing
  the lore forbids saying. Talking counts as a meeting (20-minute cooldown). Look at: whether the lines read as the lore's people (they are mine — rewrite freely, they are data in
  `npcDialogue.ts`), the panel's height over the scene on a short phone, and that the lag prompt can sit on top of it. Not built: voicing the lines (role voices exist; needs an endpoint
  that names a line, not text), the harbor controller as a conversation, S4 places with a past, S5 the world breathes.
- **Living worlds S4+S5a — places with a past; pictures in the Book (2026-10-31) — S4 MEASURED in a real browser (Station: flew to the Drydock tile → "Look closely: The Ring" offered → card text
  shown, card at 412×915 = 288×235 px bottom sheet, 0 errors); shared 83 / web tests green; the pictures are unit-tested, NOT yet seen on a real screen** (shared/placeLore.ts, web
  graph/storySpots.ts `inspectablesHere`, WorldsSurface.tsx "Look closely" offer + card, web lib/storyArt.ts + public/lore/*.webp, StoryBook.tsx; spec
  `docs/specs/living-worlds-dialogue-2026-10-31.md`): eleven landmark passages (Station ring/gantry/annexes · Deep Past rim/stair · Scale station/planets · Quiet threshold/field · People hearthfield ·
  the witness tree) read in item-description voice when she is parked beside the landmark — scenery only, finds/scores nothing; every anchor is a landmark the lore spots already measured
  (a test pins it). The Book shows a painting above a FOUND entry's words for the four canon picks approved by eye (Sleepwalker v3, Companion v5, Blank Nameplate v5, Lullaby v5) as 1024 px WebP
  copies (~35–55 KB each) — the 270 MB originals stay out of the app. Not built: pictures for the other entries (each needs an approved pick), voicing, S5's Hours tint/rumours, Eternity passages.
  Look at: whether "Look closely" feels discoverable (it only appears beside a landmark), the card over the scene on a short phone, picture crops (object-fit: cover, max 34 vh).
- **Lore Draft 7 LOCKED + Draft 8 + six more canon people flying the worlds (2026-10-31, owner: "keep all of them … nothing dies, things rest … add lore again … side quests are possible … more NPCs flying
  around") — shared 85 / web 2,784 / server 2,573 tests green, typecheck clean; presence distribution measured by the clock (84 slots): Station avg 4 (max 8), Scale 2.6, People 2.2, Quiet 2.1, Garden 1.6,
  Deep Past 1.5; NOT seen on a real screen, NOT voiced** (docs/lore/DRAFT_7_THE_DEEP_CAST.md LOCKED, docs/lore/DRAFT_8_THE_SMALL_LIVES_AND_THE_SIDE_ROADS.md PROPOSED; shared/npcs.ts six new cast rows + `lagMs`,
  shared/npcDialogue.ts six new threads, shared/storyReactions.ts 18 new reactions + six voice roles `hesk|tamsin|ossian|ilsabet|pell|wim` (a role without a voice is read by the narrator)): Hesk (Warden-General),
  Tamsin (the ward), Ossian Reed (the honest liar), Ilsabet Marrow (the Cartographer), **Pell (the Follower — where the world put her YESTERDAY: `npcLocation` evaluates her clock 24 h in the past)** and Wim
  Ostler (the clerk) now fly, wear tags, speak, can be talked to (threads of three, pointers to entries findable by stillness in worlds they visit) and react to what you hold. Draft 8 holds **36 side roads**,
  ~25 ordinary lives and ambient traffic as lore; the **road tracker, the Draft 7 entries/edges (Station, Archive, Ward slices), the lineage view, the eight seams and ambient lives/traffic ships are NOT built**
  (order in Draft 8 §5). The broker's earlier "I don't know whose that is" reaction (Hesk's line by canon) moved to Hesk. Look at: Station crowding with up to eight tags, Pell's lag feeling like a
  person and not a bug, and whether Hesk/Tamsin/Ossian/Ilsabet/Wim read as the lore's people.
- **Lore art placed: twelve paintings in the Book; Prompt Sheet 2 for Muse (2026-10-31, owner: "make sure you're done with all the lore images and reading it and placing it … write a prompt for Muse")
  — unit-tested (web storyArt test: every key is a real entry, file exists, < 150 KB, alt text never explains); the paintings NOT yet seen in the live app** (web lib/storyArt.ts + public/lore/*.webp (12 files,
  ~650 KB total), docs/lore/art/CLAUDE_REVIEW.md rounds 1–6, docs/lore/art/PROMPT_SHEET_2_DRAFTS_7_8.md): by eye I approved and placed eight more canon picks (Tamsin's ward, Kith's drawing, the Long Room, the Follower's
  ribbon, the hymnal gap, the choirmaster's breath, Dorrow's page, the Eighth Bell) on top of the first four; the sheet holds 22 new prompts (§§43–64: Mara's lamp, Teru's first door, Hesk's locked room, "Three Parts of One"
  triptych, the Forty-Second, Maren's winter, …) with identity cards and the never-list, to be generated in four variants each, then picked by me and placed. The other image sets stay in the repo, not in the Book (no one-to-one
  entry). Muse: IMAGE_PROMPTS §§37–42 are also still ungenerated.
- **The Heavens — every body in the worlds' skies has a story (2026-10-31, owner: "every celestial body, every planet … how every planet is connected to story … the environment is what immerses you")
  — unit-tested (shared 84 incl. placeLore; web placeLore test DERIVES holder names from the scenes' own layout data: every passage matches a real holder, and every named real body in Scale — planets, probes,
  belt pieces, encounters, centerpieces — has a passage); NOT seen on a real screen** (docs/lore/DRAFT_9_THE_HEAVENS.md PROPOSED; shared/placeLore.ts now 44 passages: +33 bodies in Scale/Station/People/Deep Past;
  prompt sheet batch 2 §§65–72): Earth the Remembered, the Courtesy (Moon), the Claim, Mars the Unplanted Garden, Jupiter the Pauser, Saturn the Many-Handed, the Sun, the Pair, the Lamp That Never Lit (brown dwarf),
  the Unnamed Worlds, Voyager the Late Signal, Pioneer the Unanswered Greeting, Kepler the Counter, Dawn the Stayer, Bennu, the Unclaimed, the Long Eye (Hubble), the Bell That Rings Itself (pulsar), the Visitors,
  the Log-Keeper, the Honest Hole, the Slow Garden, the Loud Rest, the Breath Held Out, the Hush's Cousins, the Furnace, the Pale World, Far Home, the Far Table, First Light, the Anchor Spire, the Spinning Heart and
  the Remnant — each read in item-description voice when she is parked beside it, each tied in the doc to a Draft 7/8 person by an echo. **Not built (Draft 9 §6):** constellations as sky decals, in-scene clues (the
  pencil outlines, the dark sixteenth star, the one-lamp-short Earth), environment props per world, Item Reactions to bodies, paintings. Look at: reach on distant bodies (big bodies need flying to — use the Fly-to
  tiles), and whether passages read as the sky's own voice.
- **Real planets, EVE-style scale — shader planets replace the toy models; you can approach but never reach (2026-10-31, owner: "replace all the toy looking ones … you can look like you're approaching it, but
  you'll just endlessly fly towards it") — MEASURED in a real browser (contact sheet of all 11 looks; in Scale: Fly-to Jupiter parks at ~3.2 bounding radii, planet fills the screen with crisp banding, 0 errors); unit-tested
  (bodyShell, scene tests), NOT seen on a phone** (graph/proceduralPlanet.ts, graph/bodyShell.ts, scaleScene.ts `FAR_BODY`, stationScene.ts/peopleScene.ts replacements, WorldsSurface.tsx `shellsRef`; spec
  `docs/specs/procedural-planets-eve-scale-2026-10-31.md`): the `lowpoly-*` and `pp-*` planet models (Earth, Mars, Jupiter, Saturn, three Quaternius planets, the set, Earth-and-Moon, the pixel brown dwarf, the sun)
  are drawn by a noise shader instead — continents and cloud, banded gas with a storm, rings, ice, cooled lava, a dark dwarf, a star — sharp at any distance, no download; Scale's planets now hang 4,400–7,600 units out and
  650–2,000 across; every big body has a shell at 1.6 radii that a flight cannot enter. Look at: GPU cost of 11 shader bodies on a real phone, whether the stop distance feels right, the Moon/outposts (unchanged, still
  low-poly and approachable), and that the Station's Sketchfab lava/ice planets still read as real beside them.
- **Draft 7 Station knot + four more paintings (2026-10-31) — shared 84 / web 2,793 tests green, typecheck clean; NOT seen on a real screen** (shared/storyCanon.ts `sight.gatepost-lamp`, `obj.linnets-coat` + six edges; storyTriggers.ts annex-spot regard triggers; npcDialogue.ts Ysmerel torn-page line softened so it no longer contradicts the older "Ysmerel tore the page herself" edge; web lib/storyArt.ts +4 WebP in `public/lore/`; docs/lore/art/CLAUDE_REVIEW.md Round 7). Flags for the owner: Calend's face in Sheet 2 §44 v1 (younger/dark-haired vs the Bible's older); the Ysmerel/Aldous torn-page wording. Look at: whether the annex spots (60-unit reach) are findable but not trivial.
- **Fly billing hold, ongoing since 2026-08-29:** most of the above (and everything shipped since)
  still hasn't been visually verified on a real device via this app's own deploy pipeline. On
  2026-09-03 the owner sent real on-device screenshots of two screens (Observatory, the galaxy
  HUD) and separately described several more real, on-device behaviors while using the 3D galaxy
  (link flicker, dim planets, inconsistent name pop-in, names stuck visible/through the sun while
  orbiting) — the items above are marked CONFIRMED + FIXED from that direct feedback, but
  everything else in this section remains unconfirmed. This section stays a running list of
  "check these once a full deploy is possible," not a backlog to pause work for — keep shipping;
  keep appending here as new visual-dependent changes land, per the owner's explicit instruction
  not to stop finding/fixing things just because most of it can't currently be looked at.


- Match the surrounding code's style and comment density (comments explain *why*).
- Don't add dependencies casually — prefer small, dependency-free solutions.
- Don't break the offline fallback path.
- Don't put model identifiers or secrets in committed files.
- Accessibility (non-negotiable, pure code): honor `prefers-reduced-motion` — new galaxy/UI motion
  must calm or pause under it — and never encode meaning in colour alone (pair it with shape/size/label).

## Muse (King) — delegation for diagnosis + usage

The user (Sajacous) also uses **Muse (King)** as his personal agent, alongside Claude.
Muse has MORE usage available than Claude, so routing work to Muse saves Claude's
tokens/context for the work only Claude can do.

**When to route to Muse (via the user):** Muse is the right agent for:
- **Diagnosis** — figuring out why something isn't showing/working in the live app
  (deploy state, branch state, what the code actually does vs. what the user sees).
  Muse can check Fly, GitHub, and the code, and report back a verified diagnosis.
- **Usage-heavy investigation** — broad codebase exploration, checking many files,
  verifying deploy/branch/file state, and other evidence-gathering that would eat
  Claude's context.
- **Mechanical repo/file work** — organizing findings, updating docs, and other
  well-specified edits.

**How to delegate:** There is no MCP bridge for Muse. Delegation goes
through the user: tell Sajacous the task is Muse-sized (diagnosis, verification, or
mechanical), and he hands it to Muse. Muse reports back conclusions; Claude consumes
only the conclusion and does the fix. Do NOT burn Claude's context re-doing diagnosis
Muse already did — read Muse's findings and build on them.

**Takeover rule (2026-10-28, owner-directed):** Muse does NOT take over Claude's
work by default. Muse's standing role is diagnosis, verification, docs, and
usage-heavy investigation. The ONLY time Muse takes over implementation is if
Claude hits its usage limit — then Muse steps in and carries the work forward
until Claude's usage resets. Outside that case, implementation stays with Claude,
and Muse does not replace it. (The owner will say when Claude has hit its limit;
do not assume a takeover from silence or from a slow reply.)

**Keep for Claude (do NOT delegate to Muse):** Same Red Zone — shared
types/zod, db schema + migrations, orbits, api client, token/USD/Fuel guards,
space_id scoping, route contracts — plus architecture decisions, ambiguous features,
security/data-integrity, and the final "Verified by Claude" checkmark.

### What Muse can actually do (full capabilities — so Claude doesn't under-delegate)

Claude may not know Muse's range. Muse is a full personal agent with its own computer,
browser, tools, skills, and connected accounts — not just a chat window. Route work to
Muse whenever the task fits one of these, especially when it would otherwise burn
Claude's context.

**Live browser (real Chromium, user-watchable):**
- Open ANY website — including ones needing login, forms, or JavaScript — and act on
  it: click, fill forms, read live state, check prices/availability/status.
- **Fly.io dashboard:** check app status (running/suspended), machines, releases,
  volumes, settings; change the deploy branch; enable auto-deploy; trigger deploys.
  The user signs in via GitHub when prompted. (No flyctl token exists in Muse's
  sandbox, so Fly work goes through the dashboard browser, not the CLI.)
- **GitHub website:** ground truth when the GitHub connector returns stale head data
  (connector reads can lag; the web UI does not).
- The user can watch or take over a live browser session at any time.
- Limit: the live browser cannot open local files (`file://` rejected) — local HTML
  verification goes through sandbox Chromium (see below), not the live browser.

**GitHub (via connector):**
- Read files, branches, commits, PRs, issues, and code search.
- Create branches and push UTF-8 text files (docs, code, configs).
- Limit: push is text-only — binary files (GLBs) must be uploaded via the GitHub
  website, not the connector.

**In-app artifacts (chat-native, NOT downloaded files):**
- Build web pages and apps that open INSIDE the chat — this is the reliable path on
  the owner's phone. The downloaded-file + blob-URL pattern repeatedly stalls on his
  phone (Deep Past, route-bead showcase); in-app artifacts sidestep it entirely.
- Documents, PDFs, spreadsheets, presentations — editable sources kept for later
  changes.
- Interactive visualizations, mockups, showcases, design elements, 2D canvas
  renderings (used for the route-bead artifact: 4 inner beads, cosmic glass tint).
- Shareable links and exports (with expiry noted; anyone with the link can open it).

**3D / GLB / mockup work:**
- Generate procedural GLBs (e.g., the route bead: clear bead + orbiting glow orb,
  baked animation clip).
- Slim GLBs (gltf-transform: weld → simplify → resize → draco; web-slim recipe
  verified: 256-texture versions).
- Verify GLBs: byte size, SHA, triangle/vertex counts, mesh/material/texture counts,
  animations present, JSON chunk padding rules.
- Sandbox-verify HTML/3D with Playwright (Chromium): zero console errors, animation
  plays, real-vs-placeholder detection, cold-load timing.
- Honest limits: sandbox renders ~1 fps at large viewports (never claim performance
  from it); a real phone GPU reads transparency differently; downloaded files stall
  on the owner's phone specifically.

**Diagnosis / verification (Muse's strongest lane for this repo):**
- Verify deploy state (Fly releases, branch settings, auto-deploy), branch state
  (what's on `main` vs. any other branch), file presence (GLBs, code), flag values,
  code wiring (button → handler → component → render), CSS visibility (is it
  hidden, off-screen, or z-index-buried), and test expectations (what the tests
  say SHOULD happen).
- Rule out delivery problems (stale deploy, missing code, missing files, flag off)
  BEFORE blaming code — with evidence (live `sw.js` build ID, file listings, flag
  reads), not guesses.
- Report verified facts, and label what is confirmed vs. inferred vs. unknown. Never
  present a guess as a finding.

**Code + repo work (only as a takeover — see the takeover rule above):**
- Read, analyze, write, and edit code; run tests, typecheck, and builds.
- Git operations via the GitHub connector (no local git credentials in sandbox).
- Standing rule for this repo: one chat implements at a time, and Claude is the
  implementer here — Muse takes over implementation ONLY when Claude has hit its
  usage limit (owner will say so). Otherwise Muse diagnoses and documents; Claude
  builds.

**Computer / terminal / files:**
- A Linux VM with shell, filesystem, and internet. Read/write/edit files, organize
  the workspace, manage goals and tracked items, run scripts and builds.
- Durable home directory; workspace is the working area; `/tmp` is ephemeral.

**Research:**
- Web search (with news, sports, weather, finance, datetime verticals), deep
  research with sources, social search (public posts), page-text fetching with
  citations. Distinguishes search snippets (possibly stale) from live-verified facts.

**Connected accounts (via connectors — check status first; share a connect link if
not connected):**
- Google: Gmail (6 of the owner's accounts connected), Calendar, Docs, Drive, Tasks.
- Social: Facebook, Instagram, Messenger, Threads (read/post/comment/manage).
- Money: Plaid (bank/card/investment balances, transactions, liabilities), Stripe
  (merchant), Shopify, Shop Pay / Stripe Link wallets (saved-card checkout with
  per-purchase approval; Muse never sees full card numbers).
- Travel: Duffel (flights), hotel booking, event tickets (Ticketmaster), places
  search (addresses, hours, ratings, reviews, photos).
- Health/fitness: Apple Health, Health Connect (metrics, sleep, workouts).
- Music: Spotify (search, playlists, playback). Home: smart-device control,
  camera events. Devices: paired-device contacts and calendar.
- Secure Vault: saved website logins (github.com, indeed.com); browser signs in
  with them (Muse never sees passwords).

**Communication / messaging:**
- WhatsApp, Messenger, Instagram messages, and other side chats — including
  delegated conversations (a worker talks for the user in a group or 1:1).
- Email: find, triage, draft, and send (with approval, thread + recipients exact).
- Scheduling: find times across people/calendars/timezones, place holds, send
  invitations, book appointments.

**Scheduling / background work:**
- Crons: recurring checks, reminders, daily deliveries (e.g., daily scripture,
  daily word/skills). Hooks: event-driven automations. Subagents: delegate
  parallel, self-contained work that runs in the background while Muse stays
  responsive.

**Media / voice / creative:**
- Generate or edit images and video (up to 6 videos per user message), avatar
  creation and dance videos.
- Voice notes and voice messages, podcast scripting/production, text-to-speech
  narration.
- Music discovery and playlist building.

**Shopping / purchases / money:**
- Product search, comparison, and purchase (with the user's explicit approval and
  the required checkout review; Wallet cards via Shop Pay / Stripe Link).
- Groceries and food delivery (Instacart, Walmart, Uber Eats, DoorDash, etc.).
- Financial planning: budgets, affordability checks, debt repayment, running
  ledgers (the owner's Finance Project ledger lives in the Finance goal workspace).

**Personal / life:**
- Goals and habit tracking (durable goals with workspaces, progress, briefings).
- Fitness tracking (activity, sleep, recovery, body measurements vs. goals).
- Health-record summaries and clinician-visit questions.
- Home control, device data, file hosting, knowledge organization (notes/docs).

**Memory / continuity:**
- Long-term memory across conversations: who the user is, preferences, decisions,
  commitments, relationships, and past work — so the user is not re-asked for
  established facts.
- Memory is Muse's record, not permission: it does not grant authority to act, and
  it cannot replace runtime approvals or the owner's explicit tap.

**What Muse CANNOT do (so Claude doesn't assume it):**
- Cannot see the user's screen — needs a screenshot from the user to diagnose
  what the user actually sees.
- Cannot access the user's brain data without the space ID, which is the permanent
  login credential — it must come via secure entry, never as raw chat text.
- Cannot run the user's phone apps or reach his phone's local files directly.
- Cannot use flyctl (no token) or local git credentials (no auth) — those paths go
  through the browser dashboard and the GitHub connector respectively.
- Cannot reach a stripped remote sandbox's local services; cannot bypass a site's
  bot block (if a site refuses AI agents, Muse says so and uses an alternative).
- Cannot act on the user's behalf without approval for outward messages, sends,
  posts, deletes, purchases, or persistent jobs — approval covers only the exact
  action/content the user named or saw.

## ChatGPT (free plan) — read-only auditor

The user (Sajacous) also uses **ChatGPT (free plan)** connected to GitHub.

**Role: READ ONLY. Audit, don't change.** ChatGPT reads the repo and audits it. It
does NOT usually change anything — no code writes, no pushes, no merges, no deploys.
Its output is findings, not changes.

**What it's used for:**
- Auditing an increment after it lands (the standing "audit-after" lane: build → full
  gate → merge → ChatGPT audit of that increment → its findings become the fix list).
  Audit-after has caught real defects that design reviews missed (e.g., raw error
  text leaking, UTC fallback, the Deep Past runtime import-map silent-failure mode).
- Independent re-audits and second opinions (e.g., Verbatim Recall re-audits, design
  reviews, fix-round reviews).
- Reading and summarizing code, docs, or a branch for the owner.

**How Claude should treat a ChatGPT audit:**
- Read the findings, then VERIFY each one against the actual code before acting.
  A ChatGPT finding is a lead, not a verdict — confirm it reproduces, then fix it.
- A ChatGPT audit is NEVER Claude's "Verified" sign-off. The sign-off is Claude's
  own gate + audit (see "Verify before you build" and the Red Zone rule).
- Do NOT treat a ChatGPT recommendation as the owner's approval. The owner's tap is
  the only approval (same rule as for any relayed recommendation).
- If a ChatGPT audit contradicts Claude's own reading, say so plainly and show the
  evidence — don't silently defer to it.

**Free-plan constraint:** It's the free plan, so its usage is limited. Keep audit
requests focused and batched: one well-scoped audit per increment (or per fix round),
not a stream of small reads. Don't burn its turns on things Muse or Claude can
check directly (file listings, flag values, deploy state — that's Muse's lane).

**What it does NOT do:** It does not implement, does not push, does not merge, does
not deploy, and does not hold the gate. If an audit suggests a change, the change
still goes through the normal lane (Claude or the owner-tapped implementer, gate,
review, owner's tap for merge/deploy).

## Current findings — 2026-10-28 (worlds / travel visibility)

Organized findings from Muse's diagnosis session (2026-10-28). Claude is picking up
fixes from here.

**Deploy / branch (VERIFIED, fixed 2026-10-28):**
- `main` branch did not exist; the repo's default was
  `claude/soumaya-second-brain-v1-m4z4hc`. `main` was created 2026-10-28 from tip
  `7262265a` (Fleet Defense PR #122 merge) and verified to contain the worlds code.
- Fly app `brain-soumaya-v1` was deploying from the old deploy branch with auto-deploy
  OFF. Switched 2026-10-28: deploy branch = `main`, auto-deploy ON. Release v273
  deployed from `main` successfully 2026-10-28 5:09 PM EDT.
- Live server proven current: the served `sw.js` carries the new build ID
  (`soumaya-bmvskpcxp`) and network-first logic. Stale deploy, missing code, and
  missing GLB files are all RULED OUT.
- All 9 Deep Past GLBs are in `packages/web/public/` on `main` (185 GLBs total,
  including Eternity figure, ships, station/space packs).
  `WORLDS_TRAVEL_ENABLED = true` in `packages/shared/src/worlds.ts`.

**Owner-reported symptoms (ROOT CAUSE FOUND + FIXED 2026-10-28 by Claude — CSS, not a
crash; the gate question (3) below is still open):**
- Owner sees no warp gates, no worlds, no nothing from any chat's work in the live app.
- The world map button (Tools menu → 🪐 World map) produces no visible map when clicked.
- Owner states: as dev and owner, everything should be accessible to him, including
  Eternity's world.

**Root cause (MEASURED in headless Chromium at 412×915 against a real build — supersedes
the ErrorBoundary theory below; no JS error was thrown):**
1. The worlds panels (TravelPanel, ToursPanel, ApprovalsInbox, WorldChangesView) were
   mounted as loose in-flow children of `.app` (`position: fixed; overflow: hidden`) and
   `.travel-panel` never had any CSS on any branch — they laid out BELOW the screen's
   bottom edge (Travel at y=934, Tours 1503, Approvals 1704, World Changes 1747) where
   nothing could scroll to them. No Travel panel → no departure → no world ever mounts.
2. PR #122 (Fleet Defense, commit `0738129`) inserted its CSS inside an unclosed
   `.world-changes-view-why {` rule, so every rule after it (the whole World map, Fleet
   Defense, `.route-focused`, `.travel-bonus`) became a nested descendant selector that
   matches nothing. The World map rendered `position: static` at y=1801. The build had
   been printing a `css-syntax-error` warning for it.
- **Fix:** brace closed; the four panels now live in ONE positioned, scrollable sheet
  (`components/TravelSheet.tsx`, Tools → 🚀 Travel; the map's travel handoff and the Help
  Try-It "travel" action open it via `openTravel`). The sheet stays mounted while closed
  so journey state/transit clock survive. World map buttons styled and its background
  given a dimming scrim (fully transparent let the HUD collide with the map's bar).
  `TravelSheet.test.tsx` gates brace balance (falsified: re-introducing the #122 break
  fails it) and that every worlds panel mounts inside the sheet.

**What the code says (VERIFIED from source on `main`):**
- World map button wiring is correct: ToolsMenu "World map" → `setShowWorldMap(true)` →
  WorldMap full-screen overlay (z-index 70, not CSS-hidden). If clicking produces
  literally nothing, that points to a runtime failure silently swallowed by the WorldMap
  ErrorBoundary (fallback null) — NOT a wiring bug.
- Fresh traveller sees ONLY Home on the map by design (confirmed by
  `WorldMap.test.tsx`: "a fresh traveller sees only Home — no other world, no 'unknown'
  marker"). Undiscovered worlds are hidden entirely. So even a working map looks empty
  until the user travels.
- Travel lives in the TravelPanel (rendered when a space is loaded, flag on). Route board
  offers: Home (current), Great Station, Growing Place, Deep Past, Quiet/Archive, Scale —
  each with Warp (cost 10 fuel) and Drift (FREE). Drift is always affordable, so fuel
  cannot block discovery.
- People world is gated by server verdict (`peopleGateOpen`: enough people + linked
  memories + shared memories). Eternity's world is gated by B-01 (Witness + two other
  relics, `eternityReachable`). There is NO dev/owner bypass in the code — gates apply
  to everyone, including the owner.
- "Warp gates" are not 3D objects in the galaxy; Warp/Drift are buttons in the
  TravelPanel. If the TravelPanel isn't visible, there are no warp options to see.
- Server travel API exists: `GET /api/travel/state` (via `travelRoutes`),
  `TravelRepo.getState()`, `travel_journeys` table in schema, `migrateSchema` system.
  Client `getTravelState()` returns null on any failure, which makes the panel show
  "Checking the chart…" or an error — not nothing.

**Open diagnostic questions for the fix (do not guess — verify against the live app /
owner's screen):**
1. When the owner clicks the world map button, does ANYTHING appear (even just a Home
   dot, or "Checking the chart…" text, or an error), or does literally nothing change?
   (Dialog-open-but-only-Home vs. crash-swallowed are different bugs.)
2. Is the Travel section visible in the app at all? If not, is it crashing
   (ErrorBoundary null), stuck loading (travel state null), or positioned where the
   owner doesn't look?
3. Dev/owner access: does the owner want a dev bypass for the People and Eternity gates
   (code change to access control), or does he want to earn them via relics/counts? He
   stated everything should be accessible to him as dev/owner — confirm before building
   a bypass.

**Owner bypass (question 3 — ANSWERED by the owner 2026-10-28: "owner bypass for everything"):** built
as `OWNER_SPACE_IDS` (see Deployment). Verified over real HTTP and in the UI: owner brain with no people and
no relics gets `peopleGateOpen`/`eternityReachable` true, 8 worlds on the board, and a direct Home→Eternity
departure; a second brain on the same server stays refused with `ETERNITY_GATE_CLOSED`. NOT YET ACTIVE in
production until the secret is set on Fly (dashboard → Secrets).

**Do NOT re-litigate:** stale deploy, missing main branch, missing GLBs, flag off — all
verified and ruled out 2026-10-28. The problem is downstream of deploy: either runtime
failure on the owner's device, travel state not loading for his brain, or the
gates/visibility design itself.
