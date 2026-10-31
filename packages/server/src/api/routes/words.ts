import { Router } from "express";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import {
  SourcesRepo,
  searchSourceChunks,
  sourceChannelOf,
  CONFLICT_OPEN,
  CONFLICT_CLOSE,
  type SourceChannel,
  type SourceRow,
  type SourceSearchFilters,
} from "../../repositories/sources.repo.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { listUnresolvedFlags } from "../../sources/forgetSource.js";
import { localDayBoundsForDate } from "../../lib/time.js";

/**
 * Your Words panel — read-only routes over the Verbatim-Recall stack
 * (design `WORDS-PANEL-DESIGN-2026-10-31.md`). The panel is a second
 * face on the same behaviour the V2 `search_my_words` tool exposes:
 * every text the panel can show as the owner's words comes from the
 * repo's current reading (corrections replayed) or a reading slice of
 * it — never from node content. Node data enters only as LABELS of
 * nodes carrying an origin link (provenance), exactly like the tool.
 *
 * Space isolation is the boundary: the repo is constructed with the
 * caller's space (spaceOf — the `guard` at the mount resolved the
 * credential), every query filters by space BEFORE its limit, and a
 * source id from another space is a 404, indistinguishable from a
 * missing one.
 *
 * No write routes here. The forget acts stay on their existing mounts
 * (creation: POST /api/sources/:id/forget-request; the flag review:
 * /api/forget-requests/unresolved) — the panel links those acts, it
 * does not reimplement them.
 */

const CHANNELS: readonly SourceChannel[] = ["typed", "telegram", "chat", "imported"];
const PREVIEW_CHARS = 140;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
/** Mirrors search_my_words (V2): DEFAULT_K 6, MAX_K 10. */
const DEFAULT_SEARCH_K = 6;
const MAX_SEARCH_K = 10;
const FALLBACK_TZ = "America/New_York";

interface SourceSummary {
  id: number;
  kind: string;
  channel: SourceChannel;
  citationClass: string;
  createdAt: string;
  preview: string;
  wordCount: number;
}

/** The reading model wraps conflicted corrections in ⟦conflict⟧…
 *  ⟦/conflict⟧ markers. The Source view renders them deliberately
 *  (highlighting); list previews and search excerpts are plain text
 *  surfaces, so the markers are stripped there — internal annotation
 *  markup never reaches the word stream. The words are untouched. */
function stripConflictMarkers(text: string): string {
  return text.split(CONFLICT_OPEN).join("").split(CONFLICT_CLOSE).join("");
}

/** A text cut can land inside a surrogate pair (the 140-unit preview
 *  slice; a 1000-unit chunk excerpt): the dangling half renders as �.
 *  Drop a lone half-pair at either edge of a cut surface. The words
 *  are untouched — the full reading in the Source view keeps the
 *  whole character (pitfall hunt H3). */
function trimLoneSurrogates(text: string): string {
  let out = text;
  if (out.length > 0) {
    const first = out.charCodeAt(0);
    if (first >= 0xdc00 && first <= 0xdfff) out = out.slice(1);
  }
  if (out.length > 0) {
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  }
  return out;
}

