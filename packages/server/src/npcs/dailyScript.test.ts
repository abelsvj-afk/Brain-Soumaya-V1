import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NPC_DEFINITIONS, NPC_SCRIPT_SPECS } from "@brain/shared";
import { createDb, type DbHandle } from "../db/client.js";
import {
  SCRIPT_RETRY_DELAYS_MS,
  assembleScript,
  buildScriptPrompt,
  getDayScript,
  publicScript,
  resetDayScriptInflight,
  scriptedLine,
} from "./dailyScript.js";

const T0 = Date.parse("2026-10-30T12:00:00.000Z");
let h: DbHandle;
beforeEach(() => {
  h = createDb(":memory:");
  resetDayScriptInflight();
});
afterEach(() => h.sqlite.close());

const goodEntries = () =>
  NPC_DEFINITIONS.flatMap((d) =>
    (NPC_SCRIPT_SPECS[d.id] ?? []).map((s) => ({
      npc: d.id,
      situation: s.situation,
      lines: Array.from({ length: s.count }, (_, i) => `${d.name} ${s.situation} variant ${i + 1}.`),
    })),
  );

describe("one batched call per brain per day", () => {
  it("makes exactly one model call however many times lines are read, then serves the cache", async () => {
    const call = vi.fn(async () => goodEntries());
    const voice = { npcDayScript: call };
    const a = await getDayScript(h, "s1", voice, T0);
    const b = await getDayScript(h, "s1", voice, T0 + 3_600_000);
    const c = await getDayScript(h, "s1", voice, T0 + 7_200_000);
    expect(call).toHaveBeenCalledTimes(1);
    expect(a.source).toBe("model");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
  it("shares one in-flight call between concurrent readers", async () => {
    let release!: (v: ReturnType<typeof goodEntries>) => void;
    const call = vi.fn(() => new Promise<ReturnType<typeof goodEntries>>((r) => (release = r)));
    const p1 = getDayScript(h, "s1", { npcDayScript: call }, T0);
    const p2 = getDayScript(h, "s1", { npcDayScript: call }, T0);
    release(goodEntries());
    await Promise.all([p1, p2]);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("a new local day makes a new call; another brain is separate", async () => {
    const call = vi.fn(async () => goodEntries());
    await getDayScript(h, "s1", { npcDayScript: call }, T0);
    await getDayScript(h, "s1", { npcDayScript: call }, T0 + 86_400_000);
    await getDayScript(h, "s2", { npcDayScript: call }, T0);
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("one prompt carries every NPC (roster size does not change the call count)", () => {
    const prompt = buildScriptPrompt(h, "s1", "2026-10-30", T0);
    for (const d of NPC_DEFINITIONS) expect(prompt).toContain(`"${d.id}"`);
    // The controller's brief is travel facts only — no memory text goes to the model for her.
    expect(prompt).toMatch(/currently at home/);
  });
});

describe("failure → retry schedule → offline lines", () => {
  it("returns offline lines at once, waits out +3/+6/+12 min, then settles for the day", async () => {
    const call = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const voice = { npcDayScript: call };
    expect((await getDayScript(h, "s1", voice, T0)).source).toBe("fallback");
    expect(call).toHaveBeenCalledTimes(1);
    await getDayScript(h, "s1", voice, T0 + 60_000); // inside the 3-minute wait
    expect(call).toHaveBeenCalledTimes(1);
    await getDayScript(h, "s1", voice, T0 + SCRIPT_RETRY_DELAYS_MS[0]! + 1);
    expect(call).toHaveBeenCalledTimes(2);
    await getDayScript(h, "s1", voice, T0 + 3 * 60_000 + 6 * 60_000 + 2);
    expect(call).toHaveBeenCalledTimes(3);
    await getDayScript(h, "s1", voice, T0 + 21 * 60_000 + 3);
    expect(call).toHaveBeenCalledTimes(4);
    await getDayScript(h, "s1", voice, T0 + 5 * 3_600_000); // exhausted: no more calls today
    expect(call).toHaveBeenCalledTimes(4);
  });
  it("recovers: a later success is cached", async () => {
    let fail = true;
    const call = vi.fn(async () => {
      if (fail) throw new Error("x");
      return goodEntries();
    });
    await getDayScript(h, "s1", { npcDayScript: call }, T0);
    fail = false;
    const s = await getDayScript(h, "s1", { npcDayScript: call }, T0 + 4 * 60_000);
    expect(s.source).toBe("model");
    await getDayScript(h, "s1", { npcDayScript: call }, T0 + 9 * 60_000);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("no voice → offline lines, nothing stored, never throws", async () => {
    const s = await getDayScript(h, "s1", null, T0);
    expect(s.source).toBe("fallback");
    expect(s.lines["harbor-controller"]?.encounter_patrolling?.length).toBeGreaterThan(0);
    expect(h.sqlite.prepare("SELECT COUNT(*) n FROM npc_day_script").get()).toEqual({ n: 0 });
  });
});

describe("assembling the script", () => {
  it("cleans, dedupes, caps, and tops up a situation the model under-delivered", () => {
    const long = "x".repeat(400);
    const s = assembleScript("d", T0, [
      { npc: "harbor-controller", situation: "encounter_patrolling", lines: ["  A. ", "A.", long, "B."] },
      { npc: "eternity", situation: "wake", lines: ["Rise."] },
    ]);
    const pat = s.lines["harbor-controller"]!.encounter_patrolling!;
    expect(new Set(pat).size).toBe(pat.length);
    expect(pat.every((l) => l.length <= 240)).toBe(true);
    // encounter_docked was missing entirely → offline top-up, so a situation is never empty.
    expect(s.lines["harbor-controller"]!.encounter_docked!.length).toBeGreaterThan(0);
    expect(s.source).toBe("model");
  });
  it("never lets a character who only answers be quoted", () => {
    const s = assembleScript("d", T0, [
      { npc: "harbor-controller", situation: "encounter_patrolling", lines: ['She says "welcome aboard".', "She sweeps past."] },
    ]);
    expect(s.lines["harbor-controller"]!.encounter_patrolling).toEqual(["She sweeps past."]);
  });
  it("a model that returns nothing usable is a fallback, not a cached success", () => {
    expect(assembleScript("d", T0, []).source).toBe("fallback");
  });
});

describe("reading lines", () => {
  it("scriptedLine is deterministic for a seed and null without a model script", async () => {
    const s = await getDayScript(h, "s1", { npcDayScript: async () => goodEntries() }, T0);
    const a = scriptedLine(s, "eternity", "wake", "seed-1");
    expect(a).toBe(scriptedLine(s, "eternity", "wake", "seed-1"));
    expect(a).toMatch(/Eternity wake variant/);
    expect(scriptedLine(null, "eternity", "wake", "x")).toBeNull();
    expect(scriptedLine({ ...s, source: "fallback" }, "eternity", "wake", "x")).toBeNull();
  });
  it("publicScript exposes encounter lines only (wake/visitation stay his to deliver)", async () => {
    const s = await getDayScript(h, "s1", { npcDayScript: async () => goodEntries() }, T0);
    const pub = publicScript(s);
    expect(pub.lines.eternity?.wake).toBeUndefined();
    expect(pub.lines.eternity?.visitation).toBeUndefined();
    expect(pub.lines.eternity?.encounter_arrival?.length).toBeGreaterThan(0);
  });
});
