# Unified discovery architecture — design baseline (2026-10-31)

> **Status: design baseline, FROZEN. NOT IMPLEMENTED.**
> Nothing in this document exists in code yet. Every phase, and every production action
> (census, classification, enforcement, relic enablement, Eternity release), is separately
> approved by the owner. Accepting this document authorizes none of them.
> Line numbers refer to commit `257cdd2`.

This is the Architect-reviewed design for making `story_finds` the single, trust-graded
discovery ledger, so that Codex, Book, TravelRepo, economy, roads and flavor stop keeping
competing truths about what a player has found. It was produced design-only: no
implementation or code change, production access, census, classification, enforcement or
deployment took place.
Behaviours named "measured" were measured in throwaway scripts on a local SQLite 3.53.2
build, not on production (see §18).

---

## 0. How to read this document

- §1–§14 are the architecture. §15 is the Phase 1 scope. §16 is the decision register,
  §17 the test matrix, §18 what is still unverified.
- **Authorization boundary.** Completing this design authorizes nothing. Phase 1, every later
  phase, merging, the census, classification, enforcement, the Eternity release and relic
  enablement each need their own explicit owner approval. This document does not record which
  approvals have been granted.
- **Terminology rule.** "accepted" means *admitted under server-side rules*, not *physically
  verified*. This is enforced by a test (TERM, §17) and must be used identically everywhere.

---

## 1. Terminology

| Word | Means | Never means |
|---|---|---|
| **accepted** | Admitted under the server-side checks in force for that method at admission time. | Physically verified. Stillness, spot reach, glimmer visibility and tap, and NPC meetings are client-submitted; the server cannot see them. |
| **imported** | Reported by a device from its own memory (localStorage), or classified from a legacy row whose evidence could not be confirmed. Never eligible for a gate in any mode (T4); never earns Fuel (relic Fuel claims require an accepted discovery, F1). | A discovery. |
| **unclassified** | A legacy row with `trust IS NULL`. Under `off` and `shadow` it keeps its existing gate eligibility; under enforcement-on it opens no gate. It cannot claim relic Fuel (F1). | Trusted or untrusted. It has not been judged. |
| **held** | Internal API word for `accepted`. | Shown to players. Provenance stays internal. |
| **ledger-world** | The world the travel ledger recorded. | Physical presence. |

Replay or classification never establishes physical presence or that the player performed an act.

---

## 2. Architecture and ownership

- `story_finds` is the single discovery ledger.
- `DiscoveryLedger` is its **sole writer**. The one exception is whole-account deletion in
  `auth/spaces.ts` (the `DELETE FROM ${t} WHERE space_id = ?` loop over `SPACE_SCOPED_TABLES`).
- `DiscoveryReader` is the **read boundary**.
- `TravelPresence` is a small read-only interface over `travel_journeys`, so the ledger and
  `TravelRepo` need not import each other.
