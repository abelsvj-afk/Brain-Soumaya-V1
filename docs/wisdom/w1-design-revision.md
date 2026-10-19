# W1 Design Revision — Temporal Truth
### Soumaya Second Brain · Wisdom Layer Phase W1
### Status: **Revision 7** — Type 3 preference-override `endsValidity` flag (2026-10-19)

> **Core principle (the foundation everything else depends on):** *A memory can stop being current without its history being rewritten, and a correction must not create false historical truth.*

---

## 0. What changed in Revision 7

Implementation review (commit `5ea0d9e`) surfaced an ambiguity in Type 3: when a preference override carries a replacement node, the code was conservative and never closed `valid_to` — but the design said it should "be treated as Type 1" when the user asserts the fact ended. The reviewer decided: **do not infer — add an explicit flag.**

| # | Change | Trigger |
|---|---|---|
| 1 | **New `endsValidity` flag on Type 3.** `SupersedeInput.newNode.endsValidity?: boolean` distinguishes the two meanings of a preference override with a replacement node. | Implementation review |
| 2 | **§2.2 Type 3 rewritten.** Documents both meanings, the flag, and the "never fabricate `valid_to`" rule. | Implementation review |
| 3 | **New tests T-PO-1/2/3.** Cover silence mode, validity-ending mode (with and without known `validFrom`), and the null-replacement no-op. | Implementation review |

---

## 0a. What changed in Revision 6

The sign-off review found one SQL correctness issue: §2.3's correction-history subquery used `ORDER BY` on the aggregate query, which does not reliably order the rows consumed by `json_group_array`. The timeline was not guaranteed to be chronological.

| # | Change | Trigger |
|---|---|---|
| 1 | **Deterministic ordering via inner subquery.** The `correction_history` JSON array is now built from an inner subquery with `ORDER BY corrected_at ASC, id ASC`, then aggregated. The `id` tiebreaker guarantees deterministic order even for same-timestamp events. | JSON ordering blocker |
| 2 | **T-HIST-1b strengthened.** Now asserts the `correction_history` array order explicitly, including a same-timestamp second event. | JSON ordering blocker |

**This document is design only. No implementation is authorized by this document.**

---

## 0a. What changed in Revision 5

The sign-off review found one remaining correctness issue: §2.3's historical query contradicted itself. It filtered out superseded rows (correct for an as-of belief query) but then claimed the Oct 11 query returns the row with `was_corrected_as_false = 1` — impossible, since the row is excluded by the WHERE clause. Additionally, the `LEFT JOIN` to corrections could duplicate node rows when multiple false-belief events exist.

| # | Change | Trigger |
|---|---|---|
| 1 | **Two separate query contracts.** §2.3 now defines Contract 1 (as-of belief query: "what facts were believed current at time T?") and Contract 2 (correction-history query: "show me this node's full history including all correction events"). Each has its own SQL, its own purpose, and its own test. The old combined query is removed. | Query-contract blocker |
| 2 | **EXISTS instead of LEFT JOIN for correction status.** Contract 2 uses `EXISTS (...)` so multiple correction events can never duplicate a node row. The full event timeline is returned as a `correction_history` JSON array via `json_group_array`. | Query-contract blocker |
| 3 | **T-HIST-1 split into T-HIST-1a / T-HIST-1b.** 1a tests the as-of belief contract (Oct 5 → believed true; Oct 11 → excluded as not current). 1b tests the correction-history contract (full event timeline for the node regardless of as-of time). | Query-contract blocker |

**This document is design only. No implementation is authorized by this document.**

---

## 0a. What changed in Revision 4

The round-4 sign-off review found three remaining blockers (B1–B3). All are narrow, focused fixes — no structural redesign.

| # | Change | Trigger |
|---|---|---|
| 1 | **T-PAR-1 revised to behavioral parity.** Fresh and migrated schemas intentionally differ (`recorded_at` has an expression default in fresh `CREATE TABLE`; nullable without default in migrated `ALTER TABLE`). The old test demanded identical `PRAGMA table_info` — a contradiction. The test now verifies identical *behavior*: every insert path populates `recorded_at` on both schemas, queries return identical results, and no NULL `recorded_at` exists after migration + normal operation. The schema asymmetry is documented as a known, accepted difference with a behavioral guarantee. | B1 |
| 2 | **Vector retrieval honesty about the safety bound.** The old doc claimed valid results are "never lost" — too strong, because the loop can stop at `MAX_CANDIDATES = 2000` without finding k valid results. Now: exhaustion is defined precisely (empty page = exhausted; a short non-empty page is NOT proof of exhaustion — the loop continues). When the safety bound is hit, the function returns whatever valid results were found and emits a queryable diagnostic (`vecSearchTruncated`), without claiming completeness. New test T-RTR-3 covers the bound-hit case. | B2 |
| 3 | **One shared timestamp per supersession operation.** The old design generated `superseded_at`, `recorded_at` (new row), and `corrected_at` (correction event) via three independent `strftime('now')` calls — they could differ by milliseconds, breaking as-of query consistency at boundaries. Now `supersede()` generates one `opTime = new Date().toISOString()` in application code and passes it explicitly to all three writes in the transaction. New test T-TIME-5 asserts string equality across all three. | B3 |

**This document is design only. No implementation is authorized by this document.**

---

## 0b. What changed in Revision 3

The round-3 gauntlet found four blockers (B1–B4) plus two additional checks. Every one is addressed below. The structural changes from Revision 2:

| # | Change | Trigger |
|---|---|---|
| 1 | **Migration order fixed**: normalize `created_at` to canonical format FIRST, then backfill `recorded_at`. Post-migration assertion that every temporal timestamp matches the canonical regex. | B1 |
| 2 | **`recorded_at` migration uses nullable column** (no expression DEFAULT — SQLite rejects parenthesized expression defaults on `ALTER TABLE ADD COLUMN`). Verified against better-sqlite3 12.11.1. DB-level backstop only in fresh-schema `BOOTSTRAP_SQL`; migrated schemas rely on application enforcement + test. Strategy documented with rationale. | B2 |
| 3 | **`never_true` column REMOVED.** Replaced by a `corrections` event table. Setting a boolean on the row mutated history (an Oct 5 as-of query would see `never_true=1` set on Oct 10). Corrections are now append-only events; `never_true` is derived, not stored. Historical as-of queries reconstruct belief state correctly. | B3 |
| 4 | **Vector search uses iterative over-fetch** with adaptive widening. The single-shot bounded query could lose valid results when superseded nodes filled all candidate slots. New loop fetches until k valid results or exhaustion, with a safety bound. | B4 |
| 5 | All `CURRENT_TIMESTAMP` references in SQL examples replaced with canonical UTC ISO format. | Addl. check 1 |
| 6 | Cascade query direction fixed (`target = ?`, not `source = ?`). Cascade **disabled by default** in W1 — explicit opt-in only after edge semantics are verified. | Addl. check 2 |

**This document is design only. No implementation is authorized by this document.**

---

## 0c. What changed in Revision 2 (retained)

The round-2 gauntlet found five blockers (B1–B5) plus six additional issues. Every one is addressed below. The structural changes from Revision 1:

| # | Change | Trigger |
|---|---|---|
| 1 | **Canonical timestamp** defined: ISO 8601 UTC `YYYY-MM-DDTHH:MM:SS.sssZ`, app-generated; DB `strftime` default as backstop; existing `created_at` normalized by migration | B1 |
| 2 | **`recorded_at` gets a DB-level DEFAULT** (`strftime` ISO 8601 UTC); full insert-path audit | B2 |
| 3 | **Three distinct correction types** (factual / false-belief / preference-override); a correction of a never-true fact sets NO valid-time interval. *(Revision 3: the `never_true` column was replaced by the `corrections` event table — see §2.4)* | B3 |
| 4 | **Explicit supersession trigger contract**: what the LLM may propose vs. what code must verify; W1 auto-triggers limited to explicit user corrections and direct user-provided contradictions | B4 |
| 5 | **Supersession filter pushed into candidate selection** (vec.ts JS filter + fts.ts SQL WHERE); per-method current-vs-historical contracts; graph traversal rule | B5 |
| 6 | `superseded_by` stays a plain INTEGER (application-validated, justified); 8 new acceptance tests; rollback defined as feature-flag-off (degraded state, documented) | Additional issues |

**This document is design only. No implementation is authorized by this document.**

---

## 1. Canonical timestamp representation (fixes B1)

### 1.1 The problem

The existing database defaults `created_at` to SQLite's `CURRENT_TIMESTAMP`, which produces `YYYY-MM-DD HH:MM:SS` (space separator, no timezone suffix, no milliseconds). Application code uses `new Date().toISOString()`, which produces `YYYY-MM-DDTHH:MM:SS.sssZ`. These are **different strings for the same instant**, and lexicographic (text) comparison is not chronological across the two formats:

