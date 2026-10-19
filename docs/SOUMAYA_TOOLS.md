# Soumaya's Tools — an agentic tool-router she can call on her own

Status: **BUILT (v1 complete)** · Owner: Claude · Branch: `claude/soumaya-second-brain-v1-m4z4hc`

> **Done (2026-07-10).** All six tools + the agentic router are shipped on `master`, gate-green:
> `fire_reminder` · `create_task` · `surface_orphan` · `review_nudge` · `check_in` · `web_lookup`
> (Gemini grounding, gated). The router is two-phase — every tool DETECTS deterministic candidates
> (offline-safe), and when Research Mode is on + a working `llm.route` exists, Soumaya CURATES which
> candidates to execute (she can only pick from validated candidates, never invent one). Runs on the
> 60s interval; delivery → Telegram if linked, always logged to `agent_logs`. **Needs a `fly deploy`
> to go live.**

## Why

Audit finding (2026-07-10): Soumaya's "autonomy" is a **fixed script** of internal graph-tidying
jobs. She has almost no tools that act in the real world, and she never freely *chooses* a tool —
`maintenance/agent.ts` picks one of 9 hardcoded jobs by a deterministic scorer; the LLM only
re-ranks. Concrete gaps the user chose to close (all four):

1. **Firing reminders** — `remindAt` is stored but nothing delivers at the time (only shown passively).
2. **Autonomous task creation** — she notices things but can't turn "I'll call the landlord" into an action.
3. **Proactive check-ins** — beyond the daily digest she can't reach out when something happens.
4. **Live web lookup** — `research()` is LLM-only; she can't pull real current info.

Architecture chosen: a **real tool-router** (function-calling loop) — given her state she reasons
which tool to invoke with what args. Built so the **offline/no-key path still works** (deterministic
detectors), with the LLM router layered on top when Research Mode + budget + a key are present.

## The seam (`packages/server/src/agent/tools/`)

```ts
interface Tool {
  name: string;
  description: string;                       // shown to the LLM router
  parameters: Record<string, unknown>;       // JSON-schema for function-calling
  guard?(tc): boolean;                       // budget / fuel / Research Mode / rate-limit
  detect(tc): ToolInvocation[];              // DETERMINISTIC opportunities (offline path)
  run(tc, args): Promise<ToolResult>;        // execute one invocation
}
interface ToolContext { ctx; spaceId; now; notify(text): Promise<void>; }
```

- **`registry.ts`** — the array of tools.
- **`router.ts`** — `runToolRouter(ctx, spaceId, { notify })`:
  1. offline path (always available): for each allowed tool, run `detect()` → execute each invocation
     (capped per tool), log every action to `agent_logs`.
  2. LLM path (seam, later): when `llm.route?` exists + Research Mode + budget, hand the LLM a compact
     state briefing + the tool schemas and let it choose invocations instead of running every `detect()`.
- **`notify`** — delivers to the user's real channel: Telegram (via `tgSend` to every chat linked to
  the space) today; extendable to web push. Every fire is also written to `agent_logs` so there's an
  in-app record regardless of channel.

Router runs on a **60s interval** (`index.ts`) so time-sensitive tools (reminders) fire promptly;
each tool self-gates its cadence inside `detect()`. Free + offline by default; only tools that call
the LLM/web are gated by Research Mode + USD budget (+ Fuel for expansion), same as `maintenance/agent.ts`.

## Tool 1 — Firing reminders (this slice; deterministic, free, offline)

- Additive `nodes.reminder_fired_at TEXT` column (idempotence — a reminder fires once).
- `detect`: nodes with `remind_at <= now AND reminder_fired_at IS NULL AND deleted_at IS NULL`
  (cap 5/tick) → one invocation each.
- `run`: mark `reminder_fired_at = now`, `notify("⏰ Reminder: …")`, log it.
- Never re-fires; never costs Fuel (core duty).

## Tool 2 — Autonomous task creation (next)

