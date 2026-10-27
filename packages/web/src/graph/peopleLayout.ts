import {
  normalizeNodeType,
  PEOPLE_GATE_MIN_MEMORIES_EACH,
  PEOPLE_GATE_MIN_PEOPLE,
  PEOPLE_GATE_MIN_SHARED_MEMORIES,
  type GraphData,
  type GraphNode,
} from "@brain/shared";

/**
 * People layout (Phase 3, P3-3) — the pure function that turns the brain's
 * graph into the People's warm field. No three.js here: this module is the
 * testable contract (C1 determinism, C2 identity traceability), and the
 * scene module renders exactly what it returns.
 *
 * Settled ground (P3-3 note Rev 122; Q1–Q7 settled by the build-all
 * delegation, 2026-10-26):
 * - A cluster exists for every person in the ELIGIBLE set: a person the
 *   brain knows with ≥1 linked memory. People with no linked memories get
 *   no cluster — nothing is invented for a name alone. Archived people
 *   have no cluster (P4 — the archive wins everywhere; the graph payload
 *   itself excludes archived rows, and this module excludes them again in
 *   defense in depth). One cluster per person, strictly — no shared
 *   family treatment (Q3).
 * - A person is a node the brain knows AS a person: `kind ===
 *   "person_entity"` (the tracked person, Cognitive Layer Phase 6 — the
 *   Mind tab roster) OR extraction-typed `type === "person"` (legacy
 *   `relationship_reflection` included via normalizeNodeType). This is the
 *   builder's first recon finding: there is no separate people table or
 *   relationships endpoint — people ARE graph nodes, and their linked
 *   memories are the graph's edges incident to them (the CRM's canonical
 *   link is `relationship = "supports"` with the memory as source and
 *   the person as target, but any incident edge to a non-person node
 *   counts here — the layout reads the graph window the app holds, the
 *   same window the home galaxy sees, and never fetches its own copy).
 * - Form by kind, never by rank (the non-ranking rule, per visual
 *   channel): a memory-light's shape says what kind of thing it is
 *   (memory / open thread / date that matters / gathering hub) — never
 *   how much it matters. Cluster size, brightness, color, and height are
 *   identical across people. The count of lights orbiting a cluster is a
 *   true count of linked memories — a fact, not a judgment — and is the
 *   only thing that varies between clusters.
 * - Bridges: a memory shared between two people renders as a fine bridge
 *   of light between their clusters; a direct edge between two people is
 *   a bridge too. Edges with missing or excluded endpoints are omitted,
 *   never drawn to an invented endpoint. A person with no bridges stands
 *   alone, honestly — alone is not lesser.
 * - Dates that matter (Q7) rest in the cluster as quiet dates — the
 *   person's own `occurredAt`, and each linked memory's `occurredAt`
 *   carried on its light. Open threads rest as quiet notes — linked
 *   `kind === "action"` nodes still open (no `expiresAt`, or one still
 *   in the future). No badges, no overdue states, no countdowns, no
 *   "last contacted" counters — ever. Dates are stored as ISO strings
 *   here; anything that displays one must format it in the viewer's own
 *   local time (NO UTC in anything user-facing).
 * - Placement is deterministic seeded placement (mulberry32 over the
 *   recipe seed + person id) — same person, same place, every visit,
 *   every device. No cluster is nearer, larger, or brighter for recency,
 *   importance, or any other rank. Importance, review strength,
 *   progress, emotional weight, and degree must NOT drive placement,
 *   size, brightness, color, height, density, or bridge emphasis — in
 *   this module or anywhere downstream.
 * - The People renders the graph data the app holds — the same window the
 *   home galaxy sees. It never fetches its own copy of the brain.
 * - The gate (Q1) is evaluated here as a DISPLAY MIRROR ONLY, over the
 *   graph window the app holds: `gateOpen` says whether this window
 *   meets the threshold. The server is the authority — TravelRepo
 *   re-checks the threshold against the whole database on every
 *   departure to People, and the route board only offers People when the
 *   server's travel state says the gate is open. A bounded graph window
 *   (the overview caps at 300 nodes) can hold fewer people than the
 *   brain does, so this mirror may read closed while the server's gate
 *   is open; it must never be used to admit or refuse travel.
 */

export const PEOPLE_SEED = "people / first-circle-1";

/** Recipe budget (R-P4 allocation): planned ceilings, asserted statically. */
export const PEOPLE_BUDGET = { maxDrawCalls: 80, maxTris: 400_000 } as const;

/** The warm field's extent: clusters rest inside this radius. */
export const PEOPLE_FIELD_RADIUS = 560;
/** A cluster's memory-lights orbit inside this radius. */
export const PEOPLE_LIGHT_ORBIT_RADIUS = 30;

/** A light's form — what kind of thing it is, never how much it matters. */
export type PeopleLightForm = "memory" | "thread" | "date" | "gathering";

export interface PeopleLight {
  nodeId: number;
  form: PeopleLightForm;
  x: number;
  y: number;
  z: number;
  /** A date that matters, when this light carries one (quiet date, never a countdown). */
  occurredAt?: string;
}

