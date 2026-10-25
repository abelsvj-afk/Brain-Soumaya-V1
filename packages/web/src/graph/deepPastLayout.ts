import type { GraphData, GraphNode, Journey, JourneyLinkSummary } from "@brain/shared";

/**
 * Deep Past layout (Phase 3, P3-2) — the pure function that turns the brain's
 * graph into the Deep Past's helix. No three.js here: this module is the
 * testable contract (C1 determinism, C2 identity traceability), and the
 * scene module renders exactly what it returns.
 *
 * Settled ground (P3-2 note, D-71; recipe-deep-past.md, D-26):
 * - Members exist for every node in the ELIGIBLE set (see isEligibleDeepPastNode)
 *   and reconcile against that set — never against all graph nodes.
 * - Membership (D-7) is age + meaningful resurfacing context, explainable in one
 *   plain line per member (P6, the `why` field). Age is the placement timestamp
 *   (`createdAt`, fallback `lastTendedAt`) in calendar years; a node whose age
 *   cannot be read is excluded, never guessed. Nothing is "forgotten" here.
 * - Depth is chronology, never a score: stratum = years kept − 1, clamped to the
 *   9 strata (0 = rim, the most recent members; 8 = basin, the oldest). Context
 *   determines membership and may bring a memory forward (the rise), but it can
 *   NEVER make a newer memory appear chronologically older (chronological
 *   monotonicity, R-D3). Importance, review strength, progress, emotional weight,
 *   and degree must NOT drive stratum, size, brightness, color, height, density,
 *   or thread emphasis — in this module or anywhere downstream.
 * - The rise (A22) is derived presentation only: a member whose context is warm
 *   (tended or linked within DEEP_PAST_WARM_DAYS) rests at the rim-side shelf
 *   while that context is warm; its stratum never changes, it never duplicates,
 *   and it returns to depth by the same rule that raised it.
 * - Anchors (D-8): an edge from a member to a non-member is a line of light rising
 *   out of the depth toward its other appearance. Edges between two members are not
 *   drawn (the helix's descent already connects them); edges between two non-members
 *   are omitted, never invented.
 * - The Chronicle thread (A21) exists only where a saved route exists: a done
 *   Journey's linked memories, in chronological order. The active route is the
 *   earliest done Journey (by id) with at least two member stops. No qualifying
 *   route → no thread, honestly.
 * - The Deep Past renders the graph data the app holds — the same window the home
 *   galaxy sees. It never fetches its own copy of the brain.
 */

export const DEEP_PAST_SEED = "deep-past / first-descent-1";

/** Recipe budget (R-D4 allocation): planned ceilings, asserted statically. */
export const DEEP_PAST_BUDGET = { maxDrawCalls: 90, maxTris: 440_000 } as const;

/** Strata: 0 = rim (members kept 1–2 years) … 8 = basin (9+ years). */
export const DEEP_PAST_STRATA_COUNT = 9;
/** A node must be kept more than a year to rest here (named, owner-correctable). */
export const DEEP_PAST_MIN_AGE_YEARS = 1;
/** Context stays warm for this long after a tend or a link (named, owner-correctable). */
export const DEEP_PAST_WARM_DAYS = 30;

/** Helix geometry (mockup ×5, to the garden's scale family): radius shrinks
 *  and depth grows toward the basin; the arc start twists 0.85 rad per stratum. */
export const DEEP_PAST_STRATUM_RADIUS = [440, 422.5, 405, 387.5, 370, 352.5, 335, 317.5, 300] as const;
export const DEEP_PAST_STRATUM_Y = [0, -90, -180, -270, -360, -450, -540, -630, -720] as const;
export const DEEP_PAST_STRATUM_ARC_START = 0.85;
export const DEEP_PAST_STRATUM_ARC_LENGTH = 4.4;
/** The First Light basin: the finished bottom (solid floor + rock below, C9). */
export const DEEP_PAST_BASIN_Y = -830;
export const DEEP_PAST_BASIN_RADIUS = 320;
/** The rim-side resting place for risen members (a finished stone platform). */
export const DEEP_PAST_RISE_SHELF = { x: 130, y: 30, z: 460 } as const;

export interface DeepPastMember {
  nodeId: number;
  /** What kind of thing this is — form only, never rank. */
  kind: string;
  /** A map-of-content hub: a gathering alcove standing for its member set. */
  gathering: boolean;
  /** Chronological home: 0 = rim … 8 = basin. Never changes with context. */
  stratum: number;
  /** Presentation position: the stratum alcove, or the rim shelf while risen. */
  x: number;
  y: number;
  z: number;
  /** Chronological alcove position (the thread's stops always use this, even risen). */
  homeX: number;
  homeY: number;
  homeZ: number;
  /** The rise (A22): warm context brought this member forward, in presentation only. */
  risen: boolean;
  riseReason: "tended recently" | "linked recently" | null;
  /** P6: one plain line naming the rule inputs that placed this member here. */
  why: string;
}

