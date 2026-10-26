import type { DbHandle } from "../db/client.js";
import { ftsUpsert } from "../db/fts.js";
import { isVectorEnabled } from "../db/vec.js";
import { SourcesRepo } from "../repositories/sources.repo.js";
import { refreshPersona } from "../persona/derive.js";

/**
 * Verbatim-Recall V1 — source forgetting (design section 18.1).
 *
 * Immutability governs EDITING; forgetting governs EXISTENCE, and it
 * goes through the repo's existing door only: a forget_requests row
 * with requested_by='user' and status='approved' (the INV-DEL-1
 * pattern in agent/episodic.ts). This module invents no second
 * deletion door — without an approved user request it refuses, and
 * ordinary node deletion never reaches here (it deactivates links;
 * sources are untouched by node events, section 12D).
 *
 * Binding (fix round 3, design `forget-request-binding-design-
 * 2026-10-25.md`, D1–D10): the request names its exact source in
 * `forget_requests.target_source_id`, set at creation (D2) and
 * re-validated at approval. `forgetSourceByRequest(h, requestId)`
 * takes NO source argument (D6) — the bound id is read from the row
 * inside the function and verified (D7) before any DELETE, in the
 * same transaction as the erasure. A row with NULL target_source_id
 * (legacy or episodic) can never authorize a source forget (D5).
 * Creation, approval, and apply are three separate explicit owner
 * acts (D10); the apply route is the ONLY production caller.
 *
 * Dependency rule (18.1): a node is erased with a forgotten source
 * ONLY if that source was its sole remaining origin. If other active
 * origin/support links remain, the node survives but is scrub-
 * verified: its content is searched for verbatim spans of the
 * forgotten chunk text. Found and not regenerable -> tombstoned.
 * Unverifiable-clean -> tombstoned. (No regeneration-from-sources
 * machinery exists in V1, so a dirty scrub always tombstones.)
 * A surviving node's METADATA is scrubbed, not tombstoned: its label,
 * tags, aliases, and celestial title are excised of verbatim spans in
 * place (fix round 5) — they are short derived labels, and the node
 * itself is clean. Its research questions and answers are excised the
 * same way (fix round 6). Its FTS row is re-indexed with the scrubbed label.
 *
 * Everything runs in ONE transaction, mirroring applyForgetRequest.
 */

export interface SourceForgetResult {
  requestId: number;
  sourceId: number;
  chunksErased: number;
  correctionsErased: number;
  linksErased: number;
  /** Nodes erased because this source was their sole remaining origin. */
  nodesErased: number[];
  /** Multi-origin nodes that survived scrub verification clean. */
  nodesSurvivedClean: number[];
  /**
   * Surviving nodes whose label, tags, aliases, or celestial title
   * quoted the forgotten source and were excised in place (fix round
   * 5). A subset of nodesSurvivedClean — the node itself survived;
   * only its metadata was scrubbed, and its FTS row re-indexed.
   */
  nodesLabelScrubbed: number[];
  /** Multi-origin nodes tombstoned because forgotten text remained. */
  nodesTombstoned: number[];
  /** Episodes tombstoned because their summary/detail quoted the source. */
  episodesTombstoned: number[];
  /** Derived/cache/draft rows deleted by the scrub pass below. */
  derivedRowsScrubbed: number;
  /** Inferred/consolidated user_model rows DELETED because their content quoted the source. */
  userModelDeleted: number[];
  /** Inferred/consolidated user_model rows invalidated (sole evidence withdrawn by this forget). */
  userModelInvalidated: number[];
  /** Inferred/consolidated user_model rows whose evidence was pruned of forgotten refs. */
  userModelPruned: number[];
  /** True when the stored persona quoted the source and was deleted + re-derived. */
  personaScrubbed: boolean;
  /** TTS audio cache rows purged for this space (the cache is regenerable; the purge is space-scoped). */
  ttsCachePurged: number;
  /**
   * Quoting rows left in place by policy — table + row id only, never
   * content. Covers stated user_model rows and instruction_profiles
   * rows (owner scope decisions pending). Empty means no quoting row
   * survived the scrub anywhere the sweep covers.
   */
  unresolved: { table: string; rowId: number }[];
}

const FORGET_TOMBSTONE = "[forgotten at the owner's request]";

/** Minimum verbatim span length used by scrub verification. Shorter
 *  overlaps are common words, not quotable spans. */
export const SCRUB_SPAN_CHARS = 24;

/**
 * Does `content` contain a verbatim span of any forgotten chunk text?
 * Checks whole short chunk texts and EVERY SCRUB_SPAN_CHARS window of
 * the forgotten text (fix round 2, audit P1: the previous stride-8
 * sampling could miss a quote starting at an unaligned offset,
 * certifying it "scrub-verified clean"; fix round 4, re-audit P1:
 * windows were scanned WITHIN each chunk only, so a span crossing a
 * chunk boundary was a window of NO single chunk and likewise passed
 * as clean). Windows are therefore scanned over the JOINED contiguous
 * text — chunks are an exact non-overlapping partition of the source
 * (chunkExact / chunksOf ORDER BY ordinal ASC), so joining them in
 * order reconstructs the source text exactly and every 24-char window
 * of the source, including cross-boundary ones, is a window of the
 * joined text. Every-window checking is exact: a 24-char span of
 * forgotten text appears in `content` iff some window equals it.
 * Bounded cost — chunks are at most SOURCE_CHUNK_CHARS (1000)
 * characters and node content is short, so the window scan is small
 * and terminates. The empty/short-text case: a chunk shorter than the
 * span is checked whole (it IS a complete owner utterance).
 */
export function containsVerbatimSpan(content: string, chunkTexts: string[]): boolean {
  if (!content) return false;
  // Short chunks (4..24 chars) are checked whole: a 24-char window
  // over the joined text can never equal a chunk shorter than the
  // span, so without this a short chunk's verbatim occurrence would
  // be missed whenever its window would need neighboring-chunk
  // characters. (Chunks shorter than 4 chars are common fragments,
  // not quotable spans.)
  for (const t of chunkTexts) {
    if (!t) continue;
    if (t.length <= SCRUB_SPAN_CHARS && t.length >= 4 && content.includes(t)) return true;
  }
  const joined = chunkTexts.filter(Boolean).join("");
  for (let i = 0; i + SCRUB_SPAN_CHARS <= joined.length; i++) {
    if (content.includes(joined.slice(i, i + SCRUB_SPAN_CHARS))) return true;
  }
  return false;
}

/**
 * Excise every verbatim span of the forgotten chunk text from `text`:
 * each quoting interval is cut out, whitespace is collapsed, and the
 * result is trimmed. Iterative — cutting one span can join two halves
 * into a new quoting window, so the pass repeats until the text is
 * span-free (bounded: every pass shortens the string). The caller
 * still checks the result with containsVerbatimSpan and falls back to
 * the tombstone marker when excision cannot produce a clean string.
 * Mirrors containsVerbatimSpan exactly (short chunks whole + every
 * 24-char window of the joined chunk text, cross-boundary included).
 */
