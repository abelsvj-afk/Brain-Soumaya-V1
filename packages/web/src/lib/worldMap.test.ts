import { describe, it, expect } from "vitest";
import {
  chainTo,
  deriveMapData,
  WORLD_MAP_SHIMMER,
  WORLD_MAP_STAR_COUNT,
  type MapData,
} from "./worldMap.js";

function atHome(traversed: { origin: string; destination: string }[] = []): MapData {
  return deriveMapData({ currentWorld: "home", activeJourney: null, traversed });
}

describe("worldMap — discovery (Q2/Q3)", () => {
  it("a fresh traveller sees only Home — nothing undiscovered, no 'unknown' markers", () => {
    const data = atHome();
    expect(data.nodes.map((n) => n.key)).toEqual(["home"]);
    expect(data.edges).toEqual([]);
  });

  it("a travelled world appears once its route is in the record; untravelled worlds stay hidden", () => {
    const data = atHome([{ origin: "home", destination: "great-station" }]);
    expect(data.nodes.map((n) => n.key)).toEqual(["home", "great-station"]);
    expect(data.nodes.find((n) => n.key === "growing-place")).toBeUndefined();
    expect(data.nodes.find((n) => n.key === "deep-past")).toBeUndefined();
    expect(data.nodes.find((n) => n.key === "people")).toBeUndefined();
  });

  it("People (P3-3, Q2) appears once travelled — a close moon of the Station, warm amber", () => {
    const data = atHome([{ origin: "great-station", destination: "people" }]);
    const people = data.nodes.find((n) => n.key === "people");
    expect(people).toBeTruthy();
    expect(people!.name).toBe("The People");
    expect(people!.color).toBe("#ffb070");
    const station = data.nodes.find((n) => n.key === "great-station")!;
    expect(Math.hypot(people!.x - station.x, people!.y - station.y)).toBeLessThan(200);
  });

  it("a journey in progress counts as discovery in motion — the map shows where you are going", () => {
    const data = deriveMapData({
      currentWorld: "home",
      activeJourney: {
        id: "j-1",
        kind: "warp",
        origin: "home",
        destination: "growing-place",
        state: "in_transit",
        fuelCharged: 10,
        cancellable: false,
        createdAt: "2026-10-25T12:00:00.000Z",
        cancelDeadline: "2026-10-25T12:00:10.000Z",
      },
      traversed: [],
    });
    expect(data.nodes.map((n) => n.key)).toEqual(["home", "growing-place"]);
  });

  it("off-chart keys never appear, even when the record names them", () => {
    const data = atHome([{ origin: "home", destination: "quiet-archive" }]);
    expect(data.nodes.map((n) => n.key)).toEqual(["home"]);
  });

  it("the current world is marked in the data (words, not colour alone)", () => {
    const data = deriveMapData({
      currentWorld: "great-station",
      activeJourney: null,
      traversed: [{ origin: "home", destination: "great-station" }],
    });
    expect(data.nodes.find((n) => n.key === "great-station")?.isCurrent).toBe(true);
    expect(data.nodes.find((n) => n.key === "home")?.isCurrent).toBe(false);
  });
});

