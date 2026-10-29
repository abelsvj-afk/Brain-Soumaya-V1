import type { GraphEdge, GraphNode } from "@brain/shared";
import type { AppContext } from "../context.js";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { EconomyRepo, EARN_MIND, EARN_MIND_DAILY_CAP, claimDailyEarn } from "../economy.js";
import { spaceTimezone, localDay } from "../agent/notify/policy.js";
import { DORMANT_DAYS } from "./dormant.js";

/**
 * Verb 1 — Tend a plot (Growing Place). Game-loop design of record:
 * `~/workspace/soumaya-readonly-audit/GAME-LOOP-FOUR-VERBS-2026-10-26.md`.
 *
 * A tend is a real brain action, never an animation-only button:
 * - line: a new memory node holding the added line, linked to the tended plot.
 * - link: a new edge between the tended plot and another memory.
 * - affirm: a recorded judgment — still true, or changed since.
 * - visit: warming only — sit with it. Earns nothing, by design.
 *
 * Fuel (settled mapping, verified against the code): tending with a line,
 * link, or affirmation earns as Mind work — EARN_MIND (+6) — under the
 * existing Mind 10/day server cap (claimDailyEarn "mind", the same pool
 * Mind-entry creation draws from). A visit earns 0. There is NO age gate
 * on Mind earns: the ≥10-minute gate (ACTION_DONE_MIN_AGE_MINUTES) applies
 * only to action completion (see economy.ts actionEarnsFuel); the build
 * brief's suggestion of a Mind age gate does not exist in code, so none
 * is invented here. Past the cap the tend still happens and still warms —
 * it pays 0. The streak is untouched: the existing tend primitive
 * (POST /api/nodes/:id/tend) does not touch it either.
 *
 * Warming: every mode updates the node's last_tended_at through the
 * existing NodesRepo.tend() (which also clears a Recall nudge snooze,
 * REG-198), so the cold/dormant signals read a tended memory as warm.
 * The tend itself is recorded in garden_tends — the durable history
 * behind the garden's warm glow and lit paths.
 *
 * Soumaya notes the tend in the galaxy: one content-free agent_logs row
 * (action 'garden_tend', templated description, node ids only — never
 * user text), visible in the Soumaya activity log.
 */

export type TendKind = "line" | "link" | "affirm" | "visit";

export interface GardenSuggestion {
  nodeId: number;
  label: string;
  /** Which of the three suggestion slots this fills. */
  slot: "coldest" | "most-linked" | "oldest";
  /** One plain line for why — never a score, never guilt. */
  why: string;
  quietDays: number;
  /** Link count (most-linked slot only). */
  degree?: number;
  /** Age in days (oldest slot only). */
  ageDays?: number;
}

export interface GardenTendRecord {
  id: number;
  nodeId: number;
  kind: TendKind;
  targetNodeId: number | null;
  edgeId: number | null;
  changed: boolean | null;
  createdAt: string;
}

export interface TendInput {
  nodeId: number;
  mode: TendKind;
  /** The added line (mode "line"). */
  text?: string;
  /** The memory to link to (mode "link"). */
  targetId?: number;
  /** The affirmation judgment (mode "affirm"): true = changed since. */
  changed?: boolean;
}

export type TendResult =
  | {
      ok: true;
      node: GraphNode;
      tend: GardenTendRecord;
      fuelEarned: number;
      fuel: number;
      newNodeId?: number;
      edgeId?: number;
      /** True when the link already existed — warmed and recorded, paid 0. */
      alreadyLinked?: boolean;
    }
  | { ok: false; error: string };

const DAY_MS = 86_400_000;

function parseMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function quietDaysOf(n: GraphNode, nowMs: number): number {
  const last = parseMs(n.lastTendedAt ?? n.createdAt);
  if (!last) return 0;
  return Math.max(0, Math.floor((nowMs - last) / DAY_MS));
}

function ageDaysOf(n: GraphNode, nowMs: number): number {
  const born = parseMs(n.createdAt);
  if (!born) return 0;
  return Math.max(0, Math.floor((nowMs - born) / DAY_MS));
}

function quietPhrase(days: number): string {
  if (days <= 0) return "tended today";
  return days === 1 ? "quiet for 1 day" : `quiet for ${days} days`;
}

/**
 * The three suggestions Soumaya makes on arrival in Growing Place:
 * the coldest plot, the most-linked-but-untended plot, and the oldest
 * untended plot. "Untended" reuses the dormant threshold (DORMANT_DAYS):
 * quiet for 30 days or more. A slot with no untended candidate falls
 * back to the coldest remaining plot by its own criterion — the why-line
 * always states the true numbers, never claims "untended" when it isn't.
 * Ignored suggestions (shown last visit, not picked) arrive as
 * excludeIds and are never suggested twice in a row; if exclusion leaves
 * fewer than three, fewer are returned — never a fake suggestion.
 * Pure function: no I/O, deterministic (ties break by lower node id).
 */
