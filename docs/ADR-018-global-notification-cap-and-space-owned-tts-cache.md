# ADR-018 — Global notification cap and per-space TTS cache ownership

**Status:** APPROVED DESIGN — **Phase A CLOSED by the owner's design-gate decision (2026-10-21); ADR-018 is approved as the implementation contract.** The closure amendment (see "Phase A — closure amendment" below) resolved blocker B1 and closure questions Q1–Q5 in the normative text, and its independent verification — including the single-item confirmation that closed D-1 — has completed. Implementation (Phases B–D) is **complete and independently accepted (28/28 criteria)** and **merged** (PR #91, 2026-10-22; deploy-branch HEAD `e297208ea3fec6fb968dad5d0e2756e1a12cdd3f` — see the implementation/merge record in the closure amendment below). Deployment and feature arming (TTS/VAPID) remain **separate and unauthorized** and on hold.  
**Approved by:** Project owner  
**Date:** 2026-10-21  
**Design baseline:** deploy branch HEAD `15be567a84ca985e93d03772c4f4b2385f91ea76`  
**Scope:** shared proactive-notification cap across Telegram + web push; space-owned synthesized Telegram audio cache; related retry/deletion correctness.  
**Non-goals:** enabling TTS or web push, deploying, changing the user's space ID on passcode change, rewriting unrelated audit findings, or changing product UI.

## 1. Approved decisions

### D1 — One global daily proactive-notification cap

The per-space `dailyProactiveCap` preference is a **single allowance across all delivery channels**, not one allowance per channel. If the cap is five, five proactive deliveries total may be accepted for that space during its local calendar day—not five Telegram plus five push.

- Accounting day is computed using the space's validated IANA timezone through the shared notification-policy helpers. UTC date slices are not acceptable for cap accounting.
- Each actual channel delivery consumes one slot. The same logical event delivered once to Telegram and once to push counts as two deliveries.
- Claiming a slot is atomic across both channels. Concurrent Telegram and push workers cannot both consume the final slot.
- A slot is reserved immediately before sending, counted while sending, retained after confirmed delivery, and retained after an ambiguous send outcome to avoid duplicate delivery.
- A definite pre-delivery/send failure releases its reservation before retry; a deferred item consumes no slot until it is eligible to send.
- **Urgency policy (owner-approved Option A, 2026-10-21):** preserve the existing exception. A notification may bypass both quiet hours and the global cap only while it freshly qualifies under the existing urgency classifier. Every retry reclassifies from immutable original due-time metadata. Once freshness expires, urgency no longer bypasses either policy. The global cap applies to all non-exempt deliveries.
- Cap exhaustion defers eligible notifications; it does not silently drop them. Existing occurrence deduplication and ambiguous-outcome terminal semantics remain in force.

### D2 — TTS audio cache is owned by one space

Every cached synthesized reply belongs to the space whose private conversational context produced it.

- Cache lookup and insertion are always scoped by `space_id`; equal text/hash across two spaces does not share audio.
- Brain deletion removes that space's cached audio in the same deletion transaction/census as other space-owned data.
- The cache remains bounded to 500 rows globally to preserve the existing hard storage bound. Eviction can cause later re-synthesis; the honest guarantee remains **“free while cached,” not “synthesize exactly once ever.”**
- Existing cache rows have no trustworthy owner. The migration must delete those legacy unowned rows rather than guess ownership or expose them across spaces.
- Cache keys continue to include provider, voice, model, prosody, and normalized text. Ownership is an additional isolation boundary, not a replacement for key correctness.
- Passcode changes do not rotate the space ID; this decision does not alter that approved identity model.

## 2. Architecture changes required

### 2.1 Shared atomic delivery ledger

Add a shared cap-claim ledger, tentatively `notification_cap_claims`, used by both the Telegram and push outboxes. The exact DDL and indexes must be finalized during implementation design review, but the ledger must at minimum record:

- `space_id`, space-local `local_day`, `channel` (`telegram` or `push`), and the outbox/occurrence identity;
- claim state sufficient to distinguish a reserved/in-flight delivery, confirmed delivery, and ambiguous outcome;
- timestamps needed for recovery and audit;
- uniqueness that prevents the same outbox delivery from claiming the same local-day slot twice.

The cap predicate counts all retained claims for the same `space_id + local_day`. Slot claim and the corresponding outbox transition must be one SQLite transaction. The two existing outboxes remain channel-specific payload/lifecycle stores; they no longer independently define the daily cap.

A definite failed delivery releases its claim atomically with requeue/terminal-failure handling. An ambiguous outcome keeps its claim and is terminal. Recovery must not double-count one delivery or free a slot whose send may have reached the user.

### 2.2 TTS cache schema and service boundary

