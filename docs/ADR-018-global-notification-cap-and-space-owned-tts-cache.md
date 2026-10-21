# ADR-018 — Global notification cap and per-space TTS cache ownership

**Status:** APPROVED DESIGN — implementation not started  
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
- Persist the original reminder due time separately from queue creation time, or derive it from validated immutable occurrence metadata.
- On every drain/retry, recalculate freshness against the original due time. A persisted `is_urgent` bit is not authority to bypass policy forever.
- Re-evaluate quiet hours, local-day cap availability, and stale/drop policy at delivery time.
- If an urgent reminder becomes stale, it loses both the quiet-hours and cap exceptions. Fresh, qualifying urgent deliveries are explicitly cap-exempt; all other deliveries use the shared global ledger.
- Preserve the current rule that uncertain send outcome is terminal/ambiguous to avoid duplicates.

## 3. Required files and boundaries (implementation targets)

Likely touch points, to be confirmed by the Builder against the architecture and current task before implementation:

- `packages/server/src/agent/notify/policy.ts` — shared local-day and urgency policy semantics.
- `packages/server/src/telegram/*outbox*.ts` (exact current path/function to be verified) — global claim integration for Telegram.
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

1. With cap = 1 and both channels eligible, concurrent Telegram and push workers produce at most one send accepted for a given space-local day.
2. Repeated concurrent claims for the same outbox occurrence cannot reserve multiple slots.
3. With cap = 5, any mix of Telegram and push has no more than five accepted/reserved/ambiguous deliveries for that space-local day. The cap is not five per channel.
4. Two local calendar days that share a UTC date boundary are accounted as distinct days in the configured space timezone; day changes are not based on `toISOString().slice(0, 10)`.
5. Deferred items consume no cap slot until claimed for delivery; cap exhaustion defers rather than drops.
6. Definite send failure releases the slot exactly once; retry can reclaim once when policy allows.
7. Successful delivery retains its slot for that local day.
8. Ambiguous send outcome retains the slot and is never automatically retried.
9. A fresh qualifying urgent reminder may bypass both quiet-hours deferral and the global cap, preserving the signed-off Phase-2 policy.
10. After the freshness window expires, retry reclassification removes the urgent exception; normal quiet-hours and global-cap rules apply, and stale reminders are dropped using original due time.
11. A fresh bill-risk notification may use its existing urgency exception only while the bill remains within the classifier's original due-in window and existing per-bill dedup rules permit it; a retry after the due time is not urgent.
12. Every retry decision is based on immutable original event timing, not `created_at`, `deliver_after`, or a persisted `is_urgent` bit.
13. Telegram and push claim operations share one transaction-safe cap predicate; a test with synchronized concurrent workers demonstrates no oversubscription.
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

25. `BOOTSTRAP_SQL` and migration result converge on the same table/index contract; bootstrap never uses migration-only columns.
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
  PRIMARY KEY (channel, delivery_key, local_day)
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

#### A2b — Retry-time event timing and urgency

- Add nullable immutable `remind_at` and `bill_due_at` fields to `push_outbox`, populated from `NotifyMeta` on first enqueue and preserved on retries. Existing rows with no recoverable due metadata are treated as non-urgent; they cannot inherit an old `is_urgent` bypass.
- On every immediate send, sweeper attempt, and crash-lease requeue, recompute urgency using the shared `classifyUrgency` rules: reminder due time within 60 minutes in the past; bill due time within the existing 6-hour future window and per-bill dedup eligibility. The persisted bit is a hint for ordering only, never authority.
- Recompute staleness against the original reminder due time (3-day reminder limit), not row creation time. Run `decidePolicy` at delivery time. Non-urgent items in quiet hours are re-deferred; non-urgent cap-exhausted items are deferred. Stale items are dropped. Fresh qualifying urgent items bypass both quiet hours and the cap per owner-approved Option A.
- If a push row cannot safely reconstruct its original timing, fail closed to non-urgent policy. Do not parse `occurrence_id` as the primary timing source; explicit columns are the durable contract.

#### A3 — TTS migration and deletion contract

