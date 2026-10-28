import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { MissionsOverview } from "@brain/shared";
import { useFleetMissions } from "./useFleetMissions.js";
import { dispatchMission, getMissions, MissionClientError, recallMission, stopFleet } from "../api/missions.js";

vi.mock("../api/missions.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/missions.js")>();
  return {
    ...orig,
    getMissions: vi.fn(),
    dispatchMission: vi.fn(),
    recallMission: vi.fn(),
    stopFleet: vi.fn(),
    resumeFleet: vi.fn(),
  };
});

const mockGet = vi.mocked(getMissions);
const mockDispatch = vi.mocked(dispatchMission);
const mockRecall = vi.mocked(recallMission);
const mockStop = vi.mocked(stopFleet);

const state = (over: Partial<MissionsOverview> = {}): MissionsOverview => ({
  missions: [],
  fleetStopped: false,
  fuel: { fuel: 25, capacity: 200 },
  log: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(state());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFleetMissions", () => {
  it("does not fetch while disabled", () => {
    renderHook(() => useFleetMissions(false));
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("loads the overview on mount", async () => {
    const { result } = renderHook(() => useFleetMissions(true));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    expect(result.current.overview?.fleetStopped).toBe(false);
    expect(result.current.failed).toBe(false);
  });

  it("a failed load is an offline state with a retry", async () => {
    mockGet.mockResolvedValue(null);
    const { result } = renderHook(() => useFleetMissions(true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    mockGet.mockResolvedValue(state());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.failed).toBe(false);
    expect(result.current.overview).not.toBeNull();
  });

  it("dispatch adopts the returned overview; a failed dispatch surfaces the plain error", async () => {
    mockDispatch.mockResolvedValue({
      mission: {
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
        createdAt: new Date().toISOString(),
        departedAt: new Date().toISOString(),
        arriveAt: null,
        returnAt: null,
        completedAt: null,
        outcome: null,
        report: null,
      },
      overview: state({ missions: [], fleetStopped: true }),
    });
    const { result } = renderHook(() => useFleetMissions(true));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    await act(async () => {
      await result.current.dispatch({
        kind: "journey",
        destination: "scale",
        durationMinutes: 30,
        fleetSize: 1,
      });
    });
    expect(result.current.overview?.fleetStopped).toBe(true);
    expect(result.current.error).toBeNull();

    mockDispatch.mockRejectedValue(new MissionClientError("INVALID_FLEET_SIZE", "A mission flies 1 to 3 ships."));
    await act(async () => {
      await result.current.dispatch({ kind: "scouting", destination: "scale", durationMinutes: 30, fleetSize: 9 });
    });
    expect(result.current.error).toContain("1 to 3 ships");
  });

  it("recall and stop adopt the returned overview", async () => {
    const recalled = {
      id: "m-1",
      clientKey: "k-1",
      kind: "scouting" as const,
      destination: "scale",
      origin: "home",
      fleetSize: 1,
      ships: ["bob"],
      durationMinutes: 30,
      fuelCost: 0,
      state: "recalled" as const,
      createdAt: new Date().toISOString(),
      departedAt: new Date().toISOString(),
      arriveAt: null,
      returnAt: null,
      completedAt: new Date().toISOString(),
      outcome: "Recalled — the fleet turned back early and returned without its outcome.",
      report: null,
    };
    mockRecall.mockResolvedValue({ mission: recalled, overview: state({ fleetStopped: false }) });
    mockStop.mockResolvedValue(state({ fleetStopped: true }));
    const { result } = renderHook(() => useFleetMissions(true));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.overview?.fleetStopped).toBe(true);
  });
});
