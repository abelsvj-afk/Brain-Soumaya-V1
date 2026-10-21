import type { GraphNode, ProvenanceRef, EpistemicStatus } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { parseTolerantMs } from "../lib/time.js";
import { buildEvolutionLinksAmong, DEFAULT_TEMPORAL } from "./temporalChains.js";
import { resolveSupersession, type SupersessionKind } from "./supersession.js";
import { spaceTimezone } from "../agent/notify/policy.js";
/** The space's timezone for user-facing date labels (owner rule 2026-10-21). */
const spaceTz = (handle: DbHandle, spaceId: string): string => spaceTimezone(handle.sqlite, spaceId);


/**
 * Maya Longitudinal Intelligence, Phase C (docs/specs/maya-longitudinal-intelligence.md,
 * Section 9) — "entity → timeline → state transitions" as a reusable READ-TIME function, not a
 * new persistence layer (Section 6 already ruled that out). Built entirely from data this
 * codebase already writes: `linkCognitiveAnchor`'s `"supports"` edges, `synthesis/
 * contradictions.ts`'s `insights` rows, `analysis/temporalChains.ts`'s evolution links,
 * `analysis/clarificationResolution.ts`'s `"resolves"` edges, and Phase B's
 * `resolveSupersession`. No new table, no new relationship type, no per-entity-kind business
 * logic — the exact same function reconstructs a vehicle's, a job's, a goal's, or a person's
 * history, because it only ever asks "what's linked to this anchor" and "in what order did it
 * happen," both already-general questions.
 */

/** One state-relevant event about an anchor entity, ordered chronologically. `source` is a
 *  pointer back to the real row — never a copy, never a second source of truth. `statement` is
 *  the memory's own text (truncated for display, same `CONTENT_PREVIEW_LEN` convention
 *  `analysis/galaxyEntity.ts` already uses). `status` is the EXISTING epistemic vocabulary,
 *  never a new one — see the status-assignment rules in `reconstructEntityTimeline`'s own
 *  comment below for exactly which existing detector each value comes from. */
export interface EntityStateEvent {
  at: string;
  source: ProvenanceRef;
  statement: string;
  status: EpistemicStatus;
}

const CONTENT_PREVIEW_LEN = 140; // matches analysis/galaxyEntity.ts's resolveNode preview length

/**
 * Bounds, each independently small and explicit — no step here can grow with total memory
 * count in the space, only with how much is ACTUALLY connected to this one anchor:
 *  - supporters: already capped at write time (`analysis/cognitive.ts`'s `MAX_ANCHOR_LINKS`,
 *    12) — this read can never see more than that regardless of how this function is called.
 *  - MAX_RELATED_CONTRADICTIONS / MAX_RELATED_CONTINUITY: new, small, explicit caps on how many
 *    contradiction insights / evolution links touching the working set get pulled in — the same
 *    "cap the caller of a caller" discipline `analysis/causal.ts`'s `MAX_CAUSAL_LINKS` and
 *    `analysis/galaxyEntity.ts`'s `MAX_CANDIDATES_PER_KIND` already established.
 *  - MAX_TIMELINE_NODES: the hard ceiling on the final, hydrated node set — generous relative to
 *    the sum of the caps above, so it only ever trims a genuinely unusual case, never silently
 *    reduces the common one.
 */
const MAX_RELATED_CONTRADICTIONS = 5;
const MAX_RELATED_CONTINUITY = 5;
const MAX_TIMELINE_NODES = 25;

interface RelatedPair {
  a: number;
  b: number;
  kind: SupersessionKind;
}

/** Only the two statuses `resolveSupersession` can ever produce, ranked so multiple pairs
 *  touching the same node combine deterministically (a genuine conflict outranks mere
 *  staleness) — same ranking reasoning `analysis/intelligence.ts`'s own precedence comments use,
 *  not a new idea, just applied here to merge multiple pair results into one status per node. */
