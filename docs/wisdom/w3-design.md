# W3 Design: Sleep / Consolidation — Draft v1

**Status:** Draft for review. Not approved. No implementation authorized.
**Branch:** (to be created) · **Depends on:** W1 (merged), W2 (merged + integrated)
**Author:** King (Muse) · **Date:** 2026-10-19

---

## 1. Problem

W1 gave Soumaya temporal truth (what is currently true). W2 gave her episodes (what happened) and a user model (what she believes about the user). But three gaps remain, all visible in production:

1. **The `potential_contradiction` backlog is write-only.** W1's `temporal.ts` logs ambiguous supersession cases to `agent_logs` with `result='pending_w3'` — and nothing reads them. They accumulate forever. (Verified: `logPotentialContradiction()` in `packages/server/src/agent/temporal.ts:314-331`.)

2. **W2's maintenance sweeps have no scheduler.** `sweepStaleEmotions()` (7-day emotion expiry) and `sweepWithdrawnEvidence()` (auto-invalidate entries whose evidence is fully withdrawn) exist in `userModel.ts` — and the latter's docstring explicitly says it is "W3-scheduled" because running it on the read path would break INV-KC-1. Nothing calls either function today. (Verified: `packages/server/src/agent/userModel.ts:2493-2534`, `2536-2606`.)

3. **Episodes never become understanding.** Every conversation turn is captured as an episode (W2 integration), but no process ever reads those episodes back to form durable beliefs. The user model only grows through the hot path (`maybeRecordStated`). A user who never states things explicitly — who just *lives* — accumulates thousands of episodes and zero consolidated understanding. This is the exact failure the wisdom-layer research identified: Smallville's reflection threshold, Mem0's consolidation, Zep's invalidation — all require a background process that integrates experience into belief.

**W3 is that process:** a quiet-hours consolidation job that turns raw experience into durable, evidence-linked understanding — without ever deleting, hallucinating, or overriding the user.

---

## 2. Relationship to the existing dream cycle

There is already a dream cycle (`packages/server/src/analysis/dreamCycle.ts`, invoked from the autonomy tick in `index.ts:247-320`). It must not be duplicated or replaced. The two processes have distinct, complementary jobs:

| | Existing dream cycle | W3 consolidation |
|---|---|---|
| **Input** | `nodes` graph (memories, high-degree clusters) | `episodes` + `potential_contradiction` backlog + `user_model` maintenance |
| **Output** | `kind:"belief"` nodes with `summarizes` edges (galaxy-visible worldview) | `user_model` rows with `origin='consolidated'` (self-model: who the user is) |
| **Question answered** | "What patterns exist in the memory graph?" | "What do I now believe about the user, given what happened?" |
| **Cadence** | Once per UTC day | Once per space-local day, during quiet hours |

**Architectural rule:** the dream cycle reasons about the *world* (third-person knowledge, galaxy beliefs). W3 reasons about the *user* (first-person model). A consolidation output goes to exactly one destination — never both. §4 defines the routing rule.

W3 runs in the same autonomy tick (`AUTONOMY_MS`, default 5 min) as the dream cycle, in the same per-space loop, subject to the same paid-call ceiling (`AUTONOMY_MAX_PAID_PER_TICK`). It is a sibling, not a replacement.

---

## 3. The consolidation job

### 3.1 When it runs

