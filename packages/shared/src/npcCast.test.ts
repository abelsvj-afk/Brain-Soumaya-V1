import { describe, expect, it } from "vitest";
import { NPC_CAST, NPC_NEVER_WORLDS, NPC_SLOT_MS, castIn, castMember, npcLocation, scriptSpecsFor } from "./npcs.js";
import { NPC_VOICE_ROLE, canTalkTo } from "./npcDialogue.js";
import { societyDay } from "./society.js";
import { worldLife } from "./societyLife.js";

const HUB_BACKGROUND_IDS = ["dockhand", "stallkeeper", "crate-counter", "net-mender", "lamp-trimmer", "berth-clerk"] as const;

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
  it("has unique ids, canon people with lore layers (the harbor controller and Eternity keep none), and offline greetings for everyone who speaks", () => {
    expect(new Set(NPC_CAST.map((c) => c.id)).size).toBe(NPC_CAST.length);
    for (const c of NPC_CAST) {
      if (c.id === "harbor-controller" || c.id === "eternity") {
        expect(c.canon).toBe("provisional");
        expect(c.lore.layers).toEqual([]);
      } else if (!c.speaks) {
        // Harbor Ring background (Item 4, Stage 1): provisional placeholders
        // with no lore layers, like the controller and Eternity — they are
        // working people, not canon people, until the lore session names them.
        expect(c.canon).toBe("provisional");
        expect(c.lore.layers).toEqual([]);
      } else {
        expect(c.canon).toBe("canon");
        expect(c.lore.layers.length).toBeGreaterThan(0);
      }
      if (c.speaks) expect(c.greetings.length).toBeGreaterThan(0);
      for (const w of c.roams) expect(NPC_NEVER_WORLDS).not.toContain(w);
      expect(c.homeShare).toBeGreaterThan(0);
      expect(c.homeShare).toBeLessThanOrEqual(1);
    }
  });
  it("every speaking member has script situations, so a bigger cast is still one call's worth of rows — and silent background members have none", () => {
    for (const c of NPC_CAST) {
      if (c.speaks) expect(scriptSpecsFor(c).length).toBeGreaterThan(0);
      else expect(scriptSpecsFor(c)).toEqual([]);
    }
    expect(scriptSpecsFor(castMember("keeper")!).map((s) => s.situation)).toEqual(["encounter_near", "encounter_visiting", "encounter_first", "chatter"]);
  });
});

describe("the Harbor Ring background (Item 4, Stage 1)", () => {
  it("is six Station people who are always there, never leave, and are silent by construction", () => {
    expect(HUB_BACKGROUND_IDS).toHaveLength(6);
    for (const id of HUB_BACKGROUND_IDS) {
      const c = castMember(id)!;
      expect(c.home).toBe("great-station");
      expect(c.roams).toEqual([]);
      expect(c.homeShare).toBe(1);
      expect(c.speaks).toBe(false);
      expect(c.greetings).toEqual([]);
      expect(c.canon).toBe("provisional");
      expect(canTalkTo(id)).toBe(false); // no Talk button: no NPC_TALK entry
      expect(NPC_VOICE_ROLE[id]).toBeUndefined(); // no voice role
      expect(scriptSpecsFor(c)).toEqual([]); // no daily-script situations
      // Always at the Station, in every slot.
      for (let i = 0; i < 50; i++) expect(npcLocation(c, T0 + i * NPC_SLOT_MS)).toBe("great-station");
      expect(castIn("great-station", T0).map((x) => x.id)).toContain(id);
    }
    // Factions spread across Ledger / Wardens / Open Hand, so the hub's
    // captions trade, inspect and give — not six identical lines.
    const factions = new Set(HUB_BACKGROUND_IDS.map((id) => castMember(id)!.faction));
    expect(factions.has("ledger")).toBe(true);
    expect(factions.has("wardens")).toBe(true);
    expect(factions.has("open-hand")).toBe(true);
  });
  it("still gets a working life: worldLife gives each one a caption to do", () => {
    const society = societyDay(null, "2026-10-30");
    const T = Date.parse("2026-10-30T09:00:00.000Z");
    const life = worldLife("great-station", T, society);
    for (const id of HUB_BACKGROUND_IDS) {
      const row = life.find((l) => l.member.id === id);
      expect(row, id).toBeTruthy();
      expect(row!.doing.caption.length).toBeGreaterThan(3);
    }
  });
});

describe("Pell is always one day behind", () => {
  it("is where the world put her yesterday, by the same clock as everyone else", () => {
    const pell = castMember("pell")!;
    const unlagged = { ...pell, lagMs: 0 };
    for (let k = 0; k < 40; k++) {
      const t = T0 + k * NPC_SLOT_MS + 123_456;
      expect(npcLocation(pell, t)).toBe(npcLocation(unlagged, t - 24 * 3_600_000));
    }
  });
  it("is the only one who lags, and the six new canon people are all in the cast", () => {
    expect(NPC_CAST.filter((c) => c.lagMs).map((c) => c.id)).toEqual(["pell"]);
    for (const id of ["hesk", "tamsin", "ossian", "ilsabet", "pell", "wim"]) expect(castMember(id)?.canon).toBe("canon");
  });
});
