// ============================================================================
// DRAFT — P1 TEST SCAFFOLDING. Staged in ~/workspace/gate-run/civ-p1-prep/.
// NOT in a repo, NOT runnable against the L1 tree. Lands at P1-B1 task T3
// (anchor assertions at T5) as packages/server/src/captains/captainsRegistry.test.ts
// after the RA-2/RA-3 re-anchor checks in ../../p1-branch-plan.md.
// Source of the EXPECTED table: ../../captains-data-staged.md (L1 captains.ts
// verbatim for Dain/Veyra/Bex; the APPROVED Five Captains Proposal for the five).
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  CAPTAIN_DEFINITIONS,
  captainDefinition,
  type CaptainId,
} from "@brain/shared";
// RE-ANCHOR: the fleet key list lives web-side in L1
// (packages/web/src/graph/stationAssets.ts TRAFFIC_MODELS). If the merged tree
// exposes no shared fleet list, this import is replaced by a server-side read
// of that module's keys — the assertion (membership + uniqueness) must not change.

/**
 * P1 registry (spec §8 T3 done-test, features F01–F03):
 *  - all 8 definitions match the approved sources field-by-field;
 *  - Sorrel is they/them in BOTH pronoun fields (spec C4 done-test);
 *  - active flags were EXACTLY { bex: true, junia: true } in P1 (spec
 *    §7); P2 activates Veyra by the P2 spec's own ruling, so the set
 *    is now { bex, junia, veyra } — a FOURTH active captain fails here;
 *  - every captain holds a real fleet ship key, unique across the cohort (F03);
 *  - Dain/Veyra/Bex are byte-unchanged from L1 except the anchor field (T5).
 */

interface ExpectedDef {
  id: CaptainId;
  name: string;
  role: string;
  pronouns: "he" | "she" | "they";
  ageBand: string;
  traits: readonly [string, string, string];
  homeWorld: string;
  anchor: { kind: string; world: string; label: string };
  active: boolean;
  sampleLine: string;
}

const EXPECTED: readonly ExpectedDef[] = [
  {
    id: "dain", name: "Dain", role: "Hauler", pronouns: "he", ageBand: "late 40s",
    traits: ["Methodical", "Generous", "Stubborn"],
    homeWorld: "great-station",
    anchor: { kind: "berth", world: "great-station", label: "his Station berth" },
    active: false, sampleLine: "Ore's ore. It sells, I haul it.",
  },
  {
    id: "veyra", name: "Veyra", role: "Seeker", pronouns: "she", ageBand: "early 30s",
    traits: ["Restless", "Private", "Bold"],
    homeWorld: "scale", // berthing world — her anchor is the ship (spec C3)
    anchor: { kind: "ship", world: "scale", label: "her ship" },
    active: true, sampleLine: "Nothing at Scale. The stirring was wrong, or I was.",
  },
  {
    id: "bex", name: "Bex", role: "Regular", pronouns: "she", ageBand: "late 20s",
    traits: ["Sociable", "Generous", "Cautious"],
    homeWorld: "great-station",
    anchor: { kind: "quarter", world: "great-station", label: "her Station quarter" },
    active: true, sampleLine: "You missed Dain sulking at the Foundry. He'll live.",
  },
  {
    id: "junia", name: "Junia", role: "Tender", pronouns: "she", ageBand: "late 50s",
    traits: ["Methodical", "Generous", "Cautious"],
    homeWorld: "growing-place",
    anchor: { kind: "terrace", world: "growing-place", label: "a tender's cottage-terrace at the Growing Place" },
    active: true,
    sampleLine: "The lower beds came up early this year. They do that when they're ready, not when I'm ready.",
  },
  {
    id: "hollis", name: "Hollis", role: "Delver", pronouns: "he", ageBand: "mid-40s",
    traits: ["Private", "Stubborn", "Bold"],
    homeWorld: "great-station", // berthing world; Deep Past is visited, never home
    anchor: { kind: "ship", world: "great-station", label: "his ship, berthed at the Great Station" },
    active: false,
    sampleLine: "Eight strata down, the light changes. I go slow there. It deserves slow.",
  },
  {
    id: "sorrel", name: "Sorrel", role: "Keeper", pronouns: "they", ageBand: "early 40s",
    traits: ["Private", "Methodical", "Cautious"],
    homeWorld: "quiet-archive",
    anchor: { kind: "cell", world: "quiet-archive", label: "a keeper's cell at the Archive" },
    active: false,
    sampleLine: "It isn't lost. It's resting. There's a difference, and the difference is the whole job.",
  },
  {
    id: "yara", name: "Yara", role: "Long-Hauler", pronouns: "she", ageBand: "late 30s",
    traits: ["Bold", "Sociable", "Restless"],
    homeWorld: "scale",
    // RE-ANCHOR (RA-3d): exact printed label is a ruled item — spec §6.2's label
    // column staged verbatim here; see branch-plan flag F-3.
    anchor: { kind: "ship", world: "scale", label: "her ship — an at-large ship home on the Scale road, berthed at the Great Station between runs" },
    active: false,
    sampleLine: "A convoy's only as fast as its slowest hull, and I love my slowest hull. Mostly.",
  },
  {
    id: "felix", name: "Felix", role: "Engineer", pronouns: "he", ageBand: "early 30s",
    traits: ["Sociable", "Greedy", "Methodical"],
    homeWorld: "great-station",
    anchor: { kind: "workshop-berth", world: "great-station", label: "a workshop-adjacent berth at the Great Station" },
    active: false,
    sampleLine: "Bring me a broken thing before you bring me a story about it. Broken things I can fix.",
  },
];

