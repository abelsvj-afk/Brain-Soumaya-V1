import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorldsSurface from "./WorldsSurface.js";
import { useTravel, type UseTravel } from "../hooks/useTravel.js";

vi.mock("../hooks/useTravel.js", () => ({ useTravel: vi.fn() }));
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

  it("mid-journey renders nothing — arrival is the server's word first", () => {
    mockUseTravel.mockReturnValue(
      atStation({
        state: {
          currentWorld: "great-station",
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
