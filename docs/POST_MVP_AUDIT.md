# Post-MVP — Phase 1 (MVP Freeze) + Phase 2 (Repository Audit)

**Owner:** Claude · **Date:** 2026-07-10 · **Workflow:** [`AI_ENGINEERING_WORKFLOW_POST_MVP.md`](./AI_ENGINEERING_WORKFLOW_POST_MVP.md)
· **Zone:** 🟢 Green (analysis only — no code changed by this document)

> This kicks off the post-MVP workflow now that the tools/functions build-out is complete (all six
> Soumaya tools + the agentic router, the neuro-aligned features). It is the honest health snapshot
> that must precede any refactoring or hardening.

---

## Phase 1 — MVP Freeze

> **🔓 FREEZE LIFTED — 2026-07-10.** The full post-MVP hardening cycle is complete (audits, bug bash,
> D4 refactor, AI validation, security, performance, observability, product readiness — all
> shipped) and the accumulated `master` is being deployed. Feature growth **resumes** under the
> lighter day-to-day loop ([`WORKFLOW.md`](../WORKFLOW.md) / [`AI_ENGINEERING_WORKFLOW.md`](./AI_ENGINEERING_WORKFLOW.md),
> spec-first), steered by the north-star docs (`SECOND_BRAIN_ALIGNMENT.md`, `NEURO_ALIGNMENT.md`).
> Part 6 (Continuous Ops) is the standing rhythm; re-freeze + re-run these phases before the *next*
> major expansion, not per feature. The record below is preserved as the completed-cycle baseline.

### Scope Lock (was effective 2026-07-10 — now lifted, above)

The MVP was **feature-complete and locked** for the hardening cycle. Work was **refinement,
hardening, and bug-fix** under the priority order *Stability → Maintainability → Security →
Performance → Scalability → UX → New Features*; small tuning/copy/UX refinements shipped under it
(the fuel-rate tune + help-menu sync).

### Shipped feature inventory (the locked MVP)

- **Core:** private multi-tenant brains (name+passcode); ingestion → typed nodes + associative
  auto-linking; the 3D celestial galaxy (mass model, kinematic orbits, LOD, bloom); offline heuristic
  fallback (no key required) for embeddings + LLM.
- **Cognitive layer:** goals, ideas (lifecycle), skills (leveling), people (CRM), identity (evidence),
  mental models, motivations, future events, intentions; working-memory "mind space".
- **Companion (Soumaya):** GraphRAG chat (threaded, mood-aware, cited), interview instinct, mic,
  custom-instruction roles, knowledge docs, About-Me, daily contact, night replay, away digest,
  proactive inquiry, foresight, dream-cycle beliefs, undertakings.
- **Autonomy — the tool fleet (new):** `fire_reminder`, `create_task`, `surface_orphan`,
  `review_nudge`, `check_in`, `web_lookup` (Gemini grounding, gated) + the two-phase agentic router.
- **Neuro-aligned (new):** spaced repetition + active recall (SRS engine, review UI, star-dimming),
  forgiving streak-freeze (nebula shields), `prefers-reduced-motion` (HUD), orphan surfacing.
- **Surfaces:** the Chronicle life timeline (2D vertical track — the 3D river design was superseded; see docs/TIMELINE_CONSOLIDATION.md); Observatory home; Browse (All/Folders/Hubs); Codex;
  Awards/ranks; Hangar; fuel economy + "Ways to earn" sheet; Telegram bridge.

### Known Issues / Initial Bug Inventory

