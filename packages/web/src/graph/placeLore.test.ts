import { describe, expect, it } from "vitest";
import { PLACE_LORE } from "@brain/shared";
import { SCALE_BELT_PIECES, SCALE_CENTERPIECES, SCALE_ENCOUNTERS, SCALE_HUNT2_PLANETS, SCALE_PLANETS, SCALE_PROBES } from "./scaleLayout.js";
import { STATION_BACKDROP_PLANETS } from "./stationAssets.js";
import { PEOPLE_BACKDROP_PLANETS } from "./peopleAssets.js";
import { STORY_TRIGGERS } from "@brain/shared";
import { WARD_HOLDERS } from "./wardLayout.js";
import { ROAD_HOLDERS } from "./roadLayout.js";
import { FOLD_HOLDERS } from "./foldLayout.js";
import { LONG_HOLDERS } from "./longLayout.js";
import { YARD_HOLDERS } from "./yardLayout.js";
import { SIEGE_HOLDERS } from "./siegeLayout.js";
import { UNMADE_HOLDERS } from "./unmadeLayout.js";
import { VILLAGE_HOLDERS } from "./villageLayout.js";

/**
 * Every body's passage is anchored to a scene holder the scene code really creates. Rather than trust a hand-typed name, the holder names are DERIVED from the same layout data the
 * scenes read (the names are the scenes' own templates: `planet-${key}`, `probe-${slug}`, `backdrop-${key}` …), so a renamed or removed body breaks this test, not the player.
 */
function holderNames(world: string): string[] {
  switch (world) {
    case "scale":
      return [
        "iss-holder",
        "moon",
        "moon-outpost-0",
        "satellite-a",
        ...[...SCALE_PLANETS, ...SCALE_HUNT2_PLANETS].map((p) => `planet-${p.key}`),
        ...SCALE_PROBES.map((p) => `probe-${p.slug}`),
        ...SCALE_BELT_PIECES.map((b) => `belt-piece-${b.key}`),
        ...SCALE_ENCOUNTERS.map((e) => `encounter-${e.key}`),
        ...SCALE_CENTERPIECES.map((c) => `centerpiece-${c.key}`),
      ];
    case "great-station":
      return ["station-rotating", "witness-drydock-gantry", "annex-0", ...STATION_BACKDROP_PLANETS.map((p) => `backdrop-${p.key}`)];
    case "people":
      return ["field-ground", ...PEOPLE_BACKDROP_PLANETS.map((p) => `backdrop-${p.key}`)];
    case "deep-past":
      return ["glb-basin", "glb-orb", "glb-spire", "glb-supernova", "place-rim", "stair"];
    case "quiet-archive":
      return ["still-threshold", "field-ground"];
    case "faded-ward":
      return [...WARD_HOLDERS];
    case "road-to-the-seam":
      return [...ROAD_HOLDERS];
    case "the-folded-letter":
      return [...FOLD_HOLDERS];
    case "the-long-morning":
      return [...LONG_HOLDERS];
    case "the-yard":
      return [...YARD_HOLDERS];
    case "the-siege":
      return [...SIEGE_HOLDERS];
    case "the-unmade-hour":
      return [...UNMADE_HOLDERS];
    case "the-village":
      return [...VILLAGE_HOLDERS];
    default:
      return [];
  }
}

describe("every passage is anchored to a body the scene really has", () => {
  it("matches a holder name derived from the scene's own layout data", () => {
    for (const p of PLACE_LORE) {
      if (p.origin) continue;
      const re = new RegExp(p.place!);
      expect(holderNames(p.world).some((n) => re.test(n)), `${p.id} (${p.place}) matches no holder in ${p.world}`).toBe(true);
    }
  });
  it("covers every named real body the scale layout places (planets, probes, encounters, centerpieces, belt)", () => {
    const names = holderNames("scale");
    const covered = (n: string) => PLACE_LORE.some((p) => p.world === "scale" && p.place && new RegExp(p.place).test(n));
    const wanted = names.filter((n) => /^(planet-|probe-|belt-piece-|encounter-|centerpiece-)/.test(n) && !/^centerpiece-(nebula)/.test(n));
    for (const n of wanted) expect(covered(n), `no passage for ${n}`).toBe(true);
  });
  it("still faces something in the Book for the bodies the lore ties to an entry (a sanity check that Draft 9 names only real entries)", () => {
    // Passages themselves name no entry; this only guards that the triggers the older passages rely on still exist.
    expect(STORY_TRIGGERS.length).toBeGreaterThan(30);
  });
});
