import { describe, it, expect } from "vitest";
import type { GraphEdge, GraphNode } from "@brain/shared";
import { focusItemStyle, songDotStyle, getFigurineIcon, getFigurineLabel, mergeGraphNodes, mergeGraphLinks, mergeGraphData } from "./App.helpers.js";

/** Locks the pure presentational helpers extracted from App.tsx (D4), so a future
 *  refactor that touches them fails loudly instead of silently. */
describe("App.helpers", () => {
  it("labels + icons every known figurine, and falls back for unknowns", () => {
    expect(getFigurineLabel("blackhole")).toBe("The Singularity");
    expect(getFigurineIcon("station")).toBe("🌐");
    expect(getFigurineLabel("station")).toBe("Waystation Figurine");
    // Unknown → label echoes the type, icon uses the stone default.
    expect(getFigurineLabel("mystery")).toBe("mystery");
    expect(getFigurineIcon("mystery")).toBe("🗿");
  });

  it("stacks focus-cluster items upward when open, collapsed when closed", () => {
    const closed = focusItemStyle(2, false);
    const open = focusItemStyle(2, true);
    expect(closed).toBeTruthy();
    expect(open).toBeTruthy();
    // Opening changes the style (it animates outward) — exact geometry may evolve, but
    // the two states must differ.
    expect(JSON.stringify(open)).not.toBe(JSON.stringify(closed));
  });

  it("spreads song dots around the ring (each index a distinct position)", () => {
    const a = songDotStyle(0, 3);
    const b = songDotStyle(1, 3);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

/** Galaxy render-stall root-cause fix (2026-09-10), extended by the populate-path
 *  repair D1/D5 (docs/repairs/galaxy-populate-render-stall.md): three-forcegraph's
 *  node AND link object caches key entries by raw object identity, not `.id` — a
 *  freshly-fetched graph must reuse existing object references by id or every
 *  Object3D gets disposed/rebuilt on every refresh. See the merge doc comments
 *  for the full confirmed mechanism. */
describe("mergeGraphNodes / mergeGraphLinks / mergeGraphData", () => {
  const node = (overrides: Partial<GraphNode>): GraphNode => ({
    id: 1,
    label: "n",
    type: "memory" as GraphNode["type"],
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  const link = (overrides: Partial<GraphEdge>): GraphEdge => ({
    id: 1,
    source: 1,
    target: 2,
    relationship: "relates_to",
    weight: 0.5,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("reuses the SAME object reference for an id that already exists", () => {
    const existing = node({ id: 1, label: "old" }) as GraphNode & { x?: number; y?: number };
    // Position fields are client-only (never present on a fresh server payload) —
    // simulate orbits.ts having already placed this node.
    existing.x = 42;
    existing.y = 7;
    const fresh = node({ id: 1, label: "new", importance: 0.9 });

    const merged = mergeGraphNodes([existing], [fresh])[0]!;

    expect(merged).toBe(existing); // same reference — the entire point of the fix
    expect(merged.label).toBe("new"); // server fields DID update
    expect(merged.importance).toBe(0.9);
    expect((merged as any).x).toBe(42); // client-only position field survived untouched
    expect((merged as any).y).toBe(7);
  });

  it("gives a genuinely new id a fresh object, not a stale reference", () => {
    const existing = node({ id: 1 });
    const freshExisting = node({ id: 1 });
    const freshNew = node({ id: 2, label: "brand new" });

    const merged = mergeGraphNodes([existing], [freshExisting, freshNew]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(existing);
    expect(merged[1]).toBe(freshNew); // no prior object for id 2 — the fresh one is used as-is
  });

  it("drops a node no longer present in the fresh payload (deletion)", () => {
    const merged = mergeGraphNodes([node({ id: 1 }), node({ id: 2 })], [node({ id: 1 })]);
    expect(merged.map((n) => n.id)).toEqual([1]);
  });

  it("mergeGraphNodes does not copy unknown fields from the fresh payload (criterion 5)", () => {
    const existing = node({ id: 1, label: "old" });
    const fresh = { ...node({ id: 1, label: "new" }), __injected: "evil" } as GraphNode;
    const merged = mergeGraphNodes([existing], [fresh])[0]!;

    expect(merged).toBe(existing);
    expect(merged.label).toBe("new"); // allowlisted server field DID update
    expect((merged as unknown as Record<string, unknown>).__injected).toBeUndefined();
  });

  it("mergeGraphData merges nodes and links by id, preserving both references", () => {
    const prevNode = node({ id: 1 });
    const prevLink = link({ id: 1, weight: 0.5 });
    const merged = mergeGraphData(
      { nodes: [prevNode, node({ id: 2 })], links: [prevLink] },
      {
        nodes: [node({ id: 1, label: "x" }), node({ id: 2 })],
        links: [link({ id: 1, weight: 0.7 })],
      },
    );

    expect(merged.nodes[0]).toBe(prevNode);
    expect(merged.links[0]).toBe(prevLink); // same link object — no longer passed through fresh
    expect(merged.links[0]!.weight).toBe(0.7); // …but its scalar fields updated
  });

  it("mergeGraphData drops a fresh link whose endpoint is outside the merged node set", () => {
    // Regression: `node not found: 150` — a payload link pointing at a node the
    // payload itself omits (superseded/merged-away) must never reach the
    // renderer, which throws on the dangling endpoint.
    const merged = mergeGraphData(
      { nodes: [], links: [] },
      {
        nodes: [node({ id: 1 }), node({ id: 2 })],
        links: [
          link({ id: 10, source: 1, target: 2 }),
          link({ id: 11, source: 1, target: 150 }),
        ],
      },
    );
    expect(merged.links.map((l) => l.id)).toEqual([10]);
  });

  it("mergeGraphData keeps a surviving link whose endpoints d3 already resolved to node objects", () => {
    const prevNode = node({ id: 1 });
    const prevNode2 = node({ id: 2 });
    const resolved = link({ id: 5, source: 1, target: 2 });
    // d3-force resolves endpoints into node object references in place once a
    // link has rendered — the guard must read the id through the object, not
    // mistake a healthy rendered link for a dangling one.
    (resolved as unknown as { source: unknown }).source = prevNode;
    (resolved as unknown as { target: unknown }).target = prevNode2;
    const merged = mergeGraphData(
      { nodes: [prevNode, prevNode2], links: [resolved] },
      {
        nodes: [node({ id: 1 }), node({ id: 2 })],
        links: [link({ id: 5, source: 1, target: 2 })],
      },
    );
    expect(merged.links.map((l) => l.id)).toEqual([5]);
    expect(merged.links[0]).toBe(resolved);
  });
});

describe("mergeGraphLinks", () => {
  const link = (overrides: Partial<GraphEdge>): GraphEdge => ({
    id: 1,
    source: 1,
    target: 2,
    relationship: "relates_to",
    weight: 0.5,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("reuses the SAME link object for a matching edge id and updates scalar fields", () => {
    const existing = link({ id: 7, weight: 0.5, relationship: "relates_to" });
    const fresh = link({ id: 7, weight: 0.9, relationship: "builds_on" });

    const merged = mergeGraphLinks([existing], [fresh])[0]!;

    expect(merged).toBe(existing); // same reference — the digest keeps its Object3D
    expect(merged.weight).toBe(0.9);
    expect(merged.relationship).toBe("builds_on");
  });

  it("gives a genuinely new edge id a fresh object, not a stale reference", () => {
    const existing = link({ id: 1 });
    const freshNew = link({ id: 2, weight: 0.8 });

    const merged = mergeGraphLinks([existing], [link({ id: 1 }), freshNew]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(existing);
    expect(merged[1]).toBe(freshNew); // no prior object for id 2 — the fresh one is used as-is
  });

  it("drops a link no longer present without mutating the dropped object", () => {
    const dropped = link({ id: 9, weight: 0.1 });

    const merged = mergeGraphLinks([link({ id: 1 }), dropped], [link({ id: 1 })]);

    expect(merged.map((l) => l.id)).toEqual([1]);
    expect(dropped.weight).toBe(0.1); // dropped objects are never touched
  });

  it("keeps reversed pairs A→B and B→A distinct (id-keyed, never endpoint-keyed)", () => {
    const ab = link({ id: 1, source: 1, target: 2, weight: 0.5 });
    const ba = link({ id: 2, source: 2, target: 1, weight: 0.3 });

    const merged = mergeGraphLinks([ab, ba], [
      link({ id: 1, source: 1, target: 2, weight: 0.8 }),
      link({ id: 2, source: 2, target: 1, weight: 0.4 }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(ab);
    expect(merged[1]).toBe(ba);
    expect(ab.weight).toBe(0.8); // each merged by its own id…
    expect(ba.weight).toBe(0.4); // …not collapsed by endpoint pair
  });

  it("never clobbers d3-resolved source/target and never copies unknown fields (criterion 5)", () => {
    const nodeA = { id: 1 };
    const nodeB = { id: 2 };
    // Simulate d3-force having resolved source/target into node object references.
    const existing = {
      ...link({ id: 1, weight: 0.5 }),
      source: nodeA as unknown as number,
      target: nodeB as unknown as number,
    };
    const fresh = { ...link({ id: 1, source: 1, target: 2, weight: 0.9 }), __injected: true } as GraphEdge;

    const merged = mergeGraphLinks([existing], [fresh])[0]!;

    expect(merged).toBe(existing);
    expect(merged.source).toBe(nodeA); // resolved reference preserved, not clobbered to raw id
    expect(merged.target).toBe(nodeB);
    expect(merged.weight).toBe(0.9); // allowlisted scalar DID update
    expect((merged as unknown as Record<string, unknown>).__injected).toBeUndefined();
  });
});
