import type { Attachment, AwayDigest, ChatResponse, Constellation, DailyDigest, DormantItem, EmotionalTrajectory, EvolutionLink, Fuel, GraphData, GraphEdge, GraphNode, Insight, InvestigationReport, LifeAreaCount, LoreEntry, LoreSubjectType, SelfReviewItem, Streak } from "@brain/shared";
import { useState, useEffect } from "react";
// Transport primitives live in http.ts (Post-MVP D4 split); re-export the public ones
// so existing `import { getSpaceId, BOOT_TIMEOUT_MS } from "../api/client"` keep working.
import { API, afetch, getSpaceId, getSpaceName, storeSpace, BOOT_TIMEOUT_MS } from "./http.js";
import { CHAT_TIMEOUT_MS, ChatRequestError, chatErrorForStatus, chatTimeoutError, sanitizeChatPayload } from "./chatSend.js";

export * from "./chatSend.js";
export { getSpaceId, getSpaceName, BOOT_TIMEOUT_MS } from "./http.js";
// The "AI is working" activity signal lives in activity.ts (D4 split); re-export the hook.
import { tracked } from "./activity.js";
import { spaceLocalDay } from "../utils/localDay.js";
export { onAiActivity } from "./activity.js";
// Node "processing" (mid-ingest) state lives in processing.ts (D4 split).
import { setNodeProcessing } from "./processing.js";
export { isNodeProcessing, onNodeProcessingChange, useProcessingNodes } from "./processing.js";
// The newest cohesive domains (spaced-repetition review + the Chronicle timeline) live
// in features.ts; the Mind / cognitive layer lives in mind.ts. Re-export both so their
// call sites are unchanged.
export * from "./features.js";
export * from "./mind.js";
export * from "./attachments.js";
export * from "./companion.js";
export * from "./ops.js";

export interface AuthResult {
  id: string;
  name: string;
  created: boolean;
}

/** Open a brain (log in) or create one. Persists the id on success. */
export async function authSpace(gamerTag: string, passcode: string, name?: string): Promise<AuthResult> {
  const res = await afetch(`${API}/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag, passcode, name }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<AuthResult> & { error?: string };
  if (!res.ok || !body.id) {
    // IM-18: never surface the raw HTTP status as user copy — a human
    // fallback here; LoginScreen humanizes further by category.
    throw new Error(body.error ?? "Couldn't open that brain. Check your gamer tag and passcode and try again.");
  }
  storeSpace(body.id, body.name);
  return { id: body.id, name: body.name ?? name ?? gamerTag, created: !!body.created };
}

/** Validate the stored id against the server; returns the brain or null. */
export async function currentSpace(): Promise<{ id: string; name: string; gamerTag?: string } | null> {
  if (!getSpaceId()) return null;
  try {
    const res = await afetch(`${API}/space/me`, {}, BOOT_TIMEOUT_MS);
    if (!res.ok) return null;
    const body = (await res.json()) as { id: string; name: string; gamerTag?: string };
    storeSpace(body.id, body.name);
    return body;
  } catch {
    return null;
  }
}

export function logoutSpace(): void {
  storeSpace(null);
}

/** Update this brain's gamer tag and/or display name (tag stays unique). */
export async function updateProfile(opts: { gamerTag?: string; name?: string }): Promise<{ id: string; name: string; gamerTag: string }> {
  const res = await afetch(`${API}/space/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; gamerTag?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? `Couldn't update profile (${res.status})`);
  storeSpace(body.id, body.name); // keep the cached name in sync
  return { id: body.id, name: body.name ?? "", gamerTag: body.gamerTag ?? "" };
}

export interface IngestResult {
  nodes: GraphNode[];
  extractedEdges: unknown[];
  associativeEdges: unknown[];
  /** Fuel earned by this ingest (memory + links). */
  fuelEarned?: number;
  /** The brain's fuel after earning. */
  fuel?: Fuel;
  /** True when this tend counted a new day for the streak. */
  streakAdvanced?: boolean;
  /** True when a banked nebula shield forgave a missed day to keep the streak alive. */
  shieldUsed?: boolean;
}

export interface SearchHit extends GraphNode {
  similarity: number;
}

/** Mirrors server/llm/adapter.ts's DegradeReason — kept as a plain string union here
 *  rather than a shared import since this is the only web-side consumer. */
export type LlmDegradeReason = "auth" | "quota" | "timeout" | "budget";

export interface Health {
  ok: boolean;
  embeddings: { model: string; dim: number };
  llm: { model: string; available: boolean; degraded?: boolean; degradedReason?: LlmDegradeReason | null };
  nodes: number;
}

/** One place that turns raw `Health` into a human status — shared by the alert bar
 *  and the Soumaya tab's diagnostics readout, so "why is the cloud AI degraded" never
 *  says two different things depending on which surface you're looking at. */
