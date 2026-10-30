import { describe, expect, it } from "vitest";
import {
  CURRENT_KEYS,
  FACTIONS,
  NEUTRAL_CURRENTS,
  ORDINANCES,
  WORLD_GOVERNORS,
  beliefTide,
  brainColor,
  currentsInWords,
  dailyCalling,
  factionStanding,
  faithLabel,
  npcFaith,
  ordinanceFor,
  scoreCurrents,
  scoreCurrentsDetailed,
  societyDay,
} from "./society.js";
import { ACTIVITY_SLOT_MS, npcDoing, worldLife } from "./societyLife.js";
import { NPC_CAST, NPC_SLOT_MS, castIn, castMember } from "./npcs.js";

const mem = (text: string, weight = 0.5) => ({ text, weight });

describe("currents", () => {
  it("is neutral with no memories, and always bounded 0..1", () => {
    expect(scoreCurrents([])).toEqual(NEUTRAL_CURRENTS);
    const c = scoreCurrents([mem("god god god pray pray bless grace grace faith faith", 1), mem("angry angry angry furious resent fight", 1)]);
    for (const k of CURRENT_KEYS) {
      expect(c[k]).toBeGreaterThanOrEqual(0);
      expect(c[k]).toBeLessThanOrEqual(1);
    }
  });
  it("responds to the right words, and only those", () => {
    const faith = scoreCurrents(Array.from({ length: 10 }, () => mem("Prayed and thanked God for His grace at church")));
    expect(faith.reverence).toBeGreaterThan(0.5);
    expect(faith.reverence).toBeGreaterThan(faith.friction);
    const rage = scoreCurrents(Array.from({ length: 10 }, () => mem("So angry, resentful, another fight about control")));
    expect(rage.friction).toBeGreaterThan(0.5);
    expect(rage.reverence).toBeLessThan(0.1);
    const giving = scoreCurrents(Array.from({ length: 10 }, () => mem("Volunteered and donated; helped a friend, forgave a debt")));
    expect(giving.giving).toBeGreaterThan(0.5);
  });
  it("one raging note cannot own a brain of otherwise calm ones", () => {
    const c = scoreCurrents([mem("furious furious furious furious furious angry angry", 1), ...Array.from({ length: 20 }, () => mem("a quiet walk, calm and grateful"))]);
    expect(c.friction).toBeLessThan(0.25);
    expect(c.peace).toBeGreaterThan(c.friction);
  });
  it("is deterministic", () => {
    const m = [mem("pray and give and build"), mem("tired and alone")];
    expect(scoreCurrents(m)).toEqual(scoreCurrents(m));
  });
  it("says it in words (the only form that ever goes toward a model) with no memory text", () => {
    const w = currentsInWords({ ...NEUTRAL_CURRENTS, reverence: 0.9 });
    expect(w.startsWith("reverence: strong")).toBe(true);
    expect(w).not.toMatch(/pray|church/);
  });
});