- Economy may read the ledger; the ledger never reads economy.
- Separate tables stay separate (an allowlist test enforces this): `codex_claims` (the Fuel
  reward ledger), `codex_discoveries` (Soumaya's field notes), `npc_relic_holdings`,
  `story_links`, `story_notes`, `story_roads`.

### Writer boundary (stated honestly)

The database **enforces** (from enforcement onward, §6):
- no write to `story_finds` from a connection that lacks the application's registered
  capability functions (insert, update, delete);
- no sequence of DML (including `INSERT OR REPLACE`, delete-then-insert) can lower or
  fabricate trust for an existing account's discoveries;
- the only exception is whole-account deletion.

The database **cannot** enforce:
- DDL: `DROP TRIGGER` succeeds (measured). It is detected (§8.4), not prevented.
- Code running inside the application process that holds the capability: bounded by
  architecture tests (§15, P1-ARCH), not by the database.

### Attribution is not authorization

The runtime attribution used by P1-ARCH is an architectural **test** mechanism, not a
security boundary. The context marker grants no write permission, alters no query behaviour,
and is never proof that an operation was authorized. Attribution proves which module issued a
statement during a test run. Authorization is the database capability functions, from
enforcement onward. The marker is independent of the capability functions (A14, A15).

---

## 3. Schema

Additive, nullable, **no default that grants eligibility**:

```sql
ALTER TABLE story_finds ADD COLUMN trust       TEXT CHECK (trust IN ('accepted','imported'));
ALTER TABLE story_finds ADD COLUMN trust_at    TEXT;
ALTER TABLE story_finds ADD COLUMN trust_basis TEXT;
```

- Existing rows read `NULL`. A `NOT NULL DEFAULT 'accepted'` column is rejected: it would
  silently stamp every old row.
- `source TEXT NOT NULL` has no CHECK (`schemaSql.ts:1379`, `client.ts:1348`); `'import'`
  needs no schema change.
- The DDL is duplicated in `schemaSql.ts` and `db/client.ts`; both change, plus a
  PRAGMA-guarded `ALTER` in `migrateSchema` (existing pattern ~`client.ts:2010`).
- `story_finds` is raw SQL only (not in the Drizzle schema).

**Tables introduced later, each by the phase that needs it** (none in Phase 1, ruling S2).
All are append-only, protected by no-update/no-delete triggers that are created with the
table: `discovery_imports` (P3, per-space), and from P6 `discovery_runs`,
`discovery_run_classifications`, `discovery_run_outcomes`, `discovery_run_reasons`,
`discovery_completions`, `discovery_enforcements`.

Each table arrives with its first consumer:

| Table | Phase | First consumer |
|---|---|---|
| `discovery_imports` | P3 | the import route, and `importCompleted` in `GET /api/story/book` |
| `discovery_runs`, `discovery_run_classifications`, `discovery_run_outcomes`, `discovery_run_reasons`, `discovery_completions` | P6 | `discovery:classify`, `discovery:attest-zero` and the dry-run |
| `discovery_enforcements` | P6 | `discovery:enforce`, and the boot verification that reads it |

The boot verification reads these tables, so it arrives in P6 with them; before P6 the
effective mode cannot exceed `shadow` (§9). A deletion tally, if T38 is ever adopted, arrives in
the phase its own design review assigns.

### `trust_basis` vocabulary

| Basis | Written by |
|---|---|
| `live:v1` | a live admission |
| `upgrade:live:v1` | a live admission upgrading an imported row |
| `client-report` | import |
| `replay-v1;R1=…;R2=…;R3=…;nr=P,A` | classification: each check outcome, and which could not be replayed |

---

## 4. Trust states and transitions

| From → To | Trigger | Rules |
|---|---|---|
| (none) → accepted | live admission | `found_at` = now, basis `live:v1` |
| (none) → imported | import | `found_at` = server import time |
| imported → accepted | live admission passing the full live checks | `found_at`/`source` unchanged, basis `upgrade:live:v1`, `upgraded:true` |
| `NULL` → accepted / imported | classification only | basis `replay-v1;…`, `trust_at` set |
| accepted → anything | forbidden | `trust`, `trust_at`, `trust_basis` immutable |
| any → `NULL` | forbidden | |
| `space_id`, `entry_id`, `found_at`, `source` | immutable after insert | |

### Duplicate-key behaviour

The ledger reads state first, inside `BEGIN IMMEDIATE`, then branches. It never relies on
SQLite conflict handling.

| Existing | Live admit | Import | Classify |
|---|---|---|---|
| absent | insert accepted | insert imported | n/a |
| `NULL` | no write, `held:false` (T18) | no write | classify |
| imported | upgrade | no write | not selected |
| accepted | no write, `held:true` | no write | not selected |

A live admission on a `NULL` row writes nothing until classification, so a pre-classification
player holding such a relic cannot claim Fuel (owner decision O4). Option B (a live-evidence
`NULL → accepted` transition with basis `upgrade-null:live:v1`) is documented only; it needs
its own design and approval, and would turn the apply-time `NULL`-set equality check into a
subset check.

Recall bumps (`last_recalled_at`, `recall_count`) are allowed on every row, but only through
an authorized connection.

### The `NULL` boundary (T35)

- Legacy `NULL` rows are preserved from the column migration until classification.
- No new row may be `NULL`: every admission and import path writes explicit, valid
  `trust`, `trust_at`, `trust_basis` (code-enforced from Phase 1, database-enforced from
  enforcement by the insert guard).
- Only classification converts an existing `NULL` row.
- After enforcement no `NULL` rows exist at all (installer invariant 4). G2's
  `NULL → classified` branch is then unreachable and stays as defence in depth.

---

## 5. Admission flows

### 5.1 Live online admission (`POST /api/story/find`)

Canon id → `SOURCE_RE` → trigger exists → travel-ledger world (skipped for `npc:`) →
regard/listen pacing → state-first branch (§4). Pacing counts a row as kept today when
`found_at ≥ dayStart`, or its basis starts `upgrade:` and `trust_at ≥ dayStart` (T21), so
upgrades cannot escape the once-a-day limit.

**Offline admission is outside the initial implementation (D6).** Guarantees that would be
needed before it could be added: server-computed `observedAt` from a client-sent *age*; a
ceiling set from shadow telemetry; ledger-world checked at `observedAt`; per-claim nonces;
online-only stillness and gifts; a separate `accepted-late` grade; a rate cap per flush.

### 5.2 Import (`POST /api/story/import`) — P3

- **Auth and space.** Behind `requireSpace`; the destination space is always `spaceOf(res)`
  from the validated `x-space-id`. Body is a strict object `{ relics: string[] }`; any
  `spaceId`, `trust`, `source` or `foundAt` key is rejected. (The space id is itself the
  bearer credential; import neither strengthens nor weakens that model.)
- **What can be written.** Only currently `discoverable` relics; at most 15 rows per space,
  ever. The server sets `source='import'`, `trust='imported'`, basis `client-report`,
  `found_at` = server time. Anything else is counted `skipped`; skipped ids are never echoed
  or logged.
- **Limits.** 2 KB body, 30 raw items, a dedicated `rateLimit({max: 6})` per IP. The structural
  bound is the real control.
- **Middleware order.** The global `express.json` (8 MB) is mounted at `api/server.ts:72`,
  before the API routes are mounted (`:139`), so a parser placed inside the import route
  cannot enforce the limit. Required arrangement: a path-scoped `express.json({ limit: '2kb' })`
  for `/api/story/import` is mounted **before** the global parser, and the global parser is
  wrapped in a small middleware that bypasses it for the exact import path (an exact-path
  comparison on the request path), after the path-scoped 2 KB parser has run. `express.json`
  has no native skip option and none is implied. The path-scoped parser and the global-parser
  bypass must use the same route-matching predicate. That predicate must cover every path form
  accepted by the import endpoint, including a trailing slash if the endpoint accepts one.
  Alternatively, the endpoint must reject noncanonical path forms before body parsing. No
  accepted import request may fall through to the global parser. The design does not rely on
  body-parser skipping an already-parsed body. Test: a 3 KB body to the import route returns 413 from the
  path-scoped parser, and an ordinary route still enforces the global limit (§17, IMP).
- **Canonicalization.** Trim, NFC, `^[a-z0-9-]{1,40}$`, exact lookup, first occurrence wins.
- **Transaction.** One `BEGIN IMMEDIATE` creates the rows and the `discovery_imports`
  completion record together. All-or-nothing. After completion, later calls write nothing and
  return the recorded result. `GET /api/story/book` carries `importCompleted`.
- **Logging.** Event name, a hash prefix of the space id, and counts only. Never the raw
  space id, client strings, or memory text.
- **Availability.** 404 unless `DISCOVERY_IMPORT=on`, the F1 code is running, and G4 exists.

---

## 6. Database guards

### 6.1 Capability functions
`db/client.ts` (`createDb`, the only application opener, `client.ts:2020`) registers
`discovery_cap()` (returns 1) and `discovery_delete_ok(space_id)` (returns 1 only while
`deleteSpace` for that exact id holds its in-process window, cleared in `finally`). A
connection lacking them fails at statement preparation (`no such function`). Backup
connections are read-only and unaffected; `VACUUM INTO` still works (measured).

**The deletion window.** `auth/spaces.ts` `deleteSpace` does not open a window today (the
repository has no reference to one), so the guard set (G3) would block account deletion unless
`deleteSpace` is changed. That change is part of the P6 enforcement work and must be in the
running build before the guard set is installed. The window is opened for the one space id
being deleted, inside the account-deletion transaction and before its table loop, and is closed
in a `finally` block, so cleanup happens on success and on failure, including when the
transaction rolls back. The deletion routine and capability window are synchronous. No `await`
or other asynchronous yield is permitted between opening and closing the window; the window is
scoped to the deleting connection and space id. Tests G-36/G-37 and the boot self-test (§8.4) exercise the real
deletion path, not merely the flag. T38 (deferred, §16) also concerns `deleteSpace`; nothing
here settles it.

### 6.2 The guard set (G0–G3), installed only at enforcement
Capability (G0), insert validation (G1), update transitions (G2) and delete protection (G3)
are implemented by **exactly one trigger per event**, with statements that run in the order
written, so nothing depends on SQLite's unspecified ordering of separate triggers.

```sql
CREATE TRIGGER story_finds_guard_insert BEFORE INSERT ON story_finds BEGIN
  SELECT RAISE(ABORT,'NO_CAPABILITY') WHERE discovery_cap() IS NOT 1;
  SELECT RAISE(IGNORE) WHERE EXISTS (SELECT 1 FROM story_finds
                                     WHERE space_id = NEW.space_id AND entry_id = NEW.entry_id);
  SELECT RAISE(ABORT,'TRUST_METADATA_INVALID') WHERE
        NEW.trust IS NULL OR NEW.trust_at IS NULL
     OR NEW.trust_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'
     OR NEW.trust_basis IS NULL
     OR (NEW.trust='accepted' AND NEW.trust_basis NOT GLOB 'live:*')
     OR (NEW.trust='imported' AND NEW.trust_basis IS NOT 'client-report');
END;

CREATE TRIGGER story_finds_guard_update BEFORE UPDATE ON story_finds BEGIN
  SELECT RAISE(ABORT,'NO_CAPABILITY') WHERE discovery_cap() IS NOT 1;
  SELECT RAISE(ABORT,'TRUST_TRANSITION_FORBIDDEN') WHERE
        NEW.space_id IS NOT OLD.space_id OR NEW.entry_id IS NOT OLD.entry_id
     OR NEW.found_at IS NOT OLD.found_at OR NEW.source IS NOT OLD.source
     OR (OLD.trust='accepted' AND (NEW.trust IS NOT OLD.trust OR NEW.trust_at IS NOT OLD.trust_at
                                   OR NEW.trust_basis IS NOT OLD.trust_basis))
     OR (OLD.trust='imported' AND NOT (
           (NEW.trust='imported' AND NEW.trust_at IS OLD.trust_at AND NEW.trust_basis IS OLD.trust_basis)
        OR (NEW.trust='accepted' AND NEW.trust_at IS NOT NULL AND NEW.trust_basis GLOB 'upgrade:*')))
     OR (OLD.trust IS NULL AND NEW.trust IS NOT NULL
         AND NOT (NEW.trust_at IS NOT NULL AND NEW.trust_basis GLOB 'replay-v*'))
     OR (OLD.trust IS NULL AND NEW.trust IS NULL
         AND (NEW.trust_at IS NOT NULL OR NEW.trust_basis IS NOT NULL))
     OR (OLD.trust IS NOT NULL AND NEW.trust IS NULL);
END;

CREATE TRIGGER story_finds_guard_delete BEFORE DELETE ON story_finds BEGIN
  SELECT RAISE(ABORT,'DELETE_FORBIDDEN') WHERE discovery_delete_ok(OLD.space_id) IS NOT 1;
END;
```

**The `trust_at` pattern is a timestamp-*shape* check only.** It confirms a
`YYYY-MM-DDT…Z`-shaped string; it does not prove a valid calendar date or time, and the guard
is a backstop against missing or malformed values, not a validator. Validity is guaranteed in
application code, by construction: `trust_at` (and `found_at`) are produced only by
`new Date(nowMs).toISOString()` in the Ledger, the import path and the classification CLI, and
never taken from a client. Test TS-1 (§17) asserts that every written value round-trips
(`new Date(v).toISOString() === v`).

### 6.3 Column changes are defined by `OLD` versus `NEW` (T34)
The transition test compares `OLD` and `NEW` values with `IS NOT`, never the statement's `SET`
list. The trigger fires on every update (`BEFORE UPDATE ON`). Measured: no-op writes
(`SET trust=trust …`) pass; recall-only updates pass on `NULL`, imported and accepted rows,
singly and together; a different `found_at`, a different `space_id`, or `trust=NULL` on an
imported row aborts; a bulk update containing one forbidden change is all-or-nothing.

### 6.4 G4 — the Fuel claim guard (installed at boot from P2)
```sql
CREATE TRIGGER codex_claims_relic_guard BEFORE INSERT ON codex_claims
WHEN NEW.reward_key LIKE 'relic-%'
 AND NOT EXISTS (SELECT 1 FROM story_finds WHERE space_id = NEW.space_id
                  AND entry_id = 'relic.' || substr(NEW.reward_key, 7) AND trust = 'accepted')
BEGIN SELECT RAISE(ABORT,'RELIC_NOT_HELD'); END;
```
Installs idempotently on every boot of P2+ code. An already-paid key re-inserted with
`OR IGNORE` also aborts (measured), so the route must short-circuit on an existing paid row
first (§7). The mapping is exact: `relicCodexKey(id)` is `relic-${id}` and relic ids contain no
dots (`relics.ts:303`).

---

## 7. Fuel eligibility (F1) — P2

Today the claim route validates relic keys only against the static catalog
(`maintenance.ts:36–41, 195–215`): any authenticated client can claim any relic key for
`EARN_CODEX_DISCOVERY = 4` Fuel, with no find. F1 ships at P2, before import, and applies in
**every** mode:

1. If a `codex_claims` row exists, return `{awarded:false}` (200). Runs first, so existing
   paid claims are untouched.
2. Otherwise a relic key requires an accepted find; if none, return 409 `RELIC_NOT_HELD`
   with no insert and no Fuel.
3. Otherwise insert and add the Fuel in one immediate transaction.

- `NULL` rows cannot claim until classified (T11, O4).
- The client treats `RELIC_NOT_HELD` as neither failed nor seen, shows no toast, and retries
  on the next run (the existing hook marks a key seen only after a successful claim).
- A 409, not a 200, is deliberate: a 200 would make an outdated client mark the key seen
  forever and lose the reward after a later upgrade.
- A brand-new find whose claim races its `/find` is paid on the next app open (known minor
  regression; find-then-claim ordering is a P5 item).
- Existing paid claims are never revoked.
- **Residual hole**: the generic relic trigger (`storyTriggers.ts:79`) still lets `/find`
  accept undiscoverable relics until relic enablement (P7).

---

## 8. Classification, completion and enforcement

### 8.1 Evidence

| Check | Category |
|---|---|
| **R1** method allowed (a trigger exists for entry+source) | existed at admission (`story.ts:97`, introduced with the module in commit `d2bfd29`, 2026-10-30), replayed now |
| **R2** ledger-world | existed at admission (`story.ts:98`), replayed now; **always `indeterminate` for legacy world-bound rows** (`legacy-history-unestablished`); `not-applicable` for `npc:` sources |
| **R3** relic is `discoverable` | **new rule applied retroactively** |
| **P** pacing / Hour roll | cannot be replayed |
| **A** the act itself | cannot be replayed |

Why R2 is inert for legacy rows: journey rows mutate (state, `arrived_at`, bonus columns);
nothing in the database protects `travel_journeys` or `travel_journey_events`; manual SQL and
restore are unauditable from code (§14). A timeline `observation` (`agrees`, `disagrees`,
`inconsistent`, `none`) may be recorded but never changes the outcome. Treating any
observation as `pass` would be a new rule-set and a new authorization.

Any `fail` or `indeterminate` gives `imported`. Every outcome is recorded for every row, with
no short-circuit.

**Consequence (O5):** essentially every legacy world-bound discovery becomes `imported`. Once
enforcement is on, the gates they opened close until a revisit (§16, O5). Under `off` and
`shadow`, gate eligibility is unchanged.

### 8.2 Accounting
Counts are over distinct `(space_id, entry_id)`. Per run: `discoveries_classified`,
`accepted`, `imported`, and `outcome_rows` (must equal `5 × discoveries`: checks R1, R2, R3,
P, A), plus per-reason tallies and an outcome-vector histogram. Separate append-only tables:
`discovery_run_classifications` (PK `(run_id, space_id, entry_id)`), `discovery_run_outcomes`
(PK includes `check_id`), `discovery_run_reasons`.

### 8.3 Completion records (T28, T29, T32)

```sql
CREATE TABLE discovery_completions (
  completion_id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('classification','zero-null')),
  run_id INTEGER,
  rule_set TEXT NOT NULL,
  census_report_sha256 TEXT NOT NULL,
  null_keys_hash TEXT NOT NULL,
  discoveries_classified INTEGER NOT NULL,
  snapshot_sha256 TEXT, snapshot_bytes INTEGER, snapshot_created_at TEXT,
  classifier_commit TEXT, authorization_ref TEXT, applied_at TEXT NOT NULL,
  CHECK ((kind='classification' AND run_id IS NOT NULL AND discoveries_classified > 0)
      OR (kind='zero-null' AND run_id IS NULL AND discoveries_classified = 0
          AND null_keys_hash = '<sha256 of the empty canonical list>')));
```

- The **governing record is the newest of any kind and any rule-set**
  (`ORDER BY completion_id DESC LIMIT 1`). Earlier records are historical and ignored; the
  installer never falls back to an older one.
- `discovery:classify --apply` runs one `BEGIN IMMEDIATE` transaction: run, classifications,
  outcomes, reason tallies, `UPDATE … WHERE trust IS NULL`, and **last** the completion
  record. A `BEFORE INSERT` trigger on `discovery_completions` rejects a classification
  completion unless the run's classifications equal the declared count, outcomes equal
  `5 ×` that, every classification has all five checks, and `accepted + imported` equals the
  count. Measured: a simulated apply missing one outcome rolled back completely.
- With zero `NULL` rows, `classify` writes nothing (it says to use `attest-zero`).
  `discovery:attest-zero --apply` re-counts `NULL` inside its transaction, requires 0, and
  verifies the snapshot hash and size and the owner-typed authorization.
- An invalid governing record makes the installer refuse (`GOVERNING_INVALID`). Recovery is a
  fresh run or attestation under a new authorization.

### 8.4 Enforcement installation and boot verification (T30, T31, T33, T36)

`discovery:enforce --apply --census-sha <prefix>` runs in one `BEGIN IMMEDIATE` transaction.
All must hold:
1. a governing record exists;
2. its `rule_set` equals the build's;
3. its `census_report_sha256` equals the owner-typed hash;
4. no row has `trust IS NULL`;
5. no non-`NULL` row lacks `trust_at` or `trust_basis`;
6. no `replay-*` row lacks a classification record;
7. the governing record's accounting qualifies (classification), or it is a valid zero-null;
8. existing guards match the build's manifest (or are absent), and every append-only audit
   trigger is present and unaltered.

It then creates the guard set, computes the manifest hash from `sqlite_master` **inside the
same transaction**, inserts an append-only `discovery_enforcements` row (action `install`,
governing completion id, rule-set, census hash, manifest sha256, authorization reference,
time), re-checks the manifest, and commits. If any step fails the whole transaction rolls
back: there is never a committed record without its guards, nor guards from this command
without a record (measured: trigger-install failure, record-insert failure and a failed
invariant each left zero triggers and zero records).

`discovery:triggers --off` drops the guard set and inserts a `withdraw` record in one
transaction. `--off-claims` (G4) is a separate command needing a logged owner decision.

**Boot verification** — enforcement is *current* only if all hold: the latest enforcement
record exists and its action is `install`; it references an existing completion whose id
equals the newest completion id; that completion's rule-set equals the build's; the live
trigger text hashes to the record's manifest hash; the live `NULL` count is 0. Otherwise the
effective mode is `shadow` with a reason (`guards-missing-or-altered`,
`guards-without-record`, `enforcement-stale`, `null-rows`, …) in `/api/health`.
**Nothing is repaired or reinstalled automatically.** A matching trigger hash alone does not
establish currency. A boot self-test refuses enforcement if triggers cannot call the
functions: it performs a guarded write inside a rolled-back savepoint, and it also exercises
the real account-deletion routine on a scratch space inside a rolled-back savepoint, asserting
that the scratch space's `story_finds` rows are removed and that the deletion window is closed
afterwards. **Mandatory P6 design requirement:** the self-test must exercise the same internal
deletion operation that the authenticated public `deleteSpace` path uses. Authentication and
passcode verification remain at the public boundary and are not bypassed or weakened. The
self-test uses an isolated scratch identity and space, through its own explicit test-only
invocation path, and must not expose an unauthenticated production deletion entry point. The P6
design must also establish how the internal routine participates in the rolled-back savepoint
without nesting or committing an independent transaction; that implementation detail is not
decided here.

---

## 9. Modes and parity

`DISCOVERY_ENFORCE` is a brake, not an authority: the effective mode is the lower of the
request and what the database permits.

- **off**: `NULL` and accepted rows are eligible exactly as today. Imported rows are never
  eligible in any mode (they do not exist in the baseline, so parity holds).
- **shadow**: identical to off, plus log lines.
- **on**: imported and `NULL` rows open no gates; the glimmer rule and the Book's `latest`
  rule apply. Relic Fuel is governed by F1 in every mode (§7), not by the mode. Before P6 the
  effective mode cannot exceed `shadow`: the readiness check reads tables that first exist in
  P6 (§3).

**Eternity (T37):** Eternity holdings are wired from accepted discoveries through a separate,
default-off feature flag. `DISCOVERY_ENFORCE=on` does **not** enable Eternity access. The flag
requires separate owner approval and can be reversed independently.

**Intentional differences** (everything else must be identical):
- In all modes: F1 and G4 (§7).
- Under off and shadow: additive response fields only (`standing`, `importCompleted`, `mode`,
  `upgraded`, `held`), the health field, new tables and columns.
- Under on: imported and `NULL` rows excluded from gates; the glimmer rule; the Book's
  `latest` rule. (Eternity wiring is behind its own flag, T37.)

**Parity evidence is required, not assumed.** See §15 (golden master) for Phase 1. Codex has
no old reader, so its parity is a client test of `buildCodex`, the glimmer rule and the claim
hook under `mode:"off"`.

---

## 10. Book and Codex first-release decisions

These behaviours are active when the effective mode is `on` (§9), which is available only after
P6 enforcement is installed and verified. Under `off` and `shadow` the legacy behaviour is
unchanged.

- Upgrades are fully silent.
- Imported entries remain visible in the Book and Codex.
- The glimmer reappears until a live revisit.
- The Book's `latest`/tremor calculation uses held discoveries only (currently
  `StoryBook.tsx:79` takes the newest `foundAt`, which an import's server-time `found_at`
  would hijack).
