import type { Constellation, GraphNode, NodeRef } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { getEmbedding } from "../db/vec.js";
import { NodesRepo } from "../repositories/nodes.repo.js";

/**
 * Constellation finder — the machine-learning organization layer.
 *
 * Runs unsupervised **k-means** over the memory embedding vectors (the same
 * MiniLM vectors used for similarity search) to discover, with no labels and no
 * API calls, the natural groupings in the brain. Vectors are unit-normalized at
 * write time, so cosine similarity is just the dot product and a normalized mean
 * is a valid spherical centroid (spherical k-means). Each cluster is then named
 * from its members' most distinctive vocabulary.
 */

const STOPWORDS = new Set(
  "the a an and or but if then so of to in on at for with from by about as is are was were be been being i me my we our you your he she it they them this that these those have has had do does did will would can could should not no yes just like about into over under again more most some any all today day really thing things stuff want need feel really".split(
    " ",
  ),
);

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Normalize a vector in place to unit length (centroids drift off the sphere). */
function normalize(v: Float32Array): void {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
}

interface Sample {
  node: GraphNode;
  vec: Float32Array;
}

/** Deterministic PRNG so clusters are stable between identical calls. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** k-means++ seeding (spread initial centroids out by distance). */
function seedCentroids(samples: Sample[], k: number, rand: () => number): Float32Array[] {
  const dim = samples[0]!.vec.length;
  const centroids: Float32Array[] = [];
  const first = samples[Math.floor(rand() * samples.length)]!;
  centroids.push(Float32Array.from(first.vec));
  while (centroids.length < k) {
    // Distance to the nearest existing centroid (1 - cosine), weighted choice.
    const d = samples.map((s) => {
      let best = -1;
      for (const c of centroids) best = Math.max(best, dot(s.vec, c));
      return Math.max(0, 1 - best);
    });
    const total = d.reduce((a, b) => a + b, 0) || 1;
    let r = rand() * total;
    let idx = 0;
    for (; idx < d.length; idx++) {
      r -= d[idx]!;
      if (r <= 0) break;
    }
    const pick = samples[Math.min(idx, samples.length - 1)]!;
    const c = Float32Array.from(pick.vec);
    centroids.push(c);
    void dim;
  }
  return centroids;
}

/** Name a cluster from the words that are common inside it (simple TF). */
function nameCluster(members: GraphNode[]): string {
  const freq = new Map<string, number>();
  for (const m of members) {
    const seen = new Set<string>();
    for (const raw of `${m.label} ${m.content}`.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 4 || STOPWORDS.has(raw)) continue;
      const stem = raw.length > 7 ? raw.slice(0, 7) : raw;
      if (seen.has(stem)) continue; // count each word once per memory
      seen.add(stem);
      freq.set(stem, (freq.get(stem) ?? 0) + 1);
    }
  }
  const top = [...freq.entries()]
    .filter(([, c]) => c >= 2) // appears in at least two memories
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w);
  if (top.length === 0) {
    // Fall back to the label of the most central member.
    return members[0]?.label ?? "Uncharted cluster";
  }
  const titled = top.map((w) => w[0]!.toUpperCase() + w.slice(1));
  return `The ${titled.join(" · ")} Cluster`;
}

export interface ClusterOptions {
  /** Override the auto-chosen number of clusters. */
  k?: number;
  iterations?: number;
}

/**
 * Cluster all embedded memories into constellations. Returns [] when there are
 * too few memories to meaningfully group.
 */
export function findConstellations(
  h: DbHandle,
  opts: ClusterOptions = {},
  spaceId: string = DEFAULT_SPACE,
): Constellation[] {
  // Cluster real memories only — never an action item or a constellation hub
  // (clustering hubs would recursively propose constellations of constellations).
  const nodes = new NodesRepo(h, spaceId).all().filter((n) => n.kind !== "action" && n.kind !== "moc");
  const samples: Sample[] = [];
  for (const node of nodes) {
    const vec = getEmbedding(h.sqlite, node.id);
    if (vec) samples.push({ node, vec });
  }
  if (samples.length < 4) return [];

  // Heuristic cluster count: ~sqrt(n/2), clamped, never more than we have.
  const k = Math.max(
    2,
    Math.min(opts.k ?? Math.round(Math.sqrt(samples.length / 2)), 8, samples.length),
  );
  const iterations = opts.iterations ?? 12;
  const rand = rng(samples.length * 2654435761);

  let centroids = seedCentroids(samples, k, rand);
  let assign = new Array<number>(samples.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    // Assignment step: nearest centroid by cosine (= dot, unit vectors).
    for (let i = 0; i < samples.length; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = dot(samples[i]!.vec, centroids[c]!);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assign[i] !== best) moved = true;
      assign[i] = best;
    }
    // Update step: centroid = normalized mean of its members.
    const dim = samples[0]!.vec.length;
    const sums = Array.from({ length: k }, () => new Float32Array(dim));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < samples.length; i++) {
      const c = assign[i]!;
      counts[c]!++;
      const v = samples[i]!.vec;
      const acc = sums[c]!;
      for (let d = 0; d < dim; d++) acc[d]! += v[d]!;
    }
    centroids = sums.map((s, c) => {
      if (counts[c] === 0) return Float32Array.from(samples[Math.floor(rand() * samples.length)]!.vec);
      normalize(s);
      return s;
    });
    if (!moved && iter > 0) break;
  }

  // Assemble constellations (drop empties AND singletons), with cohesion + an auto name.
  // REG-156 / INS-10: a 1-member bucket is not a constellation — its cohesion
  // is 1.0 by construction (the centroid IS that vector), so presenting it as
  // "1 · 100% tight" with a Save button fabricates a precision figure and
  // walks the user into the promote route's min-2 error.
  const buckets = new Map<number, Sample[]>();
  for (let i = 0; i < samples.length; i++) {
    const c = assign[i]!;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c)!.push(samples[i]!);
  }

  const out: Constellation[] = [];
  let cid = 1;
  for (const [c, members] of buckets) {
    if (members.length < 2) continue;
    const centroid = centroids[c]!;
    let cohesion = 0;
    for (const m of members) cohesion += dot(m.vec, centroid);
    cohesion = Math.max(0, Math.min(1, cohesion / members.length));
    // Order members by closeness to the centroid so the "most central" is first.
    members.sort((a, b) => dot(b.vec, centroid) - dot(a.vec, centroid));
    const refs: NodeRef[] = members.map((m) => ({ id: m.node.id, label: m.node.label, type: m.node.type }));
    out.push({ id: cid++, name: nameCluster(members.map((m) => m.node)), nodes: refs, cohesion });
  }
  // Biggest, most cohesive constellations first.
  out.sort((a, b) => b.nodes.length - a.nodes.length || b.cohesion - a.cohesion);
  return out;
}
