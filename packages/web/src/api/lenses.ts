import { API, afetch } from "./http.js";
import type { Lens, LensQuery } from "@brain/shared";

/**
 * Smart Lenses client — saved queries the galaxy renders as live constellations.
 * Thin wrappers over /api/lenses; all space-scoped server-side via the x-space-id header.
 *
 * Batch H (REG-205/206 / CN-06/07): failures are DISTINGUISHABLE from empty.
 * `getLenses` and `lensNodes` THROW on failure (like `getCandidates` in
 * api/mind.ts) instead of failing soft to `[]` — a dead server used to render
 * as "No lenses yet" / "has no matches". Callers render an error/retry state.
 *
 * Batch H (REG-208 / CN-09): evaluations carry the true total + cap flags.
 * `lensNodes` and `previewLens` return the full evaluation, not a bare count.
 *
 * Batch H (REG-209 / CN-10): the Lenscrafter counter increments ONLY when a
 * lens is created — once per lens, on every creation door — and never on edit.
 * The increment lives here, inside `createLens`, so the panel door, the Views
 * door, and any future door all count the same way; `recordLensCreated` is the
 * one shared increment (the inquiry-confirm door in api/mind.ts calls it too).
 */

export interface LensEvaluation {
  ids: number[];
  total: number;
  capped: boolean;
  totalIsLowerBound: boolean;
  shown: number;
}

export interface LensPreview {
  count: number;
  capped: boolean;
  totalIsLowerBound: boolean;
  shown: number;
}

/** One shared Lenscrafter increment — creation only, once per lens. */
export function recordLensCreated(): void {
  try {
    const sid = localStorage.getItem("brain.spaceId") || "default";
    const k = `stat.lenses_made.${sid}`;
    localStorage.setItem(k, String((parseInt(localStorage.getItem(k) || "0", 10) || 0) + 1));
  } catch {
    /* ignore */
  }
}

export async function getLenses(): Promise<Lens[]> {
  const res = await afetch(`${API}/lenses`);
  if (!res.ok) throw new Error(`lenses fetch failed (${res.status})`);
  const d = await res.json().catch(() => null);
  if (!Array.isArray(d)) throw new Error("lenses fetch returned a malformed payload");
  return d as Lens[];
}

export async function createLens(name: string, query: LensQuery, pinned = false): Promise<Lens | null> {
  try {
    const res = await afetch(`${API}/lenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, query, pinned }),
    });
    if (!res.ok) return null;
    const lens = (await res.json()) as Lens;
    // New lenses start UNPINNED on every door (Batch H, REG-211 / CN-12) —
    // pinning is a deliberate 📍 tap, not a creation side effect — and the
    // creation itself is what counts toward Lenscrafter (REG-209).
    recordLensCreated();
    return lens;
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
 *  Returns null on failure so the UI can say "couldn't count" honestly.
 *  Batch H (REG-208): the full evaluation — true total + cap flags + shown. */
export async function previewLens(query: LensQuery): Promise<LensPreview | null> {
  try {
    const res = await afetch(`${API}/lenses/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as Partial<LensPreview>;
    return typeof d.count === "number"
      ? { count: d.count, capped: d.capped ?? false, totalIsLowerBound: d.totalIsLowerBound ?? false, shown: d.shown ?? d.count }
      : null;
  } catch {
    return null;
  }
}

/** Evaluate a lens → the node ids the galaxy should isolate to, with the true
 *  total + cap flags. Throws on failure so callers never read a failed fetch
 *  as "no matches" (Batch H, REG-206 / CN-07). */
export async function lensNodes(id: number): Promise<LensEvaluation> {
  const res = await afetch(`${API}/lenses/${id}/nodes`);
  if (!res.ok) {
    // A broken lens (422) is a failure to load, not an empty lens.
    throw new Error(`lens nodes fetch failed (${res.status})`);
  }
  const d = (await res.json().catch(() => ({}))) as Partial<LensEvaluation>;
  if (!Array.isArray(d.ids) || typeof d.total !== "number") {
    throw new Error("lens nodes fetch returned a malformed payload");
  }
  return {
    ids: d.ids,
    total: d.total,
    capped: d.capped ?? false,
    totalIsLowerBound: d.totalIsLowerBound ?? false,
    shown: d.shown ?? d.ids.length,
  };
}