- Fuel becomes claimable only after `accepted`. Already-paid Fuel is never revoked.

Traced from source, not rendered; the rendered path is test T-E2E (§17).

---

## 11. Phases, rollback and deployment

Every phase needs its own owner approval.

| Phase | Content | Player-visible change |
|---|---|---|
| **P1** | Columns; `DiscoveryLedger`/`DiscoveryReader` with **all** `story_finds` reads and writes relocated (S1); `find` writes `accepted`/`live:v1`; capability functions registered and environment logged (S3); architecture, golden-master and terminology tests. No `discovery_*` tables (S2). | None |
| **P2** | F1, G4, `RELIC_NOT_HELD`, client tolerance. Release review requires the C9/C10 package and the owner's O4 choice. | Relic claims need an accepted find, in all modes |
| **P3** | Import (flag-gated; 404 unless G4 and F1 are present); the imported → accepted upgrade branch; `discovery_imports`. | Imported rows appear in the Book |
| **P4** | Eligibility, `shadow` mode and logging (the relocation itself moved to P1); Eternity wiring inert. | None |
| **P5** | Presentation code: server-driven Codex state, `standing`, the `latest` fix and the glimmer rule — these ship inert and are active only when the effective mode is `on`, which becomes available only after P6 enforcement is installed and verified (§9); plus find-then-claim ordering, which is mode-independent because F1 applies in every mode. | Claim ordering restored in all modes; everything else only under `on` (i.e. after P6) |
| **P6** | Census → classification → `discovery:enforce`, each separately approved; completion/enforcement tables; the `deleteSpace` deletion window (§6.1); the owner-visible enforcement signal (a design requirement, §16). | Doors and legacy discoveries change |
| **P7** | Relic enablement: close the generic-relic loophole; Scale, then Archive (each approved). | New relics appear |
| (Eternity) | Separate, later, reversible release behind the T37 flag, after enforcement and Scale enablement. | Eternity reachable |