const STATUS_RANK: Partial<Record<EpistemicStatus, number>> = { fact: 0, confirmed: 1, outdated: 2, contradicted: 3 };

function upgradeStatus(map: Map<number, EpistemicStatus>, id: number, status: EpistemicStatus): void {
  const current = map.get(id);
  if (!current || (STATUS_RANK[status] ?? 0) > (STATUS_RANK[current] ?? 0)) map.set(id, status);
}

function placeholders(ids: number[]): string {
  return ids.map(() => "?").join(",");
}

/**
 * Reconstruct an anchor entity's history as an ordered timeline of state-relevant events.
 *
 * `anchor` MUST be server-resolved and space-scoped — never an LLM-supplied id, same trust
 * boundary Chat → Galaxy Navigation and Phase B's evidence already enforce. Deliberately scoped
 * to `{ domain: "memory", kind: "node" }` refs: every evidence mechanism this function reuses
 * (`"supports"`/`"resolves"` edges, contradiction insights, evolution links) is keyed on
 * `nodes` ids — extending this to money/journey anchors would need those domains' own
 * before/after relationship data, which doesn't exist yet (flagged, not built, per the brief's
 * "adapt to the real repository" instruction rather than force-fitting the sketch's generic
 * `ProvenanceRef` to domains with no timeline evidence behind them). A non-memory or
 * nonexistent/out-of-space anchor returns `[]` — the same "insufficient evidence → silence"
 * discipline this module's dependencies already use, never a thrown error for an ordinary
 * "nothing to reconstruct" case.
 *
 * Status assignment (never promotes anything to `"confirmed"` except via an ACTUAL clarification
 * resolution, never invents a status beyond these four):
 *  - `"fact"` — the default for any node's own text (`EpistemicStatus`'s own doc: "a memory's
 *    own text" is a `"fact"`-eligible source).
 *  - `"confirmed"` — the node is the SOURCE of a `"resolves"` edge, which only
 *    `analysis/clarificationResolution.ts` ever creates — i.e. this exact memory is the real
 *    knowledge node a user's clarification answer produced.
 *  - `"outdated"` / `"contradicted"` — Phase B's `resolveSupersession`, called for every
 *    contradiction-insight pair and evolution-link pair touching the working set; applied to
 *    whichever side it names `superseded`. Reuses Phase B verbatim — no second supersession
 *    algorithm, no expanded contradiction semantics.
 *
 * The older side of a resolved pair is NEVER rewritten or removed — it keeps its own event, just
 * with a stronger status label. When `resolveSupersession` can't confidently establish direction
 * (insufficient evidence), the pair is silently skipped and both sides keep their baseline
 * status — never promoted, never guessed.
 */