export function suggestGardenPlots(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nowMs: number = Date.now(),
  excludeIds: number[] = [],
): GardenSuggestion[] {
  const excluded = new Set(excludeIds);
  const eligible = nodes.filter((n) => n.status !== "archived" && !excluded.has(n.id));
  if (eligible.length === 0) return [];

  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const quiet = new Map<number, number>();
  const age = new Map<number, number>();
  for (const n of eligible) {
    quiet.set(n.id, quietDaysOf(n, nowMs));
    age.set(n.id, ageDaysOf(n, nowMs));
  }
  const untended = eligible.filter((n) => (quiet.get(n.id) ?? 0) >= DORMANT_DAYS);

  const picked = new Set<number>();
  const out: GardenSuggestion[] = [];

  // Slot 1 — the coldest: longest since anyone tended it.
  const coldest = [...eligible].sort(
    (a, b) => (quiet.get(b.id) ?? 0) - (quiet.get(a.id) ?? 0) || a.id - b.id,
  )[0];
  if (coldest) {
    const q = quiet.get(coldest.id) ?? 0;
    picked.add(coldest.id);
    out.push({
      nodeId: coldest.id,
      label: coldest.label,
      slot: "coldest",
      why: q <= 0 ? "tended today — still warm" : `gone quiet for ${q} day${q === 1 ? "" : "s"}`,
      quietDays: q,
    });
  }

  // Slot 2 — the most-linked-but-untended: the best-connected quiet plot.
  const linkPool = (untended.length > 0 ? untended : eligible).filter((n) => !picked.has(n.id));
  const linked = [...linkPool].sort(
    (a, b) =>
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      (quiet.get(b.id) ?? 0) - (quiet.get(a.id) ?? 0) ||
      a.id - b.id,
  )[0];
  if (linked) {
    const q = quiet.get(linked.id) ?? 0;
    const d = degree.get(linked.id) ?? 0;
    picked.add(linked.id);
    out.push({
      nodeId: linked.id,
      label: linked.label,
      slot: "most-linked",
      why: `${d} link${d === 1 ? "" : "s"}, ${quietPhrase(q)}`,
      quietDays: q,
      degree: d,
    });
  }

  // Slot 3 — the oldest untended: the earliest-planted quiet plot.
  const oldPool = (untended.length > 0 ? untended : eligible).filter((n) => !picked.has(n.id));
  const oldest = [...oldPool].sort(
    (a, b) => parseMs(a.createdAt) - parseMs(b.createdAt) || a.id - b.id,
  )[0];
  if (oldest) {
    const a = age.get(oldest.id) ?? 0;
    const why =
      a === 365
        ? "a year old today"
        : a > 365
          ? `${Math.floor(a / 365)} year${Math.floor(a / 365) === 1 ? "" : "s"} old`
          : a <= 0
            ? "planted today"
            : `planted ${a} days ago`;
    picked.add(oldest.id);
    out.push({
      nodeId: oldest.id,
      label: oldest.label,
      slot: "oldest",
      why,
      quietDays: quiet.get(oldest.id) ?? 0,
      ageDays: a,
    });
  }

  return out;
}

/** Tend acts in the warm window (newest first) — the garden's lit paths. */
export function listRecentGardenTends(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  days = 7,
  nowMs: number = Date.now(),
): GardenTendRecord[] {
  const since = new Date(nowMs - days * DAY_MS).toISOString();
  const rows = h.sqlite
    .prepare(
      `SELECT id, node_id AS nodeId, kind, target_node_id AS targetNodeId,
              edge_id AS edgeId, changed, created_at AS createdAt
         FROM garden_tends
        WHERE space_id = ? AND created_at >= ?
        ORDER BY created_at DESC`,
    )
    .all(spaceId, since) as {
    id: number;
    nodeId: number;
    kind: string;
    targetNodeId: number | null;
    edgeId: number | null;
    changed: number | null;
    createdAt: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    kind: r.kind as TendKind,
    targetNodeId: r.targetNodeId,
    edgeId: r.edgeId,
    changed: r.changed === null ? null : r.changed !== 0,
    createdAt: r.createdAt,
  }));
}

