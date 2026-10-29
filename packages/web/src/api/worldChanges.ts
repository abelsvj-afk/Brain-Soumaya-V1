import { API, afetch } from "./http.js";

/**
 * World-changes client (Phase 4, §17 M1/M6) — a thin binding over the
 * world-change rail's server contract. The server owns every outcome:
 * proposals, decisions, the append-only log, and the sweep. This module
 * transports requests and returns the server's views verbatim; it
 * computes nothing about what changed or why. Errors arrive from the
 * server in plain language and are surfaced as-is, with their code
 * preserved for UI logic.
 *
 * Both log doors read the same fetch (M6): the ApprovalsInbox decides
 * proposals, the WorldChangesView browses the log — never two records
 * that could disagree. After a decision or an undo lands, the client
 * announces it on `window` (`world-changes-applied` /
 * `world-changes-undone`, detail = the returned proposal) so the garden
 * scene — which never fetches — can play the landing or the
 * compensation. Same pattern as the journeys client's
 * `brain-journeys-changed` announcement.
 */

export type WorldChangeKind =
  | "landmark"
  | "path"
  | "cluster"
  | "anchor"
  | "tone"
  | "brain_belief"
  | "brain_user_model"
  | "brain_dedup"
  | "brain_stated";

export type WorldChangeProposalStatus = "pending" | "approved" | "rejected" | "deferred" | "applied" | "undone";

export interface WorldChangeState {
  /** 0..1 — the A8 warmth signal (warm memories accumulating). */
  warmth: number;
  /** The season label in the space's local time, e.g. "Late spring". */
  season: string;
  pendingCount: number;
  appliedCount: number;
}

export interface WorldChangeProposal {
  id: string;
  kind: WorldChangeKind;
  title: string;
  reason: string;
  evidence: string;
  status: WorldChangeProposalStatus;
  createdAt: string;
  /**
   * What the change touches, as a plain string the client resolves
   * against the world it renders in — `landmark:<journeyId>` for a
   * landmark (its seeded crown position), `path:<fromNodeId>:<toNodeId>`
   * for a path (the two plots it joins). A target that does not resolve
   * is shown in the inbox but never rendered as a preview: the scene
   * never invents a position.
   */
  target: string;
}

export interface WorldChangeLogEntry {
  id: string;
  kind: WorldChangeKind;
  summary: string;
  reason: string;
  appliedAt: string;
  proposalId: string | null;
}

export interface WorldChangeSweepResult {
  pending: number;
  approvedUnapplied: number;
  retried: number;
  failed: number;
}

export class WorldChangesClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorldChangesClientError";
  }
}

function announce(event: "world-changes-applied" | "world-changes-undone", proposal: WorldChangeProposal): void {
  try {
    window.dispatchEvent(new CustomEvent(event, { detail: proposal }));
  } catch {
    /* no window — the log still records the decision */
  }
}

/** The garden's warmth signal and counts, or null when unreachable. */
export async function getWorldChangesState(): Promise<WorldChangeState | null> {
  try {
    const res = await afetch(`${API}/world-changes/state`);
    if (!res.ok) return null;
    const d = (await res.json()) as WorldChangeState;
    return typeof d?.warmth === "number" && typeof d?.season === "string" ? d : null;
  } catch {
    return null;
  }
}

