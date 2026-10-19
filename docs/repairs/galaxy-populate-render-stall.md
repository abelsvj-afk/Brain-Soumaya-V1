# Galaxy populate-path render-stall repair — design

**Status:** DRAFT rev 7 — revised per ChatGPT design-review round 6 (one
remaining blocker: 50,000-id predicate vs SQLite bind-variable limit).
For re-review. **No implementation authorized.**
**Branch:** `fix/galaxy-populate-render-stall` (base: `claude/soumaya-second-brain-v1-m4z4hc` @ `06d997c3`)
**Date:** 2026-10-18 (rev 7)
**Reviewers:** ChatGPT (relayed), owner

This is the canonical review document for this repair (per repo review workflow:
one canonical file, all rounds point here). Paste chunks are over.

---

## 1. Problem

Ingesting a new memory can freeze the galaxy, and the new memory often never
appears at all. Three confirmed defects, all on the populate path:

- **P0-1 — links are never identity-preserved across refreshes.**
  `mergeGraphData` (`packages/web/src/App.helpers.ts:61-63`) reuses node
  objects per id but returns `links: fresh.links` untouched. three-forcegraph's
  digest keys links by object identity (same mechanism commit `1cfc0f49` proved
  for nodes), so every post-ingest `refresh()` disposes and rebuilds **every
  link mesh** — new geometry + full GPU re-upload per link, plus a 30-tick
  cooldown reheat. `App.helpers.test.ts:82-89` currently *asserts* the
  pass-through; that test must change with this repair.
- **P0-2 — `fireLink()` triggers a full-galaxy teardown on the populate path.**
  `fireLink` (`packages/web/src/graph/Graph3D.tsx:1624-1631`) calls
  `fg.refresh()`, which sets three-forcegraph's internal `_flushObjects` and
  unconditionally clears **and disposes every tracked node AND link Object3D**,
  bypassing the node-identity fix. Trigger chain: ingest → new associative
  links → Soumaya fastens them → `fireLink` → full rebuild. Also fires on the
  ~10s link-tending cadence. `1cfc0f49`'s own message flagged this as "NOT
  touched in this commit."
- **P0-3 — the server silently drops new memories from the galaxy.**
  `overview()` (`packages/server/src/graph/service.ts:126`) returns the
  top-`limit` (default 300) nodes **by degree**. A fresh memory (degree ~0–6)
  is among the least likely to survive the cut on brains >300 nodes, so the
  ingest celebration (`spawnBurst`/`focusNode`) silently no-ops.

P1 (after the critical path is fixed): serial LLM `validateLink` loop in
ingest (`associativeLink.ts:68-107`, `pipeline.ts:119-131`); `Object.assign`
mutating previous React state (`App.helpers.ts:49-58`).

**Deferred (explicitly out of scope for this repair):** the 10s O(L log L)
link-health sort (`Graph3D.tsx:1811-1824`). Not needed for the three P0
defects; an incremental structure would enlarge risk and test surface.

---

## 2. Acceptance criteria

1. **Rendering:** refreshing an unchanged graph preserves existing node and
   link object identities wherever safe, without corrupting d3-resolved
   endpoints.
2. **GPU lifecycle:** ordinary link tending does not trigger a full-galaxy
   disposal and reconstruction.
3. **Memory visibility:** a successful ingest makes its new memories
   discoverable in the galaxy, even when the brain exceeds 300 nodes.
4. **Bounded performance:** deliberate limits on rendering and graph payload
   size are retained — **every** edge-returning read has an enforceable
   result bound with explicit continuation semantics; nothing is silently
   truncated.
5. **State correctness (precise invariant):** merge operations may mutate
   only objects that are included in the returned (new) state, and only with
   fields from the shared server contract types (`GraphNode`/`GraphEdge`).
   They never write client-only fields (d3-resolved `source`/`target` object
   references; `x`/`y`/`z`/`fx`/`fy`/`fz`/`vx`/`vy`/`vz` and other simulation
   fields), never mutate objects dropped from the new state, and never copy
   unknown/extra fields from a fresh payload onto a retained object.
6. **Evidence:** regression tests, typecheck, test suite, production build,
   and real-device measurements substantiate the repair.

---

## 3. Design decisions

