import type { AppContext } from "../context.js";
import type { DbHandle } from "../db/client.js";
import type { RawDb } from "../db/vec.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { getPreferences, localDay, spaceTimezone, DEFAULT_PREFS } from "../agent/notify/policy.js";

/**
 * Phase 4 — the §17 world-change rail + mutation engine.
 *
 * Every structural change to a world goes through here:
 *   propose -> (batched calm review) -> approve/reject/defer -> apply -> undo
 * Silence is never approval. Proposals wait quietly (no expiry, no discard).
 *
 * M1 failure rule: an approved change lands whole with its log entry, or not
 * at all, with the proposal still standing. World kinds (landmark/path) apply
 * inside ONE better-sqlite3 transaction (effect + log entry + proposal row),
 * so a mid-apply failure rolls back all three. Brain kinds apply through a
 * registered applier (async, internally transactional — see brainAppliers.ts);
 * the log entry is written only AFTER the applier succeeds, so a failed apply
 * never produces a false "applied" log entry, and a retry is safe because
 * every brain applier is idempotent (it checks for its own prior effect).
 *
 * M2 line: structural kinds need the rail. Presentation (warmth/weather
 * within the recipe) is computed state, served by getMutationState — it needs
 * no proposal. M5: inferred emotion feeds ONLY warmth/weather, never a
 * structural proposal — enforced by construction (computeMutationSignals
 * proposes landmarks from completed Journeys and paths from real edges only).
 *
 * The log (world_change_log) is append-only: this module issues no UPDATE or
 * DELETE against it. Undo appends a compensating entry (kind 'undo',
 * supersedes_log_id = the original entry); the original entry stays.
 * The undone_by_log_id column exists for forward compatibility and is not
 * written in this increment — the compensating entry's supersedes_log_id is
 * the link, so history is never rewritten.
 */

export type WorldProposalKind =
  | "landmark"
  | "path"
  | "cluster"
  | "anchor"
  | "tone"
  | "brain_belief"
  | "brain_user_model"
  | "brain_dedup"
  | "brain_stated";

export const WORLD_PROPOSAL_KINDS: readonly WorldProposalKind[] = [
  "landmark",
  "path",
  "cluster",
  "anchor",
  "tone",
  "brain_belief",
  "brain_user_model",
  "brain_dedup",
  "brain_stated",
] as const;

export type WorldProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "deferred"
  | "applied"
  | "undone"
  | "failed";

export interface WorldProposal {
  id: number;
  spaceId: string;
  kind: WorldProposalKind;
  targetKind: string | null;
  targetId: string | null;
  title: string;
  reason: string;
  evidence: unknown[];
  payload: Record<string, unknown>;
  status: WorldProposalStatus;
  dedupKey: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  appliedLogId: number | null;
}

export interface WorldChangeLogEntry {
  id: number;
  spaceId: string;
  proposalId: number | null;
  kind: string;
  summary: string;
  reason: string;
  evidence: unknown[];
  appliedAt: string;
  supersedesLogId: number | null;
  undoneByLogId: number | null;
}

export interface WorldLandmark {
  id: number;
  journeyId: number;
  label: string;
  appliedAt: string;
}

export interface WorldPath {
  id: number;
  edgeId: number;
  sourceId: number;
  targetId: number;
  appliedAt: string;
}

export interface MutationState {
  warmth: number;
  season: string;
  pendingCount: number;
  appliedCount: number;
  landmarks: WorldLandmark[];
  paths: WorldPath[];
}

/** A brain applier executes one approved brain proposal. Must be idempotent. */
export type BrainApplier = (
  ctx: AppContext,
  spaceId: string,
  payload: Record<string, unknown>,
) => Promise<{ ok: boolean; error?: string; detail?: unknown }>;

const brainAppliers = new Map<WorldProposalKind, BrainApplier>();

