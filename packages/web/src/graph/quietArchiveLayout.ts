import type { GraphData, GraphNode } from "@brain/shared";
import { isPersonNode } from "./peopleLayout.js";

/**
 * Quiet/Archive layout (Phase 3, Wave 2) — the pure function that turns
 * the brain's ARCHIVED material into the Archive's still field. No
 * three.js here: this module is the testable contract (C1 determinism,
 * C2 identity traceability), and the scene module renders exactly what
 * it returns.
 *
 * Settled ground (Quiet/Archive note Rev 123; recipe R-Q1–R-Q3; the P4
 * archive invariant; the never-punish invariant):
 * - The input is the archived set ONLY — nodes whose status is
 *   "archived", plus the edges incident to them. The app's graph window
 *   never carries archived rows (`nodes.all()` excludes them), so this
 *   layout takes its own input, fetched on entry from the existing
 *   `GET /api/nodes/archived` + incident-edges endpoints. It never
 *   fetches its own copy of the LIVE brain.
 * - A cluster exists for EVERY archived person — with or without
 *   archived memories resting with them. (Deliberate difference from
 *   People, which needs ≥1 linked memory: there, the person is alive
 *   in the world and the cluster is their company; here, the person
 *   THEMSELVES is the archived thing, and a person with no archived
 *   memories still rests as a lone lamp.) Archived people have no
 *   cluster anywhere else (P4 — the archive wins everywhere).
 * - A light is an archived memory resting with a person: an archived
 *   non-person node linked by an edge to that person. Form by kind,
 *   never by rank (the non-ranking rule): memory / rested thread /
 *   date / gathering. A rested thread is an archived action node — the
 *   form says what KIND of thing it is, and its archived state is the
 *   context; no live thread is ever shown here, and no overdue state,
 *   countdown, or "last tended" counter exists anywhere in this world.
 * - Lone lights: archived memories linked to no archived person rest
 *   on their own in the field — they are archived material too, and
 *   the field does not hide them for having no person to belong to.
 * - Bridges: an archived memory shared between two archived people
 *   renders as a fine bridge of light between their clusters, exactly
 *   as in People. Edges with a missing endpoint (the other end is a
 *   live node, or absent from the payload) are omitted, never drawn to
 *   an invented endpoint — a live memory linked to an archived person
 *   stays in the galaxy; it is not archived material and does not
 *   appear here.
 * - Dates that matter rest in the cluster as quiet dates — the person's
 *   own `occurredAt`, and each linked memory's `occurredAt` carried on
 *   its light. No badges, no overdue states, no countdowns. Dates are
 *   stored as ISO strings here; anything that displays one must format
 *   it in the viewer's own local time (NO UTC in anything user-facing).
 * - Placement is deterministic seeded placement (mulberry32 over the
 *   recipe seed + archived id) — same archived thing, same place, every
 *   visit, every device. Clusters sit on an expanding golden-angle
 *   spiral (Q3: the field grows without bound; the spacing rule keeps
 *   it readable at any size). No cluster is nearer, larger, or brighter
 *   for recency, importance, or any other rank. Importance, review
 *   strength, progress, emotional weight, and degree must NOT drive
 *   placement, size, brightness, color, height, density, or bridge
 *   emphasis — in this module or anywhere downstream.
 * - Superseded archived rows rest here too: archival status is
 *   orthogonal to temporal truth (nodes.repo `archived()` says so), and
 *   the client type carries no superseded marker to filter on. Hiding
 *   them would conflate "put away" with "no longer true".
 * - Relic spots: the two relics of this world (Stillness Seal, Unopened
 *   Fold) rest at seeded places in the field — the Seal at the threshold
 *   alcove by the arrival edge, the Fold at the field's heart. These
 *   are COORDINATES ONLY, keyed by the registry's relic id, place, and
 *   glimmer strings. The scene renders no relic mesh (the slim GLBs
 *   land with the relics increment); the relic registry flips these
 *   two from `discoverable: false` to `true` by consuming these spots.
 * - The layout renders the archived data the fetch returns. It never
 *   invents a lamp for a name alone, and it never presents the field
 *   as loss: an empty archive renders the still field itself, honestly
 *   resting ground — never a locked door, never an empty void.
 */

export const QUIET_ARCHIVE_SEED = "quiet-archive / still-water-1";

/** Recipe budget (note §3 / R-Q allocation): planned ceilings, asserted statically. */
export const QUIET_ARCHIVE_BUDGET = { maxDrawCalls: 60, maxTris: 300_000 } as const;

