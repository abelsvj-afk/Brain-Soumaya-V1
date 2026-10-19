# W2 Design — Episodes + User Model

**Status:** Revision 4 (addressing ChatGPT's round 3 review of Revision 3)
**Depends on:** W1 (temporal truth) — Revision 7
**Scope:** Episodic memory (C1) + Theory of Mind user model (C3) from the wisdom-layer research
**Surfaces:** Shared backend (`packages/server`) — web app and Telegram both benefit

**Revision history:**
- Rev 1 (commit `dd64a82`, branch `w2-design`): initial draft — Tulving episodes, 6-slot user model, anti-weak-inference rules, knowledge check.
- Rev 2 (commit `7294dfa`): addressed round 1 review — 5 P0 blockers (B1–B5), 5 P1 items (B6–B10), 5 additional gaps (11–15), and applied the 5 open-question decisions. Structural changes: episodes split into immutable `episodes` + versioned `episode_enrichments`; `user_model` gains stable `id`, `replaced_by`, `evidence_strength`; new `forget_requests` table and forget/deletion contract; recall-oriented knowledge-check candidate generation; explicit enrichment lifecycle; separated confidence/evidence/truth semantics.
- Rev 3 (commit `38a2940`): addressed round 2 review — P0 (B1: redaction exception + versioned linking; B2: lease reclaim with fencing; B3: topic normalization contract + uncertainty boundary), P1 (B4: atomic quota ledger; B5: forget-state alignment; B6: application-enforced references; B7: provenance coverage validation; B8: migration constraint equivalence), and the correction-targeting confidence note. No structural redesign — all changes were targeted contract tightenings.
- Rev 4 (this document): addresses round 3 review — P0 (B1: forget/worker race with fence revocation + `forgotten_at` in commit predicate; B2: `topic_labels` column in `user_model` schema; B3: corrected adversarial tests — topic overlap is candidate-only, entity identity required for contradiction; B4: content-free forget audit with `target_query` nulling), P1 (B5: `not_reported` label reconciliation; B6: retry off-by-one resolved; B7: space-timezone quota dates; B8: constraints exempt from candidate cap; B9: canonical tombstone format). Test plan expanded with race, audit, and tombstone acceptance tests exercising actual transactional predicates.

---

## 1. Problem statement

W1 gave Soumaya *temporal truth*: facts carry when they were true, when they were recorded, and when they were superseded. The digest can no longer surface "in between jobs" as current.

But W1 only fixes *what is true*. It does not fix *what it was like*, *what he knows*, or *what the bot believes about him*. Three concrete failures W1 cannot prevent:

1. **No texture.** "Started Samsonite job Oct 16" is a semantic fact. The episode — the 4:35 AM alarm, the 90-minute bus ride, first-day nerves, what it meant (first steady paycheck in months) — is lost. When the user says "remember when I started the job," there is nothing to remember *with*.
2. **No model of his mind.** The digest once said "you're in between jobs" to an employed man. W1's temporal filter would now exclude the stale fact — but the deeper failure was the bot having *no representation* that the user *knows* he has a job and would read that line as evidence the bot doesn't know him. Truth-checking facts is not the same as understanding the person reading them.
3. **No provenance for inference.** When the bot eventually says "you seem to prefer X," there must be an answer to "why do you think that?" that points at evidence, not vibes. The `user_persona` text blob cannot do this — it's a static sketch with no confidence, no provenance, no correction path.

W2 builds two stores: **episodes** (what happened, with texture) and the **user model** (what the system believes about the user, with evidence and confidence). Both follow the W1 principle ("a memory can stop being current without its history being rewritten") — with the explicit, user-controlled exceptions defined in §3.7 (forget/deletion contract).

---

## 2. Design principles

These are hard constraints, not aspirations. Violating any of them is a design-review blocker. Each has a named invariant and an enforcement point (code location + test).

1. **Evidence is first-class.** Every user-model entry carries its evidence (typed references to episodes/nodes/corrections), its origin (`stated` | `inferred` | `consolidated`), its confidence, and its evidence strength. An entry without evidence is not stored.
   - *Invariant INV-EV-1.* Enforcement: `updateUserModel()` / `recordStated()` reject empty `evidence_ids` at write time. Test T-U3.

2. **Stated beats inferred.** On conflict, a stated entry always wins. Inference is evidence, never authority.
   - *Invariant INV-ST-1.* Enforcement: `recordStated()` invalidates contradicted inferred/consolidated entries in the same slot before inserting. Test T-U2.

3. **No promotion by repetition of the same weak signal.** An inferred entry's confidence rises only from *independent* corroborating evidence — different episodes, different days, different signal types. Seeing the same pattern in the same conversation three times is one observation, not three.
   - *Invariant INV-IND-1.* Enforcement: `assessIndependence()` in the W3 consolidation path (W2 defines the function signature and the rule; W3 implements the job). Test T-U5.

4. **Correctable by construction.** Every user-model entry is inspectable and correctable. A user correction writes a `stated` entry at maximum confidence and invalidates the contradicted entry. Corrections never delete — they supersede, per W1 — except under the explicit forget contract (§3.7).
   - *Invariant INV-CORR-1.* Enforcement: `correctUserModel()` sets `invalid_at` + `replaced_by`, never DELETE. Test T-U6.

5. **First-order theory of mind only.** The model represents what the user believes/wants/knows/feels *about the world*. It does NOT model what the user believes about the bot's beliefs (second-order), or any deeper nesting. The schema has no representation for nested mental states; the write API rejects content that asserts them.
   - *Invariant INV-TOM-1.* Enforcement: `recordStated()` / `updateUserModel()` reject content matching higher-order patterns ("he thinks I think…", "she believes he wants…"). Test T-U11.

6. **Episodes are append-only at capture; enrichment is versioned, never destructive.** The captured event (§3.2) is immutable. Interpretation lives in separate, versioned enrichment records (§3.3) that can be superseded but never rewrite the capture. The *sole* exception is the user-authorized redaction defined in §3.7: an approved forget request may replace content fields with a tombstone marker — never with arbitrary edits, and never on the system's own initiative.
   - *Invariant INV-EP-1.* Enforcement: no UPDATE path exists for `episodes` capture columns in any module except `applyForgetRequest()` (§3.7), which requires a `forget_requests` row with `status='approved'` and may only write the tombstone constant. Test T-E4 (ordinary updates impossible), T-E4b (redaction path).

7. **No model-driven deletion, anywhere.** Consolidation may propose, decay may demote, but nothing in W2 deletes rows on the model's own initiative. The *only* deletion/redaction path is an explicit user forget request, governed by §3.7. (Resolves B2.)
   - *Invariant INV-DEL-1.* Enforcement: no DELETE statements in W2 modules except `applyForgetRequest()` (§3.7), which requires a `forget_requests` row with `status='approved'` and `requested_by='user'`. Test T-F1.

8. **Hot path stays cheap and deterministic.** Episode *capture* on the hot path is template-based and free. LLM enrichment is significance-gated and runs in background. The user model is never written by the hot path — only by explicit user statements (via the stated-write trigger, §4.8) and the W3 consolidation job.

9. **Confidence, evidence quality, and truth are three separate dimensions.** (Resolves B8.) `confidence` = P(the user currently holds this mental state | the evidence). `evidence_strength` = quality/diversity of the evidence (computed, 0..1). Neither measures whether the belief's *content* is objectively true — truth-tracking is explicitly out of scope for W2. A 0.95-confidence belief entry means "we are 0.95 confident he believes X," never "X is 0.95 true."

10. **Enrichment never fabricates experience.** (Resolves B5.) Every enriched field carries a provenance label (`direct_quote` | `explicit` | `inferred` | `generated` | `not_reported`). `not_reported` is always a valid value. Generated narrative is connective tissue, never invented experience.
    - *Invariant INV-ENRICH-1.* Enforcement: `enrichEpisode()` validates provenance labels at write time; `generated` fields are quarantined from the user-model evidence pipeline. Tests T-E12, T-E13.

---

## 3. Episodes

### 3.1 What an episode is (and isn't)

An **episode** is a structured record of a *lived event* in Tulving's sense: bound to time, place, participants, and felt sense. It is the raw material from which semantic facts are distilled — not the facts themselves.

**Not episodes:**
- `nodes` — semantic facts ("started Samsonite job Oct 16"). Nodes are the *distillation*; episodes are the *source*.
- `daily_logs` — end-of-day summaries. A daily log is a *synthesis across* episodes; an episode is a *single event*.
- `lore` — galaxy narrative chapters. Lore is *storytelling about* the galaxy; episodes are *records of* experience.
- `working_memory` — ephemeral thought-motes. Working memory is *what the system is thinking now* (decaying, promotable); episodes are *what happened* (permanent, append-only at capture).
- `agent_logs` — operational audit trail. Agent logs record *that an action happened*; episodes record *what it was like*. (W5's agent autobiography will bridge these.)

**The relationship:** one episode may distill into zero, one, or many nodes. One node may cite multiple episodes as provenance. The link is stored on the *enrichment record* (`source_node_ids`), not the immutable capture row (B1).

### 3.2 Schema: `episodes` (immutable capture)

```sql
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL DEFAULT 'legacy',

  -- What happened (template-generated at capture, NEVER modified after)
  kind TEXT NOT NULL CHECK (kind IN (
    'conversation','agent_action','job_run','digest_sent',
    'proactive_msg','correction','milestone','session'
  )),
  summary TEXT NOT NULL,           -- 1-2 sentence template narrative, first-person as the user

  -- Time (W1 temporal conventions: canonical ISO 8601 UTC)
  occurred_at TEXT NOT NULL,       -- when it happened in the world
  recorded_at TEXT NOT NULL,       -- when the system recorded it (immutable, cf. W1)

  -- Correction linkage (append-only pattern, cf. W1 corrections table)
  corrects_episode_id INTEGER,     -- NULL normally; set when this episode corrects a misrecorded one

  -- Enrichment lifecycle pointer (B6, B2 Rev 3)
  enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending','processing','completed','failed_retryable','failed_permanent')),
  enrichment_attempts INTEGER NOT NULL DEFAULT 0,
  enrichment_lease TEXT,           -- ISO timestamp: worker claim expiry (NULL = unclaimed)
  enrichment_fence TEXT,           -- fencing token (random hex per claim); stale workers
                                   -- cannot commit after reclaim (B2, Rev 3)
  enriched_at TEXT,                -- when enrichment completed (NULL until completed)

  -- Forget handling (B2, §3.7)
  forgotten_at TEXT,               -- NULL normally; set when a user forget request redacts this episode

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_episodes_space_time ON episodes(space_id, occurred_at);
CREATE INDEX idx_episodes_kind ON episodes(space_id, kind);
CREATE INDEX idx_episodes_corrects ON episodes(corrects_episode_id);
CREATE INDEX idx_episodes_enrichment ON episodes(enrichment_status, enrichment_lease)
  WHERE enrichment_status IN ('pending','failed_retryable');
```

**Immutable columns** (no UPDATE path exists in code; enforced by module API, tested T-E4): `id`, `space_id`, `kind`, `summary`, `occurred_at`, `recorded_at`, `corrects_episode_id`, `created_at`.

**Mutable columns** (lifecycle only, never content): `enrichment_status`, `enrichment_attempts`, `enrichment_lease`, `enrichment_fence`, `enriched_at`, `forgotten_at`. These track *processing state*, not *event content*. The event content itself is immutable.

**The redaction exception (B1, Rev 3).** The immutability contract has exactly one exception, and it is narrow:

- **Trigger:** only `applyForgetRequest()` executing an *approved* user forget request (§3.7). No other code path — no enrichment, no consolidation, no hot path — may modify capture columns. Ever.
- **Permitted changes:** `summary` → the tombstone constant `"[redacted per forget request #N]"` (N = the request id; the canonical format defined in §3.7, B9 Rev 4); `forgotten_at` → now; `enrichment_fence` → fresh random token (revokes any in-flight worker claim, B1 Rev 4); `enrichment_lease` → NULL. Nothing else. The tombstone is a fixed string, not a parameter — there is no "edit the summary" capability, only "replace with tombstone."
- **What is NOT permitted:** partial redaction, rewriting the summary to something else, redacting `occurred_at`/`recorded_at`/`kind` (the *fact that an event occurred at a time* is structural metadata, not content — the timeline retains "something happened here" without retaining *what*).
- **Audit without content:** the `forget_requests` row records `target_episode_id`, `scope_episode_ids`, `scope_node_ids`, `scope_topics`, `status` transitions, and timestamps — but never the redacted content itself, and never the original `target_query` text (nulled at approval, B4 Rev 4). The audit proves *that* a redaction occurred and *which* request authorized it; it cannot be used to recover *what* was forgotten. `agent_logs` records `action='forget_applied'` with `{request_id, episode_ids}` only.
- **Enforcement:** `applyForgetRequest()` is the only function with UPDATE privileges on `episodes.summary`. Code review gate: any PR touching `episodes` UPDATE statements outside `applyForgetRequest()` is rejected. Test T-E4b verifies the tombstone constant, the NULL embedding, and that the audit contains no content substrings.

**Why no `valid_to`/`superseded_at` on episodes:** an episode is a record *of* an event, not a claim *about* the world. The event happened when it happened (`occurred_at`); the system learned about it when it recorded it (`recorded_at`). There is no "stopped being true" for a lived event — October 16 happened. If the *record* is wrong, the correction pattern (append + `corrects_episode_id` link) preserves both the error and its correction, exactly as W1's `corrections` table does for facts.

### 3.3 Schema: `episode_enrichments` (versioned interpretation)

```sql
CREATE TABLE episode_enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,     -- application-enforced reference → episodes.id (B6, Rev 3; see §8.5)
  space_id TEXT NOT NULL DEFAULT 'legacy',
  version INTEGER NOT NULL,        -- 1, 2, 3... (re-enrichment creates a new version)

  -- Interpretive content (ALL of this is interpretation, not capture)
  detail TEXT,                     -- 2-4 sentences of texture; NULL = not_reported
  emotion TEXT CHECK (emotion IN (
    'anxious','relieved','proud','frustrated','hopeful','overwhelmed',
    'grateful','lonely','determined','ashamed','content','angry',
    'sad','excited','neutral'
  )),                              -- NULL = not_reported (valid, never forced)
  emotional_weight REAL CHECK (emotional_weight IS NULL OR (emotional_weight >= -1 AND emotional_weight <= 1)),
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),

  -- Structured extraction
  participants TEXT NOT NULL DEFAULT '[]',  -- JSON array, validated shape (§3.8)
  place TEXT,                      -- free text; NULL = not_reported

  -- Provenance: which source records this interpretation was distilled from
  source_node_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of node ids, validated (§3.8)
  source_transcript_ref TEXT,      -- opaque pointer; NULL if unavailable

  -- Field-level provenance labels (B5, B7 Rev 3) — JSON object mapping field → label.
  -- Labels: 'direct_quote' | 'explicit' | 'inferred' | 'generated' | 'not_reported'.
  -- Example: {"detail": "generated", "emotion": "explicit", "place": "not_reported"}
  -- B7: coverage is MANDATORY — every populated interpretive field must have a
  -- label. See "Provenance coverage validation" below.
  field_provenance TEXT NOT NULL DEFAULT '{}',

  -- Retrieval
  embedding BLOB,                  -- sqlite-vec embedding of summary + detail (NULL until computed)

  -- Version lifecycle
  superseded_by INTEGER,           -- application-enforced reference → episode_enrichments.id (newer version); NULL = current (B6, Rev 3; see §8.5)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  UNIQUE (episode_id, version)
);
CREATE INDEX idx_enrichments_episode ON episode_enrichments(episode_id, version);
CREATE INDEX idx_enrichments_current ON episode_enrichments(episode_id) WHERE superseded_by IS NULL;
```

**Versioning rules:**
- The first enrichment creates `version = 1`. Re-enrichment (model upgrade, correction of the interpretation) creates `version = N+1` and sets the old row's `superseded_by`.
- Readers use `WHERE superseded_by IS NULL` (current interpretation). History readers can walk the version chain.
- `linkEpisodeToNodes()` (B1, Rev 3): provenance-link updates **always create a new version** — never mutate an existing one. If a current version exists, the function creates `version = N+1` copying all fields from the current version with the merged `source_node_ids`, then sets the old version's `superseded_by`. If no enrichment record exists yet, it creates a minimal `version = 1` record with only `source_node_ids` populated (all interpretive fields NULL / `not_reported`). The `field_provenance` for `source_node_ids` is always `'explicit'` (it is a mechanical link, never an interpretation). This keeps the invariant "re-enrichment creates a new version and supersedes the old" exceptionless — there is no "append to current version" path.
- Rationale for versioning over in-place append: `source_node_ids` is *evidence linkage*, and evidence linkage is part of the interpretation. Silently growing it would let a later-added link retroactively change what an earlier interpretation claimed as its sources. Versioning preserves the audit trail: "version 2 added nodes 45, 46 as sources."

**Field provenance semantics (B5):**

| Label | Meaning | May feed user-model evidence? |
|---|---|---|
| `direct_quote` | Verbatim user words from the interaction | Yes |
| `explicit` | User stated it plainly (paraphrase-safe) | Yes |
| `inferred` | System interpretation from signals | Only as `inferred`-origin entries (capped 0.69) |
| `generated` | Narrative connective tissue (transitions, scene-setting) | **No** — quarantined from evidence pipeline |
| `not_reported` | The field was not present in the source interaction | N/A (field is NULL) |

**Provenance coverage validation (B7, Rev 3).** The `{}` default is valid *only* when no interpretive fields are populated (the minimal version-1 linking record from `linkEpisodeToNodes()`). Otherwise:

- **Completeness:** every populated field must have a label. Populated = `detail` non-NULL, `emotion` non-NULL, `emotional_weight` non-NULL, `importance` ≠ 0.5 (the default), `participants` non-empty array, `place` non-NULL, `source_node_ids` non-empty array, `embedding` non-NULL. Missing label for a populated field → write rejected with `ValidationError {field, reason: 'missing_provenance'}`.
- **Allowed label per field** (value+label combinations; B5 Rev 4):

  | Field | Allowed labels | NULL permitted? |
  |---|---|-----------------|
  | `detail` | `direct_quote`, `explicit`, `generated`, `not_reported` | Yes — NULL + `not_reported` = "not reported, valid" |
  | `emotion` | `direct_quote`, `explicit`, `inferred`, `not_reported` | Yes — NULL + `not_reported` = "not reported, valid" |
  | `emotional_weight` | `explicit`, `inferred`, `not_reported` | Yes — NULL + `not_reported` |
  | `importance` | `inferred` (always a judgment call) | No — has a 0.5 default; the default does not require a label (not "populated" per the completeness rule) |
  | `participants` | `explicit`, `inferred`, `not_reported` | Yes — empty array + `not_reported` |
  | `place` | `explicit`, `inferred`, `not_reported` | Yes — NULL + `not_reported` |
  | `source_node_ids` | `explicit` (mechanical link, never interpretation) | Yes — empty array is valid without a label (mechanical, not interpretive) |
  | `embedding` | `explicit` (deterministic computation, not interpretation) | Yes — NULL before computation; no label required (not interpretive) |

  **NULL + `not_reported` semantics (B5):** a NULL (or empty) field with a `not_reported` label is a *complete, valid* state meaning "the source interaction did not contain this information." It is distinct from a NULL field *without* a label, which means "not yet classified" and is a validation error (except for the minimal linking record where `{}` is permitted). T-E13 tests exactly this: enrichment of a terse interaction leaves `detail`/`emotion` NULL *with* `not_reported` labels — valid, no invented content, no validation error.

  A label outside the field's allowed set → write rejected (`invalid_provenance_label`). An unknown field name in the map → write rejected (`unknown_provenance_field`).

- **Fail-closed evidence selector:** `evidenceSafeFields()` returns only fields whose label is in the evidence-eligible set (`direct_quote`, `explicit`, and `inferred` only for `inferred`-origin entries). If `field_provenance` is malformed JSON, missing a label for a populated field, or contains an unknown label, the selector **excludes the field** (fail-closed) and logs `provenance_malformed` with `{enrichment_id, field}`. It never includes a field "on the assumption it's fine."
- **Enforcement point:** `enrichEpisode()` and `linkEpisodeToNodes()` both call `validateProvenance()` before writing. Tests T-E15 (missing label → rejected), T-E16 (malformed provenance → field excluded from evidence).

**Formal invariants:**
- *INV-ENRICH-1:* No `generated`-labeled content may appear in `evidence_ids` of any user-model entry. Enforcement: `updateUserModel()` / `recordStated()` validate evidence provenance; enrichment records expose `evidenceSafeFields()`. Test T-E12.
- *INV-ENRICH-2:* `detail`, `emotion`, `place` may be NULL. NULL means "not reported," never "not yet enriched." The enrichment worker writes explicit `not_reported` provenance rather than leaving fields ambiguously empty. Test T-E13.
- *INV-ENRICH-3:* Enrichment must not invent sensory details, feelings, motivations, or meaning absent from the source interaction. Enforcement: the enrichment prompt includes the verbatim interaction excerpt and a "grounding checklist"; the application validates that `direct_quote` fields are substrings of the source. Test T-E14 (adversarial: enrichment of a terse interaction must not produce vivid invented detail).
- *INV-ENRICH-4 (B7, Rev 3):* Provenance coverage is complete — no populated interpretive field lacks a valid label. Enforcement: `validateProvenance()` at write time; `evidenceSafeFields()` fails closed at read time. Tests T-E15, T-E16.

### 3.4 Episode kinds

| Kind | Trigger | Example |
|---|---|---|
| `conversation` | A chat session (web or Telegram) with substantive content | "Talked through the CNA fee plan; he's anxious about the money order timing" |
| `agent_action` | The agent took a notable action on his behalf | "Sent the bill-risk alert for the CNA fee" |
| `job_run` | A background job ran (digest, consolidation, router tick with findings) | "Nightly digest sent with 4 sections" |
| `digest_sent` | A digest was delivered (subset of job_run, kept distinct for analytics) | — |
| `proactive_msg` | The bot initiated contact | "Sent the morning check-in nudge" |
| `correction` | The user corrected the bot or a fact | "He corrected the bus route: it's the 8, not the 3" |
| `milestone` | A first-time or significant life event detected | "First day at Samsonite — first steady paycheck in months" |
| `session` | App session with notable interaction | — |

The `kind` column is a closed vocabulary enforced by CHECK constraint in the fresh schema and by application validation in the migration path (same pattern as W1's reason codes).

**Deferred to W7** (per open-question decision): galaxy-navigation and routine-view `session` episodes. W2 captures substantive interactions through the shared agent loop only — conversations, agent actions, job runs, digests, proactive messages, corrections, milestones. UI-navigation events have no W2 retrieval use case.

### 3.5 Write paths: capture (hot) vs enrichment (background)

**Capture (hot path, synchronous, free).** After every significant interaction, `captureEpisode()` writes a row with:
- `summary`: template-generated from the interaction type (no LLM). E.g., for a conversation: first user message + tool calls made + outcome, truncated.
- `occurred_at` / `recorded_at`: `new Date().toISOString()`.
- `enrichment_status`: `'pending'`.
- All interpretive columns: absent (they live in `episode_enrichments`, not here).

The capture path does **zero LLM calls and zero embedding calls**. It is a single INSERT. It cannot fail the interaction — on any error, it logs and continues (episodes are observability-grade, not transaction-critical).

**What capture checks first (B2, B5, B9 Rev 4):** the forget-list. If the interaction's content matches the scope of any forget request with `status IN ('approved', 'applied')` (§3.7), capture writes a tombstone row (`summary`: `"[redacted per forget request #N]"` — the canonical format with the matching request's ID, §3.7; `forgotten_at` set) rather than the content. Tombstoned episodes are never eligible for enrichment (`claimEnrichment()` filters `forgotten_at IS NULL`) or search indexing (no FTS/vec rows are written for tombstones). The tombstone preserves the *fact that an interaction occurred* (for timeline continuity) without preserving its content. `pending` requests do not block capture (scope unconfirmed); `rejected` requests do not block.

**Significance filter (hot path, heuristic, free).** Determines whether the episode qualifies for background enrichment. An episode qualifies if ANY of:

1. **First-time signal:** a new node was created, a new person/place/topic appeared (not in the last 30 days of episodes), or a new tool was used for the first time.
2. **Emotional spike:** the interaction carried `emotional_weight` with |w| > 0.5 (from node writes, explicit user language, or correction signals).
3. **Decision:** an approval was confirmed or denied, a choice was selected, or an inquiry was answered.
4. **Correction:** any correction signal (the strongest single predictor of "this mattered").
5. **Explicit life content:** the user stated something about their life (job, money, family, health, plans) — detected by the existing extraction prompt's entity output, not a new classifier.

The filter is a pure function `isSignificant(interaction) → boolean` with unit tests. Episodes failing the filter stay at `enrichment_status = 'pending'` but are deprioritized (the worker processes significant episodes first; insignificant ones are enriched only if budget remains). Nothing is dropped — the timeline feature wants completeness, and a cheap template row is better than nothing.

**Enrichment (background, LLM-gated) — explicit lifecycle (B6).**

States: `pending` → `processing` → `completed` | `failed_retryable` | `failed_permanent`.

```
Worker claim (atomic, cf. Phase 2 outbox pattern) — B2 Rev 3: expired 'processing'
claims are reclaimable, with fencing so a stale worker cannot commit after reclaim.

  -- Step 1: atomically reserve quota (B4, Rev 3 — see below).
  -- Step 2: claim one episode:
  UPDATE episodes
  SET enrichment_status = 'processing',
      enrichment_lease = <now + 10 min>,
      enrichment_fence = <random 16-byte hex>,   -- new fencing token per claim
      enrichment_attempts = enrichment_attempts + 1
  WHERE id = (
    SELECT id FROM episodes
    WHERE space_id = ?
      AND forgotten_at IS NULL           -- B1 Rev 4: tombstoned episodes are never
                                         -- eligible for enrichment (see §3.7)
      AND (
        enrichment_status IN ('pending', 'failed_retryable')
        OR (
          enrichment_status = 'processing'
          AND enrichment_lease IS NOT NULL
          AND enrichment_lease < <now>          -- lease expired: crashed worker
        )
      )
      AND (enrichment_lease IS NULL OR enrichment_lease < <now>)
    ORDER BY
      CASE enrichment_status
        WHEN 'pending' THEN 0                  -- fresh work first
        WHEN 'failed_retryable' THEN 1
        WHEN 'processing' THEN 2               -- reclaimed crashed work last
      END,
      occurred_at DESC
    LIMIT 1
  )
  RETURNING id, enrichment_fence;
```

- **Reclaim correctness (B2):** the `OR` branch matches `processing` rows whose lease has expired — the exact state a crashed worker leaves behind. The old query's `IN ('pending','failed_retryable')` predicate excluded these; the new query does not. The status predicate and the lease predicate are both in the WHERE clause of a single atomic UPDATE — no TOCTOU.
- **Fencing (B2):** every claim generates a fresh `enrichment_fence` token. The worker's commit transaction is:
  ```sql
  -- Commit (in the same transaction as the enrichment INSERT):
  -- B1 Rev 4: forgotten_at IS NULL is a hard commit requirement. A worker
  -- whose episode was forgotten (by any ordering) cannot commit.
  UPDATE episodes
  SET enrichment_status = 'completed',
      enriched_at = <now>,
      enrichment_lease = NULL
  WHERE id = ? AND enrichment_fence = <my token> AND enrichment_status = 'processing'
    AND forgotten_at IS NULL;
  -- Then check changes(): if 0 rows affected → another worker reclaimed this
  -- episode, or it was forgotten → ABORT the transaction, discard
  -- the enrichment work, log 'enrichment_commit_rejected' with {episode_id, reason}.
  -- The stale worker's enrichment record is never written. No partial state,
  -- no double-enrichment, no resurrection of forgotten content.
  ```
  A crashed worker that wakes up after its lease expired and tries to commit will find its fence token no longer matches (the reclaiming worker overwrote it) — the commit affects 0 rows and the transaction aborts. This is the standard fencing-token pattern: the token, not the lease timestamp, is the authority on who owns the work.
- **Retry accounting (B2, B6 Rev 4):** `enrichment_attempts` increments on every claim (including reclaims). **Exactly three attempts are allowed.** At claim time, after incrementing, if `enrichment_attempts > 3` the worker instead transitions the row to `failed_permanent` (no LLM call wasted on the fourth attempt):
  ```sql
  -- Inside the claim transaction, after the UPDATE that increments attempts:
  -- if the claimed row now has enrichment_attempts > 3:
  UPDATE episodes SET enrichment_status = 'failed_permanent',
      enrichment_lease = NULL WHERE id = ?;
  -- Log 'enrichment_failed_permanent' with {episode_id, attempts}. Surfaced in
  -- diagnostics; never retried automatically. A human or W3 can reset to
  -- 'pending' (resets attempts to 0) if the failure cause is fixed.
  ```
  The predicate is `> 3` everywhere — prose, SQL, and tests agree. Attempt 1, 2, 3 each get one LLM call; the claim that would be attempt 4 goes permanent instead. (Test T-E8 asserts the exact sequence: claim→fail→claim→fail→claim→fail→claim→`failed_permanent`, no fourth LLM call.)
- **Crash safety:** if the worker crashes mid-enrichment, no partial enrichment record is visible — the enrichment INSERT and the episode status update happen in a single transaction. Either both commit (status → `completed`, `enriched_at` set) or neither does (lease expires, another worker reclaims with a new fence).
- **Original preserved on failure:** the capture row is never modified by enrichment. A failed enrichment leaves a pristine capture row and a `failed_retryable` status. Retries are idempotent: re-running enrichment for an episode with a `completed` status is a no-op (guarded by status check, tested T-E3).

- **Daily cap — atomic quota reservation (B4, Rev 3):** a `COUNT(*) ... < cap` check inside the claim UPDATE does not serialize across concurrent writers — two workers can both observe a count below the cap and both claim. Rev 3 uses a quota ledger:

  ```sql
  CREATE TABLE enrichment_quota (
    space_id TEXT NOT NULL,
    quota_date TEXT NOT NULL,       -- YYYY-MM-DD in the SPACE's local timezone (B7 Rev 4)
    claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed >= 0),
    PRIMARY KEY (space_id, quota_date)
  );
  ```

  **Timezone contract (B7, Rev 4):** `quota_date` is the space-local date, computed in application code — never via SQLite `date('now')` (which is UTC). The helper `spaceLocalDate(spaceId): string` reads `space_meta.timezone` (the Phase 2 notification-policy timezone, default `America/New_York`) and returns `YYYY-MM-DD` in that zone. The reservation and refund statements take it as a bound parameter:

  **Claim flow (single transaction):**
  ```sql
  BEGIN IMMEDIATE;
  -- spaceLocalDate(spaceId) computed in TS before the transaction.
  -- Step 1: atomically reserve one quota unit. The WHERE clause makes this a
  -- check-and-increment in a single statement — SQLite serializes writers, so
  -- two concurrent workers cannot both succeed when one unit remains.
  INSERT INTO enrichment_quota (space_id, quota_date, claimed)
  VALUES (?, ?, 1)                              -- (?, spaceLocalDate, 1)
  ON CONFLICT (space_id, quota_date) DO UPDATE
    SET claimed = claimed + 1
    WHERE claimed < <daily_cap>
  RETURNING claimed;
  -- If 0 rows returned → cap exhausted → ROLLBACK, return null (no episode claimed).
  -- Step 2: claim one episode (the UPDATE ... RETURNING above).
  -- If Step 2 claims nothing (no claimable episodes) → refund the reservation:
  UPDATE enrichment_quota SET claimed = claimed - 1
  WHERE space_id = ? AND quota_date = ?;        -- (?, spaceLocalDate)
  COMMIT;
  ```

  `space_meta.episode_enrich_daily_cap` (default 20) remains the tunable. The ledger is the enforcement mechanism and the source of truth (no separate `used_today` counter to drift). Stale quota rows (old dates) are harmless — one row per space per day — and are cleaned by the W3 maintenance pass. (Test T-E9b: two simulated concurrent workers, cap=2, three episodes → exactly 2 claims succeed, third returns null.)

**Enrichment steps** (inside the transaction):
1. Generate `detail` with field-level grounding (B5): the prompt receives the verbatim interaction excerpt; each generated field is labeled per §3.3.
2. Assign `emotion` (controlled vocabulary or NULL), `emotional_weight`, `importance`.
3. Extract `participants` and `place` (validated shapes, §3.8).
4. Compute and store `embedding` (summary + detail).
5. Write `source_node_ids` for nodes created during the source interaction (via `linkEpisodeToNodes()`, which targets the enrichment record).

**Fuel discipline:** enrichment is the only LLM cost in W2's write path, bounded by the significance filter + daily cap. If the budget is hit, remaining episodes wait — never dropped, only delayed.

### 3.6 Read paths

**Episode retrieval** (`getEpisodes()` in `agent/episodic.ts`):
- **By recency:** `WHERE space_id = ? ORDER BY occurred_at DESC LIMIT n` — the timeline backend API (§3.9).
- **By similarity:** sqlite-vec KNN over enrichment embeddings + canonical scorer rerank — "remember when" queries.
- **By node provenance:** join through `episode_enrichments.source_node_ids` (SQLite JSON1 `json_each`) — "what experiences led to this fact?"
- **By kind:** filtered timelines ("show me all corrections").
- **Current interpretation:** all reads join the current enrichment version (`superseded_by IS NULL`); history reads can request a specific version.

**Canonical episode scorer (B10).** One scorer, used at Stage 2 after vector candidate generation (Stage 1: top-40 by cosine similarity):

```
score(e, q) = 0.40·relevance + 0.25·recency + 0.20·importance + 0.10·trust + 0.05·graph_degree
```

Normalized inputs (all 0..1):
- `relevance`: cosine similarity of query vector to episode embedding.
- `recency`: `0.5 ^ (days_since(occurred_at) / 7)` — 7-day half-life (episodes are texture, not reference).
- `importance`: the enrichment's `importance` column (0.5 default for unenriched).
- `trust`: fixed 1.0 for episodes (they're records, not claims — trust is not a meaningful axis).
- `graph_degree`: `min(1, len(source_node_ids) / 10)` — episodes that distilled into many facts are load-bearing.

This is the same composite form as W1's node scorer with per-kind parameters — one scorer contract, not two. (Rev 1's §3.6 `0.5/0.3/0.2` formula is retired.)

**What episodes are NOT used for:** "what is true now" queries. Those go to `nodes` (W1-filtered). Episodes answer "what happened," "when did we discuss X," "what was that like" — the mental-time-travel queries, not the knowing queries. This is the Tulving retrieval asymmetry, implemented as a routing rule in the agent loop's context builder.

### 3.7 Forget / deletion contract (B2)

**Precedence:** an explicit user forget request overrides the append-only default. The user is the ultimate authority over their own memory store. "No model-driven deletion" (principle 7) constrains the *system*; it does not constrain the *user*.

**Request flow:**
```sql
CREATE TABLE forget_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'user' CHECK (requested_by = 'user'),
  -- What to forget: one of these selectors must be set at creation
  target_episode_id INTEGER,       -- specific episode
  target_node_id INTEGER,          -- specific node (propagates to derived records)
  target_query TEXT,               -- free-text description ("everything about the trucking job")
                                   -- B4 Rev 4: set to NULL at approval time (see below).
                                   -- Never retained after scope confirmation.
  -- Durable scope representation (B5 Rev 3, B4 Rev 4): resolved at approval time.
  -- Capture-time matching uses these, never re-interprets target_query.
  scope_episode_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of episode ids in scope
  scope_node_ids TEXT NOT NULL DEFAULT '[]',     -- JSON array of node ids in scope
  -- B4 Rev 4: scope_topics replaces scope_keywords. Controlled topic labels
  -- (same vocabulary as §6.2) — coarse enough to be content-free, specific
  -- enough for capture-time matching. Raw keywords could leak sensitive terms;
  -- topic labels ("relationships", "employment") cannot reconstruct content.
  scope_topics TEXT NOT NULL DEFAULT '[]',       -- JSON array of controlled topic labels
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','applied','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  applied_at TEXT
);
```

**Scope resolution (at approval time, before `status='approved'`):**
1. If `target_episode_id` / `target_node_id` set: scope is those IDs (+ propagation targets per the table above).
2. If `target_query` set: the system resolves it to specific episode/node IDs via keyword + vector search, presents the list to the user, and the user confirms or edits. Only the confirmed IDs enter `scope_episode_ids` / `scope_node_ids`. `scope_topics` is assigned from the confirmed scope via the §6.2 topic mapper (controlled vocabulary — coarse labels, never raw sensitive terms).
3. **Content-free audit (B4, Rev 4):** at the moment scope is confirmed (the same transaction that sets `status='approved'`), `target_query` is set to **NULL**. The user's free-text description — which may itself contain the sensitive content to be forgotten — is never retained after confirmation. What remains: `scope_episode_ids`, `scope_node_ids` (IDs, not content), `scope_topics` (coarse controlled labels), timestamps, status transitions. The audit proves *that* a forget occurred, *when*, *by whom*, and *how many records* it covered — never *what* was forgotten.
4. **Scope changes after approval:** any narrowing or broadening requires re-confirmation — status returns to `pending`, scope is re-resolved, user re-approves. There is no "edit scope in place."

**Capture-time blocking rule (B5, Rev 3):** capture checks for forget requests with `status IN ('approved', 'applied')` — *both* states block, not just `applied`. Rationale: once the user has approved the scope, the intent to forget is established; content matching that scope must not be stored even if propagation hasn't run yet. `pending` does not block (scope unconfirmed — the user might reject). `rejected` does not block.

**Capture matching:** for each incoming interaction, capture checks:
- Would this interaction create nodes/episodes matching `scope_episode_ids` / `scope_node_ids` patterns? (Direct ID match — rare on hot path, cheap to check.)
- Do the interaction's topic labels (via the §6.2 topic mapper) overlap with any approved/applied request's `scope_topics`? (Topic overlap — the primary hot-path check. Coarse by design: it may over-match, which is safe — see ambiguous matches below.)
- If either matches → write tombstone instead of content, log `forget_capture_blocked` with `{request_id}` (no content in the log).

**Canonical tombstone format (B9, Rev 4):** one format, everywhere. Both capture-time blocks and completed forget operations write exactly:

```
[redacted per forget request #N]
```

where N is the `forget_requests.id`. The capture path uses the lowest matching request ID when multiple requests match (deterministic), and logs all matching IDs. There is no bare `"[redacted per forget request]"` variant — the request ID is always present, making every tombstone traceable to its authorizing request without revealing content.

**Ambiguous matches:** if topic overlap is weak (exactly one shared topic label, or the interaction's topic mapping was uncertain), capture tombstones *and* logs `forget_ambiguity` for user review. False tombstones are recoverable (the user can re-state the content after resolving the ambiguity); false captures of forgotten content are not. The bias is toward over-redaction at capture, with a review path.

**No content while awaiting propagation:** between `approved` and `applied`, capture tombstones per the rule above. The window is small (propagation runs promptly after approval), but the guarantee holds regardless of timing.

1. User invokes the `forget` skill (existing). A `forget_requests` row is created (`status='pending'`).
2. The user confirms scope (`status='approved'`). Scope confirmation is required — the system never expands a forget request beyond what was approved.
3. `applyForgetRequest()` executes propagation **in a single transaction** (the redaction exception to INV-EP-1, §3.2):

| Record | Action | Rationale |
|---|---|---|
| Target episode(s) | `summary` → tombstone constant `"[redacted per forget request #N]"` (N = request id); `forgotten_at` = now; `enrichment_fence` → fresh random token (revokes outstanding worker claims, B1 Rev 4); `enrichment_lease` → NULL. `occurred_at`, `recorded_at`, `kind` untouched. | Content removed; structural metadata retained. The fence rotation guarantees any in-flight worker's commit predicate fails even if it already passed the status check. The tombstone is a fixed string — no arbitrary edits permitted. |
| Enrichment records of target episodes | DELETE (all versions), including `embedding` | Interpretation of forgotten content has no standing |
| Embeddings (vec tables) | DELETE corresponding rows | Forgets must propagate to vector search |
| FTS entries | DELETE corresponding rows | Forgets must propagate to keyword search |
| User-model entries citing the forgotten records as **sole** evidence | `invalid_at` = now, `invalid_reason` = `'evidence_withdrawn'` | The entry's justification is gone; the claim is suspended, not deleted |
| User-model entries with **independent** remaining evidence | Kept; `evidence_ids` pruned of the forgotten refs | The claim survives on its other legs |
| `agent_logs` | Untouched (already content-free: IDs and action names only) | Audit integrity preserved |
| `forget_requests` row | `status='applied'`, `applied_at` set, `target_query` already NULL (nulled at approval, B4). Records scope IDs, scope topics, timestamps — **never the redacted content or the original query text**. | Permanent audit trail of *that* forgetting occurred, not *what* was forgotten |
| Nodes distilled from forgotten episodes | **Not** auto-deleted. Flagged for user review (surfaced as an inquiry: "this fact came from something you asked to forget — keep or remove?") | Deleting facts the user may still rely on is destructive; the user decides |

**Forget/worker race contract (B1, Rev 4).** Both transaction orderings are safe:

- **Ordering A (forget completes, then worker commits):** the worker holds fence token F1 from its claim. `applyForgetRequest()` rotates the fence to F2 and sets `forgotten_at`. The worker's commit predicate (`enrichment_fence = F1 AND forgotten_at IS NULL`) matches 0 rows → transaction aborts → no enrichment written, no embedding stored, nothing searchable recreated. The worker logs `enrichment_commit_rejected` with `{episode_id, reason: 'forgotten'}`.
- **Ordering B (worker commit in flight during forget):** SQLite serializes the two transactions (both use `BEGIN IMMEDIATE`). If the worker's commit lands first, the enrichment record exists when `applyForgetRequest()` runs — and the forget transaction DELETES it (enrichment records of target episodes are deleted in the same transaction). If forget lands first, the worker's commit fails per Ordering A. Either way, no enrichment of forgotten content survives. There is no interleaving in which a committed enrichment outlives the forget — the forget transaction is the linearizing point.

The commit predicate's `forgotten_at IS NULL` check is load-bearing, not belt-and-suspenders: the fence rotation alone would suffice for Ordering A, but the explicit forgotten check makes the invariant visible in the predicate itself and protects against any future code path that might bypass fence validation. (Test T-F4 exercises both orderings against the actual SQL.)

4. `status='applied'`, `applied_at` set. The request row itself is permanent (audit trail of what was forgotten and when).

**Limits (stated honestly):**
- Forgets apply to *this system's* stores. They do not reach backups, already-sent messages (Telegram/_digest history), or the user's own memory.
- Vector/FTS deletion is best-effort within the transaction; a crash mid-`applyForgetRequest` rolls back the entire transaction (atomicity guaranteed by the single-transaction design).
- `target_query` (free-text scope) is resolved to specific episode/node IDs *before* approval and listed for confirmation. The system never interprets scope silently.

**Capture-time precedence** (already in §3.5): if content matches the scope of a forget request with `status IN ('approved','applied')`, capture writes a tombstone instead of content. Both states block — the user's approved intent governs, not the propagation timing.

### 3.8 JSON field validation (gap 13)

`participants`, `source_node_ids`, `evidence_ids`, `field_provenance` are JSON TEXT. Every write validates:

```typescript
validateEpisodeRefs(spaceId, { participants, sourceNodeIds }): void
// - participants: array of non-empty strings, max 20, max 100 chars each
// - sourceNodeIds: array of integers; each must exist AND belong to spaceId
//   (SELECT id FROM nodes WHERE id = ? AND space_id = ?) — cross-space refs rejected
// - throws ValidationError on shape violation or cross-space reference

validateEvidenceRefs(spaceId, evidenceIds): void
// - each entry: {type: 'episode'|'node'|'correction'|'enrichment', id: number}
// - referenced row must exist and belong to spaceId
// - 'correction' type refs validate against the corrections table (W1)
```

**Stale evidence:** when a source record is corrected, superseded, or forgotten, evidence references are NOT deleted. Instead, `getUserModel()` annotates each entry with `evidence_status: 'ok' | 'stale' | 'withdrawn'` per reference (computed at read time by checking the referenced row's current state). A `stated` entry whose evidence is entirely `withdrawn` keeps its content (the user said it) but is flagged for review. An `inferred`/`consolidated` entry whose evidence is entirely `withdrawn` is auto-invalidated (`invalid_at` = now, reason `evidence_withdrawn`) — it has no standing without its evidence.

Tests: T-V1 (reject malformed JSON), T-V2 (reject cross-space node ref), T-V3 (stale evidence annotated, not deleted), T-V4 (withdrawn evidence invalidates inferred entry).

### 3.9 Timeline: backend API, not UI (gap 14)

"Timeline view" in the acceptance criteria means a **backend retrieval API**: `getEpisodes({ spaceId, before?, after?, kind?, limit, offset })` returning episodes in reverse-chronological order with their current enrichment. Pagination is cursor-based (`before` = ISO timestamp).

It does **not** mean a user-facing UI. No galaxy changes, no new pages, no W7 scope. If a future phase builds a timeline UI, it calls this API. The acceptance test asserts API behavior (ordering, pagination, kind filtering), not pixels.

---

## 4. User model

### 4.1 What the user model is (and isn't)

The **user model** is Soumaya's inspectable, evidence-backed representation of the user's mental life: what he believes, wants, intends, feels, knows, and what constrains him. It is first-order theory of mind made into data.

**Not the user model:**
- `user_persona` — the existing text blob. W2 does NOT delete or replace it. The blob becomes a *rendered view* — generated from the structured model (or left as-is where the model has no data). Existing consumers keep working. Backfill is *assisted and user-reviewable* (open-question decision): W3 may propose entries distilled from the blob, each requiring the same evidence bar and explicit user confirmation. **Never** bulk-imported, and **never** auto-converted to `stated` — provenance laundering is prohibited (INV-PERSONA-1, test T-U12).
- `values` (W4) — learned preferences from behavior. Values are *what matters to him as revealed by action*; the user model is *what he believes/wants/knows*. They overlap at `desire`/`constraint` slots, and W4 will write to those slots through the same API — but W2 does not build the behavioral ledger.
- Working memory, episodes, nodes — the model *cites* these as evidence; it is not made of them.

### 4.2 Schema

```sql
CREATE TABLE user_model (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- stable identity (B4)
  space_id TEXT NOT NULL DEFAULT 'legacy',
  slot TEXT NOT NULL CHECK (slot IN (
    'belief','desire','intention','emotion_state','knowledge','constraint'
  )),
  -- One proposition per row (B4, gap 12). Content is a single atomic claim:
  -- "believes the CNA fee is $85" — not "believes the CNA fee is $85 and the bus is the 8".
  content TEXT NOT NULL,

  -- Confidence semantics (B8): P(user currently holds this mental state | evidence).
  -- This is NOT P(content is objectively true). Truth-tracking is out of scope.
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- Evidence quality (B8): computed 0..1 from evidence count, independence, and recency.
  -- Stored (not derived at read time) so the consolidation job's assessment is auditable.
  -- Formula: min(1, 0.35·independent_sources + 0.25·recency_factor + 0.20·stated_bonus + 0.20·diversity)
  --   where independent_sources = count of independent evidence items (capped at 3 for the term),
  --   recency_factor = 0.5^(days_since_newest_evidence / 30),
  --   stated_bonus = 1 if any evidence is a direct user statement else 0,
  --   diversity = (# distinct evidence types) / 3.
  evidence_strength REAL NOT NULL DEFAULT 0 CHECK (evidence_strength >= 0 AND evidence_strength <= 1),

  evidence_ids TEXT NOT NULL DEFAULT '[]',
    -- JSON array of {type: 'episode'|'node'|'correction'|'enrichment', id: N}.
    -- Validated by validateEvidenceRefs() (§3.8). Non-empty required (INV-EV-1).

  -- Topic labels (B2, Rev 4): JSON array of controlled topic labels from the
  -- §6.2 vocabulary. Assigned at write time by recordStated()/updateUserModel()
  -- via the topic mapper; used by the knowledge check's recall-first candidate
  -- generation. Both BOOTSTRAP_SQL and the migration path create this column
  -- (see §8.1). An entry with topic_labels = '[]' is treated as
  -- topic_uncertain=true at read time (the check widens rather than narrows).
  topic_labels TEXT NOT NULL DEFAULT '[]',

  valid_at TEXT NOT NULL,          -- when this entry became the model's belief (canonical ISO UTC)
  invalid_at TEXT,                 -- when superseded (NULL = current). Cf. W1 bi-temporal pattern.
  invalid_reason TEXT CHECK (invalid_reason IN (
    'superseded','corrected_false_belief','evidence_withdrawn','expired','user_override'
  )),
  replaced_by INTEGER,             -- application-enforced reference → user_model.id (the superseding entry); NULL if none (B4, B6 Rev 3; see §8.5)

  origin TEXT NOT NULL CHECK (origin IN ('stated','inferred','consolidated')),

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  UNIQUE (space_id, slot, content, valid_at)  -- same belief held at different times = distinct rows
);
CREATE INDEX idx_user_model_current ON user_model(space_id, slot) WHERE invalid_at IS NULL;
CREATE INDEX idx_user_model_origin ON user_model(space_id, origin);
CREATE INDEX idx_user_model_replaced ON user_model(replaced_by);
```

**Identity (B4):** `id` is the stable identity used by `correctUserModel(entryId, ...)`, `replaced_by`, and all API references. The composite UNIQUE constraint prevents exact-duplicate rows but is not the identity. The API never addresses rows by `(slot, content, valid_at)`.

**One proposition per row (B4, gap 12):** `recordStated()` and `updateUserModel()` validate that `content` expresses a single atomic claim. Heuristic: reject content containing multiple independent clauses joined by `and`/`but`/`;` when they assert different predicates about different subjects. (Conservative: false positives are corrected by the caller splitting the content. The rule is documented, tested T-U13, and intentionally strict — merged claims are where contradictions hide.)
For `emotion_state`: one emotion about one subject per row. "Stressed about the fee" and "proud about the job" are two rows, not one.

**Contradiction identification (B4):** when new evidence contradicts an entry, the system identifies the contradicted row(s) by: same `slot` + topic overlap (shared entities/keywords via the candidate's extracted topics, §6.2) + temporal overlap (the entry's `[valid_at, invalid_at)` window covers the contradiction's `valid_at`). Only rows matching all three are invalidated. Same-slot rows about unrelated topics are untouched. (Test T-U14: two beliefs in the same slot, contradict one, assert the other survives.)

### 4.3 The six slots

Mapped from ToMBench's dimensions. Each slot has a distinct update rule and a distinct *consumer*:

| Slot | Represents | Example | Primary consumer |
|---|---|---|---|
| `belief` | What he thinks is true about the world | "believes the CNA fee is $85 and must be a money order" | Knowledge check (§6): don't assert contradictions |
| `desire` | What he wants | "wants the CNA license reinstated to get a second job" | Proactive relevance scoring (W6) |
| `intention` | What he's committed to doing | "intends to mail the money order this week" | Reminder/nudge generation |
| `emotion_state` | Current emotional weather (dated, never a trait) | "stressed about the fee" (2026-10-19) | Tone calibration; W6 timing |
| `knowledge` | What he already knows | "knows he works at Samsonite" / "knows the bus route" | Novelty check: don't tell him what he knows |
| `constraint` | Hard boundaries | "never suggest spending before the CNA fee is covered" | Safety rails on suggestions |

**Slot semantics are load-bearing.** A `belief` and a `knowledge` entry with the same content mean different things: belief is *what he thinks* (may be wrong — the bot can know it's wrong and still model that he believes it); knowledge is *what he demonstrably knows* (from having said it, acted on it, or been told it with acknowledgment). The knowledge check (§6) reads `belief` + `knowledge` together.

**Belief vs truth (B8):** the `belief` slot models *his* mental state, not reality. The system may simultaneously hold `belief: "he believes X"` at 0.95 and *know* X is false (from nodes). This is not a contradiction in the schema — it's the entire point of first-order ToM. The knowledge check (§6) distinguishes "contradicts what he believes" (handle as correction event) from "contradicts what is true" (handle as factual matter).

**`emotion_state` entries are always dated and always expire — enforced on reads (gap 11).** `getUserModel()` adds:
```sql
AND (slot != 'emotion_state'
     OR datetime(valid_at) > datetime('now', '-7 days'))
```
The W3-scheduled `sweepStaleEmotions()` is cleanup hygiene, not the correctness mechanism. If the job is delayed or fails, reads still exclude stale emotions. (Test T-U8 covers both the read filter and the sweep.)

### 4.4 Confidence scale, evidence strength, and promotion rules

**What confidence measures (B8):** `confidence` = the system's estimated probability that the user *currently holds* the mental state described by `content`, given the evidence. It is a belief-report confidence. It is **not** a truth confidence. A correction writes at 0.95 meaning "we are 0.95 confident he stated this correction," not "the corrected content is 0.95 true."

**What `evidence_strength` measures:** the quality of the justification — count, independence, recency, and diversity of evidence. A `stated` entry with one direct quote has high confidence (0.95) but moderate evidence_strength (~0.55: one source, one type). A `consolidated` entry with three independent episodes has both high.

**The three dimensions, kept separate:**

| Dimension | Column | Question it answers | Truth-tracking? |
|---|---|---|---|
| Report confidence | `confidence` | "How sure are we he holds this state?" | No |
| Evidence quality | `evidence_strength` | "How good is our justification?" | No |
| Objective truth | *(not modeled)* | "Is the content actually true?" | Explicitly out of scope |

| Range | Meaning | Who can write |
|---|---|---|
| 0.95–1.0 | Certain *that he holds this state*. Reserved for `stated` entries. | User statements; explicit confirmations |
| 0.70–0.94 | Probable. Multiple independent evidence sources agree. | Consolidation (W3) with ≥2 independent sources |
| 0.40–0.69 | Plausible. Single source or weak corroboration. | Consolidation (W3), single episode |
| 0.10–0.39 | Speculative. Thin evidence; kept for recall, never acted on. | Consolidation (W3) only |
| < 0.10 | Not stored. Below the noise floor. | — |

**Promotion rules (the anti-weak-inference machinery):**

1. **Independence requirement.** Confidence rises only from *independent* evidence. Two mentions in the same conversation = 1 observation. The same fact restated on three different days = 3 observations. An episode + a node distilled from that same episode = 1 observation (the node is not independent of its source episode). `assessIndependence()` implements this; W2 defines the rule, W3 implements the job.

2. **Origin ceiling.** `inferred` entries cap at 0.69. Only `consolidated` entries (W3's offline job) may reach 0.70+. `stated` entries start at 0.95. The ceiling is enforced at write time (`updateUserModel()` rejects violations, test T-U4).

3. **No confidence without evidence.** `evidence_ids` must be non-empty (INV-EV-1, test T-U3).

4. **Decay.** Inferred/consolidated entries decay: confidence × 0.97 per week without refreshing evidence. Stated entries do not decay — invalidated only by newer statement or explicit correction. Below 0.40 → flagged for re-confirmation (W6 inquiry candidate), not silently dropped.

5. **Contradiction does not average.** New contradicting evidence *invalidates* (sets `invalid_at` + `invalid_reason` + `replaced_by`), never averages down. (Test T-U2.)

### 4.5 Write paths

**Three writers, strictly separated:**

1. **`stated` — the user, via explicit statement.** Written synchronously by the agent loop when the stated-write trigger fires (§4.8). Confidence 0.95. Immediately invalidates contradicted `inferred`/`consolidated` entries in the same slot (W1-style: `invalid_at`, `invalid_reason='superseded'`, `replaced_by` → new row id).

2. **`inferred` — hot-path heuristics (W2: none).** W2 defines the origin and the 0.69 ceiling but ships *zero* hot-path inference rules. Deliberate (Clever Hans). A phase adding inferred rules goes through the review gauntlet.

3. **`consolidated` — the W3 sleep job.** Reads episodes, proposes updates with evidence links, applies promotion rules. The *only* writer of `consolidated` entries. W2 provides the table and `updateUserModel()`; W3 provides the job.

**What W2 wires up:** the `stated` path. Everything else is schema + API, waiting for W3.

### 4.6 Correction semantics

| User says | Interpretation | Action |
|---|---|---|
| "That's wrong, I don't believe X" | False-belief correction (W1 Type 2 analog) | Invalidate entry (`invalid_at` = now, `invalid_reason` = `'corrected_false_belief'`). Do NOT fabricate a validity interval. If user states the true belief, write new `stated` row with `replaced_by` link. |
| "I used to want X, now I want Y" | Factual update (W1 Type 1 analog) | Close old window (`invalid_at` = now, `invalid_reason` = `'superseded'`), write Y as `stated` with `replaced_by`. |
| "Stop assuming X about me" | Preference/silence override (W1 Type 3 analog) | Invalidate the entry (`invalid_reason` = `'user_override'`). Write no replacement. Optionally add `constraint` entry "do not infer X" — **only if the user states it as a constraint**, never inferred from the correction itself. |

**The "don't infer a constraint from a correction" rule** is the W2 analog of W1's Type 3 `endsValidity` flag: a correction is evidence that *this entry* was wrong, not evidence of a general rule. (Test T-U7.)

**Correction targeting confidence (Rev 3).** A correction writes at 0.95 meaning "we are 0.95 confident he *stated* this correction" — the statement was observed. But *which existing entry* the correction targets is a separate judgment that can be ambiguous. `correctUserModel()` must therefore:

1. Identify candidate target entries (same slot + topic overlap, §4.2 contradiction identification).
2. Score each candidate's match to the correction's content (topic overlap depth, entity match, temporal proximity).
3. If exactly one candidate scores ≥ 0.70 and the next-best scores < 0.40 → invalidate that entry (`invalid_at`, `invalid_reason`, `replaced_by`).
4. **Otherwise → abstain.** Log `correction_ambiguous` with `{correction_text, candidate_ids, scores}` and surface as an inquiry: "You said [correction] — which of these did you mean?" **Never** invalidate a nearby-but-unrelated entry to preserve the 0.95 convention. A wrong invalidation is worse than a deferred one — the entry remains correctable later, but a wrongly-killed entry's history is corrupted.

**Belief withdrawal without replacement:** "I don't believe X anymore" (no Y stated) → invalidate the X entry with `invalid_reason='corrected_false_belief'`, write no replacement. The `replaced_by` stays NULL — the belief ended, nothing took its place. (Test T-U18.)

The 0.95 default is kept for clearly classified stated claims. The targeting step is where humility lives.

### 4.7 The `user_persona` blob

**Unchanged in W2.** The blob remains the rendered summary for existing consumers. `renderPersonaFromModel()` generates text from current user-model rows; the system prefers the structured model where both exist.

**Backfill (open-question decision):** assisted and user-reviewable only. W3 may propose entries distilled from the blob, but each requires the same evidence bar as any other entry *and* explicit user confirmation before being written. **Never** bulk-imported. **Never** auto-converted to `stated` — that would launder unprosecuted claims into the evidence-backed store (INV-PERSONA-1, test T-U12).

### 4.8 Stated-write trigger boundary (gap 15)

The agent loop calls `recordStated()` only when the trigger fires. The trigger is conservative by design — false negatives (missing a stated belief, caught later by W3) are preferable to false positives (laundering a non-statement into 0.95-confidence authority).

**Fires on:** first-person, present-tense (or explicit past-tense) assertions about the speaker's own mental state or life. "I want…", "I believe…", "I need…", "I'm trying to…", "don't ever… [directed at the bot about his preferences]", "I started…", "my plan is…".

**Does NOT fire on:**
- **Hypotheticals:** "what if I quit?", "suppose I moved…" → no write. (Logged as conversation, available to W3.)
- **Quotations of others:** "she said I should…" → the claim is attributed to *her*, not his belief.
- **Jokes / sarcasm:** humor markers (exaggeration, "lol", punchline structure) → no write. When in doubt, don't write.
- **Negations of others' claims:** "that's not what she meant" → about her meaning, not his state.
- **Third-person statements:** "my brother thinks…" → about his brother.
- **Questions:** "should I…?" → no assertion made.

**Implementation:** pattern-matched pre-filter (cheap, deterministic) + LLM classifier for ambiguous cases. The classifier defaults to **abstain** on uncertainty — abstentions are logged as `stated_candidates` for W3 review, not written. (Test T-U15: adversarial cases — hypothetical, quote, joke, third-person — none produce `stated` entries.)

---

## 5. Episode extraction: what becomes an episode

### 5.1 Capture triggers

`captureEpisode()` is called from these points (all existing code locations):

| Trigger | Location | Kind |
|---|---|---|
| Agent loop turn completes with ≥1 tool call or substantive exchange | `agent/loop.ts` `agentLoop()` return path | `conversation` |
| Telegram free-text exchange completes | `telegram/bot.ts` message handler | `conversation` |
| Reminder fired | `agent/tools/reminder.ts` | `agent_action` |
| Digest sent | `synthesis/dailyDigest.ts` send path | `digest_sent` |
| Proactive message sent | Phase 2 outbox send path | `proactive_msg` |
| User correction detected (link rejection, "no"/"wrong" signal, approval denied) | `agent/approvals.ts`, `candidate_links` | `correction` |
| Router tick with findings | `index.ts` router tick | `job_run` |

**Capture is best-effort and non-blocking.** It runs after the response is delivered, never before. A capture failure is logged to `agent_logs` and swallowed.

### 5.2 The significance filter (formal)

An episode qualifies for *prioritized* background enrichment if ANY of:

1. **First-time signal:** new node created, new person/place/topic (not in last 30 days of episodes), or new tool used.
2. **Emotional spike:** |emotional_weight| > 0.5 from the interaction's signals.
3. **Decision:** approval confirmed/denied, choice selected, inquiry answered.
4. **Correction:** any correction signal.
5. **Explicit life content:** user stated something about their life (job, money, family, health, plans) — detected by the existing extraction prompt's entity output.

`isSignificant(interaction) → boolean` is a pure function with unit tests. Selectivity tunable via `space_meta.episode_enrich_daily_cap` (default 20). Non-significant episodes are enriched only if budget remains — never dropped.

### 5.3 What is NOT captured

- Heartbeat/polling ticks with no findings.
- Failed tool calls with no user-visible effect (already in `agent_logs`).
- Raw transcript embeddings (`source_transcript_ref` is an opaque pointer; W2 builds no transcript store).
- Content matching an applied forget request (§3.7) — tombstone written instead.

---

## 6. The knowledge check

### 6.1 Contract

```typescript
knowledgeCheck(spaceId, candidateContent, opts?: { timeoutMs?, maxLlmCalls? }) → {
  verdict: 'ok' | 'contradicts_belief' | 'already_known' | 'uncertain' | 'check_failed',
  conflictingEntries: UserModelEntry[],  // specific rows, with evidence + evidence_status
  suggestedAction: 'proceed' | 'rephrase_as_question' | 'suppress' | 'flag_for_review' | 'defer',
  latencyMs: number,
  llmCallsUsed: number
}
```

### 6.2 Recall-oriented candidate generation (B3, Rev 3)

The Rev 1 design gated candidates on embedding similarity > 0.82. That misses contradictions with low surface similarity. Rev 2 removed the gate but left the topic-mapping contract underspecified. Rev 3 defines it.

**Topic normalization contract.** Every user-model entry and every knowledge-check candidate carries `topic_labels`: a JSON array of controlled topic labels assigned at write time (entries) or check time (candidates).

- **The vocabulary** is a controlled, versioned list stored in `space_meta` (`topic_vocabulary_version`, default `v1`). Seed topics: `employment`, `finance`, `housing`, `transport`, `health`, `family`, `legal`, `education`, `communication`, `routine`, `goals`, `relationships`. The list grows only by explicit schema-level addition (same governance as the emotion vocabulary) — never by free-text invention at runtime.
- **Mapping rules** (deterministic, in order):
  1. **Keyword rules:** each topic has a curated synonym set. `employment` ← {job, work, employed, unemployed, hired, fired, laid off, gig, shift, warehouse, Samsonite, boss, paycheck, overtime, ...}. "Started at Samsonite" → `employment` via `Samsonite`; "you are unemployed" → `employment` via `unemployed`. The synonym sets are part of the design appendix and are tested (T-K11–T-K16).
  2. **Entity-type hints:** named entities of type ORG-employer, MONEY, DATE-employment-context reinforce the topic.
  3. **LLM fallback:** if no keyword rule fires, a bounded LLM call proposes topic labels (or abstains). The LLM's output is constrained to the controlled vocabulary — it selects, never invents.
- **When mapping is uncertain (the uncertainty boundary):** if no keyword rule fires AND the LLM abstains or reports low confidence, the candidate is labeled `topic_uncertain=true`. The check then **widens, never narrows**: it pulls all current entries from the candidate's slot (or all slots if the slot is unknown), capped at 25 by confidence, and sets `recall_uncertain=true` in the result. The verdict `ok` is **never** returned on a narrowed candidate set when recall is uncertain — the worst case is `uncertain` → `flag_for_review`, not a false `ok`.

**Topic overlap is necessary but not sufficient for contradiction (B3, Rev 4).** Sharing an employment label only generates a *candidate* for review — it never itself establishes a contradiction. A contradiction requires **entity identity + incompatible states**:

- **Entity identity:** the two claims must concern the *same* entity (same employer, same person, same object). "Quit the warehouse" vs "works at Samsonite" share the employment topic but do not establish the same employer — "warehouse" is a generic workplace term, not an entity identifier. Without entity resolution linking "warehouse" to "Samsonite" (via an explicit alias, a prior stated mapping, or an entity-resolution result with confidence), these are two compatible statements about possibly different workplaces.
- **Incompatible states:** the claims must assert states that cannot both hold. "Only free on weekdays" and "works Saturdays" are *compatible* — weekday freedom and Saturday work do not conflict. "I work at Samsonite" and "I don't work at Samsonite" are incompatible (genuine negation, same entity). "Quit Samsonite" then "started at Amazon" is a contradiction *via explicit transition* — the quit terminates the Samsonite state, the Amazon start asserts a new one, and X≠Y.

The deterministic contradiction rules (§6.2 Stage 2) are therefore:

1. **Genuine negation:** same entity + A asserts P, B asserts ¬P → contradiction.
2. **Explicit transition:** A asserts "ended state S at entity X" (quit, left, stopped, no longer) + B asserts "began state S' at entity Y" with X≠Y → contradiction (the old state is terminated, the new state replaces it).
3. **Topic overlap alone → candidate only.** The pair proceeds to LLM judgment (Stage 2 step 3) with an explicit instruction: "determine whether these claims concern the same entity and assert incompatible states; if entity identity is uncertain, return `uncertain`, not `contradiction`."

This prevents the trust-destroying false positives the round-3 review identified: the system must not tell the user "you contradicted yourself" when the two statements are compatible.

**Explicit guarantee boundary (B3):** the check guarantees contradiction *recall* over:
  (a) entries sharing at least one topic label with the candidate (via the vocabulary above),
  (b) state-change verb patterns ("started", "quit", "no longer", "now", "stopped") applied to topic-matched entries,
  (c) negation patterns ("don't", "never", "not", "no longer") applied to topic-matched entries,
  (d) all current `constraint` entries (always pulled, no filtering).

Recall is not judgment: the boundary above defines which *candidates* are pulled. Whether a candidate *is* a contradiction is decided by the entity-identity + incompatible-states rules. It does **not** guarantee recall over paraphrases that evade both the keyword vocabulary and the LLM topic mapper (e.g., a novel metaphor for unemployment that matches no synonym and that the LLM fails to classify). In that case the uncertainty boundary applies: widen + flag. The design claims "recall-first within the topic system," not "comprehensive natural-language contradiction detection" — the boundary is explicit and tested.

**Stage 1 — candidate generation (recall-oriented, no similarity threshold):**
1. Extract topics/entities from the candidate; assign `topic_labels` (with `topic_uncertain` flag if mapping failed).
2. **Constraints first, outside the cap (B8, Rev 4):** all current `constraint` entries are pulled in a *separate query* with no limit. Constraints are safety-critical and few in practice; the safety contract ("all constraints are always checked") holds unconditionally. They do not consume the 25-candidate budget.
3. Query user-model rows (`invalid_at IS NULL`, slots `belief`/`knowledge`) matching ANY of:
   - Shared topic label with the candidate.
   - **State-change patterns:** the candidate contains a state-change verb → pull all same-topic entries regardless of similarity.
   - **Negation patterns:** the candidate negates a proposition → pull entries asserting the positive form (same topic).
   - **Uncertain recall:** if `topic_uncertain`, pull all current entries from the candidate's slot (or all slots), capped at 25 by confidence desc, and set `recall_uncertain=true`.
4. Cap: max 25 non-constraint candidates (deterministic ordering: by confidence desc). Constraints are in addition to this cap, not within it. The total candidate set is therefore at most 25 + (# constraints).

**Stage 2 — contradiction judgment (deterministic first, LLM only for ambiguity):**
1. **Deterministic rules** (no LLM): direct negation ("I work at X" vs "I don't work at X"), temporal succession ("in between jobs" valid_at < "started Samsonite" valid_at with overlapping topic → the older is superseded, not contradictory), explicit constraint violation (candidate matches a constraint's prohibited pattern).
2. **Embedding similarity** as a *ranking* signal among ambiguous pairs (not a gate).
3. **LLM judgment** only for pairs surviving stages 1–2 without a deterministic verdict. Bounded: ≤5 calls per check.

**Verdict semantics:**
- `ok` → `proceed`.
- `contradicts_belief` (confidence ≥ 0.70) → `suppress` + log with cited entries. (The T-K5 case: "in between jobs" vs `belief: "works at Samsonite"` 0.95 stated.)
- `contradicts_belief` (confidence < 0.70) → `rephrase_as_question`. ("I thought you'd started the Samsonite job — is that still right?")
- `already_known` → `suppress` (reason `already_known`).
- `uncertain` → `flag_for_review`.
- `check_failed` → see §6.3.

**Adversarial acceptance cases (B3):** T-K6 ("you are unemployed" vs "started working at Samsonite" — low similarity, must contradict), T-K7 (negation: "you don't work weekends" vs "works Saturdays"), T-K8 (temporal succession correctly identified as supersession, not contradiction).

### 6.3 Failure behavior (B9)

| Path | On check failure (timeout, embedding down, LLM error) | Rationale |
|---|---|---|
| **Proactive** (digest, nudges, unprompted messages) | **Fail-closed:** `verdict='check_failed'`, `suggestedAction='defer'`. The message is deferred, the failure logged with reason. It is retried on the next cycle; after 3 deferrals it is escalated to `flag_for_review`. | Unprompted wrong claims are trust withdrawals. Never send a proactive message the safety check couldn't vet. |
| **Conversational** (answering the user) | **Fail-open:** proceed without the check. The user-model prompt block (§7.3) is best-effort context; its absence degrades quality but doesn't create new harm — the user is present to correct. | Blocking answers on a background check would hang conversations. |

**Bounded cost:** embedding lookup ≤ 2s; LLM judgment ≤ 10s per call, ≤ 5 calls; total check budget 15s. Exceeding budget → `check_failed` (proactive) or proceed (conversational). Budgets are constants, tested with mocked timeouts (T-K9, T-K10).

### 6.4 Where it plugs in

- **Proactive path (primary):** every digest section, inquiry, and proactive message candidate passes through `knowledgeCheck()` before the W6 gate. Fail-closed per §6.3.
- **Conversational path (light):** the agent loop's context builder includes the user-model block (§7.3). The full check is not run per turn — the block provides implicit first-order ToM grounding.

**Knows-believes vs knows-true (review gate):** the check distinguishes three cases: (a) candidate contradicts what he *believes* (belief slot) → correction-event handling (careful, may need his confirmation); (b) candidate contradicts what is *true* (nodes, W1) → factual handling; (c) candidate contradicts what he *knows* (knowledge slot) → noise suppression. These are different verdicts with different suggested actions, and the `conflictingEntries` cite which slot fired.

**Respectful disagreement is not blocked:** the check suppresses *unintentional* contradiction (the bot asserting something stale as fact). It does not suppress the bot *disagreeing* when the disagreement is the point — corrections the user asked for, factual corrections with cited evidence, and explicit "I see it differently" framing bypass the suppress path via an `intentional_correction` flag on the candidate.

---

## 7. Retrieval integration

### 7.1 Episodes in the existing search stack

```
memorySearch(query):
  nodeResults = existing pipeline (unchanged)
  episodeResults = episodeSearch(query)   // NEW: vec KNN over enrichment embeddings
                                         //       + canonical scorer rerank (§3.6)
  return { nodes: nodeResults, episodes: episodeResults }
```

**Parallel namespace, not merged:** nodes and episodes have different schemas, different temporal semantics, and different context shapes (facts vs narratives). The agent loop receives both; the prompt template labels them distinctly.

**Episode FTS:** separate FTS5 table `episodes_fts` over the *current enrichment's* detail + the capture summary (same pattern as node FTS). Redacted (forgotten) episodes are removed from FTS (§3.7).

**Vector reuse:** W1's `vecSearchCurrent` iterative over-fetch is reused with a no-op supersession filter (episodes are append-only). Code reuse, not a new primitive.

### 7.2 Agent loop context builder

The agent loop's system prompt gains a **user-model block**, composed by `composeUserModelBlock()`:

```
## What I believe about you (confidence = how sure I am you hold this view)
Believes: the CNA fee ($85 money order) is the top financial priority (0.95, stated)
Wants: the CNA license reinstated to get a second job (0.95, stated)
Knows: works at Samsonite warehouse; bus route is 8→1→3 (0.90, consolidated)
Constraints: never suggest spending before the CNA fee is covered (0.95, stated)
Current state: stressed about the fee (2026-10-19); proud about the job (2026-10-19)
```

Rules:
- Only entries with confidence ≥ 0.40 appear. Each line cites origin. Emotion lines always dated. Cap ~400 tokens (top by confidence × recency).
- The header explicitly says "what I believe about you" — never "what is true about you." The confidence gloss prevents the LLM from treating 0.95 as objective truth.

---

## 8. Schema, migration, and API

### 8.1 Table creation: two paths, one rule (B7)

The repo rule stands: **table creation lives only in `db/schemaSql.ts` `BOOTSTRAP_SQL`**. For W2's new tables, the two deployment paths are:

**Path A — fresh database.** `BOOTSTRAP_SQL` runs at first boot. Tables created with full constraints (CHECK, UNIQUE, FK-equivalents, canonical timestamp defaults). No migration code runs.

**Path B — existing database.** `migrateSchema()` in `db/client.ts` runs PRAGMA-guarded DDL:
```sql
CREATE TABLE IF NOT EXISTS episodes (...);       -- same column set as BOOTSTRAP_SQL
CREATE TABLE IF NOT EXISTS episode_enrichments (...);
CREATE TABLE IF NOT EXISTS user_model (...);     -- includes topic_labels (B2 Rev 4)
CREATE TABLE IF NOT EXISTS forget_requests (...); -- includes scope_topics, no scope_keywords (B4 Rev 4)
CREATE TABLE IF NOT EXISTS enrichment_quota (...);  -- B4, Rev 3
CREATE INDEX IF NOT EXISTS ...;
```
Idempotency: `IF NOT EXISTS` makes repeated startups safe. A post-migration assertion verifies all five tables (`episodes`, `episode_enrichments`, `user_model`, `forget_requests`, `enrichment_quota`) exist with the expected columns (PRAGMA table_info check, throwing on mismatch — same loud-failure pattern as W1's timestamp assertion).

**Constraint equivalence (B8, Rev 3):** `PRAGMA table_info` verifies columns but not indexes, CHECK constraints, or UNIQUE behavior. The migration test (T-M2) uses `assertSchemaEquivalent(freshDb, migratedDb)`, which compares:
1. **Columns:** `PRAGMA table_info(table)` — name, type, notnull, default, pk (for each W2 table).
2. **Indexes:** `PRAGMA index_list(table)` → for each index, `PRAGMA index_info(index)` — indexed columns and uniqueness. Every index in BOOTSTRAP_SQL must exist on the migrated path.
3. **CHECK constraints:** parsed from `sqlite_master.sql` — the CHECK expressions for `kind`, `slot`, `enrichment_status`, `emotion`, `confidence`/`evidence_strength` ranges, `invalid_reason` must be textually identical between paths.
4. **UNIQUE constraints:** verified behaviorally — attempt to insert a duplicate `(episode_id, version)` and a duplicate `(space_id, slot, content, valid_at)` on *both* paths; both must reject with `SQLITE_CONSTRAINT_UNIQUE`.

**Why no ALTER-rebuild strategy is needed:** W2's migration creates *new* tables (`CREATE TABLE IF NOT EXISTS`) — it never ALTERs existing tables. SQLite's ALTER limitations (no DROP COLUMN, no ADD CONSTRAINT) don't apply. If a future W2 revision needs to change these tables, it follows W1's additive pattern (new nullable columns via PRAGMA-guarded ALTER, application-level defaults).

**Why both:** BOOTSTRAP_SQL is the schema of record (single source of truth for what the tables look like). The migration path replicates it for databases created before W2. The T-M1/T-M2 tests pin that both paths produce identical schemas (PRAGMA comparison).

Drizzle definitions in `db/schema.ts` for all five tables (`episodes`, `episode_enrichments`, `user_model`, `forget_requests`, `enrichment_quota`) (matching the W1 pattern: fresh-schema defaults via `sql` template, nullable where SQLite ALTER limits require).

### 8.2 New module: `agent/episodic.ts`

| Function | Purpose |
|---|---|
| `captureEpisode(handle, spaceId, input)` | Hot-path capture (template summary, free). Non-blocking, never throws. Checks forget-list first. |
| `isSignificant(interaction)` | Significance filter (pure function, unit-tested). |
| `claimEnrichment(handle, spaceId)` | Atomic worker claim with quota reservation + fencing (B2, B4 Rev 3). Filters `forgotten_at IS NULL` (B1 Rev 4). Returns `{episodeId, fence}` or null. |
| `enrichEpisode(handle, spaceId, episodeId, fence)` | Background enrichment (LLM). Writes versioned enrichment record in-transaction; commit guarded by fence token + `forgotten_at IS NULL` (B1 Rev 4). Idempotent. |
| `spaceLocalDate(spaceId)` | Returns `YYYY-MM-DD` in the space's `space_meta.timezone` (B7 Rev 4). Used for quota dates — never SQLite `date('now')`. |
| `getEpisodes(handle, spaceId, opts)` | Timeline backend API: recency/kind/provenance, cursor pagination. |
| `episodeSearch(handle, spaceId, queryVec, k)` | Vector + canonical-scorer episode search. |
| `linkEpisodeToNodes(handle, episodeId, nodeIds)` | Creates a NEW enrichment version with merged `source_node_ids` (B1, Rev 3 — never mutates). |
| `validateProvenance(enrichment)` | Provenance coverage validation (B7, Rev 3) — completeness, allowed labels, fail-closed selector. |
| `applyForgetRequest(handle, requestId)` | Forget propagation (§3.7). Single transaction. Requires approved request. |
| `validateEpisodeRefs(handle, spaceId, refs)` | JSON shape + cross-space validation (§3.8). |

### 8.3 New module: `agent/userModel.ts`

| Function | Purpose |
|---|---|
| `getUserModel(handle, spaceId, opts)` | Current entries (`invalid_at IS NULL`), slot filter, **read-time emotion expiry** (gap 11). Annotates `evidence_status` per entry (§3.8). |
| `getUserModelHistory(handle, spaceId, entryId)` | Full version chain via `replaced_by` links. |
| `recordStated(handle, spaceId, slot, content, evidence)` | Write `stated` (0.95). Validates one-proposition rule, stated-trigger boundary. Invalidates contradicted entries. |
| `updateUserModel(handle, spaceId, entry)` | W3's write API for `consolidated`. Enforces origin ceiling, evidence requirement, provenance quarantine (INV-ENRICH-1). |
| `correctUserModel(handle, spaceId, entryId, correction)` | Correction semantics (§4.6). Sets `invalid_at`/`invalid_reason`/`replaced_by`. Never deletes. |
| `assessIndependence(evidenceA, evidenceB)` | Independence rule for promotion (W3 implements the job; W2 defines the function + rule). |
| `knowledgeCheck(handle, spaceId, candidate, opts)` | §6. Bounded, fail-open/fail-closed per path. |
| `composeUserModelBlock(handle, spaceId)` | §7.2 prompt block. |
| `sweepStaleEmotions(handle, spaceId)` | Cleanup hygiene (W3 schedules). Correctness lives in the read filter. |

### 8.4 Space isolation

Every function takes `spaceId`. Every query includes `space_id = ?`. Cross-space references rejected by validation (§3.8). Acceptance-tested (T-E7, T-U10, T-V2).

### 8.5 Reference enforcement strategy (B6, Rev 3)

**Decision: application-enforced, not SQL FOREIGN KEY constraints.** This matches W1's established pattern ("application-validated, cf. W1") and the repo's migration constraints:

- **Why not SQL FKs:** SQLite's `ALTER TABLE` cannot add a `REFERENCES` clause to an existing table, and W2's tables are created via `CREATE TABLE IF NOT EXISTS` on existing databases. Declaring FKs only in the fresh path would create a behavioral divergence between fresh and migrated databases — the exact parity problem B8 addresses. Application enforcement is identical on both paths.
- **What "application-enforced" means concretely:**
  1. Every write that sets a reference column (`episode_enrichments.episode_id`, `episode_enrichments.superseded_by`, `user_model.replaced_by`, `episodes.corrects_episode_id`, JSON `evidence_ids`/`source_node_ids`) validates *inside the same transaction* as the write: the referenced row exists, belongs to the same `space_id`, and (for `superseded_by`/`replaced_by`) is not already superseded itself.
  2. Validation failure → the entire transaction rolls back with a `ValidationError`. There is no "write now, validate later" path.
  3. The validation functions (`validateEpisodeRefs`, `validateEvidenceRefs`, §3.8) are the single enforcement point — no module performs its own ad-hoc reference checks.
- **Missing reference behavior:** write rejected, `ValidationError` with `{field, referenced_id, reason: 'not_found' | 'wrong_space' | 'already_superseded'}`. Never silently null the reference, never create a placeholder row.
- **Same-space rule:** a reference is valid only if the referenced row's `space_id` equals the writing `space_id`. Cross-space references are rejected even if the row exists (test T-V6).
- **Documentation honesty:** schema comments say "application-enforced reference," never "FK." Code comments on the validation functions cite this section. No contributor will mistake these for database constraints.

---

## 9. Test plan

**Episodes:**
- T-E1: `captureEpisode()` writes valid row, template summary, no LLM, no throw on DB error.
- T-E2: `isSignificant()` — first-time → true; heartbeat → false; correction → true; small talk → false.
- T-E3: `enrichEpisode()` idempotent — run twice, one version-1 record, no duplicate.
- T-E4: **Immutability (B1)** — attempt to UPDATE capture columns via API: no such path exists; direct SQL UPDATE of `summary` outside `applyForgetRequest()` is a code-review violation (no runtime path). Enforcement is API-shaped: the only UPDATE statement targeting `episodes.summary` lives in `applyForgetRequest()`.
- T-E4b: **Redaction exception (B1, Rev 3)** — approved forget request redacts episode: `summary` becomes exactly `"[redacted per forget request #N]"`, `embedding` NULL, `forgotten_at` set, `occurred_at`/`recorded_at`/`kind` untouched. Audit row (`forget_requests`) contains request metadata but no content substrings (assert none of the original summary's words appear).
- T-E4c: **Versioned linking (B1, Rev 3)** — `linkEpisodeToNodes()` on an episode with existing version-1 enrichment creates version 2 with merged `source_node_ids`; version 1's `superseded_by` points to version 2; version 1's `source_node_ids` is byte-identical to before (no in-place mutation).
- T-E5: `episodeSearch()` — similar finds, unrelated doesn't, recency rerank prefers recent (canonical scorer).
- T-E6: `source_node_ids` on enrichment record; "episodes for node X" join works.
- T-E7: Space isolation.
- T-E8: **Enrichment lifecycle (B6, B6 Rev 4)** — claim → processing → completed. Exact attempt sequence: claim (attempts=1, LLM called, fail) → claim (attempts=2, LLM called, fail) → claim (attempts=3, LLM called, fail) → claim (attempts would be 4, `> 3`) → `failed_permanent`, NO fourth LLM call. The predicate is `enrichment_attempts > 3` in prose, SQL, and test — no off-by-one.
- T-E8b: **Lease reclaim (B2, Rev 3)** — set episode to `status='processing'` with expired `enrichment_lease` (simulated crash). Run the ACTUAL `claimEnrichment()` query. Verify: the episode is claimed by the new worker (new fence token), `enrichment_attempts` incremented. Then simulate the stale worker's commit with its old fence token → 0 rows affected, transaction aborts, no enrichment record written.
- T-E9: **Daily cap (B6)** — cap=2, three significant episodes → third stays `pending` until next day.
- T-E9b: **Concurrent cap (B4, Rev 3)** — two simulated concurrent workers (interleaved transactions), cap=2, three claimable episodes → exactly 2 claims succeed, third returns null. Assert `enrichment_quota.claimed = 2`, never 3. Uses the actual quota reservation SQL.
- T-E9c: **Quota timezone boundary (B7, Rev 4)** — space timezone set to `America/New_York`. Simulate wall-clock 2026-10-19 23:30 EDT (2026-10-20 03:30 UTC). `spaceLocalDate()` must return `2026-10-19` (not `2026-10-20`). Exhaust the cap on the 19th, advance wall-clock to 2026-10-20 00:30 EDT → new `quota_date` row, cap resets. Assert the reservation SQL used the space-local date as a bound parameter (never SQLite `date('now')`).
- T-E10: Correction episode appends with `corrects_episode_id`; original unmutated.
- T-E11: **Forget propagation (B2)** — approved request redacts episode, deletes enrichments/embeddings/FTS, invalidates sole-evidence user-model entry, prunes multi-evidence entry. All in one transaction (rollback on failure tested by injecting a fault).
- T-F2: **Capture blocking (B5, Rev 3)** — create forget request, approve it (status='approved', propagation not yet run). Capture an interaction matching the scope → tombstone written, no content stored. Then reject a different request → capture proceeds normally.
- T-F3: **Scope topics (B4, Rev 4)** — forget request with `scope_topics=['employment']`. Capture "talking about the Samsonite job" (topic: employment) → tombstone. Capture "talking about the CNA fee" (topic: finance) → normal. Weak single-topic overlap → tombstone + `forget_ambiguity` logged.
- T-F4: **Forget/enrichment race, both orderings (B1, Rev 4)** — uses the ACTUAL `claimEnrichment()` SQL, the ACTUAL worker commit predicate, and the ACTUAL `applyForgetRequest()` transaction. No mocks of the expected outcome.
  - *Ordering A (forget-then-commit):* worker claims episode E (receives fence F1). `applyForgetRequest()` runs to completion (fence rotated to F2, `forgotten_at` set, enrichments deleted). Worker then attempts its commit with F1 using the real commit predicate. Assert: 0 rows affected, transaction aborts, NO enrichment record exists for E, NO embedding row exists, episode summary is the tombstone.
  - *Ordering B (commit in flight during forget):* worker claims E (fence F1), completes enrichment work but has not committed. Start `applyForgetRequest()` in a second connection with `BEGIN IMMEDIATE` (blocks until the worker's transaction resolves). Worker commits first (succeeds — not yet forgotten). Then forget proceeds: assert the just-written enrichment record is DELETED in the forget transaction, embeddings removed, episode tombstoned. Then reverse: forget's transaction starts first, worker's commit blocks on the lock, forget commits, worker's commit then affects 0 rows (fence rotated + `forgotten_at` set). Assert no enrichment survives in either interleaving.
- T-F5: **Content-free audit (B4, Rev 4)** — episode E contains sensitive content ("my private medical diagnosis is X"). Forget request created with `target_query` containing sensitive text ("forget everything about my medical diagnosis X"). Approve (scope confirmed) → assert `target_query IS NULL` in the same transaction. Apply → assert: NO substring of the sensitive content (from either the episode or the original query) appears in ANY column of `forget_requests`, in `agent_logs`, or in any other retained audit field. The audit contains only: request ID, timestamps, scope IDs (integers), scope topics (controlled labels), status transitions.
- T-F6: **Tombstone enforcement (B9, Rev 4)** — two paths, one format:
  - *Capture path:* approved forget request (scope: employment). Capture an interaction matching the scope → assert summary is exactly `"[redacted per forget request #N]"` with the correct N, `forgotten_at` set.
  - *Forget path:* approved request applied to an existing episode → assert summary is exactly `"[redacted per forget request #N]"` (same format, same N semantics).
  - *Exclusion:* assert the tombstoned episode is NOT returned by `claimEnrichment()` (the actual claim query filters `forgotten_at IS NULL`), does NOT appear in `episodeSearch()` results, and has no FTS or vec rows. Run the real claim query and the real search — not a stub.
- T-E12: **Provenance quarantine (B5)** — `generated`-labeled enrichment content cannot become user-model evidence (write rejected).
- T-E13: **`not_reported` valid (B5)** — enrichment of terse interaction leaves `detail`/`emotion` NULL with `not_reported` provenance; no invented content.
- T-E14: **Grounding (B5)** — `direct_quote` fields are substrings of the source interaction; adversarial terse input produces no vivid detail.

**User model:**
- T-U1: `recordStated()` writes at 0.95 with evidence; `getUserModel()` returns it.
- T-U2: Stated invalidates contradicted inferred entry — `invalid_at`, `invalid_reason`, `replaced_by` set; history shows both.
- T-U3: `updateUserModel()` rejects empty `evidence_ids` (INV-EV-1).
- T-U4: `updateUserModel()` rejects `inferred` with confidence > 0.69.
- T-U5: Independence — two mentions, same conversation = 1 observation.
- T-U6: Correction semantics — three rows of the §4.6 table.
- T-U7: No inferred constraint from a correction.
- T-U8: Emotion expiry — read filter excludes 8-day-old; sweep is hygiene.
- T-U9: `composeUserModelBlock()` excludes <0.40, dates emotions, caps tokens, header says "what I believe about you."
- T-U10: Space isolation.
- T-U11: **Higher-order rejection (INV-TOM-1)** — "he thinks I think…" rejected.
- T-U12: **Persona backfill (INV-PERSONA-1)** — blob content cannot become `stated` without user confirmation.
- T-U13: **One-proposition rule (B4)** — multi-claim content rejected with guidance to split.
- T-U14: **Targeted invalidation (B4)** — two same-slot beliefs, contradict one, other survives.
- T-U15: **Stated-trigger boundary (gap 15)** — hypothetical/quote/joke/third-person/question produce no `stated` entry.
- T-U16: **Ambiguous correction (Rev 3)** — two beliefs in the same slot with overlapping topics ("believes the fee is $85" and "believes the fee must be a money order"); correction "that's wrong about the fee" scores both in the ambiguous band → `correctUserModel()` abstains, logs `correction_ambiguous`, neither entry invalidated, inquiry surfaced.
- T-U17: **Targeted correction (Rev 3)** — same setup, but correction "the fee isn't $85, it's $90" scores the $85 entry ≥0.70 and the money-order entry <0.40 → only the $85 entry invalidated with `replaced_by` → new "$90" entry. Money-order entry untouched.
- T-U18: **Belief withdrawal (Rev 3)** — "I don't believe the bus is reliable anymore" with no replacement → entry invalidated with `invalid_reason='corrected_false_belief'`, `replaced_by` NULL, no new row written.

**Knowledge check:**
- T-K1: 0.95 stated belief contradiction → `contradicts_belief` + `suppress`.
- T-K2: 0.50 consolidated contradiction → `rephrase_as_question`.
- T-K3: Restated knowledge → `already_known` + `suppress`.
- T-K4: Constraint violation → `contradicts_belief` with constraint cited.
- T-K5: Original sin — "in between jobs" vs "works at Samsonite" → suppressed, logged.
- T-K6: **Adversarial recall (B3)** — "you are unemployed" vs "started at Samsonite" (low similarity) → contradiction detected via state-change pattern.
- T-K7: **Negation (B3)** — "you don't work weekends" vs "works Saturdays" → contradiction.
- T-K8: **Temporal succession (B3)** — old belief + newer superseding fact → identified as succession, not contradiction.
- T-K11: **Paraphrase recall (B3, Rev 3)** — "between gigs right now" vs `belief: "started at Samsonite"` → contradiction detected via employment topic mapping (gigs → employment synonym set).
- T-K12: **Synonym recall (B3, Rev 3)** — "jobless" vs `belief: "employed at Samsonite"` → contradiction via synonym set.
- T-K13: **Compatible schedules, same topic (B3, Rev 4)** — `belief: "works Saturdays"` (employment) vs candidate "only free on weekdays" (employment). Topic overlap generates a candidate, but the claims are *compatible* (weekday freedom + Saturday work). The check must NOT return `contradicts_belief`. Expected: `ok` (or `uncertain` if the LLM cannot resolve, never a false contradiction). This test would have failed under the Rev 3 design, which declared these contradictory.
- T-K14: **Different entities, same topic (B3, Rev 4)** — `belief: "works at Samsonite"` vs candidate "quit the warehouse". Both map to employment, but "warehouse" is a generic term that does not establish entity identity with Samsonite. Without an entity-resolution link, these are *compatible* (possibly different workplaces). Expected: candidate generated, verdict NOT `contradicts_belief`. The check must require entity identity before declaring contradiction.
- T-K15: **Unrelated state change (B3, Rev 3)** — "quit smoking" vs `belief: "works at Samsonite"` → NO contradiction (different topics: health vs employment). Tests that state-change verbs don't over-fire.
- T-K16: **Uncertain recall (B3, Rev 3)** — candidate with unmapped topic ("florpingle the zorg") → `topic_uncertain=true`, candidate set widens to slot-wide, `recall_uncertain=true` in result, verdict is `uncertain` (never false `ok`).
- T-K17: **Genuine negation, same entity (B3, Rev 4)** — `belief: "works at Samsonite"` (0.95, stated) vs candidate "I don't work at Samsonite anymore". Same entity (Samsonite), incompatible states (works vs doesn't work). Expected: `contradicts_belief` + `suppress`. This is the positive control for the entity-identity rule.
- T-K18: **Explicit job transition (B3, Rev 4)** — `belief: "works at Samsonite"` vs candidate "quit Samsonite, started at Amazon last week". The quit explicitly terminates the Samsonite state; the Amazon start asserts a new one; X≠Y. Expected: `contradicts_belief` (via explicit-transition rule, deterministic — no LLM needed) + the old belief invalidated with `replaced_by` → new "works at Amazon" entry.
- T-K19: **Different employers, no transition (B3, Rev 4)** — `belief: "works at Samsonite"` vs candidate "picked up a shift at Amazon". No quit/termination language; both employments could coexist. Expected: candidate generated (topic overlap), verdict NOT `contradicts_belief` — at most `uncertain` + `flag_for_review`. The system must not declare contradiction from two employer names alone.
- T-K20: **Constraint cap exemption (B8, Rev 4)** — seed 30 current `constraint` entries + 30 belief entries. Run `knowledgeCheck()` with a candidate matching one constraint. Verify: ALL 30 constraints were evaluated (the violated one is cited), AND the belief candidate set was capped at 25. The safety contract holds regardless of candidate volume.
- T-K9: **Proactive fail-closed (B9)** — mocked check timeout → `defer` + logged.
- T-K10: **Conversational fail-open (B9)** — mocked check timeout → proceeds.

**Validation & migration:**
- T-V1: Malformed JSON refs rejected.
- T-V2: Cross-space node ref rejected.
- T-V3: Stale evidence annotated (`evidence_status`), not deleted.
- T-V4: Withdrawn evidence auto-invalidates inferred entry, flags stated entry.
- T-V5: **Dangling reference (B6, Rev 3)** — `episode_enrichments` insert with `episode_id` pointing to nonexistent episode → `ValidationError`, transaction rolled back.
- T-V6: **Cross-space reference (B6, Rev 3)** — `user_model.replaced_by` pointing to an entry in a different space → `ValidationError`, rejected even though the row exists.
- T-V7: **Superseded reference (B6, Rev 3)** — `episode_enrichments.superseded_by` pointing to an already-superseded version → `ValidationError` (`already_superseded`).
- T-M1: Fresh DB — BOOTSTRAP_SQL creates all five tables with expected schema.
- T-M2: **Migration equivalence (B8, Rev 3)** — `assertSchemaEquivalent(freshDb, migratedDb)` compares columns (PRAGMA table_info), indexes (PRAGMA index_list + index_info), CHECK constraints (parsed from sqlite_master), and UNIQUE behavior (behavioral: duplicate inserts rejected on both paths). All five tables.
- T-M3: **Migration assertion** — missing table/column after migration → loud throw.

---

## 10. Non-goals (explicitly OUT of W2)

1. **No W3 consolidation job.** W2 provides `enrichEpisode()` and `updateUserModel()`; W3 schedules them.
2. **No values table / behavioral ledger (W4).** `desire`/`constraint` slots exist; revealed-preference learning waits for W4.
3. **No causal entries (W4).** Episodes carry narrative causality; structured causal triples are W4.
4. **No agent autobiography (W5).** `agent_action` episodes are raw material for W5's synthesis.
5. **No wisdom gate (W6).** `knowledgeCheck()` is W2's contribution; the full gate is W6.
6. **No galaxy visualization changes (W7).** W2 is backend-only. The timeline "view" is the `getEpisodes()` API (§3.9).
7. **No hot-path inferred user-model writes.** Schema supports the origin; W2 ships zero inference rules.
8. **No model-driven deletion.** Only user-approved forget requests (§3.7).
9. **No higher-order theory of mind.** First-order only; higher-order content rejected at write time.
10. **No transcript storage.** `source_transcript_ref` is an opaque pointer.
11. **No objective truth-tracking.** The user model tracks mental states, not reality. (B8.)

---

## 11. Acceptance criteria

W2 is done when:

1. **Episodes:** a conversation produces a captured episode (template summary, no LLM on hot path); a significant episode gets enriched in background (versioned record, provenance labels); `getEpisodes()` serves the timeline in order with pagination.
2. **Immutability holds:** no API path mutates capture columns; enrichment versions chain correctly; the T-E4 integrity test passes.
3. **User model:** an explicit self-statement creates a `stated` entry at 0.95 (via the trigger boundary); reads show current beliefs with evidence, confidence, and evidence_strength; a correction invalidates via `replaced_by` without deleting.
4. **Knowledge check:** T-K5 and adversarial T-K6/K7/K8 pass; proactive fail-closed and conversational fail-open verified (T-K9/K10).
5. **Forget contract:** T-E11 passes — approved request propagates correctly through all stores in one transaction.
6. **No regressions:** `npm run typecheck` + `npm test` pass; `user_persona` consumers unaffected; W1's temporal guarantees intact.
7. **Review:** passes the same gauntlet as W1 (design review → implementation review → test gate → merge approval).

---

## 12. Open questions — resolved per review

| # | Question | Decision (applied) |
|---|---|---|
| 1 | 15-emotion vocabulary size | **Keep.** `not_reported`/NULL always valid; never force a label. Episode `emotion` labels and `emotion_state` slot rows are separate representations (one describes an event, the other a dated state). |
| 2 | Typed `evidence_ids` | **Keep typed references** (`{type, id}`), with `validateEvidenceRefs()` shape + cross-space rules (§3.8). |
| 3 | Knowledge-check cost / 0.82 threshold | **Bounded hybrid, no similarity gate.** Recall-first candidate generation (§6.2), deterministic rules before LLM, ≤5 LLM calls, 15s budget. |
| 4 | Galaxy/session episodes in W2 | **Defer to W7.** W2 captures substantive agent-loop interactions only. |
| 5 | `user_persona` backfill | **Assisted, user-reviewable only.** W3 may propose; each needs evidence bar + explicit confirmation. Never bulk-imported, never auto-`stated` (INV-PERSONA-1). |

---

## Appendix: How W2 connects to the other wisdom phases

```
W1 (temporal truth)          W2 (episodes + user model)         W3+ (consolidation, values,
  facts carry when              episodes carry what               causal, autobiography,
  they were true;               happened (immutable capture       gate, galaxy)
  supersession, not             + versioned interpretation);
  deletion                      the user model carries what
        │                       he believes — evidence-backed,
        │                       correctable, with confidence
        │                       ≠ evidence quality ≠ truth
        └──────────┬─────────────────────┘
                   ▼
         Every fact (W1) can cite the
         episodes (W2) it was distilled from.
         Every user-model entry (W2) respects
         the temporal validity (W1) of its evidence.
         Forgets (W2 §3.7) propagate through
         both layers in a single transaction.
```

---

*Revision 4 prepared 2026-10-19. Addresses ChatGPT's round 3 P0 (B1: forget/worker race — fence revocation + `forgotten_at` in commit predicate + both orderings tested; B2: `topic_labels` column in `user_model` DDL; B3: topic overlap is candidate-only — entity identity + incompatible states required, T-K13/T-K14 replaced with correct semantics; B4: content-free forget audit — `target_query` nulled at approval, `scope_topics` replaces `scope_keywords`), P1 (B5: `not_reported` reconciled in allowed-label table; B6: retry predicate standardized to `> 3`; B7: space-timezone quota dates via bound parameter; B8: constraints exempt from candidate cap; B9: canonical tombstone `"[redacted per forget request #N]"` everywhere). Test plan expanded to ~70 tests, all exercising actual transactional predicates and worker commit paths per the user's guardrail. Awaiting round 4 review.*