export function exciseVerbatimSpans(text: string, chunkTexts: string[]): string {
  let out = text;
  for (let pass = 0; pass < 10; pass++) {
    if (!containsVerbatimSpan(out, chunkTexts)) break;
    const intervals = quotingIntervals(out, chunkTexts);
    if (intervals.length === 0) break; // defensive: never spin if the two disagree
    out = removeIntervals(out, intervals).replace(/\s+/g, " ").trim();
  }
  return out;
}

/** All [start, end) intervals of `text` covered by a quoting window. */
function quotingIntervals(text: string, chunkTexts: string[]): { start: number; end: number }[] {
  const intervals: { start: number; end: number }[] = [];
  const addAll = (needle: string): void => {
    if (!needle) return;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      intervals.push({ start: at, end: at + needle.length });
      from = at + 1; // +1, not +length: overlapping occurrences count
    }
  };
  for (const t of chunkTexts) {
    if (!t) continue;
    if (t.length <= SCRUB_SPAN_CHARS && t.length >= 4) addAll(t);
  }
  const joined = chunkTexts.filter(Boolean).join("");
  for (let i = 0; i + SCRUB_SPAN_CHARS <= joined.length; i++) {
    addAll(joined.slice(i, i + SCRUB_SPAN_CHARS));
  }
  return intervals;
}

/** Delete merged intervals from `text` (overlaps/adjacency coalesced).
 * Word repair: where a removal glues two word characters together
 * ("a label[ SPAN ]here" -> "a labelhere"), a single space is kept
 * between them, so excision never fuses two words into one. */
function removeIntervals(text: string, intervals: { start: number; end: number }[]): string {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  const isWordChar = (ch: string | undefined): boolean => ch != null && /[\p{L}\p{N}]/u.test(ch);
  let out = "";
  let cursor = 0;
  for (const iv of merged) {
    const kept = text.slice(cursor, iv.start);
    if (kept.length > 0 && out.length > 0) {
      const prev = out[out.length - 1];
      const next = kept[0];
      if (isWordChar(prev) && isWordChar(next)) out += " ";
    }
    out += kept;
    cursor = iv.end;
  }
  const tail = text.slice(cursor);
  if (tail.length > 0 && out.length > 0) {
    const prev = out[out.length - 1];
    const next = tail[0];
    if (isWordChar(prev) && isWordChar(next)) out += " ";
  }
  out += tail;
  return out;
}

/** Parse a JSON-array text column (tags/aliases); malformed -> []. */
function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String);
  } catch {
    /* malformed — treated as empty; the raw value is left untouched
       unless a quote is found in it, which an unparseable value cannot be */
  }
  return [];
}

/** Parse a JSON-object text column (research_answers); malformed -> {}. */
function parseJsonStringMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const obj: unknown = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    }
  } catch {
    /* malformed — treated as empty; same negligible corner as
       parseJsonStringArray (no production writer emits malformed JSON) */
  }
  return {};
}

interface ForgetRequestRow {
  id: number;
  space_id: string;
  requested_by: string;
  status: string;
  target_source_id: number | null;
  scope_episode_ids: string;
  scope_node_ids: string;
  scope_topics: string;
  created_at: string;
  applied_at: string | null;
}

/**
 * A refused forget-request act. `reason` is the stable machine code
 * (also the first token of the message, so tests can match on it);
 * `status` is the HTTP status the route layer returns for it.
 * Refusals never leak content — reason codes and ids only.
 */
export class ForgetSourceRefusal extends Error {
  readonly reason: string;
  readonly status: number;
  readonly existingRequestId?: number;
  constructor(
    reason: string,
    message: string,
    opts?: { status?: number; existingRequestId?: number },
  ) {
    super(`${reason}: ${message}`);
    this.name = "ForgetSourceRefusal";
    this.reason = reason;
    this.status = opts?.status ?? 400;
    if (opts?.existingRequestId !== undefined) this.existingRequestId = opts.existingRequestId;
  }
}

/** Content-free identifying summary of a source (design §2.3): never raw_text. */
export interface ForgetSourceSummary {
  kind: string;
  citationClass: string;
  createdAt: string;
  byteLength: number;
  contentHash: string;
  chunkCount: number;
}

/** Content-free view of a forget request + its bound source, if any. */
export interface ForgetRequestSummary {
  requestId: number;
  sourceId: number | null;
  status: string;
  requestedBy: string;
  createdAt: string;
  appliedAt: string | null;
  source: ForgetSourceSummary | null;
}

function sourceSummary(h: DbHandle, spaceId: string, sourceId: number): ForgetSourceSummary | null {
  const repo = new SourcesRepo(h, spaceId);
  const source = repo.getById(sourceId);
  if (!source) return null;
  return {
    kind: source.kind,
    citationClass: source.citationClass,
    createdAt: source.createdAt,
    byteLength: source.byteLength,
    contentHash: source.contentHash,
    chunkCount: repo.chunksOf(sourceId).length,
  };
}

/** Content-free view of one request in this space; undefined when the
 *  request does not exist here (cross-space ids are indistinguishable
 *  from missing ones — existence must not leak across spaces). */
export function inspectForgetSourceRequest(
  h: DbHandle,
  spaceId: string,
  requestId: number,
): ForgetRequestSummary | undefined {
  const req = h.sqlite
    .prepare(`SELECT * FROM forget_requests WHERE id = ? AND space_id = ?`)
    .get(requestId, spaceId) as ForgetRequestRow | undefined;
  if (!req) return undefined;
  return {
    requestId: req.id,
    sourceId: req.target_source_id,
    status: req.status,
    requestedBy: req.requested_by,
    createdAt: req.created_at,
    appliedAt: req.applied_at,
    source: req.target_source_id == null ? null : sourceSummary(h, spaceId, req.target_source_id),
  };
}

/**
 * Create a source-forget request (design §2, owner act 1 of 3; D2/D3/D4).
 * Validates, in order: the source exists in this space; no live
 * (pending/approved) request already exists for it (D9 index backstop
 * + explicit pre-check). The row carries requested_by='user',
 * status='pending', target_source_id=sourceId, target_query=NULL, all
 * three scope fields '[]' — a mixed-scope row cannot be created
 * through this door (there is no scope parameter to fill). Creation
 * deletes nothing and authorizes nothing.
 */
export function createForgetSourceRequest(
  h: DbHandle,
  spaceId: string,
  sourceId: number,
): ForgetRequestSummary {
  const sqlite = h.sqlite;
  const liveFor = (sid: number) =>
    sqlite
      .prepare(
        `SELECT id FROM forget_requests
         WHERE space_id = ? AND target_source_id = ? AND status IN ('pending','approved')`,
      )
      .get(spaceId, sid) as { id: number } | undefined;
  const repo = new SourcesRepo(h, spaceId);
  if (!repo.getById(sourceId)) {
    throw new ForgetSourceRefusal("source_not_found", `source ${sourceId} does not exist in this space`, { status: 404 });
  }
  const live = liveFor(sourceId);
  if (live) {
    throw new ForgetSourceRefusal(
      "already_pending",
      `a live forget request (id ${live.id}) already exists for source ${sourceId}`,
      { status: 409, existingRequestId: live.id },
    );
  }
  let requestId: number;
  try {
    const info = sqlite
      .prepare(
        `INSERT INTO forget_requests
           (space_id, requested_by, status, target_source_id, target_query,
            scope_episode_ids, scope_node_ids, scope_topics)
         VALUES (?, 'user', 'pending', ?, NULL, '[]', '[]', '[]')`,
      )
      .run(spaceId, sourceId);
    requestId = Number(info.lastInsertRowid);
  } catch (err) {
    // D9 backstop: a racing live request surfaces as a unique-index
    // violation — re-read it and report already_pending, not a 500.
    const raced = liveFor(sourceId);
    if (raced) {
      throw new ForgetSourceRefusal(
        "already_pending",
        `a live forget request (id ${raced.id}) already exists for source ${sourceId}`,
        { status: 409, existingRequestId: raced.id },
      );
    }
    throw err;
  }
  const created = inspectForgetSourceRequest(h, spaceId, requestId);
  if (!created) throw new Error(`forget request ${requestId} vanished immediately after creation`);
  return created;
}

