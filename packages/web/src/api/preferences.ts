import { API, afetch } from "./http.js";

/**
 * Space preferences + graph export client calls (IM-129) — the backing for
 * Settings' "Your time & notifications" and "Your data" sections.
 *
 * The preferences live server-side in space_meta and are read by the
 * notification policy boundary (quiet hours / digest time / daily proactive
 * cap genuinely gate when Soumaya may reach out) and by every space-local-day
 * computation (the timezone). There is exactly ONE store: these calls read and
 * write it through /api/space/preferences — no local mirror that could drift.
 */
export interface SpacePreferences {
  timezone: string;
  quietStart: string;
  quietEnd: string;
  digestTime: string;
  dailyProactiveCap: number;
}

export async function getSpacePreferences(): Promise<SpacePreferences | null> {
  try {
    const res = await afetch(`${API}/space/preferences`);
    if (!res.ok) return null;
    return (await res.json()) as SpacePreferences;
  } catch {
    return null;
  }
}

/** Throws with the server's message on rejection (e.g. an invalid timezone),
 *  so the caller can roll its UI back and say why — never a silent no-op. */
export async function updateSpacePreferences(patch: Partial<SpacePreferences>): Promise<SpacePreferences> {
  const res = await afetch(`${API}/space/preferences`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const d = (await res.json().catch(() => null)) as (SpacePreferences & { error?: string }) | null;
  if (!res.ok) throw new Error(d?.error ?? `Couldn't save preferences (${res.status})`);
  return d as SpacePreferences;
}

export interface GraphExport {
  exportedAt: string;
  spaceId: string;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

/** This brain's whole graph as JSON (server endpoint added by IM-129c; the
 *  Markdown export in Browse remains the human-readable alternative). */
export async function getGraphExport(): Promise<GraphExport> {
  const res = await afetch(`${API}/graph/export`);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return (await res.json()) as GraphExport;
}
