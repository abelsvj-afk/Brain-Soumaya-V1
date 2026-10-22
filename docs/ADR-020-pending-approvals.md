# ADR-020 — `pending_approvals`: listing pending proposals and resolving numbered answers

**Status:** DESIGN — **accepted by the owner as the first design-only increment
(A4) on 2026-10-22, conditional on the approval-machine trace.** The design
gate (§13) is **OPEN**. Implementation has **not** started and is **not
authorized** — gate closure does not authorize it; implementation requires the
owner's separate explicit authorization. Merge and deployment remain separate
owner decisions.
**Approved by:** Project owner (scope acceptance, 2026-10-22); design drafted 2026-10-22
**Date:** 2026-10-22
**Design baseline:** deploy branch HEAD `a9ed7c8feebf3f0a621d17afc16e8e6d6ae07e1f`
**Evidence base:** approval-machine verification check of 2026-10-22 against
`a9ed7c8` (`~/workspace/ui-audit/approval-machine-check-2026-10-22.md`).
**Governance caveat (owner, explicit):** the owner has not independently
verified the trace. Every load-bearing claim this design relies on was
therefore **spot-verified against the code at the baseline while drafting**
(§2 cites the code evidence for each given). No trace claim failed
verification; two were sharpened (see §2, notes V-a and V-b).
**Scope:** a listing surface for pending write approvals ("what's waiting on
me?") and a numbered-answer grammar that resolves a reply like `2` against
the exact immutable proposal the user saw at that number — with
authorization, expiration, idempotency, and restart recovery accounted for.
**Goal (owner's framing):** a numbered reply must resolve the same intended
proposal even if the pending list changes before the reply arrives.
**Non-goals:** the three reliability patterns (cancel-with-reason denials,
evidence-aware factual verification, tool-result budgeting) and `web_lookup`
are separate candidates (§12). A4 changes neither what approvals are *for*
(the four write tools) nor the approval machine's core guarantees.

**Revision history.**
- **Initial design (2026-10-22).** Drafted from the acceptance + trace above.
  All §2 givens spot-verified against `a9ed7c8` during drafting.

---

## 1. Settled for design (owner, 2026-10-22)

- **D-A4-1 — Scope.** A4 is narrowly scoped: list pending proposals and
  resolve a numbered response against the exact immutable proposal, with
  authorization, expiration, idempotency, and restart recovery accounted
  for. Nothing else is bundled in.
- **D-A4-2 — Givens vs gaps.** Trace findings become design givens only
  where the existing system already guarantees the behavior (§2). Every
  gap remains an explicit design requirement (§3–§8) — never an assumption
  that the current machine handles it.
- **D-A4-3 — The key acceptance test.** If a user replies `2`, the system
  must resolve the same intended proposal even if the pending list changes
  before that reply arrives. If the current system cannot guarantee that,
  this design must specify the missing binding mechanism. (It cannot, and
  §3 specifies it. The test is AC-1.)
- **D-A4-4 — No bundling.** The three reliability patterns remain separate
  candidates; A4 designs none of them. No implementation, merge, or
  deployment authorization accompanies this design.

## 2. Verified givens — the foundation the design stands on

Each given below was re-checked against the code at `a9ed7c8` while
drafting; the citation is the evidence. The design relies on these and
only these machine properties.

- **G1 — Frozen, hashed proposal records.** A pending approval is one
  durable `tool_approvals` row: autoincrement `id`, `space_id`,
  `principal`, `tool`, the exact `args_json` (`JSON.stringify(args)` at
  insert), and `args_hash` = sha256 of the canonical key-sorted args
  (`packages/server/src/agent/approvals.ts:100-118`; DDL
  `packages/server/src/db/schemaSql.ts:90-106`). Execution parses the
  **recorded** `args_json`, looks the tool up by the **recorded** name, and
  injects only `_approvalId` — the payload is never re-generated
  (`approvals.ts:245-271`).
- **G2 — Hash integrity at execution.** `executeApproval` recomputes the
  hash over the stored args and fails the approval terminally on mismatch
  ("args changed after approval"); schema validation and the tool's
  `guard()` are also re-run at execution (`approvals.ts:256-267`). A
  tampered or stale proposal therefore fails — it never executes wrong.
  (Precision: the hash is checked at execution, not at confirm; in the
  normal flow confirm and execute are back-to-back, so the user-visible
  outcome of tampering is a failed execution.)
- **G3 — Single-winner claims.** Confirm consumes via a guarded atomic
  `UPDATE … WHERE status='pending'` after revalidating space, principal,
  status, and expiry; the loser re-reads and is told the true state
  (`approvals.ts:129-161`). Deny (`:165-200`) and the
  confirmed→executing claim (`:230-242`) are likewise atomic. Concurrent
  answers cannot double-execute through the state machine (test-pinned:
  `agent/__tests__/phase1.test.ts` "double confirm: second is a no-op, not
  a double execution").
- **G4 — 15-minute TTL, lazy expiry on confirm.** `APPROVAL_TTL_MS =
  15 * 60 * 1000` on an absolute elapsed clock (`tc.now` is `Date.now()` at
  both entry points: `telegram/bot.ts:535`, `api/routes/chat.ts:156`).
  `confirmApproval` checks `expires_at` before its transition, flips the
  row to `expired`, and returns "approval expired" (`approvals.ts:138-141`)
  — test-pinned ("expired approval cannot be confirmed").
- **G5 — Append-only audit, args-free.** Every transition appends a
  templated row to `agent_logs`; `args_json` content never enters the audit
  log (`approvals.ts:14-17`, `:72-83`); append-only is enforced by DB
  triggers (`packages/server/src/db/client.ts:756-762`).
- **G6 — Durable across restarts.** All approval state is SQLite rows; a
  pending created before a restart is found and answered normally after it
  (`findPendingApproval` → `confirmApproval` → `executeApproval`, all
  id-keyed). Principals are `telegram:<chatId>` (`telegram/bot.ts:531`) and
  `web:<spaceId>` (`api/routes/chat.ts:152`).
- **G7 — Bounded execution, effectively-once.** `MAX_EXECUTION_ATTEMPTS =
  3`; retryable failures return the row to `confirmed`, exhaustion lands
  in terminal `failed` with `last_error` (`approvals.ts:278-324`). The
  module header's own claim is the contract: "**Effectively-once, not
  exactly-once**" (`approvals.ts:18-21`). Tool-level dedup under
  crash-retry with the same approval id is verified strong for
  `fire_reminder` (atomic `fired_by_approval` claim,
  `agent/tools/reminder.ts:99-111`) and `create_task` (node created with
  `idempotency_key = "approval:<id>"` under `UNIQUE(space_id,
  idempotency_key)`, `agent/tools/taskCreator.ts:90-121`).
- **G8 — Exactly four write tools, loop-created only.** Proposals are
  created only by the agent loop (`agent/loop.ts`), only for
  `reminderTool`, `taskCreatorTool`, `captureMemoryTool`,
  `dreamPlaybackTool` (`isWrite: true`,
  `agent/tools/registry.ts:121-138`). Within one turn the loop refuses a
  second write while one is pending (`loop.ts:371-376`). Owner-typed
  commands (`/log`) are immediate by standing owner decision and never
  enter this system.

**Sharpenings found during verification (recorded, not hidden):**

- **V-a — The prune quirk is worse than "expired rows escape."**
  `expireApproval` never sets `decided_at` (`approvals.ts:202-214`), and
  the sweep's 7-day prune keys on `decided_at <= ?`
  (`approvals.ts:367-373`) — so in any future where the sweep *is* wired,
  expired rows are exactly the rows the prune can never delete. §7 fixes
  this as a named machine delta (MD-2).
- **V-b — The "which one?" caller truly does not exist.**
  `maybeConfirmPending`'s doc comment promises ambiguity means "asking, not
  guessing" (`agent/loop.ts:158-164`), but with 2+ pendings
  `findPendingApproval` returns `undefined` and the function returns `null`
  (`loop.ts:170-175`) — the message falls through to the ordinary loop.
  A4's §5 implements the promised behavior for the first time.

## 3. The listing snapshot — the missing binding mechanism

The machine has immutable per-item identity (G1) and id-keyed resolution
(G3) but no presentation binding: today no list is ever materialized, so
nothing maps a shown ordinal to an approval id. A4 creates exactly that
artifact.

### 3.1 What a snapshot is

A **listing snapshot** is a persisted, server-created record binding
ordinals to approval ids for one `(space_id, principal)`:

- `approval_listings` — one row per snapshot: `id`, `space_id`,
  `principal`, `created_at`, `expires_at`, `superseded_by` (nullable
  listing id), `closed_at` (nullable).
- `approval_listing_items` — one row per shown item: `listing_id`,
  `ordinal` (1-based), `approval_id`; `UNIQUE(listing_id, ordinal)`,
  `UNIQUE(listing_id, approval_id)`. Items reference the approval id only —
  **no args are copied**; rendering re-reads `tool_approvals` at list time,
  keeping user text in exactly one table (§11).

### 3.2 Who creates it — system-generated, never model-composed

Snapshots are created **only** by a deterministic listing service (new
server code), invoked from exactly the entry points in §4. The agent model
may *request* a listing (by calling the `pending_approvals` read tool) and
may *quote* the rendered listing text verbatim, but it never composes,
renumbers, filters, or summarizes the mapping. The ordinal→id binding
exists in the database before any text is rendered from it (invariant
R3). This is the property the owner's key test depends on: the binding is
a fact of record, not a property of a generated paragraph.

### 3.3 Contents and ordering

A snapshot contains every approval that, at creation time, is
`status='pending'` **and** `expires_at > now` for that
`(space_id, principal)` — past-TTL rows are excluded at read time
(expire-on-read is rejected for the listing path: a read must not write;
lazy expiry remains the answer path's job, §5/§7).

Ordering is pinned: **`ORDER BY created_at ASC, id ASC`** — oldest first.
Rationale: (a) oldest proposals expire soonest, so the most urgent decision
is #1; (b) the `id` tiebreaker makes the order total and stable even where
`created_at` ties — a real hazard, since the bootstrap schema defaults
`created_at` to millisecond `strftime` (`db/schemaSql.ts:98`) while the
migration-era CREATE uses second-precision `CURRENT_TIMESTAMP`
(`db/client.ts:723`), so identical `created_at` strings across rows are
possible. `id` is autoincrement-monotonic, so `created_at, id` orders
exactly as proposals were inserted (invariant R2's ordering half;
acceptance AC-2).

### 3.4 Per-item rendering and the args-disclosure policy

The row stores no human-readable summary (trace Axis 1 gap — verified:
`tool_approvals` has no summary column), so each item is rendered from
`tool` + `args_json` by a **per-tool server-side renderer** — one template
per write tool, owned by the listing service, never by the model:

| Tool | Item line shows |
|---|---|
| `fire_reminder` | "Reminder: <label> — <when, rendered in the space's timezone>" |
| `create_task` | "Task: <title>" |
| `capture_memory` | "Save memory: <the proposed text, truncated per policy>" |
| `dream_playback` | "Play back <dream/chapter identifier> (records your stated correction)" |

Disclosure policy (binding on every renderer):

1. **Audience containment.** A listing renders only into the owning
   principal's own channel/conversation. The args may contain the user's
   own text; a listing shows the user their own proposed content — the
   same content the proposal prose already showed them in that
   conversation. Nothing renders cross-principal or cross-space (§6).
2. **Core, not transcript.** Show the human-meaningful core the proposal
   itself would have quoted. Free-text fields are truncated at **140
   characters** with an ellipsis; the list is an index, not a transcript.
3. **Never shown:** raw `args_json`, `args_hash`, `_approvalId`, any other
   space's or principal's data, internal keys or ids beyond the ordinal.
   (The approval id itself is *not* displayed; the ordinal is the user's
   handle. The existing fallback sentence that exposes "approval #N"
   (`loop.ts:448-456`) is superseded by the listing flow where a listing
   exists.)
4. **Fail-closed on unknown tools.** A pending whose tool has no renderer
   renders as "An action awaiting your decision (details withheld)" — it
   stays listed and resolvable by number, but no args-derived text is
   shown. A missing renderer can never become a raw-args leak.
5. **Time rendering** follows the standing NO-UTC rule: times in the
   space's configured timezone (the space-timezone accessors from the
   shipped PR #88 machinery), never device-local, never UTC-labeled.

Each item line also carries its decision deadline in user terms ("expires
in ~9 min" at render time, computed from `expires_at`), so the TTL is
visible before it bites (§7).

### 3.5 Snapshot lifetime and supersession

- **Expiry.** A snapshot expires at the **earliest `expires_at` among its
  items**, or 15 minutes after creation, whichever comes first. After
  that moment its contents are stale by construction (an item it binds
  may have lapsed), so it stops being resolvable (§5, outcome O8).
- **Supersession.** Creating a new snapshot for the same
  `(space_id, principal)` immediately supersedes the previous one
  (`superseded_by` set, `closed_at` set). Only the newest snapshot is
  ever addressable by numbered answers — a superseded snapshot can never
  be answered, so renumbering can never silently retarget a reply: the
  new listing's rendering in the user's own channel *is* the notice that
  numbering changed (§5, outcome O7).
- **Resolution does not supersede.** Answering an item leaves the snapshot
  live for its remaining items — the remaining ordinals keep their
  bindings (this is what makes sequential numbered answers work).
- **Closure.** A snapshot closes when it expires, is superseded, or all
  its items have reached terminal states. Closed snapshots are retained
  for the outcome paths of §5 (an answer against a just-closed snapshot
  can still be *explained*) and pruned by the sweep on the terminal
  window (§7).

## 4. Entry points

All entry points funnel into the one listing service (§3.2); there is no
second rendering or binding path.

1. **`pending_approvals` agent tool (both surfaces).** A read tool
   (`isWrite: false` — listing proposes nothing and executes nothing) the
   model calls when the user asks what's waiting. The tool creates the
   snapshot and returns the **canonical listing text**; the model's reply
   relays that text verbatim (tool contract + prompt instruction; the
   binding never depends on the relay's fidelity — a garbled relay can be
   re-listed, producing a superseding snapshot, but can never retarget a
   binding that was already rendered from the database).
2. **`/approvals` Telegram command (deterministic, no model).** Renders the
   same snapshot directly, mirroring the `/log` precedent that safety-
   relevant owner commands act immediately and exactly. This is the
   reference rendering: what `/approvals` shows is definitionally what the
   numbers mean in this channel.
3. **The ambiguity path (§5.3).** When a bare yes/no arrives with 2+
   pendings, the system's "which one?" response is itself a listing —
   same service, same snapshot creation.
4. **Web surface.** The conversational tool path (1) only. The web API
   already returns `pendingApprovalId` per response
   (`api/routes/chat.ts:174`) and no client consumes it (verified:
   whole-tree search finds no `packages/web` reference) — a web inbox/list
   UI is a separate future surface decision, out of scope (§12).

If nothing is pending, every entry point returns the same defined empty
result — "Nothing is waiting on you right now." — and creates no snapshot.

## 5. Resolution semantics

### 5.1 Answer grammar

Numbered answers are recognized **only** while a live (newest, unexpired)
snapshot exists for the answering `(space_id, principal)`:

- `<n>` · `yes <n>` · `approve <n>` · `confirm <n>` → **approve** item `n`.
- `no <n>` · `deny <n>` · `skip <n>` → **deny** item `n`.

where `<n>` is a 1–2 digit ordinal present in the snapshot. The listing's
own framing states this grammar before the user acts ("Reply with a number
to approve it, or 'no' + number to skip it"), so a bare number is
unambiguous *in context*: the listing defines what a number means, the
same way the existing prose question defines what "yes" means today. The
bare-number-equals-approve choice is named for explicit confirmation at
the gate (§13, item 3).

Interception order is preserved: on Telegram, approval-answer recognition
(numbered and bare) runs where `maybeConfirmPending` runs today — before
note-append interception (`telegram/bot.ts:538-545`) — so an answer can
never land inside an open-ended note. On web, the same position in
`api/routes/chat.ts` (before the agent loop).

Outside a live snapshot, a bare number is an ordinary message — today's
behavior, unchanged (outcome O9). A4 adds no ambient number-guessing.

### 5.2 Resolution procedure — bind by snapshot, decide by the machine

A numbered answer resolves in exactly these steps:

1. Load the principal's newest snapshot; if none is live → not an approval
   answer (fall through per §5.1/O9).
2. Look up the ordinal **in the snapshot** → `approval_id`. The ordinal is
   **never** re-derived from the current pending set. New pendings that
   arrived after the snapshot are not in it and renumber nothing; items
   decided since the snapshot keep their bindings.
3. Call the existing `confirmApproval` / `denyApproval` with that id. The
   machine revalidates space, principal, status, and expiry (G3/G4) and
   the single-winner claim decides races — A4 adds **no** execution path.
4. Map the machine's true result to the outcome matrix (§5.4) and answer
   with the item named, so multi-item sessions stay legible.

### 5.3 Coexistence with the bare yes/no flow

Precedence, evaluated per message:

1. **Numbered grammar** (§5.1) if it matches and a live snapshot exists.
2. **Bare yes/no, exactly one pending** → today's `maybeConfirmPending`
   path, unchanged (G3/G4).
3. **Bare yes/no, 2+ pendings** → the promised "which one?" behavior
   (V-b): respond with a listing (creating a snapshot) and consume the
   message. No execution, no fall-through.
4. **Bare yes/no, zero pendings, stray-answer window** → outcome O5
   (§5.4): if the principal's most recent approval reached a terminal
   state within the later of (snapshot lifetime, 15 minutes) **and** no
   newer pending has appeared, the answer is an explicit "already done /
   already decided" naming that item, and the message is consumed.
   Otherwise the message is ordinary chat, untouched — conversational
   "yes" outside an approval context keeps today's behavior exactly.
5. Anything else → ordinary message (unchanged).

Rule 4 is deliberately narrow: it exists to kill the one verified hazard
(a second "yes" silently binding to a newer pending or vanishing into
chat, trace Axis 4) without annexing ordinary conversation.

### 5.4 Outcome matrix — silent fall-through is designed out

Every approval-shaped answer produces exactly one explicit, user-visible
result (invariant R1). Canonical copy shapes below; final wording is
implementation copy review, the *semantics* are the contract.

| # | Situation at answer time | System result |
|---|---|---|
| O1 | Item pending & unexpired; approve wins the claim; execution succeeds | The execution's own result message (existing behavior), prefixed with the item identity: "#2 — <item line>: <result>". |
| O2 | Approve wins; execution fails retryably or terminally | Existing curated failure copy, item named ("#2 — <item>: I tried, but it didn't go through…"). Retry/exhaustion semantics unchanged (G7). Raw exception text is never shown (the E1 precedent stands). |
| O3 | Deny wins | "Skipped #2 — <item line>. I won't do that." Deny's existing side effects (incl. correction capture) unchanged. |
| O4 | Item already **executed** (double answer, or decided via the bare flow since the listing) | "Already done — #2 (<item line>) was completed at <space-local time>. It wasn't run again." No re-execution. Message consumed. |
| O5 | Bare yes/no with zero pendings inside the stray-answer window (§5.3 rule 4) | Same already-done / already-decided family, naming the most recent item and its true state. |
| O6 | Item already **denied / failed / expired** by an earlier decision | The true state, named: "already skipped", "it failed earlier", "it expired" — with O7's expiry copy where expiry is the state. No re-execution, no silent nothing. |
| O7 | Item past TTL at answer time (incl. expired-but-unswept) | The answer path lazily expires the row (G4 machinery; for deny, via the unified rule of §7) and replies: "That one expired — proposals only wait 15 minutes. Ask me again and I'll re-propose it if it still matters." |
| O8 | Number exceeds the live snapshot's items, or the snapshot expired/was superseded before the answer | "That list has changed — here's what's waiting now:" + a fresh listing (new snapshot). Never a guess at the old binding. |
| O9 | Number with no live snapshot at all | Not an approval answer — ordinary message handling, exactly as today. |

## 6. Authorization — principal containment end to end

- Snapshot rows carry `(space_id, principal)`; creation queries pendings
  scoped to both; a listing renders **only** into its principal's own
  channel/conversation; resolution re-checks principal equality at
  snapshot lookup **and** the underlying confirm/deny revalidates space +
  principal again (G3) — defense in depth, with the machine's verified
  checks as the second wall.
- A principal can never see, count, or act on another principal's
  pendings through A4 — including the empty-result wording, which is
  identical whether the *space* has other principals' pendings or none
  (no existence leak through the listing surface).

**DP-1 — Cross-channel decision point (owner, at the gate).** Principals
are channel-bound: `telegram:<chatId>` and `web:<spaceId>` are different
principal strings for the same human and space, and `confirmApproval`
rejects a principal mismatch (G3). Whether the same owner may list/act on
*web-created* pendings from Telegram (or vice versa) is therefore a real
decision, not a default the code smuggles in. **Design recommendation:
denied in A4** — A4 ships channel-bound, matching the machine's existing
authorization unit. Cross-channel acting would require a new
principal-equivalence rule (an identity claim no current record makes on
the approval path) and belongs to its own design if ever wanted. The gate
(§13) asks the owner to confirm the denied default or decide otherwise
knowingly.

## 7. Expiration coherence, the sweep decision, and the orphan rule

### 7.1 One expiry rule for both answers

Today `confirmApproval` enforces the TTL and `denyApproval` does not
(verified by direct read: no `expires_at` check exists in
`denyApproval`) — a late "no" denies a proposal that a late "yes" would
have expired. **A4 rule: an answer of either kind against a past-TTL
pending yields the EXPIRED outcome (O7).** Implementation requirement
(machine delta MD-1): the deny path performs the same expiry pre-check as
confirm (past-TTL → `expireApproval` + expired outcome), so the two
answers can never disagree about whether a proposal was still alive.

### 7.2 The sweep decision — A4 wires `sweepApprovals`

`sweepApprovals` exists, is unit-tested, and has **zero production
callers** (verified: whole-tree search finds only its definition, one
header comment, and the phase-1 test; `packages/server/src/index.ts`
intervals cover actions, notifications, push, and the tool router — never
approvals). A4 makes stale state user-visible (listings, already-decided
outcomes, the §7.3 notice), so A4 **wires it** rather than scoping it out:

- **When:** once at startup (after DB open, before serving) and on a
  periodic interval in the same family as the existing `index.ts` sweeps.
  Design constraint, not a constant: the cadence must be well under the
  15-minute TTL so proactive expiry is meaningful; it must never run
  inside a request path.
- **Context:** the sweep is maintenance, operating per-row across spaces;
  every action it takes already writes the row's own audit entries (G5).
- **Prune fix (machine delta MD-2):** `expireApproval` sets `decided_at`
  when it transitions a row. This makes the existing 7-day terminal prune
  (`approvals.ts:367-373`) actually cover expired rows (V-a) and keeps
  `decided_at` meaning "when this row last left `pending` by a decision or
  expiry" in every path.
- **Named assumption, left as-is:** stale-`executing` detection keys on
  `decided_at` (set at confirm, not refreshed at the executing claim), so
  the 5-minute staleness clock starts at confirm. In every current flow
  confirm→execute is immediate, so this is the conservative direction;
  A4's wiring does not change it.

### 7.3 Confirmed orphans — expire and surface, never silently re-drive

A row in `confirmed` whose process died before `executeApproval` claimed
it is orphaned today: the sweep rescues only `executing` rows, and no
user path can reach a non-`pending` row (trace Axis 5 — verified against
`sweepApprovals` and `findPendingApproval`).

**Rule:** the wired sweep detects `confirmed` rows older than the
stale-executing threshold (5 min) that were never claimed
(`execution_attempts = 0` and no `executing` transition) and transitions
them `confirmed → expired`, with a distinct audit action
(`approval:orphaned-expired`). The principal's **next listing** then
carries a one-line notice — "One earlier approval didn't complete and has
expired: <item line>." — after which the user can simply re-ask, and the
action re-proposes fresh.

Safety argument: consent in this system is freshness-bounded everywhere
(15-minute pending TTL). A confirmed orphan is consent whose execution
context died minutes-to-days ago; the world (guards, preconditions, the
user's intent) may have moved. Blindly executing stale consent is the
unsafe option; silently dropping it repeats the silent-failure pattern A4
exists to remove. Expiring with a visible notice is the only option
consistent with both the freshness principle and invariant R1. This adds
one sweep-only state transition (`confirmed → expired`); it is a named
machine delta (MD-3) for gate confirmation, and sweep ordering is
specified: expire stale pendings → rescue stale `executing` → expire
confirmed orphans → prune.

**Operational note (not a design blocker):** whether the live database
already holds orphaned or stuck rows is unknowable from code (trace
unknown). Implementation phase begins with a read-only status census of
`tool_approvals` before the sweep is first wired, so any pre-existing
orphans expire visibly rather than surprisingly.

## 8. Idempotency and restart recovery

### 8.1 Idempotency — inherited claims, honest language

Numbered resolution flows entirely through the existing single-winner
claims (G3): two answers to the same ordinal, in any mix of numbered and
bare forms, execute **once**; the loser receives the item's true state via
the outcome matrix (O4/O6) instead of today's silence. A4's acceptance
language promises **effectively-once, never exactly-once** (G7) — the
design does not upgrade the machine's claim, and no A4 copy may imply
otherwise.

### 8.2 The stamp-after-ingest crash window — named, bounded, deferred (DP-2)

Verified mechanism: `capture_memory` checks for a node already stamped
`approval:<id>`, ingests, and only **then** stamps the first created node
(`agent/tools/captureMemory.ts:59-105`); `dream_playback`'s correction path
shares the shape (`agent/tools/dreamPlayback.ts:137`). If the process dies
between ingest and stamp, a crash-retry finds no stamp and ingests again.
Multi-node captures stamp only the first node, so the window is wider
than one node. `fire_reminder` and `create_task` do not have this window
(G7).

**Disposition: explicit deferral, flagged for the owner's gate (DP-2).**
Rationale: (a) A4 does not widen the window — numbered resolution reuses
the identical execution path; (b) the honest fix is a contract change to
the shared ingest pipeline (the idempotency key would have to be carried
*into* node creation so ingest itself is atomic with the stamp) — a path
also used by `/log`, which must never be approval-stamped; that is a
design problem of its own, not a rider on a listing feature; (c) the
blast radius is bounded and recoverable: death inside a seconds-wide
window during an approved capture can duplicate a *memory*, which the
existing dedup/merge machinery can reconcile — it can never cause a wrong
action, a wrong reminder, or a double task. The gate asks the owner to
accept the deferral (recommended) or pull the ingest-key fix into A4's
implementation scope knowingly (§13, item 5).

### 8.3 Snapshot durability across restart — persisted

Snapshots are **persisted** (the §3.1 tables), not held in memory.
Deciding factor: approvals themselves are durable (G6) and the product's
failure philosophy is "no silent wrongness." An in-memory snapshot would
make every Fly restart silently invalidate numbering the user may be
looking at in their chat history; the only honest in-memory variant is
declared-loss ("that listing is gone"), an explicit outcome — acceptable,
but strictly worse than surviving, at the price of two additive tables.
With persistence, a restart mid-snapshot is a non-event: the binding is
intact, items are revalidated at answer time as always, and if an item
expired during the downtime the answer is O7, not a wrong execution
(AC-6). Snapshot rows are pruned by the wired sweep (§7.2): closed
snapshots older than the same 7-day terminal window as approvals,
keyed on `closed_at`.

## 9. Invariants and the complete machine-delta list

**Design invariants.**

- **R1 — No silent outcomes.** Every approval-shaped answer produces
  exactly one explicit, user-visible result (§5.4). The fall-through
  class (trace Axes 4 and 6) is designed out, not patched case-by-case.
- **R2 — Snapshot-immutable binding.** Within a snapshot, an ordinal's
  `approval_id` never changes, and the listing order (`created_at, id`)
  is total and reproducible. Resolution never re-derives an ordinal from
  the live pending set.
- **R3 — System-generated ordinals.** Only the listing service creates
  snapshots and bindings. Model output can request and relay a listing;
  it cannot create, alter, or renumber one.
- **R4 — Principal containment.** Creation, visibility, and resolution of
  a snapshot are all bound to the same `(space_id, principal)`, and every
  layer revalidates (§6).
- **R5 — One expiry rule.** Confirm and deny treat a past-TTL proposal
  identically: expired (§7.1).
- **R6 — No new execution path.** Every effect flows through the existing
  `confirmApproval` / `denyApproval` / `executeApproval`. A4's novelty is
  presentation, binding, and answering — never a second way to make the
  world change.

**Machine deltas — the complete list of changes to existing machine
behavior.** Everything else in A4 is new code (listing service, snapshot
tables, grammar, tool/command surfaces). The gate reviews this list as
the whole machine-touch surface:

- **MD-1** — `denyApproval` gains confirm's expiry pre-check (§7.1).
- **MD-2** — `expireApproval` sets `decided_at` on transition (§7.2).
- **MD-3** — `sweepApprovals` gains the confirmed-orphan pass
  (`confirmed → expired`, audited, §7.3).
- **MD-4** — `sweepApprovals` is wired: startup + periodic interval in
  `index.ts` (§7.2).
- **MD-5** — `maybeConfirmPending` gains the §5.3 precedence: numbered
  grammar first, the 2+ "which one?" listing, and the narrow stray-answer
  outcome. Its exactly-one-pending behavior is unchanged.

Nothing in MD-1…MD-5 alters the frozen-payload guarantee, the
single-winner claims, the 15-minute TTL value, or the audit contract.

## 10. Acceptance criteria

Testable, numbered. **AC-1 is the owner's key test, first by design.**

- **AC-1 — The list-changed `2` test.** Pendings A, B, C are listed as
  1, 2, 3. Before the user answers, a new pending D arrives **and** A is
  decided through the bare flow. The user replies `2`. The system resolves
  **B** — the snapshot's #2 — and only B, reporting B's outcome. D's
  arrival renumbered nothing; A's decision shifted nothing.
- **AC-2 — Ordinal stability under identical timestamps.** Two pendings
  with equal `created_at` strings list in `id` order; repeated listings
  of the same underlying set produce the same ordinal→id mapping.
- **AC-3 — Outcome matrix coverage.** One test per §5.4 cell: O1 executed
  (item named); O2 execution failure (curated copy, no raw error text);
  O3 denied; O4 already-executed re-answer (assert the side effect
  happened exactly once); O6 already-denied re-answer; O7 expired (via
  AC-4); O8 out-of-range number against a superseded/short list (fresh
  listing returned, no execution); O9 number with no snapshot (ordinary
  message handling, no approval effect).
- **AC-4 — Expiry coherence.** A past-TTL item answered `no 1` yields the
  EXPIRED outcome, not a denial; a past-TTL item answered `1` likewise.
  Past-TTL items never appear as live in any listing. A late bare "no"
  and a late bare "yes" against the same-aged pending produce the same
  expiry outcome family.
- **AC-5 — Cross-channel denial (DP-1 default).** A snapshot created
  under `telegram:<chatId>` cannot be resolved by messages under
  `web:<spaceId>`, and vice versa; each channel's listing shows only its
  own principal's pendings; the empty result is identical regardless of
  the other principal's pendings.
- **AC-6 — Restart mid-snapshot.** The server restarts between listing
  and answer. The numbered answer still resolves the same item from the
  persisted snapshot; if the item's TTL lapsed during the downtime, the
  outcome is O7 (expired), never a wrong execution.
- **AC-7 — Stray-yes discipline.** After an approval executes, a second
  bare "yes" inside the stray-answer window returns the explicit
  already-done outcome and does **not** bind to a newer pending created
  in between (the sequence is constructed exactly so). A bare "yes" with
  no approval context in its history remains ordinary chat (regression
  guard on today's behavior).
- **AC-8 — Snapshot hygiene.** Creating a second listing supersedes the
  first (numbered answers bind only to the newest); the ambiguity path
  (bare yes/no with 2+ pendings) returns a listing and executes nothing;
  the empty state returns the defined "nothing waiting" result and
  creates no snapshot.
- **AC-9 — Disclosure policy.** Listing output contains no raw
  `args_json`, no hash, no `_approvalId`, no cross-principal data;
  free-text fields are truncated at the policy bound; an item whose tool
  lacks a renderer shows the fail-closed generic line and remains
  resolvable; all rendered times are space-local, none UTC-labeled.
- **AC-10 — Sweep wiring.** With no user message at all: a stale pending
  is expired by the wired sweep (startup and interval paths both
  covered); a stale `executing` row is retried under the same approval
  id; a `confirmed` orphan past the threshold is expired with the
  `approval:orphaned-expired` audit action and appears as the notice line
  in that principal's next listing; a terminal row older than 7 days —
  including an **expired** row — is pruned (MD-2 regression).
- **AC-11 — Effectively-once under mixed answers.** Concurrent numbered
  and bare answers to the same item execute it once; the loser receives
  the true-state outcome (O4/O6 family), never an error leak and never a
  second execution.

## 11. Migration implications

Additive only, following the repo's dual-registration rule for **new
tables**: `approval_listings` and `approval_listing_items` are defined in
**both** `BOOTSTRAP_SQL` (`db/schemaSql.ts`) and `migrateSchema`
(`db/client.ts`). No `ALTER` to `tool_approvals` or any existing table;
no existing column is referenced by bootstrap SQL before its migration
(the v252 crash precedent does not arise — these are whole new tables).
Indexes: `(space_id, principal, created_at)` on listings and the two
`UNIQUE` constraints of §3.1 on items. Snapshot tables store no args —
items reference `approval_id` only (§3.1) — so the migration introduces no
new home for user text. Drizzle shape in `db/schema.ts` mirrors the DDL,
per repo convention. If implementation discovers a schema need beyond
these two tables, work stops and returns to design (standing rule).

## 12. Explicitly out of scope

- **The three reliability patterns** — cancel-with-reason denials,
  evidence-aware factual verification, tool-result budgeting. Separate
  candidates in the owner's stated order; A4 designs none of them and
  must not be bundled with any of them.
- **`web_lookup`** — a later candidate in the same program; not designed
  here.
- **What approvals are for** — the four write tools (G8), the loop's
  proposal behavior, and owner-typed immediate commands are unchanged.
- **The machine's core guarantees** — frozen payload + hash, single-winner
  claims, the 15-minute TTL value, the audit contract. A4's machine
  contact is exactly MD-1…MD-5 (§9).
- **A web inbox/list UI** — web gets the conversational listing (§4, item 4);
  the unconsumed `pendingApprovalId` field and any panel surface are a
  separate future decision.
- **Telegram inline buttons/keyboards** — no such flow exists in the tree
  today; A4's grammar is text. Buttons are a future surface decision, not
  a rider.
- **Cross-channel listing/acting** — denied by default in A4 (DP-1, §6).

## 13. Design gate — what the owner's review must confirm

Implementation is **not** authorized by this design or by gate closure; it
requires the owner's separate explicit authorization, and merge and
deployment remain separate decisions after that (standing governance).

- [ ] **Scope as written** — §1 decisions, §3–§8 semantics, and §12's
      exclusions are the increment to build; no reliability pattern and
      no `web_lookup` is bundled in.
- [ ] **The snapshot contract** — persisted snapshot (§3, §8.3),
      `created_at, id` oldest-first ordering, earliest-item expiry,
      supersede-on-new-listing, and the §3.4 disclosure policy (140-char
      bound, fail-closed unknown-tool line, no-ids/no-hash display).
- [ ] **The answer grammar** — numbered forms of §5.1, in particular
      **bare number = approve** as framed by the listing's own
      instructions, and the §5.3 precedence including the narrow
      stray-answer window.
- [ ] **DP-1 — cross-channel default: denied** (§6). Confirm channel-bound
      A4, or decide cross-channel knowingly as a different design.
- [ ] **DP-2 — stamp-window disposition** (§8.2). Confirm the explicit
      deferral (recommended), or pull the ingest-key fix into A4's
      implementation scope knowingly.
- [ ] **The machine deltas MD-1…MD-5** (§9) are the complete machine-touch
      set — including wiring the sweep (§7.2) and the
      expire-and-surface orphan rule (§7.3).
- [ ] **Acceptance criteria AC-1…AC-11** (§10) are accepted as the
      implementation's verification contract, with AC-1 (the list-changed
      `2` test) as the headline criterion.
- [ ] **Migration shape** (§11) — two additive tables, dual-registered,
      no alteration of existing tables; any further schema need returns
      to design before implementation proceeds.
