import { describe, expect, it } from "vitest";
import { checkStoryGraph, storyNeighbours, type StoryGraph } from "./story.js";
import { STORY, STORY_SECOND_READINGS, storySecondReading } from "./storyCanon.js";
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

  it("Second Readings point at real entries, appear only with a held partner, and are one sentence", () => {
    const ids = new Set(STORY.entries.map((e) => e.id));
    for (const [id, r] of Object.entries(STORY_SECOND_READINGS)) {
      expect(ids.has(id), id).toBe(true);
      for (const w of r.with) expect(ids.has(w), `${id} with ${w}`).toBe(true);
      expect((r.text.match(/[.!?]/g) ?? []).length, id).toBe(1);
    }
    expect(storySecondReading("obj.vesh-paper-boat", new Set())).toBeNull();
    expect(storySecondReading("obj.vesh-paper-boat", new Set(["sight.lullaby-hollow"]))).toMatch(/gap along a certain hull/);
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

import { STORY_TRIGGERS, hourBand, npcGifts, pickNoticed, triggerFor } from "./storyTriggers.js";

describe("how things are found", () => {
  const byId = new Map(STORY.entries.map((e) => [e.id, e]));
  it("only releases entries that exist, have words, and sit in the world the trigger names", () => {
    for (const t of STORY_TRIGGERS) {
      const e = byId.get(t.entryId);
      expect(e, t.entryId).toBeTruthy();
      if (t.how !== "relic") expect(e!.text?.plain, `${t.entryId} needs words before it can be found`).toBeTruthy();
      expect(e!.world === t.world || e!.world === "anywhere", `${t.entryId}: ${e!.world} vs ${t.world}`).toBe(true);
      expect(t.world in WORLD_COORDS).toBe(true);
    }
  });
  it("every entry has words AND a way to be found (nothing is dead content)", () => {
    const released = new Set(STORY_TRIGGERS.map((t) => t.entryId));
    for (const e of STORY.entries) {
      expect(e.text?.plain, `${e.id} needs words`).toBeTruthy();
      expect(released.has(e.id), `${e.id} needs a trigger`).toBe(true);
    }
  });
  it("releases every witness relic through the shipped relic system, in its own world", () => {
    for (const r of RELICS) {
      const t = triggerFor(`relic.${r.id}`, "relic");
      expect(t?.world, r.id).toBe(r.world);
    }
  });
  it("the Hour only decides what comes FIRST — everything in a world is reachable at any hour", () => {
    const hours = ["first-light", "measure", "threshold", "growing", "hearths", "rest", "standing"] as const;
    for (const world of ["great-station", "quiet-archive", "eternity"]) {
      for (const how of ["regard", "listen"] as const) {
        const seen = new Set<string>();
        for (const h of hours) {
          const found = new Set<string>();
          for (let i = 0; i < 20; i++) {
            const id = pickNoticed(world, how, h, found);
            if (!id) break;
            found.add(id);
            seen.add(id);
          }
        }
        const all = STORY_TRIGGERS.filter((t) => t.how === how && t.world === world).map((t) => t.entryId);
        expect([...seen].sort()).toEqual(all.sort());
      }
    }
    expect(pickNoticed("great-station", "regard", "threshold", new Set())).toBe("sight.second-seam");
    expect(pickNoticed("great-station", "regard", "rest", new Set())).toBe("sight.missing-berth");
    const everythingInPeople = new Set(STORY_TRIGGERS.filter((t) => t.how === "regard" && t.world === "people").map((t) => t.entryId));
    expect(pickNoticed("people", "regard", "rest", everythingInPeople)).toBeNull();
  });
  it("bands the local day into the seven Hours with no gap", () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) seen.add(hourBand(new Date(2026, 9, 30, h)));
    expect(seen.size).toBe(7);
  });
  it("people give things only after enough meetings, once", () => {
    expect(npcGifts("wayfarer", 0, new Set())).toEqual([]);
    expect(npcGifts("wayfarer", 2, new Set())).toEqual([]); // trust is not given on a second meeting
    expect(npcGifts("wayfarer", 3, new Set())).toEqual(["obj.doorkeepers-nail"]);
    expect(npcGifts("wayfarer", 9, new Set(["obj.doorkeepers-nail"]))).toEqual([]);
    expect(npcGifts("broker", 3, new Set())).toEqual([]);
    expect(npcGifts("broker", 4, new Set())).toEqual(["obj.dorrows-page"]);
    expect(npcGifts("broker", 6, new Set(["obj.dorrows-page"]))).toEqual(["obj.anonymous-payments"]);
  });
});

