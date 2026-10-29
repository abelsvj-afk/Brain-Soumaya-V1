import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { TravelJourney } from "@brain/shared";
import { useTravel } from "./useTravel.js";
import { prefetchWorld } from "../graph/worldPrefetch.js";
import {
  arriveJourney,
  cancelJourney,
  departJourney,
  getTravelState,
  TravelClientError,
  type TravelState,
} from "../api/travel.js";

vi.mock("../api/travel.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/travel.js")>();
  return {
    ...orig,
    getTravelState: vi.fn(),
    departJourney: vi.fn(),
    cancelJourney: vi.fn(),
    turnBackJourney: vi.fn(),
    arriveJourney: vi.fn(),
  };
});

vi.mock("../graph/worldPrefetch.js", () => ({ prefetchWorld: vi.fn(async () => {}) }));

const mockState = vi.mocked(getTravelState);
const mockDepart = vi.mocked(departJourney);
const mockCancel = vi.mocked(cancelJourney);
const mockArrive = vi.mocked(arriveJourney);

const fuel = { fuel: 25, capacity: 200, jobCost: 2, warpCost: 10 };
const journey = (over: Partial<TravelJourney> = {}): TravelJourney => ({
  id: "j-1",
  kind: "warp",
  origin: "home",
  destination: "great-station",
  state: "arming",
  fuelCharged: 0,
  cancellable: true,
  createdAt: "2026-10-23T12:00:00.000Z",
  cancelDeadline: "2026-10-23T12:00:10.000Z",
  ...over,
});
const state = (activeJourney: TravelJourney | null): TravelState => ({
  currentWorld: "home",
  activeJourney,
  fuel,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockState.mockResolvedValue(state(null));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useTravel", () => {
  it("does not fetch while disabled", () => {
    renderHook(() => useTravel(false));
    expect(mockState).not.toHaveBeenCalled();
  });

  it("loads the server's state on mount", async () => {
    mockState.mockResolvedValue(state(journey()));
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.state?.activeJourney?.id).toBe("j-1"));
    expect(result.current.error).toBeNull();
  });

  it("depart generates one key per intent and reuses it across retries", async () => {
    mockState.mockResolvedValue(state(journey())); // server truthfully shows our journey active
    mockDepart.mockResolvedValue(journey());
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.depart("warp", "great-station");
    });
    await act(async () => {
      await result.current.depart("warp", "great-station"); // a retry / double-tap
    });
    expect(mockDepart).toHaveBeenCalledTimes(2);
    const k1 = mockDepart.mock.calls[0]![0]!.clientKey;
    const k2 = mockDepart.mock.calls[1]![0]!.clientKey;
    expect(k1).toBeTruthy();
    expect(k2).toBe(k1);
    expect(localStorage.getItem("worlds.departureKey")).toBe(k1);
  });

  it("a conflicting departure surfaces the server's message and retires the key", async () => {
    mockDepart.mockRejectedValue(
      new TravelClientError(
        "ACTIVE_JOURNEY_EXISTS",
        "A journey is already in progress — finish or cancel it first.",
      ),
    );
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.depart("drift", "great-station");
    });
    expect(result.current.error).toBe(
      "A journey is already in progress — finish or cancel it first.",
    );
    expect(localStorage.getItem("worlds.departureKey")).toBeNull();
  });

  it("cancel retires the departure key", async () => {
    mockState.mockResolvedValue(state(journey()));
    mockDepart.mockResolvedValue(journey());
    mockCancel.mockResolvedValue(journey({ state: "cancelled", cancellable: false }));
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.state?.activeJourney?.id).toBe("j-1"));
    await act(async () => {
      await result.current.depart("warp", "great-station");
    });
    expect(localStorage.getItem("worlds.departureKey")).not.toBeNull();
    await act(async () => {
      await result.current.cancel();
    });
    expect(localStorage.getItem("worlds.departureKey")).toBeNull();
  });

  it("an observed arrival records the traversed route (presentation memory)", async () => {
    mockState.mockResolvedValue(state(journey({ state: "in_transit", cancellable: false })));
    mockArrive.mockResolvedValue({
      journey: journey({ state: "arrived", fuelCharged: 10, cancellable: false }),
      bonus: { credited: true, amount: 5, balance: 30, reason: null },
    });
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.state?.activeJourney?.state).toBe("in_transit"));
    expect(result.current.hasTraversed("home", "great-station")).toBe(false);
    await act(async () => {
      await result.current.arrive();
    });
    expect(result.current.hasTraversed("home", "great-station")).toBe(true);
  });

  it("polls while a journey is arming so settlement shows up", async () => {
    vi.useFakeTimers();
    mockState.mockResolvedValue(state(journey()));
    renderHook(() => useTravel());
    expect(mockState).toHaveBeenCalledTimes(1);
    // Flush the load + effect install inside act, then run the poll clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mockState.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("useTravel — copies stay in sync", () => {
  // The travel panel, the world scene layer and the world map each run their
  // own copy of this hook. Before the sync event, a departure from the panel
  // was invisible to the scene layer: no transit flight, no arrival scene,
  // until a page reload (measured in a real browser).
  it("a departure in one copy makes the other copy re-read the server", async () => {
    mockState.mockResolvedValue(state(null));
    mockDepart.mockResolvedValue(journey());
    const panel = renderHook(() => useTravel());
    const scene = renderHook(() => useTravel());
    await waitFor(() => expect(panel.result.current.state).not.toBeNull());
    await waitFor(() => expect(scene.result.current.state).not.toBeNull());
    expect(scene.result.current.state?.activeJourney).toBeNull();

    mockState.mockResolvedValue(state(journey({ state: "in_transit" })));
    await act(async () => {
      await panel.result.current.depart("warp", "great-station");
    });
    await waitFor(() => expect(scene.result.current.state?.activeJourney?.state).toBe("in_transit"));
  });

  it("the acting copy does not re-fetch for its own echo", async () => {
    mockState.mockResolvedValue(state(null));
    mockDepart.mockResolvedValue(journey());
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    mockState.mockClear();
    await act(async () => {
      await result.current.depart("warp", "great-station");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(mockState).toHaveBeenCalledTimes(1); // its own refresh — not two
  });

  it("a disabled copy never reacts to another copy's action", async () => {
    mockState.mockResolvedValue(state(null));
    mockDepart.mockResolvedValue(journey());
    const live = renderHook(() => useTravel());
    renderHook(() => useTravel(false));
    await waitFor(() => expect(live.result.current.state).not.toBeNull());
    mockState.mockClear();
    await act(async () => {
      await live.result.current.depart("warp", "great-station");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(mockState).toHaveBeenCalledTimes(1);
  });
});

// Prefetch trigger (see graph/worldPrefetch.ts): the journey's dead time is when the destination's
// models are fetched, so the world isn't bare when you arrive.
describe("useTravel — warms the destination while travelling", () => {
  it("starts warming the destination as soon as the server reports a journey arming", async () => {
    mockState.mockResolvedValue(state(journey({ state: "arming", destination: "deep-past" })));
    renderHook(() => useTravel());
    await waitFor(() => expect(prefetchWorld).toHaveBeenCalledWith("deep-past"));
  });
  it("…and while in transit (covers a reload mid-flight)", async () => {
    mockState.mockResolvedValue(state(journey({ state: "in_transit", destination: "scale" })));
    renderHook(() => useTravel());
    await waitFor(() => expect(prefetchWorld).toHaveBeenCalledWith("scale"));
  });
  it("does nothing when no journey is active", async () => {
    mockState.mockResolvedValue(state(null));
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(prefetchWorld).not.toHaveBeenCalled();
  });
  it("does not prefetch the way HOME on a turn-back (already seen) — returning is not arming/in_transit", async () => {
    mockState.mockResolvedValue(state(journey({ state: "returning", destination: "home" })));
    const { result } = renderHook(() => useTravel());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(prefetchWorld).not.toHaveBeenCalled();
  });
  it("does not prefetch while disabled (worlds flag off)", async () => {
    mockState.mockResolvedValue(state(journey({ state: "arming" })));
    renderHook(() => useTravel(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(prefetchWorld).not.toHaveBeenCalled();
  });
});
