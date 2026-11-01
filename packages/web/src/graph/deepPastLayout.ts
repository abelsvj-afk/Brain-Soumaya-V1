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

/**
 * Performance budget (2026-10-29 rework design note §9): planned ceilings,
 * asserted statically, set at the pre-asset generated scene's weight class.
 * Points get their own cap because the supernova's star cloud is points,
 * not triangles; generated triangles and GLB bytes are capped separately
 * so a singular kept piece can never hide inside the whole-scene total.
 */
export const DEEP_PAST_BUDGET = {
  maxDrawCalls: 48,
  maxTris: 195_000,
  maxPoints: 65_000,
  maxGeneratedTris: 45_000,
  maxGlbBytes: 3_700_000,
} as const;

/** Strata: 0 = rim (members kept 1–2 years) … 8 = basin (9+ years). */
export const DEEP_PAST_STRATA_COUNT = 9;
/** A node must be kept more than a year to rest here (named, owner-correctable). */
export const DEEP_PAST_MIN_AGE_YEARS = 1;
/** Context stays warm for this long after a tend or a link (named, owner-correctable). */
export const DEEP_PAST_WARM_DAYS = 30;
export type DeepPastRiseReason = "tended recently" | "linked recently" | "held risen";

/** Helix geometry (rework design note §3: the pre-asset mockup's ×1
 *  proportions): radius shrinks and depth grows toward the basin; the arc
 *  start twists 0.85 rad per stratum. */
export const DEEP_PAST_STRATUM_RADIUS = [88, 84.5, 81, 77.5, 74, 70.5, 67, 63.5, 60] as const;
export const DEEP_PAST_STRATUM_Y = [0, -18, -36, -54, -72, -90, -108, -126, -144] as const;
export const DEEP_PAST_STRATUM_ARC_START = 0.85;
export const DEEP_PAST_STRATUM_ARC_LENGTH = 4.4;
/** Each stratum is a solid disc of this thickness; its top is the floor. */
export const DEEP_PAST_DISC_THICKNESS = 2.6;
/** The floor a stratum's members rest on: the disc's top surface. */
export function deepPastFloorY(stratum: number): number {
  return DEEP_PAST_STRATUM_Y[stratum]! + DEEP_PAST_DISC_THICKNESS / 2;
}
/** The First Light basin: the finished bottom (solid floor + rock below, C9). */
export const DEEP_PAST_BASIN_Y = -168;
export const DEEP_PAST_BASIN_RADIUS = 66;
/** The rim-side resting place for risen members (a finished stone platform):
 *  the open wedge near stratum 0's rim, at angle 5.35 rad, radius 54. */
export const DEEP_PAST_RISE_SHELF = { x: Math.cos(5.35) * 54, y: 9, z: Math.sin(5.35) * 54 } as const;
/** Where a traveler's ship berths on arrival: just off stratum 0's rim. */
export const DEEP_PAST_SHIP_BERTH = {
  angle: 3.4,
  radius: DEEP_PAST_STRATUM_RADIUS[0] + 2,
  y: deepPastFloorY(0) + 4,
} as const;

/**
 * The generated stair (rework design note §5.2–5.3): one continuous helical
 * descent whose connection to the discs is an arithmetic identity, not a
 * fit. Each stratum transition is a flight of `stepsPerFlight` steps of
 * `rise` each (12 × 1.5 = 18 = the stratum drop), winding `windRad` along
 * the helix in the band from R−`bandInnerOffset` to R−`bandOuterOffset`.
 * The basin leg drops 24, so its flight has `basinSteps` steps (16 × 1.5).
 */
export const DEEP_PAST_STAIR = {
  stepsPerFlight: 12,
  rise: 1.5,
  windRad: 1.15,
  startArcRel: 3.25,
  bandInnerOffset: 17,
  bandOuterOffset: 3,
  basinSteps: 16,
} as const;

export interface DeepPastStairStep {
  /** 1..8 for the stratum flights; 9 for the basin flight. */
  flight: number;
  /** Step index within its flight, 0 = top step. */
  index: number;
  angle: number;
  radius: number;
  /** The step's top surface. */
  topY: number;
  x: number;
  z: number;
}

/** The stair band's centre radius for a flight leaving `upperStratum`. */
function stairBandRadius(upperStratum: number): number {
  return (
    DEEP_PAST_STRATUM_RADIUS[upperStratum]! -
    (DEEP_PAST_STAIR.bandInnerOffset + DEEP_PAST_STAIR.bandOuterOffset) / 2
  );
}

