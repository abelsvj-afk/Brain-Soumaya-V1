/**
 * W3 Phase B — contradiction adjudication (design Rev 11 §5.1–§5.5;
 * implementation plan Milestone 3).
 *
 * Records live in the typed `contradictions` table (Milestone 1 schema).
 * This module owns: filing (with pair uniqueness — one open record per
 * identified pair, T-C27), candidate detection over current rows, the
 * claim protocol (§5.2: claim + lease + fencing; stale claims from
 * crashed runs become claimable again, T-C21), the §5.3 decision table
 * (deterministic, computed over pre-fetched rows — NO LLM anywhere in
 * this module), application of decisions (user_model writes ONLY via
 * the §6.1 boundary; node writes ONLY via the W1 supersession writer in
 * temporal.ts), and §5.5 inquiry creation for user-facing cells.
 *
 * §5.1 note (temporal.ts call sites): logPotentialContradiction is NOT
 * amended to file typed records — its SupersedeInput carries a proposed
 * replacement PAYLOAD, not an existing record, and §5.1 requires the
 * report to point at the concrete proposed record or not file. Filing
 * happens here, where both sides are identified rows.
 *
 * Table gaps filled conservatively (flagged in the milestone report):
 * - Nodes, stated side NEWER: cell 5 protections (stated stands, system
 *   side flagged, no currency mutation) without an inquiry — the user's
 *   latest word already settled it.
 * - user_model, both sides non-stated: the cells 2/3 analog via the
 *   boundary (rules '#2u'/'#3u') — stronger-or-equal newer wins by
 *   InvalidateEntry('superseded'); strictly-stronger older flags the
 *   newer. The table is silent here; doing nothing would re-file the
 *   pair every run forever.
 * - user_model, stated vs INFERRED (not consolidated): the table's
 *   cells 6/7 name the consolidated side specifically, so these records
 *   take cell-0 deferral and surface to the user after the deferral
 *   budget rather than auto-mutating outside the table.
 */
import type { DbHandle } from "../../db/client.js";
import type { RawDb } from "../../db/vec.js";
import { applyConsolidationMutation, type ConsolidationRunContext } from "./boundary.js";
import { detectContradiction, contentTokens, tokenJaccard } from "../userModel.js";
import { supersedeSystemDerived } from "../temporal.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ContradictionDomain = "nodes" | "user_model";
/** Stored state vocabulary (Milestone 1 CHECK). Deferral is represented
 *  as state 'pending' + a deferred_until in the resolution JSON — there
 *  is no 'deferred' state value. Terminal states: 'resolved' (a
 *  decision was applied), 'unresolved' (user-facing, awaiting the
 *  user's answer), 'moot', 'stated_conflict' (the stated side prevailed). */
export type RecordState =
  | "pending" | "claimed" | "resolved" | "unresolved" | "moot" | "stated_conflict";

/** Stored kind vocabulary (Milestone 1 CHECK). */
export type StoredKind = "node" | "user_model_entry" | "episode";