export async function listWorldChangeProposals(input?: {
  status?: string;
  kind?: string;
}): Promise<WorldChangeProposal[] | null> {
  try {
    const params = new URLSearchParams();
    if (input?.status) params.set("status", input.status);
    if (input?.kind) params.set("kind", input.kind);
    const query = params.toString();
    const res = await afetch(`${API}/world-changes/proposals${query ? `?${query}` : ""}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { proposals?: WorldChangeProposal[] };
    return Array.isArray(d?.proposals) ? d.proposals : null;
  } catch {
    return null;
  }
}

export async function getWorldChangeProposal(id: string): Promise<WorldChangeProposal | null> {
  try {
    const res = await afetch(`${API}/world-changes/proposals/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { proposal?: WorldChangeProposal };
    return d?.proposal ?? null;
  } catch {
    return null;
  }
}

export type WorldChangeDecision = "approve" | "reject" | "defer";

/**
 * Decide a proposal. Silence is never approval (M1/D-15): the decision
 * is always the owner's explicit tap, carried here verbatim. Returns the
 * server's updated proposal.
 */
export async function decideWorldChangeProposal(
  id: string,
  decision: WorldChangeDecision,
  note?: string,
): Promise<WorldChangeProposal> {
  const res = await afetch(`${API}/world-changes/proposals/${encodeURIComponent(id)}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note !== undefined ? { decision, note } : { decision }),
  });
  const data = (await res.json().catch(() => null)) as { proposal?: WorldChangeProposal; error?: string; code?: string } | null;
  if (!res.ok || !data?.proposal) {
    if (res.status === 404) {
      throw new WorldChangesClientError("NOT_FOUND", "That proposal couldn't be found.");
    }
    throw new WorldChangesClientError(
      data?.code ?? "WORLD_CHANGE_REQUEST_FAILED",
      data?.error ?? "That didn't go through — please try again.",
    );
  }
  if (decision === "approve") announce("world-changes-applied", data.proposal);
  return data.proposal;
}

/**
 * Undo an applied change (M1 beat 5, D-16): a compensating entry, never
 * a rewrite — the log keeps both entries. Returns the server's updated
 * proposal plus the compensating log entry.
 */
export async function undoWorldChangeProposal(
  id: string,
): Promise<{ proposal: WorldChangeProposal; logEntry: WorldChangeLogEntry }> {
  const res = await afetch(`${API}/world-changes/proposals/${encodeURIComponent(id)}/undo`, {
    method: "POST",
  });
  const data = (await res.json().catch(() => null)) as {
    proposal?: WorldChangeProposal;
    logEntry?: WorldChangeLogEntry;
    error?: string;
    code?: string;
  } | null;
  if (!res.ok || !data?.proposal || !data?.logEntry) {
    if (res.status === 404) {
      throw new WorldChangesClientError("NOT_FOUND", "That proposal couldn't be found.");
    }
    throw new WorldChangesClientError(
      data?.code ?? "WORLD_CHANGE_REQUEST_FAILED",
      data?.error ?? "That didn't go through — please try again.",
    );
  }
  announce("world-changes-undone", data.proposal);
  return { proposal: data.proposal, logEntry: data.logEntry };
}

/** The append-only transition log, chronological, in plain language. */
export async function getWorldChangesLog(): Promise<WorldChangeLogEntry[] | null> {
  try {
    const res = await afetch(`${API}/world-changes/log`);
    if (!res.ok) return null;
    const d = (await res.json()) as { entries?: WorldChangeLogEntry[] };
    return Array.isArray(d?.entries) ? d.entries : null;
  } catch {
    return null;
  }
}

/** Retry approved-but-unapplied changes (the M1 failure rule's repair). */
export async function sweepWorldChanges(): Promise<WorldChangeSweepResult> {
  const res = await afetch(`${API}/world-changes/sweep`, { method: "POST" });
  const data = (await res.json().catch(() => null)) as (WorldChangeSweepResult & { error?: string; code?: string }) | null;
  if (!res.ok || !data || typeof data.pending !== "number") {
    throw new WorldChangesClientError(
      data?.code ?? "WORLD_CHANGE_REQUEST_FAILED",
      data?.error ?? "That didn't go through — please try again.",
    );
  }
  return { pending: data.pending, approvedUnapplied: data.approvedUnapplied, retried: data.retried, failed: data.failed };
}

/** Plain-words label for a change kind — what the inbox and the log show. */
export function worldChangeKindLabel(kind: WorldChangeKind): string {
  switch (kind) {
    case "landmark":
      return "Landmark";
    case "path":
      return "Path";
    case "cluster":
      return "Cluster";
    case "anchor":
      return "Anchor";
    case "tone":
      return "Tone";
    case "brain_belief":
      return "Brain — a belief";
    case "brain_user_model":
      return "Brain — how it sees you";
    case "brain_dedup":
      return "Brain — a duplicate";
    case "brain_stated":
      return "Brain — something you said";
  }
}

/** A proposal's target, resolved against the world it renders in. */
export type ResolvedWorldChangeTarget =
  | { kind: "landmark"; journeyId: number }
  | { kind: "path"; fromNodeId: number; toNodeId: number }
  | { kind: "unknown" };

export function resolveWorldChangeTarget(target: string): ResolvedWorldChangeTarget {
  const parts = target.trim().split(":");
  if (parts[0] === "landmark" && parts.length === 2) {
    const journeyId = Number(parts[1]);
    if (Number.isInteger(journeyId)) return { kind: "landmark", journeyId };
  }
  if (parts[0] === "path" && parts.length === 3) {
    const fromNodeId = Number(parts[1]);
    const toNodeId = Number(parts[2]);
    if (Number.isInteger(fromNodeId) && Number.isInteger(toNodeId)) {
      return { kind: "path", fromNodeId, toNodeId };
    }
  }
  // A bare number is a landmark's journey id (the oldest encoding).
  const bare = Number(target.trim());
  if (target.trim() !== "" && Number.isInteger(bare)) return { kind: "landmark", journeyId: bare };
  return { kind: "unknown" };
}