**Rollback ladder.** `DISCOVERY_IMPORT=off` first. Then roll back code if needed. G4 stays;
dropping it re-opens the hole and needs a separate logged owner decision
(`discovery:triggers --off-claims`). `discovery:triggers --off` drops the guard set only and
is mandatory before any rollback past the enforcement release (a previous release has no
capability functions, so it cannot write `story_finds` once the guards exist). Schema columns
are never rolled back. G4 re-installs on every boot of P2+ code, so a manual drop is not
durable while that code runs.

**Deployment.** Merging to `main` auto-deploys to Fly and runs migrations at boot on the real
volume. Implementation approval and merge approval are separate gates; the owner takes a fresh
backup (existing backup service) before any phase that migrates.

**Restore (D16).** A restored older database has no guards and no enforcement record, so the
effective mode is `shadow` until the owner re-runs `discovery:enforce`. The project
owner/operator monitors the owner-visible status and investigates `guards: missing`,
`guards-missing-or-altered` and `guards-without-record`; re-enforcement happens only after
verifying the governing completion and the required approvals.

---

## 12. Census package (read-only; separately authorized)

Run on a snapshot from the existing backup service (it records `snapshot_sha256`,
`snapshot_bytes`, `createdAt`, `schemaVersion`, and an app-version field —
`backup/service.ts:74–122, 272–290`), never against the live file.