- **Window:** space-local quiet hours (`space_meta.quiet_start`–`quiet_end`, default 21:00–04:30). Verified: these columns exist in `space_meta` with the Phase 2 notification policy defaults.
- **Cadence:** at most once per space-local day per space. Tracked via a new `space_meta` column `last_consolidation_date` (TEXT, `YYYY-MM-DD` in the space's timezone — same pattern as the existing `last_dream_date`, which uses UTC; W3 uses space-local because quiet hours are space-local).
- **Trigger:** the autonomy tick checks, per space: `last_consolidation_date != today_local AND now_local within quiet hours`. If both hold, run.
- **Skip conditions (fail-safe):** if the previous run's status is `running` and its `started_at` is < 6 hours ago, skip (a crashed run's lease hasn't expired — §7 handles recovery). If the space has zero unconsolidated episodes AND zero pending contradictions AND no sweeps due, skip silently (no empty runs).

### 3.2 What it reads (in order)

1. **Sweep phase (no LLM, always runs):**
   - `sweepStaleEmotions(h, spaceId)` — expires `emotion_state` rows older than 7 days.
   - `sweepWithdrawnEvidence(h, spaceId)` — invalidates `inferred`/`consolidated` entries whose evidence is entirely withdrawn; flags `stated` entries for user review (never invalidates them).
2. **Contradiction phase (LLM-optional, budgeted):** all `agent_logs` rows with `action='potential_contradiction' AND result='pending_w3'`, oldest first. See §5.
3. **Distillation phase (LLM-optional, budgeted):** unconsolidated episodes — `episodes` rows where `id NOT IN (SELECT episode_id FROM consolidation_episodes)` (see §8), `forgotten_at IS NULL`, `occurred_at` older than 24h (never consolidate today's raw experience — let it settle), ordered by `importance DESC, occurred_at ASC`. See §4.

### 3.3 What it writes

- `user_model` rows with `origin='consolidated'` only. Never `stated`, never `inferred` (see §6, INV-C-1).
- `nodes` rows (world-knowledge only, per §4 routing) — rare; most runs write zero nodes.
- `agent_logs` rows for every action (contradiction resolutions, consolidations, sweeps) — content-free, IDs + reason codes only (W1/W2 audit convention).
- `consolidation_runs` + `consolidation_episodes` bookkeeping (see §8).

### 3.4 What it never writes

- Never touches `origin='stated'` rows (read-only w.r.t. stated slots — may read them as evidence, never modify).
- Never modifies `episodes` (immutable) or `episode_enrichments` (versioned).
- Never deletes anything, anywhere. (Follows the W1/W2 no-deletion rule; forgetting is the user's explicit action via `applyForgetRequest()`, not consolidation's.)
- Never overrides a `corrections` row with `correction_type='user_override'` — a user's explicit correction is terminal. If consolidation disagrees with a user override, it logs `consolidation_suppressed_by_override` and moves on.

---

## 4. Memory distillation: episodes → understanding

### 4.1 The routing rule (one proposition, one home)

Each distillation candidate is classified before writing:

- **Self-model** — the insight is about the *user* (their beliefs, desires, habits, constraints, relationships, emotional patterns). → `user_model`, appropriate slot, `origin='consolidated'`.
  - Example: episodes about late-night coding sessions → `user_model` (`belief`: "does focused work late at night", evidence: episode IDs).
- **World-knowledge** — the insight is about the *world* (facts, how-tos, entities). → `nodes` (a semantic fact node), linked to source episodes via `summarizes` edges.
  - Example: episodes about the Samsonite job → `user_model` (`belief`: "works at Samsonite warehouse", evidence: episodes). The fact "Samsonite is a luggage manufacturer" (if it appeared) → `nodes`.

**The test:** if the sentence starts with "the user…", it's self-model. Otherwise, world-knowledge. When in doubt, self-model wins (W3's job is the user model; the dream cycle already handles world-knowledge via the node graph).

### 4.2 Distillation without duplication

Before writing any consolidated entry, the job checks for an existing covering proposition:

1. **Same slot + overlapping topic labels + temporally current** in `user_model` → do NOT create a duplicate. Instead, *strengthen*: append the new episode IDs to the existing entry's `evidence_ids` and recompute `evidence_strength`. (This is how "works at Samsonite" gets stronger each time he mentions work, rather than spawning five rows.)
2. **Covered by a `stated` entry** → do NOT write. Stated outranks consolidated, always. Log `consolidation_redundant_with_stated`.
3. **Covered by a newer `consolidated` entry with ≥ evidence strength** → skip.

### 4.3 Confidence ceilings for consolidated entries

W2's confidence semantics (Rev 5): confidence = belief-report confidence, capped by origin.

- `consolidated` entries: **capped at 0.69** (same ceiling as `inferred`). The system may be confident in its synthesis, but machine-synthesized beliefs never reach stated-level authority (0.95).
- Consolidation requires **≥2 independent episodes** (W2's independence rule — same conversation = 1 observation) OR 1 episode + 1 corroborating node. Single-episode "insights" are not consolidated; they're left for a future run with more evidence.
- `evidence_strength` is computed from the W2 formula (source count × independence × recency), stored alongside.

### 4.4 What does NOT get distilled

- Episodes with `importance < 0.4` (below the significance bar — noise).
- `kind='job_run'`, `kind='digest_sent'` episodes (operational, not experiential) — unless they contain a user-visible outcome worth modeling.
- Episodes already covered by a current user-model entry (see §4.2).
- Anything the topic mapper can't classify with confidence — logged as `consolidation_abstained`, not forced.

---

## 5. Contradiction resolution

### 5.1 The backlog

`agent_logs` rows where `action='potential_contradiction' AND result='pending_w3'`. Each row's `targets` JSON contains `{old_id, why}`. The job processes them oldest-first, within budget.

### 5.2 Adjudication rules (in priority order)

1. **User statement wins.** If either side is traceable to an explicit user statement (`origin='stated'` user_model entry, or a `correction` with `corrected_by='user'`), that side wins. No LLM judgment needed — deterministic.
2. **Recency.** If both sides are system-derived, the newer evidence wins — *unless* the older side has strictly greater evidence strength (≥2 independent sources vs 1).
3. **Evidence strength.** `evidence_strength` comparison as tiebreaker.
4. **Unresolvable.** If the rules don't produce a clear winner (equal strength, no user statement, genuinely ambiguous): **keep both, mark the row `result='unresolved'`**, and create a W2 `inquiry` candidate (a question for the user, surfaced via the normal inquiry path — not auto-asked). The system must not silently pick a winner when it doesn't know.

### 5.3 Resolution actions

- **Winner determined:** call W1's `supersede()` with `supersede_reason='update'`, `correctedBy='system'`. This closes the loser's validity interval and preserves history (W1's core guarantee).
- **Unresolvable:** mark `result='unresolved'`, log the reasoning (IDs + rule outcomes, no content), optionally queue an inquiry.
- **Stale:** if both nodes have since been superseded by other operations, mark `result='moot'` — no action needed.

### 5.4 Audit

Every adjudication appends an `agent_logs` row: `{contradiction_id, winner_id, loser_id, rule_applied, actor: 'system'}`. Content-free, per convention. The original `potential_contradiction` row's `result` is updated from `'pending_w3'` to `'resolved' | 'unresolved' | 'moot'` — this is a status transition on a log row, not a content mutation, and it's what makes the job idempotent (re-runs skip non-pending rows).

---

## 6. Safety invariants

**INV-C-1 (origin ceiling):** Consolidation writes `origin='consolidated'` only. The `updateUserModel()` function already rejects `origin='stated'` with `origin_forbidden` (verified: `userModel.ts:1414-1421`). W3 never calls `recordStated()`. Enforcement: code review + a test that asserts no `consolidated`-run row has any other origin.

**INV-C-2 (stated is sacred):** Consolidation never modifies, invalidates, or supersedes a `user_model` row with `origin='stated'`. It may read stated rows as evidence and may *strengthen* a consolidated row that agrees with a stated row, but stated rows are only ever written by `recordStated()` (hot path) or `correctUserModel()` (explicit correction path).

**INV-C-3 (user override is terminal):** If a `corrections` row with `correction_type='user_override'` exists for a proposition, consolidation does not write a competing belief. It logs `consolidation_suppressed_by_override` and moves on.

**INV-C-4 (evidence or it didn't happen):** Every consolidated `user_model` row must have non-empty `evidence_ids` pointing to real episodes/nodes. Write-time rejection — same pattern as W2's `validateProvenance()`. A consolidation output without evidence links is a bug, not a feature.

**INV-C-5 (no deletion, no resurrection):** Consolidation never deletes. It never clears `forgotten_at`, never re-embeds forgotten episodes, never re-activates invalidated rows. The forget flow is the user's explicit action; consolidation respects its outcomes unconditionally.

**INV-C-6 (bounded autonomy):** Consolidation never sends messages, never fires tools, never triggers notifications. It writes to the model and the log. If it discovers something urgent (e.g., a contradiction about medication), it queues an inquiry — the Phase 2 notification policy decides whether and when the user hears about it. W3 has no send path.

---

## 7. Forgetting and decay

### 7.1 The model: soft forgetting, not deletion

Nothing is ever deleted by decay. Instead, retrieval weight decays with time since last access:

```
weight(t) = base_weight × 0.5 ^ (hours_since_last_access / half_life_hours)
```

Per-kind half-lives (from the research phase, carried into this design):

| Kind | Half-life | Rationale |
|---|---|---|
| Episodes | 7 days | Experience fades fast; recent experience dominates |
| user_model `desire` / `intention` slots | 90 days | Preferences drift slowly |
| user_model `belief` / `knowledge` slots | 180 days | Beliefs are stickier than preferences |
| `constraint` slot, `stated` origin (any slot) | ∞ (no decay) | Constraints and explicit statements don't fade |

### 7.2 How decay is applied

**Read-time computation, not write amplification.** W3 does not walk the database rewriting weights every night. Instead:

- `episodeSearch()` and `getUserModel()` accept the decay-weighted score as part of ranking (the canonical scorer from W2 §7.2 gains a recency term).
- "Last access" = `last_accessed_at`, a column W3 adds to `episodes` and `user_model` (see §8), updated on read (piggyback on existing reads — a single `UPDATE` per read batch, not per row).

### 7.3 Interaction with W1 supersession and W2

- **W1 supersession is binary; decay is graded.** They compose: `superseded_at IS NOT NULL` → excluded entirely (W1's filter runs first). Surviving rows are then decay-weighted. A superseded row never "decays back" into relevance.
- **W2's `sweepStaleEmotions`** is the hard-expiry backstop for `emotion_state` (7 days, then `invalid_at` set). Decay handles the graded fade before that cliff.
- **Stated entries never decay** (INV-C-2 extends to decay: the user's explicit words don't fade with time; they're only ever replaced by newer stated words or explicit corrections).

---

## 8. Schema changes

All additive, following the repo's migration conventions (PRAGMA-guarded `ALTER TABLE` in `migrateSchema()`, table creation in `BOOTSTRAP_SQL`).

### 8.1 `space_meta` additions

```sql
ALTER TABLE space_meta ADD COLUMN last_consolidation_date TEXT;  -- YYYY-MM-DD, space-local
ALTER TABLE space_meta ADD COLUMN w3_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE space_meta ADD COLUMN w3_llm_budget INTEGER NOT NULL DEFAULT 5;   -- max LLM calls per run
ALTER TABLE space_meta ADD COLUMN w3_max_items INTEGER NOT NULL DEFAULT 50;  -- max work items per run
```

### 8.2 `consolidation_runs` (new table)

```sql
CREATE TABLE IF NOT EXISTS consolidation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','aborted_budget')),
  items_processed INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  contradictions_resolved INTEGER NOT NULL DEFAULT 0,
  consolidations_written INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_consolidation_runs_space
  ON consolidation_runs(space_id, started_at DESC);
```

### 8.3 `consolidation_episodes` (new table — idempotency ledger)

Records which episodes were considered by which run, and the outcome. This is what makes re-runs skip already-processed episodes without mutating the episodes table.

```sql
CREATE TABLE IF NOT EXISTS consolidation_episodes (
  run_id INTEGER NOT NULL,
  episode_id INTEGER NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('consolidated','strengthened','skipped_covered','skipped_low_importance','abstained','failed')),
  resulting_entry_id INTEGER,  -- user_model.id or nodes.id, when written/strengthened
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (run_id, episode_id)
);
```

### 8.4 `last_accessed_at` columns

```sql
ALTER TABLE episodes ADD COLUMN last_accessed_at TEXT;   -- NULL = never accessed since W3
ALTER TABLE user_model ADD COLUMN last_accessed_at TEXT;
```

Backfill: `last_accessed_at = recorded_at` (episodes) / `valid_at` (user_model) — first access approximated as creation. Nullable in migration (SQLite `ALTER TABLE` limits), NOT NULL enforced by app invariant going forward.

---

## 9. Job lifecycle and idempotency

### 9.1 Run structure

```
begin_run(spaceId):
  1. INSERT INTO consolidation_runs (space_id, started_at, status='running')
  2. Phase A (sweeps): sweepStaleEmotions + sweepWithdrawnEvidence — no LLM, no budget
  3. Phase B (contradictions): process pending_w3 rows oldest-first until budget exhausted
  4. Phase C (distillation): process unconsolidated episodes until budget exhausted
  5. UPDATE consolidation_runs SET status='completed'|'aborted_budget', completed_at=now
```

### 9.2 Crash recovery

- If the process crashes mid-run, the row stays `status='running'`. The next tick sees a `running` row with `started_at` > 6h ago → treats it as dead: marks it `'failed'` (with `error='lease_expired'`) and starts a new run.
- Phase B is idempotent: contradiction rows are claimed by `UPDATE agent_logs SET result='processing_w3' WHERE id=? AND result='pending_w3'` — a crashed run's `processing_w3` rows are reclaimed by the next run (same lease-expiry pattern as W2's enrichment fencing).
- Phase C is idempotent: `consolidation_episodes` has `PRIMARY KEY (run_id, episode_id)`, and episode selection excludes any episode already present in `consolidation_episodes` for a *completed* run. A crashed run's partial work is re-processed (distillation is itself idempotent — §4.2's dedup check prevents double-writes).

### 9.3 Budget enforcement

- `w3_llm_budget` (default 5) and `w3_max_items` (default 50) per run, from `space_meta` (user-tunable via future `/settings`-style commands; not in W3 scope).
- Every LLM call decrements the budget; when exhausted, the run sets `status='aborted_budget'` (not `'failed'` — this is a normal outcome, retried tomorrow).
- Sweeps (Phase A) never consume LLM budget — they're pure SQL.

---

## 10. Cost bounds

| Resource | Bound | Enforcement |
|---|---|---|
| LLM calls per run | `w3_llm_budget` (default 5) | Counter checked before each call; `aborted_budget` on exhaustion |
| Work items per run | `w3_max_items` (default 50) | Loop bound |
| Wall-clock per run | 10 minutes | Timeout wrapper; run marked `failed` with `error='timeout'` |
| Runs per day per space | 1 | `last_consolidation_date` gate |
| Paid LLM per tick (global) | `AUTONOMY_MAX_PAID_PER_TICK` (existing) | Shared with dream cycle |

Worst case per space per day: 5 LLM calls + 50 items. At current model pricing, negligible. The global per-tick paid ceiling provides backstop against multi-space bursts.

---

## 11. Failure modes

| Failure | Behavior |
|---|---|
| LLM call throws | Caught per-item; item marked `failed` in `consolidation_episodes`; run continues. Never aborts the run. |
| Budget exhausted mid-run | `status='aborted_budget'`; remaining items wait for tomorrow. Not an error. |
| Process crash mid-run | Lease expiry (6h) → next run marks old `failed`, starts fresh. Partial work re-processed idempotently. |
| DB locked / contention | All writes in short transactions; run yields between phases. If a transaction fails, retry once, then mark item `failed`. |
| Contradiction adjudication throws | Row stays `pending_w3`; run continues. A poison row can't block the backlog (max 3 attempts tracked via a new `attempts` counter on the log row's `targets` JSON — after 3, marked `unresolved`). |
| Distillation produces no evidence | Write-time rejection (INV-C-4); item marked `abstained`. |
| Space deleted mid-run | Foreign-key-less design: run checks space existence per phase; aborts quietly if gone. |

---

## 12. Test plan

**Sweep tests:**
- T-C1: `sweepStaleEmotions` expires a 8-day-old `emotion_state` row, leaves a 6-day-old row.
- T-C2: `sweepWithdrawnEvidence` invalidates an `inferred` entry with all evidence withdrawn; flags (doesn't invalidate) a `stated` entry.
- T-C3: sweeps are idempotent — running twice changes nothing the second time.

**Contradiction tests:**
- T-C4: user-statement-wins — a `potential_contradiction` where one side traces to `origin='stated'` resolves deterministically without LLM.
- T-C5: recency rule — newer system-derived evidence wins over older.
- T-C6: unresolvable — equal strength, no user statement → `result='unresolved'` + inquiry queued, both rows kept.
- T-C7: idempotency — re-running the job skips `resolved`/`unresolved`/`moot` rows.
- T-C8: crash recovery — a row stuck in `processing_w3` past lease expiry is reclaimed.

**Distillation tests:**
- T-C9: two independent episodes about the same topic → one `consolidated` user_model entry with both episode IDs in `evidence_ids`.
- T-C10: dedup — a third episode on the same topic *strengthens* (appends evidence, recomputes strength) instead of creating a duplicate.
- T-C11: stated-wins — consolidation does not write when a current `stated` entry covers the proposition.
- T-C12: confidence ceiling — consolidated entries never exceed 0.69.
- T-C13: single-episode insight is not consolidated (needs ≥2 independent episodes).
- T-C14: no-evidence write is rejected (INV-C-4).
- T-C15: user_override suppression — a proposition with a `user_override` correction is not consolidated; `consolidation_suppressed_by_override` logged.

**Decay tests:**
- T-C16: decay weighting — a 30-day-old episode scores lower than a 1-day-old episode, all else equal.
- T-C17: stated entries don't decay.
- T-C18: superseded rows are excluded before decay is applied (W1 composes correctly).

**Job lifecycle tests:**
- T-C19: run executes all three phases and marks `completed`.
- T-C20: budget exhaustion → `aborted_budget`, resumes next run.
- T-C21: quiet-hours gate — run doesn't fire outside quiet hours; doesn't fire twice in one local day.
- T-C22: 6-hour lease expiry on crashed runs.

---

## 13. Non-goals

- **No new model, DB, or service.** Uses the existing LLM provider interface (`ctx.llm`), existing tables plus the §8 additions.
- **No real-time consolidation.** The hot path stays fast; understanding compounds overnight. (This is the point of sleep.)
- **No user-facing output.** W3 never messages the user. Inquiries it queues go through the normal Phase 2 policy path.
- **No deletion or hard forgetting.** Decay is graded weight, not removal. Forgetting is the user's explicit action.
- **No `stated` writes, no `inferred` writes.** Only `consolidated`. (W3 doesn't do hot-path inference — that's W2's `maybeRecordStated`.)
- **No cross-space consolidation.** Every run is scoped to one `space_id`. Same-space rule, like W1/W2.
- **No galaxy visualization changes.** The dream cycle owns belief nodes; W3's user_model rows are not galaxy nodes (W7 territory if ever).

---

## 14. Open questions

1. **Should W3 absorb the existing dream cycle?** They're siblings now (world vs self). But two "sleep" processes with separate schedules could confuse. Alternative: W3 *calls* `runDreamCycle()` as Phase D, unifying under one quiet-hours run. Counter: the dream cycle's once-per-UTC-day cadence and paid-gating are tuned independently; merging risks breaking both. **Recommendation:** keep separate for W3; revisit in W6/W7.
2. **Distillation LLM vs template fallback.** Like the dream cycle, W3 should have an offline template path when no LLM key exists or budget is exhausted. How expressive can template-based consolidation be without producing garbage beliefs? Needs a design constraint: template path only strengthens existing entries, never creates new ones.
3. **The 24-hour settling rule.** §3.2 says never consolidate today's episodes. Is 24h right, or should it be "older than the last completed run"? The latter is simpler and self-tuning.
4. **`last_accessed_at` write amplification.** Updating it on every read could be write-heavy on a busy brain. Batch it (update at most once per hour per row) or sample it? Needs a perf decision before implementation.
5. **Inquiry surfacing.** Unresolvable contradictions queue inquiries — but what's the UX? Do they appear in the digest, as proactive messages, or in a review UI? This is W6 (proactivity) territory; W3 just queues them.

---

## 15. Changelog

- **Draft v1 (2026-10-19):** Initial design. Grounded in: `index.ts` autonomy tick (5-min, paid ceiling, dream cycle), `dreamCycle.ts` (existing consolidation — W3 is a sibling, not a replacement), `temporal.ts` `logPotentialContradiction()` (`result='pending_w3'`), `userModel.ts` `sweepStaleEmotions()`/`sweepWithdrawnEvidence()` (explicitly W3-scheduled), `space_meta` (quiet hours, timezone, `last_dream_date` pattern), W2's confidence ceilings and evidence rules.
