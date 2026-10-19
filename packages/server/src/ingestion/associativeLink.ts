import type { GraphEdge, GraphNode } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { knn } from "../db/vec.js";
import type { LlmProvider } from "../llm/adapter.js";
import type { EdgesRepo } from "../repositories/edges.repo.js";
import type { NodesRepo } from "../repositories/nodes.repo.js";
import { recordCandidate } from "../analysis/candidates.js";

export interface AssociativeLinkOptions {
  /** Cosine similarity floor for a candidate to be considered. */
  threshold: number;
  /** Max nearest neighbours to inspect (caps LLM fan-out). */
  k: number;
  /** Max edges to actually create for one new node (avoids hub over-linking). */
  maxLinks?: number;
  /** Per-validation timeout ms (D4). Defaults to 30s; override in tests. */
  validateTimeoutMs?: number;
}

// threshold lowered from 0.85 (near-duplicate territory) to 0.72 so a new memory links
// to RELATED older ones across time — e.g. "a new fear of repossession" reaches an old
// "repossession" memory even when the wording differs. The LLM/keyword `validateLink`
// gate downstream still filters out superficial matches, and maxLinks caps hub sprawl.
// maxLinks lowered 5 → 3: a higher bar for what Soumaya draws on her own, so the galaxy
// grows FEWER, surer connections per memory instead of over-linking. The neighbours she
// now holds back (over the cap, or that the validate gate wasn't sure about) aren't lost —
// they're routed to the review queue (candidate_links) for YOU to connect or dismiss.
export const DEFAULT_LINK_OPTIONS: AssociativeLinkOptions = { threshold: 0.72, k: 12, maxLinks: 3 };

/**
 * D4: max concurrent `validateLink` calls within one node's linking job.
 * Combined with pipeline.ts's max 2 concurrent `associativeLink` jobs, the
 * aggregate in-flight bound is 2 × 3 = 6 — structural (fixed worker counts),
 * not timing-based.
 */
const VALIDATE_CONCURRENCY = 3;
/**
 * D4: per-call timeout. The controller's signal is threaded through
 * `validateLink` into the actual provider operation (Gemini: `GenerateContentConfig.abortSignal`;
 * OpenAI: fetch `signal`), so aborting tears down the underlying transport —
 * the timeout genuinely stops the work instead of just rejecting a wrapper.
 */
const VALIDATE_TIMEOUT_MS = 30_000;

/**
 * D4: run jobs with at most `limit` in flight, preserving result order. The
 * bound is structural — a fixed worker count — so it holds regardless of
 * completion order or timing.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  // The `next++` below runs with no await between the loop check and the
  // increment, so workers can never claim the same index.
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(
      (async () => {
        while (next < items.length) {
          const i = next++;
          results[i] = await fn(items[i]!, i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

/**
 * The autonomous "dot-connecting" step: for a freshly stored node, find its
 * nearest semantic neighbours, then ask the LLM to validate each into a typed
 * edge. Emulates associative memory — connecting new thoughts to forgotten ones.
 *
 * D4 concurrency model: `validateLink` calls run with concurrency cap 3
 * (VALIDATE_CONCURRENCY), guarded by synchronous slot reservation —
 * `reserved` is incremented in the same tick as the `regularLinks + reserved
 * >= cap` check, before the validation promise is dispatched. JS
 * run-to-completion semantics make this race-free: no microtask can interleave
 * the synchronous dispatch loop, so the cap holds under any completion order.
 * Each slot is released exactly once, in a `finally` on its own validation
 * promise (success / negative / timeout / throw uniformly).
 */