/**
 * Approve a source-forget request (design §3, owner act 2 of 3).
 * Re-validates in ONE transaction: request exists in this space;
 * requested_by='user'; status='pending'; target_source_id IS NOT
 * NULL; the bound source still exists in the request's space; no
 * scope fields set. Any failure refuses and changes nothing.
 * Approval alone deletes nothing.
 */
export function approveForgetSourceRequest(
  h: DbHandle,
  spaceId: string,
  requestId: number,
): ForgetRequestSummary {
  const sqlite = h.sqlite;
  return sqlite.transaction((): ForgetRequestSummary => {
    const req = sqlite
      .prepare(`SELECT * FROM forget_requests WHERE id = ? AND space_id = ?`)
      .get(requestId, spaceId) as ForgetRequestRow | undefined;
    if (!req) {
      throw new ForgetSourceRefusal("not_found", `forget request ${requestId} does not exist`, { status: 404 });
    }
    if (req.requested_by !== "user") {
      throw new ForgetSourceRefusal("not_user", "forget requests must be user-requested", { status: 403 });
    }
    if (req.status !== "pending") {
      throw new ForgetSourceRefusal(
        "not_pending",
        `forget request ${requestId} has status '${req.status}' — only 'pending' requests can be approved`,
        { status: 409 },
      );
    }
    if (req.target_source_id == null) {
      throw new ForgetSourceRefusal(
        "unbound_legacy_request",
        `forget request ${requestId} names no source (target_source_id IS NULL)`,
        { status: 422 },
      );
    }
    if (req.scope_episode_ids !== "[]" || req.scope_node_ids !== "[]" || req.scope_topics !== "[]") {
      throw new ForgetSourceRefusal(
        "mixed_scope",
        `forget request ${requestId} carries both a bound source and episodic scope`,
        { status: 422 },
      );
    }
    const source = new SourcesRepo(h, spaceId).getById(req.target_source_id);
    if (!source) {
      throw new ForgetSourceRefusal("source_not_found", `source ${req.target_source_id} does not exist in this space`, { status: 404 });
    }
    if (source.spaceId !== spaceId) {
      throw new ForgetSourceRefusal(
        "space_mismatch",
        `source ${req.target_source_id} belongs to a different space than forget request ${requestId}`,
        { status: 403 },
      );
    }
    const changed = sqlite
      .prepare(`UPDATE forget_requests SET status = 'approved' WHERE id = ? AND status = 'pending'`)
      .run(requestId).changes;
    if (changed !== 1) {
      throw new ForgetSourceRefusal("not_pending", `forget request ${requestId} is no longer pending`, { status: 409 });
    }
    const approved = inspectForgetSourceRequest(h, spaceId, requestId);
    if (!approved) throw new Error(`forget request ${requestId} vanished during approval`);
    return approved;
  })();
}

/**
 * Reject a source-forget request (design §3.4). A rejected request
 * can never be approved or applied afterwards. Rejection deletes
 * nothing and needs no binding — it only closes the request.
 */
export function rejectForgetSourceRequest(
  h: DbHandle,
  spaceId: string,
  requestId: number,
): ForgetRequestSummary {
  const sqlite = h.sqlite;
  return sqlite.transaction((): ForgetRequestSummary => {
    const req = sqlite
      .prepare(`SELECT * FROM forget_requests WHERE id = ? AND space_id = ?`)
      .get(requestId, spaceId) as ForgetRequestRow | undefined;
    if (!req) {
      throw new ForgetSourceRefusal("not_found", `forget request ${requestId} does not exist`, { status: 404 });
    }
    if (req.requested_by !== "user") {
      throw new ForgetSourceRefusal("not_user", "forget requests must be user-requested", { status: 403 });
    }
    if (req.status !== "pending") {
      throw new ForgetSourceRefusal(
        "not_pending",
        `forget request ${requestId} has status '${req.status}' — only 'pending' requests can be rejected`,
        { status: 409 },
      );
    }
    const changed = sqlite
      .prepare(`UPDATE forget_requests SET status = 'rejected' WHERE id = ? AND status = 'pending'`)
      .run(requestId).changes;
    if (changed !== 1) {
      throw new ForgetSourceRefusal("not_pending", `forget request ${requestId} is no longer pending`, { status: 409 });
    }
    const rejected = inspectForgetSourceRequest(h, spaceId, requestId);
    if (!rejected) throw new Error(`forget request ${requestId} vanished during rejection`);
    return rejected;
  })();
}

/** Throw a refusal. The content-free `forget_source_refused` audit
 *  row is written by the caller (forgetSourceByRequest's wrapper)
 *  OUTSIDE the transaction: a throw inside the transaction rolls
 *  everything back, which would roll an audit row written in here
 *  back too. No row is written when there is no space to attribute
 *  it to (unknown request id) — there is nothing to audit against. */
function refuse(
  requestId: number,
  reason: string,
  message: string,
  status: number,
): never {
  throw new ForgetSourceRefusal(reason, message, { status });
}

