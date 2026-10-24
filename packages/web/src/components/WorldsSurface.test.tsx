import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorldsSurface from "./WorldsSurface.js";
import { useTravel, type UseTravel } from "../hooks/useTravel.js";

vi.mock("../hooks/useTravel.js", () => ({ useTravel: vi.fn() }));
vi.mock("../api/journeys.js", () => ({ getJourneys: vi.fn(async () => []) }));
const mockUseTravel = vi.mocked(useTravel);

function fakeTravel(over: Partial<UseTravel> = {}): UseTravel {
  return {
    state: {
      currentWorld: "home",
      activeJourney: null,
      fuel: { fuel: 25, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    loading: false,
    busy: false,
    error: null,
    cancelSecondsLeft: null,
    lastBonus: null,
    refresh: vi.fn(async () => {}),
    depart: vi.fn(async () => null),
    cancel: vi.fn(async () => null),
    turnBack: vi.fn(async () => null),
    arrive: vi.fn(async () => null),
    hasTraversed: () => false,
    ...over,
  };
}

const atStation = (over: Partial<UseTravel> = {}) =>
  fakeTravel({
    state: {
      currentWorld: "great-station",
      activeJourney: null,
      fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    ...over,
  });

const atGarden = (over: Partial<UseTravel> = {}) =>
  fakeTravel({
    state: {
      currentWorld: "growing-place",
      activeJourney: null,
      fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
    },
    ...over,
  });

const gardenGraph = {
  nodes: [
    { id: 1, label: "a", type: "memory", content: "", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: 2, label: "b", type: "memory", content: "", createdAt: "2025-05-01T00:00:00.000Z" },
  ],
  links: [
    { id: 10, source: 1, target: 2, relationship: "related", weight: 0.5, createdAt: "2026-10-01T00:00:00.000Z" },
  ],
} as never;

describe("WorldsSurface (P2-4 — the F-01 mount)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  it("flag off renders nothing (the dark contract)", () => {
    mockUseTravel.mockReturnValue(atStation());
    const { container } = render(<WorldsSurface enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("at home renders nothing — the surface belongs to the Station", () => {
    mockUseTravel.mockReturnValue(fakeTravel());
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
  });

  it("mid-journey renders the transit view, not nothing (P2-5) — arrival is still the server's word", async () => {
    mockUseTravel.mockReturnValue(
      atStation({
        state: {
          currentWorld: "home",
          activeJourney: {
            id: "j-9",
            kind: "warp",
            origin: "home",
            destination: "great-station",
            state: "in_transit",
            fuelCharged: 10,
            cancellable: false,
            createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z",
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    render(<WorldsSurface enabled />);
    expect(
      screen.getByRole("dialog", { name: "Travelling to The Great Station" }),
    ).toBeTruthy();
    // happy-dom has no working WebGL: the honest fallback appears,
    // the journey itself is unaffected.
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your journey is unaffected/)).toBeTruthy();
  });

  it("returning renders the transit view too (P2-5)", () => {
    mockUseTravel.mockReturnValue(
      atStation({
        state: {
          currentWorld: "great-station",
          activeJourney: {
            id: "j-10",
            kind: "drift",
            origin: "great-station",
            destination: "home",
            state: "returning",
            fuelCharged: 0,
            cancellable: false,
            createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z",
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    render(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "Travelling to Home" })).toBeTruthy();
  });

  it("arming renders nothing — the user is still at the origin and the panel owns the countdown (P2-5)", () => {
    mockUseTravel.mockReturnValue(
      atStation({
        state: {
          currentWorld: "home",
          activeJourney: {
            id: "j-11",
            kind: "warp",
            origin: "home",
            destination: "great-station",
            state: "arming",
            fuelCharged: 0,
            cancellable: true,
            createdAt: "2026-10-23T12:00:00.000Z",
            cancelDeadline: "2026-10-23T12:00:10.000Z",
          },
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    const { container } = render(<WorldsSurface enabled />);
    expect(container.firstChild).toBeNull();
  });

  it("at the Station the surface mounts; without WebGL it degrades honestly, and Close is view-only", async () => {
    mockUseTravel.mockReturnValue(atStation());
    render(<WorldsSurface enabled />);
    expect(screen.getByRole("dialog", { name: "The Great Station" })).toBeTruthy();
    // happy-dom has no working WebGL: the honest fallback appears,
    // journeys unaffected.
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to your galaxy" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("WorldsSurface — the Growing Place (P3-1)", () => {
  beforeEach(() => {
    mockUseTravel.mockReset();
  });

  it("at the garden with the graph it mounts the garden; without WebGL it degrades honestly", async () => {
    mockUseTravel.mockReturnValue(atGarden());
    render(<WorldsSurface enabled graph={gardenGraph} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(await screen.findByText(/needs graphics support/)).toBeTruthy();
    expect(screen.getByText(/your memories are unaffected/)).toBeTruthy();
  });

  it("at the garden without the graph yet it shows a loading line and builds nothing", () => {
    mockUseTravel.mockReturnValue(atGarden());
    render(<WorldsSurface enabled graph={null} />);
    expect(screen.getByRole("dialog", { name: "The Growing Place" })).toBeTruthy();
    expect(screen.getByText(/Your garden is loading/)).toBeTruthy();
  });

  it("an unknown world renders nothing — the registry admits only built worlds", () => {
    mockUseTravel.mockReturnValue(
      fakeTravel({
        state: {
          currentWorld: "deep-past",
          activeJourney: null,
          fuel: { fuel: 20, capacity: 200, jobCost: 2, warpCost: 10 },
        },
      }),
    );
    const { container } = render(<WorldsSurface enabled graph={gardenGraph} />);
    expect(container.firstChild).toBeNull();
  });
});
