import type { DbHandle } from "../db/client.js";
import type { AppContext } from "../context.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { pruneAnchorLinks, trimAnchorLinks, NAME_ONLY_KINDS } from "./cognitive.js";
import { COGNITIVE_KINDS } from "@brain/shared";

/**
 * Candidate connections — the review queue that puts YOU in control of linking.
 * Instead of silently auto-connecting everything (or silently deleting weak links),
 * the borderline ones land here so you decide: connect it yourself, or dismiss it.
 *
 *  - "withheld" — Soumaya saw a possible link but it was below her (now higher) auto-
 *    connect bar, or beyond the per-memory cap. Suggested, not drawn.
 *  - "pruned"   — a weak existing link removed to declutter a dense galaxy. Restorable.
 *
 * Dismissing records a rejection (rejections.ts pattern) so it never comes back.
 */

function pair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function isRejectedPair(h: DbHandle, spaceId: string, a: number, b: number): boolean {
  const [x, y] = pair(a, b);
  return (
    h.sqlite.prepare(`SELECT 1 FROM link_rejections WHERE space_id = ? AND a = ? AND b = ?`).get(spaceId, x, y) !=
    null
  );
}

/**
 * Offer a pair for review (idempotent per pair). Skips pairs that are already linked,
 * already rejected, or self-referential — so the queue only ever holds real choices.
 */
export function recordCandidate(
  h: DbHandle,
  spaceId: string,
  a: number,
  b: number,
  reason: string,
  score: number,
  origin: "withheld" | "pruned" | "suggested" = "withheld",
): void {
  if (a === b) return;
  const [x, y] = pair(a, b);
  if (isRejectedPair(h, spaceId, x, y)) return;
  const edges = new EdgesRepo(h, spaceId);
  if (edges.exists(x, y) || edges.exists(y, x)) return;
  // Upsert (not INSERT OR IGNORE): if this pair was previously resolved (e.g. accepted,
  // then its edge got pruned), re-open it as pending so it can actually re-enter the
  // queue instead of silently staying resolved while its edge is gone.
  h.sqlite
    .prepare(
      `INSERT INTO candidate_links (space_id, a, b, reason, score, origin, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT(space_id, a, b) DO UPDATE SET
         status = 'pending', origin = excluded.origin, score = excluded.score, reason = excluded.reason`,
    )
    .run(spaceId, x, y, reason, score, origin);
}

export interface CandidateView {
  id: number;
  a: number;
  b: number;
  aLabel: string;
  bLabel: string;
  reason: string | null;
  score: number;
  origin: string;
  createdAt: string;
  /** IM-120 (additive): each memory's own content + creation date, so the
   *  triage panel can show a context preview without flying away per node. */
  aContent: string;
  bContent: string;
  aCreatedAt: string;
  bCreatedAt: string;
}

/** Pending candidates (strongest first), enriched with the two memory labels. */
export function listCandidates(h: DbHandle, spaceId: string = DEFAULT_SPACE, limit = 50): CandidateView[] {
  const rows = h.sqlite
    .prepare(
      `SELECT id, a, b, reason, score, origin, created_at AS createdAt
       FROM candidate_links WHERE space_id = ? AND status = 'pending'
       ORDER BY score DESC, id DESC LIMIT ?`,
    )
    .all(spaceId, limit) as Omit<CandidateView, "aLabel" | "bLabel">[];
  const nodes = new NodesRepo(h, spaceId);
  // Batched lookup instead of one getById() per row — listCandidates is on the hot path
  // for every load of the candidate-review UI and previously issued up to 2*limit
  // individual SELECTs.
  const byId = new Map(nodes.byIds([...new Set(rows.flatMap((r) => [r.a, r.b]))]).map((n) => [n.id, n]));
  const out: CandidateView[] = [];
  const drop = h.sqlite.prepare(`UPDATE candidate_links SET status = 'dismissed' WHERE id = ? AND space_id = ?`);
  for (const r of rows) {
    const na = byId.get(r.a);
    const nb = byId.get(r.b);
    if (!na || !nb) {
      drop.run(r.id, spaceId); // an endpoint was deleted → the suggestion is moot
      continue;
    }
    out.push({ ...r, aLabel: na.label, bLabel: nb.label, aContent: na.content, bContent: nb.content, aCreatedAt: na.createdAt, bCreatedAt: nb.createdAt });
  }
  return out;
}

