import type { GraphData, GraphNode, Journey } from "@brain/shared";

/**
 * Garden layout (Phase 3, P3-1) — the pure function that turns the brain's
 * graph into the Growing Place's ground. No three.js here: this module is
 * the testable contract (C1 determinism, C2 identity traceability), and the
 * scene module renders exactly what it returns.
 *
 * Settled ground (P3-1 note, review 27):
 * - Plots exist for every node in the ELIGIBLE set (see isEligibleGardenNode)
 *   and reconcile against that set — never against all graph nodes.
 * - Placement inputs are ONLY age band (chronology) and seeded position.
 *   Importance, review strength, progress, emotional weight, and degree
 *   must NOT drive size, brightness, color, height, density, terrace, or
 *   path emphasis — in this module or anywhere downstream.
 * - Terrace convention (owner-settled, D-61): you arrive at the lowest
 *   terrace — the present — and climb toward the crown, where the oldest
 *   light lives under the witness tree. Chronology only; no band is better.
 * - The garden renders the graph data the app holds — the same window the
 *   home galaxy sees. It never fetches its own copy of the brain.
 */

export const GARDEN_SEED = "growing-place / first-light-1";

/** Recipe budget (R-G4 allocation): planned ceilings, asserted statically. */
export const GARDEN_BUDGET = { maxDrawCalls: 95, maxTris: 700_000 } as const;

/** Terrace bands: 0 = arrival (this year) … 5 = crown (5+ years ago). */
export const GARDEN_TERRACE_COUNT = 6;

/** Terrace geometry: ring radius shrinks and height rises toward the crown. */
export const GARDEN_TERRACE_RADIUS = [900, 780, 660, 540, 400, 250] as const;
export const GARDEN_TERRACE_HEIGHT = [0, 18, 36, 54, 72, 90] as const;

/**
 * Finished underside (garden-underside fix): the garden is a solid, not
 * flat rings over void. A stone skirt drops this far below the lowest
 * terrace (y=0) to the solid floor under the garden.
 */
export const GARDEN_UNDERSIDE_DEPTH = 60;

/** The solid floor under the garden: lowest terrace height minus the skirt depth. */
export const GARDEN_FLOOR_Y = GARDEN_TERRACE_HEIGHT[0]! - GARDEN_UNDERSIDE_DEPTH;

/**
 * Camera floor (garden-underside fix): the worlds camera never goes below
 * this height in the garden — above the lowest terrace, far above the
 * solid floor. The shipped orbit sits at 300; this is the guarantee
 * that no pose can ever sink under the garden.
 */
export const GARDEN_CAMERA_FLOOR_Y = 12;

/** Clamp a camera height to the garden floor: the view can never drop under the garden. */
export function clampToGardenFloor(y: number): number {
  return Math.max(y, GARDEN_CAMERA_FLOOR_Y);
}

export interface GardenPlot {
  nodeId: number;
  /** What kind of thing this is — form only, never rank. */
  kind: string;
  /** A map-of-content hub: a gathering plot standing for its member set. */
  gathering: boolean;
  terrace: number;
  x: number;
  y: number;
  z: number;
}

export interface GardenPath {
  edgeId: number;
  fromNodeId: number;
  toNodeId: number;
}

export interface GardenLandmark {
  journeyId: number;
  title: string;
  terrace: number;
  x: number;
  y: number;
  z: number;
}

export interface GardenLayout {
  plots: GardenPlot[];
  paths: GardenPath[];
  landmarks: GardenLandmark[];
  /** Eligible nodes in the input graph (the set plots reconcile against). */
  eligibleCount: number;
  /** Nodes deliberately excluded (archived). */
  excludedCount: number;
  /** Edges omitted because an endpoint is not in the eligible set. */
  omittedEdgeCount: number;
}