### D1 — `mergeGraphLinks` keyed by edge id (closes P0-1)

- New `mergeGraphLinks(prevLinks, freshLinks)` in `App.helpers.ts`;
  `mergeGraphData` returns `{ nodes: mergeGraphNodes(…), links: mergeGraphLinks(…) }`.
- **Merge key is the edge's stable database `id`** (present on client link
  objects — cf. `Graph3D.tsx:3618` `l.id`), **not endpoint pairs.** Rationale:
  the client's `linkKey` helper is *undirected* (`a<b ? "a-b" : "b-a"`,
  `graph3dHelpers.ts`) while `EdgesRepo.exists()` is *directed*
  (`edges.repo.ts`), so reversed pairs (A→B and B→A) can legally coexist;
  endpoint-pair keying would merge two distinct relationships. Id-keying
  kills the parallel/reversed question entirely.
- For a matching id: copy **scalar fields only** (`weight`, `relationship`,
  activity/label/color inputs) onto the existing link object via explicit
  field assignment — **never `source`/`target`**, preserving d3-force's
  in-place resolved node references (the reason `1cfc0f49` excluded links).
- New ids pass through as fresh objects (correct one-time build); vanished
  ids are dropped (digest removes them).
- Satisfies criteria 1 and 5.

### D2 — remove `fg.refresh()` from `fireLink`, with a concrete replacement trigger (closes P0-2)

- **Confirmed against source:** `fireLink`'s only state write is
  `linkHealthRef.current.set(key, Date.now())` (`Graph3D.tsx:1628`) — a ref,
  which triggers **no React render**. The `linkColor` accessor is unmemoized,
  but without a render three-forcegraph's digest never re-runs, so deleting
  `refresh()` with no replacement would silently kill the flash. The design
  therefore specifies the replacement, not just the deletion:
- Replace `f?.refresh?.()` with a minimal pulse-tick state increment
  (e.g. `setPulseTick(t => t + 1)`) inside `fireLink`. The re-render changes
  the unmemoized `linkColor` accessor's identity, which drives
  three-forcegraph's normal cheap per-render material digest — the flash
  applies through the existing accessor path, with no `_flushObjects`.
- **Conditional:** the `refresh()` removal ships only if on-device evidence
  shows the flash visibly applies via the tick path. Fallback: a refresh
  scoped to genuinely first-seen link keys only, never repair pulses.
- `noteRefreshInvoked()` diagnostic call stays; expected to go quiet in
  normal use. Satisfies criterion 2.

### D3 — `overview()` honors explicit `includeIds`, with chunking, edge completion, and bounded edge reads (closes P0-3)

- Server: `overview(limit, includeIds?)` returns the union of (a) top-`limit`
  by degree and (b) `byIds(includeIds)` **validated against the current
  space** (cross-space ids filtered — never leaked), bounded:
  `INCLUDE_IDS_CAP = 200` per request.
- **Overflow contract (no silent loss):** the server rejects `includeIds`
  longer than 200 with an explicit 400 — never truncates. The client chunks
  oversized id lists into ≤200 requests and unions the results, so the
  "new memories always appear" guarantee holds even for bulk offline sync.