- Add `space_id TEXT NOT NULL` to `tts_audio_cache`.
- Scope uniqueness to `(space_id, cache_key)`; use an index supporting space-scoped lookup and deletion.
- Pass the authenticated/current space ID into the `DbSpeechCache` instance; no cache operation may infer ownership from text/hash alone.
- Keep the 500-row global bound, pruning by newest `created_at` and stable insertion tie-breaker.
- Update total-space deletion census/guard so the table is recognized as space-owned and is deleted transactionally.
- Migrate legacy cache by rebuilding the table if necessary and dropping all old rows, because their ownership cannot be recovered safely.

### 2.3 Schema/migration discipline

For every new or changed table definition:
- Fresh bootstrap and existing-volume migration must converge to equivalent DDL, columns, uniqueness, checks, and indexes.
- Bootstrap SQL must not refer to migration-only columns.
- Migration is idempotent, transactional where SQLite permits, and fails loudly if the final schema does not match the expected shape.
- Add schema-parity tests that compare the resulting fresh-bootstrap schema with a migrated legacy fixture.

### 2.4 Notification lifecycle and retry correctness

Alongside the global ledger, correct the audited retry defects:
- Persist the original reminder due time in an explicit column on each channel's outbox record — `remind_at` on `notification_outbox` (B1, closure amendment) and `remind_at`/`bill_due_at` on `push_outbox` (A2b) — populated from `NotifyMeta` at enqueue and immutable thereafter. Deriving due time by parsing `occurrence_id` is **not** a source: it is foreclosed as a durable contract (A2b), because `remind_at` is now the persisted source on both channels.
- On every drain/retry, recalculate freshness against the persisted original due time. A persisted `is_urgent` bit is not authority to bypass policy forever.
- Re-evaluate quiet hours, local-day cap availability, and stale/drop policy at delivery time.
- If an urgent reminder becomes stale, it loses both the quiet-hours and cap exceptions. Fresh, qualifying urgent deliveries are explicitly cap-exempt; all other deliveries use the shared global ledger.
- **Legacy rows fail closed:** a queued row whose original due time cannot be recovered (no persisted due-time value) receives **no urgency exemption**. Do not invent a timestamp and do not trust a persisted urgency flag; treat the delivery as ordinary — global cap and quiet hours enforced. Rows whose original due time is available and verifiable keep the existing reclassification behavior. **Legacy reminder staleness:** A pre-migration Telegram reminder with `remind_at IS NULL` must be dropped as unverifiable and must not be sent. Do not substitute `created_at`, parse `occurrence_id`, or trust the persisted urgency flag to establish freshness. The no-urgency-exemption rule remains in force for legacy deliveries generally; this reminder-specific rule additionally resolves staleness.
- Preserve the current rule that uncertain send outcome is terminal/ambiguous to avoid duplicates.

## 3. Required files and boundaries (implementation targets)

Touch points (Telegram/push integration sites confirmed against the source in the Phase A closure amendment):

- `packages/server/src/agent/notify/policy.ts` — shared local-day and urgency policy semantics.
- `packages/server/src/agent/notify/` (new sibling module, e.g. `capClaims.ts`) — the shared cap-claim service (placement per closure amendment A1/§7: imports only the `RawDb` type and policy helpers; called from within each channel's claim path; never imports either channel's outbox).
- `packages/server/src/agent/notify/boundary.ts` — **the Telegram claim-integration site**: both Telegram claim call sites live here (`deliverNow` claim choice, `sweepNotifications` claim choice), together with the sweep's staleness and urgency reclassification. This is where the claim transaction and the B1 downgrade integrate for Telegram.
- `packages/server/src/agent/notify/outbox.ts` — Telegram outbox lifecycle and claim primitives (`claimForSend` / `claimUrgentForSend`, lease recovery); the enqueue INSERT gains `remind_at` (B1).
- `packages/server/src/push/outbox.ts` — global claim integration and retry-time due-date revalidation.
- `packages/server/src/push/service.ts` and `packages/server/src/index.ts` — ensure push drain uses the shared ledger without depending on Telegram credentials.
- `packages/server/src/telegram/tts.ts`, `packages/server/src/telegram/ttsCache.ts`, and the bot's cache construction — pass space ownership into cache operations.
- `packages/server/src/db/schemaSql.ts` and `packages/server/src/db/client.ts` — identical fresh/migrated schema and migration guards.
- `packages/server/src/auth/spaces.ts` — space-deletion census and transaction.
- Existing tests beside those modules plus focused integration tests.
- `docs/architecture.md`, `PROJECT_STATE.md`, `TASKS.md` — keep architecture/status/tasks current.

Do not rename or reorganize unrelated modules just for this increment. Confirm exact file paths and writer call sites before editing.

## 4. Acceptance criteria

### Global notification cap

