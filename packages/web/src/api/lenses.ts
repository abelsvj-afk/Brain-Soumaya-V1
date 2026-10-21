import { API, afetch } from "./http.js";
import type { Lens, LensQuery } from "@brain/shared";

/**
 * Smart Lenses client — saved queries the galaxy renders as live constellations.
 * Thin wrappers over /api/lenses; all space-scoped server-side via the x-space-id header.
 */

export async function getLenses(): Promise<Lens[]> {
  try {
    const res = await afetch(`${API}/lenses`);
    return (await res.json().catch(() => [])) as Lens[];
  } catch {
    return [];
  }
}

export async function createLens(name: string, query: LensQuery, pinned = false): Promise<Lens | null> {
  try {
    const res = await afetch(`${API}/lenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, query, pinned }),
    });
    if (!res.ok) return null;
    return (await res.json()) as Lens;
  } catch {
    return null;
  }
}

export async function updateLens(id: number, patch: { name?: string; query?: LensQuery; pinned?: boolean }): Promise<Lens | null> {
  try {
    const res = await afetch(`${API}/lenses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    return (await res.json()) as Lens;
  } catch {
    return null;
  }
}

export async function deleteLens(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/lenses/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** IM-118: live match count for an UNSAVED query (the builder's preview).
 *  Returns null on failure so the UI can say "couldn't count" honestly. */
export async function previewLens(query: LensQuery): Promise<number | null> {
  try {
    const res = await afetch(`${API}/lenses/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { count?: number };
    return typeof d.count === "number" ? d.count : null;
  } catch {
    return null;
  }
}

/** Evaluate a lens → the node ids the galaxy should isolate to. */
export async function lensNodes(id: number): Promise<number[]> {
  try {
    const res = await afetch(`${API}/lenses/${id}/nodes`);
    const d = (await res.json().catch(() => ({}))) as { ids?: number[] };
    return d.ids ?? [];
  } catch {
    return [];
  }
}
