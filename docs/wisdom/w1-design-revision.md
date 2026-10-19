# W1 Design Revision — Temporal Truth
### Soumaya Second Brain · Wisdom Layer Phase W1
### Status: **Revision 2** — addressing engineering gauntlet round 2 (2026-10-19)

> **Core principle (the foundation everything else depends on):** *A memory can stop being current without its history being rewritten, and a correction must not create false historical truth.*

---

## 0. What changed in Revision 2

The round-2 gauntlet found five blockers (B1–B5) plus six additional issues. Every one is addressed below. The structural changes from Revision 1:

| # | Change | Trigger |
|---|---|---|
| 1 | **Canonical timestamp** defined: ISO 8601 UTC `YYYY-MM-DDTHH:MM:SS.sssZ`, app-generated; DB `strftime` default as backstop; existing `created_at` normalized by migration | B1 |
| 2 | **`recorded_at` gets a DB-level DEFAULT** (`strftime` ISO 8601 UTC); full insert-path audit | B2 |
| 3 | **New `never_true` flag** + three distinct correction types (factual / false-belief / preference-override); a correction of a never-true fact sets NO valid-time interval | B3 |
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
```

---

## 2. Bitemporal schema (Revision 1 §1, corrected)

### 2.1 Columns

| Column | Type | Nullable | Default | Semantics |
|---|---|---|---|---|
| `valid_from` | TEXT | YES | NULL | When this fact became true in the real world (canonical timestamp). NULL = unknown. |
| `valid_to` | TEXT | YES | NULL | When this fact stopped being true. NULL = still true (or unknown end). |
| `never_true` | INTEGER | NO | `0` | `1` = this fact was never true; the row exists only as a corrected false belief. When `1`, `valid_from`/`valid_to` MUST be NULL. (Fixes B3.) |
| `recorded_at` | TEXT | NO | `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` | When the system recorded this row. Immutable. DB default is the backstop; app code sets `toISOString()` explicitly. (Fixes B2.) |
| `superseded_at` | TEXT | YES | NULL | When this row was superseded. NULL = current. |
| `superseded_by` | INTEGER | YES | NULL | Node id that replaced this row. Plain INTEGER, application-validated (see §7). |
| `supersede_reason` | TEXT | YES | NULL | `correction` \| `false_belief` \| `update` \| `user_override`. NULL if not superseded. |

**Why `never_true` instead of overloading `valid_to`:** Revision 1 set `valid_to` to the correction time (or zero-length interval) for false beliefs. The gauntlet correctly identified this as fabricating historical truth. A separate boolean keeps the semantics clean: `never_true = 1` means "do not interpret `valid_from`/`valid_to` at all — this row was never valid."

**Constraint (application-enforced, documented):** if `never_true = 1` then `valid_from IS NULL AND valid_to IS NULL`. The `supersede()` writer (§5) enforces this; a test asserts it.

### 2.2 The three correction types (fixes B3)

These are **different operations** with different temporal semantics. The writer MUST distinguish them; conflating them is what creates false history.

**Type 1 — Factual update** (was true, now isn't):
- Trigger: new user-provided fact directly contradicts a current fact's *present* state.
- Example: Oct 1 "between jobs" → Oct 10 "started Samsonite Oct 8."
- Old row: `valid_to = '2026-10-08T00:00:00.000Z'`, `superseded_at = <now>`, `superseded_by = <new_id>`, `supersede_reason = 'update'`, `never_true = 0`.
- New row: `valid_from = '2026-10-08T00:00:00.000Z'`, `recorded_at = <now>`.
- The old row's valid interval closes cleanly: it *was* true, then it ended.

**Type 2 — False-belief correction** (was never true):
- Trigger: user states the recorded fact was never correct.
- Example: system recorded "car insurance $200/mo" → user says "I don't have a car, never did."
- Old row: `valid_from = NULL`, `valid_to = NULL`, `never_true = 1`, `superseded_at = <now>`, `superseded_by = <new_id or NULL>`, `supersede_reason = 'false_belief'`.
- **No valid-time interval is fabricated.** The row's history reads: "believed from `recorded_at` until `superseded_at`, then corrected as false."
- If the correction asserts a replacement truth ("I take the bus"), the new row is a normal current fact. If not, no new row is created.

**Type 3 — Preference override** (not a factual claim):
- Trigger: user instruction about what to surface, not what's true.
- Example: "stop bringing up trucking."
- **Does NOT touch the temporal columns of any fact.** Trucking memories remain factually current; they are suppressed by a separate mechanism (a `directives` entry or the W6 wisdom gate's suppression rules — out of W1 scope, but W1 must not corrupt factual history to implement a preference).
- If a caller attempts `supersede_reason = 'user_override'`, the writer treats it as Type 1 with `valid_to = <now>` ONLY if the user is asserting the fact is no longer true ("I'm not doing trucking anymore" = the *pursuit* ended). If the user is only asking for silence, no supersession occurs.

### 2.3 Retrieval with the `never_true` flag

The "what's true now" filter is unchanged (superseded rows are excluded by `superseded_at IS NULL`). The `never_true` flag matters for **historical queries** and **audit**:

```sql
-- Historical: "what did we believe on Oct 5, and was it later corrected as false?"
SELECT id, label, content, recorded_at, superseded_at, never_true, supersede_reason
FROM nodes
WHERE space_id = ? AND recorded_at <= ? AND (superseded_at IS NULL OR superseded_at > ?);
-- Rows with never_true = 1 AND superseded_at <= ? are shown as "believed then, later corrected as false."
-- Rows with never_true = 1 AND superseded_at > ? (or NULL) are shown as "currently believed false" —
--   this state should not occur in practice (invariant: never_true is only set during supersession).
```

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

```sql
BEGIN IMMEDIATE;
  -- 1. Insert the new row (if any)
  INSERT INTO nodes (space_id, label, type, content, valid_from, never_true, recorded_at, ...)
  VALUES (?, ?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ...);
  -- 2. Supersede the old row (optimistic guard)
  UPDATE nodes
  SET valid_to = ?,           -- Type 1 only; NULL for Type 2
      never_true = ?,          -- 1 for Type 2, 0 otherwise
      superseded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      superseded_by = ?,
      supersede_reason = ?
  WHERE id = ? AND space_id = ? AND superseded_at IS NULL;
  -- 3. Check changes == 1, else ROLLBACK + throw SupersessionConflictError
  -- 4. Cascade (if enabled): supersede dependent rows in the same transaction
  UPDATE nodes
  SET superseded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      superseded_by = ?,       -- points to the replacement, or NULL
      supersede_reason = 'false_belief'
  WHERE id IN (
    SELECT target FROM edges
    WHERE source = ? AND space_id = ? AND relationship IN ('depends_on', 'assumes')
  )
  AND space_id = ? AND superseded_at IS NULL;
  -- 5. Audit log (content-free: IDs and reason codes only — see §8)
  INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
  VALUES (?, 'soumaya', 'supersede', ?, ?, 'ok');