| # | Severity | Issue | Notes |
|---|---|---|---|
| K1 | **Critical (operational)** | **Large backlog of shipped-but-not-live work.** GitHub Actions is blocked on this account; deploys need a **manual `fly deploy`** (delegated to `agy`/Termux). Everything from the tool fleet onward is on `master` but not confirmed live. | Highest-priority action: deploy + verify. Nothing else is user-visible until then. |
| K2 | Medium (a11y) | `prefers-reduced-motion` covers the HUD/CSS but **not the WebGL galaxy motion** (orbits, bloom, ship, ribbon). | Accessibility debt; deferred follow-up. |
| K3 | Low (UX) | Deep-space **focus mode** and a **colorblind-palette toggle** are specced but unbuilt (NEURO_ALIGNMENT #6/#7). | Deferred polish. |
| K4 | Low (product) | The **review-nudge** and **orphan** tools can both notify about the *same* memory in one tick (it's due AND unlinked). | Minor double-nudge; de-dupe later. |
| K5 | Info | `web_lookup` grounding is **unverifiable from here** (needs a live key + Research Mode). Offline no-op is tested; the live path is not. | Verify on a real deploy. |

### Feature Backlog (deferred, needs approval to build)

WebGL reduced-motion calming · deep-space focus mode · colorblind palette · richer web-lookup
(multi-query / summarization) · client integration/E2E tests · per-space editable soul.

---

## Phase 2 — Repository Audit

**Snapshot:** ~**38.1k** LOC of source (excl. tests) across `packages/{shared,server,web}` · **24**
API route modules · **42** test files / **272** tests · **0** `TODO/FIXME/HACK` markers.

### Folder structure — 🟢 healthy

Clean monorepo (`shared` types/zod/celestial · `server` Express+SQLite · `web` Vite/React/three).
Server is well-layered: `api/routes` (thin) → `analysis`/`synthesis`/`maintenance`/`agent` (logic) →
`repositories` (SQL) → `db`. New tool-router lives in its own `agent/tools/` seam. No dead or
duplicate folders observed. A new dev can navigate it quickly.

### File organization — 🟡 several oversized files

The quality standard is <300 lines/file. Over budget (refactor candidates for Phase 8):

| File | Lines | Note |
|---|---|---|
| `web/graph/Graph3D.tsx` | 2189 | The 3D scene orchestrator — the single biggest hotspot; mixes camera, render loop, follow logic, effects wiring. Prime split candidate. |
| `web/App.tsx` | 1935 | Root component holds enormous state + effects. Extract feature hooks (fuel, streak, review, follow-cam). |
| `web/graph/soumaya.ts` | 1696 | Ship flight/label/plume/fuel model in one module. |
| `web/api/client.ts` | 1598 | One flat API client — split by domain (memories, cognitive, review, timeline, tools…). |
| `server/maintenance/agent.ts` | 711 | Job system; the older sibling of the new tool-router. |
| `web/components/MindPanel.tsx` | 659 | Dense multi-kind panel. |

These are **maintainability debt, not bugs** — they work and are tested at the behavior level.

### Function inventory / duplication — 🟡 minor

- **Two autonomy systems coexist:** the older `maintenance/agent.ts` job picker and the new
  `agent/tools/` router. Both are legitimate (jobs = graph upkeep; tools = user-facing actions), but
  the boundary should be documented so they don't drift into overlap. *(Debt D1.)*
- **`toMs`/date-parse helpers are re-implemented** across several modules (timeline, review, tools,
  nodeObject). Small, but a shared `parseTs` util would remove ~5 copies. *(Debt D2.)*
- No dead functions surfaced by the gate (unused exports would fail typecheck/lint patterns in use).

### Services / API — 🟢 consistent

24 route modules follow the same pattern (validate with zod → delegate to a service → json), guarded
by `requireSpace`. Central Express-5 error handler. Rate-limit + security headers middleware present.
New routes (`review`, `timeline`, `people/dismiss`) match the convention.

### Database — 🟡 watch two things

- **Mixed data access:** `drizzle-orm` and raw `better-sqlite3` prepared statements are used
  side-by-side (repos lean drizzle; analysis/tools lean raw SQL). Consistent *enough* but a
  documented convention would help. *(Debt D3.)*
- **`space_meta` is a widening single-row table** — feature flags keep landing on it
  (`timeline_backfilled`, `streak_shields`, …). Fine at this scale; note it before it sprawls.
- Migrations are additive + idempotent (`migrateSchema`), covered by `migration.test.ts` — 🟢 the
  most important safety property holds. New columns this cycle (review_*, reminder_fired_at,
  photo_ids, dismissed_names, timeline_chapters) all followed it.

### Dependencies — 🟢 lean and justified

- **Server:** `@google/genai`, `@huggingface/transformers` (MiniLM embeddings, baked into the image
  for offline use — heavy but load-bearing), `better-sqlite3` (native, synchronous — deliberate),
  `sqlite-vec`, `drizzle-orm`, `express`, `cors`, `zod`. No obviously-unused package.
- **Web:** `react`, `react-dom`, `react-force-graph-3d` + `three`, `mammoth` (docx), `pdfjs-dist`
  (PDF). All in active use. No CDN/runtime external calls (CSP-clean).
- **Risk notes:** `@huggingface/transformers` and `three`/`react-force-graph-3d` dominate bundle
  size (web build warns >500 kB); a code-split pass is the main perf lever. `better-sqlite3` +
  `sqlite-vec` are native — platform-pinned (already a known Termux/android-arm64 constraint).

### Architecture observations — 🟢 strong, with named debts

The provider-seam design (embeddings + LLM interfaces with heuristic fallbacks) is the codebase's
best property — every new capability this cycle (webLookup, route) followed it as an *optional*
method with a null/heuristic fallback, so the offline path never broke. Space-scoping is consistent.
The tool-router's deterministic-first / LLM-curated-second design keeps the offline guarantee.

### Technical Debt Register (prioritized: Impact + Frequency + Risk − Effort)

| ID | Debt | Impact | Priority | Action (later phase) |
|---|---|---|---|---|
| **K1** | Deploy gap (shipped ≠ live) | High | **P0** | `fly deploy` + on-device verify (delegate to `agy`). |
| D1 | Two autonomy systems (jobs vs tools) undocumented boundary | Med | P1 | One-page note on who owns what; converge only if they overlap. |
| D4 | Oversized files (Graph3D/App/client) | Med | P1 | Phase 8 refactor: extract hooks/modules; behavior-preserving. |
| D3 | Mixed drizzle + raw SQL | Low-Med | P2 | Document the convention; don't rewrite working SQL. |
| D2 | Duplicated `toMs` date helpers | Low | P2 | Extract a shared `parseTs`. |
| K2 | WebGL reduced-motion | Low-Med | P2 | Gate galaxy motion under reduced-motion. |
| — | Web/3D lacks integration tests | Med | P2 | Add a thin smoke test harness where feasible. |

### Deliverables produced

This document = **MVP Scope Lock + Known Issues/Bug Inventory + Feature Backlog** (Phase 1) and
**Repository Audit Report + Technical Debt Register + Dependency Report + Architecture Observations**
(Phase 2).

---

## Phase 3 — Bug Bash (results, 2026-07-10)

**Recent code (the tools/SRS/timeline/streak/router cycle):**
- **B1 (fixed):** timeline chapter narrative measured its day-span from `a.since` — the *epoch*
  for the first/backfill chapter — so an opening chapter read *"Across about 20454 days."* Now
  anchored on the first memory in the window. Regression test added.

**Older/core code sweep (targeted by highest-risk class):**
- **Multi-tenancy scoping — 🟢 clean.** Swept every query over `nodes/edges/insights/agent_logs/
  attachments/working_memory/inquiries/candidate_links/timeline_chapters`. All either filter
  `space_id`, or key on globally-unique node ids (an edge only ever joins same-space nodes), or
  scope via a `JOIN nodes … space_id = ?`. No cross-brain leak found. The `harmonization` AVG
  subquery and the `enrich` review query are both id-scoped and safe.
- **`JSON.parse` on stored rows — 🟢 defensive.** Every server parse of a DB column is wrapped in
  try/catch (via `parseJson`/`parseTags` helpers or inline) so one malformed row can't 500 a
  request. The `gemini`/`openai` parses throw *by design* so `ResilientLlmProvider` degrades to the
  heuristic.
- **Economy/regen — 🟢 sound.** Verified the accrue-at-cap early-return can't cause a regen burst,
  because `spend()`/`add()` always refresh `updated_at`.
- **Reminder tool ⇄ NotificationsBar — 🟢 correct by design.** The tool marks `reminder_fired_at`
  (won't re-push Telegram) but deliberately leaves `remind_at` so the in-app bar remains the
  reliable surface until the user acks — clearing it would drop the reminder for un-linked users.

**Verdict:** the older code is defensively written and multi-tenant-safe; B1 was the only real
correctness bug this pass. Deliverables: this Resolved-Issue Log + Regression test.

## D4 — Oversized-file refactor (progress, 2026-07-10)

Behaviour-preserving splits, each verified by full typecheck + build + server/web tests. A web
test harness (vitest + happy-dom + @testing-library/react; 15 tests) now backs component refactors.

| File | Before | Now | Extracted → |
|---|---|---|---|
| `api/client.ts` | 1598 | **757** | http · features · mind · attachments · companion · activity · processing · ops (8 domain modules) |
| `db/client.ts` | 491 | **218** | `schemaSql.ts` (bootstrap SQL) |
| `maintenance/agent.ts` | 711 | **656** | `jobRationale.ts` (pure rationale copy) |
| `analysis/cognitive.ts` | 451 | **378** | `cognitiveTokens.ts` (pure name-matching) |
| `components/CompanionPanel.tsx` | 447 | **25** | `CompanionSections.tsx` (the 3 self-contained sections) |
| `graph/Graph3D.tsx` | 2189 | **1942** | `graph3dHelpers.ts` |
| `graph/soumaya.ts` | 1696 | **1602** | `soumayaHelpers.ts` |
| `App.tsx` | 1935 | **1825** | `App.helpers.ts` · `usePolledCount` hook · `NavRail` · `ActionRail` |

`client.ts` down **53%**; five files brought under (or near) control. A **web test harness**
(23 tests) now backs component/hook work, so stateful extractions (usePolledCount, NavRail, ActionRail)
ship with focused tests, not typecheck-only. The remaining bulk of `App.tsx`/`Graph3D.tsx`/`soumaya.ts`
is genuinely-cohesive stateful core (render/flight loops) — extracted incrementally, section by section.

### Recommended next step

Per the workflow, Phase 2 → Phase 3 (Bug Bash) should **not** begin until the audit is accepted.
The single highest-leverage action right now is **K1: deploy the accumulated `master` and verify
on-device** — until then, none of this cycle's work is real for the user. After that: a short **Bug
Bash** (Phase 3) focused on the live build, then the **D4 refactor** of the oversized files.