export async function associativeLink(
  h: DbHandle,
  deps: { nodes: NodesRepo; edges: EdgesRepo; llm: LlmProvider },
  newNode: GraphNode,
  embedding: Float32Array,
  options: AssociativeLinkOptions = DEFAULT_LINK_OPTIONS,
  spaceId: string = DEFAULT_SPACE,
): Promise<GraphEdge[]> {
  // k+1 because the node itself is its own nearest neighbour. Strongest matches
  // first so that, when capped, we keep the most meaningful connections. KNN is
  // scoped to this space so we never link across users' brains.
  const hits = knn(h.sqlite, embedding, options.k + 1, spaceId)
    .filter((hit) => hit.nodeId !== newNode.id && hit.similarity >= options.threshold)
    .sort((a, b) => b.similarity - a.similarity);

  const cap = options.maxLinks ?? DEFAULT_LINK_OPTIONS.maxLinks ?? Infinity;
  const timeoutMs = options.validateTimeoutMs ?? VALIDATE_TIMEOUT_MS;
  const created: GraphEdge[] = [];
  let regularLinks = 0; // only peer-to-peer links count toward the cap
  let reserved = 0; // in-flight validations holding a cap slot

  type Candidate = { hit: (typeof hits)[number]; target: GraphNode };

  // Phase 1 (synchronous): pre-filter candidates. Every skip that doesn't need
  // the LLM gate — dedupe, constellation fast-path, kind gating.
  const candidates: Candidate[] = [];
  for (const hit of hits) {
    if (deps.edges.exists(newNode.id, hit.nodeId)) continue;
    const target = deps.nodes.getById(hit.nodeId);
    if (!target) continue;

    // Constellation membership: a strong match to an existing MOC hub means this new
    // memory belongs in that constellation — add it directly (a `summarizes` edge), no
    // LLM gate and no cap. This is how a constellation grows with related new memories.
    if (target.kind === "moc") {
      created.push(
        deps.edges.create({
          source: target.id,
          target: newNode.id,
          relationship: "summarizes",
          weight: hit.similarity,
        }),
      );
      continue;
    }

    // Associative linking is memory↔memory ONLY. Cognitive anchors (goals/skills/people/
    // identities/…) and consolidated beliefs have their OWN dedicated linking passes
    // (cognitive gravity, dream cycles) — linking them here too just double-links and
    // inflates their degree past the anchor cap. Skip any non-memory target.
    if (target.kind != null && target.kind !== "memory") continue;

    candidates.push({ hit, target });
  }

  // Phase 2 (synchronous): reserve cap slots. Check + reserve in the same tick,
  // no await anywhere in this loop — race-free by run-to-completion.
  const jobs: Array<() => Promise<void>> = [];
  for (const c of candidates) {
    if (regularLinks + reserved >= cap) {
      // Strong enough to consider, but past the per-memory cap → offer it for review
      // rather than either over-linking or silently forgetting it.
      recordCandidate(h, spaceId, newNode.id, c.hit.nodeId, "A related memory beyond the auto-connect limit", c.hit.similarity, "withheld");
      continue;
    }
    reserved++;
    jobs.push(() => validateOne(c));
  }

  // Phase 3: run the reserved validations, at most VALIDATE_CONCURRENCY in flight.
  await mapWithConcurrency(jobs, VALIDATE_CONCURRENCY, (job) => job());

  return created;

  async function validateOne(c: Candidate): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let accepted = false;
    try {
      const decision = await deps.llm.validateLink(
        { label: newNode.label, content: newNode.content },
        { label: c.target.label, content: c.target.content },
        c.hit.similarity,
        { signal: controller.signal },
      );
      if (decision.linked) {
        // Reservation→acceptance transition as ONE synchronous block: no await
        // between the statements, so no concurrent completion can observe an
        // intermediate state where the slot is released but the link isn't
        // counted yet. (better-sqlite3 calls are synchronous; no interleaving.)
        reserved--;
        regularLinks++;
        created.push(
          deps.edges.create({
            source: newNode.id,
            target: c.hit.nodeId,
            relationship: decision.relationship ?? "relates_to",
            weight: decision.weight ?? c.hit.similarity,
          }),
        );
        accepted = true;
      } else {
        // The gate wasn't confident — don't draw it, but surface it so YOU can decide.
        recordCandidate(h, spaceId, newNode.id, c.hit.nodeId, "Soumaya wasn't sure these connect — your call", c.hit.similarity, "withheld");
      }
    } catch (err) {
      // Timeout, abort, or provider throw: treated as not-linked, logged, and
      // the ingest continues — one bad call never aborts the ingest or loses
      // the memory. Surfaced for review so the pair isn't silently forgotten.
      console.warn(
        `[associativeLink] validateLink failed for ${newNode.id}→${c.hit.nodeId}: ${err instanceof Error ? err.message : err}`,
      );
      recordCandidate(h, spaceId, newNode.id, c.hit.nodeId, "Link check failed — your call", c.hit.similarity, "withheld");
    } finally {
      clearTimeout(timer);
      // Release exactly once per validation promise: the positive path already
      // released + counted in its transition block above.
      if (!accepted) reserved--;
    }
  }
}
