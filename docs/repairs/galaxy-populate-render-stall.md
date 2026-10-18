# Galaxy populate-path render-stall repair — design

**Status:** DRAFT rev 4 — revised per ChatGPT design-review round 3 (three
remaining gaps: cross-chunk edge coverage, enforceable edge-result bound,
timeout/cancellation + slot accounting). For re-review. **No implementation
authorized.**
**Branch:** `fix/galaxy-populate-render-stall` (base: `claude/soumaya-second-brain-v1-m4z4hc` @ `06d997c3`)
**Date:** 2026-10-18 (rev 4)
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
- **Edge completion across chunks (rev 4):** chunked overview requests each
  resolve edges only within their own id set, so an edge between two nodes
  in *different* chunks would be omitted from every response. Node chunks
  are therefore only a node-inclusion mechanism; edge coverage is resolved
  separately and exactly once:
  - New endpoint `GET /api/graph/edges?ids=&cursor=`: returns all
    space-scoped edges **incident to** any given id (`source IN (…)` OR
    `target IN (…)`), ordered by edge id ASC, cursor-paginated (cursor =
    last returned edge id). Response: `{edges, nextCursor | null}` —
    a null cursor is the explicit completeness signal.
  - Client algorithm: build the full union id set `U` (dedup of top-300 ids
    ∪ all chunk ids; held locally — only *sending* it is bounded);
    partition `U` into ≤2000-id chunks; for each chunk follow cursors to
    completion; keep edges with **both endpoints in U** (client-side
    filter); dedupe by edge id across chunks/pages.
  - **Coverage argument:** every edge with both endpoints in `U` is incident
    to the chunk containing at least one of its endpoints, so it is returned
    by that chunk's incident query and passes the both-in-U filter. Complete
    across chunks and pages by construction — the same defect cannot recur
    a layer down.
- **Enforceable edge-result bound (rev 4):** `MAX_EDGES_PER_RESPONSE = 5000`
  (provisional constant) applies to **every** edge-returning read, including
  `overview()`'s internal edge fetch — which gains an additive
  `nextEdgeCursor` field (existing shape otherwise unchanged; in-repo
  consumers must follow cursors, old readers degrade to first-page rather
  than break). A non-null cursor is the explicit "more to fetch" signal;
  silent truncation is not permitted anywhere. Concurrent ingest during
  pagination is an accepted residual (id-ordered cursor keeps the window
  small; the galaxy refreshes anyway).
- **Result-size bounds (provisional constants — the invariants, not the
  numbers, are the contract):**

  | scope | nodes | edges |
  |---|---|---|
  | one overview request | ≤ `limit` (300) + 200 = 500 | ≤ 5000, cursor-paginated |
  | one `/api/graph/edges` request | n/a (≤2000 ids in) | ≤ 5000, cursor-paginated |
  | client union, C chunks | ≤ 300 + N_new (deduped) | complete incident coverage over U, deduped by id |

- **Visibility guarantee, precisely:** every requested node id that exists
  in the space appears in the final union. Every edge whose both endpoints
  are in the final union id set appears (via edge completion). A new
  memory's associative neighbors are existing hubs, normally inside the
  top-300; the residual case (neighbor outside the cut) drops that edge
  from view but never the node.
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
   with null cursor (no silent truncation); node selection and edge
   retrieval stay space-scoped and bounded per the bounds table.
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
   sibling's cap).
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
  Submitted for re-review.
