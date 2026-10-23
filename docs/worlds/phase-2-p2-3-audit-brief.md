# P2-3 Audit Brief — Web Travel Layer + Great Station (for ChatGPT, post-merge)

**What this is:** the post-merge audit request for Worlds Phase 2 increment P2-3, per the default lane (build → gate → owner's merge tap → this audit → findings become the fix list). Design authority: `phase-2-p2-3-design-note.md` (this folder), decisions D-40…D-43 in `design-exploration-1.md` §11. The code lives on the deploy branch after the merge of PR #97 (branch `worlds/p2-3-web-travel`).

## What shipped

1. **Travel client** — `packages/web/src/api/travel.ts`: typed binding over the P2-2 contract (5 routes). Server plain-language errors preserved; codes intact (`TravelClientError`). State reads return null on unreachable (distinct offline state, never a guess).
2. **State binding** — `packages/web/src/hooks/useTravel.ts`: server-authoritative. Departure key generated per intent, persisted across retries, retired on resolution/conflict/supersession. Arming poll (2s) so settlement appears; countdown derived from the server deadline for display only. Traversed routes recorded on observed arrival (presentation memory for the skip rule).
3. **Dark gate** — `packages/shared/src/worlds.ts`: `WORLDS_TRAVEL_ENABLED = false`. No flag system existed; this constant is the whole mechanism, flipped only by P2-4's launch. Flag off ⇒ panel renders null, hook disabled ⇒ no API calls.
4. **Route board** — `packages/web/src/lib/routeBoard.ts` + `components/TravelPanel.tsx` (mounted in `App.tsx` inside an ErrorBoundary): chart mirrors the server allow-list (server stays the authority); warp priced from shared constants; drift and home always free; unaffordable warp explained, never hidden. Arming shows the countdown + free cancel; first-trip arrival appears only after the presentation duration (D-11 bands; reduced-motion not held); traversed routes may skip; turn-back always available.
5. **Station scene** — `graph/stationLayout.ts` (pure: palette grammar with cyan reserved for navigation truth, beacon ring, traffic lanes, 3-stage approach, budget accounting) + `graph/stationScene.ts` (three.js over it; accessory layer; reduced-motion freeze).
6. **The hull** — `graph/profondoHull.ts` + `public/profondo.glb`: "Profondo" by vostok, CC BY 3.0 (license verified from the downloaded file itself). The proxy form renders immediately and the GLB swaps in on load (the app's model pattern); load failure keeps the proxy and registers a model fallback. Materials are re-expressed in place by material name under the recipe grammar (replacing loaded materials breaks rendering — smoke-found; the raw export's materials are unfaithful: black bases, broad emissive wash).
7. **Attribution** — `components/WorldCredits.tsx` (in-app) + a Profondo entry in `public/CREDITS.md`.
8. **Labeled extra (separate commit `7ab1a30`):** a P2-2 completeness fix — the travel tables were missing from `SPACE_SCOPED_TABLES`, so space deletion/export would have orphaned travel rows. Found by running the FULL server suite, which the P2-2 targeted gate had not done.

## Gate evidence (builder-run, sandbox)

- Web: **1428/1428 tests** at build time; the Gate 0 hull commit added 5 profondoHull tests (10/10 with stationLayout), web tsc clean and production build green after it (full web suite not re-run post-hull-commit — disclosed, not claimed). New tests: travel client 8, useTravel 7, routeBoard 4, TravelPanel 8, WorldCredits 2, stationLayout 5, profondoHull 5.
- Server: tsc clean; suite 1886/1889 pre-census-fix, census 11/11 after.
- Gate 0: 333,563 raw tris → **132,432** (weld + decimate 0.40; fail line 150k); the uncompressed GLB was 3,468,496 bytes; the SHIPPED asset is its Draco-compressed encoding (596,684 bytes — the builder's sandbox could not move the larger binary through the API or credential-less git; uploaded via GitHub's web UI and verified byte-identical by blob SHA). 1 object, 5 material groups, re-import verified at 132,432 tris; look-test harness smoke-tested headless (zero page errors) and **passed by the owner** (D-43).

## Disclosures (not hidden, not claimed green)

- Two daily-digest server tests (`notifications`, `telegram`) fail reproducibly in this sandbox in files **byte-identical to the deploy branch** and untouched by this work — date/time-boundary suspects. Flagged [RECONCILE] for the repo chat.
- The Station scene is not yet mounted in the live galaxy view (the panel is; the scene mounts with the worlds surface at P2-4 launch). No device performance run of the Station scene exists yet — §11 numbers for it are owed at the P2-4 device check, not claimed here.
- The route chart is a client-side mirror of the server allow-list (documented in `routeBoard.ts`); Phase 3 discovery is expected to move it into the state response.

## Audit asks

1. Contract fidelity: does the client ever decide money, timing, or arrival locally? (It must not.)
2. Key lifecycle: can a departure key leak across intents, double-charge, or strand a retry?
3. Honesty: any UI state that implies an outcome the server hasn't confirmed? Any raw error text or codes shown?
4. Flag discipline: with the flag off, is any travel surface reachable or any travel call made?
5. Scope: anything outside the design note §1/§8 boundaries?
6. The census fix: correct tables, correct order (events before journeys), any other travel-adjacent table missed?

Findings return to the worlds chat and become the fix list; fixes need their own owner authorization and merge tap.
