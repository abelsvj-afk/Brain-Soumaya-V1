import type { GraphData, GraphNode, Journey, JourneyLinkSummary, JourneyStatus } from "@brain/shared";

/**
 * Garden layout (Phase 3, P3-1) — the pure function that turns the brain's
 * graph into the Growing Place's ground. No three.js here: this module is
 * the testable contract (C1 determinism, C2 identity traceability), and the
 * scene module renders exactly what it returns.
 *
 * v2 (docs/specs/growing-place-v2-2026-10-29.md, owner-approved): the garden
 * is the place for Journeys, not a second copy of the galaxy.
 * - Each active/paused/done Journey is a GROVE. Its open missions (linked
 *   action nodes) are sprouts and its linked memories are stones, both
 *   inside the grove. A node linked to several Journeys rests in the
 *   lowest-id one's grove; the sharing shows as a path between groves.
 * - Memories linked to no Journey grow wild in the MEADOW (the arrival
 *   terrace) — only those from the last 30 days (owner, 2026-10-29).
 * - Memories due for recall ripen as SEED PODS (at most 5).
 *
 * Settled ground kept from P3-1 (review 27):
 * - Plots reconcile against the ELIGIBLE set (see isEligibleGardenNode) —
 *   never against all graph nodes, never invented.
 * - Placement inputs are ONLY age band (chronology) and seeded position.
 *   Importance, review strength, progress, emotional weight, and degree
 *   must NOT drive size, brightness, color, height, density, terrace, or
 *   path emphasis — in this module or anywhere downstream.
 * - You arrive at the lowest terrace (the meadow, the present); completed
 *   Journeys stand on the crown by the witness tree (D-61's oldest light).
 *   The one size signal is a grove tree's height, which counts COMPLETED
 *   missions — the Journey's own progress, and it only ever grows.
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

/** Why a plot is in the garden (v2): a grove's open mission, a grove's linked memory, or a wild meadow memory. */
export type GardenPlotRole = "mission" | "memory" | "wild";

