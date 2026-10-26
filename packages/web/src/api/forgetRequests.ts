import { API, afetch } from "./http.js";

/**
 * Review surface for flagged forget rows (design note
 * `unresolved-flag-review-surface-design-2026-10-25.md` §2). Thin
 * wrappers over /api/forget-requests/unresolved — the quoting rows a
 * forget left in place by policy (stated user_model rows,
 * instruction_profiles rows), persisted as durable flags at apply
 * time. Fail-soft like the other domain clients: a failed read
 * returns null so the panel can say "couldn't reach the server"
 * instead of pretending there is nothing to review.
 *
 * Content-free by construction (design §2.1): the server serializes
 * only allow-listed fields. An instruction profile's name is never
 * sent — profiles render as "Instruction profile #id". A user_model
 * row renders its controlled-vocabulary descriptors only (slot,
 * origin, topic labels, confidence) — never its content.
 */

export interface UnresolvedFlagView {
  flagId: number;
  requestId: number;
  sourceId: number;
  table: "user_model" | "instruction_profiles";
  rowId: number;
  policyReason: string;
  status: "open" | "reviewed" | "resolved_deleted" | "dismissed";
  createdAt: string;
  reviewedAt: string | null;
  targetMissing: boolean;
  slot?: string;
  origin?: string;
  topicLabels?: string[];
  confidence?: number | null;
  validAt?: string | null;
  mode?: string;
  priority?: number;
  enabled?: boolean;
  profileCreatedAt?: string;
}

export interface UnresolvedFlagsList {
  open: UnresolvedFlagView[];
  reviewed: UnresolvedFlagView[];
  reviewedCount: number;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await afetch(`${API}/forget-requests${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function send<T>(path: string, method: string): Promise<T | null> {
  try {
    const res = await afetch(`${API}/forget-requests${path}`, { method });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const listUnresolvedFlags = () => getJson<UnresolvedFlagsList>("/unresolved");
export const reviewUnresolvedFlag = (flagId: number) =>
  send<UnresolvedFlagView>(`/unresolved/${flagId}/review`, "POST");
export const deleteUnresolvedFlagRow = (flagId: number) =>
  send<UnresolvedFlagView>(`/unresolved/${flagId}/delete`, "POST");
export const dismissUnresolvedFlag = (flagId: number) =>
  send<UnresolvedFlagView>(`/unresolved/${flagId}/dismiss`, "POST");