| ID | Purpose | Produced by |
|---|---|---|
| C0 | SQLite version and journal mode | the snapshot |
| C1 | Rows per `source`, spaces, first/last `found_at` | the snapshot |
| C2 | Rows per entry and source | the snapshot |
| C3 | Rows whose entry id is unknown or retired in canon | the dry-run script (needs canon) |
| C4 | R1 replay: rows whose (entry, source) has no trigger | the dry-run script (needs `STORY_TRIGGERS`) |
| C5 | Journeys per space, first/last `created_at` | the snapshot |
| C6 | Finds on the five undiscoverable relics | the snapshot |
| C7 | Paid relic keys in `codex_claims` | the snapshot |
| C8 | Confirm no duplicate `(space_id, entry_id)` | the snapshot |
| C9 | Relic finds with no claim row, by `trust` (P2 release gate) | the snapshot |
| C10 | Paid relic claims with no find row (the footprint of today's hole; nothing is revoked) | the snapshot |
| C11 | Legacy arrival exposure (evidence for O5): per gated world, tiers of spaces with a ledger-recorded arrival, and what the predicted classification would do to their gate holdings | a separately reviewed dry-run analysis over the snapshot (journeys, events and discovery records) |

**How arrival is counted (C11).** C11 reports **tiers, never a single number**, and every tier
is ledger-asserted, not physical presence: `arrive()` has no minimum flight and journey rows
mutate (§14), so a historical `arrived` state is not treated as proof of a meaningful arrival.
- Tier 1: spaces with at least one journey in state `arrived` to that world.
- Tier 2: of Tier 1, spaces whose arrival has a `departed` event and an `arrived_at` later than
  `departed_at` (positive journey evidence).
- Tier 3: of Tier 2, spaces with a later journey whose `origin` is that world **and** which
  actually departed (a `departed` event, or non-null `departed_at`). `origin` alone is not
  enough: an `arming` journey cancelled before departure keeps its `origin`
  (`travel.repo.ts:531–538`) but does not show that the player left. The later journey's actual
  departure must also occur after the Tier 2 arrival: its `departed` event time, or
  `departed_at`, must be later than that arrival's `arrived_at`. A journey with the correct
  origin and departure evidence from before that arrival does not qualify.
- Owner-exempt spaces are reported separately: they bypass the gates, so their arrivals do not
  show earned access. The exempt ids are supplied to the analysis at run time and are not stored
  in its output.
- Synthetic legs written by `recallHome` have the home world as destination
  (`travel.repo.ts:347`) and are never counted as an arrival in a gated world.
- For each tier and gate, C11 also reports how many of those spaces hold the gate's discovery
  set under the predicted classification (accepted / imported / absent), so the owner can see
  how many would lose the ability to depart to that world again under enforcement-on.
- The tier definitions are fixed and independently reviewed with the census authorization
  request.

**The exact SQL is not part of this baseline.** None has been executed, and none has been
independently checked. It is written and independently reviewed with the P2 release review
(C9/C10) and with the census authorization request, and it is not described as verified until
then.

**Required before classification can be authorized:**
1. Environment record (C0) and Fly machine count, volume attachment and deploy strategy
   (see §18 — currently unverified).
2. `NULL` count split by predicted outcome and the outcome-vector histogram.
3. The "weaker evidence" count.
4. Relic rows on undiscoverable relics (C6).
5. Paid-Fuel confirmation (C7).
6. A reproducible dry-run hash (run twice, and once on a copy of the snapshot).
7. Snapshot path, checksum, size, creation time, source commit.
8. The classifier commit (clean tree) and the owner's written authorization naming the
   rule-set and census hash.

**Required before enforcement can be authorized** (a separate gate from classification):
1. The owner's O5 ruling (§16), informed by C11 and cited by the enforcement authorization
   reference. If the ruling is to commission the permissive-arrival design, that design and its
   approval come first.
2. A governing completion record (§8.3) bound to the census hash the owner will type.

**P2 release review (C9/C10)** must show: affected spaces, unpaid `NULL` relic discoveries,
maximum Fuel exposure (count × 4), recovery timing, the undiscoverable-relic limitation, and
the downstream cost of deferring P2 (it delays P3–P6, because import requires F1 and G4).
Recovery is **not** by ordinary revisit: a live admission never touches a `NULL` row (T18), so
recovery is "after classification and enforcement, plus a revisit". Unpaid relics held only in
localStorage with no server row are invisible to the server and unmeasurable.

---

## 13. API contract

| Route | Change |
|---|---|
| `POST /api/story/find` | Request unchanged. Response adds `upgraded` (and `held`). `source='import'` still returns 400. |
| `POST /api/story/import` | New (P3), §5.2. |
| `GET /api/story/book` | Each find adds internal `standing: "held" \| "carried"`; adds `importCompleted`. `source` still returned. |
| `GET /api/health` | Gains a `discovery` object reporting `discovery.effective` (the effective mode) and, when enforcement is not current, `discovery.guards` (the boot-verification verdict) and `discovery.reason` (a reason code from §8.4). Exact value strings are fixed in the P6 design. **Phase 1 adds no health field.** |
| `POST /api/maintenance/codex-claim` | Relic keys require an accepted find; 409 `RELIC_NOT_HELD` otherwise (P2). |

Phase 1 changes **no** route and **no** response shape.

---

## 14. Journey-history audit (basis for §8.1)

- `travel_journeys` rows are mutated by `UPDATE` (`travel.repo.ts:380, 387, 518, 697`;
  `guardedUpdate` callers `:535, :553, :559, :591, :613`): `state`, `departed_at`,
  `arrived_at`, `ended_at`, `fuel_charged`, `bonus_*`. Never `created_at`, `origin` or
  `destination`. `recallHome` (`:347`) inserts a synthetic `arrived` leg at app-open time.
- Events have a single insert site (`addEvent`, `:297`), called from nine transition sites,
  matched by reading, not by test. No `UPDATE`/`DELETE` of events in application code.
- The only `DELETE` path is whole-account deletion (`spaces.ts:468`), which also deletes
  `story_finds` (`:192`) in the same loop.
- No database-level protection exists on either travel table; the only triggers in the
  codebase are `agent_logs_no_update` / `agent_logs_no_delete` (`client.ts:879–886`).
- `travel_journeys` was introduced 2026-10-22 (commit `14dffc1`); `story_finds` 2026-10-30
  (`d2bfd29`).
- There is no restore code in `backup/`; restore is an out-of-app file replacement, unseen.
- The ledger is client-asserted: `arrive()` has no minimum flight, `recallHome` writes
  synthetic legs, and the old instant return left the ledger over-reporting.

---

## 15. Phase 1 scope

**Objective.** Introduce the ledger and its trust columns with **no behaviour change**.

**Excluded:** triggers (G0–G4); F1; import; any `discovery_*` table; classification;
enforcement; any change to eligibility semantics; any new route or response field; any change
under `packages/shared`, the web app, or the routes; any feature flag beyond a read of
`DISCOVERY_ENFORCE` for the boot log line.

### Rulings
| ID | Ruling |
|---|---|
| S1 | Relocate **all** `story_finds` reads and writes into the Ledger/Reader in P1. |
| S2 | No `discovery_*` tables in P1. |
| S3 | Register the (inert) capability functions in `createDb` and log SQLite version, journal mode and `trusted_schema` at boot. Binding conditions: `effectiveMode` returns `off` throughout P1 for every possible environment value; the boot log is diagnostic only — it triggers no enforcement, repair, migration beyond the approved additive schema work, or other operational action. |

### Files expected to change
- **New** (`packages/server/src/discovery/`): `ledger.ts` (all writes, state-first `admit`),
  `reader.ts` (all reads), `capability.ts`, `mode.ts` (pure `effectiveMode`, wired only to the
  boot log).
- **Modified:** `db/schemaSql.ts` (~1379), `db/client.ts` (duplicate DDL ~1348; guarded
  `ALTER` in `migrateSchema`; `createDb` :2020), `story/story.ts`, `story/flavor.ts` (:37),
  `story/roads.ts` (:41), `repositories/travel.repo.ts` (:764, `holdsAnySet` — read
  relocation only; Red Zone).
- **Unchanged in P1:** `auth/spaces.ts` (the delete loop is the documented exception; it gains
  the deletion window in P6, §6.1), `backup/inventory.ts`, the web app, `packages/shared`, all
  routes.

### Behaviour in P1
- `find` branches on existing state: absent → insert `accepted`/`live:v1`; any existing row →
  no write, same response as today. The imported branch is not implemented (no imported rows
  can exist until P3); the upgrade path lands with import.
- Pacing queries, the `regard`/`listen` early-return semantics and every response shape are
  unchanged. All reads keep legacy semantics: any row is eligible.
- The five existing test files that insert legacy-shaped rows `(space_id, entry_id, source)`
  (`story.test.ts`, `storyRoads.test.ts`, `storyFlavor.test.ts`, `wardGate.test.ts`,
  `storyChoices.test.ts`) pass **unmodified**; they become `NULL`-trust rows. They need
  updating only when guards are installed (P6).

### P1-ARCH — two layers
**Literal allowlist** — the only files that may contain the table name, each with its reason:
`discovery/ledger.ts` (the only writer), `discovery/reader.ts` (the read boundary),
`auth/spaces.ts` (the table is listed in `SPACE_SCOPED_TABLES` and `deleteSpace` loops over it —
the documented exception), `backup/inventory.ts` (table-level classification only), and
`db/schemaSql.ts` and `db/client.ts` (the DDL and its additive, PRAGMA-guarded migration).

**Dynamic-SQL inventory** — nine files build SQL by string interpolation after an upper-case SQL
verb. Eight of them interpolate a variable **table name**. The ninth, `backup/service.ts`,
interpolates a **file path**: `VACUUM INTO '${snapshotPath}'` writes a whole-database copy, so its
match is a dynamic SQL site but is **not** evidence of a variable table name. Each file is named
in the test with a justification; none of them contains the literal `story_finds` except the two
that are already on the literal allowlist (`auth/spaces.ts`, `db/client.ts`):

| File | What is interpolated | Why it is acceptable |
|---|---|---|
| `auth/spaces.ts` | table name | `deleteSpace`: loops over `SPACE_SCOPED_TABLES` (the documented exception) and cleans entity/index tables |
| `backup/manifest.ts` | table name | table-level `COUNT(*)` over the backup inventory — aggregate only, no discovery content |
| `backup/service.ts` | snapshot **path** | `VACUUM INTO` — a whole-database copy; no table is chosen |
| `db/client.ts` | table name | schema migrations over fixed table lists |
| `db/vec.ts` | table name | vector index tables chosen from a fixed pair |
| `agent/userModel.ts` | table name | evidence tables from the fixed `EVIDENCE_TABLES` map |
| `analysis/journeyLinking.ts` | table name | finance tables from fixed specs |
| `repositories/journeys.repo.ts` | table name | journey link specs naming fixed tables |
| `sources/forgetSource.ts` | table name | forget-flag tables from fixed specs |

**Three backup files, three different roles** (checked against the source and against the test's
allowlists):
- `backup/inventory.ts` is the only backup file that contains the literal `story_finds`: it is a
  static classification map (`story_finds: "may-be-empty"`), so it is on the **literal**
  allowlist. It runs no SQL.
- `backup/manifest.ts` contains no literal. `countIncludedTables` loops over `INCLUDED_TABLES`
  (derived from that inventory) and prepares `SELECT COUNT(*) AS n FROM "${table}"`; at runtime
  that statement names `story_finds`, issued from `manifest.ts`. It is therefore a **dynamic-SQL**
  site and one of the three **runtime named exceptions** (with `auth/spaces.ts` and
  `db/client.ts`).
- `backup/service.ts` has neither the literal nor a table-name interpolation; it appears only for
  the `VACUUM INTO` path interpolation above.

- **Layer 1 — static enumeration.** Scan non-test source (comments stripped) for the literal
  `story_finds` outside the literal allowlist, and for SQL built by interpolation after an
  upper-case SQL verb (`SELECT … FROM`, `DELETE FROM`, `INSERT INTO`, `ALTER TABLE`, `UPDATE`,
  `VACUUM INTO`) followed by `${…}` — normally a variable table name. `VACUUM INTO` is matched
  too, but what follows it is a file path, so that match is not evidence of a variable table name.
  English prose such as "from ${x}" is not SQL and is not matched. Both allowlists must be
  exact, so a stale entry fails as well as a missing one; a new dynamic site fails until it is
  reviewed and justified.
- **Layer 2 — runtime attribution.** A test-only wrapper on the connection records every
  statement; any statement mentioning `story_finds` must carry the discovery context marker set
  by the Ledger/Reader entry points, apart from the named exceptions. The test drives every
  story route, the travel gate reads, flavor, roads, `book()`, `deleteSpace`, a backup
  create-and-verify, and the migration. **Coverage-by-enumeration:** every access site layer 1
  finds must be exercised by at least one test, or the test fails with "unexercised access
  site". The real audit and its falsification test use the **same** classification function: a
  statement whose caller cannot be identified fails, unless it was issued inside an explicit,
  labelled harness window (which the real flows never use).
- **Stated limits.** An allowlist is not proof of exhaustive detection. The static scan sees only
  SQL written with an upper-case verb followed by a `${…}` interpolation; SQL assembled another way (for
  example by concatenation) is invisible to it and can be caught only by layer 2, and only on
  paths the tests exercise. Neither layer proves that a never-exercised dynamic path cannot
  reach the table; the allowlist-review rule is the control for new sites.
- The marker is a test aid, not a security boundary (§2).

### P1-PAR — pinned, independent golden master
- A script checks out the exact baseline commit into a separate worktree, runs the fixtures
  with the **old** code, and writes a JSON golden file recording the commit hash and a
  checksum. The P1 test recomputes the same outputs with the relocated code and compares.
- A test asserts the generator imports none of the new `discovery/` modules.
- Fixtures are deterministic (fixed clock, seeded): empty brain; every source (`regard`,
  `listen`, `relic`, `companion`, `npc:*`); each story-gate set satisfied and not (including
  the multi-way Long Morning and Folded Letter sets); the owner exemption; unknown and retired
  ids; `NULL` rows; roads at each progress state; flavor counts; `book()` finds and order;
  every departure verdict for every gated world.
- No change under `packages/shared`, so both sides read identical canon data.
- Re-running the generator in a fresh worktree of the same commit yields byte-identical
  output (manual reproducibility step).
- Deliberately altering one relocated query must make the comparison fail.

### P1-SQL
Relocated read statements must equal the baseline text after whitespace normalization. Only
the write statement changes (it adds the trust columns).

### `travel.repo.ts` review criteria (Red Zone)
The diff is limited to the `holdsAnySet` read (`:764`). No change to any gate method,
departure admission, owner exemption, `STORY_WORLD_GATES`, or any departure decision. The
relocated read is the same SQL through `DiscoveryReader`. The golden master covers every
departure verdict, holding present and absent, plus the owner exemption.

### Acceptance criteria — "Phase 1 complete"
- **A1** The gate is green: `npm run typecheck`, `npm test`, `npm run build -w @brain/web`.
- **A2** P1-PAR passes and fails when a relocated query is deliberately broken.
- **A3** The five legacy-shaped test files pass unmodified (P1-LEG).
- **A4** P1-ARCH shows the ledger is the only writer and reader of `story_finds`.
- **A5** Migration is idempotent on a fresh and a legacy database (P1-MIG); the two DDL copies
  are identical.
- **A6** A previous release's reads work on the migrated database; a `VACUUM INTO` copy keeps
  the columns (P1-ROLL).
- **A7** No route, response, web, shared-package or behaviour difference.
- **A8** The boot log line prints SQLite version, journal mode and `trusted_schema`.
- **A9** Both P1-ARCH layers pass, including coverage-by-enumeration and the named deletion
  exception.
- **A10** The golden-master comparison passes and fails under deliberate breakage; the
  generator is independent of the new code.
- **A11** P1-SQL passes.
- **A12** No change under `packages/shared`, the web app, or any route.
- **A13** `effectiveMode` returns `off` for every input; the boot log function performs no
  writes.
- **A14** The attribution marker grants no write permission and changes no query behaviour; no
  production code path reads it to decide whether to run, allow or reject a statement
  (static scan: it is read only by the test-only wrapper).
- **A15** The marker is independent of the capability functions: `discovery_cap()` returns its
  constant regardless of the marker (a test sets and clears the marker and asserts the result
  never changes).

### Internal tasks (each independently testable; rolling back one is reverting its commit)
P1.1 migration + P1-MIG · P1.2 capability registration, `effectiveMode`, boot log + P1-CAP ·
P1.3 Reader/Ledger skeletons and the golden master (no call sites changed) · P1.4 relocate
reads + P1-PAR · P1.5 relocate writes, `find` writes trust + P1-ADM, P1-LEG · P1.6
architecture and terminology tests · P1.7 documentation.

### Rollback
Redeploy the previous release. The new columns are inert and nothing else changed.

---

## 16. Decision register

### Fixed by the owner
| ID | Decision |
|---|---|
| D1 | `story_finds` is the single discovery ledger. |
| D2 | `DiscoveryLedger` is the sole writer (documented account-deletion exception); `DiscoveryReader` is the read boundary. |
| D3 | `accepted`, `imported` and `unclassified` mean what §1 says. |
| D4 | Imported discoveries stay visible in Book/Codex but open no gates and earn no Fuel. |
| D5 | A legitimate online revisit upgrades an imported row. |
| D6 | Offline admission is outside the initial implementation. |
| D7 | Fuel claims stay a separate idempotent ledger; already-paid Fuel is never revoked. |
| D8 | Classification requires a separate owner authorization. |
| D9 | Scale relics precede Archive relics. |
| D10 | Provenance stays internal, not player-facing. |
| D11 | No new minimum-flight-time rule in this project. |
| D12 | Upgrades are fully silent. |
| D13 | The glimmer reappears until a live revisit. |
| D14 | The Book's `latest`/tremor uses held discoveries only. |
| D15 | Fuel becomes claimable only after `accepted`. |
| **D16** (O1) | After a restore, remain in `shadow`. Monitoring is assigned to the project owner/operator (§11). The owner-visible enforcement signal (Settings → Owner access) is a **P6 design requirement**, not current work, and must never repair or reinstall guards automatically. |
| **D17** (O2) | Eternity access ships as a separate, later, reversible release (T37). Sequence: enforcement; separately approved Scale relic enablement; holdings and gate verification; separately approved Eternity release. |
| **D18** (O3) | Event-based import sunset; the condition is set after P3 telemetry; the contract release disables the endpoint. |

D4 is recorded in the owner's words. Its mode- and Fuel-precise form is T4 (imported never
gate-eligible in any mode), F1 (T10–T12: relic Fuel requires an accepted discovery) and §9
(unclassified rows keep gate eligibility under `off` and `shadow`).