export interface GardenPlot {
  nodeId: number;
  role: GardenPlotRole;
  /** The grove it rests in; null for a wild meadow plot. */
  journeyId: number | null;
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

/** One Journey's grove (v2). */
export interface GardenGrove {
  journeyId: number;
  title: string;
  icon?: string;
  color?: string;
  status: JourneyStatus;
  terrace: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Completed missions: the grove tree's height and its flowers. Only grows. */
  missionsCompleted: number;
  /** Linked items that did not fit in the grove, counted so nothing is silently lost. */
  unshown: number;
}

/** Two groves that share at least one linked memory (a confirmed connection). */
export interface GardenGrovePath {
  fromJourneyId: number;
  toJourneyId: number;
  shared: number;
}

/** A memory due for recall, ripened into a seed pod over where it rests. */
export interface GardenPod {
  nodeId: number;
  label: string;
  journeyId: number | null;
  x: number;
  y: number;
  z: number;
}

export interface GardenLayout {
  plots: GardenPlot[];
  paths: GardenPath[];
  landmarks: GardenLandmark[];
  groves: GardenGrove[];
  grovePaths: GardenGrovePath[];
  pods: GardenPod[];
  /** Wild memories from the window that did not fit under the meadow's ceiling. */
  meadowUnshown: number;
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

/** The meadow keeps loose memories from this many days back (owner, 2026-10-29). */
export const GARDEN_MEADOW_DAYS = 30;
/** Frame-rate safety ceiling on wild plots; the rest are counted, never hidden silently. */
export const GARDEN_MEADOW_MAX = 120;
/** At most this many seed pods ripen at once — a daily snack, not a chore. */
export const GARDEN_POD_MAX = 5;
/** Grove footprint on the open terraces, and the compact one for completed groves on the crown. */
export const GROVE_RADIUS = 52;
export const DONE_GROVE_RADIUS = 30;
/** What fits inside one grove before the rest is counted as unshown. */
export const GROVE_MAX_MISSIONS = 12;
export const GROVE_MAX_MEMORIES = 18;

/** Centre radius of a terrace's walkable band (ring t spans radius[t+1]..radius[t]). */
export function terraceBandCenter(t: number): number {
  const inner = t + 1 < GARDEN_TERRACE_COUNT ? GARDEN_TERRACE_RADIUS[t + 1]! : 60;
  return (GARDEN_TERRACE_RADIUS[t]! + inner) / 2;
}

/**
 * Where an active/paused Journey's grove stands: a seeded terrace (1..4)
 * and angle, nudged until it clears every grove placed before it. Groves
 * are placed in id order, so adding a Journey never moves an existing one.
 */
function grovePosition(
  journeyId: number,
  placed: readonly { x: number; z: number; radius: number }[],
): { terrace: number; x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${GARDEN_SEED}:grove:${journeyId}`));
  let best = { terrace: 1, x: 0, y: 0, z: 0 };
  for (let attempt = 0; attempt < 32; attempt++) {
    const terrace = 1 + Math.floor(rand() * 4);
    const angle = rand() * Math.PI * 2;
    const r = terraceBandCenter(terrace);
    best = { terrace, x: Math.cos(angle) * r, y: GARDEN_TERRACE_HEIGHT[terrace]!, z: Math.sin(angle) * r };
    if (placed.every((g) => Math.hypot(g.x - best.x, g.z - best.z) >= g.radius + GROVE_RADIUS + 8)) break;
  }
  return best;
}

/** Evenly spaced spots on a circle inside a grove, starting at a seeded angle. */
function ringSpots(
  center: { x: number; y: number; z: number },
  count: number,
  r: number,
  seed: string,
): { x: number; y: number; z: number }[] {
  const start = mulberry32(hashSeeded(seed))() * Math.PI * 2;
  return Array.from({ length: count }, (_, i) => {
    const a = start + (i / Math.max(count, 1)) * Math.PI * 2;
    return { x: center.x + Math.cos(a) * r, y: center.y, z: center.z + Math.sin(a) * r };
  });
}

export interface GardenLayoutInputs {
  /** Each Journey's linked items (GET /api/journeys/:id/links). Missing = that grove renders empty, never guessed. */
  links?: ReadonlyMap<number, readonly JourneyLinkSummary[]>;
  /** Memories due for recall (GET /api/review/due), in the server's order. */
  due?: readonly { id: number; label?: string }[];
}

export function buildGardenLayout(
  graph: GraphData,
  journeys: Journey[],
  now: Date = new Date(),
  inputs: GardenLayoutInputs = {},
): GardenLayout {
  // Canonical input ordering (C1): id-ascending before anything is derived,
  // so the same logical data in any arrival order lays out identically.
  const nodes = [...graph.nodes].sort((a, b) => a.id - b.id);
  const eligible = nodes.filter(isEligibleGardenNode);
  const eligibleById = new Map(eligible.map((n) => [n.id, n]));
  const sortedJourneys = [...journeys].sort((a, b) => a.id - b.id);

  // Which Journeys each node is linked to ("node" and "task" links both
  // point at node rows). Only eligible nodes count — a dangling link to a
  // deleted or archived node is skipped, never drawn.
  const journeysOfNode = new Map<number, number[]>();
  for (const j of sortedJourneys) {
    const seen = new Set<number>();
    for (const link of inputs.links?.get(j.id) ?? []) {
      if (link.kind !== "node" && link.kind !== "task") continue;
      if (!eligibleById.has(link.refId) || seen.has(link.refId)) continue;
      seen.add(link.refId);
      const list = journeysOfNode.get(link.refId) ?? [];
      list.push(j.id);
      journeysOfNode.set(link.refId, list);
    }
  }

  // Groves: done ones on the crown at the landmark spot (so an approved
  // landmark still rises exactly where its grove is), the rest on the
  // open terraces, placed in id order.
  const groves: GardenGrove[] = [];
  for (const j of sortedJourneys) {
    const done = j.status === "done";
    const pos = done ? { terrace: GARDEN_TERRACE_COUNT - 1, ...landmarkPositionFor(j.id) } : grovePosition(j.id, groves);
    groves.push({
      journeyId: j.id,
      title: j.title,
      icon: j.icon,
      color: j.color,
      status: j.status,
      ...pos,
      radius: done ? DONE_GROVE_RADIUS : GROVE_RADIUS,
      missionsCompleted: Math.max(0, Math.floor(j.missionsCompleted ?? 0)),
      unshown: 0,
    });
  }
  const groveById = new Map(groves.map((g) => [g.journeyId, g]));

  // Grove contents: each linked node rests in its lowest-id Journey's grove.
  const plots: GardenPlot[] = [];
  const homeOf = new Map<number, number>();
  for (const [nodeId, js] of journeysOfNode) homeOf.set(nodeId, Math.min(...js));
  for (const grove of groves) {
    const members = eligible.filter((n) => homeOf.get(n.id) === grove.journeyId);
    const missions = members.filter((n) => n.kind === "action");
    const memories = members.filter((n) => n.kind !== "action");
    const shownMissions = missions.slice(0, GROVE_MAX_MISSIONS);
    const shownMemories = memories.slice(0, GROVE_MAX_MEMORIES);
    grove.unshown = missions.length - shownMissions.length + memories.length - shownMemories.length;
    const missionSpots = ringSpots(grove, shownMissions.length, grove.radius * 0.45, `${GARDEN_SEED}:m:${grove.journeyId}`);
    const memorySpots = ringSpots(grove, shownMemories.length, grove.radius * 0.82, `${GARDEN_SEED}:s:${grove.journeyId}`);
    shownMissions.forEach((n, i) =>
      plots.push({ nodeId: n.id, role: "mission", journeyId: grove.journeyId, kind: "action", gathering: false, terrace: grove.terrace, ...missionSpots[i]! }),
    );
    shownMemories.forEach((n, i) =>
      plots.push({
        nodeId: n.id,
        role: "memory",
        journeyId: grove.journeyId,
        kind: n.kind ?? "memory",
        gathering: n.kind === "moc",
        terrace: grove.terrace,
        ...memorySpots[i]!,
      }),
    );
  }

  // The meadow: loose memories from the window, newest kept under the ceiling.
  const since = now.getTime() - GARDEN_MEADOW_DAYS * 86_400_000;
  const wild = eligible.filter((n) => {
    if (homeOf.has(n.id)) return false;
    const t = new Date(n.createdAt || n.lastTendedAt || NaN).getTime();
    return Number.isFinite(t) && t >= since && t <= now.getTime() + 86_400_000;
  });
  const wildShown = [...wild]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.id - b.id)
    .slice(0, GARDEN_MEADOW_MAX)
    .sort((a, b) => a.id - b.id);
  for (const n of wildShown) {
    plots.push({ nodeId: n.id, role: "wild", journeyId: null, kind: n.kind ?? "memory", gathering: n.kind === "moc", terrace: 0, ...placementFor(n.id, 0) });
  }

  // Memory paths: only between plots that are both in the garden.
  const plotIds = new Set(plots.map((p) => p.nodeId));
  let omittedEdgeCount = 0;
  const paths: GardenPath[] = [];
  const edges = [...graph.links].sort((a, b) => a.id - b.id);
  for (const edge of edges) {
    if (!plotIds.has(edge.source) || !plotIds.has(edge.target)) {
      // Omitted, never invented: an edge with an endpoint outside the
      // garden is not drawn, and no endpoint is fabricated for it.
      omittedEdgeCount++;
      continue;
    }
    paths.push({ edgeId: edge.id, fromNodeId: edge.source, toNodeId: edge.target });
  }

  // Grove paths: Journeys that share a linked node — confirmed links only.
  const shared = new Map<string, number>();
  for (const js of journeysOfNode.values()) {
    for (let a = 0; a < js.length; a++) {
      for (let b = a + 1; b < js.length; b++) {
        const key = `${Math.min(js[a]!, js[b]!)}:${Math.max(js[a]!, js[b]!)}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }
  const grovePaths: GardenGrovePath[] = [...shared.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split(":").map(Number) as [number, number];
      return { fromJourneyId: from, toJourneyId: to, shared: count };
    })
    .sort((a, b) => a.fromJourneyId - b.fromJourneyId || a.toJourneyId - b.toJourneyId);

