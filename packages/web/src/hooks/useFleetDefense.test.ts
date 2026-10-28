import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FleetDefenseOverview } from "@brain/shared";
import { useFleetDefense } from "./useFleetDefense.js";
import {
  getFleetDefenseOverview,
  offerFleetDefenseRelease,
  startFleetDefense,
  tickFleetDefense,
} from "../api/fleetDefense.js";

vi.mock("../api/fleetDefense.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/fleetDefense.js")>();
  return {
    ...orig,
    getFleetDefenseOverview: vi.fn(),
    offerFleetDefenseRelease: vi.fn(),
    startFleetDefense: vi.fn(),
    tickFleetDefense: vi.fn(),
  };
});

const mockGet = vi.mocked(getFleetDefenseOverview);
const mockOffer = vi.mocked(offerFleetDefenseRelease);
const mockStart = vi.mocked(startFleetDefense);
const mockTick = vi.mocked(tickFleetDefense);

const emptyOverview = (): FleetDefenseOverview => ({
  releases: [],
  activeDefense: null,
  activeRelease: null,
  history: [],
  recentLog: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(emptyOverview());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFleetDefense", () => {
  it("does not fetch while disabled", () => {
    renderHook(() => useFleetDefense(false));
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("loads the overview on mount", async () => {
    const { result } = renderHook(() => useFleetDefense(true));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("a failed load is an offline state with a retry", async () => {
    mockGet.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useFleetDefense(true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.overview).toBeNull();
    mockGet.mockResolvedValueOnce(emptyOverview());
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(result.current.overview).not.toBeNull();
  });

  it("offering refreshes the overview", async () => {
    mockOffer.mockResolvedValue({
      id: 1,
      kind: "emotion",
      size: "small",
      label: "the old argument",
      nodeId: null,
      status: "offered",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const { result } = renderHook(() => useFleetDefense(true));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    const callsBefore = mockGet.mock.calls.length;
    await act(async () => {
      await result.current.offer({ kind: "emotion", size: "small", label: "the old argument" });
    });
    expect(mockOffer).toHaveBeenCalledWith({ kind: "emotion", size: "small", label: "the old argument" });
    expect(mockGet.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("starting refreshes the overview", async () => {
    const { result } = renderHook(() => useFleetDefense(true));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    await act(async () => {
      await result.current.start(1);
    });
    expect(mockStart).toHaveBeenCalledWith(1);
  });

  it("a tick adopts the server's board", async () => {
    const active = {
      id: 7,
      releaseId: 1,
      status: "active" as const,
      invaders: [],
      tickCount: 1,
      lastMode: "autonomous" as const,
      lastLine: "Soumaya fired down lane 2 and dispersed the Quaternius challenger.",
      outcomeLine: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockGet.mockResolvedValueOnce({
      ...emptyOverview(),
      activeDefense: active,
      activeRelease: {
        id: 1,
        kind: "emotion",
        size: "small",
        label: "the old argument",
        nodeId: null,
        status: "defending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    mockTick.mockResolvedValue(active);
    const { result } = renderHook(() => useFleetDefense(true));
    await waitFor(() => expect(result.current.overview?.activeDefense?.id).toBe(7));
    // The post-tick refresh re-reads the board — point the mock at
    // the ticked board so the refresh lands on it, not the empty one.
    mockGet.mockResolvedValue({
      ...emptyOverview(),
      activeDefense: active,
      activeRelease: {
        id: 1,
        kind: "emotion",
        size: "small",
        label: "the old argument",
        nodeId: null,
        status: "defending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    await act(async () => {
      await result.current.tick("autonomous");
    });
    expect(mockTick).toHaveBeenCalledWith(7, "autonomous", undefined);
    await waitFor(() => expect(result.current.overview?.activeDefense?.tickCount).toBe(1));
  });

  it("auto-play ticks on her own while it is on and a defense is active", async () => {
    // Real timers: the auto-play interval is 2.5 s, and waitFor's
    // polling needs the real clock (fake timers stall it).
    const active = {
      id: 7,
      releaseId: 1,
      status: "active" as const,
      invaders: [],
      tickCount: 1,
      lastMode: "autonomous" as const,
      lastLine: "Soumaya fired down lane 2.",
      outcomeLine: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockGet.mockResolvedValue({
      ...emptyOverview(),
      activeDefense: active,
    });
    mockTick.mockResolvedValue(active);
    const { result } = renderHook(() => useFleetDefense(true));
    await waitFor(() => expect(result.current.overview?.activeDefense?.id).toBe(7));
    act(() => {
      result.current.setAutoPlay(true);
    });
    await waitFor(() => expect(mockTick.mock.calls.length).toBeGreaterThanOrEqual(1), {
      timeout: 6000,
    });
  });
});