D16–D18 were adopted by the owner in the design conversation of 2026-10-31.

### Settled technically
| ID | Decision |
|---|---|
| T1 | Import: relic ids only, one-shot per space, at most 15 rows, server-set source/time/trust. |
| T2 | Every check outcome recorded per row, in an append-only table. |
| T3 | `fail` and `indeterminate` both give `imported`, with distinct basis strings. |
| T4 | Imported never eligible in any mode; new logic inert under `off`. |
| T6 | Install under `BEGIN IMMEDIATE` with live invariants. |
| T7 | Apply requires `NULL`-key-set equality with the reviewed report. |
| T8 | The census reuses the existing backup service's snapshot and manifest. |
| T9 | R2 is named "ledger-world"; the 2 s boundary tolerance applies to observations only. |
| T10 | F1 ships at P2 in all modes. |
| T11 | Strict `accepted` for Fuel; `NULL` rows cannot claim until classified. |
| T12 | The already-paid short-circuit runs before the gate; G4 is the backstop. |
| T13 | Import is disabled unless G4 and the F1 code are present. |
| T14 | Accounting is over distinct `(space_id, entry_id)` discoveries. |
| T16 | `source` and `found_at` are immutable; an upgraded row keeps `source='import'`. |
| T17 | G4 installs at boot (P2); the guard set installs by the owner-authorized `discovery:enforce`. |
| T18 | A live admit never touches a `NULL` row before classification (option A); option B documented only. |
| T19 | State-first branching; the insert guard ignores any existing key; no travel-table triggers in this project. |
| T20 | Legacy world-bound R2 is always `indeterminate`; an informational observation is recorded. |
| T21 | Daily pacing counts an `upgrade:` row by `trust_at`. |
| T22 | Two rollback switches (`--off` for the guard set, `--off-claims` for G4). |
| T23 | C9/C10 are a P2 release gate. |
| T24 | Capability required for every `story_finds` insert, update and delete; one trigger per event. |
| T25 | Deletes forbidden except the whole-account window. |
| T26 | The writer boundary is stated honestly (§2). |
| T27 | Guard integrity is hashed; mismatch degrades to `shadow`. |
| T28 | One `discovery_completions` stream. |
| T29 | The newest completion overall governs. |
| T30 | Enforcement is bound to an owner-typed census hash and the build's rule-set. |
| T31 | Append-only `discovery_enforcements`. |
| T32 | Completion is the last statement of one transaction and is guarded at insert; an invalid governing record refuses. |
| T33 | Enforcement is current only if the record, newest completion, rule-set, live trigger hash and zero `NULL` rows agree; guards without a record or a record without guards mean `shadow`; no automatic repair. |
| T34 | Column change is defined by `OLD` versus `NEW`. |
| T35 | Legacy `NULL` boundary (§4). |
| T36 | Enforcement and withdrawal are each one transaction covering the DDL and the audit record; `discovery_enforcements` has an `action` column. |
| T37 | Eternity holdings are wired through a separate default-off flag (§9). |