1. With cap = 1 and both channels eligible, concurrent Telegram and push workers produce at most one **non-exempt** send accepted for a given space-local day; independently qualifying urgent deliveries are explicitly exempt under Option A.
2. Repeated concurrent claims for the same outbox occurrence cannot reserve multiple slots.
3. With cap = 5, any mix of Telegram and push has no more than five accepted/reserved/ambiguous **non-exempt** deliveries for that space-local day. The cap is not five per channel; fresh qualifying urgent exempt deliveries are tracked but excluded from the count.
4. Two local calendar days that share a UTC date boundary are accounted as distinct days in the configured space timezone; day changes are not based on `toISOString().slice(0, 10)`.
5. Deferred items consume no cap slot until claimed for delivery; cap exhaustion defers rather than drops.
6. Definite send failure releases the slot exactly once; retry can reclaim once when policy allows.
7. Successful delivery retains its slot for that local day.
8. Ambiguous send outcome retains the slot and is never automatically retried.
9. A fresh qualifying urgent reminder may bypass both quiet-hours deferral and the global cap, preserving the signed-off Phase-2 policy.
10. After the freshness window expires, retry reclassification removes the urgent exception; normal quiet-hours and global-cap rules apply, and stale reminders are dropped using original due time. A pre-migration legacy reminder with `remind_at IS NULL` has no original due time and is dropped as unverifiable instead (A2b, legacy reminder staleness) — it is never aged from `created_at`.
11. A fresh bill-risk notification may use its existing urgency exception only while the bill remains within the classifier's original due-in window and existing per-bill dedup rules permit it; a retry after the due time is not urgent.
12. Every retry decision is based on immutable original event timing, not `created_at`, `deliver_after`, or a persisted `is_urgent` bit.
13. Telegram and push claim operations share one transaction-safe cap predicate; the demonstrating test is defined as **two interleaved drain loops in one process on one SQLite handle, with coordination barriers at the send await**, asserting the ledger count after both complete shows at most one claim of the final slot. A sequential simulation is insufficient evidence for this criterion.
14. Push-only spaces still drain without a Telegram token. Missing VAPID configuration creates no push rows and sends nothing.

### Per-space TTS cache and deletion

15. Fresh bootstrap creates the owned cache schema with `space_id NOT NULL`, unique `(space_id, cache_key)`, and expected indexes.
16. An existing database with the old unowned cache migrates idempotently; legacy cache rows are purged, never assigned to an arbitrary space.
17. Identical cache keys in two spaces do not hit each other's audio; each space synthesizes/caches independently.
18. Cache get/put/size behavior is tested with multiple spaces; every query is ownership-scoped.
19. The 500-row global limit still holds under interleaved inserts from multiple spaces.
20. Deleting one space removes its cache rows in the same transaction while retaining other spaces' rows.
21. If deletion fails at any point, the entire deletion transaction rolls back, including cache cleanup.
22. Deletion census/schema guard explicitly includes `tts_audio_cache` despite its prior lack of `space_id`.
23. Cache eviction, concurrent misses, and cache-write failure tests reflect the honest “free while cached” guarantee; no test or documentation claims lifetime exactly-once synthesis.
24. Existing TTS-off behavior and provider gate remain unchanged; this increment does not enable voice or configure provider secrets.

### Schema, regression, and documentation

25. `BOOTSTRAP_SQL` and migration result converge on the same table/index contract; bootstrap never uses migration-only columns. Parity fixtures follow the repository's **table-level legacy-fixture pattern** — construct the legacy table shape in a scratch database, run the migration, assert the final contract — because a full migrated-database fixture is documented as unavailable in this environment.
26. Run migration twice and verify no data/schema drift on the second run.
27. Run server tests, web tests, typecheck, and build; perform stash-and-fail checks for the global cap concurrency assertion, cache ownership isolation, and deletion rollback/census.
28. Update architecture and project state with actual outcomes only; report separately whether tests were executed, merged, or deployed.

## 5. Scoped task plan (all tasks independently testable, target <4 hours)

### Phase A — finalize design contract (Architect; no production code)
- [x] **A1. Inspect current Telegram cap-claim transaction and push retry schema**; map exact call sites and transaction boundaries. Acceptance: source-grounded call-site and transaction-boundary map recorded in Phase A closure; no implementation.
- [x] **A2. Finalize global ledger DDL and status transitions** including idempotency key, local-day semantics, release rules, ambiguous outcome, and urgent behavior. Acceptance: normative DDL and lifecycle invariants recorded in Phase A closure.
- [x] **A3. Finalize cache migration policy** including dropping unowned rows, index/uniqueness, global 500-row pruning, and delete rollback behavior. Acceptance: migration and rollback contract recorded in Phase A closure.
- [x] **A4. Review updated architecture and tests**. Acceptance: schema and user-visible policy decisions are closed; implementation-specific migration harness/test-fixture verification remains a mandatory pre-code check.

