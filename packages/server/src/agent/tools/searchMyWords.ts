import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import {
  SourcesRepo,
  searchSourceChunks,
  type SourceSearchFilters,
} from "../../repositories/sources.repo.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import {
  localDayBoundsForDate,
  localDateOfStored,
  parseTolerantMs,
} from "../../lib/time.js";

/**
 * Verbatim-Recall V2 — `search_my_words`: the user's OWN preserved
 * words (sources), as opposed to memory_search's derived nodes.
 *
 * Structural honesty rules (design note Rev 4):
 * - The payload contains EXCERPTS ONLY — sliced from the current
 *   reading of a source (corrections applied), never node text.
 *   Linked nodes appear as labels + provenance scope, so "never
 *   quote a node" is a property of the data, not of the prompt.
 * - Search mode and degradation are reported exactly as they
 *   happened (fts_only / vec_only / fts+vec, degraded, vecLag).
 * - Coverage is computed over the whole sources table of the space,
 *   never from the hits, so a no-hit answer can say how far back the
 *   preserved record actually reaches.
 * - D2: when the configured embedder is the hash fallback
 *   (model "hash-bow" — the adapter's silent stand-in when the real
 *   embedder failed to start), its vectors are NOT semantic matches:
 *   the query vector is withheld and the search runs FTS-only,
 *   reported degraded. Same for a call-time embed failure.
 *
 * Space isolation: the repo is constructed with tc.spaceId from the
 * server-provided ToolContext; the model never supplies a space id.
 * Read-only. No approval required.
 */

const DEFAULT_K = 6;
const MAX_K = 10;
/** Coverage scans the whole space; the cap is a belt-and-braces bound
 *  far above any real corpus, passed explicitly (list() defaults to
 *  500, which would silently understate coverage). */
const COVERAGE_LIST_LIMIT = 100_000;
const FALLBACK_TZ = "America/New_York";

/** Plain-language citation-class labels (design §2). The class itself
 *  also ships, machine-readable, on every excerpt. */
const CITATION_CLASS_LABELS: Record<string, string> = {
  verbatim_typed: "your typed words",
  transcript_machine: "machine transcript",
  transcript_corrected: "transcript you corrected",
  transcript_unverifiable: "transcript that couldn't be verified",
  imported_text: "imported text",
};

function citationClassLabel(cls: string): string {
  return CITATION_CLASS_LABELS[cls] ?? cls;
}

/** The space's timezone from space_meta, defensively (mirrors the
 *  spaceLocalDate pattern in agent/episodic.ts): any failure — no row,
 *  unreachable table, invalid zone name — falls back, never throws. */
