# Agent-Building SDK Research — Tool-Calling Patterns & Tool Ideas for Soumaya

**Date:** 2026-10-22 · **Scope:** research only. This document is evidence for design decisions. **Nothing in it is implementation authorization** — no tool, pattern, or SDK named here is approved to build, install, or adopt. Next steps at the end are candidate bounded steps for the owner to accept or reject individually.

**Marking convention (applied throughout):**
- **[FACT]** — the SDK actually supports this; a source is cited.
- **[RECOMMENDATION]** — my architectural proposal built on top of facts; no SDK ships it as described.
- **[UNVERIFIED]** — I could not confirm this from the sources I could reach; treat as unknown.

**A note on the name the owner gave:** he said "strandsagent.com." The project's actual site is **strandsagents.com** (plural) — that's what this report covers. I did not fetch strandsagent.com and cannot verify what, if anything, lives there. **[UNVERIFIED: strandsagent.com itself]**

---

## 1. Primary subject: Strands Agents SDK (AWS)

### 1.1 What it is — facts

- **[FACT]** Strands Agents is an open-source SDK from AWS for building agents "model-driven" style: you supply a model, a system prompt, and tools; the model itself plans, picks tools, and decides when it's done — no hand-written workflow graph. The agent loop feeds the model the full conversation history (including every prior tool call and result) on each iteration until the model produces a final answer. Source: AWS ML blog, "Building web search-enabled agents with Strands and Exa" — https://aws.amazon.com/blogs/machine-learning/building-web-search-enabled-agents-with-strands-and-exa/
- **[FACT]** Licensed **Apache-2.0**. Sources: EveryDev profile and Geekflare comparison — https://www.everydev.ai/tools/strands-agents · https://geekflare.com/open-source/ai-agent-frameworks/
- **[FACT]** Two languages: **Python and TypeScript**, with a published feature-parity table. The TypeScript SDK (`@strands-agents/sdk`) hit **1.0** (blog dated 2026-04-30). The official parity table shows TS at parity for the agent loop, streaming, structured output, MCP, sliding-window + summarizing conversation managers, lifecycle hooks, multi-agent (swarm / graph / workflow / agents-as-tools / A2A), session managers, OpenTelemetry, and steering; TS lacks Ollama/LiteLLM providers and bidirectional voice. Source: official quickstart feature table — https://strandsagents.com/docs/user-guide/quickstart/overview/ · TS 1.0 announcement — https://strandsagents.com/blog/strands-agents-typescript-v1/
- **[FACT]** The project has restructured into a "harness" monorepo (`strands-agents/harness-sdk` on GitHub): a batteries-included `createHarness()` / `create_harness()` agent with benchmarked defaults for prompt, tools, memory, sessions, and context management, layered over the lower-level SDKs (`strands-ts`, `strands-py`), plus a CLI, an evals package, a sandbox ("Box"), and a virtual shell. Source: https://github.com/strands-agents/harness-sdk
- **[FACT]** Maturity/activity: repo created May 2025; ~8.9k GitHub stars and a fast release cadence (v1.61.1, Oct 15 2026, per Geekflare; EveryDev recorded v1.41.0 in May 2026 and 845 forks). Young but AWS-backed and shipping constantly. Sources as above.

### 1.2 Loop, tools, and control surfaces — facts