### Phase A — design closure (completed design-only, 2026-10-21)

**Evidence baseline:** owner-supplied read-only verification trace against deploy HEAD `15be567a84ca985e93d03772c4f4b2385f91ea76`, plus source inspection of the Telegram and push outboxes, schema bootstrap/migration, TTS cache, and space-deletion transaction. This closes the design contract only; it does not claim tests were run.

#### A1 — Existing send/transaction boundaries

- Telegram: `packages/server/src/agent/notify/outbox.ts`; `claimForSend` and `claimUrgentForSend` perform conditional status updates, while `markSent`, `markFailed`, `markDropped`, `markAmbiguous`, and `recoverExpiredLeases` separately transition the row. The current cap is counted from `notification_outbox` rows in `sending|sent|ambiguous` with `cap_day`; urgent rows bypass it with `cap_day = NULL`.
- Push: `packages/server/src/push/outbox.ts`; `claimPushForSend` counts only `push_outbox`, while `claimUrgentPushForSend` has no cap interaction. Failure/recovery clears `cap_day`; ambiguity retains a terminal row. `push_outbox` currently has no original due-time columns and the sweep uses `created_at` for staleness.
- Both implementations use the same SQLite handle, but the asynchronous network send occurs after the synchronous claim. Therefore the cap reservation and outbox status transition must be atomic before the network call; a network call cannot be enclosed in the SQLite transaction.
- TTS: `packages/server/src/telegram/ttsCache.ts`; `DbSpeechCache` currently has no space ID and global-keyed get/put/size. The DDL is duplicated in `db/schemaSql.ts` and `db/client.ts`. `auth/spaces.ts` performs the deletion census inside one SQLite transaction, but the cache is absent from its space-scoped list.
- Telegram claim integration site (confirmed in the closure amendment; corrects the earlier §3 map): both Telegram claim call sites live in `packages/server/src/agent/notify/boundary.ts` — the `deliverNow` claim choice and the `sweepNotifications` claim choice — and the sweep's staleness check and one-way `billRisk` upgrade live there as well. The claim transaction and the B1 reclassification integrate at that boundary; `agent/notify/outbox.ts` supplies the claim primitives and lifecycle transitions it calls.
- Claim-service placement (G1, resolved in the closure amendment): a sibling module in `agent/notify/` importing only the `RawDb` type and, if needed, policy helpers, exposing ledger claim/release/transition primitives over primitives (`spaceId`, `channel`, `deliveryKey`, `localDay`, `capExempt`), called from within each channel's claim path. `policy.ts` is a leaf imported by both channels' neighborhoods, and `push/outbox.ts` already imports from the notify layer in the same direction, so this placement creates no import cycle and no layering violation. The two placements that would violate are inside `push/` (it would invert the dependency direction for Telegram) and inside one channel's outbox (it would couple the channels to each other).

#### A2 — Final ledger schema and invariants

Use one shared `notification_cap_claims` table as the sole cap-counting authority. Proposed final DDL contract (types/checks/index names are normative; exact SQL formatting may follow repository conventions):

```sql
CREATE TABLE notification_cap_claims (
  space_id TEXT NOT NULL,
  local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'push')),
  delivery_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'sent', 'ambiguous', 'released')),
  cap_exempt INTEGER NOT NULL DEFAULT 0 CHECK (cap_exempt IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (space_id, channel, delivery_key, local_day)
);
CREATE INDEX notification_cap_claims_count_idx
  ON notification_cap_claims(space_id, local_day, state, cap_exempt);
```

