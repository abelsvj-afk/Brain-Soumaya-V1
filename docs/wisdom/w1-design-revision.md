# W1 Design Revision — Temporal Truth
### Soumaya Second Brain · Wisdom Layer Phase W1
### Status: Design revision addressing ChatGPT architecture review (2026-10-19)

---

## 0. What W1 is

The smallest change that kills the reported bug: the daily digest told a man with no car about his "car insurance payment" and told an employed man he's "in between jobs."

W1 introduces a **true bitemporal model** on the `nodes` table — distinguishing when a fact was true in the real world from when the system learned it — plus atomic, auditable, non-destructive supersession, and a "what's true now" filter applied to every retrieval path.

**This document is design only. No implementation is authorized by this document.**

---

## 1. Bitemporal schema (addresses review §2A)

### 1.1 The problem with the original proposal

The research report proposed `valid_at`/`invalid_at`/`superseded_by`. The review correctly identified this as insufficient: those columns describe when a fact applies in the modeled world, but bitemporal data must also preserve **when the system recorded or believed that fact**.

Concrete scenario:
- **Oct 1**: Soumaya records "user is between jobs" (system learns it Oct 1).
- **Oct 10**: User says "I started the Samsonite job on Oct 8" (system learns it Oct 10; the fact was true since Oct 8).

After this update, the system must answer three distinct questions:
1. "What is true right now?" → employed at Samsonite (since Oct 8).
2. "What did the system believe on Oct 5?" → between jobs (recorded Oct 1, not yet superseded).
3. "When was the user actually between jobs?" → from some unknown start until Oct 8.

A single `valid_at`/`invalid_at` pair cannot answer all three. We need **valid time** (when true in the world) and **transaction time** (when the system knew it) as separate axes.

### 1.2 New columns on `nodes`

| Column | Type | Nullable | Semantics |
|---|---|---|---|
| `valid_from` | TEXT (ISO 8601) | YES | When this fact became true in the real world. NULL = unknown / not applicable. |
| `valid_to` | TEXT (ISO 8601) | YES | When this fact stopped being true in the real world. NULL = still true (or unknown end). |
| `recorded_at` | TEXT (ISO 8601) | NO | When the system recorded this row. Immutable. Set at INSERT to `CURRENT_TIMESTAMP`. Never updated. |
| `superseded_at` | TEXT (ISO 8601) | YES | When this row was superseded by a newer row. NULL = this row is current (not superseded). |
| `superseded_by` | INTEGER (FK → nodes.id) | YES | The node id that replaced this row. NULL = not superseded. |
| `supersede_reason` | TEXT | YES | Machine-readable reason: `correction` \| `update` \| `contradiction_detected` \| `user_override`. NULL if not superseded. |

**Why these six and not fewer:**

