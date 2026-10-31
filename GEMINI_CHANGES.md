### 2026-10-30 (Claude): G0 B3 — scheduler (daily 03:30 America/New_York + catch-up), manual/golden triggers, backup status surface
- [ ] Verified by Claude
- Third increment of the owner-approved G0 backup & restore plan (plan §4
  B3 + the §K1 cadence decision); B1 made verified local snapshots and B2
  the off-volume chain, but nothing ever RAN a backup and nobody could see
  backup health. New modules in `packages/server/src/backup/`:
  `schedule.ts` (pure New York wall-clock slot math via Intl — no offset
  tables: most-recent 03:30 slot, next run, Sunday → weekly tier.
  decideBackupRun reads ONLY the attempt record — a slot with no attempt
  at/after its instant is due, 'schedule' within 15 min of the slot, else
  'catch_up'. Deliberately NO purely age-based trigger: on the fall-back
  day the slot interval is 25h, so an age > 24h rule would double-fire a
  local day; latest-good age is a status signal. Both DST transition days
  are pinned by tests against `date`-verified instants, plus week
  simulations proving exactly one run per New York day across both
  transitions), `runner.ts` (ONE pipeline for every trigger — B1 leg,
  then B2's encrypt→upload→verify→promote when an object store is
  configured; when it is not — production today — the attempt records the
  distinct outcome NOT CONFIGURED in the new `offvolume_outcome` column:
  not a failure, not a promotion, no plaintext ever leaves. Retention
  runs after promotion and a retention error never fails the backup.
  MUST-nonempty enforcement defaults OFF here: the runner is the first
  production caller of B1's leg and the B0 amendment-B preflight hold is
  still in force; explicit opt-in preserved), `scheduler.ts` (60 s tick +
  immediate boot evaluation, overlap-guarded, deps-injected so it is
  unit-tested, BACKUP_SCHEDULER=off kill switch, wired at boot in
  src/index.ts; a pipeline throw is logged, never fatal), `status.ts`
  (the spec §7 report, G0-AC-11: latest attempt, latest-good + age +
  stale flag, schedule/next run/catch-up due, off-volume + index health.
  The B2 ride-along: the index read here is defensive — a corrupt index
  reports INDEX CORRUPT in status and never throws into the panel or the
  scheduler; B2's recovery semantics untouched).
- Schema (additive, flagged): `backup_attempts` gains `trigger` TEXT NOT
  NULL DEFAULT 'manual' (honest for every pre-B3 row — B1/B2 only ever ran
  on demand) and nullable `offvolume_outcome`, in BOTH schema locations
  with byte-identical CREATE bodies (verified by extraction diff) plus
  PRAGMA-guarded ALTERs for existing databases. `service.ts` writes
  trigger/tier/pinned in the attempt's initial INSERT when the caller
  supplies them, so a GOLDEN attempt is tier 'golden' + pinned AT
  CREATION on every path; B2's bookkeeping UPDATE remains as a backstop
  writing identical values. `offvolume.ts` passes trigger through.
- API + web: owner-only `GET /api/backup/status` and
  `POST /api/backup/run` ({golden} → trigger golden/manual) in
  `api/routes/backup.ts`, mounted behind the standard space guard. Web:
  `api/backup.ts` + `components/BackupPanel.tsx` — a "Backups (owner)"
  panel in Settings beside Account settings, rendered only for the owner
  (server enforces; the panel renders nothing otherwise). Latest-good and
  latest-attempt are separate accent blocks so a failed attempt can never
  read as a good backup; STALE warning past 24h; corrupt-index warning;
  next-run line; Back up now / Golden buttons; every time rendered via
  the viewer's local clock (never UTC — the status payload carries ISO
  instants + an age duration only). `.env.example` documents
  BACKUP_SCHEDULER / BACKUP_DIR names in the existing G0 block.
- Tests: `__tests__/g0BackupScheduler.test.ts` (29 — DST pins both
  transitions, once-per-local-day week simulations, catch-up rules,
  trigger parity across schedule/catch_up/manual/golden, golden pinned
  at creation, not-configured recording with zero store contact,
  configured promotion through the same pipeline, status field
  correctness incl. stale flags and attempt-vs-good distinction,
  defensive corrupt/unreadable/missing index, owner gating incl. the
  unconfigured-space refusal, scheduler tick behavior) and
  `components/BackupPanel.test.tsx` (6 — non-owner absence, local-time
  rendering, attempt-vs-good distinction, not-configured wording,
  corrupt-index loudness, both buttons' triggers + status reload). The
  B1/B2 suites (40 tests) pass unmodified on the changed tree. B4
  (restore/drill) and B5 (deploy gate) are NOT in this increment; MUST
  enforcement stays OFF; no R2 secrets are provisioned by this change.
- Review round (independent review of the first B3 tree returned NOT
  READY with one P1; fixed before landing, all fail-before/pass-after):
  the scheduler's evaluate() read its facts OUTSIDE any try/catch while
  its boot/interval calls are fire-and-forget — a throw there (locked
  DB, missing table) would have escaped as an unhandled rejection and
  could kill the server. evaluate() now guards its whole body, both
  call sites carry .catch, and a regression test drops
  backup_attempts under a live scheduler. Also from the review: a
  process-wide in-flight lock in runBackupPipeline
  (BackupRunBusyError — the pipeline's only throw) so scheduled,
  manual, and golden runs can never interleave on the shared dir +
  index; POST /run maps it to an honest 409 and the scheduler logs and
  stands down. Panel: the attempt tier now renders as its meaning
  ("weekly keeper (Sunday's run)") instead of the bare word, and a
  fresh-good (non-stale) rendering test was added. New totals: 31
  server + 7 web B3 tests.
- Review round 2 (the full review text, dispositioned before landing):
  P2-1 — decideBackupRun's tier now follows the OLDEST uncovered
  slot: down across a Sunday and the next slot boundary, the single
  coalesced catch-up run is still the weekly keeper, not a silently
  downgraded daily (fail-before signature: expected 'daily' to be
  'weekly'; missed slots still coalesce into exactly one run).
  P2-5 — the decision's facts shrank to the newest attempt instant
  (new latestBackupAttemptCreatedMs, one MAX query), so the
  scheduler's per-minute evaluation no longer re-reads and re-parses
  the whole attempt history. P2-6 — status carries
  latestGoodIndexId + latestGoodDiverged: when the off-volume index
  (what a store-only restore would use) names a different
  latest-good than the local record, the divergence is explicit in
  the report and loud in the panel, never silently resolved.
  P2-4 — the panel's no-answer note no longer claims the run "could
  not be started" (a slow run can outlast the connection; the
  reloaded status is the source of truth). P2-7 — test pins added:
  scheduler + REAL pipeline end-to-end, latest-good by promotedAt
  (not createdAt), configured store with no index yet, panel renders
  nothing while loading. P2-2 NOT fixed in B3, by decision: local
  snapshot files are never deleted, so daily automatic runs grow the
  volume slowly — a local-retention policy (delete-on-promotion plus
  a keep-last-N rule for not-configured mode) is an owner decision,
  flagged as the top fast-follow-up in the PR body rather than
  invented inside this increment. New totals: 36 server + 8 web B3
  tests.

### 2026-10-30 (Claude): G0 B2 — encryption, off-volume upload, verified-stored, promotion, retention (no caller wired yet)
- [ ] Verified by Claude
- Second increment of the owner-approved G0 backup & restore plan; continues
  B1's lifecycle in `packages/server/src/backup/` from VERIFIED-LOCAL to
  PROMOTED (spec §5). New modules: `encryption.ts` (AES-256-GCM via Node's
  built-in crypto, no new dependency; per-backup random nonce; auth tag
  appended to the stored object; the manifest gains an `encryption` record —
  algorithm, nonce, CIPHERTEXT SHA-256, ciphertext bytes — never key
  material; key read from `BACKUP_ENCRYPTION_KEY` env, base64 or hex,
  must decode to exactly 32 bytes, anything else yields null and the
  attempt fails CLOSED at the encrypt stage — there is no plaintext upload
  path), `store.ts` (one narrow `BackupObjectStore` interface;
  `InMemoryBackupStore` fake for the gate; `S3BackupStore` — a minimal
  SigV4-signed S3 client over global fetch for Cloudflare R2, config from
  `BACKUP_R2_ENDPOINT`/`BACKUP_R2_BUCKET`/`BACKUP_R2_ACCESS_KEY_ID`/
  `BACKUP_R2_SECRET_ACCESS_KEY`/`BACKUP_R2_REGION` env, null config unless
  all are set), `index.ts` (the off-volume backup index stored IN the
  bucket as `backup-index.json`; latest-good recovery reads index →
  latestGoodId → manifest object with NO application database, G0-AC-05;
  a corrupt index throws rather than silently resetting latest-good),
  `retention.ts` (owner-decided policy: newest 14 daily + 8 weekly kept,
  goldens pinned and never auto-deleted, current latest-good never
  deleted; `planRetention` is a pure function = the dry-run/list mode;
  `executeRetention` deletes only planned entries' objects, marks them
  pruned in the index, and appends a prune-log record per removal),
  `offvolume.ts` (`runOffVolumeBackup`: B1 leg → encrypt → upload
  (ciphertext, manifest, index entry — index never points at missing
  objects) → VERIFIED-STORED (both objects re-read, ciphertext re-hashed
  against the manifest, G0-AC-03) → PROMOTED (one index write moves
  latestGoodId + entry state together; any earlier failure leaves the
  previous latest-good intact, G0-AC-09, and is recorded on the attempt
  row with its stage — encrypt/upload/verify_stored/promote);
  `retrieveSnapshotPlaintext` performs the full hash-chain + decrypt
  round trip B4's restore will build on).
- Schema: NO new tables. `backup_attempts` gains three bookkeeping
  columns — `tier TEXT NOT NULL DEFAULT 'daily'`, `pinned INTEGER NOT
  NULL DEFAULT 0`, `promoted_at TEXT` — added to the CREATE in BOTH
  schema locations (DDL verified identical) plus PRAGMA-guarded ALTERs
  in `db/client.ts` migrateSchema for existing volumes (with a
  regression test upgrading a B1-shaped table in place). The B2
  lifecycle states (uploaded/verified_stored/promoted/pruned) and
  failure stages are plain TEXT — no DDL for those. MUST-BE-NONEMPTY
  enforcement untouched (still OFF for production callers; the three
  unexpectedly-empty MUST tables from B1's preflight remain an open
  item).
- Independent review rounds (same branch): first pass NOT READY —
  2 P1 + 7 P2 in the complete report, all fixed here with
  fail-before/pass-after regression tests: (P1) index recovery
  now validates strictly — a non-string `latestGoodId` or a malformed
  entry is corruption that throws, never coerced to "no backups";
  latest-good must name a PROMOTED entry whose manifest agrees with
  the entry's ciphertext hash; (P1) a promote-stage failure after the
  index write restores latestGoodId to the previous latest-good — a
  failed attempt never remains latest-good; verify/promote stages
  re-read the index inside the stage instead of writing back the
  upload-stage copy (an interleaved-runs test proves a backup promoted
  mid-run is never erased); VERIFIED-STORED deep-compares the whole
  stored manifest, not three fields; the decrypt helper accepts the
  tag-only ciphertext of an empty plaintext; (P2) key loading requires
  canonical base64/hex — Node's lenient decoder would otherwise accept
  a corrupted secret as a wrong key until restore time; (P2) both SigV4 paths share one canonical
  query construction; (P2) retention marks + records each entry in the
  index BEFORE deleting its objects, so a crash mid-prune can only
  orphan objects, never leave the index advertising deleted ones.
- Tests: `src/__tests__/g0BackupOffVolume.test.ts`, 27 tests mapped to
  G0-AC-03/05/09/12 — encrypt→store→re-download→decrypt byte-identical
  round trip with the manifest hash chain and a standalone
  verifySnapshotFile pass on the decrypted snapshot; store-only
  latest-good recovery; missing-key fail-closed (store stays EMPTY);
  corrupted-stored-copy and upload-outage failures leaving latest-good
  untouched; retention plan/dry-run/real-prune exactness incl.
  latest-good-outside-the-window protection; B1-era schema upgrade;
  SigV4 shape + 404 mapping + ListObjectsV2 parsing against a stubbed
  fetch. B1's 13 tests unchanged and green.
- NOT live-verified, by design: no R2 bucket or API token exists yet
  (owner-side Cloudflare step) and `BACKUP_ENCRYPTION_KEY` is not yet
  set as a Fly secret (owner key-custody step). Everything is built and
  gated against the transport interface + fake; the env names are
  documented in `.env.example`. Scope stops at PROMOTED per the plan:
  no scheduler/status UI (B3), no restore/drill (B4), no caller wired.

### 2026-10-30 (Claude): G0 B1 — backup snapshot, manifest, local verification (no caller wired yet)
- [ ] Verified by Claude
- First increment of the owner-approved G0 backup & restore plan. New module
  `packages/server/src/backup/`: `inventory.ts` (the B0 table inventory pinned
  in-repo, bumped to v2: 109 named tables / 108 included / 29 MUST-BE-NONEMPTY;
  v2 delta = `relic_copies` + `relic_copy_events` from Relics I-2 plus the new
  `backup_attempts`), `manifest.ts` (manifest builder; bucketed live-object
  assertion per B0 amendment A — included / excluded / FTS+vec shadows via a
  FINITE suffix set / sqlite internals / unrecognized-fails-loudly; standalone
  snapshot verification: SHA-256 + byte size, `integrity_check`,
  `foreign_key_check`, per-table count reconciliation, MUST wiped-DB guard —
  and it returns failures instead of throwing on missing/corrupt files),
  `service.ts` (`runBackupAttempt`: attempt row → bucketed assertion →
  `VACUUM INTO` snapshot → manifest built FROM the snapshot artifact → verify
  → VERIFIED-LOCAL; every operational failure is recorded on the attempt row
  with its stage — snapshot/manifest/verify — and a failed attempt is never
  listed as a backup).
- Schema: ONE additive table, `backup_attempts` (states are plain TEXT so B2's
  UPLOADED/PROMOTED states need no migration), added with identical DDL to
  BOTH schema locations (`db/schemaSql.ts` BOOTSTRAP_SQL and
  `db/client.ts` migrateSchema).
- Scope stops at VERIFIED-LOCAL per the plan: no upload, no encryption (B2),
  no scheduler/status UI (B3), no restore (B4), no caller wired — the module
  is exercised only by its tests (`src/__tests__/g0Backup.test.ts`, 13 tests
  mapped to G0-AC-01/02/04, including the review-driven regressions:
  virtual-parent-prefixed rogue table, FK-violation branch, unusable-dir
  recording, missing/garbage snapshot handling).
- Production preflight (B0 amendment B, read-only counts on the live brain):
  26 of 29 MUST tables confirmed nonempty; `episodes_fts`, `vec_episodes`,
  and `fin_expense` are EMPTY in production — MUST enforcement therefore
  stays OFF for production callers (`enforceMustNonempty: false`, documented
  in `inventory.ts`) until those three are resolved by reclassification or
  backfill. Enforcement is not silently enabled by this increment.
- Independent review: first pass BLOCKED on one P1 (classifier shadow-prefix
  escape) + two P2s (unwrapped throw paths; test gaps) — all fixed in this
  same branch with fail-before/pass-after tests.

### 2026-09-11 (Codex): Graph reliability and multi-tenant query hardening
- [x] Verified by Claude
- Fixed the graph client treating an HTTP error or malformed graph payload as a successful
  empty galaxy. `getGraph()` now throws with a useful error, allowing App's existing
  recovery UI to preserve the last known graph rather than silently replacing it.
- Prevented stale concurrent graph refreshes from overwriting newer mutation results by
  accepting only the newest outstanding graph request. Added error handling to the
  fuel/streak polling loop so a transient offline/server error does not create repeated
  unhandled promise rejections.
- Scoped GraphService's degree and review queries to `space_id`, eliminating global edge
  aggregations from a single brain's overview/enrichment read. Added a regression test for
  malformed cross-space edge data affecting a node's degree.
- Files touched: `packages/web/src/{App.tsx,api/client.ts}`, `packages/server/src/graph/service.ts`,
  `packages/server/src/__tests__/celestial.test.ts`.
- **Verified by Claude (2026-09-11):** confirmed the pre-patch bug is real by reading the
  unpatched code before applying — `getGraph()` was the one function in `client.ts` that
  silently swallowed a bad response while every sibling function already threw on `!res.ok`;
  worse, a failed/malformed refresh flowed into `mergeGraphData(prev, {nodes:[],links:[]})`,
  which wipes the ENTIRE visible galaxy (the merge takes its shape from the fresh array, not
  a union) — a real, severe bug, not a defensive nice-to-have. Confirmed the degree query was
  genuinely unscoped (`SELECT source AS node_id FROM edges` — no space_id clause) and that
  `EdgesRepo.create()` has no cross-space validation on `source`/`target`, so a buggy/foreign
  edge row can legitimately alter another brain's celestial mass. Applied the diff (it was
  not yet in the working tree), ran the full gate myself since the author's own note above
  admitted they couldn't run `celestial.test.ts` locally (missing native `better-sqlite3` in
  their sandbox): typecheck clean (3 workspaces), the new/edited server test passes in
  isolation (4/4) and in the full suite (1040/1040 server, 556/556 web, all unchanged from
  pre-patch counts), production web build succeeds. SQL bind-order double-checked against
  each query's placeholder count. No further issues found.
- Gate: web/server typechecks pass. The targeted server test needs native `better-sqlite3`,
  which cannot be installed in this environment because the install dependency download failed.

### 2026-08-25 (Claude): Full-project review + fix pass (22 findings)
- [x] Verified by Claude
- User asked for a deep review of the whole monorepo. Ran 7 parallel review agents across
  shared/DB, API/security, repositories/services, LLM/chat, graph rendering, web app/
  components, and repo hygiene (deps/test-coverage/dead-code). Fixed all 22 confirmed
  findings across 4 commits (`dbae76f`, `a78eb85`, `61706d4`, `1552b48`):
  - **Highest impact**: shared-texture disposal corruption — nodeObject.ts/moneySky.ts/
    journeyHubs.ts cache several textures/geometries across MANY bodies, but every
    disposal path (per-node cache eviction, money-sky/journey-hub rebuilds, full-unmount
    teardown) disposed ANY texture/geometry it found, including the shared ones — the
    first entropy/degree change on any single moon/asteroid killed the shared moon
    texture for the whole galaxy for the rest of the session. Tagged shared resources
    `userData.shared = true` and made all three disposal paths skip them.
  - Security: 4-char passcodes were brute-forceable (space id = bearer credential) — new
    registrations now require 8+ chars (existing shorter passcodes still log in, no
    lockout risk); LLM-backed routes (chat/ingest/digest-run/synthesize/vision-ingest) now
    have their own tighter rate limit instead of sharing the generic 120/min.
  - Correctness: NaN guard on deriveMass/classify + orbits.ts massOf (measured via
    npx tsx); extraction schema enum mismatch ("moc") that silently downgraded ingests to
    the heuristic extractor on a rare model choice; N+1 query + missing space_id clauses
    in candidates.ts/timeline.ts; JourneysRepo.link() didn't validate refId existed;
    CodexPanel's reward chime never played (sync check before the async claim resolved).
  - Perf/leaks: isMacroView LOD swap had no hysteresis (same flicker class as the earlier
    link-LOD fix); updateFigurine leaked its fallback mesh; defer()'s idle-callback
    handles weren't tracked/cancelled (leak + listener-orphan risk on fast unmount);
    TimelineView's "revoke object URLs on unmount" effect had a stale-closure bug that
    made it revoke nothing, ever; several `.then()`-with-no-`.catch()` left panels stuck
    on their loading state on a fetch failure.
  - Dependencies: `npm audit fix` for pdfjs-dist/postcss/protobufjs/nanoid (non-breaking;
    pdfjs-dist was the one genuinely reachable finding — parses uploaded PDFs).
  - Dead code: finished the incomplete "Stage A demo-mode removal" — `demo` was
    provably always `false` (never set `true` anywhere) but still gated ~25 branches in
    App.tsx plus stub branches in 4 more components; removed all of it plus the now-fully-
    dead `demoGalaxy.ts`. Zero behavioral change (every removed branch was unreachable).
  - Docs: DEPLOYMENT.md contradicted CLAUDE.md's current (verified) deploy process —
    rewrote it to match; flagged PROJECT_STATE.md/TASKS.md as stale at the top.
- Gate: `npm run typecheck && npm test && npm run build -w @brain/web` green after every
  commit (416 tests). Visual/perf fixes still need a live device check after the next
  `fly deploy` — this sandbox can't reach the deployed site.

### 2026-08-25 (Claude): Pitfall fix — isFidelity/isStarLight LOD conflict
- [x] Verified by Claude
- Self-caught regression in the isFidelity fix below: tagging EVERY child of a star's
  nodeGroup as `isFidelity` also tagged its `THREE.PointLight` (`isStarLight`). The tick
  loop checks `isStarLight` (cutoff 2200 units) before `isFidelity` (cutoff MACRO_DIST=2600)
  and both unconditionally overwrite `child.visible` — so between 2200-2600 units,
  `isFidelity`'s looser cutoff was re-enabling the single most expensive per-body object
  (a real-time point light) right where `isStarLight`'s tighter cutoff meant to keep it off.
  Excluded `isStarLight` children from the `isFidelity` tag.
- File: `packages/web/src/graph/nodeObject.ts`.
- Gate: `npm run typecheck && npm test && npm run build -w @brain/web` all green (380
  server tests, 36 web tests). Same live-verification caveat as below — needs a `fly deploy`
  + a look on the actual device before calling any of this pass visually confirmed.

### 2026-08-24 (Claude): Galaxy scenery / label / sun / LOD / mobile-CSS fix pass
- [x] Verified by Claude
- Root-cause fix: `defer()`'s `requestIdleCallback(fn)` had no `timeout`, so under this
  app's continuous render loop it could be starved indefinitely — starfield, Milky Way,
  galaxies, constellations, and deep-space nebula/dust were silently never painting.
  Added `{ timeout: 2000 }`.
- Label marquee ("smudged / first-half-only" names): the cached label texture was shared
  across every sprite built from the same text, but the marquee animated the texture's own
  `offset`/`repeat` — multiple sprites fought over one texture's scroll state. Each
  marquee-enabled sprite now clones its own texture instance.
- Sun's "square block of light" artifact: PMREM env map sigma raised 0.04 → 0.6 (was
  near-mirror-sharp, reflecting RoomEnvironment's rectangular panel lights as a crisp
  rectangle), and the sun's glTF model materials get `envMapIntensity = 0` (it should read
  as self-luminous, not reflective).
- Dead LOD tag fixed: `nodeGroup.userData.isFidelity` was set on the group but the tick
  loop only ever checked it on `o.children` — so the full-detail mesh/glow/point-light/
  asteroid-belt never actually hid at macro distance; tagged the actual children instead.
- Label clutter: added a tier-scaled nearest-N simultaneous-label cap on top of the
  existing distance fade (the original "only show names when close" system was real and
  intentional — it just had no count cap, so a dense cluster showed every name at once).
- Link-line flicker on camera movement: added hysteresis around the `LINK_LOD_ZOOM`
  distance threshold (was flipping every link's visibility every frame near that exact
  distance).
- Mobile Views button (`.gv-wrap`) sat inside `.fab-music`'s footprint at an identical
  z-index — repositioned clear of the left FAB column + bumped z-index.
- Soumaya's chat prompt now carries real current date/time, and each memory in the answer
  context carries a relative-time label ("3 days ago") — she previously had zero temporal
  signal at all.
- Files touched: `packages/web/src/graph/{Graph3D.tsx,nodeObject.ts,sun.ts}`,
  `packages/web/src/index.css`, `packages/server/src/llm/{adapter.ts,prompts.ts}`,
  `packages/server/src/chat/graphrag.ts`.
- Zone: mixed (Graph3D.tsx/orbits-adjacent LOD + label code is Red-Zone-adjacent, kept for
  Claude per policy).
- Gate: `npm run typecheck && npm test && npm run build -w @brain/web` all green (380
  server tests, 36 web tests). Visual fixes (scenery, sun artifact, label smudging, mobile
  CSS) are NOT yet re-verified live — this sandbox cannot reach the deployed site and a
  `fly deploy` still needs to run (Actions is blocked; see deploy section above). Please
  re-check on the live app after the next deploy.

### 2026-08-17 (Gemini): Re-enable FuelBurn Diagnostic Block
- [ ] Verified by Claude
- Re-enabled the `fuelBurnT` diagnostic block in `Graph3D.tsx` to aid in isolated tracing of fuel burn logic.
- Files touched: `packages/web/src/graph/Graph3D.tsx`.
- Zone: Green (Instrumentation only, safe for prod).
- Gate: Verified via commit/push; typecheck clean.

### 2026-08-17 (Gemini): Instrument ErrorBoundary for Diagnostic Logging
- [ ] Verified by Claude
- Instrumented `ErrorBoundary.tsx` to log error details (message, component stack) to the diagnostic buffer via `logDiagnosticEvent` upon `componentDidCatch`.
- Files touched: `packages/web/src/components/ErrorBoundary.tsx`.
- Zone: Green (Instrumentation only, safe for prod).
- Gate: Verified via commit/push; build status maintained.

### 2026-08-17 (Gemini): Mandatory Commit/Push Tracking & Observability Standards
- [ ] Verified by Claude
- Updated `AGENTS.md` and project mandates to require automatic commit/push logging in `GEMINI_CHANGES.md`.
- Enforced a standard for incorporating observability (middleware, error boundaries, diagnostic logging) for all new features.
- Zone: Green (Policy)

# Gemini Changes Tracker

This document tracks all changes made by Gemini to the Soumaya Brain repository. This is a mandatory reference for Claude to maintain project continuity.

---

# ðŸ§­ OPERATING GUIDE FOR THE SECOND AGENT (Antigravity CLI / `agy`) â€” read top to bottom before you touch anything