export interface ContradictionRow {
  id: number;
  space_id: string;
  domain: ContradictionDomain;
  old_kind: StoredKind;
  old_id: number;
  new_kind: StoredKind;
  new_id: number;
  category: string;
  reported_by: string;
  report_ref: string | null;
  reopens_id: number | null;
  state: RecordState;
  attempts: number;
  claimed_by_run: number | null;
  claim_fence: string | null;
  lease_expires_at: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export type ReportedBy =
  | "temporal_propose" | "knowledge_check" | "consolidation" | "sweep" | "user" | "reconciliation";

export interface FileContradictionInput {
  domain: ContradictionDomain;
  oldKind: "node" | "user_model";
  oldId: number;
  newKind: "node" | "user_model";
  newId: number;
  category: string;
  reportedBy: ReportedBy;
  reportRef?: string | null;
  reopensId?: number | null;
}

const toStoredKind = (k: "node" | "user_model"): StoredKind =>
  k === "user_model" ? "user_model_entry" : "node";
const fromStoredKind = (k: StoredKind): "node" | "user_model" =>
  k === "user_model_entry" ? "user_model" : "node";

const CLAIM_LEASE_MS = 15 * 60 * 1000;
const MAX_DEFERRALS = 3;
const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Filing (§5.1)                                                       */
/* ------------------------------------------------------------------ */

function openRecordForPair(
  sqlite: RawDb,
  spaceId: string,
  domain: ContradictionDomain,
  aId: number,
  bId: number,
): ContradictionRow | undefined {
  return sqlite
    .prepare(
      `SELECT * FROM contradictions
       WHERE space_id = ? AND domain = ? AND state IN ('pending','claimed')
         AND ((old_id = ? AND new_id = ?) OR (old_id = ? AND new_id = ?))
       ORDER BY id ASC LIMIT 1`,
    )
    .get(spaceId, domain, aId, bId, bId, aId) as ContradictionRow | undefined;
}

/**
 * File a contradiction record for an identified pair. Pair uniqueness:
 * if an open/claimed/deferred record already covers this unordered pair
 * in this domain, return it unchanged (created=false) — two reports
 * about the same pair never create two live records, while records
 * about DIFFERENT pairs sharing one side stay distinct (T-C27).
 */
export function fileContradiction(
  sqlite: RawDb,
  spaceId: string,
  input: FileContradictionInput,
): { id: number; created: boolean } {
  const existing = openRecordForPair(sqlite, spaceId, input.domain, input.oldId, input.newId);
  if (existing) return { id: existing.id, created: false };
  const r = sqlite
    .prepare(
      `INSERT INTO contradictions
         (space_id, domain, old_kind, old_id, new_kind, new_id, category,
          reported_by, report_ref, reopens_id, state, attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
    )
    .run(
      spaceId,
      input.domain,
      toStoredKind(input.oldKind),
      input.oldId,
      toStoredKind(input.newKind),
      input.newId,
      input.category,
      input.reportedBy,
      input.reportRef ?? null,
      input.reopensId ?? null,
    );
  return { id: Number(r.lastInsertRowid), created: true };
}

/* ------------------------------------------------------------------ */
/* Claim protocol (§5.2)                                               */
/* ------------------------------------------------------------------ */

/**
 * Claim eligible records for a run. Eligible: state 'pending' whose
 * deferral (if any) has come due; state 'claimed' whose lease expired
 * AND whose claim fence is older than this run's fence (a crashed
 * run's claims — T-C21). claim_fence is a TEXT column, so the fence
 * comparison is numeric via CAST. Each claim is a guarded UPDATE
 * (changes must be exactly 1) so two runs can never hold the same
 * record. Deterministic order (oldest first).
 */
export function claimContradictions(
  sqlite: RawDb,
  spaceId: string,
  runId: number,
  fence: number,
  now: Date = new Date(),
): ContradictionRow[] {
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  const candidates = sqlite
    .prepare(
      `SELECT * FROM contradictions
       WHERE space_id = ? AND (
         state = 'pending'
         OR (state = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < ? AND CAST(claim_fence AS INTEGER) < ?)
       )
       ORDER BY created_at ASC, id ASC`,
    )
    .all(spaceId, nowIso, fence) as ContradictionRow[];
  const claimed: ContradictionRow[] = [];
  for (const row of candidates) {
    if (row.state === "pending") {
      const until = deferredUntilOf(row);
      if (until && until > nowIso) continue; // deferred, not yet due
    }
    const upd = sqlite
      .prepare(
        `UPDATE contradictions
         SET state = 'claimed', claimed_by_run = ?, claim_fence = ?, lease_expires_at = ?
         WHERE id = ? AND space_id = ? AND state = ?`,
      )
      .run(runId, String(fence), lease, row.id, spaceId, row.state);
    if (upd.changes === 1) {
      claimed.push({
        ...row,
        state: "claimed",
        claimed_by_run: runId,
        claim_fence: String(fence),
        lease_expires_at: lease,
      });
    }
  }
  return claimed;
}

function deferredUntilOf(row: ContradictionRow): string | null {
  if (!row.resolution) return null;
  try {
    const parsed = JSON.parse(row.resolution) as { deferred_until?: string };
    return parsed.deferred_until ?? null;
  } catch {
    return null;
  }
}

type TerminalState = "resolved" | "unresolved" | "moot" | "stated_conflict";

function resolveRecord(
  sqlite: RawDb,
  id: number,
  outcome: string,
  ruleApplied: string,
  nowIso: string,
  extra?: Record<string, unknown>,
  terminalState: TerminalState = "resolved",
): void {
  sqlite
    .prepare(
      `UPDATE contradictions
       SET state = ?, resolved_at = ?, resolution = ?
       WHERE id = ? AND state = 'claimed'`,
    )
    .run(terminalState, nowIso, JSON.stringify({ outcome, rule_applied: ruleApplied, ...extra }), id);
}

function deferRecord(
  sqlite: RawDb,
  row: ContradictionRow,
  missing: string,
  now: Date,
): void {
  const attempts = row.attempts + 1;
  const deferredUntil = new Date(now.getTime() + MS_PER_DAY).toISOString();
  sqlite
    .prepare(
      `UPDATE contradictions
       SET state = 'pending', attempts = ?, resolution = ?, claimed_by_run = NULL,
           claim_fence = NULL, lease_expires_at = NULL
       WHERE id = ? AND state = 'claimed'`,
    )
    .run(
      attempts,
      JSON.stringify({ outcome: "deferred", rule_applied: "#0", missing, deferred_until: deferredUntil }),
      row.id,
    );
}

/* ------------------------------------------------------------------ */
/* Side facts (pre-fetched rows; the table is pure over these)         */
/* ------------------------------------------------------------------ */

export interface SideFacts {
  kind: "node" | "user_model";
  id: number;
  exists: boolean;
  current: boolean;
  stated: boolean;
  /** user_model slot; null for nodes. */
  slot: string | null;
  /** user_model origin ('stated'|'inferred'|'consolidated'); null for nodes. */
  origin: string | null;
  content: string;
  recordedAt: string;
  validAt: string;
  /** user_model: evidence_strength column. Nodes: importance (strength proxy). */
  strength: number;
  /** user_model emotion_state aged past the §6.3 7-day determination. */
  endOfLife: boolean;
  topicLabels: string[];
  /** For a non-current user_model side: the row that replaced it, if any. */
  replacedBy: number | null;
}

const STALE_EMOTION_DAYS = 7;

function loadUserModelSide(sqlite: RawDb, spaceId: string, id: number, now: Date): SideFacts {
  const row = sqlite
    .prepare(`SELECT * FROM user_model WHERE id = ? AND space_id = ?`)
    .get(id, spaceId) as Record<string, unknown> | undefined;
  if (!row) {
    return {
      kind: "user_model", id, exists: false, current: false, stated: false,
      slot: null, origin: null, content: "", recordedAt: "", validAt: "",
      strength: 0, endOfLife: false, topicLabels: [], replacedBy: null,
    };
  }
  const validAt = String(row.valid_at);
  const ageDays = (now.getTime() - Date.parse(validAt)) / MS_PER_DAY;
  return {
    kind: "user_model",
    id,
    exists: true,
    current: row.invalid_at === null,
    stated: row.origin === "stated",
    slot: String(row.slot),
    origin: String(row.origin),
    content: String(row.content),
    recordedAt: String(row.created_at),
    validAt,
    strength: Number(row.evidence_strength ?? 0),
    endOfLife: row.slot === "emotion_state" && ageDays > STALE_EMOTION_DAYS,
    topicLabels: parseJsonArray(row.topic_labels),
    replacedBy: row.replaced_by != null ? Number(row.replaced_by) : null,
  };
}

/** A node is user-stated when a user correction created or targeted it. */
export function isUserStatedNode(sqlite: RawDb, nodeId: number): boolean {
  const row = sqlite
    .prepare(
      `SELECT 1 FROM corrections
       WHERE corrected_by = 'user' AND (node_id = ? OR superseding_node_id = ?)
       LIMIT 1`,
    )
    .get(nodeId, nodeId);
  return row !== undefined;
}

function loadNodeSide(sqlite: RawDb, spaceId: string, id: number): SideFacts {
  const row = sqlite
    .prepare(`SELECT * FROM nodes WHERE id = ? AND space_id = ?`)
    .get(id, spaceId) as Record<string, unknown> | undefined;
  if (!row) {
    return {
      kind: "node", id, exists: false, current: false, stated: false,
      slot: null, origin: null, content: "", recordedAt: "", validAt: "",
      strength: 0, endOfLife: false, topicLabels: [], replacedBy: null,
    };
  }
  const label = String(row.label ?? "");
  const content = String(row.content ?? "");
  return {
    kind: "node",
    id,
    exists: true,
    current: row.superseded_at === null && row.deleted_at === null,
    stated: isUserStatedNode(sqlite, id),
    slot: null,
    origin: null,
    content: content || label,
    recordedAt: String(row.created_at ?? ""),
    validAt: String(row.valid_from ?? row.created_at ?? ""),
    strength: Number(row.importance ?? 0),
    endOfLife: row.superseded_at !== null, // W1 already ended this side
    topicLabels: [...new Set(contentTokens(`${label} ${content}`))],
    replacedBy: row.superseded_by != null ? Number(row.superseded_by) : null,
  };
}

function parseJsonArray(v: unknown): string[] {
  if (typeof v !== "string") return [];
  try {
    const p = JSON.parse(v) as unknown;
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Relation + decision table (§5.3) — pure, deterministic, no LLM     */
/* ------------------------------------------------------------------ */

export type PairRelation = "same" | "contradicts" | "compatible" | "indeterminate";

export function pairRelation(a: SideFacts, b: SideFacts, category: string): PairRelation {
  // (The Milestone 1 category CHECK has no 'misc' value; indeterminate
  // relations from the ambiguous token band take the cell-0 path.)
  // The newer side's text is the candidate against the older side.
  const [older, newer] = a.recordedAt <= b.recordedAt ? [a, b] : [b, a];
  const verdict = detectContradiction(newer.content, {
    content: older.content,
    slot: (older.slot ?? "belief") as never,
  });
  if (verdict === "genuine_negation" || verdict === "explicit_transition") return "contradicts";
  const j = tokenJaccard(newer.content, older.content);
  if (verdict === "succession") return j >= 0.3 ? "compatible" : "indeterminate";
  if (j >= 0.8) return "same";
  // Ambiguous band: the texts neither prove sameness nor contradiction,
  // whatever the reporter claimed — the relation determination is
  // missing, so cell 0 defers rather than guessing.
  if (j >= 0.3) return "indeterminate";
  // Texts are dissimilar and no verdict fired: the reporter's category
  // is the remaining evidence (they may know more than tokens show).
  if (
    category === "factual_update" ||
    category === "false_belief" ||
    category === "state_transition" ||
    category === "preference_change"
  ) {
    return "contradicts";
  }
  if (category === "duplicate_claim") return "same";
  return "compatible";
}

export interface Decision {
  cell: string;
  outcome: string;
  /** Boundary/W1 mutation to apply, if any. */
  mutation?:
    | { kind: "InvalidateEntry"; entryId: number; reason: "superseded" | "stated_conflict" | "expired" }
    | { kind: "SetReviewFlag"; entryId: number; flag: "contradiction_pending" | "stale_emotion" }
    | { kind: "SupersedeNode"; oldNodeId: number; newNodeId: number }
    | { kind: "FlagNode"; nodeId: number };
  /** Create a §5.5 inquiry for the user. */
  inquiry?: boolean;
  /** Cell 0: a determination is missing; defer instead of deciding. */
  defer?: string;
}

/**
 * The §5.3 decision table. Inputs are the two sides' pre-fetched facts
 * plus the pair relation. `old`/`new` below follow the RECORD's sides;
 * winner/loser by recency is computed inside where the table says so.
 */
export function decidePair(
  oldSide: SideFacts,
  newSide: SideFacts,
  relation: PairRelation,
  category: string,
): Decision {
  const domain = oldSide.kind;
  // Missing determinations → cell 0.
  if (!oldSide.exists || !newSide.exists) return { cell: "#0", outcome: "deferred", defer: "side_missing" };
  if (relation === "indeterminate") return { cell: "#0", outcome: "deferred", defer: "relation" };

  // Cell 1: same proposition, compatible — consolidation target, never a
  // contradiction resolution, never an inquiry.
  if (relation === "same" || relation === "compatible") {
    return { cell: "#1", outcome: "compatible" };
  }

  // From here: relation === 'contradicts'.
  const [earlier, later] =
    oldSide.recordedAt <= newSide.recordedAt ? [oldSide, newSide] : [newSide, oldSide];

  if (domain === "user_model") {
    // Cell 8: end-of-life emotion vs successor determination.
    const emotionSide = [oldSide, newSide].find((s) => s.slot === "emotion_state" && s.endOfLife);
    if (emotionSide) {
      if (emotionSide.stated) {
        // Stated-origin emotions are NEVER auto-superseded (§5.3 cell 8
        // note) — they take the §6.3 flag path.
        return {
          cell: "#8",
          outcome: "emotion_superseded",
          mutation: { kind: "SetReviewFlag", entryId: emotionSide.id, flag: "stale_emotion" },
        };
      }
      return {
        cell: "#8",
        outcome: "emotion_superseded",
        mutation: { kind: "InvalidateEntry", entryId: emotionSide.id, reason: "expired" },
      };
    }
    if (oldSide.stated && newSide.stated) {
      // Cell 9: both user-stated.
      return { cell: "#9", outcome: "unresolved_asked", inquiry: true };
    }
    if (oldSide.stated !== newSide.stated) {
      const statedSide = oldSide.stated ? oldSide : newSide;
      const otherSide = oldSide.stated ? newSide : oldSide;
      if (otherSide.origin !== "consolidated") {
        // Cells 6/7 name the consolidated side; stated-vs-inferred is
        // outside the table → cell 0 (surfaces to the user on budget
        // exhaustion rather than auto-mutating).
        return { cell: "#0", outcome: "deferred", defer: "inferred_side_outside_table" };
      }
      if (statedSide === later) {
        // Cell 7: stated is NEWER — stated wins, consolidated invalidated.
        return {
          cell: "#7",
          outcome: "stated_wins_newer",
          mutation: { kind: "InvalidateEntry", entryId: otherSide.id, reason: "stated_conflict" },
        };
      }
      // Cell 6: stated is OLDER — flag the consolidated side, ask user.
      return {
        cell: "#6",
        outcome: "unresolved_flagged",
        mutation: { kind: "SetReviewFlag", entryId: otherSide.id, flag: "contradiction_pending" },
        inquiry: true,
      };
    }
    // Neither stated (both consolidated/inferred) — cells 2/3 analog.
    if (later.strength >= earlier.strength) {
      return {
        cell: "#2u",
        outcome: "newer_wins",
        mutation: { kind: "InvalidateEntry", entryId: earlier.id, reason: "superseded" },
      };
    }
    return {
      cell: "#3u",
      outcome: "older_retained",
      mutation: { kind: "SetReviewFlag", entryId: later.id, flag: "contradiction_pending" },
    };
  }

  // Nodes domain.
  if (oldSide.endOfLife || newSide.endOfLife) {
    // Cell 4: a side W1 already ended — it yields; nothing to mutate.
    return { cell: "#4", outcome: "end_of_life_yielded" };
  }
  if (oldSide.stated && newSide.stated) {
    // Cell 10: both user-stated (nodes).
    return { cell: "#10", outcome: "unresolved_asked", inquiry: true };
  }
  if (oldSide.stated !== newSide.stated) {
    const statedSide = oldSide.stated ? oldSide : newSide;
    const systemSide = oldSide.stated ? newSide : oldSide;
    if (statedSide === earlier) {
      // Cell 5: stated OLDER stands; ask the user.
      return { cell: "#5", outcome: "unresolved_user_confirmed", inquiry: true };
    }
    // Stated NEWER (table gap): stated stands, system side flagged,
    // no inquiry — the user's latest word already settled it.
    return {
      cell: "#5",
      outcome: "stated_stands",
      mutation: { kind: "FlagNode", nodeId: systemSide.id },
    };
  }
  // Both system-derived.
  if (later.strength >= earlier.strength) {
    // Cell 2: newer wins (stronger or equal) via the W1 writer.
    return {
      cell: "#2",
      outcome: "newer_wins",
      mutation: { kind: "SupersedeNode", oldNodeId: earlier.id, newNodeId: later.id },
    };
  }
  // Cell 3: older strictly stronger — retained; flag older for review.
  return {
    cell: "#3",
    outcome: "older_retained",
    mutation: { kind: "FlagNode", nodeId: earlier.id },
  };
}

/* ------------------------------------------------------------------ */
/* Inquiries (§5.5)                                                    */
/* ------------------------------------------------------------------ */

function inquiryQuestion(cell: string, a: SideFacts, b: SideFacts): string {
  const q = (s: string) => `'${s.length > 120 ? `${s.slice(0, 117)}…` : s}'`;
  switch (cell) {
    case "#5":
      return `You told me ${q(a.stated ? a.content : b.content)}. A derived note says ${q(a.stated ? b.content : a.content)}. Your statement stands — should I drop the derived note?`;
    case "#6":
      return `You told me ${q(a.stated ? a.content : b.content)}. Since then I've formed a belief that ${q(a.stated ? b.content : a.content)}. These seem to conflict — which should I keep?`;
    case "#7b":
      return `You recently confirmed ${q(a.stated ? a.content : b.content)}. I had a derived belief that ${q(a.stated ? b.content : a.content)}, which I've now removed.`;
    case "#9":
    case "#10":
      return `You've told me two things that seem to conflict: ${q(a.content)} and ${q(b.content)}. Which is right?`;
    default:
      return `Two beliefs seem to conflict: ${q(a.content)} and ${q(b.content)}. Which should I keep?`;
  }
}

/**
 * Create the §5.5 inquiry for a resolved record. Idempotent per record:
 * UNIQUE(space_id, contradiction_id) + ON CONFLICT DO NOTHING — resolved
 * records are never reprocessed, and a dismissed inquiry stays
 * dismissed (this is the ONLY inquiry-creation path for W3; the pair is
 * never re-filed, so no second inquiry can appear).
 */
export function createContradictionInquiry(
  sqlite: RawDb,
  spaceId: string,
  record: ContradictionRow,
  cell: string,
  a: SideFacts,
  b: SideFacts,
): number | null {
  const question = inquiryQuestion(cell, a, b);
  const nodeIds = [a, b].filter((s) => s.kind === "node").map((s) => s.id);
  const r = sqlite
    .prepare(
      `INSERT INTO inquiries (space_id, question, kind, node_ids, signature, status, contradiction_id)
       VALUES (?, ?, 'contradiction', ?, ?, 'open', ?)
       ON CONFLICT(space_id, contradiction_id) DO NOTHING`,
    )
    .run(spaceId, question, JSON.stringify(nodeIds), `w3-contra-${record.id}`, record.id);
  if (r.changes === 1) return Number(r.lastInsertRowid);
  const existing = sqlite
    .prepare(`SELECT id FROM inquiries WHERE space_id = ? AND contradiction_id = ?`)
    .get(spaceId, record.id) as { id: number } | undefined;
  return existing?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Candidate detection (§5.3 inputs over current rows)                 */
/* ------------------------------------------------------------------ */

interface UmPairRow {
  id: number;
  slot: string;
  content: string;
  topic_labels: string;
  origin: string;
}

function topicsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false; // indeterminate → never auto-file
  const set = new Set(a);
  return b.some((t) => set.has(t));
}

/**
 * Detect new contradiction candidates among CURRENT user_model rows:
 * same space + slot, topic overlap, both current, not already covered
 * by a live record. Files records (reported_by='consolidation').
 * Deterministic order; returns the number of records created.
 */
export function detectUserModelCandidates(sqlite: RawDb, spaceId: string): number {
  const rows = sqlite
    .prepare(
      `SELECT id, slot, content, topic_labels, origin FROM user_model
       WHERE space_id = ? AND invalid_at IS NULL ORDER BY slot, id`,
    )
    .all(spaceId) as UmPairRow[];
  let created = 0;
  const bySlot = new Map<string, UmPairRow[]>();
  for (const r of rows) {
    const list = bySlot.get(r.slot) ?? [];
    list.push(r);
    bySlot.set(r.slot, list);
  }
  for (const list of bySlot.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (!topicsOverlap(parseJsonArray(a.topic_labels), parseJsonArray(b.topic_labels))) continue;
        if (openRecordForPair(sqlite, spaceId, "user_model", a.id, b.id)) continue;
        const verdict = detectContradiction(b.content, { content: a.content, slot: a.slot as never });
        let category: string | null = null;
        if (verdict === "genuine_negation") category = "factual_update";
        else if (verdict === "explicit_transition") category = "state_transition";
        else if (tokenJaccard(a.content, b.content) >= 0.8) category = "duplicate_claim";
        if (!category) continue;
        const res = fileContradiction(sqlite, spaceId, {
          domain: "user_model",
          oldKind: "user_model",
          oldId: a.id,
          newKind: "user_model",
          newId: b.id,
          category,
          reportedBy: "consolidation",
        });
        if (res.created) created++;
      }
    }
  }
  return created;
}

