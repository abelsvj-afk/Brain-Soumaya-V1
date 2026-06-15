import { NODE_TYPES, type NodeType, type RelationshipType } from "@brain/shared";
import { createDb } from "./db/client.js";
import { upsertEmbedding, EMBED_DIM, type RawDb } from "./db/vec.js";

/** A random unit (L2-normalized) vector — stand-in for a real embedding. */
export function randomUnitVec(dim: number = EMBED_DIM): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const x = Math.random() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] = v[i]! / norm;
  return v;
}

export function insertNode(
  sqlite: RawDb,
  label: string,
  type: NodeType,
  content: string,
): number {
  const r = sqlite
    .prepare(`INSERT INTO nodes(label, type, content) VALUES (?, ?, ?)`)
    .run(label, type, content);
  return Number(r.lastInsertRowid);
}

export function insertEdge(
  sqlite: RawDb,
  source: number,
  target: number,
  relationship: RelationshipType,
  weight = 1,
): void {
  sqlite
    .prepare(`INSERT INTO edges(source, target, relationship, weight) VALUES (?, ?, ?, ?)`)
    .run(source, target, relationship, weight);
}

export interface SeedIds {
  /** Chain A -> B -> C -> D (for multi-hop / directed tests). */
  a: number;
  b: number;
  c: number;
  d: number;
  /** Cycle X -> Y -> Z -> X (for cycle-safety tests). */
  x: number;
  y: number;
  z: number;
}

/** Seed a small, deterministic graph with a chain and a cycle. */
export function seed(sqlite: RawDb): SeedIds {
  const a = insertNode(sqlite, "Foundational idea", "business_idea", "The seed of it all.");
  const b = insertNode(sqlite, "Refinement", "business_idea", "Builds on the foundation.");
  const c = insertNode(sqlite, "Pivot", "business_idea", "A consequence of the refinement.");
  const d = insertNode(sqlite, "Launch", "business_idea", "The eventual outcome.");

  insertEdge(sqlite, a, b, "builds_on", 0.9);
  insertEdge(sqlite, b, c, "builds_on", 0.8);
  insertEdge(sqlite, c, d, "resolves", 0.7);

  const x = insertNode(sqlite, "Worry", "relationship_reflection", "A recurring worry.");
  const y = insertNode(sqlite, "Avoidance", "relationship_reflection", "Avoiding the worry.");
  const z = insertNode(sqlite, "Resentment", "relationship_reflection", "Which feeds back.");

  insertEdge(sqlite, x, y, "complicates", 0.6);
  insertEdge(sqlite, y, z, "complicates", 0.6);
  insertEdge(sqlite, z, x, "caused_by", 0.6); // closes the cycle

  for (const id of [a, b, c, d, x, y, z]) {
    upsertEmbedding(sqlite, id, randomUnitVec());
  }
  return { a, b, c, d, x, y, z };
}

/** Seed a larger random graph for latency benchmarking. */
export function seedLarge(sqlite: RawDb, n: number): number[] {
  const ids: number[] = [];
  const insertMany = sqlite.transaction(() => {
    for (let i = 0; i < n; i++) {
      const type = NODE_TYPES[i % NODE_TYPES.length]!;
      const id = insertNode(sqlite, `Thought ${i}`, type, `Body of thought ${i}`);
      ids.push(id);
      upsertEmbedding(sqlite, id, randomUnitVec());
    }
    // Sparse edges: a chain plus a couple of random links per node.
    for (let i = 1; i < ids.length; i++) {
      insertEdge(sqlite, ids[i - 1]!, ids[i]!, "relates_to", 0.5);
      const r = Math.floor(Math.random() * ids.length);
      if (r !== i) insertEdge(sqlite, ids[i]!, ids[r]!, "relates_to", 0.3);
    }
  });
  insertMany();
  return ids;
}

// CLI entry: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { sqlite } = createDb(process.env.DB_PATH ?? "./brain.db");
  const ids = seed(sqlite);
  const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes`).get() as { c: number };
  console.log(`Seeded ${count.c} nodes. Ids:`, ids);
}