```
"2026-10-19 14:30:00"  <  "2026-10-19T14:30:00.000Z"   // space (0x20) < T (0x54) — correct by accident
"2026-10-19T14:30:00Z" <  "2026-10-19T14:30:00.000Z"   // WRONG: Z (0x5A) > . (0x2E), same instant compares unequal
```

Any mixed-format comparison is unreliable. W1 defines one canonical form and normalizes everything to it.

### 1.2 The canonical form

**All temporal columns use ISO 8601 UTC: `YYYY-MM-DDTHH:MM:SS.sssZ`.**

- Generated in **application code** via `new Date().toISOString()` (already the repo convention — see `NodesRepo.create()` line 112: `lastTendedAt: new Date().toISOString()`).
- The database DEFAULT for new temporal columns is the backstop: `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, which produces byte-identical format to `toISOString()` (`%f` yields `SS.sss`).
- Lexicographic comparison == chronological comparison for this format. Always. (Fixed-width, UTC, `Z`-terminated.)

### 1.3 Normalizing existing data

**Migration** (in `migrateSchema()`, after adding columns):

```sql
-- Normalize existing created_at from 'YYYY-MM-DD HH:MM:SS' to 'YYYY-MM-DDTHH:MM:SS.sssZ'.
-- strftime parses the old SQLite format correctly.
UPDATE nodes
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE created_at NOT LIKE '%T%';

-- Same for edges, agent_logs, and any other table with CURRENT_TIMESTAMP defaults.
UPDATE edges
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE created_at NOT LIKE '%T%';
```

**`NodesRepo.create()` change:** explicitly set `createdAt: new Date().toISOString()` instead of relying on the SQLite `CURRENT_TIMESTAMP` default. This prevents new rows from being written in the old format. (The SQLite default remains as a backstop for raw-SQL inserts, but all application paths use the canonical form.)

**Invariant going forward:** every timestamp written by application code uses `toISOString()`. Every DB default uses `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`. The two produce identical strings.

### 1.4 Date-only values

When a fact's valid time is known only to day precision (e.g., user says "I started the Samsonite job on Oct 8"):

- `valid_from` = `2026-10-08T00:00:00.000Z` (midnight UTC on that date).
- Rationale: day-precision is the finest granularity the user provided; midnight UTC is the unambiguous canonical encoding. The system does not invent a time of day.
- If the user provides a time ("started at 8am"), encode it with the space's timezone converted to UTC. (Timezone conversion uses the space's `timezone` preference from `space_meta`, default `America/New_York`.)

### 1.5 Test: timestamp consistency (new, from review)

```
T-TIME-1: Mixed-format regression
  GIVEN rows with created_at in old format ("2026-10-19 14:30:00") and new format
  WHEN the normalization migration runs
  THEN all rows have created_at matching /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  AND ordering by created_at is chronological

T-TIME-2: Same-day boundaries
  GIVEN valid_from = "2026-10-08T00:00:00.000Z"
  WHEN querying "what's true now" at "2026-10-08T00:00:00.000Z" exactly
  THEN the row passes (valid_from <= now, inclusive)

T-TIME-3: Timezone offsets
  GIVEN user in America/New_York says "started at 8am Oct 8"
  WHEN encoded
  THEN valid_from = "2026-10-08T12:00:00.000Z" (EDT = UTC-4)

T-TIME-4: Historical dates
  GIVEN valid_from = "2021-01-01T00:00:00.000Z" (Chewy job)
  WHEN comparing against now
  THEN chronological ordering is correct (no string-comparison artifacts)

T-TIME-5: Shared operation timestamp (new, from sign-off review B3)
  GIVEN a supersession of node A by node B (Type 1)
  WHEN supersede() completes
  THEN A.superseded_at === B.recorded_at === corrections.corrected_at
    (string equality — all three are the single shared opTime)
  AND a direct SQL query confirms no millisecond drift between the three values
```

---

## 2. Bitemporal schema (Revision 1 §1, corrected)

### 2.1 Columns

| Column | Type | Nullable | Default | Semantics |
|---|---|---|---|---|
| `valid_from` | TEXT | YES | NULL | When this fact became true in the real world (canonical timestamp). NULL = unknown. |
| `valid_to` | TEXT | YES | NULL | When this fact stopped being true. NULL = still true (or unknown end). |
| `recorded_at` | TEXT | YES | NULL | When the system recorded this row. Immutable. Set explicitly by application code; backfilled from `created_at` for legacy rows (see §9.2). Nullable in the migration because SQLite cannot use expression defaults on `ALTER TABLE ADD COLUMN` (see §9.1); NOT NULL enforced by application invariant + test, not by DB constraint. |
| `superseded_at` | TEXT | YES | NULL | When this row was superseded. NULL = current. This is a **transaction-time** marker (when the system changed its belief), not a rewrite of valid time. |
| `superseded_by` | INTEGER | YES | NULL | Node id that replaced this row. Plain INTEGER, application-validated (see §7). |
| `supersede_reason` | TEXT | YES | NULL | `correction` \| `false_belief` \| `update` \| `user_override`. NULL if not superseded. Denormalized convenience; the `corrections` table (§2.4) is authoritative for correction semantics. |

**Why no `never_true` column (Revision 3, fixes B3):** Revision 2 stored `never_true` as a boolean on the row. This mutates history: if the system records "car insurance $200/mo" on Oct 1 and the user corrects it as never-true on Oct 10, setting `never_true=1` on the row means an as-of query for Oct 5 returns `never_true=1` — falsely implying the system already knew it was false on Oct 5. The correct belief state on Oct 5 was "believed true." A mutable boolean cannot represent "believed true then, corrected as false later." Corrections are **events**, not row attributes. See §2.4.

**Constraint (application-enforced, documented):** for a false-belief correction (Type 2, §2.2), `valid_from` and `valid_to` MUST remain NULL — no valid-time interval is fabricated. The `supersede()` writer (§5) enforces this; a test asserts it.

### 2.2 The three correction types (fixes B3)

These are **different operations** with different temporal semantics. The writer MUST distinguish them; conflating them is what creates false history.

**Shared operation timestamp (Revision 4 — fixes sign-off B3):** every supersession operation generates ONE canonical UTC timestamp in application code at the start of `supersede()`:

```typescript
const opTime = new Date().toISOString();  // single timestamp for the whole operation
```

This `opTime` is passed explicitly to ALL three writes in the transaction: the old row's `superseded_at`, the new row's `recorded_at`, and the correction event's `corrected_at`. The database NEVER generates these independently within a single supersession — three separate `strftime('now')` calls could differ by milliseconds, which breaks as-of query consistency at the exact boundary (a historical query for time T must see all three writes as simultaneous). The `<opTime>` references below all denote this single shared value. Test T-TIME-5 asserts string equality across all three. (The DB-level `recorded_at` default remains as a backstop for *other* insert paths — see §9.1 — but `supersede()` always supplies `recorded_at` explicitly.)

**Type 1 — Factual update** (was true, now isn't):
- Trigger: new user-provided fact directly contradicts a current fact's *present* state.
- Example: Oct 1 "between jobs" → Oct 10 "started Samsonite Oct 8."
- Old row: `valid_to = '2026-10-08T00:00:00.000Z'`, `superseded_at = <opTime>`, `superseded_by = <new_id>`, `supersede_reason = 'update'`.
- New row: `valid_from = '2026-10-08T00:00:00.000Z'`, `recorded_at = <opTime>`.
- Correction event in `corrections` table: `correction_type = 'factual_update'`, `corrected_at = <opTime>`, `corrected_by = 'user'`, `superseding_node_id = <new_id>`.
- The old row's valid interval closes cleanly: it *was* true, then it ended.

**Type 2 — False-belief correction** (was never true):
- Trigger: user states the recorded fact was never correct.
- Example: system recorded "car insurance $200/mo" → user says "I don't have a car, never did."
- Old row: `valid_from = NULL`, `valid_to = NULL`, `superseded_at = <opTime>`, `superseded_by = <new_id or NULL>`, `supersede_reason = 'false_belief'`.
- **Correction event** recorded in `corrections` table (§2.4): `correction_type = 'false_belief'`, `corrected_at = <opTime>`, `corrected_by = 'user'`.
- **No valid-time interval is fabricated.** The row's history reads: "believed from `recorded_at` until `superseded_at`, then corrected as false (see correction event)."
- The "never true" status is **derived** from the correction event, not stored on the row: `isNeverTrue(node_id) = EXISTS (SELECT 1 FROM corrections WHERE node_id = ? AND correction_type = 'false_belief')`.
- If the correction asserts a replacement truth ("I take the bus"), the new row is a normal current fact. If not, no new row is created.

**Type 3 — Preference override** (not a factual claim):
- Trigger: user instruction about what to surface, not what's true.
- Example: "stop bringing up trucking."
- **Does NOT touch the temporal columns of any fact.** Trucking memories remain factually current; they are suppressed by a separate mechanism (a `directives` entry or the W6 wisdom gate's suppression rules — out of W1 scope, but W1 must not corrupt factual history to implement a preference).
- A preference override can carry **two distinct meanings**, and the writer MUST NOT infer which one from context. The caller sets the explicit flag `endsValidity?: boolean` on the replacement node input:
  - **Meaning A — Silence** (`endsValidity` false or omitted): "Stop bringing this up." The old fact's validity interval is preserved untouched (`valid_from`/`valid_to` unchanged). The old row is still superseded (a replacement exists and becomes current), but no end date is invented for the old preference/fact. The correction event records `correction_type = 'preference_override'`.
  - **Meaning B — Preference changed** (`endsValidity === true`): "I no longer prefer X; I prefer Y." The old preference's validity explicitly ends. The old row's `valid_to` is closed: use the replacement's `validFrom` if known; if unknown, leave `valid_to = NULL` — **never fabricate a date**. A NULL `valid_to` here means "ended at an unknown time," which is honest. The correction event records `correction_type = 'preference_override'`.
- **Pure silence with no replacement** (`newNode === null`): no supersession occurs at all. The writer logs `supersede_skipped` and throws `SupersessionConflictError`. This is the "stop bringing up trucking" case where there is no new fact to record.
- The old row's `supersede_reason` is `'user_override'` in both Meaning A and Meaning B (when a replacement exists).

### 2.3 Two retrieval contracts: as-of belief vs. correction history (Revision 5 — fixes query-contract blocker)

Revision 4's §2.3 combined two different questions into one query and contradicted itself: it filtered out superseded rows (correct for "what was believed current at time T") but then claimed the Oct 11 query returns the row with `was_corrected_as_false = 1` — impossible, since the WHERE clause excludes it. It also used `LEFT JOIN`, which duplicates node rows when multiple correction events exist.

These are **two distinct contracts** with different SQL, different purposes, and different tests.

#### Contract 1 — As-of belief query: "what facts were believed current at time T?"

```sql
SELECT n.id, n.label, n.content, n.recorded_at, n.superseded_at
FROM nodes n
WHERE n.space_id = ?
  AND n.recorded_at <= ?
  AND (n.superseded_at IS NULL OR n.superseded_at > ?);