export function reconstructEntityTimeline(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  anchor: ProvenanceRef,
  now: Date = new Date(),
): EntityStateEvent[] {
  if (anchor.domain !== "memory" || anchor.kind !== "node") return [];
  const nodesRepo = new NodesRepo(handle, spaceId);
  const anchorNode = nodesRepo.getById(anchor.id);
  if (!anchorNode) return [];

  const s = handle.sqlite;
  const ids = new Set<number>([anchorNode.id]);
  const pairs: RelatedPair[] = [];

  // 1) Memories linkCognitiveAnchor() has already gathered under this anchor via "supports"
  //    edges — bounded by construction at write time (MAX_ANCHOR_LINKS = 12), so this read
  //    can never scale with total memory count.
  const supporterRows = s
    .prepare(`SELECT source FROM edges WHERE space_id = ? AND target = ? AND relationship = 'supports'`)
    .all(spaceId, anchorNode.id) as { source: number }[];
  for (const r of supporterRows) ids.add(r.source);

  // 2) Contradiction insights touching the anchor or its supporters (the same-topic conflicts
  //    synthesis/contradictions.ts already detected and persisted) — capped, ordered newest
  //    first like every other bounded scan in this module family.
  const seedForContradiction = [...ids];
  const contraRows = s
    .prepare(
      `SELECT node_a AS a, node_b AS b FROM insights
       WHERE space_id = ? AND kind = 'contradiction'
         AND (node_a IN (${placeholders(seedForContradiction)}) OR node_b IN (${placeholders(seedForContradiction)}))
       ORDER BY id DESC LIMIT ?`,
    )
    .all(spaceId, ...seedForContradiction, ...seedForContradiction, MAX_RELATED_CONTRADICTIONS) as { a: number; b: number }[];
  for (const r of contraRows) {
    ids.add(r.a);
    ids.add(r.b);
    pairs.push({ a: r.a, b: r.b, kind: "contradiction" });
  }

  // 3) Evolution links (Phase A's bounded entry point, reused verbatim — no second scan) over
  //    the working set built so far, so a same-theme pair touching a contradiction-discovered
  //    node is found too, not just ones touching the anchor/supporters directly.
  const seedForContinuity = [...ids];
  const evolutionLinks = buildEvolutionLinksAmong(handle, spaceId, seedForContinuity, {
    ...DEFAULT_TEMPORAL,
    maxLinks: MAX_RELATED_CONTINUITY,
  });
  for (const l of evolutionLinks) {
    ids.add(l.fromId);
    ids.add(l.toId);
    pairs.push({ a: l.fromId, b: l.toId, kind: "continuity" });
  }

  // 4) "resolves" edges targeting anyone in the working set so far — the ONLY relationship
  //    clarificationResolution.ts ever creates, so a node found here is, by construction, the
  //    real knowledge node a user's clarification answer produced.
  const seedForResolves = [...ids];
  const resolvesRows = s
    .prepare(
      `SELECT DISTINCT source FROM edges
       WHERE space_id = ? AND relationship = 'resolves' AND target IN (${placeholders(seedForResolves)})`,
    )
    .all(spaceId, ...seedForResolves) as { source: number }[];
  const confirmedIds = new Set<number>();
  for (const r of resolvesRows) {
    ids.add(r.source);
    confirmedIds.add(r.source);
  }

  const boundedIds = [...ids].slice(0, MAX_TIMELINE_NODES);
  const nodes = nodesRepo.byIds(boundedIds); // silently drops dangling/deleted/out-of-space ids
  const nodeMap = new Map<number, GraphNode>(nodes.map((n) => [n.id, n]));

  const statusOverride = new Map<number, EpistemicStatus>();
  for (const pair of pairs) {
    const a = nodeMap.get(pair.a);
    const b = nodeMap.get(pair.b);
    if (!a || !b) continue; // one side fell outside the bounded/hydrated set — skip, don't guess
    const result = resolveSupersession(a, b, pair.kind, spaceTz(handle, spaceId));
    if (!result) continue; // insufficient evidence — baseline status stands, never promoted
    upgradeStatus(statusOverride, result.superseded.id, result.status);
  }

  return nodes
    .map((n) => ({ n, at: n.occurredAt ?? n.createdAt, ms: parseTolerantMs(n.occurredAt ?? n.createdAt) }))
    .filter((e) => Number.isFinite(e.ms))
    .sort((x, y) => x.ms - y.ms || x.n.id - y.n.id)
    .map(({ n, at }): EntityStateEvent => {
      let status: EpistemicStatus = confirmedIds.has(n.id) ? "confirmed" : "fact";
      const override = statusOverride.get(n.id);
      if (override && (STATUS_RANK[override] ?? 0) > (STATUS_RANK[status] ?? 0)) status = override;
      const statement = n.content.length > CONTENT_PREVIEW_LEN ? `${n.content.slice(0, CONTENT_PREVIEW_LEN - 3)}...` : n.content;
      return {
        at,
        source: { domain: "memory", kind: "node", id: n.id, label: n.label },
        statement,
        status,
      };
    });
}
