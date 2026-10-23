# Soumaya V1 — Implementation Ask Package
## Prepared 2026-10-23, third Soumaya chat (recall). Basis: approved design of record (design note Rev 1–3, §§22–24) + pre-implementation evidence (E1–E3).
## Status: an ASK. Nothing in this package authorizes anything. The owner's separate word decides.

---

## 1. What would be built (design §13 boundary — nothing more)

Track A, V1 only: **stop losing the owner's original words.**

1. **Schema (additive only):** `sources`, `source_chunks`, `node_sources`, `source_corrections` via `BOOTSTRAP_SQL` + `migrateSchema` migrations — including the §18.2/18.3 fields (`raw_bytes`, citation class, processing state + lease + `extraction_hash`). Registered in `SPACE_SCOPED_TABLES`; `sources_fts` + chunk vec table registered in `DERIVED_INDEXES`.
2. **Capture wiring at the traced insertion points (evidence E1):**
   - Shared pipeline entry (`ingestion/pipeline.ts`): persist source (chunks + FTS in the same transaction) → acknowledge → extract, with `node_sources` origin links written from extraction.
   - Ingest route action branch (`api/routes/ingest.ts`): source taken **before** the trim.
   - Telegram notes (`telegram/notes.ts`): `saveTelegramNote` additionally writes a source for the assembled draft text (its content is already verbatim — this gives it hash/chunks/provenance).
   - File import: source = submitted extracted text, class `imported_text` (§23 refinement). No new upload route.
3. **Processing state machine (§18.3):** durable status, single-winner lease claim, idempotent retries (`extraction_hash` + unique link index), `failed_permanent` → Inbox surfacing. No job platform.
4. **Forgetting integration (§18.1):** source forgetting rides `forget_requests` / INV-DEL-1 only; dependency-aware erasure + scrub verification for multi-origin nodes, swept against the E2 inventory.
5. **Export/restore (§23 build deliverable):** export format version bump including sources (bytes base64); a restore path that rebuilds sources/chunks/indexes and verifies hashes; pre-V1 exports still restore (sources absent).
6. **Provenance label plumbing (minimal):** nodes expose whether they carry an active `origin` link, so later phases can render "Your words" honestly. **No new UI surfaces in V1** beyond the `failed_permanent` Inbox item and the degradation notice (§12E).

**Explicitly NOT in this build:** `search_my_words` (V2) · presentation studio (V3) · voice/podcast ingestion (V4) · Deep Past binding / recall quests (V5) · anything Track B · knowledge-doc migration · TTS anything.

## 2. Exit gates (all must pass before a merge is even asked)

- The repo's full gate: typecheck + full test suite + web build (both lanes rule).
- The design's acceptance criteria as tests: §§14 (1–10) + 18.5 (11–15) — byte fidelity, extraction independence, regeneration independence, idempotent replay, correction determinism, adversarial cross-space isolation, offline FTS-only retrieval with announced degradation, honest persistence failure, timezone suite (America/New_York + Pacific/Kiritimati), forget cascade, dependency-aware erasure sweep against the E2 inventory, single-winner extraction race, export/restore round-trip.
- §18.4 items 1–2 as tests: bootstrap-vs-migration schema agreement (fresh + legacy-shaped DBs); space-erasure completeness incl. new FTS/vec rows.
- Post-build: ChatGPT audit of the increment (default lane), findings become the fix list. **Merge and deploy remain the owner's separate taps, as always.** Deploy additionally requires the §18.4 checklist: fresh export + `brain.db` backup + the owner's downgrade acknowledgment.

## 3. Queue proposal (Gate 4 — the repo chat determines; this is a proposal to it, not a decision)

Current repo-chat state (from memory, 2026-10-23): tab-by-tab audit program running (Pass 3 Observatory done; Money pitfall-hunt in flight); **GH-19 stands as the highest-priority trust correction candidate** and still needs its own design + authorization; ADR-020 implementation unauthorized; Worlds P2-4 build awaiting its own word in the Worlds chat.

Proposal:
1. **V1 does not leapfrog GH-19.** GH-19's disposition (design + owner authorization in the repo chat) goes first or the repo chat explicitly rules otherwise.
2. **V1 does not interleave with the in-flight pitfall-hunt fixes** — one schema-touching branch at a time on the single deploy branch `claude/soumaya-second-brain-v1-m4z4hc`.
3. When the repo chat slots it, V1 builds as **one branch, one increment**, against this package's §1 scope; scope questions that arise mid-build return to the design gate (§21 qualification), they are not patched around.
4. Worlds P2-4 and V1 are independent in content but share the deploy branch — the repo/Worlds chats' existing sequencing discipline governs; this package claims no priority over P2-4 either.

## 4. Risks carried into the build (from design §20, restated for the decision)

ASR truth ceiling (V1 is typed/telegram text — the ceiling binds V4, not this build) · snapshot/export residue on forgetting (disclosed at forget time) · downgrade invisibility (procedural gate at deploy) · monotonic storage growth (no quota in V1; brain is small today) · two search homes until documents migrate someday (accepted).

## 5. The decision requested

**Authorize the V1 build** as scoped in §1, gated by §2, queued per §3 — to be executed in the repo chat's lanes when it slots the work — **or hold** (design stays of record; evidence stays valid; nothing expires).

Authorization here means: the build may start when the queue proposal is honored. It does **not** mean merge, deploy, or any V2–V6/Track B work.
