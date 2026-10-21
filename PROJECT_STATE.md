## 2026-10-21 — ADR-018 Phase A design closure

**Current phase:** Phase A design contract closed for owner review; closure amendment (blocker B1 + questions Q1–Q5) applied and independently verified — the verification's single discrepancy (D-1, legacy reminder staleness) is resolved by the owner's drop-as-unverifiable rule, now stated in the ADR; verifier confirmation of that single item is the next gate, then the owner's design-gate decision; implementation not started.  
**Branch:** `design/global-notify-cap-space-tts-cache`  
**Design record:** [ADR-018](./docs/ADR-018-global-notification-cap-and-space-owned-tts-cache.md)  
**Design-only commit:** `9d34dfec9def3f81590d28c705408724335b7b3b` (an earlier closure commit on this branch — not the branch tip) updated architecture policy; ADR Phase A closure is recorded in the design branch.  
**Baseline reviewed:** `15be567a84ca985e93d03772c4f4b2385f91ea76` plus the owner-supplied read-only verification trace.

**Approved decisions**
- The daily proactive cap is global across Telegram + push per space-local day. Each channel delivery counts separately.
- **Owner-approved Option A:** genuinely fresh qualifying urgent deliveries preserve the existing exception and may bypass both quiet hours and the cap. Every retry rechecks against original due-time metadata; expired urgency loses the exception. The stored urgent bit is not authority.
- TTS audio cache is owned by one space and deleted with that space; legacy unowned cache rows are discarded rather than assigned to a tenant.
- Cache remains globally bounded to 500 rows; the honest guarantee is “free while cached,” not lifetime exactly-once synthesis.

**Phase A design closure**
- Source-grounded transaction-boundary map covers Telegram outbox, push outbox, schema/migration definitions, TTS cache service, and space deletion.
- ADR-018 now specifies the proposed shared notification_cap_claims DDL and states, atomic claim/release transitions, cap-exempt urgent claims, retry-time reminder/bill urgency and staleness revalidation, cache table rebuild, legacy-row purge, and deletion rollback requirements.
- Closure amendment (2026-10-21, after the independent Phase A design review): resolves blocker B1 (Telegram `notification_outbox` gains `remind_at`; the sweep reclassification gains the downgrade direction) and closure questions Q1–Q5 (migration transition rule, criterion-13 interleaved harness, migrateSchema-only column placement, corrected file map naming `agent/notify/boundary.ts`, table-level legacy-fixture pattern) in the ADR's normative text. Includes the owner's fail-closed legacy-row rule: no recoverable original due time ⇒ no urgency exemption — no invented timestamp, no trusted persisted flag, ordinary cap + quiet-hours enforcement. Independent verification of the amendment then verified every item except one (D-1: the staleness input for legacy reminders was unspecified); the owner resolved D-1 fail-closed — a pre-migration Telegram reminder with `remind_at IS NULL` is dropped as unverifiable and must not be sent — and that sentence is now in the ADR (§2.4, A2b, criterion 10). The D-1 rule is reminder-specific: legacy bills carry `bill_due_at` and keep their verified handling.
- Resolved by the closure amendment: shared claim-service placement verified against the real import graph (review gate G1) and migration/fixture conventions specified (G2). Still mandatory before code (per ADR A4): verify the repository migration harness and test fixtures against the implementation as built. Any incompatibility returns to design review.

**Verification status**
- Read-only source inspection only. No production code changed; no tests/build/typecheck were run by this Phase A documentation pass.
- The closure amendment is documentation-only on the design branch; no production code changed and no tests were run for it.
- The amendment's independent verification verified all items except D-1; the D-1 closure sentence is now added (documentation only, same branch) and awaits the verifier's single-item confirmation.
- No PR opened, no merge, no secrets changed, no feature armed, no deployment.

