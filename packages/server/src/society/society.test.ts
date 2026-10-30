import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { NEUTRAL_CURRENTS } from "@brain/shared";
import { buildScriptPrompt } from "../npcs/dailyScript.js";
import { computeSociety, getReflect, recentMemories, resetSocietyCache, setReflect, societyBrief } from "./society.js";

const NOW = Date.parse("2026-10-30T15:00:00.000Z");
let h: DbHandle;
beforeEach(() => {
  h = createDb(":memory:");
  resetSocietyCache();
});
afterEach(() => h.sqlite.close());

function seed(space: string, label: string, content: string, extra: Record<string, unknown> = {}): void {
  const cols = ["space_id", "label", "type", "content", "emotional_weight", "created_at", ...Object.keys(extra)];
  const vals = [space, label, "memory", content, 0.6, new Date(NOW - 86_400_000).toISOString(), ...Object.values(extra)];
  h.sqlite.prepare(`INSERT INTO nodes (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
}

describe("reading a brain", () => {
  it("a brain with no memories shows the neutral world honestly (reflects=false)", () => {
    const r = computeSociety(h, "s1", NOW);
    expect(r.society.reflects).toBe(false);
    expect(r.society.currents).toEqual(NEUTRAL_CURRENTS);
  });
  it("reflects what runs through the galaxy, in named currents", () => {
    for (let i = 0; i < 8; i++) seed("s1", `Prayer ${i}`, "Prayed and thanked God; went to church; felt His grace");
    for (let i = 0; i < 3; i++) seed("s1", `Gave ${i}`, "Donated and helped a neighbour, forgave an old debt");
    const { society } = computeSociety(h, "s1", NOW);
    expect(society.reflects).toBe(true);
    expect(society.currents.reverence).toBeGreaterThan(0.4);
    expect(society.currents.reverence).toBeGreaterThan(society.currents.friction);
    expect(society.belief).toBeGreaterThan(0.6);
  });
  it("is per brain: another brain's memories never colour this one", () => {
    for (let i = 0; i < 10; i++) seed("other", `x${i}`, "angry furious fight resentment control");
    const mine = computeSociety(h, "s1", NOW).society;
    expect(mine.reflects).toBe(false);
    expect(recentMemories(h, "s1", NOW)).toEqual([]);
  });
  it("ignores the agent's own hubs, action items, deleted and archived memories", () => {
    seed("s1", "hub", "god god god", { origin: "agent" });
    seed("s1", "todo", "pray pray", { kind: "action" });
    seed("s1", "gone", "pray pray", { deleted_at: new Date(NOW).toISOString() });
    seed("s1", "old", "pray pray", { status: "archived" });
    seed("s1", "real", "a quiet walk");
    expect(recentMemories(h, "s1", NOW).map((m) => m.text.split(" ")[0])).toEqual(["real"]);
  });
});

describe("opt-out", () => {
  it("defaults on; off yields the neutral society and reads nothing; on again restores it", () => {
    for (let i = 0; i < 8; i++) seed("s1", `p${i}`, "Prayed and thanked God, church, grace");
    expect(getReflect(h, "s1")).toBe(true);
    const on = computeSociety(h, "s1", NOW);
    expect(on.society.currents.reverence).toBeGreaterThan(0.4);
    setReflect(h, "s1", false);
    const off = computeSociety(h, "s1", NOW);
    expect(off.reflect).toBe(false);
    expect(off.society.reflects).toBe(false);
    expect(off.society.currents).toEqual(NEUTRAL_CURRENTS);
    setReflect(h, "s1", true);
    expect(computeSociety(h, "s1", NOW).society.currents.reverence).toBeGreaterThan(0.4);
  });
  it("the preference is per brain", () => {
    setReflect(h, "s1", false);
    expect(getReflect(h, "s2")).toBe(true);
  });
});

describe("what leaves the server", () => {
  it("the society brief is numbers-as-words only — no memory text", () => {
    seed("s1", "My private secret title", "I secretly prayed about a terrible thing I did to my sister Marianne");
    const s = computeSociety(h, "s1", NOW).society;
    const brief = societyBrief(s);
    expect(brief).not.toMatch(/secret|sister|Marianne|terrible/i);
    expect(JSON.stringify(s)).not.toMatch(/secret|Marianne/i);
  });
  it("the daily-script prompt carries the brief and each NPC's faction/faith/wants, but no memory text for anyone but Eternity", () => {
    seed("s1", "Zebra-plan-9141", "Pray for the unspeakable-quartz-7733 situation");
    const prompt = buildScriptPrompt(h, "s1", "2026-10-30", NOW);
    expect(prompt).toContain("The society today");
    expect(prompt).toContain("Faction: The Choir");
    // Eternity's own brief may carry memories (owner-allowed); nobody else's does — so the text appears at most inside his block.
    const harbor = prompt.slice(prompt.indexOf('## NPC "harbor-controller"'), prompt.indexOf('## NPC "eternity"'));
    expect(harbor).not.toMatch(/Zebra-plan|unspeakable-quartz/);
    const keeper = prompt.slice(prompt.indexOf('## NPC "keeper"'), prompt.indexOf('## NPC "archivist"'));
    expect(keeper).not.toMatch(/Zebra-plan|unspeakable-quartz/);
  });
});
