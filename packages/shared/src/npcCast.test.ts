import { describe, expect, it } from "vitest";
import { NPC_CAST, NPC_NEVER_WORLDS, NPC_SLOT_MS, castIn, castMember, npcLocation, scriptSpecsFor } from "./npcs.js";

const T0 = Date.parse("2026-10-30T00:00:00.000Z");

describe("the cast's lives", () => {
  it("is deterministic: the same clock gives the same place (server and web agree)", () => {
    for (const c of NPC_CAST) expect(npcLocation(c, T0 + 12345)).toBe(npcLocation(c, T0 + 12345));
  });
  it("never puts anyone in a personal brain, over a long stretch of time", () => {
    for (const c of NPC_CAST) {
      for (let i = 0; i < 2000; i++) expect(NPC_NEVER_WORLDS).not.toContain(npcLocation(c, T0 + i * NPC_SLOT_MS));
    }
    for (let i = 0; i < 50; i++) expect(castIn("home", T0 + i * NPC_SLOT_MS)).toEqual([]);
  });
  it("only ever places someone in their home world or a world they roam", () => {
    for (const c of NPC_CAST) {
      for (let i = 0; i < 500; i++) {
        const w = npcLocation(c, T0 + i * NPC_SLOT_MS);
        expect([c.home, ...c.roams]).toContain(w);
      }
    }
  });
  it("a non-roamer stays put; roamers spend about their own share at home", () => {
    const eternity = castMember("eternity")!;
    for (let i = 0; i < 300; i++) expect(npcLocation(eternity, T0 + i * NPC_SLOT_MS)).toBe("eternity");
    const wayfarer = castMember("wayfarer")!;
    let home = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (npcLocation(wayfarer, T0 + i * NPC_SLOT_MS) === wayfarer.home) home++;
    expect(home / N).toBeGreaterThan(wayfarer.homeShare - 0.06);
    expect(home / N).toBeLessThan(wayfarer.homeShare + 0.06);
    // and it actually travels: over a week it visits several different worlds
    const seen = new Set<string>();
    for (let i = 0; i < 84; i++) seen.add(npcLocation(wayfarer, T0 + i * NPC_SLOT_MS));
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
  it("holds a slot steady (no flicker within two hours) and castIn agrees with npcLocation", () => {
    for (const c of NPC_CAST) expect(npcLocation(c, T0 + 1000)).toBe(npcLocation(c, T0 + NPC_SLOT_MS - 1000));
    const t = T0 + 5 * NPC_SLOT_MS;
    for (const c of NPC_CAST) expect(castIn(npcLocation(c, t), t).map((x) => x.id)).toContain(c.id);
  });
});

describe("the cast's data", () => {
  it("has unique ids, only provisional canon (no lore is invented), and offline greetings for everyone who speaks", () => {
    expect(new Set(NPC_CAST.map((c) => c.id)).size).toBe(NPC_CAST.length);
    for (const c of NPC_CAST) {
      expect(c.canon).toBe("provisional");
      expect(c.lore.layers).toEqual([]);
      if (c.speaks) expect(c.greetings.length).toBeGreaterThan(0);
      for (const w of c.roams) expect(NPC_NEVER_WORLDS).not.toContain(w);
      expect(c.homeShare).toBeGreaterThan(0);
      expect(c.homeShare).toBeLessThanOrEqual(1);
    }
  });
  it("every member has script situations, so a bigger cast is still one call's worth of rows", () => {
    for (const c of NPC_CAST) expect(scriptSpecsFor(c).length).toBeGreaterThan(0);
    expect(scriptSpecsFor(castMember("keeper")!).map((s) => s.situation)).toEqual(["encounter_near", "encounter_visiting", "encounter_first", "chatter"]);
  });
});
