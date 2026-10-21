import type { AppContext } from "../context.js";
import type { GraphNode } from "@brain/shared";
import { promoteConstellation } from "./constellations.js";

/**
 * Living Galaxy (IM-140): "identity changes create entirely new
 * constellations." When an identity is created or edited, the memories that
 * support it (real `supports` edges into the identity node, formed by the
 * cognitive linker from the user's own words) become a constellation —
 * reusing the existing constellation machinery (`promoteConstellation`,
 * the same path the manual + auto-proposal flows use), never a parallel
 * system.
 *
 * Guards so this stays honest and non-spammy:
 *  - at least MIN_IDENTITY_CONSTELLATION_MEMBERS supporting memories —
 *    a constellation of one or two stars is not a constellation;
 *  - if an existing hub already summarizes at least half of those members,
 *    the constellation already exists — form nothing (idempotent across
 *    repeated identity edits).
 */
export const MIN_IDENTITY_CONSTELLATION_MEMBERS = 3;

/** Pure overlap test: does an existing hub already cover this member set? */
export function alreadyConstellated(memberIds: number[], hubbedMemberIds: ReadonlySet<number>): boolean {
  if (memberIds.length === 0) return false;
  const covered = memberIds.filter((id) => hubbedMemberIds.has(id)).length;
  return covered >= memberIds.length / 2;
}

export async function formIdentityConstellation(
  ctx: AppContext,
  spaceId: string,
  identityId: number,
): Promise<GraphNode | null> {
  const s = ctx.handle.sqlite;
  const identity = s
    .prepare(`SELECT label, kind FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
    .get(identityId, spaceId) as { label: string; kind: string | null } | undefined;
  if (!identity || identity.kind !== "identity") return null;

  const memberIds = (
    s
      .prepare(
        `SELECT e.source AS id FROM edges e JOIN nodes m ON m.id = e.source AND m.space_id = e.space_id
          WHERE e.space_id = ? AND e.target = ? AND e.relationship = 'supports'
            AND m.deleted_at IS NULL AND (m.kind IS NULL OR m.kind = 'memory')`,
      )
      .all(spaceId, identityId) as { id: number }[]
  ).map((r) => r.id);
  if (memberIds.length < MIN_IDENTITY_CONSTELLATION_MEMBERS) return null;

  const hubbed = new Set(
    (
      s
        .prepare(
          `SELECT e.target AS id FROM edges e JOIN nodes h ON h.id = e.source AND h.space_id = e.space_id
            WHERE e.space_id = ? AND e.relationship = 'summarizes' AND h.kind = 'moc' AND h.deleted_at IS NULL`,
        )
        .all(spaceId) as { id: number }[]
    ).map((r) => r.id),
  );
  if (alreadyConstellated(memberIds, hubbed)) return null;

  return promoteConstellation(ctx, spaceId, identity.label, memberIds);
}
