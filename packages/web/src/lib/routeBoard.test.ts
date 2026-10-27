import { describe, it, expect } from "vitest";
import { buildRouteBoard } from "./routeBoard.js";
import type { TravelState } from "../api/travel.js";

const state = (currentWorld: string, fuel: number): TravelState => ({
  currentWorld,
  activeJourney: null,
  fuel: { fuel, capacity: 200, jobCost: 2, warpCost: 10 },
});

describe("buildRouteBoard", () => {
  it("charts both worlds and marks the current one (no options to stay put)", () => {
    const board = buildRouteBoard(state("home", 25));
    expect(board.map((e) => e.world)).toEqual(["home", "great-station", "growing-place", "deep-past"]);
    expect(board[0]!.isCurrent).toBe(true);
    expect(board[0]!.options).toEqual([]);
  });

  it("charts the Growing Place (P3-1) with the same warp/drift options", () => {
    const board = buildRouteBoard(state("home", 25));
    const garden = board[2]!;
    expect(garden.name).toBe("The Growing Place");
    expect(garden.options).toEqual([
      { kind: "warp", label: "Warp", cost: 10, affordable: true },
      { kind: "drift", label: "Drift", cost: 0, affordable: true },
    ]);
  });

  it("charts the Deep Past (P3-2) with the same warp/drift options", () => {
    const board = buildRouteBoard(state("home", 25));
    const past = board[3]!;
    expect(past.name).toBe("The Deep Past");
    expect(past.options).toEqual([
      { kind: "warp", label: "Warp", cost: 10, affordable: true },
      { kind: "drift", label: "Drift", cost: 0, affordable: true },
    ]);
  });

  it("prices warp at the shared cost and drift free, by the server's rules", () => {
    const board = buildRouteBoard(state("home", 25));
    const station = board[1]!;
    expect(station.options).toEqual([
      { kind: "warp", label: "Warp", cost: 10, affordable: true },
      { kind: "drift", label: "Drift", cost: 0, affordable: true },
    ]);
  });

  it("marks warp unaffordable on a low balance — drift stays offered (fuel buys speed, never access)", () => {
    const board = buildRouteBoard(state("home", 5));
    const [warp, drift] = board[1]!.options;
    expect(warp!.affordable).toBe(false);
    expect(drift!.affordable).toBe(true);
  });

  it("travel home is always free, both kinds", () => {
    const board = buildRouteBoard(state("great-station", 0));
    const home = board[0]!;
    expect(home.options.map((o) => o.cost)).toEqual([0, 0]);
    expect(home.options.every((o) => o.affordable)).toBe(true);
  });

  it("Eternity's world is not offered while the gate stands closed", () => {
    const board = buildRouteBoard(state("home", 25));
    expect(board.map((e) => e.world)).toEqual(["home", "great-station", "growing-place", "deep-past"]);
    expect(board.find((e) => e.world === "eternity")).toBeUndefined();
  });

  it("Eternity's world is offered — same warp/drift options — once the gate stands open", () => {
    const board = buildRouteBoard({ ...state("home", 25), eternityReachable: true });
    const eternity = board.find((e) => e.world === "eternity")!;
    expect(eternity.name).toBe("Eternity's World");
    expect(eternity.options).toEqual([
      { kind: "warp", label: "Warp", cost: 10, affordable: true },
      { kind: "drift", label: "Drift", cost: 0, affordable: true },
    ]);
  });
});
