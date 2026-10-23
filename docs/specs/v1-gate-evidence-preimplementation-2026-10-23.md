# Soumaya V1 — Pre-Implementation Gate Evidence
## Produced 2026-10-23 at the owner's "Ready" — read-only inspection of `~/workspace/gate-run/repo`. No code changed.
## Purpose: produce every piece of §18.4 / Rev 3 qualification evidence that can exist *before* a build, against the actual repository — and state plainly which evidence only a built V1 can produce.

---

## E1 — Capture entry points, traced in actual code

| Entry point | Path in code | What happens to the words today | Byte-contract consequence for V1 |
|---|---|---|---|
| Web ingest (memory) | `api/routes/ingest.ts` → `ingestWithContext` → `ingestion/pipeline.ts ingestCore` | Text arrives untrimmed (zod: string, 1–20,000 chars); extraction rewrites it into nodes; **raw stored nowhere** | Clean insertion point: persist source from the route/pipeline entry before `llm.extract` runs. Contract achievable exactly as designed (§18.2). |
| Web ingest (action kind) | same route, `kind:"action"` branch | Node content = `text.trim()` — **trimmed**, no extraction | A V1 source for actions must be taken *before* this branch's trim. Noted as a build requirement. |
| Telegram free messages | `telegram/bot.ts:500` → `ingestWithContext` | Same extraction path as web ingest; raw lost | Same insertion point as web ingest (shared pipeline). |
| **Telegram notes (/note … /done)** | `telegram/notes.ts saveTelegramNote` | **Already verbatim**: bypasses extraction; node `content` = raw text byte-for-byte (code comment says so); multi-part drafts joined with `"\n"` (`PART_SEPARATOR`); failed save keeps the draft and says so | Two consequences: (1) a working in-repo precedent for the persist-first pattern + honest failure (§13) already exists; (2) **a subset of legacy nodes is quotable in fact** — telegram-note nodes (`origin='telegram'`) hold verbatim content today. They have no hash/chunks/provenance, so they stay "legacy" for V1, but V2's legacy labeling should distinguish them from extraction summaries instead of calling all 245 summary-only. The assembled-draft text (parts + separator) is the capture unit, per §18.2. |
| File import (web) | client-side `lib/extractFileText.ts` (IngestPanel / ChatDock / Companion) → text lands as editable draft → submitted via ingest route | **The server never receives the file or its bytes** — only the extracted text string the owner submits | **Design refinement (see §23 of the design note):** for the existing flow, the V1 source is the *submitted extracted text* (hash over its UTF-8 bytes, class `imported_text`). Preserving original file bytes would need a new upload route — out of V1 scope, recorded as a deliberate boundary, consistent with §18.2's server-boundary definition. |
| Knowledge documents | `knowledge/ingest.ts chunkText` → `knowledge_chunks` + `vec_docs` | Chunks are **normalized**: CRLF→LF, runs of blank lines collapsed | Even the existing "verbatim" system normalizes. **Build requirement:** V1 source chunking must NOT reuse `chunkText`; source chunks are exact substrings with offsets (§4.1). Knowledge docs themselves stay unmigrated (§18.4 decision). |
| Quick capture / share target (IM-141) | client → Ingest panel prefilled → ingest route | Same as web ingest | Covered by the web-ingest insertion point. |
| Chat | `api/routes/chat.ts` | No direct node creation in the route; captures happen through the agent/pipeline paths above | No separate insertion point needed; agent-initiated captures inherit the pipeline point. |

**E1 verdict:** the §18.2 byte contract is achievable at one shared pipeline insertion point plus the ingest-route action branch. One refinement required (file bytes) — recorded in the design note §23, a boundary clarification, not a contradiction.

## E2 — Derived-representation inventory (actual repo, diffed against design §18.1)

Schema sources swept: `db/schemaSql.ts` (BOOTSTRAP_SQL), `db/client.ts` migrations, `agent/episodic.ts` DDL. **64 tables** sit in `SPACE_SCOPED_TABLES` today (counted programmatically from `auth/spaces.ts`; corrected from an initial eyeballed figure of 73 — see design note §24, finding F1). Virtual/index tables in the codebase: `nodes_fts`, `episodes_fts`, `vec_nodes`, `vec_episodes`, `vec_docs`, `vec_journeys`, `vec_profiles` — all registered in `DERIVED_INDEXES` (`auth/spaces.ts`) and deleted first, transactionally, by `deleteSpace`.

