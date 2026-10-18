# Galaxy populate-path render-stall repair — design

**Status:** DRAFT — for design review. No implementation authorized.
**Branch:** `fix/galaxy-populate-render-stall` (base: `claude/soumaya-second-brain-v1-m4z4hc` @ `06d997c3`)
**Date:** 2026-10-18
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
ingest (`associativeLink.ts:68-107`, `pipeline.ts:119-131`); the 10s
O(L log L) link-health sort (`Graph3D.tsx:1811-1824`); `Object.assign`
mutating previous React state (`App.helpers.ts:49-58`).

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
5. **State correctness:** merges never silently mutate prior React state or
   erase valid client-side simulation fields.
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
- Satisfies criteria 1 and 5 (explicit copies replace the `Object.assign`
  pattern for links; node merge is unchanged by this decision).

### D2 — remove `fg.refresh()` from `fireLink` (closes P0-2)

- Delete the `f?.refresh?.()` call (`Graph3D.tsx:1630`). The brightness flash
  is driven by `getLinkActivity(l)` inside the `linkColor` accessor, which is
  deliberately unmemoized so its identity change re-triggers three-forcegraph's
  cheap material digest on every render — the flash still applies without
  `_flushObjects`.
- Fallback (only if review/testing shows the flash doesn't apply): scope a
  refresh to genuinely first-seen link keys, never repair pulses.
- `noteRefreshInvoked()` diagnostic call stays; expected to go quiet in
  normal use. Satisfies criterion 2.

### D3 — `overview()` honors explicit `includeIds` (closes P0-3)

- Server: `overview(limit, includeIds?)` returns the union of (a) top-`limit`
  by degree and (b) `byIds(includeIds)` **validated against the current
  space**, bounded (cap 200); edges via `within()` over the union id set.
  Route accepts `?includeIds=1,2,3`.
- Client: `getGraph` accepts `includeIds`; `refresh(newIds)` passes the ids
  returned by its own ingest response, so a memory always appears in the
  galaxy it just populated. Default `limit=300` behavior unchanged otherwise.
- Satisfies criteria 3 and 4 (bounded; no silent exclusion of the space's
  hubs, no unbounded payload growth).

### D4 — parallelize associative-link LLM validation (P1)

- `validateLink` calls run with concurrency cap 3 (`Promise.all`-with-limit);
  per-node `associativeLink` calls in `pipeline.ts` run with cap 2–3. The
  per-node `maxLinks` cap logic stays sequential per node (or is made atomic
  per node) so cap semantics don't change. Existing `resilient.ts`
  degradation handling covers provider rate limits. Expected effect: ingest
  latency roughly ÷3 on multi-hit ingests.

### D5 — small correctness/hygiene items (P1, optional in this repair)

- Replace `Object.assign(existing, fresh)` in `mergeGraphNodes` with explicit
  field copies (criterion 5).
- The 10s link-health full sort may stay (low cadence) or move to an
  incremental coldest-links structure; decision at implementation-review
  time, not in this design.

---

## 4. Test & verification plan

1. Unit: `mergeGraphLinks` — id-keyed reuse, scalar update, new-id
   pass-through, vanished-id drop, and a reversed-pair case (A→B + B→A stay
   distinct). Update `App.helpers.test.ts:82-89` (it currently asserts the
   old pass-through).
2. `npm run typecheck`, full `npm test`, production web build.
3. On-device (Samsung Xclipse 530): existing in-session `autoRenderDiag`
   harness + BAD/GOOD snapshot before/after D1+D2.
4. End-to-end populate flow: ingest → memory appears → celebration fires →
   Soumaya fastens without a freeze, on a >300-node brain (D3).

---

## 5. Explicitly out of scope

Approving this design does **not** authorize: implementation of anything
outside D1–D5; changes to `master`; deployment or production data changes;
any schema migration. Implementation needs a separate owner approval naming
this document.

---

## 6. Review log

- 2026-10-18 — DRAFT written from the read-only audit
  (`~/workspace/brain-soumaya-v1-audit/AUDIT_REPORT.md`) + ChatGPT's relayed
  review. Open design questions for reviewers: (a) is the 200-cap on
  `includeIds` the right bound; (b) D5 second bullet — fix now or defer.