Superseded: T5 (by T28–T33), T15 (by T20).

### Pending — unresolved (no ruling; evidence required)
| ID | Question | Evidence needed |
|---|---|---|
| **O4** | Unpaid legacy `NULL` discoveries: wait for classification (option A), take option B, or defer P2. | C9/C10 at the P2 release review (§12). No numeric threshold has been chosen. |
| **O5** | Legacy gates close at enforcement. Accept (revisits restore access), commission the separate permissive-arrival design (a gated world stays open for a brain that has already arrived there), or delay enforcement until it exists. | The arrival census: how many spaces have arrived in each gated world, and which relics they hold. **O5 must be settled before enforcement *authorization*, not merely before execution.** If permissive arrival is needed, its design and approval precede the enforcement authorization; the enforcement authorization reference must cite the O5 ruling. Classification authorization stays separate (classification does not itself close gates under `off`/`shadow`). |

Gates check holdings at **departure** (`travel.repo.ts:433–460`): a player keeps access while
inside a world but cannot depart to it again until the discovery is revisited. The People world
gate depends on memories and is unaffected.

### Deferred — not adopted
| ID | Question |
|---|---|
| **T38** | Account deletion versus classification accounting. `deleteSpace` removes all of a space's rows, and audit rows traditionally die with the space (the `agent_logs` precedent, `spaces.ts:446–467`); if classification rows are deleted, a run's `discoveries_classified` no longer equals its live classifications and enforcement invariant 7 would fail. Options: **(a)** rows die with the space and an insert-only tally (no space id) records how many each run lost, so `classified = live + deleted`; (b) retain rows with a hashed space id; (c) freeze accounting at apply time and verify only stored totals. Option (a) is the preferred direction; it is **not adopted**. A detailed design review is required before P6 and must specify the tally's write boundary, atomicity with `deleteSpace`, append-only protection, how the ORD tests independently verify `classified = live + deleted`, and how the tally holds no account-identifying data. It must not expand Phase 1. |