/**
 * Undo a resolved candidate (IM-120): put it back to pending. For an ACCEPTED
 * candidate this also removes the `relates_to` edge the accept created (the
 * only edge accept creates); for a DISMISSED one it clears the recorded
 * rejection so the pair can be suggested/decided again. Returns false when
 * the candidate doesn't exist or is already pending.
 */
export function restoreCandidate(h: DbHandle, spaceId: string, id: number): boolean {
  const row = h.sqlite
    .prepare(`SELECT a, b, status FROM candidate_links WHERE id = ? AND space_id = ?`)
    .get(id, spaceId) as { a: number; b: number; status: string } | undefined;
  if (!row || row.status === "pending") return false;
  if (row.status === "accepted") {
    h.sqlite
      .prepare(
        `DELETE FROM edges WHERE space_id = ? AND relationship = 'relates_to'
         AND ((source = ? AND target = ?) OR (source = ? AND target = ?))`,
      )
      .run(spaceId, row.a, row.b, row.b, row.a);
  }
  if (row.status === "dismissed") {
    const [x, y] = pair(row.a, row.b);
    h.sqlite.prepare(`DELETE FROM link_rejections WHERE space_id = ? AND a = ? AND b = ?`).run(spaceId, x, y);
  }
  h.sqlite.prepare(`UPDATE candidate_links SET status = 'pending' WHERE id = ? AND space_id = ?`).run(id, spaceId);
  return true;
}

