# PROJECT_STATE.md

> Living status snapshot, per [docs/AI_ENGINEERING_WORKFLOW.md](./docs/AI_ENGINEERING_WORKFLOW.md).
> Update whenever project status changes.

> ## 2026-10-19 — Phase 1 agent loop (branch `phase-1-agent-loop`, NOT merged/deployed)
> Final sign-off received to BUILD on a dedicated branch. Conversational function-calling loop
> (`agent/loop.ts`) with 5 tools, crash-safe approval lifecycle (`tool_approvals`), append-only
> `agent_logs`, strict batch semantics, and full acceptance tests (`agent/__tests__/phase1.test.ts`).
> Scope: web `POST /api/chat/agent` + Telegram loop swap. No OAuth, no destructive tools.
> **Not approved: merge or deploy** — those require passing tests, security review, and acceptance
> evidence. Previous note: this file's historical sections below remain stale (see banner).

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
