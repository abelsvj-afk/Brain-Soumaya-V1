import { API, afetch } from "./http.js";

/**
 * Galaxy Views category counts (Batch H, REG-207 / CN-08) — full-set member
 * counts + id lists per Views category, from `GET /api/graph/categories`.
 * The chips used to count from the loaded top-300 payload, so a category
 * whose members all sat off-payload vanished from Views; these come from the
 * whole node set, so a category with members is always present.
 */
export type CategoryKey =
  | "people"
  | "projects"
  | "goals"
  | "ideas"
  | "beliefs"
  | "knowledge"
  | "meetings"
  | "notes";

export type CategoryCounts = Record<CategoryKey, number>;

export async function getCategoryCounts(): Promise<CategoryCounts | null> {
  try {
    const res = await afetch(`${API}/graph/categories`);
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { counts?: CategoryCounts };
    return d.counts ?? null;
  } catch {
    return null;
  }
}

export async function getCategoryIds(key: CategoryKey): Promise<number[] | null> {
  try {
    const res = await afetch(`${API}/graph/categories/${encodeURIComponent(key)}/ids`);
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { ids?: number[] };
    return Array.isArray(d.ids) ? d.ids : null;
  } catch {
    return null;
  }
}