export interface PeopleCluster {
  personId: number;
  /** The brain's own chosen name for this person — never a hardcoded label. */
  name: string;
  x: number;
  y: number;
  z: number;
  lights: PeopleLight[];
  /** One plain line naming the rule inputs that placed this cluster here. */
  why: string;
}

export interface PeopleBridge {
  /** Every source edge that built this bridge (shared-memory links and/or a direct link). */
  edgeIds: number[];
  fromPersonId: number;
  toPersonId: number;
  /** The shared memories this bridge stands on (empty for a direct person↔person link). */
  viaNodeIds: number[];
}

export interface PeopleLayout {
  clusters: PeopleCluster[];
  bridges: PeopleBridge[];
  /** Clusters in the input graph (the set everything reconciles against). */
  eligibleCount: number;
  /** Person nodes deliberately excluded (archived, or no linked memory). */
  excludedCount: number;
  /** Edges touching a person that rendered as neither a light nor a bridge. */
  omittedEdgeCount: number;
  /** Q1 threshold over THIS graph window — display mirror only; the server decides travel. */
  gateOpen: boolean;
}

/**
 * A person the brain knows AS a person: a tracked `person_entity`
 * (the Mind tab roster) or an extraction-typed `person` node. The type
 * check normalizes, so the legacy `relationship_reflection` type counts
 * too — it is the same "person" the extractor meant.
 */
export function isPersonNode(node: GraphNode): boolean {
  return node.kind === "person_entity" || normalizeNodeType(node.type) === "person";
}

/** Eligible cluster set: a person with ≥1 linked memory. Archived people never qualify. */
export function isEligiblePersonNode(node: GraphNode, linkedMemoryCount: number): boolean {
  return node.status !== "archived" && isPersonNode(node) && linkedMemoryCount >= 1;
}

/**
 * The Q1 threshold, pure: at least PEOPLE_GATE_MIN_PEOPLE people each with
 * at least PEOPLE_GATE_MIN_MEMORIES_EACH linked memories, plus at least
 * PEOPLE_GATE_MIN_SHARED_MEMORIES memories shared between two people.
 * The server applies this same rule to the whole database; the layout
 * applies it to the graph window it holds.
 */
