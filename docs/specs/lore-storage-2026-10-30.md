# How the lore is stored for players — design (docs only, 2026-10-30)

*Owner: "take into account how lore should be stored for players." Spec before code (Rule #1); nothing here is built. Companion to `docs/lore/DRAFT_4_THE_DEEP_READING.md` §10 (the Sixteenth's Book) and `docs/lore/LORE_CANON.md` (the authority ledger).*

## 0. Name collision to avoid
The repo already has a **`lore` table + `lore/engine.ts`**: append-only, versioned, *generated* lore per memory/ship/station/beacon (`subject_type, subject_id, version`). That is a different thing. Everything below is the **story canon** and uses the prefix **`story_`** (tables) / `story/` (modules) so the two never get confused.

## 1. The principle: content is shared and read-only; progress is private and tiny
Two separate things, stored in two separate places:
| | What it is | Where | Who writes it |
|---|---|---|---|
| **Canon content** | Every object-text, account, sight, echo line, cast thread, Second Reading sentence | **Code/data in `packages/shared`** (typed, versioned, zod-checked), like `npcs.ts` / `relics.ts` | The owner/Claude, through commits — never a runtime user |
| **Player progress** | Which entries *this brain* has found, when, from where, plus the player's own notes and Concordance links | **Server DB, per `space_id`** | The server, on discovery events |

Why content is *not* in the database: it is authored, reviewed and locked by the owner; it must be identical for every player (no cross-brain content ever); it works offline with no key; and changing canon is a code change with a diff, not a data migration. The server stores **only ids** that point into the content.

## 2. Stable ids (the contract that makes everything else safe)
Every entry has an id that **never changes and is never reused**: `obj.doorkeepers-nail`, `acct.choir.rending`, `sight.deep-past.missing-stratum`, `echo.hymn.missing-breath`, `thread.kith.3`, `companion.dock-1`. Rename an entry's *text* freely; **never** its id. Striking an entry from canon = marking it `retired: true` in content (progress rows keep their id; the Book simply stops showing it). Re-locking text is therefore free and cannot corrupt a player's Book.

Each entry's definition carries: `id`, `kind` (object | account | sight | echo | companion | thread-step), `world`, `reach`, `canon: "provisional" | "locked"`, `pairs: string[]` (its Hidden-Web partners), `secondReading` (the extra sentence, shown only when a partner is held), and `text`.

## 3. Player progress — three small tables (all additive, all `space_id`-scoped)
All created in `schemaSql.ts` **and** `migrateSchema` (idempotent, PRAGMA-guarded), all added to `SPACE_SCOPED_TABLES` (a census test fails otherwise — it caught `npc_day_script` once).

1. **`story_finds`** — one row per entry a brain has found.
   `space_id, entry_id, found_at, source` (`world:<id>` | `npc:<id>` | `regard` | `recall`) `, last_recalled_at, recall_count`
   Primary key `(space_id, entry_id)`. **No "missed", "locked" or "percent" columns exist**: absence of a row *is* "not found yet". Finding is idempotent (`INSERT OR IGNORE`), so a replayed event is harmless.
2. **`story_links`** — Concordance pairs the player *made themselves*.
   `space_id, a, b, linked_at` (stored with `a < b`). A row is a thread of light the player drew. The server **does not** check whether the pair is "right" when storing; "right" is a pure function over the content's `pairs` evaluated at read time. (So a wrong guess is kept privately and costs nothing; a right one lights.)
3. **`story_notes`** — marginalia, text the player wrote.
   `space_id, entry_id, note, updated_at` (one note per entry; empty = delete). **Never sent to a model, never shown to an NPC, never aggregated, never leaves the brain.** Optional later: an explicit per-note "keep this as a memory" action that creates a real node through the normal ingest path — the note stays a note until the player says so.

Optional fourth table only if the owner wants it: **`story_prefs`** (`space_id, spoilers_hidden, constellation_on`). Defaults: Book on, constellation off. Mirrors `society_prefs`.

## 4. What is *derived*, never stored (so it cannot drift)
- **Second Readings** — computed at read time: an entry shows its extra sentence iff the brain holds a row for at least one id in `pairs`. No flag stored.
- **Which Concordance links are "true"** — computed against content.
- **The Book's silhouettes** — the shape for every entry not found is rendered from content metadata (kind/world), not from any stored "missing" list; there is nothing to leak or to count.
- **Hours Clock sightings** — pure functions of the brain's local time and timezone, same as `npcLocation`; stored nowhere.
- **Which companion scene you are owed** — a deterministic function of brain id + day, so a reload shows the same stranger; stored nowhere (the *find* is recorded once it happens).
- **Counts/percentages** — not computed anywhere. The product rule is *no number* (Draft 4 §10.2). The API does not return a total, so no client can show one by accident.

## 5. Recall ("memory is made by retrieval") — reuse, don't rebuild
The Book dims and relights entries using the **existing recall layer**, not a new scheduler. Two clean options (pick in the build spec):
- **A (preferred): lore entries as lightweight recall subjects** in the existing review state, keyed `story:<entry_id>`, so `/api/review/due` and the strength curve already work. Needs a check that review tables key on an arbitrary subject id (not a node FK) before committing to it.
- **B: compute strength client-side** from `last_recalled_at`/`recall_count` with the same curve function the server already shares in `packages/shared`.
Either way the rule is: **dimming is a visual cue only; nothing is ever removed, locked or lost.**

## 6. API shape (thin routes; validate → delegate → json)
Routes behind `requireSpace`, zod-validated, 400 on bad input, using `spaceOf(res)`:
- `GET /api/story/book` → `{ finds: [{entryId, foundAt, source, lastRecalledAt}], links: [...], notes: [...] }`. Never totals.
- `POST /api/story/find` `{ entryId, source }` → idempotent; **rejects ids not in content** (so a client can never invent a find) and rejects any entry whose preconditions (e.g. being in the right world) the server can verify from the travel ledger. Server stays the only authority.
- `PUT /api/story/link`, `DELETE /api/story/link` · `PUT /api/story/note`.
- `POST /api/story/recall` `{ entryId }` → bumps recall.
The client never sends progress it computed; it sends *events* and the server decides.

## 7. Privacy, deletion and export
- **Delete the brain ⇒ everything goes** (all `story_*` tables are in `SPACE_SCOPED_TABLES`; the existing `deleteSpace` already clears every listed table, covered by the census test).
- **Export**: finds/links/notes are included in the brain export the same way as other per-space data; content (canon) is not exported — it is the game.
- **No cross-brain anything.** The Follower's notes and the Companion are NPC scripts from content; no brain's finds, notes or links are ever readable by another. Aggregates across brains (e.g. "how many have found X") are **not collected** — it would be a number, and a leak.
- **Memory text and notes never go to a model**, including the daily NPC script; story NPC lines are authored content plus the existing society/currents briefs.
- **Notes are the one place user text enters the story system**; they are length-capped (e.g. 2,000 chars), plain text, escaped on render.

## 8. Offline, versions and failure modes
- Content is bundled in the client: the Book renders with **no key and no network** for everything already found (finds are cached locally for display only; the server stays the source of truth).
- A find posted offline queues and replays (idempotent). A failed read shows the Book from the local cache with a quiet "couldn't sync"; it never invents a find.
- **Content version**: the content module exports `STORY_CONTENT_VERSION`. Progress stores ids only, so older rows always still resolve; unknown ids (a retired/removed entry, or a client older than the server) are ignored by the Book, never errors.
- **Multi-device**: because progress is per `space_id`, any device that holds the brain key shows the same Book.

## 9. Risks and how this design handles them
| Risk | Handling |
|---|---|
| Canon edits after players have progress | Stable ids + `retired`; text is code, not rows. |
| A client forges finds | `POST /find` validates the id against content and the world against the travel ledger. |
| Totals/percentages creep in | No total anywhere in the API; the Book renders silhouettes from content. |
| Spoilers via the network | Locked text is bundled in the client (it is not a secret); the *Hush rule* and *no-failure rule* mean there is no advantage to spoiling, and Second Readings are cosmetic. If the owner wants server-held secrets later, only the "wrong-thing" locations and companion scenes need to move server-side. |
| Table name confusion with the existing `lore` | `story_` prefix everywhere; documented in §0. |
| Hush ethics (never punish) | There is no state that can be lost; the only write is "found". |

## 10. Build order (once the owner locks the lore)
1. `packages/shared/src/story.ts` — content types + the Draft 1–4 entries as data (zod-checked, ids frozen), with a test that ids are unique and every `pairs` target exists.
2. Server: three tables (schema + `migrateSchema` + `SPACE_SCOPED_TABLES` + migration test) → `story.repo.ts` → routes → route tests (idempotence, unknown id rejected, no totals in any response).
3. Web: Book panel (silhouettes, no numbers), regard/echo triggers, Second Readings, Concordance.
4. Recall wiring (§5), then Hours Clock sightings, then the optional constellation.
Red-Zone items (`shared/*`, `db/*`, route contracts, `space_id` scoping) stay with Claude.
