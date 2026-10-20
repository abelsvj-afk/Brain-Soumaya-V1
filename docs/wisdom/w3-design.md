# W3 Design: Sleep / Consolidation — Revision 2

**Status:** Revision 2 — addresses the W3 architecture gauntlet review (3 P0, 6 P1, 3 P2 findings on Draft v1). Not approved. No implementation authorized.
**Branch:** `w3-design` · **Baseline:** deploy branch `claude/soumaya-second-brain-v1-m4z4hc` (see §1.1 — hard gate, satisfied)
**Author:** King (Muse) · **Date:** 2026-10-19

**What changed in Revision 2 (summary):**
- **P0-1:** "Stated is sacred" is now enforced by a single guarded write boundary (§6.1) plus a run-level integrity check, not by code-review convention. Two concrete W2 conflicts are named as hardening prerequisites (§1.2).
- **P0-2:** The contradiction backlog moves from free-form `agent_logs` rows to a typed `contradictions` table with explicit two-sided identity, a formal state machine, and separate node-graph vs user-model domains (§5).
- **P0-3:** The deployment baseline is stated exactly, with merged commit SHAs (§1.1).
- **P1-1:** Evidence independence is defined by a durable lineage key, not episode IDs (§4.3).
- **P1-2:** Contradiction adjudication is a complete deterministic decision table (§5.3).
- **P1-3:** Run claiming is atomic via `UNIQUE(space_id, local_date)` + fencing (§3.1, §9).
- **P1-4:** Idempotency is defined at the logical work-item level across run IDs (§9.2).
- **P1-5:** No `last_accessed_at` on `episodes`. Access telemetry lives in a separate append-only table (§7.2, §8.5).
- **P1-6:** A full sweep eligibility matrix replaces prose sweep descriptions (§3.2, §6.3).
- **P2-1/2/3:** Semantic routing with fail-closed abstention (§4.1); an exact `evidence_strength` formula (§4.4); a durable inquiry lifecycle (§5.5).

---

## 1. Problem

W1 gave Soumaya temporal truth (what is currently true). W2 gave her episodes (what happened) and a user model (what she believes about the user). But three gaps remain, all visible in production:

1. **The `potential_contradiction` backlog is write-only.** W1's `temporal.ts` logs ambiguous supersession cases to `agent_logs` with `result='pending_w3'` — and nothing reads them. They accumulate forever. (Verified: `logPotentialContradiction()` in `packages/server/src/agent/temporal.ts:314-331`.) Worse, as the gauntlet review established, those rows record only the old side (`{old_id, why}`) — they cannot support reliable adjudication at all. §5 replaces this mechanism with a typed record.

2. **W2's maintenance sweeps have no scheduler.** `sweepStaleEmotions()` (7-day emotion expiry) and `sweepWithdrawnEvidence()` (auto-invalidate entries whose evidence is fully withdrawn) exist in `userModel.ts` — and the latter's docstring explicitly says it is "W3-scheduled" because running it on the read path would break INV-KC-1. Nothing calls either function today. (Verified: `packages/server/src/agent/userModel.ts:2493-2534`, `2536-2606`.)

3. **Episodes never become understanding.** Every conversation turn is captured as an episode (W2 integration), but no process ever reads those episodes back to form durable beliefs. The user model only grows through the hot path (`maybeRecordStated`). A user who never states things explicitly — who just *lives* — accumulates thousands of episodes and zero consolidated understanding. This is the exact failure the wisdom-layer research identified: Smallville's reflection threshold, Mem0's consolidation, Zep's invalidation — all require a background process that integrates experience into belief.

**W3 is that process:** a quiet-hours consolidation job that turns raw experience into durable, evidence-linked understanding — without ever deleting, hallucinating, or overriding the user.

### 1.1 Deployment baseline (P0-3 — hard gate, satisfied)

W3 extends exactly this baseline, and no other:

- **Deploy branch:** `claude/soumaya-second-brain-v1-m4z4hc` (the repo's deployment branch — *not* `master`; the gauntlet's 337-commit comparison was against the wrong ref).
- **W1** merged: PR #65, squash commit `cf6201c5`.
- **W2 implementation** merged: PR #67, squash commit `6d29b30`.
- **W2 integration** merged: PR #68, squash commit `274ba62` (`memorySearch` → `vecSearchCurrent()`, `composeUserModelBlock()` in the loop prompt, six capture triggers, `maybeRecordStated()`).
- **Schema prerequisites present on the baseline:** W2's five tables + `episodes_fts` + `vec_episodes` (created in `bootstrapVec()`), W1's bitemporal columns on `nodes` and the `corrections` table.

**Hard gate:** W3 implementation may not begin until W2 is merged to the deploy branch. That gate is **satisfied** by the commits above. Deployment itself remains a manual Fly action by the user and is still pending — W3 design does not depend on deployment having occurred, only on the merged code/schema baseline, because W3 ships through the same manual deploy path.

### 1.2 W2 hardening prerequisites (from P0-1)

The gauntlet found two places where existing W2 code violates the invariant W3 depends on. These are **prerequisites** — small, separately-reviewed fixes to W2 code that must land before (or with) W3 implementation, because W3's sweeps phase calls these functions:

1. **`updateUserModel()` contradiction logic must exclude `stated` unconditionally.** Today it searches contradicted entries across `inferred`/`consolidated`/`stated` and filters out stated only when `confidence >= 0.95`. A stated entry at 0.90 can therefore be invalidated by a consolidated write. Required: stated rows are never candidates for contradiction-driven invalidation, at any confidence. (Stated-vs-stated conflicts surface as `conflictingStatedIds` for the correction path — existing behavior, unchanged.)
2. **`sweepStaleEmotions()` must skip `origin='stated'` rows.** Today it expires `emotion_state` rows without an origin filter. Required: stated emotion rows are never expired by the sweep; they receive a review flag instead (§6.3).

W3's own boundary (§6.1) is defense-in-depth on top of these fixes, not a substitute for them.

---

## 2. Relationship to the existing dream cycle

There is already a dream cycle (`packages/server/src/analysis/dreamCycle.ts`, invoked from the autonomy tick in `index.ts:247-320`). It must not be duplicated or replaced. The two processes have distinct, complementary jobs:

| | Existing dream cycle | W3 consolidation |
|---|---|---|
| **Input** | `nodes` graph (memories, high-degree clusters) | `episodes` + `contradictions` backlog + `user_model` maintenance |
| **Output** | `kind:"belief"` nodes with `summarizes` edges (galaxy-visible worldview) | `user_model` rows with `origin='consolidated'` (self-model: who the user is) |
| **Question answered** | "What patterns exist in the memory graph?" | "What do I now believe about the user, given what happened?" |
| **Cadence** | Once per UTC day | Once per space-local day, during quiet hours |

**Architectural rule:** the dream cycle reasons about the *world* (third-person knowledge, galaxy beliefs). W3 reasons about the *user* (first-person model). A consolidation output goes to exactly one destination — never both. §4.1 defines the routing rule.

W3 runs in the same autonomy tick (`AUTONOMY_MS`, default 5 min) as the dream cycle, in the same per-space loop, subject to the same paid-call ceiling (`AUTONOMY_MAX_PAID_PER_TICK`). It is a sibling, not a replacement.

---

## 3. The consolidation job

### 3.1 When it runs (revised — P1-3: atomic claim)