export function evaluatePeopleGate(
  memoryCounts: Map<number, number>,
  sharedMemoryCount: number,
): boolean {
  let qualifying = 0;
  for (const count of memoryCounts.values()) {
    if (count >= PEOPLE_GATE_MIN_MEMORIES_EACH) qualifying++;
  }
  return qualifying >= PEOPLE_GATE_MIN_PEOPLE && sharedMemoryCount >= PEOPLE_GATE_MIN_SHARED_MEMORIES;
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

/** An open thread: an action node whose time has not run out (no expiry, or one still ahead). */
function isOpenThread(node: GraphNode, now: Date): boolean {
  if (node.kind !== "action") return false;
  const expires = parseDate(node.expiresAt);
  return expires === null || expires.getTime() >= now.getTime();
}

function lightForm(node: GraphNode, now: Date): PeopleLightForm {
  if (node.kind === "moc") return "gathering";
  if (isOpenThread(node, now)) return "thread";
  if (parseDate(node.occurredAt) !== null) return "date";
  return "memory";
}

function clusterPosition(personId: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${PEOPLE_SEED}:${personId}`));
  const angle = rand() * Math.PI * 2;
  const radius = 90 + rand() * (PEOPLE_FIELD_RADIUS - 140);
  return { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };
}

function lightPosition(personId: number, nodeId: number): { x: number; y: number; z: number } {
  const rand = mulberry32(hashSeeded(`${PEOPLE_SEED}:${personId}:${nodeId}`));
  const angle = rand() * Math.PI * 2;
  const radius = 12 + rand() * (PEOPLE_LIGHT_ORBIT_RADIUS - 12);
  return {
    x: Math.cos(angle) * radius,
    y: 2 + rand() * 10,
    z: Math.sin(angle) * radius,
  };
}

function whyLine(
  name: string,
  memoryCount: number,
  threadCount: number,
  dateCount: number,
): string {
  const memories = `${memoryCount} memor${memoryCount === 1 ? "y" : "ies"}`;
  const threads = threadCount > 0 ? `, ${threadCount} open thread${threadCount === 1 ? "" : "s"}` : "";
  const dates = dateCount > 0 ? `, ${dateCount} date${dateCount === 1 ? "" : "s"} that matter${dateCount === 1 ? "s" : ""}` : "";
  return `${name} — ${memories}${threads}${dates}.`;
}

export function buildPeopleLayout(graph: GraphData, now: Date = new Date()): PeopleLayout {
  // Canonical input ordering (C1): id-ascending before anything is derived,
  // so the same logical data in any arrival order lays out identically.
  const nodes = [...graph.nodes].sort((a, b) => a.id - b.id);
  const edges = [...graph.links].sort((a, b) => a.id - b.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const personIds = new Set(nodes.filter(isPersonNode).map((n) => n.id));

  // Linked memories per person: incident edges whose other endpoint is a
  // non-person node present in the payload. A person linked only to
  // another person has no linked memory — and no cluster.
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

  const clusters: PeopleCluster[] = [];
  const clusterByPerson = new Map<number, PeopleCluster>();
  let excludedCount = 0;
  for (const node of nodes) {
    if (!isPersonNode(node)) continue;
    const memoryNodeIds = [...(linkedMemoryNodeIds.get(node.id) ?? new Set<number>())].sort((a, b) => a - b);
    if (!isEligiblePersonNode(node, memoryNodeIds.length)) {
      excludedCount++;
      continue;
    }
    const center = clusterPosition(node.id);
    const lights: PeopleLight[] = memoryNodeIds.map((nodeId) => {
      const memory = byId.get(nodeId)!;
      const pos = lightPosition(node.id, nodeId);
      return {
        nodeId,
        form: lightForm(memory, now),
        x: center.x + pos.x,
        y: center.y + pos.y,
        z: center.z + pos.z,
        ...(parseDate(memory.occurredAt) ? { occurredAt: memory.occurredAt } : {}),
      };
    });
    const threadCount = lights.filter((l) => l.form === "thread").length;
    const dateCount = lights.filter((l) => l.form === "date").length + (parseDate(node.occurredAt) ? 1 : 0);
    const cluster: PeopleCluster = {
      personId: node.id,
      name: node.label,
      ...center,
      lights,
      why: whyLine(node.label, lights.length, threadCount, dateCount),
    };
    clusters.push(cluster);
    clusterByPerson.set(node.id, cluster);
  }

  // Bridges: a memory shared between two people, or a direct edge between
  // two people. One bridge per unordered pair, carrying every source edge
  // and every shared memory it stands on. Edges with a missing or excluded
  // endpoint are omitted, never drawn to an invented endpoint.
  const bridgeByPair = new Map<string, PeopleBridge>();
  const bridgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const addBridge = (a: number, b: number, edgeId: number, viaNodeId?: number) => {
    if (!clusterByPerson.has(a) || !clusterByPerson.has(b)) return false;
    const key = bridgeKey(a, b);
    const existing = bridgeByPair.get(key);
    if (existing) {
      if (!existing.edgeIds.includes(edgeId)) existing.edgeIds.push(edgeId);
      if (viaNodeId !== undefined && !existing.viaNodeIds.includes(viaNodeId)) {
        existing.viaNodeIds.push(viaNodeId);
      }
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

  // Shared memories: a non-person node linked to ≥2 eligible people.
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
  let sharedMemoryCount = 0;
  for (const [memoryId, personList] of [...personsByMemory.entries()].sort((a, b) => a[0] - b[0])) {
    const eligible = personList.filter((p) => clusterByPerson.has(p)).sort((a, b) => a - b);
    if (eligible.length < 2) continue;
    sharedMemoryCount++;
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        // Every edge between this memory and either person builds the bridge.
        for (const edge of edges) {
          const touches =
            (edge.source === memoryId && (edge.target === eligible[i] || edge.target === eligible[j])) ||
            (edge.target === memoryId && (edge.source === eligible[i] || edge.source === eligible[j]));
          if (touches) addBridge(eligible[i]!, eligible[j]!, edge.id, memoryId);
        }
      }
    }
  }

  let omittedEdgeCount = 0;
  // Direct person↔person edges are bridges even when no memory is shared.
  for (const edge of edges) {
    if (personIds.has(edge.source) && personIds.has(edge.target)) {
      addBridge(edge.source, edge.target, edge.id);
    }
  }
  for (const edge of edges) {
    const sourceIsPerson = personIds.has(edge.source);
    const targetIsPerson = personIds.has(edge.target);
    if (!sourceIsPerson && !targetIsPerson) continue; // galaxy edges, not People's concern
    const renderedAsLight =
      (sourceIsPerson && clusterByPerson.has(edge.source) && byId.has(edge.target) && !personIds.has(edge.target)) ||
      (targetIsPerson && clusterByPerson.has(edge.target) && byId.has(edge.source) && !personIds.has(edge.source));
    const renderedAsBridge =
      (sourceIsPerson && targetIsPerson && clusterByPerson.has(edge.source) && clusterByPerson.has(edge.target)) ||
      [...bridgeByPair.values()].some((b) => b.edgeIds.includes(edge.id));
    if (!renderedAsLight && !renderedAsBridge) omittedEdgeCount++;
  }
  const bridges = [...bridgeByPair.values()].sort((a, b) => a.fromPersonId - b.fromPersonId || a.toPersonId - b.toPersonId);

  const memoryCounts = new Map<number, number>();
  for (const cluster of clusters) {
    memoryCounts.set(cluster.personId, cluster.lights.length);
  }
  const gateOpen = evaluatePeopleGate(memoryCounts, sharedMemoryCount);

  return {
    clusters,
    bridges,
    eligibleCount: clusters.length,
    excludedCount,
    omittedEdgeCount,
    gateOpen,
  };
}