export function describeLlmStatus(health: Health | null): { icon: string; tone: "ok" | "warning" | "error"; text: string } {
  if (!health?.llm) return { icon: "❔", tone: "warning", text: "Status unknown (couldn't reach the server)." };
  const { model, available, degraded, degradedReason } = health.llm;
  const provider = model.startsWith("gpt") ? "OpenAI" : model.startsWith("gemini") ? "Gemini" : null;
  if (degraded) {
    const reasonText: Record<LlmDegradeReason, string> = {
      auth: `Your ${provider ?? "cloud"} API key looks invalid or was rejected.`,
      quota: `Your ${provider ?? "cloud"} account is out of credit/quota.`,
      timeout: `${provider ?? "The cloud provider"} is responding too slowly right now.`,
      budget: "This app's own spend cap was reached (Soumaya tab → Advanced to raise it).",
    };
    return {
      icon: "⚠️",
      tone: "error",
      text: `${degradedReason ? reasonText[degradedReason] : "Cloud AI limit exceeded."} Running in offline fallback.`,
    };
  }
  if (!available) {
    return { icon: "🔌", tone: "warning", text: "No cloud AI key configured — running in offline fallback mode." };
  }
  return { icon: "✅", tone: "ok", text: `Connected — ${provider ?? model} (${model}).` };
}

export async function getGraph(
  limit = 300,
  includeIds?: number[],
): Promise<GraphData & { nextEdgeCursor?: number | null }> {
  // Boot-critical: a short timeout so a stalled server can't freeze the loading sun.
  const params = new URLSearchParams({ limit: String(limit) });
  // D3: explicit ids to force into the overview (union with top-`limit`).
  if (includeIds && includeIds.length > 0) params.set("includeIds", includeIds.join(","));
  const res = await afetch(`${API}/graph?${params.toString()}`, {}, BOOT_TIMEOUT_MS);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Couldn't load your galaxy (${res.status})`);
  }
  const d = (await res.json().catch(() => null)) as
    | (Partial<GraphData> & { nextEdgeCursor?: number | null })
    | null;
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.links)) {
    throw new Error("The galaxy response was invalid. Please try again.");
  }
  // Defense in depth: never hand the renderer a link whose endpoint is not in
  // the shipped node set — d3-force throws `node not found: <id>` on a
  // dangling link and the whole galaxy fails to render. The server prunes at
  // the source; this guard keeps the invariant even against a stale payload.
  const nodeIds = new Set(d.nodes.map((n) => n.id));
  return {
    nodes: d.nodes,
    links: d.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)),
    nextEdgeCursor: d.nextEdgeCursor ?? null,
  };
}

export interface GraphEdgesPage {
  edges: GraphEdge[];
  nextCursor: number | null;
}

/** D3: one cursor page of space-scoped edges incident to any of `ids`. */
export async function getIncidentEdges(
  ids: number[],
  cursor?: number | null,
): Promise<GraphEdgesPage> {
  const q = cursor != null ? `?cursor=${cursor}` : "";
  const res = await afetch(
    `${API}/graph/edges${q}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
    BOOT_TIMEOUT_MS,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Couldn't load graph edges (${res.status})`);
  }
  const d = (await res.json().catch(() => null)) as Partial<GraphEdgesPage> | null;
  if (!d || !Array.isArray(d.edges)) {
    throw new Error("The edges response was invalid. Please try again.");
  }
  return { edges: d.edges, nextCursor: d.nextCursor ?? null };
}

/**
 * Server per-request caps (D3) — must match `INCLUDE_IDS_CAP` /
 * `MAX_UNION_IDS` in `packages/server/src/graph/service.ts`.
 */
const INCLUDE_IDS_CHUNK = 200;
const MAX_UNION_IDS_CLIENT = 50000;

/**
 * D3: refresh that guarantees explicitly-requested ids appear. Chunks the
 * id list at the server's per-request cap and unions the node sets, then
 * runs edge completion: a SINGLE id-ordered cursor stream over the fixed
 * union id set U (no per-chunk sweep, so the rev-5 race has nowhere to
 * live), keeping edges with both endpoints in U and deduping by edge id
 * against overview's own links. The stream is self-completing under
 * concurrent writes (edge ids are monotonic): when it terminates at a null
 * cursor it has returned every incident edge present at the final page's
 * read instant.
 */
