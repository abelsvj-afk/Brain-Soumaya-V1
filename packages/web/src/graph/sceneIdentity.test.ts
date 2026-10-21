import { describe, it, expect } from "vitest";
import {
  visitorCard,
  fleetCard,
  beaconReadout,
  audioSummary,
  thoughtSourceLabel,
  modelFallbackLine,
  STATION_NAME,
} from "./sceneIdentity.js";

/** CL-1b — pure shaping for the galaxy shell's identity/ambience surfaces. */

describe("IM-19 visitor identity", () => {
  it("names the variant and the memory it is visiting", () => {
    const c = visitorCard("Luminous Traveler", "Lisbon trip");
    expect(c.title).toBe("Luminous Traveler");
    expect(c.line).toContain("Lisbon trip");
    expect(c.lore).toContain("warm");
  });
  it("void wanderer lore carries the beacon warning from satellites lore", () => {
    expect(visitorCard("Void Wanderer", null).lore).toContain("beacon");
    expect(visitorCard("Void Wanderer", null).line).toBe("Drifting through your galaxy");
  });
  it("unknown variants still get an honest generic card", () => {
    const c = visitorCard("Something New", null);
    expect(c.title).toBe("Something New");
    expect(c.lore.length).toBeGreaterThan(0);
  });
});

describe("IM-19 fleet identity", () => {
  it("uses the FLEET roster name/role/lore for roster units", () => {
    const c = fleetCard("scout", "Surveying “Lisbon trip”", "Lisbon trip");
    expect(c.title).toContain("Scout");
    expect(c.title).toContain("Frontier survey");
    expect(c.line).toBe("Surveying “Lisbon trip”");
    expect(c.lore).toContain("frontier");
  });
  it("the escort (no roster row) is identified from its subAgents description", () => {
    const c = fleetCard("escort", "Flying escort on Soumaya", null);
    expect(c.title).toContain("Escort");
    expect(c.lore).toContain("formation");
  });
});

describe("IM-22 station name", () => {
  it("comes from the fleet roster", () => {
    expect(STATION_NAME).toBe("Waystation Soumaya-Prime");
  });
});

describe("IM-20 beacon readout", () => {
  it("returns targets + pending when beacons are deployed", () => {
    const r = beaconReadout({
      beacon: { active: true, detail: "2 warming memories", targets: [{ id: 5, label: "Old house" }], pending: 1 },
    });
    expect(r?.targets).toEqual([{ id: 5, label: "Old house" }]);
    expect(r?.pending).toBe(1);
  });
  it("is null when nothing is deployed (no empty chrome)", () => {
    expect(beaconReadout({ beacon: { active: false, detail: "None deployed", targets: [], pending: 0 } })).toBeNull();
    expect(beaconReadout(null)).toBeNull();
    expect(beaconReadout({})).toBeNull();
  });
  it("dispatching alone (no active target yet) still reads out", () => {
    const r = beaconReadout({ beacon: { active: false, detail: "Dispatching 1…", targets: [], pending: 1 } });
    expect(r?.pending).toBe(1);
  });
});

describe("IM-21 audio summary", () => {
  it("names all three channels and flags the fully-silent state", () => {
    expect(audioSummary({ sfx: false, voice: false, music: false })).toEqual({
      text: "Sounds off · Voice off · Music off",
      allOff: true,
    });
    expect(audioSummary({ sfx: true, voice: false, music: true }).allOff).toBe(false);
    expect(audioSummary({ sfx: true, voice: false, music: true }).text).toBe("Sounds on · Voice off · Music on");
  });
});

describe("IM-25 thought source labels + IM-24 fallback line", () => {
  it("labels agree with the Legend's wording", () => {
    expect(thoughtSourceLabel("manual")).toBe("Spontaneous");
    expect(thoughtSourceLabel("goal")).toBe("Goal pull");
    expect(thoughtSourceLabel("something-new")).toBe("something-new");
  });
  it("fallback line names the asset and the stand-in honestly", () => {
    expect(modelFallbackLine("The Waystation model")).toContain("stand-in");
    expect(modelFallbackLine("The Waystation model")).toContain("Waystation");
  });
});