- `delivery_key` is the stable channel outbox identity (`notif_key` for Telegram, `push_key` for push); channel is part of the key because each channel delivery counts separately.
- Count only rows matching the same `space_id + local_day`, in `reserved|sent|ambiguous`, with `cap_exempt = 0`. A qualifying fresh urgent delivery still receives a ledger row with `cap_exempt = 1` for idempotency/audit but does not consume a cap slot. It must still pass the unique conditional outbox claim, so only one worker can send that row.
- Claim transaction: capture one `now`; resolve and validate the space IANA zone; compute `local_day`; reclassify urgency from immutable event times; apply staleness and quiet-hours policy; then, in one SQLite transaction, conditionally claim the outbox row and insert/reactivate its ledger claim. For non-exempt rows, count shared active non-exempt claims and reserve only if count is below the cap. A failed transaction means no claim and no send. Send starts only after commit.
- A claim for the same `channel + delivery_key + local_day` is idempotent. A previously `released` row can be reactivated atomically if a definite failure is retried on the same local day; if retry crosses a local-day boundary, it creates a claim for the new day. A worker cannot reclaim a `sent` or `ambiguous` delivery.
- Confirmed success transitions `reserved → sent`. Definite failure before any possible delivery transitions `reserved → released` atomically with outbox retry/terminal failure. Definite no-recipient/drop releases the reservation. If the process crashes before send starts, recovery releases the claim and requeues; if send may have started, recovery transitions to `ambiguous` and retains the claim. Ambiguous is terminal and counts toward cap only when non-exempt.
- Never delete current-day claims as a cleanup shortcut. Retain active claims and all ambiguous claims; historical terminal rows may be pruned only after their local day is past and no outbox recovery path can refer to them. Initial implementation may retain the ledger indefinitely; bounded cleanup is not required for correctness.
- Cap preference changes are applied at claim time. Lowering the cap below already retained claims blocks additional ordinary sends until the count falls below the new value; it does not revoke sent/ambiguous history.
- Due-time columns (B1/A2b) and the lifecycle columns play different roles: `remind_at` / `bill_due_at` are immutable classification inputs — the timestamps freshness and staleness reclassification read — while `deliver_after` remains a mutable lifecycle value the policy sets and resets as a row defers, is requeued, or is recovered. Classification never reads `deliver_after`, and delivery scheduling never rewrites the due-time columns.
- **Migration transition (Q1):** from the moment the ledger lands, it is the **sole cap-counting authority**; the per-channel `cap_day` predicates inside the legacy claim functions stop being consulted as a counting source. Rows in `sending` at migration hold a `cap_day` reservation and have no ledger row: their post-migration lifecycle transitions (`markSent` / `markFailed` / lease recovery) proceed as outbox state transitions with **no ledger counterpart — ledger transitions for such rows are no-ops** — and they are never retroactively granted a claim. The bounded consequence is one lease window (`LEASE_MS` = 5 minutes per channel) in which in-flight legacy rows are not ledger-counted. This cannot oversubscribe the global cap in steady state: the ledger count for a space-day is always greater than or equal to either channel's own retained count, so once every live row carries a claim, the global predicate dominates either legacy predicate.

#### A2b — Retry-time event timing and urgency

- **Push:** add nullable immutable `remind_at` and `bill_due_at` fields to `push_outbox`, populated from `NotifyMeta` on first enqueue and preserved on retries. Placement is normative (Q3, closure amendment): these are columns on an existing table, so they are added as **migrateSchema-only PRAGMA-guarded ALTERs and are never added to BOOTSTRAP_SQL** — the repository's placement convention for existing-table columns, and the v252 rule (bootstrap runs before migrateSchema, so a bootstrap reference to a migration-only column crashes fresh-volume boot). `push_outbox` is created by BOOTSTRAP_SQL without the new columns; fresh volumes converge because `migrateSchema` runs after bootstrap on every boot and adds them.
- **Telegram (B1, closure amendment):** add a nullable immutable `remind_at TEXT` column to `notification_outbox`, on the literal `bill_due_at` precedent already in `db/client.ts`: the column is present in the migrateSchema `CREATE TABLE` (which covers volumes created after the change) **and** added to pre-existing volumes by a PRAGMA-guarded ALTER of the same shape as the existing `bill_due_at` guard. `notification_outbox` is defined only in migrateSchema today — it has no BOOTSTRAP_SQL definition — so this table's convergence point is the migrateSchema CREATE plus the guarded ALTER; nothing for this column goes into BOOTSTRAP_SQL, consistent with the placement rule above. Populate the column from `meta.remindAt` in the `enqueue` INSERT in `agent/notify/outbox.ts`, alongside the existing `bill_due_at` threading (`NotifyMeta.remindAt` already exists and is what `classifyUrgency` / `decidePolicy` read at first classification). The column is written once at enqueue and never updated.
- **Downgrade on every attempt, both channels:** on every immediate send, sweeper attempt, and crash-lease requeue, recompute urgency from the persisted original due-time columns using the shared `classifyUrgency` rules: reminder due time within 60 minutes in the past; bill due time within the existing 6-hour future window and per-bill dedup eligibility. The recomputation runs in both directions: the existing one-way `billRisk` upgrade in the Telegram sweep is preserved as the upward direction of this same reclassification, and a row whose freshness window has expired is **downgraded** — it reverts to ordinary policy evaluation and loses the quiet-hours and cap exemptions. A persisted `is_urgent` bit never authorizes a bypass by itself; it remains a hint for ordering only, never authority.
- Recompute staleness against the original reminder due time (3-day reminder limit), not row creation time, on both channels — the Telegram sweep's creation-time aging is replaced by due-time aging from `remind_at`. Run `decidePolicy` at delivery time. Non-urgent items in quiet hours are re-deferred; non-urgent cap-exhausted items are deferred. Stale items are dropped. Fresh qualifying urgent items bypass both quiet hours and the cap per owner-approved Option A.
- **Legacy rows fail closed (owner rule):** a row whose original due time cannot be recovered — no persisted due-time value, as for any row enqueued before these columns existed — receives **no urgency exemption**. Do not invent a timestamp and do not trust a persisted `is_urgent` flag; treat the delivery as ordinary, with the global cap and quiet hours enforced. Rows whose original due time is available and verifiable keep the existing reclassification behavior above. **Legacy reminder staleness:** A pre-migration Telegram reminder with `remind_at IS NULL` must be dropped as unverifiable and must not be sent. Do not substitute `created_at`, parse `occurrence_id`, or trust the persisted urgency flag to establish freshness. The no-urgency-exemption rule remains in force for legacy deliveries generally; this reminder-specific rule additionally resolves staleness. (This drop rule is scoped to legacy reminders only: legacy bills carry `bill_due_at`, remain verifiable, and keep their handling above.)
- **Occurrence parsing is foreclosed:** do not parse `occurrence_id` as a timing source — not as the primary source and not as a fallback. With `remind_at` persisted on both channels, the explicit columns are the durable contract, and the earlier draft option of deriving due time from occurrence metadata is withdrawn.