COMMIT;
```

**Atomicity proof:** all writes (new row, old row, cascade rows, audit row) are inside a single `BEGIN IMMEDIATE ... COMMIT`. If any step fails, SQLite rolls back the entire transaction. There is no observable state where the new row exists but the old row isn't superseded, or where the old row is superseded but the cascade didn't run, or where the audit row is missing.

**Edge direction note:** the cascade query above assumes edges point from dependent → dependency (`source` = dependent, `target` = the fact it depends on). The implementation MUST verify this against the real schema before enabling cascade. If the direction is reversed, the query is adjusted; if the relationship names don't exist, cascade is disabled per §4.

**Cross-space guard:** every UPDATE includes `AND space_id = ?`. The cascade subquery also filters `space_id = ?`. A supersession can never cross space boundaries — verified by test T-SEC-1.

### 5.2 Concurrency (unchanged from Revision 1)

Optimistic `superseded_at IS NULL` guard + `SupersessionConflictError` + `BEGIN IMMEDIATE`. (Revision 1 §2.5 stands.)

---

## 6. Retrieval integration (fixes B5)

### 6.1 The core problem

Superseded candidates can **crowd out** valid results in top-K retrieval if filtering happens only after candidate selection. W1 pushes the `superseded_at IS NULL` filter into candidate selection itself.

### 6.2 Vector search (`db/vec.ts`)

Current code (lines 151–179) already over-fetches (`want = min(500, max(k*6, k+40))`), then filters in JS by space/deleted/archived, then slices to `k`. W1 adds one condition to the existing JS filter:

```typescript
// Current (line 168-176):
const lookup = db.prepare(
  `SELECT space_id AS s, deleted_at AS d, status AS st, superseded_at AS sup
   FROM nodes WHERE id = ?`,
);
hits = hits
  .filter((h) => {
    const row = lookup.get(h.nodeId) as {...; sup: string | null } | undefined;
    return row !== undefined
      && row.s === spaceId
      && row.d === null
      && row.st !== "archived"
      && row.sup === null;          // W1 ADDITION: exclude superseded
  })
  .slice(0, k);
