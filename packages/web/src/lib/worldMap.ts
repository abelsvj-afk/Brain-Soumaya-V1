import type { TravelJourney } from "@brain/shared";
import { WORLD_CHART, routeLegCost } from "./routeBoard.js";

/**
 * The world map's data model (world map, Rev 116) — pure derivation, no
 * React, no fetching. The map draws what the traveller has discovered:
 *
 * - A world is DISCOVERED when it is home (always known), the world the
 *   server says the traveller is in, either end of a route already
 *   travelled, or either end of the journey now in progress. A world
 *   appears only on first travel and discovery (Q3) — never because it
 *   was created, never as an "unknown" marker (Q2: undiscovered worlds
 *   are hidden entirely, not even as unnamed marks).
 * - A route is DISCOVERED when both its worlds are discovered: the
 *   server permits travel between any two chart worlds, so the
 *   connection is known once both ends are. A route is TRAVELLED when
 *   either direction sits in the traversed record. Travelled routes
 *   draw bright; discovered-but-untravelled routes draw faint.
 * - The BRIGHT leg is the current journey's leg, else the most recent
 *   travelled leg. The map draws the current or most recent journey
 *   only (Q4) — the full history stays in the server's journey records.
 * - Fuel per leg is the server's own price (WARP_COST), displayed only
 *   — the server settles, exactly like the route board (GH-19). A chain
 *   is the shortest path over discovered routes; every chart world is
 *   directly reachable today, so chains are one leg until a gated world
 *   (Eternity) needs more.
 * - The SHIMMER is the settled hint (Q6): a faint, unnamed, unclickable
 *   shimmer in a far region — no label, no route, no distance, no
 *   interaction. It says something is out there without saying what.
 *
 * Discovery reads the client's traversed-routes record
 * (`worlds.traversedRoutes`, the same record the skip rule reads) — the
 * map fetches nothing new and no new server surface exists for it. On a
 * fresh device the record is empty, so the map shows home plus the
 * current world until the traveller travels — which is the Q3 rule, not
 * a defect.
 */

export const WORLD_MAP_VIEWBOX = { width: 1000, height: 700 } as const;
export const WORLD_MAP_SEED = "world-map / star-chart-1";
export const WORLD_MAP_STAR_COUNT = 140;
/** The shimmer's fixed place: a far region, away from every node. */
export const WORLD_MAP_SHIMMER = { x: 920, y: 80 } as const;

/** Node positions are fixed per known world (a pleasant spread); a world
 *  the chart does not know yet gets a deterministic outer-ring place from
 *  its key, so the map never has to guess twice. */
export const WORLD_NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  home: { x: 500, y: 380 },
  "great-station": { x: 760, y: 250 },
  "growing-place": { x: 250, y: 480 },
  "deep-past": { x: 300, y: 180 },
};

/** Node colours follow the settled world palettes (station amber, garden
 *  green, deep-past violet, home warm white) — never colour alone: the
 *  current world is also named in words. */
export const WORLD_NODE_COLORS: Record<string, string> = {
  home: "#fff6e0",
  "great-station": "#ffb454",
  "growing-place": "#6fa055",
  "deep-past": "#8a76c9",
};
const FALLBACK_NODE_COLOR = "#cfe0ff";

export interface MapNode {
  key: string;
  name: string;
  blurb: string;
  x: number;
  y: number;
  color: string;
  isCurrent: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  traveled: boolean;
  bright: boolean;
  /** The fuel this edge costs, in plain words, from the traveller's
   *  current world when the edge touches it — "free" for a homebound
   *  leg, "10 fuel" for a warp leg, "10 fuel · free home" when the edge
   *  touches home but not the current world (its two directions differ).
   *  The price is the server's own (WARP_COST); the map displays it, the
   *  server settles it. */
  costLabel: string;
}

export interface MapLeg {
  from: string;
  to: string;
  costWarp: number;
  costDrift: number;
}

export interface MapChain {
  legs: MapLeg[];
  totalWarp: number;
  totalDrift: number;
}

export interface MapStar {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

export interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
  currentWorld: string;
  shimmer: { x: number; y: number };
  stars: MapStar[];
}

export interface TraversedLeg {
  origin: string;
  destination: string;
}

/** Deterministic PRNG (mulberry32) over a string seed — the same recipe
 *  the world layouts use, kept local so this module stays self-contained. */