export interface DeepPastAnchor {
  edgeId: number;
  /** The member the line rises from. */
  fromNodeId: number;
  /** Its other appearance (a non-member node in the payload). */
  toNodeId: number;
}

export interface DeepPastThreadStop {
  routeId: number;
  nodeId: number;
  stratum: number;
  x: number;
  y: number;
  z: number;
}

export interface DeepPastThread {
  routeId: number;
  title: string;
  stops: DeepPastThreadStop[];
}

export interface DeepPastLayout {
  members: DeepPastMember[];
  anchors: DeepPastAnchor[];
  /** The active Chronicle route, or null when no done Journey qualifies. */
  thread: DeepPastThread | null;
  /** Members in the input graph (the set everything reconciles against). */
  eligibleCount: number;
  /** Nodes deliberately excluded (archived, too young, unreadable date). */
  excludedCount: number;
  /** Edges omitted because neither endpoint is a member. */
  omittedEdgeCount: number;
}

function hashSeeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The placement timestamp for a node: `createdAt`, falling back to
 * `lastTendedAt` (the garden's fallback chain). Null when neither is usable —
 * an age that cannot be read, and therefore a member that cannot be placed.
 */
export function placementTimestamp(node: GraphNode): Date | null {
  return parseDate(node.createdAt) ?? parseDate(node.lastTendedAt);
}

/** Stratum band for a placement timestamp, in the viewer's local calendar. */
export function stratumForDate(placedAt: Date | null, now: Date): number | null {
  if (!placedAt) return null;
  const yearsAgo = now.getFullYear() - placedAt.getFullYear();
  if (yearsAgo < DEEP_PAST_MIN_AGE_YEARS) return null;
  return Math.min(yearsAgo - DEEP_PAST_MIN_AGE_YEARS, DEEP_PAST_STRATA_COUNT - 1);
}

/**
 * Eligible member set: every node kind the shared type allows is a member
 * (form by kind), EXCEPT archived nodes (P4 — the archive wins everywhere)
 * and nodes too young to rest here (kept less than a year) or whose age
 * cannot be read. Nothing is excluded for age alone under a "forgotten"
 * label — that word does not exist in this space.
 */
export function isEligibleDeepPastNode(node: GraphNode, now: Date = new Date()): boolean {
  if (node.status === "archived") return false;
  return stratumForDate(placementTimestamp(node), now) !== null;
}

function alcovePosition(nodeId: number, stratum: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${DEEP_PAST_SEED}:${nodeId}`));
  const angle = stratum * DEEP_PAST_STRATUM_ARC_START + 0.25 + rand() * 3.9;
  const radius = DEEP_PAST_STRATUM_RADIUS[stratum]! - 15 - rand() * 35;
  return {
    x: Math.cos(angle) * radius,
    y: DEEP_PAST_STRATUM_Y[stratum]! + 8,
    z: Math.sin(angle) * radius,
  };
}

function shelfPosition(nodeId: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${DEEP_PAST_SEED}:rise:${nodeId}`));
  const angle = rand() * Math.PI * 2;
  const radius = 12 + rand() * 38;
  return {
    x: DEEP_PAST_RISE_SHELF.x + Math.cos(angle) * radius,
    y: DEEP_PAST_RISE_SHELF.y + 8,
    z: DEEP_PAST_RISE_SHELF.z + Math.sin(angle) * radius,
  };
}

/**
 * Warm context (the rise, A22): tended recently, or linked again recently.
 * Both signals are read from the payload the app already holds; a future
 * timestamp (clock skew) never counts as warm.
 */
function warmContext(
  node: GraphNode,
  touchingEdges: { createdAt: string }[],
  now: Date,
): "tended recently" | "linked recently" | null {
  const warmMs = DEEP_PAST_WARM_DAYS * 24 * 60 * 60 * 1000;
  const tended = parseDate(node.lastTendedAt);
  if (tended && now.getTime() >= tended.getTime() && now.getTime() - tended.getTime() <= warmMs) {
    return "tended recently";
  }
  for (const edge of touchingEdges) {
    const created = parseDate(edge.createdAt);
    if (created && now.getTime() >= created.getTime() && now.getTime() - created.getTime() <= warmMs) {
      return "linked recently";
    }
  }
  return null;
}