/** How many connections are waiting for review (drives the badge). */
export function countCandidates(h: DbHandle, spaceId: string = DEFAULT_SPACE): number {
  return (
    h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM candidate_links WHERE space_id = ? AND status = 'pending'`)
      .get(spaceId) as { n: number }
  ).n;
}

/** Accept a candidate → create the real edge, mark it accepted. Returns the pair. */
export function acceptCandidate(h: DbHandle, spaceId: string, id: number): { a: number; b: number } | null {
  const row = h.sqlite
    .prepare(`SELECT a, b, status FROM candidate_links WHERE id = ? AND space_id = ?`)
    .get(id, spaceId) as { a: number; b: number; status: string } | undefined;
  if (!row || row.status !== "pending") return null;
  const edges = new EdgesRepo(h, spaceId);
  if (!edges.exists(row.a, row.b) && !edges.exists(row.b, row.a)) {
    edges.create({ source: row.a, target: row.b, relationship: "relates_to", weight: 0.85 });
  }
  h.sqlite.prepare(`UPDATE candidate_links SET status = 'accepted' WHERE id = ? AND space_id = ?`).run(id, spaceId);
  return { a: row.a, b: row.b };
}

/** Dismiss a candidate → mark dismissed + record the rejection so it never returns. */
export function dismissCandidate(h: DbHandle, spaceId: string, id: number): boolean {
  const row = h.sqlite
    .prepare(`SELECT a, b FROM candidate_links WHERE id = ? AND space_id = ?`)
    .get(id, spaceId) as { a: number; b: number } | undefined;
  if (!row) return false;
  h.sqlite.prepare(`UPDATE candidate_links SET status = 'dismissed' WHERE id = ? AND space_id = ?`).run(id, spaceId);
  const [x, y] = pair(row.a, row.b);
  h.sqlite
    .prepare(`INSERT OR IGNORE INTO link_rejections (space_id, a, b) VALUES (?, ?, ?)`)
    .run(spaceId, x, y);
  return true;
}

/**
 * Manually connect two memories (no Soumaya required). Dedupes, and if the pair was a
 * pending candidate it's marked accepted. Returns the pair, or null if either id is
 * invalid / the same.
 */
export function manualLink(h: DbHandle, spaceId: string, a: number, b: number): { a: number; b: number } | null {
  if (a === b) return null;
  const nodes = new NodesRepo(h, spaceId);
  if (!nodes.getById(a) || !nodes.getById(b)) return null;
  const edges = new EdgesRepo(h, spaceId);
  if (!edges.exists(a, b) && !edges.exists(b, a)) {
    edges.create({ source: a, target: b, relationship: "relates_to", weight: 0.85 });
  }
  const [x, y] = pair(a, b);
  h.sqlite
    .prepare(`UPDATE candidate_links SET status = 'accepted' WHERE space_id = ? AND a = ? AND b = ? AND status = 'pending'`)
    .run(spaceId, x, y);
  return { a, b };
}

/**
 * Declutter a dense galaxy: move the WEAKEST associative links (low-weight `relates_to`
 * edges) out of the graph and into the review queue, so they're gone from the clutter
 * but never lost — you can restore any that mattered. Bounded per call; structural
 * edges (supports/summarizes/contradicts) are never touched.
 */
export function pruneWeakLinks(
  h: DbHandle,
  spaceId: string,
  opts: { maxWeight?: number; limit?: number } = {},
): { pruned: number } {
  const maxWeight = opts.maxWeight ?? 0.55;
  const limit = opts.limit ?? 400;
  // Memory↔memory only: never prune a link that touches a cognitive anchor / hub /
  // belief here (those have their own passes; re-accepting one would dodge the anchor cap).
  const rows = h.sqlite
    .prepare(
      `SELECT e.id, e.source, e.target, e.weight FROM edges e
         JOIN nodes ns ON ns.id = e.source
         JOIN nodes nt ON nt.id = e.target
       WHERE e.space_id = ? AND e.relationship = 'relates_to' AND e.weight < ?
         AND (ns.kind IS NULL OR ns.kind = 'memory')
         AND (nt.kind IS NULL OR nt.kind = 'memory')
       ORDER BY e.weight ASC LIMIT ?`,
    )
    .all(spaceId, maxWeight, limit) as { id: number; source: number; target: number; weight: number }[];
  const del = h.sqlite.prepare(`DELETE FROM edges WHERE id = ? AND space_id = ?`);
  let pruned = 0;
  for (const r of rows) {
    del.run(r.id, spaceId); // remove first so recordCandidate's "already linked" guard passes
    recordCandidate(h, spaceId, r.source, r.target, "A weak link Soumaya had drawn — restore it if it matters", r.weight, "pruned");
    pruned++;
  }
  return { pruned };
}

/**
 * The "Declutter" action. Two cleanups: (1) sever anchor (person/identity/goal/…)
 * supports-links whose memory doesn't actually name the anchor — with common-word
 * names no longer matching, this clears the bogus "20-30 connections to a person";
 * these are wrong, so they're removed + remembered as rejected, not queued. (2) thin
 * the weakest associative links into the review queue (restorable). Returns both counts.
 */
export function declutterGraph(ctx: AppContext, spaceId: string): { anchorPruned: number; weakPruned: number } {
  const h = ctx.handle;
  const anchors = h.sqlite
    .prepare(
      `SELECT id, kind FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND kind IN (${COGNITIVE_KINDS.map(() => "?").join(",")})`,
    )
    .all(spaceId, ...COGNITIVE_KINDS) as { id: number; kind: string }[];
  let anchorPruned = 0;
  for (const a of anchors) {
    if (NAME_ONLY_KINDS.has(a.kind)) {
      // People/identities: sever every link whose memory doesn't actually name them.
      anchorPruned += pruneAnchorLinks(ctx, spaceId, a.id);
    } else {
      // Goals/skills/…: keep them thematic but trim a runaway hub down to the cap.
      anchorPruned += trimAnchorLinks(ctx, spaceId, a.id);
    }
  }
  // Also thin the weakest memory-to-memory associative links into the review queue.
  const { pruned: weakPruned } = pruneWeakLinks(h, spaceId, { maxWeight: 0.75 });
  return { anchorPruned, weakPruned };
}
