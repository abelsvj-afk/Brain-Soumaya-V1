# W2 Design — Episodes + User Model

**Status:** Revision 2 (addressing ChatGPT's design review of the Rev 1 draft)
**Depends on:** W1 (temporal truth) — Revision 7
**Scope:** Episodic memory (C1) + Theory of Mind user model (C3) from the wisdom-layer research
**Surfaces:** Shared backend (`packages/server`) — web app and Telegram both benefit

**Revision history:**
- Rev 1 (commit `dd64a82`, branch `w2-design`): initial draft — Tulving episodes, 6-slot user model, anti-weak-inference rules, knowledge check.
- Rev 2 (this document): addresses ChatGPT's review — 5 P0 blockers (B1–B5), 5 P1 items (B6–B10), 5 additional gaps (11–15), and applies the 5 open-question decisions. Structural changes from Rev 1: episodes split into immutable `episodes` + versioned `episode_enrichments`; `user_model` gains stable `id`, `replaced_by`, and `evidence_strength`; new `forget_requests` table and formal forget/deletion contract; recall-oriented knowledge-check candidate generation; explicit enrichment lifecycle; separated confidence/evidence/truth semantics.

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

6. **Episodes are append-only at capture; enrichment is versioned, never destructive.** The captured event (§3.2) is immutable. Interpretation lives in separate, versioned enrichment records (§3.3) that can be superseded but never rewrite the capture. (Resolves B1.)
   - *Invariant INV-EP-1.* Enforcement: no UPDATE path exists for `episodes` capture columns; enrichment writes go to `episode_enrichments`. Test T-E4.

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

  -- Enrichment lifecycle pointer (B6)
  enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending','processing','completed','failed_retryable','failed_permanent')),
  enrichment_attempts INTEGER NOT NULL DEFAULT 0,
  enrichment_lease TEXT,           -- ISO timestamp: worker claim expiry (NULL = unclaimed)
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

**Mutable columns** (lifecycle only, never content): `enrichment_status`, `enrichment_attempts`, `enrichment_lease`, `enriched_at`, `forgotten_at`. These track *processing state*, not *event content*. The event content itself is immutable.

**Why no `valid_to`/`superseded_at` on episodes:** an episode is a record *of* an event, not a claim *about* the world. The event happened when it happened (`occurred_at`); the system learned about it when it recorded it (`recorded_at`). There is no "stopped being true" for a lived event — October 16 happened. If the *record* is wrong, the correction pattern (append + `corrects_episode_id` link) preserves both the error and its correction, exactly as W1's `corrections` table does for facts.

### 3.3 Schema: `episode_enrichments` (versioned interpretation)

```sql
CREATE TABLE episode_enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,     -- FK → episodes.id (application-validated, cf. W1)
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

  -- Field-level provenance labels (B5) — JSON object mapping field → label.
  -- Labels: 'direct_quote' | 'explicit' | 'inferred' | 'generated' | 'not_reported'.
  -- Example: {"detail": "generated", "emotion": "explicit", "place": "not_reported"}
  field_provenance TEXT NOT NULL DEFAULT '{}',

  -- Retrieval
  embedding BLOB,                  -- sqlite-vec embedding of summary + detail (NULL until computed)

  -- Version lifecycle
  superseded_by INTEGER,           -- FK → episode_enrichments.id (newer version); NULL = current
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  UNIQUE (episode_id, version)
);
CREATE INDEX idx_enrichments_episode ON episode_enrichments(episode_id, version);
CREATE INDEX idx_enrichments_current ON episode_enrichments(episode_id) WHERE superseded_by IS NULL;
```

**Versioning rules:**
- The first enrichment creates `version = 1`. Re-enrichment (model upgrade, correction of the interpretation) creates `version = N+1` and sets the old row's `superseded_by`.
- Readers use `WHERE superseded_by IS NULL` (current interpretation). History readers can walk the version chain.
- `linkEpisodeToNodes()` (B1) appends to the *current enrichment record's* `source_node_ids` — never to the episode row. If no enrichment record exists yet, it creates a minimal `version = 1` record with only `source_node_ids` populated (all interpretive fields NULL / `not_reported`).

**Field provenance semantics (B5):**

| Label | Meaning | May feed user-model evidence? |
|---|---|---|
| `direct_quote` | Verbatim user words from the interaction | Yes |
| `explicit` | User stated it plainly (paraphrase-safe) | Yes |
| `inferred` | System interpretation from signals | Only as `inferred`-origin entries (capped 0.69) |
| `generated` | Narrative connective tissue (transitions, scene-setting) | **No** — quarantined from evidence pipeline |
| `not_reported` | The field was not present in the source interaction | N/A (field is NULL) |

**Formal invariants:**
- *INV-ENRICH-1:* No `generated`-labeled content may appear in `evidence_ids` of any user-model entry. Enforcement: `updateUserModel()` / `recordStated()` validate evidence provenance; enrichment records expose `evidenceSafeFields()`. Test T-E12.
- *INV-ENRICH-2:* `detail`, `emotion`, `place` may be NULL. NULL means "not reported," never "not yet enriched." The enrichment worker writes explicit `not_reported` provenance rather than leaving fields ambiguously empty. Test T-E13.
- *INV-ENRICH-3:* Enrichment must not invent sensory details, feelings, motivations, or meaning absent from the source interaction. Enforcement: the enrichment prompt includes the verbatim interaction excerpt and a "grounding checklist"; the application validates that `direct_quote` fields are substrings of the source. Test T-E14 (adversarial: enrichment of a terse interaction must not produce vivid invented detail).

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

**What capture checks first (B2):** the forget-list. If the interaction's content matches an active forget request (§3.7), capture writes a tombstone row (`summary`: `"[redacted per forget request]"`, `forgotten_at` set) rather than the content. The tombstone preserves the *fact that an interaction occurred* (for timeline continuity) without preserving its content.

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
Worker claim (atomic, cf. Phase 2 outbox pattern):
  UPDATE episodes
  SET enrichment_status = 'processing',
      enrichment_lease = <now + 10 min>,
      enrichment_attempts = enrichment_attempts + 1
  WHERE id = ?
    AND enrichment_status IN ('pending', 'failed_retryable')
    AND (enrichment_lease IS NULL OR enrichment_lease < <now>)
    AND (SELECT COUNT(*) FROM episodes
         WHERE space_id = ? AND date(enriched_at) = date('now')
           AND enrichment_status = 'completed') < <daily_cap>;
```

- **Atomicity:** the claim is a single UPDATE with the lease check in the WHERE clause. Two workers cannot claim the same episode. A crashed worker's lease expires in 10 minutes; the episode returns to the claimable pool.
- **Daily cap:** enforced in the claim query itself (count of today's completions < cap), not as a separate check-then-act. `space_meta.episode_enrich_daily_cap` (default 20), `space_meta.episode_enrich_used_today` maintained for observability. No TOCTOU: the cap check and the claim are one statement.
- **Retry:** `failed_retryable` (LLM timeout, embedding service down) → reclaimed after lease expiry, up to 3 attempts (`enrichment_attempts`). After 3 failures → `failed_permanent` (logged, surfaced in diagnostics, never retried automatically).
- **Crash safety:** if the worker crashes mid-enrichment, no partial enrichment record is visible — the enrichment INSERT and the episode status update happen in a single transaction. Either both commit (status → `completed`, `enriched_at` set) or neither does (lease expires, another worker retries).
- **Original preserved on failure:** the capture row is never modified by enrichment. A failed enrichment leaves a pristine capture row and a `failed_retryable` status. Retries are idempotent: re-running enrichment for an episode with a `completed` status is a no-op (guarded by status check, tested T-E3).

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
  -- What to forget: one of these selectors must be set
  target_episode_id INTEGER,       -- specific episode
  target_node_id INTEGER,          -- specific node (propagates to derived records)
  target_query TEXT,               -- free-text description ("everything about the trucking job")
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','applied','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  applied_at TEXT
);
```

1. User invokes the `forget` skill (existing). A `forget_requests` row is created (`status='pending'`).
2. The user confirms scope (`status='approved'`). Scope confirmation is required — the system never expands a forget request beyond what was approved.
3. `applyForgetRequest()` executes propagation **in a single transaction**:

| Record | Action | Rationale |
|---|---|---|
| Target episode(s) | `summary`/`detail` redacted to `"[redacted per forget request #N]"`; `embedding` set NULL; `forgotten_at` = now | Content removed; row retained for referential integrity and timeline continuity |
| Enrichment records of target episodes | DELETE (all versions) | Interpretation of forgotten content has no standing |
| Embeddings (vec tables) | DELETE corresponding rows | Forgets must propagate to vector search |
| FTS entries | DELETE corresponding rows | Forgets must propagate to keyword search |
| User-model entries citing the forgotten records as **sole** evidence | `invalid_at` = now, `invalid_reason` = `'evidence_withdrawn'` | The entry's justification is gone; the claim is suspended, not deleted |
| User-model entries with **independent** remaining evidence | Kept; `evidence_ids` pruned of the forgotten refs | The claim survives on its other legs |
| `agent_logs` | Untouched (already content-free: IDs and action names only) | Audit integrity preserved |
| Nodes distilled from forgotten episodes | **Not** auto-deleted. Flagged for user review (surfaced as an inquiry: "this fact came from something you asked to forget — keep or remove?") | Deleting facts the user may still rely on is destructive; the user decides |

4. `status='applied'`, `applied_at` set. The request row itself is permanent (audit trail of what was forgotten and when).

**Limits (stated honestly):**
- Forgets apply to *this system's* stores. They do not reach backups, already-sent messages (Telegram/_digest history), or the user's own memory.
- Vector/FTS deletion is best-effort within the transaction; a crash mid-`applyForgetRequest` rolls back the entire transaction (atomicity guaranteed by the single-transaction design).
- `target_query` (free-text scope) is resolved to specific episode/node IDs *before* approval and listed for confirmation. The system never interprets scope silently.

**Capture-time precedence** (already in §3.5): if content matches an *applied* forget request's scope, capture writes a tombstone instead of content.

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

  valid_at TEXT NOT NULL,          -- when this entry became the model's belief (canonical ISO UTC)
  invalid_at TEXT,                 -- when superseded (NULL = current). Cf. W1 bi-temporal pattern.
  invalid_reason TEXT CHECK (invalid_reason IN (
    'superseded','corrected_false_belief','evidence_withdrawn','expired','user_override'
  )),
  replaced_by INTEGER,             -- FK → user_model.id (the superseding entry); NULL if none (B4)

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

### 6.2 Recall-oriented candidate generation (B3)

The Rev 1 design gated candidates on embedding similarity > 0.82. That misses contradictions with low surface similarity. Rev 2 uses **recall-first, rank-second**:

**Stage 1 — candidate generation (recall-oriented, no similarity threshold):**
1. Extract topics/entities from the candidate (existing extraction: noun phrases, named entities, temporal markers).
2. Query user-model rows (`invalid_at IS NULL`, slots `belief`/`knowledge`/`constraint`) matching ANY of:
   - Topic/entity overlap with the candidate (keyword + entity match, not embedding).
   - **State-change patterns:** the candidate contains a state-change verb ("started", "quit", "no longer", "now", "stopped") → pull all same-topic entries regardless of similarity. ("Started Samsonite" pulls "in between jobs" via the shared topic `job`/`employment`, not via vector similarity.)
   - **Negation patterns:** the candidate negates a proposition ("don't", "never", "not", "no longer") → pull entries asserting the positive form.
   - **Slot-wide constraint pull:** all current `constraint` entries are always candidates (constraints are few and high-stakes; no filtering).
3. Cap: max 25 candidates (deterministic ordering: constraints first, then by confidence desc).

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
CREATE TABLE IF NOT EXISTS user_model (...);
CREATE TABLE IF NOT EXISTS forget_requests (...);
CREATE INDEX IF NOT EXISTS ...;
```
Idempotency: `IF NOT EXISTS` makes repeated startups safe. A post-migration assertion verifies all four tables exist with the expected columns (PRAGMA table_info check, throwing on mismatch — same loud-failure pattern as W1's timestamp assertion).

**Why both:** BOOTSTRAP_SQL is the schema of record (single source of truth for what the tables look like). The migration path replicates it for databases created before W2. The T-M1/T-M2 tests pin that both paths produce identical schemas (PRAGMA comparison).

Drizzle definitions in `db/schema.ts` for all four tables (matching the W1 pattern: fresh-schema defaults via `sql` template, nullable where SQLite ALTER limits require).

### 8.2 New module: `agent/episodic.ts`

| Function | Purpose |
|---|---|
| `captureEpisode(handle, spaceId, input)` | Hot-path capture (template summary, free). Non-blocking, never throws. Checks forget-list first. |
| `isSignificant(interaction)` | Significance filter (pure function, unit-tested). |
| `claimEnrichment(handle, spaceId)` | Atomic worker claim (B6). Returns episode id or null. |
| `enrichEpisode(handle, spaceId, episodeId)` | Background enrichment (LLM). Writes versioned enrichment record in-transaction. Idempotent. |
| `getEpisodes(handle, spaceId, opts)` | Timeline backend API: recency/kind/provenance, cursor pagination. |
| `episodeSearch(handle, spaceId, queryVec, k)` | Vector + canonical-scorer episode search. |
| `linkEpisodeToNodes(handle, episodeId, nodeIds)` | Appends to current enrichment's `source_node_ids` (never the episode row). |
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

---

## 9. Test plan

**Episodes:**
- T-E1: `captureEpisode()` writes valid row, template summary, no LLM, no throw on DB error.
- T-E2: `isSignificant()` — first-time → true; heartbeat → false; correction → true; small talk → false.
- T-E3: `enrichEpisode()` idempotent — run twice, one version-1 record, no duplicate.
- T-E4: **Immutability (B1)** — attempt to UPDATE capture columns via API: no such path; direct SQL UPDATE of `summary` detected by integrity test (documents the invariant; enforcement is API-shaped).
- T-E5: `episodeSearch()` — similar finds, unrelated doesn't, recency rerank prefers recent (canonical scorer).
- T-E6: `source_node_ids` on enrichment record; "episodes for node X" join works.
- T-E7: Space isolation.
- T-E8: **Enrichment lifecycle (B6)** — claim → processing → completed; crashed worker (expired lease) → reclaimable; 3 failures → `failed_permanent`.
- T-E9: **Daily cap (B6)** — cap=2, three significant episodes → third stays `pending` until next day.
- T-E10: Correction episode appends with `corrects_episode_id`; original unmutated.
- T-E11: **Forget propagation (B2)** — approved request redacts episode, deletes enrichments/embeddings/FTS, invalidates sole-evidence user-model entry, prunes multi-evidence entry.
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

**Knowledge check:**
- T-K1: 0.95 stated belief contradiction → `contradicts_belief` + `suppress`.
- T-K2: 0.50 consolidated contradiction → `rephrase_as_question`.
- T-K3: Restated knowledge → `already_known` + `suppress`.
- T-K4: Constraint violation → `contradicts_belief` with constraint cited.
- T-K5: Original sin — "in between jobs" vs "works at Samsonite" → suppressed, logged.
- T-K6: **Adversarial recall (B3)** — "you are unemployed" vs "started at Samsonite" (low similarity) → contradiction detected via state-change pattern.
- T-K7: **Negation (B3)** — "you don't work weekends" vs "works Saturdays" → contradiction.
- T-K8: **Temporal succession (B3)** — old belief + newer superseding fact → identified as succession, not contradiction.
- T-K9: **Proactive fail-closed (B9)** — mocked check timeout → `defer` + logged.
- T-K10: **Conversational fail-open (B9)** — mocked check timeout → proceeds.

**Validation & migration:**
- T-V1: Malformed JSON refs rejected.
- T-V2: Cross-space node ref rejected.
- T-V3: Stale evidence annotated (`evidence_status`), not deleted.
- T-V4: Withdrawn evidence auto-invalidates inferred entry, flags stated entry.
- T-M1: Fresh DB — BOOTSTRAP_SQL creates all four tables with expected schema.
- T-M2: Existing DB — migration path creates tables idempotently; PRAGMA schemas match fresh path.
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

*Revision 2 prepared 2026-10-19. Addresses ChatGPT's P0 (B1–B5), P1 (B6–B10), gaps 11–15, and all 5 open-question decisions. Awaiting re-review.*