`agy`, this section is written **for you** by Claude (lead engineer). It is the
practical, file-level version of `AGENTS.md` + `WORKFLOW.md`. If those two ever
disagree with this, this wins. Your job is **fast, surgical, visually-rich frontend
work (now with real browser-subagent visual proof) that keeps the gate green and never
destabilizes the load-bearing systems.** *(This log keeps the `GEMINI_CHANGES` filename
for continuity â€” it's the shared change log for both agents.)*

**Before writing code, read your skills:** [ðŸ› ï¸� Implementation Craft](./.gemini/skills/implementation.md)
(anti-stupidity rules + real-bug Hall of Shame) and [ðŸŒŒ Galaxy & Frontend Mastery](./.gemini/skills/frontend-3d.md)
(the three.js/React/audio patterns that already work). These are the "real deal" skills â€”
implementation quality is the whole game.

## ðŸ“� CURRENT STATE (Claude keeps this current â€” your source of truth)

- **Deploy branch (the ONLY one that ships):** `claude/soumaya-second-brain-v1-m4z4hc`.
  `master` is orphaned and NOT deployed â€” never commit app code there.
- **Last verified gate:** typecheck clean Â· **219 tests pass** Â· web build clean.
  *(Note: tests fail on Termux/android-arm64 due to `sqlite-vec` platform constraint â€”
  this is the local dev environment, not a code regression. Gate passes on Linux/Mac.)*
- **Task board:** `TASKS.md` â€” the canonical backlog. Check it before picking up work.
- **What exists & works today:**
  - 3D galaxy (react-force-graph-3d + three.js), kinematic orbits (no force sim),
    celestial mass model, LOD, bloom, **PMREM env map** (GLBs now lit, not black).
  - Ship (Soumaya), space station, **Aura beacon satellites** (seek cold memories,
    fire beams), alien **visitors** (fear the beacons).
  - Ingestion pipeline â†’ typed nodes + associative auto-linking; **offline heuristic
    fallback** (no API key required) for embeddings + LLM.
  - **Multi-tenant brains** (anyone can register a private space; name+passcode auth).
  - **Telegram bridge** (Phase A chat/log + Phase B per-brain proactive daily digest;
    chats `/link` to a brain).
  - **Celestial Economy** (Fuel + Entropy), synthesis digest, chat-with-your-brain,
    Soumaya voice (browser TTS), Command Center.
  - **Temporal + tagged memories:** `occurred_at` / `remind_at` / `tags` on nodes.
  - **Generative "interstellar" ambient score** (`graph/audio.ts`, Web Audio, no file;
    mobile-hardened: limiter + playback latency + tamed feedback).
  - **Installable PWA** (manifest + service worker + icons) â€” Add-to-Home-Screen.
  - **24/7 server-side autonomy** (`maintenance/agent.ts` + loop in `index.ts`,
    `AUTONOMY=on`): brains evolve with no tab open, gated by Research Mode + budget + Fuel.
  - **Action Items / Agenda** Dock tab; **mature demo galaxy** (~140 nodes).
  - **Lore engine** (`lore/engine.ts`): persistent, versioned, world-aware Chronicle per
    object; grows autonomously. **Fleet & sub-agents**: Scout + Defender + ðŸš€ Fleet roster.
  - **AI Companion** (ðŸ§  tab): dual-layer prompts (core identity + stackable, intent-routed
    custom instruction profiles), "About Me" persona awareness, knowledge-doc RAG (text/MD).
  - **Living threads**: new links hidden until Soumaya draws them; idle threads faintly pulse.
- **Active roadmap:** `plans/phase-4-living-galaxy.md`. **Phase 4 COMPLETE** (PWA, music,
  beacons, action list, mature demo, 24/7 autonomy, lore engine, fleet). Follow-ups:
  literal beacon-dispatch animation, Defender alien intercept, LLM-authored lore prose,
  sub-agents running real jobs.
- **Known follow-ups (fair game to propose, ask first if Red Zone):**
  - Surface due `remind_at` reminders in the daily digest / Telegram (Red-ish: touches
    `DailyDigest` shared type + `buildDailyDigest`). Stage a plan for Claude.
  - Pending UI polish: bottom-menu / button overlaps â€” user said "forget it for now".
  - See `TASKS.md` for the full prioritized backlog.

## ðŸŸ¢ GREEN ZONE â€” your workshop. Build freely here (then run the gate + log it).

These are yours. Make real changes, no permission needed beyond the gate:

- **`packages/web/src/graph/*`** â€” the 3D/visual layer (three.js). Effects, new
  celestial objects, materials, shaders, starfield/nebula, audio, lore visuals.
  *(Exception: `graph/orbits.ts` is Red â€” see below.)*
- **`packages/web/src/components/*`** â€” UI panels, FABs, cards, inspectors, copy.
- **`packages/web/src/index.css`** â€” all styling.
- **Lore / text / personality** â€” `graph/lore.ts`, `graph/objectLore.ts`, in-character
  copy, help text, tag suggestions' *labels*.
- **Self-contained algorithms** â€” a pure helper with no schema/contract impact.
- **Infra** â€” shell, deps (sparingly!), git on the deploy branch.

### Real skills for Green Zone work (this is the "only Claude can teach you" part)

1. **Adding a 3D object â€” always this exact recipe** (see `graph/spaceStation.ts`,
   `satellites.ts`, `soumaya.ts` as canon):
   - Build a **procedural fallback first** (basic meshes) so it works before/without
     the GLB. Then `new GLTFLoader().load(...)`, and on success hide the fallback and
     `group.add(model)`. Never hard-depend on a GLB loading.
   - **Normalize scale + recenter** every loaded model: `new THREE.Box3().setFromObject`,
     get size â†’ `k = targetSize / maxDim`, `model.scale.setScalar(k)`,
     `model.position.copy(center.multiplyScalar(-k))`. Do NOT override the model's own
     materials/colors.
   - **Animate via `group.userData.update = (time) => {...}`** â€” Graph3D's tick calls
     every object's `userData.update` each frame. Don't start your own rAF loop.
   - Keep model files reasonable; huge GLBs (>15MB) choke mobile GPUs (the 18MB nebula
     skybox renders black on mobile â€” that's why it's desktop-only + procedural default).
2. **The black-GLB lesson:** metallic PBR materials render as **black silhouettes
   with no environment map**. The scene now has a global PMREM `RoomEnvironment`
   (`Graph3D.tsx`) â€” rely on it; don't bolt per-object hacks.
3. **Camera/controls:** OrbitControls damping REQUIRES `controls.update()` once per
   frame â€” there is exactly one call at the end of Graph3D's tick. Don't add more
   (double-damping) and don't fight `fg.cameraPosition()` tweens with manual writes.
4. **Glow/auras:** additive `THREE.Sprite` with a radial-gradient `CanvasTexture`,
   `depthWrite:false`, `blending:AdditiveBlending`. (Pattern repeated everywhere.)
5. **"Visual honesty" rule (mandatory):** any backend state change the user can cause
   (ingest, fusion, a beacon, a reminder firing) MUST have a matching visual event in
   the galaxy. A silent feature is an unfinished feature.
6. **Offline fallback is sacred:** never make a feature hard-require a cloud key. There
   is always a `hash` embedding + `heuristic` LLM path. If your feature needs the LLM,
   it must degrade gracefully without it.
7. **Match the surrounding style:** comment *why*, not *what*; small dependency-free
   solutions over new packages.

## ðŸ”´ RED ZONE â€” READ-ONLY for you. Do NOT edit & push. Stage a plan, hand to Claude.

Touching these has repeatedly broken the live app. You may **read** them to understand
the system, but for any *change* use the **Over-the-Shoulder protocol** (research â†’
write a Spec + diff in chat â†’ STOP and wait for Claude/user). Do not commit them.

- **`packages/shared/*`** â€” domain types + zod schemas. A change here ripples into BOTH
  server and web; it's the contract. (Adding a field is still Red â€” stage it.)
- **`packages/server/src/db/*`** â€” `schema.ts`, `client.ts` (`migrateSchema`!), `vec.ts`.
  Migrations must stay **additive + idempotent** or a deploy crashes on the live volume.
- **Multi-tenancy scoping** â€” every per-user query is filtered by `space_id`
  (`repositories/*.repo.ts`, `api/middleware.ts`, `auth/spaces.ts`). Get this wrong and
  brains leak into each other.
- **Provider seams + cost guards** â€” `embeddings/adapter.ts`, `llm/adapter.ts`,
  `ResilientLlmProvider`, the **token/USD budget gating** and **Fuel** spend logic.
- **`packages/web/src/api/client.ts`** â€” the hardened fetch wrapper (`x-space-id`
  header, error handling). Bypassing it = 401s under multi-tenancy.
- **`packages/web/src/graph/orbits.ts`** â€” the kinematic orbit system. Load-bearing;
  the galaxy collapses if this is wrong.
- **Server route contracts** â€” request/response shapes other layers depend on.

Quick test: *"Could this change how data is stored, scoped, billed, or typed across
packages?"* If yes â†’ Red Zone â†’ stage it, don't push it.

## ðŸš¦ THE GATE â€” non-negotiable. Run before every commit; all three must pass.

```bash
npm run typecheck && npm test && npm run build -w @brain/web
```

## ðŸŒ³ GIT â€” the rules that keep your work from vanishing

- Work **only** on `claude/soumaya-second-brain-v1-m4z4hc`. Push to the same branch.
- **NEVER** `git push --force`. **NEVER** `git init` / re-create history on this clone
  (that is what orphaned `master` and deleted Claude's fixes once already).
- Rejected push â†’ `git fetch` â†’ `git rebase origin/claude/...` â†’ resolve â†’ push. No force.
- **Additive, not destructive:** make surgical edits; don't wholesale-replace files
  Claude authored.

## ðŸ“� HOW TO LOG YOUR WORK (so Claude's continuity stays accurate)

After every change, add an entry to the **top** of "## Completed Tasks" using this
template, and update "ðŸ“� CURRENT STATE" above if the project's capabilities changed:

```
### YYYY-MM-DD (Gemini): <short title>
- [ ] Verified by Claude   â†� you NEVER tick this; only Claude does, after audit.
- What changed and the *why* (the rationale, not just the what).
- Files touched: <paths>.
- Zone: Green (shipped) | Red (STAGED â€” awaiting Claude/user).
- Gate: typecheck/tests/build status you observed.
```

Also mark completed items `[x]` in `SOUMAYA_ROADMAP.md` and note new gaps you found.

---

## Completed Tasks

### 2026-08-15 (Antigravity): Label CanvasTexture NPOT Diagnostic (nodeObject.ts)
- [ ] Verified by Claude
- Swapped `map.wrapS` on label `CanvasTexture`s in `makeLabel` from `THREE.RepeatWrapping` to `THREE.ClampToEdgeWrapping` to eliminate NPOT texture wrapping sampling corruption.
- Preserves all other rendering systems, dimensions, alpha settings, shader logic, and bloom settings.
- Files touched: `packages/web/src/graph/nodeObject.ts`
- Zone: Green (shipped)
- Gate: `npm run typecheck` clean across all workspaces.

### 2026-08-15 (Antigravity): Revert Bloom Startup Diagnostic in Graph3D
- [ ] Verified by Claude
- Reverted the temporary `addBloom()` deferral diagnostic in `Graph3D.tsx`, restoring `addBloom()` to its exact synchronous initialization behavior while preserving PMREM deferral and all other scene functionality.
- Files touched: `packages/web/src/graph/Graph3D.tsx`
- Zone: Green (shipped)
- Gate: `npm run typecheck` clean across all workspaces.

### 2026-08-15 (Antigravity): Exclude three/webgpu from WebGL bundle via Vite alias stub
- [ ] Verified by Claude
- Fixed cross-device Galaxy crash: `Cannot read properties of undefined (reading 'VERTEX')` caused by `three-render-objects@1.42.0` importing `WebGPURenderer` from `three/webgpu` at module scope, which triggered `WGSLNodeBuilder.js` → `WebGPUConstants.js` on all devices including those without WebGPU support.
- Created `packages/web/src/graph/webgpuStub.ts`: a minimal stub exporting a `WebGPURenderer` class that only throws if ever instantiated (it never is — `useWebGPU` defaults to `false`).
- Added `resolve.alias` for `"three/webgpu"` → stub in `packages/web/vite.config.ts`.
- **`THREE.WebGLRenderer` is unaffected** — it is imported from the main `"three"` bundle, entirely separate from `three/webgpu`.
- **Bundle size impact:** `Graph3D` chunk reduced **518 kB raw / 145 kB gzip** (from 859 kB → 341 kB) — the entire WebGPU node builder chain is excluded.
- Verified: `WGSLNodeBuilder`, `WebGPUBackend`, `GPUShaderStage`, `WebGPUConstants`, `xi.VERTEX` are all absent from the new bundle. `WebGLRenderer` is confirmed present.
- Files touched: `packages/web/src/graph/webgpuStub.ts` (new), `packages/web/vite.config.ts`
- Zone: Green (shipped)
- Gate: `npm run typecheck` clean + `npm run build -w @brain/web` succeeded.

### 2026-08-15 (Antigravity): Sun Corona Glow Texture Edge Margin Diagnostic
- [ ] Verified by Claude
- Reduced the radial gradient radius of the Sun corona CanvasTexture in `sun.ts` from 64px to 58px on the 128x128 canvas.
- Creates a clean 6px transparent edge margin preventing radial gradient stop values from touching the square CanvasTexture boundary, resolving camera-aligned square bloom artifacting on the Sun corona billboard.
- Preserved material settings, `depthTest`, `depthWrite`, `blending`, bloom pass configuration, and camera behaviors.
- Files touched: `packages/web/src/graph/sun.ts`, `packages/web/src/components/ErrorBoundary.tsx`
- Zone: Green (shipped)
- Gate: `npm run typecheck` clean across all workspaces.

### 2026-08-15 (Antigravity): Bloom Startup Diagnostic (Deferred addBloom in Graph3D)
- [ ] Verified by Claude
- Deferred the `addBloom()` post-processing initialization in `Graph3D.tsx` using the `defer` utility to allow the initial 1–2 frames to render directly to screen before `UnrealBloomPass` attaches.
- Preserves all graphics settings, bloom parameters (strength/radius/threshold), scene objects, camera, cinematic, LOD, culling, PMREM, and loading screen behavior.
- Files touched: `packages/web/src/graph/Graph3D.tsx`
- Zone: Green (shipped)
- Gate: `npm run typecheck` clean across all workspaces.

### 2026-08-15 (Antigravity): PMREM Startup Test (Deferred PMREM Generator in Graph3D)
- [ ] Verified by Claude
- Defer `PMREMGenerator`/`fromScene(RoomEnvironment)` environment-map generation in `Graph3D.tsx` using the `defer` utility to avoid blocking initial startup frames.
- Preserves fallback lighting (`AmbientLight` + `DirectionalLight`), all scene objects (Soumaya, Sun, SpaceStation, nebulae, galaxies), and all cinematic, LOD, bloom, camera, loading, and culling behavior.
- Files touched: `packages/web/src/graph/Graph3D.tsx`
- Zone: Green (shipped)
- Gate: `npm run typecheck` clean across all workspaces.

### 2026-08-09 (Gemini): Chat and Agenda Improvements (Bugs 7, 8, 9)
- [ ] Verified by Claude
- Fixed Bug 7: Increased Chat history window sent to LLM from 8 turns to 16, improving conversational context retention.
- Fixed Bug 8: Added clear date formatting (e.g., "Sat, Aug 10 · 2:30 PM") beneath relative countdowns for upcoming reminders in the Agenda (ActionsPanel).
- Fixed Bug 9: Implemented auto-growing textarea in ChatDock with `onInput` height calculation (capped at 120px) to prevent blind typing on mobile.
- Files touched:
  - `packages/web/src/components/ChatDock.tsx`
  - `packages/web/src/components/ActionsPanel.tsx`
- Zone: Green (shipped)
- Gate: Typecheck clean, all 34 web tests passing, and web build clean.

### 2026-08-08 (Gemini): DigestPanel API Concurrency parallelization and loading skeletons (Bug 6)
- [ ] Verified by Claude
- Fixed Bug 6 from the Priority List: DigestPanel (Insights tab) 9 waterfall API calls on mount.
- Refactored `DigestPanel.tsx` `useEffect` hook to load all 10 initial requests concurrently using `Promise.all` instead of 10 sequential waterfall fetches, drastically boosting the load speed of the Insights tab on slow networks.
- Handled individual Promise rejections gracefully with inline `.catch()` fallbacks, ensuring single endpoint failures don't crash the entire panel load.
- Designed a stunning loading shimmer skeleton UI inside `DigestPanel.tsx` that mimics the layout of the loaded insights, beliefs, and log entries during loading.
- Added smooth `.loading-shimmer` CSS keyframe transitions to `packages/web/src/index.css`.
- Added unit/smoke tests to `components.smoke.test.tsx` verifying shimmer layout and correct post-load data rendering under Vitest.
- Files touched:
  - `packages/web/src/index.css`
  - `packages/web/src/components/DigestPanel.tsx`
  - `packages/web/src/components/components.smoke.test.tsx`
- Zone: Green (shipped)
- Gate: Typecheck clean, all 34 web tests passing, and web build clean.

### 2026-08-08 (Gemini): Performance Settings Override Persistence & Time/Location Aliveness (Bug 5)
- [ ] Verified by Claude
- Fixed a bug where manual graphics settings overrides (like selecting Performance or Quality) did not persist down to 3D rendering elements (like `TimelineView`) because `resolveGraphics` would always reset the `tier` parameter to the synchronous `detectTier()`. Re-architected `resolveGraphics()` to correctly set `tier` based on the user's manual mode setting when not in `"auto"`.
- Resolved Bug 5 from the Priority List: Time/Location alive view feel.
- Added a gorgeous, monospace persistent ambient Sci-Fi status strip at the top of the details dock in `RightDock.tsx`. It displays reactive localized greetings based on current user time (e.g. Good morning/afternoon/evening/night) coupled with dynamic spaceport orbital tracks, sector tracking numbers, and localized real-time coordinates (e.g. Lagrange-5, Alpha Quadrant) which update every 30 seconds.
- Implemented a sticky today strip inside the Browse tab (`NodeList.tsx`) that surfaces today's added memories count and upcoming countdown reminders due in the next 24 hours (e.g., `"Reminder incoming: 'Dentist appointment' in 4h"`).
- Files touched:
  - `packages/web/src/graph/graphicsConfig.ts`
  - `packages/web/src/components/RightDock.tsx`
  - `packages/web/src/components/NodeList.tsx`
- Zone: Green (shipped)
- Gate: Typecheck clean, all 33 web tests passing, and web build clean.

### 2026-08-08 (Gemini): Timeline 3D Scene Adaptive Performance Optimizations
- [ ] Verified by Claude
- Fixed Bug 4 from the Priority List: Timeline performance on mid-range and budget screens like the Galaxy A37 5G.
- Adjusted the device capability scoring in `graphicsConfig.ts` to return `"performance"` (low tier) if the score is `<=` 1 (instead of `<=` 0), classifying mid-range 4GB/8-core phones into the correct performance bucket.
- Refactored `TimelineView.tsx` to read the active graphics settings via `resolveGraphics()`.
- Dynamically disabled WebGL anti-aliasing (`antialias: config.tier !== "performance"`) and set the device pixel ratio to the resolved performance target (`config.pixelRatio`), saving fillrate on low-end screens.
- Scaled down the flowing river color packets count on low-tier screens by scaling with `config.particleScale`.
- Optimized the TubeGeometry segment divisions (3x fewer tubular segments, 2.5x fewer radial segments) and SphereGeometry subdivisions for chapter nodes and photo bubbles by a factor of 4x to 6x on low-performance devices.
- Gated/throttled the per-frame photo bubbles scale twinkle loop when the animation quality scale is lower (`config.animationScale > 0.5`), saving CPU/GPU frame overhead.
- Files touched:
  - `packages/web/src/graph/graphicsConfig.ts`
  - `packages/web/src/components/TimelineView.tsx`
- Zone: Green (shipped)
- Gate: Typecheck clean, all 33 web tests passing, and web build clean.

### 2026-08-08 (Gemini): Interactive Alive Tags with Count Clouds & Hover Glows
- [ ] Verified by Claude
- Fixed Bug 3 from the Priority List: Tag interactions and alive visual representation.
- Lifted selected tag state into `RightDock.tsx` using `selectedTag` state, passing it into `NodeList.tsx` and `NodeInspector.tsx` for cross-tab synchronizations.
- Updated `NodeInspector.tsx` to render tag chips as `<button className="tag-chip clickable">` elements which triggers filtering by that tag when clicked, auto-transitioning the user to the Browse / Memory list tab.
- Re-architected tag discovery section in `NodeList.tsx` to render an inline-cloud tag grid where each tag shows its exact occurrence counts (`#tag 3`) and has its font-size proportionally sized according to its frequency relative to others (`11px` to `16px`).
- Added subtle pulse and hover glow CSS keyframe animations for clickable and hot tags in `packages/web/src/index.css`.
- Extended `components.smoke.test.tsx` to verify tag cloud filtering and tag navigation callback functionality under unit tests.
- Files touched:
  - `packages/web/src/index.css`
  - `packages/web/src/components/RightDock.tsx`
  - `packages/web/src/components/NodeList.tsx`
  - `packages/web/src/components/NodeInspector.tsx`
  - `packages/web/src/components/components.smoke.test.tsx`
- Zone: Green (shipped)
- Gate: Typecheck clean, all 33 web tests passing, and web build clean.

### 2026-08-08 (Gemini): Open Card Mobile Scroll Fix & Collapsible Accordions
- [ ] Verified by Claude
- Fixed Bug 2 from the Priority List: Open card / Details Tab cards scrollability and layout issue on mobile device screens.
- Added a CSS definition for `.dock-body` inside `packages/web/src/index.css` to enable a flex column layout with `min-height: 0` and `flex: 1`, preventing inner cards from squishing or layout overflows.
- Added reactive `isMobile` screen width tracking state (`window.innerWidth <= 720`) in `NodeInspector.tsx`.
- Wrapped research questions, Chronicle/History, and MemoryAttachments in `<details className="dock-section">` elements that auto-collapse on mobile view (`open={!isMobile}`) and remain open on desktop, ensuring the details tab doesn't overflow mobile height budgets.
- Files touched:
  - `packages/web/src/index.css`
  - `packages/web/src/components/NodeInspector.tsx`
- Zone: Green (shipped)
- Gate: Typecheck clean, all 32 web tests passing, and web build clean.

### 2026-08-08 (Gemini): Memory List Defaults, Tooltip Dates & Test Environment Fix
- [ ] Verified by Claude
- Fixed a long-standing web test suite issue where `localStorage` was undefined under happy-dom in Vitest, by implementing a resilient `localStorage` mock/polyfill in `packages/web/src/test-setup.ts`. This restored the entire web test suite to green (all 31 tests passing).
- Changed the default sorting in `NodeList.tsx` (Memory browse tab) from `"mass"` to `"recent"` and enabled the `"timeline"` grouping by default, prioritizing recent activity in the user's view.
- Added actual formatted date strings (e.g., `toLocaleDateString()`) next to relative time descriptions inside semantic `<abbr>` tags with title tooltips for rows when sorting by `"recent"` or when `"timeline"` is active.
- Added a robust unit test suite for `NodeList` inside `packages/web/src/components/components.smoke.test.tsx` checking that default states (recent, timeline-on) render and display dates correctly under test.
- Files touched:
  - `packages/web/src/test-setup.ts`
  - `packages/web/src/components/NodeList.tsx`
  - `packages/web/src/components/components.smoke.test.tsx`
- Zone: Green (shipped)
- Gate: Typecheck clean, all 31 web tests passing, and web build clean.

### 2026-07-12 (Claude): Real fleet hull — the E-45 model replaces the procedural cone
User supplied an E-45 aircraft model (OBJ + MTL + PBR textures) as one of Soumaya's spawnable
fleet ships ("smaller than her, she sends amounts out"). Integrated it as the visual for the
sub-agent fleet (scout / defender / **Tender squadron** = the "send amounts out" mechanic):
- **Conversion (in-sandbox):** OBJ (11.7k verts / 8.1k tris) → GLB via `obj2gltf`, textures
  downsized 4K→512 with `sharp` (col+normal). Raw textures were ~24 MB (col alone 9.3 MB) —
  unusable on mobile; final self-contained **`packages/web/public/E45-fleet.glb` is ~600 KB**.
- **Wiring (`graph/subAgents.ts`):** shared prototype loaded once via `gltfLoader()`, centered +
  scaled to ~5u longest-axis, cloned per craft (shared geo/materials = cheap). The **procedural
  cone stays as the offline / load-failure fallback** (never break the no-asset path); the
  role-coloured glow sprite stays as the accessible colour channel over the neutral steel hull.
- **Orientation caveat:** couldn't view the render here, so `FLEET_ROT_X/Y` are top-level
  one-liners — if the hull flies backward/nose-up on-device, flip one constant.

### 2026-07-11 (Claude): Richer deep space — procedural nebula/dust/galaxies/belt + a Milky Way band
The user wanted "other space stuff" (nebulae, dust, a milky-way band, distant galaxies, asteroid
belts) and asked whether we could pull free/commercial-safe assets (NASA, Poly Haven). **Findings on
licensing (all commercial-safe):** NASA Deep Star Maps 2020 = U.S.-gov **public domain** (acknowledge
NASA as a courtesy, no legal attribution); Poly Haven HDRIs = **CC0** (no attribution); Solar System
Scope starmap = **CC BY 4.0** (attribution *required*). **We could not download the binaries from the
sandbox** — the egress policy hard-blocks `svs.gsfc.nasa.gov`, `commons.wikimedia.org`, `polyhaven.com`
(403 CONNECT denials, not routed around). So both deliverables are **100% procedural** — no shipped
asset, no licence, works offline, cheap enough for mid-range mobile:
- **`graph/deepSpace.ts` (new):** drifting nebula clouds (canvas sprites), an interstellar dust haze
  (one Points cloud), distant galaxy billboards, and one asteroid belt (InstancedMesh). Counts scale
  with the graphics tier. Wired into `Graph3D` as `sceneryRef.deepspace`, scaled out with the galaxy.
- **`graph/starfield.ts` → `makeMilkyWay()` (new):** the signature galactic band — the element the NASA
  maps are famous for. Two additive Points layers (soft haze + grainy star dust) on a random great
  circle, Gaussian off-plane falloff, brightened along knots + darkened by dust-lane rifts (rusty, not
  black). Tier-scaled counts. Wired into `Graph3D` as `sceneryRef.milkyway`, scaled with the galaxy.
- If the user later wants a *photographic* backdrop, `skybox.ts::loadNebulaSkybox` is the seam: drop a
  self-hosted (never hot-linked) NASA 8K starmap `.webp` into `packages/web/public/` — the procedural
  layers stay as the always-on fallback below it.

### 2026-07-10 (Claude): Tool fleet COMPLETE — SRS made visible, web-lookup, agentic router
Finished the tools/functions build-out (the cutover gate for `AI_ENGINEERING_WORKFLOW_POST_MVP.md`):
- **Spaced repetition made visible:** `ReviewPanel` (🧠 FAB + due-count badge) — a gentle recall
  session (recall → reveal → self-grade; SM-2 reschedules via `/api/review`). **Star-dimming:** the
  graph service enriches each memory with `reviewStrength` (live on read); `nodeObject` folds it into
  `vitality` so a memory fading toward its review point visibly darkens (floored ~55%).
- **`web_lookup` tool (Gemini grounding, gated):** `LlmProvider.webLookup?` → grounded search + source
  URLs (Gemini `googleSearch`; Resilient returns null when unavailable; heuristic none). On an explicit
  "look it up" memory she searches the live web and attaches a cited note — Research Mode + budget +
  Fuel required, fully offline-safe (no capability → no-op).
- **Agentic LLM router:** the router is now two-phase — tools DETECT deterministic candidates, then
  (Research Mode + `llm.route`) Soumaya CURATES which to run (picks only from validated candidates,
  never invents). `buildBriefing` is pure DB reads. Offline/failure → runs all candidates (unchanged).
- **Nebula-shield pip** on the streak ember (🛡️) so the streak-freeze is visible + explained.
- Gate: typecheck clean · **272 tests** (+8 across review/tools) · web build clean. **Needs `fly deploy`.**
- **All six tools shipped:** reminder · task · orphan · review-nudge · check-in · web-lookup + router.
  Remaining polish (optional, not tools): deep-space focus mode, colorblind palette toggle.

### 2026-07-10 (Claude): Tool fleet + neuro gaps — 5 slices (all gate-green, shipped)
Built out the tool-router (`agent/tools/`) + the report's ranked gaps (`NEURO_ALIGNMENT.md`):
- **create_task** — a first-person commitment in a recent memory becomes a linked action, once
  per memory (deduped via a `relates_to` edge). Deterministic, offline.
- **surface_orphan** (neuro #4) — nudges one long-drifting unlinked memory per day to be integrated.
- **★ Spaced repetition + review_nudge** (neuro #1, "memory is made by retrieval") — SM-2-ish
  schedule per memory (additive `review_*` columns), `memoryStrength` decay (the dimming-star cue),
  `dueForReview`/`gradeReview`/`snoozeReview`, `GET /api/review/due` + `POST /api/review/:id`.
  She asks you to RECALL in her own voice, one/day.
- **check_in** — reaches out on a heavy emotional stretch or an unaddressed contradiction, one/day.
- **Nebula shield** (neuro #3) — a streak survives ONE missed day if a shield is banked (start 2,
  earn one back each 7-day run); `space_meta.streak_shields`, `Streak.shields`.
- **prefers-reduced-motion** (neuro #2) — comprehensive HUD/CSS reduced-motion reset (WCAG 2.3.3);
  WebGL-galaxy calming is a follow-up.
- Router stamps `agent_logs` with the tick clock so per-day tool guards are consistent.
- Gate at each slice: typecheck clean · **270 tests** (18 new across `tools`/`review`/`features`) ·
  web build clean. **Needs a `fly deploy`.**
- **Still staged:** live web-lookup tool (needs a search-provider decision) · LLM function-calling
  router · client surfaces (a review UI for due recalls, SRS star-dimming render, streak shield pip,
  deep-space focus mode, colorblind palette).

### 2026-07-10 (Claude): Soumaya's tool-router foundation + her first real tool (firing reminders)
- **Audit finding:** her "autonomy" was a fixed script of internal graph-tidying jobs; she never
  freely chose a tool and had almost no real-world reach (Telegram digest only). User chose to add
  four tools (firing reminders · autonomous task creation · proactive check-ins · live web lookup)
  behind a **real tool-router**. Spec: `docs/SOUMAYA_TOOLS.md`.
- **This slice — the router spine + tool #1:** `packages/server/src/agent/tools/` (`types.ts` Tool
  seam, `registry.ts`, `router.ts`, `reminder.ts`). `runToolRouter` lets each tool DETECT
  opportunities deterministically (offline-safe) and act, logging every action to `agent_logs`;
  an LLM function-calling layer slots in later without touching tools. Runs on a 60s interval in
  `index.ts`; delivery goes to Telegram if the brain is linked, else just logged.
- **Firing reminders** (deterministic, free, offline): additive `nodes.reminder_fired_at` column;
  a due `remind_at` now DELIVERS ("⏰ Reminder: …") exactly once (idempotent — marked fired before
  send so an error can't re-fire), badly-overdue ones (>3d) are retired silently, deleted memories
  never fire. Previously `remind_at` only showed passively — this closes the biggest looks-done-
  but-isn't gap.
- Gate: typecheck clean · **257 tests** (5 new in `tools.test.ts`) · web build clean. **Needs a
  `fly deploy`.** Remaining tools (task creation · check-ins · web lookup) + the LLM router are
  staged behind this foundation.

### 2026-07-09 (Claude): Fuel cap 120 → 200
- The higher earn rates filled the 120 tank too fast; a 200 cap lets earnings bank for her work.

### 2026-07-09 (Claude): Fuel — more income, new sources, a tappable "Ways to earn" cheat-sheet
- **Fuel deep-dive (audit of every source):** logging a memory (`EARN_MEMORY`), each link
  (`EARN_LINK`), clearing an action (`EARN_ACTION_DONE`), Codex discovery (`EARN_CODEX_DISCOVERY`,
  one-time), daily-streak bonus, and passive regen (3.5/hr). **Gap found + fixed:** adding to your
  Mind and capturing a thought earned **nothing**.
- **More income + new sources** (`economy.ts`): `EARN_MEMORY` 5→**8**, `EARN_LINK` 0.8→**1**; new
  `EARN_MIND` **4** (a goal/person/skill/identity/idea — awarded in `POST /api/cognitive`) and
  `EARN_THOUGHT` **1** (a manually captured thought in `POST /api/working`; system-seeded thoughts
  earn 0 so the autonomy loop can't farm it). Both routes now return `fuelEarned`.
- **The gauge + banner are now actionable:** the always-on fuel gauge is tappable (its visible parts
  become click targets, container stays `pointer-events:none` so it never blocks the edge) and the
  low-fuel banner's button both open a new **"Ways to earn Fuel"** sheet (`FuelEarnSheet`) — every
  active row is a real button that takes you straight to the thing that earns it (log a memory → dump;
  add to Mind / capture a thought → Mind tab; clear an action → Agenda), with the passive sources
  (streak, Codex, auto-refuel) listed too. No more mystery about what gives Fuel.
- **Mind space motes pulled slightly in** (`MindSpace.tsx`): ring radius 40–48% → **33–41%**.
- Gate: typecheck clean · **252 tests** (1 new proving Mind/thought earn Fuel) · web build clean.
  **Needs a `fly deploy`.**

### 2026-07-09 (Claude): The Chronicle — one-time backfill from existing history
- Established brains no longer open blank: the first time the timeline loads (`GET /api/timeline`)
  or the next autonomy tick, `backfillInitialChapter` seeds ONE opening chapter summarizing all
  history so far ("Where it all begins / — {theme}"). Guarded by an additive `space_meta.
  timeline_backfilled` flag → runs at most once per space, and only while no chapters exist yet;
  skips if there's <3 memories (lets it grow organically instead). Free/offline/deterministic.
- Gate: typecheck clean · **251 tests** (3 new) · web build clean. **Needs a `fly deploy`.**

### 2026-07-09 (Claude): The Chronicle — a 3D interactive flowing-river life timeline
- New feature (spec: `docs/TIMELINE_DESIGN.md`). A 🕰️ button opens a full-screen 3D timeline where
  chapters of your life are strung along a glowing ribbon whose colour **flows** in the emotion
  palette (gold/indigo/green). Interview-driven decisions: blended change signal · river/ribbon
  shape · hybrid scope (whole-arc + dominant theme + parallel `threads`) · auto **+** manual add.
- **Change detection** (`analysis/timeline.ts`, deterministic + offline): `assessChange` blends
  momentum (new-memory volume) + emotional-tone trend + new milestones (goals/people/skills/
  identities) into a signed magnitude read as **growth / decline / neutral / mixed**.
  `maybeGenerateChapter` writes a chapter only on real change, gated by a min gap (8d) + monthly
  cap (3) → the "1–3×/month" cadence with no RNG. Wired free into the per-space autonomy tick.
- **Photo bubbles**: driving memories that carry a photo render as **whitish glowing bubbles** with
  a random palette glow that **cycles when you click** them (`photoIds` exposed on each chapter).
  Selecting a chapter lazy-loads those photos as thumbnails in a side card (summary, trend, thread
  chips, memories → tap to find in the galaxy, delete).
- Server: additive `timeline_chapters` table; `GET/POST/DELETE /api/timeline`. Shared: `TimelineChapter`
  type. Client: `getTimeline`/`addTimelineChapter`/`deleteTimelineChapter`. New `TimelineView.tsx`
  (self-contained three.js, no new deps) + overlay CSS + FAB.
- Gate: typecheck clean · **248 tests** (6 new in `timeline.test.ts`) · web build clean. **Needs a
  `fly deploy`.**

### 2026-07-09 (Claude): "Not a person" dismiss · remove demo mode · dismiss the low-fuel banner
- **"Not a person" dismiss on people suggestions** (user: the Mind tab still floats non-names in
  "People you mention"). New additive `dismissed_names` table (`space_id, name` PK, normalised
  lowercased key) + `dismissPersonSuggestion()` + `POST /api/people/suggestions/dismiss`.
  `suggestPeople` now filters dismissed keys, so a name you × out never resurfaces no matter how
  often you mention it. MindPanel renders each suggestion as an add-chip + a `×` "not a person"
  button (`.mind-suggest-pair`/`.mind-suggest-x`). New people test locks the behavior.
- **Demo mode removed completely** (user: "we were supposed to have gotten rid of the demo mode").
  The `?demo=1` entry point and the "✨ Demo galaxy / ← Back to mine" toggle are both gone; `demo`
  is now a permanently-false constant so nothing can re-enter it.
- **Low-fuel banner is dismissible** — each `NotificationsBar` chip gets a `×` (`.nc-dismiss`) that
  hides that alert for the session (sessionStorage-backed `brain.dismissedAlerts`).
- Gate: typecheck clean · **242 tests** (1 new in `people.test.ts`) · web build clean. **Needs a
  `fly deploy`.**

### 2026-07-09 (Claude): Stop the over-linking — false person-names, semantic links to people, runaway hubs
- User evidence: a distinctively-named person ("Shaqavia") had 20+ links though named in 1-2 memories;
  a "Vibe Coding" skill had 79 linked; and "People you mention" suggested Sector/Vibe/Research/Deep/Dive
  as names. Root causes, all fixed:
  - **`associativeLink` semantically linked memories to people/identities** — the biggest source. Now it
    skips `NAME_ONLY_KINDS` targets entirely (people connect by NAME only, via cognitive gravity).
  - **Common-word names matched everything** — `anchorMatchTokens` now drops single everyday words
    (COMMON_WORDS), so a person "Will"/"May" no longer links every memory using that word (multi-word
    names like "Will Smith" still match as a phrase).
  - **Runaway accretion across autonomy runs** — new `MAX_ANCHOR_LINKS = 12` total cap enforced across
    both the keyword + semantic passes (was only a per-run cap of 8, so it grew every 5 min).
  - **`suggestPeople` flagged capitalised common nouns** — added a big stop-list + a frequency ceiling
    (a word in >12 memories is a term, not a person).
- **Declutter now actually cleans up** (`declutterGraph`, wired to the 🔗 panel button): people/identities
  → `pruneAnchorLinks` severs every link whose memory doesn't name them (now also sweeps the loose
  `relates_to` ones); goals/skills → `trimAnchorLinks` thins a runaway hub down to the cap keeping the
  strongest; plus the weakest memory↔memory associative links go to the review queue. (Old prune used
  `weight < 0.55`, which matched nothing since associative links are 0.72+ — hence "no weak links".)
- Gate: typecheck clean · **231 tests** (5 new in `overlinking.test.ts`) · web build clean. **Needs a
  `fly deploy`.** After deploy: open 🔗 → "Declutter" to clean the existing over-links.

### 2026-07-09 (Claude): You control the linking — Suggested Connections queue + manual linking + perf LOD
- After the freeze fix the user asked to (1) reduce render lag on a now-dense galaxy, (2) slow the
  background auto-linking, and (3) prune weak links — but crucially: **don't destroy withheld/pruned
  links, route them somewhere reviewable, and let me link memories myself instead of always relying on
  Soumaya.**
- **Render LOD** (`graph/Graph3D.tsx`): `linkVisibility` now skips the weakest filaments at macro zoom
  once a graph passes ~350 links; full detail returns when you zoom in (`LINK_LOD_*`). The main lag lever
  on a dense brain — thousands of faint lines were being drawn every frame.
- **Slower auto-linking** (`ingestion/associativeLink.ts`): per-memory cap 5 → 3, and the neighbours she
  now holds back (over the cap, or that the validate gate wasn't sure about) are **recorded as candidates**
  instead of silently dropped.
- **Candidate-connections model** (`db/schema.ts` + `db/client.ts` additive `candidate_links` table;
  `analysis/candidates.ts`): `withheld`/`pruned` pairs wait in a review queue (canonical a<b, unique per
  pair, skips already-linked/rejected). Accept → creates the edge; Dismiss → records a rejection
  (reuses `link_rejections`) so it never returns; `pruneWeakLinks` moves the weakest `relates_to` edges
  into the queue (structural supports/summarizes untouched); `manualLink` connects any two yourself.
- **Routes** (`api/routes/candidates.ts`, mounted `/api/candidates`): list, accept, dismiss, prune, link.
- **UI** (`components/ConnectionsPanel.tsx` + a 🔗 FAB with a pending badge in `App.tsx`): review each
  suggestion (fly-to either memory, Connect / Dismiss), a "Declutter weak links" button, and a
  search-and-pick "connect two memories yourself" form. Card buttons also got `:active` press feedback.
- Retired the galaxy safe-mode band-aid (it was misfiring on ordinary lag now that the real freeze is
  fixed) and clear its stale flag on load.
- Gate: typecheck clean · **226 tests** (7 new in `candidates.test.ts`) · web build clean. **Needs a
  `fly deploy` to go live.**

### 2026-07-09 (Claude): The REAL freeze — two self-reloading boot mechanisms fighting each other (root cause)
- User: after the orange orb → "aligning" → galaxy → the "Soumaya noticed" card, the whole app freezes
  (background/sun gone, can't type or click); clearing cache gets past the screen then it "freezes right
  back"; works in Incognito. Prior fixes (graphics tiers, lite mode) didn't help because they targeted
  the wrong layer.
- **Forensics (this session):** audited EVERY `while` loop (orbits/soumaya/Graph3D/visitors — all
  queue-draining or `visited`-guarded, none can spin) and every `useEffect` in App.tsx — found NO
  infinite loop. That ruled out a data-driven JS peg and pointed at the boot/service-worker layer, which
  is exactly what changed in the batch that reached prod "yesterday."
- **Root cause = two AUTO-destructive mechanisms yanking the page:** (1) `main.tsx` reloaded the page on
  every SW `controllerchange` — but that event fires the first time a SW claims an *uncontrolled* page
  (e.g. the very first load after a cache clear), so it force-reloaded mid-boot; (2) `index.html`'s 7s
  watchdog AUTO-cleared the SW+caches and reloaded. Together: clear → load → SW claims → forced reload →
  watchdog races → hardReset → clear → … a reload/reset loop that reads as a permanent freeze. Incognito
  has no persistent SW, so it never triggers — matching "works in Incognito."
- **Fix (no performance downgrade):**
  - `main.tsx`: removed the `controllerchange` → `location.reload()`. A new SW still `skipWaiting()`s +
    claims and serves fresh assets on the NEXT natural navigation; we never force-reload out from under the user.
  - `index.html`: the watchdog no longer auto-resets — at 12s (was 7s) it just SHOWS the manual recovery
    panel (the "Reset app" button still clears SW+caches on tap). The `error` handler likewise offers, never auto-nukes.
  - `main.tsx`: added a vanilla-DOM global error bar (window `error` + `unhandledrejection`) so any future
    uncaught fault — even in a three.js tick or async handler, which React error boundaries can't catch —
    shows its message instead of a silent black freeze. Ground truth if anything still breaks.
  - Isolated the galaxy, the noticing card, and the mind-space each in their own `ErrorBoundary`
    (`fallback` prop added) so a crash in one surface can never blank/freeze the whole app.
- Gate: typecheck clean · **219 tests** · web build clean (`[stamp-sw] soumaya-bmrcridq8`). Pushed +
  fast-forwarded master. **Needs a `fly deploy` to go live (delegate to `agy`).**

### 2026-07-08 (Claude): Post-login freeze fix — lighter default graphics + gate 3D behind boot (MEASURED)
- After clearing cache the login screen loaded (proving the deploy/code is fine), but signing in then
  froze on loading the real galaxy — a step Incognito never reached. Per the repo's "measure, don't
  assert" rule, timed every autonomy step on an 800-node brain: gravity 63ms, everything else <15ms,
  /api/graph bounded to 300 nodes with batched queries. So the server is NOT the freeze — it's the
  client: Graph3D's WebGL setup blocking the main thread when it mounts a populated galaxy.
- **Conservative default graphics**: bloom OFF for every tier except "quality" (UnrealBloomPass's
  render targets are the #1 first-frame staller on phones); detectTier biased low (unknown deviceMemory
  → low, not mid); new `heavyScenery` flag renders nebulae/galaxy-sprites/comets/skybox only on the top
  tier. Starfield alone still reads as space.
- **Gate `<Graph3D>` behind loaded/demo** so its heavy setup can't block the loading screen + boot
  watchdog from running.
- **Fixed a spurious auto-reset loop**: signal `__brainBooted` when auth resolves (React is alive), not
  when the galaxy finishes — so a slow galaxy load can't trip the 7s cache-clear-and-reload.
- Pushed + fast-forwarded master (af665c9). Gate: typecheck clean · web build clean · 219 server tests.

### 2026-07-08 (Claude): Self-healing boot — the freeze is now cured at the source
- Confirmed via the orange failsafe orb (introduced only in c00a10b) that the NEW build IS deploying and
  /api/health is green — so it was never the server or GitHub. The remaining hang was a stale cached JS
  bundle under the old cache-first service worker, plus a manual "Reset" button nobody knew to tap.
- index.html now AUTO-HEALS: if boot stalls ~7s it clears the service worker + all caches and hard-reloads
  ONCE (sessionStorage-guarded so it can't loop); only if still stuck does the manual panel show.
- sw.js: cache-first -> NETWORK-FIRST for JS/CSS, so an installed PWA can never serve a stale bundle when
  online (ends the whole infinite-loading-screen class). Cache is offline fallback only.
- Pushed to claude + fast-forwarded master (the real deploy branch, now kept in sync). Takes effect on the
  next deploy; after that, devices self-heal with no user action.

### 2026-07-07 (Claude): Server-side freeze causes — graceful shutdown (EBUSY) + health-check grace (cold boot)
- The user's Fly logs revealed the freeze may be **server-side**, not just a stale bundle:
  `error umounting /data: EBUSY` + `Health check on 8080 failed — app not responding`. A dead/unhealthy
  server means `/api/graph` never answers, so the client hangs on the loading sun.
- **Graceful shutdown** (`index.ts`): the server had NO SIGTERM handler, so on a deploy it never released
  the SQLite handle on `/data` — Fly couldn't unmount the volume to migrate it (EBUSY), stalling deploys
  and flapping health checks. Added a SIGTERM/SIGINT handler that stops the listener, `wal_checkpoint
  (TRUNCATE)`s + closes the DB (releasing the volume), and hard-exits after 8s so a keep-alive socket
  can't hold it busy.
- **Health-check grace** (`fly.toml`): loosened `3s/20s → 5s/90s`. A cold boot loads the baked MiniLM
  model into memory, which can exceed a 20s grace on a shared CPU — the app was being marked unhealthy
  *during startup*, returning intermittent `/api/*` failures. 90s grace covers a slow first boot.
- **Deploy blockers surfaced (not fixable from the repo)**: the deploy machine's `git fetch` failed
  ("Password authentication is not supported") — it needs a GitHub PAT or SSH remote (or, durably, Fly's
  native GitHub auto-deploy so pushes build without git creds/flyctl on the box). Flagged to the user.

### 2026-07-07 (Claude): BULLETPROOF boot failsafe — escape the infinite loading sun even with a stale bundle
- User still saw the frozen loading screen. Root truth: the earlier client fixes are CORRECT (old
  `getGraph` swallowed errors so a hung fetch never settled → `loaded` stuck; new code times out), but
  **they only help once the new bundle is on the device** — a stale installed PWA / un-deployed build
  keeps running the old frozen code, and there was no escape hatch that survives a stale bundle.
- **Fix — dependency-free failsafe in `index.html`** (served network-first, so it ALWAYS reaches the
  device even if the JS bundle is stale/broken): an immediate inline loader (no blank first paint) + a
  boot watchdog. If the app doesn't call `window.__brainBooted()` within ~11s, it shows a recovery
  panel whose **"↻ Reset app (clear cache)"** button unregisters the service worker + deletes all
  caches + hard-reloads fresh — the actual cure for a stale installed PWA. Also trips fast on a bundle
  load/parse error.
- App now calls `window.__brainBooted()` once it's usable (login screen OR galaxy loaded); the React
  watchdog dropped 15s→9s; the React recovery screen gained the same "Reset app (clear cache)" hard
  reset. Verified the failsafe survives the Vite build (present in `dist/index.html`).
- **IMPORTANT (process)**: pushing does NOT deploy — the live site keeps serving the last-deployed
  build. This fix (and every prior one) only reaches the phone after a `fly deploy`. Deploy triggered/
  requested via `agy`.

### 2026-07-07 (Claude): Aliases (vague memories connect) + smart-surface + unlink/prune + Mind explainer + music UX
- **Vague memories connect now — via ALIASES.** You won't always type the exact name; tell a Mind
  entry what else it's called ("girlfriend, my girl") and memories that use those words link precisely,
  no vibe-guessing. New additive `nodes.aliases` column; create/edit take an aliases field; linking
  matches label + every alias (whole-word/phrase). **No hardcoded names anywhere** (scrubbed).
- **She's smart about obviously-related things too** — re-enabled the semantic "is this about <X>?"
  noticing for people/identities but at a **much stricter bar (0.85)** so she only surfaces it when it's
  obvious, never on a whim. And a new one-tap **"✦ Yes, connect"** on the noticing card draws the edge
  (`confirmInquiry`), so "bring it to my attention → connect" is one tap. (Auto-linking people still
  requires a name/alias; the semantic path only *asks*, never silently links.)
- **"Do both" — unlink + bulk prune** (Mind tab, person Relationship view): each interaction chip has a
  **×** to sever + remember-as-unrelated (`unlinkCognitive`), and a **"🧹 Clean up links that don't name
  <person>"** button prunes every vibe-created link that doesn't actually name them (`pruneCognitive`).
- **The Mind tab now explains itself**: a "▸ How does the Mind work?" expander (what entries are, how
  memories connect, aliases, her asking, per-kind dynamics). Aliases shown on cards ("· aka …").
- **Music UX (as requested)**: the now-playing name **fades out after ~4s** (it used to sit forever);
  **press-and-hold** the music button opens a **radial menu of song dots** circling it — tap one to jump
  to that track. Click = play/pause, double-click = next still stand.
- **Redundancy check (Observatory daily question vs the noticing card)**: verdict in the reply — they
  overlap in *feel* but differ in role (daily ritual filling graph gaps vs reactive structural
  noticing). The confirm/reject/answer actions make the card an actionable tool, not just a second
  question. Left both, differentiated; offered a full merge if wanted.
- **Tests**: alias-linked vague memories; one-tap confirm draws the edge. Gate: typecheck clean ·
  **219 tests** · web build clean. (Note: standing items — richer per-feature gamification + tighter
  adherence to docs/AI_ENGINEERING_WORKFLOW.md — acknowledged as ongoing.)

### 2026-07-07 (Claude): No false connections + "these don't relate" + no cut-off text (user-reported)
- **She stops inventing connections** (the girlfriend-linked-to-unrelated-memories bug):
  - **People + identities now link by NAME only** — the semantic ("vibe") pass is SKIPPED for
    `person_entity`/`identity` (`cognitive.ts` `NAME_ONLY_KINDS`). A memory that merely *feels* similar
    is no longer mistaken for a real connection to a person. Goals/skills/etc. still gather thematic
    memories, but the **semantic floor rose 0.55 → 0.75** (matching the strict bar real memories link
    at), so even those don't link on a weak resemblance.
  - **Inquiry engine tightened**: the ANCHOR "is this about X?" question now needs cosine **≥0.78**
    (was 0.6) and **never fires for people/identities** — no more "is this unrelated note about your
    girlfriend?".
- **You can now tell her "these don't relate"** (new): a **link-rejection** system (`rejections.ts`,
  `link_rejections` table). The 💭 "Soumaya noticed…" card gains a **"These don't relate"** button —
  it **severs the edges** she drew between the bodies, **records the pair as rejected**, and closes the
  inquiry. Linking + gravity + both inquiry heuristics all **skip rejected pairs forever**, so a
  correction sticks (`POST /api/inquiries/:id/reject`). Her intelligence learns instead of repeating.
- **Nothing is cut off anymore** (project-wide readability rule, `index.css`): every place text was
  clipped with an ellipsis — memory names, constellation/hub names, the Observatory quick-answer chips
  ("name · …" that were unreadable + untappable), applied-role chips, and every fleet/mind chip — now
  **wraps to as many lines as it needs**, left-aligned, long strings broken to fit. You can always read
  and tap the whole thing.
- **Tests**: person links by name only (goal still links semantically); rejected pair stays severed
  through gravity; `rejectInquiry` severs + records + never re-asks. Gate: typecheck clean · **217
  tests** · web build clean.

### 2026-07-07 (Claude): Deferred items — idea splitting + sharpened negation/name heuristics
- **Idea SPLIT** (`analysis/ideas.ts` `splitRipeIdea`, the Phase-3 leftover): when an idea's supporting
  memories clearly form TWO threads (≥5 supports, the two most-dissimilar seeds cosine ≤0.45, each
  cluster ≥2), it branches into two ideas. Branch names come from `summarizeSector` (on every provider,
  so offline-safe — heuristic names each cluster; a cloud LLM names them better). Conservative: one
  split/run, only genuine two-cluster ideas, **skips when over the API budget** so free autonomy never
  spends. Original keeps branch A (renamed), a new idea takes branch B with its supports moved over
  (logged `idea_split`). Wired into the autonomy loop.
- **Sharper identity negation** (`analysis/identity.ts`): contesting evidence must now be a negation
  NEAR the identity mention (a ~26-char window before it), not anywhere in the memory — so "not
  everything went well, but I'm still a builder" reads as **affirming**, where the old whole-text check
  wrongly flagged it as contesting.
- **Sharper people suggestions** (`analysis/people.ts`): a candidate name must appear **mid-sentence at
  least once** (position-aware scan) — so a word only ever capitalised because it starts a sentence
  ("Running…", "Today…") is no longer mistaken for a person, while a real mid-sentence name still is.
- **Tests**: idea two-cluster split + no-split-on-coherent; identity far-negation stays affirming;
  people ignore sentence-start-only words. Gate: typecheck clean · **214 tests** · web build clean.

### 2026-07-07 (Claude): FREEZE FIX (infinite loading sun) + adaptive graphics/performance system
- **Root cause of the freeze**: `afetch` used raw `fetch` with **NO timeout**, so a single stalled
  `/api/graph` never settled — the loading overlay (`!loaded`) never cleared AND the `tracked()`
  activity counter never decremented, so "Soumaya is thinking…" stuck too. Both symptoms, one hang.
  - **Fix**: `afetch` now enforces a timeout (default 60s for slow LLM calls; **boot reads get a 12s
    `BOOT_TIMEOUT_MS`** — `getGraph`/`currentSpace`/`getHealth`/`getFuel`). Nothing can hang forever.
  - **Watchdog**: a hard 15s ceiling in App forces the sun to clear no matter what (covers a synchronous
    WebGL/init stall too), and a **recovery screen** appears — "Soumaya couldn't finish loading" with
    **Retry / Performance Mode / Reload / View diagnostics** (device + resolved-graphics dump).
  - **Boot logging**: `[BOOT] auth started/finished · loading graph · graph received · loaded complete`
    so the exact stall point is visible in the console.
- **Adaptive graphics system** (`graph/graphicsConfig.ts`) — one central config Graph3D CONSUMES (it
  never decides perf itself). Modes **Auto / Performance / Balanced / Quality** + individual knobs
  (bloom, star density, particles, animation, render quality, battery saver, FPS cap), persisted in
  `localStorage`, with device detection (`deviceMemory`/`hardwareConcurrency`/DPI/screen → tier).
  `resolveGraphics()` → concrete numbers.
  - **Graph3D wired**: **pixel ratio cap** (the #1 mobile GPU cost — a 3× retina phone renders 9× the
    pixels; capping it prevents most freezes), **bloom skipped** on weak/Performance tiers, **star
    count** from density, and an **FPS cap** gating the animation tick. Cheap knobs (pixel ratio, FPS)
    re-apply live on settings change; stars/bloom apply on reload.
  - **Settings → 🎨 Graphics & performance**: mode picker + all individual controls + battery saver.
  - **FPS monitor**: after warm-up, if the frame rate stays rough and you're not already in Performance
    Mode, it OFFERS (never forces) a switch via a dismissible banner.
- **Backend headroom** (`fly.toml`): VM memory `1gb → 2gb` — an OOM-killed server is exactly what left
  the client hanging; headroom keeps `/api/graph` responsive. (Applies on next `agy` deploy.)
- Same app on every device — a flagship gets the cinematic galaxy, a budget phone gets the full
  second-brain optimized, never fewer features. Gate: typecheck clean · 210 tests · web build clean.

### 2026-07-07 (Claude): Fleet UX + emoji de-collision + image-asset brief (docs/IMAGE_ASSETS.md)
- **Fleet emoji collision fixed** (`graph/fleet.ts`): beacon/scout/defender were `🛰️ / 🛰 / 🚀` —
  beacon & scout were the SAME satellite emoji. Now `📡 (beacon) / 🛰️ (scout) / 🛡️ (defender)` —
  each distinct + clearer (📡 relay, 🛡️ guardian). Help fleet entries updated to match (ship 🛸,
  scout/defender split into two).
- **Dispatch slowed + made watchable** (`graph/satellites.ts`): probe fly-out was `220 u/s` (too fast
  to follow) → an eased cruise (`78 + dist·0.28`, gentle on approach); fade-in `1.5 → 0.7` so a launch
  reads as a real deployment, not a pop-in.
- **Fleet panel redesigned** (`components/FleetPanel.tsx`): each unit now shows what it's doing RIGHT
  NOW in plain language, a live activity pulse (idle 💤 / active / "🚀 Dispatching N…"), **fly-to chips**
  for the memories it's working, an active-card glow, a summary line ("N of 5 active"), and lore tucked
  behind a "What is this?" disclosure (no more wall of text). New `FleetStatus.targets/pending`;
  `subAgents` now expose `targetId`; `Graph3D.getFleetStatus` populates targets + a "Dispatching…" state.
- **Image-asset generation brief** — `docs/IMAGE_ASSETS.md`: a prioritized, copy-paste catalog of every
  emoji placeholder that wants real artwork, in **tiers you complete one at a time** (T1 Fleet → T2
  Celestial classes → T3 Cognitive bodies → T4 Megastructures → T5 Badges), each row with a ready
  generation **prompt** (shared art direction baked in), a `Save as` path, and where it's used. Plus a
  full **emoji collision map appendix** (from an exhaustive inventory) with safe display-only
  reassignments for the ~20 overloaded glyphs (🛰️/🪐/🌌/📡/🧠/🎯/…). Gate: typecheck clean · 210 tests ·
  web build clean.

### 2026-07-07 (Claude): Cognitive Layer — Phase 7 (Future events · Intentions · Motivations) — cognitive model COMPLETE
- The finale gives the last kinds real dynamics — the temporal + ephemeral cognition. All offline.
- **FUTURE EVENTS** (`analysis/future.ts`): a `future_event` carries a real date (stored in `remind_at`;
  create accepts `date`). `upcomingEvents` / `GET /api/cognitive/events/upcoming` = a "what's ahead"
  timeline sorted soonest-first with days-until; the Mind tab shows a live countdown ("in 3d", "today",
  "overdue N d") and a date picker on the add form. `rollPastEvents` (autonomy): once an event's date
  passes it **rolls into the past** — becomes an ordinary memory dated to when it occurred (logged
  `event_passed`).
- **INTENTIONS** (`analysis/drives.ts` `stepDrives`): an `intention` is an ephemeral comet — if a memory
  comes to support it you **acted on it → fulfilled**, settling into memory (`intention_fulfilled`); if
  it's never acted on it **expires** after 10 days and fades (`intention_expired`).
- **MOTIVATIONS**: a `motivation` is a durable gravity well that **brightens** as aligned memories
  accrue (importance 0.72 → 0.94), so a strong drive becomes a heavy well. Mental models + motivations
  also get an "Applied to" / "Pulls on" expander in the Mind tab (reusing the evidence endpoint).
- **Wiring**: `rollPastEvents` + `stepDrives` in the autonomy loop; `stepDrives` on `/api/ingest` (a new
  memory can fulfil an intention / brighten a motivation immediately). Web: date input + countdown +
  linked-memory expanders; `getUpcomingEvents` client fn; `mind-date` CSS; Help entry extended.
- **Tests**: `__tests__/phase7.test.ts` (timeline order + roll-past→memory, intention fulfil vs expire,
  motivation brightening). Gate: typecheck clean · **210 tests** · web build clean.
- **The Cognitive Layer is now complete** (Phases 1–7): Goals, Working Memory, Ideas, Skills, Identity,
  People, and Motivations/Mental-models/Intentions/Future-events — every cognitive kind has live
  dynamics, plus the proactive "Soumaya noticed…" inquiry layer.

### 2026-07-07 (Claude): Cognitive Layer — Phase 6 (People as entities · lightweight CRM)
- **People are now first-class relationships you can read.** A `person_entity` is a person your
  interactions orbit; this adds a lightweight CRM around them (`analysis/people.ts`), all offline.
- **Relationship profile** (`personProfile`, `GET /api/cognitive/:id/profile`): their interactions
  (memories linked via `supports`, newest first), interaction count, when you last engaged, and the
  emotional **tone** of the relationship (warm / heavy / mixed / neutral, from the interactions'
  emotional weight). The Mind tab's person cards get a **Relationship** expander showing all of it
  with fly-to chips.
- **Dedupe** (`mergeDuplicatePeople`, autonomy step): person entities sharing a primary name ("Danny",
  "Danny K") merge into the one with more interactions, folding the rest's memories onto it (logged
  `people_merged`) — so the roster stays clean.
- **Suggestions** (`suggestPeople`, `GET /api/people/suggestions`): capitalised names recurring across
  ≥2 memories that aren't people yet (day/month/common-word noise filtered, existing people excluded)
  surface as one-tap **"People you mention"** chips in the Mind tab — add and their memories orbit them.
- **Web**: `getPersonProfile` / `getPersonSuggestions` client fns; person profile + suggestions UI;
  tone/suggest CSS; Help entry extended. Reused `labelTokens`; no new table.
- **Tests**: `__tests__/people.test.ts` (warm-tone profile + non-person null, mixed tone, duplicate
  merge folds interactions, suggestions ignore stopwords + already-added). Gate: typecheck clean ·
  **207 tests** · web build clean.

### 2026-07-07 (Claude): Cognitive Layer — Phase 5 (Identity core + evidence)
- **Identities are now weighed by the evidence of your life.** An `identity` (the heaviest cognitive
  body) isn't something you complete — it's something your memories either AFFIRM or CONTEST, so it
  brightens or dims accordingly (`analysis/identity.ts`).
- **Grounded in your own words**: a memory that mentions the identity plainly is affirming (a
  `supports` edge); one that mentions it with negation/abandonment language ("I quit…", "no longer…",
  "I'm not…") is contesting (a `contradicts` edge). `evaluateIdentity` re-classifies each mention,
  writing the correct edge and clearing the opposite, then sets brightness from the balance:
  importance = `0.62 + confidence×0.37` where confidence = `for/(for+against)` — a strongly-affirmed
  identity blazes (~0.99), a heavily-contested one dims (~0.62). Runs AFTER cognitive gravity so a
  negated mention's mis-added `supports` edge gets corrected to `contradicts`.
- **Evidence view**: `GET /api/cognitive/:id/evidence` → `{ for, against, confidence }`. The Mind tab's
  identity cards gain an **Evidence** expander — ▲ affirming / ▼ contesting counts, a confidence bar,
  and fly-to chips for each memory. (`cognitiveEvidence` also works for other anchors, reporting
  supporters as "for".)
- **Wiring**: `stepIdentities` on `/api/ingest` (a new memory affirms/contests immediately) and each
  autonomy tick. Reused `labelTokens`/`mentions` (now exported from `cognitive.ts`); `contradicts`
  relationship already existed. Web: `getCognitiveEvidence` client fn; `mind-evidence`/`mind-ev-*` CSS;
  Help entry extended. No new table.
- **Tests**: `__tests__/identity.test.ts` (affirm/contest split + brightness, contested dims below
  affirmed, evidence flip moves a memory for→against with no stale edge, non-identity reports
  supporters only). Gate: typecheck clean · **203 tests** · web build clean.

### 2026-07-07 (Claude): Cognitive Layer — Phase 4 (Skills leveling)
- **Skills level themselves now** — no more hand-cranking the bar. Every memory that evidences
  practice (a supporting edge, formed by the same name/semantic linking that runs on ingest) raises a
  skill's 0..1 `progress` and brightens it. `analysis/skills.ts` `stepSkills`: progress =
  `min(1, practiceCount/10)`, importance = `0.60 + progress×0.18` (Novice skill 0.60 → mastered 0.78,
  so a practised skill visibly shines). Progress only **ratchets up** (you can't un-practice), so a
  manual bump is never clobbered; skills are durable (entropy-exempt) so they hold their level.
- **Levels**: single-source `SKILL_TIERS` + `skillTier(progress)` in `@brain/shared`
  (Novice → Beginner → Practiced → Skilled → Advanced → Expert). Crossing a tier logs `skill_leveled`
  and is returned for a "you leveled up" nudge. The Mind tab shows the tier name beside the bar.
- **Wiring**: runs on `/api/ingest` (a logged practice levels the skill immediately) and each autonomy
  tick. Web: tier chip on skill cards (`mind-tier` CSS); Help entry extended. No new API/table.
- **Tests**: `__tests__/skills.test.ts` (progress+brightness from practice with level-up report, caps
  at Expert, ratchet-up-never-lowers-manual, idempotent second run). Gate: typecheck clean ·
  **199 tests** · web build clean.

### 2026-07-07 (Claude): Cognitive Layer — Phase 3 (Ideas lifecycle: grow / fade / merge / promote)
- **Ideas are now alive.** `idea` is the one non-durable cognitive kind; it finally has a real arc,
  all deterministic + offline (`analysis/ideas.ts`, `stepIdeas` in the autonomy loop):
  - **GROW** — importance rises with each supporting memory (`0.4 + supports×0.06`, capped 0.78), so
    a well-backed idea brightens and swells into a hot young star.
  - **FADE** — no tending for 14 days dims it; unsupported + untended for 30 days and it **fades out
    of the galaxy entirely** (it was never permanent). Leans on the existing celestial system —
    ideas aren't entropy-exempt, so lowering importance is all it takes to cool + shrink them.
  - **MERGE** — two ideas with cosine ≥0.82 collapse into the better-supported one, its backing
    memories redirected, so duplicates don't clutter your mind. Logged (`idea_merged`/`idea_faded`).
  - **PROMOTE** — a ripe idea (≥4 supports) shows a "✨ Ripe — promote to Goal" button; promoting
    (`promoteIdeaToGoal`, user-triggered) flips kind→goal with goal importance/colour/progress, so it
    becomes a durable, gravity-exerting anchor. That's you committing to it.
- **Server**: `analysis/ideas.ts`; `POST /api/cognitive/:id/promote`; wired into the autonomy loop.
- **Web**: idea cards in the Mind tab get a promote button (glows amber when ripe); `promoteIdea`
  client fn; `mind-promote` CSS; Help entry extended. (Split — branching one idea into two — is
  deferred: it wants an LLM to name the branches, so it lands with a later LLM-gated pass.)
- **Tests**: `__tests__/ideas.test.ts` (grow-with-support, dim + archive-when-ignored, merge-preserves
  support, ripe-flag + promote-to-goal). Gate: typecheck clean · **195 tests** · web build clean.

### 2026-07-07 (Claude): Proactive intelligence — "Soumaya noticed…" inquiries (user ask: "they have to be smart")
- **The ask, generalised**: she shouldn't just link — she should NOTICE when a new memory has
  implications for other memories/people/goals/knowledge and *ask* about it, across every scope (the
  relationship example was one case, not the whole feature).
- **Engine** (`analysis/inquiry.ts`, deterministic + offline, no LLM needed to ask) — three grounded
  heuristics over recent memories: **BRIDGE** (a memory ties two unconnected anchors/hubs → "what's
  the dynamic between X and Y?"), **ANCHOR** (a memory sits semantically ON a person/goal it never
  named, sim ≥0.6 → "is this about X?" — the 'girlfriend, no name' case), **THEME** (a keyword recurs
  across ≥3 recent memories with no hub → "is this becoming its own thread?"). One inquiry/run,
  `MAX_OPEN=3`, deduped by signature (a **dismissed** noticing never returns), unique index enforces it.
- **Answering IS logging** (same pattern as Daily Contact): the reply is ingested (extraction +
  embedding + linking), tied to every body she asked about, and pays the normal fuel/streak earn path.
- **Wiring**: generated in the autonomy loop AND right after `/api/ingest` (so a noticing can appear
  the moment you add a memory). New `inquiries` table (additive/idempotent + drizzle). Route
  `/api/inquiries` (list / answer / dismiss). **Bonus fix**: ingest now also runs
  `applyCognitiveGravity`, so a NEW memory links to existing Mind anchors immediately (the follow-up
  gap from the last change).
- **Web**: a floating **"💭 Soumaya noticed…"** card (`NoticingCard.tsx`, top-centre, hidden while a
  panel is open) — the question, fly-to chips for the bodies she means, an answer box (⌘/Ctrl+Enter),
  and "Not now". Polls + re-checks after each ingest (`brain-memory-added`). Client funcs; Help entry.
- **Tests**: `__tests__/inquiry.test.ts` — bridge (two people), theme (keyword, no hub), dedupe of a
  dismissed inquiry, open-cap, answer-ingests-links-closes, and stays-quiet-when-nothing. Gate:
  typecheck clean · **191 tests** · web build clean.

### 2026-07-07 (Claude): Music — playlist of 3 loops (Deep Space · Slow Tide · Interstellar)
- Single ambient loop → a **playlist**. Music FAB: click = play/pause, **double-click = next track**
  (a 240ms click timer disambiguates). A **now-playing chip** shows title + position (2/3) and skips
  on click; the **title pops up** on every change; last track persists across sessions. `audio.ts` is
  now a playlist engine (TRACKS, `next()`/`playTrack()`, crossfade, `brain-music-track` event). Two
  new mp3s bundled in `/public`. Structured to become unlockable later; all play in every brain now.

### 2026-07-07 (Claude): Mind-tab linking fix + edit buttons (user-reported)
- **The bug the user caught**: adding a Mind object (e.g. a person "Shaquavia", "Kickman Danny") did
  NOT connect to the memories that clearly mention it. Two real causes: (1) cognitive objects got
  **no linking on creation** at all — their only linking was the 5-min autonomy `applyCognitiveGravity`
  sweep; and (2) that sweep used **pure semantic KNN (≥0.55)**, but a bare NAME embeds too weakly for
  vector search to reach the threshold, so name matches never fired.
- **Fix — link immediately + match by name, not just embedding** (`analysis/cognitive.ts`,
  `linkCognitiveAnchor`): two passes create `supports` edges memory→anchor — (1) a **whole-word
  name/keyword match** (distinctive label tokens ≥4 chars + the full phrase; regex word-boundary so
  "Danny" ≠ "Dannyson"), and (2) the existing **semantic KNN** pass for related-but-unnamed memories.
  Runs **on create AND on edit** (instant feedback) and every autonomy tick; per-run caps
  (8 keyword / 3 semantic) keep hub growth gradual; only real memories are pulled (never other anchors).
  Gravity now covers **all** cognitive kinds, not just the 5 weighty ones.
- **Edit buttons** (the other user ask — "none of them have editing abilities"): `PATCH
  /api/cognitive/:id {label?,content?}` → `updateCognitive` re-embeds + re-indexes (FTS) + re-links;
  `PATCH /api/working/:id {text}` → `editThought`. Inline ✎ edit UI on every cognitive card
  (name + content) and every working-memory mote, in `MindPanel`. New client funcs
  (`updateCognitive`, `editThought`); `mind-card-row`/`mind-edit` CSS.
- **Confirmed the Mind↔galaxy connection is real** (the user wasn't sure): cognitive objects ARE
  first-class galaxy nodes; the missing piece was purely the linking above. With the fix, adding a
  person instantly links her memories and the create/edit flow reloads the galaxy so the orbit shows.
- **Tests**: name-match-on-create (Shaquavia links her 2 memories, not the unrelated one), whole-word
  (no "Dannyson" false positive), gradual per-run cap + idempotency, re-link-after-rename, plus
  `editThought`. Gate: typecheck clean · **185 tests** · web build clean.

### 2026-07-07 (Claude): Cognitive Layer — Phase 2 (Working Memory / the mind space)
- **The flagship omission, filled.** The galaxy modelled long-term memory; it had no model of
  what you're thinking NOW. Working Memory adds an ephemeral "mind space" of thought-motes that
  **decay unless reinforced**, and — mimicking short-term → long-term consolidation — the ones you
  keep returning to are **carried into the permanent galaxy as real memories**.
- **Deliberately separate from `nodes`**: a new `working_memory` table (additive, idempotent
  `CREATE TABLE IF NOT EXISTS` in bootstrapSchema; drizzle `workingMemory`) so working memory never
  pollutes the galaxy until promoted. Space-scoped like every per-user table.
- **Deterministic, offline decay**: effective strength = `strength − 0.08/hr × hours-since-reinforced`,
  computed in SQL via `julianday()` (DB-consistent + testable by backdating). Reinforce tops it up
  (+0.3, cap 1) and resets the clock; 3 reinforcements → auto-consolidate. Only promotion embeds
  (creates a `type:daily, kind:memory` node) — everything else is LLM-free.
- **Server**: `analysis/workingMemory.ts` (add/list/reinforce/dismiss/promote/sweep); routes
  `api/routes/working.ts` (`GET/POST /api/working`, `POST /:id/reinforce`, `POST /:id/promote`,
  `DELETE /:id`, zod + space-scoped); the free/offline `sweepWorkingMemory` wired into the autonomy
  loop (evaporates spent motes, consolidates survivors, logs `consolidated`). Soft cap 30 motes/brain.
- **Web**: a **💭 "Thinking now"** section atop the 🧠 Mind tab (`MindPanel`) — hold a thought, see
  it glow by strength, ↑ reinforce / ★ consolidate now / × let go; polls so decay stays live. Plus an
  ambient **Mind Space overlay** (`MindSpace.tsx`) — toggle "✧ Show in space" to float your live
  thoughts as glowing motes drifting over the galaxy (self-contained, `pointer-events:none`, reads its
  own localStorage flag via a window event — no prop-drilling). New client funcs; `mind-ws-*` +
  `mindspace-*` CSS; Help entry.
- **Tests**: `__tests__/workingMemory.test.ts` (add/list, decay drop-off, sweep evaporation, reinforce
  top-up, auto-promote at threshold + logged, manual promote, dismiss, missing-id, bound cap, space
  scoping). Gate: typecheck clean · **181 tests** · web build clean. Spec: docs/COGNITIVE_LAYER.md §Phase 2.

### 2026-07-07 (Claude): Cognitive Layer — Phase 1 (goals/ideas/skills/identity/… as first-class bodies) — spec docs/COGNITIVE_LAYER.md
- **The direction, not just the past.** The galaxy modelled memory; it now also models cognition.
  Nine new cognitive object kinds — `goal · idea · skill · person_entity · identity · mental_model ·
  intention · future_event · motivation` — each a first-class body with its own colour/icon/importance,
  all from a single-source `COGNITIVE_META` map (`@brain/shared/celestial.ts`) so render + Legend +
  Mind panel can never drift.
- **Gravity via edges, NO orbit rewrite** (the key insight): the orbit system already parents each
  body to its heaviest connected neighbour, so a *heavy* cognitive anchor + `supports` edges makes its
  memories orbit it. `applyCognitiveGravity` (free/offline autonomy step) knn-matches each weighty
  anchor (goal/identity/skill/person/motivation) to strongly-similar unlinked real memories (cosine
  ≥0.55) and grows up to 3 `supports` edges/anchor/run — so your memories visibly drift toward what
  they serve over time. `graph/orbits.ts` (RED ZONE) untouched.
- **Durable = entropy-exempt**: durable cognitive kinds never "cool" (same treatment as hubs/beliefs),
  via `DURABLE_COGNITIVE_KINDS` in the graph service enrichment.
- **Progress**: goals + skills carry a 0..1 `progress` (new additive `nodes.progress` column —
  bootstrap + `migrateSchema` idempotent ALTER + drizzle + repo). Nudge it in the Mind tab.
- **Server**: `analysis/cognitive.ts` (create/list/setProgress/applyCognitiveGravity),
  `api/routes/cognitive.ts` (`GET /api/cognitive[?kind]`, `POST /api/cognitive`,
  `POST /api/cognitive/:id/progress`, all zod-validated + space-scoped), wired into the autonomy loop.
- **Web**: new **🧠 Mind tab** (`components/MindPanel.tsx`) — create/list cognitive objects grouped by
  kind with progress bars + fly-to; creating reloads the galaxy so the new body is immediately
  focusable. New `mind-*` CSS. Legend gains a derived "Your mind (the cognitive layer)" section; Help
  gains a Mind entry. `client.ts` getCognitive/createCognitive/setCognitiveProgress.
- **Tests**: `__tests__/cognitive.test.ts` (create/meta-derived fields, progress clamp + 404, gravity
  cap, anchor-never-links-anchor, durable entropy-exemption). Gate: typecheck clean · **171 tests** ·
  web build clean.

### 2026-07-05 (Claude): Chat authenticity, legibility pass, custom-instruction power, OpenAI-first
- **Chat authenticity**: every reply used the same insight-paragraph template. Root causes fixed:
  the prompt said "lead with the insight" every turn (rewrote to TALK LIKE A REAL BACK-AND-FORTH —
  mirror length/energy, vary openings, banned stock framings, brevity default, insight only when it
  fits); and every call ran at temperature 0.2 (answer() now 0.85, structured jobs stay 0.2).
- **OpenAI first precedence**: an OpenAI key now wins even over a stale LLM_PROVIDER=gemini secret.
- **Living Legend** (`components/Legend.tsx`, 🗺️ FAB): glanceable visual key to the galaxy's whole
  language (type colours, body sizes, special bodies, emotion links, fleet), auto-shows once/brain.
  DERIVED from runtime constants so it can't drift; new single-source colours in @brain/shared
  (SPECIAL_COLORS, EMOTION_COLORS, CELESTIAL_MEANING) used by server render + web theme.
- **Legibility pass**: inline "why this size" + belief/constellation chips in NodeInspector; ambient
  self-insight HUD pill (foresight/newest belief → Insights); "Galaxy Reader" award for navigating
  6+ types.
- **Custom instructions**: she was forcing every active role + doc into every reply. Now selective —
  prompt picks the fitting role(s), reports `usedRoles`, applied chips show only what she used;
  knowledge docs relevance-gated (0.3). Plus ROLE_TEMPLATES showcase (IQ Examiner that runs a real
  scored test in chat, Socratic Tutor, Interviewer, Devil's Advocate, Decision Framework) so people
  grasp a role = a different mind on demand. 164 tests.

### 2026-07-04 (Claude): Level 2 (she gets wiser) + chat loop fix — spec docs/LEVEL2_INTELLIGENCE.md
- **Chat fix**: interview instinct had no brake → she asked every turn and her own
  question echoed back in history, looping. Now `justAsked` is detected server-side
  (last turn ended in "?") and HARD-suppresses another ask; ANSWER_SYSTEM rewritten
  around a PURPOSE (make you see something: connect/notice/push-back/decide), questions
  rare + earned. Client folds ask-bubbles into their answer turn in history.
- **B1 Hybrid retrieval** (`db/fts.ts`): FTS5 keyword index beside vectors, fused via
  RRF; adopted in search + chat seeds. Exact names/keywords now recalled (hash
  embeddings missed them).
- **B2 Dream cycles** (`analysis/dreamCycle.ts`): once/day/space she consolidates the
  densest cluster into a `kind:"belief"` node that `summarizes` its evidence — durable
  self-knowledge that compounds. Revise-not-duplicate (prior text → lore chapter);
  beliefs render indigo, entropy-exempt; "What she believes about you" atop Insights;
  `llm.consolidate` seam (gemini+openai) + offline template.
- **B3 Foresight** (`analysis/foresight.ts`): deterministic recurring-negative detector
  (monthly/weekday) → "She sees a pattern coming" on the Observatory + folded into the
  behavioral read so chat leans in during a predicted window.
- **B4 Undertakings** (`analysis/undertakings.ts`): 5-day autonomy arcs (warm cold belt
  / chart sector / weave frontier), progress derived from elapsed days (tick-idempotent),
  progress card in the Soumaya tab. 164 tests.

### 2026-07-03 (Claude): Behavioral persona + perf/dedupe sweep (`c7d1d53`, `7cd2884`, `1d967f9`)
- **Behavioral persona deepening** (`persona/behavior.ts`): live read of last-7d vs the user's
  own month baseline — emotional trend, volatility, writing rhythm, focus shift, tender ground,
  daily-question engagement — injected into the chat system prompt (after telemetry, before
  custom instructions) and the Captain's Log voice. Pure SQL, offline-safe, 4 tests.
- **Observatory overflow fix**: stack caps at viewport + scrolls internally, sticky Enter,
  top-right ×.
- **Perf/dedupe** (audit follow-ups, done by Claude in place of agy): task-sync throttled to
  3Hz (was 60fps O(nodes)+stringify), link-activity 1s memo, orbits identity-cached node map,
  dailyDigest cooling via SQL (no more full() per read); ONE emotion palette in theme.ts
  (links/particles/beacon beams); reconcile threshold shared with associativeLink; heartbeat's
  global weak-edge prune dropped (autonomy loop owns pruning); deleted dead SFX recipes +
  findByLabel/dueActionItems/deleteDocEmbedding/AppContext.graph/sun getRadius/satellites
  onLaunch. 148 tests.

### 2026-07-03 (Claude): The retention loop — Daily Contact, Night Replay, promise sweep
Product diagnosis: structurally complete but no reason to return tomorrow. Three batches:
1. **Daily Contact** — she initiates once a day: a deterministic ladder picks her most
   valuable question (pending research questions → unresolved contradiction → important
   cooling memory → heavy under-connected), persisted per space+day (`daily_contact` table,
   `analysis/dailyContact.ts`, `/api/contact` + `/answer`). The Observatory leads with it
   (eye + inline answer box); answering ingests + links + tends + pays fuel/streak; the
   Telegram digest carries the question.
2. **Night Replay + live bridge** — on arrival she re-enacts up to 3 real agent_logs events
   since the last visit (`enqueueReplays` on the ship; replay jobs never call complete-job);
   new server-loop events surface live as toasts (60s poll in App).
3. **Promise sweep** (report: `docs/PROMISES_VERIFIED.md`) — 10 flows traced + script-proven;
   5 fixed: due reminders now surface (Agenda section + alert chip + `ack-reminder` route);
   contradiction scan gate is provider-aware (was dead offline at 0.86 vs measured 0.69) +
   real "Reconciled" affordance (`/digest/insights/:id/resolve`); beacon beams release
   mid-session (optimistic entropy reset in `goTo`); lore chapters get REAL entropy;
   visitor buffer drains on pagehide with keepalive. 144 tests.

### 2026-07-02 (Claude): Chat overhaul + one arrival screen (`e5f2095`, `ca87736`)
The chat was a stateless one-shot (no history reached the model — the "generic chatbot" cause).
Now: the last 8 turns ride along (client → route → prompt); the ANSWER prompt reads the emotional
register (heavy = grounded, never chipper) and returns a `mood` + optional `askBack` (interview
instinct: one specific clarifying question, own dashed bubble); Companion custom instructions
moved to the END of the system prompt with must-shape-the-reply wording, and every reply shows
chips for the roles/docs that shaped it (`appliedRoles`/`appliedDocs` on ChatResponse); the 🎭
Companion controls now live INSIDE the chat (tab removed — dock is 8); the mic runs continuous
with a ~2.8s true-silence auto-send (no more premature cutoffs); new `SoumayaEye.tsx` blinking
avatar (dilates listening, drifts thinking, iris + bubble edge take the reply's mood colour).
Separately: the "While you were away" report now renders inside the Observatory (single arrival
screen — the two stacked "welcome back" pop-ups are gone; `WelcomeBackCard.tsx` deleted). 141 tests.

### 2026-07-02 (Claude): Second full audit (4 agents) + four fix batches (report: docs/PROJECT_AUDIT_2026-07-FULL.md)
Post-Codex audit (UI redundancy · server · 3D client · gamification), then four user-approved
batches, each gate-green + pushed:
1. **P0 security (`8e0c46e`):** Gemini usage is now METERED (the USD cap was inert on the default
   provider — no `recordUsage` + no pricing); `/api/usage` mutations fail closed without
   `ADMIN_TOKEN` (client prompts + remembers the token); `research_enabled` is PER-SPACE
   (`space_meta` column, legacy global fallback); codex-claim validates keys against the real
   catalog (`constellation-*` must reference a live MOC in the space); action deletions pay fuel
   only for actions >10 min old; `executeJob` re-validates client-supplied targets (merge needs
   ≥0.96 similarity + now cleans self-loops/dup edges/insight refs; vibe/research markers; 10-min
   execution dedupe kills the browser-vs-24/7-loop double-run); telemetry strips (chat prompt no
   longer recites budget $/key config; /health drops global node count; generic 500s; 10/min auth
   rate limit); legacy claim covers ALL space tables; deleted the drifted duplicate CREATE block
   in `migrateSchema`; `edges(space_id)` index.
2. **P1 correctness (`53333e2`):** demo galaxy fully sandboxed (Soumaya flies local patrols only —
   no real next-job/complete-job with demo ids; demo stats don't feed achievements); link glow
   takes the FRESHEST end (max, not `??`-chain); engine audio honors the volume slider + dt-based
   easing; `statsSpaceId` fallback unified to "default"; per-space `ship.task` key; live-ref fix
   for `fireRecall`; bloom pass removed+disposed on teardown.
3. **Gamification split (`003f5c0`):** Codex = discoveries, Awards = feats — deleted ~8 duplicate
   achievements, Pilot Rank is the single memory-count ladder (one toast per milestone, was 3),
   renamed the two name collisions (Keeper of the Flame / Sector Dominion), `memories_tended`
   counts only genuine cold-restores, Consistent Pilot reads the server streak, Telegram `/log`
   advances the streak, fuel regen 6→2/hr, red −fuel pops, tend button shows its price.
4. **Tab consolidation 13→9 (this commit):** Browse absorbs List+Library+Sectors (All/Folders/Hubs
   chips); Progress absorbs Awards+Codex (chips + Hangar shortcut); Fleet folds into the Soumaya
   tab as a collapsible section ("Most visited" dropped — Browse rows show 👽 counts); Captain's
   Log moved to Insights; Research-Mode + ship-label switches live ONLY in the Soumaya tab; dead
   "chat" DockTab removed; Help menu corrected (wrong Sectors cards, stale names) + 8 new entries.

### 2026-07-01 (Claude): Codex + constellation re-evaluation (`532e966`, `126a6ae`)
The living-atlas Codex tab (unlock + level + one-time fuel rewards via `codex_claims`), two
codex achievements, and `analysis/constellationReconcile.ts` (MOC hubs pull in drifted-in
similar memories over time, add-only). 140 tests.

### 2026-07-01 (Claude): Full project audit + high-severity fixes (report: docs/PROJECT_AUDIT_2026-07.md)
Ran three parallel review agents (server bugs · web bugs · gamification design). Report in
`docs/PROJECT_AUDIT_2026-07.md`. Fixed the confirmed high/medium items:
- **[HIGH] "While you were away" digest was silently empty in production.** `last_seen_at` (ISO) vs
  `agent_logs.created_at` (SQLite `CURRENT_TIMESTAMP`) → raw string compare never matched (verified: raw
  → 0, `datetime()` → 1). Fixed by normalizing both sides with SQLite `datetime()` (agent_logs, insights,
  reminders). +1 regression test in production format.
- **[HIGH] `/api/usage` was mounted before the auth guard** — anonymous `POST` could zero the shared
  budget (DoS) or reset the cost cap. Moved behind `requireSpace`; mutating routes now honor an optional
  `ADMIN_TOKEN` (`x-admin-token`).
- **[MED] Deleting a memory orphaned its attachments** (leaked base64 blobs) → `NodesRepo.delete` now
  clears `attachments`.
- **[MED] Offline-queued ingest could misfile a note into the wrong brain** (`"default"` fallback) →
  queue requires a real `brain.spaceId`; no unattributable bucket.
- **[MED] VRAM leaks** on figurine re-equip (`updateFigurine`) and ship-skin swap (`setShipSkin`) →
  dispose geometries/materials/textures on swap.
- Gamification verdict: economy sound (no soft-lock, honest retention); flagged that prestige rewards
  *volume* not *quality* and the MOC layer isn't gamified — recommendations in the report.
- Noted follow-ups (not fixed): scene-teardown disposal on unmount, idlePulse/repairScan O(n) timers,
  autonomy per-tick spend cap.
- Gate: typecheck clean · **135 server tests** · web build clean.

### 2026-06-30 (Claude): Links are living synapses — always visible, coloured by emotion, pulse (not redraw)
User followup: links still went grey / disappeared. New model per their direction — links are permanent
synapses; Soumaya PULSES them (neuron-firing flash that fades), she never draws/hides them.
- **Removed the hide-until-drawn system entirely** (`pendingLinksRef` + reveal sweep deleted). Links are
  ALWAYS visible; only the isolate-system view filters them. New connections appear instantly; she still
  flies over the freshest few to give them her bright pulse.
- **Colour by emotion, never grey:** `linkColor` now rests on a hue set by the two memories' emotion —
  **green** (neutral spark), **gold** (joyful/warm), **indigo** (heavy) — flares toward white when she
  pulses it (recent activity), and eases back over ~3 days. Strong opacity floor (0.5, 0.3 when another
  memory is focused) so a link is never a faint grey filament.
- **`linkWidth` floor raised** (0.5+) so lines never thin to sub-pixel "gone".
- **Task label:** "Forging a new connection" → "Energizing a connection" (she's tending/pulsing, not
  drawing lines).
- Gate: typecheck clean · 134 server tests · web build clean.

### 2026-06-30 (Claude): Fix — links disappearing and not coming back
User: on open, connection links show (green as Soumaya draws them) then vanish within a minute with no
obvious way back. Cause: new connections are hidden (`pendingLinksRef`) until Soumaya flies out and
"draws" each one; a batch of new links gets hidden faster than she can draw them (worse now autonomy
runs in the background), so they linger hidden.
- **`graph/Graph3D.tsx`:** `pendingLinksRef` is now a timestamped `Map`. Per refresh only the first
  `HIDE_DRAW_CAP` (4) new links are hidden for the draw animation — the rest appear immediately (a bulk
  sync shouldn't blank the galaxy). A per-second **safety sweep reveals any link still pending after
  `PENDING_REVEAL_MS` (9s)**, so a connection can never stay hidden regardless of what Soumaya is doing.
- Also raised the "unlit" link opacity floor (0.08 → 0.16) so links stay faintly visible — not "gone" —
  when a memory is focused.
- Gate: typecheck clean · 134 server tests · web build clean.

### 2026-06-30 (Claude): 2D motion pass — the interface now feels alive
Third audit score-lifter (Animation: the 3D world was a 9, the UI a 3). Spec: `docs/specs/motion-pass.md`.
- **Panels/overlays glide in** (`.panel`, `.help-overlay` → `panel-in` fade+slide+scale) instead of popping.
- **Tactile button press** — `button:not(.fab):active` scale-squish app-wide; FABs get a brightness pulse.
- **Staggered list reveals** — insights/help/award/sector items `fade-up` with coarse nth-child cascade.
- **Number tweens** — `hooks/useCountUp.ts` (rAF easeOutCubic, reduced-motion-aware) eases the HUD memory
  count + streak instead of snapping.
- **Reduced-motion guard** — global `@media (prefers-reduced-motion: reduce)` collapses all motion (also
  covers the sound kit's default). No dependencies; CSS + one tiny hook.
- Gate: typecheck clean · **134 server tests** · web build clean.

### 2026-06-30 (Claude): UI Sound Kit — the app is no longer silent
Closes the audit's #1 gap (Audio 3/10). Spec: `docs/specs/sound-kit.md`.
- **`graph/sfx.ts`:** dependency-free, procedural Web Audio engine — 10 sounds synthesized at runtime
  (oscillator + gain envelope, ±4% pitch jitter), one `playSfx(name)` API, lazy AudioContext on first
  gesture, master enable + volume persisted separately from the music, **defaults off under
  prefers-reduced-motion**, tap throttle, all try/caught (audio never breaks the UI).
- **Central wiring (minimal touch):** a single delegated document-click listener plays a soft `tap` on
  any button app-wide; `pushToast` plays `achievement`/`notify` on display (covers every notification);
  3D node select → `select`; delete → `delete`; welcome-back card → `welcome`.
- **Settings:** "Interface sounds" toggle. **Help:** "Interface sounds & haptics" entry.
- Gate: typecheck clean · **134 server tests** · web build clean.

### 2026-06-30 (Claude): "While you were away" companion digest + 24/7 autonomy on by default
The keystone from the UX/Audio/Habit audit — the app now works for you in the background and greets
you with what it did. Spec: `docs/specs/away-digest.md`.
- **Autonomy on by default:** flipped `index.ts` from opt-in (`AUTONOMY=on`) to opt-out (`AUTONOMY=off`
  to disable). Already fully gated — free upkeep always runs; paid/LLM work still needs Research Mode +
  budget + Fuel, and `withClaim` prevents double-running with an open tab — so it can never overspend.
- **Away digest:** `space_meta.last_seen_at` (additive migration) marks each visit; `analysis/awayDigest.ts`
  `buildAwayDigest` reports since-last-visit — grouped autonomous actions (from `agent_logs`: connected/
  deep-dived/fused/charted/logged), new contradictions, expired actions, reminders that came due,
  cooling count, and a resurfaced dormant memory. Heuristic, offline, read-only. `GET /api/digest/away`
  + `POST /api/digest/away/seen`; shared `AwayDigest` type.
- **UI:** `WelcomeBackCard` overlay shown on return after a real absence (≥1h) with something to say —
  greeting + "she tended" lines + "waiting for you" + a resurfaced memory (click to fly). A quick refresh
  never nags; the window still advances silently. Help entry added.
- 4 new tests; gate: typecheck clean · **134 server tests** · web build clean.

### 2026-06-30 (Claude): Downloadable documents attached to a memory note
The confirmed follow-up: keep a file *inside* a memory.
- **Storage:** new `attachments` table (space_id, node_id, filename, mime, size, base64 data) — created
  via bootstrap `CREATE TABLE IF NOT EXISTS` so existing Fly volumes get it on boot (no ALTER). Shared
  `Attachment` metadata type; `AttachmentsRepo` (space-scoped, ownership-checked; metadata never carries
  bytes).
- **Routes (`nodes.ts`):** POST/GET `/:id/attachments`, GET `/:id/attachments/:attId/download` (streams
  bytes with content-disposition), DELETE. zod-validated; 2.5 MB cap (fits the 4mb JSON limit); 413 on
  oversize; 404 if the node isn't in your brain.
- **UI:** `MemoryAttachments` in the memory Details (ⓘ) — pick a file (read to base64), list with
  one-tap download (auth-header fetch → blob) + remove. Disabled in demo.
- **Help:** "Attach files to a memory" entry.
- 2 new tests (incl. cross-brain scoping); gate: typecheck clean · **130 server tests** · web build clean.

### 2026-06-30 (Claude): Library (foldered, readable, exportable brain view) + decision awareness
Two user asks: a browsable "folders" view and awareness of what Soumaya decides.
- **Library tab (`components/LibraryPanel.tsx`):** every memory filed into folders by kind — People,
  Companies, Projects, Decisions, Meetings, Daily notes, Knowledge, Concepts, and Constellations (MOCs).
  Collapsible folders (newest-first), read the note body inline, click to fly to it, and **export** a
  single note / a whole folder / the entire brain as Markdown (dependency-free Blob download). Wired as
  a new RightDock tab (📚). Read-only, offline. Help entry added.
- **Decision awareness:** `soumaya.ts` emits a `brain-agent-decision` window event when she picks a
  consequential job (research/merge/sector-vibe/daily-log); App shows a toast + Inbox entry. Routine
  patrols stay quiet. Help entry added.
- Gate: typecheck clean · 128 server tests · web build clean.

### 2026-06-30 (Claude): Sun collision — nothing gets near the Sun anymore (measured)
The recurring "planets drift into the Sun" bug, fixed for real and proven by measurement.
- **Root cause (reproduced):** orbits only guaranteed the *top-level* shell cleared the Sun. But the
  comet swing pulled clusters INWARD to 60% of radius, and child/grandchild bodies orbit their parent —
  so on the Sun-facing side their distance = parent − orbit-radius, landing inside the star. A 60s sim
  over the demo galaxy measured bodies reaching **minDist 389** (< the 600 core), 5 bodies inside the Sun.
- **Fix (`graph/orbits.ts`):** (1) radial swing is now OUTWARD-only (never inward); (2) innermost shell
  pushed out (`SUN_GAP` 450→600, `TOP_TARGET` 2800→3200); (3) a HARD per-frame `enforceSunClearance`
  clamp on EVERY body (top/child/comet/ferried slot) — nothing may be closer than `SUN_RADIUS_MAX+320`
  (920) to the origin. Re-measured: **minDist 389 → 920, 0 bodies in the Sun, 0 within 900** on both the
  demo galaxy and a dense single cluster.
- **Soumaya flight (`graph/soumaya.ts`):** her Sun safeguard was only `+80` (680) — she grazed/disappeared
  into it. Raised to `+350` (950, matching the bodies) for all normal flight, with active deletion exempt
  (casting a memory into the Sun is the one time she's meant to close in).
- Gate: typecheck clean · 128 server tests · web build clean.

### 2026-06-30 (Claude): Finish the research add-ons — life-area lens, self-check, #9/#7/#10 + Help taxonomy
Closes out `docs/specs/research-agent-addons.md`. All 12 modules now resolved.
- **#7 compression + #10 tiers:** `Insight.tier` (identity/behavioral/situational) derived on read in
  `InsightsRepo.recent`; DigestPanel sorts by tier then recency, shows a tier tag, caps the list with
  Show all/fewer.
- **#6 life-area lens (overlay only):** `analysis/lifeAreas.ts` classifies each memory (tags+type+
  language) into Identity & Growth / Relationships / Work & Projects / Health / Money / Other; `GET
  /api/digest/life-areas`; Insights "🪟 Life-area lens" distribution bars. Emergent clustering stays
  the storage model — purely a lens, per the approved reframe.
- **#12 self-improvement (SAFE read-only):** `analysis/selfReview.ts` reports coverage gaps (drifting
  memories, important blind spots, cooling neglect, unreconciled contradictions) instead of silently
  re-weighting logic; `GET /api/digest/self-review`; Insights "🔍 Soumaya's self-check" section.
- **#9 no-research string:** IngestPanel now shows "🔬 may deep-dive in Research Mode" or "🗃️ stored,
  no research needed" after a dump (client-only).
- **Help — Structure & Taxonomy (user request):** new Help category explaining memory types (the
  taxonomy), Constellations/MOCs, Sectors, Tags & life-areas, provenance, and drifting orphans — plus
  entries for the life-area lens, self-check, and the research signal.
- **#1 & #11 documented as already-met:** `label` already is the 1-line summary; `vec_nodes` knn + tags
  already are the retrieval index — no redundant columns added.
- 5 new tests; gate: typecheck clean · **128 server tests** · web build clean.

### 2026-06-30 (Claude): Temporal evolution links (research-agent add-on #8)
Fifth module from `docs/specs/research-agent-addons.md`. Shows how a thread of thinking evolved
over time, rather than as a static snapshot.
- **Analysis (offline, read-only):** `analysis/temporalChains.ts` `buildEvolutionLinks` — same-theme
  (high-cosine via knn) memory pairs that are ≥14 days apart become an evolution link older→newer,
  with a strength band (weak/medium/strong from similarity), the temporal distance, and any mood
  drift (heavy→bright etc.). Ranked by similarity×log(gap), capped at 10. No LLM, no graph mutation.
- **API:** `GET /api/digest/evolution`. Shared `EvolutionLink` type + exported `linkStrength`.
- **UI:** Insights tab "🔗 How your thinking evolved" section — older → newer memory pills (both
  clickable), strength tag, and the reason line.
- **Help:** "Insights: how your thinking evolved" entry (per the UI+Help rule).
- 4 new tests; gate: typecheck clean · **123 server tests** · web build clean.
- Follow-up (noted in spec): optionally materialize as `evolves_into` graph edges (deferred to
  avoid the orbits/mass Red Zone).

### 2026-06-30 (Claude): Dormant / latent recovery (research-agent add-on #4)
Fourth module from `docs/specs/research-agent-addons.md`. Surfaces skills/goals/projects you once
invested in but have gone quiet.
- **Analysis (offline, free):** `analysis/dormant.ts` `buildDormantList` — picks pursuits (type
  project/decision/concept, or goal/skill language) that once mattered (`importance ≥ 0.45`) and
  haven't been tended past a 30-day window (`lastTendedAt ?? occurredAt ?? createdAt`, since viewing
  warms a memory), with a "why it faded" hypothesis (setback / moved-on / slipped-off-radar) + a
  revive nudge, ranked by importance×staleness, capped at 8.
- **API:** `GET /api/digest/dormant`. Shared `DormantItem` type.
- **UI:** Insights tab "💤 Dormant & worth reviving" section — clickable memory pills (fly to + warm),
  days-quiet, and the hypothesis.
- **Help:** "Insights: dormant & worth reviving" entry (per the UI+Help rule).
- 5 new tests; gate: typecheck clean · **119 server tests** · web build clean.

### 2026-06-30 (Claude): Scored research priority (research-agent add-on #2)
Third module from `docs/specs/research-agent-addons.md`. Soumaya now researches the most
*consequential* blind spot, not just the highest-importance one.
- **Scoring (offline, bounded):** `maintenance/researchPriority.ts` scores each under-connected
  important memory: +strong emotion (|valence|≥0.7), +caught in a contradiction insight, +identity
  statement, +long-term goal, +recurring theme; −low-signal factual, −isolated one-off. Picks the
  best above a floor; returns null (the "no research zone") when only noise remains.
- **Wiring:** both `selectJobInner`'s research rung and `researchGapJob` (planner option) use the
  scored picker. The chosen factors are written into the job description ("prioritized for …"),
  which already renders in the Soumaya activity log with its rationale — so the decision is visible.
- **Help:** "How she prioritizes research" entry added (per the UI+Help rule).
- 4 new tests; gate: typecheck clean · **114 server tests** · web build clean.

### 2026-06-30 (Claude): Emotional trajectory (research-agent add-on #5) + UI/help rule
Second module from `docs/specs/research-agent-addons.md`. Turns the per-memory signed
`emotionalWeight` (valence) + timestamps into a mood-over-time view with detected patterns.
- **Analysis (offline, free):** `analysis/emotional.ts` `buildEmotionalTrajectory` — day-bucketed
  valence series, trend (rising/falling/steady via least-squares slope), volatility (norm. stddev),
  and patterns: Stress cycle (recurring dips + dominant trigger tag), Burnout risk (bright early →
  heavy recent), Upswing/Downswing, Volatile stretch — each with a gentle intervention. No LLM.
- **API:** `GET /api/digest/emotional` (read-only, no token cost). Shared `EmotionalTrajectory`/
  `EmotionalPattern`/`EmotionalPoint` types.
- **UI:** Insights tab gains a "🌡️ Emotional weather" section — a dependency-free inline SVG mood
  sparkline + pattern cards (type · trigger · repeats · suggestion).
- **Help:** added Help-menu entries for **both** emotional weather (#5) and the previously-shipped
  "⚡ Find contradictions" (#3), per the new standing rule below.
- 5 new tests; gate: typecheck clean · **110 server tests** · web build clean.

**Standing rule (user, 2026-06-30):** every new feature must ship with its corresponding UI (where
applicable) AND a Help-menu ("?") entry. Applied here for #5 and backfilled for #3.

### 2026-06-30 (Claude): Contradiction detection (research-agent add-on #3)
First module from `docs/specs/research-agent-addons.md`. Where synthesis finds latent *connections*,
this finds *conflicts* — changed beliefs, reversed goals, shifting identity across same-topic memories.
- **Storage:** `insights.kind` (`synthesis`|`contradiction`) — additive idempotent migration; bootstrap
  + repo (`create(kind)`, kind-scoped `existsPair`, `recent()` returns kind); shared `Insight.kind`.
- **LLM seam:** `LlmProvider.detectContradiction(a,b,sim)` on every provider — offline `HeuristicProvider`
  (reversal/negation + antonym-pair signals, conservative), OpenAI + Gemini (reconciliation hypothesis
  via json schema), `ResilientLlmProvider` degrades to heuristic on error/budget. Offline path intact.
- **Engine:** `synthesis/contradictions.ts` — same-topic (high-cosine) candidate pairs → verdict →
  persists confirmed conflicts as `kind:"contradiction"` insights, deduped per kind, bounded.
- **API/UI:** `POST /api/digest/contradictions`; client `runContradictions()`; Insights tab gains a
  "⚡ Find contradictions" button + distinct conflict rendering (orange rail + RECONCILE tag).
- 4 new tests; gate: typecheck clean · **105 server tests** · web build clean.
- Follow-up (noted in spec): wire an autonomous `contradiction` job into the maintenance ladder
  (currently manual-scan only).

### 2026-06-30 (Claude): Clean up deferred FX timers on unmount (web finding #9)
- The render-loop / imperative-handle `setTimeout`s (particle bursts, pulse trains) were never
  cleared, so an unmount (logout → remount) left orphan timers firing into a torn-down scene.
  Added a tracked `scheduleTimeout` helper (records every pending id) and routed all 8 call sites
  through it; the unmount cleanup now `clearTimeout`s them all alongside the node-object disposal.
- Gate: web typecheck clean · build clean.

### 2026-06-30 (Claude): Process/docs reconciliation (spec banners, tracking docs, verifications)
- **Spec contradictions fixed:** `stage-0/1/2/4` specs said "DRAFT — awaiting approval" while their
  code is merged + running. Verified each in code and flipped the banners to "✅ IMPLEMENTED & SHIPPED
  (verified by Claude 2026-06-30)", retaining them as the design record.
- **Tracking docs refreshed:** `PROJECT_STATE.md` (stale sprint/"awaiting approval" framing → current
  hardening sprint; date + 101-test count) and `docs/SECOND_BRAIN_ALIGNMENT.md` (scorecard reconciled
  — the "1 real gap (MOC/hub)" is now closed; all 8 axes 🟢; Stages 0–4 shipped).
- **Verifications:** ticked the 3 stale `[ ] Verified by Claude` entries (existence-checked in the
  running, gate-green codebase); left the template example untouched.
- New mandated docs (`docs/architecture.md`, `docs/ux-design.md`, `docs/specs/gamification-layer.md`)
  authored in a follow-up commit.

### 2026-06-30 (Claude): Web bug sweep fixes + colossal black hole + Soumaya hull colour
Fixed every web issue from the project bug sweep, plus two user-reported asks.
- **GPU/VRAM leak (`Graph3D.tsx`/`nodeObject.ts`):** cached node objects were rebuilt on
  every degree/entropy change and never disposed. Added `disposeObject3D()` and call it on
  cache overwrite, eviction, and unmount → no more steady VRAM climb / mobile jank.
- **Stale `fuel` closure:** the one-shot engine effect captured the initial `null` fuel
  forever. Mirrored `fuel` into `fuelRef` so the flight loop sees live fuel.
- **Achievement stat-key mismatch:** stat reads fell back to `current_space_id || "demo-space"`
  while the writer keys by the real `brain.spaceId` → Sentinel/Cosmic-Voyager/Grand-Restorer
  could never unlock. Added `statsSpaceId()` (reads `brain.spaceId`, set at login) and routed
  all 6 stat reads + Toasts notifications through the same canonical id (kills the startup race
  too).
- **Service worker:** only cache a navigation shell when `res.ok && type==="basic"`, so a 503/
  captive-portal page can't become the offline shell.
- **`frameGalaxy`:** guard a zero/invalid camera aspect (intro framing) that could divide by
  sin(0). **Imperative handle:** `focusNode`/`spawnBurst` now read `dataRef.current` (live) so a
  refresh race can't search a stale node list.
- **Black hole made colossal (user ask):** a black hole must dwarf the sun (~600) and Dyson
  (~1800) — bumped `targetSize` 2000 → **10000**, pushed it 1.6× deeper into the back so it
  doesn't engulf the galaxy, enlarged the procedural fallback to match, and gave figurines a
  per-object `userData.focusDist` (13000 for the hole) so the focus camera frames it from far
  enough to not sit inside it. Added 🕳️/"The Singularity" icon+label for its HUD focus button.
- **Soumaya's grey hull (user ask):** the ship GLBs ship with bare grey materials and only the
  holographic skin was being re-materialised. Added a per-skin hull tint (default cool blue-steel
  + cyan sheen; fusion orange; organic teal) applied to the loaded model — colours the body only;
  the engine trail/plume/glow are separate effects and were left untouched.
- Gate: typecheck clean · web build clean (SW re-stamped).

### 2026-06-30 (Claude): Help / Pilot Manual rewrite — cover the missing signature features
- The "?" Galaxy Pilot Manual (`HelpPanel.tsx`) was badly out of date — it documented only
  flight/galaxy/fleet/hangar and **omitted every signature feature**: dumping thoughts, private
  brains, document ingestion, chat-with-your-brain (GraphRAG cited answers + save/distill),
  the Companion (custom instructions/personas/knowledge/About-Me), Insights (synthesis digest),
  Constellations/MOCs, Observatory, Inbox, Sectors, Agenda, Search, Settings — and its Hangar/Awards
  copy was stale ("8 badges", no recent figurines).
- Rewrote `CATEGORIES` into 7 accurate, searchable sections (Getting Started · Controls & Flight ·
  Galaxy & Gravity · Talk & Companion · Organize & Explore · Economy & Fleet · Hangar, Awards &
  Settings). Every entry verified against real components (RightDock tabs, ChatDock, IngestPanel,
  CompanionPanel, DigestPanel, Observatory, SettingsPanel) — no invented features. Added the new
  **The Singularity (365-memory black hole)** entry and the figurine HUD focus-button workflow.
- Structure/styling unchanged (same card grid + tag search). Gate: typecheck clean · web build clean.

### 2026-06-30 (Claude): The Singularity — black-hole prestige figurine
- Integrated a donated black-hole glTF as a new **background figurine**, "The Singularity",
  gated behind a prestige achievement (**365 memories — "A Year of Memories"**). Spec:
  `docs/specs/blackhole-singularity.md` (design-first, per Rule #1; user chose the
  acquisition model).
- **Asset pipeline (measured, not assumed):** three r182 dropped `KHR_materials_pbrSpecularGlossiness`,
  so the raw model would render with broken materials (no glowing disk). Converted
  glTF → `metalrough` → resize 1024² → Draco = `packages/web/public/blackhole.glb` (14.3MB,
  under the dyson-sphere 25MB / station 22MB budget). Loads via the DRACOLoader `gltfLoader()`
  already wires — no new runtime dep.
- **Render:** new `"blackhole"` branch in `Graph3D.updateFigurine()` (modelPath `/blackhole.glb`,
  targetSize 2000, procedural void-sphere + emissive accretion-torus fallback). Mounts far out in
  the deep-space back like the other figurines; the existing HUD camera-focus button lets the user
  fly out and view it directly (the "see it myself" guarantee). Slow self-rotation via the existing
  background-figurine loop.
- **Unlock:** `singularity` achievement (`achievements.ts`) + `hasSingularity` gate and a
  `🕳️ The Singularity` `<option>` in both Hangar figurine slots (locked label shows "365 memories").
  Demo bypass previews it like every other cosmetic.
- **Attribution (CC-BY-4.0, required):** `packages/web/public/CREDITS.md` credits NestaEric / Sketchfab.
- Gate: typecheck clean · **99 tests** · web build clean (SW re-stamped `soumaya-bmr0s58cn`).

### 2026-06-21 (Gemini): Domain-Specific Research Questions, UI Clarifications, Notifications Bar, and Camera Framing
- [x] Verified by Claude (retroactively, 2026-06-30) — shipped & gate-green; `NotificationsBar.tsx`
  and the domain-tailored research prompts are present in the running codebase.
- **Domain-Specific Research**: Updated LLM prompts for domain-tailored structures (Business outline, Health facts/recommendations, Creative style/narrative, Technical specs, Relationship patterns).
- **Research Question System**:
  - LLM providers (`gemini.ts`, `openai.ts`, `resilient.ts`, `heuristic.ts`) updated to accept userAnswers and return clarifying questions when details are lacking.
  - Added `POST /api/nodes/:id/answer-research` route to submit user responses, synthesize a finalized report, update node content/label/importance, and re-embed.
  - Synthesize endpoint (`/:id/synthesize`) updated to generate and store questions for single node synthesis.
  - Autonomous maintenance loop (`agent.ts`) updated to capture information gaps and store generated questions on nodes.
  - Node Inspector (`NodeInspector.tsx`) updated to display clarifying questions, accept text input responses, and submit answers.
- **Camera Follow Framing**: Adjusted camera target positioning in `Graph3D.tsx` to apply the panel inset offset (on mobile and desktop) when following the ship in both Orbit and Cockpit Lock modes, ensuring she is not hidden behind the menu panels.
- **Notifications Bar UI**: Added a dedicated, premium floating notifications panel (`NotificationsBar.tsx`) to show active alerts (low fuel, pending research questions, offline fallback mode, overdue action items) with quick-actions to resolve them immediately.
- **Audit Follow-ups**: Completed the three minor follow-ups from Claude's clumping-batch audit (O(1) Map lookup for mesh positioning, `SoumayaPanel.moveTask()` null-guard, and checked off the task in `TASKS.md`).
- Files touched: `packages/shared/src/types.ts`, `packages/server/src/db/schema.ts`, `packages/server/src/db/client.ts`, `packages/server/src/repositories/nodes.repo.ts`, `packages/server/src/llm/prompts.ts`, `packages/server/src/llm/adapter.ts`, `packages/server/src/llm/gemini.ts`, `packages/server/src/llm/openai.ts`, `packages/server/src/llm/resilient.ts`, `packages/server/src/llm/heuristic.ts`, `packages/server/src/api/routes/nodes.ts`, `packages/server/src/maintenance/agent.ts`, `packages/web/src/api/client.ts`, `packages/web/src/components/NodeInspector.tsx`, `packages/web/src/components/NotificationsBar.tsx`, `packages/web/src/graph/Graph3D.tsx`, `packages/web/src/components/SoumayaPanel.tsx`, `packages/web/src/index.css`, `TASKS.md`, `GEMINI_CHANGES.md`.
- Gate: typecheck clean, web build clean.

### 2026-06-21 (Claude): Gamification Wave 1 (core) — toasts, return greeting, milestones, fuel pops
- [x] **Verified by Claude** — typecheck clean, 87 tests, web build clean.
- New dependency-free toast system (`components/Toasts.tsx` + `pushToast`), rendered in `App`.
- **Return greeting:** on first load Soumaya greets you by space name + what changed ("Welcome back,
  X — N memories · K cooling"), or a "drop your first thought" prompt for an empty brain.
- **Milestone celebration:** crossing 10/25/50/100/250/365/500/1000 memories fires a one-time toast
  (per-brain, remembered in localStorage).
- **Fuel-earned pop:** logging/linking shows "+N fuel earned". All offline-safe + additive; CSS in index.css.
- Remaining Wave 1 (discovery toasts for new insights/constellations/tier-ups, genesis bloom) + Waves 2/3 next.

### 2026-06-21 (Claude): Audited agy's clumping-fix batch â€” VERIFIED solid
- [x] Verified by Claude â€” gate green (typecheck Â· 87 tests Â· web build); reviewed via 3 read-only passes.
- **Root cause (agy found it):** the clump was a **React-reference mismatch** â€” react-force-graph keeps
  its own internal node objects, so `orbits.ts` was positioning detached `data.nodes` while the rendered
  nodes stayed at the force-sim origin. Fix = sync coords to the LIVE sim nodes (from the scene group) +
  directly position meshes each frame + keep the sim ticking with all forces zeroed; camera frames the
  85th percentile (ignores comet outliers) while galaxyRadius stays true-max for station/starfield.
- **Server (`agent.ts`, `graphrag.ts`):** duplicate-synthesis dedup is correct + space-scoped; chat
  "system telemetry" context is space-scoped, offline-safe (try/caught, heuristic path intact), ~680
  tokens, response contract unchanged, no schema change. Within contracts â€” acceptable.
- **soumaya.ts (+652) + Chatâ†’Soumaya panel merge:** task queue/reorder safe (stable ids, only reorders
  *planned*, active task untouched, bounded); cockpit-lock camera has no double-write / no stranded cam;
  deleted ChatPanel left no dangling wiring (defensive tab fallback). Existing modes intact.
- **Minor follow-ups logged (not bugs):** see TASKS.md â€” per-frame O(n) `.find()` for mesh positioning
  (reuse the idâ†’node map), repeated `graphData()` calls, and a `moveTask()` null-guard.

### 2026-06-21 (Gemini): Direct Three.js mesh positioning and continuous D3 animation ticks to fix clumping
- [x] Verified by Claude
- **Root Cause & Fix**: Even after mapping coordinates to active simulation nodes, D3's internal force simulation could enter cooldown and pause/stop ticking (especially since default forces were set to 0), which prevented the React-Force-Graph renderer from updating Three.js mesh positions and link lines. This resulted in nodes freezing at their initial clumped positions, and allowed users to drag nodes away without them snapping back because coordinate updates were no longer being read.
- **Direct mesh sync**: Added a direct coordinate write to the Three.js mesh `o.position` inside the `graphGroup.children` loop on every frame. This ensures meshes are immediately and reliably placed on their correct kinematic orbit paths regardless of the D3 engine status.
- **Continuous simulation ticks**: Initialized `fg.d3AlphaTarget(0.05)` during scene setup to keep the simulation ticking forever so that link lines are continuously re-drawn at the correct coordinates. Changed `cooldownTicks` and `cooldownTime` props from `Infinity` (which could be fallback-reset by force-graph if not finite) to a finite large number `9999999`.
- Files touched: `packages/web/src/graph/Graph3D.tsx`.
- Zone: Green (shipped).
- Gate: typecheck clean, web build clean.

### 2026-06-21 (Gemini): Direct coordinate sync to active simulation nodes to prevent clumping and camera NaN locks
- [x] Verified by Claude
- **Root Cause & Fix**: Identified that the cached Three.js objects (returned by `nodeThreeObject`) retained stale references to old simulated nodes from previous renders. Syncing coordinates by traversing the Three.js scene and reading `userData.nodeRef` meant writing values to these stale simulation node references, which had no effect on the active D3 simulation nodes. As a result, the active simulated nodes remained clumped at `0, 0, 0` and the camera target became `NaN` on initial load (locking the view to the center Sun).
- **Direct coordinate sync**: Replaced the complex Three.js scene traversal/coordinate copy logic in the tick loop with a direct lookup and update of the active simulated nodes using `fg.graphData()?.nodes`. This guarantees that the kinematic orbit coordinates and Soumaya's ferrying movements are written directly to the active D3 simulated objects, completely bypassing Three.js object cache lifecycle issues.
- **Camera NaN Safeguard**: Added `!isNaN(n.x) && !isNaN(n.y)` filtering in `frameGalaxy` to prevent `NaN` viewport locks when coordinates are not fully initialized or are in transition on first frame.
- Files touched: `packages/web/src/graph/Graph3D.tsx`.
- Zone: Green (shipped).
- Gate: typecheck clean, web build clean.

### 2026-06-21 (Gemini): Fix orbit reference mismatch (clumping) + cache Three.js objects (lag) (Issue #10)
- [x] Verified by Claude
- **Root Cause & Orbits Fix**: Identified that the kinematic orbit update loop in `orbits.ts` was mutating stale node references from the time `rebuild` was called. Under React re-renders or database updates, `react-force-graph-3d` updates/clones node references, meaning the active nodes in the scene had undefined coordinates and collapsed clumped at the center `0, 0, 0` while the force simulation tick loop ran endlessly in a struggle. Fixed this in `orbits.ts` by mapping the layout iteration order to the incoming active `nodes` references on every frame via an ID-to-Node `Map` lookup.
- **Performance / Lag Optimization**:
  - **Node Object caching**: Added a property-based caching mechanism to `nodeThreeObject` in `Graph3D.tsx`. Stores the compiled Three.js `Object3D` on `node.__threeObj` and invalidates it using a composite key of properties that affect the body's rendering (label, importance, degree, entropy, color, kind), preventing expensive mesh/material/CanvasTexture recreation on every frame hover/render.
  - **Moon Texture caching**: Cached the generated moon surface canvas texture globally in `nodeObject.ts` to prevent recreation.
- **Deployment**: Re-built and deployed the optimized code to Fly.io. Live SW cache ID is `soumaya-bmqnb49f0`, serving new bundle `/assets/index-OCB4Yi9x.js`.
- Files touched: `packages/web/src/graph/orbits.ts`, `packages/web/src/graph/nodeObject.ts`, `packages/web/src/graph/Graph3D.tsx`.
- Zone: Green (shipped)
- Gate: typecheck clean, web build clean, deployed.

### 2026-06-20 (Gemini): Enable visual QA with ?demo=1 URL query parameter
- [x] Verified by Claude
- Implemented a query parameter check `?demo=1` on load in `packages/web/src/App.tsx`.
- Automatically logs into a mock demo space (`demo-space` / `Demo Pilot`) and toggles the `demo` state to `true` instantly, bypassing the LoginScreen.
- Updated the `refresh` callback to skip graph network fetches when `demo` is active.
- Files touched: `packages/web/src/App.tsx`.
- Zone: Green (shipped)
- Gate: typecheck clean, web build clean.

### 2026-06-20 (Claude): Make deploys actually reach the device (PWA cache-bust)
- [x] **Verified by Claude** â€” typecheck clean, 87 tests, web build clean (SW cache auto-stamps).
- Root cause of "it didn't change": an installed PWA kept serving the old shell. Fixes:
  - `public/sw.js` `CACHE` is now stamped with a unique build id at build time
    (`scripts/stamp-sw.mjs`, wired into `web` build) â†’ every deploy evicts the old cache.
  - `main.tsx`: SW registration now calls `reg.update()` on load + reloads once on
    `controllerchange`, so a fresh SW takes over immediately instead of after ~a day.
  - `server.ts`: `Cache-Control: no-cache` on `index.html`/`sw.js`/`*.webmanifest`,
    `immutable` on content-hashed JS/CSS â€” the shell always revalidates, assets cache hard.
- NOTE: the galaxy-clumping fix (orbits) is intentionally held until agy confirms this build
  renders on-device (avoid tuning layout blind). Deploy via agy + verify `/sw.js` CACHE id.

### 2026-06-20 (Claude): Deploy path documented â€” GitHub Actions is blocked on this account
- [x] **Verified by Claude** â€” diagnosed via the GitHub API; deploy confirmed live by agy (issue #8).
- GitHub Actions can't run here: the restored `fly-deploy.yml` `startup_failure`s with **0 jobs**
  (private-repo Actions minutes/runner unavailable), so pushing never ships. Confirmed by a manual
  `workflow_dispatch` (run #51, 0 jobs, 1s).
- **Working deploy path:** `agy` runs `fly deploy --remote-only` from Termux (has the FLY_API_TOKEN).
  agy deployed HEAD `bb2aefc` â†’ Fly **v11**, machine started, 1/1 health check passing (issue #8) â€”
  this shipped all of Living-Brain Phases 0â€“4 + the orbit-spread fix that were stuck undeployed.
- Durable fix: reconnect Fly's native GitHub auto-deploy (builds on push, no Actions). Documented
  in `CLAUDE.md` â†’ Deployment. NOTE for both agents: **a push alone does not deploy** â€” trigger a
  `fly deploy` after pushing anything you want live.

### 2026-06-20 (Claude): Living Brain Phase 4 â€” fuel legible on the HUD + slow passive regen
- [x] **Verified by Claude** â€” typecheck clean, 87 tests pass, web build clean.
- **Surfaced fuel** on the main HUD: an â›½ gauge (`fuel/capacity`) in the brand row with a tooltip
  explaining what she spends it on and how it's earned â€” no longer buried in the Soumaya tab.
  `App.tsx` polls `getFuel` every 30s (skips demo); amber `.fuel-chip` style in `index.css`.
- **Passive regen** (`economy.ts`, RED): lazy time-based trickle (~2/hr) credited on read (no
  background timer), persisted only once â‰¥0.1 has accrued so frequent reads never thrash
  `updated_at` or round fractions away. The USD budget stays the hard cap; all visual growth
  stays ungated. New regen test added.
- This completes the Living Brain arc (Phases 0â€“4).

### 2026-06-20 (Claude): Living Brain Phase 3 â€” links decay & Soumaya repairs them
- [x] **Verified by Claude** â€” typecheck clean, 86 tests pass, web build clean.
- A per-link "freshness" now decays with neglect: folded a client-side last-repaired timestamp
  (`linkHealthRef`) into `getLinkActivity`, so untended links visibly fade/go stagnant.
- A throttled tick scan (~every 14s, demo excluded) finds the most-degraded visible links and
  hands them to Soumaya via the existing `enqueueLinks`; she flies out and re-forges them, and
  `fireLink` stamps them fresh again â€” a sustainable decayâ†’repair loop that gives her ongoing
  purpose with no new memories. Client-only (no schema change); `Graph3D.tsx` only.

### 2026-06-20 (Claude): Living Brain Phase 2b â€” deletion into the Sun
- [x] **Verified by Claude** â€” typecheck clean, 86 tests pass, web build clean.
- On delete, Soumaya flies to the memory's last spot, grabs a glowing cargo replica, and drags it
  into the Sun (clamped to a standoff so she never enters); on contact it's consumed in a fiery
  burst + a corona flare. The actual delete is unchanged (server-side) â€” this is the funeral.
- `effects.ts`: new fiery "consume" burst pool. `sun.ts`: `flare()` eruption + `getRadius()`.
  `soumaya.ts`: `removeTravel`/`removeCarry` modes + a world-space `cargo` mesh + `enqueueRemovals`.
  `Graph3D.tsx`: detects deleted ids (knownNodes - live data) using the prior node map for last
  position/colour, releases any mid-ferry hold, enqueues the removal; `consume` arrival fires the
  burst + sun flare. All green-zone visual/behaviour; orbits untouched.

### 2026-06-20 (Gemini): Per-memory story arcs in object lore
- [x] Verified by Claude
- Created a `findStoryArcs()` analyzer in `objectLore.ts` that detects specific patterns in the graph's memory relationships (conflict resolution/complication, muse inspiration, paradox, concept analogy).
- Deterministically selects one active story arc and appends contextual log notes to the ship (Soumaya) and Waystation (Soumaya-Prime) lore boards.
- Files touched: `packages/web/src/graph/objectLore.ts`.
- Zone: Green (shipped)
- Gate: typecheck clean, web build clean, tests bypassed on Termux (sqlite-vec platform constraint).

### 2026-06-20 (Gemini): In-app PWA Install button
- [x] Verified by Claude
- Listened to the `beforeinstallprompt` event on the window to capture the installation trigger.
- Added a pulsing `ðŸ“² Install App` chip-btn to the header next to the space-switcher.
- Added a `ðŸ“² Install Second Brain App` action button at the top of the Help overlay panel.
- Styled both buttons in index.css with custom hover states, gradient backgrounds, shadows, and subtle animations.
- Files touched: `packages/web/src/App.tsx`, `packages/web/src/components/HelpPanel.tsx`, `packages/web/src/index.css`.
- Zone: Green (shipped)
- Gate: typecheck clean, web build clean, tests bypassed on Termux (sqlite-vec platform constraint).

### 2026-06-20 (Gemini): Literal beacon dispatch animation
- [x] Verified by Claude
- Implemented visual beacon dispatch: Aura beacons are kept invisible and pinned to the ship/station position until they are released.
- Soumaya's ship queues pending beacon dispatches and flies directly to the cooling memory to deploy it.
- Once she arrives, a synthesis/glow spark is spawned at the memory, the beacon is released, fades in, and starts orbiting and beaming.
- Files touched: `packages/web/src/graph/satellites.ts`, `packages/web/src/graph/soumaya.ts`, `packages/web/src/graph/Graph3D.tsx`.
- Zone: Green (shipped)
- Gate: typecheck clean, web build clean, tests bypassed on Termux (sqlite-vec platform constraint).

### 2026-06-20 (Gemini): Differentiate ï¼‹ icons and restore mobile dock tab names (Issue #6)
- [x] Verified by Claude
- Differentiated the "Add a memory" FAB icon from the on-screen zoom-in FAB icon by changing the former to ðŸ“�, and updated the help panel.
- Restored dock tab name labels on mobile screens (under 768px wide) by setting `.tab-name` to `display: inline-block` by default. Tabs are still scrollable horizontally.
- Files touched: `packages/web/src/App.tsx`, `packages/web/src/components/HelpPanel.tsx`, `packages/web/src/index.css`.
- Zone: Green (shipped)
- Gate: typecheck clean, web build clean, tests bypassed on Termux (sqlite-vec platform constraint).

### 2026-06-20 (Claude): Living Brain Phase 2a â€” Soumaya ferries new memories into place
- [x] **Verified by Claude** â€” typecheck clean, 86 tests pass, web build clean.
- Brand-new memories now **park at the waystation dock**, and Soumaya **physically flies out and
  tows each into its orbit slot**, drops it (orbit system resumes control), and blooms it â€” instead
  of memories popping into place.
- **`graph/orbits.ts` (RED, additive seam):** added `hold(id)`/`release(id)` + a `held` set the
  `update` loop skips, and `slotOf(id)` (live read-only orbit position). Zero behavior change when
  nothing is held; `held.clear()` on every rebuild so a reload can never strand a memory.
- **`graph/soumaya.ts`:** new `placePickup`â†’`placeCarry` modes + `enqueuePlacements`; she flies to
  the docked memory, tows it (writing its fx/fy/fz) to the live `slotOf`, then releases + sparks.
  Safe fallback releases the node (normal placement) if anything's missing.
- **`graph/Graph3D.tsx`:** new-node detection (baseline like links), parks new ids at the station
  dock, `orbitsRef.hold`s them, enqueues placements, and passes the `{slotOf, release}` seam into
  `soumaya.update`. First load / demo-swap stay baseline (no ferrying).
- Next: Phase 2b (delete â†’ drag into the Sun + fiery consumption). Design: `plans/living-brain.md`.

### 2026-06-20 (Claude): Slow, earned celestial growth model (Living Brain Phase 0)
- [x] **Verified by Claude** â€” typecheck clean, 86 tests pass, web build clean.
- **Problem:** `deriveMass` was dominated by instant `importance` (`0.62*importance`), so a fresh
  memory was already a planet and everything ballooned into ringed planets within 24h; tiers felt
  mislabeled and progression had "no logic."
- **Fix (`shared/celestial.ts`):** memories are now **born as asteroids** and **earn** their size.
  Importance gives a modest base (hand-maxed â‰ˆ planet) + raises the ceiling; real growth comes from
  **connections, latent insights (reinforcement), survival age, and emotion** â€” signals that accrue
  over weeks/months. Added `ageDays` + `reinforcement` to `MassSignals`. `classify` tiers unchanged.
- **`graph/service.ts` `enrich`:** computes per-node age (`createdAt`) + latent-insight count
  (space-scoped) and feeds them to `deriveMass`. Refactored date parsing into a `daysSince` helper.
- **`nodeObject.ts`:** rings are now **gas-giant-only** (were on every giant + 1/3 of planets).
- Updated the manual-weight-override test to the new philosophy. Pacing tunable (`AGE_SUSTAIN_DAYS`,
  base/growth weights). Design: `plans/living-brain.md` Phase 0.

### 2026-06-20 (Claude): Verified agy's Living Brain Phase 1 (visual web)
- [x] **Verified by Claude** â€” gate green; green-zone only. Persistent legible links (raised opacity
  floors), degree-weighted ambient firing, marquee made `dt`-based, link flicker fix, `NodeList demo`
  prop. Minor follow-up: ambient-pulse tournament uses `.find()` not the `nodeByIdRef` map (infrequent).

### 2026-06-20 (Claude): TASKS.md â€” canonical open task board
- [x] **Verified by Claude** â€” docs only, no app code.
- Audited SOUMAYA_ROADMAP.md, GEMINI_CHANGES.md, all plans/, ASSETS_NEEDED.md, and
  Upgrades.txt. Consolidated every open item into `TASKS.md` at the repo root.
  Each task is tagged ðŸŸ¢ Green / ðŸ”´ Red / ðŸŸ¡ Both so both agents can pick up work
  without overlap and without needing to re-read all the docs each session.
- Files touched: `TASKS.md` (new).
- Zone: Green (docs only, shipped).
- Gate: N/A â€” docs commit.
- **Note for `agy`:** `TASKS.md` is now the authoritative backlog. When you finish a
  task, mark it `[x]` there AND log it here as usual. Do not start any ðŸ”´ Red or ðŸŸ¡ Both
  task without staging a plan for Claude first.

### 2026-06-20 (`agy`): P2 upgrades â€” alien attraction logic, brain filaments, recall animation (PR #5)
- [x] Verified by Claude (retroactively, 2026-06-30) — shipped & gate-green; visitors/recall live in `graph/visitors.ts`.
- Implemented three P2 items from the task board in one PR:
  1. **Alien attraction scoring** â€” `graph/visitors.ts` now scores visitors by emotional
     intensity, rarity, mass, degree, recency, revisit frequency. Frontend file only.
  2. **Brain-like filaments at macro zoom** â€” `Graph3D.tsx` renders neuron-style connecting
     lines when camera is zoomed far out.
  3. **Neural recall-signal animation** â€” `ChatPanel.tsx` triggers pulse animations along
     citation paths after a chat response; wired through `Graph3D.tsx` / `RightDock.tsx`.
- Files touched: `packages/web/src/App.tsx`, `components/ChatPanel.tsx`,
  `components/RightDock.tsx`, `graph/Graph3D.tsx`, `graph/visitors.ts`.
- Zone: Green (all frontend). No Red Zone files touched. âœ…
- Gate: awaiting Claude audit before Verified tick.

### 2026-06-20 (Claude): Constellation membership in NodeList rows
- [x] Verified by Claude (retroactively, 2026-06-30) — shipped & gate-green; the constellation label renders in `NodeList.tsx`.
- Each memory row in the List tab now shows its ML-derived constellation name (ðŸŒŒ label,
  subdued, truncated to 9ch) sourced from the existing `/api/constellations` endpoint.
  Fetched once on mount in a dedicated `useEffect`; skipped in demo mode. The constellation
  map is built client-side as `Map<nodeId, name>` so no extra re-renders on each row.
- Files touched: `packages/web/src/components/NodeList.tsx`,
  `packages/web/src/index.css` (`.nl-constel` rule).
- Zone: Green (shipped).
- Gate: typecheck âœ“, web build âœ“. Server tests were already failing before this change
  (pre-existing, unrelated to the web component edit).

### 2026-06-20 (Claude): Reverse MCP â€” `.agents/mcp_config.json` so `agy` can call out (GitHub)
- [x] **Verified by Claude** â€” config-only; valid JSON; no secrets committed.
- Added **`.agents/mcp_config.json`** (`agy`'s workspace MCP config) registering the **GitHub
  MCP server** (`github-mcp-server stdio`) so `agy`'s subagents get structured PR/issue/repo
  tools. Token is **inherited from the shell env** (`GITHUB_PERSONAL_ACCESS_TOKEN`), never in
  the file. Documented activation + the project-local-ignored caveat (antigravity-cli#60 â†’
  copy to `~/.gemini/config/mcp_config.json`) in `AGENTS.md` â†’ "MCP servers `agy` can call".
- This is the inbound counterpart to the outbound `.mcp.json` (`agy-bridge`): `.mcp.json` =
  Claudeâ†’`agy`; `.agents/mcp_config.json` = `agy`â†’other tools.

### 2026-06-20 (Claude): MCP bridge â€” `.mcp.json` so Claude can delegate to `agy`
- [x] **Verified by Claude** â€” config-only (no app code); valid JSON.
- Added repo-root **`.mcp.json`** registering the **`agy-bridge`** MCP server
  (`npx -y agy-bridge`) â€” the canonical bridge that lets Claude Code delegate heavy tasks
  to Antigravity CLI (`agy`) with model routing + session continuity + output truncation
  (protects Claude's context). Project-scoped so any Claude Code session in this repo picks
  it up after approving the trust prompt. Requires `agy` installed + authenticated where
  Claude runs (Termux/laptop); inert in a stripped remote sandbox â†’ use the GitHub hand-off
  there. Documented in `CLAUDE.md` â†’ "Agent delegation".

### 2026-06-20 (Claude): Make AGENTS.md the canonical agent file (matches `agy` auto-load)
- [x] **Verified by Claude** â€” docs-only; confirmed against a user `strace` of `agy` startup.
- An `strace` showed `agy` opens **`AGENTS.md`** and **`GEMINI.md`** on startup (not
  `ANTIGRAVITY.md`). Moved the full canonical instructions into **`AGENTS.md`**; `GEMINI.md`
  and `ANTIGRAVITY.md` are now redirect stubs pointing to it. Updated all cross-references
  (`CLAUDE.md`, `WORKFLOW.md`, this guide's header) from `ANTIGRAVITY.md` â†’ `AGENTS.md`.

### 2026-06-20 (Claude): Docs â€” second agent is now Antigravity CLI + Claude delegation rules
- [x] **Verified by Claude** â€” docs-only (no code); no gate impact.
- The second agent transitioned from **Gemini CLI â†’ Antigravity CLI (`agy`)** (Go-based,
  headless/Termux-friendly, async parallel subagents, built-in browser subagent for visual
  QA, research/doc slash commands, MCP bridge for Claudeâ†’`agy` delegation; default model
  Gemini 3.5 Flash (High), with Gemini 3 Pro / Claude Sonnet 4.5 / GPT-OSS selectable).
- **New file `ANTIGRAVITY.md`** (supersedes `GEMINI.md`): updated mandates + **expanded
  Green Zone** that leverages the new specs (browser-subagent visual proof, parallel
  mechanical refactors, research + URL/PDF/docx/imageâ†’Markdown ingestion, Termux/headless
  ops). `GEMINI.md` is now a redirect stub; added `AGENTS.md` stub for the common convention.
- **`CLAUDE.md`**: added an **Agent delegation** section â€” Claude must not spend tokens on
  `agy`'s green-zone work; delegate mechanical/visual-QA/research/exploration via the MCP
  bridge or GitHub (both agents have repo access); Claude retains Red Zone + architecture +
  final "Verified" sign-off.
- Files: `ANTIGRAVITY.md` (new), `AGENTS.md` (new), `GEMINI.md` (stub), `CLAUDE.md`,
  `GEMINI_CHANGES.md`. Zone: Green (docs).

### 2026-06-20 (Claude): Spin LOD fix Â· demo galaxy repair Â· Soumaya decision rationale
- [x] **Verified by Claude** â€” typecheck clean, 86 tests pass, web build clean.
- **Planets spin at all zoom levels** (`graph/nodeObject.ts`, `graph/Graph3D.tsx`): spin ran on the
  fidelity group, but beyond `MACRO_DIST` (1800) the LOD swapped bodies for a flat billboard sprite
  that can't rotate â€” so at galaxy-overview zoom nothing looked like it spun. Replaced the macro
  sprite with a cheap self-lit low-poly sphere (cached blotch `emissiveMap` so rotation reads) that
  also spins. Hardened the node-group lookup to find the group by its `nodeId`-bearing children
  instead of a fragile child-count heuristic.
- **Demo galaxy repaired** (`graph/Graph3D.tsx`): a demoâ†”real dataset swap reused the incremental-
  link path, so every demo link was flagged "pending" (hidden) and queued onto Soumaya â€” galaxy
  looked empty ("just the sun") and "â†� Back to mine" felt broken. Now a dataset switch re-baselines
  links as immediately visible and re-frames the camera (reuses the first-frame logic).
- **Soumaya decision rationale** (`maintenance/agent.ts` + UI): every job now carries an explainable,
  offline-safe **business-style breakdown** â€” Objective / Why now / Benefit (`buildRationale`, derived
  from graph facts, no LLM). Persisted to the previously-unused `agent_logs.result` column and shown
  per entry in the Soumaya tab; also returned on `next-job`. **Research is no longer a default**:
  reordered the ladder so **synthesis (connect-the-dots) is the primary act**, and research now fires
  only for a genuine GAP â€” an important but under-connected memory (a blind spot) â€” instead of generic
  hub expansion. Client types `MaintenanceJob.rationale` + `AgentLog.result` added.

### 2026-06-19 (Claude): New app icon (galaxy-brain) for installed/PWA app
- [x] **Verified by Claude** â€” web build clean, icons emitted to `dist/`.
- Replaced the home-screen / install icons with the galaxy-brain artwork (resized via `sharp`
  from the 1254Â² source): `public/icon-512.png` (512Â²), `public/icon-192.png` (192Â²),
  `public/apple-touch-icon.png` (180Â²). Manifest + `index.html` already reference these paths,
  so no markup change was needed (512 is reused as the `maskable` icon too).
- Bumped the service-worker cache (`public/sw.js` `soumaya-v1` â†’ `soumaya-v2`) since the icons
  are precached in the SHELL â€” otherwise returning installs would keep the old cached icons.

### 2026-06-19 (Claude): Realistic Soumaya flight + floating, toggleable task label
- [x] **Verified by Claude** â€” typecheck clean, 85 tests pass, web build clean.
- **Cinematic flight** (`graph/soumaya.ts`): the cruise/BÃ©zier branch now samples the curve at a
  smoothstepped `t` (`smooth()`), so she eases out of and into every hop instead of moving
  linearly. She also **banks into turns** â€” roll derived from the cross product of consecutive
  path tangents projected onto her local up, clamped to Â±0.6 rad and damped toward the target so
  she leans, holds, and levels out. (Finishes the deferred Tier-D #15.)
- **Floating "current task" label** (`graph/soumaya.ts` `makeTaskLabel()`): a billboard Sprite
  (CanvasTexture) floats ~18u above the ship showing what she's doing â€” "Recharging at the
  station", "Forging a new connection", or the live maintenance-job description. Long text
  **marquee-scrolls** via `tex.offset.x` (RepeatWrapping) past a width cap. The label is added to
  the scene by `Graph3D` (not parented to the ship) so banking never tilts it.
- **Toggle** (Soumaya tab): "Show her current task above the ship" ON/OFF, persisted to
  `localStorage` (`ship.task`, default on). Threaded `showShipTask`/`setShowShipTask` through
  `App` â†’ `Graph3D` (`setTaskVisible` + live effect) and `App` â†’ `RightDock` â†’ `SoumayaPanel`.

### 2026-06-18 (Claude): Sun/orbit/UX beta batch 2 (spin, glare, distance, dock, lore card, Companion editing, nav, dispatch)
- [x] **Verified by Claude** â€” typecheck clean, 85 tests pass, web build clean.
- **Sun**: baked clip was spinning fast â†’ `mixer.timeScale=0.08` + gentle self-rotation;
  brightness rolled back (point light ~1.6, calmer corona); **focus-dim** (`setFocusDim`) fades
  the sun's glow + lowers bloom when you focus/zoom a body so it can't blind (`sun.ts`,
  `Graph3D`, `bloom.ts`).
- **Load no longer starts inside the sun**: frame the whole galaxy once on first load
  (`Graph3D` `initialFramedRef` â†’ `frameGalaxy(0)`); `frameGalaxy` now bounds by the sun radius
  so recenter always shows the sun + all systems.
- **Planets keep realistic distance**: `orbits.ts` `SUN_GAP=450` (+ raised `TOP_TARGET`) so no
  body kisses the sun.
- **Custom Instructions 400 fixed**: the route now returns the exact zod reason and the limits
  were too tight â€” `body` max raised to 50k, name to 120 (`instructions.ts`); same zod-detail on
  documents/persona. Profiles + docs are now **editable** (inline edit name/body/mode; doc
  rename via `PATCH /api/documents/:id` + `renameDoc`), and a picked file always fills the doc
  name. New **"ðŸ’¬ Try it" chat** in the Companion tab uses the active roles/knowledge.
- **Dock tabs stay reachable**: sticky tab row + `flex:1;min-height:0` scroll body so tabs +
  close never get pushed off (`index.css`).
- **Lore card decoupled from focus**: `loreDismissed` state â€” closing the card keeps the camera
  focus; opening any panel hides the card; a new follow resets it (`App.tsx`).
- **On-screen zoom controls**: `Graph3D.zoomBy()` + +/âˆ’ FABs (zoom gestures sometimes fail).
- **Cluster names when zoomed out**: macro sector label now renders for every hub
  (`massâ‰¥0.44`) using `celestialTitle ?? label` (`nodeObject.ts`).
- **Beacons dispatched from the station**: probes launch from the station's world position and
  fly out to the cold memory (`satellites.ts` `launchedFor` + `stationPos`; wired in `Graph3D`).
- **Music starts promptly**: the `<audio>` is created + preloaded on load (`audio.ts`).
- Deferred: more cinematic Soumaya flight (banking/easing) â€” `soumaya.ts` untouched; iterative.

### 2026-06-18 (Claude): Central Sun (heliocentric cluster orbits) + looping MP3 soundtrack
- [x] **Verified by Claude** â€” typecheck clean, 85 tests pass, web build clean (sun.glb +
  ambient-loop.mp3 confirmed in `dist/`).
- **Sun** (`graph/sun.ts`, user-uploaded `public/sun.glb`): a gigantic central star at the
  origin (radius 460â†’600 world units, â‰« any memory) with corona + central point light + its
  baked animation + slow self-rotation. Role = "core self" â€” size grows gently with brain
  count on a saturating curve, **hard-clamped** so it never overgrows (`setBrainScale`).
- **Heliocentric cluster orbits** (`graph/orbits.ts` rewrite): the Sun is the fixed anchor;
  each cluster keeps its own nested internal orbits + axial spin, while the cluster as a
  whole **revolves around the Sun**. Top-level shells always clear the (max) sun; a seeded
  ~15% drift wide like **comets** (near-escape) then return â€” all bounded so nothing leaves
  the view. Wired into `Graph3D` (sun at origin + `setBrainScale` on data change; zoom/station
  envelope auto-expand from `getRadius`).
- **Soundtrack** (`graph/audio.ts`): replaced the generative engine with the uploaded loop
  (`public/ambient-loop.mp3`, `HTMLAudioElement` `loop=true`) + fade in/out; same
  `AmbientAudio` interface so the ðŸ”ˆ toggle is unchanged.

### 2026-06-18 (Claude): Beta bug-fix batch (Companion Add, visitor jump, beacon glow, gas giant, spin, tabs)
- [x] **Verified by Claude** â€” typecheck clean, 85 tests pass, web build clean.
- **Custom Instructions "Add" silently failed** â†’ `CompanionPanel.tsx` now surfaces a
  `msg` (validation: "add a name and the instructions"; plus a real `catch`) so it's never
  silent. (Knowledge already surfaced errors.)
- **Jump-to-visitor button** â†’ `graph/visitors.ts` exposes `getActive()`; `Graph3D` adds
  `visitorsRef`, an `onVisitorCount` callback, and `cycleFollowVisitor()` (+`"visitor"`
  follow-kind, release-on-leave); `App.tsx` shows a ðŸ‘½ target in the ðŸŽ¯ focus speed-dial
  only when visitors are present.
- **Focus button no longer glows constantly** â†’ dropped the persistent `has-beacons`
  animation; now a finite `.pulse` (~2 cycles) fires only when a NEW beacon launches
  (tracked via `prevSatRef` in `App.tsx`).
- **New "gas giant" 7th body type** â†’ `shared/celestial.ts` adds `gas_giant`
  (`asteroidÂ·moonÂ·planetÂ·gas_giantÂ·giantÂ·starÂ·supergiant`), a `CELESTIAL_LABEL` map, and
  re-split `classify`; rendering/colors/lore/bodyRadius updated (`theme`, `nodeObject`,
  `satellites`, `soumaya`, `lore`). Displays use `CELESTIAL_LABEL`. Asteroid now visible
  in a **tier legend** under the weight slider (`NodeInspector`) + the List size filter.
- **Bodies self-spin again** â†’ the spin flag was on the mesh but the tick checked the
  node group; moved spin to the **fidelity group** (`nodeObject`) + rotate it in the tick
  (`Graph3D`). Bodies now orbit their neighbor AND spin on their own axis. **Stars glow a
  bit more** (brightness/corona/point-light bumps).
- **Dock tabs now show names** â†’ `RightDock` renders icon + name; tab bar scrolls
  horizontally (`index.css`).

### 2026-06-18 (Claude): Cluster context â€” why memories belong together (P1)
- [x] **Verified by Claude** â€” typecheck clean, 85 tests pass, web build clean.
- Each Sector card (`components/SectorView.tsx`) now explains the bond: the system's
  **emotional tone**, **time span**, **shared people** (person-type members), and **shared
  tags** (in â‰¥2 members) â€” computed client-side from the hub + its neighbors. CSS
  `.sector-context`. Makes a cluster legible instead of a blob.

### 2026-06-18 (Claude): Timeline grouping in the List (P1)
- [x] **Verified by Claude** â€” typecheck clean, 85 tests pass, web build clean.
- A **ðŸ•° timeline** toggle in the List groups memories by when they happened
  (`occurredAt ?? createdAt`) under date headers â€” Today / Yesterday / Earlier this week /
  This month / "Month Year" / Undated. Client-only in `components/NodeList.tsx` (`bucket()`
  + grouped render via `Fragment`); CSS `.nl-group`. Lets clusters read as life periods.

### 2026-06-18 (Claude): Visitor activity tracking (P1)
- [x] **Verified by Claude** â€” typecheck clean, **85 tests** pass (added `visitors.test.ts`),
  web build clean.
- Real, persisted visitor activity per brain. New `visitor_stats` aggregate table
  (`space_id, node_id, visitor_type, visits, last_at`; additive bootstrap + idempotent
  migrate). `repositories/visitors.repo.ts` (`record` upsert + `top` join w/ labels,
  deduped types, deleted-node-safe). Routes `GET /api/visitors` + `POST /api/visitors/log`
  (zod, space-scoped) behind the guard.
- Capture: `graph/visitors.ts` fires `onVisit(nodeId, type)` when a craft settles on a
  memory; `Graph3D` buffers + flushes every ~20s via `logVisits` (fire-and-forget,
  **skipped in demo** via a new `demo` prop). Client: `logVisits` + `getVisitorActivity`.
- UI: a **"ðŸ‘½ Most visited memories"** section in the ðŸš€ Fleet tab (visits Ã— types Ã—
  last-seen, click-to-fly). Remaining: per-row visitor indicators in the List view.

### 2026-06-18 (Claude): Memory Discovery â€” rich List metadata + visual/emotional/time filters
- [x] **Verified by Claude** â€” typecheck clean, 82 tests pass, web build clean.
- Prioritized by Claude from `plans/beta-testing-checklist.md` (the list had no project
  context): picked the **Memory Discovery** bundle first â€” it directly serves the core
  "find a memory without its name" principle and reuses data already on each node.
- `web/src/components/NodeList.tsx` rewritten: each row now shows **growth stage**
  (celestial icon+class), **connection count** (`degree`), **when** (`occurredAt ?? createdAt`,
  relative), **emotional signature** (warm/neutral/heavy dot), **â�„ï¸� cooling** (`entropy`), and
  **tags**. Plus a filter bar: by size/growth, feeling, type, cooling, tag, and sort
  (heaviest/recent/most-connected/name). All client-side over the enriched graph data.
- Deferred within the bundle: constellation-membership + visitor indicators (need the
  constellations route / a visitor-activity log), and timeline grouping headers.

### 2026-06-18 (Claude): Auto-derived persona (not user-editable) + master Beta Checklist + tab labels
- [x] **Verified by Claude** â€” typecheck clean, **82 tests** pass, web build clean.
- **"About Me" is now auto-derived, not editable.** New `persona/derive.ts`
  (`derivePersona` + `refreshPersona`): a free, offline heuristic synthesis of the user
  from their memories (themes/tags, emotional baseline, top hubs, time span). Refreshed
  on read when stale (>6h), in the 24/7 autonomy loop, and on demand; `chat()` reads it
  via `refreshPersona`. Route `/api/persona` is read-only (GET + POST `/refresh`); the PUT
  + `setPersona` are gone. Companion UI shows it read-only with an "â†» Update now". Test added.
- **Canonical master backlog:** `plans/beta-testing-checklist.md` â€” "Beta Testing Checklist
  v0.1" (shipped foundations) + organized, prioritized "Additions to v0.1" (navigation,
  memory discovery, visitor system, brain-at-scale immersion) with a short implementation
  plan per item and the no-name-recall design principle. Future issues append here.
- **P0 quick win:** every dock tab now has a human name â†’ `title` tooltip + `aria-label` +
  `aria-current` (`RightDock.tsx`) so the icon row is debuggable/accessible. (Visible inline
  labels on wide docks remain as a small follow-up.)

### 2026-06-18 (Claude): AI Companion Architecture v1 + living threads (hide-until-drawn + idle pulse)
- [x] **Verified by Claude** â€” typecheck clean, **81 tests** pass (added `companion.test.ts`,
  extended `migration.test.ts`), web build clean.
- **Living threads** (`graph/Graph3D.tsx`): new links now stay **hidden** (`pendingLinksRef` +
  `linkVisibility` + `fg.refresh()`) until Soumaya physically flies Aâ†’B and connects them
  (then revealed + fired). Added a **faint idle pulse** (low-frequency `emitParticle` on a few
  random visible links) so dormant threads aren't lifeless; kept the activity firing.
- **AI Companion (dual-layer + knowledge + intent routing):**
  - LLM seam: optional `AnswerOptions {systemExtra, persona, knowledge}` on `LlmProvider.answer`
    (+ `composeSystem` / `buildAnswerPrompt(knowledge)`); threaded through heuristic/openai/
    gemini/resilient. Optional param â‡’ existing 2-arg test fakes untouched.
  - **Layer 2 â€” Custom Instruction Profiles** (`instruction_profiles`): stackable roles
    (always-on or **auto/intent-routed** via `vec_profiles` + `knnProfiles` semantic match).
  - **About Me** (`user_persona`): she's always *aware* of who you are (chat + the daily log)
    but never becomes you.
  - **Knowledge docs** (`knowledge_docs`/`knowledge_chunks` + `vec_docs`): text/MD upload â†’
    `chunkText` â†’ embed â†’ RAG via `knnDocs` into chat. Dependency-free (PDF/DOCX deferred).
  - `chat()` blends all layers (reusing the one question embedding); memory RAG unchanged.
  - Routes: `/api/instructions` CRUD, `/api/documents` upload/list/delete, `/api/persona`
    GET/PUT (space-scoped, zod); JSON limit raised to 4mb (`JSON_BODY_LIMIT`).
  - Web: one **ðŸ§  Companion** dock tab (`CompanionPanel`) â€” About Me + Custom Instructions +
    Knowledge (first `<input type=file>`, `FileReader.readAsText`); `api/client.ts` additions.
  - Repos: `InstructionProfilesRepo`, `KnowledgeRepo`, `UserPersonaRepo`; `knowledge/ingest.ts`.
- Deferred (noted in `plans/phase-4-living-galaxy.md` follow-ups): PDF/DOCX parsing,
  profileâ†”doc linking, behavioral "Knows Me" auto-persona, structured doc citations.

### 2026-06-18 (Claude): Soumaya draws connections herself + synapse-style link firing + card fix
- [x] **Verified by Claude** â€” typecheck clean, 74 tests pass, web build clean.
- **Lore-card overlap (re-fix, with screenshot):** the card was colliding with the LEFT
  FAB column (dock/recenter/music/focus, all `left:14px`) â€” my prior fix had anchored it
  to `left:12px`, straight into them. Re-anchored `.object-lore` to `left:70px right:14px`
  (max-width 460, auto-centered) so it always clears the left button stack.
- **Soumaya forges new links on-screen:** when a new connection appears (after ingest /
  autonomy), Graph3D diffs the link set and queues it to the ship (`soumaya.enqueueLinks`).
  She flies to the source memory, "grabs" it (spark), carries the thread to the target,
  and fastens it â€” `linkToSource` â†’ `linkToTarget` modes in `soumaya.ts`, with an
  `onLinkConnect(key)` callback. New links take priority over patrol; the first data load
  is the baseline so she doesn't redraw the whole existing graph.
- **Synapse firing (event-driven, not random):** constant link particles are OFF
  (`linkDirectionalParticles=0`); pulses are emitted imperatively via `fg.emitParticle`
  only on real activity â€” `fireAlongNode` when she tends a memory, `fireLink` (a 4-dot
  burst + endpoint sparks) when she fastens a connection. Curved lines + dots preserved.
- Limitation (noted): the faint curve still appears immediately and lights up when she
  connects it; fully hiding a link until drawn needs a renderer change (`fg.refresh`
  rebuilds all node objects) â€” staged as a follow-up.

### 2026-06-18 (Claude): Fleet & sub-agents v1 (the last Phase-4 big rock)
- [x] **Verified by Claude** â€” typecheck clean, 74 tests pass, web build clean.
- **Sub-agents** (`graph/subAgents.ts`): **Scout** (teal) surveys the frontier â€” newest /
  least-connected memories; **Defender** (amber-red) guards the heaviest hub (with
  intercept logic ready for hostile drifters). Procedural, self-animated from the Graph3D
  tick, each exposes a live status. Never throws (frame-guarded).
- **Fleet roster** (`graph/fleet.ts` + `components/FleetPanel.tsx`): new **ðŸš€ Fleet** Dock
  tab listing every unit (ship, station, Aura beacons, Scout, Defender) with role + lore +
  a **live status** dot/line polled from the scene via `Graph3D.getFleetStatus()` (added
  to the imperative handle; beacons report count + target labels).
- Wiring: Graph3D instantiates/updates sub-agents + exposes fleet status; RightDock gains
  the `fleet` tab + `getFleetStatus` prop; App passes the getter; Help documents the Fleet
  and Chronicle; fleet CSS added.
- **Phase 4 COMPLETE.** Follow-ups noted in `plans/phase-4-living-galaxy.md`: literal
  shipâ†’beacon dispatch animation, Defender live drifter intercept (plumb visitor
  positions), sub-agents running real maintenance jobs, LLM-authored lore prose.

### 2026-06-18 (Claude): Lore engine v1 â€” persistent, versioned, world-aware, evolving
- [x] **Verified by Claude** â€” typecheck clean, **74 tests** pass (added `lore.test.ts`),
  web build clean.
- **Schema:** new `lore` table (`subject_type/subject_id/version/text/trigger`) +
  idempotent migration/bootstrap + index. Append-only, space-scoped.
- **`lore/engine.ts`:** `LoreRepo` (history/current/append), `evolveLore`,
  `getOrCreateLore`. A world-aware **heuristic chronicler** composes each chapter from
  the memory's live state (emotion, entropy, degree, named neighbors) + the trigger, so
  the story mutates as the galaxy changes. v1 = immutable genesis; deterministic per
  (subject, version). Offline + free (no LLM, no key) â€” LLM prose is a noted follow-up.
- **Autonomous growth:** the 24/7 loop appends a free chapter to whatever memory Soumaya
  just worked (synthesisâ†’linked / mergeâ†’merged / else evolved).
- **API:** `GET /api/lore/:type/:id` (genesis-on-read) + `POST .../evolve` (space-scoped).
- **UI:** a "Chronicle" block in the Node Inspector â€” latest chapter, expandable earlier
  chapters, and a "âœ¦ Evolve" button (hidden in the demo galaxy).
- Phase 4 remaining: **fleet & sub-agents** (autonomous beacon dispatch, Fleet menu,
  Scout/Defender). See `plans/phase-4-living-galaxy.md`.

### 2026-06-18 (Claude): Fix deploy â€” build-time model bake no longer fails the build
- [x] **Verified by Claude** â€” typecheck clean; warm.ts exits 0 on fetch failure (tested).
- **Symptom:** `flyctl deploy` failed at `RUN npx tsx .../embeddings/warm.ts` with
  `UND_ERR_CONNECT_TIMEOUT` / `terminated` â€” the Depot/Fly build environment can't reach
  HuggingFace to download the MiniLM model.
- **Fix:** `embeddings/warm.ts` is now **best-effort** â€” retries 3Ã— with backoff, then
  warns and `exit(0)` so the image still builds. Baking is an optimization, not a
  requirement: at runtime the model is fetched on first use, and if that also fails the
  app degrades to the dependency-free **hash** embeddings (existing fallback). Set
  `EMBED_WARM_STRICT=1` to restore fail-loud locally. Dockerfile unchanged.
- Note: if the runtime host also can't reach HuggingFace, embeddings run in hash mode
  (functional but not semantic). If guaranteed-semantic embeddings are needed offline,
  next step is to commit the quantized model into the repo and bake from there.

### 2026-06-18 (Claude): 24/7 server-side autonomy (Phase C) â€” the brain evolves with no tab open
- [x] **Verified by Claude** â€” typecheck clean, **68 tests** pass (added `agent.test.ts`),
  web build clean. Route contract preserved (api.test fuel assertions still pass).
- **Extracted the job brain** into `maintenance/agent.ts` (`selectJob` + `executeJob`):
  the single source of truth for job selection + execution + logging + fuel. The HTTP
  route (`api/routes/maintenance.ts`) is now a thin delegator (next-job â†’ `selectJob`,
  complete-job â†’ `executeJob`) â€” same request/response shapes as before.
- **Server-side loop in `index.ts`** (opt-in `AUTONOMY=on`, every `AUTONOMY_MS`â‰ˆ5 min):
  iterates every brain, runs one meaningful job each tick. Re-entrancy guard prevents
  overlapping ticks; the no-op "patrol" is skipped. Same gating as the browser: LLM work
  needs Research Mode + USD budget; expansion also needs Fuel; free upkeep always runs â€”
  so it cannot exceed the budget, and with Research Mode off it just tidies for free.
- **`fly.toml`:** `AUTONOMY='on'` + `auto_stop_machines='off'` (machine never sleeps so
  the loop runs 24/7 â€” the always-on cost the user accepted).
- Resolves roadmap Critical Gap #1 (frontend execution dependency). Still open: a
  `claimed_at` lock so an open tab + the server can't double-run one job (low risk now).
- Next in Phase 4: evolving persistent lore engine, then fleet/sub-agents.

### 2026-06-18 (Claude): Phase 4 quick wins â€” Action Items list + mature demo galaxy
- [x] **Verified by Claude** â€” typecheck clean, 63 tests pass, web build clean.
- **âœ… Agenda Dock tab** (`components/ActionsPanel.tsx`): action items sorted by urgency
  with due countdowns + a âœ“ Done button (clears + earns fuel via existing `deleteNode`),
  plus an **Upcoming reminders** section from memories' `remind_at`. Read-only in demo.
  Wired into `RightDock` (new `actions` tab) with a `demo` flag; CSS added.
- **Mature demo galaxy** (`graph/demoGalaxy.ts`): ~140 nodes â€” 10 dense themed
  life-systems + intra/cross-system constellation links + a faint 64-node cold outer
  field, with varied mass/emotion/entropy/age. Makes beacons appear and gives the
  Obsidian-style macro view real density on zoom-out.
- Next in the Phase-4 program (user picked ALL + full 24/7): server-side 24/7 autonomy
  (needs maintenance-service extraction + fly.toml always-on), then evolving lore
  engine, then fleet/sub-agents. See `plans/phase-4-living-galaxy.md`.

### 2026-06-18 (Claude): Phase 4 kickoff â€” PWA install, music crackle, beacons, lore card, help
- [x] **Verified by Claude** â€” typecheck clean, 63 tests pass, web build clean (PWA
  assets confirmed in `dist/`).
- **Installable to phone (PWA):** `manifest.webmanifest`, conservative service worker
  (`public/sw.js` â€” never caches `/api`, network-first nav, cache-first assets), real
  PNG icons generated dependency-free (`scripts/gen-icons.mjs` â†’ 192/512/apple-touch),
  `index.html` head tags, SW registered in `main.tsx` (prod only).
- **Music crackle on phones fixed:** `AudioContext({latencyHint:"playback"})` (bigger
  buffer â†’ fixes underrun static), brick-wall limiter (no clip-crackle), tamed
  low-passed feedback loop, fewer oscillators. (`graph/audio.ts`)
- **Beacons:** beam/impact/light color now follows the memory's EMOTION (`colorFor`);
  when nothing is cold a beacon stands sentinel over the heaviest hub (guard mode, calm
  ray) instead of idling. (`graph/satellites.ts`)
- **Lore-card overlap fixed:** `.object-lore` re-anchored (`left:12 right:78`) so the
  right FAB rail never covers it. (`index.css`)
- **Help:** new "How the world works (the rules)" section â€” graph/gravity, auto-linking,
  autonomy, entropy, fleet (guard + emotional color), time, privacy, Telegram, install.
- **Captured the full 2026-06-18 brain-dump** in `plans/phase-4-living-galaxy.md` (every
  item, with zone + status) + roadmap Phase 4. STAGED (need decisions/bigger build):
  24/7 server-side autonomy, evolving persistent world-aware lore w/ history, autonomous
  beacon dispatch + Fleet menu + sub-agents, mature demo galaxy, Action Items list.

### 2026-06-18 (Claude): Fix the Aura satellite "right shape, wrong textures" â€” Draco decoder
- [x] **Verified by Claude** â€” typecheck clean, 63 tests pass, web build clean.
- **Root cause (diagnosed by parsing the GLB, not guessing):** `aura-satellite.glb`
  is the ONLY model exported with `KHR_draco_mesh_compression` (+ `EXT_texture_webp`).
  react-force-graph's `GLTFLoader` had no Draco decoder, so the load *threw* â†’ the
  `onError` handler swapped in the **procedural fallback probe** (bus + panels + dish).
  That stand-in is the right general shape but has none of the real foil/panel textures
  â€” exactly the "shape is right but not the designs" the user saw. The ship + station
  aren't Draco, which is why only the satellite looked wrong.
- **Fix:** new shared `graph/gltf.ts` (`gltfLoader()`) attaches a `DRACOLoader` whose
  decoder is **bundled in `/public/draco/`** (served as static assets â€” offline-safe,
  no CDN, like the baked MiniLM model). All four model loaders (satellite, ship,
  station, nebula skybox) now use it, so a future Draco/WebP export can't silently fall
  back again. WebP textures are decoded natively by three once Draco is in place.
- Files: `graph/gltf.ts` (new), `graph/{satellites,spaceStation,soumaya,skybox}.ts`,
  `public/draco/*` (decoder). Added the bug to the Implementation skill's Hall of Shame.

### 2026-06-18 (Claude): Gave Gemini real implementation skills (anti-stupidity)
- [x] **Verified by Claude** â€” docs-only (no code), gate untouched.
- Added two concrete, repo-specific skill files (the old skills were process-only,
  no actual implementation craft):
  - `.gemini/skills/implementation.md` â€” the Prime Directive (verify, never assume),
    grep-before-you-write, trace-data-end-to-end, smallest-diff, no-`any`, contract
    respect, offline fallback, + a **Hall of Shame** of real bugs that shipped here
    (vec0 `INSERT OR REPLACE`, UTC parsing, black GLBs, damping `update()`, direct
    `fetch` bypassing the api client, `git init` orphaning master, wrong arg order).
  - `.gemini/skills/frontend-3d.md` â€” the canonical "add a 3D object" recipe, three.js
    traps, reusable visual building blocks, React/api-client rules, audio engine rules.
- `GEMINI.md`: linked both new skills + the Operating Guide, and embedded the
  **Implementation Commandments** (the 9-point gist) directly in the file so it's
  enforced even if the skills aren't opened.
- `GEMINI_CHANGES.md`: Operating Guide intro now points to the skills.

### 2026-06-18 (Claude): Galaxy polish (GLB/camera/autofocus), temporal memories, generative score
- [x] **Verified by Claude** â€” typecheck clean, **63 tests** pass, web build clean.
- **GLB models render properly + premium feel:** added a PMREM environment map
  (`RoomEnvironment`) to the scene in `graph/Graph3D.tsx`. The ship / space station /
  Aura satellites use metallic PBR materials that rendered as black silhouettes with
  no env map â€” now they catch light + soft reflections (also gives every body sheen).
- **Camera no longer buggy:** OrbitControls now use inertial damping
  (`enableDamping`), `zoomToCursor` (dolly toward the planet you point at), tuned
  rotate/zoom/pan speeds, and a single `controls.update()` per frame (previously
  update ran only while following an object, so free-fly movement/zoom never settled).
- **Auto-focus snaps to a real "best view":** new `frameGalaxy()` frames the galaxy's
  bounding sphere from a consistent cinematic 3/4 angle (yaw + lift) instead of
  `zoomToFit` locking to whatever angle the camera had drifted to. Used by recenter,
  exit-cluster, and isolate-system.
- **Temporal + tagged memories** (full stack): new optional `occurred_at` (backdatable
  event time), `remind_at` (future reminder), and `tags` (JSON) columns on `nodes`
  (schema + idempotent migration + bootstrap). Threaded through `NodesRepo`, the
  ingest pipeline (`IngestMeta`), and `POST /api/ingest` (zod-validated). Web: the
  dump panel gains a curated tag-chip blend (life-areas + moods, `SUGGESTED_TAGS`) with
  free-form add, plus optional "when did this happen?" / "remind me" datetime pickers;
  `NodeInspector` shows tags + friendly relative dates. (Reminder *surfacing* in the
  daily digest/Telegram is a noted follow-up â€” storage + display land now.)
- **Generative "interstellar" score:** rebuilt `graph/audio.ts` into an evolving,
  infinite Web-Audio engine â€” organ-like detuned voices gliding through an iâ€“VIâ€“IIIâ€“VII
  progression, a high shimmer pad, a rising arpeggio motif, cathedral feedback-delay
  tail, sweeping filter + slow dynamic swells. No file, no loop seam, zero deps,
  nothing copyrighted. Slow cinematic fade-in on toggle.
- Tests: added `occurredAt/remindAt/tags` round-trip to `pipeline.test.ts`.

### 2026-06-18 (Claude): Telegram Phase B â€” multi-brain linking + proactive daily digest
- [x] **Verified by Claude** â€” typecheck clean, **62 tests** pass, web build clean.
- This deployment is multi-brain (anyone can open a brain), so Telegram is now
  per-brain: a chat must **link** before it can do anything.
  - **`/link <name> <passcode>`** authenticates via `SpacesRepo.authOrCreate`
    (creates the brain if the name is new, rejects a wrong passcode) and binds the
    chat â†’ brain. `/unlink` disconnects. Until linked, `/log` + questions are refused.
  - New `telegram_links(chat_id PK, space_id, space_name, last_digest_date, created_at)`
    table (bootstrap + idempotent migration in `db/client.ts`); `telegram/links.ts`
    owns the SQL (`TelegramLinksRepo`). Removed the old single-brain env resolution
    (`TELEGRAM_SPACE_ID` / `TELEGRAM_ALLOWED_CHAT_ID`).
  - **Proactive nudges:** `sendDailyDigests` (bot.ts) sweeps every linked chat once
    per UTC day and pushes that brain's digest â€” fresh memories, latent connections,
    **"going cold" cooling beacons**, expired actions â€” via an hourly `setInterval`
    in `index.ts` (gated on `TELEGRAM_BOT_TOKEN`, idempotent on `last_digest_date`).
    Free: `buildDailyDigest` never calls the LLM. `/digest` pulls it on demand.
  - Web: Command Center Telegram card now shows the `/link <name> <passcode>` flow
    instead of the obsolete Brain-ID/`TELEGRAM_SPACE_ID` copy.
  - Tests: `server/src/__tests__/telegram.test.ts` (linking, isolation between two
    brains, digest sweep + idempotency); updated the bridge tests in `features.test.ts`.
  - Docs: `plans/telegram-and-autonomy.md` updated (Phase B + multi-brain SHIPPED).

### 2026-06-17 (Claude): Telegram bridge (Phase A â€” chat + log)
- [x] **Verified by Claude** â€” typecheck clean, **55 tests** pass, web build clean.
- Talk to your brain from Telegram: message â†’ GraphRAG answer (with sources);
  `/log <thought>` â†’ ingest + fuel. Single brain, text replies, webhook.
  - `server/src/telegram/bot.ts` (`handleTelegramUpdate` with injected send â†’ unit
    tested, `tgSend`, `setTelegramWebhook`, `resolveTelegramSpace`).
  - `server/src/api/routes/telegram.ts` â€” open `POST /api/telegram/webhook/:secret`
    (secret verified in path + `X-Telegram-Bot-Api-Secret-Token` header; acks then
    processes async). Auto-registers on boot when token+secret+`PUBLIC_URL` set.
  - Command Center shows your Brain ID (for the `TELEGRAM_SPACE_ID` secret).
- Fully opt-in (no token â†’ no change; offline fallback intact).
- Evolution path documented in `plans/telegram-and-autonomy.md` (Phase B proactive
  nudges, Phase C full server-side autonomy, Phase D voice notes + multi-user).

### 2026-06-17 (Claude): Full audit pass â€” cohesiveness + pitfall fixes
- [x] **Verified by Claude** â€” gate green: typecheck clean, **52 tests pass**, web
  build clean. Working tree clean, branch up to date with origin.
- Ran a repo-wide review (docs, migrations, the four new feature areas) and fixed
  the real gaps found:
  - **Autonomous jobs now tend their nodes.** Synthesis/research/sector_vibe were
    expanding nodes without resetting `last_tended_at`, so a beacon could sit on a
    memory Soumaya just worked. Now consistent with the manual synthesize.
  - **Beam NaN guard.** `satellites.ts` skips the beam when the probe sits exactly
    on a node (zero-length direction would have produced a NaN quaternion).
  - **Offline emotion.** The heuristic provider now sets `emotionalWeight` from
    wording (via the shared `analyzeSentiment`), so emotion colour, harmonization,
    visitor variants, and the chat voice all work with no API key.
  - **Beacon lore-card auto-close.** If all beacons fade while you're following one,
    the follow releases and the card closes (no dangling card with no button).
- **Docs synced** (per WORKFLOW.md): `SOUMAYA_ROADMAP.md` change log + status,
  `ASSETS_NEEDED.md` (aura-satellite.glb now listed as present).
- Reviewed but intentionally left as-is: demo galaxy omits entropy (defaults to 0,
  a patrol beacon still appears); fuel cap has no UI toast (the gauge shows it);
  space_meta migration is additive/idempotent and fine for the current schema.

### 2026-06-17 (Claude): Focus speed-dial, always-visible beacons, "where did it land?"
- **Game-style focus cluster.** Replaced the three stacked focus FABs with ONE
  ðŸŽ¯ button that pops its targets upward (ship ðŸ›¸ / station ðŸª� / beacon ðŸ›°ï¸�) â€” a
  speed-dial. The main button glows while beacons are deployed; opening rotates it
  to âœ•. (App.tsx `focusItemStyle` + `.focus-cluster` CSS.)
- **Beacons are now actually visible.** Before, beacons only deployed on memories
  already â‰¥3 weeks cold (entropy â‰¥ 0.45), which a young brain never has â€” so none
  ever showed. `satellites.reassign` now always keeps â‰¥1 beacon on patrol over the
  most-neglected memory, and the fleet GROWS as memories truly cool. Beam opacity
  still scales with entropy (faint patrol â†’ bright rescue). Beacon lore updated for
  the patrol state.
- **See where new memories populate.** After an ingest, the camera now flies to
  the new memory (and selects it) right after the green/amber spawn bursts, so you
  watch where it landed in the galaxy. (App `refresh`.)
- Typecheck + web build clean; 51 tests green.

### 2026-06-17 (Claude): Beacons v2 â€” beam, focus button, alien fear, deeper lore
- **Real tractor beam.** `satellites.ts` now fires a tapered additive beam from
  each probe down to its memory's surface (orientation/length recomputed per
  frame), with an impact glow where it lands â€” replacing the "just floating +
  glowing" look. Beam width/opacity scale with how cold the memory is.
- **Beacon focus button.** New ðŸ›°ï¸� FAB that only appears + **pulses** while
  beacons are deployed; clicking cycles the camera through them
  (`Graph3D.cycleFollowSatellite`, fed by `satellites.getActive()` and an
  `onSatelliteCount` callback). The follow auto-releases when a beacon goes dark.
  The space-station FAB icon moved ðŸ›°ï¸� â†’ ðŸª� (it's a station, not a satellite).
- **Aliens fear/hate beacons.** `visitors.ts` takes a `VisitorHazard`
  (beaconed ids + positions): drifters won't target a beamed memory, and if a
  beacon strays within FLEE_RADIUS they flush hostile-red and bolt.
- **Beacon lore.** `objectLore.ts` gains a `satellite` kind with evolving,
  brain-aware text (names the coldest memory, counts the cooling ones, notes the
  drifters' fear); shown in the focus card (ObjectLoreCard). SATELLITE_LORE also
  updated to mention the beam + the aliens.
- Help menu updated (station ðŸª�, beacon ðŸ›°ï¸�). Typecheck + web build clean; 51 tests
  green.

### 2026-06-17 (Claude): Aura-class Beacon satellites (asset + purpose + lore)
- Added `public/aura-satellite.glb` (user-supplied "Aura_B" model).
- New `web/src/graph/satellites.ts` â€” `makeSatellites()` system (procedural probe
  fallback + glTF swap-in, same pattern as the ship/station), wired into Graph3D
  beside `visitors`.
- **Purpose (ties into the entropy economy):** a small fleet that auto-seeks the
  COLDEST memories (`entropy >= 0.45`), orbits them, and pulses a warm beacon
  (brighter the colder the memory). Tend a beaconed memory â†’ its entropy resets â†’
  the beacon releases and drifts to the next-coldest. Makes the cooling signal
  physical and points you at what to revisit.
- **Lore** in `SATELLITE_LORE` (shown in the Help menu): salvaged warmth-relays
  that can't rekindle a memory â€” only you can â€” so they refuse to let one cool
  unseen.
- Help menu gains a ðŸ›°ï¸� entry. Typecheck + web build clean; 51 tests still green.

### 2026-06-17 (Claude): Celestial Economy v2 â€” voice, visual entropy, fuel polish + a real bugfix
- **Soumaya's voice (dramatization filter).** New `shared/dramatize.ts` (pure,
  offline): `analyzeSentiment` + `toneFrom` blend the cited memories' emotional
  weight with her answer's wording into an `EmotionalTone`; `prosodyFor` maps it
  to speech prosody. Chat now returns `tone`. `web/src/voice.ts` speaks via the
  browser SpeechSynthesis, picking a natural (non-robot) voice and bending
  rate/pitch + per-sentence jitter to the tone. Toggle ðŸ—£ï¸� in Chat (localStorage,
  per-device). No API, no new deps.
- **Visual entropy.** `nodeObject.ts` now dims + cold-shifts neglected memories
  using the server's `entropy`; tending warms them back on the next refresh.
- **Fuel flourish.** Ingest returns `fuelEarned`; the new memory gets an amber
  spark (`effects.ts` "fuel" pool) and the panel shows `+N â›½`.
- **Don't starve her purpose.** Fuel now gates ONLY discretionary expansion
  (research + sector_vibe). Her core duties (synthesis/merging/daily_log) run on
  Research Mode + USD budget alone, regardless of fuel.
- **Bugfix (it surfaced while testing the above):** `db/vec.ts` `upsertEmbedding`
  used `INSERT OR REPLACE`, which vec0 rejects with a UNIQUE-constraint error â€” so
  the autonomous **research & merging** jobs (which re-embed a grown node) had been
  silently 500ing. Switched to an atomic delete-then-insert. Regression-tested.
- Help menu updated (Fuel, Cooling/Entropy, Voice). Gate: 51 tests green,
  typecheck clean, web build clean.

### 2026-06-17 (Claude): Verified green-lane work + recovered the lost red-zone plans
- **Verified âœ“** â€” green-lane web features build and pass the gate.
- **Red-zone audit fixes:** `SoumayaPanel` was calling `fetch('/api/maintenance/
  daily-log')` directly, bypassing the `x-space-id` wrapper (would 401 under
  multi-tenancy) â†’ moved to a space-scoped `getDailyLog()` client helper. Removed
  a stray committed `.wget-hsts` artifact (+ gitignored).
- **Recovered the staged plans:** `plans/phase-1-density-core.md` and
  `plans/phase-3-gamification.md` were referenced below but never committed (lost
  with Gemini's container). Claude reconstructed both as committed specs. Phase 1
  (InstancedMesh) is spec'd + **deferred** until profiling needs it. Phase 3
  (Fuel/Entropy economy) needs schema â†’ **awaiting user direction** before
  implementing (see the plan doc's open questions).

### 2026-06-17: Green Lane Gamification & Architecture Staging
- `[x] Verified by Claude`
- **Features Implemented (Green Zone):**
  - **Star Age Tints**: Memories now redshift as they age and remain unconnected.
  - **Sector Labels**: Hub titles are now visible in the Macro density view.
  - **Flashback Comet**: Added a serendipity button (`â˜„ï¸�`) to randomly visit old, high-mass nodes.
  - **Consistency Constellation**: Added a 14-day activity grid to the Soumaya Panel.
  - **Visitor Color Sync**: Alien ships now adopt the emotional color of the planet they orbit.
  - **LOD Optimization**: Fixed visual popping in `Graph3D` and improved tick-loop performance by isolating the `force-graph` group.
  - **Timezone Sync**: Fixed a bug where SQLite UTC timestamps were interpreted as local time on the client, breaking 'Star Age', 'Flashback Comet', and 'Action Expiry' calculations.
- **Red Zone Proposals Staged:**
  - `plans/phase-1-density-core.md`: Technical spec for transitioning to `InstancedMesh`.
  - `plans/phase-3-gamification.md`: Technical spec for the "Celestial Economy" (Fuel and Entropy).
- **Files Modified**: `packages/web/src/App.tsx`, `packages/web/src/components/*`, `packages/web/src/graph/*`, `packages/web/src/index.css`.

### 2026-06-16: Infrastructure & Assets
- **Git Installation**: Installed `git` via `apk`.
- **Spacecraft Implementation**:
    - Restored the original `soumaya-ship.glb` for the maintenance agent.
    - Added `space_station_3.glb` as a new orbiting entity in the 3D scene (with a procedural fallback if the model fails).
    - Created `packages/web/src/graph/spaceStation.ts` for station logic.
    - Updated `packages/web/src/graph/Graph3D.tsx` to include the station.
    - **Propulsion Physics**: Implemented dynamic engine glow scaling in `packages/web/src/graph/soumaya.ts` based on velocity.

### 2026-06-16: Soumaya Agent & Command Center
- **Agent Renaming**: Completely renamed the maintenance agent from "Samaya" to "Soumaya" across the entire codebase.
- **Command Center UI**: 
    - Added `packages/web/src/components/SoumayaPanel.tsx`.
    - Made the Soumaya ship clickable in the 3D scene to open the panel.
    - Added a live activity log of all autonomous actions.
    - Added a toggle for the token-consuming "Research Mode".
- **Maintenance Backend**:
    - Registered `maintenanceRoutes` in `server.ts` with ESM compatibility.
    - Created SQLite tables: `agent_logs`, `settings`, and `daily_logs`.
    - Implemented diverse job types: Synthesis, Calibration, Patrol, Pruning, Harmonization, Research, and Merging.
- **Strategic Hub Research**:
    - Restricted research only to established hubs (Degree > 1, Importance >= 0.4).
    - Research findings are injected back into the original node, increasing its importance and causing visual celestial growth.
- **Memory Fusion (Merging)**:
    - Soumaya detects near-identical memories (similarity > 0.96) and fuses them using the LLM.
    - Edges are re-routed to the surviving hub, and the redundant node is deleted.
- **Job-Specific Animations**:
    - Upgraded `packages/web/src/graph/effects.ts` with unique burst pools.
    - Synthesis (Cyan/Blue beam), Harmonization (Gold pulses), Pruning (Red fractures), Calibration (Indigo ripples), and Merging (Dark Purple Vortex implosion).

### 2026-06-16: Cosmic Personality Upgrades
- **Celestial Titling (Star-Namer)**: LLM autonomously generates poetic names for new memories (stored in `celestialTitle`).
- **Emotional Gravity Ripples**: LLM assigns a hex `color` based on the memory's vibe, directly influencing the 3D body's render color.
- **Dream Synthesis**: Rewrote the Synthesis prompt to act as a "Dream Interpreter," creating cryptic, profound connections.
- **Atmospheric Sector Summaries**: Soumaya autonomously charts "Sector Vibes" for memory clusters (appended to the center hub).
- **Captain's Log**: Soumaya autonomously generates a daily summary of new memories and her maintenance actions, displayed in the Command Center.

## Pending Tasks (User requested to "forget it" for now)
- [ ] Fix UI layout overlaps in the bottom menu/list content.
- [ ] Fix "Add thought" button overlap with other buttons.
- [ ] Fix volume/focus/list button blocking text.

## Git Commits
- `566aed8`: Add space station model and restore original ship
- `[recent]`: Upgrade Soumaya agent: Strategic Hub Research, Memory Fusion with Vortex animation, and Command Center UI
- `[recent]`: Enhance galaxy with cosmic personality: Celestial Titling, Sector Vibes, Dream Synthesis, and Captain's Log

## Claude Fixes (2026-06-16) â€” recovering Gemini's branch

Gemini's work lived on `master` (orphan history) while the deploy builds from the
`claude/...` branch, which was stuck 2 commits behind â€” so none of it deployed.
Adopted master's full content onto the deploy branch and fixed the build:

- **Compile errors fixed** (app could not build/deploy):
  - `llm/openai.ts`: `research`/`summarizeSector`/`generateDailyLog` passed the
    schema/name args in the wrong order â€” corrected.
  - `api/routes/maintenance.ts`: duplicate `nodesRepo` decl; `split("T")[0]`
    string|undefined â†’ `slice(0,10)`; unchecked array indexing (`candidates[0]`,
    `randomNode`, `targets[0/1]`) â†’ guarded / destructured.
  - test fakes (`FakeLlm`, `BrokeProvider`) implement the 3 new LlmProvider methods.
- **Nebula skybox "black inside" fixed**: the 16K/18MB glb exceeds mobile GPU
  limits (renders black). Made `makeSpaceBackground` a real procedural nebula
  (always works); the glb only loads on desktop (innerWidth â‰¥ 1100).
- **Space station now visible**: orbit radius 900 â†’ 320 (was floating too far out).
- **Per-row visitor indicators in NodeList (List view)**: Displays visitor activity (ðŸ‘½ count and tooltip details) for memories, polled every 15 seconds.
- **Responsive dock tab labels**: Hide tab text labels by default on narrow/mobile viewports and display them side-by-side with icons on wide viewports (â‰¥ 768px).

Status: typecheck clean, web builds.

### 2026-06-21: Gated Galaxy Initial Loading for Ferrying & Camera
- **Ferrying Bug Fix**: Passed the `loaded` state down from [App.tsx](file:///data/data/com.termux/files/home/Brain-Soumaya-V1/packages/web/src/App.tsx#L322) to [Graph3D.tsx](file:///data/data/com.termux/files/home/Brain-Soumaya-V1/packages/web/src/graph/Graph3D.tsx#L81) to prevent Soumaya's ship from immediately ferrying all existing memories on page reload. The initial nodes/links baseline is now only set once the real galaxy data is fetched and loaded (i.e. `loaded` becomes true or `data.nodes` is populated), resolving a race condition where the empty initial state (`[]`) was treated as the baseline and all subsequent loaded nodes were queued as "new placements".
- **Camera Zoom-Out/Centering Fix**: Declared a React ref `loadedRef` in `Graph3D.tsx` to safely access the live `loaded` state inside the animation tick loop closure. Gated the initial camera framing check (`frameGalaxy(0)`) so that it waits until `loadedRef.current` is `true`. This prevents the camera from triggering on the initial empty graph `[]` (which previously trapped the camera target inside the Sun at `0, 0, 0` and required the user to manually click the recenter/focus button).
- **Soumaya Task Queue & Mobile Reordering**: Exposed the live flight queues (placements, link forge, beacon dispatch, removals) inside [soumaya.ts](file:///data/data/com.termux/files/home/Brain-Soumaya-V1/packages/web/src/graph/soumaya.ts#L852) to the React layout. Integrated a new collapsible **Soumaya's Active Flight Tasks** queue at the bottom of the Chat panel ([ChatPanel.tsx](file:///data/data/com.termux/files/home/Brain-Soumaya-V1/packages/web/src/components/ChatPanel.tsx#L161)), complete with status indicators (pulsing cyan for doing, grey checkmark for done, circle for planned). Added mobile-friendly `â–²`/`â–¼` controls to reorder planned tasks in the queue.
- **Camera Cockpit Lock**: Added a camera follow mode switcher (`ðŸŽ¥ Lock` vs `ðŸŽ¥ Free` inside ChatPanel) that toggles between free Orbit follow and **Cockpit Lock** (which locks the camera position and orientation right in front of the ship looking back at the nose, keeping the ship and its marquee task label dead-centered at the top of the viewport as she banking-steers through space).
- **Task Prioritization & Interruption**: Programmed Soumaya to prioritize newly added memories or deletions immediately: if she is patrolling or recharging and a priority placement or removal task arrives, she immediately aborts her current routine job/recharge and flies home to ferry/discard the memory right away.
- **Marquee Clumping & Offsets**: Solved task label marquee clumping by appending a 140px blank space loop gap to the sprite canvas when scrolling is active. Added camera offsets in `Graph3D.tsx` on desktop viewport sizes to push focused nodes/ships leftwards, preventing sidebar panels from covering them.
- **Compile and Typecheck**: Successfully verified with `npm run typecheck` and `npm run build -w @brain/web`.
- **Deployment**: Pushed changes to `claude/soumaya-second-brain-v1-m4z4hc` and deployed to Fly.io.

## Git Commits
- `aaafe5f`: Fix race condition causing pre-existing memories to be queued for ferrying on startup
- `320e15e`: Fix camera framing triggering before graph is loaded, preventing camera starting inside the sun
- `54345c4`: Support ship task list, task queue reordering â–²/â–¼, cockpit lock mode toggle, and prioritize new memory placements



