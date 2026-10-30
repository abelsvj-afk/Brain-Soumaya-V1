/**
 * The story's web (docs/lore/DRAFT_6_THE_LOOM.md, docs/specs/story-flavor-engine-2026-10-30.md §2–3). Pure types + a checker.
 * Content lives in storyCanon.ts; per-player progress is a separate, server-side thing (docs/specs/lore-storage-2026-10-30.md) and holds ids only.
 *
 * The shape is a spider's web: ANCHORS (immutable truths) ← entries ← DOORS (the rim a player can start from), joined sideways by typed
 * cross-threads. Non-linear by construction: nothing here can say "requires X" (the schema has no such field), and the checker proves the web holds
 * if any single entry is removed.
 */

export type StoryKind = "object" | "account" | "sight" | "echo" | "companion";
/** The five ways two things connect (Draft 5 §2.3). */
export type EdgeType = "possession" | "habit" | "provenance" | "echo" | "absence";
export type Register = "plain" | "warm" | "grave";

/** Every register voices the SAME claims (Flavour colours; it never alters a fact). `plain` is mandatory: the neutral / offline text. */
export interface Variants {
  plain: string;
  warm?: string;
  grave?: string;
}

export interface StoryEntry {
  /** Stable forever; never reused. Text can change, the id cannot. */
  id: string;
  kind: StoryKind;
  /** Where it is found (a world id, or "anywhere"). */
  world: string;
  title: string;
  /** Atomic facts this entry carries; identical for every register. */
  claims: string[];
  /** The anchors this entry bears on directly. */
  anchors: string[];
  /** A rim entry — a valid first find (Draft 5 §2.2). */
  door?: boolean;
  /** Retired from canon: progress keeps the id, the Book stops showing it. */
  retired?: boolean;
  text?: Variants;
}

export interface StoryEdge {
  a: string;
  b: string;
  type: EdgeType;
  /** Why they are joined — authoring evidence, never shown. */
  evidence: string;
}

export interface StoryAnchor {
  id: string;
  title: string;
}

export interface StoryGraph {
  anchors: readonly StoryAnchor[];
  entries: readonly StoryEntry[];
  edges: readonly StoryEdge[];
}

/** Phrases no text may ever contain (Draft 3 §10 / Draft 4 §14, the Never-say list). */
export const STORY_BANNED: readonly RegExp[] = [
  /\bthe unnamed woman'?s? name is\b/i,
  /\bEternity (was )?(created|made) by\b/i,
  /\bsomething (is )?above Eternity\b/i,
  /\bthe companion is Eternity\b/i,
];

type Id = string;

function adjacency(g: StoryGraph, removed: Id | null): Map<Id, Set<Id>> {
  const adj = new Map<Id, Set<Id>>();
  const add = (x: Id, y: Id) => {
    if (x === removed || y === removed) return;
    (adj.get(x) ?? adj.set(x, new Set()).get(x)!).add(y);
    (adj.get(y) ?? adj.set(y, new Set()).get(y)!).add(x);
  };
  for (const a of g.anchors) if (a.id !== removed) adj.set(a.id, adj.get(a.id) ?? new Set());
  for (const e of g.entries) if (!e.retired && e.id !== removed) adj.set(e.id, adj.get(e.id) ?? new Set());
  for (const e of g.entries) {
    if (e.retired) continue;
    for (const a of e.anchors) add(e.id, a);
  }
  for (const x of g.edges) add(x.a, x.b);
  return adj;
}

function reachable(adj: Map<Id, Set<Id>>, from: Id): Set<Id> {
  const seen = new Set<Id>();
  if (!adj.has(from)) return seen;
  const stack = [from];
  seen.add(from);
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of adj.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        stack.push(m);
      }
    }
  }
  return seen;
}

/**
 * Everything that is wrong with a story graph, as readable lines (empty = the web holds):
 * unique ids · edges point at real entries · every entry bears on an anchor or has ≥ 2 threads · every anchor is reached by ≥ 2 entries ·
 * a Variants block always has `plain` · no banned phrase · and REDUNDANCY — remove any one entry and every anchor is still reachable from every door.
 */
export function checkStoryGraph(g: StoryGraph): string[] {
  const issues: string[] = [];
  const ids = new Set<Id>();
  for (const x of [...g.anchors.map((a) => a.id), ...g.entries.map((e) => e.id)]) {
    if (ids.has(x)) issues.push(`duplicate id: ${x}`);
    ids.add(x);
  }
  for (const e of g.edges) {
    if (!ids.has(e.a)) issues.push(`edge from unknown id: ${e.a}`);
    if (!ids.has(e.b)) issues.push(`edge to unknown id: ${e.b}`);
    if (e.a === e.b) issues.push(`edge to itself: ${e.a}`);
  }
  const anchorIds = new Set(g.anchors.map((a) => a.id));
  for (const e of g.entries) {
    for (const a of e.anchors) if (!anchorIds.has(a)) issues.push(`${e.id} names unknown anchor ${a}`);
    if (e.claims.length === 0) issues.push(`${e.id} carries no claim`);
    if (e.text && !e.text.plain) issues.push(`${e.id} has variants but no plain text`);
    for (const t of Object.values(e.text ?? {})) for (const re of STORY_BANNED) if (t && re.test(t)) issues.push(`${e.id} contains banned text ${re}`);
  }
  if (issues.length) return issues; // structural errors first; the graph maths below assumes a sound graph

  const live = g.entries.filter((e) => !e.retired);
  const doors = live.filter((e) => e.door);
  if (doors.length === 0) issues.push("the web has no doors in");
  const base = adjacency(g, null);
  for (const e of live) {
    const deg = base.get(e.id)?.size ?? 0;
    if (deg < 2) issues.push(`${e.id} is a dead end (${deg} thread${deg === 1 ? "" : "s"}); every entry needs at least 2`);
  }
  for (const a of g.anchors) {
    const bearing = live.filter((e) => e.anchors.includes(a.id)).length;
    if (bearing < 2) issues.push(`anchor ${a.id} (${a.title}) is borne by only ${bearing} entr${bearing === 1 ? "y" : "ies"}; needs at least 2`);
  }
  // Redundancy: no single entry is load-bearing for the web.
  for (const removed of [null, ...live.map((e) => e.id)]) {
    const adj = adjacency(g, removed);
    for (const d of doors) {
      if (d.id === removed) continue;
      const reach = reachable(adj, d.id);
      for (const a of g.anchors) {
        if (!reach.has(a.id)) issues.push(`without ${removed ?? "nothing"}, door ${d.id} cannot reach anchor ${a.id}`);
      }
    }
  }
  return issues;
}

/** The entries one step from `id` — what gives a faint "tremor" when `id` is found (cosmetic; never a pointer). */
export function storyNeighbours(g: StoryGraph, id: string): string[] {
  const adj = adjacency(g, null);
  const anchorIds = new Set(g.anchors.map((a) => a.id));
  return [...(adj.get(id) ?? [])].filter((n) => !anchorIds.has(n)).sort();
}
