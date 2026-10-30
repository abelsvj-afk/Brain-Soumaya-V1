import { describe, expect, it } from "vitest";
import { CURRENT_KEYS, NEUTRAL_CURRENTS, type CurrentKey, type Currents } from "./society.js";
import { STORY, STORY_TRIGGERS, STORY_VARIANT_TOKENS } from "./index.js";
import {
  COMPANION_FORM,
  FIRST_DOOR,
  LEANS,
  NEUTRAL_COUNTS,
  dominantCurrents,
  flavorKey,
  neutralFlavor,
  pickText,
  registerFor,
  scoreLeanings,
  surfaceOrder,
  topLeanings,
  type FlavorKey,
  type Lean,
} from "./storyFlavor.js";

const only = (k: CurrentKey): Currents => ({ ...NEUTRAL_CURRENTS, [k]: 1 });
const DOORS = STORY.entries.filter((e) => e.door).map((e) => e.id);
const HOURS = ["first-light", "measure", "threshold", "growing", "hearths", "rest", "standing"] as const;
const allKeys = (): FlavorKey[] => {
  const out: FlavorKey[] = [];
  for (const a of CURRENT_KEYS) for (const b of CURRENT_KEYS) for (const l1 of LEANS) for (const l2 of LEANS) for (const hour of HOURS) for (const register of ["plain", "warm", "grave"] as const) out.push({ tide: { first: a, second: b }, lean: [l1, l2], hour, register });
  return out;
};

describe("the firewall — flavour colours, it never changes what is there", () => {
  it("surfaceOrder returns exactly the same doors, whatever the flavour (availability invariance)", () => {
    for (const key of allKeys().filter((_, i) => i % 7 === 0)) {
      const out = surfaceOrder(DOORS, key);
      expect([...out].sort()).toEqual([...DOORS].sort());
      expect(new Set(out).size).toBe(DOORS.length);
    }
  });
  it("every door a tide surfaces first is a real door", () => {
    for (const k of CURRENT_KEYS) expect(DOORS).toContain(FIRST_DOOR[k]);
  });
  it("pickText always has something to say, and 'plain' is the whole canon", () => {
    const v = { plain: "p", warm: "w" };
    expect(pickText(v, "plain")).toBe("p");
    expect(pickText(v, "warm")).toBe("w");
    expect(pickText(v, "grave")).toBe("p"); // a missing register falls back, never blanks
    for (const e of STORY.entries) if (e.text) expect(pickText(e.text, "grave").length).toBeGreaterThan(0);
  });
  it("every register of an entry carries the same claim: each must hold the entry's key tokens, and add no number", () => {
    const byId = new Map(STORY.entries.map((e) => [e.id, e]));
    for (const [id, tokens] of Object.entries(STORY_VARIANT_TOKENS)) {
      const v = byId.get(id)!.text!;
      expect(v.warm && v.grave, `${id} should have all three registers`).toBeTruthy();
      for (const reg of ["plain", "warm", "grave"] as const) {
        const text = v[reg]!.toLowerCase();
        for (const tok of tokens) expect(text, `${id}/${reg} must contain "${tok}"`).toContain(tok);
        expect(text).not.toMatch(/\d/);
      }
    }
  });
  it("the neutral key voices plain everywhere", () => {
    expect(neutralFlavor().register).toBe("plain");
  });
  it("the triggers table does not depend on flavour at all (what can be found is fixed)", () => {
    // pickNoticed/npcGifts take no flavour argument: assert by construction that the table is the same object for every key.
    const before = JSON.stringify(STORY_TRIGGERS);
    for (const key of allKeys().filter((_, i) => i % 97 === 0)) surfaceOrder(DOORS, key);
    expect(JSON.stringify(STORY_TRIGGERS)).toBe(before);
  });
});

