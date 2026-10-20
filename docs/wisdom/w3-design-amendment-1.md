# W3 Design Amendment 1 — Fingerprint Columns & Invalidation Reasons

**Amends:** `docs/wisdom/w3-design.md` Revision 11 (owner-approved design)
**Status:** Draft Revision 2 — revised per architecture review 2026-10-20 (three migration clarifications incorporated in §2). **No migration or implementation is authorized by this document.** Milestone 3 remains unauthorized until this amendment is reviewed and approved.
**Origin:** Milestone 2 implementation finding (Flag #1), confirmed against deploy HEAD `a6b60e8f` (schema verified 2026-10-20 from `packages/server/src/db/schemaSql.ts` at that commit).

---

## Issue 1 — The §6.1 fingerprint names two columns that do not exist

### Facts (verified against the schema at `a6b60e8f`)

`user_model` columns at HEAD: `id, space_id, slot, content, confidence, evidence_strength, evidence_ids, topic_labels, valid_at, invalid_at, invalid_reason, replaced_by, origin, created_at` — plus, via Milestone 1 migration only, `review_flag, review_flagged_at`.

The design's protected-column list (§6.1, carried from Revision 3) names `invalidated_by` and `updated_at`. **Neither column exists.** The Milestone 2 implementation therefore fingerprinted the protected columns as they exist:

```
id, slot, content, evidence_ids, confidence, valid_at, invalid_at, invalid_reason, replaced_by
```

### Decision

**Adopt the as-implemented set as the canonical protected-column set**, and correct the design text: §6.1's list is amended to the nine columns above. `invalid_reason` is included (it was not in the design's list) because an invalidation-reason change on a stated row is a protected-state change and must move the fingerprint.

### Why this set is sufficient

The fingerprint's job is narrow: detect any change to the *current stated set* between the Tier 2 snapshot and the commit-phase re-verification (Rev 6 optimistic concurrency). Every authorized stated-row writer (the §8.6 inventory, reconciled at Gate 0 and wired in Milestone 1) changes a stated row in only these ways:

- **Insert a new stated row** → the row set changes; the new row's `id` and columns enter the hash input.
- **Invalidate a stated row** (`recordStated` supersession, `correctUserModel`, `applyForgetRequest`) → `invalid_at`, `invalid_reason`, `replaced_by` change. All three are covered.
- **Prune `evidence_ids`** (forget flow, partial withdrawal) → covered directly.
- **Content/confidence replacement** → corrections write a *new* row and invalidate the old one; both effects are covered. No writer edits `content` or `confidence` in place on an existing stated row.

Columns deliberately excluded, with reasons:

- `topic_labels`, `evidence_strength` — never written in place on stated rows by any authorized writer (recompute paths target inferred/consolidated rows; stated rows are flag-only). If a future writer ever edits them in place on stated rows, this amendment must be revisited — the §8.6 write contract's "every verb, every caller" rule is the tripwire.
- `space_id`, `origin`, `created_at` — immutable after insert by construction.
- `review_flag`, `review_flagged_at` — excluded **by design** (Revision 4 decision): they are the intended-to-be-mutable review-metadata exception; including them would make every legitimate flag-set look like an integrity violation.

### Test expectations

- A fingerprint-stability test: `snapshotStatedIntegrity` is unchanged across a `SetReviewFlag` write and across reads.
- A fingerprint-sensitivity test: mutating each covered column on a stated row (via the authorized writers) changes the fingerprint — extending T-C57's existing coverage to `invalid_reason`.
- The design text fix itself is verified by review (this amendment), not by a test.

---

## Issue 2 — `stated_conflict` and `evidence_forgotten` violate the `invalid_reason` CHECK

### Facts (verified)

The HEAD schema constrains `invalid_reason` to exactly:

```sql
CHECK (invalid_reason IN ('superseded','corrected_false_belief','evidence_withdrawn','expired','user_override'))
```

The approved design requires two more values:

- `'stated_conflict'` — §5.3 cell 7/7b (a non-stated challenger invalidated because a current stated belief wins).
- `'evidence_forgotten'` — §7.3 (a consolidated entry invalidated after forget propagation empties its evidence set).

Milestone 2's boundary works within the current constraint (withdrawal escalation writes `'evidence_withdrawn'` per §6.1 step 4); Milestone 3's adjudication cannot — cell 7 has no lawful value today.

### Decision

**Schema migration: extend the CHECK to seven values** — add `'stated_conflict'` and `'evidence_forgotten'`. Mapping to existing values was considered and rejected: `'stated_conflict'` → `'superseded'` would erase the audit distinction between "replaced by a newer belief" and "removed because it contradicted the user's stated word," and reconciliation (§5.6) and the §9.4 incident review both read `invalid_reason` to reconstruct *why* a row died. The semantic distinction is load-bearing; the constraint must yield, not the semantics.

### Migration specification (for Milestone 3; not authorized by this amendment)

SQLite cannot alter a CHECK constraint in place, so the migration is a **table rebuild**, executed inside `migrateSchema()` (additive-migration rules; never in `BOOTSTRAP_SQL` — fresh bootstraps get the seven-value CHECK directly in the `user_model` DDL). The specification below incorporates the three clarifications required by the architecture review.

