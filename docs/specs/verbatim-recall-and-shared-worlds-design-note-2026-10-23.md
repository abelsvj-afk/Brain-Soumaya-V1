# Soumaya — Word-for-Word Recall + Shared Worlds
## Design note — 2026-10-23 (third Soumaya chat: "Build Samaya word for word recall")
## Status: DESIGN ONLY. Nothing here authorizes implementation.
## Lane: DESIGN-FIRST (DB schema + space_id scoping are Red Zone / irreversible-adjacent per repo AGENTS.md and the owner's Soumaya workflow). Max ~2 review rounds, then escalate to owner.
## REV 2 — 2026-10-23: §§10–16 added. Owner decisions recorded (world classification delegated to King and decided, §10; pinned notes approved in principle, §11). Design review verdict received: ACCEPTABLE AS A DESIGN PROPOSAL, NOT APPROVED FOR IMPLEMENTATION — its five issues (A–E) are resolved on paper in §12, V1 boundary narrowed in §13, acceptance criteria in §14, failure/rollback/migration in §15, reconciliation record in §16. Tracks A/B separated per the verdict. V1 still requires the owner's approval after this revision.
## REV 3 — 2026-10-23: §§18–20 added. Rev 2 review verdict received: READY FOR THE OWNER'S V1 APPROVAL REVIEW, NOT AUTHORIZED FOR IMPLEMENTATION. Its four remaining clarifications are closed in §18 (dependency-aware erasure; byte/hash + correction-ordering contract; durable processing state; migration/rollback gate). Joint capture-adjacent audit against the repo audit program recorded in §19. Unresolved risks + the owner decision ask in §20. Per the owner's design-first lane cap (~2 review rounds, then escalate), this is the escalation: the design is presented for the owner's explicit V1 decision. Implementation remains unauthorized until he gives it.
## RECORD SECTIONS — §§21–24: Rev 3 review disposition (§21) · OWNER APPROVAL of this design, 2026-10-23 (§22) · pre-implementation evidence addenda (§23) · self-check corrections (§24). Where §§18/23/24 refine earlier sections, the later section governs; the original text is preserved, never silently rewritten.

---

## 1. What the owner asked for

Two ideas pulled from 19 Keys, plus one architecture question of his own:

1. **Retrieve anything he has ever said, word for word**, and present it back in whatever form he needs. He is still listening to the video to recover the *second* thing Keys said about his AI — this note builds the first idea fully and leaves a marked slot for the second (§9).
2. **Use it for**: advanced note-taking now; a future podcast and business; Soumaya's standing job as second brain + agent + game that cognitively reinforces what he knows, in different forms.
3. **Multi-user future**: every person keeps a *separate, private* brain. The travel destinations (Great Station, Scale, Deep Past, Growing Place, People, Quiet/Archive) are *single shared places* — when you warp there, you see other travelers who warped there too.

## 2. What 19 Keys actually describes (verified, not guessed)

Source: 19 Keys' own published **AI Agent Field Manual** (19keys-field-manual.vercel.app/manual/, "By 19Keys, updated July 2026, 52 lines") and his Co-Creator hub (hub.19keys.com — "the 19Keys community archive"). The pattern in his own words:

- **Line 03** — the agent's job for a storyteller: *"organizes transcripts, pulls hooks, and drafts options for you to choose from"* — don't replace the voice, organize what the voice already said.
- **Line 05** — *"A second-brain folder with transcripts and frameworks is stronger than asking AI to guess your thinking from scratch."* Capture first; the transcript library IS the asset.
- **Line 35** — the retrieval tool, specified almost exactly: **Tool: `search_transcripts`. Inputs: query, date_range, speaker. Output: matching excerpts with source names.** Note the output: *excerpts* (his actual words) *with sources* — not a summary, not a paraphrase.
- **Line 44** — *"Protect private knowledge. Your second brain can become a business asset."* Folders split: **public teaching / private strategy / client data / raw transcripts** — and *"give the agent only the folder needed for the job."*
- **Line 49** — *"Turn repeated thought into IP. Frameworks become assets when they are captured and reused"* — a framework becomes a lesson, book, product, or agent workflow.

Comparable systems in the wild use the same shape (e.g. Delphi-style digital minds: sync YouTube/podcast/social sources, transcribe everything into one searchable "brain," answer grounded in excerpts). The mechanism is not magic and not a bigger LLM. It is four boring parts done in the right order:

**Capture everything as a transcript → keep the original immutable → chunk + index it (keyword AND meaning) → a retrieval tool that returns exact excerpts with citations → presentation layers that transform those excerpts on demand.**

The reason it feels like "it can retrieve anything I've ever said" is that nothing was ever thrown away or rewritten on the way in.

## 3. Why Soumaya can't do this today (code-verified, repo chat + this chat)

Repo: `abelsvj-afk/Brain-Soumaya-V1`, local clone `~/workspace/gate-run/repo`.

- Ingestion (`packages/server/src/ingestion/pipeline.ts`, `ingestCore`): the user's raw text goes straight into `llm.extract(rawText, context)`. Only the LLM's extracted nodes are stored. **The raw input itself is stored nowhere.** Once extraction runs, the original words are gone.
- The extraction prompt (`llm/prompts.ts`, `EXTRACTION_SYSTEM`) asks for per-node *"content: the relevant text/summary for that node"* — i.e. a rewrite, by design.
- The loss is visible in his own export (`~/workspace/user/backups/brain-export-2026-10-23.json`, 245 nodes / 962 edges): the node from his input "I want an llc" carries a long LLM-generated "Research Deep Dive" as its content. His three words and the machine's expansion are fused in one field, indistinguishable.
- Search exists but searches the rewrite: `nodes_fts` (FTS5 over node label+content, `db/fts.ts`) + vector search over node embeddings, fused via RRF (`agent/tools/memorySearch.ts`). Good machinery — pointed at summaries, not sources.
- **The one verbatim system already in the house:** `knowledge_docs` / `knowledge_chunks` (uploaded documents, chunked verbatim with ordinals). It proves the pattern fits this codebase — it just was never connected to captures, voice, or chat.

**Honest consequence:** word-for-word recall cannot be backfilled for the existing 245 nodes. Their originals were never kept. They must be labeled *summary-only / legacy* in any future UI. Verbatim starts the day the source layer ships — which is why Phase V1 below is "stop the bleeding" and outranks everything else here.

## 4. The design: a Source Layer under the brain

One rule, stated once and enforced everywhere: **nodes are derived; sources are truth. A node may be regenerated, merged, or superseded. A source is never edited by the machine.**

### 4.1 New tables (all `space_id`-scoped, same bootstrap/migration discipline as existing schema)

