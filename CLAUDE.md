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
