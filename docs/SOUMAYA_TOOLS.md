# Soumaya's Tools — an agentic tool-router she can call on her own

Status: **BUILT (v1 complete) + Phase 1 agent loop (in progress)** · Owner: Claude · Branch: `phase-1-agent-loop`

> **Done (2026-07-10).** The original six tools + the agentic router shipped: `fire_reminder` ·
> `create_task` · `surface_orphan` · `review_nudge` · `check_in` · `web_lookup` (Gemini grounding,
> gated). The registry has since grown to 12 tools (see below). The router is two-phase — every
> tool DETECTS deterministic candidates (offline-safe), and when Research Mode is on + a working
> `llm.route` exists, Soumaya CURATES which candidates to execute. Runs on the 60s interval;
> delivery → Telegram if linked, always logged to `agent_logs`.
>
> **Phase 1 agent loop (2026-10-19, branch `phase-1-agent-loop`, NOT merged).** A conversational
> function-calling loop (`agent/loop.ts`) lets Soumaya call tools mid-conversation via the new
> `LlmProvider.callWithTools()`. The registry owns all tool definitions; providers translate them
> (never define them). Five tools exposed: `memory_search` (new), `web_lookup`, `check_in` (reads,
> auto) + `fire_reminder`, `create_task` (writes, require explicit user approval). Approvals use a
> crash-safe lifecycle (`tool_approvals`: pending→confirmed→executing→executed/failed, approval-id
> idempotency keys, effectively-once). `agent_logs` is append-only (BEFORE UPDATE/DELETE triggers).
> See "Phase 1 agent loop" section below.

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

## Phase 1 agent loop (2026-10-19 — branch `phase-1-agent-loop`, NOT merged/deployed)

A second way for Soumaya to use tools, alongside the deterministic router:

| | Deterministic router (existing) | Agent loop (Phase 1) |
|---|---|---|
| Trigger | 60s tick, `detect()` finds opportunities | User message in chat / Telegram |
| Choice | LLM curates from deterministic candidates | LLM proposes tool calls from schemas |
| Tools | All 12 in registry | 5: `memory_search`, `web_lookup`, `check_in`, `fire_reminder`, `create_task` |
| Writes | N/A (router tools are self-contained) | Require explicit user approval |

**Key files:**
- `agent/loop.ts` — the loop (6 iterations, 4 calls/response, 12 executions/turn, strict in-order batches)
- `agent/approvals.ts` — approval state machine + crash recovery + 7-day pruning
- `agent/tools/validation.ts` — ajv (draft 2020-12) arg validation, single trusted point
- `agent/tools/memorySearch.ts` — new read-only tool (space-isolated hybrid retrieval)
- `llm/adapter.ts` — `callWithTools()` on `LlmProvider`; implemented by Gemini, OpenAI, heuristic (offline → text only), forwarded by resilient wrapper
- `api/routes/chat.ts` — `POST /api/chat/agent` (existing `POST /` untouched)
- `telegram/bot.ts` — free-text path uses the loop, falls back to `chat()` on error

**Safety invariants (acceptance-tested in `agent/__tests__/phase1.test.ts`):**
1. Registry owns tool definitions, schemas, validation, authorization, execution. Adapters translate only.
2. Write tools never execute without an explicit user confirmation bound to the exact args (sha256).
3. Approval id = idempotency key; `UNIQUE(space_id, idempotency_key)` on nodes + atomic `fired_by_approval` UPDATE give effectively-once execution across crash-retries.
4. `agent_logs` is append-only (triggers); `tool_approvals.args_json` (operational, may contain user text) is pruned after 7 days and never copied to the log.
5. `memorySearch` takes spaceId from the server context only — cross-space retrieval is impossible by construction.

**Not in Phase 1:** OAuth integrations (Gmail/Calendar/Drive), destructive tools, PWA, native wrapper. Merge and deploy both require separate approval after passing tests + security review.