export async function getGraphWithCompletion(newIds: number[], limit = 300): Promise<GraphData> {
  const deduped = [...new Set(newIds.filter((n) => Number.isFinite(n)))];
  const chunks: number[][] = [];
  for (let i = 0; i < deduped.length; i += INCLUDE_IDS_CHUNK) {
    chunks.push(deduped.slice(i, i + INCLUDE_IDS_CHUNK));
  }
  if (chunks.length === 0) chunks.push([]);

  const nodeById = new Map<number, GraphNode>();
  const linkById = new Map<number, GraphEdge>();
  for (const c of chunks) {
    const page = await getGraph(limit, c);
    for (const n of page.nodes) nodeById.set(n.id, n);
    for (const l of page.links) linkById.set(l.id, l);
    // page.nextEdgeCursor is subsumed by the completion stream below, which
    // is provably complete for both-endpoints-in-U edges — no silent truncation.
  }

  const U = new Set(nodeById.keys());
  // Prune the seeded links to the union node set: an overview page can carry
  // links to nodes that page omitted (e.g. superseded rows), and only links
  // with both endpoints in U may reach the renderer (dangling link →
  // `node not found: <id>`). The completion stream below re-adds every
  // both-endpoints-in-U edge, so pruning here loses nothing.
  for (const [id, l] of linkById) {
    if (!U.has(l.source) || !U.has(l.target)) linkById.delete(id);
  }
  const Uarr = [...U];
  // Defensive: U can only exceed the server's union cap after a pathological
  // bulk sync; each slice still runs one self-completing stream, and the
  // union of complete streams is complete.
  for (let i = 0; i < Uarr.length; i += MAX_UNION_IDS_CLIENT) {
    const slice = Uarr.slice(i, i + MAX_UNION_IDS_CLIENT);
    let cursor: number | null = null;
    do {
      const { edges, nextCursor } = await getIncidentEdges(slice, cursor);
      for (const e of edges) {
        if (U.has(e.source) && U.has(e.target)) linkById.set(e.id, e);
      }
      cursor = nextCursor;
    } while (cursor != null);
  }
  return { nodes: [...nodeById.values()], links: [...linkById.values()] };
}

type IngestOpts = {
  kind?: "memory" | "action";
  ttlHours?: number;
  occurredAt?: string;
  remindAt?: string;
  tags?: string[];
};

/** localStorage queue of ingests captured while offline, scoped to the active brain.
 *  Returns null when no brain is signed in — we never queue under a shared "default"
 *  bucket, which could later sync a note into the wrong brain. */
const ingestQueueKey = (): string | null => {
  const id = getSpaceId();
  return id ? `brain.ingestQueue.${id}` : null;
};

/** Thrown when an ingest is saved offline instead of reaching the server. */
export class OfflineQueuedError extends Error {
  constructor() {
    super("You're offline — saved. I'll sync it the moment you're back online.");
    this.name = "OfflineQueuedError";
  }
}

function enqueueIngest(text: string, opts?: IngestOpts): void {
  try {
    const key = ingestQueueKey();
    if (!key) return; // no brain signed in — don't stash an unattributable note
    const q = JSON.parse(localStorage.getItem(key) || "[]") as { text: string; opts?: IngestOpts }[];
    q.push({ text, opts });
    localStorage.setItem(key, JSON.stringify(q.slice(-200)));
  } catch {
    /* storage unavailable — nothing more we can do */
  }
}

/**
 * Drain the offline ingest queue, POSTing each saved thought. Dispatches
 * "brain-ingest-synced" (with the new node ids) so the app can refresh + celebrate.
 * Safe to call repeatedly; re-queues anything that still fails.
 */
export async function flushIngestQueue(): Promise<number> {
  const key = ingestQueueKey();
  if (!key) return 0; // no brain signed in
  let q: { text: string; opts?: IngestOpts }[];
  try {
    q = JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return 0;
  }
  if (!q.length || (typeof navigator !== "undefined" && navigator.onLine === false)) return 0;
  const remaining: typeof q = [];
  const newIds: number[] = [];
  for (const item of q) {
    try {
      const res = await afetch(`${API}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: item.text, ...item.opts }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as IngestResult;
      for (const n of r.nodes) newIds.push(n.id);
    } catch {
      remaining.push(item); // still failing — keep it for the next flush
    }
  }
  try {
    localStorage.setItem(key, JSON.stringify(remaining));
  } catch {
    /* ignore */
  }
  const synced = q.length - remaining.length;
  if (synced > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("brain-ingest-synced", { detail: { newIds, synced } }));
  }
  return synced;
}

// Auto-flush whenever connectivity returns.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushIngestQueue());
}

export async function ingestText(text: string, opts?: IngestOpts): Promise<IngestResult> {
  return tracked(
    (async () => {
      // Offline up front → queue immediately, don't even try the network.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueueIngest(text, opts);
        throw new OfflineQueuedError();
      }
      let res: Response;
      try {
        res = await afetch(`${API}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, ...opts }),
        });
      } catch {
        // Network blip mid-request → save it for the next flush.
        enqueueIngest(text, opts);
        throw new OfflineQueuedError();
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Ingest failed (${res.status})`);
      }
      const out = (await res.json()) as IngestResult;
      // A banked nebula shield just forgave a missed day — surface it as a gentle,
      // reassuring moment (a broken streak is data, not punishment) instead of a silent save.
      if (out.shieldUsed && typeof window !== "undefined") {
        try { window.dispatchEvent(new CustomEvent("brain-shield-saved")); } catch { /* no window */ }
      }
      return out;
    })(),
  );
}

export async function search(q: string): Promise<SearchHit[]> {
  try {
    const res = await afetch(`${API}/search?q=${encodeURIComponent(q)}`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** Same request as search(), but distinguishes a real failure from "zero
 *  matches" instead of collapsing both into an empty array — SearchBox.tsx
 *  used to render a network error as an indistinguishable "No matches". */
export async function searchDetailed(q: string): Promise<{ hits: SearchHit[]; error?: string }> {
  try {
    const res = await afetch(`${API}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { hits: [], error: body.error ?? `Search failed (${res.status})` };
    }
    const d = await res.json().catch(() => []);
    return { hits: Array.isArray(d) ? d : [] };
  } catch {
    return { hits: [], error: "Couldn't reach the server." };
  }
}