describe("worldMap — routes (Q4/Q5)", () => {
  it("edges run between every pair of discovered worlds: travelled bright, the rest faint", () => {
    const data = deriveMapData({
      currentWorld: "great-station",
      activeJourney: null,
      traversed: [
        { origin: "home", destination: "great-station" },
        { origin: "great-station", destination: "growing-place" },
      ],
    });
    // Discovered: home, station, garden → 3 pairs.
    expect(data.edges).toHaveLength(3);
    const byPair = new Map(data.edges.map((e) => [`${e.from}>${e.to}`, e]));
    expect(byPair.get("home>great-station")?.traveled).toBe(true);
    expect(byPair.get("great-station>growing-place")?.traveled).toBe(true);
    expect(byPair.get("home>growing-place")?.traveled).toBe(false);
    // Every edge carries its fuel cost, always — from the current world
    // when the edge touches it ("free" homebound), both prices when the
    // edge touches home but not the current world.
    expect(byPair.get("home>great-station")?.costLabel).toBe("free");
    expect(byPair.get("great-station>growing-place")?.costLabel).toBe("10 fuel");
    expect(byPair.get("home>growing-place")?.costLabel).toBe("10 fuel · free home");
  });

  it("from home the station edge reads 10 fuel — the price of leaving, not returning", () => {
    const data = atHome([{ origin: "home", destination: "great-station" }]);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]?.costLabel).toBe("10 fuel");
  });

  it("the bright leg is the most recent travelled leg when no journey is active", () => {
    const data = deriveMapData({
      currentWorld: "growing-place",
      activeJourney: null,
      traversed: [
        { origin: "home", destination: "great-station" },
        { origin: "great-station", destination: "growing-place" },
      ],
    });
    const bright = data.edges.filter((e) => e.bright);
    expect(bright).toHaveLength(1);
    expect(bright[0]?.from).toBe("great-station");
    expect(bright[0]?.to).toBe("growing-place");
  });

  it("an active journey's leg is the bright leg, even over an older route", () => {
    const data = deriveMapData({
      currentWorld: "home",
      activeJourney: {
        id: "j-2",
        kind: "drift",
        origin: "home",
        destination: "great-station",
        state: "in_transit",
        fuelCharged: 0,
        cancellable: false,
        createdAt: "2026-10-25T12:00:00.000Z",
        cancelDeadline: "2026-10-25T12:00:10.000Z",
      },
      traversed: [{ origin: "home", destination: "growing-place" }],
    });
    const bright = data.edges.filter((e) => e.bright);
    expect(bright).toHaveLength(1);
    expect(bright[0]?.from).toBe("home");
    expect(bright[0]?.to).toBe("great-station");
  });

  it("the chain to a discovered world is one direct leg: warp 10, drift free", () => {
    const data = atHome([{ origin: "home", destination: "great-station" }]);
    const chain = chainTo("great-station", data);
    expect(chain).toEqual({
      legs: [{ from: "home", to: "great-station", costWarp: 10, costDrift: 0 }],
      totalWarp: 10,
      totalDrift: 0,
    });
  });

  it("the chain home is free — returning home never costs fuel", () => {
    const data = deriveMapData({
      currentWorld: "great-station",
      activeJourney: null,
      traversed: [{ origin: "home", destination: "great-station" }],
    });
    expect(chainTo("home", data)).toEqual({
      legs: [{ from: "great-station", to: "home", costWarp: 0, costDrift: 0 }],
      totalWarp: 0,
      totalDrift: 0,
    });
  });

  it("an undiscovered destination has no chain — the map invents no route", () => {
    const data = atHome();
    expect(chainTo("growing-place", data)).toBeNull();
  });

  it("the chain to the world you are already in is empty, not an error", () => {
    const data = atHome();
    expect(chainTo("home", data)).toEqual({ legs: [], totalWarp: 0, totalDrift: 0 });
  });
});

describe("worldMap — the shimmer (Q6) and the stars", () => {
  it("the shimmer sits in a far region, away from every node", () => {
    const data = atHome([{ origin: "home", destination: "great-station" }]);
    expect(data.shimmer).toEqual(WORLD_MAP_SHIMMER);
    const shimmer = data.shimmer!;
    for (const n of data.nodes) {
      const d = Math.hypot(n.x - shimmer.x, n.y - shimmer.y);
      expect(d).toBeGreaterThan(150);
    }
  });

  it("Eternity's world appears only once discovered — and then the shimmer retires", () => {
    const before = atHome([{ origin: "home", destination: "great-station" }]);
    expect(before.nodes.find((n) => n.key === "eternity")).toBeUndefined();
    expect(before.shimmer).toEqual(WORLD_MAP_SHIMMER);
    const after = deriveMapData({
      currentWorld: "eternity",
      activeJourney: null,
      traversed: [
        { origin: "home", destination: "great-station" },
        { origin: "great-station", destination: "growing-place" },
        { origin: "growing-place", destination: "eternity" },
      ],
    });
    const node = after.nodes.find((n) => n.key === "eternity");
    expect(node).toBeDefined();
    expect(node?.name).toBe("Eternity's World");
    expect(node?.isCurrent).toBe(true);
    expect(after.shimmer).toBeNull();
  });

  it("the starfield is deterministic — the same seed draws the same sky", () => {
    const a = atHome();
    const b = atHome();
    expect(a.stars).toEqual(b.stars);
    expect(a.stars).toHaveLength(WORLD_MAP_STAR_COUNT);
  });

  it("node positions are deterministic for known worlds and stable for unknown ones", () => {
    const a = atHome([{ origin: "home", destination: "great-station" }]);
    const b = atHome([{ origin: "home", destination: "great-station" }]);
    expect(a.nodes).toEqual(b.nodes);
  });
});