- **[FACT]** **Tool definition.** Python: decorate a function with `@tool`; the schema comes from type hints + docstring. TypeScript: `tool({ name, description, inputSchema: z.object(...), callback })` with Zod schemas and fully typed inputs. Sources: strandsagents.com homepage and tools docs — https://strandsagents.com/ · https://strandsagents.com/docs/user-guide/sdk/tools/
- **[FACT]** **Tool sources are three:** hand-written tools; "vended" tools shipped in the SDK (TypeScript: file editor, HTTP request, notebook, shell/bash — the official table lists **4 built-in for TS vs 30+ via the community package for Python**); and any **MCP server**, attached by passing an `McpClient` (stdio / streamable HTTP / SSE transports) straight into the agent's tool list. Sources: feature table (above); tools docs (above); TS MCP example — https://dev.to/aws/strands-agents-now-speaks-typescript-a-side-by-side-guide-12b3
- **[FACT]** **Parallel execution is the default.** Multiple tool calls returned in one model turn run concurrently unless a "tool executor" is configured for sequential execution; the old Python `batch` tool was deprecated precisely because "concurrent tool execution is the SDK default." Sources: tools docs (above); PyPI deprecation table — https://pypi.org/project/strands-agents-tools/
- **[FACT]** **Hooks (lifecycle interception).** The loop emits typed events (`BeforeInvocationEvent`, `BeforeModelCallEvent`, `BeforeToolCallEvent`, `AfterToolCallEvent`, `MessageAddedEvent`, …). The two control workhorses: `BeforeToolCallEvent` — set `event.cancel_tool = "reason"` and the call never runs; **the reason string is delivered to the model as the tool result**, so the model sees why and can self-correct. `AfterToolCallEvent` — mutate `event.result` to rewrite what the model sees as the result. Source: AWS re:Post, "Using Strands Hooks to Deterministically Control Your Agent" — https://repost.aws/articles/AR9OFGjcoCRAi1rfwb277ZFQ/using-strands-hooks-to-deterministically-control-your-agent
- **[FACT]** **Interventions / steering (higher-level than raw hooks).** A handler returns one of: **Proceed** (run it), **Guide** (cancel + feed contextual feedback to the model), **Interrupt** (pause for human input), **Confirm** (require human approval, e.g. before deletes), **Deny** (block, with reason), **Transform** (mutate the tool input before it runs, e.g. redact PII). Steering also exists *after* a model response: Proceed, or Guide = discard the response and retry with guidance injected. Source: official docs — https://strandsagents.com/docs/user-guide/sdk/agents/interventions/ and …/interventions/steering/
- **[FACT]** **Guardrails.** Two layers: the hook/intervention layer above (deterministic, code-level — the enforcement happens outside the LLM, so the model cannot talk its way past it), plus Amazon Bedrock Guardrails integration at the model boundary. Source: EveryDev profile (above); dev.to walkthrough — https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d
- **[FACT]** **Structured output.** Zod (TS) / Pydantic (Python) schema on the agent or call; the SDK validates the model's output and **automatically retries with the validation errors fed back**; on final failure it throws `StructuredOutputError`. Source: TS SDK docs summary — https://mcpmarket.cn/server/6930b88c944e98de2307f243 (mirror of the sdk-typescript README)
- **[FACT]** **Context/session handling.** Conversation managers: **sliding window** (keep last N turns) and **summarizing** (compress older turns), plus a null manager — in both languages. Sessions persist via a **SessionManager** with pluggable repositories (file, S3) storing messages + agent state, so an agent resumes across processes. Sources: feature table (above); TS 1.0 blog (above).
- **[FACT]** **Multi-agent.** Agents-as-tools (an `Agent` is callable as a tool by another agent), **Swarm** (model-driven handoffs between specialist agents), **Graph** (explicit node/edge dependencies), **Workflow**, and the **A2A** protocol. In TS these live in `@strands-agents/sdk/multiagent`. Source: TS 1.0 blog (above).
- **[FACT]** **Observability.** OpenTelemetry tracing/metrics built in ("the agent loop traces every decision by default"), token-usage and execution metrics, cooperative cancellation via `AbortSignal`. Sources: harness-sdk README (above); TS 1.0 blog (above).
- **[FACT]** **Pre-built tool ecosystem (Python community package `strands-agents-tools`).** Historically 30+ tools: `http_request`, `web_fetch`, Exa/Tavily search tools, `memory`/`retrieve` (Bedrock Knowledge Bases), AgentCore Memory provider (`record`/`retrieve`/`list`/`get` actions), RSS, cron, `handoff_to_user` (ask the human and either continue or break out of the loop), browser, journal/notebook, `load_tool` (dynamic tool loading at runtime). Note the direction of travel: many are being **deprecated in favor of MCP servers or core features** (search → vendor MCP servers; `current_time` → a context injector that puts the time in context rather than spending a tool call; `memory` → a MemoryManager). Source: https://pypi.org/project/strands-agents-tools/
- **[FACT]** **Deployment story.** Documented targets center on AWS: Bedrock **AgentCore Runtime** (managed agent hosting, ~$0.0895/vCPU-hour per Geekflare), Lambda, Fargate, EKS, Docker. The SDK itself is just a library and runs anywhere Node/Python runs — but the guides, defaults (Bedrock is the default model provider), and managed story are AWS-shaped. Sources: EveryDev (above); Geekflare (above); strandsagents.com homepage.

### 1.3 Strands, in five lines (for the summary)

AWS's open-source (Apache-2.0), model-driven agent SDK for Python **and** TypeScript (TS hit 1.0 in Apr 2026). Its loop is deliberately thin — model + prompt + tools — and its real wealth is the control layer around the loop: lifecycle **hooks**, **steering/interventions** (Proceed / Guide / Interrupt / Confirm / Deny / Transform), and MCP as a first-class tool source. Conversation management (sliding window, summarizing), session persistence, agents-as-tools/swarm/graph multi-agent, structured output with validation-retry, and OpenTelemetry tracing are all built in. The ecosystem skews Python (30+ community tools vs 4 vended TS tools) and the deployment story skews AWS (Bedrock default, AgentCore Runtime). Young (May 2025) but very active and AWS-backed.

---

## 2. Comparison scan — other open-source agent SDKs

One or two steal-worthy ideas each; full weighing in §5's table.

