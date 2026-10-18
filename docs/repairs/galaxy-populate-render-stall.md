# Galaxy populate-path render-stall repair — design

**Status:** DRAFT rev 2 — revised per ChatGPT design-review round 1 (verdict:
revise before approval). For re-review. **No implementation authorized.**
**Branch:** `fix/galaxy-populate-render-stall` (base: `claude/soumaya-second-brain-v1-m4z4hc` @ `06d997c3`)
**Date:** 2026-10-18 (rev 2)
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
   size are retained.
5. **State correctness (precise invariant):** merge operations may mutate
   only objects that are included in the returned (new) state, and only with
   fields from the shared server contract types (`GraphNode`/`GraphEdge`).
   They never write client-only fields (d3-resolved `source`/`target` object
   references; `x`/`y`/`z`/`fx`/`fy`/`fz`/`vx`/`vy`/`vz` and other simulation
   fields), never mutate objects dropped from the new state, and never copy
   unknown/extra fields from a fresh payload onto a retained object.
   *(Rev 2: restated — the previous "never silently mutate prior React state"
   contradicted D1, since identity preservation is itself intentional
   in-place mutation of the objects that become the new state.)*
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

### D3 — `overview()` honors explicit `includeIds`, with overflow semantics (closes P0-3)

- Server: `overview(limit, includeIds?)` returns the union of (a) top-`limit`
  by degree and (b) `byIds(includeIds)` **validated against the current
  space** (cross-space ids filtered — never leaked), bounded: cap 200.
  Edges via `within()` over the union id set.
- **Overflow contract (no silent loss):** the server rejects `includeIds`
  longer than 200 with an explicit 400 — never truncates. The client chunks
  oversized id lists into ≤200 requests and unions the results, so the
  "new memories always appear" guarantee holds even for bulk offline sync.
- **Guarantee, precisely:** every requested node id that exists in the space
  appears in the response. Edges appear for pairs where both endpoints are
  in the returned set (a new memory's associative neighbors are existing
  hubs, normally inside the top-300; the residual case — neighbor outside
  the cut — drops that edge from view but never the node).
- Client: `getGraph` accepts `includeIds`; `refresh(newIds)` passes the ids
  from its own ingest response. Default `limit=300` behavior unchanged
  otherwise. Satisfies criteria 3 and 4.

### D4 — parallelize associative-link LLM validation, with a chosen concurrency model (P1)

- **Model (decided, not open):**
  - The per-node validation loop in `associativeLink` keeps its sequential
    cap logic, but `validateLink` calls within a node run with concurrency
    cap 3 using **synchronous slot reservation**: a slot is reserved before
    dispatch and released on negative/timeout, so `maxLinks` can never be
    exceeded regardless of completion order.
  - Across nodes: at most 2 concurrent `associativeLink` jobs
    (`pipeline.ts`).
  - **Aggregate bound: at most 6 in-flight `validateLink` calls.**
- **Failure handling:** per-call try/catch — a single validation failure is
  treated as not-linked, logged, and the ingest continues; one bad call never
  aborts the ingest or loses the memory.
- **Rate limits:** the existing `resilient.ts` degradation handling applies;
  the caps are chosen to stay within typical provider limits.
- Latency improvement is a **hypothesis until measured** (the earlier "÷3"
  estimate is withdrawn); the on-device gate measures it.

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
   over-cap → explicit 400, client chunking unions correctly, node selection
   and edge retrieval stay space-scoped and bounded.
4. D4: `maxLinks` cap cannot be exceeded under concurrent validation
   (slot-reservation test); single validation failure doesn't abort ingest;
   aggregate in-flight bound holds.
5. `npm run typecheck`, full `npm test`, production web build.
6. On-device (Samsung Xclipse 530): existing in-session `autoRenderDiag`
   harness + BAD/GOOD snapshot before/after D1+D2.
7. End-to-end populate flow: ingest → memory appears → celebration fires →
   Soumaya fastens without a freeze, on a >300-node brain (D3); bulk offline
   sync exercises the chunking path.

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
- 2026-10-18 — rev 2 (this revision): criterion 5 restated as a precise
  invariant; D2 specifies the pulse-tick replacement trigger and stays
  conditional on on-device evidence (source-confirmed: no render follows the
  ref write today); D3 adds 400-on-over-cap + client chunking and the exact
  visibility guarantee; D4 chooses the reservation model with aggregate bound
  6 and per-call failure isolation; D5 reframed as field-allowlist merges;
  test plan extended per the review. Submitted for re-review.
