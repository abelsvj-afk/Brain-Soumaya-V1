import type { GraphEdge, GraphNode } from "@brain/shared";
import type { GardenTend } from "../api/garden.js";

/**
 * Verb 1 — Tend a plot: the garden's warm glow and lit paths, as pure
 * helpers (no three.js, no DOM) so they are unit-testable.
 *
 * Warmth is presentation-only, additive, never a worse or dimmer state:
 * a tended plot glows gold for GARDEN_WARM_DAYS after the tend; an
 * untended plot looks exactly as it always did. The Stakes settlement
 * rejected soft decay and guilt — nothing dims, nothing is lost, nothing
 * expires; the glow simply stops being drawn after the window.
 *
 * A plot is warm when its lastTendedAt falls inside the window — the
 * same signal the cold/dormant lists read, so the garden and the
 * suggestion query can never disagree about what "tended recently" means.
 * A path is lit when a tend record links the two plots: a line tend
 * (new node → tended plot) or a link tend (tended plot → other memory),
 * within the same window.
 */

export const GARDEN_WARM_DAYS = 7;
const DAY_MS = 86_400_000;

/** Node ids whose plots glow gold (tended within the warm window). */
export function warmPlotNodeIds(
  nodes: GraphNode[],
  nowMs: number = Date.now(),
  warmDays: number = GARDEN_WARM_DAYS,
): Set<number> {
  const out = new Set<number>();
  for (const n of nodes) {
    const last = n.lastTendedAt ? Date.parse(n.lastTendedAt) : NaN;
    if (Number.isNaN(last)) continue;
    if (nowMs - last < warmDays * DAY_MS && nowMs - last >= 0) out.add(n.id);
  }
  return out;
}

/**
 * Edge ids whose paths light up: the edges a recent tend created or
 * reused. Line tends link the new node to the tended plot; link tends
 * link the tended plot to the other memory. A tend's edgeId is the
 * single source of truth — no re-derivation from graph shape.
 */
export function litPathEdgeIds(
  tends: GardenTend[],
  nowMs: number = Date.now(),
  warmDays: number = GARDEN_WARM_DAYS,
): Set<number> {
  const out = new Set<number>();
  for (const t of tends) {
    if (t.edgeId === null) continue;
    const at = Date.parse(t.createdAt);
    if (Number.isNaN(at)) continue;
    if (nowMs - at < warmDays * DAY_MS && nowMs - at >= 0) out.add(t.edgeId);
  }
  return out;
}

/** The edges of the lit set, looked up in the graph's own edge list. */
export function litPathEdges(edges: GraphEdge[], tends: GardenTend[], nowMs: number = Date.now()): GraphEdge[] {
  const lit = litPathEdgeIds(tends, nowMs);
  return edges.filter((e) => lit.has(e.id));
}