- **Window:** space-local quiet hours (`space_meta.quiet_start`–`quiet_end`, default 21:00–04:30). Verified: these columns exist in `space_meta` with the Phase 2 notification policy defaults.
- **Run date attribution:** a run is attributed to the **local date on which its quiet window opened** (`window_date`). If the current local time is after midnight but still inside the window that opened the previous evening, `window_date` is yesterday's date. This makes the 21:00–04:30 window a single claimable unit despite spanning midnight.
- **Atomic claim:** claiming a run is a single statement:

  ```sql
  INSERT INTO consolidation_runs (space_id, window_date, fence, started_at, lease_expires_at, status)
  VALUES (?, ?, ?, ?, ?, 'running')   -- lease_expires_at = started_at + 6h, computed by the caller
  ON CONFLICT (space_id, window_date) DO NOTHING
  RETURNING id;
  ```

  `consolidation_runs` carries `UNIQUE (space_id, window_date)` (§8.2). If the insert returns no row, another tick already owns this window — the tick moves on. There is no read-then-write race: two concurrent ticks cannot both own a run.
- **Fencing:** each claim generates a fresh random `fence` token stored on the run row. Every finalize/commit write for the run checks `WHERE id = ? AND fence = ? AND status = 'running'`. A worker whose lease expired and whose run was reclaimed cannot finalize — its writes match 0 rows and abort. (Same pattern as W2's enrichment fencing.)
- **Lease:** a run's lease is 6 hours from `started_at`. A `running` row past lease expiry is reclaimable: the next tick marks it `'failed'` (`error='lease_expired'`) — but note the `UNIQUE (space_id, window_date)` constraint means the dead run still occupies that window's slot. Reclaim therefore **reuses the same row**: an atomic `UPDATE ... SET fence = ?, started_at = ?, status = 'running' WHERE id = ? AND status = 'failed' AND error = 'lease_expired'` transfers ownership. One row per space per window, ever; ownership changes, identity doesn't.
- **`last_consolidation_date`:** written to `space_meta` only when a run reaches `completed` (or `aborted_budget` — a budget-aborted run did its bounded work for the day). It is a reporting convenience for `/settings`-style surfaces, **not** the scheduling mechanism. Scheduling authority is the claim insert above. This removes Draft v1's ambiguity about when the date is written.
- **Timezone / DST semantics:** all local dates and window checks are computed in the space's IANA timezone (from `space_meta`), using the same conversion path as the Phase 2 notification policy — never SQLite `date('now')`.
  - *Fall-back (repeated hour):* the window is longer; `window_date` is unchanged, the UNIQUE claim still admits exactly one run.
  - *Spring-forward (skipped hour):* the window is shorter; if quiet start falls in the skipped hour, the window opens at the first valid instant after the gap. Still exactly one claimable `window_date`.
  - *Timezone change mid-window:* the claim already made stands (keyed by the `window_date` computed at claim time). The next window is computed under the new timezone. No retroactive re-attribution.
- **Skip conditions (fail-safe):** if the space has zero unconsolidated episodes AND zero pending contradictions AND no sweeps due, the tick does not claim a run at all (no empty runs).

### 3.2 What it reads (in order)

1. **Sweep phase (no LLM, always runs):** the two W2 sweeps, executed under the eligibility matrix in §6.3 (which supersedes their Draft v1 prose descriptions):
   - `sweepStaleEmotions(h, spaceId)` — expires eligible `emotion_state` rows older than 7 days.
   - `sweepWithdrawnEvidence(h, spaceId)` — invalidates eligible entries whose evidence is entirely withdrawn; flags stated entries for review (never invalidates them).
   Both run through the guarded write boundary (§6.1) — after the §1.2 hardening, their own origin filters and the boundary agree.
2. **Contradiction phase (LLM-optional, budgeted):** `contradictions` rows in state `pending` (§5), oldest first.
3. **Distillation phase (LLM-optional, budgeted):** unconsolidated episodes — `episodes` rows with no terminal row in `consolidation_episodes` (§8.3), `forgotten_at IS NULL`, `occurred_at` older than 24h (never consolidate today's raw experience — let it settle), ordered by `importance DESC, occurred_at ASC`. See §4.

### 3.3 What it writes

- `user_model` rows with `origin='consolidated'` only, and only through the guarded write boundary (§6.1). Never `stated`, never `inferred` (INV-C-1).
- `nodes` rows (world-knowledge only, per §4.1 routing) — rare; most runs write zero nodes.
- `contradictions` state transitions (§5.2) and `agent_logs` audit rows for every action — content-free, IDs + reason codes only (W1/W2 audit convention).
- `consolidation_runs` + `consolidation_episodes` bookkeeping (§8).

### 3.4 What it never writes

- Never mutates a `user_model` row with `origin='stated'` — by any verb: invalidate, supersede, expire, strengthen, dedup-merge, or cleanup. The boundary (§6.1) rejects all of them. Stated rows may be *read* as evidence and as adjudication input, never written.
- Never modifies `episodes` capture fields or `episode_enrichments` (versioned). (Access telemetry is a separate table — §7.2 — not a column on `episodes`.)
- Never deletes anything, anywhere. (Follows the W1/W2 no-deletion rule; forgetting is the user's explicit action via `applyForgetRequest()`, not consolidation's.)
- Never overrides a `corrections` row with `correction_type='user_override'` — a user's explicit correction is terminal. If consolidation disagrees with a user override, it logs `consolidation_suppressed_by_override` and moves on.

---

## 4. Memory distillation: episodes → understanding

### 4.1 The routing rule (revised — P2-1: semantic criteria, fail-closed)

Draft v1's "if the sentence starts with 'the user…'" heuristic is withdrawn. Routing is by **proposition subject and evidence scope**, decided per proposition (distillation emits one proposition per candidate — never a compound claim):

- **Self-model** → `user_model`: the proposition's truth depends on *this user's* mental states, behavior, circumstances, relationships, or history. Test: would the proposition become false or meaningless if a different person were substituted? "Works at Samsonite" → yes (user-specific circumstance) → self-model. 
- **World-knowledge** → `nodes`: the proposition is about the world independent of the user. "Samsonite manufactures luggage" → true regardless of the user → world-knowledge.
- **Mixed or ambiguous propositions are not split by guessing.** If a candidate proposition references both the user and the world in a way that cannot be decomposed into two independently-provenanced propositions, distillation **abstains** (`consolidation_abstained`) rather than routing it to both destinations or forcing a choice. One proposition, one home, or no home.
- When classification confidence is low, self-model is *not* the default (Draft v1's tie-break is withdrawn — it biased toward the more sensitive store). Low confidence → abstain.

### 4.2 Distillation without duplication

Before writing any consolidated entry, the job checks for an existing covering proposition:

1. **Same slot + overlapping topic labels + temporally current** in `user_model` → do NOT create a duplicate. Instead, *strengthen*: append the new episode IDs to the existing entry's `evidence_ids` and recompute `evidence_strength` (§4.4). Strengthening applies only to `consolidated`/`inferred` entries — if the covering entry is `stated`, rule 2 applies and nothing is written, not even evidence (appending evidence to a stated row is a mutation, and §3.4 forbids it).
2. **Covered by a `stated` entry** → do NOT write anything. Stated outranks consolidated, always. Log `consolidation_redundant_with_stated`.
3. **Covered by a newer `consolidated` entry with ≥ evidence strength** → skip.

All three checks and the resulting write happen inside one `BEGIN IMMEDIATE` transaction through the boundary (§6.1), so a user correction landing concurrently is seen, not raced.

### 4.3 Evidence independence (revised — P1-1: lineage, not IDs)

"Two episodes" is not "two observations." Independence is defined by **source lineage**:

- Every episode carries a **lineage key** assigned at capture: the identifier of the originating interaction (conversation/session + turn, job run, digest, or correction event). W2's capture triggers already know this context; Revision 2 requires the key to be persisted on the episode row (`lineage_key`, §8.6) — episodes captured before W3 have it backfilled from their capture metadata where available, else each forms a singleton lineage (conservative: unknown lineage never merges two episodes into one source by accident, and never splits one source into two).
- **Grouping rule:** episodes sharing a `lineage_key` are **one observation**, regardless of count. Two capture triggers firing on the same turn, a capture plus its enrichment-derived copy, a digest episode quoting a conversation episode — all one source.
- **Derived artifacts inherit lineage.** A `nodes` row created from an episode (extraction, `summarizes` edge, enrichment link) carries that episode's lineage. A node therefore **cannot corroborate its own source episode**: the "1 episode + 1 corroborating node" path (§4.5) requires the node's lineage to differ from the episode's.
- **Duplicate captures** (same turn captured twice under any trigger combination) are detected by lineage key at consolidation time and counted once. Capture-time dedup remains best-effort; consolidation-time grouping is the guarantee.
- The ≥2 threshold in §4.5 is **≥2 distinct lineage groups**, full stop.

### 4.4 Evidence strength — exact formula (revised — P2-2)

`evidence_strength` is a deterministic function of the entry's evidence set. No LLM input, no hidden state.

**Definitions:**
- Evidence is grouped by lineage (§4.3). Let the groups be `G = {g₁ … gₙ}`.
- Each group has a **recency weight** `r(g) = 0.5 ^ (age_days(g) / 90)`, where `age_days(g)` is the age of the *newest* evidence item in the group, in days. (90-day evidence half-life. Newest-in-group: repeat mentions inside one conversation don't stack, but a fresh mention refreshes its group.)
- Each group contributes `c(g) = 0.34 × r(g)`.

**Formula:**

```
evidence_strength = 1 − ∏_{g ∈ G} (1 − c(g))
```

**Properties (by construction, all testable):**
- Range `[0, 1)`. One fresh group → 0.34. Two fresh groups → 0.564. Three → 0.712. Diminishing returns; no finite evidence set reaches 1.
- **Duplicates cannot inflate:** same-lineage items are one group, counted once, at the group's newest recency.
- **Old evidence loses weight predictably:** a group 90 days old contributes half its fresh value; 180 days, a quarter.
- **Strength ≠ authority.** `evidence_strength` measures corroboration. `confidence` is separately capped by origin (§4.5): for `consolidated`, `confidence = min(0.69, 0.30 + 0.39 × evidence_strength)`. No amount of evidence pushes a consolidated belief past 0.69; strengthening raises strength (and retrieval weight) without raising the authority ceiling. This preserves W2's rule that machine-synthesized belief never reaches stated-level authority.

### 4.5 Confidence ceilings and the consolidation threshold

W2's confidence semantics (Rev 5): confidence = belief-report confidence, capped by origin.

- `consolidated` entries: **capped at 0.69** (same ceiling as `inferred`), via the §4.4 mapping.
- Consolidation requires **≥2 independent lineage groups** (§4.3) OR **1 episode + 1 corroborating node of a different lineage**. Single-source "insights" are not consolidated; they're left for a future run with more evidence.
- Every consolidated row stores its `evidence_ids` (the episode/node IDs across all groups) and its computed `evidence_strength`. Recomputation on strengthening uses the same formula over the enlarged set — strengthening is therefore also idempotent: re-adding an already-present episode ID changes nothing (set semantics, §9.2).

### 4.6 What does NOT get distilled

- Episodes with `importance < 0.4` (below the significance bar — noise).
- `kind='job_run'`, `kind='digest_sent'` episodes (operational, not experiential) — unless they contain a user-visible outcome worth modeling.
- Episodes already covered by a current user-model entry (see §4.2).
- Anything the topic mapper can't classify with confidence — logged as `consolidation_abstained`, not forced.
- Mixed self/world propositions that can't be decomposed (§4.1).

---
## 5. Contradiction resolution (revised — P0-2: typed two-sided record; P1-2: decision table)

### 5.1 The backlog is now a table, not log parsing

Draft v1 read free-form `agent_logs` rows containing only `{old_id, why}` — which cannot support adjudication at all: two proposals against the same old node are indistinguishable, and text descriptions are not relational keys.

**Revision 2 replaces the mechanism.** W3 introduces a typed `contradictions` table (§8.4). A contradiction record is created with **both sides explicitly identified**:

```sql
CREATE TABLE IF NOT EXISTS contradictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL,
  -- which domain this contradiction lives in (see §5.6 — different domains, different permitted actions)
  domain TEXT NOT NULL CHECK (domain IN ('nodes','user_model')),
  -- OLD side (the incumbent)
  old_kind TEXT NOT NULL CHECK (old_kind IN ('node','user_model_entry')),
  old_id INTEGER NOT NULL,
  -- NEW side (the challenger) — REQUIRED, never optional, never parsed from text
  new_kind TEXT NOT NULL CHECK (new_kind IN ('node','user_model_entry','episode')),
  new_id INTEGER NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('factual_update','false_belief','preference_change','state_transition','duplicate_claim')),
  -- provenance of the report: who proposed this contradiction
  reported_by TEXT NOT NULL CHECK (reported_by IN ('temporal_propose','knowledge_check','consolidation','sweep','user')),
  report_ref TEXT,          -- durable reference to the originating operation (supersession proposal id,
                            -- knowledgeCheck verdict id, sweep run id, or correction id) — never free text
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','claimed','resolved','unresolved','moot','stated_conflict')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_by_run INTEGER,   -- consolidation_runs.id while claimed
  claim_fence TEXT,         -- fencing token for the claim (same pattern as W2 enrichment)
  lease_expires_at TEXT,    -- reclaimable after this time (see §5.2)
  resolution TEXT,          -- JSON: {outcome, rule_applied, winner_id, loser_id} — written on terminal states only
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair
  ON contradictions(space_id, domain, old_kind, old_id, new_kind, new_id)
  WHERE state IN ('pending','claimed');
```

**W1 call-site amendment (required):** W1's `logPotentialContradiction()` is changed to populate this table at report time — it already knows the old node and the proposed replacement (it was *proposing* a supersession that got deferred). The amendment is: record `old_kind='node', old_id=<the node>, new_kind=<node|episode>, new_id=<the proposed replacement>`. No text parsing, ever. Where the proposal source is an LLM judgment (not a concrete replacement record), the reporting site must either point at the concrete proposed record or not file — "the model thought these two things conflict" without identified records is an inquiry candidate (§5.5), not a contradiction record.

**Migration of legacy rows:** existing `agent_logs` rows with `result='pending_w3'` lack a reliable new-side reference. They are **not** migrated into the new table. On W3's first scheduled run, any legacy row is marked `result='legacy_moot'`: never adjudicated, never deleted. Rationale: adjudicating an unpairable record is exactly the failure P0-2 names; the safe default is to retire the backlog, not to guess. This is recorded in the run's audit as `contradictions_legacy_retired=<count>`.

### 5.2 Claim protocol and state machine

```
pending → claimed → {resolved | unresolved | moot | stated_conflict}   (terminal)
claimed → pending      (lease expiry: attempts += 1, fence rotated)
pending → unresolved   (attempts ≥ 3 — poison-row guard; becomes an inquiry candidate)
```

- **Claim:** `UPDATE contradictions SET state='claimed', claimed_by_run=?, claim_fence=?, lease_expires_at=?, attempts=attempts+1 WHERE id=? AND state='pending'` — single statement, atomic. A row is only claimable from `pending`; reclaimed rows go through `pending` first (never `claimed`→`claimed`).
- **Lease:** 10 minutes per claim (contradiction adjudication is one work item, not a day-long run — shorter lease than the run lease in §3.1). On expiry, any tick may reclaim: `UPDATE ... SET state='pending' WHERE id=? AND state='claimed' AND lease_expires_at < now AND claim_fence=<old fence>` — the fence check prevents reclaiming a claim that was just legitimately extended.
- **Fencing at finalize:** the terminal transition checks the fence: `UPDATE contradictions SET state=?, resolution=? WHERE id=? AND claim_fence=? AND state='claimed'`. An expired worker's finalize matches 0 rows — it cannot resolve work another worker reclaimed.
- **Pre-adjudication validation** (required before any decision-table evaluation): both sides must exist, be in the same `space_id` as the record, and still be in their expected current state (node not already superseded by an unrelated operation since the report; user_model entry not already invalidated). If validation fails → `moot` with `reason='stale_targets'`. This is what makes "retry after state change" safe: the retry validates fresh, and a changed world yields `moot`, never a wrong resolution.

### 5.3 The decision table (revised — P1-2: complete, deterministic)

All inputs are computed from the two sides' records — no LLM is consulted for the decision itself (the LLM may be used to *propose* a contradiction record in the first place; the *decision* is rules).

| # | Domain | Old side | New side | Decision | Outcome | Permitted mutations |
|---|---|---|---|---|---|---|
| 1 | nodes | any | any, same proposition | **compatible** | Both stand. | None. (e.g. "works in a warehouse" vs "works at Samsonite" — compatible, not contradictory. Compatibility is a first-class outcome, not a failed contradiction.) |
| 2 | nodes | system-derived | system-derived, newer, contradicting | **superseded_by_newer** | Newer wins. | W1 `supersede()` on old node, `supersede_reason='update'`, `correctedBy='system'`. |
| 3 | nodes | system-derived, evidence strictly stronger | system-derived, newer, contradicting | **older_retained** | Older wins on strength. | None — old node stays current; record notes `rule='strength_beats_recency'`. (Resolves the Draft v1 ambiguity: "newer wins UNLESS older has strictly greater evidence strength" — the table makes it exact: strictly greater strength defeats recency; equal or lesser does not.) |
| 4 | nodes | system-derived | system-derived, contradicting, equal strength, no user statement | **unresolved** | Both stand. | None. Inquiry candidate (§5.5). |
| 5 | nodes | any | any, one side user-stated (or `user_override` correction exists) | **stated_conflict** | Stated side wins by authority. | If the *old* node is the stated one: no mutation; record the conflict as evidence the user may want to resolve. If the *new* side is a user statement/correction contradicting an old system node: the correction path (not W3) performs the supersession via the authorized user path; W3 records the outcome as observed. **W3 never calls `supersede()` against a user-stated proposition.** |
| 6 | user_model | consolidated/inferred | consolidated/inferred, contradicting | **adjudicated** | Apply W2's existing contradiction rules via the guarded boundary (§6.1): the losing entry is invalidated (never deleted), the winning entry keeps/extends evidence. | Boundary-gated `invalid_at` set on loser only. |
| 7 | user_model | stated (any confidence) | any | **stated_conflict** | Stated wins, unconditionally. | **None.** The boundary (§6.1) rejects every mutation to the stated row. The challenger, if consolidated, is invalidated as incorrect (it disagreed with the user). If the challenger is another stated row, both stand — stated-vs-stated conflicts surface through `conflictingStatedIds` on the correction path, never through W3. |
| 8 | user_model | consolidated/inferred | episode evidence (new lineage) | **evidence_update** | Newer evidence may strengthen or revise the consolidated entry. | Boundary-gated: strengthen or invalidate-then-replace (replacement is a new row; the old row is invalidated, not edited). |
| 9 | any | — | stale/missing/cross-space targets | **moot** | No action. | None. |

**Tie-breaking within a cell** is by `evidence_strength` (§4.4, deterministic), then by `recorded_at` (older first — deterministic), then by `id` (deterministic). No cell contains "decide by judgment."

**Resolution audit:** terminal transitions write `resolution = {outcome, rule_applied: '#<cell>', winner: {kind,id}, loser: {kind,id}, actor: 'w3'}` plus an `agent_logs` row — content-free, IDs + reason codes only.

### 5.4 Node supersession vs user-model adjudication (separate domains — P0-2)

The `domain` column is not decorative. It selects the permitted mutation API:

- `domain='nodes'`: the only permitted state-changing action is W1's `supersede()` — which operates on nodes, closes validity intervals, and preserves history. W3 may call it only for cells 2 (and never against stated propositions — cell 5).
- `domain='user_model'`: the only permitted mutation path is the guarded write boundary (§6.1) — `invalid_at` sets, new-row inserts, evidence appends. W1's `supersede()` is never called on user-model rows; it doesn't understand `origin`, `invalid_at`, or evidence semantics.
- Cross-domain "contradictions" (a node claims X, the user model claims ¬X) are **not adjudicated by W3** — they are different stores with different authority models. W3 logs them as `unresolved` with `category='cross_domain'` and they become inquiry candidates. (This is deliberate scope control: unifying node and user-model truth is W6 territory, not a quiet-hours job.)

### 5.5 Inquiry lifecycle (revised — P2-3: durable, deduped)

Unresolved contradictions need a lifecycle so they don't spawn a fresh inquiry every night:

- **Identity:** an inquiry is identified by `(space_id, contradictions.id)` — one inquiry per contradiction record, ever. `UNIQUE(space_id, contradiction_id)` on the `inquiries` extension (W2's `inquiries` table gains a nullable `contradiction_id` column — see §8.6; existing inquiry rows are unaffected).
- **Dedup:** when a contradiction reaches `unresolved`, W3 upserts the inquiry row; if one already exists for that contradiction, it is left alone (no duplicate, no re-queue).
- **Status transitions:** `queued → surfaced → {answered | dismissed} → resolved`. Surfacing (digest/proactive/UI) is W6's job; W3 only queues. A `dismissed` inquiry stays dismissed — future runs do not re-queue it.
- **Response linkage:** when the user answers an inquiry, the response enters the **existing stated/correction path** (`recordStated()` / `correctUserModel()`), never a W3 write path. The answer, if it resolves the contradiction, invalidates the losing consolidated entry via the authorized correction path — and the contradiction record transitions `unresolved → resolved` with `resolution.actor='user'`, observed (not performed) by the next W3 run.
- **Supersession:** if either side of an `unresolved` contradiction is later superseded/invalidated by an unrelated authorized operation, the next run marks the contradiction `moot` and its inquiry `dismissed` with `reason='moot'`.

---

## 6. Safety invariants and the guarded write boundary

### 6.1 The guarded write boundary (revised — P0-1: enforced, not conventional)

Draft v1 protected stated rows by "code review + a test." The gauntlet correctly identified this as unenforceable — and found two live W2 paths that already violate it. Revision 2 replaces convention with structure.

**The boundary:** exactly one function in the W3 module is permitted to issue `INSERT`/`UPDATE` statements against `user_model`:

```ts
applyConsolidationMutation(sqlite, runCtx, mutation: ConsolidationMutation): MutationResult
```

where `ConsolidationMutation` is a closed union: `InsertConsolidated | InvalidateEntry | AppendEvidence | SetReviewFlag`. Every W3 write path — distillation inserts, dedup strengthening, contradiction adjudication (cells 6/8), sweeps — constructs a `Mutation` and calls this function. Nothing else in the W3 module touches `user_model` writes; the module's code-review gate is "no `INSERT INTO user_model` / `UPDATE user_model` string appears outside this function."

**What the boundary does, in order, inside one transaction:**
1. Loads the target row(s) by id with `FOR`-style re-read inside the transaction (all W3 writes use `BEGIN IMMEDIATE` — a user correction landing concurrently is seen, not raced).
2. **The stated check:** if any target row has `origin = 'stated'` → the mutation is **rejected** with `error='stated_protected'`, the transaction rolls back, the work item is marked `failed` with that reason, and an `agent_logs` row records the attempted violation (`w3_stated_write_blocked`, IDs + mutation kind — this is a canary: in a correct implementation it should never fire).
3. If the mutation is an insert: verifies `origin='consolidated'` on the new row and non-empty `evidence_ids` (INV-C-1, INV-C-4) — write-time rejection, same pattern as W2's `validateProvenance()`.
4. Applies the mutation, commits.

**There is no confidence-threshold exception.** Draft v1's inherited W2 behavior (stated filtered only at `confidence >= 0.95`) is explicitly withdrawn for W3-initiated writes: a stated row at 0.90, 0.50, or 0.10 is equally untouchable. The only operations that may alter a stated row are `recordStated()` (hot path), `correctUserModel()` (explicit correction path), and the user's own forget flow — none of which W3 calls.

**The run-level integrity check (backstop):** at run start, W3 snapshots `SELECT id, updated_at, invalid_at FROM user_model WHERE space_id=? AND origin='stated'` (a hash of the projection). At run finalize, before marking `completed`, it recomputes the projection and compares. Any difference → the run is marked `failed` with `error='stated_integrity_violation'`, and an alert-grade `agent_logs` row fires. This is the proof the reviewer asked for: even if a future code path bypasses the boundary function, the violation is detected and the run is not recorded as successful. T-C50 tests this by simulating a bypass.

**Relationship to the §1.2 prerequisites:** the hardening fixes make W2's own functions consistent with the invariant; the boundary makes W3's use of them (and any future W3 path) structurally unable to violate it. Belt and suspenders, on purpose — this is the system's core safety promise.

### 6.2 Revised invariants

- **INV-C-1 (origin ceiling):** Consolidation writes `origin='consolidated'` only. Enforced by the boundary (step 3), not by convention.
- **INV-C-2 (stated is sacred):** No W3-initiated operation mutates a `stated`-origin `user_model` row — by any verb (invalidate, supersede, expire, strengthen, dedup-merge, cleanup, decay). Stated rows are read-only inputs to W3. The *only* writers of stated rows are the authorized user-statement/correction paths. Enforced by the boundary (step 2) + the run-level integrity check (§6.1) + the §1.2 W2 hardening.
- **INV-C-3 (user override is terminal):** Unchanged from Draft v1.
- **INV-C-4 (evidence or it didn't happen):** Unchanged; enforced at the boundary.
- **INV-C-5 (no deletion, no resurrection):** Unchanged.
- **INV-C-6 (bounded autonomy):** Unchanged.

### 6.3 Sweep eligibility matrix (revised — P1-6: complete matrix)

Draft v1 described sweeps in prose. The matrix is the contract — every cell is tested (T-C45).

**`sweepStaleEmotions()` — eligibility by row:**

| origin | slot | Age | invalid_at | Action |
|---|---|---|---|---|
| inferred, consolidated | emotion_state | > 7 days | NULL | **Expire:** set `invalid_at = now` (via boundary) |
| inferred, consolidated | emotion_state | ≤ 7 days | NULL | None |
| inferred, consolidated | emotion_state | any | not NULL | None (already expired) |
| stated | emotion_state | > 7 days | NULL | **Flag only:** set review flag (§6.4), no `invalid_at`. The user's stated emotion is never expired by maintenance. |
| stated | emotion_state | ≤ 7 days | NULL | None |
| any | non-emotion slot | any | any | None — this sweep does not touch non-emotion rows, at any origin |

**`sweepWithdrawnEvidence()` — eligibility by row:**

| origin | Evidence status | Action |
|---|---|---|
| inferred, consolidated | All evidence withdrawn (tombstoned/deleted/superseded sources) | **Invalidate:** set `invalid_at = now` (via boundary) |
| inferred, consolidated | Partially withdrawn | Recompute `evidence_strength` over surviving evidence (via boundary); if zero survivors → invalidate |
| stated | All evidence withdrawn | **Flag only:** review flag with `reason='evidence_withdrawn'`; the row stands until the user corrects it |
| stated | Partially withdrawn | None — stated rows are not recomputed by maintenance |
| any | Evidence intact | None |

**Repeated sweeps** are idempotent: expired rows are skipped (`invalid_at IS NOT NULL`), flags are set-once (setting an already-set flag is a no-op), invalidations check current state inside the transaction.

**Concurrent correction during a sweep:** sweeps read-modify-write inside `BEGIN IMMEDIATE` transactions through the boundary. A user correction landing first changes the row's state; the sweep's in-transaction re-read sees it and the eligibility matrix is re-evaluated — a row invalidated by correction is no longer eligible for sweep invalidation (already `invalid_at`), and a corrected-away evidence set changes the withdrawal computation. No lost updates, no double invalidation.

### 6.4 Review flags (persistence and clearing)

- Flags live on the row: `review_flag TEXT` (nullable; values: `'evidence_withdrawn'`, `'stale_emotion'`, `'contradiction_pending'`) and `review_flagged_at TEXT` (nullable). Added to `user_model` by the W3 migration (§8.6); existing rows get NULL.
- **Set by:** sweeps and contradiction adjudication only (via the boundary — setting a flag on a stated row is explicitly permitted; it is not a content mutation).
- **Cleared by:** the user correction path (`correctUserModel()` clears the flag when the user addresses the underlying issue) or an explicit user dismissal. **Sweeps never clear flags.** A flag set in run N is still set in run N+1 unless the user acted — this is what prevents flag churn and gives the review queue stable semantics.
- Read paths (`getUserModel()`) may surface flagged rows with their flag; flagging never changes retrieval eligibility by itself (a flagged-but-valid row still reads normally — the flag is a nudge, not a demotion).

---
## 7. Forgetting and decay (revised — P1-5: immutability preserved)

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

### 7.2 Access telemetry without violating immutability (revised — P1-5)

Draft v1 added `last_accessed_at` to `episodes` and updated it on reads — which contradicts W2's invariant that captured episode fields are immutable except via the forget/redaction path. **Revision 2 removes that column entirely.** Access tracking lives in a separate table:

```sql
CREATE TABLE IF NOT EXISTS access_stats (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('episode','user_model_entry','node')),
  entity_id INTEGER NOT NULL,
  last_accessed_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (entity_type, entity_id)
);
```

- **Append-only semantics in practice:** rows are upserted (`INSERT ... ON CONFLICT DO UPDATE SET last_accessed_at=excluded.last_accessed_at, access_count=access_count+1`), but the *episodes* and *user_model* tables are never written by reads. Capture-field immutability (W2 INV-EP-1) holds: a byte-compare of an episode row before and after any number of reads shows zero change (T-C44).
- **Which reads count as access:** retrieval-serving reads — `episodeSearch()`, `getUserModel()`, `memorySearch()` node hits. Internal maintenance reads (sweeps, consolidation scans, integrity checks) do **not** count — otherwise the consolidation job itself would keep everything "fresh" by scanning it. The rule: a read counts as access iff its result was surfaced to the user or the model for a user-facing turn.
- **Batching:** updates are coalesced — at most one `access_stats` write per entity per hour (in-memory dirty set flushed at tick end). No write amplification on hot entities.
- **Decay scoring reads `access_stats`;** entities with no row default to their creation time (`recorded_at` / `valid_at` / `created_at`). Stated entries never decay regardless of access (INV-C-2 extends to decay: §7.1's ∞ row) — they need no access row at all, though they may have one; it's ignored for scoring.

### 7.3 Interaction with W1 supersession and W2

- **W1 supersession is binary; decay is graded.** They compose: `superseded_at IS NOT NULL` → excluded entirely (W1's filter runs first). Surviving rows are then decay-weighted. A superseded row never "decays back" into relevance.
- **W2's `sweepStaleEmotions`** is the hard-expiry backstop for `emotion_state` (7 days, then `invalid_at` set) under the §6.3 matrix. Decay handles the graded fade before that cliff.
- **Derived-belief withdrawal (forgetting propagation):** when `applyForgetRequest()` tombstones an episode, W3's next run withdraws it from every consolidated entry's `evidence_ids` (recompute strength via §4.4) — and if a consolidated entry's evidence set becomes empty, the entry is **invalidated** (via the boundary, §6.1 — it's consolidated-origin, so this is permitted) with `reason='evidence_forgotten'`. The verifiable completion condition: after the run, no `user_model` row with `origin='consolidated'` references the forgotten episode's ID in `evidence_ids`, and no `vec_episodes` row exists for it (W2's forget flow already deletes embeddings). T-C51 asserts this end-to-end. (This answers pressure point 8: a forgotten episode cannot reappear through a consolidated belief or cached evidence.)

---

## 8. Schema changes (revised)

All additive, following the repo's migration conventions (PRAGMA-guarded DDL in `migrateSchema()`, table creation in `BOOTSTRAP_SQL`). Fresh-bootstrap and migration paths must produce identical schemas — tested per the W2 migration-equivalence pattern (`assertSchemaEquivalent`-style: columns, indexes, CHECKs, UNIQUE behavior).

### 8.1 `space_meta` additions (unchanged from Draft v1, semantics clarified)

```sql
ALTER TABLE space_meta ADD COLUMN last_consolidation_date TEXT;  -- YYYY-MM-DD, space-local; written on completed/aborted_budget runs ONLY (§3.1)
ALTER TABLE space_meta ADD COLUMN w3_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE space_meta ADD COLUMN w3_llm_budget INTEGER NOT NULL DEFAULT 5;   -- max LLM calls per run
ALTER TABLE space_meta ADD COLUMN w3_max_items INTEGER NOT NULL DEFAULT 50;  -- max work items per run
```

### 8.2 `consolidation_runs` (revised — P1-3: atomic claim + fencing)

```sql
CREATE TABLE IF NOT EXISTS consolidation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL,
  window_date TEXT NOT NULL,          -- YYYY-MM-DD, space-local date the quiet window opened (§3.1)
  fence TEXT NOT NULL,                -- random token per claim; finalize checks it (§3.1)
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','aborted_budget')),
  lease_expires_at TEXT NOT NULL,     -- started_at + 6h; reclaimable after (§3.1)
  items_processed INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  contradictions_resolved INTEGER NOT NULL DEFAULT 0,
  consolidations_written INTEGER NOT NULL DEFAULT 0,
  stated_integrity_hash TEXT,         -- snapshot at run start (§6.1); compared at finalize
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (space_id, window_date)      -- the atomic claim: one row per space per window, ever
);
CREATE INDEX IF NOT EXISTS idx_consolidation_runs_space
  ON consolidation_runs(space_id, started_at DESC);
```

### 8.3 `consolidation_episodes` (revised — P1-4: work-item idempotency across runs)

Draft v1's `PRIMARY KEY (run_id, episode_id)` permitted the same episode to be processed by two different runs with independent outcomes — and permitted duplicate evidence appends across a crash boundary. Revision 2 keys idempotency at the **logical work item**:

```sql
CREATE TABLE IF NOT EXISTS consolidation_episodes (
  space_id TEXT NOT NULL,
  episode_id INTEGER NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('consolidated','strengthened','skipped_covered','skipped_low_importance','abstained','failed')),
  resulting_entry_id INTEGER,   -- user_model.id or nodes.id, when written/strengthened
  evidence_group_key TEXT,       -- lineage_key of the evidence group this decision was based on (§4.3)
  last_run_id INTEGER NOT NULL,  -- most recent run that touched this item (for audit, not identity)
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (space_id, episode_id)
);
```

- An episode's consolidation outcome is decided **once** per distinct evidence state. A retry of the same episode with the same `evidence_group_key` and no new evidence is a no-op — the row already exists with a terminal outcome. New evidence (a new episode in the same lineage group, or a new lineage group) legitimately re-opens the item: the run compares the current evidence set against the recorded `evidence_group_key` set and only re-processes on difference.
- **Belief mutation and ledger write are atomic:** the `UPDATE/INSERT` on the target `user_model` row and the upsert of the `consolidation_episodes` row happen in the **same transaction**. Crash between them is impossible by construction — there is no "mutation committed, ledger lost" state (T-C42).
- **Evidence appends are set-semantic:** strengthening appends episode IDs via set union, not list append. Re-processing an already-recorded episode ID changes nothing — `evidence_ids` is a set, and `evidence_strength` recomputed over the same set is identical (T-C42, T-C47).

### 8.4 `contradictions` (new — P0-2)

The typed two-sided record from §5.1, with the `UNIQUE(space_id, domain, old_kind, old_id, new_kind, new_id) WHERE state IN ('pending','claimed')` index. Lives in `BOOTSTRAP_SQL` + migration path identically.

### 8.5 `access_stats` (new — P1-5)

The append-only-in-practice telemetry table from §7.2. No columns are added to `episodes` or `user_model` for access tracking.

### 8.6 Other additions

- `episodes.lineage_key TEXT` — the durable source-lineage key (§4.3). Nullable in migration; backfilled from capture metadata where available, else each episode forms a singleton lineage. New captures always set it (capture-trigger contract amendment — small, included in W3 implementation scope).
- `user_model.review_flag TEXT` + `user_model.review_flagged_at TEXT` — nullable review flags (§6.4). Existing rows get NULL.
- `inquiries.contradiction_id INTEGER` nullable + `UNIQUE(space_id, contradiction_id)` — inquiry dedup (§5.5).

### 8.7 Withdrawn from Draft v1

- `last_accessed_at` on `episodes` and `user_model` — **removed** (P1-5). Replaced by `access_stats`.

---

## 9. Job lifecycle and idempotency (revised — P1-3, P1-4)

### 9.1 Run structure

```
claim_run(spaceId, windowDate):           -- atomic INSERT ... ON CONFLICT DO NOTHING (§3.1)
  → returns run row or NULL (already claimed)

run_consolidation(spaceId, run):
  1. Snapshot stated-integrity hash → store on run row (§6.1)
  2. Phase A (sweeps): sweepStaleEmotions + sweepWithdrawnEvidence — no LLM, no budget, via boundary
  3. Phase B (contradictions): claim + adjudicate per §5.2/§5.3 until budget exhausted
  4. Phase C (distillation): process unconsolidated episodes per §4 until budget exhausted
  5. Finalize: recompute stated-integrity hash; compare (§6.1)
     → match: mark 'completed' (fence-checked UPDATE), write last_consolidation_date
     → mismatch: mark 'failed', error='stated_integrity_violation'
```

### 9.2 Crash recovery (revised — P1-4: work-item idempotency across run IDs)

- **Run-level:** a `running` row past `lease_expires_at` is reclaimable by ownership transfer on the *same row* (§3.1) — never a second row for the same window.
- **Contradiction work-items:** claims are fenced and lease-bound (§5.2). An expired worker's finalize matches 0 rows. A reclaimed row returns to `pending` with `attempts+1`; after 3 attempts → `unresolved` (poison-row guard).
- **Distillation work-items:** keyed by `(space_id, episode_id)` (§8.3), not by run. A crash after claim-but-before-mutation leaves no ledger row — the retry sees no terminal outcome and processes normally (T-C43). A crash *during* the mutation transaction rolls back atomically — there is no partial mutation (T-C42). Because mutation and ledger commit in one transaction, "processed twice" collapses to "second attempt finds the terminal outcome already recorded and skips."
- **Sweeps:** idempotent by matrix design (§6.3) — expired rows are skipped, flags are set-once, invalidations are state-checked in-transaction.

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
| Runs per day per space | 1 | Atomic `UNIQUE(space_id, window_date)` claim (§3.1) |
| Paid LLM per tick (global) | `AUTONOMY_MAX_PAID_PER_TICK` (existing) | Shared with dream cycle |

Worst case per space per day: 5 LLM calls + 50 items. At current model pricing, negligible. The global per-tick paid ceiling provides backstop against multi-space bursts.

---

## 11. Failure modes (revised)

| Failure | Behavior |
|---|---|
| LLM call throws | Caught per-item; `consolidation_episodes` records `failed` (terminal for this evidence state); run continues. Never aborts the run. |
| Budget exhausted mid-run | `status='aborted_budget'`; remaining items wait for tomorrow. Not an error. |
| Process crash mid-run | Lease expiry (6h) → ownership transfer on the same run row (§3.1). Work-item idempotency (§9.2) prevents duplicate effects. |
| DB locked / contention | All writes in short `BEGIN IMMEDIATE` transactions; run yields between phases. Transaction failure → retry once → item `failed`. |
| Contradiction adjudication throws | Claim lease expires → row returns to `pending` with `attempts+1`; after 3 attempts → `unresolved` + inquiry. A poison row can't block the backlog. |
| Distillation produces no evidence | Write-time rejection at the boundary (INV-C-4); item marked `abstained`. |
| Space deleted mid-run | Run checks space existence per phase; aborts quietly if gone. |
| Stated-integrity mismatch at finalize | Run marked `failed`, `error='stated_integrity_violation'`, alert-grade audit row. The day's work is rolled back per-item (each item's transaction already committed — the failure is recorded, not silently accepted; see §6.1). |
| Legacy contradiction backlog | Marked `legacy_moot` on first run, never adjudicated (§5.1). |

---
## 12. Test plan (expanded — covers every gauntlet finding)

Draft v1's T-C1–T-C22 are retained where still valid; revised or superseded tests are marked. New tests are grouped by the finding they close. Every test that touches the database uses real SQLite through `createDb()` — no mocked outcomes for transactional behavior (the user's standing guardrail from the W2 reviews).

**Sweep tests (§6.3 matrix):**
- T-C1: `sweepStaleEmotions` expires an 8-day-old inferred `emotion_state` row, leaves a 6-day-old row.
- T-C2: `sweepWithdrawnEvidence` invalidates an `inferred` entry with all evidence withdrawn; **flags** (doesn't invalidate) a `stated` entry.
- T-C3: sweeps are idempotent — running twice changes nothing the second time.
- T-C45: **sweep eligibility matrix** — every origin × slot × age × evidence-status cell from §6.3, asserting the exact specified action (expire / invalidate / flag / none).
- T-C46: **review-flag lifecycle** — sweep sets a flag; a second sweep does not clear or duplicate it; `correctUserModel()` clears it; sweeps never clear flags.
- T-C52: concurrent user correction during a sweep — correction wins, sweep's in-transaction re-read adapts, no lost update or double invalidation.

**Stated-protection tests (P0-1):**
- T-C23: consolidated write conflicting with a `stated` entry at confidence **0.90** → the stated row is byte-identical afterward (hash comparison, not just field comparison).
- T-C24: **every W3 write path vs stated rows** — insert, strengthen, dedup-merge, contradiction adjudication (cell 7), sweep expire, sweep evidence-invalidate — each attempted against a stated row → all rejected with `stated_protected`, zero mutations.
- T-C25: the authorized correction path still mutates stated rows (the boundary doesn't break legitimate writes).
- T-C26: concurrent correction + W3 run → the stated row reflects the correction only; run completes or fails loudly, never silently overwrites.
- T-C50: **stated-integrity backstop** — simulate a bypass of the boundary function (direct SQL update of a stated row mid-run); finalize detects the hash mismatch and marks the run `failed` with `stated_integrity_violation`.

**Contradiction tests (P0-2, P1-2):**
- T-C4: user-statement-wins — deterministic, no LLM (now decision-table cell 5).
- T-C27: **two proposals against the same old node** → each record adjudicates its own identified pair; no cross-pair contamination.
- T-C28: **stale targets** — missing, already-superseded, or cross-space sides → `moot`, no mutation.
- T-C29: **retry after state change** — a side superseded by an unrelated operation between claim and adjudication → validation fails → `moot`, never resolves the wrong pair.
- T-C34–T-C38: **one test per decision-table cell** — compatible (both stand); superseded_by_newer; older_retained on strictly greater strength; equal-strength tie → unresolved; stated_conflict (both directions).
- T-C53: **cross-domain contradiction** (node vs user_model) → `unresolved`, `category='cross_domain'`; W1 `supersede()` is never invoked on a user-model row and the boundary is never invoked on a node.
- T-C54: poison-row guard — a contradiction whose adjudication throws 3 times → `unresolved` + inquiry, backlog unblocked.

**Distillation & independence tests (P1-1, P2-2):**
- T-C9: two independent lineage groups about the same topic → one `consolidated` entry with both groups' episode IDs in `evidence_ids`.
- T-C10: dedup — a third episode on the same topic *strengthens* (set-union evidence, recomputed strength) instead of duplicating.
- T-C30: **two episodes, one lineage** (two triggers, same turn) → counted as **one** observation; consolidation threshold not met.
- T-C31: **two episodes, two lineages** → threshold met.
- T-C32: **node derived from an episode** cannot corroborate that episode (lineage match → excluded from the corroborating-node path).
- T-C33: **duplicate captures** (capture + enrichment-derived copy) → one observation.
- T-C13: single-source insight is not consolidated.
- T-C14: no-evidence write rejected at the boundary (INV-C-4).
- T-C15: `user_override` suppression — proposition with a user_override correction is not consolidated; `consolidation_suppressed_by_override` logged.
- T-C47: **evidence_strength formula** — duplicates don't inflate (same result before/after adding a same-lineage duplicate); 90-day-old evidence contributes half of fresh; computed confidence never exceeds 0.69 for any evidence set (property test over random inputs).
- T-C11: stated-wins — consolidation does not write when a current `stated` entry covers the proposition.
- T-C12: confidence ceiling — consolidated entries never exceed 0.69 (now subsumed by T-C47's property test; retained as a direct assertion).
- T-C49: **mixed self/world proposition** → abstained (not split, not forced to one destination).

**Decay & forgetting tests (P1-5):**
- T-C16: decay weighting — a 30-day-old episode scores lower than a 1-day-old episode, all else equal.
- T-C17: stated entries don't decay.
- T-C18: superseded rows excluded before decay (W1 composes correctly).
- T-C44: **immutability under reads** — byte-compare of episode rows before and after serving reads (including decay-scored retrieval); zero change. No `last_accessed_at` column exists on `episodes`.
- T-C51: **forget propagation** — forget an episode; next W3 run withdraws it from consolidated `evidence_ids`, invalidates entries left with empty evidence; assert no consolidated row references the forgotten ID and no `vec_episodes` row exists.

**Job lifecycle tests (P1-3, P1-4):**
- T-C19: run executes all three phases and marks `completed`.
- T-C20: budget exhaustion → `aborted_budget`, resumes next run.
- T-C21: quiet-hours gate — run doesn't fire outside quiet hours; doesn't fire twice in one local day.
- T-C22: 6-hour lease expiry on crashed runs (now via ownership transfer on the same row).
- T-C39: **concurrent run claims** — two ticks race the claim insert → exactly one `consolidation_runs` row for the window.
- T-C40: **lease expiry + stale finalize** — old worker attempts finalize after reclaim → 0 rows matched, no state change; new owner completes.
- T-C41: **DST transitions** — fall-back: one run for the window_date despite the repeated hour; spring-forward: window still claims exactly once. Timezone change mid-window: existing claim stands.
- T-C42: **crash after mutation** — impossible by construction (mutation + ledger in one transaction); test asserts the transaction boundary by killing the connection mid-transaction and verifying either both or neither persisted.
- T-C43: **crash after claim before mutation** — no ledger row exists; retry processes the item normally; exactly one outcome recorded.

**Inquiry tests (P2-3):**
- T-C48: repeated `unresolved` runs → exactly one inquiry row per contradiction; user response via the stated path resolves it; contradiction transitions to `resolved` with `actor='user'`.

**Schema/migration tests:**
- T-C55: fresh-bootstrap vs migrated DB produce identical W3 schemas (columns, indexes, CHECKs, UNIQUEs) — the W2 `assertSchemaEquivalent` pattern applied to all §8 tables.
- T-C56: `lineage_key` backfill — pre-W3 episodes get singleton lineages; new captures always set the key (capture-trigger contract test).

---

## 13. Non-goals

- **No new model, DB, or service.** Uses the existing LLM provider interface (`ctx.llm`), existing tables plus the §8 additions.
- **No real-time consolidation.** The hot path stays fast; understanding compounds overnight. (This is the point of sleep.)
- **No user-facing output.** W3 never messages the user. Inquiries it queues go through the normal Phase 2 policy path.
- **No deletion or hard forgetting.** Decay is graded weight, not removal. Forgetting is the user's explicit action.
- **No `stated` writes, no `inferred` writes.** Only `consolidated`. (W3 doesn't do hot-path inference — that's W2's `maybeRecordStated`.)
- **No cross-space consolidation.** Every run is scoped to one `space_id`. Same-space rule, like W1/W2.
- **No galaxy visualization changes.** The dream cycle owns belief nodes; W3's user_model rows are not galaxy nodes (W7 territory if ever).
- **No legacy-backlog adjudication.** Pre-W3 `agent_logs` contradiction rows are retired as `legacy_moot`, not guessed at (§5.1).

---

## 14. Open questions

1. **Should W3 absorb the existing dream cycle?** They're siblings now (world vs self). But two "sleep" processes with separate schedules could confuse. Alternative: W3 *calls* `runDreamCycle()` as Phase D, unifying under one quiet-hours run. Counter: the dream cycle's once-per-UTC-day cadence and paid-gating are tuned independently; merging risks breaking both. **Recommendation:** keep separate for W3; revisit in W6/W7. *(Unchanged from Draft v1.)*
2. **Distillation LLM vs template fallback.** Like the dream cycle, W3 should have an offline template path when no LLM key exists or budget is exhausted. **Design constraint (new in Rev 2):** the template path may only strengthen existing entries and run sweeps — never create new consolidated beliefs and never adjudicate contradictions. Template-based belief creation is where garbage beliefs come from; the constraint is structural, not advisory.
3. **The 24-hour settling rule.** §3.2 says never consolidate today's episodes. Is 24h right, or should it be "older than the last completed run"? The latter is simpler and self-tuning. **Leaning:** last-completed-run in Rev 2 — but kept 24h in the text pending the reviewer's call, since the settling rule interacts with the run-date attribution in §3.1.
4. **Inquiry surfacing.** Unresolvable contradictions queue inquiries with a durable lifecycle (§5.5) — but the UX (digest, proactive message, review UI) is W6 territory. W3 queues; W6 decides. *(Narrowed from Draft v1.)*
5. **Evidence half-life tuning.** §4.4 uses a 90-day evidence half-life and §7.1 uses per-kind retrieval half-lives. These are principled defaults from the research phase, not measured values. **Recommendation:** ship with defaults, add a W6-or-later tuning pass once consolidation has produced real evidence sets to evaluate against.

---

## 15. Changelog

- **Revision 2 (2026-10-19):** Addresses the W3 architecture gauntlet (3 P0, 6 P1, 3 P2). P0-1: single guarded write boundary (§6.1) + run-level stated-integrity check + W2 hardening prerequisites (§1.2); P0-2: typed `contradictions` table with two-sided identity, formal state machine, domain separation (§5); P0-3: exact deployment baseline with commit SHAs (§1.1). P1-1: lineage-key evidence independence (§4.3); P1-2: complete decision table (§5.3); P1-3: atomic `UNIQUE(space_id, window_date)` claim + fencing + DST semantics (§3.1); P1-4: work-item idempotency across run IDs, mutation+ledger atomicity (§8.3, §9.2); P1-5: `access_stats` table replaces `last_accessed_at` columns (§7.2, §8.5); P1-6: sweep eligibility matrix + review-flag lifecycle (§6.3, §6.4). P2-1: semantic routing with fail-closed abstention (§4.1); P2-2: exact `evidence_strength` formula (§4.4); P2-3: inquiry lifecycle (§5.5). Test plan expanded to ~55 tests. Legacy contradiction backlog retired as `legacy_moot`.
- **Draft v1 (2026-10-19):** Initial design. Grounded in: `index.ts` autonomy tick (5-min, paid ceiling, dream cycle), `dreamCycle.ts` (existing consolidation — W3 is a sibling, not a replacement), `temporal.ts` `logPotentialContradiction()` (`result='pending_w3'`), `userModel.ts` `sweepStaleEmotions()`/`sweepWithdrawnEvidence()` (explicitly W3-scheduled), `space_meta` (quiet hours, timezone, `last_dream_date` pattern), W2's confidence ceilings and evidence rules.
