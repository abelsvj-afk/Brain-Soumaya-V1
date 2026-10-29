import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTours } from "./useTours.js";
import * as toursApi from "../api/tours.js";
import { TRAVEL_CHANGED_EVENT, type TravelChangedDetail } from "../lib/travelEvents.js";

vi.mock("../api/tours.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/tours.js")>();
  return {
    ...orig,
    getTours: vi.fn(async () => ({ tours: [] })),
    getTourSuggestions: vi.fn(async () => ({ suggestions: [] })),
    getTourSession: vi.fn(async () => ({ session: null })),
    startTour: vi.fn(),
    advanceTour: vi.fn(),
    leaveTour: vi.fn(),
  };
});

// A tour leg IS a journey. The tours hook has its own API and never touched the travel hook, so a tour
// that started a flight was invisible to the scene layer — the same "nothing plays" bug as warping from
// the panel. Starting or advancing a tour must announce a departure.
let events: TravelChangedDetail[];
const onEvent = (e: Event) => events.push((e as CustomEvent<TravelChangedDetail>).detail);
beforeEach(() => {
  events = [];
  window.addEventListener(TRAVEL_CHANGED_EVENT, onEvent);
});
afterEach(() => window.removeEventListener(TRAVEL_CHANGED_EVENT, onEvent));

const move = { session: { session: { state: "playing" } }, journey: null } as never;

describe("useTours — announces journeys it starts", () => {
  it("starting a tour announces a departure", async () => {
    vi.mocked(toursApi.startTour).mockResolvedValue(move);
    const { result } = renderHook(() => useTours(true));
    await act(async () => {
      await result.current.start("t1", "drift");
    });
    expect(events.map((e) => e.action)).toEqual(["depart"]);
  });

  it("advancing to the next stop announces a departure", async () => {
    vi.mocked(toursApi.advanceTour).mockResolvedValue(move);
    const { result } = renderHook(() => useTours(true));
    await act(async () => {
      await result.current.advance("t1", "warp");
    });
    expect(events.map((e) => e.action)).toEqual(["depart"]);
  });

  it("a failed start announces nothing", async () => {
    vi.mocked(toursApi.startTour).mockRejectedValue(new toursApi.ToursClientError("NOPE", "no"));
    const { result } = renderHook(() => useTours(true));
    let out: unknown = "unset";
    await act(async () => {
      out = await result.current.start("t1");
    });
    expect(out).toBeNull(); // the failure came back as a null result…
    expect(events).toEqual([]); // …and nothing was announced
  });

  it("leaving a tour is not a departure", async () => {
    vi.mocked(toursApi.leaveTour).mockResolvedValue({ session: { session: { state: "ended" } } } as never);
    const { result } = renderHook(() => useTours(true));
    await act(async () => {
      await result.current.leave("t1");
    });
    expect(events).toEqual([]);
  });
});