- **OpenAI Agents SDK** (Python + TS, `@openai/agents`). **[FACT]** Minimal primitives: Agents, **Handoffs** (delegation between agents), **Guardrails** (input/output checks that run *in parallel* with the agent and fail fast on a tripwire), function tools with Zod validation, sessions, human-in-the-loop, and **built-in tracing** where every run/generation/tool call/guardrail/handoff is a typed span. Steal: (1) the **span taxonomy** as a logging schema for her own loop; (2) **parallel guardrails with tripwires** for hostile pasted content. Caveat: the built-in tracer writes to OpenAI's platform, not your stack. Sources: https://openai.github.io/openai-agents-js/ · https://github.com/openai/openai-agents-js · https://openai.github.io/openai-agents-python/tracing/
- **Vercel AI SDK** (TS). **[FACT]** AI SDK 7 ships `ToolLoopAgent` — the classic tool loop as a library call, with configurable stopping conditions and typed runtime context — plus UI streaming helpers; deliberately *no* memory/framework opinions. Steal: **explicit stop conditions + per-step preparation** (`prepareStep`-style hooks to trim context or swap tools per step) as a design checklist for a hand-rolled loop — it's the closest published relative of what Soumaya already runs. Source: Langfuse framework comparison — https://langfuse.com/blog/2025-03-19-ai-agent-comparison
- **Mastra** (TS-first, Apache-2.0). **[FACT]** Full framework: agents with a 4-part memory system (thread history, semantic recall, **working memory** = structured state the agent maintains), graph workflows with `.then()/.branch()/.parallel()`, **suspend-and-resume for human-in-the-loop steps**, RAG, evals, a dev Studio. Steal: the **working-memory concept** (a small structured "what I currently believe about this conversation's task" object, distinct from the user model) and suspend/resume as the shape of multi-step chat flows. Sources: Langfuse (above); https://starterpick.com/guides/best-ai-agent-framework-starter-kits-2026
- **LangGraph** (Python + JS, MIT). **[FACT]** Graph runtime whose superpowers are **durable execution** (a checkpointer saves state after every node; a run survives crashes/restarts and resumes mid-flight) and **`interrupt()`** — pause anywhere, persist, surface a payload to a human, resume later with `Command(resume=…)`; completed steps replay from checkpoint instead of re-running (or re-paying). Steal: **approvals modeled as durable interrupts** whose resume value is the decision, and **checkpoint-per-step** as the recovery semantics for any multi-step agent flow. Sources: https://docs.langchain.com/oss/javascript/langgraph/interrupts · https://www.everydev.ai/tools/langgraph
- **Cloudflare Agents SDK** (TS, runs on Workers/Durable Objects). **[FACT]** Each agent is a Durable Object with its own SQLite, WebSockets, **built-in scheduling (one-time, recurring, cron)**, MCP client *and* server support, workflows with human-in-the-loop approval, and "Code Mode" (the model writes TypeScript that calls tools, instead of one JSON call per tool). Steal: **schedules as durable data with a wake-up contract** (her reminder engine's shape), and the discipline of exposing tools over MCP. Not adoptable without leaving Fly — platform, not library. Sources: https://github.com/cloudflare/agents · https://developers.cloudflare.com/agents/
- **Google ADK** (Python, TS, Java, Go). **[FACT]** Hierarchical multi-agent composition and A2A natively; enterprise-flavored. Steal: **agent hierarchy as an org chart** (a root agent that only routes) — mostly a naming/framing aid for her; too heavy to adopt. Source: https://www.morphllm.com/ai-agent-framework
- **Pydantic AI** (Python only) — *the genuinely compelling Python option.* **[FACT]** Typed **dependency injection** (`RunContext[Deps]` — tools receive a typed bundle: db, http client, user id, permissions — instead of reaching into globals), structured outputs as the core strength with validation-retry, OpenTelemetry/Logfire tracing, Pydantic Evals, and durable execution via external engines (Temporal/DBOS/…). Steal: the **deps-bundle discipline** — every tool gets an explicit, typed context object (space id, cap budget remaining, approval state) and nothing else. Source: https://pydantic.dev/docs/ai/overview/
- **smolagents** (Python, Hugging Face). **[FACT]** Agents that **write and execute Python code** per step instead of emitting JSON tool calls — efficient for multi-step data work, at the cost of a sandboxed-execution security model (every import explicitly authorized). Steal: nothing for this app's risk profile — executing model-written code against a personal brain contradicts her approval invariants; noted so the idea is on record as considered-and-rejected. Source: https://ihatereading.in/blogs/python-ai-agent-sdks-in-2026-openai-agents-sdk-vs-pydantic-ai-vs-smolagents-vs-strands
- **CrewAI** (Python). **[FACT]** Role-based "crews" of agents collaborating on task pipelines; very popular, Python-only. Steal: nothing structural — the role-play metaphor assumes teams of agents; Soumaya is one agent doing one person's jobs carefully. Source: https://starterpick.com/guides/best-ai-agent-framework-starter-kits-2026

---

## 3. Use case A — the Telegram agent

*Her Telegram bot already: shares one context builder with web chat; runs 27 conversational tools (exact counts/lookups, memory capture, verbatim notes, reminders/tasks, dream playback behind approval); typed owner commands act immediately; agent proposals need a yes; proactive sends obey the ADR-018 global cap + quiet hours. Patterns below strengthen that loop; proposals add tools it does not have.*

### 3.1 Tool-calling patterns worth adopting into the hand-rolled loop

1. **Cancellation-with-reason as the denial channel.** **[FACT]** Strands' `BeforeToolCallEvent.cancel_tool` hands the model the reason as the tool result. **[RECOMMENDATION]** Her approval/policy layer should always answer a blocked call with a *user-legible reason in the tool result* ("that needs your approval — I've queued it") rather than an exception or silence. The model then explains, offers the queued-approval path, and never retries the same call in a loop. Improves: every gated tool on Telegram *and* web chat.
2. **A steering pass after the model's draft, before send.** **[FACT]** Strands after-model steering can discard a response and retry with guidance; OpenAI guardrails run in parallel and trip early. **[RECOMMENDATION]** Add one cheap verifier pass for *factual-claim* replies: numbers, counts, dates, and names in the draft must match a tool result from this turn (her persona rule is "exact counts, never invented"). If the draft asserts a figure no tool produced, the pass Guides it back: re-draft from the tool output or say "let me check." This is the single highest-value pattern for Telegram, where she answers factual questions about his life all day.
3. **Result budgeting at the tool boundary.** **[FACT]** Strands' `AfterToolCallEvent` can rewrite the result the model sees. **[RECOMMENDATION]** Every tool returns a *budgeted* result: a hard character cap, structured head + "…and N more" tail, and large payloads (long notes, lists) replaced by a summary + an id the model can page. Prevents one fat lookup from evicting the conversation on a small-context model and keeps per-turn cost predictable on a small machine.
4. **Summarize, don't truncate, old context.** **[FACT]** Strands ships sliding-window *and summarizing* conversation managers; Mastra/Pydantic ecosystems do token-triggered summarization with a kept tail. **[RECOMMENDATION]** In her shared context builder, when a thread ages past a token budget, fold the older turns into a short running brief (decisions made, facts stated, open threads) and keep the recent tail verbatim. Verbatim user words that matter (his `/note` dictation) are already stored as data, so summarization must compress *chat*, never the stored record.
5. **Structured extraction with validation-retry for anything that becomes data.** **[FACT]** Strands and Pydantic AI both validate model output against a schema and auto-retry with the validation errors as feedback. **[RECOMMENDATION]** Any tool whose output lands in SQLite (a parsed bill, a reminder's date, an extracted contact) should pass through a schema gate; on failure the model retries with the errors; after N failures the *user* sees the raw text and a plain question — never a silently malformed row. (Powers proposal A2 below.)
6. **Parallel reads, serialized writes.** **[FACT]** Strands runs concurrent tool calls by default, with executors to force sequence. **[RECOMMENDATION]** In one model turn, independent lookups (count + search + agenda) may run concurrently; anything that writes, queues an approval, or spends cap runs one-at-a-time in the order the model emitted them. Keeps multi-part Telegram questions ("how many X, and when did I last Y?") fast without racing her own store.
7. **A trace per turn, stored in her own SQLite.** **[FACT]** OpenAI's SDK gives every run/generation/tool-call/guardrail a typed span; Strands emits OpenTelemetry by default. **[RECOMMENDATION]** Log one trace row per turn (turn → model call → tool calls with durations and result sizes → verifier verdict) in a local table. When she answers wrong on Telegram, the owner can ask "why did you say that?" and there is an answer. No external observability service — the Fly box and SQLite are the observability stack.
8. **Approvals as durable interrupts.** **[FACT]** LangGraph's `interrupt()` persists the paused run; the human's resume value re-enters exactly where it stopped, and completed steps replay from checkpoint rather than re-running. **[RECOMMENDATION]** Model a pending approval as a *resumable state*, not a message: it survives a Fly restart, carries the full proposed action + the owner's eventual yes/no/edited value, and on approval the flow continues from the proposal instead of the model re-deriving (and possibly altering) it.
9. **Schedules as data with a missed-run policy.** **[FACT]** Cloudflare's Agents SDK treats one-time/recurring/cron schedules as durable per-agent data that wakes the agent. **[RECOMMENDATION]** Her reminder/task engine should state, per schedule, what happens when the box was asleep at fire time (fire late once, skip, or collapse multiples into one) — a written policy, chosen per schedule type, instead of whatever the loop happens to do. (Powers proposal A3.)
10. **A typed deps bundle into every tool.** **[FACT]** Pydantic AI's `RunContext[Deps]` hands tools an explicit typed context. **[RECOMMENDATION]** Each of her 27 tools receives one object — space id, surface (web/telegram), cap remaining today, quiet-hours state, approval handle — and may not read ambient globals. This is what makes patterns 1–3 enforceable in one place instead of per-tool.

### 3.2 Concrete tool proposals — Telegram

Each proposal: **Purpose / Inputs / Outputs / Permissions / Failure behavior / Acceptance criteria.** All are **[RECOMMENDATION]**s; the SDK features they lean on are marked.

---

**A1 — `web_lookup`** (search the web or fetch a link). *Leans on:* Strands' vended `web_fetch`/HTTP tools and the Exa/Tavily search tools the ecosystem wires up **[FACT, §1.2]**.
- **Purpose:** Owner pastes a link, or asks a question his brain can't answer ("what time does that place close?"), and gets a sourced answer instead of a dead end or an invention.
- **Inputs:** `mode: "search" | "fetch"`; `query` (search) or `url` (fetch); optional `max_results` (default 3).
- **Outputs:** Budgeted digest: for search — title, source, one-to-two-line extract per result; for fetch — cleaned page text (capped, with the cap disclosed) + page title + URL. Every claim in her reply must trace to a returned extract.
- **Permissions:** Read-only, external. No approval. No cap cost (it's a reply, not a proactive send). Fetched content is **untrusted data**: it is wrapped as data, never instructions (her existing prompt-injection posture); a page telling her to "ignore previous instructions" is reported as page content, not obeyed.
- **Failure behavior:** DNS/HTTP/timeout/empty extraction → she says plainly she couldn't read it, names the URL, offers to retry or to work from what he pastes. Never summarizes a page she failed to fetch.
- **Acceptance criteria:** (1) Given a reachable URL, reply contains text demonstrably from that page + its title. (2) Given an unreachable URL, reply states the failure and contains zero claims about the page's content. (3) Search results cite ≥1 returned source per factual claim; an injected instruction inside a fetched page produces a report of the page, not compliance.

**A2 — `extract_proposal`** (turn pasted/forwarded text into a checked proposal). *Leans on:* schema-validated structured output with validation-retry **[FACT, §1.2]**.
- **Purpose:** He forwards a bill email, an appointment text, a landlord message; she extracts the structured facts and proposes the concrete artifact (bill, reminder, task) instead of chatting about it.
- **Inputs:** `text` (the pasted/forwarded content); `kind_hint` optional (`bill | appointment | task | auto`).
- **Outputs:** A typed object (e.g. bill: `{payee, amount, due_date, recurrence?}`; appointment: `{title, starts_at, timezone}`) rendered back to him as a proposal card/message: "You asked: …" + the extracted fields + the exact action that approval would take.
- **Permissions:** Extraction itself is read-only. **Creating anything requires the approval machine**, with the proposal showing the extracted fields verbatim — approval approves *those bytes*, not a re-parse. Dates carry the space's timezone explicitly (no UTC, no device-zone guessing); an ambiguous date is a clarification question, never a guess.
- **Failure behavior:** Schema validation fails after the retry budget → she shows the raw text, marks which fields she could not determine, and asks him to supply just those. Partial extraction is presented as partial — missing fields are blank, never filled by plausible invention.
- **Acceptance criteria:** (1) A sample bill text yields a proposal whose amount/date match the text character-for-character in value. (2) A text with no date yields a proposal with the date field explicitly missing + a question — and no created artifact. (3) Approving creates exactly the artifact shown; rejecting creates nothing and leaves no residue in counts.

**A3 — `recurring_schedule`** (create/inspect recurring reminders & digests). *Leans on:* durable scheduling-as-data **[FACT, Cloudflare §2]**; Strands' retired `cron` tool shows the ecosystem demand **[FACT, §1.2]**.
- **Purpose:** "Remind me every Sunday night to plan the week" / "what recurring things do I have?" — recurrence as a first-class object, not N one-off reminders.
- **Inputs:** `action: "create" | "list" | "pause" | "end"`; for create: `text`, `cadence` (daily/weekly/monthly + parameters), `time_local`, `missed_policy: "fire_once_late" | "skip"`.
- **Outputs:** The schedule object + its next 3 fire times rendered in the space's local time; list returns all active schedules with next-fire each.
- **Permissions:** Owner-typed creation on Telegram acts immediately (his standing rule for his own typed commands); an *agent-proposed* schedule goes through approval. Fires are proactive sends → **each fire spends from the ADR-018 global cap and obeys quiet hours**; a fire suppressed by cap/quiet hours follows `missed_policy`, visibly logged.
- **Failure behavior:** An unparseable cadence → no schedule created; she restates what she understood and asks for the correction. A schedule whose fire is suppressed 3 consecutive times surfaces that fact in the next digest instead of silently never firing.
- **Acceptance criteria:** (1) Create weekly → list shows it with the correct next 3 local dates. (2) Pause → no fire occurs and none is queued retroactively on resume. (3) With cap exhausted, a due fire does not send, and the suppression is visible in the trace/digest.

**A4 — `pending_approvals`** ("what's waiting on me?"). *Leans on:* durable-interrupt introspection **[FACT, LangGraph §2]**.
- **Purpose:** One place in chat to see everything the agent is holding for his yes: dream playbacks, proposed writes, proposed schedules — instead of hunting old messages.
- **Inputs:** none (or `filter` by kind).
- **Outputs:** Numbered list: each pending item's one-line summary, age, and what yes/no does; he can answer by number ("yes 2", "no 1") and the answer binds to that exact proposal (pattern 8).
- **Permissions:** Read-only listing. Answering is the approval act itself and goes through the existing approval machine — the tool creates no new authority.
- **Failure behavior:** If the queue is empty, she says so (a real answer, not a filler list). If an item expired since listing, answering it returns "that one's expired — here's what it was" and takes no action.
- **Acceptance criteria:** (1) With 2 pending items, list shows both with correct ages. (2) "Yes 1" executes proposal 1's recorded action byte-for-byte (no re-derivation). (3) After resolution, a fresh list no longer shows it.

**A5 — `export_document`** (send him his own data as a file). *Leans on:* the file/notebook tools every ecosystem ships **[FACT, §1.2]**.
- **Purpose:** "Send me all my notes about the apartment hunt" / "export this chapter" — a Telegram document he can save, forward, or print, instead of a wall of chat bubbles.
- **Inputs:** `source` (`notes_matching | memory_list | chapter | digest_range`), `query` or id/range, `format: "md" | "txt"` (default md).
- **Outputs:** A file attachment in the chat + a one-line manifest (what's inside, how many items, date range).
- **Permissions:** Read-only over his own space; no approval (it's his data, to him, on his authenticated channel). Never exports another space's data; the deps bundle's space id is the only scope.
- **Failure behavior:** Empty result set → no file; she says the query matched nothing and shows the query she used. Oversized export → she says the size and offers a narrower range rather than truncating silently.
- **Acceptance criteria:** (1) Export of a known note set contains exactly those notes, verbatim. (2) A query matching nothing produces no attachment and an explicit "nothing matched." (3) The manifest count equals the file's item count.

**A6 — `delegate_research`** (a bounded sub-agent returns a sourced brief). *Leans on:* agents-as-tools **[FACT, Strands §1.2; OpenAI handoffs §2]**.
- **Purpose:** "Look into X and give me the short version" — multi-step web research (several searches/fetches, cross-checking) done by a scoped sub-agent so the main conversation stays clean and the main agent's context isn't flooded with raw pages.
- **Inputs:** `question`; `depth: "quick" | "thorough"` (bounds the sub-agent's tool calls, e.g. ≤5 / ≤15); `deliver: "brief"`.
- **Outputs:** A brief: answer first, then the 2–4 sources it rests on, then one line on what it could *not* verify. The sub-agent's raw tool traffic stays out of the main thread (only the brief + a trace id return).
- **Permissions:** The sub-agent's toolset is **read-only web only** (A1) — it cannot write, propose writes, or spend notification cap. The brief is information, not action; anything actionable in it needs the normal proposal path afterward.
- **Failure behavior:** If sources conflict, the brief says so and shows both — no forced consensus. If the call budget runs out mid-research, it returns the partial brief marked partial, with what remains unchecked.
- **Acceptance criteria:** (1) Every factual claim in a brief cites a source the sub-agent actually fetched (trace shows the fetches). (2) The sub-agent makes zero write/cap-spending calls across a test battery including a prompt-injected page urging it to "also send a message." (3) A `quick` run never exceeds its tool-call bound.

---

## 4. Use case B — the galaxy ship agent

*The ship is already the user's focus object in a 3D galaxy where planets are memories. The owner is designing multi-space travel and a mutating world in a parallel chat; ideas below are flagged where they feed that design — they do not design it. What this section adds: how the ship becomes an* agent *— a scoped actor with named tools, hard boundaries, persistent world state, and behavior the user can predict.*

### 4.1 Patterns that give the ship clear boundaries and predictable behavior

1. **The ship is a sub-agent with a fenced toolset.** **[FACT]** Strands agents-as-tools and OpenAI handoffs let a parent agent invoke a specialist agent as a tool, with its own prompt and tool list. **[RECOMMENDATION]** The ship gets a *world-actions-only* toolset (fly, focus, tour, notice, propose) and **zero** access to brain-write tools. The main agent (chat/Telegram) can ask the ship to do things; the ship cannot capture, edit, or delete memories. One direction of authority, stated in the tool list — that's the boundary, enforced by what the ship's agent literally cannot call.
2. **Every world action passes a before-action gate.** **[FACT]** Strands' before-tool interventions can Deny/Guide/Confirm per call, deterministically. **[RECOMMENDATION]** Ship actions are validated against world rules before executing: movement and looking are free; anything that *changes persistent world state* must carry an approval token (see B4); anything that would notify must pass the ADR-018 cap check. Predictability comes from the gate being code, not prompt.
3. **World state changes are versioned transitions, not edits.** **[FACT]** LangGraph checkpointers and Strands session/state snapshots persist agent state so it can be saved, resumed, and inspected. **[RECOMMENDATION]** The galaxy's mutable state (positions, beacons, mutations) lives in SQLite as an append-only log of transitions (who proposed, who approved, what changed, undo pointer). The rendered world is a fold over that log. This is what makes a "mutating world" safe to build: every mutation is attributable and reversible.
4. **Post-action narration hook.** **[FACT]** After-tool hooks can rewrite/annotate results. **[RECOMMENDATION]** Each executed ship action returns a structured event (action, target, result) that both the renderer (animate it) and the narrator (one line: "She flew to the night you met…") consume. The user always knows what the ship just did and why — no silent world changes.
5. **MCP as the long-term seam (flagged, not recommended now).** **[FACT]** Strands and Cloudflare both treat MCP as the standard tool boundary; an MCP server can serve the same tools to multiple clients. **[RECOMMENDATION]** *If* the worlds design grows a second client (e.g. a separate travel/renderer process), exposing her 27 brain tools + the ship's world tools over one internal MCP server would unify the surfaces. On one small Fly box today, a direct function call is simpler; MCP is a seam to keep in mind, not a step to take.

### 4.2 Concrete tool proposals — the ship

Same six fields. All **[RECOMMENDATION]**s. "Feeds worlds design" flags mark ideas that belong in the parallel design chat's inbox.

---

**B1 — `guided_tour`** (the ship flies a narrated route). *Feeds worlds design (tours were named in the owner's vision brief).*
- **Purpose:** "Show me my year" / "take me through the apartment-hunt memories" — the ship flies an ordered route through matching nodes, pausing at each with one line of narration drawn from the memory itself.
- **Inputs:** `theme` (chapter id, tag, date range, or free-text theme resolved via search); `max_stops` (default 5); `pace: "glide" | "visit"` (pass-by vs stop-and-open).
- **Outputs:** A tour object: ordered stop list (node ids + the narration line for each, quoted/paraphrased *from the node's own content*), executed as a flight plan the renderer animates; ends with a "tour complete" card listing stops.
- **Permissions:** Read-only. Flight and narration mutate nothing and need no approval. The user can interrupt at any stop (interrupt = tour ends, ship stays). No cap cost (in-app, user-initiated).
- **Failure behavior:** Theme matches nothing → ship doesn't move; she says what she searched and offers the nearest themes that do exist. A node deleted mid-tour → skipped with a spoken note, tour continues.
- **Acceptance criteria:** (1) A tour over a known chapter visits exactly that chapter's nodes, in date order. (2) Every narration line traces to its node's content (no invented events). (3) Interrupting at stop 2 leaves the ship at stop 2 and the tour marked ended, not completed.

**B2 — `fly_to_memory`** (resolve a fuzzy reference, then fly there).
- **Purpose:** "Take me to that thing about Dad's surgery" — the user remembers a life event, not a node id. The ship resolves the reference against the brain and flies to the match.
- **Inputs:** `reference` (free text); optional `hint` (person, rough date).
- **Outputs:** Either one resolved node + flight, or a short candidate list (≤3, each with a one-line distinguisher: title + date) when resolution is ambiguous.
- **Permissions:** Read-only. No approval — but also **no silent best-guess**: below a confidence threshold, she asks instead of flying (his exactness rule: a wrong confident flight is worse than a question).
- **Failure behavior:** No plausible match → she says so, shows the closest candidates anyway, and doesn't move. Two equally strong matches → candidate list, ship stays put until he picks.
- **Acceptance criteria:** (1) A reference with one true match flies to that node. (2) A reference matching two known nodes produces the candidate list and zero movement until a pick. (3) A reference matching nothing produces an explicit "couldn't find it" + closest candidates, zero movement.

**B3 — `propose_noticing`** (ambient noticing, capped and honest). *Feeds worlds design (ambient ship behavior).*
- **Purpose:** The ship notices what a good second brain should surface: a memory's anniversary today, a cluster untouched for a year, a streak about to break, two memories that seem connected. She brings *one* noticing to the user instead of waiting to be asked.
- **Inputs:** Internal trigger (session start, idle, or scheduled evaluation); `budget` = remaining proactive allowance.
- **Outputs:** Zero or one noticing card: the observation, the evidence (which nodes/dates), and one suggested action (revisit, connect, capture a follow-up). Delivered in-app; if it ever routes to Telegram/push it spends ADR-018 cap like any proactive send.
- **Permissions:** Proposing is internal and free. **Surfacing is the gated act**: in-app card = user-present context only; any off-app notification must claim a cap slot and obey quiet hours. A noticing never edits, connects, or mutates anything by itself — its suggested action is a separate proposal under the normal rules.
- **Failure behavior:** Cap exhausted or nothing clears the evidence bar → she surfaces *nothing* (silence is the correct output; a noticing engine that must always produce one will start inventing). Weak-evidence candidates are dropped, not downgraded into vague nudges.
- **Acceptance criteria:** (1) With an anniversary memory present, a session start can surface it with the correct date math in the space's timezone. (2) With cap at zero, an off-app noticing is never sent, and the drop is trace-visible. (3) Across a seeded test brain with no qualifying patterns, the engine surfaces nothing rather than a manufactured noticing.

**B4 — `propose_world_change`** (+ its pair, `undo_world_change`). *Feeds worlds design (the mutating world) — this is the safety rail that design will need.*
- **Purpose:** The mechanism by which the world mutates *with* the user — e.g. a milestone lights a new star, related memories draw into a constellation, a completed chapter gets a monument — proposed by the ship or the system, never applied silently.
- **Inputs:** `kind` (from a closed list the worlds design defines), `payload` (the concrete change: which nodes, what visual/state effect), `reason` (the user-legible why, citing the triggering memories/milestone).
- **Outputs:** A proposal rendered *in-world* as a preview/ghost plus a plain-language card; on approval, the change is appended to the world-transition log (§4.1 pattern 3) and rendered; on rejection, the ghost is discarded.
- **Permissions:** **Approval-gated, always** — world mutation is a consequential persistent write, in the same class as user-model writes. The proposal shows exactly what will change. `undo_world_change` reverses any logged transition and itself needs no approval (it's the owner's own reversal) but is itself logged.
- **Failure behavior:** A proposal whose payload references deleted/changed nodes at approval time fails closed: nothing applies, the owner sees "this changed since I proposed it" and a fresh proposal can be generated. A partial render failure leaves the log and the rendered world consistent (the log is truth; rendering replays it).
- **Acceptance criteria:** (1) No world state differs before approval, across a test battery including the agent "trying" to apply directly. (2) Approving applies exactly the previewed change — transition log payload == approved payload. (3) Undo restores the prior rendered state bit-for-bit at the state level.

**B5 — `leave_beacon`** (a message pinned to a place or a date). *Feeds worlds design (gates/places give beacons somewhere to live).*
- **Purpose:** He — or the ship, by proposal — leaves a note at a memory, a place in the galaxy, or a future date: "when you come back here, remember why this mattered." Resurfaced when he next approaches that node, or when the date arrives.
- **Inputs:** `anchor` (node id | galaxy location | date), `text` (verbatim if user-authored), `resurface: "on_approach" | "on_date" | "both"`.
- **Outputs:** A visible beacon object in-world + the stored note; on resurface, the note is presented by the ship with its original wording intact.
- **Permissions:** User-authored beacons act immediately (his words, his world — same standing as his typed commands). **Ship-authored beacons are proposals** (B4's gate) — the ship may not pin its own words into his world unapproved. Date-triggered resurfacing that leaves the app spends cap under ADR-018.
- **Failure behavior:** Anchor node deleted → beacon is listed as orphaned in the next digest (not silently dropped, not crashed on). A date beacon whose date passes while the app is unused resurfaces at next session, marked with its original date — never backdated or presented as new.
- **Acceptance criteria:** (1) A user beacon on a node appears on approach with verbatim text. (2) A ship-proposed beacon does not exist in world state before approval. (3) Deleting the anchor node produces the orphan notice, and the beacon's text remains retrievable from the log.

---

## 5. Weighing the serious candidates for THIS app

Constraints applied: one small Fly machine; phone client; SQLite; solo vibe-coder maintainer; an existing hand-rolled loop that already implements the hard, app-specific parts (approval machine, cap accounting, user-model invariants).

| Candidate | License | Runs where | Ops complexity for a solo maintainer | Integration cost vs her loop | Verdict shape |
|---|---|---|---|---|---|
| **Strands (TS)** | Apache-2.0 **[FACT]** | In-process Node — fine on Fly | Medium: new mental model (harness vs SDK layers, hooks, plugins), Bedrock-shaped docs/defaults to work around, fast-moving API (1.x, restructured repos in its first 18 months) | High for value received: her loop must be rebuilt *inside* Strands, and approval/cap/invariants re-implemented as hooks anyway; TS tool ecosystem thin (4 vended tools; the 30+ community package is Python) | **Steal patterns, skip adoption** (§6) |
| **OpenAI Agents SDK (TS)** | MIT **[UNVERIFIED — I did not re-check the license text this session]** | In-process Node | Low–medium: few primitives; but default tracing exports to OpenAI's platform (data leaves the box) unless replaced | Medium: loop swap for guardrail/handoff shapes she can copy in ~a day each | Steal span taxonomy + parallel-guardrail shape |
| **Vercel AI SDK** | Apache-2.0 **[UNVERIFIED — not re-checked this session]** | In-process Node, lightest of the set | Low: it's a loop + streaming helpers, no framework surface to babysit | Lowest of any candidate — closest to her current shape; still a loop replacement for marginal gain today | Steal stop-condition/step-prep checklist; revisit if her loop is ever rewritten |
| **Mastra** | Apache-2.0 **[FACT]** | Wants its own server/Studio habits; memory system expects to own persistence | High for this app: its memory/RAG opinions would fight her SQLite user model and invariants | High: adopting means negotiating every one of her invariants against framework defaults | Steal working-memory concept only |
| **LangGraph (JS)** | MIT **[FACT]** | In-process, checkpointer on her existing DB | Medium–high: graph abstraction is a real conceptual adoption; JS lags Python on features | High as a framework; ~zero as a *semantics donor* | Steal interrupt/checkpoint semantics only |
| **Cloudflare Agents** | MIT **[UNVERIFIED — not re-checked this session]** | **Workers/Durable Objects only** — cannot run on her Fly box | N/A as adoption (platform move, not a library) | N/A | Steal scheduling-as-data pattern only |
| **Google ADK** | Apache-2.0 **[UNVERIFIED — not re-checked this session]** | In-process | High: enterprise hierarchy machinery for a one-agent app | High | Skip; framing only |
| **Pydantic AI** | MIT **[UNVERIFIED — not re-checked this session]** | **Python only** — adoption means a second runtime/service beside the TS app | High (new service to deploy, monitor, keep in step) for a solo maintainer | High | Steal deps-bundle discipline; the one Python option worth naming if a sidecar is ever justified — it isn't now |
| **smolagents / CrewAI** | Apache-2.0 / MIT **[UNVERIFIED]** | Python | — | — | Skip (§2): code-execution risk profile / role-play metaphor mismatch |

**Mobile/backend note applying to all rows:** none of these frameworks changes the phone client's cost — the agent runs server-side either way. The real mobile constraint is *latency and payload discipline in tool results* (pattern A3), which is a property of her loop's design, not of any framework choice.

---

## 6. Verdict on Strands for this app: **STEAL — do not adopt, do not skip**

**Steal** (patterns, into her hand-rolled loop, each a design conversation of its own): the intervention vocabulary (Proceed / Guide / **Confirm** / Deny / Transform) as the named shapes of her approval machine; cancel-with-reason tool results; after-model steering as the factual-claim verifier; summarizing conversation management; validation-retry structured output for extraction; concurrent-reads/serialized-writes executors.

**Do not adopt** (the SDK itself), for reasons grounded in her constraints, not its quality:
1. **Her hard parts are already built and are not what Strands sells.** Approval gating, cap accounting, user-model invariants, per-space scoping — Strands would make her re-express all of them as hooks inside someone else's loop. The swap buys loop plumbing she already has.
2. **Gravity mismatch.** Default provider Bedrock, deployment story AgentCore/Lambda/Fargate, guardrail story Bedrock Guardrails. She runs one Fly box on non-AWS models; every default would be a default to undo.
3. **The TS ecosystem is the thin side.** 4 vended TS tools vs the Python community's 30+ **[FACT]** — the tool catalog that makes Strands attractive in demos is mostly not available to a TypeScript app today.
4. **Churn risk for a solo maintainer.** May 2025 → multiple restructures (harness monorepo, tool deprecations toward MCP) by Oct 2026. Powerful and promising — and a moving floor under a one-person app whose maintainer's scarcest resource is attention.
5. **The harness's benchmarked defaults are tuned for coding/research agents**, not for a personal brain whose correctness rules (exact counts, verbatim notes, never-mutate) are stricter than any default.

**Not "skip"**, because the control-layer design (hooks/steering/interventions) is the best published answer to the exact problems her loop will keep meeting — it should be her loop's reference architecture even though not one line of the SDK ships.

*Revisit trigger:* if her loop is ever rewritten from scratch, or a Python sidecar is ever justified, Strands (and Pydantic AI) re-enter as genuine adoption candidates and this verdict should be re-run.

---

## 7. Candidate bounded next steps (evidence → decisions; none of this is authorized)

1. **Owner picks which patterns enter design.** §3.1's list, one by one — recommended first three: cancel-with-reason denials (A-pattern 1), the after-draft factual verifier (A-pattern 2), result budgeting (A-pattern 3). Each becomes a short design note in the house pattern before any build.
2. **Owner picks at most 1–2 tool proposals to design first.** Recommended: **A4 `pending_approvals`** (smallest, pure win, strengthens the approval machine everything else depends on) and **A1 `web_lookup`** (biggest daily-use gap). B-side proposals route to the worlds design chat's inbox, flagged as inputs — that chat owns their design.
3. **Record the Strands verdict** (§6) in the backlog so the adopt/steal/skip question isn't re-litigated from scratch next time an SDK trends.
4. **No step in this list authorizes code.** Any accepted item re-enters the normal lane: design note → owner's word → build → gate → merge → deploy, each separately.

*End of report.*
