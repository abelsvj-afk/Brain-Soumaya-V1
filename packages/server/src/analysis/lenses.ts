import type { AppContext } from "../context.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { keywordSearch } from "../db/fts.js";
import { dueForReview } from "./review.js";
import type { LensQuery } from "@brain/shared";

/**
 * Lens evaluator (Smart Lenses). Turns a saved `LensQuery` into the set of node ids the
 * galaxy should isolate to — a single deterministic, space-scoped SQL SELECT over
 * `nodes` (with small joins for `linkedTo`, `text`, and lifecycle lenses). No LLM. Every
 * predicate is optional and AND-ed; an empty query returns all non-archived bodies.
 *
 * Batch H (REG-208 / CN-09): evaluation has three ceilings — the FTS leg (500),
 * the due leg (500), and the final SELECT (2000) — and all three used to be
 * silent: a 2,400-match lens showed "2000" everywhere, dressed exactly like a
 * lens that truly matches 2,000. `evalLensDetailed` now returns the TRUE total
 * alongside the capped id list, plus one flag per cap, so the count, the
 * preview, and the isolate can each say when they are showing a subset. The
 * caps themselves are the documented bound (LENS_EVAL_CAPS), not a hidden one.
 */

const EMOTION_THRESHOLD = 0.12; // matches theme.ts emotionKind

/** The three evaluation ceilings, in one place, so the disclosure and the
 *  bound can never drift apart. 2000 is generous headroom above every other
 *  cap in this file and far past where an "isolate" view stays legible. */
export const LENS_EVAL_CAPS = { fts: 500, due: 500, final: 2000 } as const;

export interface LensEvalCaps {
  fts: number;
  due: number;
  final: number;
}

export interface LensEvalResult {
  /** The capped id list — what the isolate actually shows (<= `total`). */
  ids: number[];
  /** The TRUE match count. Exact unless an inner leg capped first (see
   *  `totalIsLowerBound`), in which case it is a lower bound. */
  total: number;
  /** Any cap truncated the set. */
  capped: boolean;
  /** The text leg matched more than `caps.fts` FTS ids. */
  ftsCapped: boolean;
  /** The due leg matched more than `caps.due` due memories. */
  dueCapped: boolean;
  /** The final SELECT matched more than `caps.final` rows. */
  finalCapped: boolean;
  /** An inner (FTS/due) leg capped first, so `total` is a floor, not exact. */
  totalIsLowerBound: boolean;
}

/** Emotional charge in that node's mood matches the requested band. */
function emotionClause(band: "positive" | "heavy" | "neutral"): string {
  if (band === "positive") return `AND n.emotional_weight > ${EMOTION_THRESHOLD}`;
  if (band === "heavy") return `AND n.emotional_weight < ${-EMOTION_THRESHOLD}`;
  return `AND n.emotional_weight IS NOT NULL AND n.emotional_weight BETWEEN ${-EMOTION_THRESHOLD} AND ${EMOTION_THRESHOLD}`;
}

const EMPTY_RESULT: LensEvalResult = {
  ids: [],
  total: 0,
  capped: false,
  ftsCapped: false,
  dueCapped: false,
  finalCapped: false,
  totalIsLowerBound: false,
};