/** Minimum spacing between clusters on the expanding spiral (Q3). */
export const QUIET_ARCHIVE_CLUSTER_SPACING = 90;
/** The field's extent with nothing resting in it — still ground, not void. */
export const QUIET_ARCHIVE_EMPTY_FIELD_RADIUS = 220;

/** A light's form — what kind of thing it is, never how much it matters. */
export type QuietArchiveLightForm = "memory" | "thread" | "date" | "gathering";

export interface QuietArchiveLight {
  nodeId: number;
  form: QuietArchiveLightForm;
  x: number;
  y: number;
  z: number;
  /** A date that matters, when this light carries one (quiet date, never a countdown). */
  occurredAt?: string;
}

export interface QuietArchiveCluster {
  personId: number;
  /** The brain's own chosen name for this person — never a hardcoded label. */
  name: string;
  x: number;
  y: number;
  z: number;
  lights: QuietArchiveLight[];
  /** One plain line naming the rule inputs that placed this cluster here. */
  why: string;
}

export interface QuietArchiveBridge {
  /** Every source edge that built this bridge (shared-memory links). */
  edgeIds: number[];
  fromPersonId: number;
  toPersonId: number;
  /** The shared archived memories this bridge stands on. */
  viaNodeIds: number[];
}

/** A relic's resting place in the field — coordinates for the relic
 *  registry to consume. `place` and `glimmer` repeat the registry's own
 *  strings so the two can never drift apart silently. */
export interface QuietArchiveRelicSpot {
  /** Registry relic id (`stillness-seal`, `unopened-fold`). */
  id: string;
  x: number;
  y: number;
  z: number;
  place: string;
  glimmer: string;
}

export interface QuietArchiveLayout {
  clusters: QuietArchiveCluster[];
  /** Archived memories resting on their own — linked to no archived person. */
  loneLights: QuietArchiveLight[];
  bridges: QuietArchiveBridge[];
  /** The two relics of this world, as resting-place coordinates. */
  relicSpots: QuietArchiveRelicSpot[];
  /** The field's extent: the farthest cluster plus its margin, or the empty-field radius. */
  fieldRadius: number;
  /** Archived nodes in the input (the set everything reconciles against). */
  archivedCount: number;
  /** Edges touching an archived node that rendered as neither a light nor a bridge. */
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

function lightForm(node: GraphNode): QuietArchiveLightForm {
  if (node.kind === "moc") return "gathering";
  if (node.kind === "action") return "thread";
  if (parseDate(node.occurredAt) !== null) return "date";
  return "memory";
}

/**
 * Cluster placement (Q3): an expanding golden-angle spiral — the field
 * grows without bound as the brain archives, and the spacing rule keeps
 * it readable at any size. Index order is person-id order (canonical
 * input ordering), so the same set always lays out identically.
 */
function clusterPosition(index: number): { x: number; y: number; z: number } {
  const angle = index * 2.399963; // golden angle
  const radius = 60 + QUIET_ARCHIVE_CLUSTER_SPACING * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };
}

function lightPosition(personId: number, nodeId: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${QUIET_ARCHIVE_SEED}:${personId}:${nodeId}`));
  const angle = rand() * Math.PI * 2;
  const radius = 12 + rand() * 18;
  return {
    x: Math.cos(angle) * radius,
    y: 2 + rand() * 10,
    z: Math.sin(angle) * radius,
  };
}

function loneLightPosition(nodeId: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${QUIET_ARCHIVE_SEED}:lone:${nodeId}`));
  const angle = rand() * Math.PI * 2;
  const radius = 40 + rand() * 120;
  return {
    x: Math.cos(angle) * radius,
    y: 2 + rand() * 8,
    z: Math.sin(angle) * radius,
  };
}

function relicSpot(
  id: string,
  place: string,
  glimmer: string,
  fieldRadius: number,
): QuietArchiveRelicSpot {
  const rand = mulberry32(hashSeeded(`${QUIET_ARCHIVE_SEED}:relic:${id}`));
  if (id === "stillness-seal") {
    // At the threshold of a quiet alcove: gate-side, by the arrival edge.
    const angle = 0.6 + (rand() - 0.5) * 0.4;
    const radius = fieldRadius * (0.5 + rand() * 0.2);
    return { id, x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius, place, glimmer };
  }
  // Unopened Fold: kept in the Archive, unopened — at the field's heart.
  const angle = rand() * Math.PI * 2;
  const radius = 20 + rand() * 40;
  return { id, x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius, place, glimmer };
}

