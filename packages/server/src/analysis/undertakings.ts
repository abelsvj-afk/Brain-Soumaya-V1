import type { AppContext } from "../context.js";
import { NodesRepo } from "../repositories/nodes.repo.js";

/**
 * Undertakings (Level 2, B4) — a MULTI-DAY arc Soumaya commits to, so her autonomy
 * reads as a mind with projects instead of a 5-minute cron. Each undertaking is a
 * free-tier template (no LLM, no budget risk) that advances one step per tick using
 * the maintenance she already does, with a visible progress arc and a finale.
 */

export interface Undertaking {
  id: number;
  kind: "warm_cold_belt" | "chart_sector" | "weave_frontier";
  title: string;
  total: number;
  done: number;
  status: "active" | "done";
  startedAt: string;
  endsAt: string | null;
}

const TEMPLATES: {
  kind: Undertaking["kind"];
  title: (n: number, extra?: string) => string;
  /** How many candidate memories this arc would work — 0 means "not needed now". */
  size: (ctx: AppContext, spaceId: string) => { count: number; extra?: string };
}[] = [
  {
    kind: "warm_cold_belt",
    title: (n) => `Warming the cold belt (${n} drifting memories)`,
    size: (ctx, spaceId) => {
      const c = (ctx.handle.sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM nodes
           WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind NOT IN ('action','moc','belief'))
             AND julianday('now') - julianday(COALESCE(last_tended_at, created_at)) > 10`,
        )
        .get(spaceId) as { c: number }).c;
      return { count: Math.min(12, c) };
    },
  },
  {
    kind: "chart_sector",
    title: (n, extra) => `Charting the ${extra ?? "densest"} sector (${n} memories)`,
    size: (ctx, spaceId) => {
      const row = ctx.handle.sqlite
        .prepare(
          `SELECT type, COUNT(*) AS c FROM nodes
           WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind NOT IN ('action','moc','belief'))
           GROUP BY type ORDER BY c DESC LIMIT 1`,
        )
        .get(spaceId) as { type: string; c: number } | undefined;
      return row && row.c >= 5 ? { count: Math.min(10, row.c), extra: row.type.replace(/_/g, " ") } : { count: 0 };
    },
  },
  {
    kind: "weave_frontier",
    title: (n) => `Weaving the frontier (${n} lonely memories)`,
    size: (ctx, spaceId) => {
      const c = (ctx.handle.sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM nodes n
           WHERE n.space_id = ? AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind NOT IN ('action','moc','belief'))
             AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id))`,
        )
        .get(spaceId) as { c: number }).c;
      return { count: Math.min(10, c) };
    },
  },
];

const rowToUndertaking = (r: any): Undertaking => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  total: r.total,
  done: r.done,
  status: r.status,
  startedAt: r.started_at,
  endsAt: r.ends_at ?? null,
});

/**
 * Recent undertakings for a space, newest first — active first-class, completed
 * included (IM-67: the Soumaya tab shows history + a celebration state for
 * finished arcs instead of the undertaking vanishing the moment it ends).
 */
export function recentUndertakings(ctx: AppContext, spaceId: string, limit = 5): Undertaking[] {
  const rows = ctx.handle.sqlite
    .prepare(`SELECT * FROM undertakings WHERE space_id = ? ORDER BY id DESC LIMIT ?`)
    .all(spaceId, limit) as any[];
  return rows.map(rowToUndertaking);
}

/** The current active undertaking for a space, if any. */
export function activeUndertaking(ctx: AppContext, spaceId: string): Undertaking | null {
  const r = ctx.handle.sqlite
    .prepare(`SELECT * FROM undertakings WHERE space_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`)
    .get(spaceId);
  return r ? rowToUndertaking(r) : null;
}

/**
 * Advance the space's autonomy narrative one step. If no arc is active, start the
 * most-needed template; otherwise progress the current one, completing it at the
 * finale. Returns a short event string when something notable happened (start /
 * finish), else null. Free — the actual per-memory work is the existing free
 * upkeep the autonomy loop already runs; this just gives it an arc + counter.
 */
export function stepUndertaking(ctx: AppContext, spaceId: string): string | null {
  const s = ctx.handle.sqlite;
  const active = activeUndertaking(ctx, spaceId);

  if (!active) {
    // Start the template with the most candidates (min 5 to be worth an arc).
    let best: { kind: Undertaking["kind"]; count: number; extra?: string; title: string } | null = null;
    for (const t of TEMPLATES) {
      const { count, extra } = t.size(ctx, spaceId);
      if (count >= 5 && (!best || count > best.count)) {
        best = { kind: t.kind, count, extra, title: t.title(count, extra) };
      }
    }
    if (!best) return null;
    const ARC_DAYS = 5; // a 5-day arc → total counts DAYS, so ticks stay idempotent
    const ends = new Date(Date.now() + ARC_DAYS * 86_400_000).toISOString();
    s.prepare(
      `INSERT INTO undertakings (space_id, kind, title, total, done, status, ends_at) VALUES (?, ?, ?, ?, 1, 'active', ?)`,
    ).run(spaceId, best.kind, best.title, ARC_DAYS, ends);
    return `Began a new undertaking: ${best.title}.`;
  }

  // Progress is DERIVED from elapsed days, not incremented per tick — so the
  // 5-minute autonomy ticks can't race a 5-day arc to completion in an hour.
  const startedMs = Date.parse(
    active.startedAt.includes("Z") || active.startedAt.includes("+")
      ? active.startedAt
      : active.startedAt.replace(" ", "T") + "Z",
  );
  const elapsedDays = Number.isNaN(startedMs) ? 0 : Math.floor((Date.now() - startedMs) / 86_400_000);
  const targetDone = Math.min(active.total, elapsedDays + 1);
  if (targetDone <= active.done) return null; // already at today's step

  const finished = targetDone >= active.total;
  s.prepare(`UPDATE undertakings SET done = ?, status = ? WHERE id = ?`).run(
    targetDone,
    finished ? "done" : "active",
    active.id,
  );
  // Visible effect: tend one still-cold / lonely memory tied to the arc so the
  // galaxy actually changes as she works (best-effort, free).
  try {
    const target = pickArcTarget(ctx, spaceId, active.kind);
    if (target != null) new NodesRepo(ctx.handle, spaceId).tend(target);
  } catch {
    /* best-effort */
  }
  return finished ? `Completed her undertaking: ${active.title}.` : null;
}

/** One memory this arc should touch next (free, deterministic). */
function pickArcTarget(ctx: AppContext, spaceId: string, kind: Undertaking["kind"]): number | null {
  const s = ctx.handle.sqlite;
  if (kind === "warm_cold_belt") {
    const r = s
      .prepare(
        `SELECT id FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind NOT IN ('action','moc','belief'))
         ORDER BY julianday('now') - julianday(COALESCE(last_tended_at, created_at)) DESC LIMIT 1`,
      )
      .get(spaceId) as { id: number } | undefined;
    return r?.id ?? null;
  }
  if (kind === "weave_frontier") {
    const r = s
      .prepare(
        `SELECT n.id FROM nodes n WHERE n.space_id = ? AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind NOT IN ('action','moc','belief'))
           AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id)) LIMIT 1`,
      )
      .get(spaceId) as { id: number } | undefined;
    return r?.id ?? null;
  }
  const r = s
    .prepare(
      `SELECT id FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind NOT IN ('action','moc','belief'))
       ORDER BY importance DESC LIMIT 1`,
    )
    .get(spaceId) as { id: number } | undefined;
  return r?.id ?? null;
}