function wordCountOf(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Summary shape shared by /overview (recent) and /sources. Preview
 *  and word count derive from the CURRENT READING (corrections
 *  applied), and the citation class is the reading's class — a
 *  corrected machine transcript reports as transcript_corrected. */
function summarize(repo: SourcesRepo, s: SourceRow): SourceSummary {
  const reading = repo.currentReading(s.id);
  const text = stripConflictMarkers(reading?.text ?? "");
  return {
    id: s.id,
    kind: s.kind,
    channel: sourceChannelOf(s),
    citationClass: reading?.readingCitationClass ?? s.citationClass,
    createdAt: s.createdAt,
    preview: trimLoneSurrogates(text.slice(0, PREVIEW_CHARS)),
    wordCount: wordCountOf(text),
  };
}

function parseChannel(raw: unknown): SourceChannel | undefined | "invalid" {
  if (raw === undefined) return undefined;
  return typeof raw === "string" && (CHANNELS as readonly string[]).includes(raw)
    ? (raw as SourceChannel)
    : "invalid";
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** The space's timezone from space_meta, defensively — mirrors the
 *  search_my_words tool's helper exactly: any failure (no row,
 *  unreachable table, invalid zone name) falls back, never throws. */
function spaceTimezone(ctx: AppContext, spaceId: string): string {
  try {
    const row = ctx.handle.sqlite
      .prepare(`SELECT timezone FROM space_meta WHERE space_id = ?`)
      .get(spaceId) as { timezone?: string } | undefined;
    const tz = row?.timezone;
    if (tz) {
      // Throws RangeError on an unknown zone name.
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    }
  } catch {
    // fall through to the default
  }
  return FALLBACK_TZ;
}

export function wordsRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/words/overview -> { total, byChannel, recent, openFlags }.
  // The archive at a glance: how much is preserved, where it came
  // from, the newest captures, and how many forget-flags wait.
  r.get("/overview", (_req, res) => {
    const spaceId = spaceOf(res);
    const repo = new SourcesRepo(ctx.handle, spaceId);
    res.json({
      total: repo.count(),
      byChannel: repo.countSourcesByChannel(),
      recent: repo.listSources({ limit: 5 }).map((s) => summarize(repo, s)),
      openFlags: listUnresolvedFlags(ctx.handle, spaceId).open.length,
    });
  });

  // GET /api/words/sources?channel=&kind=&limit=&before=
  //   -> { sources: SourceSummary[] }, newest first. `before` is the
  // id cursor (only ids < before) for Load-more paging.
  r.get("/sources", (req, res) => {
    const channel = parseChannel(req.query.channel);
    if (channel === "invalid") {
      res.status(400).json({ error: `channel must be one of ${CHANNELS.join(", ")}` });
      return;
    }
    const kind =
      typeof req.query.kind === "string" && req.query.kind.trim() ? req.query.kind.trim() : undefined;
    const beforeRaw = Number(req.query.before);
    const before = Number.isInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;
    const limit = parseLimit(req.query.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const repo = new SourcesRepo(ctx.handle, spaceOf(res));
    const rows = repo.listSources({ channel, kind, before, limit });
    res.json({ sources: rows.map((s) => summarize(repo, s)) });
  });

  // GET /api/words/sources/:id -> the whole capture: summary +
  // capturedVia, the full current reading, the corrections as stored,
  // and the derived nodes (origin links only, labels only). A source
  // outside the caller's space is a 404.
  r.get("/sources/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    const repo = new SourcesRepo(ctx.handle, spaceId);
    const src = repo.getById(id);
    if (!src) {
      res.status(404).json({ error: "not_found", message: `source ${id} does not exist` });
      return;
    }
    const reading = repo.currentReading(id);
    const corrections = repo.correctionsOf(id).map((c) => ({
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      correctedText: c.correctedText,
      createdAt: c.createdAt,
    }));
    const nodesRepo = new NodesRepo(ctx.handle, spaceId);
    const derivedNodes = nodesRepo
      .byIds(repo.nodeIdsWithOriginFrom(id))
      .map((n) => ({ nodeId: n.id, label: n.label }));
    res.json({
      source: { ...summarize(repo, src), capturedVia: sourceChannelOf(src) },
      reading: reading?.text ?? null,
      corrections,
      derivedNodes,
    });
  });

  // GET /api/words/search?q=&from=&to=&k= -> the panel face of
  // search_my_words, behaviour mirrored exactly: the query vector is
  // withheld when the configured embedder is the hash fallback (D2 —
  // hash vectors are not semantic matches) or when embedding throws,
  // so the search degrades to FTS-only and SAYS so (mode/degraded).
  // Excerpts are reading slices at the chunk's original offsets.
  r.get("/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "empty search query" });
      return;
    }
    const k = parseLimit(req.query.k, DEFAULT_SEARCH_K, MAX_SEARCH_K);
    const spaceId = spaceOf(res);
    const repo = new SourcesRepo(ctx.handle, spaceId);

    const filters: SourceSearchFilters = {};
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (from && to) {
      const tz = spaceTimezone(ctx, spaceId);
      try {
        filters.fromMs = localDayBoundsForDate(from, tz).startMs;
        filters.toMs = localDayBoundsForDate(to, tz).endMs;
      } catch {
        // Unparseable range: leave the date filter off rather than
        // silently searching an empty window (the tool's behaviour).
        delete filters.fromMs;
        delete filters.toMs;
      }
    }
    const hasFilters = filters.fromMs !== undefined;

    let queryVec: Float32Array | undefined;
    if (ctx.embeddings.model === "hash-bow") {
      queryVec = undefined; // D2: hash vectors are not semantic matches
    } else {
      try {
        queryVec = await ctx.embeddings.embed(q);
      } catch {
        queryVec = undefined;
      }
    }

    const result = searchSourceChunks(repo, q, {
      k,
      phrase: false,
      queryVec,
      ...(hasFilters ? { filters } : {}),
    });
    const results = result.hits.map(({ chunk, source }) => {
      const slice = repo.readingSlice(source.id, chunk.startOffset, chunk.endOffset);
      return {
        chunkId: chunk.id,
        sourceId: source.id,
        excerpt: trimLoneSurrogates(stripConflictMarkers(slice?.text ?? chunk.text)),
        citationClass: slice?.readingCitationClass ?? source.citationClass,
        channel: sourceChannelOf(source),
        createdAt: source.createdAt,
      };
    });
    res.json({ mode: result.mode, degraded: result.degraded, vecLag: result.vecLag, results });
  });

  return r;
}