#### A3 — TTS migration and deletion contract

- Rebuild `tts_audio_cache` in both migration/bootstrap-compatible schema definitions to add `space_id TEXT NOT NULL`, change primary/unique identity to `(space_id, cache_key)`, and add `tts_audio_cache_space_created_idx(space_id, created_at)` plus the global-prune index/order needed for the 500-row bound.
- Migration is a single transaction: rename the legacy table, create the owned table, intentionally copy **zero** legacy rows, drop the legacy table, recreate indexes, and assert the final column/constraint/index contract. This intentionally discards unowned audio. On failure, rollback leaves the legacy table intact. Rerunning after success is a no-op.
- `DbSpeechCache` construction requires a trusted current `spaceId`; get/put/size and pruning remain ownership-aware, except pruning enforces the 500-row cap globally using `created_at DESC, rowid DESC`. The cache key itself remains unchanged; ownership is an additional namespace.
- Add `tts_audio_cache` to the deletion census (`SPACE_SCOPED_TABLES` in `auth/spaces.ts`) and delete by `space_id` inside the existing `deleteSpace` transaction. Failure anywhere rolls back cache deletion with the rest of brain deletion. The census test needs no update: its independent discovery rule finds every table carrying a `space_id`, so it cannot see the table today and **will** see it the moment the migration adds `space_id` — failing until the census includes it. The implementation change is in `auth/spaces.ts`; the guard is the forcing function for its own fix.

#### A4 — Acceptance additions / design exit

- Fresh bootstrap and old-volume migration expose identical cache and ledger contracts; migration twice is a no-op; unexpected legacy cache schema fails closed without dropping source data.
- Two spaces with identical speech keys never cross-hit. Deleting one space removes only its cache rows; forced failure rolls back all deletion work.
- Synchronized Telegram/push workers with cap 1 allow at most one non-exempt reservation; fresh urgent exempt deliveries do not consume the ordinary allowance; expired urgent retries must claim a normal slot or defer/drop.
- Test same-day definite-failure release/reclaim, cross-local-day retry, duplicate claim, send-start crash ambiguity, pre-send lease recovery, DST/day-boundary timezone behavior, cap lowered below current retained count, and cap-exempt urgent deduplication.
- Test reminder and bill-risk retries at just-inside and just-outside freshness boundaries, plus the outage timeline from the verification trace; staleness always uses original due time.
- Design closure is complete at the schema/contract level. The implementation task still must verify repository migration harness and test fixtures before writing production code; any contradiction with this contract returns to design review rather than improvising during implementation.

### Phase B — shared global cap
- [ ] **B1. Add ledger to bootstrap + migration with schema assertion.** Acceptance: fresh and migrated schemas match; migration twice is a no-op.
- [ ] **B2. Implement one atomic global claim/release service.** Acceptance: unit tests for cap boundary, local day, idempotency, release, sent, and ambiguous states.
- [ ] **B3. Integrate Telegram outbox with shared claims.** Acceptance: existing Telegram lifecycle passes plus ledger consistency assertions.
- [ ] **B4. Integrate push outbox with shared claims.** Acceptance: cross-channel concurrent test proves cap cannot oversubscribe.
- [ ] **B5. Revalidate due time/urgency and staleness on every retry, both channels.** Acceptance: failed fresh reminder aged past threshold loses urgency exception on push and on Telegram (B1 downgrade); cap still applies.
- [ ] **B6. Verify push-only drain and no-VAPID zero-row behavior.** Acceptance: tests prove no Telegram token dependency and no row/send when VAPID is absent.

