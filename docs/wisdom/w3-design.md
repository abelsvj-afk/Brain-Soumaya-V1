# W3 Design: Sleep / Consolidation — Revision 5

**Status:** Revision 5 — addresses the W3 architecture gauntlet round-4 review (1 remaining P1). Not approved. No implementation authorized.
**Branch:** `w3-design` · **Baseline:** deploy branch `claude/soumaya-second-brain-v1-m4z4hc` (see §1.1 — hard gate, satisfied)
**Author:** King (Muse) · **Date:** 2026-10-19

**What changed in Revision 5 (summary):**
- **P1 (round 4):** The stated-coverage insertion guard is now **two-tier** — Tier 1 keeps the deterministic coverage check (same slot + overlapping topic labels + temporal currency → reject with `stated_covers`); Tier 2 adds a **semantic backstop**: any insert that passes Tier 1 is still checked against *all* current stated beliefs using the §5 contradiction rules, and a detected contradiction rejects the insert with `stated_contradiction_detected`. Tier 1 is the fast path; Tier 2 is the safety net — a contradictory insert can no longer bypass stated-wins merely because classification differs (different topic labels or different slots). New tests T-C66 (non-overlapping topic labels) and T-C67 (slot-mismatch variant) assert the conflicting row is absent, not merely that the stated row is intact (§6.1 step 3).

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

### 1.2 W2 hardening — required code changes (from P0-1, tightened in Rev 3)

The gauntlet found two places where existing W2 code violates the invariant W3 depends on, plus a third structural gap found in round 2: the W3 sweeps must not call W2's sweep functions as black boxes while the boundary claims to be the single write path. These are **required code changes**, not design notes — they must land before (or with) W3 implementation:

1. **`updateUserModel()` contradiction logic must exclude `stated` unconditionally.** Today it searches contradicted entries across `inferred`/`consolidated`/`stated` and filters out stated only when `confidence >= 0.95`. A stated entry at 0.90 can therefore be invalidated by a consolidated write. Required: stated rows are never candidates for contradiction-driven invalidation, at any confidence. (Stated-vs-stated conflicts surface as `conflictingStatedIds` for the correction path — existing behavior, unchanged.)
2. **`sweepStaleEmotions()` must skip `origin='stated'` rows.** Today it expires `emotion_state` rows without an origin filter. Required: stated emotion rows are never expired by the sweep; they receive a review flag instead (§6.3).
3. **Both sweep functions' SQL writers must route through `applyConsolidationMutation()` (P0-C, round 2).** It is not enough for W3's *new* code to use the boundary while W2's existing sweep functions perform direct `UPDATE user_model` statements that W3's Phase A invokes. Required: the W2 sweep functions are refactored so their write operations are issued through the guarded boundary (§6.1) — the boundary is the single write path for *all* W3-triggered `user_model` writes, including code that originated in W2. The code-review gate is mechanical: no `UPDATE user_model` / `INSERT INTO user_model` string may appear anywhere in the W3 module *or* in the W2 functions W3 invokes, outside `applyConsolidationMutation()`.

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
- **Freeze precondition (Rev 3):** the claim statement is preceded by a check: `SELECT w3_frozen FROM space_meta WHERE space_id = ?` — if `1`, the tick does not attempt the claim at all. The freeze check and the claim are not in the same transaction (the flag changes only via explicit operator action, so there is no race to guard against), but the flag is re-checked inside `run_consolidation` before Phase A begins, so a freeze landing between tick and run start still stops the run before any work.
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

- Never mutates the **protected columns** of a `user_model` row with `origin='stated'` — by any verb: invalidate, supersede, expire, strengthen, dedup-merge, cleanup, decay, or evidence append/withdrawal. (Protected columns vs the review-metadata exception are defined once in §6.1 — this section references that definition, not its own wording.) The boundary (§6.1) rejects all such mutations. Stated rows may be *read* as evidence and as adjudication input; their protected columns are never written. The sole exception is `SetReviewFlag`, which writes only `review_flag` / `review_flagged_at` (§6.4).
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
2. **Covered by a `stated` entry** → do NOT write anything. Stated outranks consolidated, always. Log `consolidation_redundant_with_stated`. (This is the distillation logic's own check — but it is *not* the enforcement point. The boundary's mandatory stated-coverage insertion precondition (§6.1, step 3) independently rejects the insert inside the transaction even if this check is skipped or wrong. T-C64 tests the boundary, not just this rule.)
3. **Covered by a newer `consolidated` entry with ≥ evidence strength** → skip.

All three checks and the resulting write happen inside one `BEGIN IMMEDIATE` transaction through the boundary (§6.1), so a user correction landing concurrently is seen, not raced.

### 4.3 Evidence independence (revised — P1-1: lineage, not IDs; tightened in Rev 3: unknown lineage is ineligible)

"Two episodes" is not "two observations." Independence is defined by **source lineage**:

- Every episode carries a **lineage key** assigned at capture: the identifier of the originating interaction. **Exact lineage grain, per capture type** (this is the contract — "conversation/session + turn" is not one rule; each trigger type defines its own):
  - `conversation` (chat/Telegram turn): `conv:<session_id>:turn:<turn_id>` — the session and the turn that produced the episode. Two triggers firing on the same turn produce the *same* key.
  - `agent_action` (tool execution inside a turn): inherits the turn's key — `conv:<session_id>:turn:<turn_id>` — an agent action inside a turn is part of that turn's source, not a separate observation.
  - `job_run`: `job:<job_name>:<run_id>` — one job execution is one source.
  - `digest_sent` / `proactive_msg`: inherit the lineage of the content they summarize (the episode/node lineage that generated them); if the digest content came from N sources, the digest episode itself takes the run's key `digest:<run_id>` and can never corroborate those N sources (it is derived from them — see derived-artifact rule below).
  - `correction`: **inherits the enclosing conversation's lineage by default** — `conv:<session_id>:turn:<turn_id>` of the turn in which the correction was issued — **unless** the correction introduces a fact not present in that conversation. The test is subject-and-slot: if the correction's proposition (per W2's one-proposition rule) concerns the *same subject entity and the same slot* as a proposition captured from the enclosing turn, it is a *refinement of the same observation* and inherits the turn's lineage. It earns an independent `corr:<correction_id>` lineage **only** when it introduces a proposition about a *different subject* or a *different slot* — i.e., genuinely new information, not a reinterpretation. A bare `corr:<id>` identifier never establishes independence by itself; the capture trigger must find positive evidence of a new subject/slot to assign independent lineage, and records which rule fired (`lineage_basis: 'inherited' | 'new_subject' | 'new_slot'`) on the episode row for audit. **Conservative default: inherit.** When the trigger cannot determine whether the correction adds new information, it inherits — a missed independent source is a false negative (one fewer observation), while a wrongly independent lineage is a false positive that manufactures evidence (the worse error).
  - Rationale (round 3 P1-3): a correction issued mid-conversation usually *re-describes the same observation* ("I work at Samsonite" → "I meant I started last Monday"). Assigning it `corr:<id>` automatically would let one interaction count as two independent sources — exactly the manufactured-independence failure. New information earns independence; reinterpretation does not.
  - `milestone` / `session`: `mill:<milestone_id>` / `sess:<session_id>` — the milestone event or session as a whole.
- **Unknown lineage (round 2 P1-1 fix):** episodes captured before the lineage key existed, or whose capture metadata cannot reconstruct it, are **lineage-unknown**, not "singleton lineages." An episode with `lineage_key IS NULL` is **ineligible to establish independence**: it cannot count as a distinct evidence group, and two unknown-lineage episodes can never together satisfy the §4.5 threshold. This is the conservative rule — independence must be *proven*, not assumed from missing metadata. Unknown-lineage episodes may still be *read* (retrieval, decay scoring) and may be *appended as corroboration to an already-established belief* only if they don't change the group count used to justify the belief's existence; they may not be the sole or threshold-crossing evidence for a new consolidated entry. (Rev 2's singleton rule is withdrawn: assigned singletons could manufacture independence from missing metadata — exactly the failure round 2 identified.)
- **Grouping rule:** episodes sharing a `lineage_key` are **one observation**, regardless of count. Two capture triggers firing on the same turn, a capture plus its enrichment-derived copy, a digest episode quoting a conversation episode — all one source.
- **Derived artifacts inherit lineage.** A `nodes` row created from an episode (extraction, `summarizes` edge, enrichment link) carries that episode's `lineage_key`. A node therefore **cannot corroborate its own source episode**: the "1 episode + 1 corroborating node" path (§4.5) requires the node's lineage key to differ from the episode's, and both to be non-NULL.
- **Duplicate captures** (same turn captured twice under any trigger combination) are detected by lineage key at consolidation time and counted once. Capture-time dedup remains best-effort; consolidation-time grouping is the guarantee.
- The ≥2 threshold in §4.5 is **≥2 distinct, known lineage groups**, full stop.

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
- Consolidation requires **≥2 independent lineage groups** (§4.3) OR **1 episode + 1 corroborating node of a different lineage**. Both groups (or the episode's and the node's lineages) must be **known** (non-NULL) — unknown-lineage evidence can never satisfy or contribute to the threshold count. Single-source "insights" are not consolidated; they're left for a future run with more evidence.
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
  reopens_id INTEGER,       -- prior contradictions.id this report reopens (NULL for first reports; see report_ref dedup below)
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

**`report_ref` dedup (round 2 P1-5):** the pair-uniqueness index above covers active records only — after a record goes terminal, a later report for the same pair could create a duplicate inquiry chain. The dedup contract is:

- **Same `(pair, report_ref)` → duplicate, ignored.** Filing a contradiction for an identical pair with an identical `report_ref` is a no-op: the existing record (in any state) is returned, and no new record or inquiry is created. `report_ref` must therefore be stable for a given originating event (e.g. `supersession-proposal:<id>`, `knowledgeCheck:<verdict_id>`, `correction:<id>`, `sweep:<run_id>:<item>`).
- **New `report_ref` for the same pair → new event.** A genuinely new report about the same pair (e.g. a *second* user correction restating the conflict, a new knowledgeCheck verdict from fresh content) creates a new contradiction record with `reopens_id = <prior contradiction id>`. The new record goes through the full state machine; its inquiry is linked (`inquiries` row references the new contradiction, with the prior inquiry's outcome visible as context).
- **Uniqueness:** `UNIQUE(space_id, domain, old_kind, old_id, new_kind, new_id, report_ref)` — enforced at the database level. This subsumes the active-state index (same pair + same ref can never double-file, even across terminal states), while same pair + different ref is permitted by design.
- **Legacy rows** (`agent_logs` `result='pending_w3'`) have no `report_ref`; they are retired as `legacy_moot` (§5.1 above) and never enter this scheme.

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

### 5.3 The decision table (revised — P1-2: complete, deterministic; Rev 4: cells 7/7b single-contract rewrite — P1-1)

All inputs are computed from the two sides' records — no LLM is consulted for the decision itself (the LLM may be used to *propose* a contradiction record in the first place; the *decision* is rules).

| # | Domain | Old side | New side | Decision | Outcome | Permitted mutations |
|---|---|---|---|---|---|---|
| 1 | nodes | any | any, same proposition | **compatible** | Both stand. | None. (e.g. "works in a warehouse" vs "works at Samsonite" — compatible, not contradictory. Compatibility is a first-class outcome, not a failed contradiction.) |
| 2 | nodes | system-derived | system-derived, newer, contradicting | **superseded_by_newer** | Newer wins. | W1 `supersede()` on old node, `supersede_reason='update'`, `correctedBy='system'`. |
| 3 | nodes | system-derived, evidence strictly stronger | system-derived, newer, contradicting | **older_retained** | Older wins on strength. | None — old node stays current; record notes `rule='strength_beats_recency'`. (Resolves the Draft v1 ambiguity: "newer wins UNLESS older has strictly greater evidence strength" — the table makes it exact: strictly greater strength defeats recency; equal or lesser does not.) |
| 4 | nodes | system-derived | system-derived, contradicting, equal strength, no user statement | **unresolved** | Both stand. | None. Inquiry candidate (§5.5). **The tie-breakers below never convert this cell into a winner** — equal strength with no authority or recency differentiator is genuinely unresolved, not a tie to be broken. |
| 5 | nodes | any | any, one side user-stated (or `user_override` correction exists) | **stated_conflict** | Stated side wins by authority. | If the *old* node is the stated one: no mutation; record the conflict as evidence the user may want to resolve. If the *new* side is a user statement/correction contradicting an old system node: the correction path (not W3) performs the supersession via the authorized user path; W3 records the outcome as observed. **W3 never calls `supersede()` against a user-stated proposition.** |
| 5b | nodes | system-derived | **user-stated** (new side stated, old side not) | **stated_conflict** | Stated wins by authority (symmetric with cell 5). | The old system node is superseded — but **not by W3**: the user-statement ingestion path performs the supersession via the authorized user path (the statement *is* the correction). W3 observes and records. If the statement arrived through a channel W3 can't attribute, W3 marks `unresolved` with `note='stated_challenger_unattributed'` and queues an inquiry rather than mutating. |
| 6 | user_model | consolidated/inferred | consolidated/inferred, contradicting | **adjudicated** | Winner determined inline (no delegation): compare `evidence_strength` first — strictly greater strength wins. If strengths are equal within floating-point tolerance (difference < 1e-9): the entry with the *newer* `valid_at` wins. If both strength and `valid_at` tie: `unresolved` (not a coin flip). | Boundary-gated `invalid_at` set on loser only (never delete). Winner's `evidence_ids` may absorb the loser's non-duplicate evidence via `AppendEvidence` if it strengthens the winner (same transaction). |
| 7 | user_model | stated (any confidence) | any | **stated_conflict** | Stated wins, unconditionally. | **W3 invalidates the non-stated challenger** via the boundary (`InvalidateEntry`, `reason='stated_conflict'`) — precondition: the challenger is a `consolidated`/`inferred` row whose proposition directly contradicts a *current* stated row (same coverage predicate as the §6.1 insertion precondition: same slot + topic overlap + temporal overlap). The stated row is never a mutation target (the boundary would reject it). **Subcase — challenger is a not-yet-written proposal** (distillation candidate): there is no row to invalidate — the §6.1 insertion precondition rejects the write with `stated_covers` before it exists. **Subcase — challenger is itself stated** (stated-vs-stated): W3 performs **no mutation at all** — both rows stand, and the conflict surfaces through `conflictingStatedIds` on the authorized correction path, never through W3. |
| 7b | user_model | consolidated/inferred | **stated** (new challenger stated) | **stated_conflict** | Stated wins by authority (symmetric with cell 7). | **W3 observes; the authorized correction path mutates.** The stated challenger was written by `recordStated()`/`correctUserModel()`, which performs its own contradiction handling at write time. W3's contract has two explicit outcomes, distinguished by the incumbent's state at adjudication: (a) the correction path already invalidated the incumbent → W3 marks the contradiction `resolved` with `actor='user'` and performs **no mutation**; (b) race window — the incumbent is still `invalid_at IS NULL` *and* a current stated row covering the same proposition exists → W3 invalidates the non-stated incumbent via the boundary (`InvalidateEntry`, `reason='stated_conflict_race'`). In both subcases the stated challenger is never a mutation target. |
| 8 | user_model | consolidated/inferred | episode evidence (new lineage) | **evidence_update** | Outcome determined inline: if the episode's lineage group is already in the entry's evidence set → no-op (duplicate). If the episode contradicts the entry's proposition → treat as cell 6 with the episode as a virtual challenger: compute the entry's strength *with* the new evidence; if the contradicted proposition's support collapses below the consolidation threshold (§4.5) → invalidate the entry and, if the new evidence independently meets the threshold, insert a replacement row (new row, old row invalidated — never edited). Otherwise → strengthen via `AppendEvidence`. | Boundary-gated: `AppendEvidence`, `InvalidateEntry`, or `InsertConsolidated` — per the inline rules above, never by external reference. |
| 9 | any | — | stale/missing/cross-space targets | **moot** | No action. | None. |
| 10 | nodes | any | **episode** (new side is an episode, not a node) | **evidence_only** | An episode is *evidence*, never a supersession target or source. | None on the node. The episode may be *cited* in the node's `supersede_reason` if a later cell-2/3/5 decision supersedes the node, but cell 10 itself performs no mutation. **Node-vs-episode action contract:** `supersede()` requires both sides to be nodes. An episode can *trigger* a contradiction record (as `new_kind='episode'`) and can *inform* adjudication, but the only mutations available in the nodes domain act on nodes. If the episode's content warrants a new node (extraction), that is a separate `InsertConsolidated`-analogous node-creation step, not part of adjudication. |

**Tie-breaking within a cell** is by `evidence_strength` (§4.4, deterministic), then by `recorded_at` (older first — deterministic), then by `id` (deterministic). No cell contains "decide by judgment." **Tie-breakers select among winners only — they never promote a case to a winner.** Cells designated `unresolved` (notably cell 4) remain unresolved regardless of tie-break values; the tie-break order applies only within cells whose outcome is a decision (2, 3, 6, 8).

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

### 6.1 The guarded write boundary (revised — P0-1: enforced, not conventional; tightened in Rev 3; invariant defined once in Rev 4 — P1-4)

**The stated-row invariant — canonical definition (defined here, referenced everywhere).** A `user_model` row with `origin='stated'` has two disjoint column classes, and this partition is the *single* definition used by §3.4, §6.1, and §6.2 — no section restates it in its own words:

- **Protected columns** — `slot, content, evidence_ids, confidence, valid_at, invalid_at, invalidated_by, replaced_by, updated_at`. No W3-initiated operation may write these columns on a stated row, by any verb (insert-targeting, invalidate, supersede, expire, strengthen, dedup-merge, cleanup, decay, evidence append/withdrawal). The *only* writers of protected columns on stated rows are the authorized user-statement/correction paths (`recordStated()`, `correctUserModel()`) and the user's own forget flow — none of which W3 calls.
- **Review-metadata exception** — `review_flag`, `review_flagged_at` **only**. These two columns exist precisely so maintenance can *signal* about a stated row without *changing* what the system believes. They may be written solely via the `SetReviewFlag` mutation (§6.4), which is structurally limited to these two columns and carries no content payload. This is the sole exception, and it is not a protected-column write.

**Hash coverage (Rev 4 decision):** the run-level integrity hash (§6.1, defense-in-depth) covers **exactly the protected columns** — `id` plus the nine protected columns above. Review fields are *excluded by definition*: they are the documented, intended-to-be-mutable exception, and their safety is verified by the boundary's type-level enforcement (a `SetReviewFlag` naming any other column is rejected structurally), not by the hash. Including them in the hash would make every legitimate flag-set during the run look like a violation at finalize.

Draft v1 protected stated rows by "code review + a test." The gauntlet correctly identified this as unenforceable — and found two live W2 paths that already violate it. Revision 2 replaced convention with structure. Revision 3 closes the three remaining gaps round 2 found: the hash projection was incomplete (P0-A), detection was post-hoc rather than preventive (P0-B), and the `SetReviewFlag` exception contradicted the closed-union claim (P0-D). Revision 4 defines the invariant once and adds the insertion precondition (P1-2).

**The boundary:** exactly one function in the W3 module is permitted to issue `INSERT`/`UPDATE` statements against `user_model`:

```ts
applyConsolidationMutation(sqlite, runCtx, mutation: ConsolidationMutation): MutationResult
```

where `ConsolidationMutation` is a closed union:

```ts
type ConsolidationMutation =
  | InsertConsolidated      // new consolidated-origin row (evidence_ids non-empty, INV-C-4)
  | InvalidateEntry         // set invalid_at on a consolidated/inferred row (never stated)
  | AppendEvidence          // set-union episode IDs into evidence_ids, recompute strength (same transaction)
  | WithdrawEvidence        // (Rev 3, P1-4) remove specific episode IDs from evidence_ids,
                            // recompute strength atomically; invalidate the entry if the set becomes empty
  | SetReviewFlag;          // the SOLE stated-row operation permitted (see below)
```

**The stated-row exception, made explicit (P0-D):** `SetReviewFlag` is the *only* mutation in the union that may target a `stated`-origin row, and it is narrowly scoped by construction: it may write **only** the `review_flag` and `review_flagged_at` columns, and only to the values enumerated in §6.4. The boundary validates this structurally — a `SetReviewFlag` mutation naming any other column, or targeting a stated row with any other mutation kind, is rejected with `stated_protected` before the transaction begins. There is no path from "flag a stated row" to "change a stated row's content": the flag columns are disjoint from the protected columns, and the mutation type carries no content payload.

**What the boundary does, in order, inside one transaction:**
1. Loads the target row(s) by id with `FOR`-style re-read inside the transaction (all W3 writes use `BEGIN IMMEDIATE` — a user correction landing concurrently is seen, not raced).
2. **The stated check (precondition, not detector — P0-B):** if the mutation kind is anything other than `SetReviewFlag` and any target row has `origin = 'stated'` → the mutation is **rejected** with `error='stated_protected'`, the transaction rolls back, the work item is marked `failed` with that reason, and an `agent_logs` row records the attempted violation (`w3_stated_write_blocked`, IDs + mutation kind — this is a canary: in a correct implementation it should never fire). **The protection is enforced before any write occurs, inside the same transaction as the would-be mutation.** There is no window in which a stated row is mutated and "detected later" — the mutation never happens.
3. If the mutation is an insert: verifies `origin='consolidated'` on the new row and non-empty `evidence_ids` (INV-C-1, INV-C-4) — write-time rejection, same pattern as W2's `validateProvenance()`. Inserts additionally verify every evidence ID's lineage is known (non-NULL) per §4.3 — unknown-lineage evidence cannot be the basis of a new consolidated row. **Two-tier stated-wins insertion guard (Rev 4, P1-2; Rev 5, round-4 P1):**
   - **Tier 1 — deterministic coverage check (fast path, no LLM):** before any `InsertConsolidated`, the boundary queries for a *covering stated belief* — a row with `origin='stated'`, `invalid_at IS NULL`, the same `slot`, overlapping `topic_labels`, and temporal currency (its `valid_at`/`invalid_at` interval overlaps the new row's). If such a row exists, the insert is **rejected** with `error='stated_covers'` — no consolidated row is created, not even alongside the untouched stated row.
   - **Tier 2 — semantic backstop (NEW, Rev 5):** an insert that passes Tier 1 is *not* automatically admitted. The boundary runs the candidate proposition through the **contradiction detector against all current stated beliefs** — not just coverage-matched ones. It reuses §5's rules in their existing priority: the deterministic coverage/similarity checks first, then the LLM-judged contradiction rules only on genuine ambiguity (a classifier miss that reaches Tier 2 is by definition ambiguous). If the detector returns a contradiction verdict against any current stated row, the insert is **rejected** with `error='stated_contradiction_detected'` — nothing is written. The detector is *bounded*: Tier 2 is per-insert work, so it is capped at the deterministic pass plus at most one LLM judgment per insert (the same contradiction-judge budget discipline §5 uses for the backlog — no unbounded reasoning). Deterministic hits short-circuit before any LLM call.
   - Both tiers are mandatory, inside the same transaction, with no caller discretion. The distillation logic in §4.2 performs its own stated-coverage check (rule 2), but the boundary does not trust it — a caller that skips or mis-implements the check is stopped here. The invariant is not "stated rows are never touched" alone — it is "no W3 belief contradicts a current stated belief." **Tier 1 is the fast path; Tier 2 is the safety net: a contradictory insert cannot bypass stated-wins merely because classification differs** — different topic labels, different slots, or any other labeling artifact that defeats the Tier 1 predicate is caught semantically by Tier 2. The only stated beliefs that escape Tier 2 are those the contradiction detector itself fails to recognize — and that failure mode is identical to the one the §5 backlog adjudication already accepts, with the same fail-closed rule: ambiguous detector output does *not* become an admission; an ambiguous-but-contradiction-likely verdict rejects, and only a clean `compatible`/`no_contradiction` verdict admits. The asymmetry is deliberate: a false rejection costs one night's belief; a false admission violates the system's core safety promise.
4. If the mutation is `WithdrawEvidence`: validates the named episode IDs are a subset of the entry's current `evidence_ids`; computes the surviving set; recomputes `evidence_strength` over survivors via §4.4; if the surviving set is empty → the mutation escalates to `InvalidateEntry` with `reason='evidence_withdrawn'` in the same transaction. All three steps (withdraw, recompute, conditional invalidate) are atomic — a crash cannot leave a row with withdrawn evidence still counted in its strength.
5. Applies the mutation, commits.

**There is no confidence-threshold exception.** Draft v1's inherited W2 behavior (stated filtered only at `confidence >= 0.95`) is explicitly withdrawn for W3-initiated writes: a stated row at 0.90, 0.50, or 0.10 is equally untouchable. The only operations that may alter a stated row are `recordStated()` (hot path), `correctUserModel()` (explicit correction path), and the user's own forget flow — none of which W3 calls.

**The run-level integrity check (defense-in-depth — P0-A, P0-B):** at run start, W3 snapshots the *complete* protected state of every stated row:

```sql
SELECT id, slot, content, evidence_ids, confidence,
       valid_at, invalid_at, invalidated_by, replaced_by, updated_at
FROM user_model
WHERE space_id = ? AND origin = 'stated'
ORDER BY id;
```

— hashed (SHA-256 over the canonical row serialization) and stored on the run row. At run finalize, before marking `completed`, it recomputes and compares. **Round 2's P0-A is closed by construction: every column that must remain unchanged is in the projection.** A content change that leaves `updated_at` untouched, a silent `evidence_ids` edit, a confidence nudge — all change the hash.

**What a mismatch means (P0-B — explicit):** the hash check is a *detector*, not a restorer. If it fires, the run is marked `failed` with `error='stated_integrity_violation'` — but the design is explicit that **this does not restore safety**. The stated row may already be mutated; conflicting consolidated beliefs may already be committed. A mismatch triggers the **incident procedure** (§9.4, new in Rev 3):

1. **Alert:** an alert-grade `agent_logs` row (`w3_stated_integrity_violation`) with the run ID, the mismatching row IDs, and the before/after hashes — content-free, IDs only.
2. **Freeze:** W3 sets `space_meta.w3_frozen = 1` for the affected space. No further W3 run may claim a window while frozen — the claim transaction checks the flag first. (The hot path, reads, and user-statement writes are unaffected; only consolidation stops.)
3. **Manual review required:** unfreezing requires a human (the operator) to inspect the diff, determine the cause (boundary bypass, W2 regression, concurrent-write bug), repair the stated row through the authorized correction path if needed, and clear the flag explicitly. There is no automatic unfreeze.
4. **Audit:** the freeze, the review, and the unfreeze are all `agent_logs` rows. An integrity violation is never silently absorbed.

T-C50 tests the detector (simulated bypass → mismatch → `failed` + frozen). T-C58 (new in Rev 3) tests the full incident: a bypassed write after earlier committed work items → run fails, `w3_frozen` set, subsequent claim refused, and the design's claim is verified — the earlier work items are *not* rolled back (each committed independently), which is exactly why the freeze exists.

**Relationship to the §1.2 prerequisites:** the hardening fixes make W2's own functions consistent with the invariant; the boundary makes W3's use of them (and any future W3 path) structurally unable to violate it. Belt and suspenders, on purpose — this is the system's core safety promise.

### 6.2 Revised invariants

- **INV-C-1 (origin ceiling):** Consolidation writes `origin='consolidated'` only. Enforced by the boundary (step 3), not by convention.
- **INV-C-2 (stated is sacred):** No W3-initiated operation writes the **protected columns** of a `stated`-origin `user_model` row — by any verb (invalidate, supersede, expire, strengthen, dedup-merge, cleanup, decay, evidence append/withdrawal). (The protected column set and the review-metadata exception are defined once in §6.1; this invariant references that definition.) Stated rows are read-only inputs to W3 except for the narrowly scoped `SetReviewFlag` exception. The *only* writers of stated protected columns are the authorized user-statement/correction paths. Enforced by the boundary (step 2: pre-write rejection + step 3: two-tier insertion guard — Tier 1 deterministic coverage precondition, Tier 2 semantic contradiction backstop) + the run-level integrity check (§6.1) + the §1.2 W2 hardening.
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
- **Set by:** sweeps and contradiction adjudication only (via the boundary — `SetReviewFlag` is the sole stated-row operation permitted by the closed mutation contract, §6.1; it writes only the two flag columns, never content).
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
- **Derived-belief withdrawal (forgetting propagation):** when `applyForgetRequest()` tombstones an episode, W3's next run issues a `WithdrawEvidence` mutation (§6.1) for every consolidated entry whose `evidence_ids` reference it: surviving evidence is preserved, strength is recomputed via §4.4, and entries left with an empty evidence set are invalidated with `reason='evidence_forgotten'` — all in one atomic transaction per entry. The verifiable completion condition: after the run, no `user_model` row with `origin='consolidated'` references the forgotten episode's ID in `evidence_ids`, and no `vec_episodes` row exists for it (W2's forget flow already deletes embeddings). Withdrawn evidence cannot reappear through retries: evidence appends are set-semantic, and a re-run sees the withdrawal already recorded in the entry's mutation history (the `WithdrawEvidence` ledger row), so re-withdrawal is a no-op. T-C51 asserts this end-to-end. (This answers pressure point 8: a forgotten episode cannot reappear through a consolidated belief or cached evidence.)

---

## 8. Schema changes (revised)

All additive, following the repo's migration conventions (PRAGMA-guarded DDL in `migrateSchema()`, table creation in `BOOTSTRAP_SQL`). Fresh-bootstrap and migration paths must produce identical schemas — tested per the W2 migration-equivalence pattern (`assertSchemaEquivalent`-style: columns, indexes, CHECKs, UNIQUE behavior).

### 8.1 `space_meta` additions (unchanged from Draft v1, semantics clarified)

```sql
ALTER TABLE space_meta ADD COLUMN last_consolidation_date TEXT;  -- YYYY-MM-DD, space-local; written on completed/aborted_budget runs ONLY (§3.1)
ALTER TABLE space_meta ADD COLUMN w3_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE space_meta ADD COLUMN w3_llm_budget INTEGER NOT NULL DEFAULT 5;   -- max LLM calls per run
ALTER TABLE space_meta ADD COLUMN w3_max_items INTEGER NOT NULL DEFAULT 50;  -- max work items per run
ALTER TABLE space_meta ADD COLUMN w3_frozen INTEGER NOT NULL DEFAULT 0;       -- Rev 3: incident freeze (§6.1/§9.4). Set on stated-integrity violation; cleared only by explicit operator action.
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
    CHECK (outcome IN ('consolidated','strengthened','skipped_covered','skipped_low_importance','abstained',
                       'failed_terminal','failed_retryable')),
  resulting_entry_id INTEGER,   -- user_model.id or nodes.id, when written/strengthened
  evidence_group_set TEXT NOT NULL,  -- canonical JSON array of lineage keys (sorted, deduped)
                                     -- representing the FULL evidence state this decision was based on
  evidence_fingerprint TEXT NOT NULL,-- SHA-256 over the canonical evidence_group_set + the
                                     -- evidence_ids snapshot; the durable identity of "this evidence state"
  last_run_id INTEGER NOT NULL,  -- most recent run that touched this item (for audit, not identity)
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (space_id, episode_id)
);
```

- An episode's consolidation outcome is decided **once** per distinct evidence state. A retry of the same episode with the same `evidence_fingerprint` is a no-op — the row already exists with a terminal outcome. New evidence (a new lineage group, or a changed evidence set) produces a *different* fingerprint, which legitimately re-opens the item: the run compares the current evidence-set fingerprint against the recorded one and only re-processes on difference. (Round 2 P1-3: the singular `evidence_group_key TEXT` could not represent the set being compared. The set *is* the stored value now — a canonical JSON array of lineage keys, sorted and deduped — plus a fingerprint hash that makes the comparison unambiguous.)
- **Terminal vs retryable (round 2 P1-3):** the outcome enum now distinguishes them explicitly:
  - `failed_terminal` — deterministic rejection: write-time validation failed (no evidence, invalid lineage, abstention rule). Retrying the same evidence state will fail identically; the item is closed for this evidence state. A *new* evidence state (new fingerprint) re-opens it.
  - `failed_retryable` — transient failure: LLM call threw, embedding failed, DB contention after one retry. The next run retries the same evidence state (with backoff: attempts recorded, `failed_retryable` → retried at most 3 times per evidence state, then escalated to `failed_terminal` with `reason='retry_exhausted'`).
- **Belief mutation and ledger write are atomic:** the `UPDATE/INSERT` on the target `user_model` row and the upsert of the `consolidation_episodes` row happen in the **same transaction**. Crash between them is impossible by construction — there is no "mutation committed, ledger lost" state (T-C42).
- **Evidence appends are set-semantic:** strengthening appends episode IDs via set union, not list append. Re-processing an already-recorded episode ID changes nothing — `evidence_ids` is a set, and `evidence_strength` recomputed over the same set is identical (T-C42, T-C47).

### 8.4 `contradictions` (new — P0-2; dedup tightened in Rev 3)

The typed two-sided record from §5.1, with `reopens_id INTEGER` added in Rev 3, the `UNIQUE(space_id, domain, old_kind, old_id, new_kind, new_id, report_ref)` dedup index, and the active-state partial index `UNIQUE(...) WHERE state IN ('pending','claimed')`. Lives in `BOOTSTRAP_SQL` + migration path identically.

### 8.5 `access_stats` (new — P1-5)

The append-only-in-practice telemetry table from §7.2. No columns are added to `episodes` or `user_model` for access tracking.

### 8.6 Other additions

- `episodes.lineage_key TEXT` — the durable source-lineage key (§4.3). Nullable in migration; backfilled from capture metadata where available, else **NULL (unknown)** — never a synthetic singleton. New captures always set it (capture-trigger contract amendment — small, included in W3 implementation scope). W3 implementation must also add the `w3_frozen` flag to `space_meta` (§6.1 incident procedure) and the `space_meta` columns from §8.1.
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

### 9.4 Incident procedure: stated-integrity violation (new — P0-B, Rev 3)

The §6.1 hash check is a detector, not a restorer. When it fires, the system must not pretend the failure is contained — a stated row may already be mutated and conflicting consolidated beliefs may already be committed. The incident procedure is:

1. **Mark and alert.** The run is marked `failed` with `error='stated_integrity_violation'`. An alert-grade `agent_logs` row fires: `w3_stated_integrity_violation`, with `targets` = `{run_id, space_id, mismatching_row_ids, hash_before, hash_after}` — content-free (IDs and hashes only, never the row contents, which may be sensitive).
2. **Freeze.** In the same finalize step, W3 sets `space_meta.w3_frozen = 1` for the space. The run-claim transaction (§3.1) checks `w3_frozen = 0` as a precondition — while frozen, no W3 run may claim a window. The hot path (chat, `maybeRecordStated`, reads, user corrections, forget flow) is **unaffected**: only consolidation stops. Freezing is fail-safe: a frozen space loses nightly consolidation, not the ability to talk to the user.
3. **Manual review (operator).** Unfreezing is a deliberate human action, not a timeout:
   - Inspect the mismatching rows: which columns changed, and what code path could have changed them (boundary bypass, W2 regression, concurrent-write bug, direct DB access).
   - Repair the stated row(s) through the authorized correction path (`correctUserModel()`), restoring the user's stated content. Never hand-edit the row outside the authorized path — the repair itself must be auditable.
   - Review any consolidated beliefs committed by the failed run for contamination (beliefs derived from or contradicting the corrupted stated row); invalidate as needed through the boundary.
   - Clear the freeze explicitly: `UPDATE space_meta SET w3_frozen = 0` + an `agent_logs` row (`w3_unfrozen`, with reviewer note). There is no automatic unfreeze, no TTL, no "freeze expires after N days."
4. **Audit trail.** The violation, the freeze, the review findings, and the unfreeze are all `agent_logs` rows. An integrity violation is never silently absorbed, and a freeze is never silently lifted.

**Design note:** the freeze exists precisely because per-item transactions commit independently (§9.2) — the failed run's earlier work items are *not* rolled back, by design. Rolling back a night's legitimate consolidation because of one integrity failure would destroy more than it saves. The freeze stops *future* damage while a human assesses *past* damage. T-C58 tests this end-to-end: bypassed write after committed items → `failed` + `w3_frozen=1` + subsequent claim refused + earlier items verifiably intact (not rolled back).

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
| LLM call throws | Caught per-item; `consolidation_episodes` records `failed_retryable` (transient) — retried next run with backoff, up to 3 attempts per evidence state, then escalated to `failed_terminal`. A deterministic validation failure records `failed_terminal` immediately. Never aborts the run. |
| Budget exhausted mid-run | `status='aborted_budget'`; remaining items wait for tomorrow. Not an error. |
| Process crash mid-run | Lease expiry (6h) → ownership transfer on the same run row (§3.1). Work-item idempotency (§9.2) prevents duplicate effects. |
| DB locked / contention | All writes in short `BEGIN IMMEDIATE` transactions; run yields between phases. Transaction failure → retry once → item `failed`. |
| Contradiction adjudication throws | Claim lease expires → row returns to `pending` with `attempts+1`; after 3 attempts → `unresolved` + inquiry. A poison row can't block the backlog. |
| Distillation produces no evidence | Write-time rejection at the boundary (INV-C-4); item marked `abstained`. |
| Space deleted mid-run | Run checks space existence per phase; aborts quietly if gone. |
| Stated-integrity mismatch at finalize | Run marked `failed`, `error='stated_integrity_violation'`, alert-grade audit row. **This does not restore safety** — it triggers the incident procedure (§9.4): freeze W3 for the space (`w3_frozen=1`), manual operator review, explicit unfreeze. Earlier committed work items are not rolled back. |
| Legacy contradiction backlog | Marked `legacy_moot` on first run, never adjudicated (§5.1). |

---
## 12. Test plan (expanded — covers every gauntlet finding)

Draft v1's T-C1–T-C22 are retained where still valid; revised or superseded tests are marked. New tests are grouped by the finding they close. Every test that touches the database uses real SQLite through `createDb()` — no mocked outcomes for transactional behavior (the user's standing guardrail from the W2 reviews). Rev 4 adds T-C64–T-C65 (~64 tests total). Rev 5 adds T-C66–T-C67 (~66 tests total).

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
- T-C57: **(Rev 3, P0-A)** stated content change *without* `updated_at` changing (direct SQL `UPDATE user_model SET content=... WHERE origin='stated'`, leaving `updated_at` untouched) → the finalize hash detects the mismatch. This is the exact evasion round 2 named.
- T-C58: **(Rev 3, P0-B)** full incident — bypassed stated write after earlier work items committed → run `failed`, `w3_frozen=1` set, subsequent run claim refused, earlier items verifiably intact (asserted *not* rolled back), alert-grade audit row present with IDs + hashes only.
- T-C59: **(Rev 3, P1-1)** unknown-lineage ineligible — two episodes with `lineage_key IS NULL` on the same topic → threshold NOT met, no consolidated entry; then two episodes with distinct known lineages → threshold met. Also: one known + one unknown → not met.
- T-C60: **(Rev 3, P1-2)** symmetric stated challenger — new stated challenger vs consolidated incumbent (cell 7b) → incumbent invalidated via boundary, stated challenger untouched; and new stated node vs old system node (cell 5b) → observed, not mutated by W3.
- T-C61: **(Rev 3, P1-4)** `WithdrawEvidence` — consolidated entry with 3 evidence groups, forget one episode → single atomic mutation: surviving evidence preserved, strength recomputed, entry valid; forget all three → entry invalidated with `reason='evidence_forgotten'`. Assert no intermediate state visible (read inside the transaction).
- T-C62: **(Rev 3, P1-5)** `report_ref` dedup — file contradiction with `report_ref='kc:v1'` → one record; re-file same pair + same ref → no new record; file same pair with `report_ref='kc:v2'` → new record with `reopens_id` pointing at the first; inquiries: exactly one inquiry per contradiction record.
- T-C63: **(Rev 3, P1-3)** evidence-state ledger — same fingerprint retry is a no-op (no duplicate work); new lineage group changes the fingerprint and re-opens the item; transient failure records `failed_retryable` and retries; deterministic validation failure records `failed_terminal` and does not retry on the same evidence state.
- T-C64: **(Rev 4, P1-2)** stated-coverage insertion precondition — a current `stated` belief exists ("works at Samsonite", slot=belief, topic=employment); attempt a direct `InsertConsolidated` of a contradictory proposition ("works at Amazon", same slot + overlapping topic) through the boundary → rejected with `stated_covers`. **Assert absence, not just stated-integrity:** query `user_model` for any consolidated row containing the contradictory proposition and assert zero rows — the test fails if the conflicting belief exists *alongside* the untouched stated row. Companion case: a non-contradictory insert (same slot, disjoint topic) is still accepted, proving the precondition is coverage-scoped, not a blanket insert ban.
- T-C66: **(Rev 5, round-4 P1)** Tier 2 semantic backstop — non-overlapping topic labels. A current `stated` belief exists ("works at Samsonite", slot=belief, topic=employment). Attempt a direct `InsertConsolidated` of a semantically contradictory proposition whose topic labels do *not* overlap the stated belief's ("unemployed and looking for work", slot=belief, topic=daily_routine) — Tier 1's deterministic coverage check passes it (different labels, no overlap), so this test proves Tier 2 catches what Tier 1 misses. Assert **no** consolidated row is created: the boundary rejects with `stated_contradiction_detected` and a query for any consolidated row containing the contradictory proposition returns zero rows. This is the exact classifier-bypass case the round-4 review named: contradictory content, different labels.
- T-C67: **(Rev 5, round-4 P1)** Tier 2 semantic backstop — slot-mismatch variant. A current `stated` belief exists ("I want to keep working at Samsonite", slot=desire, topic=employment). Attempt a direct `InsertConsolidated` of a contradictory proposition in a *different slot* ("plans to quit and move to trucking", slot=intention, topic=employment) — Tier 1 passes it (different slot), Tier 2 must detect the contradiction against the stated desire (the plan defeats the stated want) and reject with `stated_contradiction_detected`. Assert zero conflicting consolidated rows. Companion case: a genuinely compatible cross-slot insert (intention "save for a car" vs stated desire "keep working at Samsonite") is still accepted — Tier 2 is a backstop, not a cross-slot veto.

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
- T-C65: **(Rev 4, P1-3) correction lineage inherits the conversation** — turn "I work at Samsonite" captured as an episode with lineage `conv:s1:turn:t1`; in the *same* conversation, the user corrects it ("I meant I started last Monday") → correction episode carries lineage `conv:s1:turn:t1` (inherited, `lineage_basis='inherited'`), NOT `corr:<id>` → the two episodes form **one** lineage group → threshold (≥2 groups) NOT met, no consolidated entry. Then a second, independent conversation mentions Samsonite employment → second lineage group → threshold met, entry created with both groups' episode IDs. Subcase: a correction introducing a new subject ("my sister also works at Samsonite") is assigned `corr:<id>` with `lineage_basis='new_subject'` and *does* count as a second group.
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
- T-C56: `lineage_key` backfill — pre-W3 episodes get lineage keys from capture metadata where available, else **NULL (unknown)**; new captures always set the key (capture-trigger contract test). Assert no synthetic singleton keys are assigned.

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

- **Revision 5 (2026-10-19):** Addresses the gauntlet round-4 review (1 remaining P1). The stated-coverage insertion guard is now **two-tier** (§6.1 step 3): Tier 1 keeps the deterministic coverage check (same slot + overlapping topic labels + temporal currency → reject with `stated_covers`); Tier 2 adds a **semantic backstop** — any insert passing Tier 1 is checked against *all* current stated beliefs via the §5 contradiction rules (deterministic first, LLM judge only on ambiguity, at most one LLM judgment per insert, deterministic hits short-circuit). A detected contradiction rejects the insert with `stated_contradiction_detected` — nothing is written. Tier 1 is the fast path; Tier 2 is the safety net: a contradictory insert can no longer bypass stated-wins merely because classification differs. Ambiguous detector output fails closed (rejects) — only a clean `compatible`/`no_contradiction` verdict admits. New tests T-C66 (non-overlapping topic labels: "unemployed and looking" vs stated "works at Samsonite" → rejected by Tier 2) and T-C67 (slot-mismatch: contradictory intention vs stated desire → rejected; compatible cross-slot insert still accepted). Both assert the conflicting row is *absent*, not merely that the stated row is intact. Header, §6.2 (INV-C-2 enforcement reference), and test-plan count updated.

- **Revision 4 (2026-10-19):** Addresses the gauntlet round-3 review (4 P1 findings; the P0 is closed). **P1-1:** decision-table cells 7 and 7b rewritten with one consistent contract each — cell 7: W3 invalidates the non-stated challenger via the boundary (`InvalidateEntry`, `reason='stated_conflict'`), with explicit subcases for not-yet-written proposals (blocked by the insertion precondition) and stated-vs-stated (no mutation); cell 7b: W3 observes the authorized path's result, invalidating the non-stated incumbent only as a race-window cleanup under an explicit precondition. Every other cell audited — cells 5/5b were already consistent (explicit subcases, W3 never mutates). **P1-2:** stated-coverage is a mandatory insertion precondition inside the boundary transaction — same slot + topic overlap + temporal currency → reject with `stated_covers`; the invariant is "no W3 belief contradicts a current stated belief," not just "stated rows are never touched" (§6.1 step 3; T-C64 asserts the conflicting row is absent, not just that the stated row is intact). **P1-3:** correction lineage inherits the enclosing conversation's lineage unless the correction introduces a new subject or new slot (`lineage_basis` recorded for audit; conservative default is inherit) (§4.3; T-C65). **P1-4:** the stated-row invariant is defined **once** in §6.1 (protected columns vs the `SetReviewFlag` review-metadata exception); §3.4 and INV-C-2 reference that definition instead of restating it. The integrity hash covers exactly the protected columns; review fields are excluded by definition (verified by the boundary's type-level enforcement, not the hash).

- **Revision 3 (2026-10-19):** Addresses the gauntlet round-2 review (1 P0 with 3 sub-problems + 5 P1). **P0-A:** stated-integrity snapshot hashes the complete protected column set (`id, slot, content, evidence_ids, confidence, valid_at, invalid_at, invalidated_by, replaced_by, updated_at`) — content changes without `updated_at` movement are detected (§6.1; T-C57). **P0-B:** stated protection is a per-mutation precondition inside the write transaction; the hash backstop is explicitly defense-in-depth, and a mismatch triggers a defined incident procedure (alert + `w3_frozen` + manual review + explicit unfreeze, new §9.4; T-C58). **P0-C:** W2 sweep SQL writers must route through `applyConsolidationMutation()` — required code change, not a design note (§1.2). **P0-D:** `SetReviewFlag` is explicitly the sole stated-row operation in the closed mutation union, scoped to the two flag columns only (§6.1, §6.4). **P1-1:** unknown-lineage episodes are ineligible to establish independence; exact lineage grain per capture type (§4.3, §4.5; T-C59). **P1-2:** decision table completed — symmetric stated-challenger cells (5b, 7b), inline outcomes for cells 6/8 (no delegation), tie-breakers explicitly cannot promote `unresolved`, node-vs-episode action contract (cell 10) (§5.3; T-C60). **P1-3:** evidence state stored as canonical JSON set + fingerprint hash; terminal vs retryable outcomes (§8.3; T-C63). **P1-4:** `WithdrawEvidence` added to the closed mutation union; forget propagation is atomic (§6.1, §7.3; T-C61). **P1-5:** `report_ref` dedup — same ref ignored, new ref creates `reopens_id`-linked record; uniqueness on (pair, report_ref) (§5.1; T-C62). Schema: `contradictions.reopens_id`, `space_meta.w3_frozen`, updated uniqueness indexes; `lineage_key` backfill is NULL-not-singleton (§8).
- **Revision 2 (2026-10-19):** Addresses the W3 architecture gauntlet (3 P0, 6 P1, 3 P2). P0-1: single guarded write boundary (§6.1) + run-level stated-integrity check + W2 hardening prerequisites (§1.2); P0-2: typed `contradictions` table with two-sided identity, formal state machine, domain separation (§5); P0-3: exact deployment baseline with commit SHAs (§1.1). P1-1: lineage-key evidence independence (§4.3); P1-2: complete decision table (§5.3); P1-3: atomic `UNIQUE(space_id, window_date)` claim + fencing + DST semantics (§3.1); P1-4: work-item idempotency across run IDs, mutation+ledger atomicity (§8.3, §9.2); P1-5: `access_stats` table replaces `last_accessed_at` columns (§7.2, §8.5); P1-6: sweep eligibility matrix + review-flag lifecycle (§6.3, §6.4). P2-1: semantic routing with fail-closed abstention (§4.1); P2-2: exact `evidence_strength` formula (§4.4); P2-3: inquiry lifecycle (§5.5). Test plan expanded to ~55 tests. Legacy contradiction backlog retired as `legacy_moot`.
- **Draft v1 (2026-10-19):** Initial design. Grounded in: `index.ts` autonomy tick (5-min, paid ceiling, dream cycle), `dreamCycle.ts` (existing consolidation — W3 is a sibling, not a replacement), `temporal.ts` `logPotentialContradiction()` (`result='pending_w3'`), `userModel.ts` `sweepStaleEmotions()`/`sweepWithdrawnEvidence()` (explicitly W3-scheduled), `space_meta` (quiet hours, timezone, `last_dream_date` pattern), W2's confidence ceilings and evidence rules.
