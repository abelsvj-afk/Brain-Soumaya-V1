import type { SelfReviewItem } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";

/**
 * Soumaya's coverage self-check (research-agent add-on #12) — a SAFE, read-only
 * interpretation. Rather than silently re-weighting her own logic (unstable +
 * token-hungry), she reports what she may be missing so YOU stay in control:
 * drifting memories, important blind spots, cooling neglect, and unreconciled
 * contradictions. Pure SQL, offline, no token cost.
 */

const countOf = (h: DbHandle, sql: string, ...params: unknown[]): number =>
  (h.sqlite.prepare(sql).get(...params) as { c: number }).c;

export function buildSelfReview(h: DbHandle, spaceId: string = DEFAULT_SPACE): SelfReviewItem[] {
  const items: SelfReviewItem[] = [];

  // Drifting: real memories with no edges at all.
  const drifting = countOf(
    h,
    `SELECT COUNT(*) c FROM nodes n
     WHERE n.space_id = ? AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind NOT IN ('action','moc'))
     AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id))`,
    spaceId,
  );
  if (drifting > 0) {
    items.push({
      title: "Drifting memories",
      detail: `${drifting} ${drifting === 1 ? "memory has" : "memories have"} no connections yet — I'll link them as related thoughts arrive, or you can connect them by hand.`,
      count: drifting,
    });
  }

  // Important blind spots: matters to you, under-connected, not yet deep-dived.
  const blindSpots = countOf(
    h,
    `SELECT COUNT(*) c FROM nodes n
     LEFT JOIN (
       SELECT node_id, COUNT(*) deg FROM (
         SELECT source node_id FROM edges WHERE space_id = ?
         UNION ALL SELECT target node_id FROM edges WHERE space_id = ?
       ) GROUP BY node_id
     ) d ON d.node_id = n.id
     WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.importance >= 0.6
     AND COALESCE(d.deg, 0) <= 1 AND n.content NOT LIKE '%--- Research Deep Dive ---%'`,
    spaceId,
    spaceId,
    spaceId,
  );
  if (blindSpots > 0) {
    items.push({
      title: "Important blind spots",
      detail: `${blindSpots} important ${blindSpots === 1 ? "memory is" : "memories are"} thinly documented and under-connected — strong candidates for Research Mode research (the paid research that expands the memory itself, not the Investigator's free deep-dive in Details).`,
      count: blindSpots,
    });
  }

  // Cooling from neglect.
  const cooling = countOf(
    h,
    `SELECT COUNT(*) c FROM nodes
     WHERE space_id = ? AND deleted_at IS NULL AND last_tended_at IS NOT NULL
     AND julianday('now') - julianday(last_tended_at) > 14`,
    spaceId,
  );
  if (cooling > 0) {
    items.push({
      title: "Cooling from neglect",
      detail: `${cooling} ${cooling === 1 ? "memory is" : "memories are"} cooling — a quick visit warms them back up.`,
      count: cooling,
    });
  }

  // Contradictions awaiting reconciliation.
  const conflicts = countOf(
    h,
    `SELECT COUNT(*) c FROM insights WHERE space_id = ? AND kind = 'contradiction'`,
    spaceId,
  );
  if (conflicts > 0) {
    items.push({
      title: "Contradictions to reconcile",
      detail: `${conflicts} ${conflicts === 1 ? "contradiction" : "contradictions"} surfaced between your memories — worth a look to reconcile or notice you've grown.`,
      count: conflicts,
    });
  }

  return items;
}
