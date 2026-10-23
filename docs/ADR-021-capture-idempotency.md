# ADR-021 — Capture idempotency: one key per capture attempt, on every path

**Status:** DESIGN — drafted 2026-10-23 under the owner's complete-remediation
objective (every confirmed finding is fixed systematically; design-first lane
for write paths). The design gate (§11) is **OPEN**. Implementation has **not**
started and is **not authorized** — gate closure does not authorize it;
implementation requires the owner's separate explicit authorization. Merge and
deployment remain separate owner decisions.
**Approved by:** — (design only; no owner decisions recorded yet — §11 lists them)
**Date:** 2026-10-23
**Design baseline:** deploy branch HEAD `570128cb167e16427a9960fc7345264f049617ba`
**Numbering:** ADR-020 (`design/pending-approvals`) is the latest ADR; the deploy
tree at the baseline contains ADR-019 as its newest ADR file. ADR-021 is the
next free number.
**Evidence base:** Capture audit pass 6, 2026-10-23
(`~/workspace/ui-audit/capture-audit-2026-10-23.md`), findings **CAP-02**
(weak/high) and **CAP-06** (weak/medium, queue-feedback half); ADR-020 §8.2
(**DP-2**, the deferred stamp-after-ingest window). Every load-bearing claim
about current behavior below was **spot-verified against the code at the
baseline while drafting** (§2 cites file/function evidence). Verified givens,
gaps, and unknowns are kept separate (§2 / §3 / §10).
**Scope:** idempotency and duplicate protection for **every capture path** —
the web brain-dump and its offline queue, chat-originated saves, the two
approval-gated conversational tools, Telegram `/log`, Telegram `/note`, and
Mind thought capture — so that re-submitting one capture *attempt* (repeated
keystroke, lost response, retried queue flush, re-sent message, crash-retry of
an approved execution) produces **one memory set and one reward credit**, and a
replay returns the **original result**, not a second capture and not an error.
**Goal (owner's framing, via CAP-02's acceptance criteria):** re-submitting the
identical capture through any double-fire route produces one memory set and one
reward credit, or an explicit user-facing statement that a duplicate was
detected — while a genuinely repeated *distinct* thought (same words, later,
intentional) remains capturable.
**Non-goals:** raw-source preservation (CAP-01 — the approved verbatim-recall
V1 design is its vehicle; this ADR's receipt store is **not** a source store),
reward unification across doors (CAP-07), and the `/log` prefix-matching defect
(TG-05/CAP-03). None of those is designed or bundled here.

**Revision history.**
- **Initial design (2026-10-23).** Drafted from CAP-02/CAP-06 + DP-2 above.
  All §2 givens spot-verified against `583a3d3` during drafting; the deploy
  tip then advanced to `570128c` (PR #98, Worlds-only — 5 web graph files),
  and every code path cited in §2 was diff-verified **unchanged** between
  the two tips before this design was re-baselined onto `570128c`.

---

## 1. Settled for design (program-level, 2026-10-23)

- **D-CI-1 — Scope is all capture paths.** The DP-2 deferral in ADR-020 §8.2
  scoped the idempotency-key problem to the two approval-gated tools. CAP-02
  verified the same absence on *every* main capture path and named three
  concrete double-fire routes (keyboard double-submit; offline-flush retry of
  a possibly-committed POST; Telegram re-send after a silent failure). This
  ADR is the separate design task ADR-020's DP-2 disposition pointed at,
  widened to CAP-02's scope. It does not reopen ADR-020's gate; if the owner
  closes DP-2 as "deferred to ADR-021," this ADR is that design.
- **D-CI-2 — Honest strength language.** The promise is **effectively-once**,
  the approval machine's own contract language (ADR-020 G7). Completed and
  concurrent replays are deduped deterministically (§5); a crash in the
  middle of node creation leaves a named, bounded residual (§5.4) that
  reconciles instead of duplicating. No copy in this design may imply
  exactly-once.
- **D-CI-3 — Keys identify attempts, not content.** A key names one capture
  *attempt* by one user on one path. Identical words submitted as a new
  attempt (new key) always capture. Content-derived dedup exists in exactly
  one place — the optional Telegram re-send window — and only as an explicit
  owner decision (§6.3, OD-1), because Telegram gives a re-sent message a new
  identity and no attempt key survives that channel hop.

## 2. Verified givens — the foundation the design stands on

Each given was re-checked against the code at the baseline while drafting
(verified at `583a3d3`; re-confirmed unchanged at `570128c`, see the
revision history).

- **G1 — A single-node idempotency primitive already exists, and works.**
  `nodes.idempotency_key` is a nullable column (BOOTSTRAP_SQL
  `packages/server/src/db/schemaSql.ts:27`; ALTER for existing databases in
  `migrateSchema`, `packages/server/src/db/client.ts:770-784`) under
  `UNIQUE(space_id, idempotency_key)` (`nodes_idem_idx`, created in
  migrateSchema only — the schemaSql comment at :108 records why the index
  must not live in BOOTSTRAP_SQL). NULL keys never conflict.
  `NodesRepo.create` writes the key **at insert** when given one
  (`packages/server/src/repositories/nodes.repo.ts:26-27,123`).
  `create_task` uses it correctly: key carried into the create, UNIQUE
  violation caught and re-read as the deduped result
  (`packages/server/src/agent/tools/taskCreator.ts:87-121`). `fire_reminder`'s
  atomic `fired_by_approval` claim is the sibling pattern (ADR-020 G7).
- **G2 — The ingest pipeline stamps nothing and checks nothing.**
  `ingestCore` (`packages/server/src/ingestion/pipeline.ts`) creates each
  extracted node via `NodesRepo.create({...n, occurredAt, remindAt, tags})` —
  no idempotency input exists in `IngestDeps`/`IngestMeta`, and neither
  `ingest` nor `ingestWithContext` accepts a key. Every call creates fresh
  nodes and fresh edges. There is no capture-level record of "this attempt
  already ran" anywhere in the tree.
- **G3 — The web ingest route has no key field and pays rewards after ingest,
  outside any shared transaction.** `IngestBody`
  (`packages/server/src/api/routes/ingest.ts`) is
  `{text, kind?, ttlHours?, occurredAt?, remindAt?, tags?}` — a client-sent
  key would be stripped by zod today. The `kind:"action"` branch creates one
  node with no key. The memory branch runs `ingestWithContext`, **then**
  `StreakRepo.touch()` and `EconomyRepo.add(fuelEarned)` in the route — so a
  route-level replay that only deduped inside the pipeline would still
  double-credit fuel and re-touch the streak. Any correct design must bind
  the *route's whole effect* (nodes + rewards), not just node creation.
- **G4 — The web client queues without identity.** `ingestText`
  (`packages/web/src/api/client.ts:344`) POSTs `{text, ...opts}`; on
  `navigator.onLine === false` or a fetch throw it calls `enqueueIngest` and
  throws `OfflineQueuedError`. Queue items are `{text, opts}` only
  (`enqueueIngest`, :284-295) under the **per-brain** key
  `brain.ingestQueue.${id}` (`ingestQueueKey`, :271-274 — the anti-cross-brain
  scoping CAP's verified-strong section credits). `flushIngestQueue`
  (:301-340) re-POSTs each item and re-queues it on any throw or non-OK
  response — a request that committed server-side but whose response was
  lost is indistinguishable from one that never arrived (CAP-02 route 2).
  A `brain-ingest-synced` event carries the flushed node ids as *new*.
- **G5 — The keyboard double-fire route is real, exactly as CAP-02 states.**
  `IngestPanel.submit()` (`packages/web/src/components/IngestPanel.tsx:121`)
  has no in-flight guard; it only `setBusy(true)` (React state, not a
  synchronous barrier). The textarea's `onKeyDown` (:278-279) calls
  `submit()` directly on ⌘/Ctrl+Enter, bypassing the button's
  `disabled={busy}` (:387). Two ⌘+Enter presses inside one network round
  trip are two POSTs.
- **G6 — Chat-originated capture inherits the web client's behavior.**
  ChatDock's save-as-memory and distill-approval paths call the same
  `ingestText` (`packages/web/src/components/ChatDock.tsx:501,675`), as do
  the other web callers (ActionsPanel action creation, DigestPanel). A fix
  inside `ingestText` covers all of them; none sends a key today.
- **G7 — `capture_memory` / `dream_playback`: stamp-after-ingest, as DP-2
  recorded.** Both tools pre-check `SELECT … WHERE idempotency_key =
  'approval:<id>'`, then ingest, then stamp the **first** created node with
  a post-hoc `UPDATE` (`packages/server/src/agent/tools/captureMemory.ts:
  56-105`; `packages/server/src/agent/tools/dreamPlayback.ts:137-177`,
  correction branch). The stamp's `try/catch` swallows a UNIQUE loss as
  success. Crash between ingest and stamp ⇒ retry finds no stamp and
  ingests a second copy; multi-node captures are represented by one stamped
  node only. ADR-020 §8.2's mechanism description is confirmed verbatim at
  this baseline.
- **G8 — Telegram: no transport identity reaches the handler, and `/log`
  dedups nothing.** The webhook route acks `200` **before** processing
  (`packages/server/src/api/routes/telegram.ts`: `res.json({ok:true})` then
  `void handleTelegramUpdate(...)`, errors log-only) — Telegram-side retry
  after an ack is therefore not the exposure; user re-send is. The declared
  `TelegramUpdate` type (`packages/server/src/telegram/bot.ts:44-53`)
  carries **no `update_id` and no `message_id`** — `handleTelegramUpdate`
  (:286) reads only `chat.id`, `text`, `voice`. The `/log` branch
  (:494-524) calls `ingestWithContext` and then credits
  `StreakRepo`/`EconomyRepo` in the bot, with no dedup of any kind — the
  same whole-effect shape as G3.
- **G9 — `/note` is single-save under sequential updates, by draft removal —
  not by an atomic claim.** `handleNoteCommand`'s `/done` branch
  (`packages/server/src/telegram/notes.ts`) calls `saveTelegramNote`
  (one `NodesRepo.create`, verbatim, no key) and only then removes the
  draft; a failed save keeps the draft open ("your draft is still open,
  try /done again"). Two `/done` updates processed concurrently both read
  the live draft before either removes it. Drafts are keyed
  `(space_id, chat_id)` in `telegram_note_drafts`.
- **G10 — Mind thought capture is a bare INSERT.** `addThought`
  (`packages/server/src/analysis/workingMemory.ts:49`) is a plain
  `INSERT INTO working_memory` with no key or dedup;
  `POST /api/working` (`packages/server/src/api/routes/working.ts`) accepts
  `{text, source?}` only, and `MindPanel`'s submit clears the input before
  awaiting (CAP-09's evidence). Promotion is **not** a fresh capture: it
  transitions an existing mote row under a guarded update, so it is out of
  the duplicate-capture problem (verified in the same file's promote path).

## 3. Gaps this design must close (from §2)

1. No attempt identity exists on P1/P2/P6 (web), P8 (`/log`), or P5 (Mind);
   the pipeline (G2) cannot carry one even where a caller has one (P7).
2. No record exists from which a replay could return the **original
   result** — G1's stamp answers "did one node land?" but cannot reproduce
   a multi-node `IngestResult`, its edge lists, or the fuel/streak outcome
   (G3/G8 make the outcome part of the effect that must not repeat).
3. The two approval tools stamp *after* the effect (G7) — DP-2's window.
4. Rewards are written after ingest, unbound from it (G3/G8) — a dedup
   that stops at node creation still double-pays.
5. The Telegram handler cannot see message identity at all (G8), and
   `/done`'s safety is sequential-only (G9).

## 4. Mechanism overview — claim-first receipts + stamp-at-creation

Two cooperating mechanisms, both built from parts the codebase already
trusts (G1's UNIQUE-backed key; ADR-019's claim-first transaction rule):

- **A capture receipt** — one row per capture attempt, **claimed before any
  side effect** and completed with the attempt's full original result. The
  receipt is what a replay returns, what makes rewards exactly-once, and
  what distinguishes *in-flight* from *done* from *crashed*. (§5.1)
- **A capture stamp on every created node** — a new non-unique
  `nodes.capture_key` written **at insert** by the pipeline, linking a
  capture's nodes back to its receipt for crash recovery (§5.4). Callers
  that create exactly one node (action-kind, `/note`) additionally stamp
  G1's `idempotency_key` at the same insert — never by post-hoc UPDATE —
  so the existing UNIQUE index remains a hard backstop where it fits.

### 4.1 The receipt store

New table **`capture_receipts`** (migration shape in §9):

| Column | Meaning |
|---|---|
| `id` | autoincrement |
| `space_id` | owning space (all queries scoped by it) |
| `idempotency_key` | the attempt key (§6 gives each path's key shape) |
| `source` | `web` · `chat-web` · `telegram-log` · `telegram-note` · `approval` · `working` |
| `request_hash` | sha256 of the canonical request (source + text + kind + meta), for C3 |
| `status` | `claimed` → `completed` (a claim is *deleted* on definite pre-effect failure, §5.3) |
| `result_json` | the attempt's original result, verbatim (§5.2); NULL while claimed |
| `created_at` | claim time |
| `completed_at` | completion time; NULL while claimed |
| `expires_at` | `completed_at + 30 days` (retention, OD-2); NULL while claimed |

`UNIQUE(space_id, idempotency_key)` is the atomic claim backstop, exactly
as `nodes_idem_idx` is for G1. No user text beyond `result_json`'s payload
lives here, and `result_json` for ingest sources stores the response the
user already saw (node objects + edge lists + reward figures) — it is a
**result** record, not a source-text store (CAP-01's store is a separate
design; nothing here pre-empts or substitutes for it).

### 4.2 The node stamp

`nodes.capture_key` (nullable TEXT, non-unique) + index
`(space_id, capture_key)`. `ingestCore` gains an optional capture key via
`IngestMeta` and passes it into **every** `NodesRepo.create` of that
capture; the first created node also receives `idempotencyKey` when the
caller supplies one under G1's namespace rules (§6). The stamp's only jobs
are recovery linkage (§5.4) and auditability — uniqueness never depends on
it, so a multi-node capture is fully stamped, unlike G7's first-node-only
post-hoc mark.

## 5. The claim protocol (all paths)

### 5.1 Claim first

Before any node is created, any reward is written, or any draft is
consumed, the executing path inserts its receipt row (`status='claimed'`,
with `request_hash`) in its own SQLite transaction. Outcomes:

- **Insert succeeds** → this execution owns the attempt; proceed.
- **UNIQUE conflict** → load the existing receipt and branch on its state
  (§5.2/§5.3/§5.4). The loser never re-executes blindly.
- **`request_hash` mismatch** on an existing key (claimed or completed) →
  the **conflict outcome**: web `409 {error:"idempotency_key_reused"}`;
  Telegram an explicit reply naming the collision; tools a failed result.
  Nothing is created. (C3 — one key, one payload.)

### 5.2 Completed replay — return the original result

If the existing receipt is `completed` and unexpired, the path returns
`result_json` **verbatim**, marked as a replay, and performs **no** side
effect of any kind — no nodes, no edges, no streak touch, no fuel, no draft
change:

- `POST /api/ingest`: HTTP 200 with the original response body plus
  `idempotentReplay: true`. (The flag exists so clients can be honest:
  `flushIngestQueue` excludes replayed node ids from the
  `brain-ingest-synced` "new" set, and `IngestPanel` prefixes its success
  line "Already saved earlier —" instead of presenting old nodes as new.
  This is CAP-06's honesty edge at the queue seam; CAP-06's error-styling
  half is a separate finding, out of scope here.)
- `/log`: the original confirmation is re-sent, prefixed "Already logged
  earlier — " with the original label/counts. The user re-sent because
  they never saw it (G8's silent-failure route); re-delivering the
  original confirmation is the correct repair, not a terse "duplicate."
- `capture_memory` / `dream_playback`: the stored `ToolResult` (summary,
  message, targets) is returned as-is — an upgrade over G7's reconstructed
  "already saved" variant, and the approval machine's retry semantics
  (ADR-020 G7) are untouched.
- `/note` `/done`: the original "✅ Note saved as …" reply is re-sent.
- `POST /api/working`: the original `{id}` response.

### 5.3 In-flight and definite-failure outcomes

- **Claimed and fresh** (`now − created_at < CLAIM_STALE_MS`, §10): a
  concurrent duplicate is told the attempt is in flight — web
  `409 {error:"capture_in_progress", retryable:true}`; Telegram "Still
  saving that one — give me a second."; a tool execution returns a
  retryable failure so the approval machine's existing attempt accounting
  governs. Nothing is created. The web panel's own guard (§6.1) makes
  this a backstop, not a user-facing routine.
- **Definite failure before any node exists** (validation, provider error
  during extraction/embedding — i.e., the pipeline threw before its first
  `NodesRepo.create`): the executor **deletes its claim** before
  returning the failure. The user's ordinary retry (same attempt key —
  the panel keeps it until success or discard, §6.1) starts clean. This
  preserves today's "press Add again" recovery (Capture audit,
  verified-strong) instead of trapping the attempt behind a stale claim.

### 5.4 Stale claim — crash recovery by stamp, never blind re-execution

A `claimed` receipt older than `CLAIM_STALE_MS` means the executor died
(or hung past any plausible ingest) mid-attempt. A retry with that key
resolves it by evidence, in this order:

1. **No nodes carry the capture key** → the attempt died before its first
   effect. The retry re-claims (refreshes `created_at` on the same row)
   and executes normally.
2. **Nodes carry the capture key** → the capture *landed*, at least in
   part. The retry does **not** ingest again. It **reconciles**: rebuilds
   the result from the stamped nodes and their edges (extracted edges =
   both endpoints in the stamped set; associative = source in the set,
   target outside it — the pipeline's own construction, G2 §4a/4b/4c),
   then runs the completion step (§5.5) with `reconciled: true` recorded
   in `result_json`, and returns that result as a replay.
   - **Named residual (honest, D-CI-2):** if death struck *between* node
     creations, the stamped set is a prefix of the intended capture. The
     reconciled result is that partial set, flagged `reconciled` — the
     user sees a recovered partial capture, never a silent double and
     never a vanished one. The create loop performs no awaits between
     node inserts at the baseline (embeddings are batched before it), so
     this window is the width of one synchronous loop, not of a network
     call. Widening or closing it further is a pipeline-transaction
     redesign, out of scope (§8).
   - Reconciled fuel (ingest sources) is computed from the reconstructed
     associative-edge count; best-effort cognitive-anchor edges created
     inside `linkCognitiveAnchor` during creation are indistinguishable
     in the edges table and may inflate that count by the anchors a
     stamped node carries. Bounded, one-directional (a few fuel at
     most), and confined to the crash-recovery path — recorded here so
     nobody has to rediscover it.

### 5.5 Completion — rewards and receipt complete in one transaction

For the two reward-paying ingest paths (G3's route, G8's `/log`), the
completion step — `StreakRepo.touch()`, `EconomyRepo.add(...)`, and the
receipt's transition to `completed` with its final `result_json` — runs
inside **one** `handle.sqlite.transaction(...)` after the asynchronous
ingest returns. Therefore rewards exist **iff** a completed receipt
exists (C4), and a crash anywhere before that transaction leaves the
§5.4 recovery path in sole charge of ever applying them (exactly once,
inside the same shape of transaction). The non-reward paths complete
their receipt in a single-row update at the same point in their flow.
(Implementation must confirm `StreakRepo`/`EconomyRepo` writes join the
caller's transaction — both are synchronous better-sqlite3 writes at the
baseline; this is an implementation check, §10, not a design unknown.)

## 6. Per-path mechanism choices

| Path | Key origin & shape | Key lifetime | Primary guard besides the receipt |
|---|---|---|---|
| P1 web ingest (memory + action) | **Client-supplied**: `crypto.randomUUID()` minted by `api/client.ts` per *attempt* (§6.1), sent as body field `idempotencyKey` | One panel submission, incl. its offline sojourn; discarded on success/discard | Panel in-flight guard (§6.1); first-node G1 stamp for action-kind (single node) |
| P2 offline queue | The P1 attempt key, **persisted in the queue item** | Until the item syncs or is dropped by the existing 200-item bound | Per-brain queue key (G4) unchanged |
| P3 file import / P4 dictation | — inherit P1 (draft-only until submit; G-audit verified) | — | — |
| P5 Mind thought | **Client-supplied**: UUID per submit attempt in `MindPanel`, sent to `POST /api/working` | One submit attempt | Panel in-flight guard |
| P6 chat save / distill | — inherits P1 via `ingestText` (G6) | — | — |
| P7 `capture_memory` | **Server-derived**: existing `approval:<id>` (G7's namespace) | The approval's execution attempts; receipt retention (§7) | Stamp-at-creation (§6.2) |
| P7′ `dream_playback` (correction) | **Server-derived**: `approval:<id>` | Same | Stamp-at-creation (§6.2) |
| P8 Telegram `/log` | **Server-derived transport key**: `tg:<chatId>:<messageId>`; **plus optional content-window key** `tgwin:<sha256>` (§6.3, OD-1) | Transport key: receipt retention; window key: 10 minutes | Both receipts claimed atomically, either replay short-circuits |
| P9 Telegram `/note` `/done` | **Server-derived draft key**: `note:<chatId>:<draft updated_at>:<partCount>:<sha256(text)>` | Until the draft is saved, discarded, or edited (any edit changes the key) | Single node stamped at creation under both stamps (§4) |

**Why client-supplied on web:** the server cannot distinguish "the same
attempt retried" from "a new attempt with the same words" — only the
client knows an attempt's identity across a lost response (route 2's
ambiguity is client-side knowledge). A server-derived content hash on web
would break D-CI-3 (intentional repeats). **Why server-derived on
Telegram/approvals:** those callers *have* durable identities already
(message id, draft state, approval id) and no client to mint or persist a
UUID — deriving from the identity that already names the attempt is
strictly stronger than inventing one.

### 6.1 The web attempt key & the keyboard route (CAP-02 route 1)

- `IngestPanel` holds its attempt key + in-flight promise in refs. The key
  is minted when a draft first becomes submittable, and **survives** a
  failed or queued submit (so the retry is the same attempt); it is
  discarded only on success (incl. replay success) or confirmed discard —
  the same lifecycle as the IM-117 draft itself. Editing the text does
  **not** rotate the key: the receipt's `request_hash` (C3) is what
  separates "same attempt, edited words" (a conflict the panel resolves
  by minting a fresh key before resubmitting edited text — specified so
  the C3 outcome never surprises a user) from "same attempt, same words."
  Simpler equivalent the implementation may choose: rotate the key on any
  text change after a failed submit. Either satisfies C3/C5; the ADR
  requires only that an edited resubmission never 409s against its own
  earlier failure.
- `submit()` gains a synchronous in-flight guard: a re-entry while a
  submit is in flight returns the in-flight promise (or no-ops). This —
  not the server — is route 1's primary fix; the receipt is its backstop
  for the cross-tab/cross-device case the guard cannot see.
- `ingestText(text, opts)` mints a key per call for non-panel callers
  (G6), sends it in the body, and — critically for route 2 — on the
  network-failure path enqueues **that same key** with the item.
  `flushIngestQueue` sends each item's stored key verbatim on every
  retry. Items already queued by older builds (no key field) are minted
  a key and **re-persisted before their first POST**, so their first
  flush attempt is already replay-safe.

### 6.2 DP-2 closed: stamp at creation for the approval tools

`capture_memory` and `dream_playback` pass their existing
`approval:<id>` key **into** `ingestWithContext` (via `IngestMeta`), and
the pipeline stamps it — `capture_key` on every created node,
`idempotency_key` on the first — **inside `NodesRepo.create`**, in the
same insert that creates the node. The post-hoc `UPDATE` and its
swallowed-UNIQUE catch (G7) are deleted. Consequences, against ADR-020
§8.2's window:

- Death *before* the first insert: nothing landed; retry executes
  cleanly (receipt §5.4 case 1).
- Death *after* the first insert: the stamp exists from the moment the
  first node does — there is no longer an interval in which nodes exist
  unstamped. Retry finds the receipt + stamp and reconciles/returns the
  original (§5.2/§5.4) instead of ingesting a second copy.
- The pre-execution `SELECT … WHERE idempotency_key = ?` check stays as
  a fast path, now backed by the receipt as the authority.

This is the contract change to the shared pipeline ADR-020 §8.2(b) said
the honest fix required; it is designed here, in the open, as this ADR's
own increment — `/log` is never approval-stamped (its keys live in the
`tg:` namespace, §6), so the concern that kept A4 narrow does not apply.

### 6.3 Telegram `/log`: two keys, two different accidents (CAP-02 route 3)

Route 3 is two accidents sharing a symptom. (a) **The same message
processed twice** (concurrent webhook deliveries — the route processes
fire-and-forget per request, G8, so interleaving is possible): the
transport key `tg:<chatId>:<messageId>` names it exactly. Surfacing
`message_id` requires extending the `TelegramUpdate` type (G8) — an
additive change, named as delta SD-6. (b) **The user sends the text
again as a new message** after a silent failure (TG-06's recovery
reflex): no transport identity can connect the two — only content +
recency can. The design therefore also claims, atomically with the
transport receipt, a **content-window receipt**
`tgwin:<sha256(space_id | chat_id | normalized body)>` whose completed
state lives **10 minutes**: a second `/log` of the identical body from
the same chat inside the window replays the original confirmation
(§5.2) instead of capturing. Outside the window, the same words are a
fresh capture (D-CI-3). Because this is the one place the design
dedups by content, and it changes what an intentional rapid repeat does,
it is an explicit owner decision (**OD-1**) with the window length
named; the transport key ships regardless of OD-1's outcome.

### 6.4 `/note` `/done`: the draft is the identity

A note's content is final at `/done` and the draft row fully identifies
the attempt (chat, last-edit instant, part count, exact text) — the key
is derived from those four, so any post-failure edit produces a new key
and can never collide with the saved note. Claim order inverts today's
sequence safely: claim the receipt → save (node stamped at creation
under the draft key in both stamp columns — single node, so G1's UNIQUE
is a true backstop) → complete the receipt → remove the draft. A failed
save deletes its claim and leaves the draft open, preserving G9's
verified "draft is still open" behavior; a concurrent second `/done`
loses the claim race and replays the original confirmation (§5.2)
instead of saving twice.

## 7. Retention and pruning

- Completed receipts are retained **30 days** (`expires_at`), then pruned
  **lazily**: the claim path deletes an expired same-key receipt before
  inserting (key reuse after expiry is a fresh capture — the escape
  hatch that bounds dedup's memory, C5's other half), and each claim
  opportunistically prunes its own space's expired receipts. This ADR
  wires **no new sweep**; if ADR-020's wired sweep exists by
  implementation time, adding this prune to it is a separate delta, not
  assumed here.
- Why 30 days: it must outlive every realistic retry horizon — the
  offline queue persists in localStorage until a flush succeeds (days is
  plausible; months is not a retry, it's a new attempt with a persisted
  key — hmm, see OD-2), Telegram redelivery (seconds), approval retries
  (minutes). OD-2 puts the number to the owner explicitly, including the
  queued-item corner: a queue item flushed *after* its receipt expired
  would capture fresh — acceptable only if the owner agrees a >30-day
  offline queue is beyond the retry contract.
- `claimed` receipts are never age-pruned except through §5.4's
  evidence-based recovery. Receipt rows carry no content beyond
  `result_json` (bounded by the ingest result's size) — storage growth
  is one small row per capture, pruned on the same horizon.

## 8. Invariants and the complete delta list

**Design invariants.**

- **C1 — Claim before effect.** No capture path creates a node, writes a
  reward, or consumes a draft before its receipt claim succeeds.
- **C2 — Replay returns the original.** A completed key's replay returns
  the stored result verbatim (marked as a replay) with zero side
  effects. A replay is never an error and never a second execution.
- **C3 — One key, one payload.** A key reused with a different
  `request_hash` is an explicit conflict outcome; nothing is created.
- **C4 — Rewards iff completion.** Streak/fuel writes and receipt
  completion commit in one transaction on reward-paying paths; rewards
  can therefore be applied at most once per attempt, and only by the
  execution or the §5.4 recovery — never by a replay.
- **C5 — Attempts, not content.** Under a fresh key, identical content
  always captures (the `tgwin:` window of §6.3 is the sole, gated
  exception). Dedup can never become a silent "you already said that"
  filter on the brain's input.
- **C6 — Space-scoped everything.** Receipts are unique per
  `(space_id, key)`; the same key in two spaces is two attempts. The
  offline queue's per-brain keying (G4) is unchanged.
- **C7 — Stamp at creation, never after.** No capture path writes a
  stamp by post-hoc UPDATE. (The two approval tools' existing UPDATE is
  removed, SD-5.)
- **C8 — Every outcome is explicit.** Executed, replayed, in-flight,
  conflict, and reconciled are distinct, user-visible outcomes — the
  capture surface gains no new silent path (CAP-06's lesson).

**Deltas — the complete touch set.** Everything else is new code (the
receipt store + claim service).

- **SD-1** — `capture_receipts` table + claim/replay/recovery service
  (§4.1, §5).
- **SD-2** — `nodes.capture_key` column + `(space_id, capture_key)`
  index, migrateSchema-only (§9); Drizzle mirror in `db/schema.ts`.
- **SD-3** — Pipeline: `IngestMeta` carries the capture key (+ optional
  first-node `idempotencyKey`); `ingestCore` stamps at creation (§4.2).
- **SD-4** — `POST /api/ingest`: optional `idempotencyKey` body field;
  claim-first; action branch stamps its single node at creation;
  rewards + completion in one transaction (§5.5); replay/conflict/
  in-flight responses (§5.2/§5.3).
- **SD-5** — `capture_memory` + `dream_playback`: key passed into the
  pipeline; post-hoc stamp UPDATE deleted; receipt-backed replay
  (§6.2).
- **SD-6** — Telegram: `TelegramUpdate` gains `message_id` (additive);
  `/log` claims `tg:` (+ `tgwin:` per OD-1) receipts and completes
  rewards in the §5.5 transaction; `/done` claims the draft-key receipt
  (§6.4).
- **SD-7** — Web client: `ingestText` mints/carries the attempt key
  (incl. into `enqueueIngest`); queue items persist it (legacy items
  minted + re-persisted pre-POST); `flushIngestQueue` sends stored keys
  and honors `idempotentReplay` in the synced event; `IngestPanel`
  attempt-key lifecycle + in-flight guard (§6.1).
- **SD-8** — `POST /api/working` accepts an optional key + receipt;
  `MindPanel` attempt key + in-flight guard. (CAP-09's
  clear-before-confirm behavior is **not** changed by this delta — it is
  a separate finding with its own fix.)

## 9. Migration implications

Exactly two schema changes, both additive, both following repo precedent:

1. **New table `capture_receipts`** — dual-registered per the repo's
   new-table rule: defined in **both** BOOTSTRAP_SQL
   (`db/schemaSql.ts`) **and** `migrateSchema` (`db/client.ts`), with
   `UNIQUE(space_id, idempotency_key)` and an index on
   `(space_id, expires_at)` for the lazy prune. (ADR-020 §11 precedent.)
2. **New column `nodes.capture_key`** — **migrateSchema-only**,
   PRAGMA-guarded `ALTER TABLE … ADD COLUMN` (ADR-019 §8 precedent:
   columns are migration-only, never added to BOOTSTRAP_SQL), plus its
   `(space_id, capture_key)` index created in migrateSchema (an index
   on a migration column must live with the migration — the
   `nodes_idem_idx` note, G1). Fresh databases receive the column via
   migrateSchema, which runs on the fresh path too (verified in the
   ADR-019 migration rehearsal). Drizzle `db/schema.ts` mirrors both.

No existing table is altered in any other way; `nodes.idempotency_key`
and its UNIQUE index are untouched. No backfill exists to write — every
pre-existing node simply has `capture_key = NULL` (it predates attempt
tracking; nothing about it is claimed). If implementation discovers a
schema need beyond these two, work stops and returns to design (standing
rule).

## 10. Unknowns (recorded, never assumed)

1. **Live duplicate frequency** (Capture audit unknown 3): whether
   CAP-02's routes have already produced duplicates in the production
   brain. This design neither detects nor cleans pre-existing duplicates
   (§12) — a census is an implementation-phase question if the owner
   wants one.
2. **Telegram redelivery/interleaving rates** in production: the design
   is safe under any rate (UNIQUE claim), but how often §5.3's in-flight
   outcome fires is unknowable from code.
3. **Repo transaction composition**: §5.5 requires `StreakRepo` /
   `EconomyRepo` writes to join the completion transaction. Both are
   synchronous SQLite writes at the baseline and other repos already
   compose inside `handle.sqlite.transaction(...)` (ADR-019 §4), but
   these two repos' behavior inside a caller-opened transaction must be
   confirmed in implementation's first step; if either cannot join, the
   completion ordering returns to design rather than being improvised.
4. **`CLAIM_STALE_MS` value**: §5.4 needs a threshold comfortably above
   the slowest legitimate ingest (cloud extraction + embedding +
   associative linking) and comfortably below "the user gave up and
   retried in a new session." 10 minutes is proposed (the approval TTL
   is 15; a capture attempt is shorter-lived than a decision). It is a
   named constant for implementation to set within that reasoning, not
   a product decision — recorded here so the choice is visible.

## 11. Acceptance criteria

Testable, numbered. **AC-1…AC-3 are CAP-02's three routes, first by
design.**

- **AC-1 — Keyboard double-submit (route 1).** With a slow ingest stubbed,
  fire `submit()` twice (⌘+Enter path) in `IngestPanel`: exactly one
  POST leaves the client, one node set exists server-side, fuel is
  credited once. A cross-tab variant (same attempt key from two tabs)
  resolves to one execution + one replay/conflict outcome, never two
  node sets.
- **AC-2 — Offline-flush lost response (route 2).** Queue an item;
  flush against a server that commits but drops the response; flush
  again with the stored key: the second response is the **original
  result** with `idempotentReplay: true`; node count and fuel are
  unchanged by the retry; the queue drains; the synced event excludes
  the replayed ids from its "new" set. Legacy queue items (no key) are
  minted + re-persisted before their first POST and then behave
  identically.
- **AC-3 — Telegram re-send (route 3).** (a) The same `/log` update
  delivered twice (same `message_id`, incl. concurrently): one capture,
  one reward, the second delivery answered with the original
  confirmation. (b) Per OD-1: the identical body re-sent as a new
  message inside the window replays; outside the window it captures
  fresh. (c) A `/log` whose first attempt fails *before* ingest (forced
  provider error) leaves no claim: the user's re-send executes.
- **AC-4 — DP-2 crash window (approval tools).** Fault-inject process
  death (i) before the first node insert, (ii) after the first insert
  but before `run()` returns, for both `capture_memory` and
  `dream_playback`: on approval retry, (i) executes cleanly once;
  (ii) returns the original/reconciled result and creates **no** second
  node set. Assert no post-hoc stamp UPDATE remains in either tool.
- **AC-5 — Original-result fidelity.** A replayed response equals the
  original byte-for-byte in its result payload (nodes, edges,
  `fuelEarned`, streak fields) apart from the `idempotentReplay` marker;
  rewards tables show exactly one credit across original + replay.
- **AC-6 — Conflict.** Same key, different text/meta → `409`
  `idempotency_key_reused` (web) / explicit collision reply (Telegram);
  zero nodes created; the original capture is untouched.
- **AC-7 — Intentional repeat survives (C5).** The identical text
  submitted under a **new** attempt key captures fresh — nodes and
  rewards — on web and on `/log` (outside the OD-1 window). This is the
  regression guard against dedup becoming content censorship.
- **AC-8 — In-flight outcome.** A duplicate arriving while the original
  is mid-ingest receives the §5.3 in-flight outcome on each surface;
  when the original completes, a further retry returns the original
  result (AC-5), and exactly one node set exists throughout.
- **AC-9 — Restart durability.** Server restarts (i) between claim and
  ingest, (ii) between ingest and completion: on retry, (i) executes
  once; (ii) reconciles per §5.4 — rewards applied exactly once, result
  flagged `reconciled`, no second node set.
- **AC-10 — Action-kind.** Double-submit of an action capture yields
  one action node; its replay returns the original node payload.
- **AC-11 — `/note` double `/done`.** Two `/done` updates for one draft
  (sequential and concurrent variants): one note node, verbatim; the
  loser receives the original saved confirmation. A failed save leaves
  the draft open and claim-free (G9's behavior preserved), and the
  retried `/done` succeeds.
- **AC-12 — Mind thought.** Double-submit of one thought attempt yields
  one mote; its replay returns the original mote id.
- **AC-13 — Retention.** A completed receipt past `expires_at` is
  pruned on the next claim in its space, and its key then executes
  fresh; an unexpired receipt is never pruned. Claimed receipts are
  never pruned by age.
- **AC-14 — Space isolation (C6).** The same key presented in two
  spaces executes independently in each; no receipt, stamp, or replay
  crosses spaces.
- **AC-15 — Edited resubmission.** A failed submit followed by edited
  text and resubmission from the same panel never produces the C3
  conflict against the user's own earlier attempt (§6.1's rule).

Existing coverage that must stay green: the ingest route tests, the
Telegram note/bot suites (incl. the note precedence pins), the agent
phase-1 approval suite (its effectively-once tests), and the web
IngestPanel/client suites.

## 12. Explicitly out of scope

- **CAP-01 raw-source preservation** — the verbatim-recall V1 design is
  its vehicle; `capture_receipts.result_json` stores results, never
  source text, and must not be mistaken for (or grown into) the source
  store.
- **CAP-07 reward unification** — which doors *pay* is unchanged; this
  ADR only stops the paying doors from paying **twice** for one attempt.
- **TG-05/CAP-03 `/log` prefix matching** and **TG-06 silent `/log`
  failure surfacing** — separate findings; §6.3's window is computed on
  the body *as parsed by whatever the `/log` fix produces*, so the two
  designs compose in either order.
- **CAP-05 draft scoping, CAP-06's error-styling half, CAP-09's
  clear-before-confirm** — separate capture findings; SD-7/SD-8 touch
  their files only for key/guard mechanics.
- **CAP-15 distill-proposal removal on failure** — the proposal's fate
  is a Chat finding; its *capture* is deduped here via P6 inheritance.
- **Finance ingest** — not a capture path for memories; it already has
  `findDuplicate` discipline (ADR-019 §3.5) and is untouched.
- **Knowledge-doc upload and memory attachments** — not memory capture
  paths (Capture audit scope note).
- **Pre-existing duplicate cleanup** — no detection pass, merge, or
  backfill over the live graph is designed here (§10.1).
- **Semantic/similarity dedup** — explicitly rejected (C5): near-identical
  content is the brain's to reconcile through its existing merge
  machinery, never the capture door's to refuse.

## 13. Design gate — what the owner's review must confirm

Implementation is **not** authorized by this design or by gate closure;
it requires the owner's separate explicit authorization, and merge and
deployment remain separate decisions after that (standing governance).

- [ ] **Scope as written** — all capture paths (§6 table), the claim
      protocol (§5), invariants C1–C8, and §12's exclusions are the
      increment to build.
- [ ] **OD-1 — Telegram content-window dedup (§6.3).** Confirm the
      10-minute `tgwin:` window (recommended: it is the only mechanism
      that covers the user-re-send accident), set a different window,
      or ship transport-key-only knowing route 3(b) stays open.
- [ ] **OD-2 — Receipt retention (§7).** Confirm 30 days, including its
      consequence for a >30-day offline queue item (flushes as a fresh
      capture), or choose a longer horizon.
- [ ] **OD-3 — In-flight outcome (§5.3).** Confirm `409 capture_in_progress`
      (web) / "still saving" (Telegram) as the concurrent-duplicate
      outcome, rather than wait-and-return-original (rejected in design:
      it couples a second request's latency to an LLM call it doesn't
      own; the retry that follows returns the original under C2).
- [ ] **OD-4 — Mind thought capture (§6, P5).** Confirm it is in this
      increment (recommended: same defect, small surface) or explicitly
      defer P5 to a later increment.
- [ ] **OD-5 — Reconciled-partial semantics (§5.4).** Confirm that a
      crash-interrupted capture resolves as a flagged partial recovery
      (never a duplicate, never silently completed) — the
      effectively-once language of D-CI-2 made concrete.
- [ ] **The delta list SD-1…SD-8** (§8) is the complete touch set —
      including deleting the approval tools' post-hoc stamp (SD-5) and
      extending `TelegramUpdate` (SD-6).
- [ ] **Acceptance criteria AC-1…AC-15** (§11) are accepted as the
      implementation's verification contract, with AC-1…AC-3 (CAP-02's
      three routes) and AC-4 (DP-2) as the headline criteria.
- [ ] **Migration shape** (§9) — one dual-registered table + one
      migrateSchema-only column with its index; no other schema change;
      any further need returns to design.
