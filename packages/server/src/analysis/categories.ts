import type { AppContext } from "../context.js";
import { DEFAULT_SPACE } from "../db/schema.js";

/**
 * Galaxy Views categories, counted from the FULL node set (Batch H, REG-207 /
 * CN-08). The Views chips used to be computed from the loaded graph payload
 * (`nodes` prop, top-300 by degree), so a category whose members all sat
 * off-payload vanished from Views entirely — while the overlay layers beside
 * it counted from direct full-set fetches. These counts come from the same
 * population the payload itself draws from, so a chip never disappears for a
 * category that has members.
 *
 * Population (mirrors GraphService.overview + NodesRepo.byIds exactly):
 * this space, not deleted, not superseded, kind != 'action'. Archived rows
 * are NOT excluded — the payload doesn't exclude them either (byIds drops
 * only deleted/superseded). The per-key predicates mirror GalaxyViews' VIEWS
 * table one-for-one; if that table changes, this file must change with it.
 */
export const CATEGORY_KEYS = [
  "people",
  "projects",
  "goals",
  "ideas",
  "beliefs",
  "knowledge",
  "meetings",
  "notes",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

const CATEGORY_PREDICATES: Record<CategoryKey, string> = {
  people: `n.type = 'person'`,
  projects: `n.type IN ('project', 'company')`,
  goals: `n.kind = 'goal'`,
  ideas: `n.kind = 'idea'`,
  beliefs: `n.kind = 'belief'`,
  knowledge: `n.type IN ('knowledge', 'concept')`,
  meetings: `n.type = 'meeting'`,
  notes: `n.type = 'daily'`,
};

const BASE_WHERE = `n.space_id = ? AND n.deleted_at IS NULL AND n.superseded_at IS NULL AND (n.kind IS NULL OR n.kind != 'action')`;

function assertKey(key: string): CategoryKey {
  if ((CATEGORY_KEYS as readonly string[]).includes(key)) return key as CategoryKey;
  throw new Error(`unknown category: ${key}`);
}

/** Full-set member count per category (0 for categories with no members). */
export function categoryCounts(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
): Record<CategoryKey, number> {
  const out = {} as Record<CategoryKey, number>;
  for (const key of CATEGORY_KEYS) {
    const row = ctx.handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes n WHERE ${BASE_WHERE} AND ${CATEGORY_PREDICATES[key]}`)
      .get(spaceId) as { c: number };
    out[key] = row.c;
  }
  return out;
}

/** Full-set member ids for one category (what a tap isolates to). */
export function categoryIds(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
  key: CategoryKey,
): number[] {
  const k = assertKey(key);
  const rows = ctx.handle.sqlite
    .prepare(`SELECT n.id AS id FROM nodes n WHERE ${BASE_WHERE} AND ${CATEGORY_PREDICATES[k]} ORDER BY n.id DESC`)
    .all(spaceId) as { id: number }[];
  return rows.map((r) => r.id);
}