describe("the tide", () => {
  it("names the strongest current first", () => {
    for (const k of CURRENT_KEYS) expect(dominantCurrents(only(k), 1).first).toBe(k);
  });
  it("thin evidence falls toward the neutral society's own ordering", () => {
    const thin = dominantCurrents(only("friction"), 0);
    const neutral = dominantCurrents(NEUTRAL_CURRENTS, 1);
    expect(thin).toEqual(neutral);
  });
  it("voices reverence and weight gravely, giving/peace/appetite warmly, ambition/friction plainly — with about one day in six stepping back to plain", () => {
    expect(registerFor({ first: "ambition", second: "giving" }, "b", "d")).toBe("plain");
    expect(registerFor({ first: "friction", second: "giving" }, "b", "d")).toBe("plain");
    const days = Array.from({ length: 600 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}-${i}`);
    const grave = days.map((d) => registerFor({ first: "weight", second: "peace" }, "brain", d));
    const warm = days.map((d) => registerFor({ first: "giving", second: "weight" }, "brain", d));
    expect(new Set(grave)).toEqual(new Set(["grave", "plain"]));
    expect(new Set(warm)).toEqual(new Set(["warm", "plain"]));
    const plainShare = grave.filter((r) => r === "plain").length / grave.length;
    expect(plainShare).toBeGreaterThan(0.08);
    expect(plainShare).toBeLessThan(0.28);
  });
  it("is stable: the same brain on the same day always gets the same register", () => {
    for (let i = 0; i < 50; i++) expect(registerFor({ first: "weight", second: "peace" }, "brain-1", "2026-10-30")).toBe(registerFor({ first: "weight", second: "peace" }, "brain-1", "2026-10-30"));
  });
  it("every tide has a companion form and a first door", () => {
    for (const k of CURRENT_KEYS) {
      expect(COMPANION_FORM[k].length).toBeGreaterThan(5);
      expect(FIRST_DOOR[k]).toBeTruthy();
    }
  });
});

describe("how you play (counts only)", () => {
  it("reads nothing into thin evidence: the neutral pair", () => {
    expect(topLeanings(scoreLeanings(NEUTRAL_COUNTS))).toEqual(["keeper", "wanderer"]);
  });
  it("a world-hopper leans wanderer; a recaller leans keeper; a finisher leans builder", () => {
    expect(topLeanings(scoreLeanings({ ...NEUTRAL_COUNTS, distinctWorlds: 6, worldVisits: 20 }))[0]).toBe("wanderer");
    expect(topLeanings(scoreLeanings({ ...NEUTRAL_COUNTS, recalls: 30 }))[0]).toBe("keeper");
    expect(topLeanings(scoreLeanings({ ...NEUTRAL_COUNTS, closures: 12, captures: 20 }))[0]).toBe("builder");
    expect(topLeanings(scoreLeanings({ ...NEUTRAL_COUNTS, chatTurns: 30, noticings: 12 }))[0]).toBe("questioner");
    expect(topLeanings(scoreLeanings({ ...NEUTRAL_COUNTS, sameHourReturns: 14 }))[0]).toBe("ritualist");
  });
  it("hysteresis: a held leaning is not displaced by a near tie, but is by a clear lead (flavour drifts like weather)", () => {
    const scores = { wanderer: 0.5, keeper: 0.52, builder: 0.2, questioner: 0.1, ritualist: 0.05 } as Record<Lean, number>;
    expect(topLeanings(scores, ["wanderer", "builder"])[0]).toBe("wanderer"); // keeper is only a hair ahead
    const clear = { ...scores, keeper: 0.8 };
    expect(topLeanings(clear, ["wanderer", "builder"])).toContain("keeper");
  });
  it("flavorKey assembles a full key, deterministically", () => {
    const input = { currents: only("weight"), confidence: 1, counts: { ...NEUTRAL_COUNTS, recalls: 20 }, brainId: "b", dayKey: "2026-10-30", now: new Date(2026, 9, 30, 23) };
    const a = flavorKey(input);
    expect(a).toEqual(flavorKey(input));
    expect(a.tide.first).toBe("weight");
    expect(a.lean[0]).toBe("keeper");
    expect(a.hour).toBe("rest");
  });
});