```

The existing over-fetch (`k*6`) provides headroom: even if superseded nodes occupied candidate slots, the filter runs before `.slice(0, k)`, so valid results fill the top-K. **Test T-RTR-1** verifies this with a synthetic case where superseded nodes would otherwise dominate the top-K.

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

### 9.1 DDL (canonical timestamps)

```typescript
// In migrateSchema(), following the existing PRAGMA-guarded pattern:
const nodeCols = sqlite.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
for (const [col, ddl] of [
  ["valid_from",     `ALTER TABLE nodes ADD COLUMN valid_from TEXT`],
  ["valid_to",       `ALTER TABLE nodes ADD COLUMN valid_to TEXT`],
  ["never_true",     `ALTER TABLE nodes ADD COLUMN never_true INTEGER NOT NULL DEFAULT 0`],
  ["recorded_at",    `ALTER TABLE nodes ADD COLUMN recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`],
  ["superseded_at",  `ALTER TABLE nodes ADD COLUMN superseded_at TEXT`],
  ["superseded_by",  `ALTER TABLE nodes ADD COLUMN superseded_by INTEGER`],
  ["supersede_reason", `ALTER TABLE nodes ADD COLUMN supersede_reason TEXT`],
] as const) {
  if (!nodeCols.some((c) => c.name === col)) sqlite.exec(ddl);
}
```

In `BOOTSTRAP_SQL` (`CREATE TABLE nodes`), the new columns are defined with the same types and defaults. In drizzle `schema.ts`, the fields are added with matching types.

### 9.2 Backfill

```sql
-- recorded_at: best available proxy is created_at. Documented caveat: created_at is
-- when the ROW was created, which is our best approximation of "when the system learned
-- the fact" for legacy data. It is NOT proof of exact learning time (e.g., bulk imports
-- may share timestamps). Per the review's decision, this caveat is documented, not fixed.
UPDATE nodes SET recorded_at = created_at WHERE recorded_at IS NULL;
-- (The DEFAULT only applies to rows inserted AFTER the column is added;
--  existing rows get NULL from ADD COLUMN, hence the backfill.)

-- Normalize created_at to canonical format (see §1.3).
UPDATE nodes
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE created_at NOT LIKE '%T%';