---

## 17. Test matrix

| Group | Covers |
|---|---|
| MIG | Column add on an existing database; idempotent; `VACUUM INTO` round-trip preserves columns and triggers |
| P1-PAR / P1-SQL / P1-ARCH / P1-LEG / P1-ROLL / P1-CAP | §15 |
| TRANS / G-series | Every transition row; the 28-case matrix; `REPLACE`/`IGNORE`/plain `INSERT` onto each trust state; delete-then-insert; capability on every insert/update/delete including recall columns singly and together; denied-connection ordering; one trigger per event; deletion window per space, exercised through the real account-deletion path, and closed on success and on failure (G-36/G-37); guard-hash and self-test refusal; unauthorized recall updates |
| D-series | Duplicate-key behaviour in all four states; duplicate import; duplicate classification |
| NULL-1…4 | A new key with `NULL` trust aborts after enforcement; admit/import never write `NULL` pre-enforcement (property test); the installer refuses while a `NULL` row exists; `UPDATE … WHERE trust IS NULL` is the only code path changing a `NULL` row |
| F-series | F1 route order; G4; paid keys unchanged (fixture balance proof and claim-set superset); outdated-client response; client tolerance; first-account claim and `deleteSpace` with G4 present |
| IMP | Import validation, limits, one-shot, transaction rollback, 404 without G4/F1; parser order (a 3 KB body to the import route returns 413 from the path-scoped parser, and an ordinary route still enforces the global limit) |
| RB | Rollback ladder; boot over a restored older database; G4 re-install; import off |
| ACC / R2 / Z / ORD / ENF | Accounting over distinct discoveries; R2 outcomes (legacy always `indeterminate`); zero-null; governing-record scenarios; atomicity; enforce refuses without the census hash; enforcement transaction all-or-nothing; withdraw atomic; boot currency checks |
| PAR | Behaviour parity under `off` on identical fixtures and on a copy of the census snapshot |
| BOOK / CODEX / E2E | `latest`, glimmer, claim eligibility, imported → upgraded rendered path |
| ETN-1…3 | Flag off keeps the empty Eternity default under `on`; flag on derives holdings from `accepted` finds only; turning the flag off reverts it |
| TS-1 | Every `trust_at` and `found_at` written by the Ledger, the import path and the classification CLI comes from `Date#toISOString` and round-trips; none is taken from a client |
| TERM | No `verified` next to a trust identifier in code, API, logs or UI strings |
| RELIC | The generic-relic loophole is closed (P7 only) |

---

## 18. Unverified claims and blockers

1. Fly machine count, volume attachment, deploy strategy, and "no independent database" —
   not verified (no Fly access). `fly.toml` shows one `[[mounts]]` and
   `min_machines_running = 1`, which is configuration, not state.
2. Production SQLite version, journal mode, and whether its build lets application functions
   run inside triggers (`trusted_schema`). Only local SQLite 3.53.2 was measured. Phase 1
   logs these three values at boot.
3. Whether the backup manifest's commit field is populated in production.
4. The restore procedure (no restore code in the repo) and any manual SQL on the volume.
5. Whether every journey state change has a matching event (call sites matched by reading, no
   test yet).
6. The rendered imported → upgraded Book/Codex path (T-E2E) and old-cached-tab behaviour of
   the claim response.
7. Every trigger and conflict-clause behaviour in this document was measured on local SQLite
   3.53.2 only.
8. Census numbers (classified population, C9/C10, arrival counts) are unknown until the
   approved census.
9. The capability boundary does not stop DDL or code inside the application process (§2).