### Phase C — per-space TTS cache
- [ ] **C1. Rebuild/migrate cache schema with ownership.** Acceptance: legacy rows purged, composite uniqueness enforced, migration idempotent.
- [ ] **C2. Thread space ID through cache construction and get/put.** Acceptance: identical hashes across two spaces never cross-hit.
- [ ] **C3. Include cache in deletion census and transaction.** Acceptance: deleting one space removes only its rows; forced failure rolls all deletion work back.
- [ ] **C4. Update cache documentation and tests to say “free while cached.”** Acceptance: eviction, concurrent misses, and cache-write failure are tested without lifetime exactly-once claims.

### Phase D — integration gate and review
- [ ] **D1. Schema parity + migration fixture suite.** Acceptance: fresh bootstrap versus upgraded legacy schema matches the intended contract. Fixtures use the repository's table-level legacy-fixture pattern (legacy table shape in a scratch database → run the migration → assert the final contract), per criterion 25; no full migrated-database fixture exists in this environment.
- [ ] **D2. Full server/web/typecheck/build gate.** Acceptance: all gates green on the combined implementation branch.
- [ ] **D3. Stash-and-fail test-falsification sample.** Acceptance: temporarily remove/bypass global claim enforcement, cache scoping, and deletion census; each corresponding test fails, then restore and rerun.
- [ ] **D4. Independent Reviewer audit.** Acceptance: review confirms global cap across both channels, deletion isolation, no silent UTC fallback, no raw error leakage introduced, no unrelated behavior drift.
- [ ] **D5. Update PROJECT_STATE/TASKS and prepare PR.** Acceptance: PR includes evidence, migration impact, and explicit non-deployment statement.

## 6. Sequencing and release gate

Order: Phase A design closure → Phase B global cap → Phase C cache ownership/deletion → Phase D full gate/review → merge only after acceptance. Keep `TELEGRAM_TTS_ENABLED` OFF and VAPID unconfigured until the implementation is merged and the post-merge gate passes. Deployment remains a separate owner action.

## 7. Risks and unresolved implementation details

- Claim-service placement was verified against the current import graph in the Phase A closure amendment (A1): a sibling module in `agent/notify/` (see §3) implements the transaction contract without an import cycle or non-atomic split, so the stop-condition is not triggered. If implementation uncovers import-graph facts that contradict A1's evidence, stop and return to design review.
- The ledger's retention/cleanup policy must not erase claims for the current local day or ambiguous outcomes before they stop counting.
- At migration, in-flight `sending` rows hold only a legacy `cap_day` reservation; their accepted window is bounded by one lease (`LEASE_MS` = 5 minutes) per channel (A2). After that window every live row carries a ledger claim and the legacy counting source is never consulted again.
- Day-boundary races must use the same resolved timezone and a single captured `now` per claim decision.
- The cache's global 500-row bound preserves storage boundedness but means one busy space may evict another space's cache entries; it must never permit cross-space cache hits.
- Legacy unowned audio will be discarded during migration. This is an intentional privacy-first cache loss; audio can be regenerated later if/when TTS is enabled.
- No production code, secret configuration, provider spend, merge, or deploy is authorized by this ADR.

## Phase A — closure amendment (2026-10-21)

Authored after the independent Phase A design review of this ADR at `e3e5508ab5a9000d508d22d584c4545905b979d8` (deploy baseline `15be567a84ca985e93d03772c4f4b2385f91ea76`). The review's verdict: architecture sound, mandatory gates G1/G2 resolved; one blocker and five closure questions outstanding. This amendment resolves them **in the normative text above**; nothing in this section is normative on its own. The amendment itself is documentation only — no production code changed — and it does not authorize implementation.