export function buildDeepPastStairSteps(): DeepPastStairStep[] {
  const steps: DeepPastStairStep[] = [];
  const pushFlight = (flight: number, upperStratum: number, count: number, windTotal: number) => {
    const windStep = windTotal / count;
    const radius = stairBandRadius(upperStratum);
    for (let j = 0; j < count; j++) {
      const angle =
        upperStratum * DEEP_PAST_STRATUM_ARC_START + DEEP_PAST_STAIR.startArcRel + (j + 0.5) * windStep;
      steps.push({
        flight,
        index: j,
        angle,
        radius,
        topY: deepPastFloorY(upperStratum) - (j + 1) * DEEP_PAST_STAIR.rise,
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
      });
    }
  };
  for (let k = 1; k < DEEP_PAST_STRATA_COUNT; k++) {
    pushFlight(k, k - 1, DEEP_PAST_STAIR.stepsPerFlight, DEEP_PAST_STAIR.windRad);
  }
  pushFlight(
    DEEP_PAST_STRATA_COUNT,
    DEEP_PAST_STRATA_COUNT - 1,
    DEEP_PAST_STAIR.basinSteps,
    DEEP_PAST_STAIR.windRad * (DEEP_PAST_STAIR.basinSteps / DEEP_PAST_STAIR.stepsPerFlight),
  );
  return steps;
}

export interface DeepPastWalkPath {
  /** Floor-level route points: disc arcs and stair flights, rim to basin. */
  points: [number, number, number][];
  /** One landing per stratum (0..8) plus the basin (stratum 9). */
  landings: { stratum: number; point: [number, number, number] }[];
}

/**
 * The walk route (rework design note §5.2/§7): stratum 0's flight-start
 * point, then per flight its step centres, a landing on the lower stratum
 * at arc-relative 3.55 (the flight's angular end, re-expressed on the
 * lower stratum: 3.25 + 1.15 − 0.85), an arc point at 3.4, and the next
 * flight's start at 3.25 — ending with the basin flight and two points
 * walking in across the basin floor.
 */
export function buildDeepPastWalkPoints(): DeepPastWalkPath {
  const points: [number, number, number][] = [];
  const landings: DeepPastWalkPath["landings"] = [];
  const polar = (angle: number, radius: number, y: number): [number, number, number] => [
    Math.cos(angle) * radius,
    y,
    Math.sin(angle) * radius,
  ];
  const landingArcRel =
    DEEP_PAST_STAIR.startArcRel + DEEP_PAST_STAIR.windRad - DEEP_PAST_STRATUM_ARC_START; // 3.55
  const arcMidArcRel = (landingArcRel + DEEP_PAST_STAIR.startArcRel) / 2; // 3.4

  const start = polar(DEEP_PAST_STAIR.startArcRel, stairBandRadius(0), deepPastFloorY(0));
  points.push(start);
  landings.push({ stratum: 0, point: start });

  const steps = buildDeepPastStairSteps();
  for (let k = 1; k < DEEP_PAST_STRATA_COUNT; k++) {
    for (const step of steps) {
      if (step.flight === k) points.push([step.x, step.topY, step.z]);
    }
    const landing = polar(
      k * DEEP_PAST_STRATUM_ARC_START + landingArcRel,
      stairBandRadius(k - 1),
      deepPastFloorY(k),
    );
    points.push(landing);
    landings.push({ stratum: k, point: landing });
    points.push(
      polar(k * DEEP_PAST_STRATUM_ARC_START + arcMidArcRel, stairBandRadius(k), deepPastFloorY(k)),
    );
    points.push(
      polar(k * DEEP_PAST_STRATUM_ARC_START + DEEP_PAST_STAIR.startArcRel, stairBandRadius(k), deepPastFloorY(k)),
    );
  }

  let finalAngle = 0;
  for (const step of steps) {
    if (step.flight !== DEEP_PAST_STRATA_COUNT) continue;
    points.push([step.x, step.topY, step.z]);
    finalAngle = step.angle;
  }
  const basinFloorY = DEEP_PAST_BASIN_Y + DEEP_PAST_DISC_THICKNESS / 2;
  points.push(polar(finalAngle, 40, basinFloorY));
  const basinLanding = polar(finalAngle, 20, basinFloorY);
  points.push(basinLanding);
  landings.push({ stratum: DEEP_PAST_STRATA_COUNT, point: basinLanding });
  return { points, landings };
}

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
  riseReason: DeepPastRiseReason | null;
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