function whyLine(
  placedAt: Date,
  yearsAgo: number,
  stratum: number,
  riseReason: "tended recently" | "linked recently" | null,
  stillYear: number,
): string {
  const year = placedAt.getFullYear();
  if (riseReason === "tended recently") {
    return `Kept since ${year} — risen because you tended it recently; it rests at the rim while its context is warm, and returns to depth ${stratum + 1} of ${DEEP_PAST_STRATA_COUNT} when that cools.`;
  }
  if (riseReason === "linked recently") {
    return `Kept since ${year} — risen because it was linked again recently; it rests at the rim while its context is warm, and returns to depth ${stratum + 1} of ${DEEP_PAST_STRATA_COUNT} when that cools.`;
  }
  return `Kept since ${year} — ${yearsAgo} year${yearsAgo === 1 ? "" : "s"} old, quiet since ${stillYear}, resting at depth ${stratum + 1} of ${DEEP_PAST_STRATA_COUNT}.`;
}

/** Node ids a Journey link summary points at (memory links and task links only). */
function linkNodeIds(links: JourneyLinkSummary[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const link of links) {
    const id = link.kind === "node" ? link.refId : link.kind === "task" ? link.nodeRefId : undefined;
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function buildDeepPastLayout(
  graph: GraphData,
  journeys: Journey[],
  journeyLinks: Map<number, JourneyLinkSummary[]>,
  now: Date = new Date(),
): DeepPastLayout {
  // Canonical input ordering (C1): id-ascending before anything is derived,
  // so the same logical data in any arrival order lays out identically.
  const nodes = [...graph.nodes].sort((a, b) => a.id - b.id);
  const edges = [...graph.links].sort((a, b) => a.id - b.id);
  const touching = new Map<number, { createdAt: string }[]>();
  for (const edge of edges) {
    for (const endpoint of [edge.source, edge.target]) {
      const list = touching.get(endpoint) ?? [];
      list.push({ createdAt: edge.createdAt });
      touching.set(endpoint, list);
    }
  }

  const members: DeepPastMember[] = [];
  const memberById = new Map<number, DeepPastMember>();
  const placedAtMs = new Map<number, number>();
  for (const node of nodes) {
    if (node.status === "archived") continue;
    const placedAt = placementTimestamp(node);
    const stratum = stratumForDate(placedAt, now);
    if (placedAt === null || stratum === null) continue; // too young, or age unreadable: excluded, never guessed
    const yearsAgo = now.getFullYear() - placedAt.getFullYear();
    const still = parseDate(node.lastTendedAt) ?? placedAt;
    const riseReason = warmContext(node, touching.get(node.id) ?? [], now);
    const home = alcovePosition(node.id, stratum);
    const pos = riseReason ? shelfPosition(node.id) : home;
    const member: DeepPastMember = {
      nodeId: node.id,
      kind: node.kind ?? "memory",
      gathering: node.kind === "moc",
      stratum,
      ...pos,
      homeX: home.x,
      homeY: home.y,
      homeZ: home.z,
      risen: riseReason !== null,
      riseReason,
      why: whyLine(placedAt, yearsAgo, stratum, riseReason, still.getFullYear()),
    };
    members.push(member);
    memberById.set(node.id, member);
    placedAtMs.set(node.id, placedAt.getTime());
  }

  let omittedEdgeCount = 0;
  const anchors: DeepPastAnchor[] = [];
  for (const edge of edges) {
    const fromMember = memberById.has(edge.source);
    const toMember = memberById.has(edge.target);
    if (fromMember && toMember) continue; // the helix's descent already connects two members
    if (fromMember && !toMember) {
      anchors.push({ edgeId: edge.id, fromNodeId: edge.source, toNodeId: edge.target });
    } else if (!fromMember && toMember) {
      anchors.push({ edgeId: edge.id, fromNodeId: edge.target, toNodeId: edge.source });
    } else {
      omittedEdgeCount++;
    }
  }
  anchors.sort((a, b) => a.edgeId - b.edgeId);

  // The Chronicle thread (A21): the earliest done Journey (by id) whose linked
  // memories include at least two members, in chronological order (stratum,
  // then placement time, then id — so the thread always winds down).
  let thread: DeepPastThread | null = null;
  for (const journey of [...journeys].filter((j) => j.status === "done").sort((a, b) => a.id - b.id)) {
    const stops = linkNodeIds(journeyLinks.get(journey.id) ?? [])
      .map((nodeId) => memberById.get(nodeId))
      .filter((m): m is DeepPastMember => m !== undefined)
      .sort(
        (a, b) =>
          a.stratum - b.stratum ||
          (placedAtMs.get(a.nodeId) ?? 0) - (placedAtMs.get(b.nodeId) ?? 0) ||
          a.nodeId - b.nodeId,
      )
      .map((m) => ({
        routeId: journey.id,
        nodeId: m.nodeId,
        stratum: m.stratum,
        x: m.homeX,
        y: m.homeY,
        z: m.homeZ,
      }));
    if (stops.length >= 2) {
      thread = { routeId: journey.id, title: journey.title, stops };
      break;
    }
  }

  return {
    members,
    anchors,
    thread,
    eligibleCount: members.length,
    excludedCount: nodes.length - members.length,
    omittedEdgeCount,
  };
}
