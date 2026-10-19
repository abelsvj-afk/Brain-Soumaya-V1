# W2 Design — Episodes + User Model

**Status:** Draft (not yet reviewed)
**Depends on:** W1 (temporal truth) — Revision 7
**Scope:** Episodic memory (C1) + Theory of Mind user model (C3) from the wisdom-layer research
**Surfaces:** Shared backend (`packages/server`) — web app and Telegram both benefit

---

## 1. Problem statement

W1 gave Soumaya *temporal truth*: facts carry when they were true, when they were recorded, and when they were superseded. The digest can no longer surface "in between jobs" as current.

But W1 only fixes *what is true*. It does not fix *what it was like*, *what he knows*, or *what the bot believes about him*. Three concrete failures W1 cannot prevent:

1. **No texture.** "Started Samsonite job Oct 16" is a semantic fact. The episode — the 4:35 AM alarm, the 90-minute bus ride, first-day nerves, what it meant (first steady paycheck in months) — is lost. When the user says "remember when I started the job," there is nothing to remember *with*.
2. **No model of his mind.** The digest once said "you're in between jobs" to an employed man. W1's temporal filter would now exclude the stale fact — but the deeper failure was the bot having *no representation* that the user *knows* he has a job and would read that line as evidence the bot doesn't know him. Truth-checking facts is not the same as understanding the person reading them.
3. **No provenance for inference.** When the bot eventually says "you seem to prefer X," there must be an answer to "why do you think that?" that points at evidence, not vibes. The `user_persona` text blob cannot do this — it's a static sketch with no confidence, no provenance, no correction path.

W2 builds two stores: **episodes** (what happened, with texture) and the **user model** (what the system believes about the user, with evidence and confidence). Both are append-only-or-versioned, never destructively overwritten — the W1 principle ("a memory can stop being current without its history being rewritten") applies here too.

---

## 2. Design principles

These are hard constraints, not aspirations. Violating any of them is a design-review blocker.