export function forgetSourceByRequest(
  h: DbHandle,
  requestId: number,
): SourceForgetResult {
  const sqlite = h.sqlite;
  // Existence only, outside the transaction: a missing row has no
  // space to attribute an audit row to, so it throws bare (no audit
  // row), exactly as before. Everything that authorizes the erasure
  // is re-read and verified INSIDE the transaction below (D7).
  const existing = sqlite
    .prepare(`SELECT id, space_id FROM forget_requests WHERE id = ?`)
    .get(requestId) as { id: number; space_id: string } | undefined;
  if (!existing) {
    throw new ForgetSourceRefusal("not_found", `forget request ${requestId} does not exist`, { status: 404 });
  }
  const spaceId = existing.space_id;

  const tx = sqlite.transaction((): SourceForgetResult => {
    // D7 — the request row is re-read and ALL binding verification
    // runs here, in the same transaction (same snapshot) as the
    // erasure below. A failure throws with no audit row written in
    // here: the throw rolls the transaction back, which would roll
    // an audit row written in here back too — the wrapper after
    // tx() writes it outside the transaction instead.
    const req = sqlite
      .prepare(
        `SELECT id, space_id, requested_by, status, target_source_id,
                scope_episode_ids, scope_node_ids, scope_topics
         FROM forget_requests WHERE id = ?`,
      )
      .get(requestId) as ForgetRequestRow | undefined;
    if (!req) {
      // Deleted between the outer read and the transaction (no
      // production path deletes request rows): same bare not_found,
      // and the wrapper skips the audit row for it.
      throw new ForgetSourceRefusal("not_found", `forget request ${requestId} does not exist`, { status: 404 });
    }
    if (req.requested_by !== "user") {
      refuse(requestId, "not_user", "forget requests must be user-requested", 403);
    }
    if (req.status !== "approved") {
      refuse(
        requestId, "not_approved",
        `forget request ${requestId} has status '${req.status}' — only 'approved' requests can be applied`,
        409,
      );
    }
    // D5: a NULL target can never authorize a source forget — legacy
    // rows and episodic rows refuse here, forever, with no backfill.
    if (req.target_source_id == null) {
      refuse(
        requestId, "unbound_legacy_request",
        `forget request ${requestId} names no source (target_source_id IS NULL) — it cannot authorize a source forget`,
        422,
      );
    }
    const sourceId = req.target_source_id;
    // The bound source must exist in the request's own space: an
    // unscoped lookup plus an explicit space-equality check as
    // defense-in-depth (the space-scoped repo lookup alone would
    // conflate "missing" with "another space's").
    const sourceSpace = sqlite
      .prepare(`SELECT space_id FROM sources WHERE id = ?`)
      .get(sourceId) as { space_id: string } | undefined;
    if (!sourceSpace) {
      refuse(requestId, "source_not_found", `source ${sourceId} does not exist`, 404);
    }
    if (sourceSpace.space_id !== spaceId) {
      refuse(
        requestId, "space_mismatch",
        `source ${sourceId} belongs to a different space than forget request ${requestId}`,
        403,
      );
    }
    // D3: one request, one forget act — a row carrying both a bound
    // source and episodic scope is invalid at apply as well as at creation.
    if (req.scope_episode_ids !== "[]" || req.scope_node_ids !== "[]" || req.scope_topics !== "[]") {
      refuse(
        requestId, "mixed_scope",
        `forget request ${requestId} carries both a bound source and episodic scope`,
        422,
      );
    }
    const repo = new SourcesRepo(h, spaceId);
    const source = repo.getById(sourceId);
    if (!source) {
      // Unreachable after the checks above (defense-in-depth).
      refuse(requestId, "source_not_found", `source ${sourceId} does not exist in this space`, 404);
    }
    const now = new Date().toISOString();
    const chunks = repo.chunksOf(sourceId);
    const chunkIds = chunks.map((c) => c.id);
    const chunkTexts = chunks.map((c) => c.text);

    // Nodes linked to this source (any role, active) BEFORE links go.
    const linkedNodeIds = [
      ...new Set(repo.activeLinksForSource(sourceId).map((l) => l.nodeId)),
    ];

    // The source's own derived rows: vec rows, FTS rows, chunks,
    // corrections, links — all erased.
    if (isVectorEnabled(sqlite)) {
      const delVec = sqlite.prepare(`DELETE FROM vec_source_chunks WHERE chunk_id = ?`);
      for (const cid of chunkIds) {
        try { delVec.run(BigInt(cid)); } catch { /* vec table absent */ }
      }
    }
    const delFts = sqlite.prepare(`DELETE FROM sources_fts WHERE rowid = ?`);
    for (const cid of chunkIds) delFts.run(cid);

    const linksErased = sqlite
      .prepare(`DELETE FROM node_sources WHERE space_id = ? AND source_id = ?`)
      .run(spaceId, sourceId).changes;
    const correctionsErased = sqlite
      .prepare(`DELETE FROM source_corrections WHERE space_id = ? AND source_id = ?`)
      .run(spaceId, sourceId).changes;
    const chunksErased = sqlite
      .prepare(`DELETE FROM source_chunks WHERE space_id = ? AND source_id = ?`)
      .run(spaceId, sourceId).changes;
    sqlite.prepare(`DELETE FROM sources WHERE id = ? AND space_id = ?`).run(sourceId, spaceId);

    // Fix round 5 (re-review blocker): label/tag/alias/celestial-title
    // scrub for SURVIVING nodes. Rounds 2–4 checked `content` only, so
    // a node whose content was clean but whose label or tags quoted the
    // forgotten source survived with the quote intact — still
    // MATCH-retrievable through its nodes_fts label column, and
    // re-injected into the persona on re-derivation (derivePersona
    // reads labels/tags, never content). A surviving node gets its
    // metadata excised in place: every verbatim span is cut out of the
    // label, each tag, each alias, and the celestial title; tags /
    // aliases that excise to nothing are dropped; a label that excises
    // to nothing becomes the forget tombstone (labels are NOT NULL and
    // the marker is honest about what happened); a celestial title
    // that excises to nothing becomes NULL. The FTS row is re-indexed
    // with the scrubbed label so no quoting token survives in the
    // index. Columns whose values do not quote are written back
    // byte-identical — the scrub never rewrites clean metadata.
    //
    // Fix round 6 (round-5 re-review finding 2): the same in-place
    // excision covers `research_questions` / `research_answers`.
    // Questions are LLM-generated from label+content and served daily;
    // answers are user-typed and re-shown in NodeInspector — both are
    // stored representations that can return the span verbatim, and
    // the sweep never touched them. Excision, not deletion: quoting
    // entries keep their clean remainder, entries that excise to
    // nothing are dropped, and a column that empties out becomes NULL
    // (the same treatment as tags/aliases). Answer keys are excised
    // too — a key is question text and can quote the span the same
    // way a value can. `nodesLabelScrubbed` keeps its round-5 meaning
    // (label/tags/aliases/title only); a research-only scrub is proven
    // by the row itself, not by that list.
    const nodesLabelScrubbed: number[] = [];
    const scrubNodeMetadata = (
      nodeId: number,
      label: string,
      tagsRaw: string | null,
      aliasesRaw: string | null,
      celestialTitle: string | null,
      content: string,
      researchQuestionsRaw: string | null,
      researchAnswersRaw: string | null,
    ): void => {
      const labelQuotes = containsVerbatimSpan(label, chunkTexts);
      const tags = parseJsonStringArray(tagsRaw);
      const aliases = parseJsonStringArray(aliasesRaw);
      const tagsQuote = tags.some((t) => containsVerbatimSpan(t, chunkTexts));
      const aliasesQuote = aliases.some((a) => containsVerbatimSpan(a, chunkTexts));
      const titleQuotes = celestialTitle != null && containsVerbatimSpan(celestialTitle, chunkTexts);
      const questions = parseJsonStringArray(researchQuestionsRaw);
      const questionsQuote = questions.some((q) => containsVerbatimSpan(q, chunkTexts));
      const answers = parseJsonStringMap(researchAnswersRaw);
      const answersQuote = Object.entries(answers).some(
        ([k, v]) => containsVerbatimSpan(k, chunkTexts) || containsVerbatimSpan(v, chunkTexts),
      );
      if (!labelQuotes && !tagsQuote && !aliasesQuote && !titleQuotes && !questionsQuote && !answersQuote) return;
      let newLabel = label;
      if (labelQuotes) {
        newLabel = exciseVerbatimSpans(label, chunkTexts);
        if (!newLabel || containsVerbatimSpan(newLabel, chunkTexts)) newLabel = FORGET_TOMBSTONE;
      }
      const scrubList = (list: string[]): string[] =>
        list
          .map((t) => (containsVerbatimSpan(t, chunkTexts) ? exciseVerbatimSpans(t, chunkTexts).trim() : t))
          .filter((t) => t.length > 0 && !containsVerbatimSpan(t, chunkTexts));
      const tagsSql: string | null = tagsQuote
        ? (() => {
            const cleaned = scrubList(tags);
            return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
          })()
        : tagsRaw;
      const aliasesSql: string | null = aliasesQuote
        ? (() => {
            const cleaned = scrubList(aliases);
            return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
          })()
        : aliasesRaw;
      let titleSql: string | null = celestialTitle;
      if (titleQuotes) {
        const cleaned = exciseVerbatimSpans(celestialTitle as string, chunkTexts);
        titleSql = cleaned && !containsVerbatimSpan(cleaned, chunkTexts) ? cleaned : null;
      }
      const questionsSql: string | null = questionsQuote
        ? (() => {
            const cleaned = scrubList(questions);
            return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
          })()
        : researchQuestionsRaw;
      const answersSql: string | null = answersQuote
        ? (() => {
            const cleaned: Record<string, string> = {};
            for (const [k, v] of Object.entries(answers)) {
              const newKey = containsVerbatimSpan(k, chunkTexts) ? exciseVerbatimSpans(k, chunkTexts).trim() : k;
              if (!newKey || containsVerbatimSpan(newKey, chunkTexts)) continue;
              const newVal = containsVerbatimSpan(v, chunkTexts) ? exciseVerbatimSpans(v, chunkTexts).trim() : v;
              if (!newVal || containsVerbatimSpan(newVal, chunkTexts)) continue;
              cleaned[newKey] = newVal;
            }
            return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
          })()
        : researchAnswersRaw;
      sqlite
        .prepare(`UPDATE nodes SET label = ?, tags = ?, aliases = ?, celestial_title = ?, research_questions = ?, research_answers = ? WHERE id = ? AND space_id = ?`)
        .run(newLabel, tagsSql, aliasesSql, titleSql, questionsSql, answersSql, nodeId, spaceId);
      ftsUpsert(sqlite, nodeId, newLabel, content);
      if (labelQuotes || tagsQuote || aliasesQuote || titleQuotes) nodesLabelScrubbed.push(nodeId);
    };

    // Dependency-aware node handling.
    const nodesErased: number[] = [];
    const nodesSurvivedClean: number[] = [];
    const nodesTombstoned: number[] = [];
    for (const nodeId of linkedNodeIds) {
      const remaining = sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM node_sources
           WHERE space_id = ? AND node_id = ? AND active = 1 AND role IN ('origin', 'support')`,
        )
        .get(spaceId, nodeId) as { c: number };
      const nodeRow = sqlite
        .prepare(`SELECT label, tags, aliases, celestial_title, content, research_questions, research_answers FROM nodes WHERE id = ? AND space_id = ?`)
        .get(nodeId, spaceId) as { label: string; tags: string | null; aliases: string | null; celestial_title: string | null; content: string; research_questions: string | null; research_answers: string | null } | undefined;
      if (!nodeRow) continue;
      if (remaining.c === 0) {
        // Sole remaining origin forgotten: the node is erased with it —
        // row, embedding, FTS, edges, and its other (inactive/derived)
        // links, mirroring the episodic enrichment deletion discipline.
        try { sqlite.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(BigInt(nodeId)); } catch { /* vec absent */ }
        sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(nodeId);
        sqlite.prepare(`DELETE FROM edges WHERE space_id = ? AND (source = ? OR target = ?)`).run(spaceId, nodeId, nodeId);
        sqlite.prepare(`DELETE FROM node_sources WHERE space_id = ? AND node_id = ?`).run(spaceId, nodeId);
        sqlite.prepare(`DELETE FROM nodes WHERE id = ? AND space_id = ?`).run(nodeId, spaceId);
        nodesErased.push(nodeId);
        continue;
      }
      // Other origins remain: survival requires a clean scrub.
      if (containsVerbatimSpan(nodeRow.content, chunkTexts)) {
        sqlite
          .prepare(
            `UPDATE nodes SET content = ?, deleted_at = COALESCE(deleted_at, ?)
             WHERE id = ? AND space_id = ?`,
          )
          .run(FORGET_TOMBSTONE, now, nodeId, spaceId);
        try { sqlite.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(BigInt(nodeId)); } catch { /* vec absent */ }
        sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(nodeId);
        nodesTombstoned.push(nodeId);
      } else {
        // Content clean and other origins remain: the node survives —
        // but its label/tags/aliases/title may still quote the source
        // (fix round 5). Scrub metadata in place, then re-index.
        scrubNodeMetadata(nodeId, nodeRow.label, nodeRow.tags, nodeRow.aliases, nodeRow.celestial_title, nodeRow.content, nodeRow.research_questions, nodeRow.research_answers);
        nodesSurvivedClean.push(nodeId);
      }
    }

    // --- Derived-representation scrub (fix round 2, audit P1: the
    // erasure guarantee is broader than the implementation). The node
    // loop above handles nodes LINKED to the source; a forgotten quote
    // can also live in unlinked nodes and in every other persisted
    // representation the E2 inventory names (design §18.1). This pass
    // walks that inventory inside the same transaction:
    //   * episodes quoting the source: summary tombstoned (the
    //     applyForgetRequest treatment), enrichments + FTS + vec rows
    //     deleted. Episodes are owner captures, so they are tombstoned,
    //     never silently deleted. (Detail lives in enrichments/FTS.)
    //   * unlinked nodes quoting the source: tombstoned like dirty
    //     multi-origin nodes (a node may never keep forgotten words by
    //     hiding inside a summary, linked or not).
    //   * derived/operational rows quoting the source (insights,
    //     enrichments, daily logs, working memory, inquiries, chapters,
    //     drafts, agent logs, attachments, journeys, lore,
    //     contradictions, run errors, correction reasons, inbox items,
    //     pending tool approvals, candidate-link reasons, codex
    //     discoveries): deleted — they are regenerable derivations,
    //     transient state, or convention-violating copies, not owner
    //     captures. agent_logs deletes lift the append-only trigger
    //     exactly like deleteSpace does; journeys also lose their
    //     vec_journeys rows.
    //   Deliberately NOT scrubbed, with reasons: knowledge_docs/chunks
    //   (independent imports — V1's §18.4 no-touch decision; the same
    //   words there are a separate copy, not a derivation of the
    //   source), user_model rows with origin='stated' and
    //   instruction_profiles (owner-pasted/owner-spoken text whose
    //   deletion would destroy irreplaceable owner words — owner scope
    //   decisions pending; quoting rows are named in the result's
    //   `unresolved` field instead of silently kept), fin_* (out of
    //   scope by design, E2). user_model inferred/consolidated rows,
    //   user_persona, and tts_audio_cache ARE scrubbed — see the fix
    //   round 4 block below (the fix-round-2 exemption comment that
    //   used to sit here was wrong on three facts: user_persona is
    //   derived, not owner-authored; user_model does have evidence
    //   linkage; tts rows do not reliably age out under the global
    //   500-row cap, which evicts only on write with no TTL).
    const episodesTombstoned: number[] = [];
    // Enrichment ids erased in this transaction (tombstoned episodes'
    // enrichments + quoting enrichments dropped by the deleteScrub
    // below) — the user_model evidence pass needs the exact set.
    const forgottenEnrichmentIds: number[] = [];
    let derivedRowsScrubbed = 0;
    const tableExists = (t: string): boolean => {
      const r = sqlite
        .prepare(`SELECT 1 AS x FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
        .get(t) as { x: number } | undefined;
      return !!r;
    };
    const rowHasSpan = (texts: (string | null | undefined)[]): boolean => {
      const joined = texts.filter((t) => t != null && t !== "").join("\n");
      return joined.length > 0 && containsVerbatimSpan(joined, chunkTexts);
    };

    // Episodes: tombstone + drop enrichments/FTS/vec. (There is no
    // episodes.detail column in the bootstrap/migration DDL — "detail"
    // lives in episode_enrichments.detail and in episodes_fts, both
    // deleted here; the capture column is summary.)
    //
    // Fix round 3 (re-review B1): the scrub must consider the detail
    // text too, not just the summary. An episode whose summary is clean
    // but whose enrichment detail or episodes_fts detail quotes the
    // forgotten source keeps a MATCH-retrievable FTS row under a
    // summary-only gate. When ONLY the detail quotes: delete the
    // episodes_fts row (and the vec_episodes row — its embedding is
    // computed over summary + detail, so it embeds the quote) and let
    // the deleteScrub pass below remove the quoting enrichment rows;
    // the episode itself is NOT tombstoned (its summary is clean).
    if (tableExists("episodes")) {
      const epRows = sqlite
        .prepare(`SELECT id, summary FROM episodes WHERE space_id = ? AND forgotten_at IS NULL`)
        .all(spaceId) as { id: number; summary: string | null }[];
      for (const ep of epRows) {
        const summaryQuotes = rowHasSpan([ep.summary]);
        let detailQuotes = false;
        if (!summaryQuotes) {
          const enrDetails = tableExists("episode_enrichments")
            ? (sqlite
                .prepare(`SELECT detail FROM episode_enrichments WHERE episode_id = ? AND space_id = ?`)
                .all(ep.id, spaceId) as { detail: string | null }[]).map((r) => r.detail)
            : [];
          const ftsRow = tableExists("episodes_fts")
            ? (sqlite
                .prepare(`SELECT summary, detail FROM episodes_fts WHERE rowid = ?`)
                .get(ep.id) as { summary: string | null; detail: string | null } | undefined)
            : undefined;
          detailQuotes = rowHasSpan([...enrDetails, ftsRow?.summary, ftsRow?.detail]);
        }
        if (!summaryQuotes && !detailQuotes) continue;
        if (!summaryQuotes) {
          // Detail-only quote: drop the retrievable indexes; the quoting
          // enrichment rows fall to the deleteScrub pass below. The
          // episode row itself survives untouched.
          try { sqlite.prepare(`DELETE FROM episodes_fts WHERE rowid = ?`).run(ep.id); } catch { /* FTS absent */ }
          if (isVectorEnabled(sqlite)) {
            try { sqlite.prepare(`DELETE FROM vec_episodes WHERE episode_id = ?`).run(BigInt(ep.id)); } catch { /* vec absent */ }
          }
          continue;
        }
        sqlite
          .prepare(
            `UPDATE episodes SET summary = ?, forgotten_at = ?, enrichment_lease = NULL
             WHERE id = ? AND space_id = ?`,
          )
          .run(FORGET_TOMBSTONE, now, ep.id, spaceId);
        if (tableExists("episode_enrichments")) {
          const enrIds = sqlite
            .prepare(`SELECT id FROM episode_enrichments WHERE episode_id = ? AND space_id = ?`)
            .all(ep.id, spaceId) as { id: number }[];
          forgottenEnrichmentIds.push(...enrIds.map((r) => r.id));
          sqlite.prepare(`DELETE FROM episode_enrichments WHERE episode_id = ? AND space_id = ?`).run(ep.id, spaceId);
        }
        try { sqlite.prepare(`DELETE FROM episodes_fts WHERE rowid = ?`).run(ep.id); } catch { /* FTS absent */ }
        if (isVectorEnabled(sqlite)) {
          try { sqlite.prepare(`DELETE FROM vec_episodes WHERE episode_id = ?`).run(BigInt(ep.id)); } catch { /* vec absent */ }
        }
        episodesTombstoned.push(ep.id);
      }
    }

    // Unlinked nodes quoting the source: tombstone (linked nodes were
    // already decided by the loop above; clean survivors match no span).
    // A node whose content is clean but whose label/tags/aliases/title
    // quote the source gets the same in-place metadata scrub as a
    // linked survivor (fix round 5) — it survives, scrubbed.
    const linkedSet = new Set(linkedNodeIds);
    const liveNodes = sqlite
      .prepare(`SELECT id, label, tags, aliases, celestial_title, content, research_questions, research_answers FROM nodes WHERE space_id = ? AND deleted_at IS NULL`)
      .all(spaceId) as { id: number; label: string; tags: string | null; aliases: string | null; celestial_title: string | null; content: string; research_questions: string | null; research_answers: string | null }[];
    for (const n of liveNodes) {
      if (linkedSet.has(n.id)) continue;
      if (!containsVerbatimSpan(n.content, chunkTexts)) {
        scrubNodeMetadata(n.id, n.label, n.tags, n.aliases, n.celestial_title, n.content, n.research_questions, n.research_answers);
        continue;
      }
      sqlite
        .prepare(
          `UPDATE nodes SET content = ?, deleted_at = COALESCE(deleted_at, ?)
           WHERE id = ? AND space_id = ?`,
        )
        .run(FORGET_TOMBSTONE, now, n.id, spaceId);
      try { sqlite.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(BigInt(n.id)); } catch { /* vec absent */ }
      sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(n.id);
      nodesTombstoned.push(n.id);
    }

    // Derived/operational rows quoting the source: delete.
    const deleteScrub: { table: string; textCols: string[] }[] = [
      { table: "insights", textCols: ["text"] },
      { table: "daily_logs", textCols: ["content"] },
      { table: "working_memory", textCols: ["text"] },
      { table: "inquiries", textCols: ["question"] },
      { table: "timeline_chapters", textCols: ["title", "summary"] },
      { table: "attachments", textCols: ["filename", "data"] },
      { table: "lore", textCols: ["text"] },
      { table: "contradictions", textCols: ["resolution"] },
      { table: "consolidation_runs", textCols: ["error"] },
      { table: "corrections", textCols: ["reason"] },
      { table: "inbox_notifications", textCols: ["text"] },
      { table: "episode_enrichments", textCols: ["detail"] },
      { table: "candidate_links", textCols: ["reason"] },
      { table: "codex_discoveries", textCols: ["title", "lore"] },
      { table: "tool_approvals", textCols: ["args_json"] },
      { table: "journeys", textCols: ["title", "description"] },
      { table: "agent_logs", textCols: ["description", "targets"] },
    ];
    // agent_logs is guarded by the append-only BEFORE DELETE trigger:
    // lift it for exactly this delete (the deleteSpace precedent) and
    // restore it verbatim before commit. DDL is transactional, so a
    // failed scrub rolls the DROP back too.
    const agentLogsTrigger = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_logs_no_delete'`)
      .get() as { sql: string } | undefined;
    if (agentLogsTrigger) sqlite.exec(`DROP TRIGGER agent_logs_no_delete`);
    try {
      for (const { table, textCols } of deleteScrub) {
        if (!tableExists(table)) continue;
        const cols = ["id", ...textCols].join(", ");
        const rows = sqlite
          .prepare(`SELECT ${cols} FROM ${table} WHERE space_id = ?`)
          .all(spaceId) as Record<string, unknown>[];
        for (const row of rows) {
          const texts = textCols.map((c) => row[c] as string | null | undefined);
          if (!rowHasSpan(texts)) continue;
          sqlite.prepare(`DELETE FROM ${table} WHERE id = ? AND space_id = ?`).run(row.id as number, spaceId);
          derivedRowsScrubbed++;
          if (table === "episode_enrichments") forgottenEnrichmentIds.push(row.id as number);
          if (table === "journeys" && isVectorEnabled(sqlite)) {
            try { sqlite.prepare(`DELETE FROM vec_journeys WHERE journey_id = ?`).run(BigInt(row.id as number)); } catch { /* vec absent */ }
          }
        }
      }
      // Telegram drafts are keyed by (space_id, chat_id), not id.
      if (tableExists("telegram_note_drafts")) {
        const drafts = sqlite
          .prepare(`SELECT chat_id, text FROM telegram_note_drafts WHERE space_id = ?`)
          .all(spaceId) as { chat_id: number; text: string }[];
        for (const d of drafts) {
          if (!containsVerbatimSpan(d.text, chunkTexts)) continue;
          sqlite.prepare(`DELETE FROM telegram_note_drafts WHERE space_id = ? AND chat_id = ?`).run(spaceId, d.chat_id);
          derivedRowsScrubbed++;
        }
      }
    } finally {
      if (agentLogsTrigger) sqlite.exec(agentLogsTrigger.sql);
    }

    // --- Fix round 4 (re-audit P1): the four erasure exceptions.
    // The fix-round-2 comment above exempted user_model, user_persona,
    // instruction_profiles, and tts_audio_cache. Three of its facts were
    // wrong (corrected in that comment): user_persona is DERIVED by
    // Soumaya, not owner-authored (persona/derive.ts: "Soumaya derives
    // it herself"); user_model DOES have evidence linkage
    // (validateEvidenceRefs admits episode/node/correction/enrichment
    // refs, just no source-typed refs); tts_audio_cache rows do NOT
    // reliably age out (the 500-row cap is GLOBAL and eviction runs
    // only on write, with no TTL — telegram/ttsCache.ts).
    // What is built here, all inside this same transaction:
    //   * user_model rows with origin IN ('inferred','consolidated'):
    //     evidence pass first (sole forgotten evidence -> invalidated
    //     with 'evidence_withdrawn', mirroring applyForgetRequest;
    //     surviving legs -> evidence pruned), then span pass (quoting
    //     rows DELETEd — invalidation alone leaves the text in the row).
    //     Stated rows are untouched by policy (owner decision pending:
    //     they are the owner's own irreplaceable verbatim words, and
    //     the design contradicts itself on them, §3.7 vs §3.8).
    //   * user_persona: the singleton row is DELETEd when it quotes the
    //     span, then re-derived from the surviving nodes (force=true —
    //     the 6h staleness cache would otherwise keep the quoting body).
    //     Re-derivation reads node labels/tags — which CAN quote the
    //     source, so it is clean ONLY because the node loop above
    //     scrubbed every surviving node's metadata first (fix round 5:
    //     the earlier claim that re-derivation is "clean by
    //     construction" was wrong — labels/tags quote, and the
    //     re-derived body re-injected the span). Belt-and-braces: the
    //     re-derived body is verified after derivation, and a body that
    //     still quotes is deleted outright rather than served — no
    //     persona is better than a quoting persona.
    //   * tts_audio_cache: a targeted scrub is impossible (no text
    //     column; the key is a SHA-256 over the entire reply text), so
    //     the space's cache is purged outright. The cache is purely
    //     regenerable — loss costs only re-synthesis.
    //   * instruction_profiles: untouched by policy (owner decision
    //     pending: owner-pasted only, no derivation from sources; any
    //     delete/blank/excise destroys or corrupts irreplaceable owner
    //     text). Their vec_profiles rows stay too.
    // The result reports the truth: `unresolved` names every quoting
    // row left in place by policy (table + row id only, never content),
    // so no clearance is claimed while exceptions remain.
    const forgottenEpisodeSet = new Set(episodesTombstoned);
    const forgottenNodeSet = new Set([...nodesErased, ...nodesTombstoned]);
    const forgottenEnrichmentSet = new Set(forgottenEnrichmentIds);
    type UmEvidenceRef = { type: string; id: number };
    const isForgottenUmRef = (ref: UmEvidenceRef): boolean =>
      (ref.type === "episode" && forgottenEpisodeSet.has(ref.id)) ||
      (ref.type === "enrichment" && forgottenEnrichmentSet.has(ref.id)) ||
      (ref.type === "node" && forgottenNodeSet.has(ref.id));

    // (1a) Evidence pass — inferred/consolidated rows only, mirroring
    // applyForgetRequest step 5 (agent/episodic.ts): sole evidence
    // withdrawn -> invalidated; independent remaining evidence ->
    // pruned. (The consolidation boundary's forget-propagation path
    // uses invalid_reason 'evidence_forgotten' for the same escalation;
    // this pass follows applyForgetRequest exactly and uses
    // 'evidence_withdrawn'. Both values are admitted by the CHECK.)
    // No stated rows are written here, so no stated_set_version bump.
    const userModelInvalidated: number[] = [];
    const userModelPruned: number[] = [];
    const umEvRows = sqlite
      .prepare(
        `SELECT id, evidence_ids FROM user_model
         WHERE space_id = ? AND invalid_at IS NULL AND origin IN ('inferred','consolidated')`,
      )
      .all(spaceId) as { id: number; evidence_ids: string }[];
    for (const um of umEvRows) {
      let evidence: UmEvidenceRef[];
      try {
        const parsed: unknown = JSON.parse(um.evidence_ids);
        if (!Array.isArray(parsed)) continue;
        evidence = parsed as UmEvidenceRef[];
      } catch {
        continue; // malformed evidence — cannot interpret; leave untouched
      }
      if (evidence.length === 0) continue;
      const remaining = evidence.filter((ref) => !isForgottenUmRef(ref));
      if (remaining.length === 0) {
        sqlite
          .prepare(
            `UPDATE user_model
             SET invalid_at = ?, invalid_reason = 'evidence_withdrawn'
             WHERE id = ?`,
          )
          .run(now, um.id);
        userModelInvalidated.push(um.id);
      } else if (remaining.length < evidence.length) {
        sqlite
          .prepare(`UPDATE user_model SET evidence_ids = ? WHERE id = ?`)
          .run(JSON.stringify(remaining), um.id);
        userModelPruned.push(um.id);
      }
    }

    // (1b) Span pass — quoting inferred/consolidated rows are DELETEd
    // (any invalid_at: an invalidated row still holds the text). No
    // FTS/vec companion exists for user_model (vec tables are only
    // vec_nodes/vec_docs/vec_profiles/vec_journeys/vec_episodes/
    // vec_source_chunks; FTS only nodes/episodes/sources), so deleting
    // the row removes the representation entirely. Inbound replaced_by
    // links are nulled so getUserModelHistory still walks cleanly.
    const userModelDeleted: number[] = [];
    const umSpanRows = sqlite
      .prepare(
        `SELECT id, content FROM user_model
         WHERE space_id = ? AND origin IN ('inferred','consolidated')`,
      )
      .all(spaceId) as { id: number; content: string }[];
    for (const um of umSpanRows) {
      if (!containsVerbatimSpan(um.content, chunkTexts)) continue;
      sqlite.prepare(`DELETE FROM user_model WHERE id = ? AND space_id = ?`).run(um.id, spaceId);
      sqlite.prepare(`UPDATE user_model SET replaced_by = NULL WHERE replaced_by = ?`).run(um.id);
      userModelDeleted.push(um.id);
    }

    // (2) Persona — delete the quoting singleton, then re-derive from
    // the surviving nodes (force=true: the 6h staleness cache would
    // otherwise serve the quoting body back). refreshPersona runs on
    // this same handle, so it reads the post-forget node set inside
    // this transaction; it returns "" (and leaves no row) when fewer
    // than 3 nodes remain.
    let personaScrubbed = false;
    const personaRow = sqlite
      .prepare(`SELECT body FROM user_persona WHERE space_id = ?`)
      .get(spaceId) as { body: string } | undefined;
    if (personaRow && containsVerbatimSpan(personaRow.body, chunkTexts)) {
      sqlite.prepare(`DELETE FROM user_persona WHERE space_id = ?`).run(spaceId);
      refreshPersona(h, spaceId, true);
      // Fix round 5: verify the re-derived body. The label/tag scrub
      // above should have made re-derivation clean; if the body still
      // quotes, some representation was missed — delete the row rather
      // than serve (or store) a quoting persona. The sweep test proves
      // the clean case; this is the fail-safe for the missed one.
      const rederived = sqlite
        .prepare(`SELECT body FROM user_persona WHERE space_id = ?`)
        .get(spaceId) as { body: string } | undefined;
      if (rederived && containsVerbatimSpan(rederived.body, chunkTexts)) {
        sqlite.prepare(`DELETE FROM user_persona WHERE space_id = ?`).run(spaceId);
      }
      personaScrubbed = true;
    }

    // (3) TTS cache — space-scoped purge (the deleteSpace precedent).
    // No text column exists to scrub against, and the key hashes the
    // entire reply text, so a targeted scrub is impossible; the cache
    // is regenerable, so the purge costs only re-synthesis.
    let ttsCachePurged = 0;
    if (tableExists("tts_audio_cache")) {
      ttsCachePurged = sqlite
        .prepare(`DELETE FROM tts_audio_cache WHERE space_id = ?`)
        .run(spaceId).changes;
    }

    // Honesty (audit P1): every quoting row left in place by policy,
    // named by table + row id only — never content. Stated user_model
    // rows and instruction_profiles rows are the two policy blocks;
    // the scan also covers any inferred/consolidated row the span pass
    // somehow missed, so a survivor can never be silent.
    const unresolved: { table: string; rowId: number }[] = [];
    const umAllRows = sqlite
      .prepare(`SELECT id, content FROM user_model WHERE space_id = ? ORDER BY id`)
      .all(spaceId) as { id: number; content: string }[];
    for (const um of umAllRows) {
      if (containsVerbatimSpan(um.content, chunkTexts)) {
        unresolved.push({ table: "user_model", rowId: um.id });
      }
    }
    if (tableExists("instruction_profiles")) {
      const profRows = sqlite
        .prepare(`SELECT id, name, body FROM instruction_profiles WHERE space_id = ? ORDER BY id`)
        .all(spaceId) as { id: number; name: string | null; body: string }[];
      for (const p of profRows) {
        const text = [p.name, p.body].filter((t) => t != null && t !== "").join("\n");
        if (containsVerbatimSpan(text, chunkTexts)) {
          unresolved.push({ table: "instruction_profiles", rowId: p.id });
        }
      }
    }

    // Mark the authorizing request applied (content-free audit, as in
    // applyForgetRequest). D8: the marking stays conditional — a second
    // apply sees status='applied' and refuses under D7, so a request
    // authorizes exactly one forget act. The D7 checks above already
    // guaranteed this row is source-only. The .changes ARE checked
    // now: 0 changes means another apply won the race between this
    // transaction's verification and its marking, so refuse instead
    // of returning a second success — the throw rolls the whole
    // erasure back.
    const marked = sqlite
      .prepare(
        `UPDATE forget_requests SET status = 'applied', applied_at = COALESCE(applied_at, ?), target_query = NULL
         WHERE id = ? AND status = 'approved'`,
      )
      .run(now, requestId).changes;
    if (marked !== 1) {
      throw new ForgetSourceRefusal(
        "not_approved",
        `forget request ${requestId} is no longer approved — another apply won the race`,
        { status: 409 },
      );
    }
    sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', 'forget_source_applied', ?, ?, 'ok')`,
      )
      .run(
        spaceId,
        `forget_source_applied request_id=${requestId} source_id=${sourceId} nodes_erased=${nodesErased.length} nodes_tombstoned=${nodesTombstoned.length} tts_purged=${ttsCachePurged} unresolved=${unresolved.length}`,
        JSON.stringify({ request_id: requestId, source_id: sourceId }),
      );

    return {
      requestId,
      sourceId,
      chunksErased,
      correctionsErased,
      linksErased,
      nodesErased,
      nodesSurvivedClean,
      nodesLabelScrubbed,
      nodesTombstoned,
      episodesTombstoned,
      derivedRowsScrubbed,
      userModelDeleted,
      userModelInvalidated,
      userModelPruned,
      personaScrubbed,
      ttsCachePurged,
      unresolved,
    };
  });
  try {
    return tx();
  } catch (err) {
    if (err instanceof ForgetSourceRefusal) {
      // Refusal auditing happens OUTSIDE the transaction: the throw
      // rolled it back, which would have rolled an audit row written
      // inside it back too. No row for not_found — there is no
      // request (hence no space) to audit against, exactly as before.
      if (err.reason !== "not_found") {
        sqlite
          .prepare(
            `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
             VALUES (?, 'soumaya', 'forget_source_refused', ?, ?, 'refused')`,
          )
          .run(
            spaceId,
            `forget_source_refused request_id=${requestId} reason=${err.reason}`,
            JSON.stringify({ request_id: requestId, reason: err.reason }),
          );
      }
      throw err;
    }
    throw err;
  }
}