function whyLine(
  name: string,
  memoryCount: number,
  threadCount: number,
  dateCount: number,
): string {
  if (memoryCount === 0 && threadCount === 0 && dateCount === 0) return `${name} — resting.`;
  const memories = `${memoryCount} memor${memoryCount === 1 ? "y" : "ies"}`;
  const threads = threadCount > 0 ? `, ${threadCount} rested thread${threadCount === 1 ? "" : "s"}` : "";
  const dates = dateCount > 0 ? `, ${dateCount} date${dateCount === 1 ? "" : "s"} that matter${dateCount === 1 ? "s" : ""}` : "";
  return `${name} — ${memories}${threads}${dates}.`;
}

/**
 * Sputnik's alcove (population increment): by the arrival edge, off the
 * threshold's axis — the threshold stands at angle 0.6, at the field's
 * edge; Sputnik rests 0.5 rad off-axis and 40 units inside the edge,
 * so it is beside the doorway, never in it, and never on the Stillness
 * Seal's relic spot (angle 0.6 ± 0.2, radius 0.5–0.7 × field). A small
 * bright thing at the field's edge, found on arrival.
 */
export function quietArchiveSputnikPosition(fieldRadius: number): {
  x: number;
  y: number;
  z: number;
} {
  const angle = 1.1;
  const radius = Math.max(60, fieldRadius - 40);
  return { x: Math.cos(angle) * radius, y: 8, z: Math.sin(angle) * radius };
}