- **Edge completion without chunking (rev 6):** chunked overview requests each
  resolve edges only within their own id set, so an edge between two nodes
  in *different* chunks would be omitted from every response. Rev 5 closed
  this with per-chunk incident queries plus an H0 high-water-mark and
  reconciliation sweeps — but round 5 showed a write can still land *after*
  its chunk's sweep (e.g. chunk A's sweep done, edge inserted between two
  chunk-A nodes while chunk B's sweep runs), and no finite sweep ordering
  closes that window. The structural fix: **remove the chunking, not the
  race.** Chunking exists only because GET query strings cannot carry large
  id sets; moving the id set into a POST body removes the reason for
  multiple sequential streams entirely:
  - New endpoint `POST /api/graph/edges`: JSON body `{ids: number[]}`
    (the full union id set `U`; bound `MAX_UNION_IDS = 50000`, over-cap →
    explicit 400), query `?cursor=`. Returns all space-scoped edges
    **incident to** any given id (`source IN (…)` OR `target IN (…)`),
    ordered by edge id ASC, cursor-paginated (cursor = last returned edge
    id), `MAX_EDGES_PER_RESPONSE = 5000` per page. Response:
    `{edges, nextCursor | null}`. (Implementation note: configure an
    adequate JSON body limit for this route — Express defaults to 100kb,
    and a large union exceeds that; e.g. 5 MB.)
  - **Database-safe predicate evaluation (rev 7):** binding every id as a
    separate SQL parameter would need ~2×50,000 binds for
    `source IN (U) OR target IN (U)`, exceeding SQLite's bind-variable
    limit (`SQLITE_MAX_VARIABLE_NUMBER`, 32,766 on modern builds, 999 on
    older ones) on most builds — a request valid under the API contract
    could fail at the database layer. The server therefore **never binds
    the id set**. Instead, per request, in one synchronous block:
    1. `CREATE TEMP TABLE want_ids (id INTEGER PRIMARY KEY)` (temp tables
       are connection-scoped; see lifecycle note below).
    2. `INSERT INTO want_ids SELECT value FROM json_each(?)` — a **single**
       bind parameter carrying the JSON id array (JSON1 is compiled into
       better-sqlite3's SQLite). No batching, no bind-count concern.
    3. Incident query joins the indexed temp table:
       `… WHERE e.space_id = ? AND e.id > ? AND (e.source IN (SELECT id FROM
       want_ids) OR e.target IN (SELECT id FROM want_ids)) ORDER BY e.id
       ASC LIMIT 5000` — each row's membership test is an indexed lookup,
       not a 50k-way bind list.
    4. `DROP TABLE want_ids` in a `finally`.
    Lifecycle: the create/fill/query/drop sequence must execute as one
    synchronous block with **no `await`** between steps (better-sqlite3
    calls are synchronous), so interleaved requests on a shared connection
    can never observe another request's temp rows; the `finally` drop
    guarantees no leakage even on error. This makes the design independent
    of the build's bind-variable limit — preferred over verifying the
    limit and lowering the cap, which would stay fragile across builds.
    The same strategy backs `overview()`'s internal edge fetch.
  - Client: build the full union id set `U` (dedup of top-300 ids ∪ all
    node-chunk ids; held locally); run **one** cursor stream with
    `id > :cursor` and **no upper bound** to null cursor; keep edges with
    **both endpoints in U** (client-side filter); dedupe by edge id when
    unioning with overview's own links.
  - **Coverage argument:** the stream is a single id-ordered cursor stream
    over the fixed predicate P = (incident to U, space-scoped). Edge ids
    are monotonic (AUTOINCREMENT, never reused): any edge satisfying P that
    is inserted during the stream receives an id greater than every id the
    stream has already returned, so a later page's `id > :cursor`
    necessarily includes it. When the stream terminates (null cursor), it
    has therefore returned **every edge satisfying P present at the final
    page's read instant** — concurrent writes are caught by the stream
    itself, not by a follow-up protocol. There is no per-chunk sweep
    ordering, so round 5's race has nowhere to live. This is the
    well-defined consistent view the review asked for; post-view writes are
    handled by the stream's own self-completion, and anything landing after
    the final read instant is covered by the next refresh.
  - **Honest residual (stated, not hand-waved):** `U` is fixed when the
    node-chunking starts. Nodes created after that instant are not in `U`;
    their edges arrive via the next refresh (which re-runs
    overview+includeIds with the new ids). The client claims nothing beyond
    `U`-as-captured. Edges deleted mid-stream may appear stale until the
    next refresh — harmless. Node chunking itself needs no H0 or sweep:
    `byIds` reads are exact per chunk and cannot "miss" a node.
- **Enforceable edge-result bound (rev 4):** `MAX_EDGES_PER_RESPONSE = 5000`
  (provisional constant) applies to **every** edge-returning read, including
  `overview()`'s internal edge fetch — which gains an additive
  `nextEdgeCursor` field (existing shape otherwise unchanged; in-repo
  consumers must follow cursors, old readers degrade to first-page rather
  than break). A non-null cursor is the explicit "more to fetch" signal;
  silent truncation is not permitted anywhere. `overview()`'s single-stream
  internal edge fetch has no cross-stream hole and needs no additional
  machinery.
- **Result-size bounds (provisional constants — the invariants, not the
  numbers, are the contract):**

  | scope | nodes | edges |
  |---|---|---|
  | one overview request | ≤ `limit` (300) + 200 = 500 | ≤ 5000, cursor-paginated |
  | one `POST /api/graph/edges` stream | n/a (≤50000 ids in body) | ≤ 5000/page, single id-ordered stream, self-completing under concurrent writes |
  | client union | ≤ 300 + N_new (deduped); U fixed at chunking start | overview links ∪ completion edges, deduped by id; complete w.r.t. final read instant |

- **Visibility guarantee, precisely:** every requested node id that exists
  in the space appears in the final union. Every edge incident to `U` with
  both endpoints in `U`-as-captured that is present at the completion
  stream's final read instant appears. Nodes created after `U` was captured
  — and their edges — arrive via the next refresh; the client claims nothing
  beyond `U`-as-captured. A new memory's associative neighbors are existing
  hubs, normally inside the top-300; the residual case (neighbor outside
  the cut) drops that edge from view but never the node.
- Client: `getGraph` accepts `includeIds`; `refresh(newIds)` passes the ids
  from its own ingest response, then runs chunking + edge completion as
  specified. Default `limit=300` behavior unchanged otherwise. Satisfies
  criteria 3 and 4.

### D4 — parallelize associative-link LLM validation, with specified slot lifecycle and cancellation (P1)

- **Concurrency model (decided):**
  - The per-node validation loop in `associativeLink` keeps its sequential
    cap logic, but `validateLink` calls within a node run with concurrency
    cap 3.
  - Across nodes: at most 2 concurrent `associativeLink` jobs
    (`pipeline.ts`).
  - **Aggregate bound: at most 6 in-flight `validateLink` calls.**
- **Slot lifecycle (specified):**
  - *Reserve:* synchronously increment a `reserved` counter in the same tick
    as the cap check, before dispatching the `validateLink` promise. The
    cap check becomes `regularLinks + reserved >= cap` → skip/record
    withheld. Synchronous reservation is what makes the cap race-free under
    JS's run-to-completion semantics, regardless of completion order.
  - *Release:* in a `finally` block on the individual validation promise —
    covers success, validation-negative, timeout, and exception uniformly.
    Release is per-promise, so out-of-order completion cannot corrupt
    accounting: each slot is freed exactly once, by its own settlement.
  - *Reservation→acceptance transition:* on a positive validation, the
    block `reserved--; regularLinks++; created.push(edgesRepo.create(…))`
    executes **synchronously with no `await` between the statements** — a
    single run-to-completion unit, so no concurrent completion can observe
    an intermediate state where the slot is released but the link is not
    yet counted. (better-sqlite3 calls are synchronous; no interleaving is
    possible here.)
- **Cancellation (rev 4 — required, not optional):** the 30s per-call timeout
  must actually stop the underlying work, not just reject a wrapper —
  otherwise a timed-out call keeps running while its freed slot admits new
  work, violating the aggregate bound physically. D4 therefore requires
  threading an `AbortSignal` through `validateLink` into the provider call
  (additive optional `{ signal }` parameter); on timeout the controller
  aborts, the fetch layer tears down the socket, and the `finally` release
  is then sound. If during implementation a provider path genuinely cannot
  honor abort, that is an implementation-review finding that blocks D4 —
  the design does not bless a non-cancellable timeout path.
- **Failure semantics:** a single validation failure (throw/timeout/abort)
  is treated as not-linked, logged, and the ingest continues — one bad call
  never aborts the ingest or loses the memory. `reserved`/`regularLinks`
  are per-node locals, so a failure in one node cannot affect another's
  accounting.
- **Rate limits:** the existing `resilient.ts` degradation handling applies;
  the caps are chosen to stay within typical provider limits.
- Latency improvement is a **hypothesis until measured** (no speedup claimed
  in this design); the on-device gate measures it.

### D5 — field-allowlist merges (P1, in scope as reframed)

- Changing `Object.assign(existing, fresh)` to explicit assignments is **not**
  the fix (it still mutates). The fix: merges copy only fields in an
  explicit allowlist drawn from the shared server contract types, for both
  nodes and links — this is what makes criterion 5 implementable and
  testable. Applies to `mergeGraphNodes` and the new `mergeGraphLinks`.

---

## 4. Test & verification plan

1. Unit: `mergeGraphLinks` — id-keyed reuse, scalar update, new-id
   pass-through, vanished-id drop, reversed-pair case (A→B + B→A stay
   distinct), and the criterion-5 contract (client-only fields untouched,
   dropped objects unmutated, unknown fields not copied). Update
   `App.helpers.test.ts:82-89` (it currently asserts the old pass-through).
2. D2: assert `fireLink` no longer calls `refresh()` and increments the
   pulse tick; component-level test that `linkColor` output reflects updated
   activity after the tick. **Visual flash confirmation on-device is a gate.**
3. D3: missing ids skipped, duplicates deduped, cross-space ids filtered,
   over-cap → explicit 400, client chunking unions nodes correctly;
   **cross-chunk edges** — connected nodes placed in different *edge-request*
   chunks assert the edge is present after completion; **edge bound** — a
   chunk with >5000 incident edges returns exactly 5000 + non-null
   `nextCursor`, cursor-following yields the complete deduped set ending
   with null cursor (no silent truncation); **concurrent-write coverage**
   — insert an edge between two U nodes *while* the single completion
   stream is mid-flight (after several pages): assert it appears before the
   null cursor; assert the old per-chunk sweep race cannot occur because the
   protocol has no per-chunk sweep phase (regression test for the round-5
   scenario: the same setup against the rev-5 protocol would miss it);
   **union-id over-cap** — >50000 ids → explicit 400; **bind-limit safety**
   — a request with the maximum accepted id count (50000) executes
   end-to-end through the temp-table strategy (proves the documented
   contract is database-executable, not just HTTP-accepted); temp-table
   lifecycle — sequential requests never observe each other's ids, and an
   error mid-request still drops the temp table (no leakage); node
   selection and edge retrieval stay space-scoped and bounded per the
   bounds table.
4. D4: `maxLinks` cap never exceeded under concurrent validation with
   **out-of-order completion** (randomized delays, reverse-order
   resolutions); **failure injection** (forced throws/timeouts) releases all
   slots (`reserved` returns to 0), ingest completes, failures recorded as
   not-linked; **timeout cancellation** — a validation that would run past
   the timeout observes the abort signal and stops its underlying work
   (assert signal fired + mock work halted); **accounting transition** —
   interleaved positive completions never exceed the per-node cap (assert
   via the sync-block invariant under randomized completion order);
   aggregate in-flight bound (≤6 physical dispatches) holds under a stress
   run; per-node accounting isolation (a failing node doesn't affect its
   sibling's cap); **implementation acceptance (not mock-only):** during
   implementation review, verify the abort reaches the real transport /
   provider operation (socket teardown on the actual provider client) and
   that the physical ≤6 bound holds — a mock observing the signal proves
   dispatch, not cessation.
5. `npm run typecheck`, full `npm test`, production web build.
6. On-device (Samsung Xclipse 530): existing in-session `autoRenderDiag`
   harness + BAD/GOOD snapshot before/after D1+D2.
7. End-to-end populate flow: ingest → memory appears → celebration fires →
   Soumaya fastens without a freeze, on a >300-node brain (D3); bulk offline
   sync exercises the chunking + edge-completion path.

---

## 5. Explicitly out of scope

Approving this design does **not** authorize: implementation of anything
outside D1–D5; changes to `master`; deployment or production data changes;
any schema migration; the deferred link-sort cleanup. Implementation needs a
separate owner approval naming this document and its revision.

---

## 6. Review log

- 2026-10-18 — rev 1 (commit `65104adc`): DRAFT from the read-only audit +
  ChatGPT's initial relayed review.
- 2026-10-18 — ChatGPT design-review round 1: **revise before approval**,
  4 blockers (D1/D5 vs criterion 5; D2 flash evidence; D3 overflow
  semantics; D4 concurrency underspecified). Decisions: 200-id cap retained
  provisional with explicit overflow contract; link-sort cleanup deferred.
- 2026-10-18 — rev 2 (commit `45a63061`): criterion 5 restated as a precise
  invariant; D2 specifies the pulse-tick replacement trigger and stays
  conditional on on-device evidence; D3 adds 400-on-over-cap + client
  chunking and the exact visibility guarantee; D4 chooses the reservation
  model with aggregate bound 6 and per-call failure isolation; D5 reframed
  as field-allowlist merges; test plan extended.
- 2026-10-18 — ChatGPT design-review round 2: two remaining points —
  D3 cross-chunk edges + overall result-size bounds; D4 slot lifecycle
  (release on failure) + failure/out-of-order test coverage.
- 2026-10-18 — rev 3 (commit `1fc0beca`): D3 adds the edge-completion step
  (`GET /api/graph/edges?ids=` over the full union id set, `EDGE_IDS_CAP =
  2000`) and the explicit bounds table; D4 specifies reserve-synchronously /
  release-in-`finally` / 30s per-call timeout, per-node accounting
  isolation, and the failure/out-of-order test cases.
- 2026-10-18 — ChatGPT design-review round 3: **revise before approval**,
  3 gaps — D3 edge coverage across edge-request chunks + enforceable
  edge-result bound; D4 timeout-vs-cancellation + slot-to-cap accounting
  transition.
- 2026-10-18 — rev 4 (this revision): D3 edge contract changed to
  **incident-edge queries per chunk + client-side both-in-U filter +
  id-dedupe**, with a coverage argument; `MAX_EDGES_PER_RESPONSE = 5000`
  with cursor pagination on every edge-returning read (additive
  `nextEdgeCursor`; null = complete; no silent truncation); bounds table
  updated. D4 requires `AbortSignal` threaded through `validateLink`
  (timeout = real abort; non-cancellable paths block D4 at implementation
  review); reservation→acceptance transition specified as a single
  synchronous block (no observable intermediate state); tests added for
  abort enforcement, cross-edge-chunk coverage, and the edge bound.
- 2026-10-18 — ChatGPT design-review round 4: **revise before approval**,
  one remaining blocker — D3's completeness guarantee contradicts the
  accepted concurrent-write race (an insert landing behind a completed
  chunk's cursor is missed despite null cursors). D4's mock-vs-transport
  cancellation distinction noted as an implementation acceptance condition,
  not a redesign blocker.
- 2026-10-18 — rev 5 (this revision): the contradiction is resolved by
  replacing the "accepted residual" with an H0 high-water-mark +
  per-chunk reconciliation sweep contract — coverage argument and honest
  residual (`U`-as-captured scoping) stated explicitly; bounds table and
  visibility guarantee updated; tests added for the behind-the-cursor
  insert and the documented residual; D4 test plan gains the
  abort-reaches-transport implementation acceptance condition. Submitted
  for re-review.
- 2026-10-18 — ChatGPT design-review round 6: **revise before approval**,
  one remaining blocker — the 50,000-id predicate would need ~100k SQL
  bind parameters, exceeding SQLite's bind-variable limit on most builds;
  a contract-valid request could fail at the database layer.
- 2026-10-18 — rev 7 (this revision): the server never binds the id set —
  `json_each(?)` expands the JSON array into an indexed temp table with a
  single bind parameter, and the incident query joins it (indexed
  membership lookups); create/fill/query/drop runs as one synchronous
  block with `finally` cleanup, making the design independent of the
  build's bind-variable limit. Same strategy backs `overview()`'s edge
  fetch. Tests added for max-id-count executability, over-cap rejection,
  and temp-table lifecycle. The single globally ordered cursor stream and
  its concurrent-write guarantee are unchanged. Submitted for re-review.
- 2026-10-18 — ChatGPT design-review round 5: **revise before approval**,
  one remaining race — a write can land after its chunk's reconciliation
  sweep (chunk A swept, edge inserted between two chunk-A nodes while chunk
  B's sweep runs), and no finite sweep ordering closes that window.
- 2026-10-18 — rev 6 (this revision): removed the chunking instead of the
  race — `POST /api/graph/edges` carries the full union id set in the body
  (≤50000, else 400; JSON body limit raised for the route), making edge
  completion a **single** id-ordered cursor stream; monotonic ids make the
  stream self-completing under concurrent writes (coverage argument), so
  the round-5 race has nowhere to live and no H0/sweep machinery is needed.
  Bounds table, guarantee, and tests updated; D4 unchanged. Submitted for
  re-review.