**Verified schema-object inventory for `user_model` at HEAD `a6b60e8f`** (inspected 2026-10-20 in `schemaSql.ts` + `client.ts`; the rebuild must preserve all of it):

- **No triggers** exist on `user_model` (the only triggers in the schema are on `agent_logs`).
- **No foreign key in any table references `user_model`** — every `REFERENCES` in the schema targets `nodes` or `knowledge_docs`; `replaced_by` is explicitly application-enforced, not an FK.
- **Exactly three indexes:** `idx_user_model_current` (partial, `WHERE invalid_at IS NULL`), `idx_user_model_origin`, `idx_user_model_replaced`.
- **Table constraints:** `slot` CHECK (6 values), `confidence` range CHECK, `evidence_strength` range CHECK, `origin` CHECK (3 values), `UNIQUE (space_id, slot, content, valid_at)`, `id INTEGER PRIMARY KEY AUTOINCREMENT`.
- The connection runs with `PRAGMA foreign_keys = ON` (set in `createDb()`), and `migrateSchema()` is **not** executed inside an enclosing transaction.

**Procedure:**

1. **Idempotence guard — full-contract verification, fail closed.** Parse the `invalid_reason` value set out of the current `user_model` DDL in `sqlite_master` and compare it as a *set*:
   - Set equals the original five values → run the rebuild.
   - Set equals the complete expected seven values → skip (already migrated).
   - **Anything else** — a partial extension (e.g. contains `'stated_conflict'` but not `'evidence_forgotten'`), extra values, or an unparseable DDL → **throw**, naming the set actually found. An unexpected intermediate schema must fail the boot loudly, never silently pass.
2. **Foreign-key pragma ordering.** SQLite ignores `PRAGMA foreign_keys` toggles issued inside an active transaction, so ordering is contractual:
   - On entry, assert `sqlite.inTransaction === false`. If a transaction is already active, **throw** (fail closed) — proceeding would silently run the rebuild with FK enforcement in its unknown current state.
   - Record the current `PRAGMA foreign_keys` value; set `foreign_keys = OFF` **before** `BEGIN IMMEDIATE`.
   - Run the entire rebuild inside that one transaction (step 3).
   - Before `COMMIT`, run `PRAGMA foreign_key_check` — it must return zero rows (defense-in-depth: verified above that nothing references `user_model` today, but the check is cheap and catches future schema drift).
   - In a `finally` path — on success **and** on failure/rollback — restore the recorded `foreign_keys` value and verify the restore by reading the pragma back; a failed restore throws.
3. **Rebuild.** `CREATE TABLE user_model_new` reproducing the complete verified shape above — every column (including the Milestone 1 migrate-only `review_flag`, `review_flagged_at`), every constraint verbatim **except** the extended seven-value `invalid_reason` CHECK — then `INSERT INTO user_model_new SELECT` with an explicit column list, `DROP TABLE user_model`, `ALTER TABLE user_model_new RENAME TO user_model`, and recreate the three indexes exactly.
4. **Post-migration assertions** (throw on any mismatch, per the W2/W3 pattern):
   - Row-count parity between pre- and post-rebuild `user_model`.
   - The new DDL's `invalid_reason` set equals the expected seven values.
   - `PRAGMA index_list(user_model)` shows exactly the three expected indexes, and their DDL in `sqlite_master` matches the HEAD definitions.
   - `PRAGMA integrity_check` returns `ok`.
   - AUTOINCREMENT continuity: `sqlite_sequence` for `user_model` is at least `max(id)`, so no future insert can reuse an id.

### Compatibility

- Existing rows carry only the original five values — all remain valid under the seven-value CHECK. No data transformation.
- Rollback: a pre-Milestone-3 database restored onto Milestone 3 code is unaffected (the rebuild is one-way but value-compatible in both directions for existing data; new values written by M3 code would violate the *old* CHECK only if the old code ran against the new database — the standing no-downgrade assumption applies).

### Test expectations (Milestone 3)

- Migration test: a database built with the five-value CHECK migrates to seven values with **zero row loss and zero value changes**; running the migration twice is a no-op.
- Guard tests: a hand-built schema whose CHECK contains `'stated_conflict'` but **not** `'evidence_forgotten'` makes the migration throw (fail-closed partial state); invoking the migration helper with an already-open transaction throws.
- FK-restore test: after a successful migration **and** after a forced mid-rebuild failure, `PRAGMA foreign_keys` reads back its pre-migration value.
- Preservation test: index inventory + index DDLs, all table constraints, and `sqlite_sequence` continuity are asserted post-rebuild against the pre-rebuild snapshot.
- T-C55 extension: bootstrap-vs-migration equivalence now includes the extended CHECK.
- Adjudication tests (T-C34–T-C38 family): cell 7 invalidations persist `invalid_reason='stated_conflict'`; §7.3 forget propagation persists `'evidence_forgotten'` — asserted against real SQLite through `createDb()`, per the standing no-mocked-transactions rule.

---

## Acceptance criteria for this amendment

1. Reviewer confirms the protected-column set (Issue 1) and its sufficiency argument, or names a column to add.
2. Reviewer confirms the migration choice (Issue 2) over value-mapping, and the rebuild specification's completeness (columns, indexes, guard, assertion).
3. Owner approves the amendment. Only then may Milestone 3 be separately authorized; the migration lands inside Milestone 3's branch, not before.