- `valid_from`/`valid_to` = **valid time** (the world's timeline). Answers "when was this true?"
- `recorded_at`/`superseded_at` = **transaction time** (the system's timeline). Answers "when did we know it, and when did we stop believing it?"
- `superseded_by` = **provenance link**. Answers "what replaced it?" Enables the supersession chain visualization (W7).
- `supersede_reason` = **audit classification**. Answers "why?" Distinguishes user corrections from system-detected contradictions.

**What we deliberately do NOT add in W1:**
- No `valid_at`/`invalid_at` (the original proposal's names) — replaced by the clearer `valid_from`/`valid_to` + `recorded_at`/`superseded_at` split.
- No bitemporal columns on `edges` in W1. Edges inherit temporal validity from their endpoint nodes for retrieval purposes. (Edge-level bitemporality is deferred; the review's concern about edge semantics is noted but out of W1 scope — see §8.)
- No `transaction_from`/`transaction_to` range columns. `recorded_at` (immutable insert time) + `superseded_at` (NULL = still believed) is sufficient for W1's query patterns and avoids the complexity of closed transaction-time intervals.

### 1.3 Corrections vs. ordinary updates (addresses review §2A)

These are **different operations** with different semantics:

**Ordinary update** (new information about the present/future):
- Example: Oct 1 "between jobs" → Oct 10 "started Samsonite Oct 8."
- The new row gets `valid_from = '2026-10-08'` (when the new fact became true).
- The old row gets `valid_to = '2026-10-08'`, `superseded_at = <now>`, `superseded_by = <new_id>`, `supersede_reason = 'update'`.
- The old row's valid-time interval is now closed: `[?, 2026-10-08)`.

**Correction** (the old row was wrong):
- Example: System recorded "user's car insurance is $200/mo" but user says "I don't have a car, never did."
- The new row (if any — a correction may assert a *negation* with no replacement fact) gets `valid_from` = when the correct fact became true (may be NULL if unknown, or may predate the wrong row).
- The old row gets `valid_to = <valid_from of the correction>` (or NULL if the wrong fact was never true), `superseded_at = <now>`, `superseded_by = <new_id or NULL>`, `supersede_reason = 'correction'`.
- Key difference from update: a correction asserts the old row's valid-time claim was **false**, not just ended. If the user never had a car, the old row's `valid_to` is set to its own `valid_from` (zero-length interval = "was never true") or left NULL with a `supersede_reason = 'correction'` flag for the audit trail.

**User override** (explicit user instruction about the model):
- Example: User says "stop telling me about trucking, I'm not doing that anymore" when no new fact replaces it.
- The old row gets `superseded_at = <now>`, `superseded_by = NULL`, `supersede_reason = 'user_override'`, `valid_to = <now>`.
- No new row is created. The fact is retired by user fiat.

### 1.4 Retrieval with overlapping facts and uncertainty (addresses review §2A)

**The "what's true now" filter** (used by all current-state queries):

```sql
-- A node is "currently true" iff:
--   1. Not soft-deleted (existing convention)
--   2. Not superseded (W1 new)
--   3. Its valid-time interval includes now (or is unbounded)
SELECT * FROM nodes
WHERE space_id = ?
  AND deleted_at IS NULL
  AND superseded_at IS NULL
  AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP)
  AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP)
```

**Handling NULL `valid_from`** (unknown when the fact became true):
- NULL `valid_from` means "we don't know when this became true, but we believe it's true now."
- The filter treats NULL `valid_from` as "since the beginning of time" — the row passes the filter.
- This is the **safe default for backfilled data** (§3): existing memories get NULL `valid_from`, meaning "we believe this is currently true, we just don't know since when."
- Rationale: requiring a known `valid_from` would exclude all legacy data. The system must degrade gracefully.

**Handling NULL `valid_to`** (unknown end / still true):
- NULL `valid_to` means "we believe this is still true" (open-ended interval).
- The filter treats NULL `valid_to` as "until the end of time" — the row passes the filter.

**Overlapping facts** (two current rows that appear contradictory):
- W1 does NOT attempt automatic contradiction resolution at query time. If two rows both pass the "what's true now" filter and appear contradictory, both are returned.
- Contradiction *detection* (flagging overlaps for future supersession) is a W3 consolidation concern, not W1.
- Rationale: W1's job is to stop surfacing *known-superseded* facts. Detecting *unknown* contradictions is a harder problem that requires the consolidation job.

**Historical queries** ("what did we believe on date X?"):
```sql
-- What was "current" as of a past timestamp (for audit / "what did you tell me last week?"):
SELECT * FROM nodes
WHERE space_id = ?
  AND deleted_at IS NULL
  AND recorded_at <= ?
  AND (superseded_at IS NULL OR superseded_at > ?)
```
This uses transaction time only — it reconstructs the system's belief state at a point in time, regardless of valid time. This is the audit query.

---

## 2. Supersession semantics (addresses review §2B)

### 2.1 Invalidation rules: what "started new job" does and doesn't invalidate

**The principle:** Supersession is **narrow and explicit**. A new fact invalidates only the specific fact it directly contradicts, not everything topically related.

**Rule 1 — Direct state contradiction:**
A new node supersedes an existing current node **iff** they make mutually exclusive claims about the same subject at overlapping valid times.

| New fact | Invalidates | Does NOT invalidate |
|---|---|---|
| "Started Samsonite job Oct 8" | "Between jobs" (employment *status*) | "Worked at Chewy 2021-2022" (employment *history*) |
| "Don't have a car" | "Car insurance is $200/mo" (dependent fact) | "Took the bus to work" (unrelated) |
| "Moved to new apartment" | "Lives at 123 Oak St" (current address) | "Grew up in Jacksonville" (origin) |

**Rule 2 — Dependent facts cascade (one level):**
If fact B was recorded as *dependent* on fact A (via an edge with `relationship = 'depends_on'` or `relationship = 'assumes'`), and A is superseded by correction (not update), then B is also superseded with `supersede_reason = 'correction'` and `superseded_by` pointing to A's replacement (or NULL).

Example: "Car insurance is $200/mo" depends on "Has a car." When "Has a car" is corrected to "No car," the insurance fact is automatically superseded as well.

Cascade is **one level only** in W1 (no transitive closure). Deeper cascades are a W3 concern.

**Rule 3 — History is never invalidated by present changes:**
A fact about a closed time period (e.g., "Worked at Chewy 2021-2022" with `valid_from = '2021-01-01'`, `valid_to = '2022-01-01'`) is **never** superseded by a fact about a different time period. The valid-time intervals don't overlap, so there's no contradiction.

**Rule 4 — Ambiguous cases default to NO invalidation:**
If the system cannot determine with high confidence that two facts are mutually exclusive, it does **not** supersede. Instead, it logs a `potential_contradiction` entry to `agent_logs` for future consolidation review (W3).

Example: "Started new job" + existing "Freelance gigs on weekends" — these *might* coexist (part-time + freelance). No automatic invalidation. Log for review.

### 2.2 Atomicity

Supersession is a **single SQLite transaction**:

```sql
BEGIN IMMEDIATE;
  -- 1. Insert the new row
  INSERT INTO nodes (space_id, label, type, content, valid_from, recorded_at, ...)
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ...);
  -- 2. Get the new row's ID
  -- 3. Supersede the old row(s)
  UPDATE nodes
  SET valid_to = ?, superseded_at = CURRENT_TIMESTAMP,
      superseded_by = ?, supersede_reason = ?
  WHERE id IN (...) AND space_id = ? AND superseded_at IS NULL;
  -- 4. Verify exactly the expected rows were updated (optimistic concurrency check)
  -- 5. Write audit log
  INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
  VALUES (?, 'soumaya', 'supersede', ?, ?, ?);
COMMIT;
```

If any step fails, the entire transaction rolls back. There is no state where the new row exists but the old row isn't superseded (or vice versa).

### 2.3 Auditability

Every supersession writes an `agent_logs` row with:
- `action = 'supersede'`
- `description` = human-readable: `"Superseded 'Between jobs' (id 123) with 'Started Samsonite' (id 456). Reason: update. Valid: ? → 2026-10-08."`
- `targets` = JSON: `{"old_id": 123, "new_id": 456, "reason": "update", "old_valid_to": "2026-10-08"}`
- `result` = `"ok"` or error message

This makes every supersession traceable: who (agent), what (which rows), when (`created_at`), why (`supersede_reason` + description).

### 2.4 Non-destructiveness

Superseded rows are **never deleted, never modified** except for the six supersession columns (`valid_to`, `superseded_at`, `superseded_by`, `supersede_reason`). The original `content`, `label`, `recorded_at`, and all other fields are immutable after supersession.

Historical queries (§1.4) can always reconstruct what the system believed at any point in time.

### 2.5 Concurrency control (addresses review §3)

**Threat:** Two concurrent processes both try to supersede the same fact (e.g., the agent loop and a consolidation job both detect that "between jobs" is stale).

**Mechanism: optimistic concurrency via `superseded_at IS NULL` guard.**

The UPDATE in §2.2 includes `AND superseded_at IS NULL`. If two transactions race:
1. Transaction A: `UPDATE ... WHERE id = 123 AND superseded_at IS NULL` → succeeds (1 row updated).
2. Transaction B: `UPDATE ... WHERE id = 123 AND superseded_at IS NULL` → succeeds but updates **0 rows** (A already set `superseded_at`).

After the UPDATE, the code checks `changes`:
```typescript
const result = stmt.run(...);
if (result.changes === 0) {
  // Another transaction already superseded this row. Roll back and re-read.
  throw new SupersessionConflictError(oldId);
}
```

On `SupersessionConflictError`, the caller rolls back, re-reads the current state, and decides whether to retry (if the new supersession is still needed) or abort (if the other transaction already handled it).

**Why not a UNIQUE constraint?** A partial unique index on `(space_id, fact_key) WHERE superseded_at IS NULL` would require a `fact_key` column — a canonical identifier for "the same fact." Defining `fact_key` reliably requires entity resolution (is "job at Samsonite" the same fact as "warehouse job"?), which is a W2/W3 problem. The optimistic `superseded_at IS NULL` guard provides the same race protection without requiring fact identity.

**SQLite locking:** `BEGIN IMMEDIATE` acquires a reserved lock upfront, preventing `SQLITE_BUSY` errors from deferred lock escalation. better-sqlite3 is synchronous, so within a single process, transactions are serialized. Cross-process concurrency (if multiple server instances share a volume) is handled by the optimistic guard above.

---

## 3. Migration and backfill (addresses review §3)

### 3.1 Migration DDL (follows repo's existing pattern)

In `db/client.ts` `migrateSchema()`, following the existing PRAGMA-guarded pattern:

```typescript
// W1: Bitemporal columns for temporal truth. All additive, all nullable
// except recorded_at (which backfills from created_at).
const nodeCols = sqlite.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
for (const [col, ddl] of [
  ["valid_from", `ALTER TABLE nodes ADD COLUMN valid_from TEXT`],
  ["valid_to", `ALTER TABLE nodes ADD COLUMN valid_to TEXT`],
  ["recorded_at", `ALTER TABLE nodes ADD COLUMN recorded_at TEXT`],
  ["superseded_at", `ALTER TABLE nodes ADD COLUMN superseded_at TEXT`],
  ["superseded_by", `ALTER TABLE nodes ADD COLUMN superseded_by INTEGER`],
  ["supersede_reason", `ALTER TABLE nodes ADD COLUMN supersede_reason TEXT`],
] as const) {
  if (!nodeCols.some((c) => c.name === col)) sqlite.exec(ddl);
}
```

In `db/schemaSql.ts` `BOOTSTRAP_SQL`, add the six columns to the `CREATE TABLE nodes` statement (for fresh databases).

In `db/schema.ts` (drizzle), add the six fields to the `nodes` table definition:
```typescript
validFrom: text("valid_from"),
validTo: text("valid_to"),
recordedAt: text("recorded_at"),
supersededAt: text("superseded_at"),
supersededBy: integer("superseded_by"),
supersedeReason: text("supersede_reason"),
```

### 3.2 Backfill policy

After adding columns, backfill in the same migration:

```sql
-- recorded_at: when the system learned this fact. Best available proxy is created_at.
UPDATE nodes SET recorded_at = created_at WHERE recorded_at IS NULL;

-- valid_from: unknown for existing data. NULL = "we believe this is true, unknown since when."
-- (No UPDATE needed — NULL is the correct default.)

-- valid_to: NULL = "we believe this is still true." (No UPDATE needed.)

-- superseded_at / superseded_by / supersede_reason: NULL = "current, not superseded."
-- (No UPDATE needed.)
```

**Summary:** All existing rows start as **current** (`superseded_at IS NULL`), with `recorded_at = created_at` and unknown valid time (`valid_from`/`valid_to` NULL). This means:
- The "what's true now" filter (§1.4) includes all existing rows (NULL `valid_from`/`valid_to` pass).
- No existing behavior changes until a supersession occurs.
- The system degrades gracefully: old data is treated as "believed true, temporal bounds unknown."

### 3.3 Memories with unknown temporal validity

This is the **normal case** for backfilled data, not an edge case. The design handles it via the NULL semantics in §1.4:
- Unknown `valid_from` → treated as "true since forever" for filter purposes.
- Unknown `valid_to` → treated as "true until superseded" for filter purposes.
- The system is **optimistic about current truth** for legacy data and **pessimistic about supersession** (requires explicit evidence per §2.1, Rule 4).

### 3.4 Rollback

**Can the migration be reversed without data loss?** Yes.

Rollback procedure:
1. The six columns are purely additive. Dropping them (`ALTER TABLE nodes DROP COLUMN ...` — supported in SQLite 3.35+) removes W1 functionality but does not affect any pre-existing columns or data.
2. Superseded rows remain in the table with their original `content` intact. After rollback, they become visible again (the `superseded_at IS NULL` filter no longer exists). This is **safe but noisy** — the user would see stale facts again, which is the pre-W1 behavior.
3. `agent_logs` supersession records are preserved (separate table, not rolled back), providing an audit trail of what was superseded if the migration is re-applied.

**No data loss scenario:** At no point does W1 delete or overwrite existing data. The worst-case rollback outcome is returning to pre-W1 behavior (stale facts visible), not data corruption.

---

## 4. Retrieval integration (addresses review §3)

### 4.1 Every query path that must filter superseded facts

The "what's true now" filter (`deleted_at IS NULL AND superseded_at IS NULL AND (valid_from IS NULL OR valid_from <= now) AND (valid_to IS NULL OR valid_to > now)`) must be applied to **all** of the following:

| # | Path | File | Current filter | W1 change |
|---|---|---|---|---|
| 1 | **Digest: fresh memories** | `synthesis/dailyDigest.ts` → `NodesRepo.recent()` | `deleted_at IS NULL` | Add `superseded_at IS NULL` + valid-time bounds |
| 2 | **Digest: cooling memories** | `synthesis/dailyDigest.ts` (inline SQL) | `deleted_at IS NULL` | Add `superseded_at IS NULL` + valid-time bounds |
| 3 | **Digest: due reminders** | `synthesis/dailyDigest.ts` (inline SQL) | `deleted_at IS NULL` | Add `superseded_at IS NULL` (reminders are point-in-time, valid-time bounds not needed) |
| 4 | **Chat context builder** | `agent/loop.ts` (context assembly) → `NodesRepo` methods | Various | All `NodesRepo` read methods get the filter |
| 5 | **memorySearch tool** | `agent/tools/memorySearch.ts` → vector search + `NodesRepo.byIds()` | `deleted_at IS NULL` (in `byIds`) | Add `superseded_at IS NULL` to `byIds` |
| 6 | **Galaxy: all nodes** | `NodesRepo.all()` | `deleted_at IS NULL AND status != 'archived'` | Add `superseded_at IS NULL` — superseded nodes ghost out (W7 will visualize this; W1 just excludes them from "live" queries) |
| 7 | **GraphRAG / fallback retrieval** | `repositories/` vector search paths | Various | Any path that returns nodes for LLM context must apply the filter |
| 8 | **Proactive candidates** | `agent/tools/` (checkin, reviewNudge, weeklyReview, billRisk) | Various | Candidate generation queries must exclude superseded facts |

### 4.2 The bypass problem (review's specific concern)

The review noted: *"The user-reported bad digest (LLM-generated 'Car Insurance Payment / Job Situation' sections) came through a different path than buildDailyDigest."*

**Root cause hypothesis:** `buildDailyDigest` (the deterministic, no-LLM function in `synthesis/dailyDigest.ts`) produces structured sections (fresh, connections, cooling, reminders). The bad digest the user received had LLM-generated narrative sections ("Car Insurance Payment: You've successfully completed..."), which suggests it went through an **LLM summarization layer** — likely the Telegram digest path or a `dramatize.ts` / synthesis LLM call that takes `buildDailyDigest` output (or raw nodes) and generates prose.

**W1's answer — defense in depth:**

1. **Filter at the source** (§4.1): Every query path that reads nodes applies the "what's true now" filter. If a superseded "car insurance" node never reaches the LLM, the LLM cannot hallucinate about it.

2. **Filter at the repository boundary**: Rather than patching every call site, W1 adds the filter to `NodesRepo`'s core read methods (`recent`, `all`, `byIds`, `search`). Any code path using `NodesRepo` gets the filter automatically. Raw SQL paths (digest cooling/reminders queries) are patched individually.

3. **Audit for bypasses**: W1 implementation must include a codebase search for every `FROM nodes` and `from(nodes)` occurrence, verifying each either (a) goes through `NodesRepo` (gets the filter), (b) has the filter inline, or (c) is explicitly documented as a historical/audit query (uses the §1.4 historical pattern instead).

**The invariant:** No code path that presents information as "currently true" may return a row where `superseded_at IS NOT NULL`. Historical/audit paths are the only exception, and they must be explicitly marked.

### 4.3 Exact SQL patterns

**Standard "what's true now" (raw SQL):**
```sql
SELECT <cols> FROM nodes
WHERE space_id = ?
  AND deleted_at IS NULL
  AND superseded_at IS NULL
  AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP)
  AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP)
```

**Drizzle (repository methods):**
```typescript
import { and, eq, isNull, or, lte, gt, sql } from "drizzle-orm";

function currentFilter(spaceId: string) {
  const now = new Date().toISOString();
  return and(
    eq(nodes.spaceId, spaceId),
    isNull(nodes.deletedAt),
    isNull(nodes.supersededAt),
    or(isNull(nodes.validFrom), lte(nodes.validFrom, now)),
    or(isNull(nodes.validTo), gt(nodes.validTo, now)),
  );
}
// Usage: .where(currentFilter(this.spaceId))
```

**Historical "what did we believe on date X" (audit only):**
```sql
SELECT <cols> FROM nodes
WHERE space_id = ?
  AND deleted_at IS NULL
  AND recorded_at <= ?
  AND (superseded_at IS NULL OR superseded_at > ?)
```

---

## 5. The supersession writer (new module)

W1 introduces a single new module: `packages/server/src/agent/temporal.ts` (or `packages/server/src/db/temporal.ts` — final location decided at implementation).

**Single entry point:**
```typescript
interface SupersedeInput {
  spaceId: string;
  oldNodeId: number;           // The row being superseded
  newContent: {                // The replacement fact (null for user_override with no replacement)
    label: string;
    type: string;
    content: string;
    validFrom: string | null;  // When the new fact became true (null = unknown)
    // ... other node fields
  } | null;
  reason: 'correction' | 'update' | 'user_override';
  actor: string;               // 'soumaya' | 'user' | 'consolidation' (W3)
}

interface SupersedeResult {
  oldNodeId: number;
  newNodeId: number | null;
  supersededAt: string;
}
```

**Behavior:**
1. `BEGIN IMMEDIATE`.
2. Validate: old row exists, `space_id` matches, `superseded_at IS NULL` (not already superseded).
3. If `newContent` provided: INSERT new row with `recorded_at = CURRENT_TIMESTAMP`, `valid_from` from input.
4. UPDATE old row: `valid_to` = new row's `valid_from` (or `CURRENT_TIMESTAMP` for user_override), `superseded_at = CURRENT_TIMESTAMP`, `superseded_by` = new row id (or NULL), `supersede_reason` = reason.
5. Check `changes === 1`, else throw `SupersessionConflictError`.
6. INSERT `agent_logs` audit row.
7. `COMMIT`. Return result.

**Who calls it in W1:**
- The agent loop's memory-write path (when the LLM or user provides a fact that contradicts a current fact).
- The Telegram `/log` handler (same path as agent loop).
- Explicit user corrections via chat ("actually, I don't have a car").

**Who does NOT call it in W1:**
- The consolidation job (doesn't exist yet — W3).
- Automatic contradiction detection (doesn't exist yet — W3).
- Any background process. W1 supersession is **only** triggered by explicit new information (user statement or agent inference during conversation).

---

## 6. Regression tests (addresses review §3)

All tests in `packages/server/src/agent/__tests__/w1-temporal.test.ts`. Tests use `createDb()` (in-memory SQLite, per existing test patterns).

### T1: Basic supersession — the reported bug
```
GIVEN a node "Employment status: between jobs" (current, valid_from NULL)
WHEN supersede(spaceId, oldId, {content: "Employment status: employed at Samsonite", validFrom: "2026-10-08"}, 'update')
THEN:
  - Old row has superseded_at NOT NULL, superseded_by = newId, valid_to = "2026-10-08"
  - New row has superseded_at NULL, valid_from = "2026-10-08", recorded_at >= test start
  - "What's true now" query returns the new row, NOT the old row
  - Historical query (as of 2026-10-05) returns the old row
  - agent_logs contains a 'supersede' row with correct targets JSON
```

### T2: Out-of-order messages
```
GIVEN no employment node exists
WHEN user says on Oct 10: "I started the Samsonite job on Oct 8"
THEN new row has valid_from = "2026-10-08", recorded_at = "2026-10-10" (or test now)
AND "what's true now" includes it (valid_from <= now)
AND historical query as of Oct 9 does NOT include it (recorded_at > Oct 9)
```

### T3: Repeated corrections
```
GIVEN node A "Car insurance: $200/mo" (current)
WHEN user says "I don't have a car" → supersede A with reason='correction', newContent=null
  (A now has superseded_at NOT NULL, supersede_reason='correction')
WHEN user says "Actually I do have a car, insurance is $180" 
THEN new node B "Car insurance: $180/mo" is created (current)
AND A remains superseded (superseded_by NULL, reason='correction')
AND "what's true now" returns B, not A
AND history shows A → (corrected) → B
```

### T4: Concurrent supersession attempts
```
GIVEN node A (current)
WHEN two concurrent supersede() calls target A
THEN exactly one succeeds
AND the other throws SupersessionConflictError
AND A has exactly one superseded_at value and one superseded_by value
AND agent_logs contains exactly one 'supersede' row for A
```

### T5: Ambiguous update does NOT invalidate
```
GIVEN node A "Worked at Chewy 2021-2022" (valid_from="2021-01-01", valid_to="2022-01-01", current)
WHEN supersede(spaceId, B("Between jobs"), {content: "Employed at Samsonite", validFrom: "2026-10-08"}, 'update')
  where B is a different node
THEN A is NOT modified (superseded_at still NULL)
AND "what's true now" still returns A (its valid-time interval is closed but it's not superseded;
  note: A may be excluded by the valid_to filter for "current" queries, but it must NOT have superseded_at set)
```

### T6: Digest never surfaces superseded facts
```
GIVEN node A "Between jobs" (superseded by node B "Employed at Samsonite")
WHEN buildDailyDigest() is called
THEN no digest section (fresh, cooling, reminders) contains node A
AND node A is retrievable via historical query
```

### T7: Backfill correctness
```
GIVEN a database with pre-W1 nodes (no temporal columns)
WHEN migrateSchema() runs
THEN all rows have recorded_at = created_at, superseded_at NULL, valid_from NULL, valid_to NULL
AND "what's true now" returns all non-deleted rows (no behavior change)
```

### T8: Dependent fact cascade
```
GIVEN node A "Has a car" (current) and node B "Car insurance: $200/mo" (current)
  with edge A -> B, relationship='depends_on'
WHEN supersede(spaceId, A, null, 'correction')  // "I don't have a car"
THEN B also has superseded_at NOT NULL, supersede_reason='correction'
AND no further cascade (one level only)
```

---

## 7. Acceptance criteria (addresses review §F)

W1 is accepted iff **all** of the following hold:

**AC1 — The reported bug is dead.**
A test replicating the exact reported scenario ("in between jobs" → "started Samsonite Oct 8" → digest generated) produces a digest that does not contain the superseded "between jobs" fact in any section. This is T1 + T6.

**AC2 — "Never" is defined as: no code path presenting current truth returns superseded rows.**
Verified by: (a) all tests in §6 pass, (b) codebase audit confirms every `FROM nodes` / `from(nodes)` is either filtered or explicitly documented as historical (§4.2, step 3).

**AC3 — History is preserved.**
For every supersession in the tests, the old row is retrievable via the historical query pattern (§1.4) with its original content intact.

**AC4 — Migration is safe.**
T7 passes. Additionally: applying the migration to a copy of the production database (if available) produces zero errors and zero behavior change in existing queries (verified by running the existing test suite before and after).

**AC5 — Concurrency is correct.**
T4 passes. No test or manual scenario produces a row with `superseded_at NOT NULL` but `superseded_by` pointing to a non-existent row, or two rows both claiming to supersede the same row.

**AC6 — No regressions.**
The full existing test suite (`npm test`) passes with the W1 changes applied. Typecheck (`npm run typecheck`) passes.

---

## 8. Explicit non-goals for W1 (addresses review §G)

The following are **explicitly out of scope** for W1. Mentioning them here prevents scope creep:

1. **Episodes** (W2). No `episodes` table, no episodic texture capture.
2. **User model** (W2). No `user_model` table, no belief/desire/intention slots.
3. **Consolidation / sleep job** (W3). No nightly job, no automatic contradiction detection, no distillation.
4. **Values / behavioral ledger** (W4). No `values` table, no preference inference.
5. **Causal entries** (W4). No `causal_entries` table. The `depends_on` edge relationship used in §2.1 Rule 2 is read from existing edges only; W1 does not create new causal edges.
6. **Agent autobiography** (W5). No `agent_episodes` table.
7. **Wisdom gate** (W6). No `worth_saying` scoring, no proactive message filtering beyond Phase 2's existing notification policy.
8. **Galaxy visualization of temporal state** (W7). W1 excludes superseded nodes from `NodesRepo.all()` (so they don't render as live), but does not add ghosting, causal edge rendering, or supersession chain UI.
9. **Edge-level bitemporality.** Edges do not get temporal columns in W1.
10. **Automatic contradiction detection.** W1 only supersedes on explicit new information (§5, "Who calls it"). Detecting contradictions in existing data is W3.
11. **LLM-based supersession decisions.** In W1, the decision to supersede is made by the calling code (agent loop / user correction handler), not by a dedicated LLM judge. The supersession *writer* is deterministic. (Whether the agent loop uses an LLM to *detect* that a new fact contradicts an old one is an agent-loop concern, not a W1 concern — W1 provides the mechanism, not the trigger.)
12. **Multi-space / cross-user temporal logic.** All operations are scoped to a single `space_id`. Cross-space queries are out of scope (and the review's authorization question is answered: no, a supersession can never cross space boundaries — `space_id` is checked in every operation).

---

## 9. Open questions for the engineering gauntlet

These are decisions the reviewer (ChatGPT) should weigh in on before implementation:

1. **Column naming**: `valid_from`/`valid_to` vs. `valid_at`/`invalid_at`? This revision uses `valid_from`/`valid_to` for clarity (matching `recorded_at`/`superseded_at` naming). Confirm or rename.

2. **Should `recorded_at` be backfilled from `created_at`, or should we use a migration timestamp?** This revision uses `created_at` (best proxy for "when the system learned it"). Alternative: set all to migration time (simpler, but loses the distinction between old and new memories in historical queries).

3. **Cascade depth**: This revision specifies one-level cascade for dependent facts. Is one level sufficient for W1, or should cascade be disabled entirely (requiring explicit supersession of each dependent fact)?

4. **The `depends_on` edge**: §2.1 Rule 2 relies on edges with `relationship = 'depends_on'` or `'assumes'`. Do these edge types exist in the current schema, or does W1 need to define them? (If they don't exist, Rule 2 has no trigger in W1 and cascade is effectively disabled until W3 creates these edges.)

5. **Galaxy behavior for superseded nodes**: This revision excludes them from `NodesRepo.all()`. Alternative: include them with a `superseded` flag for W7-style ghosting later. Which is preferred for W1?

---

## Appendix: Files touched by W1

| File | Change |
|---|---|
| `packages/server/src/db/schemaSql.ts` | Add 6 columns to `CREATE TABLE nodes` in `BOOTSTRAP_SQL` |
| `packages/server/src/db/schema.ts` | Add 6 fields to drizzle `nodes` table definition |
| `packages/server/src/db/client.ts` | Add 6 PRAGMA-guarded `ALTER TABLE` migrations + backfill in `migrateSchema()` |
| `packages/server/src/agent/temporal.ts` | **New file.** `supersede()` writer, `SupersessionConflictError`, `currentFilter()` helper |
| `packages/server/src/repositories/nodes.repo.ts` | Add supersession filter to `recent()`, `all()`, `byIds()`, `search()` |
| `packages/server/src/synthesis/dailyDigest.ts` | Add supersession filter to cooling + reminders inline SQL |
| `packages/server/src/agent/tools/memorySearch.ts` | Verify `byIds()` filter propagates (no change if it uses `NodesRepo`) |
| `packages/server/src/agent/__tests__/w1-temporal.test.ts` | **New file.** Tests T1–T8 |

**Estimated scope:** ~200 lines of new production code (mostly the `temporal.ts` module + filter helpers), ~150 lines of migration/schema changes, ~300 lines of tests. No new dependencies. No LLM calls in the hot path (supersession writer is pure SQL + one audit INSERT).