/**
 * Eligible plot set: every node kind the shared type allows is a plot
 * (form by kind), EXCEPT archived nodes — the type's own rule is that
 * archived "rests out of the galaxy + retrieval", and the garden follows
 * the galaxy here. No other exclusion exists.
 */
export function isEligibleGardenNode(node: GraphNode): boolean {
  return node.status !== "archived";
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

/** Terrace band for a creation timestamp, in the viewer's local calendar. */
export function terraceForDate(iso: string | undefined, now: Date): number {
  const d = iso ? new Date(iso) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return 0; // no usable timestamp: the arrival terrace, never guessed
  const yearsAgo = now.getFullYear() - d.getFullYear();
  return Math.min(Math.max(yearsAgo, 0), GARDEN_TERRACE_COUNT - 1);
}

function placementFor(nodeId: number, terrace: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${GARDEN_SEED}:${nodeId}`));
  const angle = rand() * Math.PI * 2;
  const radius =
    GARDEN_TERRACE_RADIUS[terrace]! - rand() * (GARDEN_TERRACE_RADIUS[terrace]! * 0.12);
  return {
    x: Math.cos(angle) * radius,
    y: GARDEN_TERRACE_HEIGHT[terrace]!,
    z: Math.sin(angle) * radius,
  };
}

/**
 * The crown-terrace position a landmark for this journey would stand
 * on — the same seeded placement buildGardenLayout uses for done
 * Journeys (Phase 4, A6). An approved landmark rises exactly where the
 * layout would place it once it lands; a landmark already rendering
 * presence-only is never re-risen, so callers check the layout first.
 */
export function landmarkPositionFor(journeyId: number): { x: number; y: number; z: number } {
  return placementFor(journeyId, GARDEN_TERRACE_COUNT - 1);
}

export function buildGardenLayout(
  graph: GraphData,
  journeys: Journey[],
  now: Date = new Date(),
): GardenLayout {
  // Canonical input ordering (C1): id-ascending before anything is derived,
  // so the same logical data in any arrival order lays out identically.
  const nodes = [...graph.nodes].sort((a, b) => a.id - b.id);
  const eligible = nodes.filter(isEligibleGardenNode);
  const eligibleIds = new Set(eligible.map((n) => n.id));

  const plots: GardenPlot[] = eligible.map((node) => {
    const createdAt = node.createdAt || node.lastTendedAt;
    const terrace = terraceForDate(createdAt, now);
    const pos = placementFor(node.id, terrace);
    return {
      nodeId: node.id,
      kind: node.kind ?? "memory",
      gathering: node.kind === "moc",
      terrace,
      ...pos,
    };
  });
  let omittedEdgeCount = 0;
  const paths: GardenPath[] = [];
  const edges = [...graph.links].sort((a, b) => a.id - b.id);
  for (const edge of edges) {
    if (!eligibleIds.has(edge.source) || !eligibleIds.has(edge.target)) {
      // Omitted, never invented: an edge with an excluded or missing
      // endpoint is not drawn, and no endpoint is fabricated for it.
      omittedEdgeCount++;
      continue;
    }
    paths.push({ edgeId: edge.id, fromNodeId: edge.source, toNodeId: edge.target });
  }
  // Landmarks (Q1 = B, settled): presence-only, for Journeys the user has
  // marked done. They stand on the crown terrace, by the oldest light —
  // seeded by journey id, deterministic. No rising animation (A6, Phase 4).
  const crown = GARDEN_TERRACE_COUNT - 1;
  const landmarks: GardenLandmark[] = journeys
    .filter((j) => j.status === "done")
    .sort((a, b) => a.id - b.id)
    .map((j) => {
      const pos = placementFor(j.id, crown);
      return { journeyId: j.id, title: j.title, terrace: crown, ...pos };
    });

  return {
    plots,
    paths,
    landmarks,
    eligibleCount: eligible.length,
    excludedCount: nodes.length - eligible.length,
    omittedEdgeCount,
  };
}