/**
 * Detect new candidates among CURRENT nodes: same space, both current
 * (not superseded/deleted), token overlap, contradiction verdict or
 * near-duplicate. Bounded per call (deterministic order) — the run
 * continues next window if the cap is hit.
 */
export function detectNodeCandidates(sqlite: RawDb, spaceId: string, cap = 200): number {
  const rows = sqlite
    .prepare(
      `SELECT id, label, content FROM nodes
       WHERE space_id = ? AND superseded_at IS NULL AND deleted_at IS NULL
       ORDER BY id`,
    )
    .all(spaceId) as { id: number; label: string; content: string }[];
  let created = 0;
  let examined = 0;
  outer: for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (examined >= cap) break outer;
      const a = rows[i]!;
      const b = rows[j]!;
      const aText = `${a.label} ${a.content}`;
      const bText = `${b.label} ${b.content}`;
      const jaccard = tokenJaccard(aText, bText);
      if (jaccard < 0.3) continue;
      if (openRecordForPair(sqlite, spaceId, "nodes", a.id, b.id)) continue;
      examined++;
      const verdict = detectContradiction(bText, { content: aText, slot: "belief" });
      let category: string | null = null;
      if (verdict === "genuine_negation") category = "factual_update";
      else if (verdict === "explicit_transition") category = "state_transition";
      else if (jaccard >= 0.8) category = "duplicate_claim";
      if (!category) continue;
      const res = fileContradiction(sqlite, spaceId, {
        domain: "nodes",
        oldKind: "node",
        oldId: a.id,
        newKind: "node",
        newId: b.id,
        category,
        reportedBy: "consolidation",
      });
      if (res.created) created++;
    }
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* Phase B runner                                                      */
/* ------------------------------------------------------------------ */