function findEdgeId(h: DbHandle, spaceId: string, a: number, b: number): number | null {
  const row = h.sqlite
    .prepare(
      `SELECT id FROM edges WHERE space_id = ?
         AND ((source = ? AND target = ?) OR (source = ? AND target = ?))
       ORDER BY id ASC LIMIT 1`,
    )
    .get(spaceId, a, b, b, a) as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Perform one tend. Brain change first, record second, fuel last — so a
 * tend that changes the brain is never lost to a fuel failure, and fuel
 * is never paid for a tend that didn't happen.
 */
export async function tendGardenPlot(
  ctx: AppContext,
  spaceId: string,
  input: TendInput,
): Promise<TendResult> {
  const h = ctx.handle;
  const nodes = new NodesRepo(h, spaceId);
  const node = nodes.getById(input.nodeId);
  if (!node) return { ok: false, error: "not_found" };

  const econ = new EconomyRepo(h, spaceId);
  let newNodeId: number | undefined;
  let edgeId: number | undefined;
  let alreadyLinked = false;
  let earns = false;

  if (input.mode === "line") {
    const text = (input.text ?? "").trim();
    if (!text) return { ok: false, error: "text_required" };
    if (text.length > 2000) return { ok: false, error: "text_too_long" };
    const vec = await ctx.embeddings.embed(text);
    const label = text.split(/\s+/).slice(0, 6).join(" ") || "A line added while tending";
    const created = nodes.create(
      { label, type: "daily", content: text, importance: 0.5 },
      vec,
    );
    newNodeId = created.id;
    const edge = new EdgesRepo(h, spaceId).create({
      source: created.id,
      target: input.nodeId,
      relationship: "relates_to",
      weight: 0.85,
    });
    edgeId = edge.id;
    earns = true;
  } else if (input.mode === "link") {
    const targetId = input.targetId;
    if (targetId === undefined || !Number.isInteger(targetId)) return { ok: false, error: "target_required" };
    if (targetId === input.nodeId) return { ok: false, error: "same_node" };
    if (!nodes.getById(targetId)) return { ok: false, error: "target_not_found" };
    const existing = findEdgeId(h, spaceId, input.nodeId, targetId);
    if (existing !== null) {
      // Already linked: the tend still warms and is recorded, but no new
      // edge exists, so no fuel — paying for a link that changed nothing
      // would be a relink farm.
      edgeId = existing;
      alreadyLinked = true;
    } else {
      const edge = new EdgesRepo(h, spaceId).create({
        source: input.nodeId,
        target: targetId,
        relationship: "relates_to",
        weight: 0.85,
      });
      edgeId = edge.id;
      earns = true;
    }
  } else if (input.mode === "affirm") {
    if (typeof input.changed !== "boolean") return { ok: false, error: "changed_required" };
    earns = true;
  } else if (input.mode === "visit") {
    earns = false;
  } else {
    return { ok: false, error: "bad_mode" };
  }

  // Warm the plot: the existing tend primitive (also clears a Recall
  // nudge snooze, REG-198 — the user followed the nudge by visiting).
  nodes.tend(input.nodeId);

  // The durable record.
  const inserted = h.sqlite
    .prepare(
      `INSERT INTO garden_tends (space_id, node_id, kind, target_node_id, edge_id, changed)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      spaceId,
      input.nodeId,
      input.mode,
      input.mode === "line" ? (newNodeId ?? null) : input.mode === "link" ? (input.targetId ?? null) : null,
      edgeId ?? null,
      input.mode === "affirm" ? (input.changed ? 1 : 0) : null,
    );
  const tend: GardenTendRecord = {
    id: Number(inserted.lastInsertRowid),
    nodeId: input.nodeId,
    kind: input.mode,
    targetNodeId:
      input.mode === "line" ? (newNodeId ?? null) : input.mode === "link" ? (input.targetId ?? null) : null,
    edgeId: edgeId ?? null,
    changed: input.mode === "affirm" ? (input.changed ?? null) : null,
    createdAt: new Date().toISOString(),
  };

  // Fuel: Mind work, same 10/day pool as Mind-entry creation. Past the
  // cap the tend still happened — it pays 0, and the plot is still warm.
  let fuelEarned = 0;
  let fuel = econ.get();
  if (earns && !alreadyLinked) {
    const day = localDay(new Date(), spaceTimezone(h.sqlite, spaceId));
    if (claimDailyEarn(h, spaceId, day, "mind", EARN_MIND_DAILY_CAP)) {
      fuel = econ.add(EARN_MIND);
      fuelEarned = EARN_MIND;
    }
  }

  // Soumaya notes the tend in the galaxy: one content-free agent_logs
  // row (templated description, ids only — never user text).
  h.sqlite
    .prepare(
      `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
       VALUES (?, 'soumaya', 'garden_tend', ?, ?, 'ok')`,
    )
    .run(
      spaceId,
      `garden tend: ${input.mode}${alreadyLinked ? " (already linked)" : ""}`,
      JSON.stringify({ nodeId: input.nodeId, kind: input.mode, newNodeId: newNodeId ?? null, edgeId: edgeId ?? null }),
    );

  const updated = nodes.getById(input.nodeId) ?? node;
  return { ok: true, node: updated, tend, fuelEarned, fuel, newNodeId, edgeId, alreadyLinked };
}