function rngFromSeed(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nodePosition(key: string): { x: number; y: number } {
  const fixed = WORLD_NODE_POSITIONS[key];
  if (fixed) return fixed;
  // Unknown world: a deterministic place on the outer ring, from its key.
  const rand = rngFromSeed(`${WORLD_MAP_SEED}:${key}`);
  const angle = rand() * Math.PI * 2;
  const radius = 290 + rand() * 40;
  return {
    x: Math.round(500 + Math.cos(angle) * radius),
    y: Math.round(350 + Math.sin(angle) * radius * 0.8),
  };
}

function nodeColor(key: string): string {
  return WORLD_NODE_COLORS[key] ?? FALLBACK_NODE_COLOR;
}

function buildStars(): MapStar[] {
  const rand = rngFromSeed(`${WORLD_MAP_SEED}:stars`);
  const stars: MapStar[] = [];
  for (let i = 0; i < WORLD_MAP_STAR_COUNT; i++) {
    stars.push({
      x: Math.round(rand() * WORLD_MAP_VIEWBOX.width),
      y: Math.round(rand() * WORLD_MAP_VIEWBOX.height),
      r: 0.6 + rand() * 1.2,
      opacity: 0.25 + rand() * 0.55,
    });
  }
  return stars;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function deriveMapData(input: {
  currentWorld: string;
  activeJourney: TravelJourney | null;
  traversed: TraversedLeg[];
}): MapData {
  const chartKeys = new Set(WORLD_CHART.map((w) => w.key));
  const discovered = new Set<string>();
  if (chartKeys.has("home")) discovered.add("home");
  if (chartKeys.has(input.currentWorld)) discovered.add(input.currentWorld);
  for (const leg of input.traversed) {
    if (chartKeys.has(leg.origin)) discovered.add(leg.origin);
    if (chartKeys.has(leg.destination)) discovered.add(leg.destination);
  }
  // A journey in progress counts as discovery in motion: the traveller
  // is en route to its destination, so the map shows where they are going.
  const active = input.activeJourney;
  if (active) {
    if (chartKeys.has(active.origin)) discovered.add(active.origin);
    if (chartKeys.has(active.destination)) discovered.add(active.destination);
  }

  const nodes: MapNode[] = WORLD_CHART.filter((w) => discovered.has(w.key)).map((w) => {
    const pos = nodePosition(w.key);
    return {
      key: w.key,
      name: w.name,
      blurb: w.blurb,
      x: pos.x,
      y: pos.y,
      color: nodeColor(w.key),
      isCurrent: w.key === input.currentWorld,
    };
  });

  // The bright leg: the journey now in progress, else the most recent
  // travelled leg (the traversed record is append-ordered).
  const brightLeg = active
    ? { origin: active.origin, destination: active.destination }
    : input.traversed.length > 0
      ? input.traversed[input.traversed.length - 1]
      : null;
  const brightPair = brightLeg ? pairKey(brightLeg.origin, brightLeg.destination) : null;
  const traveledPairs = new Set(
    input.traversed.map((l) => pairKey(l.origin, l.destination)),
  );
  if (active) traveledPairs.add(pairKey(active.origin, active.destination));

  const edges: MapEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b) continue;
      const from = a.key;
      const to = b.key;
      // A warp leg costs 10 except homebound (free), so an edge touching
      // home has two different prices. The label shows the price from
      // the current world when the edge touches it, else both prices.
      const outCost = routeLegCost("warp", to);
      const backCost = routeLegCost("warp", from);
      let costLabel: string;
      if (from === input.currentWorld) {
        costLabel = outCost === 0 ? "free" : `${outCost} fuel`;
      } else if (to === input.currentWorld) {
        costLabel = backCost === 0 ? "free" : `${backCost} fuel`;
      } else if (outCost === backCost) {
        costLabel = outCost === 0 ? "free" : `${outCost} fuel`;
      } else {
        costLabel = `${outCost} fuel · free home`;
      }
      edges.push({
        from,
        to,
        traveled: traveledPairs.has(pairKey(from, to)),
        bright: brightPair === pairKey(from, to),
        costLabel,
      });
    }
  }

  return {
    nodes,
    edges,
    currentWorld: input.currentWorld,
    shimmer: { ...WORLD_MAP_SHIMMER },
    stars: buildStars(),
  };
}

/** The chain from the current world to a destination: the shortest path
 *  over discovered routes, with the server's per-leg prices summed.
 *  Returns null when no route on the map reaches the destination. */
export function chainTo(destination: string, data: MapData): MapChain | null {
  if (destination === data.currentWorld) return { legs: [], totalWarp: 0, totalDrift: 0 };
  // Breadth-first over the discovered edges (undirected for the map's
  // "which ways" question — every route runs both ways).
  const neighbours = new Map<string, string[]>();
  for (const e of data.edges) {
    const a = neighbours.get(e.from) ?? [];
    const b = neighbours.get(e.to) ?? [];
    a.push(e.to);
    b.push(e.from);
    neighbours.set(e.from, a);
    neighbours.set(e.to, b);
  }
  const prev = new Map<string, string>();
  const seen = new Set<string>([data.currentWorld]);
  const queue = [data.currentWorld];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    if (cur === destination) break;
    for (const n of neighbours.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!seen.has(destination)) return null;
  const keys: string[] = [destination];
  for (;;) {
    const head = keys[0];
    if (head === undefined || head === data.currentWorld) break;
    const p = prev.get(head);
    if (!p) return null;
    keys.unshift(p);
  }
  const legs: MapLeg[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const from = keys[i];
    const to = keys[i + 1];
    if (from === undefined || to === undefined) return null;
    legs.push({ from, to, costWarp: routeLegCost("warp", to), costDrift: 0 });
  }
  return {
    legs,
    totalWarp: legs.reduce((s, l) => s + l.costWarp, 0),
    totalDrift: 0,
  };
}
