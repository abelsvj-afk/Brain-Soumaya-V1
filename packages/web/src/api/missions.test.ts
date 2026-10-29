import { describe, it, expect, vi, afterEach } from "vitest";
import {
  dispatchMission,
  getMissions,
  MissionClientError,
  recallMission,
  resumeFleet,
  stopFleet,
} from "./missions.js";
import type { Mission, MissionsOverview } from "@brain/shared";

/**
 * Fleet missions client: the binding over the server loop. These tests
 * pin the wire shape (paths, bodies, response unwrapping) and the
 * error grammar (server plain-language message + code preserved; 404
 * mapped to NOT_FOUND). Transport is the global fetch that afetch
 * wraps. Missions are free: there is no 402 path to preserve.
 */

const mission = (over: Partial<Mission> = {}): Mission => ({
  id: "m-1",
  clientKey: "k-1",
  kind: "journey",
  destination: "scale",
  origin: "home",
  fleetSize: 1,
  ships: ["bob"],
  durationMinutes: 30,
  fuelCost: 0,
  state: "outbound",
  createdAt: "2026-10-27T12:00:00.000Z",
  departedAt: "2026-10-27T12:00:00.000Z",
  arriveAt: "2026-10-27T12:10:00.000Z",
  returnAt: "2026-10-27T12:20:00.000Z",
  completedAt: null,
  outcome: null,
  report: null,
  ...over,
});

const overview = (over: Partial<MissionsOverview> = {}): MissionsOverview => ({
  missions: [mission()],
  fleetStopped: false,
  fuel: { fuel: 25, capacity: 200 },
  log: [],
  ...over,
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}
const jsonRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMissions", () => {
  it("returns the overview", async () => {
    stubFetch(async () => jsonRes(200, overview()));
    const result = await getMissions();
    expect(result?.missions.map((m) => m.id)).toEqual(["m-1"]);
  });

  it("returns null when the brain is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await getMissions()).toBeNull();
  });
});

describe("dispatchMission", () => {
  it("posts the dispatch and returns the mission + overview", async () => {
    const fetch = stubFetch(async () => jsonRes(200, { mission: mission(), overview: overview() }));
    const result = await dispatchMission({
      clientKey: "k-1",
      kind: "journey",
      destination: "scale",
      durationMinutes: 30,
      fleetSize: 1,
    });
    expect(result.mission.id).toBe("m-1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/missions/dispatch"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves the server's plain error and code", async () => {
    stubFetch(async () => jsonRes(400, { error: "A mission flies 1 to 3 ships.", code: "INVALID_FLEET_SIZE" }));
    await expect(
      dispatchMission({ clientKey: "k-2", kind: "scouting", destination: "scale", durationMinutes: 30, fleetSize: 9 }),
    ).rejects.toMatchObject({ code: "INVALID_FLEET_SIZE", message: "A mission flies 1 to 3 ships." });
  });
});

describe("recallMission", () => {
  it("recalls and returns the mission + overview; 404 maps to NOT_FOUND", async () => {
    stubFetch(async () => jsonRes(200, { mission: mission({ state: "recalled" }), overview: overview() }));
    const result = await recallMission("m-1");
    expect(result.mission.state).toBe("recalled");
    stubFetch(async () => jsonRes(404, { error: "No mission.", code: "UNKNOWN_MISSION" }));
    await expect(recallMission("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the stop switch", () => {
  it("stop and resume hit their paths and return the overview", async () => {
    const fetch = stubFetch(async () => jsonRes(200, { overview: overview() }));
    const stopped = await stopFleet();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/missions/stop"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(stopped?.fleetStopped).toBe(false);
    const resumed = await resumeFleet();
    expect(resumed?.fuel.capacity).toBe(200);
  });

  it("a failed stop surfaces the server's error", async () => {
    stubFetch(async () => jsonRes(500, { error: "That didn't go through.", code: "MISSION_REQUEST_FAILED" }));
    await expect(stopFleet()).rejects.toBeInstanceOf(MissionClientError);
  });
});