export function registerBrainApplier(kind: WorldProposalKind, fn: BrainApplier): void {
  brainAppliers.set(kind, fn);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

interface ProposalRow {
  id: number;
  space_id: string;
  kind: string;
  target_kind: string | null;
  target_id: string | null;
  title: string;
  reason: string;
  evidence_json: string;
  payload_json: string;
  status: string;
  dedup_key: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  applied_log_id: number | null;
}

function mapProposal(r: ProposalRow): WorldProposal {
  return {
    id: r.id,
    spaceId: r.space_id,
    kind: r.kind as WorldProposalKind,
    targetKind: r.target_kind,
    targetId: r.target_id,
    title: r.title,
    reason: r.reason,
    evidence: parseJsonArray(r.evidence_json),
    payload: parseJsonRecord(r.payload_json),
    status: r.status as WorldProposalStatus,
    dedupKey: r.dedup_key,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    appliedLogId: r.applied_log_id,
  };
}

interface LogRow {
  id: number;
  space_id: string;
  proposal_id: number | null;
  kind: string;
  summary: string;
  reason: string;
  evidence_json: string;
  applied_at: string;
  supersedes_log_id: number | null;
  undone_by_log_id: number | null;
}

function mapLogEntry(r: LogRow): WorldChangeLogEntry {
  return {
    id: r.id,
    spaceId: r.space_id,
    proposalId: r.proposal_id,
    kind: r.kind,
    summary: r.summary,
    reason: r.reason,
    evidence: parseJsonArray(r.evidence_json),
    appliedAt: r.applied_at,
    supersedesLogId: r.supersedes_log_id,
    undoneByLogId: r.undone_by_log_id,
  };
}

export function getProposal(sqlite: RawDb, spaceId: string, id: number): WorldProposal | null {
  const row = sqlite
    .prepare(`SELECT * FROM world_proposals WHERE id = ? AND space_id = ?`)
    .get(id, spaceId) as ProposalRow | undefined;
  return row ? mapProposal(row) : null;
}

export interface ProposeInput {
  kind: WorldProposalKind;
  targetKind?: string | null;
  targetId?: string | number | null;
  title: string;
  reason: string;
  evidence?: unknown[];
  payload?: Record<string, unknown>;
  dedupKey: string;
}

/**
 * Create a proposal, or return the existing one when the dedup key already
 * stands (proposals are never duplicated — a second propose is a no-op).
 */
export function proposeWorldChange(
  sqlite: RawDb,
  spaceId: string,
  input: ProposeInput,
): { proposal: WorldProposal; duplicate: boolean } {
  if (!WORLD_PROPOSAL_KINDS.includes(input.kind)) {
    throw new Error(`unknown proposal kind: ${String(input.kind)}`);
  }
  if (!input.title.trim() || !input.reason.trim() || !input.dedupKey.trim()) {
    throw new Error("proposal needs a title, a reason, and a dedup key");
  }
  const targetId = input.targetId == null ? null : String(input.targetId);
  const inserted = sqlite
    .prepare(
      `INSERT OR IGNORE INTO world_proposals
         (space_id, kind, target_kind, target_id, title, reason, evidence_json, payload_json, status, dedup_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      spaceId,
      input.kind,
      input.targetKind ?? null,
      targetId,
      input.title,
      input.reason,
      JSON.stringify(input.evidence ?? []),
      JSON.stringify(input.payload ?? {}),
      input.dedupKey,
    );
  const duplicate = inserted.changes === 0;
  const row = sqlite
    .prepare(`SELECT * FROM world_proposals WHERE space_id = ? AND dedup_key = ?`)
    .get(spaceId, input.dedupKey) as ProposalRow | undefined;
  if (!row) throw new Error("proposal insert failed");
  return { proposal: mapProposal(row), duplicate };
}

/**
 * Decide a proposal. Silence is never approval — only an explicit 'approve'
 * applies anything. Approving runs the apply immediately; if the apply fails
 * the proposal stays 'approved' (still standing, retryable by the sweep) and
 * the error is returned — never a false "applied" state, never a log entry.
 */
export async function decideWorldChange(
  ctx: AppContext,
  spaceId: string,
  id: number,
  decision: "approve" | "reject" | "defer",
  decidedBy: string,
): Promise<{ ok: boolean; proposal: WorldProposal | null; error?: string }> {
  const sqlite = ctx.handle.sqlite;
  const proposal = getProposal(sqlite, spaceId, id);
  if (!proposal) return { ok: false, proposal: null, error: "proposal not found" };
  if (proposal.status !== "pending" && proposal.status !== "deferred") {
    return { ok: false, proposal, error: `proposal is ${proposal.status}, not decidable` };
  }
  if (decision === "reject") {
    sqlite
      .prepare(`UPDATE world_proposals SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?`)
      .run(nowIso(), decidedBy, id);
    return { ok: true, proposal: getProposal(sqlite, spaceId, id) };
  }
  if (decision === "defer") {
    sqlite
      .prepare(`UPDATE world_proposals SET status = 'deferred', decided_at = ?, decided_by = ? WHERE id = ?`)
      .run(nowIso(), decidedBy, id);
    return { ok: true, proposal: getProposal(sqlite, spaceId, id) };
  }
  // approve: mark approved first, then apply. A failed apply leaves the
  // proposal 'approved' (M1: still standing, retryable).
  sqlite
    .prepare(`UPDATE world_proposals SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?`)
    .run(nowIso(), decidedBy, id);
  const approved = getProposal(sqlite, spaceId, id);
  if (!approved) return { ok: false, proposal: null, error: "proposal vanished after approval" };
  const applied = await applyWorldChange(ctx, spaceId, approved);
  if (!applied.ok) {
    return { ok: false, proposal: getProposal(sqlite, spaceId, id), error: applied.error };
  }
  return { ok: true, proposal: getProposal(sqlite, spaceId, id) };
}

/** Validate a world-kind payload before any write. Returns an error string or null. */
function validateWorldPayload(sqlite: RawDb, spaceId: string, proposal: WorldProposal): string | null {
  const p = proposal.payload;
  if (proposal.kind === "landmark") {
    const journeyId = p.journeyId;
    if (typeof journeyId !== "number" || !Number.isInteger(journeyId)) {
      return "landmark payload needs an integer journeyId";
    }
    if (typeof p.label !== "string" || !p.label.trim()) {
      return "landmark payload needs a label";
    }
    const j = sqlite
      .prepare(`SELECT id, status FROM journeys WHERE id = ? AND space_id = ?`)
      .get(journeyId, spaceId) as { id: number; status: string } | undefined;
    if (!j) return `journey ${journeyId} not found in this space`;
    if (j.status !== "done") return `journey ${journeyId} is ${j.status}, not done`;
    return null;
  }
  if (proposal.kind === "path") {
    const edgeId = p.edgeId;
    if (typeof edgeId !== "number" || !Number.isInteger(edgeId)) {
      return "path payload needs an integer edgeId";
    }
    const e = sqlite
      .prepare(`SELECT id, source, target FROM edges WHERE id = ? AND space_id = ?`)
      .get(edgeId, spaceId) as { id: number; source: number; target: number } | undefined;
    if (!e) return `edge ${edgeId} not found in this space`;
    if (e.source !== p.sourceId || e.target !== p.targetId) {
      return "path payload source/target do not match the edge";
    }
    return null;
  }
  return `no world effect implemented for kind ${proposal.kind}`;
}

/**
 * Apply an approved proposal. World kinds run effect + log + proposal-mark in
 * ONE synchronous transaction (M1 atomicity). Brain kinds run their registered
 * applier first (internally transactional, idempotent), then the log + mark in
 * one synchronous transaction. Any failure: no log entry, proposal stays
 * 'approved'. A malformed payload (fails validation) marks the proposal
 * 'failed' — terminal, since it can never apply.
 */
export async function applyWorldChange(
  ctx: AppContext,
  spaceId: string,
  proposal: WorldProposal,
): Promise<{ ok: boolean; logId?: number; error?: string }> {
  const sqlite = ctx.handle.sqlite;
  if (proposal.status !== "approved") {
    return { ok: false, error: `proposal is ${proposal.status}, not approved` };
  }
  const isWorldKind = proposal.kind === "landmark" || proposal.kind === "path";
  if (isWorldKind) {
    const invalid = validateWorldPayload(sqlite, spaceId, proposal);
    if (invalid) {
      sqlite.prepare(`UPDATE world_proposals SET status = 'failed' WHERE id = ?`).run(proposal.id);
      return { ok: false, error: invalid };
    }
  }
  if (isWorldKind) {
    // One transaction: effect + log entry + proposal mark. Any throw rolls
    // back all three — no partial mutation, no false log entry.
    try {
      const logId = sqlite.transaction((): number => {
        const log = sqlite
          .prepare(
            `INSERT INTO world_change_log (space_id, proposal_id, kind, summary, reason, evidence_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(spaceId, proposal.id, proposal.kind, proposal.title, proposal.reason, JSON.stringify(proposal.evidence));
        const logId = Number(log.lastInsertRowid);
        if (proposal.kind === "landmark") {
          sqlite
            .prepare(`INSERT INTO world_landmarks (space_id, journey_id, label, created_log_id) VALUES (?, ?, ?, ?)`)
            .run(spaceId, proposal.payload.journeyId as number, proposal.payload.label as string, logId);
        } else {
          sqlite
            .prepare(
              `INSERT INTO world_paths (space_id, edge_id, source_id, target_id, created_log_id) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
              spaceId,
              proposal.payload.edgeId as number,
              proposal.payload.sourceId as number,
              proposal.payload.targetId as number,
              logId,
            );
        }
        sqlite
          .prepare(`UPDATE world_proposals SET status = 'applied', applied_log_id = ? WHERE id = ?`)
          .run(logId, proposal.id);
        return logId;
      })();
      return { ok: true, logId };
    } catch (e) {
      return { ok: false, error: `apply failed, rolled back: ${(e as Error).message}`.slice(0, 200) };
    }
  }
  // Brain kinds: registered applier first, then log + mark.
  const applier = brainAppliers.get(proposal.kind);
  if (!applier) {
    return { ok: false, error: `no applier registered for kind ${proposal.kind}` };
  }
  let res: { ok: boolean; error?: string; detail?: unknown };
  try {
    res = await applier(ctx, spaceId, proposal.payload);
  } catch (e) {
    return { ok: false, error: `applier threw: ${(e as Error).message}`.slice(0, 200) };
  }
  if (!res.ok) {
    return { ok: false, error: res.error ?? "applier declined" };
  }
  try {
    const logId = sqlite.transaction((): number => {
      const log = sqlite
        .prepare(
          `INSERT INTO world_change_log (space_id, proposal_id, kind, summary, reason, evidence_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(spaceId, proposal.id, proposal.kind, proposal.title, proposal.reason, JSON.stringify(proposal.evidence));
      const logId = Number(log.lastInsertRowid);
      sqlite
        .prepare(`UPDATE world_proposals SET status = 'applied', applied_log_id = ? WHERE id = ?`)
        .run(logId, proposal.id);
      return logId;
    })();
    return { ok: true, logId };
  } catch (e) {
    // Effect applied, log failed: proposal stays 'approved'; the sweep retries
    // and the applier's idempotency guard makes the retry safe.
    return { ok: false, error: `effect applied but log write failed: ${(e as Error).message}`.slice(0, 200) };
  }
}

/**
 * Undo an applied world change (D-16): dependency-aware compensating entries
 * only. If a later applied change touches the same target, refuse with a
 * plain-language conflict — never silently overwrite newer work. Undo is
 * logical reversibility, not erasure: the original log entry stays, and the
 * compensating entry (kind 'undo', supersedes_log_id = original) is what
 * reverses the effect. Brain kinds do not support undo in this increment —
 * their entries stay and are correctable through the user-model correction
 * path; the refusal says so plainly.
 */
export function undoWorldChange(
  ctx: AppContext,
  spaceId: string,
  id: number,
): { ok: boolean; proposal: WorldProposal | null; logId?: number; error?: string } {
  const sqlite = ctx.handle.sqlite;
  const proposal = getProposal(sqlite, spaceId, id);
  if (!proposal) return { ok: false, proposal: null, error: "proposal not found" };
  if (proposal.status !== "applied" || proposal.appliedLogId == null) {
    return { ok: false, proposal, error: `proposal is ${proposal.status}, not applied` };
  }
  if (proposal.kind !== "landmark" && proposal.kind !== "path") {
    return {
      ok: false,
      proposal,
      error:
        `undo is not supported for ${proposal.kind} proposals in this increment — ` +
        `the applied entry stays and can be corrected through the user-model correction path`,
    };
  }
  // Dependency check: any later non-undo log entry on the same target?
  const later = sqlite
    .prepare(
      `SELECT l.id FROM world_change_log l
       JOIN world_proposals p ON p.id = l.proposal_id
       WHERE l.space_id = ? AND l.id > ? AND l.kind != 'undo'
         AND p.target_kind = ? AND p.target_id = ? LIMIT 1`,
    )
    .get(spaceId, proposal.appliedLogId, proposal.targetKind, proposal.targetId) as { id: number } | undefined;
  if (later) {
    return {
      ok: false,
      proposal,
      error:
        `a later change (log #${later.id}) touches the same ${proposal.targetKind ?? "target"} — ` +
        `undo would overwrite newer work, so it needs your call on which change wins`,
    };
  }
  try {
    const logId = sqlite.transaction((): number => {
      const log = sqlite
        .prepare(
          `INSERT INTO world_change_log (space_id, proposal_id, kind, summary, reason, evidence_json, supersedes_log_id)
           VALUES (?, ?, 'undo', ?, ?, ?, ?)`,
        )
        .run(
          spaceId,
          proposal.id,
          `Undid: ${proposal.title}`,
          proposal.reason,
          JSON.stringify(proposal.evidence),
          proposal.appliedLogId,
        );
      const logId = Number(log.lastInsertRowid);
      if (proposal.kind === "landmark") {
        sqlite
          .prepare(`DELETE FROM world_landmarks WHERE space_id = ? AND journey_id = ?`)
          .run(spaceId, Number(proposal.targetId));
      } else {
        sqlite
          .prepare(`DELETE FROM world_paths WHERE space_id = ? AND edge_id = ?`)
          .run(spaceId, Number(proposal.targetId));
      }
      sqlite.prepare(`UPDATE world_proposals SET status = 'undone' WHERE id = ?`).run(proposal.id);
      return logId;
    })();
    return { ok: true, proposal: getProposal(sqlite, spaceId, id), logId };
  } catch (e) {
    return { ok: false, proposal, error: `undo failed, rolled back: ${(e as Error).message}`.slice(0, 200) };
  }
}

export function listProposals(
  sqlite: RawDb,
  spaceId: string,
  opts: { status?: string; kind?: string; limit?: number } = {},
): WorldProposal[] {
  const where = [`space_id = ?`];
  const args: unknown[] = [spaceId];
  if (opts.status) {
    where.push(`status = ?`);
    args.push(opts.status);
  }
  if (opts.kind) {
    where.push(`kind = ?`);
    args.push(opts.kind);
  }
  const limit = Math.max(1, Math.min(200, opts.limit ?? 100));
  const rows = sqlite
    .prepare(`SELECT * FROM world_proposals WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...args, limit) as ProposalRow[];
  return rows.map(mapProposal);
}

export function listWorldChangeLog(
  sqlite: RawDb,
  spaceId: string,
  limit = 100,
): WorldChangeLogEntry[] {
  const rows = sqlite
    .prepare(
      `SELECT * FROM world_change_log WHERE space_id = ? ORDER BY applied_at ASC, id ASC LIMIT ?`,
    )
    .all(spaceId, Math.max(1, Math.min(500, limit))) as LogRow[];
  return rows.map(mapLogEntry);
}

export function listWorldLandmarks(sqlite: RawDb, spaceId: string): WorldLandmark[] {
  const rows = sqlite
    .prepare(
      `SELECT wl.id, wl.journey_id, wl.label, wcl.applied_at
       FROM world_landmarks wl JOIN world_change_log wcl ON wcl.id = wl.created_log_id
       WHERE wl.space_id = ? ORDER BY wl.id ASC`,
    )
    .all(spaceId) as { id: number; journey_id: number; label: string; applied_at: string }[];
  return rows.map((r) => ({ id: r.id, journeyId: r.journey_id, label: r.label, appliedAt: r.applied_at }));
}

export function listWorldPaths(sqlite: RawDb, spaceId: string): WorldPath[] {
  const rows = sqlite
    .prepare(
      `SELECT wp.id, wp.edge_id, wp.source_id, wp.target_id, wcl.applied_at
       FROM world_paths wp JOIN world_change_log wcl ON wcl.id = wp.created_log_id
       WHERE wp.space_id = ? ORDER BY wp.id ASC`,
    )
    .all(spaceId) as { id: number; edge_id: number; source_id: number; target_id: number; applied_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    edgeId: r.edge_id,
    sourceId: r.source_id,
    targetId: r.target_id,
    appliedAt: r.applied_at,
  }));
}

/** Season label from the space-local date — never UTC. */
export function seasonForLocalDay(localDayStr: string): string {
  const month = Number(localDayStr.slice(5, 7));
  if (month === 12 || month <= 2) return "Winter";
  if (month <= 5) return "Spring";
  if (month <= 8) return "Summer";
  return "Autumn";
}

function computeWarmth(sqlite: RawDb, spaceId: string): number {
  const total = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL
         AND (kind IS NULL OR kind NOT IN ('action','moc','belief'))`,
    )
    .get(spaceId) as { n: number };
  if (total.n === 0) return 0;
  const warm = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL
         AND (kind IS NULL OR kind NOT IN ('action','moc','belief'))
         AND emotional_weight IS NOT NULL AND emotional_weight > 0.3`,
    )
    .get(spaceId) as { n: number };
  return Math.round((warm.n / total.n) * 1000) / 1000;
}

export function getMutationState(ctx: AppContext, spaceId: string): MutationState {
  const sqlite = ctx.handle.sqlite;
  let tz = DEFAULT_PREFS.timezone;
  try {
    tz = getPreferences(sqlite, spaceId).timezone;
  } catch {
    tz = DEFAULT_PREFS.timezone;
  }
  const season = seasonForLocalDay(localDay(new Date(), tz));
  const pending = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM world_proposals WHERE space_id = ? AND status = 'pending'`)
    .get(spaceId) as { n: number };
  const applied = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM world_proposals WHERE space_id = ? AND status = 'applied'`)
    .get(spaceId) as { n: number };
  return {
    warmth: computeWarmth(sqlite, spaceId),
    season,
    pendingCount: pending.n,
    appliedCount: applied.n,
    landmarks: listWorldLandmarks(sqlite, spaceId),
    paths: listWorldPaths(sqlite, spaceId),
  };
}

export interface SignalSummary {
  warmth: number;
  season: string;
  proposedLandmarks: number;
  proposedPaths: number;
  pendingCount: number;
}

const MAX_PATH_PROPOSALS_PER_RUN = 5;

/**
 * Compute the mutation signals from real brain data and propose what the
 * signals justify — idempotently (dedup keys; a second run proposes nothing
 * new). Landmarks come only from completed Journeys; paths only from real
 * edges between two real memories (P7 tier ii: suggested until the owner
 * confirms). Inferred emotion feeds warmth only — never a structural
 * proposal (M5). Aspirations (journeys in progress) are ambient only.
 */
export function computeMutationSignals(handle: DbHandle, spaceId: string): SignalSummary {
  const sqlite = handle.sqlite;
  let tz = DEFAULT_PREFS.timezone;
  try {
    tz = getPreferences(sqlite, spaceId).timezone;
  } catch {
    tz = DEFAULT_PREFS.timezone;
  }
  const warmth = computeWarmth(sqlite, spaceId);
  const season = seasonForLocalDay(localDay(new Date(), tz));

  let proposedLandmarks = 0;
  const journeys = new JourneysRepo(handle, spaceId).list(true).filter((j) => j.status === "done");
  for (const j of journeys) {
    const { proposal, duplicate } = proposeWorldChange(sqlite, spaceId, {
      kind: "landmark",
      targetKind: "journey",
      targetId: j.id,
      title: `Landmark for “${j.title}”`,
      reason: `You finished the journey “${j.title}”, so the Growing Place can raise a landmark for it — a real milestone, not a suggestion.`,
      evidence: [{ type: "journey", id: j.id, label: j.title }],
      payload: { journeyId: j.id, label: j.title },
      dedupKey: `landmark:journey:${j.id}`,
    });
    void proposal;
    if (!duplicate) proposedLandmarks++;
  }

  let proposedPaths = 0;
  const edges = sqlite
    .prepare(
      `SELECT e.id, e.source, e.target FROM edges e
       JOIN nodes s ON s.id = e.source AND s.space_id = e.space_id
       JOIN nodes t ON t.id = e.target AND t.space_id = e.space_id
       WHERE e.space_id = ? AND e.relationship != 'summarizes'
         AND s.deleted_at IS NULL AND t.deleted_at IS NULL
         AND (s.kind IS NULL OR s.kind NOT IN ('action','moc','belief'))
         AND (t.kind IS NULL OR t.kind NOT IN ('action','moc','belief'))
       ORDER BY e.created_at DESC LIMIT ?`,
    )
    .all(spaceId, MAX_PATH_PROPOSALS_PER_RUN * 4) as { id: number; source: number; target: number }[];
  for (const e of edges) {
    if (proposedPaths >= MAX_PATH_PROPOSALS_PER_RUN) break;
    const labels = sqlite
      .prepare(`SELECT id, label FROM nodes WHERE id IN (?, ?) AND space_id = ?`)
      .all(e.source, e.target, spaceId) as { id: number; label: string }[];
    const byId = new Map(labels.map((l) => [l.id, l.label]));
    const { duplicate } = proposeWorldChange(sqlite, spaceId, {
      kind: "path",
      targetKind: "edge",
      targetId: e.id,
      title: `A path between “${byId.get(e.source) ?? "a memory"}” and “${byId.get(e.target) ?? "a memory"}”`,
      reason: `The brain found a link between these two memories. If you approve, a path will join them in the Growing Place so you can travel it.`,
      evidence: [
        { type: "edge", id: e.id },
        { type: "node", id: e.source, label: byId.get(e.source) },
        { type: "node", id: e.target, label: byId.get(e.target) },
      ],
      payload: { edgeId: e.id, sourceId: e.source, targetId: e.target },
      dedupKey: `path:edge:${e.id}`,
    });
    if (!duplicate) proposedPaths++;
  }

  const pending = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM world_proposals WHERE space_id = ? AND status = 'pending'`)
    .get(spaceId) as { n: number };
  return { warmth, season, proposedLandmarks, proposedPaths, pendingCount: pending.n };
}

/**
 * Scheduled sweep (D-15): proposals WAIT QUIETLY — no expiry, no discard, no
 * forced decision. The sweep only retries approved-but-unapplied proposals
 * (one attempt each; a failed retry stays 'approved' and is counted) and
 * reports the counts the inbox surfaces.
 */
export async function sweepWorldProposals(
  ctx: AppContext,
  spaceId: string,
): Promise<{ pending: number; approvedUnapplied: number; retried: number; failed: number }> {
  const sqlite = ctx.handle.sqlite;
  const pending = (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM world_proposals WHERE space_id = ? AND status = 'pending'`).get(spaceId) as {
      n: number;
    }
  ).n;
  const stuck = sqlite
    .prepare(
      `SELECT * FROM world_proposals WHERE space_id = ? AND status = 'approved' AND applied_log_id IS NULL`,
    )
    .all(spaceId) as ProposalRow[];
  let retried = 0;
  let failed = 0;
  for (const row of stuck) {
    const res = await applyWorldChange(ctx, spaceId, mapProposal(row));
    retried++; // every attempt counts as a retry, success or failure
    if (!res.ok) failed++;
  }
  return { pending, approvedUnapplied: stuck.length, retried, failed };
}

/**
 * On-demand explanation (M6 door one): why is this proposal / change here,
 * in plain language — the reason, the evidence, and the current state.
 */
export function explainChange(
  sqlite: RawDb,
  spaceId: string,
  proposalId: number,
): { proposal: WorldProposal; lines: string[] } | null {
  const proposal = getProposal(sqlite, spaceId, proposalId);
  if (!proposal) return null;
  const lines = [
    proposal.reason,
    `Status: ${proposal.status}.`,
    proposal.status === "pending"
      ? "Nothing has changed yet — this is a proposal waiting for your yes."
      : proposal.status === "applied"
        ? `Applied${proposal.appliedLogId != null ? ` (log #${proposal.appliedLogId})` : ""} — the change is in the world and in the World Changes log.`
        : `Decided: ${proposal.status}.`,
  ];
  if (proposal.kind === "landmark" || proposal.kind === "path") {
    lines.push("Structural change — it needed your approval before it could land.");
  }
  if (proposal.kind.startsWith("brain_")) {
    lines.push("The brain proposed this change to its own understanding — it applies only with your approval.");
  }
  return { proposal, lines };
}