Text-bearing representations that could retain forgotten content — §18.1's list **confirmed and extended** by the actual schema:

- In §18.1 already: nodes, episodes (+FTS/vec), insights, daily_logs, knowledge_docs/chunks (+vec_docs), tts_audio_cache, and the corrections pattern.
- **Found in the actual repo, added by this inventory:** `lore` (world/subject text), `episode_enrichments` (derived text about episodes), `working_memory` (free-text rows), `agent_logs` (loop transcripts — has an append-only no-delete trigger; `deleteSpace` already handles it by lifting/restoring the trigger transactionally), `telegram_note_drafts` (in-flight owner words), `attachments.data` (file payloads as TEXT), `timeline_chapters` (generated chapter text), `inquiries` (generated questions quoting connections), `consolidation_runs`/`consolidation_episodes` + `contradictions` (W3 derived text), `user_model`/`user_persona` (derived owner model — text *about* the owner synthesized from sources), `instruction_profiles` (+vec_profiles), `journeys` (+vec_journeys, life-chapter text).
- Out of scope by design: `fin_*` tables (ADR-019 pipeline; a source forget in the brain does not reach Money data, and §16 already excludes finance ingestion from V1).

**E2 verdict:** the reviewer's demand — "inventory must match the actual repository" — is now satisfiable: this list IS the repository's, and the build's erasure sweep (§18.5.11) must run against exactly this inventory. Two build requirements follow: V1's `sources_fts` + chunk vec table must be registered in `DERIVED_INDEXES`, and the four new tables in `SPACE_SCOPED_TABLES` (both already in the design; now confirmed as the correct, existing mechanisms — `deleteSpace` is one transaction with rollback, so erasure inherits atomicity).

## E3 — Isolation, erasure, export/restore — current state

- **Space isolation today:** repos are space-constructed; `keywordSearch` filters by space before LIMIT (verified in `db/fts.ts` at design time). The design's isolation rules extend existing patterns; no contrary mechanism found.
- **Space erasure today:** `SpacesRepo.deleteSpace` — passcode + exact gamer-tag confirmation, one transaction, derived indexes first (vec rows bound as BigInt, FTS as numbers), trigger-safe handling for `agent_logs`, `spaces` row last. V1's additions slot into this machinery without new patterns.
- **Forget today:** `forget_requests` + INV-DEL-1 (`applyForgetRequest` is the only DELETE path for W2 rows) — §18.1's "ride the existing door" is verified as the real, only door.
- **Export today:** `GraphExportRepo.exportGraph` → `{ exportedAt, spaceId, nodes[], edges[] }` (live nodes only, dangling edges filtered). **There is NO restore/import counterpart for this export anywhere in the server routes** — today's only true restore is the `brain.db` file itself.
  - **Gate consequence, stated plainly:** §18.4 item 3 (export/restore round-trip) **cannot be evidenced pre-build** — the restore half does not exist. It becomes a *build deliverable*: V1 must either (a) ship a versioned export including sources **plus** a restore path that rebuilds sources/chunks/indexes with hash verification, or (b) return to the design gate to rescope. Option (a) is the design's intent; the checklist now carries it as a build-phase gate, not pre-implementation evidence.

## What only a built V1 can prove (build-phase gates — not producible now, not claimed here)

Bootstrap-vs-migration schema agreement *for the new tables* · the §14/§18.5 acceptance tests (byte fidelity, idempotent replay, single-winner extraction, correction replay, adversarial cross-space plant, erasure sweep against the E2 inventory, TZ suite) · export/restore round-trip (E3) · downgrade checklist on the actual deploy. These remain mandatory — they execute as the build's gate (tests/typecheck/tree-verify) before any merge ask, per the owner's both-lanes rule.

## Evidence verdict

Pre-implementation evidence is **complete**: capture paths traced (E1), inventory matched to the actual repo (E2), isolation/erasure/export machinery verified with one honest gap converted into a build deliverable (E3). **No material contradiction with the approved design was found** — two refinements (§23: file-byte boundary; telegram-note legacy nuance) and two build requirements (no `chunkText` reuse for source chunks; register new indexes in `DERIVED_INDEXES`) are recorded in the design note. Queue reconciliation (Gate 4) belongs to the repo chat at scheduling time. **Implementation remains unauthorized** until the owner gives that separate word.
