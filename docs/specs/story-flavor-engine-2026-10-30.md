# Story Loom + Flavour engine — design spec (docs only, 2026-10-30)

*Owner: "spider web effect … weaving the story that works if things aren't linear … then the flavour engine on top … flavour, not mutate." Spec before code (Rule #1). Nothing built. Lore: `docs/lore/DRAFT_6_THE_LOOM.md`. Content storage: `docs/specs/lore-storage-2026-10-30.md`.*

## 1. Shape of the system
```
content (shared, read-only)         per-brain state (server, private)        presentation (web)
  entries + claims + variants  ──►   story_finds / links / notes   ──► Knowledge keys ┐
  graph (anchors, radials,           story_flavor_day (cached key)  ──► Flavor key     ├─► pickVariant() ─► text/tint/order
  spirals)                           + society currents (existing)                      ┘
```
Two inputs, one pure selector. **Knowledge** (finds) decides *what may be revealed*; **Flavor** decides *how it is voiced*. Neither mutates content.

## 2. Content model (extends the storage spec's `story.ts`)
```
Entry   { id, kind, world, reach, canon, anchors:[A1..A12], claims:[claimId], pairs:[id], provenance:[...],
          doorsIn:[doorId], text: Variants, secondReading?: Variants, reaction?: Record<npcId, Variants> }
Variants{ plain: string; warm?: string; grave?: string; special?: string }   // every key voices the SAME claims
Edge    { a, b, type: "possession"|"habit"|"provenance"|"echo"|"absence", evidence: string }
Anchor  { id, claims:[claimId] }
```
- A **claim** is an atomic fact with an id (`c.hesk.does-not-know-owner`). Variants may differ in words, never in claims.
- Authoring cost is bounded: **≤ 3 registers (+1 optional) per line**; `plain` is mandatory and is the offline/neutral fallback.

## 3. The web as a checked graph (the "it works" proof)
A pure function over content, run in a shared unit test (no server):
1. **Redundancy:** for every single removed node, every anchor stays reachable from every door-in rim node (graph is 2-connected between rim and anchors).
2. **Three doors:** every anchor-bearing claim has ≥ 3 distinct `doorsIn` and ≥ 2 independent routes (no shared node).
3. **No orphan:** every entry has ≥ 1 spiral edge to a different radial.
4. **No prerequisite:** no field expresses "requires entry X" — the schema has none.
5. **Convergence:** claims about one anchor never conflict unless declared in the `accounts` matrix (the five listed contradictions).
6. **Late binding:** a variant may use `{name:id}` placeholders resolved to a name if found, else to the entry's `trace` phrase; test that the unresolved form reads cleanly.
7. **Banned content:** no variant contains her name, nor places anything above Eternity.
Resonance ("tremor") is derived from this graph: on a find, neighbours (distance 1) get a cosmetic shimmer flag in the client; never a pointer.

## 4. Flavour key (pure, deterministic, stable)
```
FlavorKey = { tide: {first: Current, second: Current}, lean: [Lean, Lean], hour: HourBand, register: "plain"|"warm"|"grave" }
register  = pure function(tide, lean, hour, brainId, dayKey)   // seeded: same brain + day ⇒ same choice
```
- **Tide** reuses `computeSociety` currents (already private, opt-out, blended toward neutral). Nothing new leaves the server.
- **Leaning** is five coarse bins from **counts only**: worlds visited / dwell, recalls, missions closed + Journeys, chat turns + regards + concordance links, same-Hour returns — read from existing tables and the new story tables. No text is read. Bins are 3-level (low/mid/high) with **hysteresis** (change needs two consecutive days past a threshold) so flavour drifts like weather, never flickers.
- **Cache:** `story_flavor_day (space_id, day_key, key_json, computed_at)` — additive, idempotent, `space_id`-scoped, in `SPACE_SCOPED_TABLES`. One row per brain-day; deleting the brain deletes it. Offline/failed compute ⇒ neutral key.
- **Opt-out:** a `story_prefs.flavor_on` switch (default on, mirrors the Society's). Off ⇒ neutral key ⇒ `plain` everywhere ⇒ the whole canon, fully voiced. Society reflection off ⇒ tide neutral too.
- **Settings copy** must say what it does: "Colours how the story speaks to you. It never changes the story."

## 5. The selector
`pickVariant(entry.text, knowledge, flavor)` →
1. choose the variant by `register` (fall back plain → whichever exists);
2. if the entry has a `secondReading` and Knowledge holds any partner id, append it (Knowledge, not Flavour);
3. for reactions, only evaluate when the player holds the trigger entry;
4. resolve `{name:id}` placeholders by Knowledge.
Ordering/emphasis helpers: `surfaceOrder(doors, flavor)` returns the eight doors in a flavour-leaning *order* (all eight always returned); `openingStyle(thread, lean)` returns the transition style for a step.

## 6. The model's role (optional, bounded)
The daily NPC script call (one per brain-day) already exists. Extension: the prompt receives the **FlavorKey** (words, never memory text) and, per line, the **claim list + authored `plain` text**; it may re-voice in the key's register. **Validation after the call:** (a) no proper noun outside the content's allowed-names list; (b) no banned phrase; (c) length cap; (d) a lightweight claim check — the output must contain each claim's *anchor tokens* (names/objects defined per claim) — else discard and use the authored variant. The model never adds a claim and never decides availability. No key ⇒ authored registers; a failed call ⇒ authored registers.

## 7. Firewall tests (must exist before any UI)
1. **Claim identity:** all variants of an entry carry the same `claims` set (compile-time via type + a test).
2. **Availability invariance (property test):** for every FlavorKey in the cross product, the set of reachable entries, endings and doors is identical.
3. **Neutral completeness:** with the neutral key, every entry renders with `plain` only and nothing is missing.
4. **Purity/determinism:** `register` and `surfaceOrder` give identical output for identical inputs; different brain ids give different but stable output.
5. **No numbers:** no API response or rendered string contains a count, ratio or percent about finds or flavour.
6. **Privacy:** no flavour input is memory text; a test greps the flavour module's imports/queries for any column holding user text.
7. **Reduced motion / not-colour-alone:** tint changes must have a non-colour carrier (word, shape or size) — per the accessibility rule.

## 8. Risks
| Risk | Handling |
|---|---|
| Flavour reads as judgement | Mirror-not-verdict copy; opt-out; no labels shown to the player; leanings never named in UI unless the owner wants "How you play" shown (default: not shown). |
| Authoring explosion | ≤ 3 registers; `plain` mandatory; most lines get 1–2 extra. A lint reports lines missing a register so work can be prioritised (priority: Eternity, canon cast greetings, thread openings). |
| Flicker / uncanny drift | Daily key, hysteresis, seeded picks. |
| Model drift into inventing canon | §6 validation; authored fallback; claims are code. |
| Cost | No new model call; the daily call carries a few extra words. Flavour compute is counts over existing tables, once per brain-day. |
| Red-Zone | `shared/*` types, `db/*` tables, route contracts, `space_id` scoping stay with Claude. |

## 9. Build order (after the owner says go)
1. Content model + claims + the web-checker test (pure, shared). 2. Author the graph for Drafts 1–5 (anchors, doors, edges) so the checker can run on real data. 3. `story_flavor_day` + leaning counts + `story_prefs` + routes. 4. Selector + client wiring (Book, Item Reactions, NPC lines). 5. Daily-script extension + validation. 6. Settings switch + copy. Each step is independently shippable and gated by §7.