-- valid_from / valid_to / never_true / superseded_* : NULL / 0 defaults are correct.
-- All existing rows start as current. No behavior change until supersession occurs.
```

### 9.3 Insert-path audit (fixes B2)

Every path that creates nodes must result in a populated `recorded_at`. The DB default guarantees this even if application code forgets, but the audit documents the intended behavior:

| # | Insert path | File | Sets `recorded_at` explicitly? | Backstop |
|---|---|---|---|---|
| 1 | `NodesRepo.create()` | `repositories/nodes.repo.ts:90` | **Yes (W1 change)** — add `recordedAt: new Date().toISOString()` alongside existing `lastTendedAt` | DB default |
| 2 | Chat extraction (agent loop writes memories) | `agent/loop.ts` → calls `NodesRepo.create()` | Via #1 | DB default |
| 3 | Telegram `/log` handler | `telegram/bot.ts` → calls `NodesRepo.create()` | Via #1 | DB default |
| 4 | Agent tool writes (`taskCreator`, `fire_reminder`) | `agent/tools/*.ts` → `NodesRepo.create()` | Via #1 | DB default |
| 5 | `supersede()` new-row insert | `agent/temporal.ts` (new) | **Yes** — explicit `strftime` in SQL | N/A (explicit) |
| 6 | Any future raw-SQL `INSERT INTO nodes` | (codebase audit) | **Must** use canonical format or rely on default | DB default |

**Test T-WRITE-1** (new, from review): create nodes through paths 1–4, verify `recorded_at` is populated and matches canonical format on every row.

### 9.4 Rollback (additional issue — revised)

**Rollback = feature flag OFF, not schema reversal.**

- W1 ships behind a feature flag (e.g., `space_meta.w1_temporal_enabled`, default ON after migration).
- **Emergency rollback:** set the flag OFF. All retrieval paths revert to pre-W1 behavior (ignore temporal columns). This is a **degraded state** — stale facts become visible again — and is documented as such. It is for emergency use only (e.g., a bug in the supersession logic is corrupting queries).
- **The service MUST NOT run in rolled-back state as a steady state.** The flag-off mode is a circuit breaker, not a supported configuration. The runbook states: flag-off → investigate → fix forward → flag-on. Maximum recommended flag-off duration is documented (e.g., 24 hours) with an alert if exceeded.
- **Schema rollback** (dropping the six columns) is possible via `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+) but is NOT the recommended rollback path — it destroys the supersession history. The flag approach preserves all data.
- **Test T-RB-1** (new, from review): with flag OFF, verify that (a) queries return pre-W1 results, (b) no data is lost (temporal columns intact), (c) re-enabling the flag restores W1 behavior without re-migration.

### 9.5 Fresh vs. migrated parity (additional issue)

**Test T-PAR-1** (new, from review):
```
GIVEN a fresh database (BOOTSTRAP_SQL with W1 columns)
AND a migrated database (pre-W1 schema + migrateSchema())
WHEN the same sequence of operations is applied to both
  (create node, supersede it, query current, query history)
THEN both databases produce identical results for all queries
AND both have identical column definitions (PRAGMA table_info comparison)
```

---

## 10. Regression tests (Revision 1 §6 + 8 new from review)

All tests in `packages/server/src/agent/__tests__/w1-temporal.test.ts`.

### Revision 1 tests (T1–T8, retained with corrections)

- **T1** (basic supersession): updated — uses canonical timestamps; asserts `never_true = 0`.
- **T2** (out-of-order): updated — `valid_from = "2026-10-08T00:00:00.000Z"` (date-only → midnight UTC per §1.4).
- **T3** (repeated corrections): updated — first correction uses Type 2 (`never_true = 1`, no valid interval); history shows "believed, corrected as false, then replaced."
- **T4** (concurrent supersession): unchanged.
- **T5** (ambiguous non-invalidation): unchanged.
- **T6** (digest exclusion): **expanded** — must cover the actual LLM-generated digest path, not just `buildDailyDigest()`. The test constructs the input that the LLM summarization layer receives and asserts no superseded fact reaches it.
- **T7** (backfill): updated — asserts canonical timestamp format on all backfilled rows.
- **T8** (cascade): updated — asserts atomic commit of old + dependent + replacement + audit (deliberately fail one step, verify full rollback).

### New tests from round-2 review

- **T-TIME-1 through T-TIME-4**: timestamp consistency (§1.5).
- **T-WRITE-1**: all insert paths populate `recorded_at` (§9.3).
- **T-TRIG-1**: ambiguous LLM inference cannot supersede (§3.2).
- **T-RTR-1**: top-K regression — superseded vector/keyword matches cannot crowd out valid results (§6.2).
- **T-RB-1**: rollback behavior — flag-off is degraded but lossless (§9.4).
- **T-FK-1**: `superseded_by` referential integrity (§7).
- **T-SEC-1**: cross-space rejection — supersession attempt across `space_id` fails without modifying either space.
- **T-PAR-1**: fresh vs. migrated parity (§9.5).

**New test: never-true correction (from review):**
```
T-NT-1: Correction of a never-true fact creates no false interval
  GIVEN node A "Car insurance: $200/mo" (current)
  WHEN user says "I don't have a car, never did"
  THEN supersede(spaceId, A, null, 'false_belief')
  AND A has valid_from IS NULL, valid_to IS NULL, never_true = 1
  AND A has superseded_at NOT NULL, supersede_reason = 'false_belief'
  AND no timestamp on A suggests it was ever true
  AND historical query shows A as "believed [recorded_at] → corrected as false [superseded_at]"
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

**AC7 — Corrections don't create false truth.** T-NT-1 passes. No test produces a row where `never_true = 1` has non-NULL `valid_from`/`valid_to`.

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
| `packages/server/src/db/schemaSql.ts` | Add 7 columns to `CREATE TABLE nodes` in `BOOTSTRAP_SQL` (with canonical defaults) |
| `packages/server/src/db/schema.ts` | Add 7 fields to drizzle `nodes` table definition |
| `packages/server/src/db/client.ts` | Add 7 PRAGMA-guarded `ALTER TABLE` migrations + backfill + `created_at` normalization in `migrateSchema()` |
| `packages/server/src/agent/temporal.ts` | **New file.** `supersede()` writer (3 correction types), `SupersessionConflictError`, `currentFilter()` helper, trigger-contract validation |
| `packages/server/src/repositories/nodes.repo.ts` | `create()`: set `createdAt` + `recordedAt` explicitly. Add `getCurrentById()`. Add `superseded_at IS NULL` + valid-time filter to `recent()`, `all()`, `byIds()` with `includeSuperseded` opt-in. `getById()` unchanged (history path). |
| `packages/server/src/db/vec.ts` | Add `superseded_at` to the post-search JS filter (line ~175) |
| `packages/server/src/db/fts.ts` | Add `AND n.superseded_at IS NULL` to the WHERE clause (line ~67) |
| `packages/server/src/synthesis/dailyDigest.ts` | Add supersession filter to cooling + reminders inline SQL; verify LLM digest path input filtering |
| `packages/server/src/agent/tools/memorySearch.ts` | Verify `byIds()` filter propagates |
| `packages/server/src/agent/loop.ts` | Tag new facts with `origin` (`user_statement` | `user_correction` | `model_inference`); only the first two qualify for auto-supersession |
| `packages/server/src/agent/__tests__/w1-temporal.test.ts` | **New file.** Tests T1–T8 (revised) + T-TIME-1–4 + T-WRITE-1 + T-TRIG-1 + T-RTR-1 + T-RB-1 + T-FK-1 + T-SEC-1 + T-PAR-1 + T-NT-1 + T-CAS-1 |

**Estimated scope:** ~250 lines of new production code (temporal.ts + filter helpers + method contracts), ~180 lines of migration/schema changes, ~500 lines of tests. No new dependencies. No LLM calls in the supersession writer (deterministic SQL + audit INSERT). The `origin` tagging in the agent loop is metadata only, not a new LLM call.