- **`sources`** — one row per original capture: `id, space_id, kind` (`note | voice | telegram | chat | podcast_episode | video | document | meeting`), `title, raw_text` (exact, as received/transcribed), `audio_ref` (nullable — where the original audio lives), `speaker` (default: owner), `occurred_at` (owner-local time semantics — **no UTC in anything user-facing; stored ISO-Z, displayed in the space's timezone**, per standing rule), `created_at, content_hash, idempotency_key`.
- **`source_chunks`** — the source split into retrievable pieces: `id, space_id, source_id, ordinal, text, start_offset, end_offset`, plus for audio/video `start_ms, end_ms`. This is `knowledge_chunks` generalized; knowledge docs can migrate into it as `kind=document` sources instead of living in a silo.
- **`node_sources`** — provenance link: `node_id, source_id, chunk_id (nullable)`. Every node extracted from a capture points back to the exact chunk(s) it came from. A node with no link is visibly machine-made (research expansions, dream output) — provenance becomes a label the user can see: **"Your words" vs "Soumaya's expansion."**

Indexes: `sources_fts` (FTS5 over chunk text) + chunk embeddings in a vec table, mirroring the existing nodes FTS/vec pairing and RRF fusion. The retrieval machinery already in the repo gets a second, more important target.

### 4.2 Capture paths (in value order)

1. **Typed notes / Telegram / chat (today's paths)** — store `raw_text` as a source *before* extraction runs; extraction then reads from the source and writes `node_sources` links. Smallest change, saves everything from that day forward.
2. **Voice notes** — transcribe (the repo already does local-first/offline-fallback work; Whisper-class transcription), store transcript as source with segment timestamps + the audio ref. A voice note becomes quotable to the second.
3. **Podcast / video import (future, when the podcast starts)** — episode audio or a YouTube/RSS sync → diarized transcript (who said what, when) → source per episode. This is the 19 Keys speaker use-case exactly, and it's an import job, not new brain surgery.
4. **Documents** — existing knowledge-docs flow folds in as sources.

### 4.3 The retrieval tool: `search_my_words`

Modeled deliberately on Keys' Line 35 schema, extended for this brain:

- **Inputs:** `query, date_range, speaker, kind, world (nullable — see §6)`
- **Output:** exact excerpts — never paraphrased — each with a citation card: source title, date (space-local), timestamp offset for audio, and the linked node(s).
- **Two retrieval passes, fused** (same RRF pattern as `memorySearch`): FTS for exact phrasing ("what did I say about liquidation?") + vector for meaning ("what did I say about protecting the family money?" when he never used those words together).
- **Answer rule for the agent:** when the owner asks *"what did I say about X"*, the answer leads with his excerpts and cites them; synthesis, if any, comes after and is labeled as synthesis. When he asks *"what do I think about X"*, synthesis leads and excerpts back it. The two questions stop getting the same mushy answer.

### 4.4 Presentation layer — "present it in whatever fashion"

All of these read from excerpts, and all show their sources:

- **Quote** — the exact passage, copy-ready, with date/source.
- **Note mode (advanced note-taking)** — a source becomes a structured note: his words on one side, Soumaya's outline/questions/connections on the other, never blended. Cornell-style split enforces the provenance rule visually.
- **Remix (podcast/business)** — pull everything he has said on a topic across all sources → hooks, an episode outline, a script draft, a post — each draft line traceable to an excerpt. This is Keys Line 03 + Line 49 operationalized: repeated thought → IP.
- **Brief** — "everything I've said about X this month," excerpts grouped by source, for review before a decision, a meeting, a recording.
- **Contradiction / evolution view** — reuses the W3 reconciliation machinery, but now against *his actual past words*: "In June you said A (quote). In October you said B (quote)." That is a feature summaries can never honestly offer.

### 4.5 Cognitive reinforcement (the game half)

- **Deep Past becomes the archive world in fact, not just theme:** its strata are real sources, deeper = earlier, and standing in a stratum surfaces the actual words from that period (fits the ratified depth rule: nothing dims, nothing is called "forgotten").
- **Recall quests:** the game quizzes him from his own excerpts ("you said this about discipline — when, and what was the next line?"). Fuel/quest hooks already exist; the content finally comes from truth instead of generated trivia.
- Spaced review: excerpts resurface on the streak/digest surfaces he already gets — his own frameworks, in his own words, on a rhythm. That is the compounding Keys calls cognitive wealth.

## 5. Trust rules (non-negotiable, from the owner's standing standards)

1. Verbatim means verbatim. A quote is never "cleaned up" silently; transcript corrections are append-only events (the repo's existing `corrections` pattern), original stays viewable.
2. Provenance is always visible: your words / her expansion / her synthesis are three different labels, in chat and in UI.
3. Legacy nodes (pre-source-layer) are marked summary-only. No fake quotes from them, ever.
4. No UTC in anything user-facing; all dates/times in the space's own timezone.
5. Offline fallback is sacred (repo commandment): transcription/retrieval must degrade to local FTS when no API key exists — FTS alone still delivers exact-word recall.

## 6. Tying it together: private brains, shared worlds

The owner's model, restated as architecture:

**A brain is private and singular. Some worlds are shared and singular. Deep Past is not one of them.**

**Owner correction, 2026-10-23:** Deep Past is one of the worlds — and it is **private-only**. It is accessible by no one besides the individual brain owner. No other travelers are present there, ever. It is not a social/shared world with private contents; it is a solo instance, locked to its owner.

So the worlds roster splits into two classes, and the class is a property of the world, not a user setting:

- **Shared worlds** — one place for everyone; travelers can be present together (the owner's original multi-user picture: Great Station, Scale, and any world he later names as shared).
- **Private worlds** — one instance per brain, owner-only, no presence, no visitors. **Deep Past is settled as private.** (Any other world he wants in this class, he names — Growing Place / People / Quiet/Archive are NOT reclassified by this correction; their class stays his call.)

### 6.1 What already fits

Everything in the brain is `space_id`-scoped today (nodes, edges, fuel, travel ledger — P2-2 even caught and fixed travel tables missing from `SPACE_SCOPED_TABLES`). One space = one person's brain, and the space ID is the permanent credential. That isolation is the correct foundation and does not change.

### 6.2 What must be added (and what must never happen)

Worlds today are *scenery inside one space* — P2-1→P2-3 travel is a per-space ledger (`travel_journeys`), and the Station a per-space scene. For the multi-user future, split three layers cleanly:

- **World definitions (shared as templates):** each world exists **once** as a scene/content definition — same hull, same geography. Versioned like code, not owned by any space. A template being shared does **not** make the place shared: Deep Past's helix/First Light design is one template, instantiated privately per owner.
- **Private worlds (per space, owner-only, no presence):** Deep Past instantiates per brain and is entered alone. Its strata are the owner's sources (§4.5) — the verbatim archive. No presence rows are written for Deep Past, no other traveler's avatar can render there, and there is no invite/share path into it. This also settles §4.5 cleanly: the archive world and the owner's exact words were never going to be social, and now the design says so outright.
- **Private overlays in shared worlds (per space, never shared):** in a *shared* world, what the place *means to you* still stays in your brain — your memories planted in Growing Place, your people in People. Another traveler in the same shared world sees the place and you, never your contents. This preserves the failure-independence invariant: worlds layer disposable, brain authoritative.
- **Presence (shared worlds only, minimal, the only bridge):** a new, deliberately tiny surface — `presence_sessions (world_id, space_id, entered_at, left_at)` + a live position/avatar feed carrying **only** what the traveler opts to show: gamer tag (already unique per space in `spaces.gamer_tag`), avatar, current world, position. **Presence is written only for shared-class worlds. Presence queries must never join brain tables.** No nodes, no excerpts, no fuel balance crosses. The shared-world API gets display identity and nothing else — enforced by keeping presence in its own tables/routes with no foreign keys into brain content.

Travel economics stay per-space (your warp costs your fuel — P2-1 constants unchanged); the commons charges nobody. Shared-world additions that come later (a public board at the Station, meeting someone at Scale) each need their own consent decision — they are **not** implied by presence.

### 6.3 Owner decisions this section needs (his calls, flagged not guessed)
*[Amendment pointer, added at the §24 self-check: the third bullet below was DECIDED after this section was written — pinned notes YES (§11). Visibility and contact (bullets 1–2) remain open. §§10–11 govern where they differ from this section.]*

- Default visibility in shared worlds: visible to all travelers / appear-offline option / friends-only?
- Any traveler-to-traveler contact at v1 (wave/emote only would be my recommendation — no text/voice from strangers by default)?
- Does a traveler ever *choose* to share an excerpt publicly at a world (e.g. pinning a quote at the Station)? Powerful for the future podcast/business — and exactly the kind of share that must be per-item, explicit, and revocable.

## 7. Phasing (each phase = owner's separate word, per standing governance)

- **V1 — Stop the bleeding:** `sources` + `source_chunks` + `node_sources`; typed/Telegram/chat captures store raw first. No UI change beyond a provenance label. *(Design-first gate applies — schema.)*
- **V2 — `search_my_words`:** FTS+vec over chunks, citation cards, agent answer rules (§4.3). Legacy nodes marked summary-only.
- **V3 — Presentation studio:** Quote / Note / Brief modes in the web app; Remix draft for one topic as the pilot.
- **V4 — Voice + podcast import:** voice-note transcription with timestamps; episode import when the podcast exists.
- **V5 — Game binding:** Deep Past strata = real sources; recall quests from excerpts.
- **V6 — Shared presence:** world definitions split from spaces + presence layer (§6), **shared-class worlds only — Deep Past is excluded from presence by design**. Separate design gate — it touches auth/space scoping (Red Zone) and needs the §6.3 decisions first.

Sequencing note for the other chats: V1–V2 reconcile against the repo chat's tab-by-tab audit program before build (audit findings are additive — GH items are not redirected by this note). V5–V6 reconcile against the Worlds chat's P2-4 gate and drift design note. Nothing here jumps either queue.

## 8. What this note is not

- Not an authorization to build, merge, or deploy anything.
- Not a claim about the second thing 19 Keys said — the owner is still recovering it from the video.

## 9. OPEN SLOT — the second 19 Keys point

Owner, 2026-10-23: *"there was something else he said about the AI — I'm watching the video as he's talking right now."* When he names it, it gets evaluated against this design and either folded in as a section or recorded as rejected, with reasons. Candidates it might be (unverified, do not build on these): a voice-clone/TTS read-back of his words; an agent that drafts in his voice from the transcript library; audience-facing access to the library (a public "ask my brain" surface — Keys' Line 44 folder split anticipates exactly this). The design above already leaves the right seams for all three: sources are quotable, presentation is a layer, and public/private is a per-folder permission.

---
*Prepared by the third Soumaya chat (word-for-word recall), referencing: the repo chat (audit program, ADR-019/020, Fly recovery, brain export) and the Worlds chat (vision brief, P2-1→P2-3, P2-4 design note D-44). Sources: 19 Keys AI Agent Field Manual (Lines 03, 05, 35, 44, 49); repo files `ingestion/pipeline.ts`, `llm/prompts.ts`, `db/schemaSql.ts`, `db/fts.ts`, `agent/tools/memorySearch.ts`; brain export 2026-10-23.*

---

# REV 2 — Decisions and review resolutions (2026-10-23)

## 10. World classification — DECIDED (owner delegated the choice to King: "U choose")

Rule used: a world is **public** only if its settled purpose carries no one's private content — a place whose job is journeys, orientation, or shared wonder. A world whose purpose *is* somebody's life content is **private**, however pretty it would be social.

| World | Class | Why (grounded in its settled purpose) |
|---|---|---|
| **Great Station** | **PUBLIC** | Home port — orientation, departure, discovery; it surfaces journeys and routes, *not memories* (settled purpose, Worlds D-5). It is the commons and the natural home of the pinned-notes board (§11). |
| **Scale Space** | **PUBLIC** | Awe and perspective; reference-scale objects at honest sizes. Almost nothing personal lives there — only a small number of user-confirmed anchors (Worlds §10). A shared vista, not a diary. |
| **Deep Past** | **PRIVATE** | Owner-settled 2026-10-23 (§6). Your strata, your words, no one else present, ever. |
| **Growing Place** | **PRIVATE** | Its landmarks are *real personal milestones only* — the garden literally grows out of one person's life evidence. Someone else's presence adds nothing; the milestones are the content, and the content is private. |
| **People** | **PRIVATE** | Organized by *who*: shared history, open threads, dates that matter, per person. Relationship data is among the most sensitive content in the brain. Never social. |
| **Quiet / Archive** | **PRIVATE** | The Archive invariant (Worlds P4) already decides this: archived material disappears from *every* other surface and is retrievable only by the owner's deliberate act inside the Archive itself. A place built for putting painful-but-important things down in peace cannot have an audience. |

**Result: 2 public worlds (Great Station, Scale), 4 private worlds.** The social surface stays deliberately small; every world that holds a life stays locked. This classification is a per-world property in the world definition, not a user preference. Reclassifying a private world to public later would be its own owner decision with its own design gate — never a settings toggle.

## 11. Pinned notes — DECIDED YES (owner, 2026-10-23: "yes people can leave pinned notes in a world, however we will design that")

- Pinned notes live in the **public worlds** (Great Station, Scale). In a private world, a "pin" is simply the owner's own note to himself — ordinary brain behavior, no new system.
- This settles the review's third reserved decision ("public excerpts") as **YES, via pinned notes**, with the details designed later in Track B. Binding constraints carried into that design now, from the review's recommendation:
  - A pin is an **explicit, per-item act** by its author. Nothing is ever pinned automatically or by default.
  - A pin is **individually revocable** by its author at any time; revoking deletes the pinned copy.
  - A pin carries **only what its author put in it** — text they typed for the pin, or an excerpt they deliberately chose to publish from their own brain. Publishing an excerpt copies it; it never creates a live link into the author's brain, and the source stays private after the copy is revoked or deleted.
  - The audience is **clear at pin time**: this world, everyone present/future in it, under the author's gamer tag.
  - Still to design in Track B (not decided here): placement/anchoring in the scene, limits (count/length/rate), reporting and removal, whether pins persist or fade, and moderation responsibility once multiple people use the app.
- The other two reserved decisions from the review — **visibility default** (visible / appear-offline / friends-only) and **contact** (none vs limited nonverbal) — remain **genuinely open**. The review's recommendations (appear-offline until opt-in; limited nonverbal only) are recorded as recommendations, **not adopted**, until the owner rules.

## 12. Review issues A–E — resolutions

### A. "Immutable" defined (P0, data integrity)
- **Write-once fields** on `sources`: `raw_text`, `kind`, `speaker`, `occurred_at`, `content_hash`, `byte_length`. No repository method updates them — enforced by API shape (no update path exists), not by convention.
- **Corrections** live in a separate append-only table, `source_corrections` (`id, space_id, source_id, chunk_id nullable, corrected_text, reason, corrected_by, created_at`), following the repo's existing W1 `corrections` pattern. The *current reading* of a source = original + its corrections in order; the original is always viewable underneath. A correction never replaces the original.
- **Canonical hash:** SHA-256 over the exact received payload bytes after transport decoding and *before* any normalization, trimming, or Unicode processing — plus stored byte length. For audio/documents, the hash covers the file bytes. Hash verified on export and on demand; a mismatch quarantines the source and is reported, never silently served.
- **Idempotency:** every capture attempt carries a client-generated `idempotency_key` (precedent: nodes already carry one). Unique index on `(space_id, idempotency_key)`. A retry — network, double-tap, Telegram redelivery — returns the existing source; it can never duplicate it.
- **Pipeline order is the integrity rule:** persist source (single transaction, chunks + FTS included) → acknowledge capture → extract afterward. Extraction failure leaves the source at status `preserved_unprocessed`, retryable; it never deletes or degrades the source.
- **Retention:** sources live for the life of the space unless the owner forgets them (forget cascades — §12B). Audio retention: kept while its source exists; the owner may explicitly delete the audio and keep the transcript — that act is recorded as an event and downgrades the citation class (§12C).

### B. Source-level privacy, enforceable (P0, authorization)
- All four new tables — `sources`, `source_chunks`, `node_sources`, `source_corrections` — are added to `SPACE_SCOPED_TABLES` (`packages/server/src/auth/spaces.ts`), inheriting the existing space-erase and scoping machinery (the exact gap P2-2 caught for travel tables; not repeated here).
- Repositories are constructed with a `spaceId` (the existing `NodesRepo` pattern); no cross-space query method exists to call.
- **Search isolation:** chunk FTS and vector queries filter by `space_id` in the WHERE clause **before** LIMIT (the W1 precedent: excluded rows never occupy result slots — here, another space's chunks are never candidates at all). Vector hits are re-verified by joining chunk → source and asserting `source.space_id` = requesting space (defense in depth against index-row mixups).
- **Background jobs** (dream cycle, consolidation, W3 reconciliation) already iterate per space; source access inherits the job's space context. No job pools sources across spaces.
- **Acceptance includes an adversarial test:** two spaces, a near-identical chunk planted in the other space tuned to win nearest-neighbor — it must never be returned, linked, or quoted through the first space's nodes, embeddings, or search. (Criteria in §14.)
- Export stays per-space, as today.

### C. Original words vs transcription accuracy (P1)
Every source carries a **citation class**, shown wherever its words are quoted:
- `verbatim_typed` — typed/imported text stored exactly as received. The agent may say "you wrote."
- `transcript_machine` — ASR output. Labeled machine transcript, with the original audio preserved alongside. The agent says "in your recording, you said (transcript)" — never presents it as guaranteed word-for-word.
- `transcript_corrected` — transcript the owner has corrected (corrections per §12A). Quoted text is the corrected reading; original transcript and audio remain one tap beneath.
- `transcript_unverifiable` — transcript whose audio the owner deleted (§12A). Honest downgrade, permanent label.
- `imported_text` — documents and publisher transcripts; treated as exact *for that document*, not as the owner's speech unless the document is his.

### D. Source-to-node lifecycle (P1)
- `node_sources` is **many-to-many**: one node may be supported by many chunks (synthesis across captures); one chunk may support many nodes (one capture splitting into several nodes — the normal extraction case). Each link carries a **role**: `origin` (the chunk this node was extracted from), `support` (evidence attached later), or `derived_from` (machine work that read the source — research expansions, dream output).
- Links are rows with the W1 supersession discipline (`active` flag, `superseded_at`), never hard-deleted by lifecycle events:
  - **Merge:** the surviving node inherits the union of both nodes' links.
  - **Split:** each child inherits the parent's links; later narrowing deactivates links, it does not erase them.
  - **Regeneration/supersession:** the new node copies links forward; the chain follows `superseded_by`.
  - **Node deletion:** removes the node and deactivates its links; **sources are never deleted by node events.**
  - **Source forgetting** is the strong direction: forgetting a source flags every node whose *only* origin is that source for the existing forget flow (INV-DEL precedent) — tombstoned with it, indexes included.
- **Display rule:** the "Your words" label requires at least one active `origin` link, and any quoted text is rendered **from chunk text, never from node content**. A node whose links are only `derived_from` can never be quoted as the owner's speech.

### E. Offline contract (P1)
- Capture persistence is a local SQLite transaction — **zero network dependency**. If persistence itself fails, the capture fails (see the honesty rule, §13).
- FTS indexing happens **inside the same transaction** as the chunk insert (explicit-sync pattern from `db/fts.ts`), so a preserved source is exact-word searchable immediately. Vector indexing is allowed to lag: chunks carry an `indexed_vec` flag, backfilled at boot (the `nodes_fts` boot-backfill precedent).
- **Phrase matching:** quoted-phrase FTS5 queries are part of the contract — an exact phrase from a source returns that source. Single exact words likewise. Acceptance tests in §14.
- **Degradation is announced, never silent:** embeddings/API unavailable → search runs FTS-only and the surface says so ("meaning search unavailable — exact-word search active"). Extraction unavailable → capture still preserves, status `preserved_unprocessed`, extraction retries when the provider returns. Nothing is discarded at any degradation level.

## 13. V1 boundary (adopted from the review, binding for the approval ask)

**In scope for V1 design:** source + chunk data model · provenance and ownership invariants · typed / Telegram / chat capture contracts · retry, correction, and failure semantics · migration and rollback strategy (§15) · acceptance tests for preservation (§14).

**Deferred:** presentation studio · voice and podcast ingestion · recall quests and spaced review · shared-world presence (Track B) · public sharing beyond the §11 decision · advanced remix and contradiction views.

**Acceptance principle (the review's, adopted verbatim in substance):** after a successful capture, the original submitted text can be retrieved exactly as received — even if extraction fails, the derived node is regenerated, or vector search is unavailable.

**Honesty nuance (the review's, adopted):** if capture *persistence* itself fails, Soumaya reports the failure and never claims the words were preserved; the client keeps the owner's local draft (precedent: `telegram_note_drafts`) so the words are not lost on his side either.

## 14. Acceptance criteria for V1 (design-level; tests specified, not written)

1. **Exact preservation:** submit a typed capture with awkward whitespace, typos, and emoji; retrieve the source; byte-identical (`content_hash` matches). Repeat via Telegram and chat paths.
2. **Extraction independence:** force extraction to fail; source still retrievable exactly; status `preserved_unprocessed`; extraction later succeeds without re-capture.
3. **Regeneration independence:** regenerate/merge/supersede the derived node; source and its `origin` links (as inherited) unchanged; quote renders chunk text.
4. **Idempotency:** replay the same capture (same `idempotency_key`) three times, including after a simulated crash mid-extraction; exactly one source exists.
5. **Correction integrity:** correct a transcript; original bytes still retrievable; corrected reading renders; both labeled per §12C.
6. **Isolation (adversarial):** the §12B two-space nearest-neighbor plant never surfaces across spaces — via search, via node links, via embeddings, via background-job output.
7. **Offline retrieval:** with no API keys configured, exact phrase and exact word searches return the source; vector lag flag visible; degradation notice present.
8. **Honest failure:** force a persistence failure; capture reports failure, claims nothing preserved, local draft retained.
9. **Timezone:** capture timestamps display in the space's local time (America/New_York for the owner); suite passes under America/New_York and Pacific/Kiritimati, matching the repo's existing TZ test discipline. No UTC in any user-facing string.
10. **Forget cascade:** forget a source; its chunks, FTS rows, vector rows, and solely-derived nodes are gone from every surface; other sources untouched.

## 15. Schema, migration, failure modes, rollback

- **Schema:** four new tables via `BOOTSTRAP_SQL` + additive `CREATE TABLE IF NOT EXISTS` migrations in `migrateSchema` (the repo's established pattern). **No changes to existing tables** — `nodes` gains no columns; provenance lives entirely in `node_sources`. Indexes: `sources (space_id, occurred_at)`, unique `sources (space_id, idempotency_key)`, `source_chunks (space_id, source_id, ordinal)`, `sources_fts` (FTS5), a chunk vec table mirroring `vec_episodes`.
- **`SPACE_SCOPED_TABLES`:** add `sources`, `source_chunks`, `node_sources`, `source_corrections`. FTS/vec index tables follow the existing index-table handling (parent-row joins), to be verified against `auth/spaces.ts` erase logic at approval review.
- **Existing knowledge documents:** V1 does **not** migrate `knowledge_docs`/`knowledge_chunks`. The source model reserves `kind=document` compatibility; folding knowledge docs in becomes a later, separate, dual-read migration decision. V1 must not silently strand or double-count them — search in V1 covers captures; knowledge docs keep their existing path. **Flagged as the one open migration question for the approval review.**
- **Failure modes:** extraction fail → preserved, retryable (§12A). Embedding fail → FTS-only + announced (§12E). FTS insert fail → the whole capture transaction rolls back → honest failure (§13). Crash between persist and extract → boot scan finds `preserved_unprocessed` sources and resumes. Audio store fail → text/transcript path proceeds, absence recorded on the source. Hash mismatch on read → quarantine + report.
- **Rollback:** V1 is additive-only, so rollback = stop: new captures fall back to today's pipeline, the new tables are left in place, **sources already preserved are never deleted by a rollback**. Disclosed risk: a pre-V1 build cannot read sources, so captures made during a V1 window would be invisible (not lost) under a downgrade — mitigated by brain export including sources from V1 onward.

## 16. Reconciliation record (against the existing program, checked 2026-10-23)

- **Tab-by-tab audit program (repo chat):** V1 touches ingestion and the capture surfaces. It does not redirect any audit finding (findings are additive; GH items keep their priority, GH-19 first). Alignment, not conflict: Round 1's honesty fixes attacked "failure indistinguishable from emptiness" — V1's honest-failure rule (§13) extends that same principle to capture. Before V1 is *presented for approval*, the capture-adjacent audit items get a joint pass with the repo chat.
- **ADR-019 (Money bill lifecycle, merged PR #93):** no overlap. Financial ingestion (`fin_*`, paystub/financial-image extraction) is a separate pipeline and is **not** a V1 source kind.
- **ADR-020 (pending approvals, design complete, gate partially open):** no conflict. Source corrections use the established append-only corrections pattern; nothing here adds a write path that bypasses the approval machine, and the dream_playback approval gate is untouched.
- **W1/W3 temporal layer:** sources adopt its discipline — `recorded_at` immutable, `occurred_at` as valid-time, append-only corrections, supersession vocabulary reused for links (§12D). W3's contradiction machinery is what a later contradiction view (§4.4) would build on — deferred, not redesigned.
- **Phase 3 (Gmail/Calendar/Drive, design only):** if Google content is ever ingested, it would arrive as `imported_text` sources under Phase 3's untrusted-data fencing. V1 neither authorizes nor designs that; it only leaves the source kind available.
- **Worlds P2-1→P2-4 (Worlds chat):** Track B stays separate per the verdict. V1–V5 touch no travel/fuel code; the V5 Deep Past binding reconciles against the P2 gates when its turn comes. P2-4's build still needs its own owner word; nothing here changes that.
- **Standing rules:** no UTC user-facing (§14.9) · space ID permanent, unchanged · TTS/push remain off · offline fallback sacred (§12E) · merge/deploy remain the owner's separate calls.

## 17. Track separation (adopted from the verdict)

- **Track A — Source preservation and recall:** §§1–5, 12–16 (V1–V5). Private knowledge only. Next step: this Rev 2 goes back through the review loop (owner's relay), then to the owner for the V1 approval decision. Implementation remains unauthorized.
- **Track B — Shared worlds and presence:** §6, §10, §11 (V6). Own design gate, own authorization. Settled so far: world classification (§10), Deep Past private (owner), pinned notes yes-in-principle (§11). Still open: visibility default, contact level.

---
*Rev 2 prepared by the third Soumaya chat. Review verdict quoted/paraphrased from the owner's relayed Design Review (2026-10-23): ACCEPTABLE AS A DESIGN PROPOSAL, NOT APPROVED FOR IMPLEMENTATION.*

---

# REV 3 — Final clarifications, joint audit, and the owner decision (2026-10-23)

## 18. The four Rev 2 clarifications, closed

### 18.1 Forgetting vs immutability — dependency-aware erasure
Immutability governs *editing*. Forgetting governs *existence*. They never conflict because they are different operations with different doors:

- **Ordinary node deletion** — never touches any source. (Unchanged from §12D.)
- **Source forgetting** — an explicit owner act that goes through the repo's existing forget machinery: a `forget_requests` row, approved, executed by the single authorized deletion path (the INV-DEL-1 pattern in `agent/episodic.ts`: no DELETE outside `applyForgetRequest`). V1 invents no second deletion door.
- **Dependency rule:** a node is erased with a forgotten source **only if that source was its sole remaining origin**. If other sources independently support the node (other active `origin`/`support` links), the node survives — but survival is not automatic cleanliness:
  - The forgotten source's chunks, FTS rows, vector rows, corrections, and `node_sources` links are erased.
  - Any surviving dependent node is queued for **scrub verification**: its content is checked for verbatim spans of the forgotten chunk text. If a span is found, the node is regenerated from its remaining sources; if it cannot be verified clean, it is tombstoned. A node may never keep forgotten words by hiding inside a summary.
- **Every persisted representation is in scope**, enumerated: `sources`, `source_chunks`, `source_corrections`, `node_sources`; node + episode FTS and vec rows; derived artifacts that can embed text — episode summaries/details, insights, daily logs, TTS cache rows keyed to the source, and agent/chat caches referencing it. The erasure job walks this list; the acceptance sweep (§18.5) greps all of it for a planted unique string.
- **Retention constraints, stated honestly:** the product has no legal-hold system, so no legal retention blocks erasure. Two operational residues are disclosed, not hidden: (1) Fly volume snapshots (daily, ~5-day retention) age out on their own schedule — erasure is complete in the live system immediately and in snapshots within their retention window; (2) exports the owner already downloaded are his own copies on his own storage — the system cannot reach into files he holds, and the forget confirmation says so in plain language.

### 18.2 Bytes, hash, and correction ordering — one precise contract
- **Authoritative storage is bytes.** `sources` stores `raw_bytes` (BLOB — the exact payload bytes as received at the server boundary) and `raw_text` (TEXT — a deterministic UTF-8 decode of `raw_bytes`). `content_hash` = SHA-256 over `raw_bytes`; `byte_length` = length of `raw_bytes`. If bytes are not valid UTF-8, `raw_text` is NULL and the source is flagged `encoding = 'binary'` — the hash still covers the bytes, and the source is retrievable as a file, never as a fake decode.
- **Per-kind capture contract (what "received" means):** Telegram — the message text exactly as delivered by the Telegram API, encoded UTF-8, **no normalization of any kind** (no NFC, no trim) at any point. Web chat / ingest — the JSON string value exactly as submitted, encoded UTF-8. File import — `raw_bytes` = the file's bytes, hash over the file; text extracted from it is a *derived* artifact (chunks are built from the extracted text; the extraction is labeled `imported_text` per §12C). **Draft rule** (from the joint audit, §19): the source is what the owner *submits* at capture commit — edits made in the ingest draft before saving are pre-capture and are not owed preservation.
- **Corrections ordering:** `source_corrections` carries a per-source monotonic `seq`, assigned inside the same transaction as the insert (`max(seq)+1`), with a unique index on `(source_id, seq)`. Deterministic replay = ascending `seq`, always.
- **Overlap/conflict rule:** a correction is anchored to the **original** chunk text by character offsets — corrections never chain onto corrected text. Overlapping corrections: the later `seq` wins for the overlapping range; the earlier correction remains in history, and the current reading shows a conflict marker where an overlap occurred. Non-overlapping corrections apply independently. Replay is therefore deterministic and auditable end to end.

### 18.3 Durable processing state — status, lease, idempotent retries
- `sources` carries: `processing_status`, `processing_attempts`, `processing_lease_owner`, `processing_lease_expires_at`, `extraction_hash`.
- **States and allowed transitions:** `preserved` (transaction committed; chunks + FTS live) → `extracting` (claimed) → `extracted` (terminal success) or → `extraction_failed` (retryable) → `extracting` (re-claim) … → `failed_permanent` (after 5 attempts; owner-visible, §below). No other transitions exist; a source can never return to a pre-`preserved` state.
- **Concurrency guard:** claiming is one atomic conditional UPDATE — set `extracting`, lease owner, lease expiry (15 minutes) — only where status is `preserved`/`extraction_failed` and no live lease exists. Exactly one worker wins; a crashed worker's lease expires and the boot scan reclaims the source. No job platform is built; this is one column set and one guarded UPDATE, consistent with the review's "additive, not a platform" bound.
- **Retry idempotency downstream:** a completed extraction records `extraction_hash` (hash of the extractor's node set for this source). A retry that reproduces the same `extraction_hash` reuses the existing nodes — it creates none. `node_sources` has a unique index on `(node_id, chunk_id, role)`, so provenance links cannot duplicate under any retry pattern.
- **Permanent failure surfacing:** `failed_permanent` sources appear in the owner's Inbox as a plain-language item ("a note was saved but couldn't be processed — it's preserved and searchable; retry or leave it"). The source remains fully preserved and exact-searchable in that state. Nothing is ever auto-discarded.

### 18.4 Migration and rollback — the explicit gate
V1 implementation may not be *authorized* until these four verifications exist as evidence (tests or a recorded check), in addition to §14:
1. **Bootstrap/migration agreement:** fresh-DB bootstrap and legacy-DB migration produce identical schemas for the four new tables (schema-diff test, both paths).
2. **Space erasure completeness:** erasing a space removes all dependent FTS and vector rows for sources/chunks, verified against `SPACE_SCOPED_TABLES` + index-table handling in `auth/spaces.ts`.
3. **Export/restore round-trip:** the brain export format is version-bumped and includes sources (bytes as base64); restore reconstructs sources, chunks, and indexes, and verifies every `content_hash`. An export taken before V1 still restores (sources simply absent).
4. **Downgrade warning is procedural, and is owned as such:** an old binary cannot be made to warn — that is stated plainly rather than papered over. The contract is: the V1 deploy checklist requires (a) a fresh export + `brain.db` backup before deploy, and (b) the owner's explicit acknowledgment that downgrading past V1 makes source-only captures invisible (not lost — they remain in the DB and in exports) until a V1+ build returns. V1+ builds log their preserved-source count at startup so the fact is never silent on the way back up.
- **Knowledge documents:** the §15 open question is now a *decision for V1*: **no migration** of `knowledge_docs`/`knowledge_chunks` in V1 — explicit, not implicit. Revisit only as its own later dual-read migration proposal.

### 18.5 Acceptance criteria — additions to §14
11. **Dependency-aware erasure:** forget a source that shares a node with a second source — the node survives, scrub-verified clean of the forgotten text; forget the second source — the node is erased. Plant a unique string in the forgotten source and sweep every representation listed in §18.1: zero hits.
12. **Byte fidelity across transports:** the same text via Telegram, web chat, and file import produces three sources whose `raw_bytes` decode to the submitted text exactly; hashes verify; a non-UTF-8 file imports as `binary` with a valid hash and no fabricated text.
13. **Correction determinism:** two overlapping corrections replay in `seq` order to one deterministic reading, conflict marker present, original untouched.
14. **Single-winner extraction:** two workers race one source — one extraction, one node set, no duplicate links; kill the winner mid-run — lease expiry + boot scan completes it exactly once.
15. **Export/restore:** export → wipe → restore → all §14.1 byte checks pass against the restored sources.

## 19. Joint capture-adjacent audit — against the repo audit program (checked 2026-10-23)

Checked against `~/workspace/ui-audit/fix-program/CHECKLIST.md` + `QUESTIONS.md` and the forget machinery in the repo. **All existing findings and priorities are preserved; nothing is re-ranked, closed, or redirected by this note.** Capture-adjacent state:

- **Round 1 (done):** the Recall honesty trio and the failure-vs-emptiness fixes. V1 extends the same principle to capture (§13 honesty rule) — aligned, no duplication: Round 1 fixed *display* honesty; V1 adds *persistence* honesty.
- **Round 2 (done): IM-116 file import** — extracted text lands as an editable draft, never auto-saved. → Produced the §18.2 draft rule: preservation is owed to the *submitted* text, not the pre-edit extraction. **IM-117** — ingest draft persistence, discard confirm, separated error surface, mic parity: V1's client draft-on-failure (§13) builds on IM-117's draft, not a new one. **IM-141 quick capture** (share target + "C" shortcut) — new capture entry points already exist; V1's capture contracts (§13) must cover all of them, including share-target submissions.
- **Parked/blocked, untouched by V1:** IM-144 Telegram voice-note TTS (BLOCKED-Q3, a *spend* decision) — that is spoken *replies*; V1 does not build it, and V4 transcription (speech *in*) must not be confused with it. Q8 (brain deletion + passcode routes don't exist server-side) stays an open audit question — V1's *source-level* forgetting rides the existing `forget_requests`/INV-DEL-1 path (§18.1) and neither needs nor preempts Q8's whole-brain deletion decision.
- **Money tab / GH program:** untouched. GH-19 remains the audit program's top trust item; V1 does not leapfrog it in the repo chat's queue — V1 implementation scheduling is a repo-chat reconciliation at build time, after the owner's approval here.
- **Net finding of the joint pass:** no audit item blocks the V1 *design*; two items shape it (IM-116 → draft rule; INV-DEL-1 → forgetting door), and one boundary is confirmed (Q8 stays separate).

## 20. Unresolved risks (recorded, not expanded) + the owner decision

Risks that survive Rev 3, stated for the approval decision:
- **R-1 Transcript truth ceiling:** ASR is never guaranteed word-for-word (§12C). Mitigated by audio preservation + labels; not eliminable. Voice sources (V4) inherit this.
- **R-2 Snapshot/export residue:** forgotten text can persist up to ~5 days in Fly volume snapshots, and indefinitely in exports the owner already holds (§18.1). Disclosed at forget time; not technically eliminable.
- **R-3 Downgrade invisibility:** source-only captures are invisible to pre-V1 builds (§18.4). Procedural gate only.
- **R-4 Storage growth:** preserving every original byte grows `brain.db` monotonically. No quota/pruning is designed in V1; the owner's brain is small today (245 nodes) — flagged for a later phase, not solved here.
- **R-5 Knowledge-doc split-brain:** until a later migration, search has two homes (captures vs knowledge docs). Accepted for V1 (§18.4), visible in the design, not hidden.

**The ask:** approve (or decline) the **V1 design** as finalized in Rev 1–3 — source + chunk model, capture contracts, integrity/isolation/erasure rules, offline contract, acceptance criteria §§14+18.5, migration gate §18.4 — as the working design of record for Track A. Approval of the design is **not** implementation authorization: the build still needs its own go-ahead, its §18.4 gate evidence, and reconciliation with the repo chat's queue at build time. Track B (shared worlds) is not part of this ask.

---
*Rev 3 prepared by the third Soumaya chat. Verdict basis: owner's relayed Rev 2 Design Review (2026-10-23): READY FOR THE OWNER'S V1 APPROVAL REVIEW, NOT AUTHORIZED FOR IMPLEMENTATION.*

## 21. Rev 3 review disposition (relayed by owner, 2026-10-23)

- **Recommendation received:** APPROVE Rev 1–3 as the V1 design of record for Track A, with the qualification that approval **preserves the implementation gates** and is **not** authorization to build. The reviewer states the boundary explicitly: a recommendation is not the owner's approval — *"the recorded approval must come from the owner."*
- **Qualification recorded as binding on any future implementation authorization:** (1) capture fidelity proven against the per-kind byte contract (whitespace, Unicode, invalid UTF-8); (2) erasure completeness verified against an inventory matched to the *actual* repository, not the design's list; (3) schema/isolation/export/restore/space-deletion tested against actual code; (4) repo-chat queue reconciliation at build scheduling, GH-19 not leapfrogged. Any material contradiction found during implementation returns to this design gate rather than being patched around.
- **Decision boundary (per the review):** Track A V1 design → approval recommended · Track A implementation → NOT authorized · §18.4 evidence → mandatory before implementation authorization · Track B → excluded · V2–V6 → separate decisions. §20's five residual risks remain visible and unsolved-by-design.
- **Status after this entry:** recommendation recorded; **owner approval PENDING his explicit word.** The gate-evidence checklist prepared for the eventual build ask lives at `~/workspace/verbatim-recall/v1-implementation-gates-checklist.md`.

## 22. OWNER APPROVAL — recorded (2026-10-23, 11:54 AM ET)

The owner approved, by his own explicit word in this chat ("Approve the V1 design of record"):

- **Rev 1–3 of this note are the V1 DESIGN OF RECORD for Track A** (source preservation and recall: source/chunk model, capture contracts, integrity, isolation, erasure, offline behavior, migration gate, acceptance criteria §§14 + 18.5).
- **Scope limits of this approval, as approved:** implementation is **NOT authorized**; the §18.4 / gate-checklist evidence remains mandatory before implementation authorization can be requested; repo-chat queue reconciliation (GH-19 not leapfrogged) is mandatory at build scheduling; **Track B (shared worlds and presence) is excluded** from this approval; **V2–V6 remain separate phase decisions**.
- §20's five residual risks stand as disclosed.

**State after approval:** design gate for V1 = CLOSED (approved design of record). Next step exists only when the owner gives a further word: production of gate evidence toward an implementation-authorization ask. Nothing starts automatically.

## 23. Pre-implementation evidence — addenda to the design of record (2026-10-23)

Produced at the owner's "Ready" (full package: `v1-gate-evidence-preimplementation-2026-10-23.md`). Read-only repo inspection; **no material contradiction with Rev 1–3 was found.** Two refinements and two build requirements are recorded here so the design of record stays truthful:

- **Refinement 1 — file-import boundary:** the current architecture extracts file text client-side; the server never receives file bytes. For that flow the V1 source is the *submitted extracted text* (hash over its UTF-8 bytes, class `imported_text`). Preserving original file bytes would require a new upload route — **out of V1 scope**. This clarifies §18.2's per-kind contract at the server boundary; it does not weaken it.
- **Refinement 2 — telegram-note legacy nuance:** Telegram notes (`telegram/notes.ts saveTelegramNote`) already store content verbatim, bypassing extraction. Legacy labeling at V2 should distinguish those nodes (`origin='telegram'`, quotable in fact, though hashless/chunkless) from extraction summaries, rather than marking every legacy node summary-only.
- **Build requirement 1:** source chunking must not reuse `knowledge/ingest.ts chunkText` (it normalizes CRLF and collapses blank lines). Source chunks are exact substrings with offsets.
- **Build requirement 2:** V1's `sources_fts` + chunk vec table must be registered in `DERIVED_INDEXES` (`auth/spaces.ts`) alongside the four tables in `SPACE_SCOPED_TABLES`, so transactional space erasure covers them.
- **Gate conversion:** §18.4 item 3 (export/restore round-trip) has no existing restore facility to verify against (export exists; restore does not). It is converted from pre-implementation evidence into a **build deliverable**: V1 ships the versioned export including sources *and* a restore path with hash verification, or returns to this gate to rescope.

## 24. Self-check record (owner's "check your work," 2026-10-23)

Full re-verification of this note, the evidence package, the gate checklist, and the memory records against the actual repo and files. Findings:

- **F1 — FACTUAL ERROR, CORRECTED: the space-scoped table count.** The evidence package (E2) and the memory record stated **73** tables in `SPACE_SCOPED_TABLES`. Programmatic count from `auth/spaces.ts`: **64**. The 73 was an eyeballed figure that was never counted — exactly the failure this design exists to prevent, and it is corrected in the evidence package, in `~/MEMORY.md`, and here. The inventory's table *names* were and are correct (taken from the array itself); only the count was wrong. The chat report that carried "73" to the owner is corrected by this section and by the report that delivers it.
- **F2 — STALE CROSS-REFERENCE, FIXED:** §6.3's third bullet still framed public excerpt-sharing as an open question after §11 decided it (pinned notes: yes). An amendment pointer now sits under the §6.3 heading; §§10–11 govern. Bullets 1–2 (visibility, contact) are genuinely still open — no change there.
- **F3 — SCHEMA AMBIGUITY, CLARIFIED:** §4.1's original `sources` sketch predates Rev 3. For the record: **§§18.2–18.3 extend and govern the source schema** — `raw_bytes` (authoritative) alongside `raw_text`, the citation class, and the processing fields (`processing_status`, `processing_attempts`, lease columns, `extraction_hash`) are part of the design of record even though §4.1's sketch doesn't list them. Likewise §15's "open migration question" (knowledge docs) was **decided in §18.4** (no migration in V1); §15 is superseded on that point.
- **F4 — ATTRIBUTION NIT, CORRECTED:** evidence E2 grouped `lore` (and loosely, `corrections`) into §18.1's original enumeration; §18.1 did not name `lore`. E2 now lists `lore` among the inventory's additions, where it belongs. No design consequence.
- **F5 — RE-VERIFIED, NO CHANGE:** export counts (245 nodes / 962 edges) · Telegram `PART_SEPARATOR` = `"\n"` · action-kind ingest trims text · ingest body limit 20,000 chars · `nodes.idempotency_key` exists (bootstrap column + ALTER path in `client.ts`) · `DERIVED_INDEXES` = 7 entries · `deleteSpace` requires passcode + exact gamer-tag, single transaction, derived indexes first · **no restore facility exists** (re-searched server + web; SettingsPanel only *downloads* the export) · `saveTelegramNote` verbatim + draft kept on failure · `chunkText` normalization · approval recorded at 11:54 AM ET, 2026-10-23 · checklist Gate 0 ✓ and Gate 2 inventory ✓ states are accurate · 19 Keys citations (manual Lines 03/05/35/44/49) checked against the fetched page.
- **F6 — SCOPE CHECK, CLEAN:** no file produced by this chat claims or implies implementation authorization; Track B's exclusion is stated consistently (§§17, 20, 21, 22); the second 19 Keys point (§9) remains honestly open and was never built upon.

**Disposition:** one factual error (F1), one stale reference (F2), one ambiguity (F3), one attribution nit (F4) — all corrected in place with the original text preserved. Nothing found changes the approved design's substance; F1/F4 touch only the evidence record, F2/F3 only cross-references. The design of record (§22) stands as approved.

## 25. Implementation ask prepared (2026-10-23)

At the owner's "Continue," the implementation-ask package was prepared: `v1-implementation-ask-2026-10-23.md`. It scopes the build to §13 exactly (schema + capture wiring at the E1-traced insertion points + processing state + forget integration + export/restore deliverable + provenance plumbing; no V2–V6, no Track B, no knowledge-doc migration), sets the exit gates (full repo gate + §§14/18.5 acceptance tests + §18.4 items 1–2 + post-build ChatGPT audit; merge/deploy remain the owner's separate taps), and proposes queue terms to the repo chat (**V1 does not leapfrog GH-19; no interleaving with the in-flight pitfall-hunt fixes; one branch, one increment, when slotted**). The package is an ask — the owner's separate implementation authorization is the decision, and it is pending as of this entry.

## 26. OWNER IMPLEMENTATION AUTHORIZATION (2026-10-23, 2:26 PM ET — his explicit word, this chat)

The owner authorized the V1 build: **"Authorize the V1 build"** (tapped and typed, 2026-10-23). Scope of this authorization:

- The build is exactly the ask package's §1 scope (`v1-implementation-ask-2026-10-23.md`), gated by its §2 exit gates (full repo gate + §§14/18.5 acceptance tests + §18.4 items 1–2 as tests + post-build ChatGPT audit). **No weakened gates** — any scope or architecture contradiction returns to the design gate.
- **Queue discipline is binding:** GH-19 and the in-flight pitfall-hunt work keep their established priority; one schema-touching branch at a time; the build begins when the repo chat's queue allows it, per Gate 4. Execution runs in the repo chat's lane.
- **Merge and deployment are NOT authorized** — they remain the owner's separate decisions, with the deploy gates mandatory (fresh export + `brain.db` backup + downgrade acknowledgment).
- V2–V6 and Track B remain unauthorized, each behind its own gate.

A decision review relayed by the owner alongside his authorization recommended exactly this outcome with the same three binding conditions (queue discipline, no weakened exit gates, separate release decisions) and correctly identified itself as a recommendation, not the authorization. The owner's own word above is the authorization of record.

## 27. Queue slotting confirmed by the repo chat (2026-10-23)

The repo chat registered the §26 authorization and slotted V1 under its own queue discipline: **Batch B (carrying GH-19) is in flight; when B lands, V1 becomes the next — and only — schema-touching build in the queue, ahead of ADR-021's implementation** (whose gate is still open). Exit gates stand as authorized; merge and deployment remain the owner's separate calls, with export + brain backup owed before any deploy. The audit register's lost-words item moved from *blocked* to *authorized-and-queued* and left the owner's decision queue. Gate 4 (checklist) is thereby discharged — the determination was the repo chat's, as proposed.