export function buildQuietArchiveLayout(archived: GraphData): QuietArchiveLayout {
  // Canonical input ordering (C1): id-ascending before anything is derived,
  // so the same logical data in any arrival order lays out identically.
  const nodes = [...archived.nodes].sort((a, b) => a.id - b.id);
  const edges = [...archived.links].sort((a, b) => a.id - b.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const personIds = new Set(nodes.filter(isPersonNode).map((n) => n.id));

  // Linked archived memories per archived person: incident edges whose
  // other endpoint is an archived non-person node PRESENT in the payload.
  // An edge to a live node is not archived material — it is omitted, and
  // the live memory stays in the galaxy.
  const linkedMemoryNodeIds = new Map<number, Set<number>>();
  for (const edge of edges) {
    for (const [personSide, otherSide] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ] as const) {
      if (!personIds.has(personSide)) continue;
      const other = byId.get(otherSide);
      if (!other || personIds.has(otherSide)) continue;
      const set = linkedMemoryNodeIds.get(personSide) ?? new Set<number>();
      set.add(otherSide);
      linkedMemoryNodeIds.set(personSide, set);
    }
  }

  const clusters: QuietArchiveCluster[] = [];
  const clusterByPerson = new Map<number, QuietArchiveCluster>();
  const personNodes = nodes.filter(isPersonNode);
  personNodes.forEach((node, index) => {
    const memoryNodeIds = [...(linkedMemoryNodeIds.get(node.id) ?? new Set<number>())].sort((a, b) => a - b);
    const center = clusterPosition(index);
    const lights: QuietArchiveLight[] = memoryNodeIds.map((nodeId) => {
      const memory = byId.get(nodeId)!;
      const pos = lightPosition(node.id, nodeId);
      return {
        nodeId,
        form: lightForm(memory),
        x: center.x + pos.x,
        y: center.y + pos.y,
        z: center.z + pos.z,
        ...(parseDate(memory.occurredAt) ? { occurredAt: memory.occurredAt } : {}),
      };
    });
    const threadCount = lights.filter((l) => l.form === "thread").length;
    const dateCount = lights.filter((l) => l.form === "date").length + (parseDate(node.occurredAt) ? 1 : 0);
    const cluster: QuietArchiveCluster = {
      personId: node.id,
      name: node.label,
      ...center,
      lights,
      why: whyLine(node.label, lights.length, threadCount, dateCount),
    };
    clusters.push(cluster);
    clusterByPerson.set(node.id, cluster);
  });

  // Lone lights: archived memories linked to no archived person.
  const personLinked = new Set<number>();
  for (const ids of linkedMemoryNodeIds.values()) {
    for (const id of ids) personLinked.add(id);
  }
  const loneLights: QuietArchiveLight[] = [];
  for (const node of nodes) {
    if (isPersonNode(node)) continue;
    if (personLinked.has(node.id)) continue;
    const pos = loneLightPosition(node.id);
    loneLights.push({
      nodeId: node.id,
      form: lightForm(node),
      x: pos.x,
      y: pos.y,
      z: pos.z,
      ...(parseDate(node.occurredAt) ? { occurredAt: node.occurredAt } : {}),
    });
  }
  loneLights.sort((a, b) => a.nodeId - b.nodeId);

  // Bridges: an archived memory shared between two archived people.
  const bridgeByPair = new Map<string, QuietArchiveBridge>();
  const bridgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const addBridge = (a: number, b: number, edgeId: number, viaNodeId?: number) => {
    if (!clusterByPerson.has(a) || !clusterByPerson.has(b)) return false;
    const key = bridgeKey(a, b);
    const existing = bridgeByPair.get(key);
    if (existing) {
      if (!existing.edgeIds.includes(edgeId)) existing.edgeIds.push(edgeId);
      if (viaNodeId !== undefined && !existing.viaNodeIds.includes(viaNodeId)) existing.viaNodeIds.push(viaNodeId);
      existing.edgeIds.sort((x, y) => x - y);
      existing.viaNodeIds.sort((x, y) => x - y);
      return true;
    }
    bridgeByPair.set(key, {
      edgeIds: [edgeId],
      fromPersonId: Math.min(a, b),
      toPersonId: Math.max(a, b),
      viaNodeIds: viaNodeId !== undefined ? [viaNodeId] : [],
    });
    return true;
  };
  const personsByMemory = new Map<number, number[]>();
  for (const edge of edges) {
    for (const [personSide, otherSide] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ] as const) {
      if (!personIds.has(personSide)) continue;
      const other = byId.get(otherSide);
      if (!other || personIds.has(otherSide)) continue;
      const list = personsByMemory.get(otherSide) ?? [];
      if (!list.includes(personSide)) list.push(personSide);
      personsByMemory.set(otherSide, list);
    }
  }
  for (const [memoryId, personList] of [...personsByMemory.entries()].sort((a, b) => a[0] - b[0])) {
    const eligible = personList.filter((p) => clusterByPerson.has(p)).sort((a, b) => a - b);
    if (eligible.length < 2) continue;
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        for (const edge of edges) {
          const touches =
            (edge.source === memoryId && (edge.target === eligible[i] || edge.target === eligible[j])) ||
            (edge.target === memoryId && (edge.source === eligible[i] || edge.source === eligible[j]));
          if (touches) addBridge(eligible[i]!, eligible[j]!, edge.id, memoryId);
        }
      }
    }
  }

  // Direct person↔person edges are bridges even when no memory is shared.
  for (const edge of edges) {
    if (personIds.has(edge.source) && personIds.has(edge.target)) {
      addBridge(edge.source, edge.target, edge.id);
    }
  }
  const bridges = [...bridgeByPair.values()].sort((a, b) => a.fromPersonId - b.fromPersonId || a.toPersonId - b.toPersonId);

  let omittedEdgeCount = 0;
  for (const edge of edges) {
    const sourceIsPerson = personIds.has(edge.source);
    const targetIsPerson = personIds.has(edge.target);
    const renderedAsLight =
      (sourceIsPerson && clusterByPerson.has(edge.source) && byId.has(edge.target) && !personIds.has(edge.target)) ||
      (targetIsPerson && clusterByPerson.has(edge.target) && byId.has(edge.source) && !personIds.has(edge.source));
    const renderedAsBridge =
      (sourceIsPerson && targetIsPerson && clusterByPerson.has(edge.source) && clusterByPerson.has(edge.target)) ||
      [...bridgeByPair.values()].some((b) => b.edgeIds.includes(edge.id));
    if (!renderedAsLight && !renderedAsBridge) omittedEdgeCount++;
  }

  const fieldRadius =
    clusters.length === 0
      ? QUIET_ARCHIVE_EMPTY_FIELD_RADIUS
      : Math.max(
          QUIET_ARCHIVE_EMPTY_FIELD_RADIUS,
          ...clusters.map((c) => Math.hypot(c.x, c.z)),
        ) + 100;

  const relicSpots = [
    relicSpot(
      "stillness-seal",
      "at the threshold of a quiet alcove",
      "at the threshold of a quiet alcove",
      fieldRadius,
    ),
    relicSpot("unopened-fold", "kept in the Archive, unopened", "kept in the Archive, unopened", fieldRadius),
  ];

  return {
    clusters,
    loneLights,
    bridges,
    relicSpots,
    fieldRadius,
    archivedCount: nodes.length,
    omittedEdgeCount,
  };
}
