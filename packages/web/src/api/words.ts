import { API, afetch } from "./http.js";

/**
 * Your Words panel client (design `WORDS-PANEL-DESIGN-2026-10-31.md`).
 * Thin fail-soft wrappers over the read-only /api/words routes — the
 * panel face of the Verbatim-Recall stack. A failed read returns null
 * so the panel can say "couldn't reach the server" instead of
 * pretending the archive is empty.
 *
 * Exact-words contract: every text field here (preview, excerpt,
 * reading) is the server's CURRENT READING of a source — corrections
 * applied — never node content. Derived nodes arrive as labels only.
 */

export type WordsChannel = "typed" | "telegram" | "chat" | "imported";

export interface WordSourceSummary {
  id: number;
  kind: string;
  channel: WordsChannel;
  citationClass: string;
  createdAt: string;
  preview: string;
  wordCount: number;
}

export interface WordsOverview {
  total: number;
  byChannel: Record<WordsChannel, number>;
  recent: WordSourceSummary[];
  openFlags: number;
}

export interface WordCorrection {
  startOffset: number;
  endOffset: number;
  correctedText: string;
  createdAt: string;
}

export interface WordSourceDetail {
  source: WordSourceSummary & { capturedVia: WordsChannel };
  reading: string | null;
  corrections: WordCorrection[];
  derivedNodes: { nodeId: number; label: string }[];
}

export interface WordSearchHit {
  chunkId: number;
  sourceId: number;
  excerpt: string;
  citationClass: string;
  channel: WordsChannel;
  createdAt: string;
}

export interface WordsSearchResponse {
  mode: "fts+vec" | "fts_only" | "vec_only";
  degraded: boolean;
  vecLag: boolean;
  results: WordSearchHit[];
}

/** The existing forget-request creation act's response (POST
 *  /api/sources/:id/forget-request). Success carries the created
 *  request; a refusal carries error/message (e.g. a request already
 *  exists) — the panel shows the message rather than hiding it, so
 *  unlike the read wrappers this one returns the parsed body on a
 *  refusal too, and null only when the server couldn't be reached. */
export interface SourceForgetRequestResult {
  requestId?: number;
  status?: string;
  error?: string;
  message?: string;
  existingRequestId?: number;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await afetch(`${API}/words${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getWordsOverview = () => getJson<WordsOverview>("/overview");

export function listWordSources(params: {
  channel?: WordsChannel;
  kind?: string;
  limit?: number;
  before?: number;
} = {}): Promise<{ sources: WordSourceSummary[] } | null> {
  const qs = new URLSearchParams();
  if (params.channel) qs.set("channel", params.channel);
  if (params.kind) qs.set("kind", params.kind);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.before !== undefined) qs.set("before", String(params.before));
  const suffix = qs.toString();
  return getJson<{ sources: WordSourceSummary[] }>(`/sources${suffix ? `?${suffix}` : ""}`);
}

export const getWordSource = (id: number) => getJson<WordSourceDetail>(`/sources/${id}`);

export function searchWords(params: {
  q: string;
  from?: string;
  to?: string;
  k?: number;
}): Promise<WordsSearchResponse | null> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.k !== undefined) qs.set("k", String(params.k));
  return getJson<WordsSearchResponse>(`/search?${qs.toString()}`);
}

/** Create a forget request for a source — the EXISTING owner act 1
 *  (POST /api/sources/:id/forget-request). The panel does not invent
 *  a new act: approval and apply stay on their existing routes. */
export async function createSourceForgetRequest(id: number): Promise<SourceForgetRequestResult | null> {
  try {
    const res = await afetch(`${API}/sources/${id}/forget-request`, { method: "POST" });
    return (await res.json()) as SourceForgetRequestResult;
  } catch {
    return null;
  }
}