- **B1 (blocker) — Telegram retry reclassification had no due-time source.** `notification_outbox` carried `bill_due_at` but no `remind_at`, so Telegram reminder retries could not reclassify from original due time, and expired Telegram urgency could persist exactly as on push. Resolved in §2.4, A1, and A2b: `notification_outbox` gains `remind_at` on the `bill_due_at` precedent (migrateSchema CREATE + PRAGMA-guarded ALTER, populated from `meta.remindAt` at enqueue); the Telegram sweep gains the **downgrade** (reclassification runs both directions on every attempt, both channels); and the draft's occurrence-parsing fallback is **withdrawn** — `occurrence_id` is foreclosed as a timing source, resolving the closure's self-contradiction.
- **Legacy-row rule (owner).** Stated in §2.4 and A2b: no recoverable original due time ⇒ no urgency exemption; no invented timestamp; no trust in a persisted urgency flag; the delivery is treated as ordinary (global cap and quiet hours enforced). Rows with an available, verifiable due time keep the existing behavior.
- **D-1 (verification discrepancy) — legacy reminder staleness.** The independent verification of this amendment verified every other item and found one gap beside the legacy-row rule: the rule settled the *exemption* for rows with no recoverable due time but not the *staleness* input — criterion 10 ages stale reminders from original due time (absent for legacy rows) while criterion 12 forbids `created_at` as a retry basis, so an implementer would have had to invent the rule. Resolved by the owner's decision, stated in §2.4 and A2b and reflected in criterion 10: a pre-migration Telegram reminder with `remind_at IS NULL` is dropped as unverifiable and must not be sent; `created_at`, occurrence parsing, and the persisted urgency flag are all forbidden as freshness sources. The rule is reminder-specific — legacy bills carry `bill_due_at`, remain verifiable, and keep their verified handling. The verifier's single-item confirmation of this sentence has since completed (verified), and no other verified item was reopened or reworded.
- **Q1 — migration boundary.** Resolved in A2: the ledger is the sole counting authority from the moment it lands; legacy in-flight `sending` rows transition with no ledger counterpart (no-ops) and are never retroactively claimed; the accepted window is one lease per channel; `cap_day` stops being consulted as a counting source.
- **Q2 — criterion 13 harness.** Resolved in §4 criterion 13: two interleaved drain loops, one process, one handle, barriers at the send await; sequential simulation explicitly insufficient.
- **Q3 — column placement.** Resolved in A2b: A2b's new `push_outbox` columns are migrateSchema-only PRAGMA-guarded ALTERs, never in BOOTSTRAP_SQL (v252 rule stated); the same placement reasoning is stated for B1's `remind_at`, whose table is migrateSchema-defined.
- **Q4 — file map.** Resolved in §3 and A1: `agent/notify/boundary.ts` is named as the Telegram claim-integration site (both claim call sites); the nonexistent `telegram/*outbox*.ts` reference is removed; the confirmed claim-service placement is recorded.
- **Q5 — fixture pattern.** Resolved in §4 criterion 25 and Phase D1: parity fixtures follow the repository's table-level legacy-fixture pattern; no full migrated-database fixture exists in this environment.
- **Gate resolutions recorded:** G1 (claim-service placement vs import graph) — cleared, placement recorded in §3/A1 and §7 updated to match. G2 (migration + fixture conventions) — cleared with the specification notes now written into A2b, criterion 25, and D1.
- **Design-gate decision (owner, 2026-10-21) — Phase A CLOSED.** With the independent verification complete (every item verified; D-1 confirmed closed by the single-item confirmation), the owner closed Phase A and approved this ADR as the implementation contract. This decision approves the design only: **implementation (Phases B–D) is not yet authorized** and awaits the owner's separate explicit authorization; merge, deployment, and feature arming (TTS/VAPID) remain unauthorized and on hold.
- **Implementation (owner-authorized 2026-10-21) — Phases B–D COMPLETE.** The global cap + retry freshness (Phase B), per-space TTS cache ownership (Phase C), and the full verification battery + independent review (Phase D) were implemented on branch `adr018-impl` exactly to this contract. The independent review's first verdict was NOT ACCEPTED on a single item — criterion 23's cache-write-failure *behavior* was correct but its required test subject was missing; the test was added (test-only), falsified in both directions, and independently confirmed closed: **implementation ACCEPTED, 28/28 criteria** (review record: `adr018-implementation-review-2026-10-21.md`).
- **D-1 push extension — RATIFIED by the owner (2026-10-22).** The implementation applied D-1's drop symmetrically to legacy push reminders (this ADR's D-1 sentence names Telegram; without the extension, legacy push reminders would have had no staleness bound at all). The owner ratified the extension explicitly, in these exact words:

> Ratified: D-1 applies to both legacy Telegram and legacy push reminders. If a legacy reminder has no persisted due time, drop it as unverifiable. Do not infer freshness from `created_at`, `occurrence_id`, or a persisted urgency flag. This extension does not change the treatment of other notification types.

- **Merge (owner-authorized 2026-10-22) — PR #91.** `adr018-impl` merged into the deploy branch; new deploy-branch HEAD `e297208ea3fec6fb968dad5d0e2756e1a12cdd3f`. Post-merge verification (from commit objects): the merged tree differs from the implementation tree by exactly PR #90's 10 web files, and from the pre-merge deploy tree by exactly the implementation's 21 files, with zero overlap between the deltas. Combined-tree re-gate on the merged HEAD: typecheck 0; web 1,371/1,371 under both America/New_York and Pacific/Kiritimati; build 0; server 1,857/1,859 — the only two failures (the daily-digest pair in `notifications`/`telegram`) reproduced identically on the pre-merge base, the known pre-existing date-sensitive fixture family, not this implementation.

**Next gate:** deployment and feature arming — each remains a **separate owner decision**, still unauthorized. Implementation and merge are complete and accepted; nothing in this record deploys the merged code or arms TTS (`TELEGRAM_TTS_*`) or web push (`VAPID_*`).