**Next tasks**
1. Verifier confirmation of the single D-1 closure (legacy reminder staleness sentence) against the amended ADR; all other amendment items are already verified.
2. Owner design-gate decision on the amended Phase A design contract.
3. Only after separate implementation authorization: implement shared global cap and retry freshness.
4. Implement per-space TTS ownership, migration, and transactional deletion.
5. Run schema-parity/migration tests, full server/web/typecheck/build gate, concurrency and deletion rollback tests, and stash-and-fail falsification.
6. Keep TTS and VAPID feature arming on hold until implementation is accepted and post-merge verification passes.

---

# PROJECT_STATE.md

> Living status snapshot, per [docs/AI_ENGINEERING_WORKFLOW.md](./docs/AI_ENGINEERING_WORKFLOW.md).
> Update whenever project status changes.

## 2026-10-20 — W3 sleep/consolidation (wisdom layer)

**Status:** DESIGN APPROVED (Rev 11 + Amendment 1 Rev 2) → IMPLEMENTED (Milestones 1–5).
Milestones 1–3 + the gate remediation MERGED to deploy branch (PR #71 → deploy HEAD
`0d642bd`; Telegram memory fix PR #72 → `d83b924`). Milestone 4 (Phase E reconciliation)
and Milestone 5 (Phase G acceptance) are implemented and gate-verified on local branches
(`w3-milestone-4`, `w3-milestone-5`) — **NOT merged. Not approved: deploy** (Fly redeploy
is the user's manual action; bot still down pending redeploy).

- Nightly quiet-hours consolidation, sibling to the dream cycle: Phase A sweeps +
  §7.3 forget propagation, Phase B typed contradiction adjudication (deterministic
  10-cell decision table — no LLM in decisions), Phase C distillation (lineage-group
  independence, consolidated confidence capped at 0.69), Phase D reconciliation
  (bounded re-comparison, durable cursor + semantic queue, shared LLM budget).
- Stated beliefs are structurally protected: every W3 write goes through the single
  guarded boundary (`applyConsolidationMutation` in `agent/consolidation/boundary.ts`);
  stated-set integrity hash with freeze-on-mismatch (§9.4); two-tier insertion guard.
- Official repo gate (first full run, 2026-10-20): the pre-W3 baseline (`a6b60e8f`)
  carried 21 test failures / 117 typecheck errors, all pre-existing. After remediation
  and Milestones 4–5 the tree is **typecheck exit 0 · tests exit 0** (server 1,405 ·
  web 591 at Phase G close; all 78 W3 T-C test IDs verified present and passing).
- **Documented limitation (permanent):** semantic contradictions below
  `w3_recon_sim_threshold` (0.75) escape Phase D/E detection; operator-tunable.
- Acceptance records: `w3-milestone-1`…`w3-milestone-5` + `integrated-gate-record-2026-10-20`
  (wisdom-layer record set, kept with the review trail).

## 2026-10-19 — W2 episodes + user model (wisdom layer)

**Status:** DESIGN APPROVED (5 review rounds) → IMPLEMENTED → MERGED to deploy branch
(PR #67, per explicit user instruction, with verification gates open). Integration on
branch `w2-integration` (pushed, NOT merged).
**Not approved:** deploy. **`npm run typecheck` + `npm test` NEVER RAN on the real repo**
(sandbox limitation; user's 8pm WiFi run pending). No CI.

Wisdom layer phase 2: episodic memory + structured user model. Motivated by a real
Telegram conversation where the bot surfaced stale employment (Gopuff over Samsonite),
treated the user's girlfriend as a stranger, and answered "where do I work"
inconsistently across turns — retrieval had no notion of "currently true" and no
structured model of the user.

- `agent/episodic.ts`: `captureEpisode()` (hot-path, never throws, forget-list check
  first), `claimEnrichment()` (atomic quota reservation + fencing tokens), `enrichEpisode()`
  (background worker, injectable enricher, template fallback — no cloud dependency),
  `applyForgetRequest()` (single-transaction propagation, content-free audit,
  canonical tombstone `[redacted per forget request #N]`), `validateProvenance()` +
  `evidenceSafeFields()` (fail-closed).
- `agent/userModel.ts`: `recordStated()` (0.95, one-proposition rule, conservative
  trigger boundary), `correctUserModel()` (abstain-on-ambiguity), `knowledgeCheck()`
  (**READ-ONLY** per INV-KC-1 — judgment only, never mutates `user_model`),
  `composeUserModelBlock()` (prompt injection of ≥0.40-confidence claims), topic mapper
  (12 controlled topics), `evidence_strength` formula.
- Schema: `episodes` (immutable capture) + `episode_enrichments` (versioned,
  `superseded_by` chaining) + `enrichment_quota` + `forget_requests` + `user_model`
  (`topic_labels`, `replaced_by`, typed evidence refs) + `episodes_fts` +
  `vec_episodes` (production `bootstrapVec` — P0 review fix; was test-helper-only).
- 86+ tests in `agent/__tests__/w2.test.ts` (all passing in a local real-SQLite harness;
  the real repo suite is UNVERIFIED). T-VEC-1 regression exercises `vec_episodes`
  through production `createDb()`, no test helper.

**Integration (branch `w2-integration`, NOT merged):**
- `memorySearch`: episodes as a parallel namespace (never merged with node facts);
  **W1 temporal wiring** — raw `knn()` → `vecSearchCurrent()`, so superseded facts
  are filtered at seed time on the conversational path (the exact gap evaluators found).
- `agent/loop.ts`: `composeUserModelBlock()` in the system prompt; `maybeRecordStated()`
  at turn start; `captureTurnEpisode()` on ALL return paths including LLM-error
  (review fix); `episodeCaptured` flag on `AgentLoopResult`.
- 6 capture triggers: loop turns, Telegram fallback, digests/proactive, approval
  denials, router job ticks — with double-capture protection.
- Review: ChatGPT closed the LLM-error finding; full verification + docs gates open.

**Blocked:** automated verification — work WiFi bars GitHub on the test device.
**Deploy:** user deploys manually via Fly; bot still down pending redeploy.

## 2026-10-19 — W1 temporal truth (merged to deploy branch)

**Status:** BUILT, awaiting `npm run typecheck` + `npm test`. Design signed off after 6 review revisions.
**Not approved:** merge, deploy.

Wisdom layer phase 1: bitemporal columns on `nodes` (`valid_from`/`valid_to`/`recorded_at`/
`superseded_at`/`superseded_by`/`supersede_reason`) + append-only `corrections` table.
`agent/temporal.ts`: `supersede()` writer (3 correction types, single shared opTime,
atomic transaction, optimistic concurrency, content-free audit), `isNeverTrue()` /
`getCorrections()` derived helpers, Contract 1 (as-of) + Contract 2 (history) queries.
Retrieval: `NodesRepo` filters superseded by default (`getCurrentById`, `recent`/`all`/
`byIds` with opt-in), `vecSearchCurrent()` iterative over-fetch, FTS WHERE filter,
digest cooling/reminders filtered. Cascade disabled by default. 26 acceptance tests
in `agent/__tests__/w1-temporal.test.ts`.

**Blocked:** automated verification — work WiFi bars GitHub on the test device; tests run on good network.

## 2026-10-19 — Phase 2 notification policy (branch `phase-2-notification-policy`)

**Status:** BUILT, awaiting `npm run typecheck` + `npm test`. Design signed off after 5 review rounds.
**Not approved:** merge, deploy.

Proactive Telegram sends now go through a single policy boundary: per-space quiet hours
(21:00–04:30 default), daily cap (5, default), timezone-aware scheduling, urgent bypass
(fresh reminders, bills due <6h), crash-safe outbox (`queued→sending→sent|failed|dropped|ambiguous`),
atomic cap claims, Telegram commands (`/quiet /digest /cap /tz /settings`). Digest fires at
per-space `digest_time` (06:00 default) instead of midnight UTC.

**Blocked:** automated verification — work WiFi bars GitHub on the test device; tests run on good network.
**Telegram:** not configured on Fly (no `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` yet).

## 2026-10-19 — Phase 1 agent loop (branch `phase-1-agent-loop`)

**Status:** BUILT, statically reviewed (9 bugs fixed), awaiting `npm run typecheck` + `npm test`.
**Not approved:** merge, deploy.

Conversational function-calling loop: 5 tools (memory_search, web_lookup, check_in,
fire_reminder, create_task), approval state machine with per-approval idempotency keys,
strict ordered batch semantics (6 iterations / 4 calls / 12 executions), append-only audit.
Web `POST /api/chat/agent`; Telegram free-text routed through the loop.

> **⚠️ STALE (flagged 2026-08-25):** this snapshot is dated 2026-06-30 and predates roughly two
> months of active commits (feature-growth work, Vision 2.0/Journeys, and a full-project review/fix
> pass). Treat the "Current Sprint" and "Completed" sections below as historical, not current status.
> For current state, see **[CLAUDE.md](./CLAUDE.md)**'s top-of-file STATUS line and
> **[GEMINI_CHANGES.md](./GEMINI_CHANGES.md)** (newest-first change log, both kept live).

**Current Phase:** Feature growth + hardening on a shipped product (Soumaya · Second Brain is live on Fly.io).

**Current Sprint (2026-06-30):** Hardening pass — full-project bug/pitfall sweep fixed (server
multi-tenant/auth/provider holes + web VRAM/state/SW bugs), the black-hole "Singularity" prestige
figurine, the Pilot Manual rewrite, and reconciling the design docs with shipped reality. The
second-brain growth stages (0–4) and gamification Waves 1–2 are **implemented and merged**.

## Completed (recent)
- Gamification **Wave 1** — celebratory toasts, return greeting, memory-count milestones, fuel pops,
  tier-up toasts.
- Gamification **Wave 2** — achievements (7 feats) + the **🏆 Awards tab** trophy case
  (`AchievementsPanel`); **daily-tending streaks** (server-authoritative `StreakRepo` over additive
  `space_meta` columns, 🔥 HUD chip + Awards banner, +2 fuel/day bonus).
- Fixed agy's stale `api.test.ts` (gamerTag auth migration) — gate green at **91 tests**.
- Adopted mandatory [AI engineering workflow](./docs/AI_ENGINEERING_WORKFLOW.md) +
  [second-brain north star](./docs/SECOND_BRAIN_BRIEFING.md); wrote
  [alignment + growth plan](./docs/SECOND_BRAIN_ALIGNMENT.md).

## Second-brain growth stages — ✅ IMPLEMENTED & SHIPPED (verified by Claude 2026-06-30)
Stages 0–4 are merged and live; their specs in `docs/specs/` now carry matching ✅ status banners
and are retained as the design record. Summary below.
  - [Stage 0 — Taxonomy expansion](./docs/specs/stage-0-taxonomy.md) 🔴 — **IMPLEMENTED.** `NodeType`
    is now person·project·decision·company·meeting·daily·knowledge·concept·other; legacy values
    (business_idea/relationship_reflection/random_thought) map via `normalizeNodeType` (no migration —
    type is free TEXT). Extraction prompt + offline heuristic classify into the new kinds (tested);
    per-kind color (`colorForType`, legacy-tolerant); List tab filters by kind + a color legend.
    Gate green (92 tests).
  - [Stage 1 — Constellation hubs / MOCs](./docs/specs/stage-1-mocs.md) 🔴 — **IMPLEMENTED (v1).**
    `moc` node kind + `summarizes` edges; `POST /api/constellations/promote` turns a detected cluster
    into a persistent, named hub with a curated summary (offline-safe via `summarizeSector`), space-
    scoped. Insights tab gains an inline "✦ Save as constellation"; the hub renders as a bright golden
    body with its name as a macro label, and clicking it shows summary + members. Gate green (94 tests).
    Deferred: Soumaya *auto-proposing* hubs at the squeeze point (manual human-curated promotion ships now).
  - [Stage 3 — Provenance & hygiene](./docs/specs/stage-3-provenance.md) 🔴 — **IMPLEMENTED.** Additive
    `nodes.origin` column (bootstrap + migration); `GraphNode.origin`; MOC hubs created as `origin:"agent"`.
    NodeInspector shows a "✦ Charted by Soumaya" badge on agent-authored nodes; List tab gains a
    "🪐 drifting" orphan-lint filter (link-less memories). Gate green (94 tests).
  - [Stage 2 — The Observatory (home)](./docs/specs/stage-2-observatory.md) 🟢 — **IMPLEMENTED.**
    `components/Observatory.tsx` fades in ~3.4s after load (after the cinematic settles; intro
    untouched): greeting + streak, capture, Soumaya's latest connection, your constellations
    (`getConstellations`), jump-back-in (recent), "Enter the galaxy". 🔭 FAB reopens it. New-brain
    hero for empty galaxies. Offline-safe; gate green (91 tests).
  - [Stage 4 — Identity layer wiring](./docs/specs/stage-4-identity-layer.md) 🔴 — **IMPLEMENTED.**
    `server/identity.ts` loads `soul.md` at boot (cached, frontmatter-stripped) and `graphrag` injects
    it into the chat system prompt's identity slot via `composeSystem({ soul })`. Offline-safe: missing
    file → falls back to the hardcoded ANSWER_SYSTEM voice. Gate green (95 tests). Deferred: wiring soul
    into the daily-log/maintenance voice; editable per-space soul from the Companion tab.

## Completed (this session, cont.)
- **Soumaya reactions** — she reacts in her own voice to new connections on ingest (1/2/3+ links → distinct lines).
- **Autonomy hardening** — `/next-job` merge scan bounded to the 50 most-recent memories (was O(n) knn/tick);
  in-memory `withClaim` idempotency so the server loop + a browser tab can't double-run a job (+1 test).
- **Daily quests / tend list** (`components/quests.ts`): 1–3 live click-through nudges (feed today / warm
  a cooling memory / revisit a drifting one) in the Observatory's "Today's tending" card.
- **Observatory toast fix** — celebratory toasts buffer behind the home cards and flush when you exit.
- **Pilot rank / level-up** (`components/rank.ts`): 8 named tiers by memory count, banner atop the Awards
  tab with a progress bar + per-brain level-up toast — the visible side of the same progression that
  speeds Soumaya up. ("✦ New constellation" discovery toast already fires on promotion.)
- **Soumaya movement rework** (`graph/soumaya.ts`): distance-aware time-bounded cruise — short hops
  gentle, no trip > ~5.5s, very long hauls "warp" to a much higher top speed; per-task base speeds
  preserved; smooth() accel/decel kept. New **progression** `pilotSpeed` (1.0 → ~1.9×) from memory
  count + streak, threaded App → Graph3D → handle, so she flies faster the more you use the brain.

## Blocked
- **Deploy delivery** — GitHub Actions is blocked on this account; nothing ships until `agy` runs a
  manual `fly deploy`. The whole gamification batch (Waves 1–2) is pushed but **not yet live** — the
  user can't see the Awards tab / streak chip until a deploy.

## Next Tasks
1. Delegate an `agy` `fly deploy` so the hardening pass + black hole + manual rewrite go live, then
   the user hard-reloads past the PWA worker to confirm.
2. Backlog of deferred niceties: Soumaya auto-proposing MOC hubs at the squeeze point; wiring `soul`
   into the daily-log/maintenance voice; editable per-space soul from the Companion tab; code-split
   the web bundle.

## Known Issues / Technical Debt
- Web bundle > 500 kB (single chunk) — code-split later.
- A few large files exceed the 300-line guideline (`graph/Graph3D.tsx`, `graph/soumaya.ts`,
  `App.tsx`, `api/client.ts`) — candidates for a future refactor.
- Identity layer is partly DB-backed (persona/companion) alongside the `soul.md` file family.

**Last Updated:** 2026-06-30 — gate green: typecheck clean · **101 server tests** · web build clean.