  // Landmarks: completed Journeys keep their presence-only crown arch
  // (Phase 4's A6 rises new ones at the same spot).
  const landmarks: GardenLandmark[] = groves
    .filter((g) => g.status === "done")
    .map((g) => ({ journeyId: g.journeyId, title: g.title, terrace: g.terrace, x: g.x, y: g.y, z: g.z }));

  // Seed pods: due memories ripen over where they rest; a due memory with
  // no plot (older, unlinked) ripens at its own meadow spot.
  const plotById = new Map(plots.map((p) => [p.nodeId, p]));
  const pods: GardenPod[] = [];
  for (const d of inputs.due ?? []) {
    if (pods.length >= GARDEN_POD_MAX) break;
    const n = eligibleById.get(d.id);
    if (!n || pods.some((p) => p.nodeId === d.id)) continue;
    const at = plotById.get(d.id) ?? { ...placementFor(d.id, 0), journeyId: homeOf.get(d.id) ?? null };
    const grove = at.journeyId != null ? groveById.get(at.journeyId) : undefined;
    pods.push({ nodeId: d.id, label: d.label ?? n.label, journeyId: grove ? grove.journeyId : null, x: at.x, y: at.y, z: at.z });
  }

  return {
    plots,
    paths,
    landmarks,
    groves,
    grovePaths,
    pods,
    meadowUnshown: wild.length - wildShown.length,
    eligibleCount: eligible.length,
    excludedCount: nodes.length - eligible.length,
    omittedEdgeCount,
  };
}
