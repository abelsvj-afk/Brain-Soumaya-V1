import { describe, it, expect } from "vitest";
import { buildRouteBoard } from "./routeBoard.js";
import type { TravelState } from "../api/travel.js";

const state = (currentWorld: string, fuel: number, peopleGateOpen?: boolean): TravelState => ({
  currentWorld,
  activeJourney: null,
  fuel: { fuel, capacity: 200, jobCost: 2, warpCost: 10 },
  ...(peopleGateOpen === undefined ? {} : { peopleGateOpen }),
});

describe("buildRouteBoard", () => {
  it("charts both worlds and marks the current one (no options to stay put)", () => {
    const board = buildRouteBoard(state("home", 25));
    expect(board.map((e) => e.world)).toEqual(["home", "great-station", "growing-place", "deep-past", "quiet-archive"]);
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

  it("hides People while the server says the gate is closed (P3-3, Q1)", () => {
    const board = buildRouteBoard(state("home", 25));
    expect(board.map((e) => e.world)).not.toContain("people");
    const closedFlag = buildRouteBoard(state("home", 25, false));
    expect(closedFlag.map((e) => e.world)).not.toContain("people");
  });

  it("charts People once the server says the gate is open, same warp/drift options", () => {
    const board = buildRouteBoard(state("home", 25, true));
    expect(board.map((e) => e.world)).toEqual(["home", "great-station", "growing-place", "deep-past", "people", "quiet-archive"]);
    const people = board[4]!;
    expect(people.name).toBe("The People");
    expect(people.options).toEqual([
      { kind: "warp", label: "Warp", cost: 10, affordable: true },
      { kind: "drift", label: "Drift", cost: 0, affordable: true },
    ]);
  });

  it("charts Quiet/Archive always — no gate, a deliberate visit, same warp/drift options", () => {
    const board = buildRouteBoard(state("home", 25));
    expect(board.map((e) => e.world)).toContain("quiet-archive");
    const archive = board.find((e) => e.world === "quiet-archive")!;
    expect(archive.name).toBe("Quiet/Archive");
    expect(archive.options).toEqual([
      { kind: "warp", label: "Warp", cost: 10, affordable: true },
      { kind: "drift", label: "Drift", cost: 0, affordable: true },
    ]);
  });

  it("keeps the People entry when the traveller is already there, even if the gate reads closed", () => {
    const board = buildRouteBoard(state("people", 25, false));
    const people = board.find((e) => e.world === "people")!;
    expect(people).toBeTruthy();
    expect(people.isCurrent).toBe(true);
    expect(people.options).toEqual([]);
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
    expect(board.map((e) => e.world)).toEqual(["home", "great-station", "growing-place", "deep-past", "quiet-archive"]);
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