1. **Evidence is first-class.** Every user-model entry carries its evidence (episode/node IDs), its origin (`stated` | `inferred` | `consolidated`), and its confidence. An entry without evidence is not stored.
2. **Stated beats inferred.** On conflict, a stated entry always wins. Inference is evidence, never authority. (From the research: the Clever Hans effect — models get ToM answers right for wrong reasons. The data structure must not trust the inference.)
3. **No promotion by repetition of the same weak signal.** An inferred entry's confidence rises only from *independent* corroborating evidence — different episodes, different days, different signal types. Seeing the same pattern in the same conversation three times is one observation, not three. (ChatGPT's explicit W2 flag.)
4. **Correctable by construction.** Every user-model entry is inspectable and correctable. A user correction writes a `stated` entry at maximum confidence and invalidates the contradicted inferred entry. Corrections never delete — they supersede, per W1.
5. **First-order theory of mind only.** The model represents what the user believes/wants/knows/feels *about the world*. It does NOT model what the user believes about the bot's beliefs (second-order), or any deeper nesting. Current models degrade sharply on higher-order ToM (ToMBench: 10+ point lag; Hi-ToM: o3 drops to 0.467 at order 4). The schema does not even have a place to put higher-order claims.
6. **Episodes are append-only.** The past doesn't change. An episode is never updated or deleted. If an episode was wrong (misrecorded), a *correction episode* is appended and linked — the same pattern as W1's `corrections` table.
7. **No model-driven deletion, anywhere.** Consolidation may propose, decay may demote, but nothing in W2 deletes rows. Soft-forgetting (rank demotion) is a W3 concern, not W2.
8. **Hot path stays cheap and deterministic.** Episode *capture* on the hot path is template-based and free. LLM enrichment is significance-gated and runs in background (LangMem's hot-path/background split). The user model is never written by the hot path — only by explicit user statements and the W3 consolidation job.

---

## 3. Episodes

### 3.1 What an episode is (and isn't)

An **episode** is a structured record of a *lived event* in Tulving's sense: bound to time, place, participants, and felt sense. It is the raw material from which semantic facts are distilled — not the facts themselves.

**Not episodes:**
- `nodes` — semantic facts ("started Samsonite job Oct 16"). Nodes are the *distillation*; episodes are the *source*.
- `daily_logs` — end-of-day summaries. A daily log is a *synthesis across* episodes; an episode is a *single event*.
- `lore` — galaxy narrative chapters. Lore is *storytelling about* the galaxy; episodes are *records of* experience.
- `working_memory` — ephemeral thought-motes. Working memory is *what the system is thinking now* (decaying, promotable); episodes are *what happened* (permanent, append-only).
- `agent_logs` — operational audit trail. Agent logs record *that an action happened*; episodes record *what it was like*. (W5's agent autobiography will bridge these.)

**The relationship:** one episode may distill into zero, one, or many nodes. One node may cite multiple episodes as provenance. The link is stored on the episode (`source_node_ids`) and queryable from the node side via a join — facts point back to the experiences they came from.

### 3.2 Schema

```sql
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL DEFAULT 'legacy',

  -- What happened (narrative, first-person as the user)
  kind TEXT NOT NULL,              -- 'conversation' | 'agent_action' | 'job_run'
                                   --   | 'digest_sent' | 'proactive_msg' | 'correction'
                                   --   | 'milestone' | 'session'
  summary TEXT NOT NULL,           -- 1-2 sentence narrative ("I started the Samsonite job today...")
  detail TEXT,                     -- texture: quotes, sensory detail, emotional beats (NULL if insignificant)

  -- Affective-semantic metadata (enriched at write time, §3.4)
  emotion TEXT,                    -- dominant emotion label, controlled vocabulary (§3.5)
  emotional_weight REAL,           -- -1..1 (mirrors nodes.emotional_weight)
  importance REAL NOT NULL DEFAULT 0.5,  -- 0..1, Smallville-style significance rating

  -- Time (W1 temporal conventions: canonical ISO 8601 UTC)
  occurred_at TEXT NOT NULL,       -- when it happened in the world
  recorded_at TEXT NOT NULL,       -- when the system recorded it (immutable, cf. W1)
  -- NOTE: episodes are append-only, so there is no valid_to/superseded_at.
  -- A misrecorded episode is corrected by appending a new episode with
  -- corrects_episode_id set — the original row is never mutated.

  corrects_episode_id INTEGER,     -- NULL normally; set when this episode corrects a misrecorded one

  -- Participants and place (structured, not buried in prose)
  participants TEXT NOT NULL DEFAULT '[]',  -- JSON array of names/roles ("Shaqavia", "Allegiance recruiter")
  place TEXT,                      -- free text ("Samsonite warehouse, Jacksonville")

  -- Provenance links
  source_node_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of node ids distilled FROM this episode
  source_transcript_ref TEXT,      -- pointer to raw transcript/log location (opaque string, may be NULL)

  -- Retrieval
  embedding BLOB,                  -- sqlite-vec embedding of summary + detail (NULL until enriched)

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_episodes_space_time ON episodes(space_id, occurred_at);
CREATE INDEX idx_episodes_kind ON episodes(space_id, kind);
CREATE INDEX idx_episodes_corrects ON episodes(corrects_episode_id);
```

**Why `recorded_at` but no `valid_from`/`valid_to`:** an episode is a record *of* an event, not a claim *about* the world. The event happened when it happened (`occurred_at`); the system learned about it when it recorded it (`recorded_at`). There is no "stopped being true" for a lived event — October 16 happened. If the *record* is wrong, the correction pattern (append + link) preserves both the error and its correction, exactly as W1's `corrections` table does for facts.

**Why `source_node_ids` lives on the episode, not a join table:** the link is written once at distillation time and never changes. A JSON array is sufficient, matches the existing `inquiries.node_ids` pattern, and avoids a join table for a write-once/read-many relationship. (If query patterns later demand it, a materialized join can be added without changing the contract.)

### 3.3 Episode kinds

| Kind | Trigger | Example |
|---|---|---|
| `conversation` | A chat session (web or Telegram) with substantive content | "Talked through the CNA fee plan; he's anxious about the money order timing" |
| `agent_action` | The agent took a notable action on his behalf | "Sent the bill-risk alert for the CNA fee" |
| `job_run` | A background job ran (digest, consolidation, router tick with findings) | "Nightly digest sent with 4 sections" |
| `digest_sent` | A digest was delivered (subset of job_run, kept distinct for analytics) | — |
| `proactive_msg` | The bot initiated contact | "Sent the morning check-in nudge" |
| `correction` | The user corrected the bot or a fact | "He corrected the bus route: it's the 8, not the 3" |
| `milestone` | A first-time or significant life event detected | "First day at Samsonite — first steady paycheck in months" |
| `session` | App session with notable interaction (galaxy exploration, etc.) | — |

The `kind` column is a closed vocabulary enforced by a CHECK constraint in the fresh schema and by application validation in the migration path (same pattern as W1's reason codes).

### 3.4 Write paths: capture (hot) vs enrichment (background)

Following LangMem's hot-path/background split:

**Capture (hot path, synchronous, free).** After every significant interaction, `captureEpisode()` writes a row with:
- `summary`: template-generated from the interaction type (no LLM). E.g., for a conversation: first user message + tool calls made + outcome, truncated.
- `detail`: NULL initially.
- `emotion`, `emotional_weight`: heuristic defaults (NULL / 0) — enrichment fills these.
- `importance`: heuristic 0.5 default — enrichment may raise it.
- `occurred_at` / `recorded_at`: `new Date().toISOString()`.
- `embedding`: NULL initially.

The capture path does **zero LLM calls and zero embedding calls**. It is a single INSERT. It cannot fail the interaction — on any error, it logs and continues (episodes are observability-grade, not transaction-critical).

**Significance filter (hot path, heuristic, free).** Determines whether the episode qualifies for background enrichment:
- Contains a first-time event (new node created, new topic, new person mentioned), OR
- Emotional spike (|emotional_weight| > 0.5 from the interaction's existing signals), OR
- A decision was made (approval confirmed/denied, choice selected), OR
- A correction occurred, OR
- The user explicitly said something about their life (not small talk).

Episodes failing the filter keep their template summary permanently. This is deliberate: the timeline feature wants completeness, and a cheap template row is better than nothing. (Contrast with the "discard insignificant episodes" advice in some literature — Soumaya keeps the cheap version because the timeline is a user-facing feature.)

**Enrichment (background, LLM-gated).** A background worker (W3's consolidation job will own the scheduling; W2 provides the `enrichEpisode()` function) processes significant episodes:
1. Generates `detail`: 2-4 sentences of texture — quotes, emotional beats, what it meant. First-person as the user.
2. Assigns `emotion` (controlled vocabulary), `emotional_weight` (-1..1), `importance` (0..1).
3. Extracts `participants` and `place`.
4. Computes and stores the `embedding` (summary + detail).
5. Links `source_node_ids`: nodes created during the source interaction get their IDs appended here. (Nodes do not need a backlink column — the join is episode→node, queried as "episodes that distilled into node X".)

**Idempotency:** enrichment is idempotent per episode (guarded by `embedding IS NOT NULL` + a `enriched_at` check — enrichment runs once). If the worker crashes mid-enrichment, the episode simply remains unenriched until the next pass. No partial state is user-visible because unenriched episodes are still valid rows.

**Fuel discipline:** enrichment is the only LLM cost in W2's write path, and it is bounded by the significance filter. The filter's selectivity is tunable via `space_meta` (default: enrich at most N episodes/day; N=20 default). If the budget is hit, remaining significant episodes wait for the next window — they are never dropped, only delayed.

### 3.5 Controlled vocabularies

**Emotions** (closed list, enforced by application validation):
`anxious`, `relieved`, `proud`, `frustrated`, `hopeful`, `overwhelmed`, `grateful`, `lonely`, `determined`, `ashamed`, `content`, `angry`, `sad`, `excited`, `neutral`

The list is intentionally small. Emotion labels are *observational and dated* (they describe the episode, not the person) — per the research, never treat them as traits. If a new emotion is needed, it goes through a schema-level addition, not free text — free-text emotions are unqueryable.

**Kinds** are listed in §3.3.

### 3.6 Read paths

**Episode retrieval** (`getEpisodes()` in the new `agent/episodic.ts` module):
- **By recency:** `WHERE space_id = ? ORDER BY occurred_at DESC LIMIT n` — the timeline view.
- **By similarity:** sqlite-vec KNN over episode embeddings + recency weighting — "remember when" queries.
- **By node provenance:** `WHERE json_extract(source_node_ids, '$') ...` — "what experiences led to this fact?" (SQLite JSON1 `json_each` join.)
- **By kind:** filtered timelines ("show me all corrections").

**Two-stage retrieval** (Arias Gonzalez pattern): Stage 1 — vector similarity + recency → top 40 candidates. Stage 2 — rerank by `0.5·similarity + 0.3·importance + 0.2·recency`. Retrieved episodes are injected into the agent's context as *narratives* ("Relevant past experiences:"), not as fact rows. Facts and episodes are different context shapes — the prompt template distinguishes them.

**What episodes are NOT used for:** "what is true now" queries. Those go to `nodes` (W1-filtered). Episodes answer "what happened," "when did we discuss X," "what was that like" — the mental-time-travel queries, not the knowing queries. This is the Tulving retrieval asymmetry, implemented as a routing rule in the agent loop's context builder.

---

## 4. User model

### 4.1 What the user model is (and isn't)

The **user model** is Soumaya's inspectable, evidence-backed representation of the user's mental life: what he believes, wants, intends, feels, knows, and what constrains him. It is first-order theory of mind made into data.

**Not the user model:**
- `user_persona` — the existing text blob. W2 does NOT delete or replace it. The blob becomes a *rendered view* — generated from the structured model (or left as-is where the model has no data). Existing consumers keep working.
- `values` (W4) — learned preferences from behavior. Values are *what matters to him as revealed by action*; the user model is *what he believes/wants/knows*. They overlap at `desire`/`constraint` slots, and W4 will write to those slots through the same API — but W2 does not build the behavioral ledger.
- Working memory, episodes, nodes — the model *cites* these as evidence; it is not made of them.

### 4.2 Schema

```sql
CREATE TABLE user_model (
  space_id TEXT NOT NULL,
  slot TEXT NOT NULL,              -- 'belief' | 'desire' | 'intention'
                                   --   | 'emotion_state' | 'knowledge' | 'constraint'
  content TEXT NOT NULL,           -- "believes the CNA fee is the top financial priority"
  confidence REAL NOT NULL,        -- 0..1 (see §4.4 for the scale)
  evidence_ids TEXT NOT NULL DEFAULT '[]',
    -- JSON array of {type: 'episode'|'node'|'correction', id: N}.
    -- Typed because evidence from different stores has different semantics.
  valid_at TEXT NOT NULL,          -- when this entry became the model's belief (canonical ISO UTC)
  invalid_at TEXT,                 -- when superseded (NULL = current). Cf. W1 bi-temporal pattern.
  origin TEXT NOT NULL,            -- 'stated' | 'inferred' | 'consolidated'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (space_id, slot, content, valid_at)
);
CREATE INDEX idx_user_model_current ON user_model(space_id, slot) WHERE invalid_at IS NULL;
CREATE INDEX idx_user_model_origin ON user_model(space_id, origin);
```

**Why composite primary key `(space_id, slot, content, valid_at)`:** the same belief can be held, lost, and re-held. ("Believes overtime is available" — true in October, false in November, true again in January.) Each holding is a distinct row with its own validity window. This is the bi-temporal pattern from Graphiti, applied to mental states instead of facts.

**Why `invalid_at` instead of deletion:** the model must be able to answer "what did I used to believe about him?" — for the user ("you used to think I wanted X") and for debugging ("when did the model get this wrong?"). Invalidation preserves history; deletion destroys it.

### 4.3 The six slots

Mapped from ToMBench's dimensions. Each slot has a distinct update rule and a distinct *consumer*:

| Slot | Represents | Example | Primary consumer |
|---|---|---|---|
| `belief` | What he thinks is true about the world | "believes the CNA fee is $85 and must be a money order" | Knowledge check (§6): don't assert contradictions |
| `desire` | What he wants | "wants the CNA license reinstated to get a second job" | Proactive relevance scoring (W6) |
| `intention` | What he's committed to doing | "intends to mail the money order this week" | Reminder/nudge generation |
| `emotion_state` | Current emotional weather (dated, never a trait) | "stressed about the fee; proud about the job (2026-10-19)" | Tone calibration; W6 timing |
| `knowledge` | What he already knows | "knows he works at Samsonite; knows the bus route" | Novelty check: don't tell him what he knows |
| `constraint` | Hard boundaries | "never suggest spending before the CNA fee is covered" | Safety rails on suggestions |

**Slot semantics are load-bearing.** A `belief` and a `knowledge` entry with the same content mean different things: belief is *what he thinks* (may be wrong — the bot can know it's wrong and still model that he believes it); knowledge is *what he demonstrably knows* (from having said it, acted on it, or been told it with acknowledgment). The knowledge check (§6) reads `belief` + `knowledge` together: contradicting a high-confidence belief is a *correction event* (handle carefully); restating known knowledge is *noise* (suppress).

**`emotion_state` entries are always dated and always expire.** An emotion_state row gets `invalid_at` set automatically after 7 days unless refreshed by new evidence. Emotions are weather, not climate. The schema enforces this: the consolidation job (W3) sweeps stale emotion_state rows. W2 provides the `sweepStaleEmotions()` function; W3 schedules it.

### 4.4 Confidence scale and promotion rules

Confidence is a number with *defined semantics*, not a vibe:

| Range | Meaning | Who can write |
|---|---|---|
| 0.95–1.0 | Certain. Reserved for `stated` entries and directly observed facts. | User statements; explicit confirmations |
| 0.70–0.94 | Probable. Multiple independent evidence sources agree. | Consolidation (W3) with ≥2 independent sources |
| 0.40–0.69 | Plausible. Single source or weak corroboration. | Consolidation (W3), single episode |
| 0.10–0.39 | Speculative. Thin evidence; kept for recall, never acted on. | Consolidation (W3) only; flagged `speculative` |
| < 0.10 | Not stored. Below the noise floor. | — |

**Promotion rules (the anti-weak-inference machinery):**

1. **Independence requirement.** Confidence rises only from *independent* evidence. Two mentions in the same conversation = 1 observation. The same fact restated by the user on three different days = 3 observations. An episode + a node distilled from that same episode = 1 observation (not 2 — the node is not independent of its source episode).

2. **Origin ceiling.** `inferred` entries (hot-path heuristics, if any are ever added) cap at 0.69. Only `consolidated` entries (W3's offline job, with full context) may reach 0.70+. `stated` entries start at 0.95.

3. **No confidence without evidence.** `evidence_ids` must be non-empty. An entry with empty evidence is rejected at write time (application-level invariant, tested).

4. **Decay.** Inferred/consolidated entries decay: confidence × 0.97 per week without refreshing evidence (mirrors W4's value decay; the mechanism is shared). Stated entries do not decay — they are invalidated only by a newer statement or an explicit correction. When a consolidated entry's confidence decays below 0.40, it is flagged for re-confirmation (surfaced as an inquiry candidate in W6, not silently dropped).

5. **Contradiction does not average.** If new evidence contradicts an entry, the entry is *invalidated* (set `invalid_at`), not averaged down. A new row is written for the new belief. Beliefs are not numbers to be smoothed; they are claims to be superseded. (This is W1's supersession logic applied to mental states.)

### 4.5 Write paths

**Three writers, strictly separated:**

1. **`stated` — the user, via explicit statement.** "I want X", "I believe Y", "don't ever Z". Written synchronously by the agent loop when it detects an explicit self-statement (pattern-matched, then confirmed by the loop's normal tool flow). Confidence 0.95. Immediately invalidates any contradicted `inferred`/`consolidated` entry in the same slot (same invalidation pattern as W1's `supersede()`: set `invalid_at`, link via a `superseded_by`-analog column — here, a `replaced_by` reference to the new row's identity).

2. **`inferred` — hot-path heuristics (W2: none).** W2 defines the origin and the ceiling (0.69) but ships *zero* hot-path inference rules. This is deliberate: hot-path ToM inference is where the Clever Hans effect lives. The slot exists for future phases; W2 leaves it empty. (A phase that adds inferred rules must go through the same review gauntlet.)

3. **`consolidated` — the W3 sleep job.** Reads the day's/week's episodes, proposes user-model updates with evidence links, applies the promotion rules. The *only* writer of `consolidated` entries. W2 provides the table and the write API (`updateUserModel()`); W3 provides the job that calls it.

**What W2 actually wires up:** the `stated` path. When the user makes an explicit self-statement in conversation, the agent loop records it. Everything else is schema + API, waiting for W3.

### 4.6 Correction semantics

Corrections to the user model follow W1's correction taxonomy, adapted:

| User says | Interpretation | Action |
|---|---|---|
| "That's wrong, I don't believe X" | False-belief correction (W1 Type 2 analog) | Invalidate the entry (`invalid_at` = now). Do NOT fabricate a validity interval. If the user states the true belief, write it as a new `stated` row. |
| "I used to want X, now I want Y" | Factual update (W1 Type 1 analog) | Close the old entry's window (`invalid_at` = now), write Y as `stated`. |
| "Stop assuming X about me" | Preference/silence override (W1 Type 3 analog) | Invalidate the entry. Do not write a replacement. Optionally add a `constraint` slot entry: "do not infer X" — but only if the user *states* it as a constraint, never inferred from the correction itself. |

**The "don't infer a constraint from a correction" rule** is the W2 analog of W1's Type 3 `endsValidity` flag: a correction is evidence that *this entry* was wrong, not evidence of a general rule. Generalizing from a single correction is exactly the weak-inference pattern §2.3 prohibits.

### 4.7 The `user_persona` blob

**Unchanged in W2.** The blob remains the rendered summary for existing consumers. A new function `renderPersonaFromModel()` generates a text summary from current user-model rows — and the system *prefers* the structured model wherever both exist. The blob is backfilled from the model on a schedule (W3), not the other way around. No existing code breaks: anything reading `user_persona` keeps working; new code reads `user_model`.

Migration path for existing blob content: W3's consolidation job may propose `stated`-equivalent entries distilled from the blob, but each requires the same evidence bar as any other entry. The blob is not bulk-imported — that would launder unprosecuted claims into the evidence-backed store.

---

## 5. Episode extraction: what becomes an episode

### 5.1 Capture triggers

`captureEpisode()` is called from these points (all existing code locations):

| Trigger | Location | Kind |
|---|---|---|
| Agent loop turn completes with ≥1 tool call or substantive exchange | `agent/loop.ts` `agentLoop()` return path | `conversation` |
| Telegram free-text exchange completes | `telegram/bot.ts` message handler | `conversation` |
| Reminder fired | `agent/tools/reminder.ts` | `agent_action` |
| Digest sent | `synthesis/dailyDigest.ts` send path | `digest_sent` |
| Proactive message sent | Phase 2 outbox send path | `proactive_msg` |
| User correction detected (link rejection, "no"/"wrong" signal, approval denied) | `agent/approvals.ts`, `candidate_links` | `correction` |
| Router tick with findings | `index.ts` router tick | `job_run` |

**Capture is best-effort and non-blocking.** It runs after the response is delivered, never before. A capture failure is logged to `agent_logs` and swallowed — the user's experience never depends on episode capture succeeding.

### 5.2 The significance filter (formal)

An episode qualifies for background enrichment if ANY of:

1. **First-time signal:** a new node was created, a new person/place/topic appeared (not in the last 30 days of episodes), or a new tool was used for the first time.
2. **Emotional spike:** the interaction carried `emotional_weight` with |w| > 0.5 (from node writes, explicit user language, or correction signals).
3. **Decision:** an approval was confirmed or denied, a choice was selected, or an inquiry was answered.
4. **Correction:** any correction signal (the strongest single predictor of "this mattered").
5. **Explicit life content:** the user stated something about their life (job, money, family, health, plans) — detected by the existing extraction prompt's entity output, not a new classifier.

The filter is a pure function `isSignificant(interaction) → boolean` with unit tests. Its selectivity is tunable via `space_meta.episode_enrich_daily_cap` (default 20). Tuning the filter does not require a migration.

### 5.3 What is NOT captured

- Heartbeat/polling ticks with no findings (noise).
- Failed tool calls with no user-visible effect (logged in `agent_logs` already).
- Embeddings of the raw transcript (the `source_transcript_ref` is an opaque pointer; W2 does not build transcript storage — that is existing log infrastructure's job).
- Anything the user asked to forget (the `forget` skill's contract takes precedence — capture checks the forget-list first).

---

## 6. The knowledge check

This is W2's primary *read-path* contribution: a function the agent loop calls before generating proactive content (and, in a lighter form, before answering).

```typescript
knowledgeCheck(spaceId, candidateContent) → {
  verdict: 'ok' | 'contradicts_belief' | 'already_known' | 'uncertain',
  conflictingEntries: UserModelEntry[],  // the specific rows, with evidence
  suggestedAction: 'proceed' | 'rephrase_as_question' | 'suppress' | 'flag_for_review'
}
```

**How it works (deterministic where possible):**

1. Load current user-model rows (`invalid_at IS NULL`) for slots `belief`, `knowledge`, `constraint`.
2. **Contradiction detection:** for each high-confidence (≥0.70) `belief`/`knowledge` entry, check whether the candidate content contradicts it. W2 ships with a deterministic first pass: embedding similarity between the candidate and the entry content above a threshold (0.82, tunable) + a lightweight LLM judgment call *only* for pairs above threshold. The LLM call is the expensive part; the embedding pre-filter keeps it to a handful of candidates per check.
3. **Already-known detection:** if the candidate's core claim matches a `knowledge` entry above threshold, it's `already_known` — telling him what he knows is noise.
4. **Constraint check:** if the candidate violates a `constraint` entry (e.g., suggesting spending before the CNA fee), it's `contradicts_belief` with the constraint cited.

**Verdict semantics:**
- `ok` → proceed.
- `contradicts_belief` (high-confidence) → `suppress` + log. The candidate is wrong *about him*. (This is the check that would have killed "in between jobs": `belief: "I work at Samsonite"` at 0.95, stated.)
- `contradicts_belief` (low-confidence, <0.70) → `rephrase_as_question`. The model is uncertain; the honest move is to ask, not assert. ("I thought you'd started the Samsonite job — is that still right?")
- `already_known` → `suppress` (reason: `already_known`). Don't tell a man with a job he has a job.
- `uncertain` → `flag_for_review`. The check couldn't decide; a human (or the W6 gate) decides.

**Where it plugs in:**
- **Proactive path (primary):** every digest section, inquiry, and proactive message candidate passes through `knowledgeCheck()` before reaching the W6 wisdom gate. (W6 doesn't exist yet; W2 provides the function and wires it into the digest + inquiry paths. The gate will call it too.)
- **Conversational path (light):** the agent loop's context builder includes the current user model as a system-prompt block (see §7.3). The full `knowledgeCheck()` is *not* run per conversational turn — too expensive. Instead, the model block lets the LLM do implicit first-order ToM in-context, grounded in the explicit entries.

**The knowledge check is advisory, not blocking, for the conversational path.** It *blocks* (suppress) on the proactive path because proactive messages are unprompted — the bar is higher. This asymmetry is intentional: answering a question wrong is correctable in the conversation; pushing a wrong claim at him unprompted is a trust withdrawal.

---

## 7. Retrieval integration

### 7.1 Episodes in the existing search stack

The existing stack: `knn` (sqlite-vec) + `keywordSearch` (FTS5) → RRF fuse → `byIds` (W1-filtered) → multi-hop expansion. Episodes plug in as a **parallel namespace**, not a modification of the node path:

```
memorySearch(query):
  nodeResults = existing pipeline (unchanged)
  episodeResults = episodeSearch(query)   // NEW: vec KNN over episodes.embedding
                                         //       + recency/importance rerank
  return { nodes: nodeResults, episodes: episodeResults }
```

**Why parallel, not merged:** nodes and episodes have different schemas, different temporal semantics (W1's `superseded_at` filter does not apply to append-only episodes), and different context shapes (facts vs narratives). Merging them into one ranked list would conflate "what is true" with "what happened." The agent loop receives both and the prompt template labels them distinctly.

**Episode FTS:** W2 adds episodes to the FTS index (a separate FTS5 table `episodes_fts`, same pattern as the existing node FTS). Keyword episode search for "remember when we talked about X" queries.

**`vecSearchCurrent` analog:** episodes don't need the W1 supersession filter (append-only), but they *do* need the same iterative over-fetch pattern if the episode table grows large — the function is parameterized, and W2 reuses it with a no-op filter. (This is code reuse, not a new retrieval primitive.)

### 7.2 The composite scorer, extended

W1's scorer (from the research report §D3, to be implemented):
```
score(m, q) = 0.40·relevance + 0.25·recency + 0.20·importance + 0.10·trust + 0.05·graph_degree
```

For episodes, the terms map as:
- `relevance`: cosine similarity over episode embeddings.
- `recency`: `0.5 ^ (days_since(occurred_at) / 7)` — 7-day half-life per the research (episodes fade fast; they're texture, not reference).
- `importance`: the episode's `importance` column (LLM-rated at enrichment, 0.5 default).
- `trust`: 1.0 for episodes (they're records, not claims — trust is not a meaningful axis; fixed, not stored).
- `graph_degree`: number of linked nodes (`source_node_ids` length) — episodes that distilled into many facts are load-bearing.

The weights are the same as nodes. The half-life differs (7d vs per-kind). This keeps one scorer with per-kind parameters — exactly what the research recommends ("start with 0.5/0.25/0.25 and tune against real retrieval failures").

### 7.3 Agent loop context builder

The agent loop's system prompt gains a **user-model block**, composed by `composeUserModelBlock()`:

```
## What I believe about you (confidence in parentheses)
Believes: the CNA fee ($85 money order) is the top financial priority (0.95, stated)
Wants: the CNA license reinstated to get a second job (0.95, stated)
Knows: works at Samsonite warehouse; bus route is 8→1→3 (0.90, consolidated)
Constraints: never suggest spending before the CNA fee is covered (0.95, stated)
Current state: stressed about the fee; proud about the job (2026-10-19)
```

Rules for the block:
- Only entries with confidence ≥ 0.40 appear. Speculative entries (<0.40) are excluded — the prompt must not present guesses as beliefs.
- Each line cites origin (`stated`/`consolidated`). The LLM sees what's *told* vs what's *inferred*.
- `emotion_state` lines are always dated. No undated emotion claims.
- The block is capped at ~400 tokens (top entries by confidence × recency). The full model is available via the `/model` command (web UI page in a later phase).

This is the "implicit ToM" from the research: the model does first-order inference in-context, grounded in explicit, evidence-backed entries — not in vibes.

---

## 8. Schema, migration, and API

### 8.1 New tables

`episodes` (§3.2) and `user_model` (§4.2). Both follow the repo's migration conventions:
- Table creation **only** in `db/schemaSql.ts` `BOOTSTRAP_SQL`.
- Drizzle definitions in `db/schema.ts`.
- No migration needed for fresh tables (they're new) — but the migration function must be idempotent (`CREATE TABLE IF NOT EXISTS`) for the deploy path.
- Canonical timestamps: `strftime('%Y-%m-%dT%H:%M:%fZ','now')` defaults in fresh schema (W1 established this pattern after the `CURRENT_TIMESTAMP` lesson).

### 8.2 New module: `agent/episodic.ts`

| Function | Purpose |
|---|---|
| `captureEpisode(handle, spaceId, input)` | Hot-path capture (template summary, free). Non-blocking, never throws. |
| `isSignificant(interaction)` | The significance filter (pure function, unit-tested). |
| `enrichEpisode(handle, spaceId, episodeId)` | Background enrichment (LLM). Idempotent. |
| `getEpisodes(handle, spaceId, opts)` | Read path: by recency / kind / node provenance. |
| `episodeSearch(handle, spaceId, queryVec, k)` | Vector + reranked episode search. |
| `linkEpisodeToNodes(handle, episodeId, nodeIds)` | Provenance linking (append-only). |

### 8.3 New module: `agent/userModel.ts`

| Function | Purpose |
|---|---|
| `getUserModel(handle, spaceId, opts)` | Current entries (`invalid_at IS NULL`), optionally filtered by slot. |
| `getUserModelHistory(handle, spaceId, slot, content)` | Full validity-window history for one belief. |
| `recordStated(handle, spaceId, slot, content, evidence)` | Write a `stated` entry (0.95). Invalidates contradicted inferred entries. |
| `updateUserModel(handle, spaceId, entry)` | W3's write API for `consolidated` entries. Enforces origin ceiling + evidence requirement. |
| `correctUserModel(handle, spaceId, entryId, correction)` | Correction semantics (§4.6). Never deletes. |
| `knowledgeCheck(handle, spaceId, candidate)` | The §6 check. |
| `composeUserModelBlock(handle, spaceId)` | The §7.3 prompt block. |
| `sweepStaleEmotions(handle, spaceId)` | Invalidates `emotion_state` rows older than 7 days without refresh. (W3 schedules it.) |

### 8.4 Space isolation

Every function takes `spaceId` as an explicit parameter. Every query includes `space_id = ?`. Cross-space reads are impossible by construction — the same guarantee Phase 1 established for `memorySearch`, extended to both new tables. Acceptance-tested (see §9).

---

## 9. Test plan

Following the W1 pattern (26 tests, each mapped to a design requirement):

**Episodes (T-E1…):**
- T-E1: `captureEpisode()` writes a valid row with template summary, no LLM call, no throw on DB error (mock failure).
- T-E2: `isSignificant()` — first-time event → true; routine heartbeat → false; correction → true; small talk → false.
- T-E3: `enrichEpisode()` is idempotent — run twice, one enrichment, no duplicate embedding.
- T-E4: Episode correction — append correction episode with `corrects_episode_id`; original row unmutated.
- T-E5: `episodeSearch()` — similar query finds the episode; unrelated query doesn't; recency rerank prefers recent.
- T-E6: `source_node_ids` linking — "episodes that distilled into node X" returns the right episodes.
- T-E7: Space isolation — episodes from space A invisible to space B.

**User model (T-U1…):**
- T-U1: `recordStated()` writes at 0.95 with evidence; `getUserModel()` returns it.
- T-U2: Stated invalidates contradicted inferred entry — old row gets `invalid_at`, history query shows both.
- T-U3: `updateUserModel()` rejects entry with empty `evidence_ids`.
- T-U4: `updateUserModel()` rejects `inferred` entry with confidence > 0.69 (origin ceiling).
- T-U5: Independence — two mentions in the same conversation count as 1 observation (promotion requires independent evidence).
- T-U6: Correction semantics — false-belief correction invalidates without fabricating interval; factual update closes window; silence override writes no replacement.
- T-U7: "Don't infer a constraint from a correction" — correcting a belief does NOT create a constraint entry.
- T-U8: Emotion expiry — `sweepStaleEmotions()` invalidates 8-day-old emotion_state, keeps 3-day-old.
- T-U9: `composeUserModelBlock()` excludes <0.40 entries, dates emotion lines, caps tokens.
- T-U10: Space isolation for user_model.

**Knowledge check (T-K1…):**
- T-K1: Candidate contradicting a 0.95 stated belief → `contradicts_belief` + `suppress`.
- T-K2: Candidate contradicting a 0.50 consolidated belief → `rephrase_as_question`.
- T-K3: Candidate restating a `knowledge` entry → `already_known` + `suppress`.
- T-K4: Candidate violating a `constraint` → `contradicts_belief` with constraint cited.
- T-K5: The original sin — "you're in between jobs" against `belief: "I work at Samsonite"` (0.95, stated) → suppressed with logged reason.

**Migration/schema (T-M1…):**
- T-M1: Fresh DB creates both tables with canonical timestamp defaults.
- T-M2: `user_persona` blob untouched by W2 migration (existing consumers keep working).

---

## 10. Non-goals (explicitly OUT of W2)

1. **No W3 consolidation job.** W2 provides `enrichEpisode()` and `updateUserModel()`; W3 schedules and orchestrates them. W2's background enrichment is manually triggered or triggered by a minimal scheduler hook — not the full nightly job.
2. **No values table / behavioral ledger (W4).** The user model's `desire`/`constraint` slots exist, but W2 does not build the revealed-preference learning loop. `recordStated()` covers stated values; revealed values wait for W4.
3. **No causal entries (W4).** Episodes carry narrative causality ("because"), but structured causal triples are W4.
4. **No agent autobiography (W5).** `agent_action` episode kinds capture *what the agent did*, but the Reflexion-style lesson synthesis (`agent_episodes` table) is W5.
5. **No wisdom gate (W6).** `knowledgeCheck()` is W2's contribution to the gate; the full 5-check gate with scoring is W6.
6. **No galaxy visualization changes (W7).** Episodes could eventually render as timeline chapters, but W2 is backend-only.
7. **No hot-path inferred user-model writes.** The `inferred` origin exists in the schema with a 0.69 ceiling, but W2 ships zero inference rules. (Deliberate — see §2.8.)
8. **No model-driven deletion.** Restated for emphasis: nothing in W2 deletes. Invalidation, supersession, and decay-demotion are the only lifecycle operations.
9. **No higher-order theory of mind.** First-order only (§2.5). The schema has no representation for nested mental states.
10. **No transcript storage.** `source_transcript_ref` is an opaque pointer. Building a transcript store is out of scope.

---

## 11. Acceptance criteria

W2 is done when:

1. **Episodes:** a conversation produces a captured episode (template summary, no LLM on hot path); a significant episode gets enriched in background (detail, emotion, embedding); the timeline view shows episodes in order.
2. **User model:** an explicit user statement ("I want X") creates a `stated` entry at 0.95; the `/model`-equivalent read shows current beliefs with evidence and confidence; a correction invalidates the old entry without deleting it.
3. **Knowledge check:** the T-K5 test passes — the exact failure from the digest bug ("in between jobs" vs "works at Samsonite") is now caught and suppressed with a logged reason.
4. **No regressions:** `npm run typecheck` + `npm test` pass; existing `user_persona` consumers unaffected; W1's temporal guarantees intact.
5. **Review:** passes the same gauntlet as W1 (design review → implementation review → test gate → merge approval).

---

## 12. Open questions for review

1. **Emotion vocabulary:** is the 15-label closed list right, or should it be smaller/larger? Should `emotion_state` slot entries use the same vocabulary as episode `emotion`?
2. **`evidence_ids` typing:** the design uses `{type, id}` objects. Is this over-engineered — would plain `episode:N` / `node:N` string prefixes suffice?
3. **Knowledge check cost:** the embedding pre-filter + LLM judgment per proactive candidate. Is the 0.82 similarity threshold the right pre-filter, or should the check be fully deterministic in W2 (deferring LLM judgment to W6)?
4. **Episode capture for the web app:** the design lists Telegram and agent-loop triggers. Should galaxy interactions (node exploration, timeline views) also capture `session` episodes in W2, or is that W7?
5. **`user_persona` backfill:** W2 says no bulk import. Should there be a one-time *assisted* migration where the user reviews proposed entries from the blob (rather than W3 inferring them silently)?

---

## Appendix: How W2 connects to the other wisdom phases

```
W1 (temporal truth)          W2 (episodes + user model)         W3+ (consolidation, values,
  facts carry when              episodes carry what               causal, autobiography,
  they were true;               happened; the user model           gate, galaxy)
  supersession, not             carries what he believes;
  deletion                      evidence-backed, correctable
        │                                │
        └──────────┬─────────────────────┘
                   ▼
         Every fact (W1) can cite the
         episodes (W2) it was distilled from.
         Every user-model entry (W2) respects
         the temporal validity (W1) of its evidence.
```

W2 does not depend on W3–W7, but it is *designed for* them: the enrichment and consolidation write APIs are the seams W3 will call; the `desire`/`constraint` slots are the seams W4 will write; `agent_action` episodes are the raw material W5 will synthesize; `knowledgeCheck()` is the first check W6 will compose.

---

*Draft prepared 2026-10-19. Awaiting user review before the ChatGPT gauntlet.*