- Rebuild `tts_audio_cache` in both migration/bootstrap-compatible schema definitions to add `space_id TEXT NOT NULL`, change primary/unique identity to `(space_id, cache_key)`, and add `tts_audio_cache_space_created_idx(space_id, created_at)` plus the global-prune index/order needed for the 500-row bound.
- Migration is a single transaction: rename the legacy table, create the owned table, intentionally copy **zero** legacy rows, drop the legacy table, recreate indexes, and assert the final column/constraint/index contract. This intentionally discards unowned audio. On failure, rollback leaves the legacy table intact. Rerunning after success is a no-op.
- `DbSpeechCache` construction requires a trusted current `spaceId`; get/put/size and pruning remain ownership-aware, except pruning enforces the 500-row cap globally using `created_at DESC, rowid DESC`. The cache key itself remains unchanged; ownership is an additional namespace.
- Add `tts_audio_cache` to the deletion census and delete by `space_id` inside the existing `deleteSpace` transaction. Failure anywhere rolls back cache deletion with the rest of brain deletion. Update the census test because its existing discovery rule only sees tables that already have a `space_id` column.

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
- [ ] **B5. Revalidate due time/urgency and staleness on every push retry.** Acceptance: failed fresh reminder aged past threshold loses urgency exception; cap still applies.
- [ ] **B6. Verify push-only drain and no-VAPID zero-row behavior.** Acceptance: tests prove no Telegram token dependency and no row/send when VAPID is absent.

### Phase C — per-space TTS cache
- [ ] **C1. Rebuild/migrate cache schema with ownership.** Acceptance: legacy rows purged, composite uniqueness enforced, migration idempotent.
- [ ] **C2. Thread space ID through cache construction and get/put.** Acceptance: identical hashes across two spaces never cross-hit.
- [ ] **C3. Include cache in deletion census and transaction.** Acceptance: deleting one space removes only its rows; forced failure rolls all deletion work back.
- [ ] **C4. Update cache documentation and tests to say “free while cached.”** Acceptance: eviction, concurrent misses, and cache-write failure are tested without lifetime exactly-once claims.

### Phase D — integration gate and review
- [ ] **D1. Schema parity + migration fixture suite.** Acceptance: fresh bootstrap versus upgraded legacy schema matches the intended contract.
- [ ] **D2. Full server/web/typecheck/build gate.** Acceptance: all gates green on the combined implementation branch.
- [ ] **D3. Stash-and-fail test-falsification sample.** Acceptance: temporarily remove/bypass global claim enforcement, cache scoping, and deletion census; each corresponding test fails, then restore and rerun.
- [ ] **D4. Independent Reviewer audit.** Acceptance: review confirms global cap across both channels, deletion isolation, no silent UTC fallback, no raw error leakage introduced, no unrelated behavior drift.
- [ ] **D5. Update PROJECT_STATE/TASKS and prepare PR.** Acceptance: PR includes evidence, migration impact, and explicit non-deployment statement.

## 6. Sequencing and release gate

Order: Phase A design closure → Phase B global cap → Phase C cache ownership/deletion → Phase D full gate/review → merge only after acceptance. Keep `TELEGRAM_TTS_ENABLED` OFF and VAPID unconfigured until the implementation is merged and the post-merge gate passes. Deployment remains a separate owner action.

## 7. Risks and unresolved implementation details

- Implementation must verify the chosen shared claim-service placement against the current import graph before coding; if the transaction contract cannot be implemented without an import cycle or non-atomic split, stop and return to design review.
- The ledger's retention/cleanup policy must not erase claims for the current local day or ambiguous outcomes before they stop counting.
- Day-boundary races must use the same resolved timezone and a single captured `now` per claim decision.
- The cache's global 500-row bound preserves storage boundedness but means one busy space may evict another space's cache entries; it must never permit cross-space cache hits.
- Legacy unowned audio will be discarded during migration. This is an intentional privacy-first cache loss; audio can be regenerated later if/when TTS is enabled.
- No production code, secret configuration, provider spend, merge, or deploy is authorized by this ADR.