describe("P1 registry — the cohort of eight (F01, spec §8 T3)", () => {
  it("defines exactly the eight captains, in cohort order", () => {
    expect(CAPTAIN_DEFINITIONS.map((d) => d.id)).toEqual(
      ["dain", "veyra", "bex", "junia", "hollis", "sorrel", "yara", "felix"],
    );
    for (const e of EXPECTED) expect(captainDefinition(e.id)?.name).toBe(e.name);
  });

  it("matches the approved sources field-by-field for every captain", () => {
    for (const e of EXPECTED) {
      const def = captainDefinition(e.id);
      if (!def) throw new Error(`${e.id} must be defined`);
      expect(def.role, e.id).toBe(e.role);
      expect(def.pronouns, e.id).toBe(e.pronouns);
      expect(def.voice.pronouns, `${e.id} voice`).toBe(e.pronouns);
      expect(def.ageBand, e.id).toBe(e.ageBand);
      expect([...def.traits], e.id).toEqual([...e.traits]);
      expect(def.homeWorld, e.id).toBe(e.homeWorld);
      expect(def.voice.sampleLine, e.id).toBe(e.sampleLine);
      // Voice can actually speak in P1's two runtime contexts — an active
      // captain with empty line arrays barks "" silently (branch-plan F-2).
      expect(def.voice.greetingLines.length, `${e.id} greetings`).toBeGreaterThanOrEqual(2);
      expect(def.voice.idleLines.length, `${e.id} idles`).toBeGreaterThanOrEqual(2);
      expect(def.voice.greetingLines.every((l) => l.trim().length > 0)).toBe(true);
      expect(def.voice.idleLines.every((l) => l.trim().length > 0)).toBe(true);
    }
  });

  it("Sorrel is they/them — the C4 done-test, named on its own", () => {
    const sorrel = captainDefinition("sorrel");
    expect(sorrel?.pronouns).toBe("they");
    expect(sorrel?.voice.pronouns).toBe("they");
  });

  it("active flags are exactly BEX, JUNIA and VEYRA true, the other five false", () => {
    const active = CAPTAIN_DEFINITIONS.filter((d) => d.active).map((d) => d.id);
    expect(active.sort()).toEqual(["bex", "junia", "veyra"]);
    for (const e of EXPECTED) expect(captainDefinition(e.id)?.active, e.id).toBe(e.active);
  });

  it("every captain flies a real fleet hull, and no two share one (F03)", () => {
    // RE-ANCHOR: replace with the merged tree's fleet key source.
    const FLEET_KEYS: readonly string[] = [
      "bob", "challenger", "dispatcher", "executioner", "imperial", "insurgent",
      "omen", "pancake", "spitfire", "striker", "zenith", "wato",
    ];
    const keys = CAPTAIN_DEFINITIONS.map((d) => d.shipModelKey);
    for (const k of keys) expect(FLEET_KEYS, k).toContain(k);
    expect(new Set(keys).size).toBe(8);
    // The L1 three keep their L1 hulls — byte-unchanged rule (T3).
    expect(captainDefinition("dain")?.shipModelKey).toBe("challenger");
    expect(captainDefinition("veyra")?.shipModelKey).toBe("omen");
    expect(captainDefinition("bex")?.shipModelKey).toBe("bob");
  });

  it("allow-lists: the six L1 kinds for five captains; Bex + Junia add exactly the P3 economy kinds; Veyra adds the P2 kinds plus the P3 kinds (P1 spec §7, widened by the P2 spec, widened by P3 R5)", () => {
    const L1 = ["arrive", "depart", "greet", "speak", "travel", "wait"];
    const ECONOMY = ["gather", "refine", "sell"];
    for (const def of CAPTAIN_DEFINITIONS) {
      if (def.id === "veyra") {
        expect([...def.allowList].sort(), def.id).toEqual(
          [...L1, "commission", "deed", "gate-check", "gate-passage", "plan", "search", ...ECONOMY].sort(),
        );
      } else if (def.id === "bex" || def.id === "junia") {
        expect([...def.allowList].sort(), def.id).toEqual([...L1, ...ECONOMY].sort());
      } else {
        expect([...def.allowList].sort(), def.id).toEqual([...L1].sort());
      }
    }
  });
});

describe("P1 anchors — definition half of A8 (spec §6.3 A8-1, static)", () => {
  it("homeWorld === homeAnchor.world for all eight, with the staged kind + label", () => {
    for (const e of EXPECTED) {
      const def = captainDefinition(e.id);
      if (!def) throw new Error(`${e.id} must be defined`);
      // RE-ANCHOR: `homeAnchor` is the T5 field; absent on the L1 tree.
      expect(def.homeAnchor.world, e.id).toBe(def.homeWorld);
      expect(def.homeAnchor.kind, e.id).toBe(e.anchor.kind);
      expect(def.homeAnchor.label, e.id).toBe(e.anchor.label);
    }
  });

  it("no anchor names a fenced world: people, seam worlds, Eternity (F08/I-5)", () => {
    const fenced = ["people", "home", "eternity", "unmade-hour", "first-light", "unlit-hulls", "long-morning", "folded-letter"];
    for (const def of CAPTAIN_DEFINITIONS) {
      expect(fenced).not.toContain(def.homeAnchor.world);
      expect(fenced).not.toContain(def.homeWorld);
    }
  });
});