describe("belief and colour", () => {
  it("belief rises with reverence and peace, sags with weight and friction", () => {
    const base = beliefTide(NEUTRAL_CURRENTS);
    expect(beliefTide({ ...NEUTRAL_CURRENTS, reverence: 0.9 })).toBeGreaterThan(base);
    expect(beliefTide({ ...NEUTRAL_CURRENTS, weight: 0.9 })).toBeLessThan(base);
    expect(beliefTide({ ...NEUTRAL_CURRENTS, friction: 0.9 })).toBeLessThan(base);
    for (const k of CURRENT_KEYS) {
      const b = beliefTide({ ...NEUTRAL_CURRENTS, [k]: 1 });
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
  it("the colour leans toward the strongest current's hue", () => {
    expect(brainColor({ ...NEUTRAL_CURRENTS, giving: 1, reverence: 0, ambition: 0, appetite: 0, friction: 0, weight: 0, peace: 0 }).h).toBe(135);
    expect(brainColor({ ...NEUTRAL_CURRENTS, weight: 1, reverence: 0, giving: 0, ambition: 0, appetite: 0, friction: 0, peace: 0 }).h).toBe(220);
  });
});

describe("factions and governance", () => {
  it("a faction is lifted by the currents it answers to", () => {
    const hi = { ...NEUTRAL_CURRENTS, giving: 0.9 };
    const open = FACTIONS.find((f) => f.id === "open-hand")!;
    expect(factionStanding(open, hi, beliefTide(hi))).toBeGreaterThan(factionStanding(open, NEUTRAL_CURRENTS, beliefTide(NEUTRAL_CURRENTS)));
    const choir = FACTIONS.find((f) => f.id === "choir")!;
    const undertow = FACTIONS.find((f) => f.id === "undertow")!;
    const doubting = { ...NEUTRAL_CURRENTS, reverence: 0.05, friction: 0.7, weight: 0.6 };
    expect(factionStanding(undertow, doubting, beliefTide(doubting))).toBeGreaterThan(factionStanding(choir, doubting, beliefTide(doubting)));
  });
  it("callings are deterministic for a day and vary across days", () => {
    const f = FACTIONS[0]!;
    expect(dailyCalling(f, NEUTRAL_CURRENTS, "2026-10-30")).toEqual(dailyCalling(f, NEUTRAL_CURRENTS, "2026-10-30"));
    const seen = new Set<string>();
    for (let d = 1; d <= 60; d++) seen.add(dailyCalling(f, NEUTRAL_CURRENTS, `2026-11-${String(d).padStart(2, "0")}`).id);
    expect(seen.size).toBeGreaterThan(1);
  });
  it("every world has a governor, and the ordinance follows the currents", () => {
    for (const w of Object.keys(WORLD_GOVERNORS)) expect(ORDINANCES.some((o) => o.id === ordinanceFor(w, NEUTRAL_CURRENTS, "d").id)).toBe(true);
    const festive = { ...NEUTRAL_CURRENTS, reverence: 1, peace: 0.8 };
    const counts = new Map<string, number>();
    for (let d = 0; d < 80; d++) counts.set(ordinanceFor("quiet-archive", festive, `day${d}`).id, (counts.get(ordinanceFor("quiet-archive", festive, `day${d}`).id) ?? 0) + 1);
    expect([...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]).toBe("festival");
    const rough = { ...NEUTRAL_CURRENTS, friction: 1, appetite: 0.7 };
    const c2 = new Map<string, number>();
    for (let d = 0; d < 80; d++) {
      const id = ordinanceFor("great-station", rough, `day${d}`).id;
      c2.set(id, (c2.get(id) ?? 0) + 1);
    }
    expect(["tightened-lanes", "free-berth"]).toContain([...c2.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  });
});

describe("faith", () => {
  it("each NPC keeps their own temper; the tide moves them only a little", () => {
    for (const m of NPC_CAST) {
      const lo = npcFaith(m.faith, m.susceptibility, 0);
      const hi = npcFaith(m.faith, m.susceptibility, 1);
      expect(hi).toBeGreaterThanOrEqual(lo);
      expect(Math.abs(npcFaith(m.faith, m.susceptibility, 0.6) - m.faith)).toBeLessThan(1e-9);
    }
    expect(faithLabel(0.9)).toBe("devout");
    expect(faithLabel(0)).toBe("wavering");
    expect(faithLabel(-0.9)).toBe("a sceptic");
    // The Cantor stays a believer and the Dissenter a doubter even at the extremes of the tide.
    expect(npcFaith(castMember("cantor")!.faith, castMember("cantor")!.susceptibility, 0)).toBeGreaterThan(0.5);
    expect(npcFaith(castMember("dissenter")!.faith, castMember("dissenter")!.susceptibility, 1)).toBeLessThan(0);
  });
  it("most of the cast believe, as the owner described; some do not", () => {
    const believers = NPC_CAST.filter((m) => m.faith > 0.2).length;
    const doubters = NPC_CAST.filter((m) => m.faith < -0.2).length;
    expect(believers).toBeGreaterThan(doubters);
    expect(doubters).toBeGreaterThan(0);
  });
});

describe("what the cast is doing", () => {
  const society = societyDay(null, "2026-10-30");
  const T = Date.parse("2026-10-30T09:00:00.000Z");
  it("is deterministic and always has words", () => {
    for (const m of NPC_CAST) {
      const mates = castIn(m.home, T);
      const a = npcDoing(m, T, { society, world: m.home, mates });
      expect(a).toEqual(npcDoing(m, T, { society, world: m.home, mates }));
      expect(a.caption.length).toBeGreaterThan(3);
    }
  });
  it("never looks the same twice: across a day each NPC does several different things", () => {
    for (const m of NPC_CAST.filter((x) => x.id !== "eternity")) {
      const kinds = new Set<string>();
      const captions = new Set<string>();
      for (let i = 0; i < 48; i++) {
        const t = T + i * ACTIVITY_SLOT_MS;
        const w = m.home;
        const d = npcDoing(m, t, { society, world: w, mates: castIn(w, t) });
        kinds.add(d.kind);
        captions.add(d.caption);
      }
      expect(kinds.size).toBeGreaterThanOrEqual(3);
      expect(captions.size).toBeGreaterThanOrEqual(3);
    }
  });
  it("trades and debates are mutual: both ships show the same pairing", () => {
    let seen = 0;
    for (let i = 0; i < 400 && seen < 5; i++) {
      const t = T + i * ACTIVITY_SLOT_MS;
      for (const w of ["great-station", "growing-place", "scale", "quiet-archive"]) {
        const life = worldLife(w, t, society);
        for (const a of life) {
          if (!a.doing.partnerId) continue;
          const b = life.find((x) => x.member.id === a.doing.partnerId);
          expect(b).toBeTruthy();
          expect(b!.doing.partnerId).toBe(a.member.id);
          expect(b!.doing.kind).toBe(a.doing.kind);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
  it("the calling and the currents change what a faction does", () => {
    const festive = societyDay({ ...NEUTRAL_CURRENTS, reverence: 1, peace: 0.9 }, "d1");
    const market = societyDay({ ...NEUTRAL_CURRENTS, ambition: 1, appetite: 0.6, reverence: 0.1, peace: 0.1 }, "d1");
    const cantor = castMember("cantor")!;
    const count = (soc: typeof festive, kind: string) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const t = T + i * ACTIVITY_SLOT_MS;
        const d = npcDoing(cantor, t, { society: soc, world: "quiet-archive", mates: [cantor] });
        if (d.kind === kind) n++;
      }
      return n;
    };
    expect(count(festive, "worship")).toBeGreaterThan(count(market, "worship"));
  });
  it("reflection off yields a neutral society that still lives", () => {
    const off = societyDay(null, "d");
    expect(off.reflects).toBe(false);
    expect(off.currents).toEqual(NEUTRAL_CURRENTS);
    expect(worldLife("great-station", T, off).length + worldLife("quiet-archive", T, off).length).toBeGreaterThan(0);
  });
  it("a slot is thirty minutes, inside a two-hour location slot", () => {
    expect(NPC_SLOT_MS % ACTIVITY_SLOT_MS).toBe(0);
  });
});

describe("thin evidence", () => {
  it("a brain with no theme words reads as the neutral world, not as 'everything quiet'", () => {
    const quiet = scoreCurrents(Array.from({ length: 12 }, () => mem("Coffee with Maya; watched the game; picked up groceries")));
    for (const k of CURRENT_KEYS) expect(quiet[k]).toBeCloseTo(NEUTRAL_CURRENTS[k], 5);
    expect(societyDay(quiet, "d").factions.every((f) => f.standing > 0.06)).toBe(true);
  });
  it("confidence rises with evidence and pulls the reading off neutral", () => {
    const few = scoreCurrentsDetailed([mem("pray")]);
    const many = scoreCurrentsDetailed(Array.from({ length: 12 }, () => mem("Prayed and thanked God for His grace at church")));
    expect(many.confidence).toBeGreaterThan(few.confidence);
    expect(many.currents.reverence).toBeGreaterThan(few.currents.reverence);
    expect(scoreCurrentsDetailed([]).confidence).toBe(0);
  });
});