import { STORY_REACTIONS, reactionBetween, reactionFor } from "./storyReactions.js";
import { NPC_CAST } from "./npcs.js";

describe("Item Reactions", () => {
  it("belong to people who exist, about things that exist, in one short sideways line", () => {
    const ids = new Set(STORY.entries.map((e) => e.id));
    const cast = new Set(NPC_CAST.map((c) => c.id));
    for (const r of STORY_REACTIONS) {
      expect(cast.has(r.npc), r.npc).toBe(true);
      expect(ids.has(r.holds), r.holds).toBe(true);
      expect(r.line.split(/\s+/).length).toBeLessThanOrEqual(30);
      expect(r.line).not.toMatch(/\d/);
    }
  });
  it("only fire for what you hold, and never require giving anything up", () => {
    expect(reactionFor("keeper", new Set())).toBeNull();
    expect(reactionFor("keeper", new Set(["relic.witness-seed"]))?.line).toMatch(/water/);
    expect(reactionBetween("keeper", "relic.harbor-nail")).toBeNull(); // the server refuses a pairing that does not exist
  });
});

import { eligibleHere, spotReach } from "./storyTriggers.js";

describe("physical spots", () => {
  it("every regard/listen in a world the viewer can move through has a spot; only Eternity has none (documented)", () => {
    for (const t of STORY_TRIGGERS.filter((x) => x.how === "regard" || x.how === "listen")) {
      if (t.world === "eternity") expect(t.spot, t.entryId).toBeUndefined();
      else expect(t.spot, `${t.entryId} needs a physical spot`).toBeTruthy();
    }
  });
  it("reach is a plain distance: inside the spot's radius, not outside it", () => {
    const rim = { place: "x", at: [0, -0.5, 0], near: 0.5 } as const;
    // landmark at (100,0,0), radius 200 → the point is (100,-100,0); reach 100
    expect(spotReach(rim, [100, 0, 0], 200, [100, -100, 90])).toBe(true);
    expect(spotReach(rim, [100, 0, 0], 200, [100, -100, 110])).toBe(false);
    expect(spotReach({ origin: true, near: 160 }, [0, 0, 0], 1, [150, 0, 0])).toBe(true);
    expect(spotReach({ origin: true, near: 160 }, [0, 0, 0], 1, [170, 0, 0])).toBe(false);
  });
  it("a small landmark still has a sensible minimum reach", () => {
    expect(spotReach({ place: "x", near: 0.1 }, [0, 0, 0], 10, [50, 0, 0])).toBe(true); // min 60 units
    expect(spotReach({ place: "x", near: 0.1 }, [0, 0, 0], 10, [70, 0, 0])).toBe(false);
  });
  it("away from every spot, nothing is eligible in a world that has spots; Eternity stays open", () => {
    expect(eligibleHere("great-station", "regard", () => false)).toEqual([]);
    expect(eligibleHere("eternity", "regard", () => false).length).toBeGreaterThan(0);
  });
  it("a stillness picks only among what the viewer is at", () => {
    const here = (t: { entryId: string }) => t.entryId === "obj.faded-ticket";
    expect(pickNoticed("great-station", "regard", "hearths", new Set(), here)).toBe("obj.faded-ticket");
    expect(pickNoticed("great-station", "regard", "hearths", new Set(), () => false)).toBeNull();
  });
});
