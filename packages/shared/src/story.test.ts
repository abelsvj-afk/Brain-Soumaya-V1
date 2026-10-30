import { describe, expect, it } from "vitest";
import { checkStoryGraph, storyNeighbours, type StoryGraph } from "./story.js";
import { STORY } from "./storyCanon.js";
import { RELICS } from "./relics.js";
import { WORLD_COORDS } from "./worlds.js";

describe("the story web", () => {
  it("holds: no structural problems and no single load-bearing entry", () => {
    expect(checkStoryGraph(STORY)).toEqual([]);
  });

  it("has eight doors in, and the five kinds of thread are all used", () => {
    expect(STORY.entries.filter((e) => e.door)).toHaveLength(8);
    expect(new Set(STORY.edges.map((e) => e.type))).toEqual(new Set(["possession", "habit", "provenance", "echo", "absence"]));
  });

  it("covers all fifteen witnesses' kept things, matching the shipped relic ids", () => {
    const ids = new Set(STORY.entries.map((e) => e.id));
    for (const r of RELICS) expect(ids.has(`relic.${r.id}`), `relic.${r.id}`).toBe(true);
  });

  it("places every entry in a real world of the travel ledger (or 'anywhere')", () => {
    for (const e of STORY.entries) expect(e.world === "anywhere" || e.world in WORLD_COORDS, `${e.id}: ${e.world}`).toBe(true);
  });

  it("has no prerequisite: nothing in the schema expresses 'requires'", () => {
    for (const e of STORY.entries) expect(Object.keys(e).some((k) => /^(requires|prereq|unlock)/i.test(k))).toBe(false);
  });

  it("every register of an entry has a plain fallback (the neutral / offline text)", () => {
    for (const e of STORY.entries) if (e.text) expect(e.text.plain.length).toBeGreaterThan(0);
  });

  it("gives a door a tremor: its neighbours are other entries, never anchors", () => {
    const n = storyNeighbours(STORY, "obj.kiths-drawing");
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((x) => !x.startsWith("A"))).toBe(true);
  });
});

describe("the web checker catches a broken web (falsified)", () => {
  const anchors = [{ id: "A1", title: "x" }, { id: "A2", title: "y" }];
  const mk = (extra: Partial<StoryGraph> = {}): StoryGraph => ({
    anchors,
    entries: [
      { id: "d1", kind: "object", world: "w", title: "d1", anchors: [], claims: ["c"], door: true },
      { id: "m", kind: "object", world: "w", title: "m", anchors: ["A1"], claims: ["c"] },
      { id: "n", kind: "object", world: "w", title: "n", anchors: ["A1", "A2"], claims: ["c"] },
      { id: "o", kind: "object", world: "w", title: "o", anchors: ["A2"], claims: ["c"] },
    ],
    edges: [
      { a: "d1", b: "m", type: "echo", evidence: "" },
      { a: "d1", b: "n", type: "echo", evidence: "" },
      { a: "m", b: "n", type: "echo", evidence: "" },
      { a: "n", b: "o", type: "echo", evidence: "" },
      { a: "m", b: "o", type: "echo", evidence: "" },
    ],
    ...extra,
  });

  it("accepts a sound little web", () => {
    expect(checkStoryGraph(mk())).toEqual([]);
  });

  it("flags a cut point: one entry carrying the only path to an anchor", () => {
    const g = mk({
      edges: [
        { a: "d1", b: "m", type: "echo", evidence: "" },
        { a: "m", b: "n", type: "echo", evidence: "" },
        { a: "n", b: "o", type: "echo", evidence: "" },
      ],
    });
    expect(checkStoryGraph(g).join("\n")).toMatch(/cannot reach anchor/);
  });

  it("flags a dead end, a duplicate id, a dangling edge and banned text", () => {
    expect(checkStoryGraph(mk({ edges: [{ a: "d1", b: "m", type: "echo", evidence: "" }] })).join("\n")).toMatch(/dead end/);
    const g = mk();
    expect(checkStoryGraph({ ...g, entries: [...g.entries, g.entries[0]!] }).join("\n")).toMatch(/duplicate id/);
    expect(checkStoryGraph({ ...g, edges: [...g.edges, { a: "m", b: "ghost", type: "echo", evidence: "" }] }).join("\n")).toMatch(/unknown id/);
    const bad = { ...g, entries: g.entries.map((e) => (e.id === "m" ? { ...e, text: { plain: "The companion is Eternity." } } : e)) };
    expect(checkStoryGraph(bad).join("\n")).toMatch(/banned/);
  });
});