export interface DeepPastStratumSummary {
  stratum: number;
  memberCount: number;
  /** Earliest placement year (UTC) among this stratum's members, or null when it rests empty. */
  earliestYear: number | null;
}

export interface DeepPastLayout {
  members: DeepPastMember[];
  /** One summary per stratum, all 9, in stratum order. */
  strata: DeepPastStratumSummary[];
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

/**
 * The calendar year of a timestamp, read in UTC. Placement timestamps are
 * UTC-midnight by construction (ISO `Z` strings), so reading the year in
 * the viewer's local calendar flips the year at the boundary in western
 * timezones (2020-01-01T00:00:00Z is 2019-12-31 in New York) and moves
 * the member a whole stratum. UTC keeps the year the timestamp states.
 */
function utcYear(d: Date): number {
  return d.getUTCFullYear();
}

/** Stratum band for a placement timestamp, in the UTC calendar year. */
export function stratumForDate(placedAt: Date | null, now: Date): number | null {
  if (!placedAt) return null;
  const yearsAgo = utcYear(now) - utcYear(placedAt);
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
  const angle = stratum * DEEP_PAST_STRATUM_ARC_START + 0.3 + rand() * 3.8;
  const radius = 10 + rand() * (DEEP_PAST_STRATUM_RADIUS[stratum]! - 18);
  return {
    x: Math.cos(angle) * radius,
    y: deepPastFloorY(stratum),
    z: Math.sin(angle) * radius,
  };
}

function shelfPosition(nodeId: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${DEEP_PAST_SEED}:rise:${nodeId}`));
  const angle = rand() * Math.PI * 2;
  const radius = 2 + rand() * 7;
  return {
    x: DEEP_PAST_RISE_SHELF.x + Math.cos(angle) * radius,
    y: DEEP_PAST_RISE_SHELF.y,
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
  warmDays: number = DEEP_PAST_WARM_DAYS,
): "tended recently" | "linked recently" | null {
  const warmMs = warmDays * 24 * 60 * 60 * 1000;
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
  riseReason: DeepPastRiseReason | null,
  stillYear: number,
): string {
  const year = utcYear(placedAt);
  if (riseReason === "tended recently") {
    return `Kept since ${year} — risen because you tended it recently; it rests at the rim while its context is warm, and returns to depth ${stratum + 1} of ${DEEP_PAST_STRATA_COUNT} when that cools.`;
  }
  if (riseReason === "linked recently") {
    return `Kept since ${year} — risen because it was linked again recently; it rests at the rim while its context is warm, and returns to depth ${stratum + 1} of ${DEEP_PAST_STRATA_COUNT} when that cools.`;
  }
  if (riseReason === "held risen") {
    return `Kept since ${year} — risen and held at the rim for this visit; it returns to depth ${stratum + 1} of ${DEEP_PAST_STRATA_COUNT} when the visit ends.`;
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
  opts: { warmDays?: number; stickyRisenIds?: ReadonlySet<number> } = {},
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
  const strata: DeepPastStratumSummary[] = Array.from({ length: DEEP_PAST_STRATA_COUNT }, (_, i) => ({
    stratum: i,
    memberCount: 0,
    earliestYear: null,
  }));
  for (const node of nodes) {
    if (node.status === "archived") continue;
    const placedAt = placementTimestamp(node);
    const stratum = stratumForDate(placedAt, now);
    if (placedAt === null || stratum === null) continue; // too young, or age unreadable: excluded, never guessed
    const yearsAgo = utcYear(now) - utcYear(placedAt);
    const still = parseDate(node.lastTendedAt) ?? placedAt;
    const warm = warmContext(node, touching.get(node.id) ?? [], now, opts.warmDays ?? DEEP_PAST_WARM_DAYS);
    const riseReason: DeepPastRiseReason | null = warm ?? (opts.stickyRisenIds?.has(node.id) ? "held risen" : null);
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
      why: whyLine(placedAt, yearsAgo, stratum, riseReason, utcYear(still)),
    };
    members.push(member);
    memberById.set(node.id, member);
    placedAtMs.set(node.id, placedAt.getTime());
    const summary = strata[stratum]!;
    summary.memberCount++;
    const placedYear = utcYear(placedAt);
    if (summary.earliestYear === null || placedYear < summary.earliestYear) {
      summary.earliestYear = placedYear;
    }
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
    strata,
    anchors,
    thread,
    eligibleCount: members.length,
    excludedCount: nodes.length - members.length,
    omittedEdgeCount,
  };
}