```

- No correction join. Superseded rows are correctly excluded — a fact superseded before T was not believed current at T.
- This is the query the digest, chat context builder, and all "what's true" paths use (with T = now).

#### Contract 2 — Correction-history query: "show me this node's full history, including all corrections"

```sql
SELECT n.id, n.label, n.content, n.recorded_at, n.superseded_at, n.superseded_by,
       EXISTS (
         SELECT 1 FROM corrections c
         WHERE c.node_id = n.id
           AND c.correction_type = 'false_belief'
       ) AS was_corrected_as_false,
       (SELECT json_group_array(
          json_object('type', ordered_c.correction_type, 'at', ordered_c.corrected_at,
                      'by', ordered_c.corrected_by, 'reason', ordered_c.reason)
        )
        FROM (
          SELECT c2.correction_type, c2.corrected_at, c2.corrected_by, c2.reason
          FROM corrections c2
          WHERE c2.node_id = n.id
          ORDER BY c2.corrected_at ASC, c2.id ASC
        ) AS ordered_c
       ) AS correction_history
FROM nodes n
WHERE n.space_id = ? AND n.id = ?;
```

- `EXISTS` (not `LEFT JOIN`) for the boolean — multiple correction events can never duplicate the row.
- `correction_history` returns the full event timeline as a JSON array, ordered by correction time then row id (deterministic even for same-timestamp events). Ordering is enforced in an inner subquery before aggregation — `ORDER BY` on the aggregate query itself does not guarantee `json_group_array` input order. For audit/history views only — never for "what's true now" queries.

#### Walkthrough: the car-insurance scenario

- Oct 1: system records "car insurance $200/mo" (`recorded_at = Oct 1`).
- Oct 10: user says "never had a car." Row gets `superseded_at = Oct 10` (shared `opTime`). Correction event: `correction_type = 'false_belief'`, `corrected_at = Oct 10`.
- **Contract 1, as-of Oct 5:** `recorded_at (Oct 1) <= Oct 5` ✓, `superseded_at (Oct 10) > Oct 5` ✓ → row returned, believed true. The system correctly reconstructs the Oct 5 belief state. ✓
- **Contract 1, as-of Oct 11:** `superseded_at (Oct 10) <= Oct 11` → row excluded. Correct — it was not believed current on Oct 11. ✓
- **Contract 2, node history:** returns the row with `was_corrected_as_false = 1` and `correction_history = [{"type":"false_belief","at":"2026-10-10T...","by":"user","reason":"..."}]`. The full story — believed Oct 1–Oct 10, then corrected as false — is visible in one row, with no duplication regardless of how many correction events exist. ✓
- **Current truth query** (`superseded_at IS NULL`): excludes the row entirely. The derived `isNeverTrue()` helper (§2.4) is available for callers that need the false-belief status without a history join.

**Tests T-HIST-1a / T-HIST-1b** (split from T-HIST-1, see §10): 1a asserts the Contract 1 reconstructions (Oct 5 → present/believed-true; Oct 11 → excluded); 1b asserts the Contract 2 history view (single row, `was_corrected_as_false = 1`, `correction_history` array with exactly one event ordered by `corrected_at ASC, id ASC`, no row duplication when a second correction event is added — including a second event with the same timestamp, which must still sort deterministically by `id`).

### 2.4 The `corrections` table (new in Revision 3 — fixes B3)

Corrections are **append-only events**. They are never updated or deleted. Each correction records what happened, when, and why — without mutating the corrected row's historical interpretation.

```sql
-- In BOOTSTRAP_SQL (fresh schema):
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY,
  space_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,              -- the node being corrected
  correction_type TEXT NOT NULL,          -- 'factual_update' | 'false_belief' | 'preference_override'
  corrected_at TEXT NOT NULL              -- canonical timestamp: when the correction was made
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  corrected_by TEXT NOT NULL,             -- 'user' | 'system'
  reason TEXT,                            -- reason code, content-free (no memory text)
  superseding_node_id INTEGER,           -- the replacement node, if any (NULL for pure false-belief)
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_corrections_node ON corrections(node_id);
CREATE INDEX IF NOT EXISTS idx_corrections_space_time ON corrections(space_id, corrected_at);

-- In migrateSchema(): same CREATE TABLE IF NOT EXISTS (no ALTER needed — new table).
```

**Derived helpers** (in `agent/temporal.ts`):
```typescript
// Was this node ever corrected as a false belief?
function isNeverTrue(db: Database, nodeId: number): boolean {
  return db.prepare(
    `SELECT 1 FROM corrections WHERE node_id = ? AND correction_type = 'false_belief' LIMIT 1`
  ).get(nodeId) !== undefined;
}

// Full correction history for a node (for audit / history views).
function getCorrections(db: Database, nodeId: number): Correction[] {
  return db.prepare(
    `SELECT * FROM corrections WHERE node_id = ? ORDER BY corrected_at ASC`
  ).all(nodeId) as Correction[];
}
```

**Why a separate table instead of a row flag:**
1. **As-of correctness** (B3): the row's columns describe its own lifecycle; the correction event describes a *later* judgment about the row. Mixing them in one row conflates two different times.
2. **Multiple corrections**: a node can be corrected, then re-corrected. A single boolean cannot represent a correction history. The table preserves every event.
3. **Audit**: the corrections table IS the audit trail for corrections — no separate logging needed for the "what" (the `agent_logs` entry still records the "who/when/why" of the supersession operation).
4. **No history rewrite**: the original row is never modified except for the `superseded_*` transaction-time pointer. Its `valid_from`/`valid_to`/`recorded_at` are immutable after creation.

---

## 3. Supersession trigger contract (fixes B4)

### 3.1 The boundary

Revision 1 said W1 excludes LLM-based supersession decisions but allowed the agent loop to use an LLM for contradiction detection, without defining the boundary. This section makes it explicit.

**What the LLM may do (advisory only):**
- Propose a candidate supersession: `{ old_node_id, proposed_new_fact, reason, confidence }`.
- Proposals are data, not actions. They are logged to `agent_logs` with `action = 'supersession_proposed'`.
- A proposal **never** mutates the database by itself.

**What code must verify before executing any supersession:**
1. Both the old node and the new fact exist and belong to the same `space_id`.
2. The new fact originates from an **explicit user statement or correction** — not from model inference, not from a retrieved document, not from a tool output. (Source tracking: the agent loop tags facts with `origin: 'user_statement' | 'user_correction' | 'model_inference' | ...`. Only the first two qualify for W1 auto-supersession.)
3. The contradiction is **direct and unambiguous** per §4 Rule 1 (mutually exclusive claims about the same subject at overlapping valid times).
4. No ambiguity flag is set (if the LLM proposal includes `ambiguous: true`, or if Rule 4 in §4 triggers, the supersession does not execute).

**What triggers automatic supersession in W1 — the complete list:**
1. **Explicit user correction:** user says "that's wrong" / "I don't have a car" / "actually it's X." → Type 2 (false-belief) or Type 1 (factual update) depending on whether the old fact was ever true.
2. **Direct factual contradiction from user-provided info:** user provides a new fact that directly contradicts a current fact ("I started at Samsonite" vs. "between jobs"). → Type 1.

**Everything else** — ambiguous contradictions, model-inferred conflicts, contradictions detected in existing data, multi-hop implications — is **logged as `potential_contradiction`** for W3 consolidation review. It is NOT auto-superseded in W1.

### 3.2 Test: model uncertainty cannot supersede (new, from review)

```
T-TRIG-1: Ambiguous LLM inference is blocked
  GIVEN node A "User prefers morning reminders" (current, from behavioral inference)
  WHEN the LLM proposes supersession with { ambiguous: true, confidence: 0.55 }
  THEN supersede() is NOT called
  AND agent_logs contains 'supersession_proposed' with the proposal
  AND agent_logs contains 'potential_contradiction' for W3 review
  AND node A is unmodified