- `detect`: recent memories whose text contains a commitment ("I need to / I'll / have to / must / don't
  forget") and that don't already have a linked `action`. Deterministic phrase-matcher offline; LLM
  extraction when available for better recall.
- `run`: create an `action` node (the existing action-item kind) linked to the source memory, `notify`.
  Guarded against duplicates (one action per source memory). Also re-surfaces a dormant high-importance
  memory as a gentle task at most once/week.

## Tool 3 — Proactive check-ins (next; rate-limited)

- `detect`: a signal fired — a heavy emotional stretch (rolling mean emotional_weight dips), an unaddressed
  contradiction insight, or a promise that's overdue. At most **one check-in per space per day**
  (guard via `space_meta.last_checkin_date`, additive).
- `run`: compose a short message (heuristic offline; LLM voice when available) and `notify`.

## Tool 4 — Live web lookup (next; gated)

- `guard`: Research Mode ON + USD budget + a key (never offline; degrade to a note that it's unavailable).
- New provider method `webLookup?(query): Promise<{ text; sources }>` — Gemini grounding / a search API.
  `detect`: a `research` opportunity where the memory poses an external question. `run`: fetch, attach a
  cited note to the node, `notify`. Spends Fuel like other expansion jobs.

## Tool 7 — Weekly review (shipped; deterministic, free, offline)

- `detect`: rate-limited to one per rolling 7-day window (checks `agent_logs` for the last
  `tool:weekly_review`); requires ≥ 3 memories in the past week so there's something to reflect on.
- `run`: composes a short reflection — count, a gentle mood read (mean + spread of emotional weight),
  and the standout memory (highest importance). Heuristic by default; when a cloud LLM is present,
  `generateDailyLog` phrases it in Soumaya's voice (any failure → heuristic). Delivers via `notify`
  (Telegram) and, because the full digest rides in the result summary, the router's `agent_logs`
  row surfaces it in-app (Night Replay).

## Tool 8 — Chart discovery (shipped; deterministic, free, offline)

- `detect`: rate-limited to one new note per day. Scans for a genuinely notable, not-yet-
  charted structure — a dense constellation (≥ 8 members), the brightest nexus (a memory at
  degree ≥ 10), or a sector that's crossed 25/50/100 bodies — each keyed so it's recorded once.
- `run`: writes a `codex_discoveries` row (Soumaya-voiced lore, an icon, an optional focus id)
  and `notify`s. Surfaced client-side under the Codex's **"Soumaya's Field Notes"** category
  (`GET /api/codex/discoveries`), so she grows the atlas herself as the galaxy reveals itself.

## Verification

- Gate `typecheck && test && build` green at each slice.
- Slice 1 tests (`tools.test.ts`): a due reminder fires exactly once (idempotent), a future reminder
  doesn't, firing marks `reminder_fired_at` + calls `notify` + writes an `agent_logs` row, deleted
  memories never fire.
- Offline path proven (no key, no Telegram → still marks fired + logs).
- Additive migration proven (existing volume upgrades in place).


---

## Phase 2: Notification Policy (branch `phase-2-notification-policy`)

**Status: BUILT, awaiting tests.** Design signed off 2026-10-19 after 4 review rounds.

### Problem
Six tools could push to Telegram via `tc.notify()` with no shared policy: no quiet
hours, no rate coordination, no user preferences. A 3am reminder went straight
to the user's phone.

### Architecture
A **single policy boundary** wraps the router tick's notify closure (`index.ts`).
Tools pass identity + occurrence hints; the policy decides send-now / queue /
drop. Deferred messages wait in `notification_outbox`, delivered by a sweeper.

### Preferences (`space_meta`, per-space)
| Setting | Default | Set via |
|---|---|---|
| `timezone` | `America/New_York` | `/tz <IANA>` (validated, invalid rejected) |
| `quiet_start` / `quiet_end` | `21:00` / `04:30` | `/quiet <HH:MM> <HH:MM>` |
| `digest_time` | `06:00` | `/digest <HH:MM>` |
| `daily_proactive_cap` | `5` | `/cap <n>` |
`/settings` shows current values. Web UI deferred.

### Priority vs urgency
- **Urgent** (bypasses quiet hours + cap, reason logged): `fire_reminder` due
  within 60 min; `billRisk` due within 6h (first alert per bill per day only).
- **Normal**: checkins, nudges, reviews, tasks, stale reminders, ordinary bill warnings.
- **Low**: reserved.
`is_urgent` is the bypass authority, persisted per outbox row; queued bill alerts
are re-evaluated at delivery time (atomic upgrade, one winner).

### Outbox lifecycle
`queued → sending → sent | failed | dropped | ambiguous`
- `notif_key = sha256(space_id|tool|occurrence_id)` — UNIQUE dedup. Occurrence
  IDs per tool: `node:{id}:at:{remindAt}`, `action:{id}`, `day:{localDay}`,
  `week:{isoWeek}`, `bill:{id}:day:{localDay}`.
- **Atomic cap claim**: single UPDATE with cap check — one winner per slot.
  Cap derived from outbox rows (`status IN ('sending','sent')` with `cap_day`);
  no separate counter. Failed/dropped release the slot automatically.
- **Crash recovery** (lease 5 min): `send_started_at IS NULL` → definite
  non-delivery → requeue, slot released. `send_started_at` set → **ambiguous**:
  terminal, cap retained, never auto-retried (Telegram has no idempotency key;
  a retry risks a duplicate send).
- **Trade-off (documented)**: on ambiguous outcome we retain the cap slot and
  don't retry — the cap contract takes precedence over delivery completeness.

### Digest
Fires at `digest_time` in the space's timezone (not midnight UTC);
`last_digest_date` is the local date. Doesn't count toward the cap.

### Audit
Every decision → `agent_logs` (`notify:sent|queued|dropped|failed|ambiguous|deduped|retry`),
content-free. Outbox `message` holds user-facing text (operational, pruned with the row).

### Tests
`packages/server/src/agent/notify/__tests__/phase2.test.ts` — 30+ cases:
quiet-hour boundaries, cap races, urgent bypass, crash-before/after-send,
ambiguous cap retention, DST, timezone validation, per-tool staleness,
bill-upgrade atomicity, digest timing, audit hygiene.