export interface AdjudicationSummary {
  filed: number;
  claimed: number;
  resolved: number;
  deferred: number;
  moot: number;
  inquiriesCreated: number;
  mutationsApplied: number;
}

function audit(sqlite: RawDb, spaceId: string, action: string, description: string, targets: unknown): void {
  try {
    sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', ?, ?, ?, 'ok')`,
      )
      .run(spaceId, action, description, JSON.stringify(targets));
  } catch {
    // Audit is observability-grade.
  }
}

export interface AdjudicationRunContext {
  /** The boundary context for this run (shared budget ledger etc.). */
  boundary: ConsolidationRunContext;
  runId: number;
  fence: number;
  now?: Date;
}

/**
 * Run Phase B for one claimed run: detect candidates, claim records,
 * decide + apply each. All user_model mutations go through the §6.1
 * boundary; node supersession goes through the W1 writer. NO LLM.
 */
export async function runAdjudication(
  h: DbHandle,
  actx: AdjudicationRunContext,
): Promise<AdjudicationSummary> {
  const ctx = actx.boundary;
  const sqlite = h.sqlite;
  const spaceId = ctx.spaceId;
  const now = actx.now ?? new Date();
  const nowIso = now.toISOString();
  const summary: AdjudicationSummary = {
    filed: 0, claimed: 0, resolved: 0, deferred: 0, moot: 0,
    inquiriesCreated: 0, mutationsApplied: 0,
  };

  summary.filed += detectUserModelCandidates(sqlite, spaceId);
  summary.filed += detectNodeCandidates(sqlite, spaceId);

  const claimed = claimContradictions(sqlite, spaceId, actx.runId, actx.fence, now);
  summary.claimed = claimed.length;

  const invalidatedIds = new Set<string>(); // "kind:id" invalidated this phase

  for (const record of claimed) {
    const load = (kind: StoredKind, id: number): SideFacts =>
      kind === "user_model_entry"
        ? loadUserModelSide(sqlite, spaceId, id, now)
        : loadNodeSide(sqlite, spaceId, id);
    let a = load(record.old_kind, record.old_id);
    let b = load(record.new_kind, record.new_id);

    // A side no longer current (and not this record's own doing) → moot,
    // EXCEPT the cell-7 race (7b) and cell 4, which decide over exactly
    // that situation.
    const statedSide = a.stated ? a : b.stated ? b : null;
    const otherSide = statedSide === a ? b : a;
    const isRaceShape =
      record.domain === "user_model" &&
      statedSide !== null &&
      !statedSide.current &&
      statedSide.replacedBy !== null &&
      otherSide.current &&
      otherSide.origin === "consolidated";
    if ((!a.current || !b.current) && !isRaceShape) {
      // Nodes: a side ended by W1 since filing → cell 4 decides.
      if (!(record.domain === "nodes" && (a.endOfLife || b.endOfLife) && a.exists && b.exists)) {
        resolveRecord(sqlite, record.id, "moot", "#moot", nowIso, undefined, "moot");
        summary.moot++;
        summary.resolved++;
        continue;
      }
    }

    if (isRaceShape && statedSide) {
      // Cell 7b: the user re-stated/corrected this proposition while the
      // record was claimed — the user's later word prevails; the
      // consolidated side is invalidated with 'stated_conflict'
      // (Amendment 1's seven-value set has no 'stated_conflict_race';
      // the subcase is carried by rule_applied '#7b').
      const res = await applyConsolidationMutation(sqlite, ctx, {
        kind: "InvalidateEntry",
        entryId: otherSide.id,
        reason: "stated_conflict",
      });
      if (res.status === "applied") {
        summary.mutationsApplied++;
        invalidatedIds.add(`user_model:${otherSide.id}`);
      }
      const inquiryId = createContradictionInquiry(sqlite, spaceId, record, "#7b", a, b);
      if (inquiryId !== null) summary.inquiriesCreated++;
      resolveRecord(sqlite, record.id, "stated_wins_race", "#7b", nowIso, { inquiry_id: inquiryId }, "stated_conflict");
      summary.resolved++;
      continue;
    }

    const relation = pairRelation(a, b, record.category);
    const decision = decidePair(a, b, relation, record.category);

    if (decision.defer) {
      if (record.attempts + 1 >= MAX_DEFERRALS) {
        // Deferral budget exhausted: leave both sides untouched, resolve
        // unresolved, and ask the user (§5.3 cell 0).
        const inquiryId = createContradictionInquiry(sqlite, spaceId, record, "#0", a, b);
        if (inquiryId !== null) summary.inquiriesCreated++;
        resolveRecord(sqlite, record.id, "unresolved_deferred", "#0", nowIso, { inquiry_id: inquiryId }, "unresolved");
        summary.resolved++;
      } else {
        deferRecord(sqlite, record, decision.defer, now);
        summary.deferred++;
      }
      continue;
    }

    // Apply the decision's mutation.
    if (decision.mutation) {
      const m = decision.mutation;
      if (m.kind === "InvalidateEntry" || m.kind === "SetReviewFlag") {
        const res = await applyConsolidationMutation(
          sqlite,
          ctx,
          m.kind === "InvalidateEntry"
            ? { kind: "InvalidateEntry", entryId: m.entryId, reason: m.reason }
            : { kind: "SetReviewFlag", entryId: m.entryId, flag: m.flag },
        );
        if (res.status === "applied") {
          summary.mutationsApplied++;
          if (m.kind === "InvalidateEntry") invalidatedIds.add(`user_model:${m.entryId}`);
        } else if (res.error === "stated_state_changed" || res.error === "stated_protected") {
          // The world changed under the claim — re-decide next window
          // rather than forcing this decision through.
          deferRecord(sqlite, record, "stated_state_changed", now);
          summary.deferred++;
          continue;
        }
      } else if (m.kind === "SupersedeNode") {
        const out = supersedeSystemDerived(h, spaceId, {
          oldNodeId: m.oldNodeId,
          newNodeId: m.newNodeId,
        });
        if (out) {
          summary.mutationsApplied++;
          invalidatedIds.add(`node:${m.oldNodeId}`);
        }
      } else if (m.kind === "FlagNode") {
        audit(sqlite, spaceId, "w3_flagged_for_review",
          `w3 adjudication flagged node ${m.nodeId} for review (record ${record.id}, cell ${decision.cell})`,
          { node_id: m.nodeId, record_id: record.id, cell: decision.cell });
        summary.mutationsApplied++;
      }
    }

    let inquiryId: number | null = null;
    if (decision.inquiry) {
      // Re-read sides post-mutation for accurate question text.
      a = load(record.old_kind, record.old_id);
      b = load(record.new_kind, record.new_id);
      inquiryId = createContradictionInquiry(sqlite, spaceId, record, decision.cell, a, b);
      if (inquiryId !== null) summary.inquiriesCreated++;
    }
    resolveRecord(
      sqlite,
      record.id,
      decision.outcome,
      decision.cell,
      nowIso,
      { inquiry_id: inquiryId },
      decision.cell === "#7" ? "stated_conflict" : decision.inquiry ? "unresolved" : "resolved",
    );
    summary.resolved++;
  }

  // Superseded-record cleanup: any still-pending record whose pair
  // touches a side invalidated in this phase and is no longer
  // both-current is moot — it can never be decided over live rows again.
  if (invalidatedIds.size > 0) {
    const open = sqlite
      .prepare(
        `SELECT * FROM contradictions WHERE space_id = ? AND state = 'pending'`,
      )
      .all(spaceId) as ContradictionRow[];
    for (const row of open) {
      const touches = [row.old_kind, row.new_kind].some((kind, idx) =>
        invalidatedIds.has(`${fromStoredKind(kind)}:${idx === 0 ? row.old_id : row.new_id}`),
      );
      if (!touches) continue;
      const aNow = row.old_kind === "user_model_entry"
        ? loadUserModelSide(sqlite, spaceId, row.old_id, now)
        : loadNodeSide(sqlite, spaceId, row.old_id);
      const bNow = row.new_kind === "user_model_entry"
        ? loadUserModelSide(sqlite, spaceId, row.new_id, now)
        : loadNodeSide(sqlite, spaceId, row.new_id);
      if (!aNow.current || !bNow.current) {
        sqlite
          .prepare(
            `UPDATE contradictions SET state = 'moot', resolved_at = ?, resolution = ?
             WHERE id = ? AND state = 'pending'`,
          )
          .run(nowIso, JSON.stringify({ outcome: "moot", rule_applied: "#moot" }), row.id);
        summary.moot++;
      }
    }
  }

  return summary;
}