```

---

## 4. Invalidation rules (Revision 1 §2.1, unchanged except cascade condition)

**Rule 1 — Direct state contradiction:** a new node supersedes a current node iff they make mutually exclusive claims about the same subject at overlapping valid times. (Table of examples unchanged from Revision 1.)

**Rule 2 — Dependent facts cascade (one level, conditional):** if fact B has an edge to fact A with `relationship = 'depends_on'` or `'assumes'`, and A is superseded with reason `false_belief` (Type 2) or `correction`, then B is also superseded. **Per the review's decision:** one-level cascade is kept for W1 **conditional on** verifying that `depends_on`/`assumes` edges exist with reliable semantics in the current schema. If the implementation audit finds these relationships are not reliably defined, cascade is **disabled** in W1 and each dependent fact requires explicit supersession. The implementation MUST check this before enabling the cascade path.

**Rule 3 — History is never invalidated by present changes.** (Unchanged.)

**Rule 4 — Ambiguous cases default to NO invalidation.** Log `potential_contradiction` for W3. (Unchanged.)

---

## 5. Atomicity and concurrency (Revision 1 §2.2, §2.5 — plus cascade proof)

### 5.1 The transaction (with cascade)

**Shared timestamp (Revision 4 — fixes sign-off B3):** `supersede()` generates ONE canonical UTC timestamp in application code BEFORE opening the transaction:

```typescript
// In agent/temporal.ts — supersede():
const opTime = new Date().toISOString();  // ONE timestamp for the entire operation
```

All three temporal writes in the transaction use this single `opTime` as a bound parameter. The database never generates these timestamps independently — three separate `strftime('now')` calls inside one transaction could differ by milliseconds (SQLite evaluates `now` per statement, not per transaction), which would break as-of query consistency at the exact correction boundary. Historical retrieval (§2.3) relies on `superseded_at`, `recorded_at` (new row), and `corrected_at` agreeing about when the correction occurred.

```sql
BEGIN IMMEDIATE;
  -- 1. Insert the new row (if any). No never_true column (see §2.4).
  --    recorded_at is the shared opTime — supplied explicitly, NOT left to the DB default.
  INSERT INTO nodes (space_id, label, type, content, valid_from, recorded_at, ...)
  VALUES (?, ?, ?, ?, ?, ?, ...);           -- recorded_at = :opTime
  -- 2. Supersede the old row (optimistic guard).
  --    NOTE: valid_to is set ONLY for Type 1 (factual update). For Type 2
  --    (false-belief), valid_to stays NULL — no interval is fabricated.
  --    superseded_at is the shared opTime.
  UPDATE nodes
  SET valid_to = ?,           -- Type 1: the time the fact stopped being true; Type 2: NULL
      superseded_at = ?,      -- :opTime (shared)
      superseded_by = ?,
      supersede_reason = ?
  WHERE id = ? AND space_id = ? AND superseded_at IS NULL;
  -- 3. Check changes == 1, else ROLLBACK + throw SupersessionConflictError
  -- 4. Record the correction event (append-only; see §2.4).
  --    corrected_at is the shared opTime.
  INSERT INTO corrections
    (space_id, node_id, correction_type, corrected_at, corrected_by, reason, superseding_node_id)
  VALUES
    (?, ?, ?, ?, ?, ?, ?);    -- corrected_at = :opTime (shared)
  -- 5. Cascade (DISABLED BY DEFAULT in W1 — see below).
  --    When enabled (only after edge semantics are verified), supersede dependent rows:
  --    Edges point dependent → dependency: source = dependent, target = dependency.
  --    To find nodes that DEPEND ON the superseded node X, query WHERE target = X.
  --    Cascade rows also use the shared opTime for superseded_at.
  UPDATE nodes
  SET superseded_at = ?,      -- :opTime (shared)
      superseded_by = ?,       -- points to the replacement, or NULL
      supersede_reason = 'false_belief'
  WHERE id IN (
    SELECT source FROM edges
    WHERE target = ? AND space_id = ? AND relationship IN ('depends_on', 'assumes')
  )
  AND space_id = ? AND superseded_at IS NULL;
  -- 6. Audit log (content-free: IDs and reason codes only — see §8)
  INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
  VALUES (?, 'soumaya', 'supersede', ?, ?, 'ok');
COMMIT;
```

**Why the shared timestamp matters:** consider an as-of query for time T where T falls between two `strftime('now')` evaluations (e.g., `superseded_at = 14:00:00.123` but `corrected_at = 14:00:00.127`). A query for `T = 14:00:00.125` would see the row as superseded but find no correction event yet — an inconsistent belief state. With a single `opTime`, all three writes are atomically simultaneous from the query's perspective: any as-of time is either before all three or after all three. There is no observable instant where the writes disagree.

**Note on the DB-level `recorded_at` default:** it remains in `BOOTSTRAP_SQL` (fresh schema) as a backstop for insert paths OTHER than `supersede()` — e.g., a future raw-SQL insert that forgets the column. But `supersede()` ALWAYS supplies `recorded_at` explicitly as `:opTime`. The backstop never fires inside a supersession operation.

**Atomicity proof:** all writes (new row, old row, correction event, cascade rows, audit row) are inside a single `BEGIN IMMEDIATE ... COMMIT`. If any step fails, SQLite rolls back the entire transaction. There is no observable state where the new row exists but the old row isn't superseded, or where the correction event is missing, or where the old row is superseded but the cascade didn't run.

**Cascade: DISABLED BY DEFAULT in W1.** The cascade path (step 5) is implemented but gated behind an explicit configuration flag (`space_meta.w1_cascade_enabled`, default `false`). It may only be enabled after the implementation audit verifies that `depends_on` / `assumes` edges exist with reliable semantics in the actual schema (§4, Rule 2). Rationale: an incorrect cascade silently invalidates facts the user never asked to change. The safe default is no cascade; each dependent fact requires explicit supersession until the edge semantics are proven.

**Edge direction (fixes round-3 additional check 2):** the cascade query above uses `WHERE target = ?` because edges point from dependent → dependency (`source` = the dependent node, `target` = the node it depends on). The Revision 2 query incorrectly used `source = ?`, which would have found the dependencies OF the superseded node (the wrong direction). The implementation MUST verify the actual edge direction against the real schema before enabling cascade; if reversed, the query is flipped.

**Cross-space guard:** every UPDATE and INSERT includes `AND space_id = ?` / `space_id = ?`. The cascade subquery also filters `space_id = ?`. A supersession can never cross space boundaries — verified by test T-SEC-1.

### 5.2 Concurrency (unchanged from Revision 1)

Optimistic `superseded_at IS NULL` guard + `SupersessionConflictError` + `BEGIN IMMEDIATE`. (Revision 1 §2.5 stands.)

---

## 6. Retrieval integration (fixes B5)

### 6.1 The core problem

Superseded candidates can **crowd out** valid results in top-K retrieval if filtering happens only after candidate selection. W1 pushes the `superseded_at IS NULL` filter into candidate selection itself.

### 6.2 Vector search (`db/vec.ts`) — Revision 4 (fixes sign-off B2)

**The problem with Revision 2:** it filtered superseded nodes in JS after the vector search returned its candidate set, which was bounded by the initial `want` (`min(500, max(k*6, k+40))`). If superseded nodes occupied all `want` slots, valid matches were permanently lost — no amount of post-filtering can recover candidates the vector index never returned.

**The fix: iterative over-fetch with adaptive widening.** Keep fetching batches until we have `k` valid results, the candidate pool is exhausted, or the safety bound is hit.

**Exhaustion contract (Revision 4 — fixes sign-off B2):** the underlying `vecSearchRaw(query, limit, offset)` paginates by offset/limit. **Exhaustion is defined as: the API returns an empty page.** A short (non-empty) page is NOT proof of exhaustion — the implementation must not treat it as such. Rationale: the vector index may return fewer than `limit` hits for internal reasons (shard boundaries, approximate-index page limits) while more candidates exist at higher offsets. Only an empty page is an unambiguous "no more candidates" signal. (If the underlying API cannot support offset pagination, the implementation fetches `fetchSize + offset` and slices — this limitation is documented in code, and the empty-page rule still applies to the sliced result.)

**Safety bound honesty (Revision 4 — fixes sign-off B2):** `MAX_CANDIDATES = 2000` is a circuit breaker, not a completeness guarantee. If the loop hits the bound without finding `k` valid results, the function:
1. Returns whatever valid results were found (possibly fewer than `k`, possibly zero).
2. Emits a structured diagnostic log: `vecSearchTruncated{space_id, query_hash, found, wanted, scanned}` — queryable via `agent_logs` for tuning (if this fires regularly, the bound or the index needs attention).
3. Does NOT claim the returned top-k is equivalent to searching a clean index. The doc no longer makes that claim.

```typescript
// In db/vec.ts — replaces the single-shot search + filter.
const MAX_CANDIDATES = 2000;  // safety bound: circuit breaker, NOT a completeness guarantee