export function evalLensDetailed(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
  query: LensQuery = {},
  now: number = Date.now(),
  capsIn: LensEvalCaps = LENS_EVAL_CAPS,
): LensEvalResult {
  const s = ctx.handle.sqlite;
  // Caps arrive from the documented constant (or a test override) — never
  // from user input — but keep the LIMIT interpolation integer-safe anyway.
  const caps: LensEvalCaps = {
    fts: Math.max(1, Math.floor(capsIn.fts)),
    due: Math.max(1, Math.floor(capsIn.due)),
    final: Math.max(1, Math.floor(capsIn.final)),
  };
  const where: string[] = [`n.space_id = ?`, `n.deleted_at IS NULL`];
  const params: unknown[] = [spaceId];
  let ftsCapped = false;
  let dueCapped = false;

  // Lifecycle lens (mutually-exclusive states).
  const state = query.state ?? "active";
  if (state === "archived") {
    where.push(`n.status = 'archived'`);
  } else {
    where.push(`n.status != 'archived'`); // active / due / orphan all exclude archived
    if (state === "orphan") {
      where.push(
        `NOT EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id))`,
      );
    }
    if (state === "due") {
      // Probe one past the cap: exactly `caps.due` rows may mean "exactly that
      // many due", or "at least that many" — only the +1 probe tells them apart.
      const dueIds = dueForReview(ctx, spaceId, now, caps.due + 1).map((r) => r.id);
      if (dueIds.length === 0) return { ...EMPTY_RESULT };
      if (dueIds.length > caps.due) {
        dueCapped = true;
        dueIds.length = caps.due;
      }
      where.push(`n.id IN (${dueIds.map(() => "?").join(",")})`);
      params.push(...dueIds);
    }
  }

  // Kind / type filter — matches either the celestial `type` or the cognitive `kind`.
  if (query.kinds && query.kinds.length > 0) {
    const ph = query.kinds.map(() => "?").join(",");
    where.push(`(n.type IN (${ph}) OR n.kind IN (${ph}))`);
    params.push(...query.kinds, ...query.kinds);
  }

  // Tags — any-of (tags is a JSON array string; a LIKE on the quoted token is enough).
  if (query.tags && query.tags.length > 0) {
    const ors = query.tags.map(() => `n.tags LIKE ?`);
    where.push(`(${ors.join(" OR ")})`);
    for (const t of query.tags) params.push(`%"${t}"%`);
  }

  if (query.emotion) where.push(emotionClause(query.emotion).replace(/^AND /, ""));

  if (typeof query.minImportance === "number") {
    where.push(`COALESCE(n.importance, 0) >= ?`);
    params.push(query.minImportance);
  }

  if (typeof query.withinDays === "number") {
    where.push(`julianday('now') - julianday(COALESCE(n.occurred_at, n.created_at)) <= ?`);
    params.push(query.withinDays);
  }

  if (typeof query.linkedTo === "number") {
    where.push(
      `EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id
        AND ((e.source = ? AND e.target = n.id) OR (e.target = ? AND e.source = n.id)))`,
    );
    params.push(query.linkedTo, query.linkedTo);
  }

  // Full-text keyword — resolve to ids via FTS, then constrain (empty match → empty lens).
  // Probe one past the cap, as for the due leg: a full page of FTS ids is
  // ambiguous between "exactly that many" and "at least that many".
  if (query.text && query.text.trim()) {
    const ids = keywordSearch(s, spaceId, query.text.trim(), caps.fts + 1).map((r) => r.nodeId);
    if (ids.length === 0) return { ...EMPTY_RESULT };
    if (ids.length > caps.fts) {
      ftsCapped = true;
      ids.length = caps.fts;
    }
    where.push(`n.id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }

  const whereSql = where.join(" AND ");
  // The true total: the same WHERE, no ORDER, no LIMIT. When an inner leg
  // capped first this counts the truncated leg, so it is a lower bound.
  const total = (
    s.prepare(`SELECT COUNT(*) AS c FROM nodes n WHERE ${whereSql}`).get(...params) as { c: number }
  ).c;
  const finalCapped = total > caps.final;
  // Safety cap, not a real-world limit — a lens is meant to match everything that
  // qualifies, but an unbounded scan over a years-old, thousands-of-memories brain
  // is an unforced cost. 2000 is generous headroom above every other cap in this
  // file (keywordSearch's 500) and far past where an "isolate" view stays legible.
  const rows = s
    .prepare(
      `SELECT n.id FROM nodes n WHERE ${whereSql}
       ORDER BY COALESCE(n.importance, 0) DESC, n.id DESC LIMIT ${caps.final}`,
    )
    .all(...params) as { id: number }[];
  const ids = rows.map((r) => r.id);
  const totalIsLowerBound = ftsCapped || dueCapped;
  return {
    ids,
    total,
    capped: ftsCapped || dueCapped || finalCapped,
    ftsCapped,
    dueCapped,
    finalCapped,
    totalIsLowerBound,
  };
}

export function evalLens(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
  query: LensQuery = {},
  now: number = Date.now(),
): number[] {
  return evalLensDetailed(ctx, spaceId, query, now).ids;
}