/** Ask the AI to piece a memory + its connections into a fresh insight. */
export async function synthesizeNode(id: number): Promise<{ text: string; connected: number; questions?: string[] }> {
  setNodeProcessing([id], true);
  try {
    return await tracked(
      (async () => {
        const res = await afetch(`${API}/nodes/${id}/synthesize`, { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Synthesis failed (${res.status})`);
        }
        return res.json() as Promise<{ text: string; connected: number; questions?: string[] }>;
      })(),
    );
  } finally {
    setNodeProcessing([id], false);
  }
}

/** Manually set a memory's weight (0..1), or null to reset to the auto rating. */
export async function setImportance(id: number, importance: number | null): Promise<GraphNode> {
  const res = await afetch(`${API}/nodes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ importance }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Update failed (${res.status})`);
  }
  return res.json() as Promise<GraphNode>;
}

/**
 * Edit a memory's label and/or body via the node PATCH route (IM-26).
 * Unlike the fail-soft helpers, this THROWS on failure — an edit the server
 * didn't store must never look saved. Returns the updated (enriched) node.
 */
export async function updateNodeDetails(
  id: number,
  patch: { label?: string; content?: string },
): Promise<GraphNode> {
  const res = await afetch(`${API}/nodes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Update failed (${res.status})`);
  }
  return res.json() as Promise<GraphNode>;
}

/** Permanently delete a memory. */
export async function deleteNode(id: number): Promise<void> {
  const res = await afetch(`${API}/nodes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Delete failed (${res.status})`);
  }
}

/** Archive (rest) a memory — kept, but out of the galaxy + retrieval — or restore it. */
export async function archiveNode(id: number, archived = true): Promise<boolean> {
  try {
    const res = await afetch(`${API}/nodes/${id}/${archived ? "archive" : "unarchive"}`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
export async function getArchivedNodes(): Promise<GraphNode[]> {
  try {
    const res = await afetch(`${API}/nodes/archived`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** An object's evolving lore (oldest → newest); genesis is created on first read. */
export async function getLore(subjectType: LoreSubjectType, subjectId: string): Promise<LoreEntry[]> {
  try {
    const res = await afetch(`${API}/lore/${subjectType}/${encodeURIComponent(subjectId)}`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? (d as LoreEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Strict variant of getLore for surfaces that must distinguish "no story yet"
 * from "the story failed to load" (IM-31): THROWS on network/HTTP failure
 * instead of collapsing it into an empty history. getLore's fail-soft
 * contract is unchanged for its other callers.
 */
export async function getLoreStrict(subjectType: LoreSubjectType, subjectId: string): Promise<LoreEntry[]> {
  const res = await afetch(`${API}/lore/${subjectType}/${encodeURIComponent(subjectId)}`);
  if (!res.ok) throw new Error(`Lore failed (${res.status})`);
  const d = await res.json().catch(() => []);
  return Array.isArray(d) ? (d as LoreEntry[]) : [];
}

/** Append the next lore chapter; returns the full updated history. */
export async function evolveLore(
  subjectType: LoreSubjectType,
  subjectId: string,
): Promise<LoreEntry[]> {
  const res = await afetch(`${API}/lore/${subjectType}/${encodeURIComponent(subjectId)}/evolve`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Evolve failed (${res.status})`);
  const d = (await res.json()) as { history: LoreEntry[] };
  return d.history;
}

export async function getNeighbors(id: number, depth = 2): Promise<GraphData> {
  try {
    const res = await afetch(`${API}/nodes/${id}/neighbors?depth=${depth}`);
    const d = (await res.json().catch(() => null)) as Partial<GraphData> | null;
    return {
      nodes: Array.isArray(d?.nodes) ? d!.nodes! : [],
      links: Array.isArray(d?.links) ? d!.links! : [],
    };
  } catch {
    return { nodes: [], links: [] };
  }
}

/**
 * Run the Investigator's cited deep-dive over one memory (IM-37):
 * POST /api/investigate { nodeId } — deterministic + offline server-side.
 * THROWS on failure so the surface can show an honest error, never a
 * fabricated report. (The endpoint takes the node only — no free-text
 * question parameter exists in its contract.)
 */
export async function investigateNode(nodeId: number): Promise<InvestigationReport> {
  const res = await afetch(`${API}/investigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Investigation failed (${res.status})`);
  }
  return res.json() as Promise<InvestigationReport>;
}

export async function getHealth(): Promise<Health> {
  const res = await afetch(`${API}/health`, {}, BOOT_TIMEOUT_MS);
  return res.json() as Promise<Health>;
}

export async function getDigest(): Promise<Insight[]> {
  try {
    const res = await afetch(`${API}/digest`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/**
 * IM-124 residual: the strict sibling of `getDigest` — same endpoint, but
 * FAILURE (network error, non-OK status, malformed body) returns
 * `{ ok: false }` instead of collapsing into the same `[]` as a genuine
 * empty digest. `getDigest` above keeps its fail-soft contract untouched
 * for every existing caller; only callers that must distinguish "nothing
 * to report" from "the server didn't answer" (the Observatory) use this.
 * Same Result-variant pattern as api/mind.ts's `getCognitiveResult`.
 */
export async function getDigestResult(): Promise<{ ok: true; insights: Insight[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/digest`);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, insights: d as Insight[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Soumaya's daily digest (free, no LLM). Returns a safe empty shape on error. */
export async function getDailyDigest(): Promise<DailyDigest> {
  const empty: DailyDigest = {
    date: spaceLocalDay(),
    greeting: "",
    fresh: [],
    connections: [],
    expiredActions: [],
    cooling: [],
    reminders: [],
    closing: "",
  };
  try {
    const res = await afetch(`${API}/digest/daily`);
    const d = await res.json().catch(() => null);
    if (!d || typeof d !== "object") return empty;
    return {
      date: typeof d.date === "string" ? d.date : empty.date,
      greeting: typeof d.greeting === "string" ? d.greeting : "",
      fresh: Array.isArray(d.fresh) ? d.fresh : [],
      connections: Array.isArray(d.connections) ? d.connections : [],
      expiredActions: Array.isArray(d.expiredActions) ? d.expiredActions : [],
      cooling: Array.isArray(d.cooling) ? d.cooling : [],
      reminders: Array.isArray(d.reminders) ? d.reminders : [],
      closing: typeof d.closing === "string" ? d.closing : "",
    };
  } catch {
    return empty;
  }
}

/** This brain's Celestial Economy fuel (free, space-scoped). */
export async function getFuel(): Promise<Fuel | null> {
  try {
    const res = await afetch(`${API}/maintenance/fuel`, {}, BOOT_TIMEOUT_MS);
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return d && typeof d.fuel === "number" ? (d as Fuel) : null;
  } catch {
    return null;
  }
}

/** Spend Fuel her fast flight burned. Returns the new balance (or null on failure). */
export async function burnFuel(amount: number): Promise<Fuel | null> {
  try {
    const res = await afetch(`${API}/maintenance/fuel/burn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return d && typeof d.fuel === "number" ? (d as Fuel) : null;
  } catch {
    return null;
  }
}

/** This brain's daily-tending streak (consecutive days fed a memory). */
export async function getStreak(): Promise<Streak | null> {
  try {
    const res = await afetch(`${API}/maintenance/streak`);
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return d && typeof d.current === "number" ? (d as Streak) : null;
  } catch {
    return null;
  }
}

/** "Tend" a memory (reset its entropy) — called when you focus it. Fire-and-forget. */
export async function tendNode(id: number): Promise<void> {
  try {
    await afetch(`${API}/nodes/${id}/tend`, { method: "POST" });
  } catch {
    /* best-effort */
  }
}

/** Ask Soumaya to prioritize tending this memory on her next round. Best-effort. */
export async function requestMaintenance(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/nodes/${id}/request-maintenance`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

/** ML constellations (k-means over embeddings). Safe array on error. */
export async function getConstellations(): Promise<Constellation[]> {
  try {
    const res = await afetch(`${API}/constellations`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/**
 * IM-124 residual: strict sibling of `getConstellations` (see
 * `getDigestResult`) — `{ ok: false }` on any failure, so a caller that
 * must not mistake a dead endpoint for "no constellations" can tell the
 * difference. `getConstellations` keeps its fail-soft contract.
 */
export async function getConstellationsResult(): Promise<{ ok: true; constellations: Constellation[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/constellations`);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, constellations: d as Constellation[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Promote a detected cluster into a persistent, named constellation hub (MOC). */
/**
 * `error` carries the server's real reason (e.g. "at least 2 memories required") when
 * available. This used to build that exact message via `throw new Error(...)` and then
 * catch it immediately, discarding it — the caller only ever saw a generic fallback.
 */
export async function promoteConstellation(name: string, nodeIds: number[]): Promise<{ hub: GraphNode | null; error?: string }> {
  try {
    const res = await afetch(`${API}/constellations/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, nodeIds }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { hub: null, error: body.error };
    }
    return { hub: (await res.json()) as GraphNode };
  } catch {
    return { hub: null };
  }
}

/**
 * Run the latent-connection scan. IM-61: a scan is an ACTION, not a read —
 * unlike the fail-soft getters above it must NOT return [] on error, because
 * the caller toasts "no connections found" for an empty result, and a failed
 * scan masquerading as an empty one tells the user their brain was checked
 * when it never was. Throws on network failure, non-OK status, or a
 * non-array body; resolves (possibly []) only on a real, successful scan.
 */
export async function runDigest(): Promise<Insight[]> {
  return tracked(
    (async () => {
      const res = await afetch(`${API}/digest/run`, { method: "POST" });
      if (!res.ok) throw new Error(`Connection scan failed (${res.status})`);
      const d = await res.json().catch(() => null);
      if (!Array.isArray(d)) throw new Error("Connection scan returned an unexpected result");
      return d as Insight[];
    })(),
  );
}

/**
 * Claim the one-time fuel reward for discovering a Codex entry (idempotent server-side).
 * `failed` distinguishes a rejected/unreachable claim (IM-93: callers must NOT treat
 * the entry as claimed — it stays eligible for a retry) from a successful claim that
 * simply awarded nothing because it was already claimed.
 */
export async function claimCodexReward(key: string): Promise<{ awarded: boolean; fuel?: number; failed?: boolean }> {
  try {
    const res = await afetch(`${API}/maintenance/codex-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) return { awarded: false, failed: true };
    return (await res.json()) as { awarded: boolean; fuel?: number };
  } catch {
    return { awarded: false, failed: true };
  }
}

/** Mood-over-time trajectory + detected emotional patterns (free, offline-safe). */
export async function getEmotionalTrajectory(): Promise<EmotionalTrajectory> {
  const empty: EmotionalTrajectory = {
    points: [],
    trend: "steady",
    average: 0,
    volatility: 0,
    patterns: [],
    sampleSize: 0,
  };
  try {
    const res = await afetch(`${API}/digest/emotional`);
    const d = await res.json().catch(() => null);
    if (!d || typeof d !== "object") return empty;
    return {
      points: Array.isArray(d.points) ? d.points : [],
      trend: d.trend === "rising" || d.trend === "falling" ? d.trend : "steady",
      average: typeof d.average === "number" ? d.average : 0,
      volatility: typeof d.volatility === "number" ? d.volatility : 0,
      patterns: Array.isArray(d.patterns) ? d.patterns : [],
      sampleSize: typeof d.sampleSize === "number" ? d.sampleSize : 0,
    };
  } catch {
    return empty;
  }
}

/** Distribution of memories across life-areas — the optional life-area lens (#6). */
export async function getLifeAreas(): Promise<LifeAreaCount[]> {
  try {
    const res = await afetch(`${API}/digest/life-areas`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** "While you were away" digest — what changed since your last visit. */
export async function getAwayDigest(): Promise<AwayDigest | null> {
  try {
    const res = await afetch(`${API}/digest/away`);
    const d = await res.json().catch(() => null);
    return d && typeof d === "object" ? (d as AwayDigest) : null;
  } catch {
    return null;
  }
}

/** Advance the "last visit" window to now (after showing / skipping the welcome-back card). */
export async function markAwaySeen(): Promise<void> {
  try {
    await afetch(`${API}/digest/away/seen`, { method: "POST" });
  } catch {
    /* best-effort */
  }
}

/** Soumaya's read-only coverage self-check (#12). */
export async function getSelfReview(): Promise<SelfReviewItem[]> {
  try {
    const res = await afetch(`${API}/digest/self-review`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** How threads of thinking evolved over time (older → newer, free, offline-safe). */
export async function getEvolutionLinks(): Promise<EvolutionLink[]> {
  try {
    const res = await afetch(`${API}/digest/evolution`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}


/** Dormant skills/goals/projects worth reviving (free, offline-safe). */
export async function getDormant(): Promise<DormantItem[]> {
  try {
    const res = await afetch(`${API}/digest/dormant`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/**
 * Scan same-topic memories for contradictions (changed beliefs / reversed goals).
 * IM-61: same honesty contract as runDigest — throws on any failure so the
 * panel can say "the scan didn't run" instead of the false reassurance
 * "No contradictions found — your memories are consistent ✓".
 */
export async function runContradictions(): Promise<Insight[]> {
  return tracked(
    (async () => {
      const res = await afetch(`${API}/digest/contradictions`, { method: "POST" });
      if (!res.ok) throw new Error(`Contradiction scan failed (${res.status})`);
      const d = await res.json().catch(() => null);
      if (!Array.isArray(d)) throw new Error("Contradiction scan returned an unexpected result");
      return d as Insight[];
    })(),
  );
}

/**
 * Proactive → Chat handoff sources (Phase Y: "goal_trend"; Phase Z adds "bill_risk",
 * docs/specs/soumaya-bill-risk-proactive-source.md). Exported once here so client.ts,
 * ChatDock.tsx, and App.tsx share one literal instead of three independently-typed
 * copies now that there are two sources — still just a web-local type alias, not a new
 * cross-package abstraction.
 */
export type ProactiveContextSource = "goal_trend" | "bill_risk";
export interface ProactiveContext {
  source: ProactiveContextSource;
  targetId: number;
}

export async function askChat(
  question: string,
  /** Recent turns (oldest first) so she carries the conversation thread. */
  history: { role: "you" | "soumaya"; text: string }[] = [],
  /**
   * Explicit Journey-scoped retrieval (Phase Q server-side; Phase AC.1 wires the client).
   * Only ever a real, user-selected Journey id (e.g. "Ask Soumaya about this" from a
   * JourneyCard) — never inferred from `question`'s text. The server re-validates it
   * belongs to this space before using it for anything; an invalid/cross-space id here
   * just contributes zero extra candidates, never an error.
   */
  journeyId?: number,
  /**
   * Proactive → Chat handoff (Phase Y, docs/specs/soumaya-proactive-chat-handoff.md).
   * Only ever set when the user opened Chat from a real proactive delivery (a toast
   * click) — the server re-validates it against real data before using it for
   * anything, so an invalid/stale/cross-space value here just contributes nothing.
   */
  proactiveContext?: ProactiveContext,
  /**
   * In-chat attachments (IM-106): files attached to THIS message, already
   * extracted to text client-side (lib/extractFileText.ts). One-turn context
   * for her reply — never stored server-side as documents.
   */
  attachments?: { name: string; text: string }[],
  /**
   * Caller cancel (IM-103): aborts the in-flight request. Linked with the
   * standard timeout below so supplying a signal doesn't silently remove the
   * hang protection afetch normally provides.
   */
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return tracked(
    (async () => {
      // Finding 1: EVERY send (fresh or retry — retries call askChat again)
      // is sanitized to the server contract here, so the payload shapes the
      // server rejects (history text >4000, >16 entries, empty/oversized
      // attachments, question >2000) can no longer be produced by this
      // client. The client's own history window (last 8) is unchanged.
      const payload = sanitizeChatPayload({
        question,
        history: history.slice(-8),
        attachments,
      });
      // afetch skips its own timeout when the caller passes a signal, so link
      // the caller's signal with the chat timeout here. Finding 8: the cap is
      // CHAT_TIMEOUT_MS (15s — server turn deadline 9s + network slack), not
      // the generic 60s, so a hung turn surfaces while the user is looking.
      let effectiveSignal = signal;
      let timer: number | undefined;
      let timedOut = false;
      if (signal) {
        const linked = new AbortController();
        timer = window.setTimeout(() => {
          timedOut = true;
          linked.abort();
        }, CHAT_TIMEOUT_MS);
        if (signal.aborted) linked.abort();
        else signal.addEventListener("abort", () => linked.abort(), { once: true });
        effectiveSignal = linked.signal;
      }
      try {
        const res = await afetch(
          `${API}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: payload.question,
              history: payload.history,
              ...(journeyId ? { journeyId } : {}),
              ...(proactiveContext ? { proactiveContext } : {}),
              ...(payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
            }),
            ...(effectiveSignal ? { signal: effectiveSignal } : {}),
          },
          CHAT_TIMEOUT_MS,
        );
        // IM-108: an HTTP failure used to be cast to ChatResponse anyway, so a
        // 400/500 body ({error}) surfaced as a phantom "(no answer)" reply in
        // her voice. Throw so the caller can show a real error surface.
        // Finding 1: the thrown error carries PLAIN-LANGUAGE copy mapped from
        // the status — the server's raw error string is read by NO ONE here
        // and never reaches the UI (it belongs in server logs).
        if (!res.ok) throw chatErrorForStatus(res.status);
        return (await res.json()) as ChatResponse;
      } catch (err) {
        if (err instanceof ChatRequestError) throw err;
        // Our own timeout aborts the linked signal (the caller's signal is
        // untouched) — translate that into the honest timeout copy. A caller
        // abort (Stop) rethrows as-is so ChatDock can tell the difference.
        if (timedOut) throw chatTimeoutError();
        throw err;
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
      }
    })(),
  );
}


/** Her current multi-day undertaking (arc), or null. */
export interface Undertaking {
  id: number;
  kind: string;
  title: string;
  total: number;
  done: number;
  status: "active" | "done";
  startedAt: string;
  endsAt: string | null;
}
export async function getUndertaking(): Promise<Undertaking | null> {
  try {
    const res = await afetch(`${API}/maintenance/undertaking`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Recent undertakings incl. completed ones, newest first (IM-67). [] on failure. */
export async function getUndertakingHistory(): Promise<Undertaking[]> {
  try {
    const res = await afetch(`${API}/maintenance/undertakings`);
    if (!res.ok) return [];
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? (d as Undertaking[]) : [];
  } catch {
    return [];
  }
}

/** A belief she's consolidated about you (dream cycles). */
export interface Belief {
  id: number;
  content: string;
  createdAt: string;
  evidence: number;
}
export async function getBeliefs(): Promise<Belief[]> {
  try {
    const res = await afetch(`${API}/digest/beliefs`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** Acknowledge a due reminder (clears remind_at so it stops re-surfacing). */
export async function ackReminder(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/nodes/${id}/ack-reminder`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Agenda edit/reschedule/snooze patch (IM-51) — additive PATCH /nodes/:id/agenda. */
export interface AgendaPatch {
  label?: string;
  content?: string;
  remindAt?: string | null;
  expiresAt?: string | null;
}

export async function updateAgendaItem(id: number, patch: AgendaPatch): Promise<GraphNode> {
  const res = await afetch(`${API}/nodes/${id}/agenda`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Agenda update failed (${res.status})`);
  }
  return res.json() as Promise<GraphNode>;
}

/** Resolve/dismiss a surfaced insight (reconciled contradiction, seen connection). */
export async function resolveInsight(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/digest/insights/${id}/resolve`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

/** The Daily Contact — her one question + discovery of the day. */
export interface DailyContact {
  date: string;
  question: {
    text: string;
    nodeId: number | null;
    nodeLabel: string | null;
    source: "research" | "contradiction" | "cooling" | "heavy";
  } | null;
  discovery: { text: string; nodeId: number | null } | null;
  foresight: { text: string; inDays: number } | null;
  answered: boolean;
}

export async function getDailyContact(): Promise<DailyContact | null> {
  try {
    const res = await afetch(`${API}/contact`);
    return res.ok ? ((await res.json()) as DailyContact) : null;
  } catch {
    return null;
  }
}

export async function answerDailyContact(
  text: string,
): Promise<{ nodeIds: number[]; fuelEarned: number; streakAdvanced: boolean } | null> {
  try {
    const res = await afetch(`${API}/contact/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Ask the server to distill a finished chat into 0–3 memory-worthy notes. */
export async function distillChat(messages: { role: "you" | "soumaya"; text: string }[]): Promise<string[]> {
  try {
    const res = await afetch(`${API}/chat/distill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const d = (await res.json().catch(() => ({}))) as { summaries?: string[] };
    return Array.isArray(d.summaries) ? d.summaries : [];
  } catch {
    return [];
  }
}



// --- Visitor activity ---

export interface VisitedMemory {
  nodeId: number;
  label: string;
  type: string;
  visits: number;
  visitorTypes: string[];
  lastAt: string;
}

/** Report a batch of visitor arrivals (fire-and-forget; never throws/badges).
 *  Pass `flush: true` from pagehide/backgrounding — `keepalive` lets the request
 *  outlive the page so the buffered tail isn't silently dropped on close. */
export function logVisits(events: { nodeId: number; type: string }[], flush = false): void {
  if (events.length === 0) return;
  void afetch(`${API}/visitors/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
    ...(flush ? { keepalive: true } : {}),
  }).catch(() => {});
}

export async function getVisitorActivity(): Promise<VisitedMemory[]> {
  try {
    const res = await afetch(`${API}/visitors`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? (d as VisitedMemory[]) : [];
  } catch {
    return [];
  }
}

/** Submit answers to clarifying research questions. */
export async function answerResearch(id: number, answers: Record<string, string>): Promise<{ node: GraphNode }> {
  return tracked(
    (async () => {
      const res = await afetch(`${API}/nodes/${id}/answer-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Answering research failed (${res.status})`);
      }
      return res.json() as Promise<{ node: GraphNode }>;
    })()
  );
}