function spaceTimezone(tc: ToolContext): string {
  try {
    const row = tc.ctx.handle.sqlite
      .prepare(`SELECT timezone FROM space_meta WHERE space_id = ?`)
      .get(tc.spaceId) as { timezone?: string } | undefined;
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

interface Coverage {
  totalSources: number;
  unchunkedSources: number;
  earliestSourceAt: string | null;
  earliestSourceAtLocal: string | null;
}

/** K4 — coverage over the eligible population: every source in the
 *  space, classified by whether it has chunks (only chunked sources
 *  are searchable). Derived from the sources table alone. */
function computeCoverage(repo: SourcesRepo, tz: string): Coverage {
  const all = repo.list(COVERAGE_LIST_LIMIT);
  let totalSources = 0;
  let unchunkedSources = 0;
  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestRaw: string | null = null;
  for (const s of all) {
    const chunkCount = repo.chunksOf(s.id).length;
    if (chunkCount === 0) {
      unchunkedSources++;
      continue;
    }
    totalSources++;
    const raw = s.occurredAt ?? s.createdAt;
    const ms = parseTolerantMs(raw);
    if (Number.isFinite(ms) && ms < earliestMs) {
      earliestMs = ms;
      earliestRaw = raw;
    }
  }
  return {
    totalSources,
    unchunkedSources,
    earliestSourceAt:
      earliestRaw === null ? null : new Date(earliestMs).toISOString(),
    earliestSourceAtLocal:
      earliestRaw === null ? null : renderCoverageStart(earliestRaw, earliestMs, tz),
  };
}

/** §4.1 clarification B: the coverage boundary renders WITH time and
 *  zone context — never a bare date — when the stored value is a
 *  timestamp. A stored bare date is a calendar date (it carries no
 *  time to show), so it renders as the date itself. */
function renderCoverageStart(raw: string, ms: number, tz: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

export const searchMyWordsTool: Tool = {
  name: "search_my_words",
  description:
    "Search the user's OWN preserved words — their notes, messages, and transcripts, stored verbatim — and return exact excerpts with citations. Use when the user asks what they said, wrote, or recorded (\"what did I say about…\", \"find my note where I…\"), or when a quote must be exact. This searches preserved sources only, NOT derived memories: results are quotable excerpts with the passage's location (source, chunk, character offsets) and how trustworthy the wording is (typed by them, machine transcript, corrected transcript). Supports date_range (their local dates), kind, speaker, and exact_phrase (literal wording only — a phrase search that misses means they never wrote that exact phrase). A no-hit result is a real answer: the coverage field says how many preserved sources exist and how far back they reach.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Words or a topic to find in the user's preserved sources.",
      },
      date_range: {
        type: "object",
        description: "Restrict to sources from these local dates (inclusive, YYYY-MM-DD).",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
      kind: {
        type: "string",
        description: "Restrict to one source kind (e.g. note, telegram, document, voice).",
      },
      speaker: {
        type: "string",
        description: "Restrict to one speaker (e.g. owner).",
      },
      exact_phrase: {
        type: "boolean",
        description:
          "True = match this exact literal phrase only (no keyword or meaning-based matching). Default false.",
      },
      k: {
        type: "integer",
        minimum: 1,
        maximum: MAX_K,
        description: `Max excerpts to return (1-${MAX_K}, default ${DEFAULT_K}).`,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, summary: "empty search query" };
    const k = Math.min(MAX_K, Math.max(1, Number(args.k ?? DEFAULT_K) || DEFAULT_K));
    const exactPhrase = args.exact_phrase === true;

    const tz = spaceTimezone(tc);
    const repo = new SourcesRepo(tc.ctx.handle, tc.spaceId);

    // Filters are built here but APPLIED inside the repo methods,
    // before their k cuts (K1) — never post-filtered at this layer.
    const filters: SourceSearchFilters = {};
    const dr = args.date_range as { from?: unknown; to?: unknown } | undefined;
    if (dr && typeof dr.from === "string" && typeof dr.to === "string") {
      try {
        filters.fromMs = localDayBoundsForDate(dr.from, tz).startMs;
        filters.toMs = localDayBoundsForDate(dr.to, tz).endMs;
      } catch {
        // Unparseable range: leave the date filter off rather than
        // silently searching an empty window.
        delete filters.fromMs;
        delete filters.toMs;
      }
    }
    if (typeof args.kind === "string" && args.kind.trim()) filters.kind = args.kind.trim();
    if (typeof args.speaker === "string" && args.speaker.trim()) {
      filters.speaker = args.speaker.trim();
    }
    const hasFilters =
      filters.fromMs !== undefined || filters.kind !== undefined || filters.speaker !== undefined;

    // Query vector — withheld entirely for exact_phrase (literal-only
    // by request), and withheld under D2 (hash fallback or call-time
    // failure), which degrades the search to FTS-only, reported.
    let queryVec: Float32Array | undefined;
    if (!exactPhrase) {
      if (tc.ctx.embeddings.model === "hash-bow") {
        queryVec = undefined; // D2: hash vectors are not semantic matches
      } else {
        try {
          queryVec = await tc.ctx.embeddings.embed(query);
        } catch {
          queryVec = undefined;
        }
      }
    }

    const result = searchSourceChunks(repo, query, {
      k,
      phrase: exactPhrase,
      queryVec,
      ...(hasFilters ? { filters } : {}),
    });
    // Under exact_phrase the missing vector path is the request, not a
    // degradation; every other path reports the primitive's truth.
    const degraded = exactPhrase ? false : result.degraded;

    const nodesRepo = new NodesRepo(tc.ctx.handle, tc.spaceId);
    const excerpts = result.hits.map(({ chunk, source }) => {
      // The excerpt text is the current reading sliced to this chunk's
      // ORIGINAL offsets (D1) — corrections applied, chunk identity
      // untouched. For an uncorrected chunk this is exactly the stored
      // chunk substring, by construction of the reading model.
      const slice = repo.readingSlice(source.id, chunk.startOffset, chunk.endOffset);
      const readingClass = slice?.readingCitationClass ?? source.citationClass;

      // Provenance: nodes this source fed, labeled by link scope. The
      // node's LABEL only — its content never enters the payload.
      const links = repo.activeLinksForSource(source.id);
      const scopeByNode = new Map<number, "chunk" | "source">();
      for (const l of links) {
        if (l.chunkId === chunk.id) scopeByNode.set(l.nodeId, "chunk");
        else if (!scopeByNode.has(l.nodeId)) scopeByNode.set(l.nodeId, "source");
      }
      const linkedNodes = nodesRepo
        .byIds([...scopeByNode.keys()])
        .map((n) => ({ id: n.id, label: n.label, linkScope: scopeByNode.get(n.id)! }));

      return {
        text: slice?.text ?? chunk.text,
        quotable: true,
        sourceId: source.id,
        sourceTitle: source.title ?? `${source.kind} · ${localDateOfStored(source.occurredAt ?? source.createdAt, tz) ?? "undated"}`,
        kind: source.kind,
        speaker: source.speaker,
        date: localDateOfStored(source.occurredAt ?? source.createdAt, tz),
        chunkOrdinal: chunk.ordinal,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        citationClass: readingClass,
        citationClassLabel: citationClassLabel(readingClass),
        originalCitationClass: source.citationClass,
        corrected: slice?.corrected ?? false,
        conflicted: slice?.conflicted ?? false,
        linkedNodes,
      };
    });

    const coverage = computeCoverage(repo, tz);
    const payload = {
      excerpts,
      coverage,
      mode: result.mode,
      degraded,
      vecLag: result.vecLag,
    };
    return {
      ok: true,
      // summary is content-free (it reaches agent_logs); the payload
      // lives in `message`, which only the agent loop consumes.
      summary: `search_my_words: ${excerpts.length} excerpts, mode ${result.mode}${degraded ? ", degraded" : ""}`,
      targets: excerpts.map((e) => e.sourceId),
      message: JSON.stringify(payload),
    };
  },
};