async function vecSearchCurrent(
  spaceId: string,
  queryVector: number[],
  k: number,
): Promise<ScoredHit[]> {
  const valid: ScoredHit[] = [];
  let offset = 0;
  // Initial fetch size: same over-fetch as before (k*6 headroom).
  let fetchSize = Math.min(500, Math.max(k * 6, k + 40));
  let truncated = false;

  const lookup = db.prepare(
    `SELECT space_id AS s, deleted_at AS d, status AS st, superseded_at AS sup
     FROM nodes WHERE id = ?`
  );

  while (valid.length < k) {
    if (offset >= MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    // Raw vector search: returns up to fetchSize hits starting at offset.
    const batch: ScoredHit[] = vecSearchRaw(queryVector, fetchSize, offset);

    // EXHAUSTION CONTRACT: only an empty page means "no more candidates."
    // A short non-empty page is NOT exhaustion — continue to the next offset.
    if (batch.length === 0) break;

    let batchValid = 0;
    for (const h of batch) {
      const row = lookup.get(h.nodeId) as
        { s: number; d: string | null; st: string; sup: string | null } | undefined;
      if (row !== undefined
          && row.s === spaceId
          && row.d === null
          && row.st !== "archived"
          && row.sup === null) {          // exclude superseded
        valid.push(h);
        batchValid++;
        if (valid.length >= k) break;
      }
    }

    offset += batch.length;

    // Adaptive widening: if this batch was mostly superseded, the result set is
    // superseded-heavy — double the fetch size for the next iteration.
    // This handles the pathological case where superseded nodes dominate the index.
    if (batch.length > 0 && batchValid < batch.length / 2) {
      fetchSize = Math.min(fetchSize * 2, MAX_CANDIDATES - offset);
    }
  }

  if (truncated) {
    // Safety bound hit: return partial results + emit a queryable diagnostic.
    // Do NOT claim completeness. This is a tuning signal, not a silent success.
    logDiagnostic("vecSearchTruncated", {
      space_id: spaceId,
      // query_hash: sha256 of the query vector (content-free; the vector itself is not logged)
      query_hash: sha256hex(queryVector),
      found: valid.length,
      wanted: k,
      scanned: offset,
    });
  }

  return valid.slice(0, k);
}
```

**Why this is correct (revised for honesty):**
- **Termination:** the loop exits when (a) we have `k` valid, (b) the vector index returns an empty page (exhaustion), or (c) we hit `MAX_CANDIDATES`. It cannot loop forever.
- **No silent truncation:** if the bound is hit, the diagnostic is emitted. Operators can query `agent_logs` for `vecSearchTruncated` events to detect whether the bound is too low or the index is pathologically superseded-heavy.
- **Common-case performance:** the common case (few superseded nodes) terminates after one iteration, identical to the old behavior. The adaptive doubling means the pathological case costs O(log n) extra fetches, not O(n).
- **Determinism (qualified):** when the loop terminates via (a) or (b) — the normal cases — results are in vector-similarity order and match what a clean index would return. When it terminates via (c) — the bound — results are a prefix of the valid set, and the diagnostic records that the result may be incomplete. The old doc's unqualified determinism claim was too strong; this version distinguishes the cases.

**Test T-RTR-2** (new, from round-3 review — superseded candidates EXCEED the initial over-fetch window):
```
T-RTR-2: Iterative over-fetch survives superseded flooding
  GIVEN 500 superseded nodes with high vector similarity to the query
  AND 3 valid nodes with slightly lower similarity
  AND k = 3 (initial fetchSize = max(3*6, 3+40) = 43)
  WHEN vecSearchCurrent runs
  THEN all 3 valid nodes are returned
  AND no superseded node is returned
  AND the loop terminates (offset < MAX_CANDIDATES)
```
Note: with 500 superseded nodes and initial fetchSize 43, the first batch contains zero valid results. The adaptive doubling (43 → 86 → 172 → 344 → 688) ensures the valid nodes are found within ~4 iterations. A single-shot filter would have returned zero results.

**Test T-RTR-3** (new, from sign-off review B2 — safety bound hit):
```
T-RTR-3: Safety bound hit returns partial results + diagnostic (no silent truncation)
  GIVEN 2500 superseded nodes with high vector similarity to the query
  AND 3 valid nodes with slightly lower similarity (beyond the 2000-candidate bound)
  AND k = 3
  WHEN vecSearchCurrent runs
  THEN the loop terminates at MAX_CANDIDATES = 2000 (offset >= 2000)
  AND whatever valid results were found within the bound are returned
    (may be fewer than k, possibly zero — the test asserts the count matches
     the number of valid nodes within the first 2000 candidates, verified independently)
  AND a vecSearchTruncated diagnostic is emitted to agent_logs with
    {space_id, query_hash, found, wanted: 3, scanned: >= 2000}
  AND the function does NOT throw, does NOT hang, and does NOT claim completeness
  AND a follow-up query for the vecSearchTruncated event returns the diagnostic
    (proves the tuning signal is queryable)
```

### 6.3 Keyword search (`db/fts.ts`)

Current code (lines 65–68) JOINs `nodes` and filters in SQL **before** `LIMIT`. W1 adds one WHERE condition:

```sql
SELECT f.rowid AS nodeId FROM nodes_fts f
JOIN nodes n ON n.id = f.rowid
WHERE nodes_fts MATCH ? AND n.space_id = ?
  AND n.deleted_at IS NULL
  AND n.status != 'archived'
  AND n.superseded_at IS NULL        -- W1 ADDITION
ORDER BY bm25(nodes_fts) LIMIT ?
```

Because the filter is in the WHERE clause (not post-LIMIT), superseded rows never occupy result slots. No over-fetch needed.

### 6.4 Repository method contracts

| Method | Current behavior | W1 contract |
|---|---|---|
| `getById(id)` | Returns row if not deleted | **Unchanged.** Returns the row as-is (including superseded rows) — this is the history/detail path. Callers that need truth use `getCurrentById`. |
| `getCurrentById(id)` | *(new)* | Returns the row only if `superseded_at IS NULL` (+ valid-time bounds). For "is this currently true?" checks. |
| `recent(limit)` | Returns recent non-deleted | Adds `superseded_at IS NULL` + valid-time filter by default. New opt-in param: `recent(limit, { includeSuperseded: true })` for history views. |
| `all()` | Returns all non-deleted, non-archived | Adds `superseded_at IS NULL` by default. Opt-in `includeSuperseded` flag. (Per review decision: ordinary live-galaxy query excludes superseded; historical/detail paths use the flag.) |
| `archived()` | Returns archived | **Unchanged.** Archival is orthogonal to supersession. |
| `byIds(ids)` | Returns matching non-deleted | Adds `superseded_at IS NULL` by default. Opt-in flag. (This is the memorySearch tool's path — §4.1 #5.) |

### 6.5 Graph traversal

When expanding edges during graph traversal (galaxy rendering, GraphRAG expansion):
- **Default:** do not traverse *through* superseded nodes. A superseded node is a dead end for live-graph expansion.
- **Supersession edges** (`superseded_by` links) are traversable only in history mode (explicit user request: "show me the history of this fact").
- Rationale: the live graph shows what's true now; the history graph shows what was believed. Mixing them in one traversal produces confusing paths.

### 6.6 Digest, chat, proactive paths (Revision 1 §4.1 — unchanged)

The eight query paths from Revision 1 still apply, with the B5 additions above covering the vector/FTS primitives. The codebase audit requirement stands: every `FROM nodes` / `from(nodes)` must be either filtered or explicitly documented as historical.

---

## 7. Foreign-key integrity: `superseded_by` (additional issue)

**Decision: plain INTEGER, application-validated.** Justification:

1. SQLite cannot add a proper `FOREIGN KEY` constraint via `ALTER TABLE ... ADD COLUMN` in all cases. A table rebuild (copy to new table with FK, drop old, rename) is possible but disproportionate for W1 — it requires exclusive access and risks data loss on a table the user actively writes to.
2. The `supersede()` writer (§5) is the **single entry point** for setting `superseded_by`. It always sets it to either a just-inserted row id (known to exist — same transaction) or NULL. There is no code path that can write a dangling reference.
3. **Test T-FK-1** verifies referential integrity: after every test supersession, `SELECT COUNT(*) FROM nodes WHERE superseded_by IS NOT NULL AND superseded_by NOT IN (SELECT id FROM nodes)` returns 0.

If a future phase needs database-enforced integrity, the table rebuild can be done then. For W1, the single-writer invariant + test is sufficient.

---

## 8. Audit content: no memory text in logs (additional issue)

Revision 1's sample audit description included the memory label (`"Superseded 'Between jobs' (id 123)..."`). Labels may contain sensitive information. **Revised audit format — content-free:**

```
action: 'supersede'
description: 'supersede node_id=123 reason=update valid_to=2026-10-08T00:00:00.000Z new_id=456'
  (IDs, reason codes, timestamps only — no label, no content)
targets: JSON {"old_id": 123, "new_id": 456, "reason": "update", "actor": "soumaya"}
result: 'ok'
```

Memory text is retrievable only through authorized access (the `getById` history path). The audit log answers "what happened, when, why" without exposing "what it said."

---

## 9. Migration, backfill, and rollback (Revision 1 §3, corrected)

### 9.1 DDL (canonical timestamps) — Revision 3 (fixes B2)

**SQLite constraint (verified):** `ALTER TABLE ... ADD COLUMN` does **not** support parenthesized expression defaults. Per the [SQLite ALTER TABLE documentation](https://www.sqlite.org/lang_altertable.html): *"The new column may not have a default value of CURRENT_TIME, CURRENT_DATE, CURRENT_TIMESTAMP, or an expression in parentheses."* This applies to all SQLite versions, including the one bundled with better-sqlite3 12.11.1. The Revision 2 migration DDL (`DEFAULT (strftime(...))` on `ADD COLUMN`) would have been **rejected at migration time**.

**Consequence:** the migration path and the fresh-schema path use different DDL for `recorded_at`, but produce **identical runtime behavior**:

```typescript
// In migrateSchema(), following the existing PRAGMA-guarded pattern:
// NOTE: recorded_at is added WITHOUT a default (SQLite forbids expression
// defaults on ADD COLUMN). It is backfilled immediately (§9.2) and set
// explicitly by application code on every insert (§9.3). A test (T-WRITE-1)
// fails if any insert path omits it.
const nodeCols = sqlite.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
for (const [col, ddl] of [
  ["valid_from",       `ALTER TABLE nodes ADD COLUMN valid_from TEXT`],
  ["valid_to",         `ALTER TABLE nodes ADD COLUMN valid_to TEXT`],
  // NO never_true column (see §2.4 — corrections table instead).
  ["recorded_at",      `ALTER TABLE nodes ADD COLUMN recorded_at TEXT`],
  ["superseded_at",    `ALTER TABLE nodes ADD COLUMN superseded_at TEXT`],
  ["superseded_by",    `ALTER TABLE nodes ADD COLUMN superseded_by INTEGER`],
  ["supersede_reason", `ALTER TABLE nodes ADD COLUMN supersede_reason TEXT`],
] as const) {
  if (!nodeCols.some((c) => c.name === col)) sqlite.exec(ddl);
}

// New table — no ALTER needed (CREATE TABLE IF NOT EXISTS is idempotent):
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS corrections (
    id INTEGER PRIMARY KEY,
    space_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    correction_type TEXT NOT NULL,
    corrected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    corrected_by TEXT NOT NULL,
    reason TEXT,
    superseding_node_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_corrections_node ON corrections(node_id);
  CREATE INDEX IF NOT EXISTS idx_corrections_space_time ON corrections(space_id, corrected_at);
`);
```

In `BOOTSTRAP_SQL` (`CREATE TABLE nodes`, fresh databases), the new columns ARE defined with expression defaults — this is legal in `CREATE TABLE`:
```sql
recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
-- (other columns as above)
```

In drizzle `schema.ts`, the fields are added with matching types. The drizzle default for `recorded_at` is documented as "fresh-schema backstop only; application code always sets explicitly."

**Why the asymmetry is safe — and explicitly documented (Revision 4 — fixes sign-off B1):** the fresh and migrated schemas intentionally differ in one place:

| Aspect | Fresh schema (`BOOTSTRAP_SQL`) | Migrated schema (`migrateSchema()`) |
|---|---|---|
| `recorded_at` definition | `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` | `TEXT` (nullable, no default) |
| Enforcement mechanism | DB default (backstop) + application code (primary) | Application code only |

This asymmetry exists because SQLite forbids expression defaults on `ALTER TABLE ADD COLUMN` — there is no DDL that gives migrated databases the same column definition. This is a **known, accepted schema difference**, not an oversight.

The behavioral guarantee that makes it safe: **every application insert path sets `recorded_at` explicitly** (§9.3). The DB default is a backstop, not the primary mechanism — in both schemas, the application is what populates the column. The difference only matters for raw-SQL inserts that bypass the application: on fresh schemas they'd get the DB default; on migrated schemas they'd get NULL. **Raw-SQL inserts into `nodes` MUST supply `recorded_at` explicitly** — this is a documented invariant, enforced by the codebase audit (§6.6) and test T-WRITE-1 assertion #4 (which documents the NULL outcome as the known limitation).

**What "parity" means (revised — see §9.5):** parity is behavioral, not definitional. Both schemas guarantee: (a) no row has NULL `recorded_at` after migration + normal operation, (b) all queries return identical results, (c) all temporal invariants hold. `PRAGMA table_info` will show different column definitions — that is expected and accepted.

### 9.2 Backfill — Revision 3 (fixes B1)

**Migration step order is critical.** Revision 2 backfilled `recorded_at = created_at` BEFORE normalizing `created_at`, leaving `recorded_at` in the old SQLite format. The correct order:

```sql
-- STEP 1: Normalize created_at to canonical format FIRST.
-- strftime parses the old 'YYYY-MM-DD HH:MM:SS' SQLite format correctly.
-- Rows already in canonical format are untouched (the WHERE clause skips them).
UPDATE nodes
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE created_at NOT LIKE '%T%';

-- STEP 2: Backfill recorded_at from the NOW-NORMALIZED created_at.
-- recorded_at is NULL for all existing rows (ADD COLUMN without default → NULL).
UPDATE nodes SET recorded_at = created_at WHERE recorded_at IS NULL;

-- STEP 3: Normalize other tables with CURRENT_TIMESTAMP defaults (same pattern).
UPDATE edges
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE created_at NOT LIKE '%T%';
-- (agent_logs, etc. — same pattern, enumerated in implementation.)

-- STEP 4: valid_from / valid_to / superseded_* : NULL defaults are correct.
-- All existing rows start as current. No behavior change until supersession occurs.
-- No corrections rows are created by migration (no historical corrections to import).
```

**Caveat (per review decision, documented not fixed):** `recorded_at` backfilled from `created_at` is the best available proxy for "when the system learned the fact." It is NOT proof of exact learning time (e.g., bulk imports may share timestamps, and `created_at` reflects row creation, not necessarily fact acquisition). This caveat is documented in code comments and in the `recorded_at` column documentation. For all rows created AFTER the W1 migration, `recorded_at` is set explicitly at insert time and is exact.

**Post-migration assertion (new, from round-3 review):** after running the migration SQL, the application verifies the canonical-format invariant before completing startup:

```typescript
// In migrateSchema(), after the W1 migration block:
const BAD_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const bad = sqlite.prepare(`
  SELECT COUNT(*) AS n FROM nodes
  WHERE (created_at IS NOT NULL AND created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
     OR (recorded_at IS NOT NULL AND recorded_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
     OR (valid_from IS NOT NULL AND valid_from NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
     OR (valid_to IS NOT NULL AND valid_to NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
     OR (superseded_at IS NOT NULL AND superseded_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
`).get() as { n: number };
if (bad.n > 0) {
  throw new Error(`W1 migration: ${bad.n} rows have non-canonical timestamps after normalization`);
}
// (SQLite GLOB is used in SQL; the stricter regex /^\d{4}-...$/ is applied in
//  TypeScript in test T-MIG-1 for exact validation.)
```

If the assertion fails, the migration throws and the application does not start — a loud failure, not silent corruption. **Test T-MIG-1** (new): runs the migration on a fixture DB with mixed-format timestamps, asserts zero non-canonical timestamps afterward and that the assertion itself would catch a deliberately corrupted row.

### 9.3 Insert-path audit (fixes B2)

Every path that creates nodes must result in a populated `recorded_at`. Because the migration cannot use a DB-level expression default (see §9.1), **application code is the enforcement mechanism**, backed by a test that fails if any path omits it.

| # | Insert path | File | Sets `recorded_at` explicitly? | Guarantee |
|---|---|---|---|---|
| 1 | `NodesRepo.create()` | `repositories/nodes.repo.ts:90` | **Yes (W1 change)** — add `recordedAt: new Date().toISOString()` alongside the existing `createdAt` change (§1.3) | Application code |
| 2 | Chat extraction (agent loop writes memories) | `agent/loop.ts` → calls `NodesRepo.create()` | Via #1 | Application code |
| 3 | Telegram `/log` handler | `telegram/bot.ts` → calls `NodesRepo.create()` | Via #1 | Application code |
| 4 | Agent tool writes (`taskCreator`, `fire_reminder`) | `agent/tools/*.ts` → `NodesRepo.create()` | Via #1 | Application code |
| 5 | `supersede()` new-row insert | `agent/temporal.ts` (new) | **Yes** — explicit `:opTime` bound parameter (the single shared operation timestamp, §5.1). Never the DB default. | Explicit parameter |
| 6 | `corrections` table inserts | `agent/temporal.ts` (new) | **Yes** — explicit `:opTime` bound parameter (shared with the supersession, §5.1). The `CREATE TABLE` expression default exists as a backstop for non-supersession correction inserts, but `supersede()` always supplies it explicitly. | Explicit parameter |
| 7 | Any future raw-SQL `INSERT INTO nodes` | (codebase audit) | **Must** set `recorded_at` explicitly or rely on... nothing — there is no DB backstop in migrated schemas. The codebase audit (§6.6) must verify no raw inserts bypass `NodesRepo.create()`. | Code review + test |

**Why this is sufficient:** In practice, all node creation flows through `NodesRepo.create()` (paths 1–4) or the `supersede()` writer (path 5). There is no concurrent writer — better-sqlite3 is single-process on Fly. The invariant is enforced at the narrowest choke point (`NodesRepo.create()`), not scattered across callers.

**Test T-WRITE-1** (expanded from round-2): create nodes through paths 1–4 (real `NodesRepo.create()` calls, simulated chat extraction, simulated `/log`, simulated tool writes), then assert:
1. Every created row has `recorded_at IS NOT NULL`.
2. Every `recorded_at` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`.
3. `recorded_at` is within 5 seconds of the test's start time (proves it's set at insert, not backfilled).
4. A direct SQL `INSERT INTO nodes (...)` WITHOUT `recorded_at` produces NULL (documents the known limitation; the test asserts the application never does this).

### 9.4 Rollback (additional issue — revised)

**Rollback = feature flag OFF, not schema reversal.**

- W1 ships behind a feature flag (e.g., `space_meta.w1_temporal_enabled`, default ON after migration).
- **Emergency rollback:** set the flag OFF. All retrieval paths revert to pre-W1 behavior (ignore temporal columns). This is a **degraded state** — stale facts become visible again — and is documented as such. It is for emergency use only (e.g., a bug in the supersession logic is corrupting queries).
- **The service MUST NOT run in rolled-back state as a steady state.** The flag-off mode is a circuit breaker, not a supported configuration. The runbook states: flag-off → investigate → fix forward → flag-on. Maximum recommended flag-off duration is documented (e.g., 24 hours) with an alert if exceeded.
- **Schema rollback** (dropping the six columns) is possible via `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+) but is NOT the recommended rollback path — it destroys the supersession history. The flag approach preserves all data.
- **Test T-RB-1** (new, from review): with flag OFF, verify that (a) queries return pre-W1 results, (b) no data is lost (temporal columns intact), (c) re-enabling the flag restores W1 behavior without re-migration.

### 9.5 Fresh vs. migrated parity (revised in Revision 4 — fixes sign-off B1)

**The old T-PAR-1 was contradictory:** it required identical `PRAGMA table_info` column definitions, but §9.1 intentionally gives fresh and migrated schemas different `recorded_at` definitions (expression default vs. nullable, no default — SQLite forbids the former on `ALTER TABLE ADD COLUMN`). Both conditions cannot hold simultaneously.

**Revised parity contract: behavioral, not definitional.** The schemas differ in DDL; they must agree in behavior.

**Test T-PAR-1** (revised):
```
GIVEN a fresh database (BOOTSTRAP_SQL with W1 columns)
AND a migrated database (pre-W1 schema + migrateSchema())
WHEN the same sequence of operations is applied to both:
  1. Create 10 nodes through NodesRepo.create() (all insert paths)
  2. Supersede 3 of them (one per correction type)
  3. Run: getCurrentById, recent(), all(), byIds(), vecSearchCurrent, FTS search,
     historical as-of query, digest builder input query
THEN:
  (a) Every row in both databases has recorded_at IS NOT NULL
  (b) Every recorded_at matches /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  (c) All 8 queries return IDENTICAL result sets (same node IDs, same ordering)
  (d) PRAGMA table_info(nodes) is DOCUMENTED as differing ONLY in the
      recorded_at column definition (fresh: NOT NULL + DEFAULT; migrated:
      nullable, no default) — any OTHER column difference fails the test
```

Assertion (d) is the key: it pins the asymmetry to exactly one known, accepted difference. If a future change introduces any other schema divergence, the test catches it.

**What parity does NOT require:** identical `PRAGMA table_info` output. The old requirement is explicitly withdrawn — it was unachievable given SQLite's `ALTER TABLE` limitations, and pursuing it (via table rebuild) would add migration risk disproportionate to the benefit.

---

## 10. Regression tests (Revision 1 §6 + 8 new from review)

All tests in `packages/server/src/agent/__tests__/w1-temporal.test.ts`.

### Revision 1 tests (T1–T8, retained with corrections)

- **T1** (basic supersession): updated — uses canonical timestamps; asserts a `corrections` row with `correction_type = 'factual_update'` is created.
- **T2** (out-of-order): updated — `valid_from = "2026-10-08T00:00:00.000Z"` (date-only → midnight UTC per §1.4).
- **T3** (repeated corrections): updated — first correction uses Type 2 (false-belief correction event, no valid interval on the row); history via `corrections` table shows "believed, corrected as false, then replaced."
- **T4** (concurrent supersession): unchanged.
- **T5** (ambiguous non-invalidation): unchanged.
- **T6** (digest exclusion): **expanded** — must cover the actual LLM-generated digest path, not just `buildDailyDigest()`. The test constructs the input that the LLM summarization layer receives and asserts no superseded fact reaches it.
- **T7** (backfill): updated — asserts canonical timestamp format on all backfilled rows.
- **T8** (cascade): updated — asserts atomic commit of old + dependent + replacement + audit (deliberately fail one step, verify full rollback).

### New tests from round-2 review (retained)

- **T-TIME-1 through T-TIME-4**: timestamp consistency (§1.5).
- **T-WRITE-1**: all insert paths populate `recorded_at` (§9.3, expanded in Rev 3).
- **T-TRIG-1**: ambiguous LLM inference cannot supersede (§3.2).
- **T-RTR-1**: top-K regression — superseded vector/keyword matches cannot crowd out valid results when they dominate the final top-K (§6.2, Rev 2 version; superseded by T-RTR-2 for the flooding case).
- **T-RB-1**: rollback behavior — flag-off is degraded but lossless (§9.4).
- **T-FK-1**: `superseded_by` referential integrity (§7).
- **T-SEC-1**: cross-space rejection — supersession attempt across `space_id` fails without modifying either space.
- **T-PAR-1**: fresh vs. migrated parity (§9.5).

### New tests from round-3 review

- **T-MIG-1**: migration order and assertion (§9.2). Fixture DB with mixed-format `created_at` values → run migration → assert all temporal columns match canonical format; assert the post-migration assertion throws on a deliberately corrupted row.
- **T-RTR-2**: iterative over-fetch survives superseded flooding (§6.2). 500 superseded high-similarity nodes + 3 valid lower-similarity nodes, k=3 → all 3 valid returned, loop terminates.
- **T-HIST-1a / T-HIST-1b**: as-of belief contract and correction-history contract (§2.3). 1a: Oct 5 as-of → believed-true; Oct 11 as-of → excluded. 1b: history view returns single row with `was_corrected_as_false = 1` and full `correction_history` array ordered by `corrected_at ASC, id ASC`; adding a second correction event (including same-timestamp) does not duplicate the row and preserves deterministic order.
- **T-NT-1** (revised): false-belief correction via `corrections` table, no `never_true` column (§2.4).
- **T-CAS-1**: atomic cascade failure (§5.1, retained).

### New tests from sign-off review (Revision 4)

- **T-TIME-5**: shared operation timestamp (§1.5, §5.1). Asserts `old.superseded_at === new.recorded_at === corrections.corrected_at` (string equality) after a supersession.
- **T-RTR-3**: safety bound hit (§6.2). 2500 superseded nodes + 3 valid beyond the bound → partial results returned + `vecSearchTruncated` diagnostic emitted, no crash, no silent truncation, no completeness claim.

**New test: never-true correction via corrections table (from review, revised for §2.4):**
```
T-NT-1: Correction of a never-true fact creates no false interval
  GIVEN node A "Car insurance: $200/mo" (current, recorded_at = Oct 1)
  WHEN user says "I don't have a car, never did"
  THEN supersede(spaceId, A, null, 'false_belief')
  AND A has valid_from IS NULL, valid_to IS NULL (no interval fabricated)
  AND A has superseded_at NOT NULL, supersede_reason = 'false_belief'
  AND a corrections row exists: node_id = A, correction_type = 'false_belief',
      corrected_at ≈ now, corrected_by = 'user'
  AND isNeverTrue(A) returns true (derived from corrections table)
  AND no timestamp on A suggests it was ever true
```

**New tests: as-of belief and correction history (from round-3 review, B3; split in Revision 5):**
```
T-HIST-1a: As-of belief query reconstructs pre-correction belief state (Contract 1)
  GIVEN node A "Car insurance: $200/mo" (recorded_at = Oct 1T10:00:00.000Z)
  AND on Oct 10T14:00:00.000Z user corrects it as false_belief
    (A.superseded_at = Oct 10T14:00:00.000Z; corrections row with corrected_at = Oct 10T14:00:00.000Z)
  WHEN querying as-of Oct 5T00:00:00.000Z via Contract 1
  THEN A is returned (believed current on Oct 5)
  AND the result does NOT imply the system knew it was false on Oct 5
  WHEN querying as-of Oct 11T00:00:00.000Z via Contract 1
  THEN A is excluded (superseded_at <= Oct 11 — it was not believed current on Oct 11)

T-HIST-1b: Correction-history query returns full event timeline without duplication (Contract 2)
  GIVEN the same node A and correction as T-HIST-1a
  AND a second correction event is later recorded for A (correction_type = 'factual_update', corrected_at = Oct 12)
  WHEN querying Contract 2 for node A
  THEN exactly ONE row is returned (no duplication from the two correction events)
  AND was_corrected_as_false = 1 (EXISTS finds the false_belief event)
  AND correction_history is a JSON array with exactly 2 events in corrected_at order
```

**New test: atomic cascade failure (from review):**
```
T-CAS-1: Deliberately fail the cascade
  GIVEN node A (current) with dependent node B via 'depends_on' edge
  WHEN supersede() is called but the audit INSERT is forced to fail (test hook)
  THEN the entire transaction rolls back
  AND A is still current (superseded_at IS NULL)
  AND B is still current
  AND no partial supersession exists
```

---

## 11. Acceptance criteria (Revision 1 §7, expanded)

W1 is accepted iff **all** of the following hold:

**AC1 — The reported bug is dead.** T1 + T6 (expanded to cover the LLM digest path).

**AC2 — "Never" means: no code path presenting current truth returns superseded rows.** Verified by all tests passing + codebase audit of every `FROM nodes`.

**AC3 — History is preserved and honest.** Every supersession is retrievable via historical queries with original content intact AND without fabricated valid-time intervals (T-NT-1).

**AC4 — Migration is safe.** T7 + T-PAR-1 pass. Existing test suite passes before and after migration.

**AC5 — Concurrency is correct.** T4 passes. T-FK-1 passes.

**AC6 — No regressions.** Full `npm test` + `npm run typecheck` pass.

**AC7 — Corrections don't create false truth.** T-NT-1 + T-HIST-1a + T-HIST-1b + T-TIME-5 pass. No correction produces a row with non-NULL `valid_from`/`valid_to` for a false-belief correction. As-of queries reconstruct pre-correction belief states correctly; history views show the full correction timeline without row duplication. All three temporal writes in a supersession share one identical timestamp (no boundary drift).

**AC8 — Uncertain inferences don't mutate history.** T-TRIG-1 passes.

---

## 12. Explicit non-goals for W1 (Revision 1 §8, retained)

All 12 non-goals from Revision 1 stand. Additionally:

13. **Preference/directive storage.** Type 3 overrides ("stop bringing up X") are explicitly NOT implemented via temporal columns. A future phase (W4/W6) will define the directives mechanism. W1 only guarantees that preference overrides don't corrupt factual history.
14. **Cross-space temporal logic.** (Already stated; reaffirmed with T-SEC-1.)

---

## 13. Open questions — resolved per review decisions

| # | Question (Rev 1 §9) | Decision (per round-2 review) |
|---|---|---|
| 1 | Column naming | **Keep** `valid_from` / `valid_to` / `recorded_at` / `superseded_at`. Fix semantics, not vocabulary. |
| 2 | Backfill `recorded_at` | **Use `created_at` as proxy**, with the caveat explicitly documented (§9.2): it approximates learning time, not proof of it. |
| 3 | Cascade depth | **One level, conditional** on verified `depends_on`/`assumes` edge semantics (§4). If unverifiable, cascade disabled in W1. |
| 4 | `depends_on` edges | **Verify against real schema** before enabling cascade (§5.1). Implementation audit required. |
| 5 | Galaxy behavior | **Live query excludes superseded** (via `all()` default); historical nodes available via `includeSuperseded` flag for detail views. Ghosting deferred to W7. |

---

## Appendix: Files touched by W1 (revised)

| File | Change |
|---|---|
| `packages/server/src/db/schemaSql.ts` | Add 6 columns to `CREATE TABLE nodes` in `BOOTSTRAP_SQL` (`recorded_at` gets expression default here — legal in `CREATE TABLE`); add `CREATE TABLE corrections` + indexes |
| `packages/server/src/db/schema.ts` | Add 6 fields to drizzle `nodes` table definition; add `corrections` table definition |
| `packages/server/src/db/client.ts` | Add 6 PRAGMA-guarded `ALTER TABLE` migrations (no `never_true`; `recorded_at` nullable, no expression default) + `CREATE TABLE IF NOT EXISTS corrections` + ordered backfill (normalize → backfill → assert) in `migrateSchema()` |
| `packages/server/src/agent/temporal.ts` | **New file.** `supersede()` writer (3 correction types), `SupersessionConflictError`, `currentFilter()` helper, `isNeverTrue()` + `getCorrections()` (derived from `corrections` table), trigger-contract validation, `vecSearchCurrent()` iterative over-fetch |
| `packages/server/src/repositories/nodes.repo.ts` | `create()`: set `createdAt` + `recordedAt` explicitly. Add `getCurrentById()`. Add `superseded_at IS NULL` + valid-time filter to `recent()`, `all()`, `byIds()` with `includeSuperseded` opt-in. `getById()` unchanged (history path). |
| `packages/server/src/db/vec.ts` | Replace single-shot search + JS filter with `vecSearchCurrent()` iterative over-fetch with adaptive widening (§6.2) |
| `packages/server/src/db/fts.ts` | Add `AND n.superseded_at IS NULL` to the WHERE clause (line ~67) |
| `packages/server/src/synthesis/dailyDigest.ts` | Add supersession filter to cooling + reminders inline SQL; verify LLM digest path input filtering |
| `packages/server/src/agent/tools/memorySearch.ts` | Verify `byIds()` filter propagates |
| `packages/server/src/agent/loop.ts` | Tag new facts with `origin` (`user_statement` | `user_correction` | `model_inference`); only the first two qualify for auto-supersession |
| `packages/server/src/agent/__tests__/w1-temporal.test.ts` | **New file.** Tests T1–T8 (revised) + T-TIME-1–5 + T-WRITE-1 + T-TRIG-1 + T-RTR-1 + T-RTR-2 + T-RTR-3 + T-RB-1 + T-FK-1 + T-SEC-1 + T-PAR-1 + T-NT-1 + T-HIST-1a + T-HIST-1b + T-MIG-1 + T-CAS-1 |

**Estimated scope:** ~300 lines of new production code (temporal.ts + corrections helpers + iterative vec search + filter helpers + method contracts), ~200 lines of migration/schema changes (including `corrections` table), ~700 lines of tests. No new dependencies. No LLM calls in the supersession writer (deterministic SQL + audit INSERT). The `origin` tagging in the agent loop is metadata only, not a new LLM call.
